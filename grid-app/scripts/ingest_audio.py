#!/usr/bin/env python3
"""Audio ingestion: transcribe via a multimodal model and surface turns.

ROADMAP §1 / LOOP_QUEUE item 13. Same artifact lifecycle as the PDF/PPTX/image
ingestors — but for ``.mp3 / .m4a / .wav / .ogg / .flac`` uploads. Without an
``OPENROUTER_API_KEY`` the transcription falls back to a placeholder string
that explains the missing dependency (see ``_caption.transcribe_audio``).

Each speaker turn becomes its own ``source_chunks`` row so retrieval can hit
"the bit where Speaker 2 mentioned the WECC interconnection". If the model
returned plain text with no detectable turn structure, the whole transcript
becomes one chunk.
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

from _caption import transcribe_audio  # noqa: E402
from ingest_pdf import (  # noqa: E402
    EMBEDDING_DIM,
    _fetch_artifact,
    _load_env,
    _patch_artifact,
    _set_failed,
    _set_pipeline,
    _supabase_request,
    embed_text,
    extract_context,
    extract_glossary,
    merge_context,
    merge_glossary,
)


def _build_chunks(transcript: str, turns: list[dict]) -> list[dict[str, Any]]:
    if turns:
        return [
            {
                "ordinal": i,
                "page": None,
                "text": (t.get("text") or "").strip(),
                "metadata": {"speaker": t.get("speaker"), "kind": "audio_turn"},
            }
            for i, t in enumerate(turns)
            if (t.get("text") or "").strip()
        ]
    transcript = transcript.strip()
    if not transcript:
        return []
    return [{"ordinal": 0, "page": None, "text": transcript, "metadata": {"kind": "audio_transcript"}}]


def _insert_chunks(env, artifact, chunks):
    try:
        _supabase_request(env, "DELETE", f"source_chunks?artifact_id=eq.{artifact['id']}")
    except Exception:
        pass
    if not chunks:
        return
    BATCH = 50
    user_id = artifact.get("user_id")
    for i in range(0, len(chunks), BATCH):
        rows = [
            {
                "artifact_id": artifact["id"],
                "user_id": user_id,
                "ordinal": c["ordinal"],
                "page": c.get("page"),
                "text": c["text"],
                "embedding": embed_text(c["text"]),
                "metadata": c.get("metadata", {}),
            }
            for c in chunks[i : i + BATCH]
        ]
        _supabase_request(env, "POST", "source_chunks", rows)


def _summary_markdown(artifact: dict[str, Any], transcript: str, turns: list[dict]) -> str:
    name = artifact.get("name") or artifact.get("slug") or "Audio recording"
    bits: list[str] = [f"# {name}"]
    if turns:
        bits.append("## Transcript")
        for t in turns:
            sp = t.get("speaker") or "Unknown"
            bits.append(f"**{sp}.** {(t.get('text') or '').strip()}")
    else:
        bits.append("## Transcript")
        bits.append(transcript)
    return "\n\n".join(bits)


def ingest_audio(artifact_id: str, audio_path: Path, workspace: Path) -> dict[str, Any]:
    env = _load_env()
    if "SUPABASE_SERVICE_ROLE_KEY" not in env:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY missing (env or .env.local)")

    artifact = _fetch_artifact(env, artifact_id)
    _set_pipeline(env, artifact, "extracting")

    transcript, turns = transcribe_audio(audio_path)
    if not transcript.strip():
        raise RuntimeError("empty transcript")

    _set_pipeline(env, artifact, "chunking")
    chunks = _build_chunks(transcript, turns)

    _set_pipeline(env, artifact, "embedded")
    _insert_chunks(env, artifact, chunks)

    terms = extract_glossary(transcript)
    blurb = extract_context(transcript)
    source_label = artifact.get("name") or artifact.get("slug") or artifact_id
    merge_glossary(workspace / "glossary.md", terms, source_label)
    merge_context(workspace / "company-context.md", blurb, source_label)

    meta = dict(artifact.get("metadata") or {})
    meta.update(
        {
            "pipeline_status": "ready",
            "transcript_characters": len(transcript),
            "turns": len(turns),
            "speakers": sorted({(t.get("speaker") or "Unknown") for t in turns}),
            "chunks": len(chunks),
            "extracted_at": datetime.now(timezone.utc).isoformat(),
            "extracted_text": transcript[:200_000],
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
                "text": _summary_markdown(artifact, transcript, turns),
            },
        },
    )
    return {
        "artifact_id": artifact_id,
        "transcript_characters": len(transcript),
        "turns": len(turns),
        "chunks": len(chunks),
    }


def _cli() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--artifact-id", required=True)
    p.add_argument("--audio", required=True)
    p.add_argument("--workspace", required=True)
    args = p.parse_args()
    try:
        result = ingest_audio(args.artifact_id, Path(args.audio), Path(args.workspace))
    except Exception as exc:
        try:
            env = _load_env()
            artifact = _fetch_artifact(env, args.artifact_id)
            _set_failed(env, artifact, f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}")
        except Exception:
            pass
        sys.stderr.write(f"ingest_audio failed: {exc}\n{traceback.format_exc()}")
        return 1
    sys.stdout.write(json.dumps(result) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(_cli())
