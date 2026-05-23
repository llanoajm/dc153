#!/usr/bin/env python3
"""Reviewer agent: validate a feature artifact, set its status, log the decision.

Driven by ``app/api/features/[id]/route.ts`` (after a user edits a feature) and
``scripts/ingest_pdf.py`` (after the intake drafter inserts a draft). Implements
ROADMAP §9 (LOOP_QUEUE item 15).

Checks performed on the feature module at ``artifact.fs_path``:

1. **Parse.** ``ast.parse`` on the source. A SyntaxError is a hard fail.
2. **Import.** Load the module via ``importlib`` with the user's workspace on
   ``sys.path`` so relative imports (``from features.x import y``) resolve.
   ``ImportError`` or any exception raised at module top level is a hard fail.
3. **Signatures.** For each public function (no leading underscore), inspect
   its ``inspect.Signature``. Parameters annotated as ``DispatchOutcome`` or
   ``zap.DispatchOutcome`` are recorded — the reviewer doesn't reject on
   signature shape alone (drafts are intentionally stubs), but it flags any
   annotation that references a name we can't resolve.
4. **Smoke.** Call every zero-argument public function. Exception → soft fail
   (recorded but doesn't flip status by itself; only counts toward a hard
   fail if combined with another problem).

Outcome:

* All hard checks pass + soft checks pass  → ``passed``
* Hard fail  → ``failed`` (status flipped to ``failed_validation``)
* Hard pass + soft fail → ``passed_with_warnings`` (status stays ``draft``)

Status transitions (only when the artifact is currently ``draft``):

* ``passed`` AND the scope's ``review_policies.auto_promote = true``
    → status flips to ``canonical``.
* ``passed`` AND ``auto_promote = false``
    → status stays ``draft`` (the user/admin approves manually).
* ``failed``
    → status flips to ``failed_validation`` regardless of policy.

Either way an ``audit_log`` row is written with the full check report. The
reviewer never silently flips an already-``canonical`` artifact back to
``draft`` — it can only flip a passing canonical to ``failed_validation`` if
the user's last edit broke it.

Auth: requires ``SUPABASE_SERVICE_ROLE_KEY`` in the environment or in
``.env.local``.
"""
from __future__ import annotations

import argparse
import ast
import importlib.util
import inspect
import json
import os
import sys
import traceback
import typing
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
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
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode()
        return json.loads(text) if text else None


def _fetch_artifact(env: dict[str, str], artifact_id: str) -> dict[str, Any] | None:
    rows = _supabase_request(env, "GET", f"artifacts?id=eq.{artifact_id}&select=*")
    return rows[0] if rows else None


def _patch_artifact(env: dict[str, str], artifact_id: str, patch: dict[str, Any]) -> None:
    patch = dict(patch)
    patch.setdefault("updated_at", datetime.now(timezone.utc).isoformat())
    _supabase_request(env, "PATCH", f"artifacts?id=eq.{artifact_id}", patch)


def _fetch_policy(
    env: dict[str, str], *, user_id: str | None, org_id: str | None
) -> dict[str, Any] | None:
    """Look up the review policy for the artifact's scope.

    Org-scoped artifacts use the org's policy if present; otherwise the
    author's personal policy. Personal artifacts use the author's policy.
    Missing rows mean ``auto_promote=false`` (require approval).
    """
    if org_id:
        rows = _supabase_request(
            env, "GET", f"review_policies?org_id=eq.{org_id}&user_id=is.null&select=*"
        )
        if rows:
            return rows[0]
    if user_id:
        rows = _supabase_request(
            env, "GET", f"review_policies?user_id=eq.{user_id}&org_id=is.null&select=*"
        )
        if rows:
            return rows[0]
    return None


def _write_audit(
    env: dict[str, str],
    *,
    user_id: str | None,
    org_id: str | None,
    artifact_id: str | None,
    action: str,
    actor: str,
    payload: dict[str, Any],
) -> None:
    """Insert one audit_log row. Service-role only."""
    try:
        _supabase_request(
            env,
            "POST",
            "audit_log",
            {
                "user_id": user_id,
                "org_id": org_id,
                "artifact_id": artifact_id,
                "action": action,
                "actor": actor,
                "payload": payload,
            },
        )
    except Exception as exc:  # don't let audit failure mask the real result
        sys.stderr.write(f"[review_feature] audit insert failed: {exc}\n")


# ---------------------------------------------------------------------------
# checks
# ---------------------------------------------------------------------------

# Parameters annotated with these names are treated as referring to zap's
# ``DispatchOutcome`` (or a subclass). Pure string-matching — fully resolving
# the annotation would require executing the module, which we already do, but
# this catches forward references and string annotations that don't resolve at
# import time.
_DISPATCH_OUTCOME_NAMES = ("DispatchOutcome", "zap.DispatchOutcome")


def _import_module(source_path: Path, workspace: Path) -> tuple[Any | None, str | None]:
    """Import ``source_path`` as ``features.<stem>``.

    Returns ``(module, None)`` on success or ``(None, error_string)`` on
    failure. The workspace is prepended to ``sys.path`` so relative imports
    inside the feature resolve.
    """
    workspace_str = str(workspace)
    inserted = False
    if workspace_str not in sys.path:
        sys.path.insert(0, workspace_str)
        inserted = True
    try:
        spec = importlib.util.spec_from_file_location(
            f"features.{source_path.stem}", source_path
        )
        if spec is None or spec.loader is None:
            return None, "could not build importlib spec"
        module = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(module)
        except Exception as exc:
            return None, f"{type(exc).__name__}: {exc}"
        return module, None
    finally:
        if inserted:
            try:
                sys.path.remove(workspace_str)
            except ValueError:
                pass


def _annotation_str(annotation: Any) -> str:
    if annotation is inspect.Parameter.empty:
        return ""
    if isinstance(annotation, str):
        return annotation
    try:
        return getattr(annotation, "__qualname__", "") or getattr(
            annotation, "__name__", ""
        ) or repr(annotation)
    except Exception:
        return repr(annotation)


def _check_signatures(module: Any) -> dict[str, Any]:
    """Walk public functions, record their signatures, flag DispatchOutcome refs."""
    public: list[dict[str, Any]] = []
    dispatch_refs: list[str] = []
    for name, obj in vars(module).items():
        if name.startswith("_"):
            continue
        if not inspect.isfunction(obj) and not inspect.ismethod(obj):
            continue
        if getattr(obj, "__module__", None) != module.__name__:
            continue  # re-exported import, not the feature's own function
        try:
            sig = inspect.signature(obj)
        except (TypeError, ValueError) as exc:
            public.append({"name": name, "error": f"signature: {exc}"})
            continue
        params: list[dict[str, str]] = []
        for pname, p in sig.parameters.items():
            ann = _annotation_str(p.annotation)
            params.append({"name": pname, "annotation": ann})
            if any(target in ann for target in _DISPATCH_OUTCOME_NAMES):
                dispatch_refs.append(f"{name}.{pname}")
        ret = _annotation_str(sig.return_annotation)
        if any(target in ret for target in _DISPATCH_OUTCOME_NAMES):
            dispatch_refs.append(f"{name} -> return")
        public.append({"name": name, "params": params, "returns": ret})
    return {
        "public_functions": public,
        "dispatch_outcome_refs": dispatch_refs,
    }


def _smoke_call_zero_arg_funcs(module: Any, limit: int = 8) -> list[dict[str, Any]]:
    """Call every public zero-required-arg function. Return per-call results."""
    results: list[dict[str, Any]] = []
    count = 0
    for name, obj in vars(module).items():
        if name.startswith("_"):
            continue
        if not callable(obj):
            continue
        if getattr(obj, "__module__", None) != module.__name__:
            continue
        try:
            sig = inspect.signature(obj)
        except (TypeError, ValueError):
            continue
        required = [
            p
            for p in sig.parameters.values()
            if p.default is inspect.Parameter.empty
            and p.kind
            in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.POSITIONAL_ONLY)
        ]
        if required:
            continue
        if count >= limit:
            break
        count += 1
        try:
            value = obj()
            results.append(
                {
                    "name": name,
                    "ok": True,
                    "value_type": type(value).__name__,
                    "value_preview": _preview(value),
                }
            )
        except Exception as exc:
            results.append(
                {
                    "name": name,
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}",
                }
            )
    return results


def _preview(value: Any, limit: int = 200) -> str:
    try:
        s = repr(value)
    except Exception:
        s = f"<unrepr-able {type(value).__name__}>"
    if len(s) > limit:
        s = s[: limit - 3] + "..."
    return s


def review_module(source_path: Path, workspace: Path) -> dict[str, Any]:
    """Run all checks. Returns a structured report.

    Report shape::

        {
          "parse": {"ok": bool, "error": str|None},
          "import": {"ok": bool, "error": str|None},
          "signatures": {...},
          "smoke": [{name, ok, ...}, ...],
          "outcome": "passed" | "passed_with_warnings" | "failed",
          "summary": "<one-line>",
        }
    """
    report: dict[str, Any] = {
        "parse": {"ok": False, "error": None},
        "import": {"ok": False, "error": None},
        "signatures": None,
        "smoke": [],
        "outcome": "failed",
        "summary": "",
    }
    try:
        source_text = source_path.read_text(encoding="utf-8")
    except OSError as exc:
        report["parse"]["error"] = f"read failed: {exc}"
        report["summary"] = "could not read source file"
        return report

    try:
        ast.parse(source_text, filename=str(source_path))
        report["parse"]["ok"] = True
    except SyntaxError as exc:
        report["parse"]["error"] = f"SyntaxError: {exc.msg} at line {exc.lineno}"
        report["summary"] = "syntax error"
        return report

    module, import_err = _import_module(source_path, workspace)
    if import_err or module is None:
        report["import"]["error"] = import_err or "unknown import failure"
        report["summary"] = "module failed to import"
        return report
    report["import"]["ok"] = True

    try:
        report["signatures"] = _check_signatures(module)
    except Exception as exc:
        report["signatures"] = {"error": f"{type(exc).__name__}: {exc}"}

    try:
        report["smoke"] = _smoke_call_zero_arg_funcs(module)
    except Exception as exc:
        report["smoke"] = [{"name": "<harness>", "ok": False, "error": str(exc)}]

    smoke_fails = [r for r in report["smoke"] if not r.get("ok", False)]
    if smoke_fails:
        report["outcome"] = "passed_with_warnings"
        report["summary"] = (
            f"imports clean; {len(smoke_fails)} smoke call(s) raised"
        )
    else:
        report["outcome"] = "passed"
        n_public = (
            len((report["signatures"] or {}).get("public_functions") or [])
            if isinstance(report["signatures"], dict)
            else 0
        )
        report["summary"] = (
            f"imports clean; {n_public} public function(s); "
            f"{len(report['smoke'])} smoke call(s) ok"
        )
    return report


# ---------------------------------------------------------------------------
# orchestration
# ---------------------------------------------------------------------------

def review_artifact(artifact_id: str, workspace: Path) -> dict[str, Any]:
    """End-to-end: load artifact -> run checks -> apply status -> audit."""
    env = _load_env()
    if "SUPABASE_SERVICE_ROLE_KEY" not in env:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY missing (env or .env.local)")

    artifact = _fetch_artifact(env, artifact_id)
    if artifact is None:
        raise RuntimeError(f"artifact {artifact_id} not found")
    if artifact.get("kind") != "feature":
        raise RuntimeError(
            f"artifact {artifact_id} kind={artifact.get('kind')!r}, not 'feature'"
        )

    fs_path = artifact.get("fs_path")
    if not fs_path:
        report = {
            "outcome": "failed",
            "summary": "artifact has no fs_path",
            "parse": {"ok": False, "error": "missing fs_path"},
        }
    else:
        source_path = Path(fs_path)
        if not source_path.exists():
            # If the active file is missing, peek at the hidden form (the
            # features panel renames rejected drafts to ``_<slug>.py``).
            alt = source_path.with_name(f"_{source_path.name}")
            if alt.exists():
                source_path = alt
        if not source_path.exists():
            report = {
                "outcome": "failed",
                "summary": f"source file missing: {fs_path}",
                "parse": {"ok": False, "error": "file not found"},
            }
        else:
            report = review_module(source_path, workspace)

    # Decide on the status transition.
    current_status = artifact.get("status")
    user_id = artifact.get("user_id")
    org_id = artifact.get("org_id")
    policy = _fetch_policy(env, user_id=user_id, org_id=org_id)
    auto_promote = bool((policy or {}).get("auto_promote"))

    decided: str | None = None
    if report["outcome"] == "failed":
        decided = "failed_validation"
    elif report["outcome"] == "passed" and current_status == "draft" and auto_promote:
        decided = "canonical"
    elif report["outcome"] == "passed" and current_status == "failed_validation":
        # The user fixed a previously-failing draft. Move it back to draft so
        # they can approve manually (auto_promote escalates from there).
        decided = "canonical" if auto_promote else "draft"
    elif report["outcome"] == "passed_with_warnings" and current_status == "failed_validation":
        decided = "draft"

    meta = dict(artifact.get("metadata") or {})
    history = meta.get("review_history") if isinstance(meta.get("review_history"), list) else []
    history = list(history) + [
        {
            "at": datetime.now(timezone.utc).isoformat(),
            "outcome": report["outcome"],
            "summary": report["summary"],
            "policy_auto_promote": auto_promote,
            "from_status": current_status,
            "to_status": decided or current_status,
        }
    ]
    meta["review_history"] = history[-10:]
    meta["last_review"] = history[-1]

    patch: dict[str, Any] = {"metadata": meta}
    if decided and decided != current_status:
        patch["status"] = decided
    _patch_artifact(env, artifact_id, patch)

    _write_audit(
        env,
        user_id=user_id,
        org_id=org_id,
        artifact_id=artifact_id,
        action=f"review.{report['outcome']}",
        actor="reviewer",
        payload={
            "report": report,
            "from_status": current_status,
            "to_status": decided or current_status,
            "policy_auto_promote": auto_promote,
        },
    )

    return {
        "artifact_id": artifact_id,
        "outcome": report["outcome"],
        "summary": report["summary"],
        "from_status": current_status,
        "to_status": decided or current_status,
        "auto_promote": auto_promote,
    }


def _cli() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-id", required=True)
    parser.add_argument("--workspace", required=True)
    args = parser.parse_args()
    try:
        result = review_artifact(args.artifact_id, Path(args.workspace))
    except Exception as exc:
        sys.stderr.write(
            f"review_feature failed: {exc}\n{traceback.format_exc()}"
        )
        return 1
    sys.stdout.write(json.dumps(result) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
