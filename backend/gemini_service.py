"""
gemini_service.py – Meeting summarization via Hugging Face Inference API.

This module is ONLY responsible for summarization.
Transcription is handled by whisper_service.py (OpenAI Whisper).

Uses the huggingface_hub InferenceClient with distilbart-cnn-12-6 (fast, reliable).
Requires the HF_TOKEN environment variable to be set.
"""

import os
import time
from huggingface_hub import InferenceClient


def _get_hf_client() -> InferenceClient:
    """Return an InferenceClient configured with the HF_TOKEN env var."""
    token = os.environ.get("HF_TOKEN", "")
    if not token:
        raise ValueError(
            "HF_TOKEN is not set. "
            "Get one at https://huggingface.co/settings/tokens"
        )
    return InferenceClient(
        provider="hf-inference",
        api_key=token,
    )


# distilbart is 3x faster than bart-large-cnn and rarely times out
_HF_MODEL = "sshleifer/distilbart-cnn-12-6"

# Smaller chunks to stay within token limits and reduce timeouts
_MAX_CHARS_PER_CHUNK = 2500

# Retry config for transient failures (502/503/504)
_MAX_RETRIES = 3
_RETRY_DELAY = 5  # seconds


async def summarize_transcript(transcript: str) -> str:
    """
    Send the full meeting transcript to Hugging Face (distilbart-cnn-12-6)
    and return a summary.

    Long transcripts are split into chunks, each summarized individually,
    then the chunk summaries are concatenated.

    Returns a placeholder string if the transcript is empty.
    Raises RuntimeError on API failure.
    """
    if not transcript.strip():
        return "No transcript content available to summarize."

    client = _get_hf_client()

    chunks = _split_text(transcript, _MAX_CHARS_PER_CHUNK)

    summaries = []
    for chunk in chunks:
        summary = _summarize_with_retry(client, chunk)
        summaries.append(summary)

    return "\n\n".join(summaries).strip()


def _summarize_with_retry(client: InferenceClient, text: str) -> str:
    """Call the summarization API with retries on transient errors."""
    last_error = None
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            result = client.summarization(
                text,
                model=_HF_MODEL,
            )
            return result.summary_text
        except Exception as exc:
            last_error = exc
            error_str = str(exc)
            # Retry on gateway errors (model cold start)
            if any(code in error_str for code in ("502", "503", "504")):
                print(f"[HF] Attempt {attempt}/{_MAX_RETRIES} failed ({error_str[:80]}), retrying in {_RETRY_DELAY}s...")
                time.sleep(_RETRY_DELAY)
                continue
            # Non-retryable error
            raise RuntimeError(
                f"Hugging Face summarization failed: {exc}"
            ) from exc

    raise RuntimeError(
        f"Hugging Face summarization failed after {_MAX_RETRIES} retries: {last_error}"
    )


def _split_text(text: str, max_chars: int) -> list[str]:
    """Split text into chunks of roughly *max_chars* characters."""
    words = text.split()
    chunks: list[str] = []
    current_chunk: list[str] = []
    current_len = 0

    for word in words:
        if current_len + len(word) + 1 > max_chars and current_chunk:
            chunks.append(" ".join(current_chunk))
            current_chunk = []
            current_len = 0
        current_chunk.append(word)
        current_len += len(word) + 1

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks if chunks else [text]
