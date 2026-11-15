import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { ENTITY_DEFS, FACTIONS, SUPERWEAPON_IDS } from '../src/core/config.js';
import { createGameState, enqueueCommand, stepSimulation } from '../src/core/engine.js';
import { rebuildTeamFogGrids, getCellFogMask, FOG_VISIBLE, FOG_DETECTED } from '../src/gameplay/fogCpu.js';
import { spawnEntity } from '../src/gameplay/entities.js';
import { compileMap, MAP_SIZE, TERRAIN, worldToGrid } from '../src/world/map.js';
import { SKIRMISH_MAPS } from '../src/world/skirmishMaps.js';

function createFlatLandMap() {
  return compileMap({
    id: 'm4_flat_test',
    seed: 1001,
    baseElevation: 1.6,
    seaChannels: [],
    bridges: [],
    cliffs: [],
    orePatches: [{ cx: 70, cz: 70, radius: 4, oreType: 1, amount: 2, pillar: true }],
    spawns: [
      { playerId: 0, teamId: 0, factionId: 'abyssal', gx: 40, gz: 40 },
      { playerId: 1, teamId: 1, factionId: 'crimson', gx: 160, gz: 160 }
    ]
  });
}

function testNukeWarningAndIronCurtainCounterplay() {
  const map = createFlatLandMap();
  const state = createGameState({ map, populateDefault: false, startingCredits: 20000 });

  const silo = spawnEntity(state, {
    typeId: 'nuclear_silo',
    playerId: 1,
    teamId: 1,
    factionId: 'crimson',
    gx: 160,
    gz: 160
  });
  const curtain = spawnEntity(state, {
    typeId: 'iron_curtain',
    playerId: 0,
    teamId: 0,
    factionId: 'crimson',
    gx: 40,
    gz: 40
  });
  // Supply power so superweapons operate at green power
  spawnEntity(state, { typeId: 'nuclear_reactor', playerId: 0, teamId: 0, factionId: 'crimson', gx: 36, gz: 40 });
  spawnEntity(state, { typeId: 'nuclear_reactor', playerId: 1, teamId: 1, factionId: 'crimson', gx: 156, gz: 160 });

  // Cluster of Apocalypse tanks in non-overlapping 3x3 cell triangle + unshielded Grizzly nearby
  const coords = [
    [99.0, 99.0],
    [103.0, 99.0],
    [101.0, 102.5]
  ];
  const apocCluster = coords.map(([x, z]) =>
    spawnEntity(state, {
      typeId: 'apocalypse',
      playerId: 0,
      teamId: 0,
      factionId: 'crimson',
      x,
      z
    })
  );
  const unshielded = spawnEntity(state, {
    typeId: 'grizzly',
    playerId: 0,
    teamId: 0,
    factionId: 'abyssal',
    x: 109,
    z: 100
  });

  stepSimulation(state);
  assert.ok(state.players[1].superweapons.nuclear_silo, 'Nuke silo cooldown entry should exist');
  assert.ok(state.players[0].superweapons.iron_curtain, 'Iron curtain cooldown entry should exist');

  // Force both superweapons ready for exact 180-tick counterplay test
  state.players[1].superweapons.nuclear_silo.remainingTicks = 0;
  state.players[0].superweapons.iron_curtain.remainingTicks = 0;

  // Step to establish tick base, then fire Nuke at (100, 100)
  enqueueCommand(state, {
    playerId: 1,
    type: 'FIRE_SUPERWEAPON',
    typeId: 'nuclear_silo',
    x: 100,
    z: 100
  });
  stepSimulation(state); // executes at tickCount=1 -> warning expiryTick = 1 + 180 = 181

  const warning = state.areaEffects.find((fx) => fx.kind === 'sw_warning' && fx.swTypeId === 'nuclear_silo');
  assert.ok(warning, 'Nuclear launch must spawn a 180-tick sw_warning hazard beacon');
  const impactTick = warning.expiryTick;
  assert.equal(impactTick - state.tickCount, 180, 'Warning duration must be 180 ticks from trigger tick');

  // Step to 1 tick BEFORE detonation (when Iron Curtain arrives right before impactTick!)
  while (state.tickCount < impactTick - 1) {
    stepSimulation(state);
  }
  assert.ok(
    state.areaEffects.some((fx) => fx.kind === 'sw_warning'),
    'Warning must remain active right up to counterplay deadline'
  );

  // At t = impactTick - 1, trigger Iron Curtain over Apocalypse cluster (100, 100)
  enqueueCommand(state, {
    playerId: 0,
    type: 'FIRE_SUPERWEAPON',
    typeId: 'iron_curtain',
    x: 101,
    z: 100
  });
  stepSimulation(state); // executes Iron Curtain AND crosses detonation tick cleanly!
  for (const a of apocCluster) {
    assert.ok(a.ironCurtainTicks >= 449, 'Iron Curtain must grant 450-tick shield to entire 3x3 cluster');
  }
  assert.equal(unshielded.ironCurtainTicks, 0, 'Grizzly outside Iron Curtain radius stays unshielded');

  assert.ok(
    state.areaEffects.some((fx) => fx.kind === 'radiation'),
    'Nuclear detonation must spawn persistent radiation fallout zone'
  );
  for (const a of apocCluster) {
    assert.equal(a.hp, a.maxHp, 'Shielded Apocalypse cluster must survive Nuke blast with 100% HP');
  }
  assert.equal(unshielded.alive, false, 'Unshielded Grizzly within 1200 blast radius must be destroyed');
  console.log('[test-m4] Nuke 180-tick warning + t=179 Iron Curtain counterplay + radiation fallout passed!');
}

function testChronoStormLowPowerAndDoctrines() {
  // 1. Chrono Sphere ground vs sea vs infantry erasure + Weather Control + Low Power pause
  const seaMap = compileMap({
    id: 'm4_sea_test',
    seed: 2020,
    baseElevation: 1.6,
    seaChannels: [{ type: 'strait_x', centerX: 128, halfWidth: 20, zMin: 0, zMax: 255, shallowMargin: 4 }],
    bridges: [],
    cliffs: [],
    orePatches: [],
    spawns: [
      { playerId: 0, teamId: 0, factionId: 'abyssal', gx: 40, gz: 128 },
      { playerId: 1, teamId: 1, factionId: 'crimson', gx: 210, gz: 128 }
    ]
  });

  const state = createGameState({ map: seaMap, populateDefault: false });
  spawnEntity(state, { typeId: 'conyard', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 36, gz: 124 });
  spawnEntity(state, { typeId: 'chrono_sphere', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 42, gz: 124 });
  spawnEntity(state, { typeId: 'weather_control', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 46, gz: 124 });
  const radar = spawnEntity(state, { typeId: 'airforce_radar', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 32, gz: 124 });

  // Units in source 3x3 cluster around (100, 200)
  const tank = spawnEntity(state, { typeId: 'grizzly', playerId: 0, teamId: 0, factionId: 'abyssal', x: 100, z: 200 });
  const inf = spawnEntity(state, { typeId: 'gi', playerId: 0, teamId: 0, factionId: 'abyssal', x: 101, z: 200 });
  // Sea ship around sea (256, 200)
  const aegis = spawnEntity(state, { typeId: 'aegis', playerId: 0, teamId: 0, factionId: 'abyssal', x: 256, z: 200 });
  // Damaged grizzly for Nano Repair + Enemy units for EMP & Recon stealth test
  const hurt = spawnEntity(state, { typeId: 'grizzly', playerId: 0, teamId: 0, factionId: 'abyssal', x: 70, z: 200 });
  hurt.hp = 100;
  const hiddenShadow = spawnEntity(state, { typeId: 'shadow', playerId: 1, teamId: 1, factionId: 'crimson', x: 380, z: 120 });
  hiddenShadow.isStealthed = true;
  const enemyRhino = spawnEntity(state, { typeId: 'rhino', playerId: 1, teamId: 1, factionId: 'crimson', x: 360, z: 120 });
  // Target for Weather Control storm away from test EMP target
  spawnEntity(state, { typeId: 'rhino', playerId: 1, teamId: 1, factionId: 'crimson', x: 360, z: 256 });

  stepSimulation(state);
  // Check Low-Power pause: with only conyard (+20) and chrono+weather (-400), isLowPower is true!
  assert.equal(state.players[0].isLowPower, true, 'Missing power plants with -400 drain must be low power');
  const cdBefore = state.players[0].superweapons.chrono_sphere.remainingTicks;
  for (let i = 0; i < 10; i++) stepSimulation(state);
  assert.equal(
    state.players[0].superweapons.chrono_sphere.remainingTicks,
    cdBefore,
    'Superweapon cooldown must strictly pause while isLowPower === true'
  );

  // Supply ample power & verify cooldown ticks down + Chrono/Storm
  for (let p = 0; p < 5; p++) {
    spawnEntity(state, { typeId: 'power_plant', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 30 + p * 3, gz: 132 });
  }
  stepSimulation(state);
  assert.equal(state.players[0].isLowPower, false);

  state.players[0].superweapons.chrono_sphere.remainingTicks = 0;
  state.players[0].superweapons.weather_control.remainingTicks = 0;

  // Chrono Sphere warps vehicle onto land (150, 200) & erases infantry caught in 3x3
  enqueueCommand(state, {
    playerId: 0,
    type: 'FIRE_SUPERWEAPON',
    typeId: 'chrono_sphere',
    sourceX: 100,
    sourceZ: 200,
    x: 150,
    z: 200
  });
  stepSimulation(state);
  assert.ok(tank.alive && Math.hypot(tank.x - 150, tank.z - 200) < 10, 'Chrono Sphere must teleport land tank');
  assert.equal(inf.alive, false, 'Chrono Sphere must erase infantry caught inside 3x3 teleport box');

  // Chrono Sphere warps ship from sea to sea (never strands on land)
  state.players[0].superweapons.chrono_sphere.remainingTicks = 0;
  enqueueCommand(state, {
    playerId: 0,
    type: 'FIRE_SUPERWEAPON',
    typeId: 'chrono_sphere',
    sourceX: 256,
    sourceZ: 200,
    x: 260,
    z: 280
  });
  stepSimulation(state);
  const shipCell = worldToGrid(aegis.z) * MAP_SIZE + worldToGrid(aegis.x);
  assert.equal(state.map.terrain[shipCell], TERRAIN.SEA, 'Chrono-warped naval unit must land on TERRAIN.SEA');

  // Weather Control: 180-tick warning -> 360-tick storm -> 18 deterministic lightning strikes
  enqueueCommand(state, {
    playerId: 0,
    type: 'FIRE_SUPERWEAPON',
    typeId: 'weather_control',
    x: 360,
    z: 256
  });
  let strikeCount = 0;
  for (let i = 0; i < 600; i++) {
    stepSimulation(state);
    for (const ev of state.events) {
      if (ev.type === 'fx:lightningStrike') strikeCount++;
    }
  }
  assert.equal(strikeCount, 18, `Weather Control must fire exactly 18 lightning strikes (got ${strikeCount})`);

  // F1..F4 Doctrines: reset cooldowns and verify each doctrine
  state.players[0].doctrines = { recon_satellite: 0, paratroopers: 0, nano_repair: 0, emp_strike: 0 };

  // F1: Recon Satellite reveals stealthed units
  enqueueCommand(state, { playerId: 0, type: 'USE_DOCTRINE', typeId: 'recon_satellite', x: 380, z: 120 });
  stepSimulation(state);
  const fogMask = getCellFogMask(state, 0, worldToGrid(hiddenShadow.x), worldToGrid(hiddenShadow.z));
  assert.equal(
    (fogMask & (FOG_VISIBLE | FOG_DETECTED)) === (FOG_VISIBLE | FOG_DETECTED),
    true,
    'F1 Recon Satellite must set both FOG_VISIBLE and FOG_DETECTED'
  );

  // F3: Nano Repair heals 35% maxHp
  const beforeHp = hurt.hp;
  enqueueCommand(state, { playerId: 0, type: 'USE_DOCTRINE', typeId: 'nano_repair', x: hurt.x, z: hurt.z });
  stepSimulation(state);
  assert.ok(hurt.hp > beforeHp + 50, 'F3 Nano Repair must heal damaged friendly vehicles');

  // F4: EMP Strike disables enemy vehicles for 240 ticks
  enqueueCommand(state, { playerId: 0, type: 'USE_DOCTRINE', typeId: 'emp_strike', x: enemyRhino.x, z: enemyRhino.z });
  stepSimulation(state);
  assert.ok(enemyRhino.empTicks >= 239 && enemyRhino.empTicks <= 240, 'F4 EMP Strike must set empTicks = 240 on enemy mechanical units');

  // F2: Paratroopers drops 6 GI with radar, and blocks without radar/airport
  enqueueCommand(state, { playerId: 0, type: 'USE_DOCTRINE', typeId: 'paratroopers', x: 80, z: 200 });
  stepSimulation(state);
  const droppedGis = state.entities.filter((e) => e.alive && e.playerId === 0 && e.typeId === 'gi');
  assert.equal(droppedGis.length, 6, 'F2 Paratroopers must drop 6 GI for Abyssal when radar exists');

  radar.alive = false;
  state.players[0].doctrines.paratroopers = 0;
  enqueueCommand(state, { playerId: 0, type: 'USE_DOCTRINE', typeId: 'paratroopers', x: 90, z: 200 });
  stepSimulation(state);
  assert.ok(
    state.events.some((e) => e.type === 'hud:notice' && e.key === 'hud.status.doctrineNoRadar'),
    'F2 Paratroopers without Airforce Radar or Tech Airport must fail cleanly with notice'
  );

  console.log('[test-m4] Chrono Sphere, Weather Control (18 strikes), Low-Power pause, and F1..F4 Doctrines passed!');
}

function testEightSkirmishMaps() {
  assert.equal(SKIRMISH_MAPS.length, 8, 'Must provide all 8 skirmish maps');
  for (const bp of SKIRMISH_MAPS) {
    const t0 = performance.now();
    const compiled = compileMap(bp);
    const ms = performance.now() - t0;
    assert.ok(ms < 15.0, `Map ${bp.id} compiled in ${ms.toFixed(2)}ms (must be < 15ms)`);
    assert.ok(compiled.spawns.length >= 2, `Map ${bp.id} must have >= 2 spawns`);
    assert.ok(compiled.orePillars.length >= 2, `Map ${bp.id} must have ore pillars`);
  }
  console.log('[test-m4] All 8 skirmish map blueprints compiled in < 15ms each!');
}

function testFogConstrainedAndThreeTierAI() {
  // 1. Strict Fog-of-War test: hidden enemy cluster outside fogGrids[1] gets 0 AI attack targets
  const map = compileMap(SKIRMISH_MAPS[0]); // harbor
  const fogState = createGameState({
    mapBlueprint: SKIRMISH_MAPS[0],
    populateDefault: false,
    enableAI: true,
    startingCredits: 2000
  });
  const aiHq = spawnEntity(fogState, { typeId: 'conyard', playerId: 1, teamId: 1, factionId: 'crimson', gx: 210, gz: 126 });
  spawnEntity(fogState, { typeId: 'power_plant', playerId: 1, teamId: 1, factionId: 'crimson', gx: 216, gz: 126 });
  const hiddenEnemyTank = spawnEntity(fogState, { typeId: 'grizzly', playerId: 0, teamId: 0, factionId: 'abyssal', x: 40, z: 256 });
  // Put an AI Rhino right next to AI HQ (nowhere near hiddenEnemyTank)
  const aiTank = spawnEntity(fogState, { typeId: 'rhino', playerId: 1, teamId: 1, factionId: 'crimson', x: aiHq.x - 8, z: aiHq.z });

  for (let t = 0; t < 60; t++) stepSimulation(fogState);
  assert.notEqual(
    aiTank.attackTargetId,
    hiddenEnemyTank.id,
    'AI must NEVER target an enemy hidden outside fogGrids[teamId]'
  );

  // 2. Smoke-test Easy, Normal, Hard AI + zero infinite power_plant loop + valid coastal naval_yard
  for (const diff of ['easy', 'normal', 'hard']) {
    const sim = createGameState({
      mapBlueprint: SKIRMISH_MAPS[0],
      players: [
        { playerId: 0, teamId: 0, factionId: 'abyssal', isHuman: false, aiDifficulty: diff, credits: 15000 },
        { playerId: 1, teamId: 1, factionId: 'crimson', isHuman: false, aiDifficulty: diff, credits: 15000 }
      ],
      skirmishFairStart: true
    });
    for (let t = 0; t < 3000 && sim.winnerTeamId === null; t++) {
      stepSimulation(sim);
    }
    for (const p of sim.players) {
      const pPlants = sim.entities.filter((e) => e.alive && e.playerId === p.playerId && e.typeId === 'power_plant').length;
      assert.ok(pPlants <= 10, `AI (${diff}) must never infinite-loop power_plant (built ${pPlants})`);
      const ny = sim.entities.find((e) => e.alive && e.playerId === p.playerId && e.typeId === 'naval_yard');
      if (ny) {
        const nyCell = ny.gz * MAP_SIZE + ny.gx;
        assert.equal(sim.map.terrain[nyCell], TERRAIN.SEA, `AI (${diff}) naval_yard must stand on TERRAIN.SEA`);
      }
    }
  }
  console.log('[test-m4] Strict Fog AI, zero infinite power-plant loop & Easy/Normal/Hard AI smoke passed!');
}

testNukeWarningAndIronCurtainCounterplay();
testChronoStormLowPowerAndDoctrines();
testEightSkirmishMaps();
testFogConstrainedAndThreeTierAI();
console.log('[test-m4] ALL M4 SIMULATION GATES PASSED.');
