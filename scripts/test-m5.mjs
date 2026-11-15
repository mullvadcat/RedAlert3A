// Milestone 5 Gate Verification:
// T5.1: Complete state serialization/deserialization & bit-for-bit determinism after restore + separate profile unlock store
// T5.2: Declarative Director Engine (onCapture, cameraPan 3s -> cameraReturn, dialogue, checkpoint, choicePrompt)
// T5.3 & T5.4: All 13 Campaign Missions (A01..A06, C01..C06, EX13), progression graph, EX13 dual-faction & 4 superweapons

import assert from 'node:assert/strict';
import { createGameState, enqueueCommand, stepSimulation } from '../src/core/engine.js';
import {
  SAVE_SCHEMA_VERSION,
  computeUnlockedMissions,
  createDefaultCampaignProfile,
  isMissionUnlocked,
  loadCampaignProfile,
  loadCheckpointFromDb,
  migrateCampaignProfile,
  recordMissionVictory,
  restoreCheckpoint,
  saveCampaignProfile,
  saveCheckpointToDb,
  serializeCheckpoint
} from '../src/core/save.js';
import { FOG_EXPLORED } from '../src/gameplay/fogCpu.js';
import { startProduction } from '../src/gameplay/production.js';
import { CAMPAIGN_MISSIONS } from '../src/story/campaigns/index.js';
import { resolveDirectorChoice } from '../src/story/director.js';
import { MAP_SIZE, TERRAIN } from '../src/world/map.js';
import ZH_CN from '../src/locales/zh-CN.js';
import EN_US from '../src/locales/en-US.js';

function testT51SaveDeterminismAndSeparation() {
  const state = createGameState({
    mode: 'skirmish',
    seed: 0x51a7e001,
    fastBuild: true
  });

  for (let i = 0; i < 180; i++) {
    stepSimulation(state);
  }

  // Exercise non-trivial transient & gameplay edge states
  state.players[0].credits = 4321;
  state.players[0].doctrines.airdrop_paratroopers = { ready: false, remainingTicks: 333, totalTicks: 1800 };
  state.players[0].superweapons.chrono_sphere = { ready: false, remainingTicks: 777, totalTicks: 7200 };
  if (state.map.orePillars.length > 0) {
    state.map.orePillars[0].nextRegenTick = state.tickCount + 123;
  }
  const bridgeTile = 120 * MAP_SIZE + 120;
  state.map.terrain[bridgeTile] = TERRAIN.BROKEN_BRIDGE;
  state.map.oreAmount[bridgeTile] = 0;

  const tank = state.entities.find((e) => e.alive && e.playerId === 0 && e.category === 'vehicle');
  if (tank) {
    tank.eraseProgress = 42;
    tank.frozenByCount = 1;
    tank.ironCurtainTicks = 90;
    tank.empTicks = 15;
    tank.pendingDamage = 18;
  }

  state.areaEffects.push({
    id: state.nextAreaEffectId++,
    kind: 'radiation',
    playerId: 1,
    teamId: 1,
    x: 260,
    z: 260,
    radius: 14,
    remainingTicks: 120,
    damagePerTick: 2
  });

  state.projectiles.push({
    id: state.nextProjectileId++,
    sourceId: tank ? tank.id : 1,
    playerId: 0,
    teamId: 0,
    x: 200,
    y: 4,
    z: 200,
    prevX: 199,
    prevY: 4,
    prevZ: 200,
    vx: 10,
    vy: 0,
    vz: 0,
    targetId: null,
    targetX: 240,
    targetY: 2,
    targetZ: 200,
    damage: 45,
    damageType: 'AP',
    splashRadius: 0,
    reservedDamage: 0,
    ttlTicks: 30,
    isMissile: false,
    isHoming: false
  });

  const payload = serializeCheckpoint(state, 't51_snap');
  assert.equal(payload.schemaVersion, SAVE_SCHEMA_VERSION);

  // Full JSON round-trip (as IndexedDB structured/string payload)
  const raw = JSON.parse(JSON.stringify(payload));
  const restored = restoreCheckpoint(raw);

  assert.equal(restored.tickCount, state.tickCount);
  assert.equal(restored.prngState, state.prngState);
  assert.equal(restored.nextEntityId, state.nextEntityId);
  assert.equal(restored.nextProjectileId, state.nextProjectileId);
  assert.equal(restored.nextAreaEffectId, state.nextAreaEffectId);
  assert.equal(restored.players[0].credits, 4321);
  assert.equal(restored.players[0].doctrines.airdrop_paratroopers.remainingTicks, 333);
  assert.equal(restored.players[0].superweapons.chrono_sphere.remainingTicks, 777);
  assert.equal(restored.map.terrain[bridgeTile], TERRAIN.BROKEN_BRIDGE);
  assert.equal(restored.areaEffects.length, state.areaEffects.length);
  assert.equal(restored.projectiles.length, state.projectiles.length);
  assert.equal(restored.flowCache.slots.length, 0, 'flowCache must start empty after restore');

  // Verify FOG_EXPLORED bit preserved
  for (let i = 0; i < state.fogGrids[0].length; i++) {
    assert.equal(restored.fogGrids[0][i] & FOG_EXPLORED, state.fogGrids[0][i] & FOG_EXPLORED);
  }

  // Step both original & restored for 600 ticks and confirm zero drift
  for (let i = 0; i < 600; i++) {
    stepSimulation(state);
    stepSimulation(restored);
  }

  assert.equal(restored.tickCount, state.tickCount);
  assert.equal(restored.prngState, state.prngState, 'PRNG must remain bit-identical after restore');
  assert.equal(restored.nextEntityId, state.nextEntityId);
  assert.equal(restored.nextProjectileId, state.nextProjectileId);
  assert.equal(restored.players[0].credits, state.players[0].credits);
  assert.equal(restored.players[1].credits, state.players[1].credits);
  assert.equal(restored.entities.length, state.entities.length);
  for (let i = 0; i < state.entities.length; i++) {
    const a = state.entities[i];
    const b = restored.entities[i];
    assert.equal(b.id, a.id);
    assert.equal(b.alive, a.alive);
    assert.equal(b.hp, a.hp);
    assert.equal(b.x, a.x);
    assert.equal(b.z, a.z);
  }
}

async function testT51ProfileUnlockSeparation() {
  const fresh = createDefaultCampaignProfile();
  assert.deepEqual(fresh.unlockedMissions, ['A01']);
  assert.equal(isMissionUnlocked(fresh, 'EX13'), false);

  const afterA01 = recordMissionVictory(fresh, 'A01', 'normal');
  assert.equal(afterA01.prologueCleared, true);
  assert.ok(afterA01.unlockedMissions.includes('A02'));
  assert.ok(afterA01.unlockedMissions.includes('C01'));
  assert.equal(isMissionUnlocked(afterA01, 'EX13'), false);

  await saveCampaignProfile(afterA01);

  // Saving & loading an earlier A01 in-match checkpoint must not erase external unlock progression
  const earlyState = createGameState({ mode: 'campaign', missionId: 'A01' });
  await saveCheckpointToDb('slot1', earlyState, 'early');
  const loadedCp = await loadCheckpointFromDb('slot1');
  assert.equal(loadedCp.missionId, 'A01');

  const profileAfterCp = await loadCampaignProfile();
  assert.equal(profileAfterCp.prologueCleared, true);
  assert.ok(profileAfterCp.unlockedMissions.includes('C01'));

  // Clear full Abyssal & Crimson tracks -> EX13 unlocks
  let p = afterA01;
  for (const id of ['A02', 'A03', 'A04', 'A05', 'A06']) {
    p = recordMissionVictory(p, id, 'hard');
  }
  assert.equal(isMissionUnlocked(p, 'EX13'), false, 'EX13 must stay locked until Crimson C06 also cleared');
  for (const id of ['C01', 'C02', 'C03', 'C04', 'C05', 'C06']) {
    p = recordMissionVictory(p, id, 'normal');
  }
  assert.equal(isMissionUnlocked(p, 'EX13'), true, 'EX13 must unlock when both A06 & C06 cleared');

  // Verify schema migration safety (incompatible version safely resets; matching schema merges & recomputes unlocks)
  const incompatible = migrateCampaignProfile({ schemaVersion: 99, clearedMissions: { A01: 'easy' } });
  assert.deepEqual(incompatible.unlockedMissions, ['A01']);
  const migrated = migrateCampaignProfile({ schemaVersion: SAVE_SCHEMA_VERSION, clearedMissions: { A01: 'easy' } });
  assert.equal(migrated.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.ok(computeUnlockedMissions(migrated).includes('C01'));
}

function testT52DirectorA01() {
  const state = createGameState({ mode: 'campaign', missionId: 'A01', seed: 101 });
  assert.ok(state.directorState);
  assert.equal(state.directorState.missionId, 'A01');

  let sawIntroDlg = false;
  for (let i = 0; i < 10; i++) {
    stepSimulation(state);
    if (state.events.some((ev) => ev.type === 'director:dialogue' && ev.localeKey === 'campaign.A01.dlgIntro')) {
      sawIntroDlg = true;
    }
  }
  assert.ok(sawIntroDlg, 'A01 intro dialogue must fire at tick 5');

  const eng = state.entities.find((e) => e.alive && e.playerId === 0 && e.typeId === 'engineer');
  const outpost = state.entities.find((e) => e.alive && e.campaignTag === 'a01_outpost');
  assert.ok(eng && outpost, 'A01 must spawn engineer and a01_outpost');
  assert.equal(outpost.playerId, 2);

  // Move engineer adjacent & issue capture order
  eng.x = outpost.x - 4;
  eng.z = outpost.z;
  enqueueCommand(state, {
    type: 'ATTACK',
    playerId: 0,
    entityIds: [eng.id],
    targetId: outpost.id
  });

  let sawPan = false;
  let sawCheckpoint = false;
  let sawChoice = false;
  let sawReturn = false;

  for (let i = 0; i < 200; i++) {
    stepSimulation(state);
    for (const ev of state.events) {
      if (ev.type === 'director:cameraPan') sawPan = true;
      if (ev.type === 'director:checkpoint') sawCheckpoint = true;
      if (ev.type === 'director:choicePrompt') sawChoice = true;
      if (ev.type === 'director:cameraReturn') sawReturn = true;
    }
  }

  assert.equal(outpost.playerId, 0, 'Engineer capture must flip outpost to player 0');
  assert.ok(sawPan, 'onCapture must emit director:cameraPan');
  assert.ok(sawCheckpoint, 'onCapture must trigger checkpoint');
  assert.ok(sawChoice, 'onCapture must emit choicePrompt');
  assert.ok(sawReturn, '3s cameraPan must auto-emit director:cameraReturn');
  assert.equal(state.directorState.activeCutscene, null);

  const preTanks = state.entities.filter((e) => e.alive && e.playerId === 0 && e.typeId === 'grizzly').length;
  resolveDirectorChoice(state, 0);
  const postTanks = state.entities.filter((e) => e.alive && e.playerId === 0 && e.typeId === 'grizzly').length;
  assert.equal(postTanks - preTanks, 3, 'Resolving choice 0 must spawn 3 Grizzly tanks');
}

function testT53T54All13MissionsAndEX13() {
  assert.equal(CAMPAIGN_MISSIONS.length, 13, 'Must ship 13 campaign missions (A01..A06, C01..C06, EX13)');

  for (const m of CAMPAIGN_MISSIONS) {
    assert.ok(ZH_CN[m.titleKey], `Missing zh-CN title for ${m.id}`);
    assert.ok(EN_US[m.titleKey], `Missing en-US title for ${m.id}`);
    assert.ok(ZH_CN[m.briefKey], `Missing zh-CN brief for ${m.id}`);
    assert.ok(EN_US[m.briefKey], `Missing en-US brief for ${m.id}`);

    const st = createGameState({ mode: 'campaign', missionId: m.id, seed: 42 });
    assert.equal(st.missionId, m.id);
    assert.ok(st.directorState, `${m.id} must initialize directorState`);
    assert.ok(st.entities.some((e) => e.alive && e.playerId === 0), `${m.id} must have player 0 entities`);
    assert.ok(st.entities.some((e) => e.alive && e.playerId === 1), `${m.id} must have enemy entities`);

    for (let t = 0; t < 60; t++) {
      stepSimulation(st);
    }
  }

  // EX13 special validation: dual-faction production + 4 independent superweapons
  const ex13 = createGameState({ mode: 'campaign', missionId: 'EX13', seed: 99, fastBuild: true });
  assert.equal(ex13.players[0].allowDualFaction, true, 'EX13 must grant dual-faction tech');
  ex13.players[0].credits = 50000;

  assert.equal(startProduction(ex13, 0, 'vehicle', 'prism'), true, 'EX13 must allow Abyssal Prism Tank');
  assert.equal(startProduction(ex13, 0, 'vehicle', 'apocalypse'), true, 'EX13 must allow Crimson Apocalypse Tank');

  for (let i = 0; i < 60; i++) {
    stepSimulation(ex13);
  }
  for (const sw of ['chrono_sphere', 'iron_curtain', 'weather_control', 'nuclear_silo']) {
    assert.ok(ex13.players[0].superweapons[sw], `EX13 must have ${sw}`);
    assert.equal(ex13.players[0].superweapons[sw].remainingTicks, 0, `${sw} must be ready after EX13 intro`);
  }

  // Fire all 4 superweapons across distinct targets without key conflict
  enqueueCommand(ex13, { type: 'FIRE_SUPERWEAPON', playerId: 0, typeId: 'iron_curtain', x: 112, z: 112 });
  enqueueCommand(ex13, { type: 'FIRE_SUPERWEAPON', playerId: 0, typeId: 'chrono_sphere', sourceX: 112, sourceZ: 112, x: 200, z: 200 });
  enqueueCommand(ex13, { type: 'FIRE_SUPERWEAPON', playerId: 0, typeId: 'weather_control', x: 370, z: 370 });
  enqueueCommand(ex13, { type: 'FIRE_SUPERWEAPON', playerId: 0, typeId: 'nuclear_silo', x: 380, z: 380 });
  for (let i = 0; i < 15; i++) {
    stepSimulation(ex13);
  }
  assert.ok(ex13.players[0].superweapons.iron_curtain.remainingTicks > 0, 'iron_curtain must reset cooldown');
  assert.ok(ex13.players[0].superweapons.chrono_sphere.remainingTicks > 0, 'chrono_sphere must reset cooldown');
  assert.ok(ex13.players[0].superweapons.weather_control.remainingTicks > 0, 'weather_control must reset cooldown');
  assert.ok(ex13.players[0].superweapons.nuclear_silo.remainingTicks > 0, 'nuclear_silo must reset cooldown');
  // Step enough ticks for warning strikes to resolve
  for (let i = 0; i < 200; i++) {
    stepSimulation(ex13);
  }
}

async function main() {
  testT51SaveDeterminismAndSeparation();
  await testT51ProfileUnlockSeparation();
  testT52DirectorA01();
  testT53T54All13MissionsAndEX13();
  console.log('ALL M5 TESTS PASSED (T5.1-T5.4: Save Determinism, Director Engine, 13 Missions & EX13 Dual-Tech)');
}

main();
