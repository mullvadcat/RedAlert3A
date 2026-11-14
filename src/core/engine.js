// 30 Hz Deterministic Pure Simulation Core (L4 in DAG).
// Zero DOM / WebGL / Three.js imports: shared verbatim between browser and Node.js.

import { ENTITY_DEFS, FACTIONS, TICK_DT, TICK_RATE } from './config.js';
import {
  DEFAULT_M1_MAP_BLUEPRINT,
  TERRAIN,
  WORLD_SIZE,
  compileMap,
  stepMapResources
} from '../world/map.js';
import { createTeamFogGrids, rebuildTeamFogGrids } from '../gameplay/fogCpu.js';
import { createFlowCache, stepNavigation } from '../gameplay/nav.js';
import {
  deployEntity,
  findNearestPassableLand,
  spawnEntity,
  stepEntitiesAndHarvesters
} from '../gameplay/entities.js';
import {
  cancelProduction,
  createEmptyQueues,
  placeBuilding,
  sellBuilding,
  startProduction,
  stepProductionAndPower
} from '../gameplay/production.js';
import { checkVictoryCondition, stepCombatAndProjectiles } from '../gameplay/combat.js';

function createPlayerState(spec) {
  return {
    playerId: spec.playerId,
    teamId: spec.teamId ?? spec.playerId,
    factionId: spec.factionId ?? FACTIONS.abyssal.id,
    isHuman: Boolean(spec.isHuman),
    aiDifficulty: spec.aiDifficulty ?? null,
    credits: spec.credits ?? 10000,
    powerProduced: 0,
    powerConsumed: 0,
    powerFactor: 1.0,
    powerState: 'green',
    isLowPower: false,
    aiState: spec.isHuman
      ? null
      : {
          phase: 'OPENING',
          nextAttackTick: 900,
          lastScoutTick: 0
        },
    queues: createEmptyQueues(),
    doctrines: {
      recon_satellite: 0,
      paratroopers: 0,
      nano_repair: 0,
      emp_strike: 0
    },
    superweapons: {
      chrono_sphere: null,
      iron_curtain: null,
      weather_control: null,
      nuclear_silo: null
    },
    stats: { produced: 0, lost: 0, killedValue: 0, spentValue: 0 }
  };
}

export function createGameState(options = {}) {
  const seed = (options.seed ?? 20400401) >>> 0;
  const map = options.map ?? compileMap(options.mapBlueprint ?? DEFAULT_M1_MAP_BLUEPRINT);
  const startingCredits = options.startingCredits ?? 10000;
  const humanFaction = options.factionId ?? FACTIONS.abyssal.id;
  const enemyFaction = humanFaction === FACTIONS.abyssal.id ? FACTIONS.crimson.id : FACTIONS.abyssal.id;

  const players = options.players
    ? options.players.map(createPlayerState)
    : [
        createPlayerState({
          playerId: 0,
          teamId: 0,
          factionId: humanFaction,
          isHuman: true,
          credits: startingCredits
        }),
        createPlayerState({
          playerId: 1,
          teamId: 1,
          factionId: enemyFaction,
          isHuman: false,
          aiDifficulty: options.aiDifficulty ?? 'normal',
          credits: startingCredits
        })
      ];

  const state = {
    tickCount: 0,
    prngState: seed,
    mode: options.mode ?? 'skirmish',
    missionId: options.missionId ?? null,
    fastBuild: Boolean(options.fastBuild),
    map,
    players,
    fogGrids: createTeamFogGrids(4),
    entities: [],
    entityById: new Map(),
    nextEntityId: 1,
    projectiles: [],
    nextProjectileId: 1,
    commandQueue: [],
    areaEffects: [],
    orePillars: map.orePillars ?? [],
    flowCache: createFlowCache(),
    hadMultipleHqTeams: false,
    winnerTeamId: null,
    events: []
  };

  if (options.populateDefault !== false) {
    if (state.mode === 'bench') {
      populateBenchM1Scenario(state);
    } else {
      populateM1SkirmishScenario(state);
    }
    rebuildTeamFogGrids(state);
    stepProductionAndPower(state);
  }

  return state;
}

export function populateM1SkirmishScenario(state) {
  const sp0 = state.map.spawns[0] ?? { gx: 44, gz: 128, x: 89, z: 257 };
  const sp1 = state.map.spawns[1] ?? { gx: 212, gz: 128, x: 425, z: 257 };

  // Player 0: Starting MCV (ready to press D & deploy) + 2 Grizzly scout escorts
  const p0 = state.players[0];
  spawnEntity(state, {
    typeId: 'mcv',
    playerId: p0.playerId,
    teamId: p0.teamId,
    factionId: p0.factionId,
    x: sp0.x,
    z: sp0.z
  });
  for (let i = 0; i < 2; i++) {
    spawnEntity(state, {
      typeId: p0.factionId === 'crimson' ? 'rhino' : 'grizzly',
      playerId: p0.playerId,
      teamId: p0.teamId,
      factionId: p0.factionId,
      x: sp0.x + 8,
      z: sp0.z - 4 + i * 8
    });
  }

  // Player 1: Established Crimson rival base across the bridge with Conyard, Power, War Factory & defender tanks
  if (state.players[1]) {
    const p1 = state.players[1];
    spawnEntity(state, {
      typeId: 'conyard',
      playerId: p1.playerId,
      teamId: p1.teamId,
      factionId: p1.factionId,
      gx: sp1.gx - 2,
      gz: sp1.gz - 2
    });
    spawnEntity(state, {
      typeId: 'power_plant',
      playerId: p1.playerId,
      teamId: p1.teamId,
      factionId: p1.factionId,
      gx: sp1.gx + 5,
      gz: sp1.gz - 6
    });
    spawnEntity(state, {
      typeId: 'war_factory',
      playerId: p1.playerId,
      teamId: p1.teamId,
      factionId: p1.factionId,
      gx: sp1.gx - 8,
      gz: sp1.gz + 4
    });
    for (let i = 0; i < 3; i++) {
      spawnEntity(state, {
        typeId: 'rhino',
        playerId: p1.playerId,
        teamId: p1.teamId,
        factionId: p1.factionId,
        x: sp1.x - 20,
        z: sp1.z - 8 + i * 8,
        yaw: -Math.PI * 0.5
      });
    }
  }
}

// M1 ?bench=1 smoke benchmark: 100 tanks (50 Grizzly vs 50 Rhino) + 20 buildings actively clashing
export function populateBenchM1Scenario(state) {
  const p0 = state.players[0];
  const p1 = state.players[1] ?? state.players[0];

  const baseOffsetsP0 = [
    ['conyard', 38, 120], ['power_plant', 44, 118], ['power_plant', 44, 122],
    ['refinery', 48, 116], ['refinery', 48, 122], ['war_factory', 42, 128],
    ['war_factory', 48, 128], ['barracks', 38, 128], ['airforce_radar', 36, 120],
    ['service_depot', 38, 134]
  ];
  for (const [typeId, gx, gz] of baseOffsetsP0) {
    spawnEntity(state, { typeId, playerId: p0.playerId, teamId: p0.teamId, factionId: p0.factionId, gx, gz });
  }

  const baseOffsetsP1 = [
    ['conyard', 206, 120], ['power_plant', 212, 118], ['power_plant', 212, 122],
    ['refinery', 200, 116], ['refinery', 200, 122], ['war_factory', 204, 128],
    ['war_factory', 210, 128], ['barracks', 200, 128], ['airforce_radar', 215, 120],
    ['service_depot', 204, 134]
  ];
  for (const [typeId, gx, gz] of baseOffsetsP1) {
    spawnEntity(state, { typeId, playerId: p1.playerId, teamId: p1.teamId, factionId: p1.factionId, gx, gz });
  }

  // 50 Abyssal Grizzly tanks vs 50 Crimson Rhino tanks converging around the central plains/bridge
  for (let i = 0; i < 50; i++) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const p0Pos = findNearestPassableLand(state.map, 170 + col * 5.0, 210 + row * 9.0);
    const g = spawnEntity(state, {
      typeId: 'grizzly',
      playerId: p0.playerId,
      teamId: p0.teamId,
      factionId: p0.factionId,
      x: p0Pos.x,
      z: p0Pos.z
    });
    g.orderType = 'ATTACK_MOVE';
    g.moveTargetX = 330;
    g.moveTargetZ = 256;

    const p1Pos = findNearestPassableLand(state.map, 320 + col * 5.0, 210 + row * 9.0);
    const r = spawnEntity(state, {
      typeId: 'rhino',
      playerId: p1.playerId,
      teamId: p1.teamId,
      factionId: p1.factionId,
      x: p1Pos.x,
      z: p1Pos.z,
      yaw: -Math.PI * 0.5
    });
    r.orderType = 'ATTACK_MOVE';
    r.moveTargetX = 180;
    r.moveTargetZ = 256;
  }
}

export function enqueueCommand(state, cmd) {
  if (!cmd || !cmd.type) return;
  state.commandQueue.push({
    ...cmd,
    tick: cmd.tick ?? state.tickCount
  });
}

function clampWorld(v) {
  return Math.max(4, Math.min(WORLD_SIZE - 4, v));
}

function executeCommand(state, cmd) {
  const player = state.players[cmd.playerId];
  if (!player) return;

  switch (cmd.type) {
    case 'MOVE':
    case 'ATTACK_MOVE': {
      const ids = cmd.entityIds ?? [];
      const validUnits = [];
      for (let i = 0; i < ids.length; i++) {
        const ent = state.entityById.get(ids[i]);
        if (ent && ent.alive && !ent.isBuilding && ent.playerId === cmd.playerId) {
          validUnits.push(ent);
        }
      }
      const n = validUnits.length;
      if (n === 0) break;
      const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
      const spacing = 3.8;
      for (let i = 0; i < n; i++) {
        const ent = validUnits[i];
        const row = Math.floor(i / cols);
        const col = i % cols;
        const ox = (col - (cols - 1) * 0.5) * spacing;
        const oz = (row - (Math.ceil(n / cols) - 1) * 0.5) * spacing;
        ent.attackTargetId = null;
        ent.orderType = cmd.type;
        ent.moveTargetX = clampWorld((cmd.x ?? ent.x) + ox);
        ent.moveTargetZ = clampWorld((cmd.z ?? ent.z) + oz);
        ent.moveStopDist = 0.9;
        if (ent.deployState === 'DEPLOYED' && ent.typeId === 'gi') {
          deployEntity(state, ent);
        }
      }
      break;
    }

    case 'ATTACK': {
      const target = state.entityById.get(cmd.targetId);
      if (!target || !target.alive) break;
      const ids = cmd.entityIds ?? [];
      for (let i = 0; i < ids.length; i++) {
        const ent = state.entityById.get(ids[i]);
        if (!ent || !ent.alive || ent.playerId !== cmd.playerId) continue;
        if (ent.teamId === target.teamId) continue;
        ent.attackTargetId = target.id;
        ent.orderType = 'ATTACK';
        if (!ent.isBuilding) {
          const weapon = ENTITY_DEFS[ent.typeId]?.weapon;
          const range = weapon?.range ?? 10;
          if (Math.hypot(target.x - ent.x, target.z - ent.z) > range) {
            ent.moveTargetX = target.x;
            ent.moveTargetZ = target.z;
            ent.moveStopDist = Math.max(2.0, range * 0.85);
          } else {
            ent.moveTargetX = null;
            ent.moveTargetZ = null;
          }
        }
      }
      break;
    }

    case 'STOP': {
      const ids = cmd.entityIds ?? [];
      for (let i = 0; i < ids.length; i++) {
        const ent = state.entityById.get(ids[i]);
        if (!ent || !ent.alive || ent.playerId !== cmd.playerId) continue;
        ent.moveTargetX = null;
        ent.moveTargetZ = null;
        ent.attackTargetId = null;
        ent.orderType = 'IDLE';
      }
      break;
    }

    case 'DEPLOY': {
      const ids = cmd.entityIds ?? [];
      for (let i = 0; i < ids.length; i++) {
        const ent = state.entityById.get(ids[i]);
        if (ent && ent.alive && ent.playerId === cmd.playerId) {
          deployEntity(state, ent);
        }
      }
      break;
    }

    case 'START_PROD':
      startProduction(state, cmd.playerId, cmd.queueKey, cmd.typeId, cmd.count ?? 1);
      break;

    case 'CANCEL_PROD':
      cancelProduction(state, cmd.playerId, cmd.queueKey, cmd.typeId, cmd.count ?? 1);
      break;

    case 'PLACE_BUILDING': {
      const gx = Math.round(cmd.x ?? 0);
      const gz = Math.round(cmd.z ?? 0);
      placeBuilding(state, cmd.playerId, cmd.typeId, gx, gz);
      break;
    }

    case 'TOGGLE_REPAIR': {
      const target = state.entityById.get(cmd.targetId);
      if (target && target.alive && target.isBuilding && target.playerId === cmd.playerId) {
        target.isRepairing = !target.isRepairing;
      }
      break;
    }

    case 'SELL_BUILDING':
      sellBuilding(state, cmd.playerId, cmd.targetId);
      break;

    case 'SET_RALLY': {
      const ids = cmd.entityIds ?? [];
      for (let i = 0; i < ids.length; i++) {
        const ent = state.entityById.get(ids[i]);
        if (ent && ent.alive && ent.isBuilding && ent.playerId === cmd.playerId) {
          ent.rallyX = clampWorld(cmd.x ?? ent.x);
          ent.rallyZ = clampWorld(cmd.z ?? ent.z);
        }
      }
      break;
    }

    case 'USE_DOCTRINE':
    case 'FIRE_SUPERWEAPON':
      // Placeholder hooks preserved cleanly for M4 superweapon.js
      state.events.push({ type: 'command:deferred_m4', cmdType: cmd.type, typeId: cmd.typeId });
      break;

    default:
      break;
  }
}

export function consumeCommands(state) {
  if (state.commandQueue.length === 0) return;
  const remaining = [];
  for (let i = 0; i < state.commandQueue.length; i++) {
    const cmd = state.commandQueue[i];
    if ((cmd.tick ?? 0) <= state.tickCount) {
      executeCommand(state, cmd);
    } else {
      remaining.push(cmd);
    }
  }
  state.commandQueue = remaining;
}

function stepAirAndNaval(state) {
  // M1: Clean pass-through; M3 (T3.3 & T3.4) plugs in airforce.js & naval.js here.
  void state;
}

function stepSuperweaponsAndAreaEffects(state) {
  if (state.areaEffects && state.areaEffects.length > 0) {
    state.areaEffects = state.areaEffects.filter((fx) => fx.expiryTick > state.tickCount);
  }
}

function stepAiAndCheckVictory(state) {
  checkVictoryCondition(state);
}

// Strict 10-step 30 Hz deterministic simulation tick pipeline (DEVELOPMENT_PLAN §2.4).
export function stepSimulation(state) {
  state.tickCount += 1;
  state.events.length = 0;

  consumeCommands(state);                 // 1
  stepProductionAndPower(state);          // 2
  stepMapResources(state);                // 3
  stepNavigation(state);                  // 4
  stepEntitiesAndHarvesters(state);       // 5
  stepAirAndNaval(state);                 // 6
  stepCombatAndProjectiles(state);        // 7
  stepSuperweaponsAndAreaEffects(state);  // 8
  rebuildTeamFogGrids(state);             // 9
  stepAiAndCheckVictory(state);           // 10
}
