#!/usr/bin/env python3
"""Detached ingestion for an uploaded network folder.

Driven by ``app/api/upload/route.ts``. Walks an artifact through the
pipeline statuses required by ROADMAP §1 / §6 / §7:

    queued -> extracting -> embedded -> ready

Converter chain (tried in order):

* **PyPSA CSV folder** — the canonical shape. Detected by the presence of
  ``buses.csv`` at the folder root (or one level down).
* **MATPOWER ``.m``** — any single ``.m`` file in the upload is parsed via
  ``scripts/_matpower.py`` and round-tripped through PyPSA to a CSV folder.
* **Custom importer** — modules under ``<workspace>/features/import_*.py``
  that expose ``matches(folder) -> bool`` and ``convert(folder, dest) -> None``
  (ROADMAP §1, item 7 of LOOP_QUEUE.md). The first importer whose ``matches``
  returns True is invoked; ``convert`` must write a PyPSA-compatible CSV
  folder to ``dest``. The pipeline then continues against that converted
  folder.

If no converter matches the artifact is left in
``pipeline_status='awaiting_importer'`` with ``metadata.inspection`` (a
schema fingerprint plus per-CSV column lists) so the agent can author a
custom importer. The artifact's ``status`` stays ``draft`` (not failed) —
the upload itself didn't fail, we just don't yet know how to read it.

If a converter matches but extraction or smoke dispatch fails, the
artifact's ``status`` flips to ``failed_validation`` and
``metadata.pipeline_error`` records the message.

Auth: requires ``SUPABASE_SERVICE_ROLE_KEY`` in the environment (or in
``.env.local``); without it the script exits 1 immediately so the upload
route's spawn fails loud during local dev.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sys
import traceback
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable

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
        traceback.print_exc()


def _set_awaiting_importer(
    env: dict[str, str],
    artifact_id: str,
    inspection: dict[str, Any],
) -> None:
    current = _fetch_artifact(env, artifact_id)
    metadata = dict(current.get("metadata") or {})
    metadata["pipeline_status"] = "awaiting_importer"
    metadata["inspection"] = inspection
    _patch_artifact(env, artifact_id, {"metadata": metadata})


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


def _find_pypsa_root(folder: Path) -> Path | None:
    if (folder / "buses.csv").exists():
        return folder
    sub_dirs = [p for p in folder.iterdir() if p.is_dir()]
    if len(sub_dirs) == 1 and (sub_dirs[0] / "buses.csv").exists():
        return sub_dirs[0]
    for sub in sub_dirs:
        if (sub / "buses.csv").exists():
            return sub
    return None


def _find_matpower_file(folder: Path) -> Path | None:
    """Return the first ``.m`` file found anywhere in ``folder``."""
    candidates = sorted(folder.rglob("*.m"))
    return candidates[0] if candidates else None


def _matpower_to_pypsa_folder(mp_path: Path, dest: Path) -> None:
    """Round-trip MATPOWER through PyPSA into a CSV folder at ``dest``."""
    from _matpower import parse_matpower
    import pandas as pd
    import pypsa

    mp = parse_matpower(mp_path)

    n = pypsa.Network()
    n.name = mp_path.stem
    for row in mp["bus"]:
        bus_id = str(int(row[0]))
        base_kv = row[9] if len(row) > 9 else 138.0
        n.add("Bus", bus_id, v_nom=float(base_kv))
    for row in mp["bus"]:
        bus_id = str(int(row[0]))
        pd_load = row[2] if len(row) > 2 else 0.0
        if pd_load and pd_load != 0:
            n.add("Load", f"load_{bus_id}", bus=bus_id, p_set=float(pd_load))
    for i, row in enumerate(mp["branch"]):
        f, t = str(int(row[0])), str(int(row[1]))
        r, x, b, rate_a = row[2], row[3], row[4], row[5]
        n.add(
            "Line",
            f"line_{i}",
            bus0=f,
            bus1=t,
            r=float(r),
            x=float(max(x, 1e-3)),
            b=float(b),
            s_nom=float(rate_a) if rate_a > 0 else 9999.0,
        )
    n.add("Carrier", "thermal", co2_emissions=0.5)
    for i, gr in enumerate(mp["gen"]):
        bus_id = str(int(gr[0]))
        p_max = gr[8] if len(gr) > 8 else 100.0
        marginal_cost = 50.0
        if i < len(mp["gencost"]):
            gc = mp["gencost"][i]
            model = int(gc[0])
            ncoef = int(gc[3])
            if model == 2 and ncoef >= 2:
                coefs = gc[4 : 4 + ncoef]
                marginal_cost = max(coefs[-2], 1.0)
        n.add(
            "Generator",
            f"gen_{i}",
            bus=bus_id,
            p_nom=float(p_max) if p_max > 0 else 100.0,
            marginal_cost=float(marginal_cost),
            carrier="thermal",
        )
    n.set_snapshots(pd.date_range("2024-01-01", periods=1, freq="h"))

    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(parents=True)
    n.export_to_csv_folder(str(dest))


def _features_dir() -> Path | None:
    """Resolve the per-user features dir from the upload's path.

    Uploads land at ``<workspace>/sources/<slug>/raw/``; we walk up to find
    ``features/`` next to it. Returns None if the directory layout doesn't
    match.
    """
    explicit = os.environ.get("STEINMETZ_FEATURES_DIR")
    if explicit:
        p = Path(explicit)
        return p if p.exists() else None
    return None


def _features_dir_from_folder(folder: Path) -> Path | None:
    """Find ``<workspace>/features`` by walking up from the raw upload dir."""
    cur = folder.resolve()
    for _ in range(6):
        candidate = cur / "features"
        if candidate.is_dir():
            return candidate
        if cur.parent == cur:
            break
        cur = cur.parent
    return None


def _load_importer(path: Path):
    spec = importlib.util.spec_from_file_location(
        f"steinmetz_importer_{path.stem}", path
    )
    if not spec or not spec.loader:
        raise ImportError(f"cannot build spec for {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _try_custom_importers(
    folder: Path,
    features_dir: Path,
) -> tuple[Path | None, dict[str, Any]]:
    """Return ``(converted_dir, importer_info)`` if any custom importer matches.

    Imports modules whose names start with ``import_`` (per ROADMAP §1's
    naming convention). Each must expose ``matches(folder: Path) -> bool``
    and ``convert(folder: Path, dest: Path) -> None``. The first match wins;
    its ``convert`` is invoked and the resulting PyPSA CSV folder is
    returned for the downstream pipeline to consume.
    """
    if not features_dir.exists():
        return None, {}
    tried: list[str] = []
    for path in sorted(features_dir.glob("import_*.py")):
        if path.name.startswith("_"):
            continue
        slug = path.stem
        tried.append(slug)
        try:
            module = _load_importer(path)
        except Exception as exc:
            sys.stderr.write(f"[ingest] skip importer {slug}: {exc}\n")
            continue
        matches: Callable[[Path], bool] | None = getattr(module, "matches", None)
        convert: Callable[[Path, Path], None] | None = getattr(module, "convert", None)
        if matches is None or convert is None:
            continue
        try:
            if not matches(folder):
                continue
        except Exception as exc:
            sys.stderr.write(f"[ingest] importer {slug}.matches() raised: {exc}\n")
            continue
        dest = folder.parent / "converted"
        try:
            convert(folder, dest)
        except Exception as exc:
            raise RuntimeError(
                f"custom importer {slug} matched but convert() failed: {exc}"
            ) from exc
        if not (dest / "buses.csv").exists():
            raise RuntimeError(
                f"custom importer {slug} produced no buses.csv at {dest}"
            )
        return dest, {"importer": slug, "tried": tried}
    return None, {"tried": tried}


def _csv_files_in(folder: Path) -> list[Path]:
    return sorted(p for p in folder.rglob("*.csv") if p.is_file())


def _inspect_folder(folder: Path) -> dict[str, Any]:
    """Build the schema fingerprint shown to the agent for unknown uploads.

    Records one entry per CSV: relative path, columns, row count, and the
    first three rows as plain dicts. A short SHA-1 of the sorted column
    names per file gives us a stable fingerprint for matching against later
    importers.
    """
    import pandas as pd

    csv_files = _csv_files_in(folder)
    files: list[dict[str, Any]] = []
    fingerprint_parts: list[str] = []
    for path in csv_files:
        rel = str(path.relative_to(folder))
        try:
            df = pd.read_csv(path, nrows=5)
        except Exception as exc:
            files.append({"path": rel, "error": str(exc)[:200]})
            continue
        columns = [str(c) for c in df.columns]
        sample = df.head(3).to_dict(orient="records")
        # Cast sample values to strings so JSON serialization never trips on numpy types.
        sample = [{k: _safe_scalar(v) for k, v in row.items()} for row in sample]
        try:
            row_count = sum(1 for _ in open(path)) - 1
        except OSError:
            row_count = None
        files.append(
            {
                "path": rel,
                "columns": columns,
                "row_count": row_count,
                "sample": sample,
            }
        )
        fingerprint_parts.append(rel + "|" + ",".join(sorted(columns)))

    other = [
        str(p.relative_to(folder))
        for p in sorted(folder.rglob("*"))
        if p.is_file() and p.suffix.lower() != ".csv"
    ]
    fingerprint = hashlib.sha1(
        "\n".join(fingerprint_parts).encode()
    ).hexdigest()[:16] if fingerprint_parts else None
    return {
        "fingerprint": fingerprint,
        "csv_files": files,
        "other_files": other,
        "hint": _inspection_hint(files),
    }


def _safe_scalar(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (str, int, float, bool)):
        return v
    return str(v)


def _inspection_hint(files: list[dict[str, Any]]) -> str:
    if not files:
        return "no CSV files in upload"
    if len(files) == 1:
        f = files[0]
        cols = f.get("columns") or []
        return f"single CSV '{f['path']}' with columns {cols!r}"
    return (
        f"{len(files)} CSV files with no buses.csv root; "
        f"likely a utility-specific layout — write a custom importer at "
        f"features/import_<slug>.py exposing matches() + convert()."
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


def _smoke_dispatch(net_dir: Path, gpu: bool = False):
    """Run the 1-hour smoke and return ``(info_dict, dispatch_payload | None)``.

    ``info_dict`` is the metadata to merge onto the network artifact.
    ``dispatch_payload`` is everything callers need to emit a run artifact
    (outcome + pypsa network + snapshots + solver name + elapsed) — or None if
    the dispatch failed unexpectedly.
    """
    from smoke_dispatch import run_dispatch

    outcome, pnet, snapshots, used_solver, elapsed = run_dispatch(net_dir, gpu=gpu)
    info: dict[str, Any] = {
        "smoke_dispatch": "ok",
        "smoke_solver": used_solver,
        "smoke_elapsed_s": round(float(elapsed), 3),
    }
    if outcome is not None and getattr(outcome, "prices", None) is not None:
        try:
            info["smoke_prices_shape"] = list(outcome.prices.shape)
        except Exception:
            pass
    return info, (outcome, pnet, snapshots, used_solver, elapsed)


def _emit_run_artifact(
    env: dict[str, str],
    network_artifact: dict[str, Any],
    net_dir: Path,
    dispatch: tuple,
) -> None:
    """Insert a kind='run' artifact tied to ``network_artifact``.

    Best-effort: any failure (missing zap helpers, malformed outcome, network
    error to Supabase) is logged and swallowed so the network ingest still
    completes.
    """
    try:
        from run_artifact import build_run_row

        outcome, pnet, snapshots, used_solver, elapsed = dispatch
        row = build_run_row(
            network_artifact=network_artifact,
            network_name=network_artifact.get("name") or net_dir.name,
            network_slug=network_artifact.get("slug"),
            net_dir=net_dir,
            outcome=outcome,
            pnet=pnet,
            snapshots=snapshots,
            used_solver=used_solver,
            elapsed_s=float(elapsed),
            canonical=False,
        )
        # Preserve the owner's user_id for RLS even though we're using the
        # service-role key — keeps cross-user reads honest.
        if "user_id" not in row and network_artifact.get("user_id"):
            row["user_id"] = network_artifact["user_id"]
        _supabase_request(env, "POST", "artifacts", row)
    except Exception:
        sys.stderr.write("warn: failed to emit run artifact\n")
        traceback.print_exc()


def _resolve_network_dir(folder: Path) -> tuple[Path | None, dict[str, Any]]:
    """Try standard then custom converters. Returns (network_dir, info).

    ``network_dir`` is a PyPSA CSV folder ready for topology extraction.
    ``info`` carries metadata about which converter was used so callers can
    surface it on the artifact.
    """
    pypsa_root = _find_pypsa_root(folder)
    if pypsa_root is not None:
        return pypsa_root, {"converter": "pypsa-csv"}

    mp_file = _find_matpower_file(folder)
    if mp_file is not None:
        dest = folder.parent / "converted"
        _matpower_to_pypsa_folder(mp_file, dest)
        return dest, {"converter": "matpower", "matpower_file": mp_file.name}

    features_dir = _features_dir_from_folder(folder)
    if features_dir is not None:
        custom, custom_info = _try_custom_importers(folder, features_dir)
        if custom is not None:
            return custom, {"converter": "custom-importer", **custom_info}
        if custom_info.get("tried"):
            return None, {"tried_importers": custom_info["tried"]}

    return None, {}


def ingest(artifact_id: str, folder: Path, gpu: bool = False) -> None:
    env = _load_env()
    if "SUPABASE_SERVICE_ROLE_KEY" not in env or "NEXT_PUBLIC_SUPABASE_URL" not in env:
        raise SystemExit("missing Supabase env vars (need SUPABASE_SERVICE_ROLE_KEY)")

    try:
        _set_pipeline_status(env, artifact_id, "extracting")
        _maybe_unzip(folder)

        net_dir, converter_info = _resolve_network_dir(folder)

        if net_dir is None:
            inspection = _inspect_folder(folder)
            if converter_info.get("tried_importers"):
                inspection["tried_importers"] = converter_info["tried_importers"]
            # Persist for the agent to read out-of-band.
            try:
                (folder.parent / "inspection.json").write_text(
                    json.dumps(inspection, indent=2)
                )
            except OSError:
                pass
            _set_awaiting_importer(env, artifact_id, inspection)
            return

        topology = _extract_topology(net_dir)
        _set_view_spec_topology(env, artifact_id, topology)
        _set_pipeline_status(
            env,
            artifact_id,
            "embedded",
            extra_metadata={
                "pypsa_root": str(net_dir.relative_to(folder.parent)),
                **converter_info,
            },
        )

        if net_dir != folder:
            _patch_artifact(env, artifact_id, {"fs_path": str(net_dir)})

        info, dispatch = _smoke_dispatch(net_dir, gpu=gpu)
        _set_pipeline_status(env, artifact_id, "ready", extra_metadata=info)

        if dispatch is not None:
            try:
                network_artifact = _fetch_artifact(env, artifact_id)
            except Exception:
                network_artifact = {"id": artifact_id}
            _emit_run_artifact(env, network_artifact, net_dir, dispatch)
    except Exception as err:
        message = "".join(traceback.format_exception(err))
        _set_failed(env, artifact_id, message)
        sys.stderr.write(message)
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-id", required=True)
    parser.add_argument("--folder", required=True, help="absolute path to the raw upload folder")
    parser.add_argument(
        "--gpu",
        action="store_true",
        help=(
            "forward gpu=True into smoke_dispatch.run_dispatch (Modal GPU solver). "
            "Requires ZAP_SOLVER_MODAL_URL / ZAP_SOLVER_API_KEY in grid-app/.env.local; "
            "no silent CPU fallback."
        ),
    )
    args = parser.parse_args()
    ingest(args.artifact_id, Path(args.folder).resolve(), gpu=args.gpu)


if __name__ == "__main__":
    main()
