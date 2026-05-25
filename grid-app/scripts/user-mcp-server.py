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


_BUILTIN_DISPATCH = {
    "list_pending_imports": _builtin_list_pending_imports,
    "inspect_upload": _builtin_inspect_upload,
    "write_custom_importer": _builtin_write_custom_importer,
    "fetch_network": _builtin_fetch_network,
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
