// Dual-resolution navigation:
// - 128x128 (4m/cell) time-sliced macro FlowFields (<= 2 computed per 30 Hz logic tick)
// - 16-slot LRU FlowField cache keyed by (mx, mz, layer, mapRevision)
// - Zero-GC spatial hash Boids separation + 256x256 terrain & building footprint collision
// Pure ESM: zero DOM / WebGL imports.

import { ENTITY_DEFS, TICK_DT } from '../core/config.js';
import { CELL_SIZE, MAP_SIZE, TERRAIN, WORLD_SIZE, worldToGrid } from '../world/map.js';

export const MACRO_SIZE = 128;
export const MACRO_CELL = CELL_SIZE * 2; // 4m
export const FLOW_CACHE_SIZE = 32;
export const MAX_FLOWS_PER_TICK = 2;

const DIR_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DIR_DZ = [0, 1, 1, 1, 0, -1, -1, -1];
const DIR_COST = [10, 14, 10, 14, 10, 14, 10, 14];
// Normalized (-127..127) vector pointing back from v -> u (opposite of DIR_DX[d], DIR_DZ[d])
const REV_DIR_X = new Int8Array([-127, -90, 0, 90, 127, 90, 0, -90]);
const REV_DIR_Z = new Int8Array([0, -90, -127, -90, 0, 90, 127, 90]);
const INF_DIST = 0x7fffffff;

function getCacheKey(mx, mz, layer, revision) {
  return `${mx},${mz},${layer},${revision}`;
}

export function createFlowCache() {
  return {
    slots: [],
    queue: [],
    queuedKeys: new Set(),
    lastComputedThisTick: 0,
    passMasks: {
      LAND: { revision: -1, mask: new Uint8Array(MACRO_SIZE * MACRO_SIZE) },
      SEA: { revision: -1, mask: new Uint8Array(MACRO_SIZE * MACRO_SIZE) },
      AMPHIBIOUS: { revision: -1, mask: new Uint8Array(MACRO_SIZE * MACRO_SIZE) }
    },
    // Preallocated scratch for zero-GC Dial's Bucket Dijkstra + Spatial Hash
    dist: new Int32Array(MACRO_SIZE * MACRO_SIZE),
    passMask: new Uint8Array(MACRO_SIZE * MACRO_SIZE),
    bucketNodes: new Int32Array(32 * 4096),
    bucketCounts: new Int32Array(32),
    spatialHeads: new Int32Array(MACRO_SIZE * MACRO_SIZE),
    spatialNext: new Int32Array(2048)
  };
}

function isFineCellPassable(map, gx, gz, layer, allowBuildingId = 0) {
  if (gx < 0 || gx >= MAP_SIZE || gz < 0 || gz >= MAP_SIZE) return false;
  const idx = gz * MAP_SIZE + gx;
  const bid = map.buildingId[idx];
  if (bid > 0 && bid !== allowBuildingId) return false;

  const t = map.terrain[idx];
  if (layer === 'AIR') return true;
  if (layer === 'SEA') return t === TERRAIN.SEA || t === TERRAIN.SHALLOW || t === TERRAIN.BROKEN_BRIDGE;
  if (layer === 'AMPHIBIOUS') return t !== TERRAIN.CLIFF;
  // Default LAND
  return t === TERRAIN.LAND || t === TERRAIN.SHALLOW || t === TERRAIN.BRIDGE;
}

function getOrBuildPassMask(map, layer, cache) {
  const entry = cache.passMasks?.[layer];
  if (entry && entry.revision === map.revision) {
    return entry.mask;
  }
  const passMask = entry ? entry.mask : cache.passMask;
  const terrain = map.terrain;
  const buildingId = map.buildingId;
  for (let mz = 0; mz < MACRO_SIZE; mz++) {
    const gz0 = mz * 2;
    const row0 = gz0 * MAP_SIZE;
    const row1 = (gz0 + 1) * MAP_SIZE;
    const mRow = mz * MACRO_SIZE;
    for (let mx = 0; mx < MACRO_SIZE; mx++) {
      const gx0 = mx * 2;
      let ok = 0;
      const i0 = row0 + gx0;
      const i1 = i0 + 1;
      const i2 = row1 + gx0;
      const i3 = i2 + 1;
      if (layer === 'SEA') {
        if (buildingId[i0] === 0 && (terrain[i0] === 1 || terrain[i0] === 2 || terrain[i0] === 5)) ok++;
        if (buildingId[i1] === 0 && (terrain[i1] === 1 || terrain[i1] === 2 || terrain[i1] === 5)) ok++;
        if (buildingId[i2] === 0 && (terrain[i2] === 1 || terrain[i2] === 2 || terrain[i2] === 5)) ok++;
        if (buildingId[i3] === 0 && (terrain[i3] === 1 || terrain[i3] === 2 || terrain[i3] === 5)) ok++;
      } else if (layer === 'AMPHIBIOUS') {
        if (buildingId[i0] === 0 && terrain[i0] !== 3) ok++;
        if (buildingId[i1] === 0 && terrain[i1] !== 3) ok++;
        if (buildingId[i2] === 0 && terrain[i2] !== 3) ok++;
        if (buildingId[i3] === 0 && terrain[i3] !== 3) ok++;
      } else {
        if (buildingId[i0] === 0 && (terrain[i0] === 0 || terrain[i0] === 1 || terrain[i0] === 4)) ok++;
        if (buildingId[i1] === 0 && (terrain[i1] === 0 || terrain[i1] === 1 || terrain[i1] === 4)) ok++;
        if (buildingId[i2] === 0 && (terrain[i2] === 0 || terrain[i2] === 1 || terrain[i2] === 4)) ok++;
        if (buildingId[i3] === 0 && (terrain[i3] === 0 || terrain[i3] === 1 || terrain[i3] === 4)) ok++;
      }
      passMask[mRow + mx] = ok >= 3 ? 1 : 0;
    }
  }
  if (entry) entry.revision = map.revision;
  return passMask;
}

function hasClearMacroLine(map, cache, x0, z0, x1, z1, layer, dist) {
  const passMask = getOrBuildPassMask(map, layer, cache);
  const steps = Math.max(2, Math.ceil(dist / 3));
  const inv = 1 / steps;
  for (let s = 1; s < steps; s++) {
    const t = s * inv;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    const mx = Math.max(0, Math.min(MACRO_SIZE - 1, (x * 0.25) | 0));
    const mz = Math.max(0, Math.min(MACRO_SIZE - 1, (z * 0.25) | 0));
    if (passMask[(mz << 7) + mx] === 0) return false;
  }
  return true;
}

function computeFlowFieldIntoSlot(map, targetMx, targetMz, layer, cache, slot) {
  const dist = cache.dist;
  const passMask = getOrBuildPassMask(map, layer, cache);
  const bucketNodes = cache.bucketNodes;
  const bucketCounts = cache.bucketCounts;
  const dirX = slot.dirX;
  const dirZ = slot.dirZ;
  dist.fill(INF_DIST);
  dirX.fill(0);
  dirZ.fill(0);
  bucketCounts.fill(0);

  // Snap target macro cell to nearest passable cell if target itself sits on a building/obstacle
  let startMx = Math.max(0, Math.min(MACRO_SIZE - 1, targetMx));
  let startMz = Math.max(0, Math.min(MACRO_SIZE - 1, targetMz));
  if (passMask[startMz * MACRO_SIZE + startMx] === 0) {
    let found = false;
    for (let r = 1; r <= 6 && !found; r++) {
      for (let dz = -r; dz <= r && !found; dz++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          const nx = startMx + dx;
          const nz = startMz + dz;
          if (nx >= 0 && nx < MACRO_SIZE && nz >= 0 && nz < MACRO_SIZE && passMask[nz * MACRO_SIZE + nx]) {
            startMx = nx;
            startMz = nz;
            found = true;
          }
        }
      }
    }
  }

  const startIdx = startMz * MACRO_SIZE + startMx;
  dist[startIdx] = 0;
  bucketNodes[0] = startIdx;
  bucketCounts[0] = 1;

  let remaining = 1;
  let curD = 0;

  while (remaining > 0) {
    let b = curD & 31;
    let cnt = bucketCounts[b];
    while (cnt === 0) {
      curD++;
      b = curD & 31;
      cnt = bucketCounts[b];
    }
    const baseOff = b << 12;
    bucketCounts[b] = 0;
    remaining -= cnt;

    for (let k = 0; k < cnt; k++) {
      const u = bucketNodes[baseOff + k];
      if (dist[u] !== curD) continue;

      const ux = u & 127;
      const uz = u >> 7;
      if (ux > 0 && ux < 127 && uz > 0 && uz < 127) {
        const pR = passMask[u + 1];
        const pL = passMask[u - 1];
        const pD = passMask[u + 128];
        const pU = passMask[u - 128];
        const c10 = curD + 10;
        const c14 = curD + 14;
        if (pR && c10 < dist[u + 1]) {
          const v = u + 1; dist[v] = c10; dirX[v] = -127; dirZ[v] = 0;
          const nb = c10 & 31; const p = bucketCounts[nb];
          if (p < 4096) { bucketNodes[(nb << 12) + p] = v; bucketCounts[nb] = p + 1; remaining++; }
        }
        if (pL && c10 < dist[u - 1]) {
          const v = u - 1; dist[v] = c10; dirX[v] = 127; dirZ[v] = 0;
          const nb = c10 & 31; const p = bucketCounts[nb];
          if (p < 4096) { bucketNodes[(nb << 12) + p] = v; bucketCounts[nb] = p + 1; remaining++; }
        }
        if (pD && c10 < dist[u + 128]) {
          const v = u + 128; dist[v] = c10; dirX[v] = 0; dirZ[v] = -127;
          const nb = c10 & 31; const p = bucketCounts[nb];
          if (p < 4096) { bucketNodes[(nb << 12) + p] = v; bucketCounts[nb] = p + 1; remaining++; }
        }
        if (pU && c10 < dist[u - 128]) {
          const v = u - 128; dist[v] = c10; dirX[v] = 0; dirZ[v] = 127;
          const nb = c10 & 31; const p = bucketCounts[nb];
          if (p < 4096) { bucketNodes[(nb << 12) + p] = v; bucketCounts[nb] = p + 1; remaining++; }
        }
        if (pR && pD && passMask[u + 129] && c14 < dist[u + 129]) {
          const v = u + 129; dist[v] = c14; dirX[v] = -90; dirZ[v] = -90;
          const nb = c14 & 31; const p = bucketCounts[nb];
          if (p < 4096) { bucketNodes[(nb << 12) + p] = v; bucketCounts[nb] = p + 1; remaining++; }
        }
        if (pL && pD && passMask[u + 127] && c14 < dist[u + 127]) {
          const v = u + 127; dist[v] = c14; dirX[v] = 90; dirZ[v] = -90;
          const nb = c14 & 31; const p = bucketCounts[nb];
          if (p < 4096) { bucketNodes[(nb << 12) + p] = v; bucketCounts[nb] = p + 1; remaining++; }
        }
        if (pL && pU && passMask[u - 129] && c14 < dist[u - 129]) {
          const v = u - 129; dist[v] = c14; dirX[v] = 90; dirZ[v] = 90;
          const nb = c14 & 31; const p = bucketCounts[nb];
          if (p < 4096) { bucketNodes[(nb << 12) + p] = v; bucketCounts[nb] = p + 1; remaining++; }
        }
        if (pR && pU && passMask[u - 127] && c14 < dist[u - 127]) {
          const v = u - 127; dist[v] = c14; dirX[v] = -90; dirZ[v] = 90;
          const nb = c14 & 31; const p = bucketCounts[nb];
          if (p < 4096) { bucketNodes[(nb << 12) + p] = v; bucketCounts[nb] = p + 1; remaining++; }
        }
      } else {
        const rowU = uz << 7;
        for (let d = 0; d < 8; d++) {
          const vx = ux + DIR_DX[d];
          const vz = uz + DIR_DZ[d];
          if (vx < 0 || vx >= MACRO_SIZE || vz < 0 || vz >= MACRO_SIZE) continue;
          const v = (vz << 7) + vx;
          if (passMask[v] === 0) continue;
          if (DIR_DX[d] !== 0 && DIR_DZ[d] !== 0) {
            if (passMask[rowU + ux + DIR_DX[d]] === 0 || passMask[((uz + DIR_DZ[d]) << 7) + ux] === 0) {
              continue;
            }
          }
          const nd = curD + DIR_COST[d];
          if (nd < dist[v]) {
            dist[v] = nd;
            dirX[v] = REV_DIR_X[d];
            dirZ[v] = REV_DIR_Z[d];
            const nb = nd & 31;
            const nPos = bucketCounts[nb];
            if (nPos < 4096) {
              bucketNodes[(nb << 12) + nPos] = v;
              bucketCounts[nb] = nPos + 1;
              remaining++;
            }
          }
        }
      }
    }
    curD++;
  }

  slot.key = getCacheKey(targetMx, targetMz, layer, map.revision);
  slot.mx = targetMx;
  slot.mz = targetMz;
  slot.layer = layer;
  slot.revision = map.revision;
  slot.lastUsedTick = 0;
}

export function requestFlowField(state, targetX, targetZ, layer = 'LAND', priority = 1) {
  if (layer === 'AIR' || !state.flowCache || !state.map) return null;
  const mx = Math.max(0, Math.min(MACRO_SIZE - 1, Math.floor(targetX / MACRO_CELL)));
  const mz = Math.max(0, Math.min(MACRO_SIZE - 1, Math.floor(targetZ / MACRO_CELL)));
  const key = getCacheKey(mx, mz, layer, state.map.revision);

  const slots = state.flowCache.slots;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].key === key) {
      slots[i].lastUsedTick = state.tickCount;
      return slots[i];
    }
  }

  if (!state.flowCache.queuedKeys.has(key)) {
    state.flowCache.queuedKeys.add(key);
    state.flowCache.queue.push({ mx, mz, layer, revision: state.map.revision, key, priority, enqueuedTick: state.tickCount });
  }
  return null;
}

export function getMovementLayer(entity) {
  const def = ENTITY_DEFS[entity.typeId];
  if (entity.domain === 'AIR') return 'AIR';
  if (def?.amphibious) return 'AMPHIBIOUS';
  if (entity.domain === 'SEA' || entity.domain === 'SUBMERGED') return 'SEA';
  return 'LAND';
}

export function stepNavigation(state) {
  const map = state.map;
  const cache = state.flowCache;
  if (!map || !cache) return;

  // 1. Time-sliced FlowField queue: strictly <= MAX_FLOWS_PER_TICK (2) per 30 Hz tick
  cache.lastComputedThisTick = 0;
  if (cache.queue.length > 0) {
    cache.queue.sort((a, b) => b.priority - a.priority || a.enqueuedTick - b.enqueuedTick);
    let processed = 0;
    while (cache.queue.length > 0 && processed < MAX_FLOWS_PER_TICK) {
      const req = cache.queue.shift();
      cache.queuedKeys.delete(req.key);
      if (req.revision && req.revision !== map.revision) continue;

      let slot = cache.slots.find((s) => s.key === req.key);
      if (!slot) {
        if (cache.slots.length < FLOW_CACHE_SIZE) {
          slot = {
            key: '',
            mx: 0,
            mz: 0,
            layer: req.layer,
            revision: map.revision,
            lastUsedTick: state.tickCount,
            dirX: new Int8Array(MACRO_SIZE * MACRO_SIZE),
            dirZ: new Int8Array(MACRO_SIZE * MACRO_SIZE)
          };
          cache.slots.push(slot);
        } else {
          // Evict least recently used slot cleanly with zero allocations
          let lruIdx = 0;
          for (let i = 1; i < cache.slots.length; i++) {
            if (cache.slots[i].lastUsedTick < cache.slots[lruIdx].lastUsedTick) {
              lruIdx = i;
            }
          }
          slot = cache.slots[lruIdx];
        }
      }
      computeFlowFieldIntoSlot(map, req.mx, req.mz, req.layer, cache, slot);
      slot.lastUsedTick = state.tickCount;
      processed++;
    }
    cache.lastComputedThisTick = processed;
  }

  // 2. Build zero-GC spatial hash for all alive mobile units
  const entities = state.entities;
  if (entities.length > cache.spatialNext.length) {
    cache.spatialNext = new Int32Array(Math.max(entities.length * 2, 2048));
  }
  const heads = cache.spatialHeads;
  const next = cache.spatialNext;
  heads.fill(-1);

  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent.alive || ent.isBuilding) continue;
    const mx = Math.max(0, Math.min(MACRO_SIZE - 1, Math.floor(ent.x / MACRO_CELL)));
    const mz = Math.max(0, Math.min(MACRO_SIZE - 1, Math.floor(ent.z / MACRO_CELL)));
    const bucket = mz * MACRO_SIZE + mx;
    next[i] = heads[bucket];
    heads[bucket] = i;
  }

  // 3. Snapshot prevX/prevZ/prevY for frame interpolation and integrate velocities + Boids
  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent.alive) continue;

    ent.prevX = ent.x;
    ent.prevZ = ent.z;
    ent.prevY = ent.y;

    if (ent.isBuilding) continue;
    if (ent.empTicks > 0 || ent.frozenByCount > 0 || ent.stunTicks > 0) continue;
    if (ent.deployState === 'DEPLOYED') continue;
    if (ent.airState === 'A_DOCKED' || ent.airState === 'A_REARMING') continue;

    const layer = getMovementLayer(ent);
    const speed = ent.speed ?? ENTITY_DEFS[ent.typeId]?.speed ?? 0;

    let moveX = 0;
    let moveZ = 0;
    let hasMoveTarget = false;

    if (ent.moveTargetX !== null && ent.moveTargetZ !== null && speed > 0) {
      const dx = ent.moveTargetX - ent.x;
      const dz = ent.moveTargetZ - ent.z;
      const dist = Math.hypot(dx, dz);
      const stopThreshold = ent.moveStopDist ?? 0.9;

      if (dist <= stopThreshold) {
        if (ent.orderType === 'MOVE' || ent.orderType === 'ATTACK_MOVE') {
          ent.moveTargetX = null;
          ent.moveTargetZ = null;
          ent.orderType = 'IDLE';
        }
      } else {
        hasMoveTarget = true;
        if (layer === 'AIR' || dist < 10 || (dist < 380 && hasClearMacroLine(map, cache, ent.x, ent.z, ent.moveTargetX, ent.moveTargetZ, layer, dist))) {
          moveX = dx / dist;
          moveZ = dz / dist;
        } else {
          // Cluster distant flow goals to 12m macro regions so squads share cached FlowFields
          const qx = dist > 24 ? Math.floor(ent.moveTargetX / 12) * 12 + 6 : ent.moveTargetX;
          const qz = dist > 24 ? Math.floor(ent.moveTargetZ / 12) * 12 + 6 : ent.moveTargetZ;
          const flow = requestFlowField(state, qx, qz, layer, 1);
          if (flow) {
            const emx = Math.max(0, Math.min(MACRO_SIZE - 1, Math.floor(ent.x / MACRO_CELL)));
            const emz = Math.max(0, Math.min(MACRO_SIZE - 1, Math.floor(ent.z / MACRO_CELL)));
            const fIdx = emz * MACRO_SIZE + emx;
            const fx = flow.dirX[fIdx] / 127;
            const fz = flow.dirZ[fIdx] / 127;
            if (fx !== 0 || fz !== 0) {
              moveX = fx;
              moveZ = fz;
            } else {
              moveX = dx / dist;
              moveZ = dz / dist;
            }
          } else {
            // While waiting in <= 2/tick queue, steer directly without hitching frame rate
            moveX = dx / dist;
            moveZ = dz / dist;
          }
        }
      }
    }

    // Local zero-GC Boids separation against units in the same height band
    let sepX = 0;
    let sepZ = 0;
    const isAir = layer === 'AIR';
    const mx = Math.max(0, Math.min(MACRO_SIZE - 1, Math.floor(ent.x / MACRO_CELL)));
    const mz = Math.max(0, Math.min(MACRO_SIZE - 1, Math.floor(ent.z / MACRO_CELL)));
    const myRadius = ent.radius ?? 1.2;

    for (let dzCell = -1; dzCell <= 1; dzCell++) {
      const nz = mz + dzCell;
      if (nz < 0 || nz >= MACRO_SIZE) continue;
      for (let dxCell = -1; dxCell <= 1; dxCell++) {
        const nx = mx + dxCell;
        if (nx < 0 || nx >= MACRO_SIZE) continue;
        let j = heads[nz * MACRO_SIZE + nx];
        while (j !== -1) {
          if (j !== i) {
            const other = entities[j];
            const otherAir = other.domain === 'AIR';
            if (otherAir === isAir && other.alive) {
              const ox = ent.x - other.x;
              const oz = ent.z - other.z;
              const minDist = myRadius + (other.radius ?? 1.2) + 0.35;
              const d2 = ox * ox + oz * oz;
              if (d2 < minDist * minDist) {
                const d = Math.sqrt(d2) || 0.001;
                const push = ((minDist - d) / minDist) * (hasMoveTarget ? 0.65 : 0.45);
                sepX += (ox / d) * push;
                sepZ += (oz / d) * push;
              }
            }
          }
          j = next[j];
        }
      }
    }

    if (!hasMoveTarget && Math.abs(sepX) < 0.01 && Math.abs(sepZ) < 0.01) {
      continue;
    }

    let vx = moveX * speed + sepX * Math.max(2.0, speed * 0.75);
    let vz = moveZ * speed + sepZ * Math.max(2.0, speed * 0.75);
    const vLen = Math.hypot(vx, vz);
    if (vLen > speed && speed > 0) {
      const scale = speed / vLen;
      vx *= scale;
      vz *= scale;
    }

    const nextX = Math.max(2, Math.min(WORLD_SIZE - 2, ent.x + vx * TICK_DT));
    const nextZ = Math.max(2, Math.min(WORLD_SIZE - 2, ent.z + vz * TICK_DT));
    const allowBid = ent.typeId === 'harvester' ? (ent.homeId ?? 0) : 0;

    if (layer === 'AIR') {
      ent.x = nextX;
      ent.z = nextZ;
      ent.y = Math.max(8.5, map.elevation[worldToGrid(ent.z) * MAP_SIZE + worldToGrid(ent.x)] + 7.5);
    } else {
      const gxN = worldToGrid(nextX);
      const gzN = worldToGrid(nextZ);
      const gxCur = worldToGrid(ent.x);
      const gzCur = worldToGrid(ent.z);

      // Axis-separated sliding against buildings & impassable terrain
      if (isFineCellPassable(map, gxN, gzN, layer, allowBid)) {
        ent.x = nextX;
        ent.z = nextZ;
      } else if (isFineCellPassable(map, gxN, gzCur, layer, allowBid)) {
        ent.x = nextX;
      } else if (isFineCellPassable(map, gxCur, gzN, layer, allowBid)) {
        ent.z = nextZ;
      }
      const curIdx = worldToGrid(ent.z) * MAP_SIZE + worldToGrid(ent.x);
      ent.y = layer === 'SEA' ? 0 : Math.max(0, map.elevation[curIdx]);
    }

    if (Math.hypot(ent.x - ent.prevX, ent.z - ent.prevZ) > 0.01) {
      const targetYaw = Math.atan2(ent.x - ent.prevX, ent.z - ent.prevZ);
      let diff = targetYaw - ent.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      ent.yaw += diff * 0.32;
      if (!ent.attackTargetId) {
        let tDiff = ent.yaw - ent.turretYaw;
        while (tDiff > Math.PI) tDiff -= Math.PI * 2;
        while (tDiff < -Math.PI) tDiff += Math.PI * 2;
        ent.turretYaw += tDiff * 0.25;
      }
    }
  }
}
