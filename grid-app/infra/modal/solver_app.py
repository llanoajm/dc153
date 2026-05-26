"""Modal app exposing zap's ADMM OPF solver as a GPU web endpoint.

Deploy with:
    ZAP_SRC=/path/to/zap modal deploy infra/modal/solver_app.py

The deployed endpoint accepts a PyPSA network (netCDF bytes, base64-encoded
inside a JSON envelope) plus solver args, runs ADMMSolver on a GPU container,
and returns a JSON-serialisable dispatch outcome (LMPs, powers, angles).

Cold-start is expected; we don't keep containers warm. See README.md for the
end-to-end deploy recipe and what callers must supply.
"""

from __future__ import annotations

import base64
import io
import os
import pickle
import time
from pathlib import Path

from typing import TYPE_CHECKING

import modal

if TYPE_CHECKING:
    from fastapi import Request

ZAP_SRC = Path(os.environ.get("ZAP_SRC", "/home/agent/zap")).resolve()

GPU_TIER = os.environ.get("ZAP_MODAL_GPU", "H100")
SOLVER_TIMEOUT_S = int(os.environ.get("ZAP_MODAL_TIMEOUT", "600"))
SCALEDOWN_WINDOW_S = int(os.environ.get("ZAP_MODAL_SCALEDOWN", "60"))

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "build-essential")
    .pip_install(
        "torch==2.2.0",
        "numpy>=1.26,<2.0",
        "scipy>=1.12",
        "pypsa==0.30.2",
        "attrs>=24.2",
        "h5py>=3.14",
        "cvxpy==1.7.1",
        "ortools==9.11.4210",
        "pandas",
        "netcdf4",
        "fastapi[standard]",
    )
    .add_local_dir(str(ZAP_SRC), remote_path="/root/zap", copy=True)
    .run_commands("pip install /root/zap --no-deps")
)

app = modal.App("zap-opf-solver", image=image)

api_key_secret = modal.Secret.from_name(
    "zap-solver-api-key", required_keys=["SOLVER_API_KEY"]
)


_PANDAS_COW_PATCHED = False


def _patch_pandas_cow_in_container():
    """Pandas 3.0 enabled Copy-on-Write by default, which makes
    ``DataFrame.values`` / ``Series.values`` return read-only ndarrays.
    ``zap.importers.pypsa`` mutates those arrays in-place (``+=``, ``/=``),
    so importing a real PyPSA network blows up with
    ``ValueError: output array is read-only``. Mirrors the shim used in
    ``grid-app/scripts/_pypsa_compat.py`` and ``zap/tests/conftest.py``.
    Idempotent under pandas <3.0 where ``.values`` is already writable."""
    global _PANDAS_COW_PATCHED
    if _PANDAS_COW_PATCHED:
        return

    import numpy as np
    import pandas as pd

    orig_df = pd.DataFrame.values.fget
    orig_series = pd.Series.values.fget

    def _writable(arr):
        if isinstance(arr, np.ndarray) and not arr.flags.writeable:
            return arr.copy()
        return arr

    def _df_values(self):
        return _writable(orig_df(self))

    def _series_values(self):
        return _writable(orig_series(self))

    pd.DataFrame.values = property(_df_values)
    pd.Series.values = property(_series_values)
    _PANDAS_COW_PATCHED = True


def _tensor_to_list(x):
    """Convert torch tensors / nested structures to JSON-friendly Python."""
    import torch
    import numpy as np

    if x is None:
        return None
    if isinstance(x, torch.Tensor):
        return x.detach().cpu().numpy().tolist()
    if isinstance(x, np.ndarray):
        return x.tolist()
    if isinstance(x, (list, tuple)):
        return [_tensor_to_list(xi) for xi in x]
    if isinstance(x, dict):
        return {k: _tensor_to_list(v) for k, v in x.items()}
    return x


def _run_solve(network_nc: bytes, args: dict, import_args: dict) -> dict:
    """Body of the solve, broken out so both the web endpoint and the local
    entrypoint share the same code path."""
    _patch_pandas_cow_in_container()
    import pypsa
    import torch
    import zap
    from zap.admm import ADMMSolver, ADMMLayer
    from zap.importers.pypsa import load_pypsa_network

    t0 = time.time()

    # 1. Deserialise the PyPSA network from netCDF (path-only API).
    import tempfile
    pnet = pypsa.Network()
    with tempfile.NamedTemporaryFile(suffix=".nc", delete=False) as tf:
        tf.write(network_nc)
        tf.flush()
        nc_path = tf.name
    try:
        pnet.import_from_netcdf(nc_path)
    finally:
        Path(nc_path).unlink(missing_ok=True)

    # 2. Build zap network + devices.
    net, devices = load_pypsa_network(pnet, **(import_args or {}))
    time_horizon = max(d.time_horizon for d in devices)

    # 3. Configure the ADMM solver. Default to GPU + float32.
    dtype = torch.float32 if args.get("dtype", "float32") == "float32" else torch.float64
    solver_kwargs = {
        "machine": "cuda" if torch.cuda.is_available() else "cpu",
        "dtype": dtype,
        "num_iterations": int(args.get("num_iterations", 1000)),
        "rho_power": float(args.get("rho_power", 1.0)),
        "rho_angle": float(args.get("rho_angle", 1.0)),
        "atol": float(args.get("atol", 1e-5)),
        "rtol": float(args.get("rtol", 1e-5)),
    }
    solver = ADMMSolver(**solver_kwargs)

    # 4. Move device data onto the solver's machine.
    devices_t = [d.torchify(machine=solver.machine, dtype=solver.dtype) for d in devices]

    # 5. Build the layer and run a forward solve at the base parameters.
    layer = ADMMLayer(
        net,
        devices_t,
        parameter_names={},
        time_horizon=time_horizon,
        solver=solver,
        adapt_rho=False,
        warm_start=False,
        verbose=False,
    )
    params = layer.initialize_parameters()
    # ADMMLayer.forward returns an ADMMState (raw solver fields: power, phase,
    # dual_power, ...). The DispatchOutcome view (power, angle, prices) is one
    # `.as_outcome()` call away — match the CPU return shape so the response
    # below can stay aligned with the existing keys.
    outcome = layer(**params).as_outcome()

    elapsed = time.time() - t0

    return {
        "machine": solver.machine,
        "gpu": GPU_TIER if solver.machine == "cuda" else None,
        "elapsed_s": elapsed,
        "time_horizon": int(time_horizon),
        "num_buses": int(net.num_nodes),
        "num_devices": [int(d.num_devices) for d in devices_t],
        "outcome": {
            "power": _tensor_to_list(outcome.power),
            "angle": _tensor_to_list(outcome.angle),
            "prices": _tensor_to_list(outcome.prices),
        },
        "solver_args": {
            **{k: v for k, v in solver_kwargs.items() if k != "dtype"},
            "dtype": args.get("dtype", "float32"),
        },
    }


@app.function(gpu=GPU_TIER, timeout=120)
def verify_gpu() -> str:
    """Lightweight smoke test: confirm the container can acquire the GPU and
    that zap + torch import cleanly. Returns a JSON string so the local
    runner doesn't need torch installed to deserialize the result."""
    import json
    import torch
    import zap  # noqa: F401  — proves the package is installed in the image.

    info = {
        "cuda_available": bool(torch.cuda.is_available()),
        "device_count": int(torch.cuda.device_count()) if torch.cuda.is_available() else 0,
        "torch_version": str(torch.__version__),
        "zap_version": getattr(zap, "__version__", "unknown"),
    }
    if info["cuda_available"]:
        info["device_name"] = str(torch.cuda.get_device_name(0))
        info["cuda_version"] = str(torch.version.cuda)
        x = torch.randn(2048, 2048, device="cuda", dtype=torch.float32)
        y = x @ x.T
        info["gemm_ok"] = bool(torch.isfinite(y).all().item())
    return json.dumps(info)


@app.function(
    gpu=GPU_TIER,
    timeout=SOLVER_TIMEOUT_S,
    scaledown_window=SCALEDOWN_WINDOW_S,
)
def smoke_solve_native_toy(num_iterations: int = 100) -> dict:
    """Exercise the GPU + ADMM stack using zap's native toy network
    (`zap.importers.toy.load_test_network`), bypassing the pypsa importer.
    Used to verify the deploy end-to-end without needing a real input file."""
    import torch
    from zap.importers.toy import load_test_network
    from zap.admm import ADMMSolver, ADMMLayer

    net, devices = load_test_network()
    time_horizon = max(d.time_horizon for d in devices)

    solver = ADMMSolver(
        machine="cuda" if torch.cuda.is_available() else "cpu",
        dtype=torch.float32,
        num_iterations=num_iterations,
        rho_power=1.0,
        rho_angle=1.0,
        atol=1e-5,
        rtol=1e-5,
    )
    devices_t = [d.torchify(machine=solver.machine, dtype=solver.dtype) for d in devices]
    layer = ADMMLayer(
        net, devices_t, parameter_names={}, time_horizon=time_horizon,
        solver=solver, adapt_rho=False, warm_start=False, verbose=False,
    )
    t0 = time.time()
    outcome = layer(**layer.initialize_parameters())
    return {
        "machine": solver.machine,
        "gpu": GPU_TIER if solver.machine == "cuda" else None,
        "elapsed_s": time.time() - t0,
        "time_horizon": int(time_horizon),
        "num_buses": int(net.num_nodes),
        "num_devices": [int(d.num_devices) for d in devices_t],
        "power_shape": list(outcome.power[0].shape) if outcome.power else [],
        "prices_shape": list(outcome.prices.shape) if hasattr(outcome.prices, "shape") else [],
    }


@app.function(timeout=120)
def build_toy_network_nc() -> bytes:
    """Build a tiny 3-bus PyPSA network inside the container and return its
    netCDF bytes. Used by the local smoke entrypoint, which doesn't have
    pypsa installed in the VM."""
    import tempfile
    import pypsa
    import pandas as pd

    pnet = pypsa.Network()
    pnet.set_snapshots(pd.date_range("2024-01-01", periods=4, freq="h"))
    pnet.add("Bus", ["b0", "b1", "b2"])
    pnet.add("Generator", "g0", bus="b0", p_nom=100, marginal_cost=20)
    pnet.add("Generator", "g1", bus="b1", p_nom=80, marginal_cost=35)
    pnet.add("Load", "l0", bus="b2", p_set=60)
    pnet.add("Line", "L01", bus0="b0", bus1="b1", x=0.1, s_nom=200)
    pnet.add("Line", "L12", bus0="b1", bus1="b2", x=0.1, s_nom=200)
    # pypsa.export_to_netcdf wants a filesystem path, not a buffer.
    with tempfile.NamedTemporaryFile(suffix=".nc") as tf:
        pnet.export_to_netcdf(tf.name)
        return Path(tf.name).read_bytes()


@app.function(
    gpu=GPU_TIER,
    timeout=SOLVER_TIMEOUT_S,
    scaledown_window=SCALEDOWN_WINDOW_S,
)
def solve_direct(network_nc: bytes, args: dict, import_args: dict) -> dict:
    """Direct RPC entrypoint — call via `solve_direct.remote(...)` from Python.
    Used by the local smoke test and by any future Python-side caller that
    doesn't want to go through the HTTP endpoint."""
    return _run_solve(network_nc, args, import_args)


@app.function(
    gpu=GPU_TIER,
    timeout=SOLVER_TIMEOUT_S,
    scaledown_window=SCALEDOWN_WINDOW_S,
    secrets=[api_key_secret],
)
@modal.fastapi_endpoint(method="POST")
def solve(payload: dict, request: Request):
    """HTTP entrypoint. POST JSON:

        {
          "network_nc_b64": "<base64 PyPSA netCDF bytes>",
          "args":           {"num_iterations": 500, "rho_power": 1.0, ...},
          "import_args":    {"power_unit": 1.0, ...}
        }

    Header: `Authorization: Bearer <SOLVER_API_KEY>`.
    """
    from fastapi import HTTPException

    expected = os.environ.get("SOLVER_API_KEY", "")
    presented = request.headers.get("authorization", "").removeprefix("Bearer ").strip()
    if not expected or presented != expected:
        raise HTTPException(status_code=401, detail="unauthorized")

    if "network_nc_b64" not in payload:
        raise HTTPException(status_code=400, detail="missing network_nc_b64")
    try:
        network_nc = base64.b64decode(payload["network_nc_b64"])
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"bad base64: {e}")

    try:
        return _run_solve(
            network_nc,
            payload.get("args") or {},
            payload.get("import_args") or {},
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"solve failed: {type(e).__name__}: {e}"
        )


@app.local_entrypoint()
def smoke(network_path: str = "", num_iterations: int = 100):
    """Smoke test: `modal run solver_app.py::smoke --network-path foo.nc`.

    If `network-path` is empty, build a tiny toy network on the fly so a
    deploy-time sanity check doesn't need an input file.
    """
    import json
    if network_path:
        # Real input -> pypsa importer path.
        nc_bytes = Path(network_path).read_bytes()
        result = solve_direct.remote(nc_bytes, {"num_iterations": num_iterations}, {})
        summary = {k: v for k, v in result.items() if k != "outcome"}
        summary["outcome_keys"] = list(result.get("outcome", {}).keys())
    else:
        # No file -> lightweight GPU + zap-import verification.
        print("Verifying GPU + image (no solve; see note in verify_gpu)...")
        # verify_gpu returns a JSON string so this works without torch locally.
        summary = json.loads(verify_gpu.remote())
    print(json.dumps(summary, indent=2, default=str))
