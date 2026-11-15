// Milestone 5 (T5.1): IndexedDB Campaign Progression & Complete Deterministic Checkpoint Save/Load.
// Strictly enforces schemaVersion: 1, full gameplay state serialization, transient flowCache rebuild,
// and separation between in-match checkpoints and external campaign unlock progression.

import { KEYMAP_DEFAULTS } from './config.js';
import { createFlowCache } from '../gameplay/nav.js';
import { FOG_EXPLORED, createTeamFogGrids, rebuildTeamFogGrids } from '../gameplay/fogCpu.js';
import { MAP_SIZE, compileMap } from '../world/map.js';

export const SAVE_SCHEMA_VERSION = 1;
const DB_NAME = 'redalert3a_save_db';
const DB_VERSION = 1;
const STORE_PROFILE = 'profile';
const STORE_CHECKPOINTS = 'checkpoints';
const DIFFICULTY_RANK = { easy: 1, normal: 2, hard: 3 };

// Headless Node / fallback in-memory store when IndexedDB is unavailable
const memoryProfileStore = new Map();
const memoryCheckpointStore = new Map();

function encodeUint8Base64(u8) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  }
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function decodeUint8Base64(b64) {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function computeUnlockedMissions(profile) {
  const cleared = profile?.clearedMissions ?? {};
  const unlocked = ['A01'];

  // Abyssal line A02..A06 sequential after A01
  if (profile?.prologueCleared || cleared.A01) {
    unlocked.push('A02');
    for (let i = 2; i <= 5; i++) {
      if (cleared[`A0${i}`]) unlocked.push(`A0${i + 1}`);
    }
    // Crimson line unlocks concurrently once prologue A01 is cleared
    unlocked.push('C01');
    for (let i = 1; i <= 5; i++) {
      if (cleared[`C0${i}`]) unlocked.push(`C0${i + 1}`);
    }
  }

  // Secret finale EX13 requires both Abyssal (A06) & Crimson (C06) victories
  const aDone = Boolean(profile?.abyssalCleared || cleared.A06);
  const cDone = Boolean(profile?.crimsonCleared || cleared.C06);
  if (aDone && cDone) {
    unlocked.push('EX13');
  }

  return unlocked;
}

export function createDefaultCampaignProfile() {
  const base = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    prologueCleared: false,
    abyssalCleared: false,
    crimsonCleared: false,
    clearedMissions: {},
    unlockedMissions: ['A01'],
    preferences: {
      locale: 'zh-CN',
      quality: 'high',
      muted: false,
      keymap: { ...KEYMAP_DEFAULTS }
    }
  };
  base.unlockedMissions = computeUnlockedMissions(base);
  return base;
}

export function migrateCampaignProfile(raw) {
  const def = createDefaultCampaignProfile();
  if (!raw || typeof raw !== 'object' || raw.schemaVersion !== SAVE_SCHEMA_VERSION) {
    return def;
  }
  const merged = {
    schemaVersion: SAVE_SCHEMA_VERSION,
    prologueCleared: Boolean(raw.prologueCleared),
    abyssalCleared: Boolean(raw.abyssalCleared),
    crimsonCleared: Boolean(raw.crimsonCleared),
    clearedMissions: structuredClone(raw.clearedMissions ?? {}),
    unlockedMissions: [],
    preferences: {
      locale: raw.preferences?.locale === 'en-US' ? 'en-US' : 'zh-CN',
      quality: ['ultra', 'high', 'balanced'].includes(raw.preferences?.quality) ? raw.preferences.quality : 'high',
      muted: Boolean(raw.preferences?.muted),
      keymap: { ...KEYMAP_DEFAULTS, ...(raw.preferences?.keymap ?? {}) }
    }
  };
  if (merged.clearedMissions.A01) merged.prologueCleared = true;
  if (merged.clearedMissions.A06) merged.abyssalCleared = true;
  if (merged.clearedMissions.C06) merged.crimsonCleared = true;
  merged.unlockedMissions = computeUnlockedMissions(merged);
  return merged;
}

export function isMissionUnlocked(profile, missionId) {
  if (!missionId) return false;
  if (missionId === 'A01') return true;
  const unlocked = computeUnlockedMissions(profile);
  return unlocked.includes(missionId);
}

export function recordMissionVictory(profile, missionId, difficulty = 'normal') {
  const next = migrateCampaignProfile(profile);
  if (!missionId) return next;
  const prevDiff = next.clearedMissions[missionId];
  const prevRank = DIFFICULTY_RANK[prevDiff] ?? 0;
  const curRank = DIFFICULTY_RANK[difficulty] ?? DIFFICULTY_RANK.normal;
  if (curRank >= prevRank) {
    next.clearedMissions[missionId] = difficulty in DIFFICULTY_RANK ? difficulty : 'normal';
  }
  if (missionId === 'A01') next.prologueCleared = true;
  if (missionId === 'A06') next.abyssalCleared = true;
  if (missionId === 'C06') next.crimsonCleared = true;
  next.unlockedMissions = computeUnlockedMissions(next);
  return next;
}

// === Full Simulation Checkpoint Serialization & Restoration ===

export function serializeCheckpoint(state, label = 'auto') {
  if (!state || !state.map) {
    throw new Error('Cannot serialize checkpoint: invalid GameState');
  }

  // Persist ONLY bit 0 (FOG_EXPLORED) for each fog grid; VISIBLE/DETECTED recompute on load
  const fogExplored = {};
  const teamKeys = Object.keys(state.fogGrids ?? {});
  for (let i = 0; i < teamKeys.length; i++) {
    const tk = teamKeys[i];
    const grid = state.fogGrids[tk];
    if (!grid) continue;
    const expOnly = new Uint8Array(grid.length);
    for (let c = 0; c < grid.length; c++) {
      expOnly[c] = grid[c] & FOG_EXPLORED;
    }
    fogExplored[tk] = encodeUint8Base64(expOnly);
  }

  const players = (state.players ?? []).map((p) => ({
    playerId: p.playerId,
    teamId: p.teamId,
    factionId: p.factionId,
    isHuman: Boolean(p.isHuman),
    aiDifficulty: p.aiDifficulty ?? null,
    allowDualFaction: Boolean(p.allowDualFaction),
    credits: p.credits,
    powerProduced: p.powerProduced ?? 0,
    powerConsumed: p.powerConsumed ?? 0,
    powerFactor: p.powerFactor ?? 1.0,
    powerState: p.powerState ?? 'green',
    isLowPower: Boolean(p.isLowPower),
    aiState: p.aiState ? structuredClone(p.aiState) : null,
    queues: structuredClone(p.queues),
    doctrines: structuredClone(p.doctrines),
    superweapons: structuredClone(p.superweapons),
    stats: structuredClone(p.stats)
  }));

  const map = state.map;
  const hasBlueprint = Boolean(map.blueprint);

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    label,
    savedAtTick: state.tickCount,
    mode: state.mode,
    missionId: state.missionId ?? null,
    difficulty: state.difficulty ?? 'normal',
    fastBuild: Boolean(state.fastBuild),
    noFog: Boolean(state.noFog),
    skirmishFairStart: Boolean(state.skirmishFairStart),
    disableAI: Boolean(state.disableAI),

    // 1. Global control state
    tickCount: state.tickCount,
    prngState: state.prngState >>> 0,
    nextEntityId: state.nextEntityId,
    nextProjectileId: state.nextProjectileId,
    nextAreaEffectId: state.nextAreaEffectId ?? 1,
    hadMultipleHqTeams: Boolean(state.hadMultipleHqTeams),
    winnerTeamId: state.winnerTeamId ?? null,

    // 2. Full player states
    players,

    // 3. Dynamic map layer (ores, pillars, bridges, terrain overrides)
    map: {
      id: map.id,
      width: map.width ?? MAP_SIZE,
      height: map.height ?? MAP_SIZE,
      cellSize: map.cellSize ?? 2,
      worldSize: map.worldSize ?? 512,
      revision: map.revision ?? 1,
      blueprint: hasBlueprint ? structuredClone(map.blueprint) : null,
      elevationB64: !hasBlueprint && map.elevation
        ? encodeUint8Base64(new Uint8Array(map.elevation.buffer, map.elevation.byteOffset, map.elevation.byteLength))
        : null,
      terrainB64: encodeUint8Base64(map.terrain),
      oreTypeB64: encodeUint8Base64(map.oreType),
      oreAmountB64: encodeUint8Base64(map.oreAmount),
      bridges: structuredClone(map.bridges ?? []),
      spawns: structuredClone(map.spawns ?? []),
      neutralBuildings: structuredClone(map.neutralBuildings ?? []),
      supportsNaval: map.supportsNaval
    },
    orePillars: structuredClone(state.orePillars ?? []),

    // 4. Fog explored bit + active areaEffects
    fogExplored,
    areaEffects: structuredClone(state.areaEffects ?? []),

    // 5. Entities, projectiles, orphan drones, pending commands & director progress
    entities: structuredClone(state.entities ?? []),
    projectiles: structuredClone(state.projectiles ?? []),
    orphanDrones: structuredClone(state.orphanDrones ?? []),
    commandQueue: structuredClone(state.commandQueue ?? []),
    directorState: state.directorState ? structuredClone(state.directorState) : null
  };
}

export function restoreCheckpoint(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== SAVE_SCHEMA_VERSION) {
    throw new Error(`Unsupported checkpoint schemaVersion: ${snapshot?.schemaVersion}`);
  }

  const mSnap = snapshot.map;
  const compiled = mSnap.blueprint ? compileMap(mSnap.blueprint) : null;
  const total = MAP_SIZE * MAP_SIZE;

  const elevation = compiled
    ? compiled.elevation
    : mSnap.elevationB64
      ? new Float32Array(decodeUint8Base64(mSnap.elevationB64).buffer)
      : new Float32Array(total).fill(1.6);

  const map = {
    id: mSnap.id,
    blueprint: mSnap.blueprint ? structuredClone(mSnap.blueprint) : null,
    width: mSnap.width ?? MAP_SIZE,
    height: mSnap.height ?? MAP_SIZE,
    cellSize: mSnap.cellSize ?? 2,
    worldSize: mSnap.worldSize ?? 512,
    terrain: decodeUint8Base64(mSnap.terrainB64),
    elevation,
    oreType: decodeUint8Base64(mSnap.oreTypeB64),
    oreAmount: decodeUint8Base64(mSnap.oreAmountB64),
    buildingId: new Int32Array(total),
    orePillars: structuredClone(snapshot.orePillars ?? []),
    bridges: structuredClone(mSnap.bridges ?? []),
    spawns: structuredClone(mSnap.spawns ?? []),
    neutralBuildings: structuredClone(mSnap.neutralBuildings ?? []),
    supportsNaval: mSnap.supportsNaval,
    revision: mSnap.revision ?? 1
  };

  const entities = structuredClone(snapshot.entities ?? []);
  const entityById = new Map();
  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    entityById.set(ent.id, ent);
    // Re-stamp alive building footprints onto transient map.buildingId
    if (ent.alive && ent.isBuilding && ent.gx !== undefined && ent.gz !== undefined) {
      const w = ent.footprintW ?? 1;
      const h = ent.footprintH ?? 1;
      for (let dz = 0; dz < h; dz++) {
        for (let dx = 0; dx < w; dx++) {
          const gx = ent.gx + dx;
          const gz = ent.gz + dz;
          if (gx >= 0 && gx < MAP_SIZE && gz >= 0 && gz < MAP_SIZE) {
            map.buildingId[gz * MAP_SIZE + gx] = ent.id;
          }
        }
      }
    }
  }

  const fogGrids = createTeamFogGrids(4);
  for (const [tk, b64] of Object.entries(snapshot.fogExplored ?? {})) {
    const arr = decodeUint8Base64(b64);
    if (fogGrids[tk] && arr.length === fogGrids[tk].length) {
      for (let i = 0; i < arr.length; i++) {
        fogGrids[tk][i] = arr[i] & FOG_EXPLORED;
      }
    }
  }

  const state = {
    tickCount: snapshot.tickCount,
    prngState: snapshot.prngState >>> 0,
    mode: snapshot.mode ?? 'skirmish',
    missionId: snapshot.missionId ?? null,
    difficulty: snapshot.difficulty ?? 'normal',
    fastBuild: Boolean(snapshot.fastBuild),
    noFog: Boolean(snapshot.noFog),
    skirmishFairStart: Boolean(snapshot.skirmishFairStart),
    disableAI: Boolean(snapshot.disableAI),
    map,
    players: structuredClone(snapshot.players ?? []),
    fogGrids,
    entities,
    entityById,
    nextEntityId: snapshot.nextEntityId,
    projectiles: structuredClone(snapshot.projectiles ?? []),
    nextProjectileId: snapshot.nextProjectileId,
    commandQueue: structuredClone(snapshot.commandQueue ?? []),
    areaEffects: structuredClone(snapshot.areaEffects ?? []),
    nextAreaEffectId: snapshot.nextAreaEffectId ?? 1,
    orphanDrones: structuredClone(snapshot.orphanDrones ?? []),
    orePillars: map.orePillars,
    // Transient acceleration cache: explicitly NOT persisted; initialized clean on restore
    flowCache: createFlowCache(),
    directorState: snapshot.directorState ? structuredClone(snapshot.directorState) : null,
    hadMultipleHqTeams: Boolean(snapshot.hadMultipleHqTeams),
    winnerTeamId: snapshot.winnerTeamId ?? null,
    events: []
  };

  // Recompute transient VISIBLE | DETECTED bits from alive units/buildings/areaEffects while keeping EXPLORED
  rebuildTeamFogGrids(state);

  return state;
}

// === IndexedDB Persistence Layer (with Node In-Memory Fallback) ===

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROFILE)) {
        db.createObjectStore(STORE_PROFILE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CHECKPOINTS)) {
        db.createObjectStore(STORE_CHECKPOINTS, { keyPath: 'slotId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCampaignProfile(profile) {
  const clean = migrateCampaignProfile(profile);
  const record = { id: 'main', ...clean };
  const db = await openDatabase().catch(() => null);
  if (!db) {
    memoryProfileStore.set('main', structuredClone(record));
    return clean;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROFILE, 'readwrite');
    tx.objectStore(STORE_PROFILE).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve(clean);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function loadCampaignProfile() {
  const db = await openDatabase().catch(() => null);
  if (!db) {
    const raw = memoryProfileStore.get('main');
    return migrateCampaignProfile(raw);
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_PROFILE, 'readonly');
    const req = tx.objectStore(STORE_PROFILE).get('main');
    req.onsuccess = () => {
      db.close();
      resolve(migrateCampaignProfile(req.result));
    };
    req.onerror = () => {
      db.close();
      resolve(createDefaultCampaignProfile());
    };
  });
}

export async function saveCheckpointToDb(slotId, state, label = 'auto') {
  const snap = serializeCheckpoint(state, label);
  const record = { slotId, updatedAt: Date.now(), snapshot: snap };
  const db = await openDatabase().catch(() => null);
  if (!db) {
    memoryCheckpointStore.set(slotId, structuredClone(record));
    return snap;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CHECKPOINTS, 'readwrite');
    tx.objectStore(STORE_CHECKPOINTS).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve(snap);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function loadCheckpointFromDb(slotId) {
  const db = await openDatabase().catch(() => null);
  if (!db) {
    const rec = memoryCheckpointStore.get(slotId);
    return rec?.snapshot ? restoreCheckpoint(rec.snapshot) : null;
  }
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_CHECKPOINTS, 'readonly');
    const req = tx.objectStore(STORE_CHECKPOINTS).get(slotId);
    req.onsuccess = () => {
      db.close();
      const snap = req.result?.snapshot;
      resolve(snap ? restoreCheckpoint(snap) : null);
    };
    req.onerror = () => {
      db.close();
      resolve(null);
    };
  });
}
