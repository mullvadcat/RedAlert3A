import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'EX13',
  act: 'finale',
  order: 13,
  allowDualFaction: true,
  titleKey: 'campaign.EX13.title',
  briefKey: 'campaign.EX13.brief',
  mapId: 'strait_2v2',
  factionId: 'abyssal',
  enemyFactionId: 'crimson',
  startingCredits: 30000,
  objectives: [
    { id: 'obj_ex13_hives', labelKey: 'campaign.EX13.objHives', status: 'active' }
  ],
  setup(state) {
    if (state.players[0]) {
      state.players[0].allowDualFaction = true;
    }
    clearLandingZone(state.map, 44, 128, 18);
    clearLandingZone(state.map, 204, 128, 18);

    // Unified Abyssal + Crimson Joint Command with all 4 Superweapons on screen
    spawnMissionGroup(state, 0, 'abyssal', [
      { typeId: 'conyard', gx: 36, gz: 120, factionId: 'abyssal' },
      { typeId: 'conyard', gx: 36, gz: 134, factionId: 'crimson' },
      { typeId: 'nuclear_reactor', gx: 46, gz: 116 },
      { typeId: 'nuclear_reactor', gx: 46, gz: 136 },
      { typeId: 'nuclear_reactor', gx: 36, gz: 110 },
      { typeId: 'nuclear_reactor', gx: 36, gz: 144 },
      { typeId: 'barracks', gx: 54, gz: 120 },
      { typeId: 'war_factory', gx: 54, gz: 132 },
      { typeId: 'airforce_radar', gx: 44, gz: 144 },
      { typeId: 'battle_lab', gx: 30, gz: 126 },
      { typeId: 'chrono_sphere', gx: 26, gz: 112 },
      { typeId: 'iron_curtain', gx: 26, gz: 122 },
      { typeId: 'weather_control', gx: 26, gz: 132 },
      { typeId: 'nuclear_silo', gx: 26, gz: 142 },
      { typeId: 'apocalypse', x: 116, z: 256, count: 4, factionId: 'crimson' },
      { typeId: 'prism', x: 110, z: 248, count: 4, factionId: 'abyssal' }
    ]);

    // 3 Abyss-0 Sovereign Bio-Mecha Hive Cores
    spawnMissionGroup(state, 1, 'abyss0', [
      { typeId: 'conyard', gx: 204, gz: 110, factionId: 'abyss0', tag: 'ex13_hive', hpMult: 3.0 },
      { typeId: 'conyard', gx: 208, gz: 128, factionId: 'abyss0', tag: 'ex13_hive', hpMult: 3.0 },
      { typeId: 'conyard', gx: 204, gz: 146, factionId: 'abyss0', tag: 'ex13_hive', hpMult: 3.0 },
      { typeId: 'war_factory', gx: 194, gz: 128, factionId: 'abyss0' },
      { typeId: 'apocalypse', x: 382, z: 256, count: 4, factionId: 'abyss0' },
      { typeId: 'kirov', x: 396, z: 256, count: 2, factionId: 'abyss0' }
    ]);
  },
  triggers: [
    {
      id: 'ex13_intro',
      when: 'onTimer',
      atTick: 8,
      actions: [
        DirectorActions.grantSuperweaponReady(0, 'chrono_sphere'),
        DirectorActions.grantSuperweaponReady(0, 'iron_curtain'),
        DirectorActions.grantSuperweaponReady(0, 'weather_control'),
        DirectorActions.grantSuperweaponReady(0, 'nuclear_silo'),
        DirectorActions.dialogue('eva_abyssal', 'campaign.EX13.dlgIntro', 6, '#f59e0b'),
        DirectorActions.dialogue('commander_abyssal', 'campaign.EX13.dlgLinJoint', 5, '#38bdf8'),
        DirectorActions.dialogue('commander_crimson', 'campaign.EX13.dlgVolkovJoint', 5, '#ef4444'),
        DirectorActions.dialogue('abyss0_signal', 'campaign.EX13.dlgAbyss0', 5, '#c084fc'),
        DirectorActions.triggerCheckpoint('ex13_joint_command')
      ]
    },
    {
      id: 'ex13_wave1',
      when: 'onTimer',
      atTick: 210,
      actions: [
        DirectorActions.dialogue('dr_lin_prism', 'campaign.EX13.dlgWave1SciA', 5, '#67e8f9'),
        DirectorActions.dialogue('dr_volkov_tesla', 'campaign.EX13.dlgWave1SciB', 5, '#fb923c'),
        DirectorActions.spawnWave({
          playerId: 1, factionId: 'abyss0', tag: 'ex13_wave1',
          x: 382, z: 256, attackMoveX: 115, attackMoveZ: 256,
          units: [
            { typeId: 'apocalypse', count: 2 },
            { typeId: 'prism', count: 2 }
          ]
        })
      ]
    },
    {
      id: 'ex13_wave2',
      when: 'onTimer',
      atTick: 600,
      actions: [
        DirectorActions.dialogue('abyss0_signal', 'campaign.EX13.dlgWave2Abyss', 5, '#c084fc'),
        DirectorActions.dialogue('hero_sledge', 'campaign.EX13.dlgWave2Heroes', 5, '#f97316'),
        DirectorActions.spawnWave({
          playerId: 1, factionId: 'abyss0', tag: 'ex13_wave2',
          x: 392, z: 256, attackMoveX: 95, attackMoveZ: 256,
          units: [
            { typeId: 'kirov', count: 2, air: true },
            { typeId: 'v3', count: 2 }
          ]
        })
      ]
    },
    {
      id: 'ex13_wave3',
      when: 'onTimer',
      atTick: 1100,
      actions: [
        DirectorActions.dialogue('commander_abyssal', 'campaign.EX13.dlgWave3Final', 6, '#f59e0b'),
        DirectorActions.spawnWave({
          playerId: 1, factionId: 'abyss0', tag: 'ex13_wave3',
          x: 382, z: 256, attackMoveX: 105, attackMoveZ: 256,
          units: [
            { typeId: 'apocalypse', count: 3 },
            { typeId: 'prism', count: 3 }
          ]
        })
      ]
    },
    {
      id: 'ex13_hives_destroyed',
      when: 'onUnitDestroyed',
      tag: 'ex13_hive',
      actions: [
        DirectorActions.objective('obj_ex13_hives', 'campaign.EX13.objHives', 'completed'),
        DirectorActions.dialogue('commander_abyssal', 'campaign.EX13.dlgVictory', 5, '#f59e0b'),
        DirectorActions.dialogue('commander_crimson', 'campaign.EX13.dlgVictoryVolkov', 5, '#f59e0b'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
