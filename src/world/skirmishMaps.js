// Handcrafted 8 Skirmish Map Blueprints (256x256, <15ms compile time each).
// Pure ESM L1 World Module: zero DOM / gameplay imports.

import { DEFAULT_M1_MAP_BLUEPRINT } from './map.js';

export const SKIRMISH_MAPS = [
  {
    ...DEFAULT_M1_MAP_BLUEPRINT,
    id: 'harbor',
    nameKey: 'map.harbor.name',
    maxPlayers: 2,
    supportsNaval: true
  },
  {
    id: 'twin_bridges',
    nameKey: 'map.twin_bridges.name',
    maxPlayers: 2,
    supportsNaval: true,
    baseElevation: 1.8,
    seaChannels: [
      { type: 'strait_x', centerX: 128, halfWidth: 12, zMin: 0, zMax: 255, shallowMargin: 4 }
    ],
    bridges: [
      { id: 'north_bridge', x0: 112, z0: 68, x1: 144, z1: 71 },
      { id: 'south_bridge', x0: 112, z0: 184, x1: 144, z1: 187 }
    ],
    cliffs: [
      { x0: 96, z0: 108, x1: 104, z1: 148 },
      { x0: 152, z0: 108, x1: 160, z1: 148 }
    ],
    orePatches: [
      { cx: 58, cz: 104, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 58, cz: 152, radius: 4, oreType: 1, amount: 3, pillar: true },
      { cx: 198, cz: 104, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 198, cz: 152, radius: 4, oreType: 1, amount: 3, pillar: true },
      { cx: 88, cz: 46, radius: 4, oreType: 2, amount: 3, pillar: true },
      { cx: 168, cz: 210, radius: 4, oreType: 2, amount: 3, pillar: true }
    ],
    spawns: [
      { gx: 40, gz: 128, playerIndex: 0 },
      { gx: 216, gz: 128, playerIndex: 1 }
    ],
    neutralBuildings: [
      { typeId: 'oil_derrick', gx: 76, gz: 46 },
      { typeId: 'oil_derrick', gx: 180, gz: 210 },
      { typeId: 'hospital', gx: 90, gz: 128 }
    ]
  },
  {
    id: 'crimson_crater',
    nameKey: 'map.crimson_crater.name',
    maxPlayers: 4,
    supportsNaval: false,
    baseElevation: 2.0,
    seaChannels: [
      { type: 'sea_circle', cx: 128, cz: 128, radius: 18, shallowMargin: 4 }
    ],
    bridges: [],
    cliffs: [
      { x0: 102, z0: 84, x1: 112, z1: 90 },
      { x0: 144, z0: 166, x1: 154, z1: 172 }
    ],
    orePatches: [
      { cx: 60, cz: 58, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 196, cz: 58, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 60, cz: 198, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 196, cz: 198, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 128, cz: 92, radius: 5, oreType: 2, amount: 3, pillar: true },
      { cx: 128, cz: 164, radius: 5, oreType: 2, amount: 3, pillar: true }
    ],
    spawns: [
      { gx: 40, gz: 42, playerIndex: 0 },
      { gx: 216, gz: 214, playerIndex: 1 },
      { gx: 216, gz: 42, playerIndex: 2 },
      { gx: 40, gz: 214, playerIndex: 3 }
    ],
    neutralBuildings: [
      { typeId: 'oil_derrick', gx: 128, gz: 64 },
      { typeId: 'oil_derrick', gx: 128, gz: 192 },
      { typeId: 'tech_airport', gx: 86, gz: 128 }
    ]
  },
  {
    id: 'archipelago',
    nameKey: 'map.archipelago.name',
    maxPlayers: 4,
    supportsNaval: true,
    baseElevation: 1.8,
    seaChannels: [
      { type: 'strait_x', centerX: 128, halfWidth: 16, zMin: 0, zMax: 255, shallowMargin: 5 },
      { type: 'strait_z', centerZ: 128, halfWidth: 16, xMin: 0, xMax: 255, shallowMargin: 5 },
      { type: 'bay_south', baseZ: 230, freq: 0.03, amplitude: 6, shallowMargin: 4 }
    ],
    bridges: [
      { id: 'center_causeway', x0: 108, z0: 126, x1: 148, z1: 130 }
    ],
    cliffs: [],
    orePatches: [
      { cx: 56, cz: 60, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 200, cz: 60, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 56, cz: 186, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 200, cz: 186, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 88, cz: 88, radius: 4, oreType: 2, amount: 3, pillar: true },
      { cx: 168, cz: 168, radius: 4, oreType: 2, amount: 3, pillar: true }
    ],
    spawns: [
      { gx: 42, gz: 46, playerIndex: 0 },
      { gx: 214, gz: 194, playerIndex: 1 },
      { gx: 214, gz: 46, playerIndex: 2 },
      { gx: 42, gz: 194, playerIndex: 3 }
    ],
    neutralBuildings: [
      { typeId: 'oil_derrick', gx: 90, gz: 64 },
      { typeId: 'oil_derrick', gx: 166, gz: 188 }
    ]
  },
  {
    id: 'strait_2v2',
    nameKey: 'map.strait_2v2.name',
    maxPlayers: 4,
    supportsNaval: true,
    baseElevation: 1.8,
    seaChannels: [
      { type: 'strait_x', centerX: 128, halfWidth: 15, zMin: 0, zMax: 255, shallowMargin: 5 },
      { type: 'bay_south', baseZ: 224, freq: 0.04, amplitude: 5, shallowMargin: 4 },
      { type: 'bay_north', baseZ: 30, freq: 0.04, amplitude: 5, shallowMargin: 4 }
    ],
    bridges: [
      { id: 'main_strait_br', x0: 109, z0: 126, x1: 147, z1: 130 }
    ],
    cliffs: [],
    orePatches: [
      { cx: 58, cz: 68, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 58, cz: 184, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 198, cz: 68, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 198, cz: 184, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 88, cz: 128, radius: 4, oreType: 2, amount: 3, pillar: true },
      { cx: 168, cz: 128, radius: 4, oreType: 2, amount: 3, pillar: true }
    ],
    spawns: [
      { gx: 40, gz: 84, playerIndex: 0 },
      { gx: 216, gz: 84, playerIndex: 1 },
      { gx: 40, gz: 172, playerIndex: 2 },
      { gx: 216, gz: 172, playerIndex: 3 }
    ],
    neutralBuildings: [
      { typeId: 'tech_airport', gx: 76, gz: 128 },
      { typeId: 'hospital', gx: 180, gz: 128 }
    ]
  },
  {
    id: 'frost_pass',
    nameKey: 'map.frost_pass.name',
    maxPlayers: 2,
    supportsNaval: true,
    baseElevation: 2.2,
    seaChannels: [
      { type: 'bay_north', baseZ: 36, freq: 0.05, amplitude: 6, shallowMargin: 4 },
      { type: 'bay_south', baseZ: 218, freq: 0.05, amplitude: 6, shallowMargin: 4 }
    ],
    bridges: [],
    cliffs: [
      { x0: 120, z0: 66, x1: 136, z1: 108 },
      { x0: 120, z0: 148, x1: 136, z1: 190 }
    ],
    orePatches: [
      { cx: 64, cz: 110, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 192, cz: 146, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 128, cz: 128, radius: 6, oreType: 2, amount: 4, pillar: true }
    ],
    spawns: [
      { gx: 42, gz: 128, playerIndex: 0 },
      { gx: 214, gz: 128, playerIndex: 1 }
    ],
    neutralBuildings: [
      { typeId: 'oil_derrick', gx: 88, gz: 68 },
      { typeId: 'oil_derrick', gx: 168, gz: 188 }
    ]
  },
  {
    id: 'refinery_basin',
    nameKey: 'map.refinery_basin.name',
    maxPlayers: 2,
    supportsNaval: true,
    baseElevation: 1.6,
    seaChannels: [
      { type: 'bay_south', baseZ: 212, freq: 0.035, amplitude: 8, shallowMargin: 5 }
    ],
    bridges: [],
    cliffs: [
      { x0: 96, z0: 56, x1: 102, z1: 92 },
      { x0: 154, z0: 56, x1: 160, z1: 92 }
    ],
    orePatches: [
      { cx: 66, cz: 112, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 190, cz: 112, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 114, cz: 124, radius: 4, oreType: 2, amount: 4, pillar: true },
      { cx: 142, cz: 124, radius: 4, oreType: 2, amount: 4, pillar: true },
      { cx: 128, cz: 76, radius: 5, oreType: 2, amount: 3, pillar: true }
    ],
    spawns: [
      { gx: 42, gz: 136, playerIndex: 0 },
      { gx: 214, gz: 136, playerIndex: 1 }
    ],
    neutralBuildings: [
      { typeId: 'oil_derrick', gx: 104, gz: 170 },
      { typeId: 'oil_derrick', gx: 152, gz: 170 },
      { typeId: 'hospital', gx: 128, gz: 100 }
    ]
  },
  {
    id: 'mesa_delta',
    nameKey: 'map.mesa_delta.name',
    maxPlayers: 4,
    supportsNaval: true,
    baseElevation: 2.0,
    seaChannels: [
      { type: 'strait_z', centerZ: 128, halfWidth: 11, xMin: 0, xMax: 255, shallowMargin: 4 },
      { type: 'sea_circle', cx: 128, cz: 128, radius: 22, shallowMargin: 4 }
    ],
    bridges: [
      { id: 'west_delta_br', x0: 66, z0: 114, x1: 72, z1: 142 },
      { id: 'east_delta_br', x0: 184, z0: 114, x1: 190, z1: 142 }
    ],
    cliffs: [],
    orePatches: [
      { cx: 52, cz: 74, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 204, cz: 74, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 52, cz: 182, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 204, cz: 182, radius: 5, oreType: 1, amount: 3, pillar: true },
      { cx: 128, cz: 66, radius: 5, oreType: 2, amount: 3, pillar: true },
      { cx: 128, cz: 190, radius: 5, oreType: 2, amount: 3, pillar: true }
    ],
    spawns: [
      { gx: 38, gz: 46, playerIndex: 0 },
      { gx: 218, gz: 210, playerIndex: 1 },
      { gx: 218, gz: 46, playerIndex: 2 },
      { gx: 38, gz: 210, playerIndex: 3 }
    ],
    neutralBuildings: [
      { typeId: 'tech_airport', gx: 128, gz: 46 },
      { typeId: 'oil_derrick', gx: 128, gz: 210 }
    ]
  }
];

export function getSkirmishMapById(id) {
  return SKIRMISH_MAPS.find((m) => m.id === id) ?? SKIRMISH_MAPS[0];
}
