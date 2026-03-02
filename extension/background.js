/**
 * background.js – MeetLite Service Worker
 *
 * Architecture: Full-recording mode
 *  - On START: creates meeting in backend, opens offscreen doc
 *  - Offscreen records the ENTIRE meeting continuously
 *  - On STOP: offscreen sends ONE full audio blob via port
 *  - Background POSTs full audio to /api/transcribe-and-summarize
 *  - No chunking, no 60-second intervals
 *
 * Keepalive:
 *  - Offscreen port keeps SW alive during recording
 *  - chrome.alarms as fallback
 *  - State persisted to chrome.storage.session
 */

'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────
try { importScripts('config.js'); } catch (_) {}
const API_BASE = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE) || 'http://localhost:8000';

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  recording:  false,
  meetingId:  null,
  transcript: null,
  summary:    null,
  status:     'idle',   // idle | starting | recording | processing | done | error
  error:      null,
};

let fullAudioResolve = null;   // resolved when offscreen sends FULL_AUDIO
let offscreenPort    = null;

// ─── Persist / Restore ───────────────────────────────────────────────────────

async function persistState() {
  try {
    await chrome.storage.session.set({ meetliteState: { ...state } });
  } catch (_) {}
}

async function restoreState() {
  try {
    const data = await chrome.storage.session.get('meetliteState');
    if (data && data.meetliteState) {
      state = { ...state, ...data.meetliteState };
    }
  } catch (_) {}
}

restoreState();

// ─── Keepalive via chrome.alarms (fallback) ──────────────────────────────────

function startKeepalive() {
  chrome.alarms.create('meetlite-keepalive', { periodInMinutes: 0.4 });
}

function stopKeepalive() {
  chrome.alarms.clear('meetlite-keepalive');
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'meetlite-keepalive') {
    console.log('[MeetLite] Keepalive tick');
  }
});

// ─── Port from offscreen doc (keepalive + receives full audio) ───────────────

// Pending audio data received before stopRecording() sets up its promise
let pendingAudioData = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'meetlite-offscreen') return;

  offscreenPort = port;
  console.log('[MeetLite] Offscreen port connected — SW will stay alive');

  port.onMessage.addListener((msg) => {
    // Port is mainly for keepalive. FULL_AUDIO comes via sendMessage now.
    if (msg.type === 'FULL_AUDIO') {
      const audioData = { base64: msg.base64, mimeType: msg.mimeType, size: msg.size };
      console.log('[MeetLite] FULL_AUDIO via port (unexpected) — base64 length:', msg.base64?.length || 0);
      if (fullAudioResolve) {
        fullAudioResolve(audioData);
        fullAudioResolve = null;
      } else {
        pendingAudioData = audioData;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    offscreenPort = null;
    console.log('[MeetLite] Offscreen port disconnected');
  });
});

// ─── State helpers ────────────────────────────────────────────────────────────

function setState(patch) {
  state = { ...state, ...patch };
  persistState();
  chrome.runtime.sendMessage({ type: 'STATE_UPDATE', state }).catch(() => {});
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Offscreen helpers ───────────────────────────────────────────────────────

async function ensureOffscreen() {
  let exists = false;
  try {
    const ctxs = await chrome.offscreen.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    exists = Array.isArray(ctxs) && ctxs.length > 0;
  } catch (_) {}

  if (!exists) {
    try {
      await chrome.offscreen.createDocument({
        url:           chrome.runtime.getURL('offscreen.html'),
        reasons:       ['AUDIO_PLAYBACK'],
        justification: 'Record Google Meet tab audio for transcription',
      });
    } catch (e) {
      if (!e.message || !e.message.includes('single')) throw e;
    }
  }
}

async function closeOffscreen() {
  try { await chrome.offscreen.closeDocument(); } catch (_) {}
  offscreenPort = null;
}

function msgOffscreen(payload) {
  return new Promise((resolve, reject) => {
    // Prefer port if available (direct channel to offscreen, avoids broadcast)
    if (offscreenPort) {
      try {
        offscreenPort.postMessage(payload);
        // Port messages don't have a response, resolve immediately
        resolve({ ok: true });
        return;
      } catch (e) {
        console.warn('[MeetLite] Port postMessage failed, falling back to sendMessage:', e.message);
      }
    }
    // Fallback: broadcast via sendMessage
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });
}

// ─── Core flow ────────────────────────────────────────────────────────────────

async function beginRecording(streamId) {
  setState({ status: 'starting', error: null, transcript: null, summary: null });

  // 1. Create meeting in backend
  const data = await apiFetch('/api/meetings', { method: 'POST' });
  setState({ meetingId: data.meeting_id });

  // 2. Open offscreen doc & start keepalive
  await ensureOffscreen();
  startKeepalive();

  // 3. Wait briefly for offscreen port to connect
  await new Promise((r) => setTimeout(r, 300));

  // 4. Tell offscreen to start recording
  //    Use sendMessage for START — the port might not be connected yet
  const resp = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'OFFSCREEN_START', streamId }, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(response);
    });
  });

  if (!resp || !resp.ok) {
    stopKeepalive();
    throw new Error(resp?.error || 'Offscreen failed to start recording');
  }

  setState({ recording: true, status: 'recording' });
}

async function stopRecording() {
  setState({ status: 'processing' });

  // 1. Set up promise to receive the full audio blob from offscreen
  //    Check if audio already arrived (stashed by port listener)
  if (pendingAudioData) {
    console.log('[MeetLite] Using stashed audio data — base64 length:', pendingAudioData.base64?.length || 0);
  }

  const audioPromise = pendingAudioData
    ? Promise.resolve(pendingAudioData)
    : new Promise((resolve) => {
        fullAudioResolve = resolve;
        // Timeout after 60 seconds (large recordings need time for base64 conversion)
        setTimeout(() => {
          if (fullAudioResolve) {
            console.error('[MeetLite] Audio receive timed out after 60s');
            fullAudioResolve(null);
            fullAudioResolve = null;
          }
        }, 60000);
      });

  pendingAudioData = null;

  // 2. Tell offscreen to stop via sendMessage (NOT port) so it gets a proper
  //    sendResponse callback and the onMessage handler fires correctly.
  try {
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[MeetLite] OFFSCREEN_STOP sendMessage error:', chrome.runtime.lastError.message);
          resolve(); // don't fail — audio might still arrive
        } else {
          console.log('[MeetLite] OFFSCREEN_STOP acknowledged:', response);
          resolve();
        }
      });
    });
  } catch (e) {
    console.warn('[MeetLite] OFFSCREEN_STOP error (may be ok):', e.message);
  }

  const audio = await audioPromise;

  if (!audio || !audio.base64 || audio.base64.length === 0) {
    console.error('[MeetLite] No audio data received. audio:', audio ? `base64 len=${audio.base64?.length}, size=${audio.size}` : 'null');
    stopKeepalive();
    await closeOffscreen();
    throw new Error('No audio data received from recording.');
  }

  // 3. Ensure we still have the meeting ID
  if (!state.meetingId) await restoreState();
  if (!state.meetingId) {
    stopKeepalive();
    await closeOffscreen();
    throw new Error('Meeting ID was lost. Please try recording again.');
  }

  // 4. Decode base64 → Uint8Array → Blob
  const binaryString = atob(audio.base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  console.log('[MeetLite] Decoded audio:', bytes.length, 'bytes from base64 length:', audio.base64.length);

  const mimeType = audio.mimeType || 'audio/webm';
  const blob = new Blob([bytes], { type: mimeType });

  console.log('[MeetLite] Blob created:', blob.size, 'bytes, type:', blob.type);

  // Pick filename extension that matches the MIME for Whisper
  let ext = 'webm';
  if (mimeType.includes('ogg')) ext = 'ogg';
  else if (mimeType.includes('mp4')) ext = 'mp4';

  const fd = new FormData();
  fd.append('audio', blob, `recording.${ext}`);
  fd.append('meeting_id', state.meetingId);

  const result = await apiFetch('/api/transcribe-and-summarize', { method: 'POST', body: fd });

  setState({
    recording:  false,
    status:     'done',
    transcript: result.transcript || null,
    summary:    result.summary || null,
  });

  stopKeepalive();
  await closeOffscreen();
}

// ─── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // Messages meant for offscreen — let them pass through, don't consume them
  if (msg.type === 'OFFSCREEN_START' || msg.type === 'OFFSCREEN_STOP') {
    return false;
  }

  if (msg.type === 'START_RECORDING') {
    beginRecording(msg.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        setState({ status: 'error', error: err.message, recording: false });
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (msg.type === 'STOP_RECORDING') {
    stopRecording()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        setState({ status: 'error', error: err.message, recording: false });
        stopKeepalive();
        closeOffscreen();
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (msg.type === 'GET_STATE') {
    restoreState().then(() => sendResponse({ state }));
    return true;
  }

  if (msg.type === 'RESET_STATE') {
    stopKeepalive();
    setState({
      recording: false, meetingId: null, transcript: null,
      summary: null, status: 'idle', error: null,
    });
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'STREAM_ENDED') {
    console.warn('[MeetLite] Stream ended unexpectedly');
    if (state.recording) {
      stopRecording().catch((err) => {
        setState({ status: 'error', error: 'Stream ended: ' + err.message, recording: false });
        stopKeepalive();
        closeOffscreen();
      });
    }
    return false;
  }

  // FULL_AUDIO from offscreen — primary delivery path via sendMessage
  if (msg.type === 'FULL_AUDIO') {
    const audioData = { base64: msg.base64, mimeType: msg.mimeType, size: msg.size };
    console.log('[MeetLite] FULL_AUDIO received — base64 length:', msg.base64?.length || 0, 'size:', msg.size);
    if (fullAudioResolve) {
      fullAudioResolve(audioData);
      fullAudioResolve = null;
    } else {
      console.log('[MeetLite] Stashing audio (promise not ready yet)');
      pendingAudioData = audioData;
    }
    return false;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[MeetLite] Extension ready.');
});
