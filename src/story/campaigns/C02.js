import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'C02',
  act: 'crimson',
  order: 2,
  titleKey: 'campaign.C02.title',
  briefKey: 'campaign.C02.brief',
  mapId: 'archipelago_4p',
  factionId: 'crimson',
  enemyFactionId: 'abyssal',
  startingCredits: 12000,
  objectives: [
    { id: 'obj_c02_carriers', labelKey: 'campaign.C02.objCarriers', status: 'active' }
  ],
  setup(state) {
    clearLandingZone(state.map, 42, 128, 12);
    spawnMissionGroup(state, 0, 'crimson', [
      { typeId: 'conyard', gx: 38, gz: 126 },
      { typeId: 'power_plant', gx: 46, gz: 120 },
      { typeId: 'naval_yard', gx: 68, gz: 126 },
      { typeId: 'typhoon', x: 152, z: 256, count: 4 },
      { typeId: 'sea_scorpion', x: 146, z: 248, count: 3 }
    ]);
    spawnMissionGroup(state, 1, 'abyssal', [
      { typeId: 'conyard', gx: 210, gz: 126 },
      { typeId: 'power_plant', gx: 216, gz: 120 },
      { typeId: 'naval_yard', gx: 186, gz: 126 },
      { typeId: 'carrier', x: 356, z: 256, count: 2, tag: 'c02_carrier' },
      { typeId: 'dolphin', x: 344, z: 256, count: 3 }
    ]);
  },
  triggers: [
    {
      id: 'c02_intro',
      when: 'onTimer',
      atTick: 8,
      actions: [
        DirectorActions.dialogue('eva_crimson', 'campaign.C02.dlgIntro', 5, '#ef4444'),
        DirectorActions.triggerCheckpoint('c02_subs_deployed')
      ]
    },
    {
      id: 'c02_carriers_sunk',
      when: 'onUnitDestroyed',
      tag: 'c02_carrier',
      actions: [
        DirectorActions.objective('obj_c02_carriers', 'campaign.C02.objCarriers', 'completed'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
