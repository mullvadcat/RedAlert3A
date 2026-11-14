// CPU 256x256 Fog of War bitmask per teamId (Bit 0 = EXPLORED, Bit 1 = VISIBLE, Bit 2 = DETECTED).
// Pure ESM: zero DOM / WebGL imports.

import { ENTITY_DEFS } from '../core/config.js';
import { MAP_SIZE, worldToGrid } from '../world/map.js';

export const FOG_UNEXPLORED = 0;
export const FOG_EXPLORED = 1;
export const FOG_VISIBLE = 2;
export const FOG_DETECTED = 4;

export function createTeamFogGrids(maxTeams = 4) {
  const grids = {};
  const size = MAP_SIZE * MAP_SIZE;
  for (let t = 0; t < maxTeams; t++) {
    grids[t] = new Uint8Array(size);
  }
  return grids;
}

function stampCircle(grid, centerGx, centerGz, radiusCells, bitMask) {
  const r2 = radiusCells * radiusCells;
  const minX = Math.max(0, Math.floor(centerGx - radiusCells));
  const maxX = Math.min(MAP_SIZE - 1, Math.ceil(centerGx + radiusCells));
  const minZ = Math.max(0, Math.floor(centerGz - radiusCells));
  const maxZ = Math.min(MAP_SIZE - 1, Math.ceil(centerGz + radiusCells));

  for (let gz = minZ; gz <= maxZ; gz++) {
    const dz = gz - centerGz;
    const dz2 = dz * dz;
    const row = gz * MAP_SIZE;
    for (let gx = minX; gx <= maxX; gx++) {
      const dx = gx - centerGx;
      if (dx * dx + dz2 <= r2) {
        grid[row + gx] |= bitMask;
      }
    }
  }
}

export function rebuildTeamFogGrids(state) {
  const fogGrids = state.fogGrids;
  if (!fogGrids || !state.map) return;
  const cellSize = state.map.cellSize || 2;
  const teamIds = Object.keys(fogGrids);

  // 1. Preserve only EXPLORED bit (Bit 0) via 32-bit wordwise mask, clear VISIBLE & DETECTED.
  for (let t = 0; t < teamIds.length; t++) {
    const grid = fogGrids[teamIds[t]];
    const u32 = new Uint32Array(grid.buffer, grid.byteOffset, grid.byteLength >> 2);
    for (let i = 0; i < u32.length; i++) {
      u32[i] &= 0x01010101;
    }
  }

  // 2. Re-stamp VISIBLE | EXPLORED (3) and detector circles (4) from alive friendly units/buildings.
  const entities = state.entities;
  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent.alive) continue;
    const grid = fogGrids[ent.teamId];
    if (!grid) continue;

    const sightMeters = ent.sight ?? ENTITY_DEFS[ent.typeId]?.sight ?? 12;
    const sightCells = Math.max(1, sightMeters / cellSize);
    const gx = worldToGrid(ent.x);
    const gz = worldToGrid(ent.z);
    stampCircle(grid, gx, gz, sightCells, FOG_EXPLORED | FOG_VISIBLE);

    const def = ENTITY_DEFS[ent.typeId];
    if (def?.detector) {
      const detCells = (def.detectorRadius ?? 12) / cellSize;
      stampCircle(grid, gx, gz, detCells, FOG_EXPLORED | FOG_VISIBLE | FOG_DETECTED);
    }
  }

  // 3. Re-stamp active area effects (e.g., F1 Recon Satellite).
  const areaEffects = state.areaEffects;
  if (areaEffects && areaEffects.length > 0) {
    for (let i = 0; i < areaEffects.length; i++) {
      const fx = areaEffects[i];
      if (fx.type === 'satellite' && fx.expiryTick > state.tickCount) {
        const grid = fogGrids[fx.teamId];
        if (!grid) continue;
        stampCircle(
          grid,
          worldToGrid(fx.x),
          worldToGrid(fx.z),
          Math.max(1, (fx.radius ?? 20) / cellSize),
          FOG_EXPLORED | FOG_VISIBLE | FOG_DETECTED
        );
      }
    }
  }
}

export function getCellFogMask(state, teamId, gx, gz) {
  const grid = state.fogGrids?.[teamId];
  if (!grid) return 0;
  if (gx < 0 || gx >= MAP_SIZE || gz < 0 || gz >= MAP_SIZE) return 0;
  return grid[gz * MAP_SIZE + gx];
}

export function isCellExplored(state, teamId, gx, gz) {
  return (getCellFogMask(state, teamId, gx, gz) & FOG_EXPLORED) !== 0;
}

export function isCellVisible(state, teamId, gx, gz) {
  return (getCellFogMask(state, teamId, gx, gz) & FOG_VISIBLE) !== 0;
}

export function isEntityTargetable(state, teamId, target) {
  if (!target || !target.alive) return false;
  if (target.teamId === teamId) return true;
  const gx = worldToGrid(target.x);
  const gz = worldToGrid(target.z);
  const mask = getCellFogMask(state, teamId, gx, gz);
  const isStealth =
    (target.domain === 'SUBMERGED' && !(target.surfacedTicks > 0)) ||
    (Boolean(target.isStealthed) && !(target.revealTicks > 0));
  if (isStealth) {
    return (mask & (FOG_VISIBLE | FOG_DETECTED)) === (FOG_VISIBLE | FOG_DETECTED);
  }
  return (mask & FOG_VISIBLE) !== 0;
}
