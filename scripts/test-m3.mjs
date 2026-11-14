import assert from 'node:assert/strict';

import { ENTITY_DEFS, TICK_RATE, getArmorMultiplier } from '../src/core/config.js';
import { createGameState, enqueueCommand, stepSimulation } from '../src/core/engine.js';
import {
  boardTransport,
  deployEntity,
  removeEntity,
  spawnEntity
} from '../src/gameplay/entities.js';
import { rebuildTeamFogGrids } from '../src/gameplay/fogCpu.js';
import { startProduction, stepProductionAndPower } from '../src/gameplay/production.js';
import { MAP_SIZE, TERRAIN, compileMap, gridToWorldCenter } from '../src/world/map.js';

function createFlatTestMap(id, withSea = false) {
  const map = compileMap({
    id,
    baseElevation: 1.6,
    seaChannels: [],
    bridges: [],
    cliffs: [],
    orePatches: [],
    spawns: []
  });
  if (withSea) {
    for (let gz = 40; gz <= 115; gz++) {
      for (let gx = 70; gx <= 145; gx++) {
        const idx = gz * MAP_SIZE + gx;
        map.terrain[idx] = TERRAIN.SEA;
        map.elevation[idx] = -2.4;
      }
    }
  }
  return map;
}

function testChronoLegionnaireFreezeAndErase() {
  const map = createFlatTestMap('m3_chrono_test');
  const state = createGameState({ map, populateDefault: false });

  const c1 = spawnEntity(state, { typeId: 'chrono', playerId: 0, teamId: 0, factionId: 'abyssal', x: 50, z: 50 });
  const c2 = spawnEntity(state, { typeId: 'chrono', playerId: 0, teamId: 0, factionId: 'abyssal', x: 52, z: 52 });
  const g1 = spawnEntity(state, { typeId: 'grizzly', playerId: 0, teamId: 0, factionId: 'abyssal', x: 50, z: 58 });
  // Put rhino right next to c1 inside sight radius
  const rhino = spawnEntity(state, { typeId: 'rhino', playerId: 1, teamId: 1, factionId: 'crimson', x: 56, z: 50 });
  rebuildTeamFogGrids(state);

  // 1. Chrono instant teleport within explored fog sets stunTicks = clamp(D*0.08, 1, 4)*30
  // Move c2 near an already visible explored cell 12m away -> wait first let's reveal destination by placing c1 within sight or fog explore
  const destX = 62;
  const destZ = 52;
  const d = Math.hypot(destX - c2.x, destZ - c2.z); // 10m -> clamp(0.8, 1.0, 4.0) = 1.0s = 30 ticks
  enqueueCommand(state, { playerId: 0, type: 'MOVE', entityIds: [c2.id], x: destX, z: destZ });
  stepSimulation(state);
  assert.equal(c2.x, destX, 'Chrono must warp immediately on MOVE to explored land');
  assert.ok(c2.stunTicks >= 29 && c2.stunTicks <= 30, `Expected ~30 stun ticks after 10m warp, got ${c2.stunTicks}`);
  assert.ok(state.events.some((e) => e.type === 'fx:chronoWarp'), 'Warp must emit fx:chronoWarp event');

  // 2. Single chrono locks rhino while grizzly shoots at it: HP must stay intact at pre-freeze maxHp (490)
  const preFreezeHp = rhino.hp;
  enqueueCommand(state, { playerId: 0, type: 'ATTACK', entityIds: [c1.id, g1.id], targetId: rhino.id });
  for (let i = 0; i < 6; i++) stepSimulation(state);
  assert.equal(rhino.frozenByCount, 1, '1st Chrono must set frozenByCount === 1');
  assert.equal(rhino.hp, preFreezeHp, 'Frozen tank must be immune to normal Grizzly cannon fire');
  assert.ok(rhino.eraseProgress > 40 && rhino.eraseProgress < 60, `Expected ~50 eraseProgress after 6 ticks, got ${rhino.eraseProgress}`);

  // 3. 2nd Chrono finishes stun & locks same rhino -> doubles erasure speed (2 * 250/30 per tick)
  for (let i = 0; i < 30; i++) stepSimulation(state); // clear remaining stun
  enqueueCommand(state, { playerId: 0, type: 'ATTACK', entityIds: [c2.id], targetId: rhino.id });
  const beforeErase = rhino.eraseProgress;
  stepSimulation(state);
  const delta2 = rhino.eraseProgress - beforeErase;
  assert.ok(rhino.frozenByCount === 2, `Expected frozenByCount === 2, got ${rhino.frozenByCount}`);
  assert.ok(Math.abs(delta2 - 500 / 30) < 0.05, `Two Chronos must double erase rate (~16.67/tick), got ${delta2}`);

  // 4. Move c1 out of range -> frozenByCount drops to 1 and continues erasing
  enqueueCommand(state, { playerId: 0, type: 'MOVE', entityIds: [c1.id], x: 38, z: 50 });
  stepSimulation(state);
  const afterDrop1 = rhino.eraseProgress;
  stepSimulation(state);
  assert.equal(rhino.frozenByCount, 1, 'After 1st Chrono leaves, 2nd still keeps target frozen');
  assert.ok(rhino.eraseProgress > afterDrop1, 'Remaining Chrono continues advancing eraseProgress');

  // 5. Move c2 away as well -> frozenByCount === 0 resets eraseProgress = 0 without touching hp (still preFreezeHp)
  enqueueCommand(state, { playerId: 0, type: 'MOVE', entityIds: [c2.id], x: 40, z: 50 });
  stepSimulation(state);
  assert.equal(rhino.frozenByCount, 0, 'Target must unfreeze once all Chronos disengage');
  assert.equal(rhino.eraseProgress, 0, 'eraseProgress must reset to 0 on complete unlock');
  assert.equal(rhino.hp, preFreezeHp, 'Unfrozen tank must retain full pre-freeze HP');

  // 6. Re-lock with c1 + c2 and sustain until full erasure
  for (let i = 0; i < 40; i++) stepSimulation(state); // clear teleport stun
  enqueueCommand(state, { playerId: 0, type: 'ATTACK', entityIds: [c1.id, c2.id], targetId: rhino.id });
  let erasedEvent = false;
  let explosionEvent = false;
  for (let i = 0; i < 70 && rhino.alive; i++) {
    stepSimulation(state);
    if (state.events.some((e) => e.type === 'entity:erased' && e.entityId === rhino.id)) erasedEvent = true;
    if (state.events.some((e) => e.type === 'fx:explosion')) explosionEvent = true;
  }
  assert.equal(rhino.alive, false, 'Chrono lock must erase 500 HP tank cleanly');
  assert.equal(erasedEvent, true, 'Chrono erase must emit entity:erased event');
  assert.equal(explosionEvent, false, 'Chrono erase must NOT emit explosion/debris');
  assert.equal(c1.killValue + c2.killValue, 0, 'Chrono erasure must grant 0 XP / killValue');
  assert.equal(c1.veterancy + c2.veterancy, 0, 'Chrono erasure must grant 0 veterancy rank');
}

function testEngineerBridgeAndCrush() {
  const map = compileMap({
    id: 'm3_eng_bridge',
    baseElevation: 1.6,
    seaChannels: [{ x0: 60, z0: 40, x1: 68, z1: 90 }],
    bridges: [{ id: 'center_br', x0: 59, z0: 60, x1: 69, z1: 62 }],
    cliffs: [],
    orePatches: [],
    spawns: []
  });
  // Break the bridge manually
  const br = map.bridges[0];
  br.intact = false;
  for (let i = 0; i < br.cells.length; i++) {
    map.terrain[br.cells[i]] = TERRAIN.BROKEN_BRIDGE;
  }

  const state = createGameState({ map, populateDefault: false, startingCredits: 1000 });
  const engBridge = spawnEntity(state, {
    typeId: 'engineer',
    playerId: 0,
    teamId: 0,
    factionId: 'abyssal',
    x: (br.x0 - 1) * 2,
    z: 61 * 2 + 1
  });
  const derrick = spawnEntity(state, {
    typeId: 'oil_derrick',
    playerId: -1,
    teamId: 3,
    factionId: 'neutral',
    gx: 40,
    gz: 60
  });
  const engOil = spawnEntity(state, {
    typeId: 'engineer',
    playerId: 0,
    teamId: 0,
    factionId: 'abyssal',
    x: derrick.x - 3,
    z: derrick.z
  });

  // Apocalypse crush check: crushes conscript, spares tesla_trooper (antiCrush) & deployed gi
  const apoc = spawnEntity(state, { typeId: 'apocalypse', playerId: 1, teamId: 1, factionId: 'crimson', x: 90, z: 120 });
  const conscript = spawnEntity(state, { typeId: 'conscript', playerId: 0, teamId: 0, factionId: 'abyssal', x: 90, z: 120 });
  const tesla = spawnEntity(state, { typeId: 'tesla_trooper', playerId: 0, teamId: 0, factionId: 'abyssal', x: 90, z: 120.5 });
  const gi = spawnEntity(state, { typeId: 'gi', playerId: 0, teamId: 0, factionId: 'abyssal', x: 90, z: 120.8 });
  deployEntity(state, gi);

  rebuildTeamFogGrids(state);
  enqueueCommand(state, { playerId: 0, type: 'ATTACK', entityIds: [engOil.id], targetId: derrick.id });

  stepSimulation(state);
  assert.equal(br.intact, true, 'Engineer adjacent to broken bridge must restore br.intact = true');
  assert.equal(map.terrain[br.cells[0]], TERRAIN.BRIDGE, 'Broken bridge cells must revert to TERRAIN.BRIDGE');
  assert.equal(derrick.playerId, 0, 'Engineer must capture neutral oil_derrick');
  assert.equal(state.players[0].credits, 1500, 'Capturing oil_derrick must immediately award +$500');
  assert.equal(conscript.alive, false, 'Apocalypse must crush regular infantry (conscript)');
  assert.equal(tesla.alive, true, 'Apocalypse must NOT crush antiCrush tesla_trooper');
  assert.equal(gi.alive, true, 'Apocalypse must NOT crush deployed sandbag GI');

  for (let i = 0; i < 120; i++) stepSimulation(state);
  assert.equal(state.players[0].credits, 1540, 'Owned oil_derrick must pay +$40 every 120 ticks');
}

function testPrismRefractionAndV3AndIfv() {
  const map = createFlatTestMap('m3_prism_v3_ifv');
  const state = createGameState({ map, populateDefault: false });

  // 1. 10 Prism convergence against target + secondary: exact 0.7^(k-3) decay & <= 128 cap
  const prisms = [];
  for (let i = 0; i < 10; i++) {
    prisms.push(spawnEntity(state, {
      typeId: 'prism',
      playerId: 0,
      teamId: 0,
      factionId: 'abyssal',
      x: 40 + (i % 5) * 3,
      z: 40 + Math.floor(i / 5) * 3
    }));
  }
  const primary = spawnEntity(state, { typeId: 'apocalypse', playerId: 1, teamId: 1, factionId: 'crimson', x: 52, z: 50 });
  const secondary = spawnEntity(state, { typeId: 'apocalypse', playerId: 1, teamId: 1, factionId: 'crimson', x: 55, z: 50 });
  // Give high temporary HP so neither dies in 1 volley and we measure exact split damage
  primary.maxHp = 5000; primary.hp = 5000;
  secondary.maxHp = 5000; secondary.hp = 5000;

  rebuildTeamFogGrids(state);
  enqueueCommand(state, {
    playerId: 0,
    type: 'ATTACK',
    entityIds: prisms.map((p) => p.id),
    targetId: primary.id
  });
  stepSimulation(state);

  const secDamageTaken = 5000 - secondary.hp;
  const prismMult = getArmorMultiplier('Prism', secondary, prisms[0]);
  const splitRaw = ENTITY_DEFS.prism.weapon.damage * 0.55;
  let expectedDecayFactor = 0;
  for (let k = 1; k <= 10; k++) {
    expectedDecayFactor += k <= 3 ? 1.0 : Math.pow(0.7, k - 3);
  }
  const expectedSecDmg = splitRaw * prismMult * expectedDecayFactor;
  assert.ok(
    Math.abs(secDamageTaken - expectedSecDmg) < 0.05,
    `10-Prism secondary damage (${secDamageTaken.toFixed(2)}) must match 0.7^(k-3) decay (${expectedSecDmg.toFixed(2)})`
  );

  // Also test global 128 split cap with 30 Prisms hitting 1 primary + 6 secondaries
  const stateCap = createGameState({ map, populateDefault: false });
  for (let i = 0; i < 30; i++) {
    const p = spawnEntity(stateCap, {
      typeId: 'prism',
      playerId: 0,
      teamId: 0,
      factionId: 'abyssal',
      x: 40 + (i % 6) * 2.5,
      z: 40 + Math.floor(i / 6) * 2.5
    });
    p.attackTargetId = null;
  }
  const priCap = spawnEntity(stateCap, { typeId: 'conyard', playerId: 1, teamId: 1, factionId: 'crimson', gx: 28, gz: 28 });
  priCap.hp = 50000; priCap.maxHp = 50000;
  for (let s = 0; s < 6; s++) {
    const sub = spawnEntity(stateCap, {
      typeId: 'rhino',
      playerId: 1,
      teamId: 1,
      factionId: 'crimson',
      x: priCap.x + (s - 2.5) * 1.6,
      z: priCap.z + 4
    });
    sub.hp = 5000; sub.maxHp = 5000;
  }
  rebuildTeamFogGrids(stateCap);
  const attackerIds = stateCap.entities.filter((e) => e.playerId === 0).map((e) => e.id);
  enqueueCommand(stateCap, { playerId: 0, type: 'ATTACK', entityIds: attackerIds, targetId: priCap.id });
  stepSimulation(stateCap);
  const splitBeams = stateCap.events.filter(
    (e) => e.type === 'combat:fire' && e.attackerTypeId === 'prism' && e.targetId !== priCap.id
  ).length;
  assert.equal(splitBeams, 128, `30x5=150 prism splits must clamp strictly to <= 128/tick, got ${splitBeams}`);

  // 2. V3 fires rocket, launcher dies immediately -> rocket stays airborne & releases pendingDamage once on impact
  const v3State = createGameState({ map, populateDefault: false });
  const v3 = spawnEntity(v3State, { typeId: 'v3', playerId: 1, teamId: 1, factionId: 'crimson', x: 60, z: 60 });
  const target = spawnEntity(v3State, { typeId: 'conyard', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 35, gz: 28 }); // 14m away (within v3 sight 16m & range 34m)
  rebuildTeamFogGrids(v3State);
  enqueueCommand(v3State, { playerId: 1, type: 'ATTACK', entityIds: [v3.id], targetId: target.id });
  stepSimulation(v3State);
  assert.equal(v3State.projectiles.length, 1, 'V3 must launch interceptable rocket');
  const reserved = target.pendingDamage;
  assert.ok(reserved > 0, 'Target must hold pendingDamage reservation while V3 rocket is in flight');

  // Destroy V3 launcher immediately mid-flight
  removeEntity(v3State, v3.id, 'destroyed');
  stepSimulation(v3State);
  assert.equal(target.pendingDamage, reserved, 'Destroying V3 launcher must NOT prematurely release mid-flight pendingDamage');

  // Step until rocket lands
  for (let i = 0; i < 60 && v3State.projectiles.length > 0; i++) stepSimulation(v3State);
  assert.equal(v3State.projectiles.length, 0, 'Orphan V3 rocket must still complete flight and impact');
  assert.equal(target.pendingDamage, 0, 'Impact must release V3 pendingDamage cleanly to 0');
  assert.ok(target.hp < target.maxHp, 'Target must receive V3 impact damage');

  // 3. IFV boarding engineer enters repair mode and DEPLOY unloads cleanly
  const ifvState = createGameState({ map, populateDefault: false });
  const ifv = spawnEntity(ifvState, { typeId: 'ifv', playerId: 0, teamId: 0, factionId: 'abyssal', x: 60, z: 60 });
  const eng = spawnEntity(ifvState, { typeId: 'engineer', playerId: 0, teamId: 0, factionId: 'abyssal', x: 61, z: 60 });
  const hurtTank = spawnEntity(ifvState, { typeId: 'grizzly', playerId: 0, teamId: 0, factionId: 'abyssal', x: 65, z: 60 });
  hurtTank.hp = 150;
  boardTransport(ifvState, ifv, eng);
  assert.equal(ifv.cargoList[0]?.typeId, 'engineer', 'IFV must adopt engineer repair mode on boarding');
  for (let i = 0; i < 15; i++) stepSimulation(ifvState);
  assert.ok(hurtTank.hp > 150, `Engineer-IFV must repair nearby damaged friendly vehicle (hp=${hurtTank.hp})`);
  deployEntity(ifvState, ifv);
  assert.equal(eng.alive, true, 'DEPLOY on IFV must unload engineer onto passable land');
  assert.equal(ifv.cargoList.length, 0, 'Unloaded IFV must clear cargoList');
}

function testAirforceDualProducers() {
  const map = createFlatTestMap('m3_air_producers');
  const state = createGameState({ map, populateDefault: false, startingCredits: 20000, fastBuild: true });

  spawnEntity(state, { typeId: 'conyard', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 40, gz: 40 });
  spawnEntity(state, { typeId: 'power_plant', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 36, gz: 40 });
  spawnEntity(state, { typeId: 'power_plant', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 36, gz: 43 });
  spawnEntity(state, { typeId: 'barracks', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 45, gz: 40 });
  const wf = spawnEntity(state, { typeId: 'war_factory', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 40, gz: 46 });
  const radar = spawnEntity(state, { typeId: 'airforce_radar', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 46, gz: 46 });
  spawnEntity(state, { typeId: 'battle_lab', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 52, gz: 46 });

  stepProductionAndPower(state);
  assert.equal(startProduction(state, 0, 'air', 'stormhawk', 1), true);
  assert.equal(startProduction(state, 0, 'air', 'nighthawk', 1), true);

  // Advance 2 ticks then destroy airforce_radar -> stormhawk (airforce_radar) pauses, nighthawk (war_factory) finishes!
  stepSimulation(state);
  stepSimulation(state);
  removeEntity(state, radar.id, 'destroyed');

  let nighthawkUnit = null;
  for (let i = 0; i < 60; i++) {
    stepSimulation(state);
    if (!nighthawkUnit) {
      nighthawkUnit = state.entities.find((e) => e.alive && e.typeId === 'nighthawk') ?? null;
    }
  }
  const stormQueue = state.players[0].queues.air_naval[0];
  assert.equal(stormQueue.typeId, 'stormhawk');
  assert.equal(stormQueue.status, 'PAUSED', 'Destroying all airforce_radars must pause stormhawk production');
  assert.ok(nighthawkUnit !== null, 'Destroying airforce_radar must NOT block war_factory nighthawk production');
  assert.ok(Math.hypot(nighthawkUnit.x - wf.x, nighthawkUnit.z - wf.z) < 6, 'Nighthawk must lift off from war_factory roof');

  // Switch player 0 faction to crimson temporarily to test Kirov global warning & war_factory spawn
  state.players[0].factionId = 'crimson';
  assert.equal(startProduction(state, 0, 'air', 'kirov', 1), true);
  let kirovAlert = false;
  for (let i = 0; i < 80; i++) {
    stepSimulation(state);
    if (state.events.some((e) => e.type === 'hud:notice' && e.key === 'hud.status.kirovReporting')) {
      kirovAlert = true;
    }
  }
  const kirov = state.entities.find((e) => e.alive && e.typeId === 'kirov');
  assert.ok(kirov, 'Kirov must finish producing from war_factory even without airforce_radar');
  assert.equal(kirovAlert, true, 'Kirov spawn must emit hud.status.kirovReporting global notice');
}

function testNavalAegisVsKirovAndCarrierOrphanDrones() {
  const map = createFlatTestMap('m3_naval_test', true);
  const state = createGameState({ map, populateDefault: false });

  // 1. Aegis solos 2000 HP Kirov in <= 10 salvos and <= 150 ticks (5.0s)
  const aegisX = gridToWorldCenter(85);
  const aegisZ = gridToWorldCenter(70);
  const kirovX = gridToWorldCenter(91); // 12m apart (<= 19m Aegis range)
  const kirovZ = gridToWorldCenter(70);
  const aegis = spawnEntity(state, {
    typeId: 'aegis',
    playerId: 0,
    teamId: 0,
    factionId: 'abyssal',
    x: aegisX,
    z: aegisZ
  });
  const kirov = spawnEntity(state, {
    typeId: 'kirov',
    playerId: 1,
    teamId: 1,
    factionId: 'crimson',
    x: kirovX,
    z: kirovZ
  });
  rebuildTeamFogGrids(state);

  let salvosFired = 0;
  let killTicks = 0;
  for (let t = 1; t <= 160 && kirov.alive; t++) {
    stepSimulation(state);
    salvosFired += state.events.filter((e) => e.type === 'combat:fire' && e.attackerId === aegis.id).length;
    if (!kirov.alive) killTicks = t;
  }
  assert.equal(kirov.alive, false, 'Aegis must shoot down Kirov');
  assert.ok(salvosFired <= 10, `Aegis must kill 2000 HP Kirov in <= 10 salvos, took ${salvosFired}`);
  assert.ok(killTicks > 0 && killTicks <= 150, `Aegis must kill Kirov within <= 5.0s (150 ticks), took ${killTicks} ticks`);

  // 2. Carrier launches drones, then Carrier is sunk mid-flight -> orphan drones crash & cleanly release pendingDamage
  const carrierX = gridToWorldCenter(80);
  const carrierZ = gridToWorldCenter(90);
  const dreadX = gridToWorldCenter(90); // 20m apart (within Carrier 24m sight & 38m range)
  const dreadZ = gridToWorldCenter(90);
  const carrier = spawnEntity(state, {
    typeId: 'carrier',
    playerId: 0,
    teamId: 0,
    factionId: 'abyssal',
    x: carrierX,
    z: carrierZ
  });
  const dread = spawnEntity(state, {
    typeId: 'dreadnought',
    playerId: 1,
    teamId: 1,
    factionId: 'crimson',
    x: dreadX,
    z: dreadZ
  });
  rebuildTeamFogGrids(state);

  // Launch 2 drones over ~18 ticks
  for (let t = 0; t < 18; t++) stepSimulation(state);
  const launchedCount = carrier.drones.filter((d) => d.fsmState !== 'D_DOCKED').length;
  assert.ok(launchedCount >= 2, `Expected >= 2 drones launched by Carrier, got ${launchedCount}`);
  assert.ok(dread.pendingDamage > 0, 'Launched drones must reserve pendingDamage on target Dreadnought');

  // Sink carrier immediately and cap remaining fuel low to verify fuel depletion crash path deterministically
  removeEntity(state, carrier.id, 'destroyed');
  assert.ok(state.orphanDrones.length >= 2, 'Destroying carrier must move airborne drones to state.orphanDrones');
  for (let i = 0; i < state.orphanDrones.length; i++) {
    state.orphanDrones[i].fuelTicks = Math.min(state.orphanDrones[i].fuelTicks, 6);
  }
  for (let t = 0; t < 20; t++) stepSimulation(state);
  assert.equal(state.orphanDrones.length, 0, 'All orphan carrier drones must crash once fuel expires');
  assert.equal(state.projectiles.length, 0, 'No orphan bombs should remain');
  assert.ok(dread.pendingDamage >= 0, 'Target pendingDamage must never go negative');
  assert.equal(dread.pendingDamage, 0, 'Orphan drone crash must idempotently release all reserved pendingDamage to 0');
}

function runAll() {
  testChronoLegionnaireFreezeAndErase();
  testEngineerBridgeAndCrush();
  testPrismRefractionAndV3AndIfv();
  testAirforceDualProducers();
  testNavalAegisVsKirovAndCarrierOrphanDrones();
  console.log('test-m3: ALL M3 SIMULATION GATES PASSED (Chrono/Engineer/Prism/V3/IFV/Airforce/Aegis/Carrier).');
}

runAll();
