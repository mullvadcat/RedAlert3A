// Browser Military Walkie-Talkie WebAudio Pipeline & EVA Voice Mixer (T2.4).
// Browser-only adapter: never import from src/core/engine.js or Node test scripts.
// Enforces autoplay-unlock on first user gesture and dual-track activeLocale / voiceLocale support.

import { getVoiceLocale } from './i18n.js';

function makeSaturationCurve(amount = 14) {
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

export function createAudioMixer() {
  let ctx = null;
  let radioBus = null;
  let masterGain = null;
  let noiseBuffer = null;
  let muted = false;
  let unlocked = false;
  const voiceCache = new Map();

  function ensureContext() {
    if (ctx) return ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    ctx = new AudioCtx();
    masterGain = ctx.createGain();
    masterGain.gain.value = muted ? 0 : 0.42;
    masterGain.connect(ctx.destination);

    // Military Walkie-Talkie Bus: 450Hz~2600Hz bandpass + warm transistor waveshaper
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1350; // geometric center of ~450-2600Hz voice band
    bandpass.Q.value = 0.85;

    const shaper = ctx.createWaveShaper();
    shaper.curve = makeSaturationCurve(12);
    shaper.oversample = '2x';

    radioBus = ctx.createGain();
    radioBus.gain.value = 0.85;
    radioBus.connect(bandpass);
    bandpass.connect(shaper);
    shaper.connect(masterGain);

    // Pre-bake 1s white noise buffer for PTT squelch / explosions / gunshots
    const sampleRate = ctx.sampleRate;
    noiseBuffer = ctx.createBuffer(1, sampleRate, sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < sampleRate; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return ctx;
  }

  function unlock() {
    const c = ensureContext();
    if (!c) return;
    if (c.state === 'suspended') {
      c.resume().catch(() => {});
    }
    unlocked = c.state === 'running';
  }

  function playSquelchClick(whenOffset = 0, pitch = 2100) {
    if (!ctx || !radioBus || ctx.state !== 'running') return;
    const now = ctx.currentTime + whenOffset;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(pitch, now);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.08, now);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

    src.connect(g);
    g.connect(radioBus);
    osc.connect(og);
    og.connect(radioBus);

    src.start(now);
    src.stop(now + 0.05);
    osc.start(now);
    osc.stop(now + 0.04);
  }

  function playSynthEvaCue(cueId) {
    if (!ctx || !radioBus || ctx.state !== 'running' || muted) return;
    const isZh = getVoiceLocale() === 'zh-CN';
    playSquelchClick(0, isZh ? 1950 : 2250);

    // Distinct 2-3 note tactical confirmation chirp routed through military radio filter
    const now = ctx.currentTime + 0.05;
    const notes = cueId.includes('underAttack')
      ? [660, 520, 660]
      : (cueId.includes('deployed') || cueId.includes('ready') ? [520, 780] : [580, 640]);

    for (let i = 0; i < notes.length; i++) {
      const t0 = now + i * 0.08;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(notes[i], t0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.11, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
      osc.connect(g);
      g.connect(radioBus);
      osc.start(t0);
      osc.stop(t0 + 0.075);
    }

    playSquelchClick(0.06 + notes.length * 0.08, 1650);
  }

  // Hot-pluggable voice asset loader with automatic procedural radio fallback
  async function playEvaNotice(voiceId = 'ready') {
    if (muted) return;
    const c = ensureContext();
    if (!c || c.state !== 'running') return;

    const safeVoice = String(voiceId).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const locale = getVoiceLocale();
    const cacheKey = `${locale}:${safeVoice}`;

    const cached = voiceCache.get(cacheKey);
    if (cached === 'missing') {
      playSynthEvaCue(safeVoice);
      return;
    }
    if (cached instanceof AudioBuffer) {
      playSquelchClick(0, 2150);
      const src = c.createBufferSource();
      src.buffer = cached;
      src.connect(radioBus);
      src.start(c.currentTime + 0.05);
      playSquelchClick(0.08 + cached.duration, 1600);
      return;
    }

    try {
      const url = `./assets/audio/voices/${encodeURIComponent(locale)}/${encodeURIComponent(safeVoice)}.ogg`;
      const res = await fetch(url);
      if (!res.ok) {
        voiceCache.set(cacheKey, 'missing');
        playSynthEvaCue(safeVoice);
        return;
      }
      const arr = await res.arrayBuffer();
      const decoded = await c.decodeAudioData(arr);
      voiceCache.set(cacheKey, decoded);
      if (c.state === 'running') {
        playSquelchClick(0, 2150);
        const src = c.createBufferSource();
        src.buffer = decoded;
        src.connect(radioBus);
        src.start(c.currentTime + 0.05);
        playSquelchClick(0.08 + decoded.duration, 1600);
      }
    } catch {
      voiceCache.set(cacheKey, 'missing');
      playSynthEvaCue(safeVoice);
    }
  }

  function playSfx(kind) {
    if (muted || !ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;

    if (kind === 'explosion') {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(520, now);
      lp.frequency.exponentialRampToValueAtTime(90, now + 0.35);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.28, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
      src.connect(lp);
      lp.connect(g);
      g.connect(masterGain);
      src.start(now);
      src.stop(now + 0.4);
    } else if (kind === 'cannon') {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(48, now + 0.14);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.15, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.16);
    } else if (kind === 'laser' || kind === 'tesla') {
      const osc = ctx.createOscillator();
      osc.type = kind === 'tesla' ? 'sawtooth' : 'sine';
      osc.frequency.setValueAtTime(kind === 'tesla' ? 440 : 1200, now);
      osc.frequency.exponentialRampToValueAtTime(kind === 'tesla' ? 180 : 520, now + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.11, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
      osc.connect(g);
      g.connect(masterGain);
      osc.start(now);
      osc.stop(now + 0.2);
    }
  }

  return {
    unlock,
    playEvaNotice,
    playSfx,
    setMuted(flag) {
      muted = Boolean(flag);
      if (masterGain && ctx) {
        masterGain.gain.setValueAtTime(muted ? 0 : 0.42, ctx.currentTime);
      }
    },
    get isMuted() { return muted; },
    get isUnlocked() { return unlocked || ctx?.state === 'running'; }
  };
}
