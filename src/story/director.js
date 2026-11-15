// Milestone 5 (T5.2): Deterministic Declarative Campaign Director Engine.
// Supports timeline actions (cameraPanTo, spawnWave, dialogue, objective, triggerCheckpoint, choicePrompt)
// and declarative triggers (onTimer, onAreaEntered, onCapture, onUnitDestroyed, onBuildingBuilt, onAllEnemiesCleared).
// Pure ESM simulation module: emits structured events & keeps 100% serializable state in state.directorState.

import { TICK_RATE } from '../core/config.js';
import { findNearestPassableLand, spawnEntity } from '../gameplay/entities.js';

export function createDirectorState(missionSpec = {}) {
  return {
    missionId: missionSpec.id ?? null,
    firedTriggers: [],
    pendingTimeline: [],
    objectives: (missionSpec.objectives ?? []).map((o) => ({
      id: o.id,
      labelKey: o.labelKey,
      status: o.status ?? 'active'
    })),
    activeCutscene: null,
    pendingChoice: null,
    customFlags: {},
    lastCameraReturnTick: null,
    checkpointCount: 0,
    lastCheckpointLabel: null
  };
}

// === Declarative Action Builders ===

export const DirectorActions = {
  cameraPanTo(x, z, zoom = 0.85, ms = 3000) {
    return { type: 'cameraPanTo', x, z, zoom, ms };
  },
  spawnWave(blueprint) {
    return { type: 'spawnWave', blueprint };
  },
  dialogue(speakerId, localeKey, durationSec = 5, accentHex = '#38bdf8') {
    return { type: 'dialogue', speakerId, localeKey, durationSec, accentHex };
  },
  objective(id, labelKey, status = 'active') {
    return { type: 'objective', id, labelKey, status };
  },
  triggerCheckpoint(label = 'auto') {
    return { type: 'triggerCheckpoint', label };
  },
  choicePrompt(titleKey, bodyKey, choices) {
    return { type: 'choicePrompt', titleKey, bodyKey, choices };
  },
  setFlag(key, value = true) {
    return { type: 'setFlag', key, value };
  },
  grantCredits(playerId = 0, amount = 2000) {
    return { type: 'grantCredits', playerId, amount };
  },
  grantSuperweaponReady(playerId = 0, swId) {
    return { type: 'grantSuperweaponReady', playerId, swId };
  },
  victory(winnerTeamId = 0) {
    return { type: 'victory', winnerTeamId };
  },
  defeat(winnerTeamId = 1) {
    return { type: 'defeat', winnerTeamId };
  }
};

function executeDirectorAction(state, action, ds) {
  if (!action) return;

  switch (action.type) {
    case 'cameraPanTo': {
      const durationTicks = Math.max(1, Math.round(((action.ms ?? 3000) / 1000) * TICK_RATE));
      ds.activeCutscene = {
        startTick: state.tickCount,
        endTick: state.tickCount + durationTicks,
        x: action.x,
        z: action.z,
        zoom: action.zoom ?? 0.85,
        ms: action.ms ?? 3000
      };
      state.events.push({
        type: 'director:cameraPan',
        x: action.x,
        z: action.z,
        zoom: action.zoom ?? 0.85,
        ms: action.ms ?? 3000,
        endTick: ds.activeCutscene.endTick
      });
      break;
    }

    case 'spawnWave': {
      const bp = action.blueprint ?? {};
      const playerId = bp.playerId ?? 1;
      const teamId = bp.teamId ?? (state.players[playerId]?.teamId ?? playerId);
      const factionId = bp.factionId ?? state.players[playerId]?.factionId ?? 'crimson';
      const units = bp.units ?? [];
      const spawnedIds = [];

      for (let i = 0; i < units.length; i++) {
        const spec = units[i];
        const count = spec.count ?? 1;
        for (let k = 0; k < count; k++) {
          const ox = ((k % 3) - 1) * 3.5 + (i * 1.5);
          const oz = Math.floor(k / 3) * 3.5;
          const rawX = (spec.x ?? bp.x ?? 256) + ox;
          const rawZ = (spec.z ?? bp.z ?? 256) + oz;
          const pos = spec.air || spec.naval
            ? { x: rawX, z: rawZ }
            : findNearestPassableLand(state.map, rawX, rawZ);
          const ent = spawnEntity(state, {
            typeId: spec.typeId,
            playerId,
            teamId,
            factionId,
            x: pos.x,
            z: pos.z,
            campaignTag: spec.tag ?? bp.tag ?? null
          });
          if (spec.attackMoveX !== undefined && spec.attackMoveZ !== undefined) {
            ent.orderType = 'ATTACK_MOVE';
            ent.moveTargetX = spec.attackMoveX;
            ent.moveTargetZ = spec.attackMoveZ;
          } else if (bp.attackMoveX !== undefined && bp.attackMoveZ !== undefined) {
            ent.orderType = 'ATTACK_MOVE';
            ent.moveTargetX = bp.attackMoveX;
            ent.moveTargetZ = bp.attackMoveZ;
          } else if (spec.moveX !== undefined && spec.moveZ !== undefined) {
            ent.orderType = 'MOVE';
            ent.moveTargetX = spec.moveX;
            ent.moveTargetZ = spec.moveZ;
          }
          spawnedIds.push(ent.id);
        }
      }
      state.events.push({ type: 'director:waveSpawned', tag: bp.tag ?? null, count: spawnedIds.length });
      break;
    }

    case 'dialogue': {
      state.events.push({
        type: 'director:dialogue',
        speakerId: action.speakerId ?? 'eva_abyssal',
        localeKey: action.localeKey,
        durationSec: action.durationSec ?? 5,
        accentHex: action.accentHex ?? '#38bdf8'
      });
      break;
    }

    case 'objective': {
      const idx = ds.objectives.findIndex((o) => o.id === action.id);
      if (idx >= 0) {
        if (action.labelKey) ds.objectives[idx].labelKey = action.labelKey;
        ds.objectives[idx].status = action.status ?? 'active';
      } else {
        ds.objectives.push({
          id: action.id,
          labelKey: action.labelKey,
          status: action.status ?? 'active'
        });
      }
      state.events.push({
        type: 'director:objective',
        id: action.id,
        labelKey: action.labelKey,
        status: action.status ?? 'active'
      });
      break;
    }

    case 'triggerCheckpoint': {
      ds.checkpointCount = (ds.checkpointCount ?? 0) + 1;
      ds.lastCheckpointLabel = action.label ?? 'auto';
      state.events.push({
        type: 'director:checkpoint',
        label: action.label ?? 'auto',
        tick: state.tickCount
      });
      break;
    }

    case 'choicePrompt': {
      ds.pendingChoice = {
        titleKey: action.titleKey,
        bodyKey: action.bodyKey,
        choices: action.choices ?? []
      };
      state.events.push({
        type: 'director:choicePrompt',
        ...ds.pendingChoice
      });
      break;
    }

    case 'setFlag': {
      ds.customFlags[action.key] = action.value ?? true;
      break;
    }

    case 'grantCredits': {
      const p = state.players[action.playerId ?? 0];
      if (p) p.credits += action.amount ?? 0;
      break;
    }

    case 'grantSuperweaponReady': {
      const p = state.players[action.playerId ?? 0];
      if (p?.superweapons && action.swId) {
        p.superweapons[action.swId] = {
          ready: true,
          remainingTicks: 0,
          totalTicks: 1
        };
      }
      break;
    }

    case 'victory': {
      if (state.winnerTeamId === null) {
        state.winnerTeamId = action.winnerTeamId ?? 0;
        state.events.push({ type: 'match:victory', winnerTeamId: state.winnerTeamId });
      }
      break;
    }

    case 'defeat': {
      if (state.winnerTeamId === null) {
        state.winnerTeamId = action.winnerTeamId ?? 1;
        state.events.push({ type: 'match:victory', winnerTeamId: state.winnerTeamId });
      }
      break;
    }

    default:
      break;
  }
}

export function resolveDirectorChoice(state, choiceIndex) {
  const ds = state.directorState;
  if (!ds || !ds.pendingChoice) return;
  const chosen = ds.pendingChoice.choices?.[choiceIndex];
  ds.pendingChoice = null;
  if (chosen?.actions) {
    for (let i = 0; i < chosen.actions.length; i++) {
      executeDirectorAction(state, chosen.actions[i], ds);
    }
  }
}

function checkTriggerCondition(state, trigger, ds) {
  // Optional prerequisite flag gate
  if (trigger.requiresFlag && !ds.customFlags[trigger.requiresFlag]) {
    return false;
  }

  switch (trigger.when) {
    case 'onTimer':
      return state.tickCount >= (trigger.atTick ?? 1);

    case 'onAreaEntered': {
      const tx = trigger.x ?? 256;
      const tz = trigger.z ?? 256;
      const r2 = (trigger.radius ?? 14) ** 2;
      const pid = trigger.playerId ?? 0;
      for (let i = 0; i < state.entities.length; i++) {
        const e = state.entities[i];
        if (!e.alive || e.playerId !== pid) continue;
        if (trigger.unitOnly && e.isBuilding) continue;
        const dx = e.x - tx;
        const dz = e.z - tz;
        if (dx * dx + dz * dz <= r2) return true;
      }
      return false;
    }

    case 'onCapture': {
      const targetPlayer = trigger.byPlayerId ?? 0;
      for (let i = 0; i < state.entities.length; i++) {
        const e = state.entities[i];
        if (!e.alive) continue;
        if (trigger.tag && e.campaignTag !== trigger.tag) continue;
        if (trigger.typeId && e.typeId !== trigger.typeId) continue;
        if (e.playerId === targetPlayer) return true;
      }
      return false;
    }

    case 'onUnitDestroyed': {
      if (trigger.tag) {
        // Trigger fires once ALL units carrying trigger.tag are dead (or destroyed event seen)
        let anyAliveWithTag = false;
        for (let i = 0; i < state.entities.length; i++) {
          const e = state.entities[i];
          if (e.alive && e.campaignTag === trigger.tag) {
            anyAliveWithTag = true;
            break;
          }
        }
        if (!anyAliveWithTag && (ds.customFlags[`seen_${trigger.tag}`] || state.tickCount > 2)) {
          return true;
        }
      }
      for (let i = 0; i < state.events.length; i++) {
        const ev = state.events[i];
        if (ev.type !== 'entity:destroyed' && ev.type !== 'entity:erased') continue;
        if (trigger.typeId && ev.typeId === trigger.typeId && (trigger.teamId === undefined || ev.teamId === trigger.teamId)) {
          return true;
        }
      }
      return false;
    }

    case 'onBuildingBuilt': {
      const pid = trigger.playerId ?? 0;
      for (let i = 0; i < state.entities.length; i++) {
        const e = state.entities[i];
        if (e.alive && e.isBuilding && e.playerId === pid && e.typeId === trigger.typeId) {
          return true;
        }
      }
      return false;
    }

    case 'onAllEnemiesCleared': {
      if (state.tickCount < (trigger.minTick ?? 15)) return false;
      const enemyTeam = trigger.enemyTeamId ?? 1;
      for (let i = 0; i < state.entities.length; i++) {
        const e = state.entities[i];
        if (e.alive && e.teamId === enemyTeam && e.category !== 'neutral') {
          return false;
        }
      }
      return true;
    }

    default:
      return false;
  }
}

export function stepDirector(state, missionSpec = null) {
  const ds = state.directorState;
  if (!ds || state.winnerTeamId !== null) return;

  // Release camera control smoothly once active cutscene finishes
  if (ds.activeCutscene && state.tickCount >= ds.activeCutscene.endTick) {
    ds.lastCameraReturnTick = state.tickCount;
    ds.activeCutscene = null;
    state.events.push({ type: 'director:cameraReturn', tick: state.tickCount });
  }

  // Drain any delayed timeline actions scheduled by earlier triggers
  if (ds.pendingTimeline.length > 0) {
    const keep = [];
    for (let i = 0; i < ds.pendingTimeline.length; i++) {
      const item = ds.pendingTimeline[i];
      if (state.tickCount >= item.execTick) {
        executeDirectorAction(state, item.action, ds);
      } else {
        keep.push(item);
      }
    }
    ds.pendingTimeline = keep;
  }

  // Evaluate declarative triggers cleanly (one-shot unless repeatable: true)
  const triggers = missionSpec?.triggers ?? [];
  for (let i = 0; i < triggers.length; i++) {
    const tr = triggers[i];
    if (!tr.repeatable && ds.firedTriggers.includes(tr.id)) continue;

    if (checkTriggerCondition(state, tr, ds)) {
      if (!tr.repeatable) ds.firedTriggers.push(tr.id);
      const actions = tr.actions ?? [];
      for (let a = 0; a < actions.length; a++) {
        const act = actions[a];
        if (act.delayTicks && act.delayTicks > 0) {
          ds.pendingTimeline.push({ execTick: state.tickCount + act.delayTicks, action: act });
        } else {
          executeDirectorAction(state, act, ds);
        }
      }
    }
  }

  // Automatic campaign defeat check: if Player 0 loses ALL units & ALL buildings
  if (state.tickCount > 15 && state.winnerTeamId === null) {
    let p0Alive = 0;
    for (let i = 0; i < state.entities.length; i++) {
      const e = state.entities[i];
      if (e.alive && e.playerId === 0) {
        p0Alive++;
        break;
      }
    }
    if (p0Alive === 0) {
      executeDirectorAction(state, DirectorActions.defeat(1), ds);
    }
  }
}
