#!/usr/bin/env python3
"""Per-user MCP server for Steinmetz.

Introspects ``$STEINMETZ_FEATURES_DIR`` (default ``./features``) and exposes
each public function as a typed MCP tool. Communicates over stdio using
JSON-RPC 2.0 — newline-delimited frames, no Content-Length header.

This deliberately avoids the official ``mcp`` Python SDK so we don't add a
Python install step to user workspaces. It implements the slice opencode's
client exercises: ``initialize``, ``tools/list``, ``tools/call`` (+ ``ping``).

The features directory is re-walked on every ``tools/list`` so newly written
features show up in the agent's tool palette without restarting the server.
"""
from __future__ import annotations

import hashlib
import importlib.util
import inspect
import json
import os
import sys
import time
import traceback
import typing
import urllib.error
import urllib.request
from pathlib import Path

PROTOCOL_VERSION = "2025-06-18"
SERVER_INFO = {"name": "steinmetz-features", "version": "0.1.0"}

# HARDENING §2.2 — `may_I_proceed()` admission. The MCP server posts to
# grid-app before invoking a feature, and again when it finishes. If the env
# is unconfigured (dev / smoke), the wrapper is a no-op and tool calls run
# unmetered — that's the legacy behavior, preserved on purpose so launching
# the MCP server outside of opencode (e.g. in tests) still works.
PROCEED_URL_PATH = "/api/internal/proceed"
RELEASE_URL_PATH = "/api/internal/release"
DEFAULT_GRID_APP_URL = "http://127.0.0.1:3000"


ROOT = Path(__file__).resolve().parent.parent
GRID_APP_ENV_FILE = ROOT / ".env.local"


def _load_grid_app_env() -> dict[str, str]:
    """Read ``<grid-app>/.env.local`` so the MCP server can reach Supabase /
    Modal without those keys being injected into every opencode session env.
    Lightweight parser — mirrors ``scripts/seed_networks._load_env``."""
    env: dict[str, str] = {}
    if GRID_APP_ENV_FILE.exists():
        for line in GRID_APP_ENV_FILE.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    env.update(os.environ)
    return env


def features_dir() -> Path:
    return Path(os.environ.get("STEINMETZ_FEATURES_DIR") or "features").resolve()


def workspace_dir() -> Path:
    """Workspace root. Default: the parent of ``features_dir()``."""
    explicit = os.environ.get("STEINMETZ_WORKSPACE_DIR")
    if explicit:
        return Path(explicit).resolve()
    return features_dir().parent


def sources_dir() -> Path:
    return workspace_dir() / "sources"


def skills_dir() -> Path:
    return workspace_dir() / ".opencode" / "skills"


def log(msg: str) -> None:
    sys.stderr.write(f"[user-mcp] {msg}\n")
    sys.stderr.flush()


def _type_to_schema(tp) -> dict:
    if tp is inspect.Parameter.empty:
        return {"type": "string"}
    if tp is str:
        return {"type": "string"}
    if tp is int:
        return {"type": "integer"}
    if tp is float:
        return {"type": "number"}
    if tp is bool:
        return {"type": "boolean"}
    origin = typing.get_origin(tp)
    if tp is list or origin is list:
        return {"type": "array"}
    if tp is dict or origin is dict:
        return {"type": "object"}
    if origin is typing.Union:
        args = [a for a in typing.get_args(tp) if a is not type(None)]
        if len(args) == 1:
            return _type_to_schema(args[0])
    return {"type": "string"}


def _load_module(slug: str, path: Path):
    spec = importlib.util.spec_from_file_location(f"steinmetz_feature_{slug}", path)
    if not spec or not spec.loader:
        raise ImportError(f"cannot build spec for {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _builtin_tools() -> list[dict]:
    """Built-in tools that don't come from feature files.

    These ship with every workspace so the agent can drive the
    heterogeneous-upload loop (ROADMAP §1, LOOP_QUEUE.md item 7) and the
    agentic data-acquisition loop (ROADMAP §6.5, LOOP_QUEUE item 8):

    * ``list_pending_imports`` — slugs in ``sources/`` whose ingestion left an
      ``inspection.json`` because no standard or custom converter matched.
    * ``inspect_upload`` — full inspection for one slug (CSV columns +
      samples + raw file list). Lets the agent decide what to write.
    * ``write_custom_importer`` — writes a ``features/import_<slug>.py`` and a
      ``.opencode/skills/<slug>/SKILL.md`` from agent-supplied source.
      Convenience wrapper around two file writes.
    * ``fetch_network`` — download a URL into the workspace, create a
      ``network`` artifact with source/license/fetched_at/checksum metadata,
      and kick off the standard upload pipeline.
    """
    return [
        {
            "name": "steinmetz__list_pending_imports",
            "description": (
                "List uploads in this workspace that need a custom importer. "
                "Returns one entry per source slug whose ingestion produced an "
                "inspection.json (i.e. no standard / existing custom importer "
                "matched). Use this to discover work; then call "
                "steinmetz__inspect_upload(slug) for details."
            ),
            "inputSchema": {"type": "object", "properties": {}},
            "_builtin": "list_pending_imports",
        },
        {
            "name": "steinmetz__inspect_upload",
            "description": (
                "Return the schema fingerprint, CSV column lists, and a few "
                "sample rows from an uploaded source folder. Use this before "
                "writing a custom importer so you can see what the columns "
                "actually mean."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "slug": {
                        "type": "string",
                        "description": "Source slug (directory name under sources/).",
                    }
                },
                "required": ["slug"],
            },
            "_builtin": "inspect_upload",
        },
        {
            "name": "steinmetz__write_custom_importer",
            "description": (
                "Write features/import_<slug>.py and "
                ".opencode/skills/<slug>/SKILL.md from agent-supplied source. "
                "The Python module must expose matches(folder: Path) -> bool "
                "and convert(folder: Path, dest: Path) -> None; convert() must "
                "write a PyPSA-compatible CSV folder (with buses.csv) to dest. "
                "After writing, ask the user to re-upload or hit "
                "/api/upload/reingest/<artifact_id> to re-run the pipeline."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "slug": {
                        "type": "string",
                        "description": "Importer slug. The file name becomes import_<slug>.py.",
                    },
                    "python_source": {
                        "type": "string",
                        "description": "Full body of features/import_<slug>.py.",
                    },
                    "skill_markdown": {
                        "type": "string",
                        "description": "Full body of .opencode/skills/<slug>/SKILL.md.",
                    },
                },
                "required": ["slug", "python_source", "skill_markdown"],
            },
            "_builtin": "write_custom_importer",
        },
        {
            "name": "steinmetz__list_networks",
            "description": (
                "List the power-system network artifacts visible to this user: "
                "the canonical reference networks that ship with Steinmetz plus "
                "any the user has uploaded or fetched. Returns one entry per "
                "network with its `id` (the uuid `solve_opf` needs as "
                "`network_artifact_id`), `name`, `slug`, `status`, and "
                "bus/line/generator counts when known. Call this FIRST to "
                "resolve a network the user names in plain language (e.g. 'the "
                "IEEE 30-bus', 'the German grid') into the artifact id before "
                "calling solve_opf. If the user's message carries an 'active "
                "network' context line with a network_artifact_id, use that id "
                "directly instead."
            ),
            "inputSchema": {"type": "object", "properties": {}},
            "_builtin": "list_networks",
        },
        {
            "name": "steinmetz__solve_opf",
            "description": (
                "Run an OPF dispatch on a network artifact and write a "
                "`run` artifact tied to it. Pass `network_artifact_id` (uuid "
                "of a `kind='network'` artifact visible to this user), "
                "`hours` (number of snapshots to solve; 1 by default), and "
                "`gpu` (false → CPU/cvxpy via the local zap install; true → "
                "Modal-hosted ADMM on GPU). Returns the new run artifact's "
                "id; view_spec carries LMPs (and best-effort carrier + line "
                "flows). Metadata records `solver` / `machine` / `elapsed_s` "
                "so downstream pages can show solver provenance."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "network_artifact_id": {
                        "type": "string",
                        "description": "UUID of the `kind='network'` artifact to solve.",
                    },
                    "hours": {
                        "type": "integer",
                        "description": "Number of snapshots to dispatch (default 1).",
                    },
                    "gpu": {
                        "type": "boolean",
                        "description": (
                            "Run on the Modal-hosted GPU container instead "
                            "of the local CPU solver. Requires "
                            "ZAP_SOLVER_MODAL_URL + ZAP_SOLVER_API_KEY in "
                            "grid-app/.env.local."
                        ),
                    },
                },
                "required": ["network_artifact_id"],
            },
            "_builtin": "solve_opf",
        },
        {
            "name": "steinmetz__fetch_network",
            "description": (
                "Download a named network or dataset from a URL into the "
                "user's workspace, create a `network` artifact, and run the "
                "standard upload pipeline against it (queued → extracting → "
                "embedded → ready). Use this after WebSearch / WebFetch has "
                "identified a concrete URL (a PyPSA CSV folder zip, a "
                "MATPOWER .m, a Zenodo release, etc.).\n\n"
                "Required: `url`. Recommended: `name` (display label), "
                "`license` (SPDX-style — leave empty if you couldn't "
                "determine it; the artifact will be flagged "
                "`license_unknown=true` and stay `status='draft'` so the "
                "user must confirm before canonical promotion). Optional: "
                "`slug` (defaults to a slug derived from the URL), "
                "`expected_checksum` (SHA-256 hex with or without `sha256:` "
                "prefix; the call fails if the download doesn't match), and "
                "`session_id` to link the artifact to the current chat. "
                "Returns the new artifact id."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "HTTP(S) URL of the dataset to fetch.",
                    },
                    "name": {
                        "type": "string",
                        "description": "Display name for the artifact.",
                    },
                    "slug": {
                        "type": "string",
                        "description": "Optional slug; derived from the URL if omitted.",
                    },
                    "license": {
                        "type": "string",
                        "description": (
                            "License string (e.g. 'MIT', 'CC-BY-4.0'). Leave "
                            "empty if the source doesn't declare one — the "
                            "artifact will be marked license_unknown=true."
                        ),
                    },
                    "expected_checksum": {
                        "type": "string",
                        "description": "SHA-256 hex (with or without sha256: prefix).",
                    },
                    "session_id": {
                        "type": "string",
                        "description": "Opencode session id to link to.",
                    },
                },
                "required": ["url"],
            },
            "_builtin": "fetch_network",
        },
    ]


def _builtin_list_pending_imports() -> str:
    root = sources_dir()
    if not root.exists():
        return json.dumps({"pending": []}, indent=2)
    pending: list[dict] = []
    for child in sorted(root.iterdir()):
        if not child.is_dir():
            continue
        inspection_path = child / "inspection.json"
        if not inspection_path.exists():
            continue
        try:
            inspection = json.loads(inspection_path.read_text())
        except Exception as exc:
            inspection = {"error": str(exc)}
        files = inspection.get("csv_files") or []
        pending.append(
            {
                "slug": child.name,
                "fingerprint": inspection.get("fingerprint"),
                "csv_file_count": len(files),
                "csv_paths": [f.get("path") for f in files],
                "hint": inspection.get("hint"),
            }
        )
    return json.dumps({"pending": pending}, indent=2)


def _builtin_inspect_upload(slug: str) -> str:
    if not slug or "/" in slug or slug.startswith("."):
        raise ValueError("invalid slug")
    src = sources_dir() / slug
    if not src.exists():
        raise FileNotFoundError(f"no source folder for slug {slug!r}")
    inspection_path = src / "inspection.json"
    if inspection_path.exists():
        return inspection_path.read_text()
    # Fall back to a fresh introspection of raw/ if no inspection was written.
    raw = src / "raw"
    if not raw.exists():
        raise FileNotFoundError(f"no raw/ subfolder for slug {slug!r}")
    return json.dumps(_quick_inspect(raw), indent=2)


def _quick_inspect(folder: Path) -> dict:
    """Cheap fallback inspection — column lists, no samples."""
    out: dict = {"csv_files": [], "other_files": []}
    for path in sorted(folder.rglob("*")):
        if not path.is_file():
            continue
        rel = str(path.relative_to(folder))
        if path.suffix.lower() == ".csv":
            try:
                with open(path) as fh:
                    header = fh.readline().strip()
                cols = [c.strip() for c in header.split(",")] if header else []
            except OSError as exc:
                out["csv_files"].append({"path": rel, "error": str(exc)})
                continue
            out["csv_files"].append({"path": rel, "columns": cols})
        else:
            out["other_files"].append(rel)
    return out


def _builtin_write_custom_importer(
    slug: str, python_source: str, skill_markdown: str
) -> str:
    if not slug or "/" in slug or slug.startswith(".") or " " in slug:
        raise ValueError("invalid slug (no spaces, slashes, or leading dots)")
    fdir = features_dir()
    sdir = skills_dir() / slug
    fdir.mkdir(parents=True, exist_ok=True)
    sdir.mkdir(parents=True, exist_ok=True)
    importer_path = fdir / f"import_{slug}.py"
    skill_path = sdir / "SKILL.md"
    importer_path.write_text(python_source)
    skill_path.write_text(skill_markdown)
    return json.dumps(
        {
            "wrote": [str(importer_path), str(skill_path)],
            "slug": slug,
            "next_step": (
                "Trigger a re-ingest with POST /api/upload/reingest/<artifact_id> "
                "for the awaiting_importer artifact, or ask the user to re-upload."
            ),
        },
        indent=2,
    )


def discover_tools() -> list[dict]:
    """Return a list of tool entries discovered in the features dir.

    Each entry contains MCP-visible fields (``name``, ``description``,
    ``inputSchema``) and private fields prefixed ``_`` that we use to dispatch
    a call.
    """
    fdir = features_dir()
    tools: list[dict] = list(_builtin_tools())
    if not fdir.exists():
        log(f"features dir does not exist: {fdir}")
        return tools
    for path in sorted(fdir.glob("*.py")):
        if path.name.startswith("_"):
            continue
        slug = path.stem
        try:
            module = _load_module(slug, path)
        except Exception as exc:
            log(f"skipping {path.name}: {exc}")
            continue
        for name, fn in inspect.getmembers(module, inspect.isfunction):
            if name.startswith("_"):
                continue
            if getattr(fn, "__module__", None) != module.__name__:
                continue
            try:
                sig = inspect.signature(fn)
            except (TypeError, ValueError):
                continue
            properties: dict = {}
            required: list[str] = []
            for pname, p in sig.parameters.items():
                if p.kind in (
                    inspect.Parameter.VAR_POSITIONAL,
                    inspect.Parameter.VAR_KEYWORD,
                ):
                    continue
                properties[pname] = _type_to_schema(p.annotation)
                if p.default is inspect.Parameter.empty:
                    required.append(pname)
            input_schema: dict = {"type": "object", "properties": properties}
            if required:
                input_schema["required"] = required
            description = inspect.getdoc(fn) or f"Call {name}() from features/{slug}.py"
            tools.append(
                {
                    "name": f"{slug}__{name}",
                    "description": description,
                    "inputSchema": input_schema,
                    "_slug": slug,
                    "_path": str(path),
                    "_function": name,
                }
            )
    return tools


def _builtin_fetch_network(
    url: str,
    name: str | None = None,
    slug: str | None = None,
    license: str | None = None,
    expected_checksum: str | None = None,
    session_id: str | None = None,
) -> str:
    """Bridge into ``scripts/fetch_url.fetch_to_workspace``."""
    if not url or not isinstance(url, str):
        raise ValueError("url is required")
    if not url.startswith(("http://", "https://")):
        raise ValueError("url must be http(s)")
    # Import lazily so the MCP server starts even if the Supabase env isn't
    # configured yet (e.g. during opencode bring-up in dev).
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from fetch_url import fetch_to_workspace, ChecksumMismatch, FetchError

    try:
        result = fetch_to_workspace(
            workspace=workspace_dir(),
            url=url,
            name=name,
            slug=slug,
            license=license,
            expected_checksum=expected_checksum,
            session_id=session_id,
        )
    except ChecksumMismatch as exc:
        return json.dumps({"error": "checksum_mismatch", "detail": str(exc)}, indent=2)
    except FetchError as exc:
        return json.dumps({"error": "fetch_failed", "detail": str(exc)}, indent=2)
    return json.dumps(result, indent=2)


def _supabase_request(env: dict, method: str, path: str, body=None):
    """Issue a Supabase REST request using the service-role key. Mirrors the
    helper in ``scripts/seed_networks.py`` / ``scripts/ingest_pypsa_folder.py``
    so the MCP solve_opf tool can fetch the network row + insert a run row
    without depending on a JWT we don't have."""
    url = env.get("NEXT_PUBLIC_SUPABASE_URL")
    key = env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Supabase env missing (need NEXT_PUBLIC_SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY in grid-app/.env.local)"
        )
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


class _OutcomeShim:
    """Minimal duck-type stand-in for zap's ``DispatchOutcome``.

    ``scripts/run_artifact.build_run_view_spec`` only reads
    ``outcome.prices`` (cast through numpy), so we wrap the Modal solver's
    JSON ``outcome.prices`` list in an object that exposes the same attribute.
    Carrier-dispatch + line-flow extraction is best-effort over PyPSA's own
    pre-solved time-series, which we don't touch."""

    __slots__ = ("prices", "power", "angle")

    def __init__(self, prices=None, power=None, angle=None):
        self.prices = prices
        self.power = power
        self.angle = angle


def _solve_via_modal(
    net_dir,
    pnet,
    snapshots,
    hours: int,
    admm_args: dict | None = None,
) -> tuple:
    """Run the Modal-hosted ADMM solver and return a tuple shaped like the
    CPU path: ``(outcome, pnet, snapshots, used_solver, elapsed, extra)``.

    ``extra`` carries provenance fields the run artifact's metadata wants
    (machine, gpu, solver_args) — the caller passes them through
    ``build_run_row``'s provenance kwargs. Raises ``RuntimeError`` with a
    clear message when the Modal env isn't configured or the call fails.

    ``admm_args`` defaults to ``{"num_iterations": 1000}`` (the interactive
    setting; fast but ~30% LMP diff vs CPU on ieee-30). The cross-path probe
    (``scripts/_compare_gpu_paths.py``) overrides this to match the precision
    settings ``scripts/_gpu_adapter.HIGH_PRECISION_ADMM_ARGS`` posts from the
    CLI path so the two callers send identical bodies to the endpoint."""
    import base64
    import tempfile

    env = _load_grid_app_env()
    endpoint = env.get("ZAP_SOLVER_MODAL_URL")
    api_key = env.get("ZAP_SOLVER_API_KEY")
    if not endpoint or not api_key:
        raise RuntimeError(
            "Modal solver not configured — set ZAP_SOLVER_MODAL_URL + "
            "ZAP_SOLVER_API_KEY in grid-app/.env.local"
        )

    pnet.set_snapshots(snapshots)
    with tempfile.NamedTemporaryFile(suffix=".nc", delete=False) as tf:
        nc_path = tf.name
    try:
        pnet.export_to_netcdf(nc_path)
        nc_bytes = Path(nc_path).read_bytes()
    finally:
        Path(nc_path).unlink(missing_ok=True)

    args_for_post = dict(admm_args) if admm_args else {"num_iterations": 1000}
    payload = json.dumps(
        {
            "network_nc_b64": base64.b64encode(nc_bytes).decode("ascii"),
            "args": args_for_post,
            "import_args": {},
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        method="POST",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    timeout_s = int(env.get("ZAP_SOLVER_TIMEOUT_S") or 600)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            result = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:500] if exc.fp else ""
        raise RuntimeError(
            f"Modal solver returned HTTP {exc.code}: {detail}"
        ) from exc
    elapsed = time.time() - t0

    outcome_payload = result.get("outcome") or {}
    outcome = _OutcomeShim(
        prices=outcome_payload.get("prices"),
        power=outcome_payload.get("power"),
        angle=outcome_payload.get("angle"),
    )
    extra = {
        "machine": result.get("machine"),
        "gpu": result.get("gpu"),
        "solver_args": result.get("solver_args") or {},
        "num_buses": result.get("num_buses"),
        "time_horizon": result.get("time_horizon"),
        "bus_ids": result.get("bus_ids") or [],
    }
    return outcome, pnet, snapshots, "MODAL_GPU", elapsed, extra


def _builtin_list_networks() -> str:
    """List `kind='network'` artifacts this user can see (canonical + own).

    Uses the service-role key (which bypasses RLS), so we re-apply the
    visibility rule by hand: a network is visible when it has no owner
    (canonical reference networks, `user_id IS NULL`) or is owned by this
    user. Org-scoped networks aren't included here yet — the MCP server only
    knows STEINMETZ_USER_ID, not the user's org memberships."""
    env = _load_grid_app_env()
    user_id = os.environ.get("STEINMETZ_USER_ID")
    rows = (
        _supabase_request(
            env,
            "GET",
            "artifacts?kind=eq.network"
            "&select=id,name,slug,status,metadata,user_id"
            "&order=created_at.asc",
        )
        or []
    )
    networks: list[dict] = []
    for r in rows:
        owner = r.get("user_id")
        if owner not in (None, user_id):
            continue
        meta = r.get("metadata") or {}
        networks.append(
            {
                "id": r.get("id"),
                "name": r.get("name"),
                "slug": r.get("slug"),
                "status": r.get("status"),
                "pipeline_status": meta.get("pipeline_status"),
                "buses": meta.get("buses"),
                "lines": meta.get("lines"),
                "generators": meta.get("generators"),
                "canonical": owner is None,
            }
        )
    return json.dumps({"networks": networks}, indent=2)


def _builtin_solve_opf(
    network_artifact_id: str,
    hours: int = 1,
    gpu: bool = False,
) -> str:
    """Fetch a network artifact, dispatch on CPU or GPU, write a run row."""
    if not network_artifact_id or not isinstance(network_artifact_id, str):
        raise ValueError("network_artifact_id is required")
    try:
        hours = int(hours)
    except (TypeError, ValueError):
        raise ValueError("hours must be an integer")
    if hours < 1:
        raise ValueError("hours must be >= 1")

    env = _load_grid_app_env()
    rows = _supabase_request(
        env,
        "GET",
        f"artifacts?id=eq.{network_artifact_id}&select=*",
    )
    if not rows:
        raise RuntimeError(f"network artifact {network_artifact_id} not found")
    network_artifact = rows[0]
    if network_artifact.get("kind") != "network":
        raise RuntimeError(
            f"artifact {network_artifact_id} is kind={network_artifact.get('kind')!r}, "
            "not 'network'"
        )

    fs_path = network_artifact.get("fs_path")
    if not fs_path:
        raise RuntimeError(
            f"artifact {network_artifact_id} has no fs_path; cannot locate "
            "PyPSA folder on disk"
        )
    net_dir = Path(fs_path)
    if not net_dir.is_absolute():
        net_dir = (ROOT / net_dir).resolve()
    if not (net_dir / "buses.csv").exists():
        raise RuntimeError(
            f"network folder {net_dir} is missing buses.csv — re-run "
            "ingestion or pass a different artifact"
        )

    # The smoke-dispatch helper covers the CPU path end-to-end; for the GPU
    # path we load the network locally so build_run_row can re-use the same
    # pnet for carrier / line-flow extraction.
    sys.path.insert(0, str(ROOT / "scripts"))
    import _pypsa_compat  # noqa: F401  must precede pypsa import

    import pypsa
    import pandas as pd

    pnet = pypsa.Network()
    pnet.import_from_csv_folder(str(net_dir))
    if len(pnet.snapshots) == 0:
        pnet.set_snapshots(pd.date_range("2024-01-01", periods=1, freq="h"))
    snapshots = pnet.snapshots[:hours]

    extra: dict = {}
    if gpu:
        outcome, pnet, snapshots, used_solver, elapsed, extra = _solve_via_modal(
            net_dir, pnet, snapshots, hours
        )
    else:
        from smoke_dispatch import run_dispatch

        outcome, pnet, snapshots, used_solver, elapsed = run_dispatch(
            net_dir, hours=hours
        )

    from run_artifact import build_run_row

    user_id = network_artifact.get("user_id") or os.environ.get("STEINMETZ_USER_ID")
    row = build_run_row(
        network_artifact={"id": network_artifact_id, "user_id": user_id},
        network_name=network_artifact.get("name") or net_dir.name,
        network_slug=network_artifact.get("slug"),
        net_dir=net_dir,
        outcome=outcome,
        pnet=pnet,
        snapshots=snapshots,
        used_solver=used_solver,
        elapsed_s=float(elapsed),
        canonical=False,
        machine=(extra or {}).get("machine"),
        gpu=True if gpu else None,
        solver_args=(extra or {}).get("solver_args") or None,
    )
    if extra:
        metadata = dict(row.get("metadata") or {})
        metadata["gpu_requested"] = True
        row["metadata"] = metadata
    if user_id:
        row["user_id"] = user_id

    inserted = _supabase_request(env, "POST", "artifacts", row)
    if not inserted:
        raise RuntimeError("Supabase insert returned no row")
    new_id = inserted[0].get("id")
    return json.dumps(
        {
            "run_artifact_id": new_id,
            "network_artifact_id": network_artifact_id,
            "solver": used_solver,
            "machine": (extra or {}).get("machine") or "cpu",
            "elapsed_s": round(float(elapsed), 3),
            "hours": int(len(snapshots)),
        },
        indent=2,
    )


_BUILTIN_DISPATCH = {
    "list_pending_imports": _builtin_list_pending_imports,
    "inspect_upload": _builtin_inspect_upload,
    "write_custom_importer": _builtin_write_custom_importer,
    "fetch_network": _builtin_fetch_network,
    "list_networks": _builtin_list_networks,
    "solve_opf": _builtin_solve_opf,
}


def call_tool(tool_name: str, arguments: dict | None) -> str:
    tools = discover_tools()
    target = next((t for t in tools if t["name"] == tool_name), None)
    if not target:
        raise ValueError(f"unknown tool: {tool_name}")
    builtin = target.get("_builtin")
    if builtin:
        handler = _BUILTIN_DISPATCH.get(builtin)
        if not handler:
            raise ValueError(f"builtin handler missing: {builtin}")
        result = handler(**(arguments or {}))
        if isinstance(result, str):
            return result
        try:
            return json.dumps(result, default=str, indent=2)
        except Exception:
            return repr(result)
    module = _load_module(target["_slug"] + "_call", Path(target["_path"]))
    fn = getattr(module, target["_function"])
    result = fn(**(arguments or {}))
    if isinstance(result, str):
        return result
    try:
        return json.dumps(result, default=str, indent=2)
    except Exception:
        return repr(result)


class ProceedDenied(Exception):
    """Raised when grid-app's token bucket refuses admission (HTTP 429)."""

    def __init__(self, retry_after: int, reason: str) -> None:
        super().__init__(f"proceed denied: {reason} (retry_after={retry_after}s)")
        self.retry_after = retry_after
        self.reason = reason


def _grid_app_url() -> str:
    return os.environ.get("STEINMETZ_GRID_APP_URL") or DEFAULT_GRID_APP_URL


def _proceed_args_digest(arguments: dict | None) -> str:
    try:
        canonical = json.dumps(arguments or {}, sort_keys=True, default=str)
    except Exception:
        canonical = repr(arguments)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:32]


def _proceed_request(tool_name: str, arguments: dict | None) -> str | None:
    """Reserve a concurrency slot for `tool_name`. Returns a release token
    when grid-app admits the call, raises ProceedDenied on 429, returns None
    when the admission endpoint isn't configured (so the call runs unmetered).
    """
    token = os.environ.get("STEINMETZ_INTERNAL_TOKEN")
    user_id = os.environ.get("STEINMETZ_USER_ID")
    if not token or not user_id:
        return None
    payload = json.dumps(
        {
            "user_id": user_id,
            "tool": tool_name,
            "args_digest": _proceed_args_digest(arguments),
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        _grid_app_url().rstrip("/") + PROCEED_URL_PATH,
        method="POST",
        data=payload,
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8") or "{}")
            return str(body.get("token") or "") or None
    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            try:
                body = json.loads(exc.read().decode("utf-8") or "{}")
            except Exception:
                body = {}
            raise ProceedDenied(
                retry_after=int(body.get("retry_after") or 5),
                reason=str(body.get("reason") or "rate_limited"),
            ) from exc
        log(f"proceed HTTP error {exc.code}: {exc.reason}")
        return None
    except Exception as exc:
        log(f"proceed call failed: {exc}")
        return None


def _release_request(
    proceed_token: str | None,
    *,
    status: str,
    runtime_ms: int,
    error: str | None = None,
) -> None:
    if not proceed_token:
        return
    bearer = os.environ.get("STEINMETZ_INTERNAL_TOKEN")
    if not bearer:
        return
    payload: dict = {
        "token": proceed_token,
        "status": status,
        "runtime_ms": runtime_ms,
    }
    if error:
        payload["error"] = error[:4000]
    req = urllib.request.Request(
        _grid_app_url().rstrip("/") + RELEASE_URL_PATH,
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {bearer}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            resp.read()
    except Exception as exc:
        log(f"release call failed: {exc}")


def _send(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def _respond(msg_id, *, result=None, error=None) -> None:
    out: dict = {"jsonrpc": "2.0", "id": msg_id}
    if error is not None:
        out["error"] = error
    else:
        out["result"] = result
    _send(out)


def _public_tools(tools: list[dict]) -> list[dict]:
    return [{k: v for k, v in t.items() if not k.startswith("_")} for t in tools]


def handle(req: dict) -> None:
    method = req.get("method")
    msg_id = req.get("id")
    params = req.get("params") or {}

    if method == "initialize":
        _respond(
            msg_id,
            result={
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": SERVER_INFO,
            },
        )
        return

    if method in ("notifications/initialized", "initialized"):
        return

    if method == "ping":
        _respond(msg_id, result={})
        return

    if method == "tools/list":
        _respond(msg_id, result={"tools": _public_tools(discover_tools())})
        return

    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        # HARDENING §2.2: ask grid-app for a slot before running the tool. If
        # the bucket is full we surface the 429 to the agent as an MCP tool
        # error (`isError: true`) — same shape it sees for any other failure,
        # so the agent can decide to retry or pick a different tool.
        proceed_token: str | None = None
        try:
            proceed_token = _proceed_request(name or "", args)
        except ProceedDenied as denied:
            _respond(
                msg_id,
                result={
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                f"concurrency limit reached ({denied.reason}); "
                                f"retry in ~{denied.retry_after}s"
                            ),
                        }
                    ],
                    "isError": True,
                },
            )
            return

        start_ns = time.monotonic_ns()
        try:
            text = call_tool(name, args)
        except Exception as exc:
            tb = traceback.format_exc()
            runtime_ms = max(0, (time.monotonic_ns() - start_ns) // 1_000_000)
            _release_request(
                proceed_token,
                status="error",
                runtime_ms=int(runtime_ms),
                error=str(exc),
            )
            _respond(
                msg_id,
                result={
                    "content": [{"type": "text", "text": f"{exc}\n\n{tb}"}],
                    "isError": True,
                },
            )
            return

        runtime_ms = max(0, (time.monotonic_ns() - start_ns) // 1_000_000)
        _release_request(proceed_token, status="ok", runtime_ms=int(runtime_ms))
        _respond(
            msg_id,
            result={
                "content": [{"type": "text", "text": text}],
                "isError": False,
            },
        )
        return

    if msg_id is not None:
        _respond(msg_id, error={"code": -32601, "message": f"method not found: {method}"})


def main() -> None:
    log(f"starting; features={features_dir()}")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as exc:
            log(f"bad json from client: {exc}")
            continue
        try:
            handle(req)
        except Exception as exc:
            log(f"handler crashed: {exc}\n{traceback.format_exc()}")
            msg_id = req.get("id")
            if msg_id is not None:
                _respond(msg_id, error={"code": -32603, "message": str(exc)})


if __name__ == "__main__":
    main()
