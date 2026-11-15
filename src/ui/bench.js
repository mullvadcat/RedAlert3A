// Milestone 6 (T6.2): ?bench=1 Heavy Combat Performance Telemetry Overlay (Pure safe DOM).
// Reports Avg FPS, P99 Frame Time, Sim Tick Avg (<= 2.0ms gate), Draw Calls (< 140 gate),
// Active Units (250+ across land/sea/air), JS Heap Delta, and runtime Quality switcher.

import { onLocaleChange, t } from '../core/i18n.js';

export function computePercentile(samples, percentile = 0.99) {
  if (!samples || samples.length === 0) return 0;
  const sorted = samples.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
  return sorted[idx];
}

export function createBenchOverlay(options = {}) {
  const host = typeof document !== 'undefined'
    ? (document.getElementById('viewport-container') || document.body)
    : null;

  const MAX_SAMPLES = 3600;
  const frameSamples = [];
  const simSamples = [];
  const startTimeMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const baseHeapBytes =
    typeof performance !== 'undefined' && performance.memory ? performance.memory.usedJSHeapSize : null;

  let lastDrawCalls = 0;
  let lastActiveUnits = 0;
  let currentQualityId = options.initialQuality ?? 'high';
  let lastRenderMs = 0;

  let panel = null;
  let titleEl = null;
  let rows = null;
  const qualityButtons = {};

  if (host && typeof document !== 'undefined') {
    panel = document.createElement('div');
    panel.id = 'bench-telemetry-overlay';
    panel.style.cssText =
      'position:absolute;top:52px;left:12px;z-index:45;min-width:270px;padding:10px 12px;' +
      'background:rgba(8,14,26,0.88);border:1px solid #38bdf8;border-radius:6px;' +
      'color:#e2e8f0;font:12px/1.45 monospace;pointer-events:auto;';

    titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-weight:bold;color:#38bdf8;margin-bottom:6px;';
    panel.appendChild(titleEl);

    rows = {};
    const rowKeys = [
      'elapsed',
      'activeUnits',
      'avgFps',
      'p99Frame',
      'simAvg',
      'drawCalls',
      'heapDelta',
      'quality'
    ];
    for (const key of rowKeys) {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;justify-content:space-between;gap:12px;';
      const lbl = document.createElement('span');
      const val = document.createElement('span');
      r.appendChild(lbl);
      r.appendChild(val);
      panel.appendChild(r);
      rows[key] = { lbl, val };
    }

    const qBar = document.createElement('div');
    qBar.style.cssText = 'display:flex;gap:6px;margin-top:8px;';
    for (const qid of ['ultra', 'high', 'balanced']) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = qid.toUpperCase();
      btn.style.cssText =
        'flex:1;padding:3px 6px;border:1px solid #475569;border-radius:4px;' +
        'background:#1e293b;color:#e2e8f0;cursor:pointer;font:11px monospace;';
      btn.addEventListener('click', () => {
        currentQualityId = qid;
        if (typeof options.onChangeQuality === 'function') {
          options.onChangeQuality(qid);
        }
        render(true);
      });
      qBar.appendChild(btn);
      qualityButtons[qid] = btn;
    }
    panel.appendChild(qBar);
    host.appendChild(panel);
  }

  function recordFrame({ frameMs = 16.6, simMs = 0, drawCalls = 0, activeUnits = 0 }) {
    if (frameSamples.length >= MAX_SAMPLES) frameSamples.shift();
    frameSamples.push(frameMs);
    if (simMs > 0) {
      if (simSamples.length >= MAX_SAMPLES) simSamples.shift();
      simSamples.push(simMs);
    }
    lastDrawCalls = drawCalls;
    lastActiveUnits = activeUnits;
    render(false);
  }

  function getSnapshot() {
    let sumFrame = 0;
    for (let i = 0; i < frameSamples.length; i++) sumFrame += frameSamples[i];
    const avgFrameMs = frameSamples.length > 0 ? sumFrame / frameSamples.length : 16.67;
    const avgFps = avgFrameMs > 0 ? 1000 / avgFrameMs : 60;
    const p99FrameMs = computePercentile(frameSamples, 0.99);

    let sumSim = 0;
    for (let i = 0; i < simSamples.length; i++) sumSim += simSamples[i];
    const simAvgMs = simSamples.length > 0 ? sumSim / simSamples.length : 0;

    const curHeap =
      typeof performance !== 'undefined' && performance.memory ? performance.memory.usedJSHeapSize : null;
    const heapDeltaMb =
      baseHeapBytes !== null && curHeap !== null ? (curHeap - baseHeapBytes) / (1024 * 1024) : null;

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsedSec = Math.max(0, (nowMs - startTimeMs) * 0.001);

    return {
      elapsedSec,
      avgFps,
      p99FrameMs,
      simAvgMs,
      drawCalls: lastDrawCalls,
      activeUnits: lastActiveUnits,
      heapDeltaMb,
      qualityId: currentQualityId
    };
  }

  function render(force = false) {
    if (!panel || !rows) return;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && nowMs - lastRenderMs < 400) return;
    lastRenderMs = nowMs;

    const snap = getSnapshot();
    titleEl.textContent = t('bench.title');

    rows.elapsed.lbl.textContent = t('bench.elapsed');
    rows.elapsed.val.textContent = `${snap.elapsedSec.toFixed(1)}s / 60s`;

    rows.activeUnits.lbl.textContent = t('bench.activeUnits');
    rows.activeUnits.val.textContent = `${snap.activeUnits}`;

    rows.avgFps.lbl.textContent = t('bench.avgFps');
    rows.avgFps.val.textContent = `${snap.avgFps.toFixed(1)}`;

    rows.p99Frame.lbl.textContent = t('bench.p99Frame');
    rows.p99Frame.val.textContent = `${snap.p99FrameMs.toFixed(2)} ms`;

    const simOk = snap.simAvgMs <= 2.0;
    rows.simAvg.lbl.textContent = t('bench.simAvg');
    rows.simAvg.val.textContent = `${snap.simAvgMs.toFixed(3)} ms [${simOk ? t('bench.pass') : t('bench.warn')}]`;
    rows.simAvg.val.style.color = simOk ? '#4ade80' : '#f87171';

    const dcOk = snap.drawCalls < 140;
    rows.drawCalls.lbl.textContent = t('bench.drawCalls');
    rows.drawCalls.val.textContent = `${snap.drawCalls} [${dcOk ? t('bench.pass') : t('bench.warn')}]`;
    rows.drawCalls.val.style.color = dcOk ? '#4ade80' : '#f87171';

    rows.heapDelta.lbl.textContent = t('bench.heapDelta');
    rows.heapDelta.val.textContent = snap.heapDeltaMb !== null ? `${snap.heapDeltaMb.toFixed(2)} MB` : 'N/A';

    rows.quality.lbl.textContent = t('bench.quality');
    rows.quality.val.textContent = snap.qualityId.toUpperCase();

    for (const [qid, btn] of Object.entries(qualityButtons)) {
      btn.style.borderColor = qid === currentQualityId ? '#38bdf8' : '#475569';
      btn.style.color = qid === currentQualityId ? '#38bdf8' : '#e2e8f0';
    }
  }

  onLocaleChange(() => render(true));
  render(true);

  return {
    recordFrame,
    getSnapshot,
    setQuality(qid) {
      currentQualityId = qid;
      render(true);
    },
    destroy() {
      if (panel && panel.parentElement) panel.parentElement.removeChild(panel);
    }
  };
}
