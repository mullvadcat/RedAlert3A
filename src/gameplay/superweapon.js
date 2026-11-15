// 30 Hz Deterministic Superweapons (Chrono Sphere, Iron Curtain, Weather Storm, Nuclear Silo)
// and F1~F4 Commander Doctrines (L3 Gameplay Module: imports L0-L2 only).

import {
  DOCTRINE_DEFS,
  ENTITY_DEFS,
  FACTIONS,
  SUPERWEAPON_IDS,
  nextRandom
} from '../core/config.js';
import {
  CELL_SIZE,
  MAP_SIZE,
  TERRAIN,
  WORLD_SIZE,
  getElevationAtWorld,
  worldToGrid
} from '../world/map.js';
import {
  findNearestPassableLand,
  removeEntity,
  spawnEntity
} from './entities.js';

function clampWorldCoord(v) {
  return Math.max(4, Math.min(WORLD_SIZE - 4, v));
}

function findNearestSeaPoint(map, worldX, worldZ, maxRadiusCells = 8) {
  const cgx = worldToGrid(worldX);
  const cgz = worldToGrid(worldZ);
  for (let r = 0; r <= maxRadiusCells; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const gx = cgx + dx;
        const gz = cgz + dz;
        if (gx < 1 || gx >= MAP_SIZE - 1 || gz < 1 || gz >= MAP_SIZE - 1) continue;
        const idx = gz * MAP_SIZE + gx;
        if (map.terrain[idx] === TERRAIN.SEA && map.buildingId[idx] === 0) {
          return {
            x: (gx + 0.5) * CELL_SIZE,
            z: (gz + 0.5) * CELL_SIZE,
            elev: Math.max(0, map.elevation[idx])
          };
        }
      }
    }
  }
  return null;
}

function findNearestLandPoint(map, worldX, worldZ, amphibious = false, maxRadiusCells = 8) {
  const cgx = worldToGrid(worldX);
  const cgz = worldToGrid(worldZ);
  for (let r = 0; r <= maxRadiusCells; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue;
        const gx = cgx + dx;
        const gz = cgz + dz;
        if (gx < 1 || gx >= MAP_SIZE - 1 || gz < 1 || gz >= MAP_SIZE - 1) continue;
        const idx = gz * MAP_SIZE + gx;
        const t = map.terrain[idx];
        const passable =
          t === TERRAIN.LAND ||
          t === TERRAIN.BRIDGE ||
          (amphibious && (t === TERRAIN.SHALLOW || t === TERRAIN.SEA));
        if (passable && map.buildingId[idx] === 0) {
          return {
            x: (gx + 0.5) * CELL_SIZE,
            z: (gz + 0.5) * CELL_SIZE,
            elev: Math.max(0, map.elevation[idx])
          };
        }
      }
    }
  }
  return findNearestPassableLand(map, worldX, worldZ, maxRadiusCells);
}

export function fireSuperweapon(state, playerId, swTypeId, targetX, targetZ, sourceX, sourceZ, applyDamageFn) {
  const player = state.players[playerId];
  const def = ENTITY_DEFS[swTypeId];
  if (!player || !def || def.category !== 'superweapon') return false;

  const hasBuilding = state.entities.some((e) => e.alive && e.playerId === playerId && e.typeId === swTypeId);
  if (!hasBuilding || player.isLowPower) return false;

  const swState = player.superweapons?.[swTypeId];
  if (!swState || swState.remainingTicks > 0) return false;

  const tx = clampWorldCoord(targetX ?? 256);
  const tz = clampWorldCoord(targetZ ?? 256);
  const sx = clampWorldCoord(sourceX ?? tx);
  const sz = clampWorldCoord(sourceZ ?? tz);

  // Reset cooldown immediately on trigger
  swState.remainingTicks = def.superweaponCooldownTicks;

  if (swTypeId === 'chrono_sphere') {
    const halfBox = 3.5; // 3x3 grid cell window (6m x 6m around center)
    const snapshot = state.entities.slice();
    let shifted = 0;

    for (let i = 0; i < snapshot.length; i++) {
      const ent = snapshot[i];
      if (!ent.alive || ent.playerId !== playerId || ent.isBuilding) continue;
      if (ent.domain === 'AIR' || ent.frozenByCount > 0) continue;
      if (Math.abs(ent.x - sx) > halfBox || Math.abs(ent.z - sz) > halfBox) continue;

      if (ent.category === 'infantry') {
        // Biological infantry caught in raw chrono field are erased
        removeEntity(state, ent.id, 'erased');
        continue;
      }

      const ox = ent.x - sx;
      const oz = ent.z - sz;
      const desiredX = clampWorldCoord(tx + ox);
      const desiredZ = clampWorldCoord(tz + oz);
      const isAmphib = Boolean(ENTITY_DEFS[ent.typeId]?.amphibious);

      let landing = null;
      if (ent.domain === 'SEA' && !isAmphib) {
        landing = findNearestSeaPoint(state.map, desiredX, desiredZ, 8);
      } else {
        landing = findNearestLandPoint(state.map, desiredX, desiredZ, isAmphib, 8);
      }
      if (!landing) continue;

      ent.x = landing.x;
      ent.z = landing.z;
      ent.prevX = landing.x;
      ent.prevZ = landing.z;
      ent.y = landing.elev;
      ent.prevY = landing.elev;
      ent.moveTargetX = null;
      ent.moveTargetZ = null;
      ent.orderType = 'IDLE';
      shifted++;
    }

    state.events.push({ type: 'fx:chronoWarp', x: sx, z: sz, tx, tz, count: shifted });
    state.events.push({ type: 'hud:notice', playerId, key: 'hud.status.swTriggered', x: tx, z: tz });
    return true;
  }

  if (swTypeId === 'iron_curtain') {
    const halfBox = 3.5; // 3x3 cell target zone
    const snapshot = state.entities.slice();
    let shielded = 0;

    for (let i = 0; i < snapshot.length; i++) {
      const ent = snapshot[i];
      if (!ent.alive || ent.playerId !== playerId || ent.isBuilding || ent.frozenByCount > 0) continue;
      if (Math.abs(ent.x - tx) > halfBox || Math.abs(ent.z - tz) > halfBox) continue;

      if (ent.category === 'infantry') {
        // Biological infantry exposed to Iron Curtain perish instantly
        removeEntity(state, ent.id, 'destroyed');
        continue;
      }
      // Protects mobile GROUND/SEA vehicles + Kirov airships (excludes jets/nighthawk)
      if (ent.domain === 'AIR' && ent.typeId !== 'kirov') continue;

      ent.ironCurtainTicks = 450; // 15s invulnerability
      shielded++;
    }

    state.events.push({ type: 'fx:ironCurtain', x: tx, z: tz, count: shielded, playerId });
    state.events.push({ type: 'hud:notice', playerId, key: 'hud.status.swTriggered', x: tx, z: tz });
    return true;
  }

  if (swTypeId === 'nuclear_silo' || swTypeId === 'weather_control') {
    // 6.0s (180-tick) global warning ring counter-play window before detonation/storm
    const warningId = state.nextAreaEffectId ? state.nextAreaEffectId++ : state.tickCount;
    state.areaEffects.push({
      id: warningId,
      type: 'sw_warning',
      kind: 'sw_warning',
      swTypeId,
      ownerPlayerId: playerId,
      teamId: player.teamId,
      x: tx,
      z: tz,
      radius: 18.0,
      expiryTick: state.tickCount + 180
    });
    state.events.push({
      type: 'sw:warning',
      swTypeId,
      ownerPlayerId: playerId,
      x: tx,
      z: tz,
      impactTick: state.tickCount + 180
    });
    state.events.push({
      type: 'hud:notice',
      playerId: 0,
      globalAlert: true,
      key: swTypeId === 'nuclear_silo' ? 'hud.status.swWarningNuke' : 'hud.status.swWarningStorm',
      x: tx,
      z: tz
    });
    return true;
  }

  void applyDamageFn;
  return false;
}

export function castDoctrine(state, playerId, doctrineKey, targetX, targetZ) {
  const player = state.players[playerId];
  const def = DOCTRINE_DEFS[doctrineKey];
  if (!player || !def) return false;

  if ((player.doctrines?.[doctrineKey] ?? 0) > 0) return false;
  const tx = clampWorldCoord(targetX ?? 256);
  const tz = clampWorldCoord(targetZ ?? 256);

  if (doctrineKey === 'paratroopers') {
    const hasAirSupport = state.entities.some(
      (e) => e.alive && e.playerId === playerId && (e.typeId === 'airforce_radar' || e.typeId === 'tech_airport')
    );
    if (!hasAirSupport) {
      if (player.isHuman) {
        state.events.push({ type: 'hud:notice', playerId, key: 'hud.status.doctrineNoRadar' });
      }
      return false;
    }

    player.doctrines[doctrineKey] = def.cooldownTicks;
    const isCrimson = player.factionId === FACTIONS.crimson.id;
    const unitTypeId = isCrimson ? 'conscript' : 'gi';
    const unitCount = isCrimson ? def.crimsonCount : def.abyssalCount;

    for (let i = 0; i < unitCount; i++) {
      const ang = (i / unitCount) * Math.PI * 2;
      const dist = 1.6 + (i % 2) * 1.4;
      const spot = findNearestLandPoint(state.map, tx + Math.cos(ang) * dist, tz + Math.sin(ang) * dist, false, 6);
      if (!spot) continue;
      spawnEntity(state, {
        typeId: unitTypeId,
        playerId,
        teamId: player.teamId,
        factionId: player.factionId,
        x: spot.x,
        z: spot.z
      });
    }
    state.events.push({ type: 'fx:doctrineCast', doctrineKey, playerId, x: tx, z: tz });
    return true;
  }

  player.doctrines[doctrineKey] = def.cooldownTicks;

  if (doctrineKey === 'recon_satellite') {
    state.areaEffects.push({
      id: state.nextAreaEffectId ? state.nextAreaEffectId++ : state.tickCount,
      type: 'satellite',
      kind: 'satellite',
      teamId: player.teamId,
      ownerPlayerId: playerId,
      x: tx,
      z: tz,
      radius: def.radius,
      expiryTick: state.tickCount + def.durationTicks
    });
    state.events.push({ type: 'fx:doctrineCast', doctrineKey, playerId, x: tx, z: tz });
    return true;
  }

  if (doctrineKey === 'nano_repair') {
    const r2 = def.radius * def.radius;
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!ent.alive || ent.teamId !== player.teamId || ent.frozenByCount > 0) continue;
      const dx = ent.x - tx;
      const dz = ent.z - tz;
      if (dx * dx + dz * dz <= r2) {
        ent.hp = Math.min(ent.maxHp, ent.hp + Math.round(ent.maxHp * def.healRatio));
      }
    }
    state.events.push({ type: 'fx:doctrineCast', doctrineKey, playerId, x: tx, z: tz });
    return true;
  }

  if (doctrineKey === 'emp_strike') {
    const r2 = def.radius * def.radius;
    for (let i = 0; i < state.entities.length; i++) {
      const ent = state.entities[i];
      if (!ent.alive || ent.teamId === player.teamId || ent.teamId === 3) continue;
      const entDef = ENTITY_DEFS[ent.typeId];
      const isMechanicalOrPowered = ent.isBuilding ? Boolean(entDef?.requiresPower) : ent.category !== 'infantry';
      if (!isMechanicalOrPowered) continue;
      const dx = ent.x - tx;
      const dz = ent.z - tz;
      if (dx * dx + dz * dz <= r2) {
        ent.empTicks = Math.max(ent.empTicks ?? 0, def.durationTicks);
      }
    }
    state.events.push({ type: 'fx:doctrineCast', doctrineKey, playerId, x: tx, z: tz });
    return true;
  }

  return false;
}

function triggerNuclearDetonation(state, fx, applyDamageFn) {
  const entities = state.entities.slice();
  const radius = fx.radius ?? 18.0;
  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent.alive) continue;
    const dist = Math.hypot(ent.x - fx.x, ent.z - fx.z);
    if (dist <= radius + (ent.radius ?? 0)) {
      const falloff = Math.max(0.25, 1.0 - dist / radius);
      applyDamageFn(state, ent, 1200 * falloff, 'HighExplosive', null, fx.ownerPlayerId ?? null);
    }
  }

  state.areaEffects.push({
    id: state.nextAreaEffectId ? state.nextAreaEffectId++ : state.tickCount,
    type: 'radiation',
    kind: 'radiation',
    x: fx.x,
    z: fx.z,
    radius: 14.0,
    damagePerTick: 45 / 30,
    expiryTick: state.tickCount + 900, // 30s fallout zone
    ownerPlayerId: fx.ownerPlayerId ?? null
  });

  state.events.push({
    type: 'fx:explosion',
    x: fx.x,
    y: getElevationAtWorld(state.map, fx.x, fx.z) + 1.0,
    z: fx.z,
    scale: 5.5
  });
  state.events.push({ type: 'fx:nukeBlast', x: fx.x, z: fx.z });
}

function triggerLightningStrike(state, fx, applyDamageFn) {
  const angle = nextRandom(state) * Math.PI * 2;
  const dist = Math.sqrt(nextRandom(state)) * (fx.radius ?? 18.0);
  const sx = clampWorldCoord(fx.x + Math.cos(angle) * dist);
  const sz = clampWorldCoord(fx.z + Math.sin(angle) * dist);

  const entities = state.entities.slice();
  const hitRadius = 6.0;
  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    if (!ent.alive) continue;
    if (Math.hypot(ent.x - sx, ent.z - sz) <= hitRadius + (ent.radius ?? 0)) {
      applyDamageFn(state, ent, 280, 'HighExplosive', null, fx.ownerPlayerId ?? null);
    }
  }

  const elev = getElevationAtWorld(state.map, sx, sz);
  state.events.push({ type: 'fx:explosion', x: sx, y: elev + 0.5, z: sz, scale: 2.0 });
  state.events.push({ type: 'fx:lightningStrike', x: sx, y: elev, z: sz });
}

export function stepSuperweaponsAndAreaEffectsCore(state, applyDamageFn) {
  // 1. Update Doctrine timers and Superweapon countdowns (paused while isLowPower === true)
  const players = state.players ?? [];
  for (let p = 0; p < players.length; p++) {
    const player = players[p];
    if (player.doctrines) {
      for (const k of Object.keys(player.doctrines)) {
        if (player.doctrines[k] > 0) player.doctrines[k]--;
      }
    }

    if (!player.superweapons) continue;
    for (let s = 0; s < SUPERWEAPON_IDS.length; s++) {
      const swId = SUPERWEAPON_IDS[s];
      const hasBuilt = state.entities.some(
        (e) => e.alive && e.playerId === player.playerId && e.typeId === swId
      );
      if (!hasBuilt) {
        player.superweapons[swId] = null;
        continue;
      }
      if (!player.superweapons[swId]) {
        player.superweapons[swId] = {
          remainingTicks: ENTITY_DEFS[swId].superweaponCooldownTicks
        };
      }
      const swState = player.superweapons[swId];
      if (!player.isLowPower && swState.remainingTicks > 0) {
        const prev = swState.remainingTicks;
        const step = state.fastBuild ? 10 : 1;
        swState.remainingTicks = Math.max(0, prev - step);
        if (prev > 0 && swState.remainingTicks === 0 && player.isHuman) {
          state.events.push({ type: 'hud:notice', playerId: player.playerId, key: 'hud.status.swReady' });
        }
      }
    }
  }

  // 2. Advance active AreaEffects (warnings, lightning storm bolts, radiation fallout, satellite expiry)
  if (!state.areaEffects || state.areaEffects.length === 0) return;
  const active = [];
  for (let i = 0; i < state.areaEffects.length; i++) {
    const fx = state.areaEffects[i];

    if (fx.kind === 'sw_warning') {
      if (state.tickCount >= fx.expiryTick) {
        if (fx.swTypeId === 'nuclear_silo') {
          triggerNuclearDetonation(state, fx, applyDamageFn);
        } else if (fx.swTypeId === 'weather_control') {
          state.areaEffects.push({
            id: state.nextAreaEffectId ? state.nextAreaEffectId++ : state.tickCount,
            type: 'lightning_storm',
            kind: 'lightning_storm',
            ownerPlayerId: fx.ownerPlayerId,
            x: fx.x,
            z: fx.z,
            radius: 18.0,
            strikesRemaining: 18,
            nextStrikeTick: state.tickCount,
            expiryTick: state.tickCount + 360 // 12s storm
          });
        }
        continue;
      }
      active.push(fx);
      continue;
    }

    if (fx.expiryTick <= state.tickCount) continue;

    if (fx.kind === 'lightning_storm') {
      while (fx.strikesRemaining > 0 && state.tickCount >= fx.nextStrikeTick) {
        triggerLightningStrike(state, fx, applyDamageFn);
        fx.strikesRemaining -= 1;
        fx.nextStrikeTick += 20;
      }
    } else if ((fx.kind === 'radiation' || fx.type === 'radiation') && fx.damagePerTick > 0) {
      for (let j = 0; j < state.entities.length; j++) {
        const ent = state.entities[j];
        if (!ent.alive || ent.domain === 'AIR') continue;
        if (Math.hypot(ent.x - fx.x, ent.z - fx.z) <= fx.radius) {
          applyDamageFn(state, ent, fx.damagePerTick, 'Radiation', null, fx.ownerPlayerId ?? null);
        }
      }
    }

    active.push(fx);
  }
  state.areaEffects = active;
}
