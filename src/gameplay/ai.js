// 30 Hz Deterministic Fog-Constrained 3-Tier Utility AI (L3 Gameplay Module).
// Strictly imports L0-L2 only: NEVER imports other L3 modules (coordinates exclusively via GameState & commandQueue).

import {
  DOCTRINE_DEFS,
  ECONOMY_CONFIG,
  ENTITY_DEFS,
  SUPERWEAPON_IDS,
  nextRandom
} from '../core/config.js';
import {
  CELL_SIZE,
  MAP_SIZE,
  TERRAIN,
  WORLD_SIZE,
  gridToWorldCenter,
  worldToGrid
} from '../world/map.js';
import {
  FOG_DETECTED,
  FOG_VISIBLE,
  getCellFogMask
} from './fogCpu.js';
import { findNearestPassableLand } from './entities.js';

const DIFFICULTY_PARAMS = {
  easy: {
    evalInterval: 30,
    attackInterval: 960,
    minWaveSize: 8,
    maxHarvestersPerRefinery: 1,
    maxDefenses: 2,
    counterSuperweapons: false,
    useOffensiveSuperweapons: false,
    useDoctrines: false
  },
  normal: {
    evalInterval: 15,
    attackInterval: 630,
    minWaveSize: 6,
    maxHarvestersPerRefinery: 2,
    maxDefenses: 4,
    counterSuperweapons: true,
    useOffensiveSuperweapons: true,
    useDoctrines: true
  },
  hard: {
    evalInterval: 10,
    attackInterval: 450,
    minWaveSize: 5,
    maxHarvestersPerRefinery: 2,
    maxDefenses: 6,
    counterSuperweapons: true,
    useOffensiveSuperweapons: true,
    useDoctrines: true
  }
};

export function createDefaultAiState(difficulty = 'normal') {
  const params = DIFFICULTY_PARAMS[difficulty] ?? DIFFICULTY_PARAMS.normal;
  return {
    phase: 'OPENING',
    nextAttackTick: params.attackInterval,
    lastScoutTick: 0,
    scoutIndex: 0,
    noNavalSpot: false,
    buildRetryTick: 0
  };
}

function getDiffParams(difficulty) {
  return DIFFICULTY_PARAMS[difficulty] ?? DIFFICULTY_PARAMS.normal;
}

function isEnemyVisibleInFog(state, teamId, ent) {
  if (!ent || !ent.alive) return false;
  if (ent.teamId === teamId || ent.teamId === 3 || ent.category === 'neutral') return false;
  const gx = worldToGrid(ent.x);
  const gz = worldToGrid(ent.z);
  const mask = getCellFogMask(state, teamId, gx, gz);
  const isStealth =
    (ent.domain === 'SUBMERGED' && !(ent.surfacedTicks > 0)) ||
    (Boolean(ent.isStealthed) && !(ent.revealTicks > 0));
  if (isStealth) {
    return (mask & (FOG_VISIBLE | FOG_DETECTED)) === (FOG_VISIBLE | FOG_DETECTED);
  }
  return (mask & FOG_VISIBLE) !== 0;
}

function isPlacementValidLocal(state, ownBuildings, typeId, gx, gz) {
  const map = state.map;
  const def = ENTITY_DEFS[typeId];
  if (!map || !def || !def.isBuilding) return false;

  const w = def.footprintW;
  const h = def.footprintH;
  if (gx < 2 || gz < 2 || gx + w >= MAP_SIZE - 2 || gz + h >= MAP_SIZE - 2) return false;

  const isMarine = def.domain === 'SEA';
  const refElev = map.elevation[gz * MAP_SIZE + gx];
  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      const idx = (gz + dz) * MAP_SIZE + (gx + dx);
      if (map.buildingId[idx] !== 0) return false;
      const t = map.terrain[idx];
      if (isMarine) {
        if (t !== TERRAIN.SEA) return false;
      } else {
        if (t !== TERRAIN.LAND) return false;
        if (Math.abs(map.elevation[idx] - refElev) > 0.4) return false;
      }
    }
  }

  for (let i = 0; i < (state.orePillars?.length ?? 0); i++) {
    const p = state.orePillars[i];
    if (p.gx >= gx && p.gx < gx + w && p.gz >= gz && p.gz < gz + h) {
      return false;
    }
  }

  // Keep 1-cell clearance on land so harvesters/units do not jam inside tight walls
  if (!isMarine) {
    for (let dz = -1; dz <= h; dz++) {
      for (let dx = -1; dx <= w; dx++) {
        if (dx >= 0 && dx < w && dz >= 0 && dz < h) continue;
        const nIdx = (gz + dz) * MAP_SIZE + (gx + dx);
        if (map.buildingId[nIdx] !== 0) return false;
      }
    }
  } else {
    // Open-sea check (>= 24 connected SEA cells) matching production.js
    const visited = new Set();
    const queue = [gz * MAP_SIZE + gx];
    visited.add(queue[0]);
    let head = 0;
    while (head < queue.length && visited.size < 24) {
      const cur = queue[head++];
      const cx0 = cur % MAP_SIZE;
      const cz0 = (cur - cx0) / MAP_SIZE;
      if (cx0 + 1 < MAP_SIZE && !visited.has(cur + 1) && map.terrain[cur + 1] === TERRAIN.SEA) {
        visited.add(cur + 1);
        queue.push(cur + 1);
      }
      if (cx0 - 1 >= 0 && !visited.has(cur - 1) && map.terrain[cur - 1] === TERRAIN.SEA) {
        visited.add(cur - 1);
        queue.push(cur - 1);
      }
      if (cz0 + 1 < MAP_SIZE && !visited.has(cur + MAP_SIZE) && map.terrain[cur + MAP_SIZE] === TERRAIN.SEA) {
        visited.add(cur + MAP_SIZE);
        queue.push(cur + MAP_SIZE);
      }
      if (cz0 - 1 >= 0 && !visited.has(cur - MAP_SIZE) && map.terrain[cur - MAP_SIZE] === TERRAIN.SEA) {
        visited.add(cur - MAP_SIZE);
        queue.push(cur - MAP_SIZE);
      }
    }
    if (visited.size < 24) return false;
  }

  const cx = gx + w * 0.5;
  const cz = gz + h * 0.5;
  for (let i = 0; i < ownBuildings.length; i++) {
    const ent = ownBuildings[i];
    const fx = ent.gx + ent.footprintW * 0.5;
    const fz = ent.gz + ent.footprintH * 0.5;
    if (ent.typeId === 'conyard') {
      if (Math.hypot(cx - fx, cz - fz) <= ECONOMY_CONFIG.buildRadiusConyardCells + Math.max(w, h) * 0.5) {
        return true;
      }
    } else if (ent.domain === 'GROUND') {
      const maxEdgeDist = isMarine
        ? ECONOMY_CONFIG.buildRadiusNavalNearLandCells
        : ECONOMY_CONFIG.buildRadiusBuildingCells;
      const dxEdge = Math.max(0, Math.abs(cx - fx) - (ent.footprintW + w) * 0.5);
      const dzEdge = Math.max(0, Math.abs(cz - fz) - (ent.footprintH + h) * 0.5);
      if (Math.hypot(dxEdge, dzEdge) <= maxEdgeDist) {
        return true;
      }
    }
  }
  return false;
}

function findValidAiBuildPlacement(state, ownBuildings, typeId) {
  const anchor = ownBuildings.find((b) => b.typeId === 'conyard') ?? ownBuildings[0];
  if (!anchor) return null;

  const isMarine = ENTITY_DEFS[typeId]?.domain === 'SEA';
  const maxR = isMarine ? 22 : 17;
  const step = isMarine ? 2 : 1;
  const startGx = anchor.gx;
  const startGz = anchor.gz;

  for (let r = 3; r <= maxR; r += step) {
    for (let dz = -r; dz <= r; dz += step) {
      for (let dx = -r; dx <= r; dx += step) {
        if (Math.abs(dx) < r - step + 1 && Math.abs(dz) < r - step + 1) continue;
        const gx = startGx + dx;
        const gz = startGz + dz;
        if (isPlacementValidLocal(state, ownBuildings, typeId, gx, gz)) {
          return { gx, gz };
        }
      }
    }
  }
  return null;
}

function canBuildLocal(player, ownTypes, ownBuildings, typeId) {
  const def = ENTITY_DEFS[typeId];
  if (!def || def.buildable === false) return false;

  let hasFaction = player.allowDualFaction || def.factions.includes(player.factionId);
  if (!hasFaction) {
    for (let i = 0; i < ownBuildings.length; i++) {
      if (def.factions.includes(ownBuildings[i].factionId)) {
        hasFaction = true;
        break;
      }
    }
  }
  if (!hasFaction) return false;
  if (def.producerType && !(ownTypes[def.producerType] > 0)) return false;
  if (def.prereqs) {
    for (let i = 0; i < def.prereqs.length; i++) {
      if (!(ownTypes[def.prereqs[i]] > 0)) return false;
    }
  }
  return true;
}

function chooseNextMainBuilding(state, player, ownTypes, ownBuildings, aiState) {
  const powerSurplus = player.powerProduced - player.powerConsumed;
  const powerCount = (ownTypes.power_plant ?? 0) + (ownTypes.nuclear_reactor ?? 0);

  // Strict zero-infinite-loop guardrail: only queue power when low power OR surplus < 45 and capped under 10 plants
  if ((player.isLowPower || powerSurplus < 45) && powerCount < 10) {
    if (ownTypes.battle_lab > 0 && canBuildLocal(player, ownTypes, ownBuildings, 'nuclear_reactor') && player.credits >= 1500) {
      return 'nuclear_reactor';
    }
    if (canBuildLocal(player, ownTypes, ownBuildings, 'power_plant')) {
      return 'power_plant';
    }
  }

  const refCount = ownTypes.refinery ?? 0;
  if (refCount < 1 && canBuildLocal(player, ownTypes, ownBuildings, 'refinery')) return 'refinery';
  if (!(ownTypes.barracks > 0) && canBuildLocal(player, ownTypes, ownBuildings, 'barracks')) return 'barracks';
  if (!(ownTypes.war_factory > 0) && canBuildLocal(player, ownTypes, ownBuildings, 'war_factory')) return 'war_factory';

  if (refCount < 2 && player.credits >= 1600 && canBuildLocal(player, ownTypes, ownBuildings, 'refinery')) {
    return 'refinery';
  }
  if (!(ownTypes.airforce_radar > 0) && canBuildLocal(player, ownTypes, ownBuildings, 'airforce_radar')) {
    return 'airforce_radar';
  }

  if (
    state.map.supportsNaval !== false &&
    !aiState.noNavalSpot &&
    !(ownTypes.naval_yard > 0) &&
    canBuildLocal(player, ownTypes, ownBuildings, 'naval_yard')
  ) {
    if (findValidAiBuildPlacement(state, ownBuildings, 'naval_yard')) {
      return 'naval_yard';
    }
    aiState.noNavalSpot = true;
  }

  if (!(ownTypes.service_depot > 0) && canBuildLocal(player, ownTypes, ownBuildings, 'service_depot')) {
    return 'service_depot';
  }
  if (!(ownTypes.battle_lab > 0) && canBuildLocal(player, ownTypes, ownBuildings, 'battle_lab')) {
    return 'battle_lab';
  }

  if (powerSurplus < 200 && powerCount < 10 && player.credits >= 900) {
    if (ownTypes.battle_lab > 0 && canBuildLocal(player, ownTypes, ownBuildings, 'nuclear_reactor')) {
      return 'nuclear_reactor';
    }
    if (canBuildLocal(player, ownTypes, ownBuildings, 'power_plant')) {
      return 'power_plant';
    }
  }

  return null;
}

function chooseNextDefenseOrSuperweapon(player, ownTypes, ownBuildings, params, hasVisibleAirThreat) {
  const surplus = player.powerProduced - player.powerConsumed;
  const swCandidates =
    player.factionId === 'abyssal'
      ? ['weather_control', 'chrono_sphere']
      : ['nuclear_silo', 'iron_curtain'];

  if (params.useOffensiveSuperweapons && surplus >= 200 && player.credits >= 3000) {
    for (let i = 0; i < swCandidates.length; i++) {
      const swId = swCandidates[i];
      if (!(ownTypes[swId] > 0) && canBuildLocal(player, ownTypes, ownBuildings, swId)) {
        return swId;
      }
    }
  }

  const aaCount = ownTypes.aa_turret ?? 0;
  if ((hasVisibleAirThreat || aaCount === 0) && aaCount < 2 && surplus >= 50 && canBuildLocal(player, ownTypes, ownBuildings, 'aa_turret')) {
    return 'aa_turret';
  }

  const defCount = (ownTypes.pillbox ?? 0) + (ownTypes.aa_turret ?? 0) + (ownTypes.prism_tower ?? 0) + (ownTypes.tesla_coil ?? 0);
  if (defCount >= params.maxDefenses || player.credits < 1400) return null;

  if (surplus >= 75) {
    const heavyDef = player.factionId === 'abyssal' ? 'prism_tower' : 'tesla_coil';
    if (canBuildLocal(player, ownTypes, ownBuildings, heavyDef)) return heavyDef;
  }
  if (canBuildLocal(player, ownTypes, ownBuildings, 'pillbox')) return 'pillbox';
  return null;
}

function handleSuperweaponCounterReaction(state, player, ownUnits, ownBuildings) {
  if (!state.areaEffects || state.areaEffects.length === 0) return;
  const anchor = ownBuildings.find((b) => b.typeId === 'conyard') ?? ownBuildings[0];
  const safeX = anchor ? anchor.x : 120;
  const safeZ = anchor ? anchor.z : 120;

  for (let i = 0; i < state.areaEffects.length; i++) {
    const fx = state.areaEffects[i];
    if (fx.kind !== 'sw_warning') continue;
    if (fx.ownerPlayerId === player.playerId) continue;
    const owner = state.players[fx.ownerPlayerId];
    if (owner && owner.teamId === player.teamId) continue;

    // Check if any own building or unit cluster is inside threat radius
    const threatenedUnits = ownUnits.filter((u) => Math.hypot(u.x - fx.x, u.z - fx.z) <= 22);
    const threatenedBuildings = ownBuildings.filter((b) => Math.hypot(b.x - fx.x, b.z - fx.z) <= 22);
    if (threatenedUnits.length === 0 && threatenedBuildings.length === 0) continue;

    if (!player.isLowPower && player.superweapons?.iron_curtain && player.superweapons.iron_curtain.remainingTicks === 0) {
      const targetPos = threatenedUnits[0] ?? threatenedBuildings[0];
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'FIRE_SUPERWEAPON',
        typeId: 'iron_curtain',
        x: targetPos.x,
        z: targetPos.z
      });
      return;
    }

    if (!player.isLowPower && player.superweapons?.chrono_sphere && player.superweapons.chrono_sphere.remainingTicks === 0 && threatenedUnits.length > 0) {
      const src = threatenedUnits[0];
      const safe = findNearestPassableLand(state.map, safeX + 18, safeZ + 18, 12);
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'FIRE_SUPERWEAPON',
        typeId: 'chrono_sphere',
        sourceX: src.x,
        sourceZ: src.z,
        x: safe.x,
        z: safe.z
      });
      return;
    }

    if (threatenedUnits.length > 0) {
      const dx = threatenedUnits[0].x - fx.x;
      const dz = threatenedUnits[0].z - fx.z;
      const len = Math.max(0.1, Math.hypot(dx, dz));
      const evadePos = findNearestPassableLand(
        state.map,
        threatenedUnits[0].x + (dx / len) * 24,
        threatenedUnits[0].z + (dz / len) * 24,
        10
      );
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'MOVE',
        entityIds: threatenedUnits.map((u) => u.id),
        x: evadePos.x,
        z: evadePos.z
      });
    }
  }
}

function evaluateAiPlayer(state, player) {
  const aiState = player.aiState ?? (player.aiState = createDefaultAiState(player.aiDifficulty ?? 'normal'));
  const params = getDiffParams(player.aiDifficulty ?? 'normal');

  const ownBuildings = [];
  const ownUnits = [];
  const ownHarvesters = [];
  const ownMcvs = [];
  const ownCombatLandAir = [];
  const ownNaval = [];
  const ownTypes = Object.create(null);
  const visibleEnemies = [];
  let underAttackTarget = null;
  let hasVisibleAirThreat = false;

  for (let i = 0; i < state.entities.length; i++) {
    const ent = state.entities[i];
    if (!ent.alive) continue;

    if (ent.playerId === player.playerId) {
      ownTypes[ent.typeId] = (ownTypes[ent.typeId] ?? 0) + 1;
      if (ent.lastCombatTick >= state.tickCount - 90 && !underAttackTarget) {
        underAttackTarget = ent;
      }
      if (ent.isBuilding) {
        ownBuildings.push(ent);
      } else {
        ownUnits.push(ent);
        if (ent.typeId === 'mcv') {
          ownMcvs.push(ent);
        } else if (ent.typeId === 'harvester') {
          ownHarvesters.push(ent);
        } else if (ent.domain === 'SEA' || ent.domain === 'SUBMERGED') {
          ownNaval.push(ent);
        } else {
          ownCombatLandAir.push(ent);
        }
      }
    } else if (isEnemyVisibleInFog(state, player.teamId, ent)) {
      visibleEnemies.push(ent);
      if (ent.domain === 'AIR') hasVisibleAirThreat = true;
    }
  }

  // 1. Deploy starting/extra MCV if we have no Construction Yard
  if (!(ownTypes.conyard > 0) && ownMcvs.length > 0) {
    state.commandQueue.push({
      playerId: player.playerId,
      type: 'DEPLOY',
      entityIds: [ownMcvs[0].id]
    });
    return;
  }
  if (ownBuildings.length === 0) return;

  // 2. Place READY buildings cleanly (with fallback cancel if truly impossible)
  for (const qKey of ['main', 'defense']) {
    const item = player.queues?.[qKey];
    if (item && item.status === 'READY') {
      const spot = findValidAiBuildPlacement(state, ownBuildings, item.typeId);
      if (spot) {
        state.commandQueue.push({
          playerId: player.playerId,
          type: 'PLACE_BUILDING',
          typeId: item.typeId,
          x: spot.gx,
          z: spot.gz,
          gx: spot.gx,
          gz: spot.gz
        });
      } else {
        if (item.typeId === 'naval_yard') aiState.noNavalSpot = true;
        state.commandQueue.push({
          playerId: player.playerId,
          type: 'CANCEL_PROD',
          queueKey: qKey,
          typeId: item.typeId,
          count: 1
        });
      }
    }
  }

  // 3. Queue next main/defense construction when queue is idle
  if (!player.queues?.main && state.tickCount >= aiState.buildRetryTick) {
    const nextMain = chooseNextMainBuilding(state, player, ownTypes, ownBuildings, aiState);
    if (nextMain && player.credits >= 250) {
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'START_PROD',
        queueKey: 'main',
        typeId: nextMain,
        count: 1
      });
    }
  }

  if (!player.queues?.defense && ownTypes.conyard > 0 && player.credits >= 600) {
    const nextDef = chooseNextDefenseOrSuperweapon(player, ownTypes, ownBuildings, params, hasVisibleAirThreat);
    if (nextDef) {
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'START_PROD',
        queueKey: 'defense',
        typeId: nextDef,
        count: 1
      });
    }
  }

  // 4. Unit production queues (Infantry, Vehicle, Air/Naval)
  const infQueue = player.queues?.infantry ?? [];
  if (infQueue.length === 0 && ownTypes.barracks > 0 && player.credits >= 300) {
    const rInf = nextRandom(state);
    let infId = player.factionId === 'abyssal' ? 'gi' : 'conscript';
    if (hasVisibleAirThreat) {
      infId = 'flak_trooper';
    } else if (ownTypes.battle_lab > 0 && player.credits >= 2200 && rInf > 0.72) {
      infId = player.factionId === 'abyssal' ? 'chrono' : 'sledge';
    } else if (ownTypes.airforce_radar > 0 && player.credits >= 1100 && rInf > 0.52) {
      infId = player.factionId === 'abyssal' ? 'rocketeer' : 'tesla_trooper';
    }
    if (canBuildLocal(player, ownTypes, ownBuildings, infId)) {
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'START_PROD',
        queueKey: 'infantry',
        typeId: infId,
        count: 1
      });
    }
  }

  const vehQueue = player.queues?.vehicle ?? [];
  if (vehQueue.length === 0 && ownTypes.war_factory > 0 && player.credits >= 600) {
    const targetHarvesters = Math.min(4, (ownTypes.refinery ?? 0) * params.maxHarvestersPerRefinery);
    let vehId = null;
    if (ownHarvesters.length < targetHarvesters && player.credits >= 1400) {
      vehId = 'harvester';
    } else {
      const rVeh = nextRandom(state);
      if (player.factionId === 'abyssal') {
        if (hasVisibleAirThreat && rVeh < 0.45) {
          vehId = 'ifv';
        } else if (ownTypes.battle_lab > 0 && player.credits >= 1500 && rVeh > 0.55) {
          vehId = 'prism';
        } else {
          vehId = rVeh < 0.28 ? 'ifv' : 'grizzly';
        }
      } else {
        if (ownTypes.battle_lab > 0 && player.credits >= 1900 && rVeh > 0.62) {
          vehId = 'apocalypse';
        } else if (ownTypes.airforce_radar > 0 && player.credits >= 1300 && rVeh > 0.80) {
          vehId = 'v3';
        } else {
          vehId = 'rhino';
        }
      }
    }
    if (vehId && canBuildLocal(player, ownTypes, ownBuildings, vehId)) {
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'START_PROD',
        queueKey: 'vehicle',
        typeId: vehId,
        count: 1
      });
    }
  }

  const airNavalQueue = player.queues?.air_naval ?? [];
  if (airNavalQueue.length < 2 && player.credits >= 1400) {
    const rAn = nextRandom(state);
    let anId = null;
    if (ownTypes.naval_yard > 0 && ownNaval.length < 4 && rAn < 0.45) {
      if (hasVisibleAirThreat && player.factionId === 'abyssal' && canBuildLocal(player, ownTypes, ownBuildings, 'aegis')) {
        anId = 'aegis';
      } else if (hasVisibleAirThreat && player.factionId === 'crimson' && canBuildLocal(player, ownTypes, ownBuildings, 'sea_scorpion')) {
        anId = 'sea_scorpion';
      } else if (ownTypes.battle_lab > 0 && player.credits >= 2200) {
        anId = player.factionId === 'abyssal' ? 'carrier' : 'dreadnought';
      } else {
        anId = player.factionId === 'abyssal' ? 'dolphin' : 'typhoon';
      }
    } else if (ownTypes.airforce_radar > 0 && ownCombatLandAir.filter((u) => u.domain === 'AIR').length < 4) {
      if (player.factionId === 'crimson' && ownTypes.battle_lab > 0 && player.credits >= 2400 && rAn > 0.72) {
        anId = 'kirov';
      } else {
        anId = player.factionId === 'abyssal' ? 'stormhawk' : 'crimson_mig';
      }
    }
    if (anId && canBuildLocal(player, ownTypes, ownBuildings, anId)) {
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'START_PROD',
        queueKey: 'air_naval',
        typeId: anId,
        count: 1
      });
    }
  }

  // 5. Offensive Superweapons & Doctrines (strictly targeted using Fog-visible targets or unexplored spawns)
  const enemySpawns = (state.map.spawns ?? []).filter((sp) => {
    const anchor = ownBuildings[0];
    return anchor && Math.hypot(sp.x - anchor.x, sp.z - anchor.z) > 60;
  });
  const enemyStructure = visibleEnemies.find((e) => e.isBuilding) ?? visibleEnemies[0] ?? null;

  if (params.useDoctrines && player.doctrines) {
    if (player.doctrines.recon_satellite === 0 && enemySpawns.length > 0 && state.tickCount >= 180) {
      const sp = enemySpawns[aiState.scoutIndex % enemySpawns.length];
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'USE_DOCTRINE',
        typeId: 'recon_satellite',
        x: sp.x,
        z: sp.z
      });
    } else if (player.doctrines.paratroopers === 0 && (ownTypes.airforce_radar > 0 || ownTypes.tech_airport > 0) && enemyStructure) {
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'USE_DOCTRINE',
        typeId: 'paratroopers',
        x: enemyStructure.x,
        z: enemyStructure.z
      });
    } else if (player.doctrines.emp_strike === 0 && enemyStructure && !enemyStructure.isBuilding) {
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'USE_DOCTRINE',
        typeId: 'emp_strike',
        x: enemyStructure.x,
        z: enemyStructure.z
      });
    } else if (player.doctrines.nano_repair === 0 && ownCombatLandAir.some((u) => u.hp < u.maxHp * 0.6)) {
      const hurt = ownCombatLandAir.find((u) => u.hp < u.maxHp * 0.6);
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'USE_DOCTRINE',
        typeId: 'nano_repair',
        x: hurt.x,
        z: hurt.z
      });
    }
  }

  if (params.useOffensiveSuperweapons && !player.isLowPower && enemyStructure) {
    for (const swId of ['nuclear_silo', 'weather_control']) {
      if (player.superweapons?.[swId]?.remainingTicks === 0 && ownTypes[swId] > 0) {
        state.commandQueue.push({
          playerId: player.playerId,
          type: 'FIRE_SUPERWEAPON',
          typeId: swId,
          x: enemyStructure.x,
          z: enemyStructure.z
        });
        break;
      }
    }
  }

  // 6. Tactical Defense & Fog-Constrained Wave Attacks
  if (underAttackTarget) {
    const idleDefenders = ownCombatLandAir.filter((u) => u.orderType === 'IDLE' || !u.orderType);
    if (idleDefenders.length > 0) {
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'ATTACK_MOVE',
        entityIds: idleDefenders.map((u) => u.id),
        x: underAttackTarget.x,
        z: underAttackTarget.z
      });
    }
  }

  if (visibleEnemies.length > 0) {
    const nearbyThreats = visibleEnemies.filter((e) => {
      const anchor = ownBuildings[0];
      return anchor && Math.hypot(e.x - anchor.x, e.z - anchor.z) <= 55;
    });
    if (nearbyThreats.length > 0) {
      const defenders = ownCombatLandAir.filter((u) => u.orderType === 'IDLE' || !u.orderType);
      if (defenders.length > 0) {
        state.commandQueue.push({
          playerId: player.playerId,
          type: 'ATTACK',
          entityIds: defenders.map((u) => u.id),
          targetId: nearbyThreats[0].id
        });
      }
    }
  }

  if (ownCombatLandAir.length >= params.minWaveSize && state.tickCount >= aiState.nextAttackTick) {
    aiState.nextAttackTick = state.tickCount + params.attackInterval;
    const waveIds = ownCombatLandAir
      .filter((u) => u.orderType !== 'MOVE')
      .map((u) => u.id);
    if (waveIds.length >= Math.max(2, params.minWaveSize - 1)) {
      if (enemyStructure) {
        state.commandQueue.push({
          playerId: player.playerId,
          type: 'ATTACK_MOVE',
          entityIds: waveIds,
          x: enemyStructure.x,
          z: enemyStructure.z
        });
      } else if (enemySpawns.length > 0) {
        const sp = enemySpawns[aiState.scoutIndex % enemySpawns.length];
        aiState.scoutIndex++;
        state.commandQueue.push({
          playerId: player.playerId,
          type: 'ATTACK_MOVE',
          entityIds: waveIds,
          x: sp.x,
          z: sp.z
        });
      }
    }
  } else if (
    state.tickCount - aiState.lastScoutTick >= 360 &&
    enemySpawns.length > 0 &&
    visibleEnemies.length === 0
  ) {
    // Send a single scout if no enemy is visible in fog yet
    const idleScout = ownCombatLandAir.find((u) => u.orderType === 'IDLE' && u.domain !== 'SEA');
    if (idleScout) {
      aiState.lastScoutTick = state.tickCount;
      const sp = enemySpawns[aiState.scoutIndex % enemySpawns.length];
      aiState.scoutIndex++;
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'ATTACK_MOVE',
        entityIds: [idleScout.id],
        x: sp.x,
        z: sp.z
      });
    }
  }

  if (ownNaval.length >= 2 && visibleEnemies.some((e) => e.domain === 'SEA' || e.domain === 'SUBMERGED')) {
    const seaTarget = visibleEnemies.find((e) => e.domain === 'SEA' || e.domain === 'SUBMERGED');
    const idleNaval = ownNaval.filter((u) => u.orderType === 'IDLE');
    if (idleNaval.length > 0 && seaTarget) {
      state.commandQueue.push({
        playerId: player.playerId,
        type: 'ATTACK',
        entityIds: idleNaval.map((u) => u.id),
        targetId: seaTarget.id
      });
    }
  }
}

export function stepAI(state) {
  if (!state || state.winnerTeamId !== null || state.disableAI) return;
  const players = state.players;
  if (!players || players.length === 0) return;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!p || p.isHuman) continue;

    const params = getDiffParams(p.aiDifficulty ?? 'normal');

    // Superweapon warning counter-reaction check runs frequently (every 5 ticks) on normal/hard
    if (
      params.counterSuperweapons &&
      state.areaEffects &&
      state.areaEffects.length > 0 &&
      (state.tickCount + p.playerId) % 5 === 0
    ) {
      const ownUnits = [];
      const ownBuildings = [];
      for (let e = 0; e < state.entities.length; e++) {
        const ent = state.entities[e];
        if (!ent.alive || ent.playerId !== p.playerId) continue;
        if (ent.isBuilding) ownBuildings.push(ent);
        else ownUnits.push(ent);
      }
      handleSuperweaponCounterReaction(state, p, ownUnits, ownBuildings);
    }

    if ((state.tickCount + p.playerId * 7) % params.evalInterval !== 0) continue;
    evaluateAiPlayer(state, p);
  }
}
