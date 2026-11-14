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
  worldToGrid
} from '../world/map.js';
import {
  findNearestPassableLand,
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
  if (player) ownedFactions.add(player.factionId);

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
  return list;
}

export function startProduction(state, playerId, queueKey, typeId, count = 1) {
  const player = state.players[playerId];
  const def = ENTITY_DEFS[typeId];
  if (!player || !def) return false;

  const targetQueueKey = def.queueKey ?? queueKey;
  if (queueKey && targetQueueKey !== queueKey) return false;
  if (!canBuildItem(state, playerId, typeId)) return false;

  if (targetQueueKey === 'main' || targetQueueKey === 'defense') {
    const cur = player.queues[targetQueueKey];
    if (cur) {
      if (cur.typeId === typeId && cur.status === 'PAUSED') {
        cur.status = 'BUILDING';
        return true;
      }
      return false;
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

  const targetKey = ENTITY_DEFS[typeId]?.queueKey ?? queueKey;
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

function spawnProducedUnit(state, player, def) {
  const producer = findPrimaryProducer(state, player.playerId, def.producerType);
  if (!producer) return null;

  let spawnX = producer.x;
  let spawnZ = producer.z + producer.footprintH * CELL_SIZE * 0.5 + 3.0;
  if (def.domain !== 'AIR' && def.domain !== 'SEA' && def.domain !== 'SUBMERGED') {
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
    z: spawnZ,
    homeId: producer.id
  });

  if (unit.typeId === 'harvester') {
    unit.fsmState = 'H_SEEK_ORE';
  } else if (producer.rallyX !== null && producer.rallyZ !== null) {
    unit.moveTargetX = producer.rallyX;
    unit.moveTargetZ = producer.rallyZ;
    unit.orderType = 'MOVE';
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

    // Concurrent unit queues: infantry (E), vehicle (R), air_naval (T)
    for (const qKey of ['infantry', 'vehicle', 'air_naval']) {
      const list = player.queues[qKey];
      if (!Array.isArray(list) || list.length === 0) continue;
      const head = list[0];
      const def = ENTITY_DEFS[head.typeId];
      if (!def) {
        list.shift();
        continue;
      }
      if (head.status === 'PAUSED' && player.credits >= 1 && getCompatibleProducerCount(state, player.playerId, def.producerType) > 0) {
        head.status = 'BUILDING';
      }
      if (advanceQueueItem(state, player, head, def)) {
        spawnProducedUnit(state, player, def);
        head.count -= 1;
        if (head.count <= 0) {
          list.shift();
        } else {
          head.progressTicks = 0;
          head.paidCost = 0;
          head.status = 'BUILDING';
        }
      }
    }
  }
}
