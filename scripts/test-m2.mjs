import assert from 'node:assert/strict';

import { ENTITY_DEFS, getArmorMultiplier } from '../src/core/config.js';
import { createGameState, stepSimulation } from '../src/core/engine.js';
import { applyDamage } from '../src/gameplay/combat.js';
import { rebuildTeamFogGrids } from '../src/gameplay/fogCpu.js';
import { spawnEntity } from '../src/gameplay/entities.js';
import { validateBuildingPlacement } from '../src/gameplay/production.js';
import { createDebrisSystem, spawnBuildingDebris, stepDebrisSystem } from '../src/world/destruction.js';
import { MAP_SIZE, TERRAIN, compileMap, gridToWorldCenter } from '../src/world/map.js';

function createFlatTestMap(id) {
  return compileMap({
    id,
    baseElevation: 1.6,
    seaChannels: [],
    bridges: [],
    cliffs: [],
    orePatches: [],
    spawns: []
  });
}

function paintSeaRect(map, gx0, gz0, w, h) {
  for (let dz = 0; dz < h; dz++) {
    for (let dx = 0; dx < w; dx++) {
      const idx = (gz0 + dz) * MAP_SIZE + (gx0 + dx);
      map.terrain[idx] = TERRAIN.SEA;
      map.elevation[idx] = -1.2;
    }
  }
}

function testNavalYardOpenSeaValidation() {
  const map = createFlatTestMap('m2_naval_test');
  // Open sea bay: 10x10 (100 cells >= 24)
  paintSeaRect(map, 60, 60, 10, 10);
  // Isolated tiny pond: 4x4 (16 cells < 24) surrounded by LAND
  paintSeaRect(map, 26, 60, 4, 4);

  const state = createGameState({ map, populateDefault: false });
  spawnEntity(state, {
    typeId: 'conyard',
    playerId: 0,
    teamId: 0,
    factionId: 'abyssal',
    gx: 52,
    gz: 60
  });
  spawnEntity(state, {
    typeId: 'power_plant',
    playerId: 0,
    teamId: 0,
    factionId: 'abyssal',
    gx: 20,
    gz: 60
  });

  const okSea = validateBuildingPlacement(state, 0, 'naval_yard', 62, 62);
  assert.equal(okSea.valid, true, `Expected naval_yard on open sea to pass, got: ${okSea.reason}`);

  const landFail = validateBuildingPlacement(state, 0, 'naval_yard', 46, 60);
  assert.equal(landFail.valid, false, 'Expected naval_yard on LAND to fail');

  const puddleFail = validateBuildingPlacement(state, 0, 'naval_yard', 26, 60);
  assert.equal(puddleFail.valid, false, 'Expected naval_yard in <24-cell enclosed puddle to fail');
  assert.equal(puddleFail.reason, 'requires_open_sea');

  console.log('[test-m2] naval_yard open-sea connectivity validation passed.');
}

function testLowPowerDefenseTowers() {
  const map = createFlatTestMap('m2_low_power_test');
  const state = createGameState({ map, populateDefault: false });

  // Player 0 power deficit: +100 produced vs 150 consumed -> isLowPower === true
  spawnEntity(state, { typeId: 'conyard', playerId: 0, teamId: 0, factionId: 'crimson', gx: 12, gz: 12 });
  spawnEntity(state, { typeId: 'power_plant', playerId: 0, teamId: 0, factionId: 'crimson', gx: 17, gz: 12 });

  // Place towers >= 45m apart so targets do not cross-trigger neighboring towers
  spawnEntity(state, { typeId: 'pillbox', playerId: 0, teamId: 0, factionId: 'crimson', gx: 30, gz: 30 });
  const dummy1 = spawnEntity(state, {
    typeId: 'mcv', playerId: 1, teamId: 1, factionId: 'abyssal',
    x: gridToWorldCenter(30) + 9.0, z: gridToWorldCenter(30)
  });

  spawnEntity(state, { typeId: 'prism_tower', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 80, gz: 30 });
  const dummy2 = spawnEntity(state, {
    typeId: 'mcv', playerId: 1, teamId: 1, factionId: 'abyssal',
    x: gridToWorldCenter(80) + 10.0, z: gridToWorldCenter(30)
  });

  const tesla = spawnEntity(state, { typeId: 'tesla_coil', playerId: 0, teamId: 0, factionId: 'crimson', gx: 130, gz: 30 });
  const dummy3 = spawnEntity(state, {
    typeId: 'mcv', playerId: 1, teamId: 1, factionId: 'abyssal',
    x: gridToWorldCenter(130) + 10.0, z: gridToWorldCenter(30)
  });

  for (let t = 0; t < 45; t++) stepSimulation(state);

  assert.equal(state.players[0].isLowPower, true, 'Player 0 should be in low-power deficit');
  assert.ok(dummy1.hp < dummy1.maxHp, 'pillbox must continue firing during low power');
  assert.equal(dummy2.hp, dummy2.maxHp, 'prism_tower must go offline during low power');
  assert.equal(dummy3.hp, dummy3.maxHp, 'tesla_coil without tesla_troopers must stay offline during low power');

  // Place 2 friendly tesla_troopers within 4.5m of tesla_coil center to overcharge it
  spawnEntity(state, {
    typeId: 'tesla_trooper', playerId: 0, teamId: 0, factionId: 'crimson',
    x: tesla.x - 2.5, z: tesla.z
  });
  spawnEntity(state, {
    typeId: 'tesla_trooper', playerId: 0, teamId: 0, factionId: 'crimson',
    x: tesla.x, z: tesla.z - 2.5
  });

  for (let t = 0; t < 45; t++) stepSimulation(state);
  assert.ok(dummy3.hp < dummy3.maxHp, 'tesla_coil overcharged by >= 2 tesla_troopers must fire even at low power');

  console.log('[test-m2] Low-power defense tower rules (pillbox / prism_tower / tesla_coil overcharge) passed.');
}

function testPrismTowerConvergence() {
  const runPrismShot = (supportCount) => {
    const map = createFlatTestMap('m2_prism_conv');
    const state = createGameState({ map, populateDefault: false });

    // Generous power
    for (let i = 0; i < 4; i++) {
      spawnEntity(state, { typeId: 'power_plant', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 10 + i * 3, gz: 10 });
    }

    const primary = spawnEntity(state, {
      typeId: 'prism_tower', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 50, gz: 50
    });
    // Support towers placed east/south within 12.0m of primary, out of range of target to the west
    if (supportCount >= 1) {
      spawnEntity(state, { typeId: 'prism_tower', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 54, gz: 50 });
    }
    if (supportCount >= 2) {
      spawnEntity(state, { typeId: 'prism_tower', playerId: 0, teamId: 0, factionId: 'abyssal', gx: 50, gz: 54 });
    }

    const prismRange = ENTITY_DEFS.prism_tower.weapon.range;
    const target = spawnEntity(state, {
      typeId: 'mcv', playerId: 1, teamId: 1, factionId: 'crimson',
      x: primary.x - (prismRange - 1.5),
      z: primary.z
    });

    const hpBefore = target.hp;
    rebuildTeamFogGrids(state);
    stepSimulation(state);
    return {
      dealt: hpBefore - target.hp,
      target,
      primary
    };
  };

  const solo = runPrismShot(0);
  const converged = runPrismShot(2);
  const expectedConverged = Math.round(
    ENTITY_DEFS.prism_tower.weapon.damage * 2.0 * getArmorMultiplier('Prism', converged.target, converged.primary)
  );

  assert.ok(solo.dealt > 0, 'Solo prism_tower must deal damage');
  assert.equal(converged.dealt, expectedConverged, `Expected 2-support prism convergence damage ${expectedConverged}, got ${converged.dealt}`);
  assert.equal(converged.dealt, solo.dealt * 2, '2 support towers (+50% each) must yield exactly 200% damage');

  console.log(`[test-m2] prism_tower beam convergence (${solo.dealt} -> ${converged.dealt}) passed.`);
}

function testNuclearReactorMeltdown() {
  const map = createFlatTestMap('m2_reactor_meltdown');
  const state = createGameState({ map, populateDefault: false });

  const reactor = spawnEntity(state, {
    typeId: 'nuclear_reactor', playerId: 1, teamId: 1, factionId: 'crimson', gx: 60, gz: 60
  });
  const bystander = spawnEntity(state, {
    typeId: 'mcv', playerId: 0, teamId: 0, factionId: 'abyssal',
    x: reactor.x + 5.0, z: reactor.z
  });

  const initialHp = bystander.hp;
  applyDamage(state, reactor, 99999, 'APShell');
  assert.equal(reactor.alive, false);

  const hpAfterBlast = bystander.hp;
  assert.ok(hpAfterBlast < initialHp, 'nuclear_reactor explosion must deal immediate thermal blast damage');

  const rad = state.areaEffects.find((e) => e.type === 'radiation');
  assert.ok(rad, 'nuclear_reactor destruction must register a radiation areaEffect');

  for (let t = 0; t < 45; t++) stepSimulation(state);
  assert.ok(bystander.hp < hpAfterBlast, 'radiation areaEffect must inflict ongoing damage to units inside radius');

  console.log('[test-m2] nuclear_reactor meltdown blast & radiation areaEffect test passed.');
}

function testDestructionDeterminismAndRngIsolation() {
  const poolA = createDebrisSystem(256);
  const poolB = createDebrisSystem(256);

  spawnBuildingDebris(poolA, 42, 315, 128.5, 1.6, 144.2, 4, 4, 1.0);
  spawnBuildingDebris(poolB, 42, 315, 128.5, 1.6, 144.2, 4, 4, 1.0);
  assert.equal(poolA.chunks.length, poolB.chunks.length);
  assert.ok(poolA.chunks.length >= 6);

  for (let f = 0; f < 60; f++) {
    stepDebrisSystem(poolA, 1 / 60);
    stepDebrisSystem(poolB, 1 / 60);
  }
  assert.deepEqual(poolA.chunks, poolB.chunks, 'Two debris simulations with identical seed & quality must be bit-identical');

  // Verify zero mutation to gameplay prngState across 1000 combat ticks
  const runCombatSim = (enableVisualDebris) => {
    const map = createFlatTestMap('m2_rng_iso');
    const state = createGameState({ map, populateDefault: false, seed: 0x1234abcd });
    const debris = createDebrisSystem(128);

    for (let i = 0; i < 4; i++) {
      spawnEntity(state, { typeId: 'grizzly', playerId: 0, teamId: 0, factionId: 'abyssal', x: 96, z: 110 + i * 5 });
      spawnEntity(state, { typeId: 'rhino', playerId: 1, teamId: 1, factionId: 'crimson', x: 114, z: 110 + i * 5 });
    }

    for (let tick = 0; tick < 1000; tick++) {
      stepSimulation(state);
      if (enableVisualDebris) {
        if (tick === 20 || tick === 150) {
          spawnBuildingDebris(debris, 900 + tick, state.tickCount, 100, 1.6, 100, 3, 3, 1.0);
        }
        stepDebrisSystem(debris, 1 / 30);
      }
    }

    return {
      prngState: state.prngState,
      entities: state.entities.map((e) => ({ id: e.id, alive: e.alive, hp: e.hp, x: e.x, z: e.z }))
    };
  };

  const baseline = runCombatSim(false);
  const withDebris = runCombatSim(true);

  assert.equal(withDebris.prngState, baseline.prngState, 'Debris pool must never advance state.prngState');
  assert.deepEqual(withDebris.entities, baseline.entities, 'Debris pool must produce 0 gameplay divergence over 1000 ticks');

  console.log('[test-m2] destruction.js determinism & 1000-tick RNG isolation passed.');
}

testNavalYardOpenSeaValidation();
testLowPowerDefenseTowers();
testPrismTowerConvergence();
testNuclearReactorMeltdown();
testDestructionDeterminismAndRngIsolation();
console.log('[test-m2] ALL M2 SIMULATION GATES PASSED.');
