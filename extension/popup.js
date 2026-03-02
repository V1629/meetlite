/**
 * popup.js – MeetLite popup controller.
 *
 * CRITICAL: chrome.tabCapture.getMediaStreamId() MUST be called here in the popup,
 * not in the background service worker. It requires:
 *   1. A user gesture (click)
 *   2. To be called from the popup or content script context, NOT the SW
 *
 * Flow (full-recording mode):
 *   onStart() → getMediaStreamId() → send START_RECORDING to background (with streamId)
 *   background creates offscreen → offscreen starts MediaRecorder
 *   Recording runs until user clicks Stop.
 *   onStop() → STOP_RECORDING → background receives FULL audio → transcribes → summarises
 */

'use strict';

let appState  = { status: 'idle', transcript: null, summary: null, error: null, recording: false };
let meetTabId = null;
let timerSec  = 0;
let timerRef  = null;

const $content   = document.getElementById('content');
const $statusDot = document.getElementById('statusDot');
const $statusTxt = document.getElementById('statusText');
const $timer     = document.getElementById('timer');

// ─── Timer ────────────────────────────────────────────────────────────────────
function startTimer() {
  if (timerRef) return;
  timerSec = 0;
  timerRef = setInterval(() => { timerSec++; $timer.textContent = fmt(timerSec); }, 1000);
}
function stopTimer()  { clearInterval(timerRef); timerRef = null; $timer.textContent = ''; }
function fmt(s)       { return String(Math.floor(s/60)).padStart(2,'0') + ':' + String(s%60).padStart(2,'0'); }

// ─── Status bar ───────────────────────────────────────────────────────────────
const LABELS = {
  idle:       'Ready',
  starting:   'Connecting…',
  recording:  'Recording',
  processing: 'Processing audio & generating summary…',
  done:       'Complete',
  error:      'Error',
};

function updateStatusBar(s) {
  $statusDot.className  = 'status-dot ' + s;
  $statusTxt.className  = 'status-text ' + s;
  $statusTxt.textContent = LABELS[s] || s;
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function transcriptHTML(text) {
  if (!text || !text.trim())
    return `<div class="transcript-empty">No transcript available.</div>`;
  return `<div class="transcript-chunk"><div>${esc(text)}</div></div>`;
}

function summaryHTML(text) {
  if (!text) return '';
  const sections = [
    { title:'Key Points',   icon:'◆', cls:'key-points' },
    { title:'Decisions',    icon:'✓', cls:'decisions'  },
    { title:'Action Items', icon:'→', cls:'actions'    },
  ].map(({title,icon,cls}) => {
    const m = text.match(new RegExp('## '+title+'([\\s\\S]*?)(?=## |$)','i'));
    const items = m
      ? m[1].trim().split('\n').map(l=>l.replace(/^[-*•]\s*/,'').trim()).filter(Boolean)
      : [];
    return { title, icon, cls, items };
  });

  if (!sections.some(s=>s.items.length))
    return `<div class="summary-card">
      <pre style="font-size:11px;color:#aaaacc;white-space:pre-wrap;font-family:inherit;">${esc(text)}</pre>
    </div>`;

  return sections.map(({title,icon,cls,items}) => `
    <div class="summary-card ${cls}">
      <div class="summary-card-header"><span>${icon}</span><span>${title}</span></div>
      ${items.length
        ? items.map(i=>`<div class="summary-item"><span class="summary-bullet">▸</span><span>${esc(i)}</span></div>`).join('')
        : `<div style="font-size:11px;color:var(--text-dim);font-style:italic;">None noted</div>`
      }
    </div>`).join('');
}

function makeCopyBtn(id, label) {
  return `<button class="btn-sm" id="${id}">${label}</button>`;
}
function bindCopy(id, text, resetLabel) {
  const el = document.getElementById(id);
  if (!el) return;
  el.onclick = () => navigator.clipboard.writeText(text).then(() => {
    el.textContent = '✓ Copied!';
    setTimeout(() => { el.textContent = resetLabel; }, 2000);
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  const { status, transcript, summary, error } = appState;

  updateStatusBar(status);

  if (status === 'recording' || status === 'starting') startTimer();
  else stopTimer();

  const errHTML = error
    ? `<div class="error-banner"><span>⚠</span><span>${esc(error)}</span></div>`
    : '';

  // ── Not on a Meet tab ──
  if (!meetTabId && (status === 'idle' || status === 'error')) {
    $content.innerHTML = `
      <div class="not-meet-notice">
        <div class="icon">🎙️</div>
        <p>Open a <strong>Google Meet</strong> tab and make sure it's the active tab, then click the MeetLite icon again.</p>
        <p style="margin-top:6px;font-size:11px;color:var(--text-dim);">
          MeetLite uses tab capture to record all participants.
        </p>
      </div>`;
    return;
  }

  // ── Idle ──
  if (status === 'idle') {
    $content.innerHTML = `${errHTML}
      <button class="btn-record start" id="btnStart">
        <span class="btn-icon start"></span>Start Recording
      </button>
      <div style="font-size:11px;color:var(--text-dim);line-height:1.65;padding:4px 2px;">
        Captures <strong style="color:var(--text)">all participants</strong> from this Meet tab.
        Transcript &amp; AI summary are generated when you stop the recording.
      </div>`;
    document.getElementById('btnStart').onclick = onStart;
    return;
  }

  // ── Starting ──
  if (status === 'starting') {
    $content.innerHTML = `
      <div class="processing-row">
        <div class="spinner"></div>
        <span>Connecting to meeting audio…</span>
      </div>`;
    return;
  }

  // ── Recording ──
  if (status === 'recording') {
    $content.innerHTML = `${errHTML}
      <button class="btn-record stop" id="btnStop">
        <span class="btn-icon stop"></span>Stop Recording
      </button>
      <div style="font-size:12px;color:var(--text-dim);line-height:1.6;padding:6px 2px;text-align:center;">
        🔴 Recording in progress…<br>
        <span style="font-size:11px;">Click <strong>Stop</strong> when the meeting ends to get your transcript &amp; summary.</span>
      </div>`;
    document.getElementById('btnStop').onclick = onStop;
    return;
  }

  // ── Processing ──
  if (status === 'processing') {
    $content.innerHTML = `
      <div class="processing-row">
        <div class="spinner"></div>
        <span>Transcribing audio &amp; generating AI summary…</span>
      </div>
      <div style="font-size:11px;color:var(--text-dim);padding:8px 2px;text-align:center;">
        This may take a moment depending on recording length.
      </div>`;
    return;
  }

  // ── Done ──
  if (status === 'done') {
    $content.innerHTML = `${errHTML}
      <div class="btn-row">
        ${transcript ? makeCopyBtn('btnCpTx','⎘ Copy Transcript') : ''}
        <button class="btn-sm" id="btnNew">↺ New Meeting</button>
      </div>
      ${transcript ? `
        <div class="section-header">
          <span>Transcript</span><span class="line"></span>
        </div>
        <div class="transcript-box" id="txBox">${transcriptHTML(transcript)}</div>` : ''}
      ${summary ? `
        <div class="section-header" style="margin-top:6px;">
          <span style="color:var(--signal);">◉</span>
          <span>AI Summary</span><span class="line"></span>
        </div>
        <div class="summary-section">${summaryHTML(summary)}</div>
        ${makeCopyBtn('btnCpSum','⎘ Copy Summary')}` : ''}
      ${!transcript && !summary ? `
        <div style="font-size:11px;color:var(--text-dim);padding:8px 2px;text-align:center;">
          No transcript was captured. The recording may have been too short.
        </div>` : ''}`;

    if (transcript) bindCopy('btnCpTx', transcript, '⎘ Copy Transcript');
    if (summary) bindCopy('btnCpSum', summary, '⎘ Copy Summary');
    document.getElementById('btnNew').onclick = () => {
      chrome.runtime.sendMessage({ type: 'RESET_STATE' });
      timerSec = 0;
    };
    const b = document.getElementById('txBox');
    if (b) b.scrollTop = b.scrollHeight;
    return;
  }

  // ── Error ──
  if (status === 'error') {
    $content.innerHTML = `${errHTML}
      <button class="btn-sm" id="btnNew" style="margin-top:8px;width:100%;">↺ Try Again</button>`;
    document.getElementById('btnNew').onclick = () => chrome.runtime.sendMessage({ type: 'RESET_STATE' });
    return;
  }
}

// ─── User actions ─────────────────────────────────────────────────────────────

async function onStart() {
  if (!meetTabId) return;

  appState = { ...appState, status: 'starting', error: null };
  render();

  try {
    // Get stream ID from tabCapture — MUST happen here in popup (user gesture context)
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: meetTabId }, (id) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!id) {
          reject(new Error('tabCapture returned empty stream ID'));
        } else {
          resolve(id);
        }
      });
    });

    // Hand off to background with the stream ID
    chrome.runtime.sendMessage({ type: 'START_RECORDING', tabId: meetTabId, streamId }, (res) => {
      if (chrome.runtime.lastError) {
        appState = { ...appState, status: 'error', error: chrome.runtime.lastError.message };
        render();
        return;
      }
      if (res && !res.ok) {
        appState = { ...appState, status: 'error', error: res.error };
        render();
      }
    });

  } catch (err) {
    appState = { ...appState, status: 'error', error: err.message };
    render();
  }
}

function onStop() {
  appState = { ...appState, status: 'processing' };
  render();

  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (res) => {
    if (chrome.runtime.lastError || (res && !res.ok)) {
      const msg = (res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message);
      if (msg) appState = { ...appState, error: msg };
      render();
    }
  });
}

// ─── Live state updates from background ──────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') {
    appState = msg.state;
    render();
  }
  if (msg.type === 'STREAM_ENDED') {
    appState = { ...appState, error: 'Meeting audio ended. Click Stop to get your summary.' };
    render();
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('meet.google.com')) {
      meetTabId = tab.id;
    }
  } catch (_) {}

  chrome.runtime.sendMessage({ type: 'GET_STATE' }, (res) => {
    if (chrome.runtime.lastError) { render(); return; }
    if (res && res.state) appState = res.state;
    render();
  });
}

init();
