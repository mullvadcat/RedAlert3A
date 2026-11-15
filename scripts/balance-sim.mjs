import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createGameState, enqueueCommand, stepSimulation } from '../src/core/engine.js';
import { spawnEntity } from '../src/gameplay/entities.js';
import { rebuildTeamFogGrids } from '../src/gameplay/fogCpu.js';
import { compileMap } from '../src/world/map.js';
import { SKIRMISH_MAPS } from '../src/world/skirmishMaps.js';

function runMicroDuel(label, teamASpec, teamBSpec, maxTicks = 1200) {
  const flatMap = compileMap({
    id: `micro_${label}`,
    seed: 9001,
    baseElevation: 1.6,
    seaChannels: [{ type: 'strait_x', centerX: 200, halfWidth: 20, zMin: 0, zMax: 255, shallowMargin: 4 }],
    bridges: [],
    cliffs: [],
    orePatches: [],
    spawns: [
      { playerId: 0, teamId: 0, factionId: 'abyssal', gx: 40, gz: 60 },
      { playerId: 1, teamId: 1, factionId: 'crimson', gx: 100, gz: 60 }
    ]
  });

  const state = createGameState({
    map: flatMap,
    populateDefault: false,
    disableAI: true
  });

  const aUnits = [];
  for (let i = 0; i < teamASpec.count; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    aUnits.push(
      spawnEntity(state, {
        typeId: teamASpec.typeId,
        playerId: 0,
        teamId: 0,
        factionId: 'abyssal',
        x: teamASpec.x + col * 3.5,
        z: teamASpec.z + row * 3.5
      })
    );
  }
  const bUnits = [];
  for (let i = 0; i < teamBSpec.count; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    bUnits.push(
      spawnEntity(state, {
        typeId: teamBSpec.typeId,
        playerId: 1,
        teamId: 1,
        factionId: 'crimson',
        x: teamBSpec.x - col * 3.5,
        z: teamBSpec.z + row * 3.5
      })
    );
  }
  rebuildTeamFogGrids(state);

  const midX = (teamASpec.x + teamBSpec.x) * 0.5;
  enqueueCommand(state, {
    playerId: 0,
    type: 'ATTACK_MOVE',
    entityIds: aUnits.map((u) => u.id),
    x: midX,
    z: teamASpec.z
  });
  enqueueCommand(state, {
    playerId: 1,
    type: 'ATTACK_MOVE',
    entityIds: bUnits.map((u) => u.id),
    x: midX,
    z: teamBSpec.z
  });

  for (let t = 0; t < maxTicks; t++) {
    stepSimulation(state);
    const aAlive = aUnits.filter((u) => u.alive).length;
    const bAlive = bUnits.filter((u) => u.alive).length;
    if (aAlive === 0 || bAlive === 0) break;
  }

  const aSurvivors = aUnits.filter((u) => u.alive).length;
  const bSurvivors = bUnits.filter((u) => u.alive).length;
  console.log(
    `[balance:micro] ${label}: A(${teamASpec.count}x ${teamASpec.typeId})=${aSurvivors} vs B(${teamBSpec.count}x ${teamBSpec.typeId})=${bSurvivors} at tick ${state.tickCount}`
  );
  return { aSurvivors, bSurvivors, ticks: state.tickCount };
}

function parseMatchCountArg() {
  const arg = process.argv.find((a) => a.startsWith('--matches='));
  if (!arg) return 200;
  const parsed = Number(arg.split('=')[1]);
  return Number.isFinite(parsed) && parsed >= 2 ? Math.floor(parsed) : 200;
}

function scoreRemainingForceValue(state, teamId) {
  let score = 0;
  for (let i = 0; i < state.entities.length; i++) {
    const e = state.entities[i];
    if (!e.alive || e.teamId !== teamId) continue;
    score += Math.max(50, e.hp);
  }
  return score;
}

function runMirroredAiMatchMatrix(totalMatches) {
  const pairCount = Math.floor(totalMatches / 2);
  const actualMatches = pairCount * 2;
  const landMaps = SKIRMISH_MAPS.filter((m) => m.maxPlayers === 2);

  let abyssalWins = 0;
  let crimsonWins = 0;
  let decisiveFinishes = 0;
  let totalTicksSimulated = 0;
  let totalKillsValue = 0;

  const tStart = performance.now();

  for (let p = 0; p < pairCount; p++) {
    const mapBp = landMaps[p % landMaps.length];
    const seed = (20401000 + p * 7919) >>> 0;

    for (let swap = 0; swap < 2; swap++) {
      const f0 = swap === 0 ? 'abyssal' : 'crimson';
      const f1 = swap === 0 ? 'crimson' : 'abyssal';
      const abyssalTeam = f0 === 'abyssal' ? 0 : 1;

      const state = createGameState({
        seed,
        mapBlueprint: mapBp,
        players: [
          { playerId: 0, teamId: 0, factionId: f0, isHuman: false, aiDifficulty: 'hard', credits: 14000 },
          { playerId: 1, teamId: 1, factionId: f1, isHuman: false, aiDifficulty: 'hard', credits: 14000 }
        ],
        skirmishFairStart: true,
        fastBuild: false
      });

      const maxMatchTicks = 4500;
      for (let t = 0; t < maxMatchTicks && state.winnerTeamId === null; t++) {
        stepSimulation(state);
      }

      totalTicksSimulated += state.tickCount;
      totalKillsValue += (state.players[0].stats?.killedValue ?? 0) + (state.players[1].stats?.killedValue ?? 0);

      let winTeam = state.winnerTeamId;
      if (winTeam !== null) {
        decisiveFinishes++;
      } else {
        const s0 = scoreRemainingForceValue(state, 0);
        const s1 = scoreRemainingForceValue(state, 1);
        winTeam = s0 >= s1 ? 0 : 1;
      }

      if (winTeam === abyssalTeam) abyssalWins++;
      else crimsonWins++;
    }
  }

  const wallMs = performance.now() - tStart;
  const wallSec = Math.max(0.001, wallMs / 1000);
  const simulatedGameSec = totalTicksSimulated / 30;
  const speedMultiplier = simulatedGameSec / wallSec;
  const abyssalRate = (abyssalWins / actualMatches) * 100;
  const crimsonRate = (crimsonWins / actualMatches) * 100;

  console.log(
    `[sim:balance] Matches=${actualMatches} (Decisive=${decisiveFinishes}), SimTicks=${totalTicksSimulated}, Wall=${wallSec.toFixed(2)}s, Speed=${speedMultiplier.toFixed(1)}x real-time`
  );
  console.log(
    `[sim:balance] Abyssal=${abyssalWins}/${actualMatches} (${abyssalRate.toFixed(2)}%), Crimson=${crimsonWins}/${actualMatches} (${crimsonRate.toFixed(2)}%), AvgKillValue=$${Math.round(totalKillsValue / actualMatches)}`
  );

  assert.ok(speedMultiplier > 1000, `Expected >1000x simulation speed, got ${speedMultiplier.toFixed(1)}x`);
  assert.ok(
    abyssalRate >= 48.0 && abyssalRate <= 52.0,
    `Expected mirrored Abyssal win rate in 48%~52%, got ${abyssalRate.toFixed(2)}%`
  );
}

console.log('[sim:balance] Running micro unit cost-efficiency benchmarks...');
const mbtDuel = runMicroDuel('9x_Grizzly($6300)_vs_7x_Rhino($6300)', { typeId: 'grizzly', count: 9, x: 100, z: 120 }, { typeId: 'rhino', count: 7, x: 145, z: 120 }, 3000);
assert.ok(mbtDuel.aSurvivors === 0 || mbtDuel.bSurvivors === 0, 'Equal-cost MBT clash must conclude decisively');
runMicroDuel('4x_Prism($4800)_vs_3x_Apocalypse($5250)', { typeId: 'prism', count: 4, x: 96, z: 120 }, { typeId: 'apocalypse', count: 3, x: 148, z: 120 }, 3000);
const aaDuel = runMicroDuel('2x_Aegis($2400)_vs_2x_Kirov($4000)', { typeId: 'aegis', count: 2, x: 382, z: 120 }, { typeId: 'kirov', count: 2, x: 432, z: 120 }, 1500);
assert.ok(aaDuel.aSurvivors > 0 && aaDuel.bSurvivors === 0, 'Aegis cruisers must shred unescorted Kirovs at stand-off range');

const totalMatches = parseMatchCountArg();
console.log(`[sim:balance] Running ${totalMatches} mirrored-seed headless AI vs AI skirmishes...`);
runMirroredAiMatchMatrix(totalMatches);
console.log('[sim:balance] ALL M4 BALANCE & SPEED GATES PASSED.');
