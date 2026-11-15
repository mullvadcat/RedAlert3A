// Context-sensitive RA2-style SVG tactical cursors (L2 UI Layer).
// Caches lightweight 24x24 data-URI cursors once and updates canvas.style.cursor only when state changes.

import { TERRAIN } from '../world/map.js';
import { isEntityTargetable } from '../gameplay/fogCpu.js';
import { canBoardTransport } from '../gameplay/entities.js';

function svgCursor(svgBody, hotX = 12, hotY = 12, fallback = 'crosshair') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${svgBody}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hotX} ${hotY}, ${fallback}`;
}

const CURSORS = {
  default: 'crosshair',
  grabbing: 'grabbing',
  move: svgCursor(
    '<circle cx="12" cy="12" r="8" fill="none" stroke="#3ddc84" stroke-width="2"/><circle cx="12" cy="12" r="2.2" fill="#3ddc84"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke="#3ddc84" stroke-width="1.6"/>',
    12, 12, 'pointer'
  ),
  attack: svgCursor(
    '<circle cx="12" cy="12" r="7" fill="none" stroke="#ff4d4f" stroke-width="2"/><circle cx="12" cy="12" r="2" fill="#ffcf56"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="#ff4d4f" stroke-width="2"/>',
    12, 12, 'crosshair'
  ),
  attackMove: svgCursor(
    '<polygon points="12,2 22,12 12,22 2,12" fill="none" stroke="#ff7a33" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="#ff4d4f"/>',
    12, 12, 'crosshair'
  ),
  capture: svgCursor(
    '<circle cx="12" cy="12" r="8" fill="rgba(247,201,72,0.16)" stroke="#f7c948" stroke-width="2"/><path d="M7 13l5-5 5 5M12 8v9" fill="none" stroke="#f7c948" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    12, 12, 'pointer'
  ),
  repair: svgCursor(
    '<circle cx="12" cy="12" r="8" fill="rgba(61,220,132,0.14)" stroke="#3ddc84" stroke-width="2"/><path d="M8 16l6-6a3 3 0 1 1 2 2l-6 6z" fill="none" stroke="#3ddc84" stroke-width="1.8"/>',
    12, 12, 'pointer'
  ),
  sell: svgCursor(
    '<circle cx="12" cy="12" r="8" fill="rgba(245,179,66,0.16)" stroke="#f5b342" stroke-width="2"/><path d="M12 6v12M9.5 9c0-1 1.1-1.6 2.5-1.6s2.5.6 2.5 1.6-1.1 1.6-2.5 1.8-2.5.8-2.5 1.8 1.1 1.6 2.5 1.6 2.5-.6 2.5-1.6" fill="none" stroke="#f5b342" stroke-width="1.7" stroke-linecap="round"/>',
    12, 12, 'pointer'
  ),
  board: svgCursor(
    '<circle cx="12" cy="12" r="8" fill="rgba(45,126,255,0.18)" stroke="#4ea1ff" stroke-width="2"/><path d="M7 10l5 5 5-5M12 5v9" fill="none" stroke="#4ea1ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    12, 12, 'pointer'
  ),
  deploy: svgCursor(
    '<rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="#f7c948" stroke-width="1.8"/><path d="M4 4l4 4M20 4l-4 4M4 20l4-4M20 20l-4-4" stroke="#3ddc84" stroke-width="2" stroke-linecap="round"/>',
    12, 12, 'pointer'
  ),
  powerStrike: svgCursor(
    '<circle cx="12" cy="12" r="9" fill="none" stroke="#47d8ff" stroke-width="1.8" stroke-dasharray="3 2"/><circle cx="12" cy="12" r="3" fill="#ffcf56"/>',
    12, 12, 'crosshair'
  ),
  denied: svgCursor(
    '<circle cx="12" cy="12" r="8" fill="rgba(255,77,79,0.14)" stroke="#ff4d4f" stroke-width="2"/><path d="M8 8l8 8M16 8l-8 8" stroke="#ff4d4f" stroke-width="2" stroke-linecap="round"/>',
    12, 12, 'not-allowed'
  )
};

export function createCursorManager(canvas) {
  let currentKey = '';
  return {
    set(key) {
      const next = CURSORS[key] ? key : 'default';
      if (next === currentKey) return;
      currentKey = next;
      canvas.style.cursor = CURSORS[next];
    },
    reset() {
      this.set('default');
    }
  };
}

export function computeTacticalCursor(state, uiState, world, findEntityAtWorld) {
  if (uiState.pendingPower) return 'powerStrike';
  if (uiState.placementTypeId) return uiState.placementValid ? 'deploy' : 'denied';
  if (uiState.cursorMode === 'attackMove') return 'attackMove';

  if (uiState.cursorMode === 'repair') {
    const b = findEntityAtWorld(world.x, world.z, (ent) => ent.isBuilding && ent.playerId === 0);
    return b && b.hp < b.maxHp ? 'repair' : 'default';
  }
  if (uiState.cursorMode === 'sell') {
    const b = findEntityAtWorld(world.x, world.z, (ent) => ent.isBuilding && ent.playerId === 0);
    return b ? 'sell' : 'default';
  }

  if (!uiState.selectedIds || uiState.selectedIds.size === 0) return 'default';

  const selected = [];
  for (const id of uiState.selectedIds) {
    const ent = state.entityById.get(id);
    if (ent && ent.alive && ent.playerId === 0) selected.push(ent);
  }
  if (selected.length === 0) return 'default';

  const hasEngineer = selected.some((u) => u.typeId === 'engineer');
  const hovered = findEntityAtWorld(
    world.x,
    world.z,
    (ent) => ent.teamId === 0 || ent.teamId === 3 || uiState.noFog || isEntityTargetable(state, 0, ent)
  );

  if (hovered) {
    if (hovered.teamId !== 0 && hovered.teamId !== 3) {
      return 'attack';
    }
    if (hasEngineer && hovered.isBuilding) {
      if (hovered.teamId === 3 || hovered.playerId !== 0) return 'capture';
      if (hovered.playerId === 0 && hovered.hp < hovered.maxHp) return 'repair';
    }
    if (hovered.playerId === 0 && selected.some((u) => canBoardTransport(hovered, u))) {
      return 'board';
    }
    if (hovered.playerId === 0 && selected.some((u) => u.id === hovered.id && (u.typeId === 'mcv' || u.typeId === 'gi'))) {
      return 'deploy';
    }
  }

  const hasMobile = selected.some((u) => !u.isBuilding);
  if (!hasMobile) return 'default';

  const cellSize = state.map.cellSize || 2;
  const gx = Math.floor(world.x / cellSize);
  const gz = Math.floor(world.z / cellSize);
  if (gx < 0 || gz < 0 || gx >= state.map.width || gz >= state.map.height) return 'denied';
  const terr = state.map.terrain[gz * state.map.width + gx];
  const allAir = selected.every((u) => u.domain === 'AIR');
  if (allAir) return 'move';
  if (terr === TERRAIN.CLIFF) return 'denied';
  const anyGroundOnly = selected.every((u) => u.domain === 'GROUND');
  if (anyGroundOnly && (terr === TERRAIN.SEA || terr === TERRAIN.SHALLOW)) return 'denied';
  const anyNavalOnly = selected.every((u) => u.domain === 'SEA');
  if (anyNavalOnly && terr !== TERRAIN.SEA && terr !== TERRAIN.SHALLOW) return 'denied';

  return 'move';
}
