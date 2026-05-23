"""Download a URL into ``<workspace>/sources/<slug>/raw/`` and record metadata.

This is the orchestrator behind ROADMAP §6.5 / LOOP_QUEUE item 8:

* ``/api/fetch`` (TypeScript) shells out to this script via ``--cli``.
* The per-user MCP server (``scripts/user-mcp-server.py``) imports the
  :func:`fetch_to_workspace` function directly for the
  ``steinmetz__fetch_network`` tool.

What it does:

1. Computes a slug (from CLI / arg, or derived from the URL path).
2. Downloads the URL into ``<workspace>/sources/<slug>/raw/`` via plain HTTP.
   Streams to disk, follows redirects (urllib does this by default).
3. Computes the SHA-256 of the downloaded payload. If the caller supplied an
   ``expected_checksum`` and it doesn't match, raises ``ChecksumMismatch``
   *before* creating any artifact row.
4. Creates an ``artifacts`` row via the Supabase REST API (service-role key
   loaded from ``.env.local``). Fills metadata.source_url, metadata.license,
   metadata.fetched_at, metadata.checksum (SHA-256, hex). If the license is
   missing or "unknown", sets ``metadata.license_unknown=true`` and forces
   ``status='draft'`` — the agent must prompt the user before promotion to
   canonical (per ROADMAP §6.5 "License capture is non-negotiable").
5. Spawns the standard ingestion script (``ingest_pypsa_folder.py``) detached
   so the upload pipeline (queued → extracting → embedded → ready) re-runs
   against the freshly-downloaded folder. Validation re-uses the upload
   pipeline by design.

The script returns a JSON payload (artifact id, checksum, fetched files, etc.)
so callers can wait on the synchronous part and surface progress.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.local"
INGEST_SCRIPT = ROOT / "scripts" / "ingest_pypsa_folder.py"
PY_BIN = os.environ.get("STEINMETZ_PY") or "/home/agent/zap/.venv/bin/python"


class FetchError(RuntimeError):
    pass


class ChecksumMismatch(FetchError):
    pass


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


def slugify(raw: str) -> str:
    s = raw.lower()
    s = re.sub(r"[^a-z0-9-]+", "-", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s[:64]


def _slug_from_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    base = Path(parsed.path).name or parsed.netloc
    base = base.removesuffix(".zip").removesuffix(".tar.gz").removesuffix(".csv")
    return slugify(base) or f"fetch-{int(datetime.now().timestamp())}"


def _filename_from_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    name = Path(parsed.path).name or "download.bin"
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", name)


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
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode()
        return json.loads(text) if text else None


def _download(url: str, dest: Path) -> tuple[Path, str, int]:
    """Stream ``url`` to ``dest``. Returns (path, sha256, bytes)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    sha = hashlib.sha256()
    total = 0
    # Identify as a generic client; some hosts (GitHub raw) reject the default urllib UA.
    req = urllib.request.Request(url, headers={"User-Agent": "steinmetz-fetch/0.1"})
    with urllib.request.urlopen(req, timeout=60) as resp, dest.open("wb") as out:
        while True:
            chunk = resp.read(64 * 1024)
            if not chunk:
                break
            sha.update(chunk)
            out.write(chunk)
            total += len(chunk)
    return dest, sha.hexdigest(), total


def _user_id_from_workspace(workspace: Path) -> str:
    # Workspaces live at `${GRID_WORKSPACE_ROOT}/<userId>`. Pull the basename;
    # the API route validates it's a real auth.uid via createClient().
    name = workspace.name
    if not name or "/" in name:
        raise FetchError(f"workspace path has no user id: {workspace}")
    return name


def fetch_to_workspace(
    *,
    workspace: Path,
    url: str,
    name: str | None = None,
    slug: str | None = None,
    license: str | None = None,
    expected_checksum: str | None = None,
    session_id: str | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Download ``url`` into the workspace and create a ``network`` artifact.

    Validation runs detached via the standard ingestion pipeline. The synchronous
    portion ends once the artifact row exists and the ingestion process is
    spawned.
    """
    env = _load_env()
    if "SUPABASE_SERVICE_ROLE_KEY" not in env or "NEXT_PUBLIC_SUPABASE_URL" not in env:
        raise FetchError("missing Supabase env vars (need SUPABASE_SERVICE_ROLE_KEY)")

    if user_id is None:
        user_id = _user_id_from_workspace(workspace)

    derived_slug = slug.strip() if slug else _slug_from_url(url)
    derived_slug = slugify(derived_slug) or f"fetch-{int(datetime.now().timestamp())}"
    display_name = (name or "").strip() or f"Fetched: {derived_slug}"

    raw_dir = workspace / "sources" / derived_slug / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    filename = _filename_from_url(url) or "download.bin"
    dest = raw_dir / filename
    _, checksum, byte_count = _download(url, dest)

    if expected_checksum:
        expected_normalized = expected_checksum.strip().lower()
        # Allow either "sha256:..." prefix or bare hex.
        if expected_normalized.startswith("sha256:"):
            expected_normalized = expected_normalized.removeprefix("sha256:")
        if expected_normalized != checksum:
            # Don't leave a half-downloaded artifact: clean up and bail.
            try:
                dest.unlink()
            except OSError:
                pass
            raise ChecksumMismatch(
                f"checksum mismatch for {url}: expected {expected_normalized}, got {checksum}"
            )

    license_clean = (license or "").strip()
    license_unknown = license_clean == "" or license_clean.lower() in {
        "unknown",
        "tbd",
        "n/a",
    }

    metadata: dict[str, Any] = {
        "pipeline_status": "queued",
        "source_url": url,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "checksum": f"sha256:{checksum}",
        "license": license_clean or None,
        "license_unknown": license_unknown,
        "fetched_files": [filename],
        "fetched_bytes": byte_count,
        "acquisition": "web-fetch",
    }

    artifact_row = {
        "user_id": user_id,
        "kind": "network",
        "name": display_name,
        "slug": derived_slug,
        "fs_path": str(raw_dir),
        "metadata": metadata,
        "view_spec": {
            "renderer": "network-graph",
            "fallback_renderer": "markdown",
        },
        "parent_session_id": session_id,
        # License-unknown can't be canonical until the user confirms (§6.5).
        "status": "draft",
    }
    rows = _supabase_request(env, "POST", "artifacts", artifact_row)
    if not rows:
        raise FetchError("supabase insert returned no row")
    artifact = rows[0]

    # Spawn the standard ingestion pipeline detached. It will unzip if the
    # download is a .zip, run the converter chain (PyPSA → MATPOWER → custom),
    # write the network-graph view_spec, and run a 1-hour smoke dispatch.
    subprocess.Popen(
        [PY_BIN, str(INGEST_SCRIPT), "--artifact-id", artifact["id"], "--folder", str(raw_dir)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        cwd=str(ROOT),
        start_new_session=True,
        env={**os.environ},
    )

    return {
        "artifact_id": artifact["id"],
        "slug": derived_slug,
        "name": display_name,
        "raw_dir": str(raw_dir),
        "checksum": metadata["checksum"],
        "bytes": byte_count,
        "license_unknown": license_unknown,
        "pending_user_confirmation": license_unknown,
        "next": "Pipeline is running in the background; status flips queued→extracting→embedded→ready.",
    }


def _cli() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--name", default=None)
    parser.add_argument("--slug", default=None)
    parser.add_argument("--license", default=None)
    parser.add_argument("--checksum", dest="expected_checksum", default=None)
    parser.add_argument("--session-id", default=None)
    parser.add_argument("--user-id", default=None)
    args = parser.parse_args()
    try:
        result = fetch_to_workspace(
            workspace=Path(args.workspace).resolve(),
            url=args.url,
            name=args.name,
            slug=args.slug,
            license=args.license,
            expected_checksum=args.expected_checksum,
            session_id=args.session_id,
            user_id=args.user_id,
        )
    except ChecksumMismatch as exc:
        sys.stdout.write(json.dumps({"error": "checksum_mismatch", "detail": str(exc)}) + "\n")
        return 2
    except FetchError as exc:
        sys.stdout.write(json.dumps({"error": "fetch_failed", "detail": str(exc)}) + "\n")
        return 1
    sys.stdout.write(json.dumps(result) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
