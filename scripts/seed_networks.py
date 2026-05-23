#!/usr/bin/env python3
"""Insert canonical artifact rows for the bundled reference networks.

For each folder under ``data/networks/``, this script:

1. Parses ``card.md`` for human-readable metadata + the source URL/license.
2. Loads the PyPSA CSV folder to extract topology stats (bus/line/generator
   counts, carrier mix from generators.csv).
3. Runs ``smoke_dispatch`` to confirm the network still solves before
   promoting it to canonical.
4. Upserts a row in ``public.artifacts`` with ``user_id=null``,
   ``org_id=null``, ``status='canonical'``, ``kind='network'``, and a
   ``view_spec`` pointing the renderer at the future ``network-graph`` view
   with a fallback ``markdown`` panel rendering ``card.md``.

The upsert key is ``(user_id is null, slug)``. Re-running is idempotent.

Auth: uses ``SUPABASE_SERVICE_ROLE_KEY`` from ``.env.local`` so it can write
canonical rows that bypass RLS. Without that key, the script falls back to a
dry-run that prints the rows it would insert.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import _pypsa_compat  # noqa: F401  must precede pypsa/zap

import pypsa  # noqa: E402

from smoke_dispatch import run_dispatch, smoke_dispatch  # noqa: E402
from run_artifact import build_run_row  # noqa: E402

NETWORKS_DIR = ROOT / "data" / "networks"
ENV_FILE = ROOT / ".env.local"


def _load_env():
    """Lightweight .env.local parser (no python-dotenv dep)."""
    if not ENV_FILE.exists():
        return {}
    env = {}
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def _parse_card(card_path: Path) -> dict:
    """Pull a few structured fields out of card.md (title, source URL, license)."""
    if not card_path.exists():
        return {}
    text = card_path.read_text()
    out: dict = {}
    title_match = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    if title_match:
        out["title"] = title_match.group(1).strip()
    url_match = re.search(r"URL:\s*(\S+)", text)
    if url_match:
        out["source_url"] = url_match.group(1).strip()
    license_match = re.search(r"License:\s*(.+)$", text, re.MULTILINE)
    if license_match:
        out["license"] = license_match.group(1).strip()
    return out


def _carrier_mix_from_csv(net_dir: Path) -> dict[str, float]:
    gens = pd.read_csv(net_dir / "generators.csv")
    if "carrier" not in gens or "p_nom" not in gens:
        return {}
    grouped = gens.groupby("carrier")["p_nom"].sum()
    total = float(grouped.sum())
    if total <= 0:
        return {}
    return {str(k): round(float(v) / total, 4) for k, v in grouped.items()}


def _stats(net_dir: Path) -> dict:
    pnet = pypsa.Network()
    pnet.import_from_csv_folder(str(net_dir))
    return {
        "buses": int(len(pnet.buses)),
        "lines": int(len(pnet.lines)),
        "generators": int(len(pnet.generators)),
        "loads": int(len(pnet.loads)),
        "snapshots": int(len(pnet.snapshots)),
    }


def _build_row(slug: str, net_dir: Path) -> dict:
    card = _parse_card(net_dir / "card.md")
    stats = _stats(net_dir)
    metadata = {
        "source_url": card.get("source_url"),
        "license": card.get("license"),
        "bundled": True,
        "carrier_mix": _carrier_mix_from_csv(net_dir),
        **stats,
    }
    return {
        "user_id": None,
        "org_id": None,
        "kind": "network",
        "name": card.get("title", slug),
        "slug": slug,
        "fs_path": str(net_dir.relative_to(ROOT)),
        "storage_path": None,
        "metadata": metadata,
        "view_spec": {
            # Network-graph renderer is roadmap item #6; until it lands, the
            # universal renderer dispatches by view_spec.renderer and falls
            # back to a markdown panel for card.md.
            "renderer": "network-graph",
            "fallback_renderer": "markdown",
            "fallback_source": f"{net_dir.relative_to(ROOT)}/card.md",
        },
        "status": "canonical",
    }


def _supabase_request(env: dict, method: str, path: str, body=None):
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
        return resp.status, resp.read().decode()


def _upsert(env: dict, row: dict, dry_run: bool) -> str | None:
    url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if dry_run or not url or not key:
        print(
            f"[dry-run] would upsert canonical artifact: "
            f"slug={row['slug']} kind={row['kind']} buses={row['metadata']['buses']}"
        )
        return None
    # Two-step upsert: check by (slug, user_id is null) since the table doesn't
    # have a unique constraint on slug. Canonical seeding is a low-frequency
    # admin operation so the extra round trip is fine.
    slug = row["slug"]
    try:
        status, body = _supabase_request(
            env, "GET", f"artifacts?slug=eq.{slug}&user_id=is.null&select=id"
        )
        existing = json.loads(body) if body else []
        if existing:
            existing_id = existing[0]["id"]
            _supabase_request(
                env, "PATCH", f"artifacts?id=eq.{existing_id}", row
            )
            print(f"  updated {slug}: id={existing_id}")
            return existing_id
        else:
            _, body = _supabase_request(env, "POST", "artifacts", row)
            payload = json.loads(body) if body else []
            new_id = payload[0]["id"] if payload else None
            print(f"  inserted {slug}: id={new_id or '?'}")
            return new_id
    except urllib.error.HTTPError as err:
        print(
            f"  ERROR upserting {slug}: HTTP {err.code} — "
            f"{err.read().decode()[:200]}"
        )
        return None


def _upsert_run(env: dict, row: dict, dry_run: bool) -> str | None:
    """Insert (or refresh) a canonical run artifact tied to a network.

    Identity for canonical runs is `(parent_id, hours, solver)` — re-running the
    seed script shouldn't accumulate duplicate run rows for the same network.
    """
    url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if dry_run or not url or not key:
        print(
            f"  [dry-run] would upsert canonical run: "
            f"slug={row['slug']} hours={row['metadata']['hours']} "
            f"solver={row['metadata']['solver']}"
        )
        return None
    parent_id = row.get("parent_id")
    try:
        if parent_id:
            _, body = _supabase_request(
                env,
                "GET",
                f"artifacts?kind=eq.run&user_id=is.null&parent_id=eq.{parent_id}&select=id",
            )
            existing = json.loads(body) if body else []
            if existing:
                existing_id = existing[0]["id"]
                _supabase_request(
                    env, "PATCH", f"artifacts?id=eq.{existing_id}", row
                )
                print(f"  updated run: id={existing_id}")
                return existing_id
        _, body = _supabase_request(env, "POST", "artifacts", row)
        payload = json.loads(body) if body else []
        new_id = payload[0]["id"] if payload else None
        print(f"  inserted run: id={new_id or '?'}")
        return new_id
    except urllib.error.HTTPError as err:
        print(
            f"  ERROR upserting run for parent {parent_id}: HTTP {err.code} — "
            f"{err.read().decode()[:200]}"
        )
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="don't hit Supabase; just print the rows that would be upserted",
    )
    parser.add_argument(
        "--skip-smoke",
        action="store_true",
        help="skip the 1-hour smoke dispatch (use only when zap is unavailable)",
    )
    args = parser.parse_args()

    env = {**_load_env(), **os.environ}

    if not NETWORKS_DIR.exists():
        print(f"no networks directory at {NETWORKS_DIR}", file=sys.stderr)
        sys.exit(1)

    folders = sorted(p for p in NETWORKS_DIR.iterdir() if p.is_dir())
    if not folders:
        print(f"no networks under {NETWORKS_DIR}", file=sys.stderr)
        sys.exit(1)

    print(f"seeding {len(folders)} canonical network artifact(s)")
    for net_dir in folders:
        slug = net_dir.name
        print(f"- {slug}")
        run_info = None
        if not args.skip_smoke:
            try:
                outcome, pnet, snapshots, used_solver, elapsed = run_dispatch(net_dir)
                run_info = (outcome, pnet, snapshots, used_solver, elapsed)
                print(
                    f"  smoke ok: solver={used_solver} "
                    f"prices_shape={getattr(outcome.prices, 'shape', None)} "
                    f"elapsed={elapsed:.2f}s"
                )
            except Exception as err:
                print(f"  SKIP {slug}: smoke dispatch failed — {err}")
                continue
        row = _build_row(slug, net_dir)
        network_id = _upsert(env, row, args.dry_run)

        if run_info is not None:
            outcome, pnet, snapshots, used_solver, elapsed = run_info
            network_artifact = {"id": network_id, "user_id": None} if network_id else None
            run_row = build_run_row(
                network_artifact=network_artifact,
                network_name=row["name"],
                network_slug=slug,
                net_dir=net_dir,
                outcome=outcome,
                pnet=pnet,
                snapshots=snapshots,
                used_solver=used_solver,
                elapsed_s=elapsed,
                canonical=True,
            )
            _upsert_run(env, run_row, args.dry_run)


if __name__ == "__main__":
    main()
