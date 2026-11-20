// Single Source of Truth for RedAlert3A runtime stats, factions, 49 canonical entities,
// 7x6 armor matrix, explicit target/attacker overrides, veterancy, quality & default keymap.

export const TICK_RATE = 30;
export const TICK_DT = 1 / TICK_RATE;

export const FACTIONS = {
  abyssal: { id: 'abyssal', color: '#2d7eff', rgb: [0.176, 0.494, 1.0] },
  crimson: { id: 'crimson', color: '#e83b3b', rgb: [0.910, 0.231, 0.231] },
  abyss0: { id: 'abyss0', color: '#9b30ff', rgb: [0.608, 0.188, 1.0] },
  neutral: { id: 'neutral', color: '#8a9ba8', rgb: [0.541, 0.608, 0.659] }
};

export const PLAYER_COLORS = [
  { hex: '#2d7eff', rgb: [0.176, 0.494, 1.0] },
  { hex: '#e83b3b', rgb: [0.910, 0.231, 0.231] },
  { hex: '#3ddc84', rgb: [0.239, 0.863, 0.518] },
  { hex: '#f5b342', rgb: [0.961, 0.702, 0.259] }
];

export const QUALITY_PRESETS = {
  ultra: {
    id: 'ultra',
    shadowSize: 4096,
    gtaoEnabled: true,
    bloomEnabled: true,
    gerstnerWaves: 4,
    debrisScale: 1.0,
    pixelRatioCap: 2.0
  },
  high: {
    id: 'high',
    shadowSize: 4096,
    gtaoEnabled: true,
    bloomEnabled: true,
    gerstnerWaves: 4,
    debrisScale: 1.0,
    pixelRatioCap: 1.5
  },
  balanced: {
    id: 'balanced',
    shadowSize: 2048,
    gtaoEnabled: false,
    bloomEnabled: false,
    gerstnerWaves: 2,
    debrisScale: 0.6,
    pixelRatioCap: 1.0
  }
};

// Zero conflict with WASD: arrow keys pan camera; A/S/D/K/X/Q/W/E/R/T/F1-F4/L/H/Space/Esc bind commands.
export const KEYMAP_DEFAULTS = {
  panUp: 'ArrowUp',
  panDown: 'ArrowDown',
  panLeft: 'ArrowLeft',
  panRight: 'ArrowRight',
  attackMove: 'KeyA',
  stop: 'KeyS',
  deploy: 'KeyD',
  repairMode: 'KeyK',
  sellMode: 'KeyX',
  tabMain: 'KeyQ',
  tabDefense: 'KeyW',
  tabInfantry: 'KeyE',
  tabVehicle: 'KeyR',
  tabAirNaval: 'KeyT',
  doctrine1: 'F1',
  doctrine2: 'F2',
  doctrine3: 'F3',
  doctrine4: 'F4',
  toggleLocale: 'KeyL',
  toggleIsoCam: 'KeyV',
  homeBase: 'KeyH',
  jumpAlert: 'Space',
  cancel: 'Escape'
};

export const ECONOMY_CONFIG = {
  redOreCellValue: 350,
  violetOreCellValue: 700,
  maxHarvesterCargoCells: 2,
  harvestDurationTicks: 4 * TICK_RATE, // 4.0s = 120 ticks
  unloadDurationTicks: Math.round(1.5 * TICK_RATE), // 1.5s = 45 ticks
  pillarRegenIntervalTicks: 10 * TICK_RATE, // 10s = 300 ticks
  pillarRegenRadiusCells: 3,
  maxCellOreUnits: 4,
  buildRadiusConyardCells: 18,
  buildRadiusBuildingCells: 8,
  buildRadiusNavalNearLandCells: 12,
  repairHpPerSec: 35,
  repairCostRatio: 0.30,
  sellRefundRatio: 0.50
};

export const POWER_TIERS = {
  greenMinRatio: 1.0,
  yellowMinRatio: 0.6,
  greenFactor: 1.0,
  yellowFactor: 0.5,
  redFactor: 0.35
};

// Direct override relative to rank 0 base stats (no compounding).
export const VETERANCY_CONFIG = {
  0: {
    rank: 0,
    minKillRatio: 0,
    damageMult: 1.0,
    speedMult: 1.0,
    sightBonus: 0,
    damageTakenMult: 1.0,
    cooldownMult: 1.0,
    hpMult: 1.0,
    selfHealPerSec: 0
  },
  1: {
    rank: 1,
    minKillRatio: 1.5,
    damageMult: 1.20,
    speedMult: 1.15,
    sightBonus: 2,
    damageTakenMult: 0.85,
    cooldownMult: 1.0,
    hpMult: 1.0,
    selfHealPerSec: 0
  },
  2: {
    rank: 2,
    minKillRatio: 4.0,
    damageMult: 1.32,
    speedMult: 1.15,
    sightBonus: 2,
    damageTakenMult: 0.84,
    cooldownMult: 0.88,
    hpMult: 1.15,
    selfHealPerSec: 7
  }
};

// 7x6 DamageType vs ArmorType matrix aligned with SDD v2.2 §5.1
export const ARMOR_MATRIX = {
  Bullet:        { None: 1.00, HeavyInfantry: 0.65, Light: 0.45, Heavy: 0.20, SuperHeavy: 0.10, Air: 0.00 },
  APShell:       { None: 0.25, HeavyInfantry: 0.45, Light: 0.85, Heavy: 1.00, SuperHeavy: 0.90, Air: 0.00 },
  Missile:       { None: 0.40, HeavyInfantry: 0.50, Light: 1.00, Heavy: 0.75, SuperHeavy: 0.65, Air: 1.30 },
  HighExplosive: { None: 1.50, HeavyInfantry: 1.15, Light: 1.15, Heavy: 0.95, SuperHeavy: 0.90, Air: 0.00 },
  Prism:         { None: 1.25, HeavyInfantry: 0.90, Light: 1.15, Heavy: 0.80, SuperHeavy: 0.75, Air: 0.00 },
  Tesla:         { None: 1.60, HeavyInfantry: 0.85, Light: 1.20, Heavy: 1.00, SuperHeavy: 0.85, Air: 0.00 },
  Torpedo:       { None: 0.00, HeavyInfantry: 0.00, Light: 1.25, Heavy: 1.20, SuperHeavy: 1.10, Air: 0.00 },
  Chrono:        { None: 1.00, HeavyInfantry: 1.00, Light: 1.00, Heavy: 1.00, SuperHeavy: 1.00, Air: 0.00 },
  Radiation:     { None: 1.50, HeavyInfantry: 0.90, Light: 0.70, Heavy: 0.55, SuperHeavy: 0.25, Air: 0.00 }
};

// Direct target overrides (do NOT multiply with base matrix cell).
export const TARGET_OVERRIDES = {
  Bullet: (target) => (target.typeId === 'rocketeer' ? 0.60 : null),
  HighExplosive: (target) => (target.isStructure === true ? 1.35 : null),
  Prism: (target) => (target.isStructure === true ? 1.30 : null)
};

// Direct attacker overrides (keeps aegis vs Air = 1.60 cleanly separated from incoming Missile vs aegis).
export const ATTACKER_OVERRIDES = {
  Missile: (attacker, target) => (attacker?.typeId === 'aegis' && target?.armor === 'Air' ? 1.60 : null)
};

export function getArmorMultiplier(damageType, target, attacker = null) {
  if (!target) return 0;
  const attackerOverrideFn = ATTACKER_OVERRIDES[damageType];
  if (attackerOverrideFn) {
    const val = attackerOverrideFn(attacker, target);
    if (val !== null) return val;
  }
  const targetOverrideFn = TARGET_OVERRIDES[damageType];
  if (targetOverrideFn) {
    const val = targetOverrideFn(target);
    if (val !== null) return val;
  }
  const row = ARMOR_MATRIX[damageType];
  if (!row) return 1.0;
  return row[target.armor] ?? 1.0;
}

const sec = (s) => Math.max(1, Math.round(s * TICK_RATE));

// Complete 49 canonical entity definitions matching docs/README.md
export const ENTITY_DEFS = {
  // === 9 Infantry ===
  gi: {
    id: 'gi', category: 'infantry', factions: ['abyssal'], cost: 160, buildTicks: sec(2.2),
    speed: 3.6, hp: 135, armor: 'None', domain: 'GROUND', sight: 13, radius: 0.45,
    producerType: 'barracks', queueKey: 'infantry', prereqs: ['barracks'],
    weapon: { damage: 20, burst: 1, cooldownTicks: sec(0.35), range: 10.5, damageType: 'Bullet', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 60 },
    deployedWeapon: { damage: 30, burst: 1, cooldownTicks: sec(0.35), range: 13.0, damageType: 'Bullet', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 60 },
    canDeploy: true
  },
  conscript: {
    id: 'conscript', category: 'infantry', factions: ['crimson'], cost: 100, buildTicks: sec(1.8),
    speed: 3.8, hp: 115, armor: 'None', domain: 'GROUND', sight: 12, radius: 0.45,
    producerType: 'barracks', queueKey: 'infantry', prereqs: ['barracks'],
    weapon: { damage: 13, burst: 1, cooldownTicks: sec(0.40), range: 9, damageType: 'Bullet', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 60 }
  },
  flak_trooper: {
    id: 'flak_trooper', category: 'infantry', factions: ['abyssal', 'crimson'], cost: 300, buildTicks: sec(3.2),
    speed: 3.5, hp: 140, armor: 'None', domain: 'GROUND', sight: 15, radius: 0.5,
    producerType: 'barracks', queueKey: 'infantry', prereqs: ['barracks'],
    weapon: { damage: 20, antiAirDamage: 38, burst: 1, cooldownTicks: sec(0.6), range: 15, damageType: 'Missile', targetDomains: ['GROUND', 'SEA', 'AIR'], projectileSpeed: 36 }
  },
  engineer: {
    id: 'engineer', category: 'infantry', factions: ['abyssal', 'crimson'], cost: 500, buildTicks: sec(4.5),
    speed: 3.4, hp: 85, armor: 'None', domain: 'GROUND', sight: 11, radius: 0.45,
    producerType: 'barracks', queueKey: 'infantry', prereqs: ['barracks'],
    weapon: null
  },
  rocketeer: {
    id: 'rocketeer', category: 'infantry', factions: ['abyssal'], cost: 600, buildTicks: sec(5.0),
    speed: 7.2, hp: 150, armor: 'Air', domain: 'AIR', sight: 18, radius: 0.55,
    producerType: 'barracks', queueKey: 'infantry', prereqs: ['barracks', 'airforce_radar'],
    weapon: { damage: 22, burst: 1, cooldownTicks: sec(0.45), range: 13, damageType: 'Bullet', targetDomains: ['GROUND', 'SEA', 'AIR'], projectileSpeed: 55 }
  },
  tesla_trooper: {
    id: 'tesla_trooper', category: 'infantry', factions: ['crimson'], cost: 500, buildTicks: sec(5.0),
    speed: 3.0, hp: 240, armor: 'HeavyInfantry', domain: 'GROUND', sight: 12, radius: 0.55, antiCrush: true,
    producerType: 'barracks', queueKey: 'infantry', prereqs: ['barracks', 'airforce_radar'],
    weapon: { damage: 68, burst: 1, cooldownTicks: sec(1.4), range: 9, damageType: 'Tesla', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 0 }
  },
  chrono: {
    id: 'chrono', category: 'infantry', factions: ['abyssal'], cost: 1500, buildTicks: sec(10.0),
    speed: 4.0, hp: 200, armor: 'None', domain: 'GROUND', sight: 16, radius: 0.5, canTeleport: true,
    producerType: 'barracks', queueKey: 'infantry', prereqs: ['barracks', 'battle_lab'],
    weapon: { damage: 250 / TICK_RATE, burst: 1, cooldownTicks: 1, range: 14, damageType: 'Chrono', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 0 }
  },
  shadow: {
    id: 'shadow', category: 'infantry', factions: ['abyssal'], cost: 1800, buildTicks: sec(12.0),
    speed: 5.0, hp: 420, armor: 'HeavyInfantry', domain: 'GROUND', amphibious: true, sight: 17, radius: 0.55, antiCrush: true, heroLimit: 1,
    producerType: 'barracks', queueKey: 'infantry', prereqs: ['barracks', 'battle_lab'],
    weapon: { damage: 120, burst: 1, cooldownTicks: sec(0.75), range: 13, damageType: 'Bullet', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 70 }
  },
  sledge: {
    id: 'sledge', category: 'infantry', factions: ['crimson'], cost: 1800, buildTicks: sec(12.0),
    speed: 4.5, hp: 480, armor: 'HeavyInfantry', domain: 'GROUND', sight: 18, radius: 0.6, antiCrush: true, heroLimit: 1,
    producerType: 'barracks', queueKey: 'infantry', prereqs: ['barracks', 'battle_lab'],
    weapon: { damage: 150, burst: 1, cooldownTicks: sec(1.1), range: 16, damageType: 'HighExplosive', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 50 }
  },

  // === 8 Ground Vehicles ===
  harvester: {
    id: 'harvester', category: 'vehicle', factions: ['abyssal', 'crimson'], cost: 1400, buildTicks: sec(10.0),
    speed: 4.2, hp: 1050, armor: 'Heavy', domain: 'GROUND', sight: 12, radius: 1.35,
    producerType: 'war_factory', queueKey: 'vehicle', prereqs: ['refinery'],
    weapon: { damage: 14, burst: 1, cooldownTicks: sec(0.8), range: 10, damageType: 'Bullet', targetDomains: ['GROUND'], projectileSpeed: 55 }
  },
  grizzly: {
    id: 'grizzly', category: 'vehicle', factions: ['abyssal'], cost: 700, buildTicks: sec(6.5),
    speed: 6.6, hp: 400, armor: 'Heavy', domain: 'GROUND', sight: 16, radius: 1.25,
    producerType: 'war_factory', queueKey: 'vehicle', prereqs: ['war_factory'],
    weapon: { damage: 74, burst: 1, cooldownTicks: sec(1.52), range: 15.5, damageType: 'APShell', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 48 }
  },
  rhino: {
    id: 'rhino', category: 'vehicle', factions: ['crimson'], cost: 900, buildTicks: sec(7.5),
    speed: 5.4, hp: 555, armor: 'Heavy', domain: 'GROUND', sight: 16, radius: 1.35,
    producerType: 'war_factory', queueKey: 'vehicle', prereqs: ['war_factory'],
    weapon: { damage: 98, burst: 1, cooldownTicks: sec(1.62), range: 16, damageType: 'APShell', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 45 }
  },
  ifv: {
    id: 'ifv', category: 'vehicle', factions: ['abyssal'], cost: 600, buildTicks: sec(5.5),
    speed: 8.4, hp: 260, armor: 'Light', domain: 'GROUND', sight: 17, radius: 1.1, transportSlots: 1,
    producerType: 'war_factory', queueKey: 'vehicle', prereqs: ['war_factory'],
    weapon: { damage: 48, burst: 1, cooldownTicks: sec(1.2), range: 16, damageType: 'Missile', targetDomains: ['GROUND', 'SEA', 'AIR'], projectileSpeed: 32 }
  },
  v3: {
    id: 'v3', category: 'vehicle', factions: ['crimson'], cost: 800, buildTicks: sec(7.5),
    speed: 4.6, hp: 240, armor: 'Light', domain: 'GROUND', sight: 16, radius: 1.35,
    producerType: 'war_factory', queueKey: 'vehicle', prereqs: ['war_factory', 'airforce_radar'],
    weapon: { damage: 260, burst: 1, cooldownTicks: sec(7.0), range: 34, splashRadius: 4.5, damageType: 'HighExplosive', targetDomains: ['GROUND', 'SEA'], interceptable: true, projectileSpeed: 18 }
  },
  prism: {
    id: 'prism', category: 'vehicle', factions: ['abyssal'], cost: 1200, buildTicks: sec(10.5),
    speed: 5.6, hp: 310, armor: 'Light', domain: 'GROUND', sight: 18, radius: 1.25,
    producerType: 'war_factory', queueKey: 'vehicle', prereqs: ['war_factory', 'battle_lab'],
    weapon: { damage: 155, burst: 1, cooldownTicks: sec(1.9), range: 24, prismSplits: 5, damageType: 'Prism', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 0 }
  },
  apocalypse: {
    id: 'apocalypse', category: 'vehicle', factions: ['crimson'], cost: 1750, buildTicks: sec(14.0),
    speed: 4.0, hp: 980, armor: 'SuperHeavy', domain: 'GROUND', sight: 18, radius: 1.65, canCrush: true, selfHealPerSec: 8,
    producerType: 'war_factory', queueKey: 'vehicle', prereqs: ['war_factory', 'battle_lab'],
    weapon: { damage: 88, burst: 2, antiAirDamage: 60, cooldownTicks: sec(2.0), range: 18, damageType: 'APShell', targetDomains: ['GROUND', 'SEA', 'AIR'], projectileSpeed: 46 }
  },
  mcv: {
    id: 'mcv', category: 'vehicle', factions: ['abyssal', 'crimson'], cost: 3000, buildTicks: sec(20.0),
    speed: 3.8, hp: 1300, armor: 'Heavy', domain: 'GROUND', sight: 14, radius: 1.6, canDeploy: true, deploysInto: 'conyard',
    producerType: 'war_factory', queueKey: 'vehicle', prereqs: ['war_factory', 'service_depot'],
    weapon: null
  },

  // === 4 Air ===
  nighthawk: {
    id: 'nighthawk', category: 'air', factions: ['abyssal', 'crimson'], cost: 1000, buildTicks: sec(8.0),
    speed: 7.8, hp: 380, armor: 'Air', domain: 'AIR', stealth: true, transportSlots: 5, sight: 20, radius: 1.4,
    producerType: 'war_factory', queueKey: 'air_naval', prereqs: ['war_factory', 'airforce_radar'],
    weapon: { damage: 18, burst: 1, cooldownTicks: sec(0.4), range: 10, damageType: 'Bullet', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 58 }
  },
  stormhawk: {
    id: 'stormhawk', category: 'air', factions: ['abyssal'], cost: 1200, buildTicks: sec(10.0),
    speed: 13.0, hp: 310, armor: 'Air', domain: 'AIR', maxAmmo: 4, sight: 22, radius: 1.25,
    producerType: 'airforce_radar', queueKey: 'air_naval', prereqs: ['airforce_radar'],
    weapon: { damage: 75, burst: 4, cooldownTicks: sec(3.0), range: 18, damageType: 'APShell', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 38 }
  },
  crimson_mig: {
    id: 'crimson_mig', category: 'air', factions: ['crimson'], cost: 1200, buildTicks: sec(10.0),
    speed: 11.5, hp: 380, armor: 'Air', domain: 'AIR', maxAmmo: 2, sight: 22, radius: 1.35,
    producerType: 'airforce_radar', queueKey: 'air_naval', prereqs: ['airforce_radar'],
    weapon: { damage: 160, burst: 2, splashRadius: 5, cooldownTicks: sec(3.0), range: 18, damageType: 'HighExplosive', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 32 }
  },
  kirov: {
    id: 'kirov', category: 'air', factions: ['crimson'], cost: 1850, buildTicks: sec(15.0),
    speed: 3.0, hp: 2000, armor: 'Air', domain: 'AIR', sight: 18, radius: 2.2,
    producerType: 'war_factory', queueKey: 'air_naval', prereqs: ['war_factory', 'battle_lab'],
    weapon: { damage: 360, burst: 1, splashRadius: 5, cooldownTicks: sec(2.2), range: 4, damageType: 'HighExplosive', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 18 }
  },

  // === 7 Naval ===
  hover_transport: {
    id: 'hover_transport', category: 'naval', factions: ['abyssal', 'crimson'], cost: 900, buildTicks: sec(7.0),
    speed: 6.5, hp: 450, armor: 'Light', domain: 'SEA', amphibious: true, transportSlots: 12, sight: 14, radius: 1.7,
    producerType: 'naval_yard', queueKey: 'air_naval', prereqs: ['naval_yard'],
    weapon: null
  },
  dolphin: {
    id: 'dolphin', category: 'naval', factions: ['abyssal'], cost: 500, buildTicks: sec(5.0),
    speed: 9.5, hp: 260, armor: 'Light', domain: 'SEA', detector: true, detectorRadius: 16, sight: 18, radius: 0.9,
    producerType: 'naval_yard', queueKey: 'air_naval', prereqs: ['naval_yard'],
    weapon: { damage: 55, subMult: 1.5, burst: 1, cooldownTicks: sec(1.4), range: 13, damageType: 'Torpedo', targetDomains: ['SEA', 'SUBMERGED'], projectileSpeed: 30 }
  },
  sea_scorpion: {
    id: 'sea_scorpion', category: 'naval', factions: ['crimson'], cost: 600, buildTicks: sec(5.5),
    speed: 8.8, hp: 360, armor: 'Light', domain: 'SEA', detector: true, detectorRadius: 12, sight: 18, radius: 1.35,
    producerType: 'naval_yard', queueKey: 'air_naval', prereqs: ['naval_yard'],
    weapon: { damage: 32, antiAirDamage: 52, burst: 1, cooldownTicks: sec(0.5), range: 21, seaRange: 12, damageType: 'Missile', targetDomains: ['GROUND', 'SEA', 'AIR', 'SUBMERGED'], projectileSpeed: 36 }
  },
  aegis: {
    id: 'aegis', category: 'naval', factions: ['abyssal'], cost: 1200, buildTicks: sec(9.0),
    speed: 5.8, hp: 650, armor: 'Heavy', domain: 'SEA', sight: 24, radius: 1.75,
    producerType: 'naval_yard', queueKey: 'air_naval', prereqs: ['naval_yard', 'airforce_radar'],
    weapon: { damage: 65, burst: 2, cooldownTicks: sec(0.5), range: 28, damageType: 'Missile', targetDomains: ['AIR'], projectileSpeed: 42 }
  },
  typhoon: {
    id: 'typhoon', category: 'naval', factions: ['crimson'], cost: 1000, buildTicks: sec(8.0),
    speed: 5.2, hp: 580, armor: 'Heavy', domain: 'SUBMERGED', stealth: true, sight: 16, radius: 1.55,
    producerType: 'naval_yard', queueKey: 'air_naval', prereqs: ['naval_yard', 'airforce_radar'],
    weapon: { damage: 140, burst: 1, cooldownTicks: sec(2.6), range: 14, damageType: 'Torpedo', targetDomains: ['SEA', 'SUBMERGED'], projectileSpeed: 22 }
  },
  carrier: {
    id: 'carrier', category: 'naval', factions: ['abyssal'], cost: 2000, buildTicks: sec(16.0),
    speed: 3.6, hp: 1300, armor: 'SuperHeavy', domain: 'SEA', maxDrones: 4, sight: 24, radius: 2.35,
    producerType: 'naval_yard', queueKey: 'air_naval', prereqs: ['naval_yard', 'battle_lab'],
    weapon: { damage: 90, burst: 1, cooldownTicks: sec(2.5), range: 38, damageType: 'HighExplosive', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 28 }
  },
  dreadnought: {
    id: 'dreadnought', category: 'naval', factions: ['crimson'], cost: 2000, buildTicks: sec(16.0),
    speed: 3.5, hp: 1400, armor: 'SuperHeavy', domain: 'SEA', sight: 24, radius: 2.35,
    producerType: 'naval_yard', queueKey: 'air_naval', prereqs: ['naval_yard', 'battle_lab'],
    weapon: { damage: 180, burst: 2, splashRadius: 5, cooldownTicks: sec(5.5), range: 40, damageType: 'HighExplosive', targetDomains: ['GROUND', 'SEA'], interceptable: true, projectileSpeed: 20 }
  },

  // === 10 Base Buildings ===
  conyard: {
    id: 'conyard', category: 'building', isBuilding: true, isStructure: true, buildable: false,
    factions: ['abyssal', 'crimson'], footprintW: 4, footprintH: 4, cost: 3000, buildTicks: 1,
    power: 20, hp: 2400, armor: 'SuperHeavy', domain: 'GROUND', sight: 20, buildRadius: 18,
    producerType: 'conyard', queueKey: 'main', prereqs: []
  },
  power_plant: {
    id: 'power_plant', category: 'building', isBuilding: true, isStructure: true,
    factions: ['abyssal', 'crimson'], footprintW: 2, footprintH: 2, cost: 800, buildTicks: sec(8.0),
    power: 100, hp: 850, armor: 'SuperHeavy', domain: 'GROUND', sight: 12,
    producerType: 'conyard', queueKey: 'main', prereqs: ['conyard']
  },
  nuclear_reactor: {
    id: 'nuclear_reactor', category: 'building', isBuilding: true, isStructure: true,
    factions: ['crimson'], footprintW: 3, footprintH: 3, cost: 1500, buildTicks: sec(14.0),
    power: 350, hp: 1100, armor: 'SuperHeavy', domain: 'GROUND', sight: 14, explodesWithRadiation: true,
    producerType: 'conyard', queueKey: 'main', prereqs: ['battle_lab']
  },
  refinery: {
    id: 'refinery', category: 'building', isBuilding: true, isStructure: true,
    factions: ['abyssal', 'crimson'], footprintW: 3, footprintH: 3, cost: 2000, buildTicks: sec(16.0),
    power: -50, hp: 1300, armor: 'SuperHeavy', domain: 'GROUND', sight: 14, grantsHarvester: true,
    producerType: 'conyard', queueKey: 'main', prereqs: ['power_plant']
  },
  barracks: {
    id: 'barracks', category: 'building', isBuilding: true, isStructure: true,
    factions: ['abyssal', 'crimson'], footprintW: 2, footprintH: 3, cost: 500, buildTicks: sec(6.0),
    power: -10, hp: 900, armor: 'SuperHeavy', domain: 'GROUND', sight: 13,
    producerType: 'conyard', queueKey: 'main', prereqs: ['power_plant']
  },
  war_factory: {
    id: 'war_factory', category: 'building', isBuilding: true, isStructure: true,
    factions: ['abyssal', 'crimson'], footprintW: 4, footprintH: 3, cost: 2000, buildTicks: sec(18.0),
    power: -25, hp: 1500, armor: 'SuperHeavy', domain: 'GROUND', sight: 14,
    producerType: 'conyard', queueKey: 'main', prereqs: ['refinery']
  },
  naval_yard: {
    id: 'naval_yard', category: 'building', isBuilding: true, isStructure: true,
    factions: ['abyssal', 'crimson'], footprintW: 4, footprintH: 4, cost: 1000, buildTicks: sec(12.0),
    power: -30, hp: 1600, armor: 'SuperHeavy', domain: 'SEA', sight: 15,
    producerType: 'conyard', queueKey: 'main', prereqs: ['power_plant']
  },
  airforce_radar: {
    id: 'airforce_radar', category: 'building', isBuilding: true, isStructure: true,
    factions: ['abyssal', 'crimson'], footprintW: 2, footprintH: 3, cost: 1200, buildTicks: sec(12.0),
    power: -50, hp: 900, armor: 'SuperHeavy', domain: 'GROUND', sight: 18, enablesRadar: true, helipads: 4,
    producerType: 'conyard', queueKey: 'main', prereqs: ['refinery']
  },
  service_depot: {
    id: 'service_depot', category: 'building', isBuilding: true, isStructure: true,
    factions: ['abyssal', 'crimson'], footprintW: 3, footprintH: 3, cost: 1200, buildTicks: sec(10.0),
    power: -25, hp: 1000, armor: 'SuperHeavy', domain: 'GROUND', sight: 13,
    producerType: 'conyard', queueKey: 'main', prereqs: ['war_factory']
  },
  battle_lab: {
    id: 'battle_lab', category: 'building', isBuilding: true, isStructure: true,
    factions: ['abyssal', 'crimson'], footprintW: 3, footprintH: 3, cost: 2000, buildTicks: sec(20.0),
    power: -100, hp: 1200, armor: 'SuperHeavy', domain: 'GROUND', sight: 15,
    producerType: 'conyard', queueKey: 'main', prereqs: ['airforce_radar', 'war_factory']
  },

  // === 8 Defenses & Superweapons ===
  pillbox: {
    id: 'pillbox', category: 'defense', isBuilding: true, isStructure: true,
    factions: ['abyssal', 'crimson'], footprintW: 1, footprintH: 1, cost: 500, buildTicks: sec(5.0),
    power: 0, hp: 600, armor: 'SuperHeavy', domain: 'GROUND', sight: 15,
    producerType: 'conyard', queueKey: 'defense', prereqs: ['barracks'],
    weapon: { damage: 28, burst: 1, cooldownTicks: sec(0.4), range: 14, damageType: 'Bullet', targetDomains: ['GROUND'], projectileSpeed: 64 }
  },
  aa_turret: {
    id: 'aa_turret', category: 'defense', isBuilding: true, isStructure: true,
    factions: ['abyssal', 'crimson'], footprintW: 1, footprintH: 1, cost: 1000, buildTicks: sec(8.0),
    power: -50, hp: 700, armor: 'SuperHeavy', domain: 'GROUND', sight: 22, requiresPower: true,
    producerType: 'conyard', queueKey: 'defense', prereqs: ['airforce_radar'],
    weapon: { damage: 52, burst: 1, cooldownTicks: sec(0.65), range: 24, damageType: 'Missile', targetDomains: ['AIR'], projectileSpeed: 40 }
  },
  prism_tower: {
    id: 'prism_tower', category: 'defense', isBuilding: true, isStructure: true,
    factions: ['abyssal'], footprintW: 1, footprintH: 1, cost: 1500, buildTicks: sec(14.0),
    power: -75, hp: 650, armor: 'SuperHeavy', domain: 'GROUND', sight: 22, requiresPower: true,
    producerType: 'conyard', queueKey: 'defense', prereqs: ['battle_lab'],
    weapon: { damage: 140, burst: 1, cooldownTicks: sec(2.0), range: 22, damageType: 'Prism', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 0 }
  },
  tesla_coil: {
    id: 'tesla_coil', category: 'defense', isBuilding: true, isStructure: true,
    factions: ['crimson'], footprintW: 1, footprintH: 1, cost: 1500, buildTicks: sec(14.0),
    power: -75, hp: 750, armor: 'SuperHeavy', domain: 'GROUND', sight: 20, requiresPower: true,
    producerType: 'conyard', queueKey: 'defense', prereqs: ['battle_lab'],
    weapon: { damage: 220, burst: 1, cooldownTicks: sec(2.2), range: 19, damageType: 'Tesla', targetDomains: ['GROUND', 'SEA'], projectileSpeed: 0 }
  },
  chrono_sphere: {
    id: 'chrono_sphere', category: 'superweapon', isBuilding: true, isStructure: true,
    factions: ['abyssal'], footprintW: 3, footprintH: 3, cost: 2500, buildTicks: sec(22.0),
    power: -200, hp: 1200, armor: 'SuperHeavy', domain: 'GROUND', sight: 16, requiresPower: true,
    superweaponCooldownTicks: sec(210),
    producerType: 'conyard', queueKey: 'defense', prereqs: ['battle_lab']
  },
  iron_curtain: {
    id: 'iron_curtain', category: 'superweapon', isBuilding: true, isStructure: true,
    factions: ['crimson'], footprintW: 3, footprintH: 3, cost: 2500, buildTicks: sec(22.0),
    power: -200, hp: 1200, armor: 'SuperHeavy', domain: 'GROUND', sight: 16, requiresPower: true,
    superweaponCooldownTicks: sec(210),
    producerType: 'conyard', queueKey: 'defense', prereqs: ['battle_lab']
  },
  weather_control: {
    id: 'weather_control', category: 'superweapon', isBuilding: true, isStructure: true,
    factions: ['abyssal'], footprintW: 3, footprintH: 3, cost: 5000, buildTicks: sec(35.0),
    power: -200, hp: 1500, armor: 'SuperHeavy', domain: 'GROUND', sight: 18, requiresPower: true,
    superweaponCooldownTicks: sec(300),
    producerType: 'conyard', queueKey: 'defense', prereqs: ['battle_lab']
  },
  nuclear_silo: {
    id: 'nuclear_silo', category: 'superweapon', isBuilding: true, isStructure: true,
    factions: ['crimson'], footprintW: 3, footprintH: 3, cost: 5000, buildTicks: sec(35.0),
    power: -200, hp: 1500, armor: 'SuperHeavy', domain: 'GROUND', sight: 18, requiresPower: true,
    superweaponCooldownTicks: sec(300),
    producerType: 'conyard', queueKey: 'defense', prereqs: ['battle_lab']
  },

  // === 3 Neutral Strategic Buildings ===
  oil_derrick: {
    id: 'oil_derrick', category: 'neutral', isBuilding: true, isStructure: true, buildable: false,
    factions: ['neutral'], footprintW: 2, footprintH: 2, cost: 0, buildTicks: 1,
    power: 0, hp: 1000, armor: 'SuperHeavy', domain: 'GROUND', sight: 10, captureBonus: 500, passiveIncome: 40, passiveIntervalTicks: sec(4.0)
  },
  tech_airport: {
    id: 'tech_airport', category: 'neutral', isBuilding: true, isStructure: true, buildable: false,
    factions: ['neutral'], footprintW: 3, footprintH: 3, cost: 0, buildTicks: 1,
    power: 0, hp: 1200, armor: 'SuperHeavy', domain: 'GROUND', sight: 12
  },
  hospital: {
    id: 'hospital', category: 'neutral', isBuilding: true, isStructure: true, buildable: false,
    factions: ['neutral'], footprintW: 3, footprintH: 3, cost: 0, buildTicks: 1,
    power: 0, hp: 1100, armor: 'SuperHeavy', domain: 'GROUND', sight: 12
  }
};

export const CANONICAL_ENTITY_IDS = Object.keys(ENTITY_DEFS);

export const SUPERWEAPON_IDS = ['chrono_sphere', 'iron_curtain', 'weather_control', 'nuclear_silo'];

export const DOCTRINE_DEFS = {
  recon_satellite: { id: 'recon_satellite', cooldownTicks: sec(90), radius: 20, durationTicks: sec(15) },
  paratroopers: { id: 'paratroopers', cooldownTicks: sec(120), radius: 4, abyssalCount: 6, crimsonCount: 8 },
  nano_repair: { id: 'nano_repair', cooldownTicks: sec(90), radius: 12, healRatio: 0.35 },
  emp_strike: { id: 'emp_strike', cooldownTicks: sec(120), radius: 12, durationTicks: sec(8) }
};

export function nextRandom(state) {
  let t = ((state.prngState ?? 1) + 0x6d2b79f5) >>> 0;
  state.prngState = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function getEntityDef(typeId) {
  return ENTITY_DEFS[typeId] ?? null;
}

export function getUnitDamageStats(typeId, veterancyRank = 0) {
  const def = ENTITY_DEFS[typeId];
  const vet = VETERANCY_CONFIG[veterancyRank] ?? VETERANCY_CONFIG[0];
  const w = def?.weapon;
  return {
    maxHp: Math.round((def?.hp ?? 100) * vet.hpMult),
    damage: w ? Math.round(w.damage * vet.damageMult) : 0,
    burst: w?.burst ?? 1,
    cooldownTicks: w ? Math.max(1, Math.round(w.cooldownTicks * vet.cooldownMult)) : 30,
    speed: (def?.speed ?? 0) * vet.speedMult,
    sight: (def?.sight ?? 10) + vet.sightBonus,
    damageTakenMult: vet.damageTakenMult
  };
}

const RULE_PATCH_FIELDS = Object.freeze({
  cost: { min: 0, max: 50000, integer: true },
  buildTimeSec: { min: 0.5, max: 600, integer: false },
  hp: { min: 1, max: 100000, integer: true },
  speed: { min: 0, max: 60, integer: false },
  sight: { min: 1, max: 40, integer: false },
  power: { min: -1000, max: 1000, integer: true }
});

const WEAPON_PATCH_FIELDS = Object.freeze({
  damage: { min: 0, max: 50000, integer: false },
  range: { min: 0.5, max: 60, integer: false },
  cooldownTicks: { min: 1, max: 600, integer: true },
  splashRadius: { min: 0, max: 20, integer: false }
});

const BASE_ENTITY_SNAPSHOT = Object.freeze(
  Object.fromEntries(
    CANONICAL_ENTITY_IDS.map((id) => {
      const def = ENTITY_DEFS[id];
      const snap = {};
      for (const k of Object.keys(RULE_PATCH_FIELDS)) {
        if (k in def) snap[k] = def[k];
      }
      if (def.weapon) {
        snap.weapon = {};
        for (const wk of Object.keys(WEAPON_PATCH_FIELDS)) {
          if (wk in def.weapon) snap.weapon[wk] = def.weapon[wk];
        }
      }
      return [id, snap];
    })
  )
);

let activeRulePatch = null;

function clampStat(val, spec) {
  const num = Number(val);
  if (!Number.isFinite(num)) return null;
  const clamped = Math.min(spec.max, Math.max(spec.min, num));
  return spec.integer ? Math.round(clamped) : Number(clamped.toFixed(3));
}

export function resetRulePatch() {
  for (const id of CANONICAL_ENTITY_IDS) {
    const def = ENTITY_DEFS[id];
    const snap = BASE_ENTITY_SNAPSHOT[id];
    if (!def || !snap) continue;
    for (const k of Object.keys(RULE_PATCH_FIELDS)) {
      if (k in snap) def[k] = snap[k];
    }
    if (snap.weapon && def.weapon) {
      for (const wk of Object.keys(WEAPON_PATCH_FIELDS)) {
        if (wk in snap.weapon) def.weapon[wk] = snap.weapon[wk];
      }
    }
  }
  activeRulePatch = null;
  return true;
}

export function applyRulePatch(rawPatch) {
  if (!rawPatch || typeof rawPatch !== 'object' || Array.isArray(rawPatch)) {
    throw new Error('Rule patch must be a JSON object.');
  }
  resetRulePatch();

  const unitMap = rawPatch.units && typeof rawPatch.units === 'object' && !Array.isArray(rawPatch.units)
    ? rawPatch.units
    : rawPatch;

  const appliedUnits = [];
  const warnings = [];
  const cleanPatch = {};

  for (const [typeId, changes] of Object.entries(unitMap)) {
    if (typeId === '__proto__' || typeId === 'constructor' || typeId === 'prototype') continue;
    if (!Object.hasOwn(ENTITY_DEFS, typeId)) {
      warnings.push(`Unknown entity type skipped: ${typeId}`);
      continue;
    }
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) continue;

    const def = ENTITY_DEFS[typeId];
    const unitOut = {};

    for (const [field, spec] of Object.entries(RULE_PATCH_FIELDS)) {
      if (!Object.hasOwn(changes, field)) continue;
      const safeVal = clampStat(changes[field], spec);
      if (safeVal === null) continue;
      def[field] = safeVal;
      unitOut[field] = safeVal;
    }

    if (changes.weapon && typeof changes.weapon === 'object' && !Array.isArray(changes.weapon)) {
      if (!def.weapon) {
        warnings.push(`Entity ${typeId} has no weapon block; weapon overrides skipped.`);
      } else {
        const weaponOut = {};
        for (const [wField, wSpec] of Object.entries(WEAPON_PATCH_FIELDS)) {
          if (!Object.hasOwn(changes.weapon, wField)) continue;
          const safeVal = clampStat(changes.weapon[wField], wSpec);
          if (safeVal === null) continue;
          def.weapon[wField] = safeVal;
          weaponOut[wField] = safeVal;
        }
        if (Object.keys(weaponOut).length > 0) unitOut.weapon = weaponOut;
      }
    }

    if (Object.keys(unitOut).length > 0) {
      cleanPatch[typeId] = unitOut;
      appliedUnits.push(typeId);
    }
  }

  activeRulePatch = appliedUnits.length > 0 ? cleanPatch : null;
  return {
    appliedUnits,
    activePatch: getActiveRulePatch(),
    warnings
  };
}

export function getActiveRulePatch() {
  return activeRulePatch ? structuredClone(activeRulePatch) : null;
}
