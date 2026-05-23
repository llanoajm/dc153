"""Shared vision / audio captioning helpers for the multi-modal ingestion
scripts (ROADMAP §1, LOOP_QUEUE item 13).

Both ``caption_image`` and ``transcribe_audio`` try a real model via the
OpenRouter HTTP API when ``OPENROUTER_API_KEY`` is available, and fall back to
a deterministic, dependency-light placeholder when it is not. The fallback
keeps the ingestion pipeline working end-to-end even on a fresh checkout
without a key — the artifact just carries a "[caption unavailable]"-style
string instead of a real description.

Used by ``ingest_pptx.py``, ``ingest_image.py``, ``ingest_audio.py``.
"""
from __future__ import annotations

import base64
import json
import mimetypes
import os
import urllib.error
import urllib.request
import wave
from pathlib import Path

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
VISION_MODEL = os.environ.get("STEINMETZ_VISION_MODEL", "anthropic/claude-sonnet-4")
AUDIO_MODEL = os.environ.get("STEINMETZ_AUDIO_MODEL", "google/gemini-2.0-flash-001")


def _openrouter_key() -> str | None:
    key = os.environ.get("OPENROUTER_API_KEY")
    if key:
        return key
    env_local = Path(__file__).resolve().parent.parent / ".env.local"
    if env_local.exists():
        for line in env_local.read_text().splitlines():
            line = line.strip()
            if line.startswith("OPENROUTER_API_KEY="):
                value = line.split("=", 1)[1].strip().strip('"').strip("'")
                if value:
                    return value
    return None


def _openrouter_chat(model: str, messages: list[dict], *, max_tokens: int = 512) -> str | None:
    key = _openrouter_key()
    if not key:
        return None
    body = json.dumps(
        {
            "model": model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": 0.2,
        }
    ).encode()
    req = urllib.request.Request(
        OPENROUTER_URL,
        method="POST",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://steinmetz.local",
            "X-Title": "Steinmetz ingestion",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    try:
        return payload["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, TypeError, AttributeError):
        return None


def _data_url(path: Path) -> str:
    mime, _ = mimetypes.guess_type(str(path))
    if mime is None:
        mime = "application/octet-stream"
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"


def _image_fallback(path: Path) -> str:
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        return f"[caption unavailable] Image file {path.name}"
    try:
        with Image.open(path) as im:
            w, h = im.size
            mode = im.mode
            fmt = im.format or path.suffix.lstrip(".").upper()
            try:
                small = im.convert("RGB").resize((4, 4))
                pixels = list(small.getdata())
                avg = tuple(sum(c[i] for c in pixels) // len(pixels) for i in range(3))
                color = f"#{avg[0]:02x}{avg[1]:02x}{avg[2]:02x}"
            except Exception:
                color = ""
    except Exception as exc:
        return f"[caption unavailable] {path.name}: {exc}"
    bits = [f"Image: {fmt} {w}×{h}, mode {mode}"]
    if color:
        bits.append(f"mean color {color}")
    bits.append("[no vision model configured — set OPENROUTER_API_KEY for real captions]")
    return ". ".join(bits) + "."


def caption_image(path: Path, *, context: str = "") -> str:
    """Return a textual caption for an image file.

    When ``OPENROUTER_API_KEY`` is present, calls a vision model on OpenRouter.
    Otherwise returns a deterministic placeholder string describing the
    image's pixel dimensions + mean color.

    ``context`` is included in the prompt so callers can disambiguate (e.g.,
    "this is slide 3 of a PowerPoint deck about transmission planning").
    """
    if not path.exists():
        return f"[caption unavailable] missing file: {path}"
    try:
        prompt_text = (
            "Describe this image in 2-3 sentences. Focus on technical content "
            "(diagrams, charts, equations, network topology, geographic features) "
            "if present. If the image is decorative, say so briefly."
        )
        if context:
            prompt_text = f"{context}\n\n{prompt_text}"
        result = _openrouter_chat(
            VISION_MODEL,
            [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt_text},
                        {"type": "image_url", "image_url": {"url": _data_url(path)}},
                    ],
                }
            ],
        )
        if result:
            return result
    except Exception:
        pass
    return _image_fallback(path)


def _audio_fallback(path: Path) -> tuple[str, list[dict]]:
    suffix = path.suffix.lower()
    if suffix in (".wav", ".wave"):
        try:
            with wave.open(str(path), "rb") as w:
                frames = w.getnframes()
                rate = w.getframerate()
                channels = w.getnchannels()
                seconds = frames / float(rate) if rate else 0.0
            return (
                f"[transcript unavailable — no audio model configured] "
                f"WAV {channels}ch @ {rate} Hz, {seconds:.1f}s.",
                [],
            )
        except wave.Error:
            pass
    size_kb = path.stat().st_size / 1024 if path.exists() else 0
    return (
        f"[transcript unavailable — no audio model configured] {path.name} ({size_kb:.0f} KB)",
        [],
    )


def transcribe_audio(path: Path) -> tuple[str, list[dict]]:
    """Return ``(transcript, turns)`` for an audio file.

    ``turns`` is a (possibly empty) list of ``{speaker, start, end, text}``
    dicts. The fallback returns no turns and a placeholder transcript that
    explains why.
    """
    if not path.exists():
        return f"[transcript unavailable] missing file: {path}", []
    try:
        prompt = (
            "Transcribe the audio as plain text. If multiple speakers are "
            "audible, prefix each turn with `Speaker N:` on its own line. "
            "Do not summarize — produce a verbatim transcript."
        )
        result = _openrouter_chat(
            AUDIO_MODEL,
            [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "input_audio", "input_audio": {"data": base64.b64encode(path.read_bytes()).decode("ascii"), "format": path.suffix.lstrip(".") or "mp3"}},
                    ],
                }
            ],
            max_tokens=4096,
        )
        if result:
            return result, _parse_speaker_turns(result)
    except Exception:
        pass
    return _audio_fallback(path)


def _parse_speaker_turns(text: str) -> list[dict]:
    """Cheap split: lines starting with ``Speaker N:`` become turn boundaries."""
    turns: list[dict] = []
    current_speaker: str | None = None
    buf: list[str] = []
    import re

    def flush() -> None:
        if current_speaker and buf:
            turns.append({"speaker": current_speaker, "text": "\n".join(buf).strip()})

    for line in text.splitlines():
        m = re.match(r"^(Speaker\s+\d+|[A-Z][a-z]{1,15}):\s*(.*)$", line)
        if m:
            flush()
            current_speaker = m.group(1)
            buf = [m.group(2)] if m.group(2) else []
        elif current_speaker:
            buf.append(line)
    flush()
    return turns
