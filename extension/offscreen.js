/**
 * offscreen.js – Records the ENTIRE meeting as one continuous audio blob.
 *
 * On OFFSCREEN_START: captures tab audio, starts MediaRecorder, pipes audio back to speakers.
 * On OFFSCREEN_STOP:  stops recorder, assembles full blob, sends ArrayBuffer to background via port.
 *
 * A persistent port to background.js keeps the service worker alive for the entire recording.
 */

'use strict';

let mediaRecorder = null;
let stream        = null;
let audioContext   = null;
let allChunks      = [];       // all data chunks for the full recording
let activeMime     = '';
let bgPort         = null;

// ─── Persistent port to background (keeps SW alive) ──────────────────────────

function ensurePort() {
  if (bgPort) return bgPort;
  try {
    bgPort = chrome.runtime.connect({ name: 'meetlite-offscreen' });

    // Listen for commands from background via port
    bgPort.onMessage.addListener((msg) => {
      console.log('[MeetLite Offscreen] Port message received:', msg.type);
      if (msg.type === 'OFFSCREEN_START') {
        handleStart(msg, () => {}); // no sendResponse needed for port
      } else if (msg.type === 'OFFSCREEN_STOP') {
        handleStop(() => {}); // no sendResponse needed for port
      }
    });

    bgPort.onDisconnect.addListener(() => {
      bgPort = null;
      // Reconnect if still recording
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        setTimeout(ensurePort, 500);
      }
    });
  } catch (e) {
    console.warn('[MeetLite Offscreen] Port connect failed:', e.message);
    bgPort = null;
  }
  return bgPort;
}

// ─── Pick best MIME ──────────────────────────────────────────────────────────

function chooseMime() {
  const preferred = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const m of preferred) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

// ─── Core handlers ───────────────────────────────────────────────────────────

function handleStart(msg, sendResponse) {
    allChunks  = [];
    activeMime = chooseMime();

    // Open port immediately to keep SW alive
    ensurePort();

    const constraints = {
      audio: {
        mandatory: {
          chromeMediaSource:   'tab',
          chromeMediaSourceId: msg.streamId,
        },
      },
      video: false,
    };

    navigator.mediaDevices.getUserMedia(constraints)
      .then((capturedStream) => {
        stream = capturedStream;

        // Pipe audio back to speakers so user can still hear Meet
        try {
          audioContext = new AudioContext();
          const source = audioContext.createMediaStreamSource(stream);
          source.connect(audioContext.destination);
        } catch (e) {
          console.warn('[MeetLite Offscreen] Could not pipe audio:', e.message);
        }

        // Track end events
        stream.getAudioTracks().forEach((track) => {
          track.onended = () => {
            console.warn('[MeetLite Offscreen] Audio track ended');
            chrome.runtime.sendMessage({ type: 'STREAM_ENDED' }).catch(() => {});
          };
        });

        // Start recording — collect everything into allChunks
        const opts = activeMime ? { mimeType: activeMime } : {};
        try {
          mediaRecorder = new MediaRecorder(stream, opts);
        } catch (_) {
          mediaRecorder = new MediaRecorder(stream);
          activeMime = mediaRecorder.mimeType;
        }

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            allChunks.push(e.data);
          }
        };

        // Use timeslice=1000 so data flows in steadily (prevents huge single buffer)
        mediaRecorder.start(1000);
        console.log('[MeetLite Offscreen] Recording started, mime:', activeMime || '(default)');

        try { sendResponse({ ok: true }); } catch (_) {}
      })
      .catch((err) => {
        console.error('[MeetLite Offscreen] getUserMedia error:', err.name, err.message);
        try { sendResponse({ ok: false, error: err.name + ': ' + err.message }); } catch (_) {}
      });
}

function handleStop(sendResponse) {
    console.log('[MeetLite Offscreen] STOP received. mediaRecorder state:', mediaRecorder?.state, 'chunks so far:', allChunks.length);

    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      console.warn('[MeetLite Offscreen] No active recorder, sending empty');
      sendAudioToBackground('', activeMime || 'audio/webm', 0);
      try { sendResponse({ ok: true }); } catch (_) {}
      return;
    }

    mediaRecorder.onstop = async () => {
      // Assemble full recording blob
      const mime = activeMime || 'audio/webm';
      const fullBlob = new Blob(allChunks, { type: mime });
      const chunkCount = allChunks.length;
      allChunks = [];

      console.log('[MeetLite Offscreen] Full recording:', fullBlob.size, 'bytes,', chunkCount, 'chunks, mime:', mime);

      // Clean up media resources
      if (audioContext) {
        audioContext.close().catch(() => {});
        audioContext = null;
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      mediaRecorder = null;

      if (fullBlob.size === 0) {
        console.error('[MeetLite Offscreen] ERROR: blob is empty, nothing was recorded');
        sendAudioToBackground('', mime, 0);
        try { sendResponse({ ok: true }); } catch (_) {}
        return;
      }

      // Convert to base64 string — ArrayBuffer gets detached/emptied over
      // chrome.runtime messaging, so base64 is the reliable transport.
      const arrayBuf = await fullBlob.arrayBuffer();
      const uint8    = new Uint8Array(arrayBuf);
      let binary = '';
      // Process in 32KB slices to avoid call-stack overflow on large arrays
      const SLICE = 32768;
      for (let i = 0; i < uint8.length; i += SLICE) {
        binary += String.fromCharCode.apply(null, uint8.subarray(i, i + SLICE));
      }
      const base64 = btoa(binary);

      console.log('[MeetLite Offscreen] Sending base64, length:', base64.length, '(raw bytes:', uint8.length, ')');

      sendAudioToBackground(base64, mime, uint8.length);
      try { sendResponse({ ok: true }); } catch (_) {}
    };

    // Flush any buffered data then stop
    try { mediaRecorder.requestData(); } catch (_) {}
    mediaRecorder.stop();
}

function sendAudioToBackground(base64, mimeType, size) {
  const payload = { type: 'FULL_AUDIO', base64, mimeType, size };

  // ALWAYS use chrome.runtime.sendMessage for the audio payload.
  // Port messages can silently fail if the port disconnected/reconnected.
  // sendMessage is reliable for offscreen → background communication.
  console.log('[MeetLite Offscreen] Sending FULL_AUDIO via sendMessage, base64 length:', base64.length);
  chrome.runtime.sendMessage(payload, () => {
    if (chrome.runtime.lastError) {
      console.warn('[MeetLite Offscreen] sendMessage error:', chrome.runtime.lastError.message);
    } else {
      console.log('[MeetLite Offscreen] FULL_AUDIO sendMessage delivered');
    }
  });
}

// ─── Message handler (broadcast fallback — port is preferred) ────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // ── START ──
  if (msg.type === 'OFFSCREEN_START') {
    handleStart(msg, sendResponse);
    return true; // async
  }

  // ── STOP ──
  if (msg.type === 'OFFSCREEN_STOP') {
    handleStop(sendResponse);
    return true; // async
  }
});

// ─── Connect port immediately on load ────────────────────────────────────────
// This ensures the port is ready before background tries to send commands.
ensurePort();
console.log('[MeetLite Offscreen] Document loaded, port established');
