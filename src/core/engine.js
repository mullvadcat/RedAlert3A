// 30 Hz Deterministic Pure Simulation Core (L4 in DAG).
// Zero DOM / WebGL / Three.js imports: shared verbatim between browser and Node.js.

import { ENTITY_DEFS, FACTIONS, TICK_DT, TICK_RATE } from './config.js';
import {
  DEFAULT_M1_MAP_BLUEPRINT,
  MAP_SIZE,
  TERRAIN,
  WORLD_SIZE,
  compileMap,
  stepMapResources,
  worldToGrid
} from '../world/map.js';
import { createTeamFogGrids, isCellExplored, rebuildTeamFogGrids } from '../gameplay/fogCpu.js';
import { createFlowCache, stepNavigation } from '../gameplay/nav.js';
import {
  canBoardTransport,
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
import { applyDamage, checkVictoryCondition, stepCombatAndProjectiles } from '../gameplay/combat.js';
import { stepAirforce } from '../gameplay/airforce.js';
import { stepNaval } from '../gameplay/naval.js';
import { castDoctrine, fireSuperweapon, stepSuperweaponsAndAreaEffectsCore } from '../gameplay/superweapon.js';
import { createDefaultAiState, stepAI } from '../gameplay/ai.js';
import { createDirectorState, stepDirector } from '../story/director.js';
import { getCampaignMission } from '../story/campaigns/index.js';
import { getSkirmishMapById } from '../world/skirmishMaps.js';

function createPlayerState(spec) {
  return {
    playerId: spec.playerId,
    teamId: spec.teamId ?? spec.playerId,
    factionId: spec.factionId ?? FACTIONS.abyssal.id,
    isHuman: Boolean(spec.isHuman),
    aiDifficulty: spec.aiDifficulty ?? null,
    allowDualFaction: Boolean(spec.allowDualFaction),
    credits: spec.credits ?? 6500,
    powerProduced: 0,
    powerConsumed: 0,
    powerFactor: 1.0,
    powerState: 'green',
    isLowPower: false,
    aiState: spec.isHuman
      ? null
      : (spec.aiState ? structuredClone(spec.aiState) : createDefaultAiState(spec.aiDifficulty ?? 'normal')),
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
  const missionSpec = options.missionId ? getCampaignMission(options.missionId) : null;
  if (options.missionId && !missionSpec) {
    throw new Error(`Unknown campaign missionId: ${options.missionId}`);
  }

  const blueprint = options.mapBlueprint ?? (missionSpec ? getSkirmishMapById(missionSpec.mapId) : DEFAULT_M1_MAP_BLUEPRINT);
  const map = options.map ?? compileMap(blueprint);
  if (!map.neutralBuildings && blueprint.neutralBuildings) {
    map.neutralBuildings = blueprint.neutralBuildings;
  }
  if (blueprint.supportsNaval !== undefined && map.supportsNaval === undefined) {
    map.supportsNaval = blueprint.supportsNaval;
  }
  const startingCredits = options.startingCredits ?? missionSpec?.startingCredits ?? 6500;
  const humanFaction = options.factionId ?? missionSpec?.factionId ?? FACTIONS.abyssal.id;
  const enemyFaction = missionSpec?.enemyFactionId ?? (humanFaction === FACTIONS.abyssal.id ? FACTIONS.crimson.id : FACTIONS.abyssal.id);

  const players = options.players
    ? options.players.map(createPlayerState)
    : missionSpec
      ? [
          createPlayerState({
            playerId: 0,
            teamId: 0,
            factionId: humanFaction,
            isHuman: true,
            allowDualFaction: Boolean(missionSpec.allowDualFaction),
            credits: startingCredits
          }),
          createPlayerState({
            playerId: 1,
            teamId: 1,
            factionId: enemyFaction,
            isHuman: false,
            aiDifficulty: options.difficulty ?? options.aiDifficulty ?? 'normal',
            credits: startingCredits
          }),
          createPlayerState({
            playerId: 2,
            teamId: 3,
            factionId: FACTIONS.abyssal.id,
            isHuman: false,
            credits: 0
          })
        ]
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

  const disableAI =
    options.disableAI !== undefined
      ? Boolean(options.disableAI)
      : (missionSpec ? Boolean(missionSpec.disableAI) : (options.populateDefault === false && !options.players && !options.enableAI));

  const state = {
    tickCount: 0,
    prngState: seed,
    mode: missionSpec ? 'campaign' : (options.mode ?? 'skirmish'),
    missionId: missionSpec ? missionSpec.id : (options.missionId ?? null),
    difficulty: options.difficulty ?? options.aiDifficulty ?? 'normal',
    fastBuild: Boolean(options.fastBuild),
    noFog: Boolean(options.noFog),
    skirmishFairStart: Boolean(options.skirmishFairStart),
    disableAI,
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
    nextAreaEffectId: 1,
    orphanDrones: [],
    orePillars: map.orePillars ?? [],
    flowCache: createFlowCache(),
    directorState: missionSpec ? createDirectorState(missionSpec) : null,
    hadMultipleHqTeams: false,
    winnerTeamId: null,
    events: []
  };

  if (missionSpec) {
    missionSpec.setup(state);
    rebuildTeamFogGrids(state);
    stepProductionAndPower(state);
  } else if (options.populateDefault !== false) {
    if (state.mode === 'bench' || state.mode === 'bench_m1') {
      populateBenchM1Scenario(state);
    } else {
      populateM1SkirmishScenario(state);
    }
    rebuildTeamFogGrids(state);
    stepProductionAndPower(state);
  }

  return state;
}

function spawnNeutralMapBuildings(state) {
  const list = state.map?.neutralBuildings;
  if (!list || list.length === 0) return;
  for (let i = 0; i < list.length; i++) {
    const nb = list[i];
    if (!ENTITY_DEFS[nb.typeId]) continue;
    spawnEntity(state, {
      typeId: nb.typeId,
      playerId: -1,
      teamId: 3,
      factionId: 'neutral',
      gx: nb.gx,
      gz: nb.gz
    });
  }
}

export function populateM1SkirmishScenario(state) {
  spawnNeutralMapBuildings(state);

  if (state.skirmishFairStart || state.players.length > 2) {
    for (let i = 0; i < state.players.length; i++) {
      const p = state.players[i];
      const sp = state.map.spawns[i] ?? {
        gx: i % 2 === 0 ? 44 : 212,
        gz: i < 2 ? 128 : 48,
        x: i % 2 === 0 ? 89 : 425,
        z: i < 2 ? 257 : 97
      };
      const mcvPos = findNearestPassableLand(state.map, sp.x, sp.z, 8);
      spawnEntity(state, {
        typeId: 'mcv',
        playerId: p.playerId,
        teamId: p.teamId,
        factionId: p.factionId,
        x: mcvPos.x,
        z: mcvPos.z
      });
      const mbtId = p.factionId === 'crimson' ? 'rhino' : 'grizzly';
      const dir = sp.x < WORLD_SIZE * 0.5 ? 1 : -1;
      for (let u = 0; u < 2; u++) {
        const pos = findNearestPassableLand(state.map, mcvPos.x + dir * 7, mcvPos.z - 4 + u * 8, 8);
        spawnEntity(state, {
          typeId: mbtId,
          playerId: p.playerId,
          teamId: p.teamId,
          factionId: p.factionId,
          x: pos.x,
          z: pos.z,
          yaw: dir > 0 ? Math.PI * 0.5 : -Math.PI * 0.5
        });
      }
    }
    return;
  }

  const sp0 = state.map.spawns[0] ?? { gx: 44, gz: 128, x: 89, z: 257 };
  const sp1 = state.map.spawns[1] ?? { gx: 212, gz: 128, x: 425, z: 257 };

  // Player 0: Starting MCV (ready to press D & deploy) + 2 escort MBTs
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

  // Player 1: Established rival base with Conyard, Power, War Factory & defender tanks
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
        typeId: p1.factionId === 'crimson' ? 'rhino' : 'grizzly',
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
    ['power_plant', 44, 126], ['power_plant', 44, 130],
    ['refinery', 48, 116], ['refinery', 48, 122], ['war_factory', 42, 128],
    ['war_factory', 48, 128], ['barracks', 38, 128], ['airforce_radar', 36, 120],
    ['service_depot', 38, 134]
  ];
  for (const [typeId, gx, gz] of baseOffsetsP0) {
    spawnEntity(state, { typeId, playerId: p0.playerId, teamId: p0.teamId, factionId: p0.factionId, gx, gz });
  }

  const baseOffsetsP1 = [
    ['conyard', 206, 120], ['power_plant', 212, 118], ['power_plant', 212, 122],
    ['power_plant', 212, 126], ['power_plant', 212, 130],
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

  // Tier-3 heavy armor (25 Prism vs 25 Apocalypse = 50)
  for (let i = 0; i < 25; i++) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    const p0Pos = findNearestPassableLand(state.map, 148 + col * 5.0, 224 + row * 12.0);
    const pr = spawnEntity(state, {
      typeId: 'prism',
      playerId: p0.playerId,
      teamId: p0.teamId,
      factionId: p0.factionId,
      x: p0Pos.x,
      z: p0Pos.z
    });
    pr.orderType = 'ATTACK_MOVE';
    pr.moveTargetX = 340;
    pr.moveTargetZ = 256;

    const p1Pos = findNearestPassableLand(state.map, 344 + col * 5.0, 224 + row * 12.0);
    const ap = spawnEntity(state, {
      typeId: 'apocalypse',
      playerId: p1.playerId,
      teamId: p1.teamId,
      factionId: p1.factionId,
      x: p1Pos.x,
      z: p1Pos.z,
      yaw: -Math.PI * 0.5
    });
    ap.orderType = 'ATTACK_MOVE';
    ap.moveTargetX = 170;
    ap.moveTargetZ = 256;
  }

  // Infantry platoons (30 GI vs 30 Conscript = 60)
  for (let i = 0; i < 30; i++) {
    const col = i % 6;
    const row = Math.floor(i / 6);
    const p0Pos = findNearestPassableLand(state.map, 196 + col * 3.5, 228 + row * 11.0);
    const gi = spawnEntity(state, {
      typeId: 'gi',
      playerId: p0.playerId,
      teamId: p0.teamId,
      factionId: p0.factionId,
      x: p0Pos.x,
      z: p0Pos.z
    });
    gi.orderType = 'ATTACK_MOVE';
    gi.moveTargetX = 310;
    gi.moveTargetZ = 256;

    const p1Pos = findNearestPassableLand(state.map, 296 + col * 3.5, 228 + row * 11.0);
    const cs = spawnEntity(state, {
      typeId: 'conscript',
      playerId: p1.playerId,
      teamId: p1.teamId,
      factionId: p1.factionId,
      x: p1Pos.x,
      z: p1Pos.z,
      yaw: -Math.PI * 0.5
    });
    cs.orderType = 'ATTACK_MOVE';
    cs.moveTargetX = 200;
    cs.moveTargetZ = 256;
  }

  // Harvesters (6 vs 6 = 12)
  for (let i = 0; i < 6; i++) {
    const h0Pos = findNearestPassableLand(state.map, 92 + (i % 3) * 6, 232 + Math.floor(i / 3) * 18);
    spawnEntity(state, {
      typeId: 'harvester',
      playerId: p0.playerId,
      teamId: p0.teamId,
      factionId: p0.factionId,
      x: h0Pos.x,
      z: h0Pos.z
    });
    const h1Pos = findNearestPassableLand(state.map, 412 + (i % 3) * 6, 232 + Math.floor(i / 3) * 18);
    spawnEntity(state, {
      typeId: 'harvester',
      playerId: p1.playerId,
      teamId: p1.teamId,
      factionId: p1.factionId,
      x: h1Pos.x,
      z: h1Pos.z
    });
  }

  // Air wings (12 Stormhawk vs 12 Mig = 24)
  for (let i = 0; i < 12; i++) {
    const sh = spawnEntity(state, {
      typeId: 'stormhawk',
      playerId: p0.playerId,
      teamId: p0.teamId,
      factionId: p0.factionId,
      x: 110 + (i % 4) * 10,
      z: 205 + Math.floor(i / 4) * 35
    });
    sh.orderType = 'ATTACK_MOVE';
    sh.moveTargetX = 340;
    sh.moveTargetZ = 256;

    const mg = spawnEntity(state, {
      typeId: 'crimson_mig',
      playerId: p1.playerId,
      teamId: p1.teamId,
      factionId: p1.factionId,
      x: 390 + (i % 4) * 10,
      z: 205 + Math.floor(i / 4) * 35,
      yaw: -Math.PI * 0.5
    });
    mg.orderType = 'ATTACK_MOVE';
    mg.moveTargetX = 170;
    mg.moveTargetZ = 256;
  }

  // Naval squadrons (8 Aegis vs 8 Dreadnought = 16) in sea lanes (fallback air if no sea)
  const cellSize = WORLD_SIZE / MAP_SIZE;
  const seaSpots = [];
  for (let gz = 24; gz < MAP_SIZE - 24 && seaSpots.length < 40; gz += 8) {
    for (let gx = 40; gx < MAP_SIZE - 40 && seaSpots.length < 40; gx += 12) {
      if (state.map.terrain[gz * MAP_SIZE + gx] === TERRAIN.SEA) {
        seaSpots.push({ x: (gx + 0.5) * cellSize, z: (gz + 0.5) * cellSize });
      }
    }
  }
  for (let i = 0; i < 8; i++) {
    if (seaSpots.length >= 2) {
      const s0 = seaSpots[i % Math.floor(seaSpots.length / 2)];
      const s1 = seaSpots[Math.floor(seaSpots.length / 2) + (i % Math.ceil(seaSpots.length / 2))];
      const ae = spawnEntity(state, {
        typeId: 'aegis',
        playerId: p0.playerId,
        teamId: p0.teamId,
        factionId: p0.factionId,
        x: s0.x,
        z: s0.z
      });
      ae.orderType = 'ATTACK_MOVE';
      ae.moveTargetX = s1.x;
      ae.moveTargetZ = s1.z;

      const dn = spawnEntity(state, {
        typeId: 'dreadnought',
        playerId: p1.playerId,
        teamId: p1.teamId,
        factionId: p1.factionId,
        x: s1.x,
        z: s1.z,
        yaw: -Math.PI * 0.5
      });
      dn.orderType = 'ATTACK_MOVE';
      dn.moveTargetX = s0.x;
      dn.moveTargetZ = s0.z;
    } else {
      spawnEntity(state, { typeId: 'stormhawk', playerId: p0.playerId, teamId: p0.teamId, factionId: p0.factionId, x: 140 + i * 8, z: 256 });
      spawnEntity(state, { typeId: 'crimson_mig', playerId: p1.playerId, teamId: p1.teamId, factionId: p1.factionId, x: 360 + i * 8, z: 256 });
    }
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
        const tx = clampWorld((cmd.x ?? ent.x) + ox);
        const tz = clampWorld((cmd.z ?? ent.z) + oz);
        ent.interactTargetId = null;
        ent.boardTargetId = null;
        ent.attackTargetId = null;

        if (ent.typeId === 'chrono') {
          const dist = Math.hypot(tx - ent.x, tz - ent.z);
          const gx = Math.max(0, Math.min(MAP_SIZE - 1, worldToGrid(tx)));
          const gz = Math.max(0, Math.min(MAP_SIZE - 1, worldToGrid(tz)));
          const idx = gz * MAP_SIZE + gx;
          const cellTerrain = state.map.terrain[idx];
          const cellBlocked = state.map.buildingId[idx] !== 0;
          if (
            dist > 4.0 &&
            ent.stunTicks === 0 &&
            ent.empTicks === 0 &&
            ent.frozenByCount === 0 &&
            (cellTerrain === TERRAIN.LAND || cellTerrain === TERRAIN.BRIDGE) &&
            !cellBlocked &&
            isCellExplored(state, ent.teamId, gx, gz)
          ) {
            const oldX = ent.x;
            const oldZ = ent.z;
            ent.x = tx;
            ent.z = tz;
            ent.prevX = tx;
            ent.prevZ = tz;
            ent.moveTargetX = null;
            ent.moveTargetZ = null;
            ent.orderType = 'IDLE';
            ent.stunTicks = Math.round(Math.max(1.0, Math.min(4.0, dist * 0.08)) * TICK_RATE);
            state.events.push({ type: 'fx:chronoWarp', x: oldX, z: oldZ, tx, tz, entityId: ent.id });
            continue;
          }
        }

        ent.orderType = cmd.type;
        ent.moveTargetX = tx;
        ent.moveTargetZ = tz;
        ent.moveStopDist = 0.9;
        if (ent.deployState === 'DEPLOYED' && ent.typeId === 'gi') {
          deployEntity(state, ent);
        }
        if (
          ENTITY_DEFS[ent.typeId]?.producerType === 'airforce_radar' &&
          ent.airState === 'A_DOCKED' &&
          ent.ammo > 0
        ) {
          ent.airState = 'A_LAUNCHING';
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

        if (canBoardTransport(target, ent)) {
          ent.boardTargetId = target.id;
          ent.interactTargetId = null;
          ent.attackTargetId = null;
          ent.orderType = 'BOARD';
          ent.moveTargetX = target.x;
          ent.moveTargetZ = target.z;
          ent.moveStopDist = (target.radius ?? 1.8) + 1.4;
          continue;
        }

        if (ent.typeId === 'engineer' && target.isBuilding && (target.teamId !== ent.teamId || target.playerId === cmd.playerId)) {
          ent.interactTargetId = target.id;
          ent.boardTargetId = null;
          ent.attackTargetId = null;
          ent.orderType = 'INTERACT';
          ent.moveTargetX = target.x;
          ent.moveTargetZ = target.z;
          ent.moveStopDist = (target.radius ?? 2.0) + 1.4;
          continue;
        }

        if (ent.teamId === target.teamId) continue;
        ent.interactTargetId = null;
        ent.boardTargetId = null;
        ent.attackTargetId = target.id;
        ent.orderType = 'ATTACK';
        if (!ent.isBuilding) {
          const isShadowC4 =
            ent.typeId === 'shadow' &&
            (target.isBuilding || target.domain === 'SEA' || target.domain === 'SUBMERGED');
          const weapon = ENTITY_DEFS[ent.typeId]?.weapon;
          const range = isShadowC4 ? 1.8 : (weapon?.range ?? 10);
          if (Math.hypot(target.x - ent.x, target.z - ent.z) > range + (target.radius ?? 0)) {
            ent.moveTargetX = target.x;
            ent.moveTargetZ = target.z;
            ent.moveStopDist = isShadowC4 ? 1.6 : Math.max(2.0, range * 0.85);
          } else {
            ent.moveTargetX = null;
            ent.moveTargetZ = null;
          }
          if (
            ENTITY_DEFS[ent.typeId]?.producerType === 'airforce_radar' &&
            ent.airState === 'A_DOCKED' &&
            ent.ammo > 0
          ) {
            ent.airState = 'A_LAUNCHING';
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
        ent.interactTargetId = null;
        ent.boardTargetId = null;
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
      const gx = Math.round(cmd.gx ?? cmd.x ?? 0);
      const gz = Math.round(cmd.gz ?? cmd.z ?? 0);
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
      castDoctrine(state, cmd.playerId, cmd.typeId, cmd.x, cmd.z);
      break;
    case 'FIRE_SUPERWEAPON':
      fireSuperweapon(state, cmd.playerId, cmd.typeId, cmd.x, cmd.z, cmd.sourceX, cmd.sourceZ, applyDamage);
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
  stepAirforce(state);
  stepNaval(state);
}

function stepSuperweaponsAndAreaEffects(state) {
  stepSuperweaponsAndAreaEffectsCore(state, applyDamage);
}

function stepAiAndCheckVictory(state) {
  stepAI(state);
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
  if (state.tickCount <= 5 || state.tickCount % 3 === 0) {
    rebuildTeamFogGrids(state);           // 9 (10 Hz deterministic fog update)
  }
  stepAiAndCheckVictory(state);           // 10
  if (state.mode === 'campaign' && state.directorState) {
    stepDirector(state, getCampaignMission(state.missionId));
  }
}
