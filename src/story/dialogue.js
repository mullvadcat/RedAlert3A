// Radio Portrait & Tactical Transmission Dialogue Box (AAA Phase P1-1).
// Procedural Canvas 2D animated character portraits for all 9 campaign speakers + FIFO queue.
// Uses strict .textContent & DOM element APIs (zero innerHTML / unsafe DOM sinks).

import { t } from '../core/i18n.js';

const PORTRAIT_SIZE = 64;
const MAX_QUEUE_LEN = 6;

const SPEAKER_PROFILES = {
  eva_abyssal: {
    bgTop: '#071b33',
    bgBot: '#040b18',
    primary: '#38bdf8',
    secondary: '#7dd3fc',
    kind: 'eva_abyssal'
  },
  commander_abyssal: {
    bgTop: '#0d2647',
    bgBot: '#081224',
    primary: '#38bdf8',
    secondary: '#f59e0b',
    kind: 'commander_abyssal'
  },
  dr_lin_prism: {
    bgTop: '#0b2b3d',
    bgBot: '#05111b',
    primary: '#67e8f9',
    secondary: '#a5f3fc',
    kind: 'dr_lin_prism'
  },
  hero_shadow: {
    bgTop: '#091f2a',
    bgBot: '#040a10',
    primary: '#22d3ee',
    secondary: '#34d399',
    kind: 'hero_shadow'
  },
  eva_crimson: {
    bgTop: '#2c0a10',
    bgBot: '#0d0407',
    primary: '#ef4444',
    secondary: '#fca5a5',
    kind: 'eva_crimson'
  },
  commander_crimson: {
    bgTop: '#320d11',
    bgBot: '#120608',
    primary: '#f87171',
    secondary: '#f59e0b',
    kind: 'commander_crimson'
  },
  dr_volkov_tesla: {
    bgTop: '#2a1609',
    bgBot: '#0e0705',
    primary: '#fb923c',
    secondary: '#38bdf8',
    kind: 'dr_volkov_tesla'
  },
  hero_sledge: {
    bgTop: '#2b1208',
    bgBot: '#100704',
    primary: '#f97316',
    secondary: '#ef4444',
    kind: 'hero_sledge'
  },
  abyss0_signal: {
    bgTop: '#210938',
    bgBot: '#090312',
    primary: '#c084fc',
    secondary: '#a855f7',
    kind: 'abyss0_signal'
  }
};

function normalizeSpeakerId(speakerKey) {
  const clean = String(speakerKey || '').trim().replace(/^speaker\./, '');
  if (!clean || clean === 'EVA') return 'eva_abyssal';
  if (clean === 'crimson') return 'eva_crimson';
  return SPEAKER_PROFILES[clean] ? clean : 'eva_abyssal';
}

function drawPolygon(ctx, cx, cy, r, sides, rotRad) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotRad + (i * Math.PI * 2) / sides;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawPortraitSubject(ctx, profile, animSec) {
  const cx = 32;
  const cy = 30;
  const { primary, secondary, kind } = profile;

  switch (kind) {
    case 'eva_abyssal': {
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.5;
      drawPolygon(ctx, cx, cy, 17, 6, animSec * 0.65);
      ctx.stroke();
      ctx.strokeStyle = secondary;
      drawPolygon(ctx, cx, cy, 11, 4, -animSec * 1.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5 + Math.sin(animSec * 5) * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = primary;
      ctx.fill();
      break;
    }

    case 'commander_abyssal': {
      // Shoulders + crisp navy collar + gold rank pips
      ctx.fillStyle = '#153459';
      ctx.beginPath();
      ctx.moveTo(10, 62);
      ctx.quadraticCurveTo(32, 40, 54, 62);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 1.5;
      ctx.fillStyle = secondary;
      ctx.fillRect(19, 49, 4, 2);
      ctx.fillRect(41, 49, 4, 2);
      // Head & jawline silhouette
      ctx.fillStyle = '#9bb6d8';
      ctx.beginPath();
      ctx.arc(cx, 29, 9.5, 0, Math.PI * 2);
      ctx.fill();
      // Peaked naval admiral cap
      ctx.fillStyle = '#0f2342';
      ctx.beginPath();
      ctx.moveTo(18, 22);
      ctx.lineTo(46, 22);
      ctx.lineTo(42, 13);
      ctx.lineTo(22, 13);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = secondary;
      ctx.fillRect(29, 15, 6, 3);
      // Cyan tactical visor & comms earpiece
      ctx.fillStyle = primary;
      ctx.fillRect(24, 26, 16, 3.5);
      ctx.fillStyle = '#071426';
      ctx.fillRect(19, 24, 3, 8);
      break;
    }

    case 'dr_lin_prism': {
      // Lab coat shoulders
      ctx.fillStyle = '#cadce8';
      ctx.beginPath();
      ctx.moveTo(12, 62);
      ctx.lineTo(22, 43);
      ctx.lineTo(42, 43);
      ctx.lineTo(52, 62);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0d2b3e';
      ctx.beginPath();
      ctx.moveTo(27, 44);
      ctx.lineTo(37, 44);
      ctx.lineTo(32, 56);
      ctx.closePath();
      ctx.fill();
      // Head
      ctx.fillStyle = '#9dc3d6';
      ctx.beginPath();
      ctx.arc(cx, 28, 9, 0, Math.PI * 2);
      ctx.fill();
      // Cyan prism spectacles + orbiting hexagonal refraction ring
      ctx.fillStyle = primary;
      ctx.fillRect(23, 25, 7, 4);
      ctx.fillRect(34, 25, 7, 4);
      ctx.fillRect(30, 26.5, 4, 1.5);
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 1;
      drawPolygon(ctx, cx, 28, 18, 6, animSec * 0.9);
      ctx.stroke();
      break;
    }

    case 'hero_shadow': {
      // Hooded stealth mantle
      ctx.fillStyle = '#0c1824';
      ctx.beginPath();
      ctx.moveTo(10, 62);
      ctx.lineTo(18, 36);
      ctx.lineTo(24, 15);
      ctx.lineTo(40, 15);
      ctx.lineTo(46, 36);
      ctx.lineTo(54, 62);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      // Shadowed face mask & twin glowing NVG optics
      ctx.fillStyle = '#05090f';
      ctx.beginPath();
      ctx.arc(cx, 29, 8.5, 0, Math.PI * 2);
      ctx.fill();
      const pulse = 0.75 + 0.25 * Math.sin(animSec * 6);
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.arc(27, 28, 2.5 * pulse, 0, Math.PI * 2);
      ctx.arc(37, 28, 2.5 * pulse, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'eva_crimson': {
      // Heavy industrial chevrons & red scanner reticle
      ctx.strokeStyle = primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(15, 22);
      ctx.lineTo(32, 34);
      ctx.lineTo(49, 22);
      ctx.moveTo(15, 34);
      ctx.lineTo(32, 46);
      ctx.lineTo(49, 34);
      ctx.stroke();
      const sweepY = 14 + ((animSec * 24) % 34);
      ctx.fillStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.fillRect(10, sweepY, 44, 2.5);
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, 28, 12, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case 'commander_crimson': {
      // Broad armored coat & crimson epaulettes
      ctx.fillStyle = '#3b1518';
      ctx.beginPath();
      ctx.moveTo(7, 62);
      ctx.lineTo(15, 42);
      ctx.lineTo(49, 42);
      ctx.lineTo(57, 62);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = primary;
      ctx.fillRect(14, 42, 8, 4);
      ctx.fillRect(42, 42, 8, 4);
      // Strong jaw head
      ctx.fillStyle = '#bfa29e';
      ctx.fillRect(23, 21, 18, 17);
      // Heavy fur ushanka + crimson star crest
      ctx.fillStyle = '#261416';
      ctx.fillRect(18, 11, 28, 12);
      ctx.fillStyle = primary;
      drawPolygon(ctx, cx, 17, 3.8, 5, -Math.PI / 2);
      ctx.fill();
      // Grim eyes + scarred jawline accent
      ctx.fillStyle = '#1b090a';
      ctx.fillRect(25, 26, 5, 2.5);
      ctx.fillRect(34, 26, 5, 2.5);
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(37, 29);
      ctx.lineTo(39, 35);
      ctx.stroke();
      break;
    }

    case 'dr_volkov_tesla': {
      // Insulated arc-coil collar silhouette
      ctx.fillStyle = '#291a12';
      ctx.beginPath();
      ctx.moveTo(10, 62);
      ctx.lineTo(18, 42);
      ctx.lineTo(46, 42);
      ctx.lineTo(54, 62);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#c4a693';
      ctx.beginPath();
      ctx.arc(cx, 28, 9, 0, Math.PI * 2);
      ctx.fill();
      // Welding goggles
      ctx.fillStyle = '#1a110c';
      ctx.fillRect(21, 22, 22, 8);
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.arc(27, 26, 3.2, 0, Math.PI * 2);
      ctx.arc(37, 26, 3.2, 0, Math.PI * 2);
      ctx.fill();
      // Twin copper coil prongs & animated Tesla spark
      ctx.fillStyle = '#d97706';
      ctx.fillRect(14, 34, 4, 12);
      ctx.fillRect(46, 34, 4, 12);
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      const jitter = Math.sin(animSec * 19) * 3;
      ctx.moveTo(16, 34);
      ctx.lineTo(24, 17 + jitter);
      ctx.lineTo(40, 19 - jitter);
      ctx.lineTo(48, 34);
      ctx.stroke();
      break;
    }

    case 'hero_sledge': {
      // Heavy exo-pauldrons
      ctx.fillStyle = '#331c12';
      ctx.fillRect(6, 41, 52, 21);
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(8, 43, 14, 12);
      ctx.strokeRect(42, 43, 14, 12);
      // Blast-helmet octagon
      ctx.fillStyle = '#47281a';
      drawPolygon(ctx, cx, 26, 13, 8, Math.PI / 8);
      ctx.fill();
      ctx.strokeStyle = secondary;
      ctx.stroke();
      // Glowing horizontal tactical visor slit
      ctx.fillStyle = primary;
      ctx.fillRect(22, 24, 20, 4);
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(25, 25.2, 14, 1.5);
      break;
    }

    case 'abyss0_signal': {
      // Bio-mecha tendrils radiating around hexagonal singularity eye
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 6; i++) {
        const a = animSec * 0.7 + (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11);
        ctx.lineTo(cx + Math.cos(a + 0.35) * 24, cy + Math.sin(a + 0.35) * 24);
        ctx.stroke();
      }
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.8;
      drawPolygon(ctx, cx, cy, 13, 6, -animSec * 1.2);
      ctx.stroke();
      ctx.fillStyle = '#f0abfc';
      ctx.beginPath();
      ctx.arc(cx, cy, 4.2 + Math.sin(animSec * 8) * 1.1, 0, Math.PI * 2);
      ctx.fill();
      // Subtle horizontal glitch slice
      if (Math.sin(animSec * 13) > 0.6) {
        ctx.fillStyle = 'rgba(192, 132, 252, 0.35)';
        ctx.fillRect(6, 18 + ((Math.floor(animSec * 20) * 7) % 24), 52, 2);
      }
      break;
    }

    default:
      break;
  }
}

function drawPortraitFrame(ctx, profile, animSec, active) {
  const s = PORTRAIT_SIZE;
  const grad = ctx.createLinearGradient(0, 0, 0, s);
  grad.addColorStop(0, profile.bgTop);
  grad.addColorStop(1, profile.bgBot);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, s, s);

  drawPortraitSubject(ctx, profile, animSec);

  // Subtle horizontal CRT scanlines
  ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
  for (let y = 2; y < s; y += 3) {
    ctx.fillRect(0, y, s, 1);
  }

  // Animated 5-bar bottom voice frequency waveform
  for (let i = 0; i < 5; i++) {
    const wave = active ? (0.3 + 0.7 * Math.abs(Math.sin(animSec * (7.5 + i * 2.1) + i * 1.3))) : 0.2;
    const h = Math.max(2, Math.round(wave * 11));
    ctx.fillStyle = profile.primary;
    ctx.fillRect(42 + i * 4, s - 4 - h, 2, h);
  }

  // Top-left live carrier signal indicator dot
  const blink = !active || Math.sin(animSec * 7) > -0.25;
  ctx.fillStyle = blink ? profile.primary : 'rgba(255, 255, 255, 0.2)';
  ctx.beginPath();
  ctx.arc(7, 7, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // Crisp 1px corner brackets
  ctx.fillStyle = profile.secondary;
  ctx.fillRect(2, 2, 7, 1);
  ctx.fillRect(2, 2, 1, 7);
  ctx.fillRect(s - 9, 2, 7, 1);
  ctx.fillRect(s - 3, 2, 1, 7);
  ctx.fillRect(2, s - 3, 7, 1);
  ctx.fillRect(2, s - 9, 1, 7);
}

export function createDialogueController() {
  const boxEl = document.getElementById('dialogue-box');
  const portraitEl = document.getElementById('dialogue-portrait');
  const speakerEl = document.getElementById('dialogue-speaker');
  const textEl = document.getElementById('dialogue-text');

  let canvasEl = null;
  let ctx = null;
  if (portraitEl) {
    portraitEl.textContent = '';
    canvasEl = document.createElement('canvas');
    canvasEl.width = PORTRAIT_SIZE;
    canvasEl.height = PORTRAIT_SIZE;
    canvasEl.setAttribute('aria-hidden', 'true');
    portraitEl.appendChild(canvasEl);
    ctx = canvasEl.getContext('2d');
  }

  let remainingSec = 0;
  let animSec = 0;
  let currentSpeakerKey = null;
  let currentSpeakerId = 'eva_abyssal';
  let currentTextKey = null;
  const queue = [];

  function resolveSpeakerLabel(speakerKey, normalizedId) {
    if (!speakerKey) return t('speaker.eva_abyssal');
    if (speakerKey === 'EVA') return 'EVA';
    if (speakerKey.includes('.')) return t(speakerKey);
    if (SPEAKER_PROFILES[speakerKey]) return t(`speaker.${speakerKey}`);
    return speakerKey || t(`speaker.${normalizedId}`);
  }

  function renderText() {
    if (!currentTextKey || !speakerEl || !textEl) return;
    speakerEl.textContent = resolveSpeakerLabel(currentSpeakerKey, currentSpeakerId);
    textEl.textContent = currentTextKey.includes('.') ? t(currentTextKey) : currentTextKey;
  }

  function redrawPortrait() {
    if (!ctx) return;
    const profile = SPEAKER_PROFILES[currentSpeakerId] ?? SPEAKER_PROFILES.eva_abyssal;
    drawPortraitFrame(ctx, profile, animSec, remainingSec > 0);
  }

  function startItem(item) {
    currentSpeakerKey = item.speakerKey;
    currentSpeakerId = normalizeSpeakerId(item.speakerKey);
    currentTextKey = item.textKey;
    remainingSec = Math.max(0.5, item.durationSec ?? 5.0);
    const accentHex = item.accentHex ?? SPEAKER_PROFILES[currentSpeakerId].primary;

    if (boxEl) {
      boxEl.style.borderLeftColor = accentHex;
    }
    if (portraitEl) {
      portraitEl.style.borderColor = accentHex;
    }
    if (speakerEl) {
      speakerEl.style.color = accentHex;
    }
    renderText();
    redrawPortrait();
    if (boxEl) boxEl.hidden = false;
  }

  function showDialogue(speakerKey, textKey, durationSec = 5.0, accentHex = '#38bdf8') {
    if (!boxEl) return;
    if (remainingSec > 0) {
      const tail = queue[queue.length - 1];
      if (textKey === currentTextKey || (tail && tail.textKey === textKey)) {
        return;
      }
      queue.push({ speakerKey, textKey, durationSec, accentHex });
      if (queue.length > MAX_QUEUE_LEN) {
        queue.shift();
      }
      return;
    }
    startItem({ speakerKey, textKey, durationSec, accentHex });
  }

  function hideDialogue() {
    queue.length = 0;
    remainingSec = 0;
    currentSpeakerKey = null;
    currentTextKey = null;
    if (boxEl) boxEl.hidden = true;
  }

  function update(dtSec) {
    animSec += dtSec;
    if (remainingSec <= 0) return;
    remainingSec = Math.max(0, remainingSec - dtSec);
    if (remainingSec === 0) {
      if (queue.length > 0) {
        startItem(queue.shift());
      } else {
        hideDialogue();
      }
      return;
    }
    redrawPortrait();
  }

  return {
    showDialogue,
    hideDialogue,
    refreshLocale: renderText,
    update,
    getQueueLength: () => queue.length
  };
}
