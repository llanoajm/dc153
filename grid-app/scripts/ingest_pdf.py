#!/usr/bin/env python3
"""Detached PDF ingestion: text extraction → chunks → embeddings → glossary + context.

Driven by ``app/api/upload/pdf/route.ts``. Walks an artifact through the
pipeline statuses required by ROADMAP §1 / §3 (LOOP_QUEUE item 11):

    queued -> extracting -> chunking -> embedded -> ready

Pipeline:

1. Extract per-page text via ``pypdf``.
2. Chunk paragraphs into ~``CHUNK_TARGET`` characters with ``CHUNK_OVERLAP``
   overlap. Each chunk keeps the originating page number.
3. Compute a deterministic hashing-based bag-of-words embedding (no ML deps).
   This is a placeholder vector — semantic embeddings can replace it without a
   schema change.
4. Insert chunks into ``public.source_chunks`` via the Supabase REST API.
5. Extract glossary candidates (acronyms, "X is defined as Y", "X means Y",
   "X stands for Y" sentences) and merge into ``<workspace>/glossary.md``.
6. Write a narrative ``<workspace>/company-context.md`` (title + first
   paragraph + section headings) merged with prior content.
7. If the artifact has a ``parent_id`` (the prior version of the same slug),
   build a unified diff of the new vs. old extracted text and store it on
   the artifact's ``view_spec`` so the universal renderer shows it via the
   ``diff`` renderer.

Auth: requires ``SUPABASE_SERVICE_ROLE_KEY`` in the environment (or in
``.env.local``).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env.local"

CHUNK_TARGET = 1200
CHUNK_OVERLAP = 200
EMBEDDING_DIM = 128


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


def _fetch_artifact(env: dict[str, str], artifact_id: str) -> dict[str, Any]:
    rows = _supabase_request(env, "GET", f"artifacts?id=eq.{artifact_id}&select=*")
    if not rows:
        raise RuntimeError(f"artifact {artifact_id} not found")
    return rows[0]


def _patch_artifact(env: dict[str, str], artifact_id: str, patch: dict[str, Any]) -> None:
    patch = dict(patch)
    patch.setdefault("updated_at", datetime.now(timezone.utc).isoformat())
    _supabase_request(env, "PATCH", f"artifacts?id=eq.{artifact_id}", patch)


def _merge_metadata(
    env: dict[str, str], artifact: dict[str, Any], patch: dict[str, Any]
) -> dict[str, Any]:
    meta = dict(artifact.get("metadata") or {})
    meta.update(patch)
    _patch_artifact(env, artifact["id"], {"metadata": meta})
    artifact["metadata"] = meta
    return artifact


def _set_pipeline(env: dict[str, str], artifact: dict[str, Any], status: str) -> None:
    _merge_metadata(env, artifact, {"pipeline_status": status})


def _set_failed(env: dict[str, str], artifact: dict[str, Any], message: str) -> None:
    _patch_artifact(
        env,
        artifact["id"],
        {
            "status": "failed_validation",
            "metadata": {
                **(artifact.get("metadata") or {}),
                "pipeline_status": "failed",
                "pipeline_error": message[:1000],
            },
        },
    )


# ---------------------------------------------------------------------------
# extraction
# ---------------------------------------------------------------------------

def extract_pdf(pdf_path: Path) -> tuple[str, list[tuple[int, str]]]:
    """Return (full_text, per_page) for ``pdf_path``.

    per_page is a list of (page_number_1indexed, page_text). Tables / weird
    layouts are best-effort: pypdf extracts the text frame and we strip
    excess whitespace.
    """
    try:
        import pypdf  # type: ignore
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "pypdf not installed in the venv — run "
            "`pip install --target=/home/agent/zap/.venv/lib/python3.12/site-packages pypdf`"
        ) from exc

    reader = pypdf.PdfReader(str(pdf_path))
    per_page: list[tuple[int, str]] = []
    for i, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        text = re.sub(r"[ \t]+", " ", text)
        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        if text:
            per_page.append((i, text))
    full = "\n\n".join(t for _, t in per_page)
    return full, per_page


def chunk_text(per_page: list[tuple[int, str]]) -> list[dict[str, Any]]:
    """Split per-page text into rough ``CHUNK_TARGET``-char chunks with overlap.

    Returns ``[{ordinal, page, text}, ...]``. Pages are kept on chunks; if a
    chunk spans two pages we tag it with the page where it started.
    """
    chunks: list[dict[str, Any]] = []
    ordinal = 0
    carry = ""
    carry_page: int | None = None
    for page_no, text in per_page:
        # Combine paragraph-aware: split on blank lines first.
        for paragraph in re.split(r"\n\s*\n", text):
            paragraph = paragraph.strip()
            if not paragraph:
                continue
            if not carry:
                carry_page = page_no
                carry = paragraph
            else:
                carry = f"{carry}\n\n{paragraph}"
            while len(carry) >= CHUNK_TARGET:
                chunks.append(
                    {"ordinal": ordinal, "page": carry_page, "text": carry[:CHUNK_TARGET]}
                )
                ordinal += 1
                # Carry forward the tail with overlap so context bridges chunks.
                tail_start = max(0, CHUNK_TARGET - CHUNK_OVERLAP)
                carry = carry[tail_start:]
                carry_page = page_no
    if carry.strip():
        chunks.append({"ordinal": ordinal, "page": carry_page, "text": carry.strip()})
    return chunks


# ---------------------------------------------------------------------------
# embedding (deterministic hashing-based bag-of-words)
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9_-]{1,}")


def embed_text(text: str, dim: int = EMBEDDING_DIM) -> list[float]:
    """Deterministic hashing-trick vector.

    For every alpha token in ``text`` we increment ``vector[hash(token) % dim]``.
    Then L2-normalize. The result is a fixed-dimensional vector that captures
    lexical co-occurrence — not as good as a semantic embedding, but
    dependency-free, reproducible, and a defensible MVP for retrieval/dedup.
    """
    vec = [0.0] * dim
    for tok in _TOKEN_RE.findall(text.lower()):
        h = int(hashlib.blake2b(tok.encode("utf-8"), digest_size=8).hexdigest(), 16)
        vec[h % dim] += 1.0
    norm = math.sqrt(sum(x * x for x in vec))
    if norm > 0:
        vec = [x / norm for x in vec]
    return vec


# ---------------------------------------------------------------------------
# glossary + context extraction (rule-based; agent can refine post-hoc)
# ---------------------------------------------------------------------------

_ACRONYM_RE = re.compile(r"\b([A-Z]{2,6})\b")
# The full-form must stay on one line and start at a sentence/line boundary —
# otherwise lazy `\w\s,-` greedily slurps the prior sentence's tail.
_PAREN_EXPANSION_RE = re.compile(
    r"(?:(?<=^)|(?<=[.!?]\s)|(?<=\n))([A-Z][A-Za-z0-9 ,-]{3,60}?)\s*\(([A-Z]{2,8})\)"
)
# Definition patterns intentionally use a short, alpha-only term so we don't
# slurp the tail of the prior sentence. The term must START at a sentence
# boundary (start of string, after a period, or after a newline).
_TERM_BOUNDARY = r"(?:(?<=^)|(?<=[.!?]\s)|(?<=\n))"
_DEFINITION_PATTERNS = [
    re.compile(
        _TERM_BOUNDARY + r"([A-Z][\w\s-]{2,40}?)\s+(?:is defined as|refers to|means|stands for)\s+([^.\n]{5,400})\.",
    ),
    re.compile(
        _TERM_BOUNDARY + r"([A-Z][\w\s-]{2,40}?)\s+(?:is|are)\s+(?:a|an|the)\s+([^.\n]{5,400})\.",
    ),
]


def extract_glossary(text: str) -> dict[str, str]:
    """Extract candidate {term: definition}. Best-effort, conservative."""
    terms: dict[str, str] = {}

    # Acronyms introduced as "Full Name (ACR)" — high-precision.
    for m in _PAREN_EXPANSION_RE.finditer(text):
        full = m.group(1).strip().rstrip(",")
        acr = m.group(2).strip()
        if len(acr) >= 2 and len(full) >= 4:
            terms[acr] = full
            terms.setdefault(full, acr + " — see acronym")

    # Sentence patterns. Keep only short, plausible definitions.
    for pattern in _DEFINITION_PATTERNS:
        for m in pattern.finditer(text):
            term = re.sub(r"\s+", " ", m.group(1)).strip().rstrip(",")
            definition = re.sub(r"\s+", " ", m.group(2)).strip()
            if 2 <= len(term) <= 60 and 5 <= len(definition) <= 400:
                # First definition wins (acronym expansions take precedence).
                terms.setdefault(term, definition)

    # Drop noise: terms that look like full sentences.
    return {
        k: v
        for k, v in terms.items()
        if not k.endswith(".") and not k.lower().startswith(("the ", "a ", "an "))
    }


_HEADING_RE = re.compile(r"^([A-Z][A-Z0-9\s,.&'/-]{3,80})$", re.MULTILINE)


def extract_context(text: str, *, max_chars: int = 4000) -> str:
    """Build a narrative context blurb from a document.

    Heuristic: title (first non-empty line) + first paragraph + the list of
    section headings. Capped at ``max_chars``. The agent can read full chunks
    via the source artifact when it wants more.
    """
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    title = lines[0] if lines else ""

    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    lead = ""
    for p in paragraphs[:6]:
        if len(p) >= 80:  # skip table-of-contents-ish runs of bullets
            lead = p
            break
    if not lead and paragraphs:
        lead = paragraphs[0]

    # When the lead starts with the title (no blank line separated them in the
    # source), peel the title off so we don't render it twice.
    if title and lead.startswith(title):
        lead = lead[len(title) :].lstrip("\n ")

    headings: list[str] = []
    for m in _HEADING_RE.finditer(text):
        h = m.group(1).strip()
        if h == title or h in headings or len(h.split()) > 12:
            continue
        headings.append(h)
        if len(headings) >= 20:
            break

    parts: list[str] = []
    if title:
        parts.append(f"# {title}")
    if lead:
        parts.append(lead)
    if headings:
        parts.append("## Sections\n" + "\n".join(f"- {h}" for h in headings))
    blurb = "\n\n".join(parts)
    return blurb[:max_chars]


# ---------------------------------------------------------------------------
# glossary / context-doc merging on the workspace filesystem
# ---------------------------------------------------------------------------

GLOSSARY_HEADER = "# Glossary\n\nDomain terms and acronyms used by this user's documents. Auto-built by the\nSteinmetz PDF ingestion pipeline; user-editable. Each entry's source PDF is\nrecorded inline so you can trace a definition back to its origin.\n"
CONTEXT_HEADER = "# Company / Domain Context\n\nNarrative system context distilled from the user's uploaded sources. Auto-\nbuilt by the Steinmetz PDF ingestion pipeline; user-editable. The agent loads\nthis as system context every session.\n"


def _read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def merge_glossary(path: Path, terms: dict[str, str], source_label: str) -> None:
    existing = _read_text(path)
    if not existing.strip():
        existing = GLOSSARY_HEADER
    new_entries: list[str] = []
    for term, definition in sorted(terms.items(), key=lambda kv: kv[0].lower()):
        marker = f"### {term}"
        if marker in existing:
            continue  # don't duplicate already-known terms
        new_entries.append(f"{marker}\n\n{definition}\n\n_source: {source_label}_\n")
    if not new_entries:
        return
    body = existing.rstrip() + "\n\n" + "\n".join(new_entries)
    path.write_text(body, encoding="utf-8")


def _summary_markdown(
    artifact: dict[str, Any],
    terms: dict[str, str],
    blurb: str,
    full_text: str,
    chunk_count: int,
) -> str:
    """Inline markdown body shown on the artifact viewer page."""
    name = artifact.get("name") or artifact.get("slug") or "Source document"
    bits: list[str] = []
    blurb_stripped = blurb.strip()
    if not blurb_stripped.startswith("# "):
        bits.append(f"# {name}")
    if blurb_stripped:
        bits.append(blurb_stripped)
    if terms:
        bits.append("## Extracted glossary terms")
        bits.append(
            "\n".join(f"- **{k}** — {v}" for k, v in sorted(terms.items()))[:4000]
        )
    bits.append(
        f"\n_Indexed {chunk_count} chunks · {len(full_text)} characters._"
    )
    return "\n\n".join(bits)


def merge_context(path: Path, blurb: str, source_label: str) -> None:
    existing = _read_text(path)
    if not existing.strip():
        existing = CONTEXT_HEADER
    marker = f"## From: {source_label}"
    if marker in existing or not blurb.strip():
        return  # already absorbed
    body = existing.rstrip() + f"\n\n---\n\n{marker}\n\n{blurb}\n"
    path.write_text(body, encoding="utf-8")


# ---------------------------------------------------------------------------
# diff
# ---------------------------------------------------------------------------

def build_diff_view_spec(
    env: dict[str, str], artifact: dict[str, Any], new_text: str
) -> dict[str, Any] | None:
    """If the artifact has a parent (prior version), compute a diff view spec."""
    parent_id = artifact.get("parent_id")
    if not parent_id:
        return None
    rows = _supabase_request(env, "GET", f"artifacts?id=eq.{parent_id}&select=*")
    if not rows:
        return None
    parent = rows[0]
    parent_meta = parent.get("metadata") or {}
    before = parent_meta.get("extracted_text") or ""
    if not before:
        return None
    return {
        "renderer": "diff",
        "path": f"{artifact.get('slug') or artifact.get('name')} (v{parent_meta.get('version', 1)} → v{(artifact.get('metadata') or {}).get('version', 2)})",
        "before": before[:200_000],
        "after": new_text[:200_000],
    }


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def _insert_chunks(
    env: dict[str, str], artifact: dict[str, Any], chunks: list[dict[str, Any]]
) -> None:
    """Insert all chunks for an artifact. Deletes any prior chunks first."""
    user_id = artifact.get("user_id")
    artifact_id = artifact["id"]
    # Wipe prior chunks for this artifact (idempotent re-runs).
    try:
        _supabase_request(env, "DELETE", f"source_chunks?artifact_id=eq.{artifact_id}")
    except urllib.error.HTTPError:
        pass

    if not chunks:
        return

    BATCH = 50
    for i in range(0, len(chunks), BATCH):
        rows = [
            {
                "artifact_id": artifact_id,
                "user_id": user_id,
                "ordinal": c["ordinal"],
                "page": c.get("page"),
                "text": c["text"],
                "embedding": embed_text(c["text"]),
                "metadata": {},
            }
            for c in chunks[i : i + BATCH]
        ]
        _supabase_request(env, "POST", "source_chunks", rows)


def ingest_pdf(artifact_id: str, pdf_path: Path, workspace: Path) -> dict[str, Any]:
    env = _load_env()
    if "SUPABASE_SERVICE_ROLE_KEY" not in env:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY missing (env or .env.local)")

    artifact = _fetch_artifact(env, artifact_id)
    _set_pipeline(env, artifact, "extracting")

    full_text, per_page = extract_pdf(pdf_path)
    if not full_text.strip():
        raise RuntimeError("no extractable text in PDF (scanned image? OCR not wired)")

    _set_pipeline(env, artifact, "chunking")
    chunks = chunk_text(per_page)

    _set_pipeline(env, artifact, "embedded")
    _insert_chunks(env, artifact, chunks)

    # Glossary + context derive from the full text.
    terms = extract_glossary(full_text)
    blurb = extract_context(full_text)
    source_label = artifact.get("name") or artifact.get("slug") or artifact_id

    glossary_path = workspace / "glossary.md"
    context_path = workspace / "company-context.md"
    merge_glossary(glossary_path, terms, source_label)
    merge_context(context_path, blurb, source_label)

    # Draft candidate features (ROADMAP §4 / LOOP_QUEUE item 12). Detected
    # math blocks become draft `.py` stubs + matching `feature` artifact rows
    # the user can approve/edit/reject from /app/features.
    drafts = _draft_features_from_text(
        env=env,
        artifact=artifact,
        workspace=workspace,
        full_text=full_text,
        source_label=source_label,
    )

    # Diff view spec for re-uploads.
    view_spec_extra = build_diff_view_spec(env, artifact, full_text) or {}

    meta = dict(artifact.get("metadata") or {})
    meta.update(
        {
            "pipeline_status": "ready",
            "pages": len(per_page),
            "chunks": len(chunks),
            "characters": len(full_text),
            "extracted_at": datetime.now(timezone.utc).isoformat(),
            "extracted_text": full_text[:200_000],  # cap for sanity
            "glossary_terms_added": len(terms),
            "feature_drafts": len(drafts),
            "feature_draft_ids": [d["artifact_id"] for d in drafts],
            "embedding_dim": EMBEDDING_DIM,
            "embedding_kind": "hash-bow-v1",
        }
    )
    # Build a markdown view_spec so the universal renderer shows the artifact
    # body inline on /app/artifacts/<id>. Cap at a few KB so the page stays
    # snappy — the chunks live in `source_chunks` for full retrieval.
    base_view_spec: dict[str, Any] = {
        "renderer": "markdown",
        "text": _summary_markdown(artifact, terms, blurb, full_text, len(chunks)),
    }
    patch: dict[str, Any] = {
        "metadata": meta,
        "status": "draft",
        "view_spec": {**(artifact.get("view_spec") or {}), **base_view_spec, **view_spec_extra},
    }
    _patch_artifact(env, artifact_id, patch)

    return {
        "artifact_id": artifact_id,
        "pages": len(per_page),
        "chunks": len(chunks),
        "terms": len(terms),
        "drafts": len(drafts),
        "glossary": str(glossary_path),
        "context": str(context_path),
    }


def _draft_features_from_text(
    *,
    env: dict[str, str],
    artifact: dict[str, Any],
    workspace: Path,
    full_text: str,
    source_label: str,
) -> list[dict[str, Any]]:
    """Detect math blocks, write draft files, and insert feature artifact rows.

    Insertion uses the same service-role REST path as chunks; the artifact is
    written with ``status='draft'``, ``parent_id`` pointing back to the source
    document, and a ``code`` view_spec carrying the stub source so the
    universal renderer shows it on /app/artifacts/<id>.
    """
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from draft_features import find_candidates, write_drafts

    candidates = find_candidates(full_text)
    if not candidates:
        return []

    source_slug = artifact.get("slug") or "source"
    user_id = artifact.get("user_id")

    written = write_drafts(
        workspace=workspace,
        source_slug=source_slug,
        source_name=source_label,
        source_artifact_id=artifact["id"],
        candidates=candidates,
    )

    results: list[dict[str, Any]] = []
    for entry in written:
        try:
            code_source = Path(entry["path"]).read_text(encoding="utf-8")
        except OSError:
            code_source = ""
        row = {
            "user_id": user_id,
            "kind": "feature",
            "name": f"{entry['heading']} — draft",
            "slug": entry["slug"],
            "fs_path": entry["path"],
            "status": "draft",
            "parent_id": artifact["id"],
            "parent_session_id": artifact.get("parent_session_id"),
            "metadata": {
                "drafted_at": datetime.now(timezone.utc).isoformat(),
                "drafted_by": "ingest_pdf.draft_features",
                "source_artifact_id": artifact["id"],
                "source_label": source_label,
                "heading": entry["heading"],
                "excerpt": entry["excerpt"][:4000],
                "char_offset": entry["char_offset"],
            },
            "view_spec": {
                "renderer": "code",
                "language": "python",
                "path": f"features/{entry['slug']}.py",
                "source": code_source,
            },
        }
        try:
            created = _supabase_request(env, "POST", "artifacts", row)
            if created:
                results.append({**entry, "artifact_id": created[0].get("id")})
        except urllib.error.HTTPError as exc:
            sys.stderr.write(f"draft feature insert failed for {entry['slug']}: {exc}\n")
            continue
    return results


def _cli() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-id", required=True)
    parser.add_argument("--pdf", required=True)
    parser.add_argument("--workspace", required=True)
    args = parser.parse_args()

    try:
        result = ingest_pdf(args.artifact_id, Path(args.pdf), Path(args.workspace))
    except Exception as exc:
        try:
            env = _load_env()
            artifact = _fetch_artifact(env, args.artifact_id)
            _set_failed(env, artifact, f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}")
        except Exception:
            pass
        sys.stderr.write(f"ingest_pdf failed: {exc}\n{traceback.format_exc()}")
        return 1

    sys.stdout.write(json.dumps(result) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
