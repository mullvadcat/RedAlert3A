// 5-channel concurrent production queues (main/defense/infantry/vehicle/air_naval),
// 3-state power model, per-tick credit deduction, N===0 pause guard & multi-factory speed formula,
// building placement validation, repair & sell refund.
// Pure ESM: zero DOM / WebGL imports.

import {
  ECONOMY_CONFIG,
  ENTITY_DEFS,
  POWER_TIERS
} from '../core/config.js';
import { nextRandomInt } from '../core/events.js';
import {
  CELL_SIZE,
  MAP_SIZE,
  TERRAIN,
  gridToWorldCenter,
  worldToGrid
} from '../world/map.js';
import {
  findFreeAirpad,
  findNearestPassableLand,
  getAirpadWorldPos,
  removeEntity,
  spawnEntity
} from './entities.js';

export const QUEUE_KEYS = ['main', 'defense', 'infantry', 'vehicle', 'air_naval'];

export function createEmptyQueues() {
  return {
    main: null,
    defense: null,
    infantry: [],
    vehicle: [],
    air_naval: []
  };
}

export function updatePlayerPower(state, player) {
  let produced = 0;
  let consumed = 0;
  for (let i = 0; i < state.entities.length; i++) {
    const ent = state.entities[i];
    if (!ent.alive || ent.playerId !== player.playerId) continue;
    const def = ENTITY_DEFS[ent.typeId];
    if (!def || !def.power) continue;
    if (def.power > 0) {
      // Power generators output scales down proportionally when damaged
      const hpRatio = ent.typeId === 'conyard' ? 1.0 : Math.max(0.25, ent.hp / Math.max(1, ent.maxHp));
      produced += Math.round(def.power * hpRatio);
    } else {
      consumed += Math.abs(def.power);
    }
  }

  player.powerProduced = produced;
  player.powerConsumed = consumed;

  const ratio = consumed <= 0 ? 1.0 : produced / consumed;
  if (ratio >= POWER_TIERS.greenMinRatio) {
    player.powerState = 'green';
    player.powerFactor = POWER_TIERS.greenFactor;
    player.isLowPower = false;
  } else if (ratio >= POWER_TIERS.yellowMinRatio) {
    player.powerState = 'yellow';
    player.powerFactor = POWER_TIERS.yellowFactor;
    player.isLowPower = true;
  } else {
    player.powerState = 'red';
    player.powerFactor = POWER_TIERS.redFactor;
    player.isLowPower = true;
  }
}

export function getCompatibleProducerCount(state, playerId, producerType) {
  let count = 0;
  for (let i = 0; i < state.entities.length; i++) {
    const ent = state.entities[i];
    if (ent.alive && ent.playerId === playerId && ent.typeId === producerType) {
      count++;
    }
  }
  return count;
}

export function findPrimaryProducer(state, playerId, producerType) {
  for (let i = 0; i < state.entities.length; i++) {
    const ent = state.entities[i];
    if (ent.alive && ent.playerId === playerId && ent.typeId === producerType) {
      return ent;
    }
  }
  return null;
}

export function getPlayerTechUnlockSet(state, playerId) {
  const ownedTypes = new Set();
  const ownedFactions = new Set();
  const player = state.players[playerId];
  if (player) {
    ownedFactions.add(player.factionId);
    if (player.allowDualFaction) {
      ownedFactions.add('abyssal');
      ownedFactions.add('crimson');
    }
  }

  for (let i = 0; i < state.entities.length; i++) {
    const ent = state.entities[i];
    if (!ent.alive || ent.playerId !== playerId || !ent.isBuilding) continue;
    ownedTypes.add(ent.typeId);
    if (ent.factionId) ownedFactions.add(ent.factionId);
  }
  return { ownedTypes, ownedFactions };
}

export function canBuildItem(state, playerId, typeId) {
  const def = ENTITY_DEFS[typeId];
  if (!def || def.buildable === false) return false;

  const { ownedTypes, ownedFactions } = getPlayerTechUnlockSet(state, playerId);
  const factionAllowed = def.factions.some((f) => ownedFactions.has(f));
  if (!factionAllowed) return false;

  if (def.producerType && !ownedTypes.has(def.producerType)) return false;
  if (def.prereqs) {
    for (let i = 0; i < def.prereqs.length; i++) {
      if (!ownedTypes.has(def.prereqs[i])) return false;
    }
  }

  if (def.heroLimit) {
    let existing = 0;
    for (let i = 0; i < state.entities.length; i++) {
      const e = state.entities[i];
      if (e.alive && e.playerId === playerId && e.typeId === typeId) existing++;
    }
    const q = state.players[playerId]?.queues?.[def.queueKey];
    if (Array.isArray(q)) {
      for (let i = 0; i < q.length; i++) {
        if (q[i].typeId === typeId) existing += q[i].count;
      }
    }
    if (existing >= def.heroLimit) return false;
  }

  return true;
}

export function hasRequiredPrereqs(state, playerId, typeId) {
  const def = ENTITY_DEFS[typeId];
  if (!def) return false;
  if (!def.prereqs || def.prereqs.length === 0) return true;
  const { ownedTypes } = getPlayerTechUnlockSet(state, playerId);
  for (let i = 0; i < def.prereqs.length; i++) {
    if (!ownedTypes.has(def.prereqs[i])) return false;
  }
  return true;
}

export function getBuildableItemsForTab(state, playerId, queueKey, airNavalSubTab = null) {
  const list = [];
  for (const def of Object.values(ENTITY_DEFS)) {
    if (def.queueKey !== queueKey) continue;
    if (def.buildable === false) continue;
    if (queueKey === 'air_naval' && airNavalSubTab) {
      if (airNavalSubTab === 'air' && def.category !== 'air') continue;
      if (airNavalSubTab === 'naval' && def.category !== 'naval') continue;
    }
    if (canBuildItem(state, playerId, def.id)) {
      list.push(def);
    }
  }

  // Never hide an active or READY queued item from the sidebar even if its prerequisite was lost
  const seen = new Set(list.map((d) => d.id));
  const activeQueue = state.players?.[playerId]?.queues?.[queueKey];
  const entries = Array.isArray(activeQueue) ? activeQueue : (activeQueue ? [activeQueue] : []);
  for (let i = 0; i < entries.length; i++) {
    const qDef = ENTITY_DEFS[entries[i]?.typeId];
    if (!qDef || seen.has(qDef.id) || qDef.queueKey !== queueKey) continue;
    if (queueKey === 'air_naval' && airNavalSubTab) {
      if (airNavalSubTab === 'air' && qDef.category !== 'air') continue;
      if (airNavalSubTab === 'naval' && qDef.category !== 'naval') continue;
    }
    seen.add(qDef.id);
    list.push(qDef);
  }

  return list;
}

export function startProduction(state, playerId, queueKey, typeId, count = 1) {
  const player = state.players[playerId];
  const def = ENTITY_DEFS[typeId];
  if (!player || !def) return false;

  const normQueueKey = (queueKey === 'air' || queueKey === 'naval') ? 'air_naval' : queueKey;
  const targetQueueKey = def.queueKey ?? normQueueKey;
  if (normQueueKey && targetQueueKey !== normQueueKey) return false;
  if (!canBuildItem(state, playerId, typeId)) return false;

  if (targetQueueKey === 'main' || targetQueueKey === 'defense') {
    const cur = player.queues[targetQueueKey];
    if (cur) {
      if (cur.typeId === typeId && cur.status === 'PAUSED') {
        cur.status = 'BUILDING';
        return true;
      }
      if (cur.typeId !== typeId && !hasRequiredPrereqs(state, playerId, cur.typeId)) {
        if (cur.paidCost > 0) {
          player.credits += Math.round(cur.paidCost);
        }
        player.queues[targetQueueKey] = null;
        if (player.isHuman) {
          state.events.push({ type: 'hud:notice', playerId, key: 'hud.status.prodCancelledPrereq' });
        }
      } else {
        if (player.isHuman) {
          state.events.push({
            type: 'hud:notice',
            playerId,
            key: cur.status === 'READY' ? 'hud.status.queueReadyFirst' : 'hud.status.queueBusy'
          });
        }
        return false;
      }
    }
    player.queues[targetQueueKey] = {
      typeId,
      totalCost: def.cost,
      paidCost: 0,
      progressTicks: 0,
      totalTicks: def.buildTicks,
      status: 'BUILDING'
    };
    return true;
  }

  const queue = player.queues[targetQueueKey];
  if (!Array.isArray(queue)) return false;
  const addCount = Math.max(1, Math.min(99, count));

  // Merge into last entry if same typeId and headroom exists, else append
  const last = queue[queue.length - 1];
  if (last && last.typeId === typeId) {
    last.count = Math.min(99, last.count + addCount);
    if (last.status === 'PAUSED') last.status = 'BUILDING';
    return true;
  }

  queue.push({
    typeId,
    count: def.heroLimit ? 1 : addCount,
    totalCost: def.cost,
    paidCost: 0,
    progressTicks: 0,
    totalTicks: def.buildTicks,
    status: 'BUILDING'
  });
  return true;
}

export function cancelProduction(state, playerId, queueKey, typeId, count = 1) {
  const player = state.players[playerId];
  if (!player) return false;

  const normQueueKey = (queueKey === 'air' || queueKey === 'naval') ? 'air_naval' : queueKey;
  const targetKey = ENTITY_DEFS[typeId]?.queueKey ?? normQueueKey;
  if (!targetKey) return false;

  if (targetKey === 'main' || targetKey === 'defense') {
    const item = player.queues[targetKey];
    if (!item || (typeId && item.typeId !== typeId)) return false;
    // Left click on READY handled in UI; right click cancels & refunds 100% paidCost
    if (item.paidCost > 0) {
      player.credits += Math.round(item.paidCost);
    }
    player.queues[targetKey] = null;
    return true;
  }

  const queue = player.queues[targetKey];
  if (!Array.isArray(queue) || queue.length === 0) return false;
  let idx = -1;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (!typeId || queue[i].typeId === typeId) {
      idx = i;
      break;
    }
  }
  if (idx === -1) return false;

  const item = queue[idx];
  const removeCount = Math.max(1, count);
  if (item.count > removeCount) {
    item.count -= removeCount;
    return true;
  }

  if (item.paidCost > 0) {
    player.credits += Math.round(item.paidCost);
  }
  queue.splice(idx, 1);
  return true;
}

export function validateBuildingPlacement(state, playerId, typeId, gx, gz) {
  const map = state.map;
  const def = ENTITY_DEFS[typeId];
  if (!map || !def || !def.isBuilding) return { valid: false, reason: 'invalid_type' };

  const w = def.footprintW;
  const h = def.footprintH;
  if (gx < 1 || gz < 1 || gx + w >= MAP_SIZE - 1 || gz + h >= MAP_SIZE - 1) {
    return { valid: false, reason: 'out_of_bounds' };
  }

  const isMarine = def.domain === 'SEA';
  const refElev = map.elevation[gz * MAP_SIZE + gx];
  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      const idx = (gz + dz) * MAP_SIZE + (gx + dx);
      if (map.buildingId[idx] !== 0) return { valid: false, reason: 'occupied' };
      const t = map.terrain[idx];
      if (isMarine) {
        if (t !== TERRAIN.SEA) return { valid: false, reason: 'requires_sea' };
      } else {
        if (t !== TERRAIN.LAND) return { valid: false, reason: 'requires_land' };
        if (Math.abs(map.elevation[idx] - refElev) > 0.4) {
          return { valid: false, reason: 'uneven_terrain' };
        }
      }
    }
  }

  // Prevent burying regenerating ore pillars underneath concrete structures
  for (let i = 0; i < (state.orePillars?.length ?? 0); i++) {
    const p = state.orePillars[i];
    if (p.gx >= gx && p.gx < gx + w && p.gz >= gz && p.gz < gz + h) {
      return { valid: false, reason: 'ore_pillar_blocked' };
    }
  }

  // Naval Yard open-sea check: must connect to >= 24 contiguous SEA cells (blocks landlocked pools)
  if (isMarine) {
    const visited = new Set();
    const queue = [gz * MAP_SIZE + gx];
    visited.add(queue[0]);
    let head = 0;
    while (head < queue.length && visited.size < 24) {
      const cur = queue[head++];
      const cx0 = cur % MAP_SIZE;
      const cz0 = (cur - cx0) / MAP_SIZE;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let d = 0; d < 4; d++) {
        const nx = cx0 + dirs[d][0];
        const nz = cz0 + dirs[d][1];
        if (nx < 0 || nx >= MAP_SIZE || nz < 0 || nz >= MAP_SIZE) continue;
        const nIdx = nz * MAP_SIZE + nx;
        if (!visited.has(nIdx) && map.terrain[nIdx] === TERRAIN.SEA) {
          visited.add(nIdx);
          queue.push(nIdx);
        }
      }
    }
    if (visited.size < 24) {
      return { valid: false, reason: 'requires_open_sea' };
    }
  }

  // Build radius check: <= 18 cells from conyard center, or <= 8 cells (12 for naval_yard) from friendly land building edge
  const cx = gx + w * 0.5;
  const cz = gz + h * 0.5;
  let inRadius = false;

  for (let i = 0; i < state.entities.length; i++) {
    const ent = state.entities[i];
    if (!ent.alive || !ent.isBuilding || ent.playerId !== playerId) continue;
    const fx = ent.gx + ent.footprintW * 0.5;
    const fz = ent.gz + ent.footprintH * 0.5;
    const distCells = Math.hypot(cx - fx, cz - fz);

    if (ent.typeId === 'conyard') {
      if (distCells <= ECONOMY_CONFIG.buildRadiusConyardCells + Math.max(w, h) * 0.5) {
        inRadius = true;
        break;
      }
    } else if (ent.domain === 'GROUND') {
      const maxEdgeDist = isMarine
        ? ECONOMY_CONFIG.buildRadiusNavalNearLandCells
        : ECONOMY_CONFIG.buildRadiusBuildingCells;
      const dxEdge = Math.max(0, Math.abs(cx - fx) - (ent.footprintW + w) * 0.5);
      const dzEdge = Math.max(0, Math.abs(cz - fz) - (ent.footprintH + h) * 0.5);
      if (Math.hypot(dxEdge, dzEdge) <= maxEdgeDist) {
        inRadius = true;
        break;
      }
    }
  }

  if (!inRadius) return { valid: false, reason: 'out_of_build_radius' };
  return { valid: true, reason: null };
}

export function placeBuilding(state, playerId, typeId, gx, gz) {
  const player = state.players[playerId];
  const def = ENTITY_DEFS[typeId];
  if (!player || !def) return null;

  const qKey = def.queueKey;
  const active = player.queues[qKey];
  if (!active || active.typeId !== typeId || active.status !== 'READY') {
    return null;
  }

  const check = validateBuildingPlacement(state, playerId, typeId, gx, gz);
  if (!check.valid) {
    state.events.push({ type: 'hud:notice', playerId, key: 'hud.status.placeInvalid' });
    return null;
  }

  player.queues[qKey] = null;
  const bld = spawnEntity(state, {
    typeId,
    playerId,
    teamId: player.teamId,
    factionId: player.factionId,
    gx,
    gz
  });

  if (def.grantsHarvester) {
    const exitPos = findNearestPassableLand(
      state.map,
      bld.x,
      bld.z + bld.footprintH * CELL_SIZE * 0.5 + 3.0
    );
    const harv = spawnEntity(state, {
      typeId: 'harvester',
      playerId,
      teamId: player.teamId,
      factionId: player.factionId,
      x: exitPos.x,
      z: exitPos.z,
      homeId: bld.id
    });
    harv.fsmState = 'H_SEEK_ORE';
    state.events.push({ type: 'hud:notice', playerId, key: 'hud.status.harvesterSpawned' });
  }

  updatePlayerPower(state, player);
  return bld;
}

export function sellBuilding(state, playerId, entityId) {
  const ent = state.entityById.get(entityId);
  const player = state.players[playerId];
  if (!ent || !ent.alive || !ent.isBuilding || ent.playerId !== playerId || !player) return false;

  const def = ENTITY_DEFS[ent.typeId];
  const refund = Math.round((def?.cost ?? 0) * ECONOMY_CONFIG.sellRefundRatio);
  player.credits += refund;

  const spawnPos = findNearestPassableLand(state.map, ent.x, ent.z);
  const garrisonType = player.factionId === 'crimson' ? 'conscript' : 'gi';
  const survivorCount = nextRandomInt(state, 1, 2);

  removeEntity(state, ent.id, 'sold');
  for (let i = 0; i < survivorCount; i++) {
    spawnEntity(state, {
      typeId: garrisonType,
      playerId,
      teamId: player.teamId,
      factionId: player.factionId,
      x: spawnPos.x + i * 1.4,
      z: spawnPos.z
    });
  }

  updatePlayerPower(state, player);
  return true;
}

function findNearestSeaExit(map, worldX, worldZ) {
  if (!map) return { x: worldX, z: worldZ };
  const cx = worldToGrid(worldX);
  const cz = worldToGrid(worldZ);
  for (let r = 0; r <= 6; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 1 || gx >= MAP_SIZE - 1 || gz < 1 || gz >= MAP_SIZE - 1) continue;
        const idx = gz * MAP_SIZE + gx;
        if (map.terrain[idx] === TERRAIN.SEA && map.buildingId[idx] === 0) {
          return { x: gridToWorldCenter(gx), z: gridToWorldCenter(gz) };
        }
      }
    }
  }
  return { x: worldX, z: worldZ };
}

function spawnProducedUnit(state, player, def) {
  const producer = findPrimaryProducer(state, player.playerId, def.producerType);
  if (!producer) return null;

  let spawnX = producer.x;
  let spawnZ = producer.z + producer.footprintH * CELL_SIZE * 0.5 + 3.0;
  let spawnY;
  let homeId = producer.id;
  let airState;
  let padIndex = 0;

  if (def.producerType === 'airforce_radar') {
    const pad = findFreeAirpad(state, player.playerId);
    const targetRadar = pad?.radar ?? producer;
    padIndex = pad?.padIndex ?? 0;
    const pos = getAirpadWorldPos(targetRadar, padIndex);
    spawnX = pos.x;
    spawnY = pos.y;
    spawnZ = pos.z;
    homeId = targetRadar.id;
    airState = 'A_DOCKED';
  } else if (def.domain === 'AIR') {
    // War Factory vertical roof liftoff (Nighthawk / Kirov) — bypasses Airforce helipads completely
    spawnX = producer.x;
    spawnY = (producer.y ?? 1.6) + 2.8;
    spawnZ = producer.z;
    airState = 'A_AIRBORNE';
  } else if (def.domain === 'SEA' || def.domain === 'SUBMERGED') {
    const seaPos = findNearestSeaExit(state.map, producer.x, producer.z + producer.footprintH * CELL_SIZE * 0.5 + 3.0);
    spawnX = seaPos.x;
    spawnZ = seaPos.z;
  } else {
    const safe = findNearestPassableLand(state.map, spawnX, spawnZ);
    spawnX = safe.x;
    spawnZ = safe.z;
  }

  const unit = spawnEntity(state, {
    typeId: def.id,
    playerId: player.playerId,
    teamId: player.teamId,
    factionId: player.factionId,
    x: spawnX,
    y: spawnY,
    z: spawnZ,
    homeId,
    airState,
    padIndex
  });

  if (unit.typeId === 'harvester') {
    unit.fsmState = 'H_SEEK_ORE';
  } else if (def.producerType !== 'airforce_radar' && producer.rallyX !== null && producer.rallyZ !== null) {
    unit.moveTargetX = producer.rallyX;
    unit.moveTargetZ = producer.rallyZ;
    unit.orderType = 'MOVE';
  }

  if (unit.typeId === 'kirov') {
    // Broadcast global Kirov airship liftoff warning to player 0 & telemetry
    state.events.push({
      type: 'hud:notice',
      playerId: 0,
      globalAlert: true,
      key: 'hud.status.kirovReporting',
      x: unit.x,
      z: unit.z
    });
  }

  player.stats.produced += 1;
  state.events.push({ type: 'production:completed', playerId: player.playerId, entityId: unit.id, typeId: unit.typeId });
  return unit;
}

function advanceQueueItem(state, player, item, def) {
  const compatibleCount = getCompatibleProducerCount(state, player.playerId, def.producerType);
  // Strict N === 0 guard: pause immediately, never divide or evaluate (1 + 0.25 * (0 - 1))
  if (compatibleCount === 0) {
    item.status = 'PAUSED';
    return false;
  }
  if (item.status === 'READY' || item.status === 'PAUSED') {
    return false;
  }

  const speedMult =
    (1 + 0.25 * Math.min(compatibleCount - 1, 4)) *
    player.powerFactor *
    (state.fastBuild ? 10 : 1);

  const remainingTicks = Math.max(0, item.totalTicks - item.progressTicks);
  const deltaTicks = Math.min(remainingTicks, speedMult);
  const nextProgress = item.progressTicks + deltaTicks;
  const targetPaid = item.totalTicks > 0
    ? Math.min(item.totalCost, (nextProgress / item.totalTicks) * item.totalCost)
    : item.totalCost;
  const costDue = Math.max(0, targetPaid - item.paidCost);

  if (costDue > 0 && player.credits <= 0.0001) {
    item.status = 'PAUSED';
    if (player.isHuman && state.tickCount % 60 === 0) {
      state.events.push({ type: 'hud:notice', playerId: player.playerId, key: 'hud.status.insufficientCredits' });
    }
    return false;
  }

  if (costDue > player.credits) {
    const ratio = player.credits / costDue;
    item.paidCost += player.credits;
    player.stats.spentValue += player.credits;
    player.credits = 0;
    item.progressTicks += deltaTicks * ratio;
    item.status = 'PAUSED';
    return false;
  }

  player.credits -= costDue;
  player.stats.spentValue += costDue;
  item.paidCost += costDue;
  item.progressTicks = nextProgress;

  if (item.progressTicks >= item.totalTicks - 1e-5) {
    item.progressTicks = item.totalTicks;
    return true; // Completed!
  }
  return false;
}

export function stepProductionAndPower(state) {
  for (let p = 0; p < state.players.length; p++) {
    const player = state.players[p];
    const wasLowPower = player.isLowPower;
    updatePlayerPower(state, player);
    if (!wasLowPower && player.isLowPower && player.isHuman) {
      state.events.push({ type: 'hud:notice', playerId: player.playerId, key: 'hud.status.lowPower' });
    }

    // Single-slot structure queues: main (Q) & defense (W)
    for (const qKey of ['main', 'defense']) {
      const item = player.queues[qKey];
      if (!item) continue;
      const def = ENTITY_DEFS[item.typeId];
      if (!def) continue;
      if (item.status !== 'READY' && !hasRequiredPrereqs(state, player.playerId, item.typeId)) {
        if (item.paidCost > 0) {
          player.credits += Math.round(item.paidCost);
        }
        player.queues[qKey] = null;
        if (player.isHuman) {
          state.events.push({ type: 'hud:notice', playerId: player.playerId, key: 'hud.status.prodCancelledPrereq' });
        }
        continue;
      }
      if (item.status === 'READY') continue;
      // Resume automatically when credits recover or producer comes back
      if (item.status === 'PAUSED' && player.credits >= 1 && getCompatibleProducerCount(state, player.playerId, def.producerType) > 0) {
        item.status = 'BUILDING';
      }
      if (advanceQueueItem(state, player, item, def)) {
        item.status = 'READY';
        state.events.push({ type: 'production:ready', playerId: player.playerId, queueKey: qKey, typeId: item.typeId });
      }
    }

    // Concurrent unit queues: infantry (E), vehicle (R), air_naval (T - independent per producerType)
    for (const qKey of ['infantry', 'vehicle', 'air_naval']) {
      const list = player.queues[qKey];
      if (!Array.isArray(list) || list.length === 0) continue;
      const seenProducers = new Set();
      let idx = 0;
      while (idx < list.length) {
        const item = list[idx];
        const def = ENTITY_DEFS[item.typeId];
        if (!def) {
          list.splice(idx, 1);
          continue;
        }
        const prodKey = def.producerType ?? qKey;
        if (seenProducers.has(prodKey)) {
          idx++;
          continue;
        }
        seenProducers.add(prodKey);
        if (item.status === 'PAUSED' && player.credits >= 1 && getCompatibleProducerCount(state, player.playerId, def.producerType) > 0) {
          item.status = 'BUILDING';
        }
        if (advanceQueueItem(state, player, item, def)) {
          spawnProducedUnit(state, player, def);
          item.count -= 1;
          if (item.count <= 0) {
            list.splice(idx, 1);
            continue;
          }
          item.progressTicks = 0;
          item.paidCost = 0;
          item.status = 'BUILDING';
        }
        idx++;
      }
    }
  }
}
