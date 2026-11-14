// Deterministic Analytical Parabolic Debris Pool (T2.3).
// Pure ESM: computes trajectories solely from immutable visual hash seed = hash32(buildingId ^ (tickCount * 0x9e3779b9)),
// never touching or advancing gameplay state.prngState.

import { hash32 } from '../core/events.js';

function nextVisualFloat(seedObj) {
  seedObj.seed = hash32(seedObj.seed + 0x9e3779b9);
  return (seedObj.seed >>> 0) / 4294967296;
}

export function createDebrisSystem(maxChunks = 256) {
  return {
    maxChunks,
    chunks: [],
    writeCursor: 0
  };
}

export function spawnBuildingDebris(
  debrisSys,
  buildingId,
  tickCount,
  x,
  y,
  z,
  footprintW = 2,
  footprintH = 2,
  debrisScale = 1.0
) {
  if (!debrisSys) return [];

  const count = Math.max(2, Math.min(10, Math.round((6 + Math.min(4, Math.max(footprintW, footprintH))) * debrisScale)));
  const seedState = {
    seed: hash32((buildingId >>> 0) ^ Math.imul(tickCount >>> 0, 0x9e3779b9))
  };

  const spawned = [];
  const spreadX = Math.max(1.2, footprintW * 0.75);
  const spreadZ = Math.max(1.2, footprintH * 0.75);

  for (let i = 0; i < count; i++) {
    const angle = nextVisualFloat(seedState) * Math.PI * 2;
    const horizSpeed = 4.5 + nextVisualFloat(seedState) * 9.5;
    const vy = 8.0 + nextVisualFloat(seedState) * 11.0;
    const ox = (nextVisualFloat(seedState) - 0.5) * spreadX;
    const oz = (nextVisualFloat(seedState) - 0.5) * spreadZ;
    const scaleBase = 0.45 + nextVisualFloat(seedState) * 0.65;
    const tint = nextVisualFloat(seedState);

    const chunk = {
      x: x + ox,
      y: y + 0.8 + nextVisualFloat(seedState) * 1.4,
      z: z + oz,
      vx: Math.cos(angle) * horizSpeed,
      vy,
      vz: Math.sin(angle) * horizSpeed,
      yaw: angle,
      pitch: nextVisualFloat(seedState) * Math.PI,
      angVelYaw: (nextVisualFloat(seedState) - 0.5) * 9.0,
      angVelPitch: (nextVisualFloat(seedState) - 0.5) * 11.0,
      sx: scaleBase * (0.9 + nextVisualFloat(seedState) * 0.5),
      sy: scaleBase * 0.55,
      sz: scaleBase * (0.9 + nextVisualFloat(seedState) * 0.5),
      r: tint > 0.6 ? 0.45 : 0.24,
      g: tint > 0.6 ? 0.36 : 0.23,
      b: tint > 0.6 ? 0.28 : 0.24,
      age: 0,
      ttl: 3.4 + nextVisualFloat(seedState) * 1.6,
      bounced: false
    };

    if (debrisSys.chunks.length < debrisSys.maxChunks) {
      debrisSys.chunks.push(chunk);
    } else {
      debrisSys.chunks[debrisSys.writeCursor] = chunk;
      debrisSys.writeCursor = (debrisSys.writeCursor + 1) % debrisSys.maxChunks;
    }
    spawned.push(chunk);
  }

  return spawned;
}

export function stepDebrisSystem(debrisSys, dtSec, getGroundHeightFn = null, onBounceFn = null) {
  if (!debrisSys || debrisSys.chunks.length === 0) return;
  const gravity = 20.5;
  let write = 0;

  for (let i = 0; i < debrisSys.chunks.length; i++) {
    const c = debrisSys.chunks[i];
    c.age += dtSec;
    if (c.age >= c.ttl) continue;

    c.vy -= gravity * dtSec;
    c.x += c.vx * dtSec;
    c.y += c.vy * dtSec;
    c.z += c.vz * dtSec;
    c.yaw += c.angVelYaw * dtSec;
    c.pitch += c.angVelPitch * dtSec;

    const groundY = getGroundHeightFn ? getGroundHeightFn(c.x, c.z) : 1.6;
    if (c.y <= groundY + c.sy * 0.5) {
      c.y = groundY + c.sy * 0.5;
      if (Math.abs(c.vy) > 1.2) {
        c.vy = -c.vy * 0.35;
        c.vx *= 0.68;
        c.vz *= 0.68;
        c.angVelYaw *= 0.6;
        c.angVelPitch *= 0.6;
        if (!c.bounced) {
          c.bounced = true;
          if (onBounceFn) onBounceFn(c.x, groundY, c.z);
        }
      } else {
        c.vy = 0;
        c.vx *= 0.85;
        c.vz *= 0.85;
        c.angVelYaw *= 0.5;
        c.angVelPitch *= 0.5;
      }
    }

    debrisSys.chunks[write++] = c;
  }
  debrisSys.chunks.length = write;
}
