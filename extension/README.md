# MeetLite Chrome Extension

Captures **all participants' audio** from your Google Meet tab using `chrome.tabCapture`,
transcribes it live with **OpenAI Whisper**, and shows a structured **Gemini AI summary** when you stop.

---

## How to install (Developer Mode)

1. Open Chrome and go to: `chrome://extensions`
2. Enable **Developer mode** (toggle, top right)
3. Click **Load unpacked**
4. Select the `meetlite/extension/` folder
5. The MeetLite icon (green circle) appears in your toolbar

---

## How to use

1. Start your FastAPI backend first (see main README)
2. Join a Google Meet
3. Click the MeetLite extension icon in the Chrome toolbar
4. Click **Start Recording**
5. Allow the tab capture permission prompt if it appears
6. The popup shows live transcript every 60 seconds
7. A `● MeetLite: Recording` badge appears inside the Meet UI
8. When your meeting ends, click **Stop Recording**
9. The popup shows the full transcript + AI summary with:
   - Key Points
   - Decisions
   - Action Items
10. Use **Copy Transcript** or **Copy Summary** to save results

---

## File structure

```
extension/
├── manifest.json      ← Extension config, permissions
├── background.js      ← Service worker: orchestrates everything
├── offscreen.html     ← Hidden DOM page for MediaRecorder
├── offscreen.js       ← MediaRecorder logic (tab audio capture)
├── content.js         ← Status badge injected into Meet page
├── popup.html         ← Extension popup UI (HTML + CSS)
├── popup.js           ← Popup render logic + user actions
├── config.js          ← API_BASE and CHUNK_INTERVAL_MS
└── icons/             ← Extension icons (16, 48, 128px)
```

---

## Architecture

```
[Google Meet Tab]
      │
      │ chrome.tabCapture.getMediaStreamId()
      ▼
[background.js]  ──── MediaStream ID ────▶  [offscreen.js]
      │                                           │
      │                                     MediaRecorder
      │                                     (60s chunks)
      │          ArrayBuffer (audio blob)         │
      │◀──────────────────────────────────────────┘
      │
      │  POST /api/transcribe-chunk (FormData)
      ▼
[FastAPI Backend]  ──▶  Gemini AI  ──▶  transcript text
      │
      │  transcript appended to DB
      │
      │  POST /api/finalize-meeting
      ▼
[FastAPI Backend]  ──▶  Gemini AI  ──▶  structured summary
      │
      ▼
[popup.js] ◀── STATE_UPDATE messages ── [background.js]
```

---

## Why this captures all participants

The standard `getUserMedia({audio: true})` only captures your microphone.

This extension uses `chrome.tabCapture.getMediaStreamId()` which captures the
**entire audio output** of the Google Meet browser tab — meaning every participant's
voice that Meet plays through your speakers is included in the recording.

The stream ID is passed to the offscreen document where `getUserMedia` is called with:
```js
audio: {
  mandatory: {
    chromeMediaSource: 'tab',
    chromeMediaSourceId: streamId,
  }
}
```
This is the correct, official Chrome API for capturing tab audio.

---

## Changing the backend URL

Edit `config.js`:
```js
const CONFIG = {
  API_BASE: 'https://your-deployed-backend.com',  // ← change this
  CHUNK_INTERVAL_MS: 60000,
};
```
Then reload the extension at `chrome://extensions`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Could not capture tab" | Make sure you're on a meet.google.com tab when you click Start |
| No transcript appearing | Check backend is running on port 8000, check OPENAI_API_KEY and GEMINI_API_KEY in .env |
| CORS error in background console | Backend CORS is already set to allow `chrome-extension://` origins |
| Extension not showing in toolbar | Pin it: click the puzzle icon → pin MeetLite |
| Badge not showing in Meet | Refresh the Meet tab after installing the extension |
