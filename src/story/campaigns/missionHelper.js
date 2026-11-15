// Shared campaign mission scaffolding helpers (zero duplication across A01..A06, C01..C06, EX13).

import { spawnEntity, findNearestPassableLand } from '../../gameplay/entities.js';
import { ENTITY_DEFS } from '../../core/config.js';

export function spawnMissionGroup(state, playerId, factionId, list) {
  const teamId = state.players[playerId]?.teamId ?? playerId;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const def = ENTITY_DEFS[item.typeId];
    if (!def) continue;
    if (def.isBuilding) {
      const gx = item.gx ?? Math.round((item.x ?? 100) / 2);
      const gz = item.gz ?? Math.round((item.z ?? 100) / 2);
      const ent = spawnEntity(state, {
        typeId: item.typeId,
        playerId,
        teamId,
        factionId: item.factionId ?? factionId,
        gx,
        gz,
        campaignTag: item.tag ?? null
      });
      if (item.hpMult) {
        ent.maxHp = Math.round(ent.maxHp * item.hpMult);
        ent.hp = ent.maxHp;
      }
      out.push(ent);
    } else {
      const count = item.count ?? 1;
      for (let k = 0; k < count; k++) {
        const ox = ((k % 3) - 1) * 3.5;
        const oz = Math.floor(k / 3) * 3.5;
        const wx = (item.x ?? 100) + ox;
        const wz = (item.z ?? 100) + oz;
        const pos = def.domain === 'GROUND' ? findNearestPassableLand(state.map, wx, wz) : { x: wx, z: wz };
        const ent = spawnEntity(state, {
          typeId: item.typeId,
          playerId,
          teamId,
          factionId: item.factionId ?? factionId,
          x: pos.x,
          z: pos.z,
          campaignTag: item.tag ?? null
        });
        out.push(ent);
      }
    }
  }
  return out;
}

export function clearLandingZone(map, cx, cz, radiusCells = 12) {
  for (let dz = -radiusCells; dz <= radiusCells; dz++) {
    for (let dx = -radiusCells; dx <= radiusCells; dx++) {
      const gx = cx + dx;
      const gz = cz + dz;
      if (gx < 2 || gz < 2 || gx >= map.width - 2 || gz >= map.height - 2) continue;
      if (dx * dx + dz * dz <= radiusCells * radiusCells) {
        const idx = gz * map.width + gx;
        if (map.terrain[idx] === 3) map.terrain[idx] = 0; // Flatten impassable cliff around scripted LZ
      }
    }
  }
}
