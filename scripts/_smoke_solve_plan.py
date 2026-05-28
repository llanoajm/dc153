#!/usr/bin/env python3
"""Smoke-validate the MCP ``solve_plan`` tool (REDESIGN_ROADMAP §12, LOOP item 12).

Two layers, mirroring how the ``list_networks`` / ``solve_opf`` verifications
work:

1. **Stdio protocol** — spawn ``scripts/user-mcp-server.py`` as a subprocess and
   speak newline-delimited JSON-RPC 2.0 to it (``initialize`` → ``tools/list``),
   exactly the slice opencode exercises. Assert ``steinmetz__solve_plan`` is
   advertised with the right input schema.

2. **Solve contract** — the tool's full entrypoint (``_builtin_solve_plan``)
   inserts a row into Supabase and would need a real workspace + service-role
   auth + a seeded network artifact we can't depend on in a CI-style smoke. Per
   the loop protocol's documented workaround (see ``_smoke_solve_opf.py``), we
   exercise the solve the tool wraps — ``plan_artifact.run_plan`` — directly
   against the on-disk ``data/networks/ieee-30/`` folder, and confirm the
   contract the MCP layer hands back: a per-iteration history carrying
   ``loss`` / ``op_cost`` / ``inv_cost`` and a final per-generator build.

3. **Optional end-to-end insert** — if Supabase is reachable (``.env.local``
   has the URL + service-role key) AND a canonical ``ieee-30`` network artifact
   is discoverable via the live ``list_networks`` builtin, drive a real stdio
   ``tools/call`` of ``solve_plan`` and assert it returns a ``plan_artifact_id``.
   Skipped (not failed) when the DB or seed row isn't available.

Run from ``/home/agent/grid-app``::

    python scripts/_smoke_solve_plan.py

Exits 0 when the protocol + solve contract pass; non-zero with a diagnostic
otherwise. ``--iterations`` / ``--hours`` tune the solve; defaults are tiny so
it finishes in a few seconds on CPU.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

MCP_SERVER = SCRIPTS_DIR / "user-mcp-server.py"
SOLVE_PLAN_TOOL = "steinmetz__solve_plan"


def _drive_stdio(requests: list[dict], timeout: float = 180.0) -> list[dict]:
    """Send a batch of JSON-RPC requests to the MCP server over stdio and
    return the parsed responses (one per request that carried an ``id``)."""
    if not MCP_SERVER.exists():
        raise FileNotFoundError(f"missing {MCP_SERVER}")
    payload = "".join(json.dumps(r) + "\n" for r in requests)
    proc = subprocess.run(
        [sys.executable, str(MCP_SERVER)],
        input=payload,
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(ROOT),
    )
    responses: list[dict] = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            responses.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    if not responses and proc.stderr:
        print("--- mcp stderr ---")
        print(proc.stderr[-2000:])
    return responses


def smoke_protocol() -> int:
    """Layer 1: confirm solve_plan is advertised over stdio tools/list."""
    print("[protocol] initialize + tools/list over stdio", flush=True)
    responses = _drive_stdio(
        [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
            {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        ]
    )
    by_id = {r.get("id"): r for r in responses}
    init = by_id.get(1)
    if not init or "result" not in init:
        print(f"FAIL [protocol]: bad initialize response: {init}")
        return 1
    listing = by_id.get(2)
    if not listing or "result" not in listing:
        print(f"FAIL [protocol]: bad tools/list response: {listing}")
        return 1
    tools = listing["result"].get("tools") or []
    names = {t.get("name") for t in tools}
    if SOLVE_PLAN_TOOL not in names:
        print(
            f"FAIL [protocol]: {SOLVE_PLAN_TOOL} not in tools/list "
            f"(saw {sorted(n for n in names if n)})"
        )
        return 1
    tool = next(t for t in tools if t.get("name") == SOLVE_PLAN_TOOL)
    props = (tool.get("inputSchema") or {}).get("properties") or {}
    required = (tool.get("inputSchema") or {}).get("required") or []
    if "network_artifact_id" not in props or "network_artifact_id" not in required:
        print(f"FAIL [protocol]: {SOLVE_PLAN_TOOL} schema missing required network_artifact_id")
        return 1
    for opt in ("hours", "iterations", "emissions_weight"):
        if opt not in props:
            print(f"FAIL [protocol]: {SOLVE_PLAN_TOOL} schema missing optional {opt!r}")
            return 1
    print(f"OK   [protocol]: {SOLVE_PLAN_TOOL} advertised with expected schema")
    return 0


def smoke_solve_contract(net_dir: Path, hours: int, iterations: int) -> int:
    """Layer 2: exercise run_plan (the solve _builtin_solve_plan wraps)."""
    from plan_artifact import build_plan_row, run_plan

    print(
        f"[contract] run_plan {net_dir.name} hours={hours} iterations={iterations} "
        "(CPU)",
        flush=True,
    )
    plan = run_plan(net_dir, hours=hours, num_iterations=iterations)

    history = plan.get("history") or {}
    for key in ("loss", "op_cost", "inv_cost"):
        series = history.get(key)
        if not series or len(series) < 1:
            print(f"FAIL [contract]: history missing/empty series {key!r}: {series!r}")
            return 1
    if any(v is None for v in history["loss"]):
        print(f"FAIL [contract]: loss history has None entries: {history['loss']}")
        return 1

    caps = plan.get("capacity_table") or []
    if not caps:
        print("FAIL [contract]: no final capacity table returned")
        return 1
    if any("after" not in c or c["after"] is None for c in caps):
        print(f"FAIL [contract]: capacity table missing 'after' values: {caps}")
        return 1

    if plan.get("solver", "").upper() == "MODAL_GPU":
        print("FAIL [contract]: solve_plan used GPU — must be CPU-only")
        return 1

    # The row builder is what _builtin_solve_plan inserts — confirm it produces
    # a kind='plan' row whose metadata carries the history + final caps.
    row = build_plan_row(
        network_artifact={"id": "smoke", "user_id": None},
        network_name=net_dir.name,
        network_slug=net_dir.name,
        net_dir=net_dir,
        plan=plan,
    )
    if row.get("kind") != "plan":
        print(f"FAIL [contract]: row kind={row.get('kind')!r}, expected 'plan'")
        return 1
    meta = row.get("metadata") or {}
    if not meta.get("history") or not meta.get("final_caps"):
        print("FAIL [contract]: plan row metadata missing history / final_caps")
        return 1
    if (row.get("view_spec") or {}).get("renderer") != "plan":
        print("FAIL [contract]: plan view_spec renderer is not 'plan'")
        return 1

    print(
        f"OK   [contract]: {len(history['loss'])} loss points, "
        f"final_loss={plan.get('final_loss')}, "
        f"op_cost={plan.get('final_op_cost')}, inv_cost={plan.get('final_inv_cost')}, "
        f"{len(caps)} generators (solver={plan.get('solver')})"
    )
    return 0


def smoke_end_to_end(hours: int, iterations: int) -> int:
    """Layer 3 (optional): real stdio tools/call against a seeded network."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("user_mcp_server", MCP_SERVER)
    mcp = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    try:
        spec.loader.exec_module(mcp)  # type: ignore[union-attr]
        env = mcp._load_grid_app_env()
        if not env.get("NEXT_PUBLIC_SUPABASE_URL") or not env.get(
            "SUPABASE_SERVICE_ROLE_KEY"
        ):
            print("[e2e] skipped — Supabase env not configured")
            return 0
        listing = json.loads(mcp._builtin_list_networks())
    except Exception as exc:  # noqa: BLE001
        print(f"[e2e] skipped — list_networks unavailable ({exc})")
        return 0

    networks = listing.get("networks") or []
    ieee = next(
        (n for n in networks if (n.get("slug") or "").startswith("ieee-30")),
        None,
    )
    if not ieee or not ieee.get("id"):
        print("[e2e] skipped — no seeded ieee-30 network artifact found")
        return 0

    print(f"[e2e] stdio tools/call solve_plan on network {ieee['id']}", flush=True)
    responses = _drive_stdio(
        [
            {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": {
                    "name": SOLVE_PLAN_TOOL,
                    "arguments": {
                        "network_artifact_id": ieee["id"],
                        "hours": hours,
                        "iterations": iterations,
                    },
                },
            },
        ]
    )
    call = next((r for r in responses if r.get("id") == 2), None)
    if not call or "result" not in call:
        print(f"FAIL [e2e]: bad tools/call response: {call}")
        return 1
    result = call["result"]
    text = (result.get("content") or [{}])[0].get("text", "")
    if result.get("isError"):
        print(f"FAIL [e2e]: solve_plan errored: {text[:500]}")
        return 1
    try:
        body = json.loads(text)
    except json.JSONDecodeError:
        print(f"FAIL [e2e]: solve_plan returned non-JSON: {text[:500]}")
        return 1
    if not body.get("plan_artifact_id"):
        print(f"FAIL [e2e]: solve_plan returned no plan_artifact_id: {body}")
        return 1
    print(f"OK   [e2e]: solve_plan wrote plan artifact {body['plan_artifact_id']}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--net-dir",
        default=str(ROOT / "data/networks/ieee-30"),
        help="PyPSA CSV folder (default: data/networks/ieee-30)",
    )
    parser.add_argument("--hours", type=int, default=1)
    parser.add_argument("--iterations", type=int, default=3)
    parser.add_argument(
        "--skip-e2e",
        action="store_true",
        help="Skip the optional Supabase-backed stdio tools/call layer.",
    )
    args = parser.parse_args()

    net_dir = Path(args.net_dir).resolve()
    if not (net_dir / "buses.csv").exists():
        print(f"FAIL: {net_dir} doesn't look like a PyPSA CSV folder")
        return 1

    try:
        rc = smoke_protocol()
        if rc != 0:
            return rc
        rc = smoke_solve_contract(net_dir, args.hours, args.iterations)
        if rc != 0:
            return rc
        if not args.skip_e2e:
            rc = smoke_end_to_end(args.hours, args.iterations)
            if rc != 0:
                return rc
    except Exception:
        traceback.print_exc()
        return 1
    print("ALL OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
