// 30 Hz Airforce Dispatch & Helipad / Vertical-Liftoff FSM (T3.3).
// Strictly distinguishes producerType === 'airforce_radar' (Stormhawk / Crimson MiG using 4-slot helipads)
// from producerType === 'war_factory' (Nighthawk / Kirov lifting off vertically without helipad slots).
// Pure ESM (L3): imports only L0-L2 modules (zero cross-L3 / DOM / WebGL imports).

import { ENTITY_DEFS, TICK_DT } from '../core/config.js';
import { MAP_SIZE, worldToGrid } from '../world/map.js';
import {
  findFreeAirpad,
  getAirpadWorldPos,
  removeEntity
} from './entities.js';

export function stepAirforce(state) {
  const entities = state.entities;
  const map = state.map;

  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent.alive || ent.domain !== 'AIR' || ent.frozenByCount > 0) continue;

    const def = ENTITY_DEFS[ent.typeId];
    if (!def) continue;

    const gx = worldToGrid(ent.x);
    const gz = worldToGrid(ent.z);
    const groundElev = map ? (map.elevation[gz * MAP_SIZE + gx] ?? 1.6) : 1.6;
    const cruiseY = Math.max(8.5, groundElev + (ent.typeId === 'kirov' ? 9.5 : 7.5));

    // War Factory air units (Nighthawk / Kirov) & Rocketeer smoothly maintain flight altitude
    if (def.producerType !== 'airforce_radar') {
      if (ent.typeId === 'nighthawk') {
        ent.isStealthed = true;
      }
      ent.y += (cruiseY - ent.y) * 0.16;
      continue;
    }

    // Strike fighters (Stormhawk / Crimson MiG): strictly bound to Airforce Radar helipads
    let radar = ent.homeId ? state.entityById.get(ent.homeId) : null;
    if (!radar || !radar.alive || radar.playerId !== ent.playerId || radar.typeId !== 'airforce_radar') {
      const alt = findFreeAirpad(state, ent.playerId);
      if (alt) {
        ent.homeId = alt.radar.id;
        ent.padIndex = alt.padIndex;
        radar = alt.radar;
      } else {
        ent.homeId = null;
        radar = null;
      }
    }

    // No friendly Airforce Radar remains -> loiter in holding circle draining fuel until crash
    if (!radar) {
      if (ent.airState === 'A_DOCKED' || ent.airState === 'A_REARMING') {
        ent.airState = 'A_AIRBORNE';
      }
      ent.y += (cruiseY - ent.y) * 0.14;
      ent.hp -= 12 * TICK_DT;
      if (ent.hp <= 0) {
        ent.hp = 0;
        state.events.push({ type: 'fx:explosion', x: ent.x, y: ent.y, z: ent.z, scale: 1.0 });
        removeEntity(state, ent.id, 'destroyed');
      }
      continue;
    }

    const padPos = getAirpadWorldPos(radar, ent.padIndex);

    if (ent.airState === 'A_DOCKED') {
      ent.x = padPos.x;
      ent.z = padPos.z;
      ent.prevX = padPos.x;
      ent.prevZ = padPos.z;
      ent.y += (padPos.y - ent.y) * 0.25;
      if (ent.hp < ent.maxHp) {
        ent.hp = Math.min(ent.maxHp, ent.hp + 15 * TICK_DT);
      }

      const hasSortieOrder =
        ent.attackTargetId !== null ||
        ent.moveTargetX !== null ||
        ent.orderType === 'ATTACK' ||
        ent.orderType === 'ATTACK_MOVE' ||
        ent.orderType === 'MOVE';

      if (hasSortieOrder && (ent.ammo ?? 0) > 0 && ent.empTicks === 0) {
        ent.airState = 'A_LAUNCHING';
      }
      continue;
    }

    if (ent.airState === 'A_LAUNCHING') {
      ent.y = Math.min(cruiseY, ent.y + 0.45);
      if (ent.y >= cruiseY - 0.35) {
        ent.y = cruiseY;
        ent.airState = 'A_AIRBORNE';
      }
      continue;
    }

    if (ent.airState === 'A_AIRBORNE') {
      ent.y += (cruiseY - ent.y) * 0.18;
      if ((ent.ammo ?? 0) <= 0) {
        ent.airState = 'A_RETURNING';
      } else if (ent.attackTargetId !== null) {
        const tgt = state.entityById.get(ent.attackTargetId);
        if (!tgt || !tgt.alive) {
          ent.attackTargetId = null;
          if ((ent.ammo ?? 0) < (def.maxAmmo ?? 1)) {
            ent.airState = 'A_RETURNING';
          }
        } else {
          ent.moveTargetX = tgt.x;
          ent.moveTargetZ = tgt.z;
          ent.moveStopDist = Math.max(4.0, (def.weapon?.range ?? 16) * 0.72);
        }
      }
      continue;
    }

    if (ent.airState === 'A_RETURNING') {
      ent.y += (cruiseY - ent.y) * 0.16;
      ent.attackTargetId = null;
      ent.moveTargetX = padPos.x;
      ent.moveTargetZ = padPos.z;
      ent.moveStopDist = 1.6;
      ent.orderType = 'RETURN';

      if (Math.hypot(ent.x - padPos.x, ent.z - padPos.z) <= 2.4) {
        ent.moveTargetX = null;
        ent.moveTargetZ = null;
        ent.orderType = 'IDLE';
        ent.airState = 'A_REARMING';
        ent.fsmTimerTicks = 0;
      }
      continue;
    }

    if (ent.airState === 'A_REARMING') {
      ent.x = padPos.x;
      ent.z = padPos.z;
      ent.y += (padPos.y - ent.y) * 0.22;
      if (ent.hp < ent.maxHp) {
        ent.hp = Math.min(ent.maxHp, ent.hp + 15 * TICK_DT);
      }
      const maxAmmo = def.maxAmmo ?? 1;
      ent.fsmTimerTicks = (ent.fsmTimerTicks ?? 0) + 1;
      if (ent.fsmTimerTicks >= 18) {
        ent.fsmTimerTicks = 0;
        if ((ent.ammo ?? 0) < maxAmmo) {
          ent.ammo = (ent.ammo ?? 0) + 1;
        }
      }
      if ((ent.ammo ?? 0) >= maxAmmo && Math.abs(ent.y - padPos.y) <= 0.15) {
        ent.y = padPos.y;
        ent.airState = 'A_DOCKED';
      }
    }
  }
}
