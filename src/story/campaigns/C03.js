import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'C03',
  act: 'crimson',
  order: 3,
  titleKey: 'campaign.C03.title',
  briefKey: 'campaign.C03.brief',
  mapId: 'frost_pass',
  factionId: 'crimson',
  enemyFactionId: 'abyssal',
  startingCredits: 11000,
  objectives: [
    { id: 'obj_c03_power', labelKey: 'campaign.C03.objPower', status: 'active' }
  ],
  setup(state) {
    clearLandingZone(state.map, 44, 128, 12);
    spawnMissionGroup(state, 0, 'crimson', [
      { typeId: 'conyard', gx: 40, gz: 126 },
      { typeId: 'power_plant', gx: 48, gz: 120 },
      { typeId: 'war_factory', gx: 56, gz: 126 },
      { typeId: 'tesla_coil', gx: 68, gz: 126 },
      { typeId: 'tesla_trooper', x: 132, z: 252, count: 4 },
      { typeId: 'kirov', x: 108, z: 256, count: 2 }
    ]);
    spawnMissionGroup(state, 1, 'abyssal', [
      { typeId: 'conyard', gx: 208, gz: 126 },
      { typeId: 'power_plant', gx: 214, gz: 120 },
      { typeId: 'aa_turret', gx: 196, gz: 126 },
      { typeId: 'grizzly', x: 382, z: 256, count: 4 }
    ]);
  },
  triggers: [
    {
      id: 'c03_intro',
      when: 'onTimer',
      atTick: 8,
      actions: [
        DirectorActions.dialogue('dr_volkov_tesla', 'campaign.C03.dlgGromovaWarn', 5, '#fb923c'),
        DirectorActions.dialogue('commander_crimson', 'campaign.C03.dlgIntro', 5, '#ef4444'),
        DirectorActions.triggerCheckpoint('c03_kirov_airlift')
      ]
    },
    {
      id: 'c03_abyss_interfere',
      when: 'onTimer',
      atTick: 180,
      actions: [
        DirectorActions.dialogue('abyss0_signal', 'campaign.C03.dlgAbyssInterfere', 5, '#c084fc')
      ]
    },
    {
      id: 'c03_raid',
      when: 'onTimer',
      atTick: 390,
      actions: [
        DirectorActions.dialogue('eva_crimson', 'campaign.C03.dlgRaid', 5, '#ef4444'),
        DirectorActions.spawnWave({
          playerId: 1, factionId: 'abyssal', tag: 'c03_raid',
          x: 374, z: 256, attackMoveX: 136, attackMoveZ: 256,
          units: [
            { typeId: 'rocketeer', count: 4, air: true },
            { typeId: 'ifv', count: 3 }
          ]
        })
      ]
    },
    {
      id: 'c03_win',
      when: 'onAllEnemiesCleared',
      enemyTeamId: 1,
      minTick: 25,
      actions: [
        DirectorActions.objective('obj_c03_power', 'campaign.C03.objPower', 'completed'),
        DirectorActions.dialogue('commander_crimson', 'campaign.C03.dlgVictory', 5, '#ef4444'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
