import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'C05',
  act: 'crimson',
  order: 5,
  titleKey: 'campaign.C05.title',
  briefKey: 'campaign.C05.brief',
  mapId: 'harbor',
  factionId: 'crimson',
  enemyFactionId: 'abyssal',
  startingCredits: 16000,
  objectives: [
    { id: 'obj_c05_weather', labelKey: 'campaign.C05.objWeather', status: 'active' }
  ],
  setup(state) {
    clearLandingZone(state.map, 44, 128, 12);
    spawnMissionGroup(state, 0, 'crimson', [
      { typeId: 'conyard', gx: 40, gz: 126 },
      { typeId: 'power_plant', gx: 48, gz: 120 },
      { typeId: 'naval_yard', gx: 70, gz: 126 },
      { typeId: 'dreadnought', x: 158, z: 256, count: 3 },
      { typeId: 'desolator', x: 110, z: 256, count: 4 }
    ]);
    spawnMissionGroup(state, 1, 'abyssal', [
      { typeId: 'conyard', gx: 208, gz: 126 },
      { typeId: 'power_plant', gx: 214, gz: 118 },
      { typeId: 'weather_control', gx: 198, gz: 126, tag: 'c05_weather_core' },
      { typeId: 'aegis', x: 356, z: 256, count: 2 }
    ]);
  },
  triggers: [
    {
      id: 'c05_intro',
      when: 'onTimer',
      atTick: 8,
      actions: [
        DirectorActions.dialogue('commander_crimson', 'campaign.C05.dlgIntro', 5, '#ef4444'),
        DirectorActions.triggerCheckpoint('c05_dreadnought_raid')
      ]
    },
    {
      id: 'c05_weather_down',
      when: 'onUnitDestroyed',
      tag: 'c05_weather_core',
      actions: [
        DirectorActions.objective('obj_c05_weather', 'campaign.C05.objWeather', 'completed'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
