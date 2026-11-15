// 4-Level RTS Input Priority Stack + Marquee Box Select + Camera Navigation (L2 UI Layer).
// Enforces: 1) Modal > 2) Placement/Cursor Blocking > 3) Selection Hotkeys (A/S/D/K/X) > 4) Global Keys (Arrows/Q-T/1-9/H/Space/L).

import { ENTITY_DEFS, KEYMAP_DEFAULTS } from '../core/config.js';
import { toggleLocale } from '../core/i18n.js';
import { CELL_SIZE, MAP_SIZE, worldToGrid } from '../world/map.js';
import { isEntityTargetable } from '../gameplay/fogCpu.js';
import { canBoardTransport } from '../gameplay/entities.js';
import { validateBuildingPlacement } from '../gameplay/production.js';

export function createInputController(canvas, initialState, uiState, pipeline, sidebarUI, enqueue) {
  let state = initialState;
  const selectionBoxEl = document.getElementById('selection-box');
  const victoryModalEl = document.getElementById('victory-modal');
  const keysDown = new Set();

  // Control groups 1~9 -> Set of entity IDs
  const controlGroups = Array.from({ length: 10 }, () => []);
  let lastGroupTap = { idx: -1, timeMs: 0 };
  let lastClickInfo = { timeMs: 0, typeId: null };

  let pointerInsideViewport = false;
  let pointerOverInteractiveUi = false;
  let pointerClientX = 0;
  let pointerClientY = 0;
  let dragStart = null;
  let rightDragStart = null;
  let suppressNextContextMenu = false;
  let isMiddleOrbit = false;
  let isMiddlePan = false;
  let lastMiddleX = 0;
  let lastMiddleY = 0;
  let lastMiddleTapMs = 0;

  function findEntityAtWorld(wx, wz, filterFn = null) {
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!ent.alive) continue;
      if (filterFn && !filterFn(ent)) continue;

      const hitR = ent.isBuilding
        ? Math.max(ent.footprintW, ent.footprintH) * CELL_SIZE * 0.58
        : Math.max(1.5, (ent.radius ?? 1.0) * 1.45);
      const d = Math.hypot(ent.x - wx, ent.z - wz);
      if (d <= hitR && d < bestDist) {
        best = ent;
        bestDist = d;
      }
    }
    return best;
  }

  function updatePlacementPreview(clientX, clientY) {
    if (!uiState.placementTypeId) {
      uiState.hoverFootprint = null;
      uiState.placementValid = false;
      return;
    }
    const def = ENTITY_DEFS[uiState.placementTypeId];
    if (!def) return;
    const hit = pipeline.camera.screenToWorld(clientX, clientY, 1.6);
    const gx = Math.max(1, Math.min(MAP_SIZE - def.footprintW - 1, worldToGrid(hit.x) - Math.floor(def.footprintW * 0.5)));
    const gz = Math.max(1, Math.min(MAP_SIZE - def.footprintH - 1, worldToGrid(hit.z) - Math.floor(def.footprintH * 0.5)));
    const check = validateBuildingPlacement(state, 0, uiState.placementTypeId, gx, gz);
    uiState.hoverFootprint = { gx, gz, w: def.footprintW, h: def.footprintH };
    uiState.placementValid = check.valid;
  }

  function jumpToHomeBase() {
    const conyard = state.entities.find((e) => e.alive && e.playerId === 0 && e.typeId === 'conyard')
      ?? state.entities.find((e) => e.alive && e.playerId === 0 && e.typeId === 'mcv')
      ?? state.entities.find((e) => e.alive && e.playerId === 0);
    if (conyard) {
      pipeline.camera.jumpTo(conyard.x, conyard.z);
    }
  }

  function jumpToCentroid(ids) {
    let sx = 0;
    let sz = 0;
    let count = 0;
    for (const id of ids) {
      const ent = state.entityById.get(id);
      if (ent && ent.alive) {
        sx += ent.x;
        sz += ent.z;
        count++;
      }
    }
    if (count > 0) pipeline.camera.jumpTo(sx / count, sz / count);
  }

  function cancelCursorOrPlacement() {
    uiState.placementTypeId = null;
    uiState.hoverFootprint = null;
    uiState.cursorMode = 'default';
    uiState.pendingPower = null;
  }

  // === 4-Level Keyboard Priority Stack ===
  window.addEventListener('keydown', (e) => {
    keysDown.add(e.code);

    // Level 1: Modal Open
    if (sidebarUI.isModalOpen()) {
      if (e.code === KEYMAP_DEFAULTS.cancel) {
        victoryModalEl.hidden = true;
      }
      return;
    }

    // Level 2: Placement / Special Cursor Mode / Pending Power Blocking
    const inPlacementOrTool =
      Boolean(uiState.placementTypeId) ||
      Boolean(uiState.pendingPower) ||
      uiState.cursorMode === 'repair' ||
      uiState.cursorMode === 'sell';
    if (uiState.placementTypeId || uiState.pendingPower || uiState.cursorMode !== 'default') {
      if (e.code === KEYMAP_DEFAULTS.cancel) {
        e.preventDefault();
        cancelCursorOrPlacement();
        return;
      }
      // Strictly swallow unit hotkeys A/S/D while placing, repairing, or selling
      if (
        inPlacementOrTool &&
        (e.code === KEYMAP_DEFAULTS.attackMove || e.code === KEYMAP_DEFAULTS.stop || e.code === KEYMAP_DEFAULTS.deploy)
      ) {
        e.preventDefault();
        return;
      }
    }

    // Level 3: Selected Entity Command Hotkeys
    const selectedIds = Array.from(uiState.selectedIds);
    if (selectedIds.length > 0 && !inPlacementOrTool) {
      if (e.code === KEYMAP_DEFAULTS.attackMove) {
        e.preventDefault();
        uiState.cursorMode = 'attackMove';
        return;
      }
      if (e.code === KEYMAP_DEFAULTS.stop) {
        e.preventDefault();
        enqueue({ playerId: 0, type: 'STOP', entityIds: selectedIds });
        return;
      }
      if (e.code === KEYMAP_DEFAULTS.deploy) {
        e.preventDefault();
        enqueue({ playerId: 0, type: 'DEPLOY', entityIds: selectedIds });
        return;
      }
    }

    // Level 4: Global Hotkeys (Tabs, Tools, Control Groups 1-9, Home, Alert, Language)
    if (e.code === KEYMAP_DEFAULTS.repairMode) {
      uiState.placementTypeId = null;
      uiState.cursorMode = uiState.cursorMode === 'repair' ? 'default' : 'repair';
      return;
    }
    if (e.code === KEYMAP_DEFAULTS.sellMode) {
      uiState.placementTypeId = null;
      uiState.cursorMode = uiState.cursorMode === 'sell' ? 'default' : 'sell';
      return;
    }
    if (e.code === KEYMAP_DEFAULTS.tabMain) { uiState.activeTab = 'main'; return; }
    if (e.code === KEYMAP_DEFAULTS.tabDefense) { uiState.activeTab = 'defense'; return; }
    if (e.code === KEYMAP_DEFAULTS.tabInfantry) { uiState.activeTab = 'infantry'; return; }
    if (e.code === KEYMAP_DEFAULTS.tabVehicle) { uiState.activeTab = 'vehicle'; return; }
    if (e.code === KEYMAP_DEFAULTS.tabAirNaval) {
      if (uiState.activeTab === 'air_naval') {
        uiState.activeSubTab = uiState.activeSubTab === 'air' ? 'naval' : 'air';
      } else {
        uiState.activeTab = 'air_naval';
      }
      return;
    }

    if (e.code === KEYMAP_DEFAULTS.homeBase) {
      jumpToHomeBase();
      return;
    }
    if (e.code === KEYMAP_DEFAULTS.jumpAlert) {
      e.preventDefault();
      if (uiState.lastAlertPos) {
        pipeline.camera.jumpTo(uiState.lastAlertPos.x, uiState.lastAlertPos.z);
      } else {
        jumpToHomeBase();
      }
      return;
    }
    if (e.code === KEYMAP_DEFAULTS.toggleLocale) {
      toggleLocale();
      return;
    }

    // Commander Doctrines F1..F4
    const doctrineHotkeys = {
      [KEYMAP_DEFAULTS.doctrine1]: 'recon_satellite',
      [KEYMAP_DEFAULTS.doctrine2]: 'paratroopers',
      [KEYMAP_DEFAULTS.doctrine3]: 'nano_repair',
      [KEYMAP_DEFAULTS.doctrine4]: 'emp_strike'
    };
    const doctrineId = doctrineHotkeys[e.code];
    if (doctrineId) {
      e.preventDefault();
      uiState.placementTypeId = null;
      uiState.cursorMode = 'default';
      uiState.pendingPower = { kind: 'doctrine', id: doctrineId, sourceX: null, sourceZ: null };
      sidebarUI.setStatusNotice('hud.status.selectTarget', 4.0);
      return;
    }

    // Control groups 1..9
    if (e.code.startsWith('Digit') && e.code.length === 6) {
      const idx = Number(e.code[5]);
      if (idx >= 1 && idx <= 9) {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          controlGroups[idx] = Array.from(uiState.selectedIds);
        } else {
          const aliveIds = controlGroups[idx].filter((id) => state.entityById.get(id)?.alive);
          controlGroups[idx] = aliveIds;
          if (aliveIds.length > 0) {
            uiState.selectedIds = new Set(aliveIds);
            const now = performance.now();
            if (lastGroupTap.idx === idx && now - lastGroupTap.timeMs < 350) {
              jumpToCentroid(aliveIds);
            }
            lastGroupTap = { idx, timeMs: now };
          }
        }
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    keysDown.delete(e.code);
  });

  window.addEventListener('blur', () => {
    keysDown.clear();
    pointerInsideViewport = false;
    pointerOverInteractiveUi = false;
    rightDragStart = null;
    isMiddlePan = false;
    isMiddleOrbit = false;
    canvas.style.cursor = '';
  });

  document.addEventListener('mouseleave', () => {
    pointerInsideViewport = false;
    pointerOverInteractiveUi = false;
  });

  // === Canvas & Viewport Mouse Controls ===
  const viewportEl = canvas.parentElement;
  if (viewportEl) {
    viewportEl.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('contextmenu', (e) => {
    if (suppressNextContextMenu) {
      e.preventDefault();
      suppressNextContextMenu = false;
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.shiftKey && Math.abs(e.deltaY) > 0 && Math.abs(e.deltaX) < 1) {
      const panScale = (14 + pipeline.camera.height * 0.4) * 0.002;
      pipeline.camera.pan(e.deltaY * panScale, 0);
      return;
    }
    if (Math.abs(e.deltaX) >= 3) {
      const panScale = (14 + pipeline.camera.height * 0.4) * 0.002;
      pipeline.camera.pan(e.deltaX * panScale, 0);
    }
    if (Math.abs(e.deltaY) > 0) {
      pipeline.camera.zoom(e.deltaY * 0.03);
    }
  }, { passive: false });

  function handleRightClickAction(clientX, clientY) {
    // Right-click cancels placement, pending power, or cursor mode first
    if (uiState.placementTypeId || uiState.pendingPower || uiState.cursorMode !== 'default') {
      cancelCursorOrPlacement();
      return;
    }

    if (uiState.selectedIds.size === 0) return;
    const world = pipeline.camera.screenToWorld(clientX, clientY, 1.6);
    const selectedList = Array.from(uiState.selectedIds);

    const selectedEntities = selectedList
      .map((id) => state.entityById.get(id))
      .filter((ent) => ent && ent.alive);
    const selectedHasEngineer = selectedEntities.some((ent) => ent.typeId === 'engineer');

    // Check if targeting an enemy, neutral interactable (engineer), or friendly transport (boarding)
    const enemyTarget = findEntityAtWorld(
      world.x,
      world.z,
      (ent) => {
        if (ent.teamId !== 0 && ent.teamId !== 3) {
          return uiState.noFog || isEntityTargetable(state, 0, ent);
        }
        if (selectedHasEngineer && ent.isBuilding && (ent.teamId === 3 || (ent.playerId === 0 && ent.hp < ent.maxHp))) {
          return true;
        }
        if (ent.playerId === 0 && selectedEntities.some((unit) => canBoardTransport(ent, unit))) {
          return true;
        }
        return false;
      }
    );

    if (enemyTarget) {
      enqueue({ playerId: 0, type: 'ATTACK', entityIds: selectedList, targetId: enemyTarget.id });
      pipeline.pushTransientFx({
        kind: 'order',
        x: enemyTarget.x,
        y: enemyTarget.y ?? 1.6,
        z: enemyTarget.z,
        r: 1.0,
        g: 0.25,
        b: 0.2,
        startSec: performance.now() * 0.001,
        duration: 0.45
      });
      return;
    }

    const hasMobile = selectedList.some((id) => {
      const ent = state.entityById.get(id);
      return ent && ent.alive && !ent.isBuilding && ent.playerId === 0;
    });

    if (hasMobile) {
      enqueue({ playerId: 0, type: 'MOVE', entityIds: selectedList, x: world.x, z: world.z });
      pipeline.pushTransientFx({
        kind: 'order',
        x: world.x,
        y: 1.6,
        z: world.z,
        r: 0.25,
        g: 0.95,
        b: 0.45,
        startSec: performance.now() * 0.001,
        duration: 0.42
      });
    } else {
      enqueue({ playerId: 0, type: 'SET_RALLY', entityIds: selectedList, x: world.x, z: world.z });
    }
  }

  canvas.addEventListener('mousedown', (e) => {
    e.preventDefault();
    canvas.focus();

    if (e.button === 1) {
      const now = performance.now();
      if (now - lastMiddleTapMs < 300) {
        pipeline.camera.resetOrientation();
      }
      lastMiddleTapMs = now;
      lastMiddleX = e.clientX;
      lastMiddleY = e.clientY;
      isMiddleOrbit = e.altKey;
      isMiddlePan = !e.altKey;
      canvas.style.cursor = 'grabbing';
      return;
    }

    if (e.button === 2) {
      rightDragStart = {
        x: e.clientX,
        y: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        active: false,
        orbit: e.altKey
      };
      return;
    }

    if (e.button === 0) {
      const world = pipeline.camera.screenToWorld(e.clientX, e.clientY, 1.6);

      // Active Superweapon or Commander Doctrine targeting
      if (uiState.pendingPower) {
        const pw = uiState.pendingPower;
        if (pw.kind === 'doctrine') {
          enqueue({ playerId: 0, type: 'USE_DOCTRINE', typeId: pw.id, x: world.x, z: world.z });
          uiState.pendingPower = null;
          pipeline.pushTransientFx({
            kind: 'order',
            x: world.x,
            y: 1.8,
            z: world.z,
            r: 0.25,
            g: 0.92,
            b: 1.0,
            startSec: performance.now() * 0.001,
            duration: 0.6
          });
          return;
        }
        if (pw.kind === 'superweapon') {
          if (pw.id === 'chrono_sphere' && pw.sourceX === null) {
            pw.sourceX = world.x;
            pw.sourceZ = world.z;
            sidebarUI.setStatusNotice('hud.status.selectTarget', 4.0);
            pipeline.pushTransientFx({
              kind: 'order',
              x: world.x,
              y: 1.8,
              z: world.z,
              r: 0.3,
              g: 0.95,
              b: 1.0,
              startSec: performance.now() * 0.001,
              duration: 1.2
            });
            return;
          }
          enqueue({
            playerId: 0,
            type: 'FIRE_SUPERWEAPON',
            typeId: pw.id,
            sourceX: pw.sourceX ?? world.x,
            sourceZ: pw.sourceZ ?? world.z,
            x: world.x,
            z: world.z
          });
          uiState.pendingPower = null;
          return;
        }
      }

      // Active placement mode
      if (uiState.placementTypeId) {
        updatePlacementPreview(e.clientX, e.clientY);
        const fp = uiState.hoverFootprint;
        if (fp && uiState.placementValid) {
          enqueue({
            playerId: 0,
            type: 'PLACE_BUILDING',
            typeId: uiState.placementTypeId,
            x: fp.gx,
            z: fp.gz
          });
          cancelCursorOrPlacement();
        } else {
          sidebarUI.setStatusNotice('hud.status.placeInvalid', 3.0);
        }
        return;
      }

      // Repair / Sell modes
      if (uiState.cursorMode === 'repair' || uiState.cursorMode === 'sell') {
        const b = findEntityAtWorld(world.x, world.z, (ent) => ent.isBuilding && ent.playerId === 0);
        if (b) {
          enqueue({
            playerId: 0,
            type: uiState.cursorMode === 'repair' ? 'TOGGLE_REPAIR' : 'SELL_BUILDING',
            targetId: b.id
          });
        }
        return;
      }

      // Attack-move cursor click
      if (uiState.cursorMode === 'attackMove') {
        if (uiState.selectedIds.size > 0) {
          enqueue({
            playerId: 0,
            type: 'ATTACK_MOVE',
            entityIds: Array.from(uiState.selectedIds),
            x: world.x,
            z: world.z
          });
          pipeline.pushTransientFx({
            kind: 'order',
            x: world.x,
            y: 1.6,
            z: world.z,
            r: 1.0,
            g: 0.35,
            b: 0.18,
            startSec: performance.now() * 0.001,
            duration: 0.45
          });
        }
        uiState.cursorMode = 'default';
        return;
      }

      // Normal LMB selection or marquee box drag
      dragStart = { x: e.clientX, y: e.clientY, shiftKey: e.shiftKey };
    }
  });

  window.addEventListener('mousemove', (e) => {
    pointerClientX = e.clientX;
    pointerClientY = e.clientY;

    const rect = canvas.getBoundingClientRect();
    const inX = e.clientX >= rect.left - 8 && e.clientX <= rect.right + 2;
    const inY = e.clientY >= rect.top - 8 && e.clientY <= rect.bottom + 8;
    pointerInsideViewport = inX && inY;
    const targetEl = e.target;
    pointerOverInteractiveUi = !!(
      targetEl instanceof Element &&
      targetEl.closest('#gallery-panel, #victory-modal, #dialogue-box, #bench-telemetry-overlay, #sidebar-root')
    );

    if (isMiddlePan) {
      pipeline.camera.panByScreenDrag(lastMiddleX, lastMiddleY, e.clientX, e.clientY);
      lastMiddleX = e.clientX;
      lastMiddleY = e.clientY;
      return;
    }

    if (isMiddleOrbit) {
      const dYaw = (e.clientX - lastMiddleX) * 0.008;
      const dPitch = (e.clientY - lastMiddleY) * 0.006;
      pipeline.camera.orbit(-dYaw, dPitch);
      lastMiddleX = e.clientX;
      lastMiddleY = e.clientY;
      return;
    }

    if (rightDragStart) {
      if (!rightDragStart.active && Math.hypot(e.clientX - rightDragStart.x, e.clientY - rightDragStart.y) > 5) {
        rightDragStart.active = true;
        canvas.style.cursor = 'grabbing';
      }
      if (rightDragStart.active) {
        if (rightDragStart.orbit) {
          const dYaw = (e.clientX - rightDragStart.lastX) * 0.008;
          const dPitch = (e.clientY - rightDragStart.lastY) * 0.006;
          pipeline.camera.orbit(-dYaw, dPitch);
        } else {
          pipeline.camera.panByScreenDrag(rightDragStart.lastX, rightDragStart.lastY, e.clientX, e.clientY);
        }
        rightDragStart.lastX = e.clientX;
        rightDragStart.lastY = e.clientY;
        return;
      }
    }

    if (uiState.placementTypeId) {
      updatePlacementPreview(e.clientX, e.clientY);
    }

    if (dragStart) {
      const dist = Math.hypot(e.clientX - dragStart.x, e.clientY - dragStart.y);
      if (dist > 6) {
        const left = Math.min(dragStart.x, e.clientX);
        const top = Math.min(dragStart.y, e.clientY);
        const width = Math.abs(e.clientX - dragStart.x);
        const height = Math.abs(e.clientY - dragStart.y);
        selectionBoxEl.hidden = false;
        selectionBoxEl.style.left = `${left - rect.left}px`;
        selectionBoxEl.style.top = `${top - rect.top}px`;
        selectionBoxEl.style.width = `${width}px`;
        selectionBoxEl.style.height = `${height}px`;
      }
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 1) {
      isMiddlePan = false;
      isMiddleOrbit = false;
      canvas.style.cursor = '';
    }
    if (e.button === 2 && rightDragStart) {
      const rDrag = rightDragStart;
      rightDragStart = null;
      canvas.style.cursor = '';
      if (rDrag.active) {
        suppressNextContextMenu = true;
      } else {
        suppressNextContextMenu = false;
        handleRightClickAction(e.clientX, e.clientY);
      }
      return;
    }
    if (!dragStart || e.button !== 0) return;

    const start = dragStart;
    dragStart = null;
    selectionBoxEl.hidden = true;

    const dragDist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (dragDist > 8) {
      const minX = Math.min(start.x, e.clientX);
      const maxX = Math.max(start.x, e.clientX);
      const minY = Math.min(start.y, e.clientY);
      const maxY = Math.max(start.y, e.clientY);

      const nextSet = start.shiftKey ? new Set(uiState.selectedIds) : new Set();
      for (let i = 0; i < state.entities.length; i++) {
        const ent = state.entities[i];
        if (!ent.alive || ent.playerId !== 0 || ent.isBuilding) continue;
        const scr = pipeline.camera.worldToScreen(ent.x, ent.y ?? 1.6, ent.z);
        if (scr.visible && scr.x >= minX && scr.x <= maxX && scr.y >= minY && scr.y <= maxY) {
          nextSet.add(ent.id);
        }
      }
      uiState.selectedIds = nextSet;
      return;
    }

    // Single or double click selection
    const world = pipeline.camera.screenToWorld(e.clientX, e.clientY, 1.6);
    const picked = findEntityAtWorld(world.x, world.z, (ent) => ent.playerId === 0);
    if (!picked) {
      if (!start.shiftKey) uiState.selectedIds.clear();
      return;
    }

    const now = performance.now();
    const isDouble = !picked.isBuilding && lastClickInfo.typeId === picked.typeId && (now - lastClickInfo.timeMs) < 320;
    lastClickInfo = { timeMs: now, typeId: picked.typeId };

    if (isDouble) {
      const sameTypeSet = start.shiftKey ? new Set(uiState.selectedIds) : new Set();
      for (let i = 0; i < state.entities.length; i++) {
        const ent = state.entities[i];
        if (!ent.alive || ent.playerId !== 0 || ent.typeId !== picked.typeId) continue;
        const scr = pipeline.camera.worldToScreen(ent.x, ent.y ?? 1.6, ent.z);
        if (scr.visible) sameTypeSet.add(ent.id);
      }
      uiState.selectedIds = sameTypeSet;
      return;
    }

    if (start.shiftKey) {
      if (uiState.selectedIds.has(picked.id)) uiState.selectedIds.delete(picked.id);
      else uiState.selectedIds.add(picked.id);
    } else {
      uiState.selectedIds = new Set([picked.id]);
    }
  });

  function updateCamera(dtSec) {
    const panSpeed = (34 + pipeline.camera.height * 0.45) * dtSec;
    let dx = 0;
    let dz = 0;

    if (keysDown.has(KEYMAP_DEFAULTS.panLeft)) dx -= panSpeed;
    if (keysDown.has(KEYMAP_DEFAULTS.panRight)) dx += panSpeed;
    if (keysDown.has(KEYMAP_DEFAULTS.panUp)) dz -= panSpeed;
    if (keysDown.has(KEYMAP_DEFAULTS.panDown)) dz += panSpeed;

    // 24px viewport edge scrolling (works cleanly across top/bottom HUD overlays; pauses over sidebar/modals)
    const modalClosed = !victoryModalEl || victoryModalEl.hidden;
    if (modalClosed && pointerInsideViewport && !pointerOverInteractiveUi && !dragStart && !rightDragStart && !isMiddlePan && !isMiddleOrbit) {
      const rect = canvas.getBoundingClientRect();
      const m = 24;
      if (pointerClientX <= rect.left + m) {
        const ratio = 0.45 + 0.55 * Math.max(0, Math.min(1, (rect.left + m - pointerClientX) / m));
        dx -= panSpeed * ratio;
      } else if (pointerClientX >= rect.right - m && pointerClientX <= rect.right + 4) {
        const ratio = 0.45 + 0.55 * Math.max(0, Math.min(1, (pointerClientX - (rect.right - m)) / m));
        dx += panSpeed * ratio;
      }
      if (pointerClientY <= rect.top + m) {
        const ratio = 0.45 + 0.55 * Math.max(0, Math.min(1, (rect.top + m - pointerClientY) / m));
        dz -= panSpeed * ratio;
      } else if (pointerClientY >= rect.bottom - m) {
        const ratio = 0.45 + 0.55 * Math.max(0, Math.min(1, (pointerClientY - (rect.bottom - m)) / m));
        dz += panSpeed * ratio;
      }
    }

    if (dx !== 0 || dz !== 0) {
      pipeline.camera.pan(dx, dz);
    }
  }

  return {
    updateCamera,
    setState: (nextState) => { state = nextState; }
  };
}
