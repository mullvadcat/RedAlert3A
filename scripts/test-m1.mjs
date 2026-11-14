import assert from 'node:assert/strict';
import { ENTITY_DEFS, getArmorMultiplier } from '../src/core/config.js';
import { createGameState, enqueueCommand, stepSimulation } from '../src/core/engine.js';
import { FOG_EXPLORED, FOG_VISIBLE, getCellFogMask, rebuildTeamFogGrids } from '../src/gameplay/fogCpu.js';
import { requestFlowField } from '../src/gameplay/nav.js';
import { cancelProduction, startProduction } from '../src/gameplay/production.js';
import { spawnEntity } from '../src/gameplay/entities.js';
import { compileMap, DEFAULT_M1_MAP_BLUEPRINT, MAP_SIZE, ORE_TYPE, TERRAIN, worldToGrid } from '../src/world/map.js';

function testArmorAndConfig() {
  const aegis = { typeId: 'aegis', armor: ENTITY_DEFS.aegis.armor, isStructure: false };
  const kirov = { typeId: 'kirov', armor: ENTITY_DEFS.kirov.armor, isStructure: false };
  const dummyAttacker = { typeId: 'v3' };
  const structure = { typeId: 'conyard', armor: ENTITY_DEFS.conyard.armor, isStructure: true };
  const rocketeer = { typeId: 'rocketeer', armor: ENTITY_DEFS.rocketeer.armor, isStructure: false };

  const aegisSalvo =
    ENTITY_DEFS.aegis.weapon.burst *
    ENTITY_DEFS.aegis.weapon.damage *
    getArmorMultiplier('Missile', kirov, aegis);
  assert.equal(aegisSalvo, 208, 'Aegis salvo vs Kirov must equal 208');

  // Ensure Missile vs Aegis did NOT get inverted (Aegis is Heavy armor -> 0.75)
  assert.equal(getArmorMultiplier('Missile', aegis, dummyAttacker), 0.75);
  assert.equal(getArmorMultiplier('HighExplosive', structure, dummyAttacker), 1.35);
  assert.equal(getArmorMultiplier('Prism', structure, dummyAttacker), 1.30);
  assert.equal(getArmorMultiplier('Bullet', rocketeer, dummyAttacker), 0.60);
  console.log('[test-m1] Armor & override checks passed (Aegis vs Kirov = 208).');
}

function testMapAndOreRegen() {
  const t0 = performance.now();
  const map = compileMap(DEFAULT_M1_MAP_BLUEPRINT);
  const dt = performance.now() - t0;
  assert.ok(dt < 15, `compileMap took ${dt.toFixed(2)}ms (expected < 15ms)`);

  // Create empty isolated state with a single pillar surrounded by depleted land cells
  const testMap = compileMap({
    id: 'pillar_test',
    baseElevation: 1.6,
    seaChannels: [],
    bridges: [],
    cliffs: [],
    orePatches: [{ cx: 100, cz: 100, radius: 1, oreType: ORE_TYPE.RED, amount: 0, pillar: true }],
    spawns: []
  });
  const state = createGameState({ map: testMap, populateDefault: false });
  const pillar = state.orePillars[0];
  assert.ok(pillar, 'Ore pillar should exist');

  let totalOreBefore = 0;
  for (let i = 0; i < testMap.oreAmount.length; i++) totalOreBefore += testMap.oreAmount[i];
  assert.equal(totalOreBefore, 0);

  for (let tick = 0; tick < 300; tick++) {
    stepSimulation(state);
  }

  let nonZeroCells = 0;
  let totalOreAfter = 0;
  for (let i = 0; i < testMap.oreAmount.length; i++) {
    if (testMap.oreAmount[i] > 0) nonZeroCells++;
    totalOreAfter += testMap.oreAmount[i];
  }
  assert.equal(nonZeroCells, 1, 'After 300 ticks, exactly 1 cell should receive 1 unit of ore');
  assert.equal(totalOreAfter, 1);
  console.log(`[test-m1] Map compile (${dt.toFixed(2)}ms < 15ms) & 300-tick single-cell ore regen passed.`);
}

function testFogPersistence() {
  const map = compileMap({
    id: 'fog_test',
    baseElevation: 1.6,
    seaChannels: [],
    bridges: [],
    cliffs: [],
    orePatches: [],
    spawns: []
  });
  const state = createGameState({ map, populateDefault: false });
  const tank = spawnEntity(state, { typeId: 'grizzly', playerId: 0, teamId: 0, factionId: 'abyssal', x: 60, z: 60 });
  rebuildTeamFogGrids(state);

  const gx = worldToGrid(60);
  const gz = worldToGrid(60);
  assert.equal(getCellFogMask(state, 0, gx, gz), FOG_EXPLORED | FOG_VISIBLE);

  // Move tank far outside its prior sight circle (sight=16m = 8 cells; move 100m away)
  tank.x = 200;
  tank.z = 200;
  rebuildTeamFogGrids(state);
  assert.equal(getCellFogMask(state, 0, gx, gz), FOG_EXPLORED, 'Previously visited cell must remain EXPLORED (1)');
  console.log('[test-m1] Fog EXPLORED (3 -> 1) persistence test passed.');
}

function testNavTimeSliced() {
  const state = createGameState({ populateDefault: true });
  for (let i = 0; i < 20; i++) {
    requestFlowField(state, 100 + i * 16, 80 + (i % 5) * 32, 'LAND', 1);
  }
  // Warm up JIT cleanly on 1 tick, then benchmark 10 ticks of 2 flows/tick
  stepSimulation(state);
  assert.ok(state.flowCache.lastComputedThisTick <= 2, 'Must strictly compute <= 2 flowfields/tick');

  const times = [];
  for (let k = 0; k < 10; k++) {
    const start = performance.now();
    stepSimulation(state);
    const elapsed = performance.now() - start;
    assert.ok(state.flowCache.lastComputedThisTick <= 2);
    times.push(elapsed);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  console.log(`[test-m1] Navigation 20-request time-sliced avg step = ${avg.toFixed(3)}ms (<= 2 flowfields/tick).`);
  assert.ok(avg < 5.0, `Full stepSimulation shouldn't exceed budget (${avg.toFixed(3)}ms)`);
}

function testM1PlayableLoopAndMixedHarvester() {
  const flatMap = compileMap({
    id: 'm1_loop_test',
    baseElevation: 1.6,
    seaChannels: [],
    bridges: [],
    cliffs: [],
    orePatches: [],
    spawns: [
      { playerId: 0, teamId: 0, factionId: 'abyssal', gx: 44, gz: 128 },
      { playerId: 1, teamId: 1, factionId: 'crimson', gx: 90, gz: 128 }
    ]
  });

  // Paint exact mixed ore right beside player 0 refinery spot: 1 Red cell + 1 Violet cell
  const redGx = 52, redGz = 136;
  const vioGx = 53, vioGz = 136;
  flatMap.oreType[redGz * MAP_SIZE + redGx] = ORE_TYPE.RED;
  flatMap.oreAmount[redGz * MAP_SIZE + redGx] = 1;
  flatMap.oreType[vioGz * MAP_SIZE + vioGx] = ORE_TYPE.VIOLET;
  flatMap.oreAmount[vioGz * MAP_SIZE + vioGx] = 1;

  const state = createGameState({
    map: flatMap,
    populateDefault: false,
    fastBuild: true,
    startingCredits: 10000
  });

  // Spawn Player 0 MCV & Player 1 rival Conyard
  const mcv = spawnEntity(state, { typeId: 'mcv', playerId: 0, teamId: 0, factionId: 'abyssal', x: 88, z: 256 });
  spawnEntity(state, { typeId: 'conyard', playerId: 1, teamId: 1, factionId: 'crimson', gx: 90, gz: 128 });
  rebuildTeamFogGrids(state);

  // Verify N===0 pause guard & refund before factory exists
  const p0 = state.players[0];
  enqueueCommand(state, { playerId: 0, type: 'DEPLOY', entityIds: [mcv.id] });
  stepSimulation(state);

  const conyard = state.entities.find((e) => e.playerId === 0 && e.typeId === 'conyard');
  assert.ok(conyard, 'MCV must deploy into conyard');

  // Force test N=0 pause guard directly on queued item whose producer gets destroyed
  p0.queues.vehicle.push({
    typeId: 'grizzly', count: 1, totalCost: 700, paidCost: 200, progressTicks: 50, totalTicks: 195, status: 'BUILDING'
  });
  stepSimulation(state);
  assert.equal(p0.queues.vehicle[0].status, 'PAUSED', 'Queue with 0 compatible producers must immediately pause');
  const creditsBeforeCancel = p0.credits;
  cancelProduction(state, 0, 'vehicle', 'grizzly', 1);
  assert.equal(p0.credits, creditsBeforeCancel + 200, 'Cancel must refund paidCost cleanly');

  // Build Power Plant
  startProduction(state, 0, 'main', 'power_plant');
  for (let i = 0; i < 60 && p0.queues.main?.status !== 'READY'; i++) stepSimulation(state);
  assert.equal(p0.queues.main?.status, 'READY');
  enqueueCommand(state, { playerId: 0, type: 'PLACE_BUILDING', typeId: 'power_plant', x: 40, z: 120 });
  stepSimulation(state);
  assert.equal(p0.powerState, 'green');

  // Build Refinery -> spawns Harvester automatically
  startProduction(state, 0, 'main', 'refinery');
  for (let i = 0; i < 120 && p0.queues.main?.status !== 'READY'; i++) stepSimulation(state);
  enqueueCommand(state, { playerId: 0, type: 'PLACE_BUILDING', typeId: 'refinery', x: 48, z: 128 });
  stepSimulation(state);

  const harv = state.entities.find((e) => e.playerId === 0 && e.typeId === 'harvester');
  assert.ok(harv, 'Refinery must spawn complimentary harvester');

  // Record credits once refinery is paid, then wait for mixed ($350 + $700 = $1050) unload!
  const creditsAtHarvestStart = p0.credits;
  let unloadedAmount = 0;
  for (let i = 0; i < 600; i++) {
    stepSimulation(state);
    for (const ev of state.events) {
      if (ev.type === 'economy:unloaded' && ev.entityId === harv.id) {
        unloadedAmount = ev.amount;
      }
    }
    if (unloadedAmount > 0) break;
  }
  assert.equal(unloadedAmount, 1050, 'Mixed 1 Red ($350) + 1 Violet ($700) cargo must unload exact $1,050');
  assert.equal(Math.round(p0.credits - creditsAtHarvestStart), 1050);

  // Build War Factory -> Train 4 Grizzly tanks -> Attack & destroy enemy Conyard -> Victory!
  startProduction(state, 0, 'main', 'war_factory');
  for (let i = 0; i < 120 && p0.queues.main?.status !== 'READY'; i++) stepSimulation(state);
  enqueueCommand(state, { playerId: 0, type: 'PLACE_BUILDING', typeId: 'war_factory', x: 42, z: 120 });
  stepSimulation(state);

  startProduction(state, 0, 'vehicle', 'grizzly', 4);
  for (let i = 0; i < 200; i++) {
    stepSimulation(state);
    if (state.entities.filter((e) => e.playerId === 0 && e.typeId === 'grizzly').length >= 4) break;
  }
  const tanks = state.entities.filter((e) => e.playerId === 0 && e.typeId === 'grizzly');
  assert.ok(tanks.length >= 4, 'War factory must produce 4 Grizzly tanks');

  const enemyHq = state.entities.find((e) => e.playerId === 1 && e.typeId === 'conyard');
  assert.ok(enemyHq);
  enqueueCommand(state, {
    playerId: 0,
    type: 'ATTACK_MOVE',
    entityIds: tanks.map((t) => t.id),
    x: enemyHq.x,
    z: enemyHq.z
  });

  for (let i = 0; i < 1500 && state.winnerTeamId === null; i++) {
    stepSimulation(state);
  }
  assert.equal(state.winnerTeamId, 0, 'Destroying all enemy buildings/MCVs must trigger victory for team 0');
  console.log('[test-m1] Full M1 gameplay loop + mixed $1,050 harvester unload + N=0 guard + victory passed!');
}

testArmorAndConfig();
testMapAndOreRegen();
testFogPersistence();
testNavTimeSliced();
testM1PlayableLoopAndMixedHarvester();
console.log('[test-m1] ALL SIMULATION GATES PASSED.');
