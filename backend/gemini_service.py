"""
gemini_service.py – Meeting summarization via Hugging Face Inference API.

This module is ONLY responsible for summarization.
Transcription is handled by whisper_service.py (OpenAI Whisper).

Uses the huggingface_hub InferenceClient with the facebook/bart-large-cnn model.
Requires the HF_TOKEN environment variable to be set.
"""

import os
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


_HF_MODEL = "facebook/bart-large-cnn"

# BART-large-CNN has a 1024-token input limit.  We chunk long transcripts
# and concatenate the per-chunk summaries.
_MAX_CHARS_PER_CHUNK = 3000


async def summarize_transcript(transcript: str) -> str:
    """
    Send the full meeting transcript to Hugging Face (BART-large-CNN)
    and return a summary.

    Long transcripts are split into chunks, each summarized individually,
    then the chunk summaries are concatenated.

    Returns a placeholder string if the transcript is empty.
    Raises RuntimeError on API failure.
    """
    if not transcript.strip():
        return "No transcript content available to summarize."

    client = _get_hf_client()

    # Split into chunks if the transcript is very long
    chunks = _split_text(transcript, _MAX_CHARS_PER_CHUNK)

    try:
        summaries = []
        for chunk in chunks:
            result = client.summarization(
                chunk,
                model=_HF_MODEL,
            )
            summaries.append(result.summary_text)

        return "\n\n".join(summaries).strip()

    except Exception as exc:
        raise RuntimeError(
            f"Hugging Face summarization failed: {exc}"
        ) from exc


def _split_text(text: str, max_chars: int) -> list[str]:
    """Split text into chunks of roughly *max_chars* characters on sentence boundaries."""
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

    return summary
