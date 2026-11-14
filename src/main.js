// Browser Runtime Entrypoint & Fixed 30 Hz Accumulator Bridge (L1 App Shell).
// Connects pure simulation core, WebGL2 rendering pipeline, Sidebar/Minimap UI, and Input Controller.

import { ENTITY_DEFS, TICK_DT } from './core/config.js';
import { createGameState, enqueueCommand, stepSimulation } from './core/engine.js';
import { initI18n, t } from './core/i18n.js';
import { createRenderPipeline } from './render/pipeline.js';
import { createSidebarUI } from './ui/sidebar.js';
import { createMinimapUI } from './ui/minimap.js';
import { createInputController } from './ui/input.js';

function parseLaunchFlags() {
  const params = new URLSearchParams(window.location.search);
  return {
    lang: params.get('lang') === 'en-US' ? 'en-US' : (params.get('lang') === 'zh-CN' ? 'zh-CN' : undefined),
    noFog: params.get('nofog') === '1',
    fastBuild: params.get('fastbuild') === '1',
    bench: params.get('bench') === '1',
    quality: params.get('quality') || 'high'
  };
}

function setLoadingProgress(pct, textKey) {
  const bar = document.getElementById('loading-progress-bar');
  const status = document.getElementById('loading-status');
  const subtitle = document.getElementById('loading-subtitle');
  if (bar) bar.style.width = `${pct}%`;
  if (status) status.textContent = t(textKey);
  if (subtitle) subtitle.textContent = t('app.subtitle');
}

function bootstrap() {
  const flags = parseLaunchFlags();
  initI18n(flags.lang);

  setLoadingProgress(20, 'loading.initializing');

  const canvas = document.getElementById('game-canvas');
  const pipeline = createRenderPipeline(canvas, flags.quality);

  setLoadingProgress(55, 'loading.bakingPbr');

  const state = createGameState({
    mode: flags.bench ? 'bench_m1' : 'skirmish',
    fastBuild: flags.fastBuild
  });

  setLoadingProgress(85, 'loading.compilingMap');
  pipeline.syncTerrainMap(state.map, 0, true);

  const uiState = {
    activeTab: 'main',
    activeSubTab: 'air',
    placementTypeId: null,
    hoverFootprint: null,
    placementValid: false,
    cursorMode: 'default',
    selectedIds: new Set(),
    noFog: flags.noFog,
    isBench: flags.bench,
    lastAlertPos: null
  };

  // Focus camera nicely on starting base or M1 central combat in ?bench=1
  if (flags.bench) {
    pipeline.camera.jumpTo(256, 256);
    pipeline.camera.zoom(16);
  } else {
    const startUnit = state.entities.find((e) => e.alive && e.playerId === 0);
    if (startUnit) {
      pipeline.camera.jumpTo(startUnit.x, startUnit.z);
      uiState.selectedIds.add(startUnit.id);
    }
  }

  const enqueue = (cmd) => enqueueCommand(state, cmd);
  const sidebarUI = createSidebarUI(state, uiState, { enqueue });
  const minimapUI = createMinimapUI(state, uiState, pipeline.camera, enqueue);
  const inputCtrl = createInputController(canvas, state, uiState, pipeline, sidebarUI, enqueue);

  setLoadingProgress(100, 'loading.ready');
  const loadingScreen = document.getElementById('loading-screen');
  if (loadingScreen) loadingScreen.hidden = true;

  if (flags.bench) {
    sidebarUI.setStatusNotice('hud.status.benchActive', 10.0);
  }

  function consumeSimulationEvents(elapsedSec) {
    const events = state.events;
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'fx:explosion') {
        pipeline.decalPool.addDecal(ev.x, ev.y ?? 1.6, ev.z, 2.2 * (ev.scale ?? 1), (ev.x * 0.7) % Math.PI, 0, 0.88);
        pipeline.pushTransientFx({
          kind: 'explosion',
          x: ev.x,
          y: ev.y ?? 1.6,
          z: ev.z,
          scale: ev.scale ?? 1.0,
          startSec: elapsedSec,
          duration: 0.42
        });
      } else if (ev.type === 'combat:fire') {
        const isBeam = ev.damageType === 'Prism' || ev.damageType === 'Tesla' || ev.damageType === 'Chrono';
        if (isBeam) {
          const col = ev.damageType === 'Prism'
            ? [1.0, 0.92, 0.55]
            : (ev.damageType === 'Tesla' ? [0.42, 0.78, 1.0] : [0.35, 1.0, 0.92]);
          pipeline.pushTransientFx({
            kind: 'beam',
            x: ev.x,
            y: 2.3,
            z: ev.z,
            tx: ev.tx,
            tz: ev.tz,
            r: col[0],
            g: col[1],
            b: col[2],
            startSec: elapsedSec,
            duration: 0.22
          });
        }
      } else if (ev.type === 'building:placed') {
        pipeline.shadowSys.invalidateCache();
        if (ev.playerId === 0 && ev.typeId === 'refinery') {
          sidebarUI.setStatusNotice('hud.status.harvesterSpawned', 4.5);
        }
      } else if (ev.type === 'unit:deployed') {
        if (ev.typeId === 'conyard') {
          pipeline.shadowSys.invalidateCache();
          if (ev.playerId === 0) sidebarUI.setStatusNotice('hud.status.deployed', 4.5);
        }
      } else if (ev.type === 'hud:notice') {
        if (ev.playerId === 0) {
          sidebarUI.setStatusNotice(ev.key, 4.0);
          if (typeof ev.x === 'number' && typeof ev.z === 'number') {
            uiState.lastAlertPos = { x: ev.x, z: ev.z };
          }
        }
      } else if (ev.type === 'match:ended') {
        sidebarUI.showVictoryModal(ev.winnerTeamId);
      }
    }
  }

  let accumulator = 0;
  let prevTimeMs = performance.now();
  let fpsFrames = 0;
  let fpsLastSampleMs = prevTimeMs;
  let currentFps = 60;

  // Read-only / controlled harness handle for telemetry verification
  const telemetry = {
    drawCalls: 0,
    fps: 60,
    tick: 0,
    activeEntities: state.entities.length
  };

  window.__RA3A__ = {
    state,
    uiState,
    pipeline,
    telemetry,
    enqueueCommand: enqueue,
    stepSimulation: () => stepSimulation(state),
    getEntityDef: (id) => ENTITY_DEFS[id] ?? null
  };

  function frameLoop(nowMs) {
    const dtSec = Math.min(0.1, Math.max(0, (nowMs - prevTimeMs) * 0.001));
    prevTimeMs = nowMs;
    const elapsedSec = nowMs * 0.001;

    inputCtrl.updateCamera(dtSec);

    accumulator += dtSec;
    let steps = 0;
    while (accumulator >= TICK_DT && steps < 5) {
      stepSimulation(state);
      consumeSimulationEvents(elapsedSec);
      accumulator -= TICK_DT;
      steps++;
    }
    if (steps === 5 && accumulator > TICK_DT) {
      accumulator = 0;
    }

    const alpha = accumulator / TICK_DT;
    pipeline.renderFrame(state, alpha, uiState, elapsedSec);

    fpsFrames++;
    if (nowMs - fpsLastSampleMs >= 500) {
      currentFps = Math.round((fpsFrames * 1000) / Math.max(1, nowMs - fpsLastSampleMs));
      fpsFrames = 0;
      fpsLastSampleMs = nowMs;
    }

    telemetry.drawCalls = pipeline.info.render.calls;
    telemetry.fps = currentFps;
    telemetry.tick = state.tickCount;
    telemetry.activeEntities = state.entities.filter((e) => e.alive).length;

    sidebarUI.update(dtSec, telemetry);
    minimapUI.update();

    requestAnimationFrame(frameLoop);
  }

  requestAnimationFrame(frameLoop);
}

bootstrap();
