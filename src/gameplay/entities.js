// Unified entity lifecycle pool, MCV deploy, Veterancy (0/1/2 override),
// and Harvester 7-state FSM (H_IDLE -> H_SEEK_ORE -> H_MOVE_TO_ORE -> H_HARVESTING -> H_RETURN -> H_DOCKING -> H_UNLOADING).
// Pure ESM: zero DOM / WebGL imports.

import {
  ECONOMY_CONFIG,
  ENTITY_DEFS,
  FACTIONS,
  TICK_DT,
  VETERANCY_CONFIG
} from '../core/config.js';
import {
  CELL_SIZE,
  MAP_SIZE,
  ORE_TYPE,
  TERRAIN,
  WORLD_SIZE,
  gridToWorldCenter,
  worldToGrid
} from '../world/map.js';

export function findNearestPassableLand(map, worldX, worldZ, maxRadiusCells = 8) {
  const cx = worldToGrid(worldX);
  const cz = worldToGrid(worldZ);
  for (let r = 0; r <= maxRadiusCells; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 1 || gx >= MAP_SIZE - 1 || gz < 1 || gz >= MAP_SIZE - 1) continue;
        const idx = gz * MAP_SIZE + gx;
        const t = map.terrain[idx];
        if ((t === TERRAIN.LAND || t === TERRAIN.BRIDGE) && map.buildingId[idx] === 0) {
          return { x: gridToWorldCenter(gx), z: gridToWorldCenter(gz), elev: map.elevation[idx] };
        }
      }
    }
  }
  return { x: worldX, z: worldZ, elev: map.elevation[cz * MAP_SIZE + cx] ?? 1.6 };
}

const AIRPAD_OFFSETS = [
  [-1.0, -1.2],
  [1.0, -1.2],
  [-1.0, 1.2],
  [1.0, 1.2]
];

export function getAirpadWorldPos(radar, padIndex = 0) {
  const off = AIRPAD_OFFSETS[padIndex & 3];
  return {
    x: radar.x + off[0],
    y: (radar.y ?? 1.6) + 2.25,
    z: radar.z + off[1]
  };
}

export function findFreeAirpad(state, playerId) {
  const radars = [];
  for (let i = 0; i < state.entities.length; i++) {
    const e = state.entities[i];
    if (e.alive && e.typeId === 'airforce_radar' && e.playerId === playerId) {
      radars.push(e);
    }
  }
  if (radars.length === 0) return null;

  for (let r = 0; r < radars.length; r++) {
    const radar = radars[r];
    const used = [false, false, false, false];
    for (let i = 0; i < state.entities.length; i++) {
      const a = state.entities[i];
      if (!a.alive || a.playerId !== playerId) continue;
      if (ENTITY_DEFS[a.typeId]?.producerType !== 'airforce_radar') continue;
      if (a.homeId === radar.id) {
        used[(a.padIndex ?? 0) & 3] = true;
      }
    }
    const freeIdx = used.indexOf(false);
    if (freeIdx !== -1) return { radar, padIndex: freeIdx };
  }
  return { radar: radars[0], padIndex: 0 };
}

export function applyVeterancyRank(ent, rank) {
  const safeRank = Math.max(0, Math.min(2, rank));
  const vet = VETERANCY_CONFIG[safeRank] ?? VETERANCY_CONFIG[0];
  const prevMaxHp = ent.maxHp || ent.baseMaxHp;
  const newMaxHp = Math.max(1, Math.round(ent.baseMaxHp * vet.hpMult));

  ent.veterancy = safeRank;
  ent.damage = Math.round(ent.baseDamage * vet.damageMult);
  ent.speed = ent.baseSpeed * vet.speedMult;
  ent.sight = ent.baseSight + vet.sightBonus;
  ent.cooldownTicks = ent.baseCooldownTicks > 0
    ? Math.max(1, Math.round(ent.baseCooldownTicks * vet.cooldownMult))
    : 0;
  ent.damageTakenMult = vet.damageTakenMult;
  ent.maxHp = newMaxHp;
  if (prevMaxHp > 0 && newMaxHp !== prevMaxHp) {
    ent.hp = Math.max(1, Math.min(newMaxHp, Math.round(ent.hp * (newMaxHp / prevMaxHp))));
  }
}

export function grantKillExperience(state, attacker, victim) {
  if (!attacker || !attacker.alive || attacker.isBuilding || !victim) return;
  const victimCost = ENTITY_DEFS[victim.typeId]?.cost ?? 0;
  const attackerCost = Math.max(100, ENTITY_DEFS[attacker.typeId]?.cost ?? 100);
  attacker.killValue += victimCost;

  const ratio = attacker.killValue / attackerCost;
  let nextRank = attacker.veterancy;
  if (ratio >= VETERANCY_CONFIG[2].minKillRatio) nextRank = 2;
  else if (ratio >= VETERANCY_CONFIG[1].minKillRatio) nextRank = Math.max(nextRank, 1);

  if (nextRank > attacker.veterancy) {
    applyVeterancyRank(attacker, nextRank);
    state.events.push({ type: 'entity:promoted', entityId: attacker.id, rank: nextRank });
  }
}

export function spawnEntity(state, spec) {
  const def = ENTITY_DEFS[spec.typeId];
  if (!def) {
    throw new Error(`Unknown canonical entity typeId: ${spec.typeId}`);
  }

  const id = spec.id ?? state.nextEntityId++;
  if (id >= state.nextEntityId) state.nextEntityId = id + 1;

  const isBuilding = Boolean(def.isBuilding);
  const w = def.footprintW ?? 1;
  const h = def.footprintH ?? 1;
  let gx = spec.gx ?? worldToGrid(spec.x ?? 100);
  let gz = spec.gz ?? worldToGrid(spec.z ?? 100);
  let x = spec.x;
  let z = spec.z;

  if (isBuilding) {
    gx = Math.max(0, Math.min(MAP_SIZE - w, gx));
    gz = Math.max(0, Math.min(MAP_SIZE - h, gz));
    x = (gx + w * 0.5) * CELL_SIZE;
    z = (gz + h * 0.5) * CELL_SIZE;
  } else if (x === undefined || z === undefined) {
    x = gridToWorldCenter(gx);
    z = gridToWorldCenter(gz);
  }

  let y = spec.y ?? 0;
  if (state.map) {
    const cIdx = worldToGrid(z) * MAP_SIZE + worldToGrid(x);
    if (def.domain === 'AIR') y = Math.max(8.5, state.map.elevation[cIdx] + 7.5);
    else if (def.domain === 'SEA' || def.domain === 'SUBMERGED') y = 0;
    else y = Math.max(0, state.map.elevation[cIdx]);
  }

  const weapon = def.weapon ?? null;
  const baseMaxHp = def.hp;
  const ent = {
    id,
    typeId: def.id,
    category: def.category,
    domain: def.domain,
    isBuilding,
    isStructure: Boolean(def.isStructure),
    footprintW: w,
    footprintH: h,
    gx,
    gz,
    alive: true,
    playerId: spec.playerId ?? 0,
    teamId: spec.teamId ?? spec.playerId ?? 0,
    factionId: spec.factionId ?? FACTIONS.abyssal.id,
    producerType: def.producerType ?? null,

    x,
    z,
    y,
    prevX: x,
    prevZ: z,
    prevY: y,
    yaw: spec.yaw ?? 0,
    turretYaw: spec.yaw ?? 0,
    recoil: 0,
    radius: def.radius ?? (isBuilding ? Math.max(w, h) * CELL_SIZE * 0.45 : 1.0),

    hp: spec.hp ?? baseMaxHp,
    maxHp: baseMaxHp,
    baseMaxHp,
    baseDamage: weapon?.damage ?? 0,
    baseSpeed: def.speed ?? 0,
    baseCooldownTicks: weapon?.cooldownTicks ?? 0,
    baseSight: def.sight ?? 12,
    damage: weapon?.damage ?? 0,
    speed: def.speed ?? 0,
    cooldownTicks: weapon?.cooldownTicks ?? 0,
    sight: def.sight ?? 12,
    damageTakenMult: 1.0,
    armor: def.armor ?? 'None',
    pendingDamage: 0,

    eraseProgress: 0,
    frozenByCount: 0,
    ironCurtainTicks: 0,
    empTicks: 0,
    stunTicks: 0,
    surfacedTicks: 0,
    revealTicks: 0,
    c4CooldownTicks: 0,
    deployState: 'MOBILE',

    veterancy: spec.veterancy ?? 0,
    killValue: spec.killValue ?? 0,
    lastCombatTick: -999,
    fireCooldownTicks: 0,
    isRepairing: false,
    isStealthed: Boolean(def.stealth),

    orderType: 'IDLE',
    moveTargetX: null,
    moveTargetZ: null,
    moveStopDist: 0.9,
    attackTargetId: null,
    interactTargetId: null,
    boardTargetId: null,
    chronoLockTargetId: null,
    rallyX: isBuilding ? x : null,
    rallyZ: isBuilding ? Math.min(WORLD_SIZE - 4, z + h * CELL_SIZE * 0.5 + 3.0) : null,

    fsmState: def.id === 'harvester' ? 'H_IDLE' : 'IDLE',
    fsmTimerTicks: 0,
    passiveTimerTicks: def.passiveIntervalTicks ?? 0,
    cargoCount: 0,
    cargoValue: 0,
    targetOreGx: -1,
    targetOreGz: -1,
    homeId: spec.homeId ?? null,
    ammo: def.maxAmmo ?? 0,
    airState: spec.airState ?? (def.producerType === 'airforce_radar' ? 'A_DOCKED' : 'A_AIRBORNE'),
    padIndex: spec.padIndex ?? 0,
    cargoIds: [],
    cargoList: [],
    drones: def.maxDrones
      ? Array.from({ length: def.maxDrones }, (_, idx) => ({
          id: `${id}_d${idx}`,
          index: idx,
          fsmState: 'D_DOCKED',
          timerTicks: 0,
          targetId: null,
          x,
          y: y + 2.2,
          z,
          yaw: spec.yaw ?? 0,
          fuelTicks: 300,
          reservedDamage: 0,
          released: true
        }))
      : null,
    droneLaunchCooldown: 0
  };

  if (ent.veterancy > 0) {
    applyVeterancyRank(ent, ent.veterancy);
  }

  state.entities.push(ent);
  state.entityById.set(ent.id, ent);

  if (isBuilding && state.map) {
    for (let dz = 0; dz < h; dz++) {
      for (let dx = 0; dx < w; dx++) {
        const idx = (gz + dz) * MAP_SIZE + (gx + dx);
        state.map.buildingId[idx] = ent.id;
      }
    }
    state.map.revision++;

    // Wake any idle friendly harvesters when a refinery finishes construction
    if (ent.typeId === 'refinery') {
      wakeIdleHarvestersForPlayer(state, ent.playerId, ent.id);
    }
  }

  state.events.push({ type: 'entity:spawned', entityId: ent.id, typeId: ent.typeId, playerId: ent.playerId });
  return ent;
}

export function wakeIdleHarvestersForPlayer(state, playerId, refineryId) {
  for (let i = 0; i < state.entities.length; i++) {
    const h = state.entities[i];
    if (!h.alive || h.typeId !== 'harvester' || h.playerId !== playerId) continue;
    if (!h.homeId || !state.entityById.get(h.homeId)?.alive) {
      h.homeId = refineryId;
    }
    if (h.fsmState === 'H_IDLE') {
      h.fsmState = h.cargoCount >= ECONOMY_CONFIG.maxHarvesterCargoCells ? 'H_RETURN' : 'H_SEEK_ORE';
      h.fsmTimerTicks = 0;
    }
  }
}

export function removeEntity(state, entityId, reason = 'destroyed') {
  const ent = state.entityById.get(entityId);
  if (!ent || !ent.alive) return;

  ent.alive = false;
  state.entityById.delete(entityId);

  if (ent.isBuilding && state.map) {
    for (let dz = 0; dz < ent.footprintH; dz++) {
      for (let dx = 0; dx < ent.footprintW; dx++) {
        const cx = ent.gx + dx;
        const cz = ent.gz + dz;
        if (cx >= 0 && cx < MAP_SIZE && cz >= 0 && cz < MAP_SIZE) {
          const idx = cz * MAP_SIZE + cx;
          if (state.map.buildingId[idx] === ent.id) {
            state.map.buildingId[idx] = 0;
          }
        }
      }
    }
    state.map.revision++;

    // Orphan harvester handling: switch to another friendly refinery or halt cleanly in H_IDLE
    if (ent.typeId === 'refinery') {
      let backup = null;
      for (let i = 0; i < state.entities.length; i++) {
        const cand = state.entities[i];
        if (cand.alive && cand.typeId === 'refinery' && cand.playerId === ent.playerId) {
          backup = cand;
          break;
        }
      }
      for (let i = 0; i < state.entities.length; i++) {
        const harv = state.entities[i];
        if (harv.alive && harv.typeId === 'harvester' && harv.homeId === ent.id) {
          if (backup) {
            harv.homeId = backup.id;
          } else {
            harv.homeId = null;
            if (harv.fsmState === 'H_RETURN' || harv.fsmState === 'H_DOCKING' || harv.fsmState === 'H_UNLOADING') {
              harv.fsmState = 'H_IDLE';
              harv.moveTargetX = null;
              harv.moveTargetZ = null;
              harv.orderType = 'IDLE';
            }
          }
        }
      }
    }
  }

  // Orphan airborne carrier drones detach on carrier destruction and crash when out of fuel
  if (ent.drones && reason !== 'boarded') {
    if (!state.orphanDrones) state.orphanDrones = [];
    for (let i = 0; i < ent.drones.length; i++) {
      const d = ent.drones[i];
      if (d.fsmState === 'D_LAUNCHING' || d.fsmState === 'D_ATTACK_RUN' || d.fsmState === 'D_RETURNING') {
        d.fuelTicks = Math.min(d.fuelTicks ?? 45, 30);
        d.fsmState = 'D_ORPHAN';
        state.orphanDrones.push(d);
      }
    }
  }

  if (ent.cargoList && ent.cargoList.length > 0 && reason !== 'boarded') {
    ent.cargoList.length = 0;
    ent.cargoIds.length = 0;
  }

  const eventTypeMap = {
    sold: 'entity:sold',
    deployed: 'entity:deployed',
    erased: 'entity:erased',
    boarded: 'entity:boarded',
    consumed: 'entity:consumed'
  };

  state.events.push({
    type: eventTypeMap[reason] ?? 'entity:destroyed',
    entityId: ent.id,
    typeId: ent.typeId,
    playerId: ent.playerId,
    teamId: ent.teamId,
    x: ent.x,
    z: ent.z,
    y: ent.y,
    reason
  });
}

export function compactDeadEntities(state) {
  let write = 0;
  for (let read = 0; read < state.entities.length; read++) {
    if (state.entities[read].alive) {
      if (write !== read) state.entities[write] = state.entities[read];
      write++;
    }
  }
  state.entities.length = write;
}

export function deployEntity(state, ent) {
  if (!ent || !ent.alive) return false;
  if (ent.typeId === 'mcv') {
    const def = ENTITY_DEFS.conyard;
    const gx = Math.max(0, Math.min(MAP_SIZE - def.footprintW, worldToGrid(ent.x) - 2));
    const gz = Math.max(0, Math.min(MAP_SIZE - def.footprintH, worldToGrid(ent.z) - 2));
    const map = state.map;
    if (!map) return false;

    const refElev = map.elevation[gz * MAP_SIZE + gx];
    for (let dz = 0; dz < def.footprintH; dz++) {
      for (let dx = 0; dx < def.footprintW; dx++) {
        const idx = (gz + dz) * MAP_SIZE + (gx + dx);
        if (map.terrain[idx] !== TERRAIN.LAND || map.buildingId[idx] !== 0) {
          state.events.push({ type: 'hud:notice', playerId: ent.playerId, key: 'hud.status.deployBlocked' });
          return false;
        }
        if (Math.abs(map.elevation[idx] - refElev) > 0.35) {
          state.events.push({ type: 'hud:notice', playerId: ent.playerId, key: 'hud.status.deployBlocked' });
          return false;
        }
      }
    }

    const hpRatio = ent.hp / Math.max(1, ent.maxHp);
    const yardHp = Math.max(1, Math.round(def.hp * hpRatio));
    const { playerId, teamId, factionId } = ent;
    removeEntity(state, ent.id, 'deployed');
    spawnEntity(state, {
      typeId: 'conyard',
      playerId,
      teamId,
      factionId,
      gx,
      gz,
      hp: yardHp
    });
    state.events.push({ type: 'hud:notice', playerId, key: 'hud.status.deployed' });
    return true;
  }

  if (ent.typeId === 'gi') {
    if (ent.deployState === 'DEPLOYED') {
      ent.deployState = 'MOBILE';
      ent.baseDamage = ENTITY_DEFS.gi.weapon.damage;
      ent.damageTakenMult = VETERANCY_CONFIG[ent.veterancy]?.damageTakenMult ?? 1.0;
    } else {
      ent.deployState = 'DEPLOYED';
      ent.moveTargetX = null;
      ent.moveTargetZ = null;
      ent.orderType = 'IDLE';
      ent.baseDamage = ENTITY_DEFS.gi.deployedWeapon.damage;
      ent.damageTakenMult = (VETERANCY_CONFIG[ent.veterancy]?.damageTakenMult ?? 1.0) * 0.65;
    }
    applyVeterancyRank(ent, ent.veterancy);
    return true;
  }

  if (ent.typeId === 'ifv' || ent.typeId === 'hover_transport' || ent.typeId === 'nighthawk') {
    return unloadTransport(state, ent);
  }

  return false;
}

export function getCargoSlotSize(ent) {
  if (!ent) return 99;
  if (ent.category === 'infantry') return 1;
  if (ent.typeId === 'harvester' || ent.typeId === 'mcv' || ent.typeId === 'apocalypse') return 4;
  return 2;
}

function findPassableUnloadSpot(map, worldX, worldZ, maxRadiusCells = 7) {
  if (!map) return { x: worldX, z: worldZ, elev: 1.6 };
  const cx = worldToGrid(worldX);
  const cz = worldToGrid(worldZ);
  for (let r = 0; r <= maxRadiusCells; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const gx = cx + dx;
        const gz = cz + dz;
        if (gx < 1 || gx >= MAP_SIZE - 1 || gz < 1 || gz >= MAP_SIZE - 1) continue;
        const idx = gz * MAP_SIZE + gx;
        const t = map.terrain[idx];
        if ((t === TERRAIN.LAND || t === TERRAIN.BRIDGE) && map.buildingId[idx] === 0) {
          return { x: gridToWorldCenter(gx), z: gridToWorldCenter(gz), elev: Math.max(0, map.elevation[idx]) };
        }
      }
    }
  }
  return null;
}

export function getUsedCargoSlots(transport) {
  if (!transport?.cargoList) return 0;
  let used = 0;
  for (let i = 0; i < transport.cargoList.length; i++) {
    used += getCargoSlotSize(transport.cargoList[i]);
  }
  return used;
}

export function canBoardTransport(transport, passenger) {
  if (!transport || !passenger || !transport.alive || !passenger.alive) return false;
  if (transport.id === passenger.id || transport.playerId !== passenger.playerId) return false;
  if (passenger.isBuilding || passenger.frozenByCount > 0) return false;
  const maxSlots = ENTITY_DEFS[transport.typeId]?.transportSlots ?? 0;
  if (maxSlots <= 0) return false;
  if ((ENTITY_DEFS[passenger.typeId]?.transportSlots ?? 0) > 0) return false;
  if (transport.typeId === 'ifv' || transport.typeId === 'nighthawk') {
    if (passenger.category !== 'infantry') return false;
  } else if (passenger.domain === 'AIR' || passenger.domain === 'SEA' || passenger.domain === 'SUBMERGED') {
    return false;
  }
  return getUsedCargoSlots(transport) + getCargoSlotSize(passenger) <= maxSlots;
}

export function boardTransport(state, transport, passenger) {
  if (!canBoardTransport(transport, passenger)) return false;
  passenger.boardTargetId = null;
  passenger.moveTargetX = null;
  passenger.moveTargetZ = null;
  passenger.attackTargetId = null;
  passenger.interactTargetId = null;
  passenger.orderType = 'IDLE';
  removeEntity(state, passenger.id, 'boarded');
  transport.cargoList.push(passenger);
  transport.cargoIds.push(passenger.id);
  state.events.push({ type: 'transport:boarded', transportId: transport.id, passengerId: passenger.id, typeId: passenger.typeId });
  return true;
}

export function unloadTransport(state, transport) {
  if (!transport || !transport.alive || !transport.cargoList || transport.cargoList.length === 0) {
    return false;
  }
  const baseSpot = findPassableUnloadSpot(state.map, transport.x, transport.z, 7);
  if (!baseSpot) {
    state.events.push({ type: 'hud:notice', playerId: transport.playerId, key: 'hud.status.deployBlocked' });
    return false;
  }

  const unloadedIds = [];
  for (let i = 0; i < transport.cargoList.length; i++) {
    const p = transport.cargoList[i];
    const angle = (i / Math.max(1, transport.cargoList.length)) * Math.PI * 2;
    const spot = findPassableUnloadSpot(
      state.map,
      baseSpot.x + Math.cos(angle) * (1.2 + (i % 3) * 0.9),
      baseSpot.z + Math.sin(angle) * (1.2 + (i % 3) * 0.9),
      6
    ) ?? baseSpot;

    p.alive = true;
    p.x = spot.x;
    p.z = spot.z;
    p.prevX = spot.x;
    p.prevZ = spot.z;
    p.y = spot.elev;
    p.prevY = spot.elev;
    p.moveTargetX = null;
    p.moveTargetZ = null;
    p.attackTargetId = null;
    p.boardTargetId = null;
    p.orderType = 'IDLE';

    state.entities.push(p);
    state.entityById.set(p.id, p);
    unloadedIds.push(p.id);
  }

  transport.cargoList.length = 0;
  transport.cargoIds.length = 0;
  state.events.push({ type: 'transport:unloaded', transportId: transport.id, passengerIds: unloadedIds });
  return true;
}

export function transferEntityOwner(state, target, newPlayerId, newTeamId) {
  if (!target || !target.alive) return false;
  const wasNeutralOil = target.typeId === 'oil_derrick' && target.teamId === 3;
  target.playerId = newPlayerId;
  target.teamId = newTeamId;
  target.attackTargetId = null;
  if (wasNeutralOil) {
    const player = state.players[newPlayerId];
    if (player) {
      player.credits += ENTITY_DEFS.oil_derrick.captureBonus ?? 500;
    }
    target.passiveTimerTicks = ENTITY_DEFS.oil_derrick.passiveIntervalTicks ?? 120;
  }
  if (target.typeId === 'refinery') {
    wakeIdleHarvestersForPlayer(state, newPlayerId, target.id);
  }
  state.events.push({ type: 'engineer:captured', entityId: target.id, typeId: target.typeId, playerId: newPlayerId });
  if (newPlayerId === 0) {
    state.events.push({ type: 'hud:notice', playerId: 0, key: 'hud.status.engineerCaptured', x: target.x, z: target.z });
  }
  return true;
}

function findFriendlyRefinery(state, playerId, preferredId = null) {
  if (preferredId) {
    const pref = state.entityById.get(preferredId);
    if (pref && pref.alive && pref.typeId === 'refinery' && pref.playerId === playerId) {
      return pref;
    }
  }
  for (let i = 0; i < state.entities.length; i++) {
    const ent = state.entities[i];
    if (ent.alive && ent.typeId === 'refinery' && ent.playerId === playerId) {
      return ent;
    }
  }
  return null;
}

function findNearestOreCell(map, fromX, fromZ, maxSearchRadiusCells = 90) {
  const cgx = worldToGrid(fromX);
  const cgz = worldToGrid(fromZ);
  let bestScore = Infinity;
  let bestGx = -1;
  let bestGz = -1;

  const minX = Math.max(0, cgx - maxSearchRadiusCells);
  const maxX = Math.min(MAP_SIZE - 1, cgx + maxSearchRadiusCells);
  const minZ = Math.max(0, cgz - maxSearchRadiusCells);
  const maxZ = Math.min(MAP_SIZE - 1, cgz + maxSearchRadiusCells);

  for (let gz = minZ; gz <= maxZ; gz++) {
    const row = gz * MAP_SIZE;
    const dz = gz - cgz;
    for (let gx = minX; gx <= maxX; gx++) {
      const idx = row + gx;
      if (map.oreAmount[idx] <= 0 || map.buildingId[idx] > 0) continue;
      if (map.terrain[idx] !== TERRAIN.LAND) continue;
      const dx = gx - cgx;
      const dist = Math.hypot(dx, dz);
      // Slightly prefer higher-value Violet ore when distances are comparable
      const valueBias = map.oreType[idx] === ORE_TYPE.VIOLET ? 0.85 : 1.0;
      const score = dist * valueBias;
      if (score < bestScore) {
        bestScore = score;
        bestGx = gx;
        bestGz = gz;
      }
    }
  }

  return bestGx !== -1 ? { gx: bestGx, gz: bestGz } : null;
}

function hasFriendlyBuildingType(state, playerId, typeId) {
  for (let i = 0; i < state.entities.length; i++) {
    const e = state.entities[i];
    if (e.alive && e.playerId === playerId && e.typeId === typeId) return true;
  }
  return false;
}

function stepHarvesterFSM(state, harv) {
  const map = state.map;
  if (!map || harv.empTicks > 0 || harv.frozenByCount > 0) return;
  const player = state.players[harv.playerId];
  const refinery = findFriendlyRefinery(state, harv.playerId, harv.homeId);

  if (harv.fsmState === 'H_IDLE') {
    if (harv.orderType === 'MOVE' && harv.moveTargetX !== null) return;
    if (refinery) {
      harv.homeId = refinery.id;
      harv.fsmState = harv.cargoCount >= ECONOMY_CONFIG.maxHarvesterCargoCells ? 'H_RETURN' : 'H_SEEK_ORE';
    }
    return;
  }

  // Respect manual player move override; resume mining once reached or when forced back to seek
  if (harv.orderType === 'MOVE') {
    return;
  }

  if (harv.fsmState === 'H_SEEK_ORE') {
    if (harv.cargoCount >= ECONOMY_CONFIG.maxHarvesterCargoCells) {
      harv.fsmState = 'H_RETURN';
      return;
    }
    const target = findNearestOreCell(map, harv.x, harv.z);
    if (!target) {
      if (harv.cargoCount > 0 && refinery) {
        harv.fsmState = 'H_RETURN';
      } else {
        harv.fsmTimerTicks = 30;
      }
      return;
    }
    harv.targetOreGx = target.gx;
    harv.targetOreGz = target.gz;
    harv.moveTargetX = gridToWorldCenter(target.gx);
    harv.moveTargetZ = gridToWorldCenter(target.gz);
    harv.moveStopDist = 1.5;
    harv.orderType = 'HARVEST';
    harv.fsmState = 'H_MOVE_TO_ORE';
    return;
  }

  if (harv.fsmState === 'H_MOVE_TO_ORE') {
    const idx = harv.targetOreGz * MAP_SIZE + harv.targetOreGx;
    if (idx < 0 || idx >= map.oreAmount.length || map.oreAmount[idx] <= 0) {
      harv.fsmState = 'H_SEEK_ORE';
      return;
    }
    const tx = gridToWorldCenter(harv.targetOreGx);
    const tz = gridToWorldCenter(harv.targetOreGz);
    if (Math.hypot(harv.x - tx, harv.z - tz) <= 1.8) {
      harv.moveTargetX = null;
      harv.moveTargetZ = null;
      harv.fsmState = 'H_HARVESTING';
      // 4.0s total for 2-cell full load -> 60 ticks per harvested ore cell
      harv.fsmTimerTicks = Math.max(1, Math.round(ECONOMY_CONFIG.harvestDurationTicks / ECONOMY_CONFIG.maxHarvesterCargoCells));
    }
    return;
  }

  if (harv.fsmState === 'H_HARVESTING') {
    if (harv.fsmTimerTicks > 0) {
      harv.fsmTimerTicks--;
      return;
    }
    const idx = harv.targetOreGz * MAP_SIZE + harv.targetOreGx;
    if (idx >= 0 && idx < map.oreAmount.length && map.oreAmount[idx] > 0) {
      const oreKind = map.oreType[idx];
      const unitValue = oreKind === ORE_TYPE.VIOLET
        ? ECONOMY_CONFIG.violetOreCellValue
        : ECONOMY_CONFIG.redOreCellValue;
      map.oreAmount[idx] -= 1;
      if (map.oreAmount[idx] === 0) {
        map.oreType[idx] = ORE_TYPE.NONE;
      }
      harv.cargoCount += 1;
      harv.cargoValue += unitValue;
      state.events.push({ type: 'harvester:mined', entityId: harv.id, oreKind, unitValue, cargoCount: harv.cargoCount });
    }

    if (harv.cargoCount >= ECONOMY_CONFIG.maxHarvesterCargoCells) {
      harv.fsmState = 'H_RETURN';
    } else if (idx >= 0 && idx < map.oreAmount.length && map.oreAmount[idx] > 0) {
      // Mine next unit from same cell
      harv.fsmTimerTicks = Math.max(1, Math.round(ECONOMY_CONFIG.harvestDurationTicks / ECONOMY_CONFIG.maxHarvesterCargoCells));
    } else {
      harv.fsmState = 'H_SEEK_ORE';
    }
    return;
  }

  if (harv.fsmState === 'H_RETURN') {
    if (!refinery) {
      harv.homeId = null;
      harv.fsmState = 'H_IDLE';
      harv.moveTargetX = null;
      harv.moveTargetZ = null;
      return;
    }
    harv.homeId = refinery.id;
    const dockX = refinery.x;
    const dockZ = Math.min(WORLD_SIZE - 4, refinery.z + refinery.footprintH * CELL_SIZE * 0.5 + 1.6);

    // Abyssal Battle Lab unlocks instant Chrono return warp
    if (player?.factionId === FACTIONS.abyssal.id && hasFriendlyBuildingType(state, harv.playerId, 'battle_lab')) {
      harv.x = dockX;
      harv.z = dockZ;
      harv.prevX = dockX;
      harv.prevZ = dockZ;
      harv.moveTargetX = null;
      harv.moveTargetZ = null;
      harv.fsmState = 'H_DOCKING';
      state.events.push({ type: 'fx:chronoWarp', x: dockX, z: dockZ });
      return;
    }

    harv.moveTargetX = dockX;
    harv.moveTargetZ = dockZ;
    harv.moveStopDist = 1.6;
    harv.orderType = 'RETURN';
    if (Math.hypot(harv.x - dockX, harv.z - dockZ) <= 2.4) {
      harv.moveTargetX = null;
      harv.moveTargetZ = null;
      harv.fsmState = 'H_DOCKING';
    }
    return;
  }

  if (harv.fsmState === 'H_DOCKING') {
    if (!refinery) {
      harv.fsmState = 'H_IDLE';
      return;
    }
    harv.fsmState = 'H_UNLOADING';
    harv.fsmTimerTicks = ECONOMY_CONFIG.unloadDurationTicks;
    return;
  }

  if (harv.fsmState === 'H_UNLOADING') {
    if (!refinery) {
      harv.fsmState = 'H_IDLE';
      return;
    }
    if (harv.fsmTimerTicks > 0) {
      harv.fsmTimerTicks--;
      return;
    }
    const payout = harv.cargoValue;
    if (player && payout > 0) {
      player.credits += payout;
      state.events.push({ type: 'economy:unloaded', playerId: harv.playerId, entityId: harv.id, amount: payout });
    }
    harv.cargoCount = 0;
    harv.cargoValue = 0;
    harv.orderType = 'IDLE';
    harv.fsmState = 'H_SEEK_ORE';
  }
}

function healNearbyUnits(state, origin, radius, healPerSec, filterFn) {
  const healAmt = healPerSec * TICK_DT;
  const r2 = radius * radius;
  for (let i = 0; i < state.entities.length; i++) {
    const unit = state.entities[i];
    if (!unit.alive || unit.isBuilding || unit.playerId !== origin.playerId) continue;
    if (unit.frozenByCount > 0 || unit.hp >= unit.maxHp) continue;
    if (!filterFn(unit)) continue;
    const dx = unit.x - origin.x;
    const dz = unit.z - origin.z;
    if (dx * dx + dz * dz <= r2) {
      unit.hp = Math.min(unit.maxHp, unit.hp + healAmt);
    }
  }
}

export function stepEntitiesAndHarvesters(state) {
  const depots = [];
  const crushers = [];
  for (let i = 0; i < state.entities.length; i++) {
    const e = state.entities[i];
    if (!e.alive) continue;
    if (e.typeId === 'service_depot') depots.push(e);
    else if (!e.isBuilding && ENTITY_DEFS[e.typeId]?.canCrush && e.empTicks === 0 && e.frozenByCount === 0) {
      const moved = Math.hypot(e.x - e.prevX, e.z - e.prevZ);
      if (moved > 0.02 || e.moveTargetX !== null) {
        crushers.push(e);
      }
    }
  }

  for (let i = 0; i < state.entities.length; i++) {
    const ent = state.entities[i];
    if (!ent.alive) continue;

    if (ent.recoil > 0.001) {
      ent.recoil *= 0.78;
      if (ent.recoil < 0.01) ent.recoil = 0;
    }
    if (ent.ironCurtainTicks > 0) ent.ironCurtainTicks--;
    if (ent.empTicks > 0) ent.empTicks--;
    if (ent.stunTicks > 0) ent.stunTicks--;
    if (ent.surfacedTicks > 0) ent.surfacedTicks--;
    if (ent.revealTicks > 0) ent.revealTicks--;
    if (ent.c4CooldownTicks > 0) ent.c4CooldownTicks--;

    if (ent.typeId === 'harvester') {
      stepHarvesterFSM(state, ent);
    }

    // Engineer interactions: capture enemy/neutral building, instant repair friendly building, or repair broken bridge
    if (ent.typeId === 'engineer' && ent.frozenByCount === 0 && ent.empTicks === 0) {
      if (ent.interactTargetId !== null) {
        const target = state.entityById.get(ent.interactTargetId);
        if (!target || !target.alive || !target.isBuilding) {
          ent.interactTargetId = null;
        } else {
          const reach = (target.radius ?? 2.2) + 2.6;
          if (Math.hypot(ent.x - target.x, ent.z - target.z) <= reach) {
            if (target.playerId === ent.playerId) {
              if (target.hp < target.maxHp) {
                target.hp = target.maxHp;
                state.events.push({ type: 'engineer:repaired', entityId: target.id, playerId: ent.playerId });
                removeEntity(state, ent.id, 'consumed');
                continue;
              }
              ent.interactTargetId = null;
            } else {
              transferEntityOwner(state, target, ent.playerId, ent.teamId);
              removeEntity(state, ent.id, 'consumed');
              continue;
            }
          } else {
            ent.moveTargetX = target.x;
            ent.moveTargetZ = target.z;
            ent.moveStopDist = Math.max(1.8, (target.radius ?? 2.0) + 1.4);
          }
        }
      }

      // Check broken bridge repair within 4.5m
      const bridges = state.map?.bridges ?? [];
      let repairedBridge = false;
      for (let b = 0; b < bridges.length; b++) {
        const br = bridges[b];
        if (br.intact) continue;
        const bcx = ((br.x0 + br.x1) * 0.5 + 0.5) * CELL_SIZE;
        const bcz = ((br.z0 + br.z1) * 0.5 + 0.5) * CELL_SIZE;
        const bw = (br.x1 - br.x0 + 1) * CELL_SIZE * 0.5 + 4.5;
        const bh = (br.z1 - br.z0 + 1) * CELL_SIZE * 0.5 + 4.5;
        if (Math.abs(ent.x - bcx) <= bw && Math.abs(ent.z - bcz) <= bh) {
          for (let c = 0; c < br.cells.length; c++) {
            const idx = br.cells[c];
            state.map.terrain[idx] = TERRAIN.BRIDGE;
          }
          br.intact = true;
          state.map.revision++;
          state.events.push({ type: 'bridge:repaired', bridgeId: br.id, playerId: ent.playerId });
          if (ent.playerId === 0) {
            state.events.push({ type: 'hud:notice', playerId: 0, key: 'hud.status.bridgeRepaired', x: bcx, z: bcz });
          }
          removeEntity(state, ent.id, 'consumed');
          repairedBridge = true;
          break;
        }
      }
      if (repairedBridge) continue;
    }

    // Boarding friendly transports (IFV / Hover Transport / Nighthawk)
    if (!ent.isBuilding && ent.boardTargetId !== null && ent.frozenByCount === 0) {
      const transport = state.entityById.get(ent.boardTargetId);
      if (!transport || !transport.alive || !canBoardTransport(transport, ent)) {
        ent.boardTargetId = null;
      } else if (Math.hypot(ent.x - transport.x, ent.z - transport.z) <= (transport.radius ?? 1.5) + 2.6) {
        if (boardTransport(state, transport, ent)) {
          continue;
        }
      } else {
        ent.moveTargetX = transport.x;
        ent.moveTargetZ = transport.z;
        ent.moveStopDist = Math.max(1.2, (transport.radius ?? 1.5) + 1.2);
      }
    }

    // Neutral & captured tech buildings (Oil Derrick, Hospital, Tech Airport)
    if (ent.typeId === 'oil_derrick' && ent.teamId !== 3 && ent.playerId >= 0) {
      if (ent.passiveTimerTicks > 0) ent.passiveTimerTicks--;
      if (ent.passiveTimerTicks <= 0) {
        ent.passiveTimerTicks = ENTITY_DEFS.oil_derrick.passiveIntervalTicks ?? 120;
        const owner = state.players[ent.playerId];
        if (owner) {
          owner.credits += ENTITY_DEFS.oil_derrick.passiveIncome ?? 40;
        }
      }
    } else if (ent.typeId === 'hospital' && ent.teamId !== 3 && ent.playerId >= 0) {
      healNearbyUnits(state, ent, 10.0, 18, (u) => u.category === 'infantry' && u.domain === 'GROUND');
    } else if (ent.typeId === 'tech_airport' && ent.teamId !== 3 && ent.playerId >= 0) {
      healNearbyUnits(state, ent, 16.0, 12, (u) => u.domain === 'AIR');
    }

    // Building manual repair (K mode toggle)
    if (ent.isBuilding && ent.isRepairing) {
      const player = state.players[ent.playerId];
      const cost = ENTITY_DEFS[ent.typeId]?.cost ?? 0;
      if (ent.hp >= ent.maxHp || !player || player.credits <= 0) {
        ent.isRepairing = false;
      } else {
        const healStep = Math.min(ent.maxHp - ent.hp, ECONOMY_CONFIG.repairHpPerSec * TICK_DT);
        const repairCostPerHp = cost > 0 ? (cost * ECONOMY_CONFIG.repairCostRatio) / ent.maxHp : 0;
        const stepCost = healStep * repairCostPerHp;
        if (player.credits >= stepCost) {
          player.credits -= stepCost;
          ent.hp = Math.min(ent.maxHp, ent.hp + healStep);
        } else {
          ent.isRepairing = false;
        }
      }
    }

    // Service Depot rapid paid repair for parked friendly ground vehicles (60 HP/s, 25% cost rate)
    if (!ent.isBuilding && ent.category === 'vehicle' && ent.domain === 'GROUND' && ent.frozenByCount === 0 && ent.hp < ent.maxHp && depots.length > 0) {
      for (let d = 0; d < depots.length; d++) {
        const depot = depots[d];
        if (depot.playerId !== ent.playerId) continue;
        if (Math.hypot(ent.x - depot.x, ent.z - depot.z) <= 4.8) {
          const player = state.players[ent.playerId];
          const unitCost = ENTITY_DEFS[ent.typeId]?.cost ?? 0;
          const healStep = Math.min(ent.maxHp - ent.hp, 60 * TICK_DT);
          const stepCost = unitCost > 0 ? healStep * ((unitCost * 0.25) / ent.maxHp) : 0;
          if (player && player.credits >= stepCost) {
            player.credits -= stepCost;
            ent.hp = Math.min(ent.maxHp, ent.hp + healStep);
          }
          break;
        }
      }
    }

    // Out-of-combat self-repair for Apocalypse & Elite (Rank 2) units (after 4s = 120 ticks out of combat)
    if (!ent.isBuilding && ent.frozenByCount === 0 && ent.hp < ent.maxHp && state.tickCount - ent.lastCombatTick >= 120) {
      const vetHeal = VETERANCY_CONFIG[ent.veterancy]?.selfHealPerSec ?? 0;
      const unitHeal = ENTITY_DEFS[ent.typeId]?.selfHealPerSec ?? 0;
      const totalHeal = Math.max(vetHeal, unitHeal);
      if (totalHeal > 0) {
        ent.hp = Math.min(ent.maxHp, ent.hp + totalHeal * TICK_DT);
      }
    }
  }

  // Vehicle crushing: heavy crusher tanks eliminate unfortified, non-antiCrush ground infantry on contact
  for (let c = 0; c < crushers.length; c++) {
    const tank = crushers[c];
    if (!tank.alive) continue;
    const tankR = tank.radius ?? 1.5;
    for (let j = 0; j < state.entities.length; j++) {
      const inf = state.entities[j];
      if (!inf.alive || inf.category !== 'infantry' || inf.domain !== 'GROUND') continue;
      if (inf.teamId === tank.teamId || inf.ironCurtainTicks > 0 || inf.frozenByCount > 0) continue;
      if (ENTITY_DEFS[inf.typeId]?.antiCrush || inf.deployState === 'DEPLOYED') continue;
      const crushR = (tankR + (inf.radius ?? 0.45)) * 0.9;
      const dx = inf.x - tank.x;
      const dz = inf.z - tank.z;
      if (dx * dx + dz * dz <= crushR * crushR) {
        removeEntity(state, inf.id, 'crushed');
      }
    }
  }
}
