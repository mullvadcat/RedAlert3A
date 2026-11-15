import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'A06',
  act: 'abyssal',
  order: 6,
  titleKey: 'campaign.A06.title',
  briefKey: 'campaign.A06.brief',
  mapId: 'strait_2v2',
  factionId: 'abyssal',
  enemyFactionId: 'crimson',
  startingCredits: 20000,
  objectives: [
    { id: 'obj_a06_seal', labelKey: 'campaign.A06.objSeal', status: 'active' }
  ],
  setup(state) {
    clearLandingZone(state.map, 46, 128, 14);
    spawnMissionGroup(state, 0, 'abyssal', [
      { typeId: 'conyard', gx: 40, gz: 126 },
      { typeId: 'power_plant', gx: 48, gz: 120 },
      { typeId: 'power_plant', gx: 48, gz: 132 },
      { typeId: 'battle_lab', gx: 36, gz: 118 },
      { typeId: 'weather_control', gx: 36, gz: 136 },
      { typeId: 'naval_yard', gx: 72, gz: 126 },
      { typeId: 'carrier', x: 162, z: 256, count: 2 },
      { typeId: 'aegis', x: 168, z: 266, count: 2 },
      { typeId: 'prism', x: 118, z: 256, count: 4 }
    ]);
    spawnMissionGroup(state, 1, 'crimson', [
      { typeId: 'conyard', gx: 208, gz: 126 },
      { typeId: 'power_plant', gx: 214, gz: 118 },
      { typeId: 'nuclear_silo', gx: 200, gz: 126 },
      { typeId: 'dreadnought', x: 350, z: 256, count: 2 },
      { typeId: 'apocalypse', x: 392, z: 256, count: 3 }
    ]);
  },
  triggers: [
    {
      id: 'a06_intro',
      when: 'onTimer',
      atTick: 10,
      actions: [
        DirectorActions.grantSuperweaponReady(0, 'weather_control'),
        DirectorActions.dialogue('eva_abyssal', 'campaign.A06.dlgIntro', 5, '#38bdf8'),
        DirectorActions.triggerCheckpoint('a06_finale_ready')
      ]
    },
    {
      id: 'a06_victory',
      when: 'onAllEnemiesCleared',
      enemyTeamId: 1,
      minTick: 25,
      actions: [
        DirectorActions.objective('obj_a06_seal', 'campaign.A06.objSeal', 'completed'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
