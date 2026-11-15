export const REPLAY_SCHEMA_VERSION = 1;
export const REPLAY_FILE_EXT = '.ra3arep.json';
export const ALLOWED_REPLAY_SPEEDS = Object.freeze([1, 2, 4]);

function sanitizeJsonValue(value, depth = 0) {
  if (depth > 8) return null;
  if (value === null || value === undefined) return undefined;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length; i++) {
      const clean = sanitizeJsonValue(value[i], depth + 1);
      out.push(clean === undefined ? null : clean);
    }
    return out;
  }
  if (t === 'object') {
    const out = Object.create(null);
    for (const [k, v] of Object.entries(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const clean = sanitizeJsonValue(v, depth + 1);
      if (clean !== undefined) out[k] = clean;
    }
    return out;
  }
  return undefined;
}

function toPlainObject(obj) {
  if (!obj || typeof obj !== 'object') return {};
  return JSON.parse(JSON.stringify(obj));
}

export function createReplayRecorder(initialMeta = {}) {
  const meta = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    createdAt: Date.now(),
    mode: initialMeta.mode ?? 'skirmish',
    mapId: initialMeta.mapId ?? null,
    missionId: initialMeta.missionId ?? null,
    seed: Number.isFinite(initialMeta.seed) ? (initialMeta.seed >>> 0) : 1337,
    initialCredits: Number.isFinite(initialMeta.initialCredits) ? initialMeta.initialCredits : 10000,
    difficulty: initialMeta.difficulty ?? 'normal',
    playerSlotCount: Number.isInteger(initialMeta.playerSlotCount) ? initialMeta.playerSlotCount : 2,
    humanFactionId: initialMeta.humanFactionId ?? 'abyssal',
    aiFactionId: initialMeta.aiFactionId ?? 'crimson',
    players: Array.isArray(initialMeta.players) ? toPlainObject(sanitizeJsonValue(initialMeta.players)) : null,
    skirmishFairStart: initialMeta.skirmishFairStart !== false,
    fastBuild: Boolean(initialMeta.fastBuild),
    noFog: Boolean(initialMeta.noFog),
    rulePatch: initialMeta.rulePatch ? toPlainObject(sanitizeJsonValue(initialMeta.rulePatch)) : null,
    endTick: 0,
    winnerTeamId: null
  };

  const commands = [];

  return {
    recordCommand(tick, cmd) {
      if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') return;
      const safeTick = Math.max(0, Math.floor(Number(tick) || 0));
      const clean = sanitizeJsonValue(cmd);
      if (!clean || typeof clean.type !== 'string') return;
      commands.push({
        tick: safeTick,
        cmd: JSON.parse(JSON.stringify(clean))
      });
    },

    finalize(endTick, winnerTeamId = null) {
      meta.endTick = Math.max(meta.endTick, Math.floor(Number(endTick) || 0));
      if (winnerTeamId !== null && winnerTeamId !== undefined) {
        meta.winnerTeamId = winnerTeamId;
      }
    },

    get commandCount() {
      return commands.length;
    },

    toJSON() {
      return {
        ...meta,
        endTick: Math.max(meta.endTick, commands.length > 0 ? commands[commands.length - 1].tick + 1 : 0),
        commands: commands.map((entry) => ({
          tick: entry.tick,
          cmd: JSON.parse(JSON.stringify(entry.cmd))
        }))
      };
    }
  };
}

export function validateReplayData(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, data: null, error: 'Replay payload must be a JSON object.' };
  }
  if (raw.schemaVersion !== REPLAY_SCHEMA_VERSION) {
    return { ok: false, data: null, error: `Unsupported replay schemaVersion: ${raw.schemaVersion}` };
  }
  if (!Number.isFinite(Number(raw.seed))) {
    return { ok: false, data: null, error: 'Replay seed is missing or invalid.' };
  }
  if (typeof raw.mapId !== 'string' && typeof raw.missionId !== 'string') {
    return { ok: false, data: null, error: 'Replay requires mapId or missionId.' };
  }
  if (!Array.isArray(raw.commands)) {
    return { ok: false, data: null, error: 'Replay commands must be an array.' };
  }

  const normalizedCommands = [];
  for (let i = 0; i < raw.commands.length; i++) {
    const entry = raw.commands[i];
    if (
      !entry ||
      typeof entry !== 'object' ||
      !Number.isInteger(entry.tick) ||
      entry.tick < 0 ||
      !entry.cmd ||
      typeof entry.cmd !== 'object' ||
      typeof entry.cmd.type !== 'string'
    ) {
      return { ok: false, data: null, error: `Invalid replay command entry at index ${i}.` };
    }
    const cleanCmd = sanitizeJsonValue(entry.cmd);
    normalizedCommands.push({
      seq: i,
      tick: entry.tick,
      cmd: toPlainObject(cleanCmd)
    });
  }

  return {
    ok: true,
    error: null,
    data: {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      createdAt: Number(raw.createdAt) || Date.now(),
      mode: raw.mode === 'campaign' ? 'campaign' : 'skirmish',
      mapId: typeof raw.mapId === 'string' ? raw.mapId : null,
      missionId: typeof raw.missionId === 'string' ? raw.missionId : null,
      seed: Number(raw.seed) >>> 0,
      initialCredits: Number.isFinite(Number(raw.initialCredits)) ? Number(raw.initialCredits) : 10000,
      difficulty: typeof raw.difficulty === 'string' ? raw.difficulty : 'normal',
      playerSlotCount: Number.isInteger(raw.playerSlotCount) ? raw.playerSlotCount : 2,
      humanFactionId: typeof raw.humanFactionId === 'string' ? raw.humanFactionId : 'abyssal',
      aiFactionId: typeof raw.aiFactionId === 'string' ? raw.aiFactionId : 'crimson',
      players: Array.isArray(raw.players) ? toPlainObject(sanitizeJsonValue(raw.players)) : null,
      skirmishFairStart: raw.skirmishFairStart !== false,
      fastBuild: Boolean(raw.fastBuild),
      noFog: Boolean(raw.noFog),
      rulePatch: raw.rulePatch && typeof raw.rulePatch === 'object' ? toPlainObject(sanitizeJsonValue(raw.rulePatch)) : null,
      endTick: Number.isFinite(Number(raw.endTick)) ? Math.max(0, Math.floor(Number(raw.endTick))) : 0,
      winnerTeamId: raw.winnerTeamId ?? null,
      commands: normalizedCommands
    }
  };
}

export function createReplayPlaybackController(rawReplayData) {
  const check = validateReplayData(rawReplayData);
  if (!check.ok) {
    throw new Error(check.error || 'Invalid replay data');
  }
  const replay = check.data;
  const entries = [...replay.commands].sort((a, b) => (a.tick - b.tick) || (a.seq - b.seq));
  const lastCmdTick = entries.length > 0 ? entries[entries.length - 1].tick + 1 : 0;
  const totalEndTick = Math.max(replay.endTick, lastCmdTick);

  let cursor = 0;
  let speed = 1;
  let paused = false;

  return {
    replay,

    get speed() {
      return speed;
    },

    setSpeed(nextSpeed) {
      if (ALLOWED_REPLAY_SPEEDS.includes(nextSpeed)) {
        speed = nextSpeed;
      }
      return speed;
    },

    cycleSpeed() {
      const idx = ALLOWED_REPLAY_SPEEDS.indexOf(speed);
      speed = ALLOWED_REPLAY_SPEEDS[(idx + 1) % ALLOWED_REPLAY_SPEEDS.length];
      return speed;
    },

    get paused() {
      return paused;
    },

    setPaused(nextPaused) {
      paused = Boolean(nextPaused);
      return paused;
    },

    togglePause() {
      paused = !paused;
      return paused;
    },

    feedTickCommands(state, enqueueFn) {
      let dispatched = 0;
      const tick = state?.tickCount ?? 0;
      while (cursor < entries.length && entries[cursor].tick <= tick) {
        enqueueFn(structuredClone(entries[cursor].cmd));
        cursor += 1;
        dispatched += 1;
      }
      return dispatched;
    },

    isFinished(currentTick) {
      return cursor >= entries.length && currentTick >= totalEndTick;
    },

    get progress() {
      return {
        executedCommands: cursor,
        totalCommands: entries.length,
        endTick: totalEndTick
      };
    }
  };
}
