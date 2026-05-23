#!/usr/bin/env python3
"""Heuristic intake drafter: scan source-document text for concrete math and
draft candidate `features/<slug>.py` stubs the user can approve/edit/reject.

Driven by ``scripts/ingest_pdf.py`` (LOOP_QUEUE item 12 / ROADMAP §4).

A "concrete math" block is detected by combining:

* A section heading from a small vocabulary (Objective, Cost Function,
  Constraint, Formulation, Optimization Problem, Mathematical Model, ...).
* Math signals nearby: equations (``=`` with variable-like LHS), explicit
  ``minimize`` / ``maximize`` / ``subject to`` keywords, or summation/product
  symbols (sigma, prod, integral).

For each detected block we emit one draft. Each draft is a real Python file
under ``<workspace>/features/<slug>.py`` that:

* Carries the verbatim excerpt as a module docstring (so the agent can read
  the source math without re-opening the PDF).
* Exposes a public ``draft_excerpt()`` function so the per-user MCP server
  (``scripts/user-mcp-server.py``) lists it as a typed tool — drafts are
  visible to the agent the moment they're written.
* Includes a TODO block listing the zap classes that are likely relevant,
  so the agent has a starting point when the user asks it to implement.

We do NOT execute the math or guess at the implementation — drafting is
deliberately a write-only step. The Features panel (``/app/features``) lets
the user approve (→ ``status='canonical'``), reject (→ ``status='deprecated'``,
file renamed to ``_<slug>.py`` so the MCP server stops exposing it), or edit
the code in place.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


# Headings that strongly suggest a formulation block. Matched case-insensitively
# and anchored at the start of a line — fragments inside running prose don't
# count. The first capture is the original heading text we keep for the slug.
_HEADING_VOCAB = [
    "objective function",
    "objective",
    "cost function",
    "loss function",
    "constraint",
    "constraints",
    "formulation",
    "optimization problem",
    "mathematical model",
    "mathematical formulation",
    "decision variable",
    "decision variables",
    "model",
    "dispatch problem",
    "planning problem",
]

# Match a heading line: numbered (e.g. "3.2 Objective Function") or bare
# ("Objective Function"), with or without trailing colon. Limit length so we
# don't slurp paragraph leads. Anchored at line start via re.MULTILINE.
_HEADING_RE = re.compile(
    r"^[ \t]*(?:\d+(?:\.\d+)*\.?\s+)?"  # optional numbering
    r"((?:" + "|".join(re.escape(h) for h in _HEADING_VOCAB) + r"))"
    r"[ \t]*:?[ \t]*$",
    re.IGNORECASE | re.MULTILINE,
)

# Math signals — at least one must appear within the block to qualify.
_MATH_SIGNALS = [
    re.compile(r"\bminimize\b", re.IGNORECASE),
    re.compile(r"\bmaximize\b", re.IGNORECASE),
    re.compile(r"\bsubject to\b", re.IGNORECASE),
    re.compile(r"\bs\.t\.\s", re.IGNORECASE),
    re.compile(r"[∑∏∫]"),
    # Sigma / Pi / Integral as plain words with subscript (LaTeX-ish):
    # ``sum_t``, ``sum_{t,g}``, ``prod_i``, ``int_0^T``.
    re.compile(r"\b(sum|prod|max|min|int)_[a-zA-Z_\{]"),
    re.compile(r"\\sum|\\prod|\\int|\\min|\\max"),
    # Equality with at least one variable-like token nearby on either side.
    re.compile(r"[a-zA-Z_][a-zA-Z0-9_]*\s*\([^)]*\)\s*=\s*[^=\n]{3,}"),  # f(x) =
    re.compile(r"\b[a-zA-Z][a-zA-Z0-9_]{0,15}\s*=\s*[^=\n]{3,}"),         # var =
    # Leq / geq comparators next to a variable
    re.compile(r"[≤≥]|<=|>="),
]

_SLUG_RE = re.compile(r"[^a-z0-9]+")
_SLUG_SEP = "_"
_BLOCK_MAX = 2400   # chars of context to capture per draft excerpt
_BLOCK_MIN = 40     # tiny blocks are probably section stubs, skip
_MIN_SIGNALS = 1


@dataclass
class FeatureDraftCandidate:
    """One math-shaped block detected in a source document."""

    heading: str
    excerpt: str
    char_offset: int


def _slugify(s: str, max_len: int = 48) -> str:
    s = _SLUG_RE.sub(_SLUG_SEP, s.lower()).strip(_SLUG_SEP)
    return s[:max_len] or "draft"


def _block_after(text: str, start: int, end: int) -> str:
    """Return up to ``_BLOCK_MAX`` chars starting at ``end`` (after the
    heading), stopping at the next vocabulary heading if we find one first."""
    tail = text[end : end + _BLOCK_MAX]
    next_match = _HEADING_RE.search(tail)
    if next_match:
        tail = tail[: next_match.start()]
    return tail.strip()


def _has_math(block: str) -> int:
    return sum(1 for pat in _MATH_SIGNALS if pat.search(block))


def find_candidates(text: str) -> list[FeatureDraftCandidate]:
    """Scan ``text`` and return candidate math blocks.

    Conservative: a heading alone is not enough; the block following it must
    contain at least ``_MIN_SIGNALS`` math signals. This is meant to over-filter
    in ambiguous cases — false negatives are fine because the user can always
    point the agent at the source manually; false positives spam the Features
    panel with junk drafts.
    """
    candidates: list[FeatureDraftCandidate] = []
    seen_slugs: set[str] = set()
    for match in _HEADING_RE.finditer(text):
        heading = match.group(1).strip().strip(":")
        block = _block_after(text, match.start(), match.end())
        signals = _has_math(block)
        # Tiny blocks get a higher signal bar — they're prone to being
        # captions or stub sentences. Dense math overrides the size floor.
        if len(block) < _BLOCK_MIN and signals < 2:
            continue
        if signals < _MIN_SIGNALS:
            continue
        slug = _slugify(heading)
        if slug in seen_slugs:
            continue  # one draft per heading per document
        seen_slugs.add(slug)
        candidates.append(
            FeatureDraftCandidate(
                heading=heading,
                excerpt=block,
                char_offset=match.start(),
            )
        )
    return candidates


# ---------------------------------------------------------------------------
# stub file template
# ---------------------------------------------------------------------------

_TEMPLATE = '''\
"""Draft feature: {heading} (from {source_name}).

Status: draft — generated by the Steinmetz intake agent. Approve, edit, or
reject this in the Features panel ({features_panel_url}). If approved, the
status flips to ``canonical`` and the feature joins the user's working skill
set. If rejected, this file is renamed to ``_{slug}.py`` so the per-user MCP
server stops exposing it.

Source artifact id: {source_artifact_id}
Detected at character offset: {char_offset}
Excerpt:

{excerpt_quoted}
"""
from __future__ import annotations


_EXCERPT = """{excerpt_pyliteral}"""

_HEADING = {heading_pyliteral}


def draft_excerpt() -> str:
    """Return the verbatim excerpt this draft is based on.

    Exposed so the per-user MCP server lists this draft as a callable tool;
    the agent (or user) can ``draft_excerpt()`` to recall what the math says
    without re-opening the source PDF.
    """
    return _EXCERPT


def draft_heading() -> str:
    """Return the heading the intake drafter latched onto."""
    return _HEADING


# TODO: implement the math above against zap. Likely starting points:
#
# * Objectives: subclass ``zap.AbstractOperationObjective`` (or compose
#   existing objectives with ``+`` / ``*``).
# * Constraints: extend the relevant device's feasibility rules, or add a
#   new ``AbstractDevice`` subclass.
# * Custom dispatch / planning: build on ``zap.DispatchLayer`` / planning
#   problem classes.
#
# Expose at least one public function (no leading underscore) so the MCP
# server picks the implementation up; the user will invoke it by name in
# chat.
'''


def render_stub(
    *,
    candidate: FeatureDraftCandidate,
    source_name: str,
    source_artifact_id: str,
    slug: str,
    features_panel_url: str = "/app/features",
) -> str:
    """Render a Python source stub for a draft candidate."""
    excerpt_quoted = "\n".join("    " + ln for ln in candidate.excerpt.splitlines())
    # Cap the verbatim _EXCERPT string and python-literal-quote so triple
    # quotes inside the source don't blow up the template.
    excerpt_safe = candidate.excerpt[:4000].replace('"""', "''' ")
    return _TEMPLATE.format(
        heading=candidate.heading,
        source_name=source_name,
        features_panel_url=features_panel_url,
        slug=slug,
        source_artifact_id=source_artifact_id,
        char_offset=candidate.char_offset,
        excerpt_quoted=excerpt_quoted,
        excerpt_pyliteral=excerpt_safe,
        heading_pyliteral=repr(candidate.heading),
    )


def draft_slug(source_slug: str, heading: str) -> str:
    """Compose a feature slug from source + heading.

    The source slug prefix keeps drafts grouped per document so collisions
    across different PDFs don't clobber each other's files.
    """
    base = _slugify(source_slug, max_len=24)
    head = _slugify(heading, max_len=24)
    return f"{base}__{head}"[:60] if base else head


def write_drafts(
    *,
    workspace: Path,
    source_slug: str,
    source_name: str,
    source_artifact_id: str,
    candidates: list[FeatureDraftCandidate],
) -> list[dict]:
    """Write one ``features/<slug>.py`` per candidate.

    Returns a list of ``{slug, path, heading, excerpt}`` dicts so the caller
    (the ingest script) can create matching ``feature`` artifact rows.
    """
    features_dir = workspace / "features"
    features_dir.mkdir(parents=True, exist_ok=True)
    written: list[dict] = []
    for c in candidates:
        slug = draft_slug(source_slug, c.heading)
        path = features_dir / f"{slug}.py"
        # Don't clobber an existing feature with the same name; the user may
        # have hand-edited it. Re-ingest is idempotent: skip drafts whose
        # target file already exists.
        if path.exists():
            continue
        path.write_text(
            render_stub(
                candidate=c,
                source_name=source_name,
                source_artifact_id=source_artifact_id,
                slug=slug,
            ),
            encoding="utf-8",
        )
        written.append(
            {
                "slug": slug,
                "path": str(path),
                "heading": c.heading,
                "excerpt": c.excerpt,
                "char_offset": c.char_offset,
            }
        )
    return written


# ---------------------------------------------------------------------------
# tiny smoke when run directly
# ---------------------------------------------------------------------------

if __name__ == "__main__":  # pragma: no cover
    import sys

    sample = sys.stdin.read() or (
        "1. Introduction\nSome prose.\n\n"
        "2. Objective Function\nminimize sum_{t} c_g * p_g(t)\n"
        "subject to sum_g p_g(t) = D(t) for all t.\n\n"
        "3. Conclusion\nDone.\n"
    )
    cs = find_candidates(sample)
    for c in cs:
        print(f"--- {c.heading} ---")
        print(c.excerpt[:400])
        print()
