#!/usr/bin/env python3
"""One-time backfill: a default "My workspace" per user (WORKSPACE_REDESIGN.md §4.3).

Context: the workspaces redesign (REDESIGN_ROADMAP §1-2) adds a ``workspaces``
table and a nullable ``artifacts.workspace_id`` grouping key. Existing rows
predate workspaces, so every user's personal artifacts currently have
``workspace_id NULL``. This script materializes one default workspace per user
who owns any artifacts or features, then stamps that workspace's id onto their
personal artifacts.

What it does, per user that owns artifacts and/or features:
  1. Ensure a personal workspace named "My workspace" exists (reuse if present).
  2. Set ``workspace_id`` on that user's artifacts that still have it NULL.

What it deliberately does NOT touch:
  - Canonical / template networks (``user_id IS NULL``): they stay shared with
    ``workspace_id NULL`` (per §4.2 they are usable as any workspace's data
    source — not grouped under a single workspace). These rows never enter the
    per-user loop because they have no owner.
  - The legacy ``public.features`` table: migration 0001 added ``workspace_id``
    to ``artifacts`` only, not to ``features``. Setting it there would require
    unreviewed DDL, which the build guardrails forbid. Features are surfaced as
    ``kind='feature'``/``kind='objective'`` artifacts (WORKSPACE_REDESIGN.md §3),
    which DO get a ``workspace_id`` here. Users who own features but no artifacts
    still get a default workspace created so it's ready for them.

Idempotency:
  - The workspace is keyed by ``(user_id, name='My workspace')`` — re-running
    finds the existing row instead of creating a duplicate.
  - Artifact assignment only targets rows with ``workspace_id IS NULL``; rows
    already assigned are skipped. So a second ``--dry-run`` after an apply
    reports zero planned changes.

Safety: read-only by default. ``--dry-run`` (the default) prints the plan and
writes NOTHING. Real writes require an explicit ``--apply`` flag a human runs.
This script never issues DDL and never touches the live schema — it only
inserts ``workspaces`` rows and PATCHes ``artifacts.workspace_id`` via the
PostgREST data API with the service-role key (bypassing RLS, as backfills must).

Auth: reads ``NEXT_PUBLIC_SUPABASE_URL`` + ``SUPABASE_SERVICE_ROLE_KEY`` from
``grid-app/.env.local`` (same lightweight loader as scripts/seed_networks.py).
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.local"

DEFAULT_WORKSPACE_NAME = "My workspace"


def _load_env() -> dict:
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


def _supabase_request(env: dict, method: str, path: str, body=None):
    """Single PostgREST round trip with the service-role key."""
    url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
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
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode()
        return resp.status, json.loads(text) if text else []


def _paged_get(env: dict, table: str, query: str, page_size: int = 1000) -> list:
    """GET every matching row, following Range pagination so large tables don't
    silently truncate at PostgREST's default 1000-row cap."""
    rows: list = []
    offset = 0
    while True:
        url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
        key = env["SUPABASE_SERVICE_ROLE_KEY"]
        req = urllib.request.Request(
            f"{url}/rest/v1/{table}?{query}",
            method="GET",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Range-Unit": "items",
                "Range": f"{offset}-{offset + page_size - 1}",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode()
            batch = json.loads(text) if text else []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def _collect_owner_ids(env: dict) -> "OrderedDict[str, dict]":
    """Distinct user ids that own artifacts and/or features.

    Returns an insertion-ordered map ``user_id -> {"artifacts": n, "features": n}``
    so the plan output is deterministic.
    """
    owners: "OrderedDict[str, dict]" = OrderedDict()

    artifact_rows = _paged_get(
        env, "artifacts", "select=user_id&user_id=not.is.null"
    )
    for row in artifact_rows:
        uid = row.get("user_id")
        if not uid:
            continue
        owners.setdefault(uid, {"artifacts": 0, "features": 0})["artifacts"] += 1

    feature_rows = _paged_get(env, "features", "select=user_id")
    for row in feature_rows:
        uid = row.get("user_id")
        if not uid:
            continue
        owners.setdefault(uid, {"artifacts": 0, "features": 0})["features"] += 1

    return owners


def _existing_default_workspace(env: dict, user_id: str) -> str | None:
    """Return the id of this user's existing default workspace, if any.

    Keyed by ``(user_id, name='My workspace')`` so re-runs are idempotent. URL-
    encodes the name so the space survives the query string.
    """
    name_filter = urllib.parse.quote(f"eq.{DEFAULT_WORKSPACE_NAME}", safe="")
    _, rows = _supabase_request(
        env,
        "GET",
        f"workspaces?user_id=eq.{user_id}&name={name_filter}&select=id&limit=1",
    )
    if rows:
        return rows[0]["id"]
    return None


def _unassigned_artifact_count(env: dict, user_id: str) -> int:
    """How many of this user's artifacts still have workspace_id NULL."""
    rows = _paged_get(
        env,
        "artifacts",
        f"select=id&user_id=eq.{user_id}&workspace_id=is.null",
    )
    return len(rows)


def build_plan(env: dict) -> list[dict]:
    """Compute the per-user plan WITHOUT writing anything.

    Each entry: {user_id, owns, existing_workspace_id, unassigned_artifacts}.
    ``existing_workspace_id`` is set when the user already has a default
    workspace (so apply reuses it rather than creating a duplicate).
    """
    owners = _collect_owner_ids(env)
    plan: list[dict] = []
    for user_id, counts in owners.items():
        existing = _existing_default_workspace(env, user_id)
        unassigned = _unassigned_artifact_count(env, user_id)
        plan.append(
            {
                "user_id": user_id,
                "owns": counts,
                "existing_workspace_id": existing,
                "unassigned_artifacts": unassigned,
            }
        )
    return plan


def print_plan(plan: list[dict]) -> None:
    if not plan:
        print("[plan] no users own artifacts or features — nothing to backfill.")
        return
    creates = sum(1 for p in plan if not p["existing_workspace_id"])
    reuses = sum(1 for p in plan if p["existing_workspace_id"])
    total_assign = sum(p["unassigned_artifacts"] for p in plan)
    print(
        f"[plan] {len(plan)} user(s) own artifacts/features: "
        f"{creates} workspace(s) to create, {reuses} existing to reuse; "
        f"{total_assign} artifact(s) to stamp with workspace_id."
    )
    for p in plan:
        owns = p["owns"]
        if p["existing_workspace_id"]:
            ws = f"reuse workspace {p['existing_workspace_id']}"
        else:
            ws = f"create '{DEFAULT_WORKSPACE_NAME}'"
        print(
            f"  - user {p['user_id']}: "
            f"artifacts={owns['artifacts']} features={owns['features']} → "
            f"{ws}; assign {p['unassigned_artifacts']} unassigned artifact(s)"
        )


def apply_plan(env: dict, plan: list[dict]) -> None:
    for p in plan:
        user_id = p["user_id"]
        workspace_id = p["existing_workspace_id"]
        if not workspace_id:
            try:
                _, rows = _supabase_request(
                    env,
                    "POST",
                    "workspaces",
                    {"user_id": user_id, "name": DEFAULT_WORKSPACE_NAME, "focus": []},
                )
                workspace_id = rows[0]["id"] if rows else None
                print(f"  created workspace {workspace_id} for user {user_id}")
            except urllib.error.HTTPError as err:
                detail = err.read().decode()[:200]
                print(
                    f"  ERROR creating workspace for {user_id}: "
                    f"HTTP {err.code} — {detail}",
                    file=sys.stderr,
                )
                continue
        else:
            print(f"  reusing workspace {workspace_id} for user {user_id}")

        if not workspace_id:
            print(f"  SKIP assignment for {user_id}: no workspace id", file=sys.stderr)
            continue

        # Stamp only the still-unassigned artifacts. The filter is part of the
        # PATCH so this is idempotent even if interrupted and re-run.
        try:
            _, updated = _supabase_request(
                env,
                "PATCH",
                f"artifacts?user_id=eq.{user_id}&workspace_id=is.null",
                {"workspace_id": workspace_id},
            )
            print(
                f"  assigned {len(updated)} artifact(s) to workspace "
                f"{workspace_id} for user {user_id}"
            )
        except urllib.error.HTTPError as err:
            detail = err.read().decode()[:200]
            print(
                f"  ERROR assigning artifacts for {user_id}: "
                f"HTTP {err.code} — {detail}",
                file=sys.stderr,
            )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--dry-run",
        action="store_true",
        help="(default) compute and print the plan; write NOTHING",
    )
    group.add_argument(
        "--apply",
        action="store_true",
        help="actually create workspaces and stamp workspace_id (a human runs this)",
    )
    args = parser.parse_args()

    env = _load_env()
    url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print(
            "Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in "
            f"{ENV_FILE}. Cannot reach Supabase; aborting.",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        plan = build_plan(env)
    except urllib.error.HTTPError as err:
        detail = err.read().decode()[:300]
        print(f"Failed to read current state: HTTP {err.code} — {detail}", file=sys.stderr)
        print(
            "If this is a 404, the workspaces table / artifacts.workspace_id "
            "column may not be applied yet — paste supabase/migrations/"
            "0001_workspaces.sql into the SQL editor first.",
            file=sys.stderr,
        )
        sys.exit(1)
    except urllib.error.URLError as err:
        print(f"Network error reaching Supabase: {err}", file=sys.stderr)
        sys.exit(1)

    print_plan(plan)

    if args.apply:
        print("[apply] writing changes…")
        apply_plan(env, plan)
        print("[apply] done.")
    else:
        print("[dry-run] no changes written. Re-run with --apply to execute.")


if __name__ == "__main__":
    main()
