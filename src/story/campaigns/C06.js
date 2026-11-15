import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'C06',
  act: 'crimson',
  order: 6,
  titleKey: 'campaign.C06.title',
  briefKey: 'campaign.C06.brief',
  mapId: 'crater_4ffa',
  factionId: 'crimson',
  enemyFactionId: 'abyssal',
  startingCredits: 20000,
  objectives: [
    { id: 'obj_c06_core', labelKey: 'campaign.C06.objCore', status: 'active' }
  ],
  setup(state) {
    clearLandingZone(state.map, 44, 128, 14);
    spawnMissionGroup(state, 0, 'crimson', [
      { typeId: 'conyard', gx: 40, gz: 126 },
      { typeId: 'power_plant', gx: 48, gz: 120 },
      { typeId: 'power_plant', gx: 48, gz: 132 },
      { typeId: 'battle_lab', gx: 36, gz: 118 },
      { typeId: 'nuclear_silo', gx: 36, gz: 136 },
      { typeId: 'apocalypse', x: 118, z: 256, count: 4 },
      { typeId: 'sledge', x: 124, z: 252, count: 1 }
    ]);
    spawnMissionGroup(state, 1, 'abyssal', [
      { typeId: 'conyard', gx: 208, gz: 126 },
      { typeId: 'power_plant', gx: 214, gz: 120 },
      { typeId: 'weather_control', gx: 200, gz: 126 },
      { typeId: 'prism', x: 386, z: 256, count: 4 }
    ]);
  },
  triggers: [
    {
      id: 'c06_intro',
      when: 'onTimer',
      atTick: 10,
      actions: [
        DirectorActions.grantSuperweaponReady(0, 'nuclear_silo'),
        DirectorActions.dialogue('eva_crimson', 'campaign.C06.dlgIntro', 5, '#ef4444'),
        DirectorActions.triggerCheckpoint('c06_nuke_ready')
      ]
    },
    {
      id: 'c06_win',
      when: 'onAllEnemiesCleared',
      enemyTeamId: 1,
      minTick: 25,
      actions: [
        DirectorActions.objective('obj_c06_core', 'campaign.C06.objCore', 'completed'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
