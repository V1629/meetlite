"""
main.py – MeetLite FastAPI backend.

AI pipeline:
  Transcription → OpenAI Whisper (whisper-1)                 via whisper_service.py
  Summarization → Hugging Face (facebook/bart-large-cnn)     via gemini_service.py

Endpoints:
  GET  /api/meetings                  List all meetings (newest first)
  POST /api/meetings                  Create a new meeting session
  GET  /api/meetings/{id}             Retrieve one meeting (transcript + summary)
  PATCH /api/meetings/{id}            Update meeting title
  DELETE /api/meetings/{id}           Delete a meeting
  POST /api/transcribe-and-summarize  Full audio → Whisper → Gemini → transcript + summary
  POST /api/transcribe-chunk          (Legacy) Receive audio chunk → Whisper → append transcript
  POST /api/finalize-meeting          (Legacy) Full transcript → Gemini → structured summary
  GET  /health                        Health check
"""

import os
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.orm import Session
from dotenv import load_dotenv

import models
import database
import whisper_service
import gemini_service

load_dotenv()  # Must be called before any env-dependent code


@asynccontextmanager
async def lifespan(app: FastAPI):
    database.Base.metadata.create_all(bind=database.engine)
    yield


app = FastAPI(
    title="MeetLite API",
    version="2.1.0",
    description="Whisper transcription + Gemini summarization for Google Meet recordings.",
    lifespan=lifespan,
)

# ─── CORS ─────────────────────────────────────────────────────────────────────
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Pydantic schemas ─────────────────────────────────────────────────────────

class MeetingTitleUpdate(BaseModel):
    title: str


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "2.1.0"}


@app.get("/api/meetings")
async def list_meetings(db: Session = Depends(database.get_db)):
    """Return all meetings ordered by most recent first."""
    meetings = (
        db.query(models.Meeting)
        .order_by(models.Meeting.created_at.desc())
        .all()
    )
    return [
        {
            "meeting_id":     m.id,
            "title":          m.title,
            "created_at":     m.created_at.isoformat(),
            "has_transcript": bool(m.transcript and m.transcript.strip()),
            "has_summary":    bool(m.summary and m.summary.strip()),
            # Short preview of transcript for the list card
            "preview":        (m.transcript or "")[:160].strip(),
        }
        for m in meetings
    ]


@app.post("/api/meetings")
async def create_meeting(
    request: Request,
    db: Session = Depends(database.get_db),
):
    """Create a new Meeting record and return its UUID.
    Accepts: empty body, form data with 'title', or JSON with 'title'.
    """
    title = "Untitled Meeting"
    content_type = request.headers.get("content-type", "")

    try:
        if "multipart/form-data" in content_type or "application/x-www-form-urlencoded" in content_type:
            form = await request.form()
            title = form.get("title", title) or title
        elif "application/json" in content_type:
            body = await request.json()
            title = body.get("title", title) or title
    except Exception:
        pass  # Use default title on parse failures

    meeting = models.Meeting(
        id=str(uuid.uuid4()),
        title=str(title).strip() or "Untitled Meeting",
        transcript="",
        summary=None,
    )
    db.add(meeting)
    db.commit()
    db.refresh(meeting)
    return {
        "meeting_id": meeting.id,
        "title":      meeting.title,
        "created_at": meeting.created_at.isoformat(),
    }


@app.get("/api/meetings/{meeting_id}")
async def get_meeting(meeting_id: str, db: Session = Depends(database.get_db)):
    """Retrieve a full meeting record by ID."""
    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    return {
        "meeting_id":  meeting.id,
        "title":       meeting.title,
        "created_at":  meeting.created_at.isoformat(),
        "transcript":  meeting.transcript,
        "summary":     meeting.summary,
    }


@app.patch("/api/meetings/{meeting_id}")
async def update_meeting_title(
    meeting_id: str,
    body: MeetingTitleUpdate,
    db: Session = Depends(database.get_db),
):
    """Update the title of a meeting."""
    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    meeting.title = body.title.strip() or "Untitled Meeting"
    db.commit()
    db.refresh(meeting)
    return {"meeting_id": meeting.id, "title": meeting.title}


@app.delete("/api/meetings/{meeting_id}")
async def delete_meeting(meeting_id: str, db: Session = Depends(database.get_db)):
    """Permanently delete a meeting and all its data."""
    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    db.delete(meeting)
    db.commit()
    return {"deleted": True, "meeting_id": meeting_id}


@app.post("/api/transcribe-chunk")
async def transcribe_chunk(
    audio: UploadFile = File(...),
    meeting_id: str   = Form(...),
    db: Session       = Depends(database.get_db),
):
    """Receive a 60-second audio chunk, transcribe with Whisper, append to transcript."""
    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail=f"Meeting '{meeting_id}' not found.")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file received.")

    mime_type = (audio.content_type or "audio/webm").strip()

    try:
        chunk_transcript = await whisper_service.transcribe_audio(audio_bytes, mime_type)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Whisper transcription error: {exc}")

    if not chunk_transcript.strip():
        return {
            "meeting_id":       meeting_id,
            "chunk_transcript": "",
            "full_transcript":  meeting.transcript,
        }

    separator = "\n" if meeting.transcript else ""
    meeting.transcript = meeting.transcript + separator + chunk_transcript
    db.commit()
    db.refresh(meeting)

    return {
        "meeting_id":       meeting_id,
        "chunk_transcript": chunk_transcript,
        "full_transcript":  meeting.transcript,
    }


@app.post("/api/finalize-meeting")
async def finalize_meeting(
    meeting_id: str = Form(...),
    db: Session     = Depends(database.get_db),
):
    """Generate Gemini summary for the full transcript. Idempotent."""
    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail=f"Meeting '{meeting_id}' not found.")

    if meeting.summary:
        return {
            "meeting_id":      meeting_id,
            "summary":         meeting.summary,
            "full_transcript": meeting.transcript,
        }

    try:
        summary = await gemini_service.summarize_transcript(meeting.transcript)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini summarization error: {exc}")

    meeting.summary = summary
    db.commit()
    db.refresh(meeting)

    return {
        "meeting_id":      meeting_id,
        "summary":         meeting.summary,
        "full_transcript": meeting.transcript,
    }


# ─── Full-recording endpoint (replaces chunk workflow) ────────────────────────

WHISPER_MAX_BYTES = 24 * 1024 * 1024   # ~24 MB to stay safely under 25 MB limit


@app.post("/api/transcribe-and-summarize")
async def transcribe_and_summarize(
    audio: UploadFile = File(...),
    meeting_id: str   = Form(...),
    db: Session       = Depends(database.get_db),
):
    """
    Receive the FULL recording as a single audio file.
    1. If size ≤ 24 MB → transcribe in one shot.
    2. If size > 24 MB → split into ~24 MB segments, transcribe each, concatenate.
    3. Summarise the full transcript with Gemini.
    4. Save both to the meeting record.
    """
    meeting = db.query(models.Meeting).filter(models.Meeting.id == meeting_id).first()
    if not meeting:
        raise HTTPException(status_code=404, detail=f"Meeting '{meeting_id}' not found.")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file received.")

    # Determine MIME type: prefer the upload content_type, fall back to
    # guessing from filename, and ultimately default to audio/webm
    mime_type = (audio.content_type or "").strip()
    if not mime_type or mime_type == "application/octet-stream":
        fname = (audio.filename or "").lower()
        if fname.endswith(".webm"):
            mime_type = "audio/webm"
        elif fname.endswith(".ogg") or fname.endswith(".oga"):
            mime_type = "audio/ogg"
        elif fname.endswith(".mp4") or fname.endswith(".m4a"):
            mime_type = "audio/mp4"
        elif fname.endswith(".mp3"):
            mime_type = "audio/mpeg"
        elif fname.endswith(".wav"):
            mime_type = "audio/wav"
        else:
            mime_type = "audio/webm"   # safe default for Chrome MediaRecorder

    print(f"[transcribe-and-summarize] file={audio.filename}, content_type={audio.content_type}, resolved_mime={mime_type}, size={len(audio_bytes)}")

    # ── Transcription (split if necessary) ────────────────────────────────
    try:
        if len(audio_bytes) <= WHISPER_MAX_BYTES:
            transcript = await whisper_service.transcribe_audio(audio_bytes, mime_type)
        else:
            # Split into roughly equal segments ≤ WHISPER_MAX_BYTES
            segments = []
            offset = 0
            while offset < len(audio_bytes):
                end = min(offset + WHISPER_MAX_BYTES, len(audio_bytes))
                segments.append(audio_bytes[offset:end])
                offset = end

            parts = []
            for i, seg in enumerate(segments):
                part = await whisper_service.transcribe_audio(seg, mime_type)
                if part.strip():
                    parts.append(part.strip())
            transcript = "\n".join(parts)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Whisper transcription error: {exc}")

    if not transcript.strip():
        meeting.transcript = ""
        db.commit()
        return {
            "meeting_id":  meeting_id,
            "transcript":  "",
            "summary":     None,
        }

    meeting.transcript = transcript

    # ── Summarization ─────────────────────────────────────────────────────
    try:
        summary = await gemini_service.summarize_transcript(transcript)
    except Exception as exc:
        # Save transcript even if summarization fails
        db.commit()
        raise HTTPException(status_code=502, detail=f"Gemini summarization error: {exc}")

    meeting.summary = summary
    db.commit()
    db.refresh(meeting)

    return {
        "meeting_id": meeting_id,
        "transcript": meeting.transcript,
        "summary":    meeting.summary,
    }


# ─── Entry point ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
