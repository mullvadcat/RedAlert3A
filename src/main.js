// Browser Runtime Entrypoint & Fixed 30 Hz Accumulator Bridge (L1 App Shell).
// Connects pure simulation core, WebGL2 rendering pipeline, Sidebar/Minimap UI, and Input Controller.

import { CANONICAL_ENTITY_IDS, ENTITY_DEFS, TICK_DT } from './core/config.js';
import { createGameState, enqueueCommand, stepSimulation } from './core/engine.js';
import { initI18n, onLocaleChange, t } from './core/i18n.js';
import { createAudioMixer } from './core/mixer.js';
import {
  createDefaultCampaignProfile,
  loadCampaignProfile,
  loadCheckpointFromDb,
  recordMissionVictory,
  saveCampaignProfile,
  saveCheckpointToDb
} from './core/save.js';
import { createDialogueController } from './story/dialogue.js';
import { resolveDirectorChoice } from './story/director.js';
import { deployEntity, spawnEntity } from './gameplay/entities.js';
import { createRenderPipeline } from './render/pipeline.js';
import { createSidebarUI } from './ui/sidebar.js';
import { createMinimapUI } from './ui/minimap.js';
import { createInputController } from './ui/input.js';
import { createLobbyMenu } from './ui/menus.js';
import { spawnBuildingDebris, stepDebrisSystem } from './world/destruction.js';
import { MAP_SIZE, TERRAIN, getElevationAtWorld } from './world/map.js';
import { getSkirmishMapById } from './world/skirmishMaps.js';

function parseLaunchFlags() {
  const params = new URLSearchParams(window.location.search);
  return {
    lang: params.get('lang') === 'en-US' ? 'en-US' : (params.get('lang') === 'zh-CN' ? 'zh-CN' : undefined),
    noFog: params.get('nofog') === '1',
    fastBuild: params.get('fastbuild') === '1',
    bench: params.get('bench') === '1',
    show: params.get('show') || null,
    quality: params.get('quality') || 'high',
    mapId: params.get('map') || null,
    mission: params.get('mission') || null,
    openMenu: params.get('menu') === '1'
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

  const isGallery = flags.show === 'gallery';

  let state = createGameState({
    mode: isGallery ? 'gallery' : (flags.mission ? 'campaign' : (flags.bench ? 'bench_m1' : 'skirmish')),
    missionId: flags.mission,
    populateDefault: !isGallery,
    fastBuild: flags.fastBuild || isGallery,
    noFog: flags.noFog,
    mapBlueprint: flags.mapId ? getSkirmishMapById(flags.mapId) : undefined
  });

  if (isGallery) {
    // Flatten showcase plaza (gx/gz 96..160 -> world 192..320) so all 49 land/air/naval models stand clearly
    for (let gz = 96; gz <= 160; gz++) {
      for (let gx = 96; gx <= 160; gx++) {
        const idx = gz * MAP_SIZE + gx;
        state.map.terrain[idx] = TERRAIN.LAND;
        state.map.elevation[idx] = 1.6;
        state.map.oreAmount[idx] = 0;
        state.map.buildingId[idx] = 0;
      }
    }
    const cols = 7;
    const spacing = 14;
    for (let i = 0; i < CANONICAL_ENTITY_IDS.length; i++) {
      const typeId = CANONICAL_ENTITY_IDS[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const wx = 256 + (col - 3) * spacing;
      const wz = 256 + (row - 3) * spacing;
      const ent = spawnEntity(state, {
        typeId,
        playerId: 0,
        teamId: 0,
        factionId: 'abyssal',
        x: wx,
        z: wz,
        yaw: Math.PI * 0.15
      });
      ent.y = Math.max(1.6, ent.y);
      ent.prevY = ent.y;
      ent.orderType = 'HOLD';
    }
  }

  setLoadingProgress(85, 'loading.compilingMap');
  pipeline.syncTerrainMap(state.map, 0, true);

  const uiState = {
    activeTab: 'main',
    activeSubTab: 'air',
    placementTypeId: null,
    hoverFootprint: null,
    placementValid: false,
    cursorMode: 'default',
    pendingPower: null,
    lobbyOpen: flags.openMenu,
    selectedIds: new Set(),
    noFog: flags.noFog || isGallery,
    isBench: flags.bench,
    isGallery,
    lastAlertPos: null
  };

  // Focus camera nicely on starting base, M1 central combat (?bench=1), or gallery showcase
  if (isGallery) {
    pipeline.camera.jumpTo(256, 256);
    pipeline.camera.zoom(68 - pipeline.camera.height);
  } else if (flags.bench) {
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
  const mixer = createAudioMixer();
  const dialogueCtrl = createDialogueController();
  const sidebarUI = createSidebarUI(state, uiState, { enqueue });
  const minimapUI = createMinimapUI(state, uiState, pipeline.camera, enqueue);
  const inputCtrl = createInputController(canvas, state, uiState, pipeline, sidebarUI, enqueue);

  let campaignProfile = createDefaultCampaignProfile();
  let choiceModalEl = null;

  function hideChoicePrompt() {
    if (choiceModalEl && choiceModalEl.parentElement) {
      choiceModalEl.parentElement.removeChild(choiceModalEl);
    }
    choiceModalEl = null;
  }

  function showChoicePrompt(payload) {
    hideChoicePrompt();
    const host = document.getElementById('viewport-container') || document.body;
    if (!host) return;
    const overlay = document.createElement('div');
    overlay.id = 'director-choice-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(4,10,20,0.68);z-index:60;';

    const card = document.createElement('div');
    card.className = 'modal-card';
    card.style.cssText = 'max-width:440px;padding:18px;border:1px solid #38bdf8;background:#0b1322;color:#e2e8f0;border-radius:8px;';

    const title = document.createElement('h3');
    title.textContent = payload.titleKey ? t(payload.titleKey) : '';
    card.appendChild(title);

    const body = document.createElement('p');
    body.textContent = payload.bodyKey ? t(payload.bodyKey) : '';
    body.style.margin = '8px 0 14px';
    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const choices = payload.choices ?? [];
    for (let i = 0; i < choices.length; i++) {
      const ch = choices[i];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = i === 0 ? 'btn-primary' : 'btn-secondary';
      btn.textContent = ch.labelKey ? t(ch.labelKey) : String(i + 1);
      btn.addEventListener('click', () => {
        resolveDirectorChoice(state, i);
        hideChoicePrompt();
      });
      actions.appendChild(btn);
    }
    card.appendChild(actions);
    overlay.appendChild(card);
    host.appendChild(overlay);
    choiceModalEl = overlay;
  }

  function applyLoadedGameState(nextState, focusCamera = true) {
    state = nextState;
    uiState.selectedIds.clear();
    uiState.placementTypeId = null;
    uiState.cursorMode = 'default';
    uiState.pendingPower = null;
    hideChoicePrompt();
    pipeline.syncTerrainMap(state.map, 0, true);
    pipeline.shadowSys.invalidateCache();
    sidebarUI.setState(state);
    minimapUI.setState(state);
    inputCtrl.setState(state);
    if (focusCamera) {
      const startUnit = state.entities.find((e) => e.alive && e.playerId === 0);
      if (startUnit) {
        pipeline.camera.jumpTo(startUnit.x, startUnit.z);
        uiState.selectedIds.add(startUnit.id);
      }
    }
    accumulator = 0;
  }

  function launchSkirmishMatch(cfg) {
    applyLoadedGameState(createGameState({
      mode: 'skirmish',
      mapBlueprint: cfg.mapBlueprint,
      players: cfg.players,
      startingCredits: cfg.startingCredits,
      factionId: cfg.factionId,
      aiDifficulty: cfg.aiDifficulty,
      skirmishFairStart: cfg.skirmishFairStart ?? true,
      fastBuild: flags.fastBuild,
      noFog: flags.noFog
    }), true);
  }

  function launchCampaignMission(missionId, aiDifficulty) {
    applyLoadedGameState(createGameState({
      mode: 'campaign',
      missionId,
      aiDifficulty: aiDifficulty || 'normal',
      fastBuild: flags.fastBuild,
      noFog: flags.noFog
    }), true);
  }

  const lobbyCtrl = createLobbyMenu(uiState, {
    openInitially: flags.openMenu,
    initialTab: flags.mission ? 'campaign' : 'skirmish',
    initialMapId: flags.mapId,
    profile: campaignProfile,
    onLaunchSkirmish: launchSkirmishMatch,
    onLaunchCampaign: launchCampaignMission,
    onSaveCheckpoint: () => {
      saveCheckpointToDb('manual', state, 'manual');
    },
    onLoadCheckpoint: async () => {
      const cp = (await loadCheckpointFromDb('manual')) ?? (await loadCheckpointFromDb('autosave'));
      if (cp?.state) {
        applyLoadedGameState(cp.state, false);
        lobbyCtrl.close();
      }
    }
  });

  loadCampaignProfile().then((loaded) => {
    if (loaded) {
      campaignProfile = loaded;
      lobbyCtrl.setProfile(campaignProfile);
    }
  });

  const handleAudioUnlock = () => {
    mixer.unlock();
    window.removeEventListener('pointerdown', handleAudioUnlock);
    window.removeEventListener('keydown', handleAudioUnlock);
  };
  window.addEventListener('pointerdown', handleAudioUnlock);
  window.addEventListener('keydown', handleAudioUnlock);
  onLocaleChange(() => dialogueCtrl.refreshLocale());

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
        mixer.playSfx('explosion');
      } else if (ev.type === 'combat:fire') {
        const isBeam = ev.damageType === 'Prism' || ev.damageType === 'Tesla' || ev.damageType === 'Chrono';
        mixer.playSfx(ev.damageType === 'Tesla' ? 'tesla' : (isBeam ? 'laser' : 'cannon'));
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
      } else if (ev.type === 'entity:destroyed') {
        const def = ENTITY_DEFS[ev.typeId];
        if (def?.isBuilding) {
          pipeline.shadowSys.invalidateCache();
          mixer.playSfx('explosion');
          spawnBuildingDebris(
            pipeline.debrisSys,
            ev.entityId ?? ev.id ?? 0,
            state.tickCount,
            ev.x,
            ev.y ?? 1.6,
            ev.z,
            def.footprintW,
            def.footprintH,
            pipeline.quality.debrisScale
          );
        }
      } else if (ev.type === 'building:placed') {
        pipeline.shadowSys.invalidateCache();
        if (ev.playerId === 0) {
          mixer.playEvaNotice('building_placed');
          if (ev.typeId === 'refinery') {
            sidebarUI.setStatusNotice('hud.status.harvesterSpawned', 4.5);
          }
        }
      } else if (ev.type === 'unit:deployed') {
        if (ev.typeId === 'conyard') {
          pipeline.shadowSys.invalidateCache();
          if (ev.playerId === 0) {
            sidebarUI.setStatusNotice('hud.status.deployed', 4.5);
            mixer.playEvaNotice('deployed');
            dialogueCtrl.showDialogue('EVA', 'hud.status.deployed', 4.5);
          }
        }
      } else if (ev.type === 'fx:chronoWarp') {
        mixer.playSfx('laser');
        for (const [px, pz] of [[ev.x, ev.z], [ev.tx, ev.tz]]) {
          pipeline.pushTransientFx({
            kind: 'order',
            x: px,
            y: getElevationAtWorld(state.map, px, pz) + 0.3,
            z: pz,
            r: 0.25,
            g: 0.95,
            b: 1.0,
            startSec: elapsedSec,
            duration: 0.65
          });
        }
      } else if (ev.type === 'fx:nukeBlast') {
        mixer.playSfx('explosion');
        const by = getElevationAtWorld(state.map, ev.x, ev.z);
        pipeline.decalPool.addDecal(ev.x, by, ev.z, 12.0, 0.2, 0.25, 0.95);
        pipeline.pushTransientFx({
          kind: 'explosion',
          x: ev.x,
          y: by + 1.0,
          z: ev.z,
          scale: 6.5,
          startSec: elapsedSec,
          duration: 1.4
        });
      } else if (ev.type === 'fx:lightningStrike') {
        mixer.playSfx('tesla');
        pipeline.pushTransientFx({
          kind: 'beam',
          x: ev.x,
          y: 26.0,
          z: ev.z,
          tx: ev.x,
          tz: ev.z,
          r: 0.45,
          g: 0.85,
          b: 1.0,
          startSec: elapsedSec,
          duration: 0.28
        });
      } else if (ev.type === 'fx:ironCurtain') {
        mixer.playSfx('laser');
        pipeline.pushTransientFx({
          kind: 'order',
          x: ev.x,
          y: getElevationAtWorld(state.map, ev.x, ev.z) + 0.5,
          z: ev.z,
          r: 0.95,
          g: 0.15,
          b: 0.18,
          startSec: elapsedSec,
          duration: 0.85
        });
      } else if (ev.type === 'sw:warning') {
        mixer.playEvaNotice('sw_warning');
      } else if (ev.type === 'hud:notice') {
        if (ev.playerId === 0) {
          sidebarUI.setStatusNotice(ev.key, 4.0);
          mixer.playEvaNotice(ev.key);
          if (typeof ev.x === 'number' && typeof ev.z === 'number') {
            uiState.lastAlertPos = { x: ev.x, z: ev.z };
          }
        }
      } else if (ev.type === 'director:cameraPan') {
        pipeline.camera.jumpTo(ev.x, ev.z);
      } else if (ev.type === 'director:dialogue') {
        const speakerKey = ev.speakerId ? `speaker.${ev.speakerId}` : 'speaker.eva_abyssal';
        dialogueCtrl.showDialogue(speakerKey, ev.localeKey, ev.durationSec ?? 5, ev.accentHex ?? '#38bdf8');
      } else if (ev.type === 'director:checkpoint') {
        saveCheckpointToDb('autosave', state, ev.label ?? 'auto');
      } else if (ev.type === 'director:choicePrompt') {
        showChoicePrompt(ev);
      } else if (ev.type === 'match:ended' || ev.type === 'match:victory') {
        if (state.mode === 'campaign' && state.missionId && ev.winnerTeamId === 0) {
          campaignProfile = recordMissionVictory(campaignProfile, state.missionId);
          saveCampaignProfile(campaignProfile);
          lobbyCtrl.setProfile(campaignProfile);
        }
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

  let galleryCtrl = null;
  if (isGallery) {
    let focusIndex = 0;
    let factionRed = false;
    let damagedMode = false;

    const panel = document.createElement('div');
    panel.id = 'gallery-panel';
    panel.style.cssText = 'position:fixed;top:12px;left:12px;z-index:50;background:rgba(10,16,26,0.9);border:1px solid #3c5472;padding:12px;border-radius:6px;color:#e8eef6;font:12px/1.4 sans-serif;max-width:340px;';

    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-weight:700;font-size:13px;margin-bottom:4px;color:#62d2ff;';
    panel.appendChild(titleEl);

    const focusLabelEl = document.createElement('div');
    focusLabelEl.style.cssText = 'margin-bottom:8px;color:#cbd8e8;';
    panel.appendChild(focusLabelEl);

    const btnGrid = document.createElement('div');
    btnGrid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:6px;';
    panel.appendChild(btnGrid);

    const mkBtn = (key, handler) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.style.cssText = 'padding:5px 8px;background:#1c293d;border:1px solid #486488;color:#eaf2fc;border-radius:4px;cursor:pointer;font-size:11px;';
      btn.dataset.localeKey = key;
      btn.textContent = t(key);
      btn.addEventListener('click', handler);
      btnGrid.appendChild(btn);
      return btn;
    };

    const refreshGalleryLabels = () => {
      titleEl.textContent = t('gallery.title');
      const ent = state.entities[focusIndex];
      const nameStr = ent ? t(`unit.${ent.typeId}.name`) : '';
      focusLabelEl.textContent = ent ? `[${focusIndex + 1}/${state.entities.length}] ${nameStr} (${ent.typeId})` : '';
      const btns = btnGrid.querySelectorAll('button');
      for (let i = 0; i < btns.length; i++) {
        btns[i].textContent = t(btns[i].dataset.localeKey);
      }
    };

    const focusEntity = (idxOrId) => {
      let idx = typeof idxOrId === 'number'
        ? ((idxOrId % state.entities.length) + state.entities.length) % state.entities.length
        : state.entities.findIndex((e) => e.typeId === idxOrId);
      if (idx < 0) idx = 0;
      focusIndex = idx;
      const ent = state.entities[focusIndex];
      if (ent) {
        uiState.selectedIds.clear();
        uiState.selectedIds.add(ent.id);
        pipeline.camera.jumpTo(ent.x, ent.z);
        pipeline.camera.zoom(20 - pipeline.camera.height);
      }
      refreshGalleryLabels();
    };

    const toggleFaction = () => {
      factionRed = !factionRed;
      for (let i = 0; i < state.entities.length; i++) {
        const ent = state.entities[i];
        ent.playerId = factionRed ? 1 : 0;
        ent.factionId = factionRed ? 'crimson' : 'abyssal';
      }
    };

    const toggleDamage = () => {
      damagedMode = !damagedMode;
      for (let i = 0; i < state.entities.length; i++) {
        const ent = state.entities[i];
        ent.hp = damagedMode ? Math.max(1, Math.round(ent.maxHp * 0.35)) : ent.maxHp;
      }
    };

    const triggerAction = () => {
      const nowSec = performance.now() * 0.001;
      for (let i = 0; i < state.entities.length; i++) {
        const ent = state.entities[i];
        ent.turretYaw += 0.65;
        ent.recoil = 0.42;
      }
      const focused = state.entities[focusIndex];
      if (focused) {
        if (focused.typeId === 'gi') deployEntity(state, focused);
        pipeline.pushTransientFx({
          kind: 'beam',
          x: focused.x,
          y: focused.y + 1.4,
          z: focused.z,
          tx: focused.x + Math.sin(focused.turretYaw) * 9,
          tz: focused.z + Math.cos(focused.turretYaw) * 9,
          r: factionRed ? 1.0 : 0.35,
          g: factionRed ? 0.35 : 0.92,
          b: factionRed ? 0.25 : 1.0,
          startSec: nowSec,
          duration: 0.35
        });
      }
    };

    const triggerCollapse = () => {
      const focused = state.entities[focusIndex] ?? state.entities[0];
      if (!focused) return;
      const def = ENTITY_DEFS[focused.typeId];
      spawnBuildingDebris(
        pipeline.debrisSys,
        focused.id,
        state.tickCount + 1,
        focused.x,
        focused.y,
        focused.z,
        def?.footprintW ?? 2,
        def?.footprintH ?? 2,
        pipeline.quality.debrisScale
      );
      mixer.playSfx('explosion');
    };

    mkBtn('gallery.prev', () => focusEntity(focusIndex - 1));
    mkBtn('gallery.next', () => focusEntity(focusIndex + 1));
    mkBtn('gallery.faction', toggleFaction);
    mkBtn('gallery.damage', toggleDamage);
    mkBtn('gallery.action', triggerAction);
    mkBtn('gallery.collapse', triggerCollapse);
    mkBtn('gallery.overview', () => {
      pipeline.camera.jumpTo(256, 256);
      pipeline.camera.zoom(68 - pipeline.camera.height);
    });

    document.body.appendChild(panel);
    onLocaleChange(refreshGalleryLabels);
    refreshGalleryLabels();

    galleryCtrl = {
      entityCount: state.entities.length,
      focusEntity,
      toggleFaction,
      toggleDamage,
      triggerAction,
      triggerCollapse
    };
  }

  window.__RA3A__ = {
    get state() { return state; },
    uiState,
    pipeline,
    mixer,
    dialogueCtrl,
    lobbyCtrl,
    telemetry,
    gallery: galleryCtrl,
    enqueueCommand: enqueue,
    stepSimulation: () => stepSimulation(state),
    getEntityDef: (id) => ENTITY_DEFS[id] ?? null
  };

  function frameLoop(nowMs) {
    const dtSec = Math.min(0.1, Math.max(0, (nowMs - prevTimeMs) * 0.001));
    prevTimeMs = nowMs;
    const elapsedSec = nowMs * 0.001;

    const cutscene = state.directorState?.activeCutscene;
    if (cutscene) {
      const k = Math.min(1, dtSec * 5.0);
      const nx = pipeline.camera.targetX + (cutscene.x - pipeline.camera.targetX) * k;
      const nz = pipeline.camera.targetZ + (cutscene.z - pipeline.camera.targetZ) * k;
      pipeline.camera.jumpTo(nx, nz);
    } else {
      inputCtrl.updateCamera(dtSec);
    }

    if (isGallery) {
      for (let i = 0; i < state.entities.length; i++) {
        const ent = state.entities[i];
        ent.prevX = ent.x;
        ent.prevY = ent.y;
        ent.prevZ = ent.z;
        ent.recoil *= Math.pow(0.05, dtSec);
      }
    } else {
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
      mixer.updateCombatIntensity(state, dtSec);
    }

    stepDebrisSystem(
      pipeline.debrisSys,
      dtSec,
      (x, z) => getElevationAtWorld(state.map, x, z),
      (x, y, z) => pipeline.decalPool.addDecal(x, y, z, 1.1, 0, 0, 0.7)
    );
    dialogueCtrl.update(dtSec);

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
