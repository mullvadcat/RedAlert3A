// 30 Hz Naval Fleet Systems, Naval Yard Auto-Repair, and 5-State Carrier Drone FSM (T3.4).
// Pure ESM (L3): imports only L0-L2 modules (zero cross-L3 / DOM / WebGL imports).

import { ENTITY_DEFS, TICK_DT, getArmorMultiplier } from '../core/config.js';
import { isEntityTargetable } from './fogCpu.js';

export function releaseDroneReservation(state, drone) {
  if (!drone || drone.released) return;
  drone.released = true;
  if (drone.targetId !== null && drone.reservedDamage > 0) {
    const target = state.entityById.get(drone.targetId);
    if (target) {
      target.pendingDamage = Math.max(0, target.pendingDamage - drone.reservedDamage);
    }
  }
  drone.reservedDamage = 0;
}

function findCarrierStrikeTarget(state, carrier) {
  const maxRange = ENTITY_DEFS.carrier.weapon?.range ?? 38;
  const maxR2 = maxRange * maxRange;

  if (carrier.attackTargetId !== null) {
    const exp = state.entityById.get(carrier.attackTargetId);
    if (
      exp &&
      exp.alive &&
      exp.teamId !== carrier.teamId &&
      exp.teamId !== 3 &&
      exp.frozenByCount === 0 &&
      (exp.domain === 'GROUND' || exp.domain === 'SEA') &&
      isEntityTargetable(state, carrier.teamId, exp) &&
      Math.hypot(exp.x - carrier.x, exp.z - carrier.z) <= maxRange + (exp.radius ?? 0)
    ) {
      return exp;
    }
    carrier.attackTargetId = null;
  }

  let best = null;
  let bestD2 = Infinity;
  for (let i = 0; i < state.entities.length; i++) {
    const cand = state.entities[i];
    if (!cand.alive || cand.teamId === carrier.teamId || cand.teamId === 3) continue;
    if (cand.frozenByCount > 0 || (cand.domain !== 'GROUND' && cand.domain !== 'SEA')) continue;
    if (cand.hp - cand.pendingDamage <= 0) continue;
    if (!isEntityTargetable(state, carrier.teamId, cand)) continue;
    const dx = cand.x - carrier.x;
    const dz = cand.z - carrier.z;
    const d2 = dx * dx + dz * dz;
    const effR = maxRange + (cand.radius ?? 0);
    if (d2 <= effR * effR && d2 < bestD2 && d2 <= maxR2 + 16) {
      bestD2 = d2;
      best = cand;
    }
  }
  return best;
}

export function stepNaval(state) {
  const entities = state.entities;
  const navalYards = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e.alive && e.typeId === 'naval_yard') navalYards.push(e);
  }

  // 1. Naval Yard passive hull repair for friendly ships within 10.0m & Carrier 5-state Drone FSM
  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent.alive) continue;

    if ((ent.domain === 'SEA' || ent.domain === 'SUBMERGED') && ent.frozenByCount === 0 && ent.hp < ent.maxHp && navalYards.length > 0) {
      for (let ny = 0; ny < navalYards.length; ny++) {
        const yard = navalYards[ny];
        if (yard.playerId !== ent.playerId) continue;
        if (Math.hypot(ent.x - yard.x, ent.z - yard.z) <= 10.0) {
          ent.hp = Math.min(ent.maxHp, ent.hp + 14 * TICK_DT);
          break;
        }
      }
    }

    if (ent.typeId !== 'carrier' || !ent.drones) continue;
    if (ent.droneLaunchCooldown > 0) ent.droneLaunchCooldown--;

    const canLaunch = ent.empTicks === 0 && ent.frozenByCount === 0;
    const strikeTarget = canLaunch ? findCarrierStrikeTarget(state, ent) : null;
    const droneWeapon = ENTITY_DEFS.carrier.weapon;

    for (let dIdx = 0; dIdx < ent.drones.length; dIdx++) {
      const d = ent.drones[dIdx];
      const deckOx = (dIdx - 1.5) * 0.85;
      const deckX = ent.x + Math.cos(ent.yaw) * deckOx;
      const deckZ = ent.z - Math.sin(ent.yaw) * deckOx;

      if (d.fsmState === 'D_DOCKED') {
        d.x = deckX;
        d.y = ent.y + 2.2;
        d.z = deckZ;
        d.yaw = ent.yaw;
        if (strikeTarget && ent.droneLaunchCooldown <= 0 && (strikeTarget.hp - strikeTarget.pendingDamage > 0)) {
          const expectedDmg = Math.round(
            (droneWeapon.damage ?? 90) *
            getArmorMultiplier(droneWeapon.damageType ?? 'HighExplosive', strikeTarget, ent) *
            (strikeTarget.damageTakenMult ?? 1.0)
          );
          strikeTarget.pendingDamage += expectedDmg;
          d.fsmState = 'D_LAUNCHING';
          d.timerTicks = 8;
          d.targetId = strikeTarget.id;
          d.reservedDamage = expectedDmg;
          d.released = false;
          d.fuelTicks = 300;
          ent.droneLaunchCooldown = 12; // 0.4s launch interval between drones
        }
        continue;
      }

      if (d.fsmState === 'D_LAUNCHING') {
        d.y = Math.min(9.5, d.y + 0.9);
        d.timerTicks--;
        if (d.timerTicks <= 0) {
          d.fsmState = 'D_ATTACK_RUN';
        }
        continue;
      }

      if (d.fsmState === 'D_ATTACK_RUN') {
        d.fuelTicks--;
        const target = d.targetId !== null ? state.entityById.get(d.targetId) : null;
        if (!target || !target.alive || d.fuelTicks <= 0) {
          releaseDroneReservation(state, d);
          d.fsmState = 'D_RETURNING';
          continue;
        }
        const dx = target.x - d.x;
        const dz = target.z - d.z;
        const dist = Math.hypot(dx, dz);
        d.yaw = Math.atan2(dx, dz);
        const step = 28 * TICK_DT;

        if (dist <= step + 2.2) {
          // Transfer reservation cleanly into terminal bomb projectile resolved in stepCombatAndProjectiles
          const resDmg = d.reservedDamage;
          d.released = true;
          d.reservedDamage = 0;
          state.projectiles.push({
            id: state.nextProjectileId++,
            attackerId: ent.id,
            attackerTypeId: 'carrier',
            attackerPlayerId: ent.playerId,
            attackerTeamId: ent.teamId,
            targetId: target.id,
            damageType: droneWeapon.damageType ?? 'HighExplosive',
            baseDamage: droneWeapon.damage ?? 90,
            reservedDamage: resDmg,
            released: false,
            interceptable: false,
            splashRadius: 2.0,
            x: d.x,
            y: d.y,
            z: d.z,
            prevX: d.x,
            prevY: d.y,
            prevZ: d.z,
            targetX: target.x,
            targetY: (target.y ?? 1.6) + 0.8,
            targetZ: target.z,
            speed: 999,
            ttlTicks: 3
          });
          d.fsmState = 'D_RETURNING';
        } else {
          const inv = step / dist;
          d.x += dx * inv;
          d.z += dz * inv;
          d.y += (9.0 - d.y) * 0.2;
        }
        continue;
      }

      if (d.fsmState === 'D_RETURNING') {
        const dx = deckX - d.x;
        const dz = deckZ - d.z;
        const dist = Math.hypot(dx, dz);
        d.yaw = Math.atan2(dx, dz);
        const step = 26 * TICK_DT;
        if (dist <= step + 1.5) {
          d.x = deckX;
          d.z = deckZ;
          d.y = ent.y + 2.2;
          d.fsmState = 'D_REARMING';
          d.timerTicks = 75; // 2.5s rearm on deck
        } else {
          const inv = step / dist;
          d.x += dx * inv;
          d.z += dz * inv;
          d.y += (ent.y + 5.5 - d.y) * 0.16;
        }
        continue;
      }

      if (d.fsmState === 'D_REARMING') {
        d.x = deckX;
        d.y = ent.y + 2.2;
        d.z = deckZ;
        d.yaw = ent.yaw;
        if (d.timerTicks > 0) d.timerTicks--;
        if (d.timerTicks <= 0) {
          d.fsmState = 'D_DOCKED';
        }
      }
    }
  }

  // 2. Orphan airborne drones from sunk Carriers: drain remaining fuel, crash & idempotently release pendingDamage
  if (state.orphanDrones && state.orphanDrones.length > 0) {
    const aliveOrphans = [];
    for (let i = 0; i < state.orphanDrones.length; i++) {
      const d = state.orphanDrones[i];
      d.fuelTicks--;
      d.x += Math.sin(d.yaw) * 14 * TICK_DT;
      d.z += Math.cos(d.yaw) * 14 * TICK_DT;
      d.y = Math.max(0.2, d.y - 0.18);
      if (d.fuelTicks <= 0) {
        releaseDroneReservation(state, d);
        state.events.push({ type: 'fx:explosion', x: d.x, y: d.y, z: d.z, scale: 0.55 });
      } else {
        aliveOrphans.push(d);
      }
    }
    state.orphanDrones = aliveOrphans;
  }
}
