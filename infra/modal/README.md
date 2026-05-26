# Modal-hosted GPU OPF solver

Wraps `zap.admm.ADMMSolver` in a Modal container so the web app can dispatch
GPU OPF solves without owning a GPU. Cold-start is accepted; we don't keep
containers warm.

## Files

- `solver_app.py` — the Modal app. Two functions:
  - `solve` — `@modal.fastapi_endpoint`, the HTTP entrypoint grid-app calls
  - `solve_direct` — `.remote()`-callable for Python clients and the smoke test
- `../../lib/modal-solver.ts` — thin TS client used by grid-app
- `../../.env.example` — `ZAP_SOLVER_MODAL_URL`, `ZAP_SOLVER_API_KEY` lines

## What you have to do (the gaps I can't fill)

1. **Create a Modal account** at https://modal.com, then on the VM:
   ```bash
   export PATH="$HOME/.local/bin:$PATH"   # modal was installed via pip --user
   modal token new                        # opens a browser; auth flow is yours
   ```

2. **Create the API-key secret.** Pick a random token, then:
   ```bash
   openssl rand -hex 32 > /tmp/solver_key
   modal secret create zap-solver-api-key SOLVER_API_KEY=$(cat /tmp/solver_key)
   ```
   Save the same value as `ZAP_SOLVER_API_KEY` in `grid-app/.env.local`.

3. **Deploy.** From `/home/agent/grid-app`:
   ```bash
   ZAP_SRC=/home/agent/zap \
     modal deploy infra/modal/solver_app.py
   ```
   First deploy uploads zap's source into the image and installs it, plus
   pulls down `torch==2.2.0` and the rest of zap's pinned deps. Expect a
   3-5 minute initial build; subsequent deploys are incremental.

4. **Copy the printed URL.** `modal deploy` prints something like
   `https://<workspace>--zap-opf-solver-solve.modal.run`. Paste it as
   `ZAP_SOLVER_MODAL_URL` in `.env.local`.

5. **Decide the GPU tier.** Default is `A10G` (~$1.10/hr while a container is
   alive; idles out 60s after the last request). Override per-deploy:
   ```bash
   ZAP_MODAL_GPU=L4 modal deploy infra/modal/solver_app.py   # cheaper, smaller
   ZAP_MODAL_GPU=A100 modal deploy infra/modal/solver_app.py # for big problems
   ```
   See https://modal.com/pricing for current rates.

6. **Smoke-test it.**
   ```bash
   SOLVER_API_KEY=$(cat /tmp/solver_key) \
     modal run infra/modal/solver_app.py::smoke
   ```
   This builds a 3-bus toy network on the fly and runs 100 ADMM iterations.
   Verifies the GPU path end-to-end. First call pays cold-start (~30s).

## What I already did

- `infra/modal/solver_app.py` — full Modal app with image, GPU function, and
  HTTP endpoint. Imports zap as a library; does not modify zap source.
- `lib/modal-solver.ts` — typed TS client (`solveOpfOnModal(...)`) returning a
  `SolveResult` with `outcome.power`, `outcome.angle`, `outcome.prices`.
- `.env.example` — added the two env vars callers need.

## CPU vs GPU parity

See [`PARITY_REPORT.md`](PARITY_REPORT.md) for the latest timing + LMP-diff
numbers (re-run with `python scripts/_gpu_parity_report.py`).

## Request / response shape

POST `<ZAP_SOLVER_MODAL_URL>`
```json
{
  "network_nc_b64": "<base64 of pypsa.Network.export_to_netcdf() bytes>",
  "args":        { "num_iterations": 1000, "rho_power": 1.0, "atol": 1e-5 },
  "import_args": { "power_unit": 1.0, "carbon_tax": 0.0 }
}
```
Header: `Authorization: Bearer <SOLVER_API_KEY>`.

Response:
```json
{
  "machine": "cuda",
  "gpu": "A10G",
  "elapsed_s": 4.2,
  "time_horizon": 24,
  "num_buses": 118,
  "num_devices": [54, 99, 0, 186],
  "bus_ids": ["1", "2", "..."],
  "snapshot_iso": ["2024-01-01T00:00:00", "..."],
  "device_class_names": ["Generator", "Load", "ACLine", "..."],
  "outcome": {
    "power":  [[[...]]],
    "angle":  [[...]],
    "prices": [[...]]
  },
  "solver_args": { ... }
}
```

## Cost notes

- Default `scaledown_window=60` means a warm container dies 60s after its
  last request. A burst of solves within a minute reuses the same GPU; a
  one-off solve pays full cold-start every time.
- Cold-start dominated by `torch` import and CUDA context init — typically
  20-40s on A10G, longer on A100.
- Override `ZAP_MODAL_SCALEDOWN` if you want the container alive longer
  between solves (trades $ for latency).
