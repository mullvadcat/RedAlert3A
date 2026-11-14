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

function getActiveWeapon(ent) {
  const def = ENTITY_DEFS[ent.typeId];
  if (!def) return null;
  if (ent.typeId === 'gi' && ent.deployState === 'DEPLOYED') {
    return def.deployedWeapon;
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
  if (attacker.empTicks > 0 || attacker.frozenByCount > 0) return false;
  const def = ENTITY_DEFS[attacker.typeId];
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
  return weapon.targetDomains.includes(target.domain);
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

function fireWeapon(state, attacker, target, weapon) {
  attacker.fireCooldownTicks = attacker.cooldownTicks || weapon.cooldownTicks;
  attacker.recoil = attacker.isBuilding ? 0.25 : 0.45;
  attacker.lastCombatTick = state.tickCount;

  // Rotate turret smoothly toward target
  const dx = target.x - attacker.x;
  const dz = target.z - attacker.z;
  attacker.turretYaw = Math.atan2(dx, dz);

  const burst = attacker.burst ?? weapon.burst ?? 1;
  const basePerShot = (target.domain === 'AIR' && weapon.antiAirDamage)
    ? weapon.antiAirDamage
    : attacker.damage;
  let rawTotal = basePerShot * burst;

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
  // 1. Units & defensive structures acquire targets and fire
  const entities = state.entities;
  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent.alive) continue;
    if (ent.fireCooldownTicks > 0) ent.fireCooldownTicks--;

    const weapon = getActiveWeapon(ent);
    if (!isWeaponOperational(state, ent, weapon)) continue;

    // Hold fire when idle harvester? Harvester still defends itself if enemy closes in!
    const target = selectTargetForEntity(state, ent, weapon);
    if (!target) {
      // AA Turret can intercept in-flight V3 ballistic rockets within 24m
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
      fireWeapon(state, ent, target, weapon);
    } else if (ent.fireCooldownTicks === 0) {
      fireWeapon(state, ent, target, weapon);
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
