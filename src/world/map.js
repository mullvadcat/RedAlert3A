// Declarative 256x256 (512m x 512m) parametric map compiler & 300-tick ore pillar regeneration.
// Pure ESM: zero DOM / WebGL imports.

import { ECONOMY_CONFIG, FACTIONS } from '../core/config.js';

export const MAP_SIZE = 256;
export const CELL_SIZE = 2;
export const WORLD_SIZE = MAP_SIZE * CELL_SIZE; // 512m

export const TERRAIN = {
  LAND: 0,
  SHALLOW: 1,
  SEA: 2,
  CLIFF: 3,
  BRIDGE: 4,
  BROKEN_BRIDGE: 5
};

export const ORE_TYPE = {
  NONE: 0,
  RED: 1,
  VIOLET: 2
};

// Precomputed spiral offsets within radius 3 cells (nearest-first, excluding pillar center).
const SORTED_PILLAR_OFFSETS = [];
{
  const r = ECONOMY_CONFIG.pillarRegenRadiusCells;
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 >= 1 && d2 <= r * r) {
        SORTED_PILLAR_OFFSETS.push({ dx, dz, d2 });
      }
    }
  }
  SORTED_PILLAR_OFFSETS.sort((a, b) => a.d2 - b.d2 || a.dz - b.dz || a.dx - b.dx);
}

// Standard M1 Proving Grounds: coastal land-sea theater with mirrored bases, central strait + bridge,
// coastal beach shallows, cliffs, and Red ($350) / Violet ($700) ore veins with regenerating pillars.
export const DEFAULT_M1_MAP_BLUEPRINT = {
  id: 'berth4_proving_grounds',
  seed: 204004,
  baseElevation: 1.6,
  // Coastal ocean regions + central strait
  seaChannels: [
    // Southern bay below Abyssal southern ridge (creates smooth shoreline right in view of start camera)
    { type: 'bay_south', baseZ: 176, amplitude: 8, freq: 0.045, shallowMargin: 5 },
    // Northern sea cove
    { type: 'bay_north', baseZ: 68, amplitude: 7, freq: 0.04, shallowMargin: 5 },
    // North-south strait splitting middle battlefield from z=96..176 with bridge crossing
    { type: 'strait_x', centerX: 128, halfWidth: 6, zMin: 96, zMax: 184, shallowMargin: 3 }
  ],
  bridges: [
    { id: 1, x0: 120, z0: 124, x1: 136, z1: 132 }
  ],
  cliffs: [
    // Rocky tactical outcrops away from buildable main plateaus
    { x0: 96, z0: 84, x1: 102, z1: 96 },
    { x0: 154, z0: 152, x1: 160, z1: 164 }
  ],
  orePatches: [
    // Player 0 (Abyssal) near-base Red & Violet ore
    { cx: 64, cz: 112, radius: 5, oreType: ORE_TYPE.RED, amount: 2, pillar: true },
    { cx: 70, cz: 144, radius: 4, oreType: ORE_TYPE.VIOLET, amount: 2, pillar: true },
    // Player 1 (Crimson) near-base Red & Violet ore
    { cx: 192, cz: 144, radius: 5, oreType: ORE_TYPE.RED, amount: 2, pillar: true },
    { cx: 186, cz: 112, radius: 4, oreType: ORE_TYPE.VIOLET, amount: 2, pillar: true },
    // Contested mid-map high-value Violet veins north & south of the bridge
    { cx: 106, cz: 154, radius: 4, oreType: ORE_TYPE.VIOLET, amount: 3, pillar: true },
    { cx: 150, cz: 102, radius: 4, oreType: ORE_TYPE.VIOLET, amount: 3, pillar: true }
  ],
  spawns: [
    { playerId: 0, teamId: 0, factionId: FACTIONS.abyssal.id, gx: 44, gz: 128 },
    { playerId: 1, teamId: 1, factionId: FACTIONS.crimson.id, gx: 212, gz: 128 }
  ]
};

export function compileMap(blueprint = DEFAULT_M1_MAP_BLUEPRINT) {
  const total = MAP_SIZE * MAP_SIZE;
  const terrain = new Uint8Array(total);
  const elevation = new Float32Array(total);
  const oreType = new Uint8Array(total);
  const oreAmount = new Uint8Array(total);
  const buildingId = new Int32Array(total);

  const baseElev = blueprint.baseElevation ?? 1.6;
  terrain.fill(TERRAIN.LAND);
  elevation.fill(baseElev);

  // Subtle macro height undulation on land using precomputed 1D trig tables (< 2ms total).
  const spawns = blueprint.spawns ?? [];
  const sinX = new Float32Array(MAP_SIZE);
  const cosZ = new Float32Array(MAP_SIZE);
  for (let i = 0; i < MAP_SIZE; i++) {
    sinX[i] = Math.sin(i * 0.09);
    cosZ[i] = Math.cos(i * 0.09);
  }

  for (let gz = 0; gz < MAP_SIZE; gz++) {
    const cz = cosZ[gz];
    const row = gz * MAP_SIZE;
    for (let gx = 0; gx < MAP_SIZE; gx++) {
      let nearSpawn = false;
      for (let s = 0; s < spawns.length; s++) {
        const dx = gx - spawns[s].gx;
        const dz = gz - spawns[s].gz;
        if (dx * dx + dz * dz < 484) {
          nearSpawn = true;
          break;
        }
      }
      if (!nearSpawn) {
        elevation[row + gx] = baseElev + sinX[gx] * cz * 0.14;
      }
    }
  }

  // Apply sea channels & shoreline shallows with precomputed 1D curves (1 fast pass per channel)
  const channels = blueprint.seaChannels ?? [];
  const curve = new Float32Array(MAP_SIZE);
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    const margin = ch.shallowMargin ?? 4;
    const invSpan = 1 / (margin + 1.2);
    if (ch.type === 'bay_south') {
      const f = ch.freq ?? 0.04;
      const amp = ch.amplitude ?? 6;
      for (let gx = 0; gx < MAP_SIZE; gx++) curve[gx] = ch.baseZ + Math.sin(gx * f) * amp;
      for (let gz = 0; gz < MAP_SIZE; gz++) {
        const row = gz * MAP_SIZE;
        for (let gx = 0; gx < MAP_SIZE; gx++) {
          const signedDepth = gz - curve[gx];
          if (signedDepth > -margin) {
            const idx = row + gx;
            if (signedDepth >= 1.2) {
              terrain[idx] = TERRAIN.SEA;
              const d = -2.8 - Math.min(2.2, (signedDepth - 1.2) * 0.35);
              if (d < elevation[idx]) elevation[idx] = d;
            } else {
              const t = (signedDepth + margin) * invSpan;
              const nextElev = baseElev * (1 - t) - 1.1 * t;
              if (nextElev < elevation[idx]) elevation[idx] = nextElev;
              if (terrain[idx] !== TERRAIN.SEA) terrain[idx] = nextElev <= 0.1 ? TERRAIN.SHALLOW : TERRAIN.LAND;
            }
          }
        }
      }
    } else if (ch.type === 'bay_north') {
      const f = ch.freq ?? 0.04;
      const amp = ch.amplitude ?? 6;
      for (let gx = 0; gx < MAP_SIZE; gx++) curve[gx] = ch.baseZ + Math.cos(gx * f) * amp;
      for (let gz = 0; gz < MAP_SIZE; gz++) {
        const row = gz * MAP_SIZE;
        for (let gx = 0; gx < MAP_SIZE; gx++) {
          const signedDepth = curve[gx] - gz;
          if (signedDepth > -margin) {
            const idx = row + gx;
            if (signedDepth >= 1.2) {
              terrain[idx] = TERRAIN.SEA;
              const d = -2.8 - Math.min(2.2, (signedDepth - 1.2) * 0.35);
              if (d < elevation[idx]) elevation[idx] = d;
            } else {
              const t = (signedDepth + margin) * invSpan;
              const nextElev = baseElev * (1 - t) - 1.1 * t;
              if (nextElev < elevation[idx]) elevation[idx] = nextElev;
              if (terrain[idx] !== TERRAIN.SEA) terrain[idx] = nextElev <= 0.1 ? TERRAIN.SHALLOW : TERRAIN.LAND;
            }
          }
        }
      }
    } else if (ch.type === 'strait_x') {
      const zMin = Math.max(0, ch.zMin);
      const zMax = Math.min(MAP_SIZE - 1, ch.zMax);
      const hw = ch.halfWidth ?? 6;
      const gxMin = Math.max(0, Math.floor(ch.centerX - hw - margin - 3));
      const gxMax = Math.min(MAP_SIZE - 1, Math.ceil(ch.centerX + hw + margin + 3));
      for (let gz = zMin; gz <= zMax; gz++) {
        const center = ch.centerX + Math.sin(gz * 0.06) * 2.5;
        const row = gz * MAP_SIZE;
        for (let gx = gxMin; gx <= gxMax; gx++) {
          const signedDepth = hw - Math.abs(gx - center);
          if (signedDepth > -margin) {
            const idx = row + gx;
            if (signedDepth >= 1.2) {
              terrain[idx] = TERRAIN.SEA;
              const d = -2.8 - Math.min(2.2, (signedDepth - 1.2) * 0.35);
              if (d < elevation[idx]) elevation[idx] = d;
            } else {
              const t = (signedDepth + margin) * invSpan;
              const nextElev = baseElev * (1 - t) - 1.1 * t;
              if (nextElev < elevation[idx]) elevation[idx] = nextElev;
              if (terrain[idx] !== TERRAIN.SEA) terrain[idx] = nextElev <= 0.1 ? TERRAIN.SHALLOW : TERRAIN.LAND;
            }
          }
        }
      }
    }
  }

  // Carve cliffs
  const cliffs = blueprint.cliffs ?? [];
  for (let c = 0; c < cliffs.length; c++) {
    const cl = cliffs[c];
    for (let gz = Math.max(0, cl.z0); gz <= Math.min(MAP_SIZE - 1, cl.z1); gz++) {
      for (let gx = Math.max(0, cl.x0); gx <= Math.min(MAP_SIZE - 1, cl.x1); gx++) {
        const idx = gz * MAP_SIZE + gx;
        terrain[idx] = TERRAIN.CLIFF;
        elevation[idx] = baseElev + 3.2;
      }
    }
  }

  // Paint bridges across sea/shallows
  const bridges = [];
  for (const br of blueprint.bridges ?? []) {
    const cells = [];
    for (let gz = Math.max(0, br.z0); gz <= Math.min(MAP_SIZE - 1, br.z1); gz++) {
      for (let gx = Math.max(0, br.x0); gx <= Math.min(MAP_SIZE - 1, br.x1); gx++) {
        const idx = gz * MAP_SIZE + gx;
        terrain[idx] = TERRAIN.BRIDGE;
        elevation[idx] = baseElev;
        cells.push(idx);
      }
    }
    bridges.push({ id: br.id, x0: br.x0, z0: br.z0, x1: br.x1, z1: br.z1, cells, intact: true });
  }

  // Place Red / Violet ore veins and regenerating ore pillars
  const orePillars = [];
  for (const patch of blueprint.orePatches ?? []) {
    const r = patch.radius ?? 4;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r) continue;
        if (patch.pillar && dx === 0 && dz === 0) continue; // Center is pillar crystal core
        const gx = patch.cx + dx;
        const gz = patch.cz + dz;
        if (gx < 1 || gx >= MAP_SIZE - 1 || gz < 1 || gz >= MAP_SIZE - 1) continue;
        const idx = gz * MAP_SIZE + gx;
        if (terrain[idx] !== TERRAIN.LAND) continue;
        oreType[idx] = patch.oreType;
        oreAmount[idx] = Math.min(ECONOMY_CONFIG.maxCellOreUnits, patch.amount ?? 2);
      }
    }
    if (patch.pillar) {
      const pIdx = patch.cz * MAP_SIZE + patch.cx;
      if (terrain[pIdx] === TERRAIN.LAND) {
        oreType[pIdx] = patch.oreType;
        oreAmount[pIdx] = 0; // Pillar itself is non-depleting spawner
        orePillars.push({
          gx: patch.cx,
          gz: patch.cz,
          x: (patch.cx + 0.5) * CELL_SIZE,
          z: (patch.cz + 0.5) * CELL_SIZE,
          oreType: patch.oreType,
          nextRegenTick: ECONOMY_CONFIG.pillarRegenIntervalTicks
        });
      }
    }
  }

  return {
    id: blueprint.id,
    width: MAP_SIZE,
    height: MAP_SIZE,
    cellSize: CELL_SIZE,
    worldSize: WORLD_SIZE,
    terrain,
    elevation,
    oreType,
    oreAmount,
    buildingId,
    orePillars,
    bridges,
    spawns: spawns.map((s) => ({
      ...s,
      x: (s.gx + 0.5) * CELL_SIZE,
      z: (s.gz + 0.5) * CELL_SIZE
    })),
    revision: 1
  };
}

export function worldToGrid(val) {
  return Math.max(0, Math.min(MAP_SIZE - 1, Math.floor(val / CELL_SIZE)));
}

export function gridToWorldCenter(g) {
  return (g + 0.5) * CELL_SIZE;
}

export function getTerrainAtWorld(map, x, z) {
  const gx = worldToGrid(x);
  const gz = worldToGrid(z);
  return map.terrain[gz * MAP_SIZE + gx];
}

export function getElevationAtWorld(map, x, z) {
  const gx = worldToGrid(x);
  const gz = worldToGrid(z);
  return map.elevation[gz * MAP_SIZE + gx];
}

export function getWaterDepthAtCell(map, idx) {
  const elev = map.elevation[idx];
  return elev < 0 ? -elev : 0;
}

// Each ore pillar regenerates strictly 1 non-full ore cell (nearest-first within 3 cells) per 300 ticks.
export function stepMapResources(state) {
  const map = state.map;
  if (!map || !state.orePillars) return;

  for (let i = 0; i < state.orePillars.length; i++) {
    const pillar = state.orePillars[i];
    if (state.tickCount < pillar.nextRegenTick) continue;

    pillar.nextRegenTick += ECONOMY_CONFIG.pillarRegenIntervalTicks;
    for (let k = 0; k < SORTED_PILLAR_OFFSETS.length; k++) {
      const off = SORTED_PILLAR_OFFSETS[k];
      const gx = pillar.gx + off.dx;
      const gz = pillar.gz + off.dz;
      if (gx < 0 || gx >= MAP_SIZE || gz < 0 || gz >= MAP_SIZE) continue;
      const idx = gz * MAP_SIZE + gx;
      if (map.terrain[idx] !== TERRAIN.LAND) continue;
      if (map.buildingId[idx] > 0) continue;
      if (map.oreAmount[idx] >= ECONOMY_CONFIG.maxCellOreUnits) continue;

      if (map.oreType[idx] === ORE_TYPE.NONE || map.oreAmount[idx] === 0) {
        map.oreType[idx] = pillar.oreType;
      }
      map.oreAmount[idx] += 1;
      state.events.push({ type: 'map:oreRegen', gx, gz, oreType: map.oreType[idx] });
      break;
    }
  }
}
