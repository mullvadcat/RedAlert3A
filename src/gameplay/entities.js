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
    rallyX: isBuilding ? x : null,
    rallyZ: isBuilding ? Math.min(WORLD_SIZE - 4, z + h * CELL_SIZE * 0.5 + 3.0) : null,

    fsmState: def.id === 'harvester' ? 'H_IDLE' : 'IDLE',
    fsmTimerTicks: 0,
    cargoCount: 0,
    cargoValue: 0,
    targetOreGx: -1,
    targetOreGz: -1,
    homeId: spec.homeId ?? null,
    ammo: def.maxAmmo ?? 0,
    cargoIds: []
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

  state.events.push({
    type: reason === 'sold' ? 'entity:sold' : reason === 'deployed' ? 'entity:deployed' : 'entity:destroyed',
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

  return false;
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

export function stepEntitiesAndHarvesters(state) {
  const depots = [];
  for (let i = 0; i < state.entities.length; i++) {
    const e = state.entities[i];
    if (e.alive && e.typeId === 'service_depot') depots.push(e);
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

    if (ent.typeId === 'harvester') {
      stepHarvesterFSM(state, ent);
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
    if (!ent.isBuilding && ent.category === 'vehicle' && ent.domain === 'GROUND' && ent.hp < ent.maxHp && depots.length > 0) {
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
    if (!ent.isBuilding && ent.hp < ent.maxHp && state.tickCount - ent.lastCombatTick >= 120) {
      const vetHeal = VETERANCY_CONFIG[ent.veterancy]?.selfHealPerSec ?? 0;
      const unitHeal = ENTITY_DEFS[ent.typeId]?.selfHealPerSec ?? 0;
      const totalHeal = Math.max(vetHeal, unitHeal);
      if (totalHeal > 0) {
        ent.hp = Math.min(ent.maxHp, ent.hp + totalHeal * TICK_DT);
      }
    }
  }
}
