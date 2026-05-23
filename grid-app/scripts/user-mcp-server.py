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

import importlib.util
import inspect
import json
import os
import sys
import traceback
import typing
from pathlib import Path

PROTOCOL_VERSION = "2025-06-18"
SERVER_INFO = {"name": "steinmetz-features", "version": "0.1.0"}


def features_dir() -> Path:
    return Path(os.environ.get("STEINMETZ_FEATURES_DIR") or "features").resolve()


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


def discover_tools() -> list[dict]:
    """Return a list of tool entries discovered in the features dir.

    Each entry contains MCP-visible fields (``name``, ``description``,
    ``inputSchema``) and private fields prefixed ``_`` that we use to dispatch
    a call.
    """
    fdir = features_dir()
    if not fdir.exists():
        log(f"features dir does not exist: {fdir}")
        return []
    tools: list[dict] = []
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


def call_tool(tool_name: str, arguments: dict | None) -> str:
    tools = discover_tools()
    target = next((t for t in tools if t["name"] == tool_name), None)
    if not target:
        raise ValueError(f"unknown tool: {tool_name}")
    module = _load_module(target["_slug"] + "_call", Path(target["_path"]))
    fn = getattr(module, target["_function"])
    result = fn(**(arguments or {}))
    if isinstance(result, str):
        return result
    try:
        return json.dumps(result, default=str, indent=2)
    except Exception:
        return repr(result)


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
        try:
            text = call_tool(name, args)
            _respond(
                msg_id,
                result={
                    "content": [{"type": "text", "text": text}],
                    "isError": False,
                },
            )
        except Exception as exc:
            tb = traceback.format_exc()
            _respond(
                msg_id,
                result={
                    "content": [{"type": "text", "text": f"{exc}\n\n{tb}"}],
                    "isError": True,
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
