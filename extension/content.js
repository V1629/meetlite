/**
 * content.js – Injected into meet.google.com pages.
 * Shows a small status badge inside the Meet UI so you know
 * MeetLite is recording without switching tabs.
 */

'use strict';

let badge = null;
let hideTimer = null;

// Inject animation CSS once
const style = document.createElement('style');
style.textContent = `
  @keyframes meetlite-pulse {
    0%,100% { box-shadow: 0 0 0 0 rgba(255,68,68,0.5); }
    50%      { box-shadow: 0 0 0 5px rgba(255,68,68,0); }
  }
  #meetlite-badge { transition: opacity 0.4s ease, transform 0.4s ease; }
  #meetlite-badge.hiding { opacity:0; transform: translateY(-4px); }
`;
document.head.appendChild(style);

function showBadge(text, color, pulse) {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }

  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'meetlite-badge';
    Object.assign(badge.style, {
      position:      'fixed',
      top:           '14px',
      right:         '76px',
      zIndex:        '99999',
      display:       'flex',
      alignItems:    'center',
      gap:           '7px',
      padding:       '5px 13px',
      borderRadius:  '20px',
      fontFamily:    "'Google Sans', 'Roboto', sans-serif",
      fontSize:      '12px',
      fontWeight:    '500',
      letterSpacing: '0.02em',
      backdropFilter:'blur(10px)',
      border:        '1px solid rgba(255,255,255,0.12)',
      boxShadow:     '0 2px 14px rgba(0,0,0,0.35)',
      userSelect:    'none',
      cursor:        'default',
    });
    document.body.appendChild(badge);
  }

  const dotAnim = pulse ? 'animation:meetlite-pulse 1.4s ease-in-out infinite;' : '';
  badge.innerHTML = `
    <span style="width:7px;height:7px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;${dotAnim}"></span>
    <span>MeetLite · ${text}</span>`;

  badge.style.background = `rgba(${hexToRgb(color)}, 0.13)`;
  badge.style.color       = lighten(color);
  badge.style.borderColor = `rgba(${hexToRgb(color)}, 0.28)`;
  badge.classList.remove('hiding');
}

function removeBadge(delay = 0) {
  if (!badge) return;
  hideTimer = setTimeout(() => {
    if (badge) {
      badge.classList.add('hiding');
      setTimeout(() => { badge && badge.remove(); badge = null; }, 400);
    }
  }, delay);
}

function hexToRgb(hex) {
  const h = hex.replace('#','');
  const n = parseInt(h.length === 3 ? h.split('').map(c=>c+c).join('') : h, 16);
  return [(n>>16)&255,(n>>8)&255,n&255].join(',');
}

function lighten(hex) {
  // Return a lighter version of the color for text
  const map = { '#ff4444':'#ff9999', '#00ff9d':'#00ff9d', '#ffaa00':'#ffd060' };
  return map[hex] || hex;
}

// Listen for state updates from background
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'STATE_UPDATE') return;
  const { status } = msg.state;

  if (status === 'recording')   showBadge('Recording', '#ff4444', true);
  else if (status === 'starting')   showBadge('Starting…', '#ffaa00', false);
  else if (status === 'processing') showBadge('Processing…', '#ffaa00', false);
  else if (status === 'done')       { showBadge('Done ✓', '#00ff9d', false); removeBadge(5000); }
  else if (status === 'idle')       removeBadge();
  else if (status === 'error')      { showBadge('Error', '#ff4444', false); removeBadge(8000); }
});
