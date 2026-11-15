import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'C04',
  act: 'crimson',
  order: 4,
  titleKey: 'campaign.C04.title',
  briefKey: 'campaign.C04.brief',
  mapId: 'alpine_3ffa',
  factionId: 'crimson',
  enemyFactionId: 'abyssal',
  startingCredits: 15000,
  objectives: [
    { id: 'obj_c04_gauntlet', labelKey: 'campaign.C04.objGauntlet', status: 'active' }
  ],
  setup(state) {
    clearLandingZone(state.map, 44, 128, 14);
    spawnMissionGroup(state, 0, 'crimson', [
      { typeId: 'conyard', gx: 40, gz: 126 },
      { typeId: 'power_plant', gx: 48, gz: 120 },
      { typeId: 'power_plant', gx: 48, gz: 132 },
      { typeId: 'battle_lab', gx: 36, gz: 118 },
      { typeId: 'iron_curtain', gx: 36, gz: 136 },
      { typeId: 'apocalypse', x: 118, z: 256, count: 4 },
      { typeId: 'rhino', x: 114, z: 248, count: 4 }
    ]);
    spawnMissionGroup(state, 1, 'abyssal', [
      { typeId: 'conyard', gx: 208, gz: 126 },
      { typeId: 'power_plant', gx: 214, gz: 120 },
      { typeId: 'prism_tower', gx: 192, gz: 122 },
      { typeId: 'prism_tower', gx: 192, gz: 130 },
      { typeId: 'prism', x: 388, z: 256, count: 3 }
    ]);
  },
  triggers: [
    {
      id: 'c04_ready',
      when: 'onTimer',
      atTick: 10,
      actions: [
        DirectorActions.grantSuperweaponReady(0, 'iron_curtain'),
        DirectorActions.dialogue('eva_crimson', 'campaign.C04.dlgIntro', 5, '#ef4444'),
        DirectorActions.triggerCheckpoint('c04_iron_spear')
      ]
    },
    {
      id: 'c04_win',
      when: 'onAllEnemiesCleared',
      enemyTeamId: 1,
      minTick: 25,
      actions: [
        DirectorActions.objective('obj_c04_gauntlet', 'campaign.C04.objGauntlet', 'completed'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
