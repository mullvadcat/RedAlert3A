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

const staticFogCacheByGrids = new WeakMap();

function stampCircle(grid, centerGx, centerGz, radiusCells, bitMask) {
  const r2 = radiusCells * radiusCells;
  const minZ = Math.max(0, Math.floor(centerGz - radiusCells));
  const maxZ = Math.min(MAP_SIZE - 1, Math.ceil(centerGz + radiusCells));

  for (let gz = minZ; gz <= maxZ; gz++) {
    const dz = gz - centerGz;
    const rem = r2 - dz * dz;
    if (rem < 0) continue;
    const span = Math.floor(Math.sqrt(rem));
    const minX = Math.max(0, Math.floor(centerGx - span));
    const maxX = Math.min(MAP_SIZE - 1, Math.floor(centerGx + span));
    const row = gz * MAP_SIZE;
    for (let gx = minX; gx <= maxX; gx++) {
      grid[row + gx] |= bitMask;
    }
  }
}

function clearCircleWithStatic(grid, staticGrid, centerGx, centerGz, radiusCells) {
  const r2 = radiusCells * radiusCells;
  const minZ = Math.max(0, Math.floor(centerGz - radiusCells));
  const maxZ = Math.min(MAP_SIZE - 1, Math.ceil(centerGz + radiusCells));

  for (let gz = minZ; gz <= maxZ; gz++) {
    const dz = gz - centerGz;
    const rem = r2 - dz * dz;
    if (rem < 0) continue;
    const span = Math.floor(Math.sqrt(rem));
    const minX = Math.max(0, Math.floor(centerGx - span));
    const maxX = Math.min(MAP_SIZE - 1, Math.floor(centerGx + span));
    const row = gz * MAP_SIZE;
    for (let gx = minX; gx <= maxX; gx++) {
      const idx = row + gx;
      grid[idx] = (grid[idx] & FOG_EXPLORED) | staticGrid[idx];
    }
  }
}

export function rebuildTeamFogGrids(state) {
  const fogGrids = state.fogGrids;
  if (!fogGrids || !state.map) return;
  const cellSize = state.map.cellSize || 2;
  const entities = state.entities;
  const areaEffects = state.areaEffects;

  // Determine active teams (typically 2 in 1v1), static signature, & group alive mobiles in ONE pass
  let activeTeamMask = 0;
  let staticSig = state.map.revision | 0;
  let sCache = staticFogCacheByGrids.get(fogGrids);
  if (!sCache) {
    const gridU32 = {};
    for (let t = 0; t < 8; t++) {
      const g = fogGrids[t];
      if (g) gridU32[t] = new Uint32Array(g.buffer, g.byteOffset, g.byteLength >> 2);
    }
    sCache = {
      sig: NaN,
      teamMask: 0,
      grids: {},
      u32: {},
      gridU32,
      prevMobile: {},
      curPools: [[], [], [], [], [], [], [], []],
      curLens: [0, 0, 0, 0, 0, 0, 0, 0],
      clearedPool: [],
      teamMobs: [[], [], [], [], [], [], [], []],
      idToCurIdx: new Int32Array(2048).fill(-1)
    };
    staticFogCacheByGrids.set(fogGrids, sCache);
  }

  const teamMobiles = sCache.teamMobs;
  for (let t = 0; t < 8; t++) teamMobiles[t].length = 0;

  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent.alive) continue;
    const t = ent.teamId;
    if (t >= 0 && t < 8 && fogGrids[t]) {
      activeTeamMask |= 1 << t;
      if (!ent.isBuilding) teamMobiles[t].push(ent);
    }
    if (ent.isBuilding) {
      staticSig = (staticSig * 31 + ent.id + t * 17) | 0;
    }
  }
  if (areaEffects && areaEffects.length > 0) {
    for (let i = 0; i < areaEffects.length; i++) {
      const fx = areaEffects[i];
      if (fx.type === 'satellite' && fx.expiryTick > state.tickCount && fx.teamId >= 0 && fx.teamId < 8 && fogGrids[fx.teamId]) {
        activeTeamMask |= 1 << fx.teamId;
        staticSig = (staticSig * 31 + (fx.id || i + 1) + fx.teamId * 29) | 0;
      }
    }
  }

  const staticDirty = sCache.sig !== staticSig || sCache.teamMask !== activeTeamMask;
  if (staticDirty) {
    sCache.sig = staticSig;
    sCache.teamMask = activeTeamMask;
    const size = MAP_SIZE * MAP_SIZE;
    for (let t = 0; t < 8; t++) {
      if ((activeTeamMask & (1 << t)) === 0) continue;
      if (!sCache.grids[t]) {
        const buf = new Uint8Array(size);
        sCache.grids[t] = buf;
        sCache.u32[t] = new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2);
      } else {
        sCache.grids[t].fill(0);
      }
    }
    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (!ent.alive || !ent.isBuilding) continue;
      const sg = sCache.grids[ent.teamId];
      if (!sg) continue;
      const sightMeters = ent.sight ?? ENTITY_DEFS[ent.typeId]?.sight ?? 12;
      const sightCells = Math.max(1, sightMeters / cellSize);
      const gx = worldToGrid(ent.x);
      const gz = worldToGrid(ent.z);
      stampCircle(sg, gx, gz, sightCells, FOG_EXPLORED | FOG_VISIBLE);
      const def = ENTITY_DEFS[ent.typeId];
      if (def?.detector) {
        stampCircle(sg, gx, gz, (def.detectorRadius ?? 12) / cellSize, FOG_EXPLORED | FOG_VISIBLE | FOG_DETECTED);
      }
    }
    if (areaEffects && areaEffects.length > 0) {
      for (let i = 0; i < areaEffects.length; i++) {
        const fx = areaEffects[i];
        if (fx.type === 'satellite' && fx.expiryTick > state.tickCount) {
          const sg = sCache.grids[fx.teamId];
          if (!sg) continue;
          stampCircle(
            sg,
            worldToGrid(fx.x),
            worldToGrid(fx.z),
            Math.max(1, (fx.radius ?? 20) / cellSize),
            FOG_EXPLORED | FOG_VISIBLE | FOG_DETECTED
          );
        }
      }
    }
  }

  for (let t = 0; t < 8; t++) {
    const grid = fogGrids[t];
    if (!grid) continue;
    if ((activeTeamMask & (1 << t)) === 0) {
      if (staticDirty) {
        const u32 = sCache.gridU32[t];
        for (let i = 0; i < u32.length; i++) u32[i] &= 0x01010101;
      }
      if (sCache.prevMobile[t]) sCache.prevMobile[t].length = 0;
      continue;
    }

    const mobs = teamMobiles[t];
    const prev = sCache.prevMobile[t] || (sCache.prevMobile[t] = []);
    const pool = sCache.curPools[t];

    if (staticDirty || prev.length === 0) {
      const u32 = sCache.gridU32[t];
      const staticU32 = sCache.u32[t];
      for (let i = 0; i < u32.length; i++) {
        u32[i] = (u32[i] & 0x01010101) | staticU32[i];
      }
      prev.length = 0;
      for (let i = 0; i < mobs.length; i++) {
        const ent = mobs[i];
        const gx = ent.x < 0 ? 0 : ent.x >= 512 ? 255 : (ent.x * 0.5) | 0;
        const gz = ent.z < 0 ? 0 : ent.z >= 512 ? 255 : (ent.z * 0.5) | 0;
        const def = ENTITY_DEFS[ent.typeId];
        const sightCells = Math.max(1, (ent.sight ?? def?.sight ?? 12) / cellSize);
        const detCells = def?.detector ? (def.detectorRadius ?? 12) / cellSize : 0;
        stampCircle(grid, gx, gz, sightCells, FOG_EXPLORED | FOG_VISIBLE);
        if (detCells > 0) stampCircle(grid, gx, gz, detCells, FOG_EXPLORED | FOG_VISIBLE | FOG_DETECTED);
        let item = pool[i];
        if (!item) {
          item = { id: ent.id, gx, gz, sightCells, detCells, dirty: false };
          pool[i] = item;
        } else {
          item.id = ent.id;
          item.gx = gx;
          item.gz = gz;
          item.sightCells = sightCells;
          item.detCells = detCells;
          item.dirty = false;
        }
        prev.push(item);
      }
      continue;
    }

    // Zero-GC fast-check: if all mobile units stay in the same 2m cell as last tick, skip completely
    let anyDirty = mobs.length !== prev.length;
    if (!anyDirty) {
      for (let i = 0; i < mobs.length; i++) {
        const ent = mobs[i];
        const p = prev[i];
        const gx = ent.x < 0 ? 0 : ent.x >= 512 ? 255 : (ent.x * 0.5) | 0;
        const gz = ent.z < 0 ? 0 : ent.z >= 512 ? 255 : (ent.z * 0.5) | 0;
        if (p.id !== ent.id || gx !== p.gx || gz !== p.gz) {
          anyDirty = true;
          break;
        }
      }
    }
    if (!anyDirty) continue;

    // Zero-GC incremental update reusing preallocated item slots & flat id lookup array
    let idMap = sCache.idToCurIdx;
    const clearedBoxes = sCache.clearedPool;
    clearedBoxes.length = 0;
    const nMobs = mobs.length;
    if (!sCache.altMobile) sCache.altMobile = [[], [], [], [], [], [], [], []];
    const curList = sCache.altMobile[t];
    curList.length = 0;
    const itemPool = sCache.curPools[t];
    if (!sCache.altPools) sCache.altPools = [[], [], [], [], [], [], [], []];
    const activePool = prev[0] === itemPool[0] ? sCache.altPools[t] : itemPool;

    for (let i = 0; i < nMobs; i++) {
      const ent = mobs[i];
      if (ent.id >= idMap.length) {
        const nextArr = new Int32Array(Math.max(ent.id + 256, idMap.length * 2)).fill(-1);
        nextArr.set(idMap);
        sCache.idToCurIdx = nextArr;
        idMap = nextArr;
      }
      const gx = ent.x < 0 ? 0 : ent.x >= 512 ? 255 : (ent.x * 0.5) | 0;
      const gz = ent.z < 0 ? 0 : ent.z >= 512 ? 255 : (ent.z * 0.5) | 0;
      const def = ENTITY_DEFS[ent.typeId];
      const sightCells = Math.max(1, (ent.sight ?? def?.sight ?? 12) / cellSize);
      const detCells = def?.detector ? (def.detectorRadius ?? 12) / cellSize : 0;
      let item = activePool[i];
      if (!item) {
        item = { id: ent.id, gx, gz, sightCells, detCells, dirty: true };
        activePool[i] = item;
      } else {
        item.id = ent.id;
        item.gx = gx;
        item.gz = gz;
        item.sightCells = sightCells;
        item.detCells = detCells;
        item.dirty = true;
      }
      idMap[ent.id] = i;
      curList.push(item);
    }

    const staticGrid = sCache.grids[t];
    for (let i = 0; i < prev.length; i++) {
      const p = prev[i];
      const cIdx = p.id < idMap.length ? idMap[p.id] : -1;
      const c = cIdx >= 0 ? curList[cIdx] : null;
      if (c && c.gx === p.gx && c.gz === p.gz && c.sightCells === p.sightCells && c.detCells === p.detCells) {
        c.dirty = false;
      } else {
        const maxR = Math.max(p.sightCells, p.detCells);
        clearCircleWithStatic(grid, staticGrid, p.gx, p.gz, maxR);
        clearedBoxes.push(p.gx, p.gz, maxR);
      }
    }
    for (let i = 0; i < nMobs; i++) idMap[curList[i].id] = -1;

    if (clearedBoxes.length > 0) {
      for (let i = 0; i < nMobs; i++) {
        const c = curList[i];
        if (c.dirty) continue;
        const cr = Math.max(c.sightCells, c.detCells);
        for (let b = 0; b < clearedBoxes.length; b += 3) {
          const reach = cr + clearedBoxes[b + 2] + 1;
          if (Math.abs(c.gx - clearedBoxes[b]) <= reach && Math.abs(c.gz - clearedBoxes[b + 1]) <= reach) {
            c.dirty = true;
            break;
          }
        }
      }
    }

    for (let i = 0; i < nMobs; i++) {
      const c = curList[i];
      if (!c.dirty) continue;
      stampCircle(grid, c.gx, c.gz, c.sightCells, FOG_EXPLORED | FOG_VISIBLE);
      if (c.detCells > 0) stampCircle(grid, c.gx, c.gz, c.detCells, FOG_EXPLORED | FOG_VISIBLE | FOG_DETECTED);
    }

    sCache.prevMobile[t] = curList;
    sCache.altMobile[t] = prev;
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
