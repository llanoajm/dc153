"""
Run the zap demo on Modal.

Usage:
    modal run modal_demo.py               # fast CPU smoke test (no GPU)
    modal run modal_demo.py --gpu         # full H100 run (~45 min, detach below)
    modal run --detach modal_demo.py --gpu  # detached — safe to close laptop
    modal volume get zap-data demo/results.json ./data/demo/results.json
"""

import modal
from pathlib import Path

ZAP_ROOT = Path(__file__).parent

# Same image as modal_run.py — built once and cached.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libsuitesparse-dev")
    .pip_install(
        "torch==2.2.2",
        index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "numpy>=1.26.4,<2",
        "scipy>=1.12.0",
        "attrs>=24.2.0",
        "cvxpy==1.7.1",
        "ortools==9.11.4210",
        "pypsa==0.30.2",
        "h5py>=3.14.0",
        "pyyaml",
        "pandas",
        "scikit-sparse>=0.4.16",
    )
    .add_local_dir(
        str(ZAP_ROOT),
        "/zap",
        ignore=["data", ".git", "__pycache__", "*.pyc", ".venv", "*.egg-info"],
        copy=True,
    )
    .run_commands("pip install -e /zap --no-deps")
)

data_vol = modal.Volume.from_name("zap-data", create_if_missing=True)

app = modal.App("zap-demo", image=image)


@app.function(gpu="H100", timeout=120)
def probe_cuda():
    """Minimal CUDA probe — no zap code, just torch."""
    import subprocess
    r = subprocess.run(["nvidia-smi", "--query-gpu=name,driver_version,memory.total", "--format=csv,noheader"],
                       capture_output=True, text=True)
    print("[probe] nvidia-smi:", r.stdout.strip() or r.stderr.strip())
    import torch
    avail = torch.cuda.is_available()
    print(f"[probe] torch={torch.__version__} cuda_avail={avail}")
    if avail:
        x = torch.ones(3, device="cuda")
        print(f"[probe] tensor on cuda: {x}")
    return {"cuda": avail, "torch": torch.__version__}


@app.function(
    gpu="H100",
    volumes={"/zap/data": data_vol},
    timeout=3 * 60 * 60,
)
def run_demo_gpu():
    """Full demo on H100: MEP-GD, MEP-NN, RL-DQN. Results → zap-data volume."""
    import sys, traceback, subprocess
    sys.path.insert(0, "/zap")

    # Surface CUDA availability before anything else
    result = subprocess.run(["nvidia-smi"], capture_output=True, text=True)
    print("[GPU] nvidia-smi:", result.stdout[:300] if result.returncode == 0 else result.stderr[:300])

    import torch
    print(f"[GPU] torch={torch.__version__} cuda={torch.cuda.is_available()} device={torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A'}")

    try:
        from demo import run_all
        results = run_all(
            machine="cuda",
            out_path="/zap/data/demo/results.json",
            fast=False,
        )
        data_vol.commit()
        print(f"GPU demo complete — {results['elapsed_total_s']:.1f}s total")
        return {"status": "ok", "elapsed_s": results["elapsed_total_s"]}
    except Exception:
        traceback.print_exc()
        raise


@app.function(
    volumes={"/zap/data": data_vol},
    timeout=60 * 60,
    cpu=4,
    memory=8192,
)
def run_demo_cpu():
    """Fast CPU demo (smoke test). Results → zap-data volume."""
    import sys
    sys.path.insert(0, "/zap")
    from demo import run_all

    results = run_all(
        machine="cpu",
        out_path="/zap/data/demo/results.json",
        fast=True,
    )
    data_vol.commit()
    print(f"CPU demo complete — {results['elapsed_total_s']:.1f}s total")
    return {"status": "ok", "elapsed_s": results["elapsed_total_s"]}


@app.function(
    gpu="H100",
    volumes={"/zap/data": data_vol},
    timeout=60 * 60,
)
def run_demo_gpu_fast():
    """Fast GPU demo (same as CPU fast but on H100) for debugging."""
    import sys, traceback
    sys.path.insert(0, "/zap")
    import torch
    print(f"[GPU-fast] cuda={torch.cuda.is_available()} device={torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'N/A'}")
    try:
        from demo import run_all
        results = run_all(
            machine="cuda",
            out_path="/zap/data/demo/results.json",
            fast=True,
        )
        data_vol.commit()
        print(f"GPU-fast demo complete — {results['elapsed_total_s']:.1f}s total")
        return {"status": "ok", "elapsed_s": results["elapsed_total_s"], "machine": results["machine"]}
    except Exception:
        traceback.print_exc()
        raise


@app.local_entrypoint()
def main(gpu: bool = False, probe: bool = False, fast_gpu: bool = False):
    if probe:
        result = probe_cuda.remote()
        print(f"CUDA probe result: {result}")
    elif fast_gpu:
        # Sync (non-spawned) fast GPU run for debugging — stays connected
        result = run_demo_gpu_fast.remote()
        print(f"Fast GPU demo done: {result}")
    elif gpu:
        call = run_demo_gpu.spawn()
        print(f"Spawned GPU demo: {call.object_id}")
        print("Detached — safe to close laptop. Check progress with:")
        print("  modal app logs <app-id>")
        print("Download results when done:")
        print("  modal volume get zap-data demo/results.json ./data/demo/results.json")
    else:
        result = run_demo_cpu.remote()
        print(f"CPU demo done: {result}")
        print("Download results:")
        print("  modal volume get zap-data demo/results.json ./data/demo/results.json")
