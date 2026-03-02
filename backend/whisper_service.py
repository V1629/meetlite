"""
whisper_service.py – Transcription via OpenAI Whisper API.

Uses the openai Python SDK to send audio to whisper-1.
Whisper accepts: flac, m4a, mp3, mp4, mpeg, mpga, oga, ogg, wav, webm (max 25 MB per file).

The audio arriving from the Chrome extension is audio/webm;codecs=opus which
Whisper handles natively — we just need to write it to a temp file with the
correct .webm extension so the SDK sets the right Content-Type.
"""

import os
import tempfile
from pathlib import Path
from typing import Dict, Optional
from openai import AsyncOpenAI

# Lazy-initialised client so the module can be imported even without a key set
_client: Optional[AsyncOpenAI] = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        api_key = os.getenv("OPENAI_API_KEY", "")
        if not api_key:
            raise ValueError(
                "OPENAI_API_KEY is not set. "
                "Get one at https://platform.openai.com/api-keys"
            )
        _client = AsyncOpenAI(api_key=api_key)
    return _client


# Whisper-supported extensions (the full set from the API error message)
_VALID_EXTENSIONS = {".flac", ".m4a", ".mp3", ".mp4", ".mpeg", ".mpga", ".oga", ".ogg", ".wav", ".webm"}

# Map common MIME types → file extensions Whisper accepts
_MIME_TO_EXT: Dict[str, str] = {
    "audio/webm":                 ".webm",
    "audio/webm;codecs=opus":     ".webm",
    "audio/ogg":                  ".ogg",
    "audio/ogg;codecs=opus":      ".ogg",
    "audio/mp4":                  ".mp4",
    "audio/mpeg":                 ".mp3",
    "audio/mpga":                 ".mpga",
    "audio/mp3":                  ".mp3",
    "audio/wav":                  ".wav",
    "audio/x-wav":                ".wav",
    "audio/flac":                 ".flac",
    "audio/x-flac":               ".flac",
    "audio/m4a":                  ".m4a",
    "audio/x-m4a":                ".m4a",
    "application/octet-stream":   ".webm",   # fallback for untyped uploads
}


def _ext_for_mime(mime_type: str) -> str:
    """Return the file extension Whisper needs for the given MIME type."""
    # Normalise: strip parameters after semicolon for lookup, keep full for fallback
    normalized = mime_type.strip().lower()
    base = normalized.split(";")[0].strip()
    ext = _MIME_TO_EXT.get(normalized, _MIME_TO_EXT.get(base, ".webm"))
    # Validate it's actually a Whisper-supported extension
    if ext not in _VALID_EXTENSIONS:
        ext = ".webm"
    return ext


async def transcribe_audio(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    """
    Send raw audio bytes to OpenAI Whisper (whisper-1) and return the transcript.

    Strategy:
      1. Write bytes to a named temp file with the correct extension.
         Whisper's API determines format from the filename extension.
      2. Open the file and POST it via the openai SDK.
      3. Delete the temp file regardless of success or failure.

    Raises RuntimeError on API errors.
    """
    client = _get_client()
    ext = _ext_for_mime(mime_type)

    print(f"[Whisper] mime_type={mime_type!r} → ext={ext}, audio_size={len(audio_bytes)} bytes")

    # Write to a real temp file — openai SDK needs a seekable file-like object
    # with a .name attribute that has the right extension
    tmp_path = None
    try:
        # suffix ensures the correct extension; delete=False so we control cleanup
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        # Open for reading and send to Whisper
        with open(tmp_path, "rb") as audio_file:
            response = await client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                response_format="text",   # plain string, no JSON wrapper
                language="en",            # remove this line for auto-detect
            )

        # response_format="text" returns a plain string directly
        transcript = str(response).strip()
        return transcript

    except Exception as exc:
        raise RuntimeError(f"Whisper transcription failed: {exc}") from exc

    finally:
        # Always clean up the temp file
        if tmp_path and Path(tmp_path).exists():
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
