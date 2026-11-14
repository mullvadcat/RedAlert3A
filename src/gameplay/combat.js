// 30 Hz deterministic combat resolution, CPU fog target acquisition,
// 7x6 armor & override damage calculation, idempotent pendingDamage reservation/release,
// and standard victory detection (all hostile structures + MCVs destroyed).
// Pure ESM: zero DOM / WebGL imports.

import {
  ENTITY_DEFS,
  TICK_DT,
  getArmorMultiplier
} from '../core/config.js';
import { isEntityTargetable } from './fogCpu.js';
import {
  compactDeadEntities,
  grantKillExperience,
  removeEntity
} from './entities.js';

const IFV_MODES = {
  engineer: { damage: 0, healPerShot: 42, burst: 1, cooldownTicks: 15, range: 12, damageType: 'Repair', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 0 },
  gi: { damage: 24, burst: 1, cooldownTicks: 6, range: 16, damageType: 'Bullet', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 64 },
  chrono: { damage: 250 / 30, burst: 1, cooldownTicks: 1, range: 15, damageType: 'Chrono', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 0 }
};

function getActiveWeapon(ent) {
  const def = ENTITY_DEFS[ent.typeId];
  if (!def) return null;
  if (ent.typeId === 'carrier') return null; // Uses 4-drone 5-state FSM in naval.js
  if (ent.typeId === 'gi' && ent.deployState === 'DEPLOYED') {
    return def.deployedWeapon;
  }
  if (ent.typeId === 'ifv' && ent.cargoList && ent.cargoList.length > 0) {
    const modeWeapon = IFV_MODES[ent.cargoList[0].typeId];
    if (modeWeapon) return modeWeapon;
  }
  return def.weapon ?? null;
}

function countAdjacentTeslaTroopers(state, coil) {
  let count = 0;
  for (let i = 0; i < state.entities.length; i++) {
    const ent = state.entities[i];
    if (!ent.alive || ent.typeId !== 'tesla_trooper' || ent.playerId !== coil.playerId) continue;
    if (ent.frozenByCount > 0 || ent.stunTicks > 0) continue;
    if (Math.hypot(ent.x - coil.x, ent.z - coil.z) <= 4.5) {
      count++;
    }
  }
  return count;
}

function isWeaponOperational(state, attacker, weapon) {
  if (!weapon || !attacker.alive) return false;
  if (attacker.empTicks > 0 || attacker.frozenByCount > 0 || attacker.stunTicks > 0) return false;
  const def = ENTITY_DEFS[attacker.typeId];
  if (def?.producerType === 'airforce_radar' && (attacker.airState === 'A_DOCKED' || attacker.airState === 'A_REARMING')) {
    return false;
  }
  if (def?.maxAmmo > 0 && (attacker.ammo ?? 0) <= 0) return false;
  if (def?.requiresPower && state.players[attacker.playerId]?.isLowPower) {
    // >= 2 friendly Tesla Troopers adjacent to a Tesla Coil override blackout shutdown!
    if (attacker.typeId === 'tesla_coil' && countAdjacentTeslaTroopers(state, attacker) >= 2) {
      attacker.overcharged = true;
      return true;
    }
    attacker.overcharged = false;
    return false;
  }
  attacker.overcharged = false;
  return true;
}

function isDomainAllowed(weapon, target) {
  if (!weapon?.targetDomains) return false;
  if (weapon.targetDomains.includes(target.domain)) return true;
  if (target.domain === 'SUBMERGED' && target.surfacedTicks > 0 && weapon.targetDomains.includes('SEA')) {
    return true;
  }
  return false;
}

export function releaseProjectileReservation(state, proj) {
  if (proj.released) return;
  proj.released = true;
  const target = state.entityById.get(proj.targetId);
  if (target) {
    target.pendingDamage = Math.max(0, target.pendingDamage - proj.reservedDamage);
  }
}

export function applyDamage(state, target, rawDamage, damageType, attacker = null, attackerPlayerId = null) {
  if (!target || !target.alive) return 0;
  if (target.ironCurtainTicks > 0 || target.frozenByCount > 0) return 0;

  const mult = getArmorMultiplier(damageType, target, attacker);
  const takenMult = target.damageTakenMult ?? 1.0;
  const finalDmg = rawDamage * mult * takenMult;
  if (finalDmg <= 0) return 0;

  target.hp -= finalDmg;
  target.lastCombatTick = state.tickCount;

  // Notify defender when damaged
  if (state.tickCount % 30 === 0) {
    state.events.push({ type: 'combat:hit', targetId: target.id, attackerId: attacker?.id ?? null, dmg: finalDmg, x: target.x, z: target.z });
  }

  if (target.hp <= 0) {
    target.hp = 0;
    const victimPlayer = state.players[target.playerId];
    if (victimPlayer) victimPlayer.stats.lost += 1;

    const killOwnerId = attacker?.playerId ?? attackerPlayerId;
    if (killOwnerId !== null && state.players[killOwnerId] && target.teamId !== state.players[killOwnerId].teamId) {
      state.players[killOwnerId].stats.killedValue += ENTITY_DEFS[target.typeId]?.cost ?? 0;
    }

    if (attacker && attacker.alive) {
      grantKillExperience(state, attacker, target);
    }

    state.events.push({
      type: 'fx:explosion',
      x: target.x,
      y: target.y,
      z: target.z,
      scale: target.isBuilding ? 2.4 : 1.0
    });
    const wasReactor = target.typeId === 'nuclear_reactor';
    const rx = target.x;
    const rz = target.z;
    removeEntity(state, target.id, 'destroyed');

    // Nuclear Reactor destruction triggers thermal blast + persistent radiation zone (T2.2)
    if (wasReactor) {
      state.areaEffects.push({
        id: state.nextAreaEffectId ? state.nextAreaEffectId++ : state.tickCount,
        type: 'radiation',
        kind: 'radiation',
        x: rx,
        z: rz,
        radius: 8.0,
        damagePerTick: 45 / 30,
        expiryTick: state.tickCount + 450,
        ownerPlayerId: killOwnerId ?? -1
      });
      const blastList = state.entities.filter((e) => e.alive && Math.hypot(e.x - rx, e.z - rz) <= 7.0);
      for (let b = 0; b < blastList.length; b++) {
        const near = blastList[b];
        const dist = Math.hypot(near.x - rx, near.z - rz);
        const falloff = Math.max(0.25, 1.0 - dist / 8.0);
        applyDamage(state, near, 240 * falloff, 'HighExplosive', null, killOwnerId ?? null);
      }
    }
  }
  return finalDmg;
}

function selectTargetForEntity(state, attacker, weapon) {
  const range = weapon.range ?? 10;

  // 1. Validate explicit attack target first
  if (attacker.attackTargetId !== null) {
    const explicit = state.entityById.get(attacker.attackTargetId);
    if (
      explicit &&
      explicit.alive &&
      explicit.teamId !== attacker.teamId &&
      explicit.frozenByCount === 0 &&
      isDomainAllowed(weapon, explicit) &&
      getArmorMultiplier(weapon.damageType, explicit, attacker) > 0 &&
      isEntityTargetable(state, attacker.teamId, explicit)
    ) {
      const dist = Math.hypot(explicit.x - attacker.x, explicit.z - attacker.z);
      if (dist <= range + (explicit.radius ?? 0)) {
        return explicit;
      }
      // Chase explicit target if mobile unit with ATTACK order
      if (!attacker.isBuilding && (attacker.orderType === 'ATTACK' || attacker.orderType === 'ATTACK_MOVE')) {
        attacker.moveTargetX = explicit.x;
        attacker.moveTargetZ = explicit.z;
        attacker.moveStopDist = Math.max(2.0, range * 0.85);
      }
      return null;
    }
    attacker.attackTargetId = null;
  }

  // 2. Auto-acquire nearest valid visible enemy within weapon range (respecting pendingDamage)
  let best = null;
  let bestDist2 = Infinity;
  const entities = state.entities;
  for (let i = 0; i < entities.length; i++) {
    const cand = entities[i];
    if (!cand.alive || cand.teamId === attacker.teamId) continue;
    if (cand.teamId === 3 && cand.category === 'neutral') continue; // Don't auto-aggro neutral oil derricks
    if (cand.frozenByCount > 0) continue;
    if (!isDomainAllowed(weapon, cand)) continue;
    if (getArmorMultiplier(weapon.damageType, cand, attacker) <= 0) continue;
    if (cand.hp - cand.pendingDamage <= 0) continue; // Overkill prevention!

    const dx = cand.x - attacker.x;
    const dz = cand.z - attacker.z;
    const effRange = range + (cand.radius ?? 0);
    const d2 = dx * dx + dz * dz;
    if (d2 > effRange * effRange) continue;
    if (!isEntityTargetable(state, attacker.teamId, cand)) continue;

    if (d2 < bestDist2) {
      bestDist2 = d2;
      best = cand;
    }
  }
  return best;
}

function stepChronoLocks(state) {
  const entities = state.entities;
  const nextLocks = new Map();

  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent.alive || ent.empTicks > 0 || ent.stunTicks > 0 || ent.frozenByCount > 0) {
      ent.chronoLockTargetId = null;
      continue;
    }
    const weapon = getActiveWeapon(ent);
    if (!weapon || weapon.damageType !== 'Chrono') {
      ent.chronoLockTargetId = null;
      continue;
    }
    if (ent.orderType === 'MOVE' && ent.moveTargetX !== null) {
      ent.chronoLockTargetId = null;
      continue;
    }

    const range = weapon.range ?? 14;
    let target = null;
    const preferredId = ent.attackTargetId ?? ent.chronoLockTargetId;
    if (preferredId !== null) {
      const cand = state.entityById.get(preferredId);
      if (
        cand &&
        cand.alive &&
        cand.teamId !== ent.teamId &&
        cand.teamId !== 3 &&
        cand.ironCurtainTicks === 0 &&
        isDomainAllowed(weapon, cand) &&
        isEntityTargetable(state, ent.teamId, cand)
      ) {
        if (Math.hypot(cand.x - ent.x, cand.z - ent.z) <= range + (cand.radius ?? 0)) {
          target = cand;
        }
      }
    }

    if (!target) {
      let bestDist2 = Infinity;
      for (let j = 0; j < entities.length; j++) {
        const cand = entities[j];
        if (!cand.alive || cand.teamId === ent.teamId || cand.teamId === 3) continue;
        if (cand.ironCurtainTicks > 0 || !isDomainAllowed(weapon, cand)) continue;
        if (!isEntityTargetable(state, ent.teamId, cand)) continue;
        const effR = range + (cand.radius ?? 0);
        const dx = cand.x - ent.x;
        const dz = cand.z - ent.z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= effR * effR && d2 < bestDist2) {
          bestDist2 = d2;
          target = cand;
        }
      }
    }

    if (!target) {
      ent.chronoLockTargetId = null;
      continue;
    }

    ent.chronoLockTargetId = target.id;
    ent.turretYaw = Math.atan2(target.x - ent.x, target.z - ent.z);
    ent.lastCombatTick = state.tickCount;
    nextLocks.set(target.id, (nextLocks.get(target.id) ?? 0) + 1);
    target.eraseProgress += weapon.damage ?? (250 / 30);

    if (state.tickCount % 3 === 0) {
      state.events.push({
        type: 'combat:fire',
        attackerId: ent.id,
        attackerTypeId: ent.typeId,
        targetId: target.id,
        x: ent.x,
        z: ent.z,
        tx: target.x,
        tz: target.z,
        damageType: 'Chrono'
      });
    }
  }

  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent.alive) continue;
    const locks = nextLocks.get(ent.id) ?? 0;
    ent.frozenByCount = locks;
    if (locks === 0) {
      ent.eraseProgress = 0;
    } else if (ent.eraseProgress >= ent.maxHp) {
      const victimPlayer = state.players[ent.playerId];
      if (victimPlayer) victimPlayer.stats.lost += 1;
      state.events.push({ type: 'fx:chronoErase', entityId: ent.id, x: ent.x, y: ent.y, z: ent.z });
      removeEntity(state, ent.id, 'erased');
    }
  }
}

function stepIfvRepair(state, ent, weapon) {
  const range = weapon.range ?? 12;
  let best = null;
  let bestDist2 = Infinity;
  for (let i = 0; i < state.entities.length; i++) {
    const cand = state.entities[i];
    if (!cand.alive || cand.id === ent.id || cand.playerId !== ent.playerId) continue;
    if (cand.frozenByCount > 0 || cand.hp >= cand.maxHp) continue;
    if (!isDomainAllowed(weapon, cand)) continue;
    const effR = range + (cand.radius ?? 0);
    const dx = cand.x - ent.x;
    const dz = cand.z - ent.z;
    const d2 = dx * dx + dz * dz;
    if (d2 <= effR * effR && d2 < bestDist2) {
      bestDist2 = d2;
      best = cand;
    }
  }
  if (!best) return;
  ent.fireCooldownTicks = weapon.cooldownTicks;
  ent.turretYaw = Math.atan2(best.x - ent.x, best.z - ent.z);
  best.hp = Math.min(best.maxHp, best.hp + (weapon.healPerShot ?? 40));
  state.events.push({
    type: 'combat:fire',
    attackerId: ent.id,
    attackerTypeId: ent.typeId,
    targetId: best.id,
    x: ent.x,
    z: ent.z,
    tx: best.x,
    tz: best.z,
    damageType: 'Prism'
  });
}

function fireWeapon(state, attacker, target, weapon, prismCtx) {
  attacker.fireCooldownTicks = (attacker.typeId === 'ifv' && attacker.cargoList?.length > 0)
    ? weapon.cooldownTicks
    : (attacker.cooldownTicks || weapon.cooldownTicks);
  attacker.recoil = attacker.isBuilding ? 0.25 : 0.45;
  attacker.lastCombatTick = state.tickCount;

  const burst = weapon.burst ?? attacker.burst ?? 1;
  // Enforce Airforce radar-pad ammo consumption & auto-RTB (expend sortie burst)
  const def = ENTITY_DEFS[attacker.typeId];
  if (def?.maxAmmo > 0) {
    attacker.ammo = Math.max(0, (attacker.ammo ?? 0) - burst);
    if (attacker.ammo === 0) {
      attacker.airState = 'A_RETURNING';
    }
  }

  // Temporary stealth reveal windows upon firing (T3.3 Nighthawk & T3.4 Typhoon)
  if (attacker.typeId === 'typhoon') attacker.surfacedTicks = 45;
  if (attacker.typeId === 'nighthawk') attacker.revealTicks = 30;

  // Rotate turret smoothly toward target
  const dx = target.x - attacker.x;
  const dz = target.z - attacker.z;
  attacker.turretYaw = Math.atan2(dx, dz);

  const useWeaponDamage = attacker.typeId === 'ifv' && attacker.cargoList?.length > 0;
  const basePerShot = (target.domain === 'AIR' && weapon.antiAirDamage)
    ? weapon.antiAirDamage
    : (useWeaponDamage ? weapon.damage : attacker.damage);
  let rawTotal = basePerShot * burst;

  // Dolphin sonar anti-submarine bonus (150% vs SUBMERGED)
  if (weapon.subMult && target.domain === 'SUBMERGED') {
    rawTotal *= weapon.subMult;
  }

  // Prism Tower convergence: up to 4 adjacent idle powered Prism Towers add +50% each (max 300%)
  if (attacker.typeId === 'prism_tower') {
    let supportCount = 0;
    for (let i = 0; i < state.entities.length && supportCount < 4; i++) {
      const other = state.entities[i];
      if (!other.alive || other.id === attacker.id || other.typeId !== 'prism_tower') continue;
      if (other.playerId !== attacker.playerId || other.empTicks > 0 || other.frozenByCount > 0) continue;
      if (state.players[other.playerId]?.isLowPower || other.fireCooldownTicks > 6) continue;
      if (Math.hypot(other.x - attacker.x, other.z - attacker.z) <= 12.0) {
        supportCount++;
        other.fireCooldownTicks = Math.max(other.fireCooldownTicks, 20);
        other.turretYaw = Math.atan2(attacker.x - other.x, attacker.z - other.z);
        state.events.push({
          type: 'combat:fire',
          attackerId: other.id,
          attackerTypeId: other.typeId,
          targetId: attacker.id,
          x: other.x,
          z: other.z,
          tx: attacker.x,
          tz: attacker.z,
          damageType: 'Prism'
        });
      }
    }
    rawTotal *= 1 + 0.5 * supportCount;
  }

  const mult = getArmorMultiplier(weapon.damageType, target, attacker);
  const expectedDmg = rawTotal * mult * (target.damageTakenMult ?? 1.0);

  state.events.push({
    type: 'combat:fire',
    attackerId: attacker.id,
    attackerTypeId: attacker.typeId,
    targetId: target.id,
    x: attacker.x,
    z: attacker.z,
    tx: target.x,
    tz: target.z,
    damageType: weapon.damageType
  });

  if (!weapon.projectileSpeed || weapon.projectileSpeed <= 0) {
    applyDamage(state, target, rawTotal, weapon.damageType, attacker, attacker.playerId);

    // Prism Tank Beam Splitting: up to 5 secondary rays, global cap 128/tick, marginal decay 0.7^{k-3} for k > 3
    if (attacker.typeId === 'prism' && weapon.prismSplits > 0 && prismCtx && prismCtx.globalSplits < 128) {
      const splitRange2 = 10.0 * 10.0;
      const candidates = [];
      for (let i = 0; i < state.entities.length; i++) {
        const cand = state.entities[i];
        if (!cand.alive || cand.id === target.id || cand.teamId === attacker.teamId || cand.teamId === 3) continue;
        if (cand.domain === 'AIR' || cand.frozenByCount > 0) continue;
        if (!isEntityTargetable(state, attacker.teamId, cand)) continue;
        const sdx = cand.x - target.x;
        const sdz = cand.z - target.z;
        const d2 = sdx * sdx + sdz * sdz;
        if (d2 <= splitRange2) {
          candidates.push({ cand, d2 });
        }
      }
      candidates.sort((a, b) => a.d2 - b.d2);
      const maxRays = Math.min(weapon.prismSplits, candidates.length, 128 - prismCtx.globalSplits);
      for (let r = 0; r < maxRays; r++) {
        const sec = candidates[r].cand;
        const k = (prismCtx.targetHits.get(sec.id) ?? 0) + 1;
        prismCtx.targetHits.set(sec.id, k);
        const decay = k <= 3 ? 1.0 : Math.pow(0.7, k - 3);
        const splitRaw = rawTotal * 0.55 * decay;
        applyDamage(state, sec, splitRaw, 'Prism', attacker, attacker.playerId);
        prismCtx.globalSplits++;
        state.events.push({
          type: 'combat:fire',
          attackerId: attacker.id,
          attackerTypeId: attacker.typeId,
          targetId: sec.id,
          x: target.x,
          z: target.z,
          tx: sec.x,
          tz: sec.z,
          damageType: 'Prism'
        });
      }
    }
    return;
  }

  target.pendingDamage += expectedDmg;
  const dist = Math.hypot(dx, dz);
  const projSpeed = weapon.projectileSpeed;

  state.projectiles.push({
    id: state.nextProjectileId++,
    attackerId: attacker.id,
    attackerTypeId: attacker.typeId,
    attackerPlayerId: attacker.playerId,
    attackerTeamId: attacker.teamId,
    targetId: target.id,
    damageType: weapon.damageType,
    baseDamage: rawTotal,
    reservedDamage: expectedDmg,
    released: false,
    interceptable: Boolean(weapon.interceptable),
    splashRadius: weapon.splashRadius ?? 0,
    x: attacker.x,
    y: (attacker.y ?? 1.6) + 1.5,
    z: attacker.z,
    prevX: attacker.x,
    prevY: (attacker.y ?? 1.6) + 1.5,
    prevZ: attacker.z,
    targetX: target.x,
    targetY: (target.y ?? 1.6) + 0.9,
    targetZ: target.z,
    speed: projSpeed,
    ttlTicks: Math.max(15, Math.ceil((dist / projSpeed) * 30) + 25)
  });
}

export function stepCombatAndProjectiles(state) {
  // 0. Chrono Legionnaire / Chrono IFV phase lock & erasure pre-pass (updates frozenByCount deterministically)
  stepChronoLocks(state);

  const prismCtx = { globalSplits: 0, targetHits: new Map() };

  // 1. Units & defensive structures acquire targets and fire
  const entities = state.entities;
  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent.alive) continue;
    if (ent.fireCooldownTicks > 0) ent.fireCooldownTicks--;

    const weapon = getActiveWeapon(ent);
    if (!isWeaponOperational(state, ent, weapon)) continue;
    if (weapon.damageType === 'Chrono') continue; // Resolved deterministically in stepChronoLocks
    if (weapon.damageType === 'Repair') {
      if (ent.fireCooldownTicks === 0) stepIfvRepair(state, ent, weapon);
      continue;
    }

    // Shadow Hero C4 close-quarters demolition on enemy buildings & naval vessels
    if (ent.typeId === 'shadow' && ent.c4CooldownTicks === 0 && ent.attackTargetId !== null) {
      const c4Target = state.entityById.get(ent.attackTargetId);
      if (
        c4Target &&
        c4Target.alive &&
        c4Target.teamId !== ent.teamId &&
        c4Target.teamId !== 3 &&
        (c4Target.isBuilding || c4Target.domain === 'SEA' || c4Target.domain === 'SUBMERGED')
      ) {
        const reach = (c4Target.radius ?? 1.5) + 2.4;
        if (Math.hypot(c4Target.x - ent.x, c4Target.z - ent.z) <= reach) {
          ent.c4CooldownTicks = 60;
          ent.attackTargetId = null;
          ent.moveTargetX = null;
          ent.moveTargetZ = null;
          ent.orderType = 'IDLE';
          applyDamage(state, c4Target, 999999, 'HighExplosive', ent, ent.playerId);
          state.events.push({ type: 'fx:explosion', x: c4Target.x, y: c4Target.y ?? 1.6, z: c4Target.z, scale: 1.8 });
          continue;
        }
        ent.moveTargetX = c4Target.x;
        ent.moveTargetZ = c4Target.z;
        ent.moveStopDist = Math.max(1.2, (c4Target.radius ?? 1.5) + 1.2);
        continue;
      }
    }

    // Hold fire when idle harvester? Harvester still defends itself if enemy closes in!
    const target = selectTargetForEntity(state, ent, weapon);
    if (!target) {
      // AA Turret can intercept in-flight V3/Dreadnought ballistic rockets within 24m
      if (ent.typeId === 'aa_turret' && ent.fireCooldownTicks === 0) {
        const aaRange = weapon.range ?? 24;
        for (let pIdx = 0; pIdx < state.projectiles.length; pIdx++) {
          const proj = state.projectiles[pIdx];
          if (!proj.interceptable || proj.released || proj.intercepted) continue;
          if (proj.attackerTeamId === ent.teamId) continue;
          if (Math.hypot(proj.x - ent.x, proj.z - ent.z) <= aaRange) {
            ent.fireCooldownTicks = ent.cooldownTicks || weapon.cooldownTicks;
            ent.turretYaw = Math.atan2(proj.x - ent.x, proj.z - ent.z);
            releaseProjectileReservation(state, proj);
            proj.intercepted = true;
            state.events.push({
              type: 'combat:fire',
              attackerId: ent.id,
              attackerTypeId: ent.typeId,
              targetId: null,
              x: ent.x,
              z: ent.z,
              tx: proj.x,
              tz: proj.z,
              damageType: weapon.damageType
            });
            state.events.push({ type: 'fx:explosion', x: proj.x, y: proj.y, z: proj.z, scale: 0.7 });
            break;
          }
        }
      }
      continue;
    }

    // Attack-move pauses briefly to engage targets in range cleanly
    if (ent.orderType === 'ATTACK_MOVE' && ent.fireCooldownTicks === 0) {
      fireWeapon(state, ent, target, weapon, prismCtx);
    } else if (ent.fireCooldownTicks === 0) {
      fireWeapon(state, ent, target, weapon, prismCtx);
    }
  }

  // 2. Advance in-flight projectiles & release reservations idempotently
  const projs = state.projectiles;
  let write = 0;
  for (let i = 0; i < projs.length; i++) {
    const p = projs[i];
    if (p.intercepted) continue;
    p.prevX = p.x;
    p.prevY = p.y;
    p.prevZ = p.z;
    p.ttlTicks--;

    const target = state.entityById.get(p.targetId);
    if (target && target.alive) {
      p.targetX = target.x;
      p.targetY = (target.y ?? 1.6) + 0.9;
      p.targetZ = target.z;
    }

    const dx = p.targetX - p.x;
    const dy = p.targetY - p.y;
    const dz = p.targetZ - p.z;
    const dist = Math.hypot(dx, dy, dz);
    const stepDist = p.speed * TICK_DT;

    if (dist <= stepDist + 0.45) {
      releaseProjectileReservation(state, p);
      const attacker = state.entityById.get(p.attackerId) ?? { typeId: p.attackerTypeId, alive: false, playerId: p.attackerPlayerId };
      if (target && target.alive) {
        applyDamage(state, target, p.baseDamage, p.damageType, attacker, p.attackerPlayerId);
      }
      if (p.splashRadius > 0) {
        const sr2 = p.splashRadius * p.splashRadius;
        for (let k = 0; k < entities.length; k++) {
          const near = entities[k];
          if (!near.alive || near.id === p.targetId || near.domain === 'AIR' || near.teamId === p.attackerTeamId || near.teamId === 3) continue;
          const sd2 = (near.x - p.targetX) ** 2 + (near.z - p.targetZ) ** 2;
          if (sd2 <= sr2) {
            const falloff = Math.max(0.25, 1.0 - Math.sqrt(sd2) / p.splashRadius);
            applyDamage(state, near, p.baseDamage * falloff, p.damageType, attacker, p.attackerPlayerId);
          }
        }
      }
      state.events.push({ type: 'fx:impact', x: p.targetX, y: p.targetY, z: p.targetZ, damageType: p.damageType });
      continue;
    }

    if (p.ttlTicks <= 0) {
      releaseProjectileReservation(state, p);
      continue;
    }

    const inv = stepDist / dist;
    p.x += dx * inv;
    p.y += dy * inv;
    p.z += dz * inv;
    projs[write++] = p;
  }
  projs.length = write;

  // Compact destroyed entities once per tick cleanly
  compactDeadEntities(state);
}

export function checkVictoryCondition(state) {
  if (state.mode === 'bench' || state.winnerTeamId !== null || state.tickCount === 0) {
    return;
  }

  const activeTeamsWithHqAssets = new Set();
  for (let i = 0; i < state.entities.length; i++) {
    const ent = state.entities[i];
    if (!ent.alive) continue;
    if (ent.category === 'neutral') continue;
    if (ent.isBuilding || ent.typeId === 'mcv') {
      activeTeamsWithHqAssets.add(ent.teamId);
    }
  }

  if (activeTeamsWithHqAssets.size >= 2) {
    state.hadMultipleHqTeams = true;
  }

  if (state.hadMultipleHqTeams && activeTeamsWithHqAssets.size <= 1) {
    state.winnerTeamId = activeTeamsWithHqAssets.size === 1 ? [...activeTeamsWithHqAssets][0] : -1;
    state.events.push({ type: 'match:ended', winnerTeamId: state.winnerTeamId });
  }
}
