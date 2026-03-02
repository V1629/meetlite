# MeetLite – AI Meeting Transcriber & Summarizer

MeetLite is a Chrome extension + FastAPI backend that records your Google Meet,
transcribes all participants with **OpenAI Whisper**, and generates a structured
summary with **Google Gemini** — no third-party meeting bots required.

---

## AI Pipeline

```
Audio chunks (60s each)
        │
        ▼
  OpenAI Whisper (whisper-1)
  → Accurate speech-to-text
  → Appended to transcript in DB
        │
        ▼  (on meeting end)
  Google Gemini (gemini-1.5-flash)
  → Reads full transcript
  → Returns structured summary:
      ## Key Points
      ## Decisions
      ## Action Items
```

---

## Architecture

```
[Google Meet Tab]
      │  chrome.tabCapture (all participants)
      ▼
[popup.js] ──getMediaStreamId()──▶ [background.js]
                                         │
                                   [offscreen.js]
                                   MediaRecorder
                                   60s chunks
                                         │
                              POST /api/transcribe-chunk
                                         ▼
                              [FastAPI Backend]
                              whisper_service.py
                                  OpenAI Whisper API
                              → transcript chunk stored in SQLite
                                         │
                              POST /api/finalize-meeting
                                         ▼
                              [FastAPI Backend]
                              gemini_service.py
                                  Google Gemini API
                              → structured summary stored in SQLite
                                         │
                              STATE_UPDATE → popup.js
                              Shows transcript + summary side by side
```

---

## Project Structure

```
meetlite/
├── backend/
│   ├── main.py               ← FastAPI app, all route handlers
│   ├── whisper_service.py    ← OpenAI Whisper transcription
│   ├── gemini_service.py     ← Google Gemini summarization
│   ├── models.py             ← SQLAlchemy Meeting model
│   ├── database.py           ← SQLite engine & session
│   ├── requirements.txt      ← Python dependencies
│   └── .env.example          ← Environment variable template
│
├── extension/
│   ├── manifest.json         ← MV3 extension config + permissions
│   ├── background.js         ← Service worker: orchestration
│   ├── offscreen.html        ← Hidden DOM context for MediaRecorder
│   ├── offscreen.js          ← Tab audio capture + chunking
│   ├── popup.html            ← Extension popup UI (HTML + CSS)
│   ├── popup.js              ← Popup render + user interactions
│   ├── content.js            ← Status badge inside Meet UI
│   ├── icons/                ← Extension icons (16, 48, 128px)
│   └── README.md             ← Extension-specific setup guide
│
└── README.md                 ← This file
```

---

## Getting API Keys

### OpenAI API Key (for Whisper transcription)
1. Go to https://platform.openai.com/api-keys
2. Click **+ Create new secret key**
3. Copy the key — starts with `sk-`

**Cost**: Whisper costs $0.006 per minute of audio (~$0.36/hr of meeting)

### Google Gemini API Key (for summarization)
1. Go to https://aistudio.google.com/app/apikey
2. Click **Create API Key**
3. Copy the key

**Cost**: Gemini 1.5 Flash has a generous free tier (15 RPM, 1M tokens/day free)

---

## Setup & Running Locally

### 1. Backend

```bash
cd meetlite/backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Open .env and set:
#   OPENAI_API_KEY=sk-...
#   GEMINI_API_KEY=...

# Start the server
uvicorn main:app --reload --port 8000
```

API runs at: http://localhost:8000
Interactive docs: http://localhost:8000/docs

### 2. Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select the `meetlite/extension/` folder
5. Pin the MeetLite icon to your toolbar

---

## Using MeetLite in a Meeting

1. Start the backend (`uvicorn main:app --port 8000`)
2. Join your Google Meet
3. Click the **MeetLite** icon in Chrome toolbar
4. Click **Start Recording** — Chrome will confirm tab audio capture
5. A `● MeetLite: Recording` badge appears inside the Meet page
6. Transcript chunks appear in the popup every **60 seconds**
7. When the meeting ends, click **Stop Recording**
8. After ~10–20 seconds: full transcript + structured AI summary appears
9. Use **Copy Transcript** or **Copy Summary** to save results

---

## Known Limitations

- **Requires backend running locally** — no cloud version included out of the box
- **Microphone only if using the frontend (Next.js)** — the Chrome extension captures all participants
- **Whisper 25MB file limit** — 60-second webm chunks are typically 1–3 MB, well within limits
- **English language default** — change `language="en"` in `whisper_service.py` to another language code, or remove it for auto-detection
- **Summary only generated once** — re-summarization not supported in this MVP

---

## Deploying the Backend

### Railway / Render
1. Push `backend/` to GitHub
2. Connect to Railway or Render
3. Set environment variables: `OPENAI_API_KEY`, `GEMINI_API_KEY`
4. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Update `API_BASE` in `extension/background.js` to your deployed URL

### Docker
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `OPENAI_API_KEY is not set` | Check your `.env` file exists and has the key |
| `Whisper transcription failed` | Check your OpenAI account has credits |
| `Gemini summarization failed` | Verify GEMINI_API_KEY is valid |
| Transcript is empty | Meeting may have been silent; check backend logs |
| Extension not capturing audio | Make sure you're on `meet.google.com` and it's the active tab |
| `Only a single offscreen document` error | Reload the extension at `chrome://extensions` |
