// Milestone 6 Gate Verification:
// T6.1: Quality presets (ultra/high/balanced) configuration & WebGL recovery exports
// T6.2: Heavy 250+ unit Land/Sea/Air ?bench=1 scenario, <= 2.0ms avg tick time, & bench telemetry overlay
// T6.3: M6 bilingual parity verification

import assert from 'node:assert/strict';
import { QUALITY_PRESETS } from '../src/core/config.js';
import { createGameState, stepSimulation } from '../src/core/engine.js';
import { computePercentile, createBenchOverlay } from '../src/ui/bench.js';
import { getSkirmishMapById } from '../src/world/skirmishMaps.js';
import ZH_CN from '../src/locales/zh-CN.js';
import EN_US from '../src/locales/en-US.js';

function testT61QualityPresets() {
  assert.equal(QUALITY_PRESETS.ultra.shadowSize, 4096);
  assert.equal(QUALITY_PRESETS.high.shadowSize, 4096);
  assert.equal(QUALITY_PRESETS.balanced.shadowSize, 2048);
  assert.equal(QUALITY_PRESETS.ultra.bloomEnabled, true);
  assert.equal(QUALITY_PRESETS.balanced.bloomEnabled, false);
  assert.ok(QUALITY_PRESETS.balanced.debrisScale < QUALITY_PRESETS.ultra.debrisScale);
}

function testT62HeavyBench250Plus() {
  const straitMap = getSkirmishMapById('strait_2v2');
  const state = createGameState({
    mode: 'bench',
    mapBlueprint: straitMap,
    seed: 0x6001
  });
  const stateAlias = createGameState({
    mode: 'bench_m1',
    mapBlueprint: straitMap,
    seed: 0x6001
  });
  assert.equal(state.entities.length, stateAlias.entities.length);
  const initialActive = state.entities.filter((e) => e.alive).length;
  assert.ok(initialActive >= 250, `Expected >= 250 initial active entities, got ${initialActive}`);

  const domains = new Set(state.entities.filter((e) => !e.isBuilding).map((e) => e.domain));
  assert.ok(domains.has('GROUND'), 'Bench must include GROUND units');
  assert.ok(domains.has('AIR'), 'Bench must include AIR units');
  assert.ok(domains.has('SEA'), 'Bench must include SEA units');

  // Warmup JIT
  for (let i = 0; i < 60; i++) {
    stepSimulation(state);
  }

  // Benchmark 600 simulation ticks (20s simulated heavy battle)
  const ticks = 600;
  const t0 = performance.now();
  for (let i = 0; i < ticks; i++) {
    stepSimulation(state);
  }
  const elapsedMs = performance.now() - t0;
  const avgMs = elapsedMs / ticks;
  assert.ok(avgMs <= 2.0, `Bench sim avg ${avgMs.toFixed(3)}ms exceeded 2.0ms budget`);

  // Verify bench telemetry calculation & headless tracker
  assert.equal(computePercentile([10, 12, 14, 16, 18, 20, 22, 24, 26, 50], 0.99), 50);
  const overlay = createBenchOverlay({ initialQuality: 'high' });
  const postCombatAlive = state.entities.filter((e) => e.alive).length;
  overlay.recordFrame({ frameMs: 16.5, simMs: avgMs, drawCalls: 92, activeUnits: postCombatAlive });
  overlay.recordFrame({ frameMs: 18.0, simMs: avgMs, drawCalls: 94, activeUnits: postCombatAlive });
  const snap = overlay.getSnapshot();
  assert.equal(snap.qualityId, 'high');
  assert.ok(snap.avgFps > 50);
  assert.ok(snap.p99FrameMs >= 16.5);
  assert.ok(snap.drawCalls < 140);
  assert.equal(snap.activeUnits, postCombatAlive);
  assert.ok(postCombatAlive > 0);
  overlay.setQuality('balanced');
  assert.equal(overlay.getSnapshot().qualityId, 'balanced');
  overlay.destroy();

  console.log(
    `[test-m6] 250+ unit land/sea/air bench (${initialActive} start -> ${postCombatAlive} alive @ 660t): ${avgMs.toFixed(3)} ms/tick (<= 2.0ms), domains=${[...domains].join('/')}`
  );
}

function testT63LocaleKeys() {
  const required = [
    'menu.quality',
    'menu.qualityUltra',
    'menu.qualityHigh',
    'menu.qualityBalanced',
    'loading.contextLost',
    'loading.contextRestored',
    'bench.title',
    'bench.avgFps',
    'bench.p99Frame',
    'bench.simAvg',
    'bench.drawCalls',
    'bench.heapDelta',
    'bench.activeUnits',
    'bench.quality',
    'bench.elapsed',
    'bench.pass',
    'bench.warn'
  ];
  for (const key of required) {
    assert.ok(ZH_CN[key], `Missing zh-CN key ${key}`);
    assert.ok(EN_US[key], `Missing en-US key ${key}`);
  }
}

testT61QualityPresets();
testT62HeavyBench250Plus();
testT63LocaleKeys();
console.log('ALL M6 TESTS PASSED (T6.1-T6.3: Quality Presets, 250+ Bench <= 2.0ms, Telemetry & i18n)');
