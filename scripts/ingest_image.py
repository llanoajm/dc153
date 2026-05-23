#!/usr/bin/env python3
"""Image ingestion: caption via vision model, write a markdown view spec.

ROADMAP §1 / LOOP_QUEUE item 13. Counterpart to ``ingest_pdf.py`` and
``ingest_pptx.py`` for standalone images (PNG/JPEG/GIF/WEBP/SVG). One image
per artifact → one chunk → one caption.

Pipeline: ``queued → extracting → embedded → ready``. We skip the chunking
step (there's only one chunk for a single image) but still surface a
``pipeline_status`` so the Sources panel renders the same transitions.
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _caption import caption_image  # noqa: E402
from ingest_pdf import (  # noqa: E402
    EMBEDDING_DIM,
    _fetch_artifact,
    _load_env,
    _patch_artifact,
    _set_failed,
    _set_pipeline,
    _supabase_request,
    embed_text,
    extract_glossary,
    merge_glossary,
)


def _image_dimensions(path: Path) -> tuple[int, int] | None:
    try:
        from PIL import Image  # type: ignore

        with Image.open(path) as im:
            return im.size
    except Exception:
        return None


def ingest_image(artifact_id: str, image_path: Path, workspace: Path) -> dict[str, Any]:
    env = _load_env()
    if "SUPABASE_SERVICE_ROLE_KEY" not in env:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY missing (env or .env.local)")

    artifact = _fetch_artifact(env, artifact_id)
    _set_pipeline(env, artifact, "extracting")

    caption = caption_image(image_path)
    dims = _image_dimensions(image_path)

    _set_pipeline(env, artifact, "embedded")
    # Single chunk so the source_chunks table still has lineage for the image.
    try:
        _supabase_request(env, "DELETE", f"source_chunks?artifact_id=eq.{artifact_id}")
    except Exception:
        pass
    _supabase_request(
        env,
        "POST",
        "source_chunks",
        [
            {
                "artifact_id": artifact_id,
                "user_id": artifact.get("user_id"),
                "ordinal": 0,
                "page": None,
                "text": caption,
                "embedding": embed_text(caption),
                "metadata": {"kind": "image_caption"},
            }
        ],
    )

    terms = extract_glossary(caption)
    merge_glossary(
        workspace / "glossary.md",
        terms,
        artifact.get("name") or artifact.get("slug") or artifact_id,
    )

    width, height = dims if dims else (None, None)
    relative = image_path.name
    summary_bits = [
        f"# {artifact.get('name') or relative}",
        caption,
    ]
    if dims:
        summary_bits.append(f"_Image dimensions: {width}×{height}._")
    summary = "\n\n".join(summary_bits)

    meta = dict(artifact.get("metadata") or {})
    meta.update(
        {
            "pipeline_status": "ready",
            "caption": caption,
            "width": width,
            "height": height,
            "characters": len(caption),
            "extracted_at": datetime.now(timezone.utc).isoformat(),
            "extracted_text": caption[:200_000],
            "glossary_terms_added": len(terms),
            "embedding_dim": EMBEDDING_DIM,
            "embedding_kind": "hash-bow-v1",
        }
    )
    _patch_artifact(
        env,
        artifact_id,
        {
            "status": "draft",
            "metadata": meta,
            "view_spec": {
                **(artifact.get("view_spec") or {}),
                "renderer": "markdown",
                "text": summary,
            },
        },
    )
    return {
        "artifact_id": artifact_id,
        "caption_chars": len(caption),
        "width": width,
        "height": height,
        "terms": len(terms),
    }


def _cli() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--artifact-id", required=True)
    p.add_argument("--image", required=True)
    p.add_argument("--workspace", required=True)
    args = p.parse_args()
    try:
        result = ingest_image(args.artifact_id, Path(args.image), Path(args.workspace))
    except Exception as exc:
        try:
            env = _load_env()
            artifact = _fetch_artifact(env, args.artifact_id)
            _set_failed(env, artifact, f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}")
        except Exception:
            pass
        sys.stderr.write(f"ingest_image failed: {exc}\n{traceback.format_exc()}")
        return 1
    sys.stdout.write(json.dumps(result) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
