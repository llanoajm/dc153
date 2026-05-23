#!/usr/bin/env python3
"""Detached ingestion for an uploaded PyPSA folder.

Driven by ``app/api/upload/route.ts``. Walks an artifact through the
pipeline statuses required by ROADMAP §1 / §6:

    queued -> extracting -> embedded -> ready

* ``extracting``: unzip if needed; locate the PyPSA folder root (descending
  one level if a wrapper directory was uploaded); validate ``buses.csv``.
* ``embedded``: extract the topology summary (bus/line/generator counts,
  carrier mix, downsampled buses + lines) and write it into the artifact's
  ``view_spec`` so the network-graph renderer can draw it without
  re-reading the filesystem on every request.
* ``ready``: run the 1-hour smoke dispatch (the same routine used by the
  canonical seeding pipeline).

On any failure the artifact's ``status`` flips to ``failed_validation`` and
``metadata.pipeline_error`` records the message.

Auth: requires ``SUPABASE_SERVICE_ROLE_KEY`` in the environment (or in
``.env.local``); without it the script exits 1 immediately so the upload
route's spawn fails loud during local dev.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import _pypsa_compat  # noqa: F401  must precede pypsa/zap imports

MAX_BUSES_INLINE = 1500
ENV_FILE = ROOT / ".env.local"


def _load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    env.update(os.environ)
    return env


def _supabase_request(env: dict[str, str], method: str, path: str, body: Any = None) -> Any:
    url = env["NEXT_PUBLIC_SUPABASE_URL"]
    key = env["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(
        f"{url}/rest/v1/{path}",
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        text = resp.read().decode()
        return json.loads(text) if text else None


def _fetch_artifact(env: dict[str, str], artifact_id: str) -> dict[str, Any]:
    rows = _supabase_request(env, "GET", f"artifacts?id=eq.{artifact_id}&select=*")
    if not rows:
        raise RuntimeError(f"artifact {artifact_id} not found")
    return rows[0]


def _patch_artifact(env: dict[str, str], artifact_id: str, patch: dict[str, Any]) -> None:
    _supabase_request(env, "PATCH", f"artifacts?id=eq.{artifact_id}", patch)


def _set_pipeline_status(
    env: dict[str, str],
    artifact_id: str,
    pipeline_status: str,
    extra_metadata: dict[str, Any] | None = None,
) -> None:
    # Fetch current metadata so we can merge — PostgREST's PATCH replaces the
    # whole jsonb value otherwise.
    current = _fetch_artifact(env, artifact_id)
    metadata = dict(current.get("metadata") or {})
    metadata["pipeline_status"] = pipeline_status
    if extra_metadata:
        metadata.update(extra_metadata)
    _patch_artifact(env, artifact_id, {"metadata": metadata})


def _set_failed(env: dict[str, str], artifact_id: str, message: str) -> None:
    try:
        current = _fetch_artifact(env, artifact_id)
        metadata = dict(current.get("metadata") or {})
        metadata["pipeline_status"] = "failed"
        metadata["pipeline_error"] = message[:2000]
        _patch_artifact(
            env,
            artifact_id,
            {"metadata": metadata, "status": "failed_validation"},
        )
    except Exception:
        # Best-effort — if we can't even write the failure, give up quietly.
        traceback.print_exc()


def _set_view_spec_topology(
    env: dict[str, str],
    artifact_id: str,
    topology: dict[str, Any],
) -> None:
    current = _fetch_artifact(env, artifact_id)
    view_spec = dict(current.get("view_spec") or {})
    view_spec["renderer"] = "network-graph"
    view_spec["buses"] = topology["buses"]
    view_spec["lines"] = topology["lines"]
    view_spec["counts"] = topology["counts"]
    if topology.get("truncated"):
        view_spec["truncated"] = True
    metadata = dict(current.get("metadata") or {})
    metadata.update(
        {
            "buses": topology["counts"]["buses"],
            "lines": topology["counts"]["lines"],
            "generators": topology["counts"]["generators"],
        }
    )
    if topology.get("carrier_mix"):
        metadata["carrier_mix"] = topology["carrier_mix"]
    _patch_artifact(env, artifact_id, {"view_spec": view_spec, "metadata": metadata})


def _maybe_unzip(folder: Path) -> None:
    zips = [p for p in folder.iterdir() if p.suffix.lower() == ".zip"]
    for z in zips:
        with zipfile.ZipFile(z) as zf:
            zf.extractall(folder)
        z.unlink()


def _find_pypsa_root(folder: Path) -> Path:
    """Descend one level if the user uploaded a wrapper directory."""
    if (folder / "buses.csv").exists():
        return folder
    sub_dirs = [p for p in folder.iterdir() if p.is_dir()]
    if len(sub_dirs) == 1 and (sub_dirs[0] / "buses.csv").exists():
        return sub_dirs[0]
    # Search one level deeper as a last resort
    for sub in sub_dirs:
        if (sub / "buses.csv").exists():
            return sub
    raise FileNotFoundError(
        f"no buses.csv found in {folder} or any immediate subdirectory; "
        "this doesn't look like a PyPSA CSV folder"
    )


def _extract_topology(net_dir: Path) -> dict[str, Any]:
    import pandas as pd

    buses_df = pd.read_csv(net_dir / "buses.csv")
    name_col = "name" if "name" in buses_df.columns else buses_df.columns[0]
    buses_df[name_col] = buses_df[name_col].astype(str)

    has_xy = "x" in buses_df.columns and "y" in buses_df.columns
    bus_records: list[dict[str, Any]] = []
    for _, row in buses_df.iterrows():
        rec: dict[str, Any] = {"id": str(row[name_col])}
        if has_xy:
            x_val = row.get("x")
            y_val = row.get("y")
            if pd.notna(x_val) and pd.notna(y_val):
                rec["x"] = float(x_val)
                rec["y"] = float(y_val)
        if "carrier" in buses_df.columns:
            c = row.get("carrier")
            if isinstance(c, str) and c:
                rec["carrier"] = c
        bus_records.append(rec)

    lines_path = net_dir / "lines.csv"
    line_records: list[dict[str, Any]] = []
    if lines_path.exists():
        lines_df = pd.read_csv(lines_path)
        for col in ("bus0", "bus1"):
            if col in lines_df.columns:
                lines_df[col] = lines_df[col].astype(str)
        for _, row in lines_df.iterrows():
            if "bus0" not in lines_df.columns or "bus1" not in lines_df.columns:
                break
            rec: dict[str, Any] = {
                "source": str(row["bus0"]),
                "target": str(row["bus1"]),
            }
            if "s_nom" in lines_df.columns:
                s = row.get("s_nom")
                if pd.notna(s):
                    rec["s_nom"] = float(s)
            line_records.append(rec)

    generators_path = net_dir / "generators.csv"
    generators_count = 0
    carrier_mix: dict[str, float] = {}
    if generators_path.exists():
        gens_df = pd.read_csv(generators_path)
        generators_count = int(len(gens_df))
        if "carrier" in gens_df.columns and "p_nom" in gens_df.columns:
            grouped = gens_df.groupby("carrier")["p_nom"].sum()
            total = float(grouped.sum())
            if total > 0:
                carrier_mix = {
                    str(k): round(float(v) / total, 4) for k, v in grouped.items()
                }

    total_buses = int(len(buses_df))
    total_lines = int(len(line_records))

    truncated = False
    if len(bus_records) > MAX_BUSES_INLINE:
        stride = max(1, len(bus_records) // MAX_BUSES_INLINE)
        sampled_buses = bus_records[::stride]
        kept_ids = {b["id"] for b in sampled_buses}
        sampled_lines = [
            line
            for line in line_records
            if line["source"] in kept_ids and line["target"] in kept_ids
        ]
        bus_records = sampled_buses
        line_records = sampled_lines
        truncated = True

    return {
        "buses": bus_records,
        "lines": line_records,
        "counts": {
            "buses": total_buses,
            "lines": total_lines,
            "generators": generators_count,
        },
        "carrier_mix": carrier_mix,
        "truncated": truncated,
    }


def _smoke_dispatch(net_dir: Path) -> dict[str, Any]:
    from smoke_dispatch import smoke_dispatch

    outcome = smoke_dispatch(net_dir)
    info: dict[str, Any] = {"smoke_dispatch": "ok"}
    if outcome is not None and getattr(outcome, "prices", None) is not None:
        try:
            info["smoke_prices_shape"] = list(outcome.prices.shape)
        except Exception:
            pass
    return info


def ingest(artifact_id: str, folder: Path) -> None:
    env = _load_env()
    if "SUPABASE_SERVICE_ROLE_KEY" not in env or "NEXT_PUBLIC_SUPABASE_URL" not in env:
        raise SystemExit("missing Supabase env vars (need SUPABASE_SERVICE_ROLE_KEY)")

    try:
        _set_pipeline_status(env, artifact_id, "extracting")
        _maybe_unzip(folder)
        net_dir = _find_pypsa_root(folder)
        topology = _extract_topology(net_dir)
        _set_view_spec_topology(env, artifact_id, topology)
        _set_pipeline_status(
            env,
            artifact_id,
            "embedded",
            extra_metadata={"pypsa_root": str(net_dir.relative_to(folder.parent))},
        )

        # If the upload landed inside a wrapper directory, update fs_path to
        # point at the real PyPSA root so the topology endpoint resolves it.
        if net_dir != folder:
            _patch_artifact(env, artifact_id, {"fs_path": str(net_dir)})

        info = _smoke_dispatch(net_dir)
        _set_pipeline_status(env, artifact_id, "ready", extra_metadata=info)
    except Exception as err:
        message = "".join(traceback.format_exception(err))
        _set_failed(env, artifact_id, message)
        # Print to stderr too in case the parent is watching logs.
        sys.stderr.write(message)
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-id", required=True)
    parser.add_argument("--folder", required=True, help="absolute path to the raw upload folder")
    args = parser.parse_args()
    ingest(args.artifact_id, Path(args.folder).resolve())


if __name__ == "__main__":
    main()
