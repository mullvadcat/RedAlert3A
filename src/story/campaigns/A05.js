import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'A05',
  act: 'abyssal',
  order: 5,
  titleKey: 'campaign.A05.title',
  briefKey: 'campaign.A05.brief',
  mapId: 'crater_4ffa',
  factionId: 'abyssal',
  enemyFactionId: 'crimson',
  startingCredits: 16000,
  objectives: [
    { id: 'obj_a05_silos', labelKey: 'campaign.A05.objSilos', status: 'active' }
  ],
  setup(state) {
    clearLandingZone(state.map, 44, 128, 14);
    spawnMissionGroup(state, 0, 'abyssal', [
      { typeId: 'conyard', gx: 40, gz: 126 },
      { typeId: 'power_plant', gx: 48, gz: 120 },
      { typeId: 'power_plant', gx: 48, gz: 132 },
      { typeId: 'war_factory', gx: 56, gz: 126 },
      { typeId: 'battle_lab', gx: 36, gz: 118 },
      { typeId: 'chrono_sphere', gx: 36, gz: 136 },
      { typeId: 'prism', x: 120, z: 256, count: 5 },
      { typeId: 'grizzly', x: 116, z: 248, count: 4 }
    ]);
    spawnMissionGroup(state, 1, 'crimson', [
      { typeId: 'conyard', gx: 210, gz: 126 },
      { typeId: 'power_plant', gx: 216, gz: 120 },
      { typeId: 'nuclear_silo', gx: 202, gz: 118, tag: 'a05_silo' },
      { typeId: 'nuclear_silo', gx: 202, gz: 136, tag: 'a05_silo' },
      { typeId: 'apocalypse', x: 392, z: 256, count: 3 }
    ]);
  },
  triggers: [
    {
      id: 'a05_ready',
      when: 'onTimer',
      atTick: 10,
      actions: [
        DirectorActions.grantSuperweaponReady(0, 'chrono_sphere'),
        DirectorActions.dialogue('commander_abyssal', 'campaign.A05.dlgIntro', 5, '#38bdf8'),
        DirectorActions.triggerCheckpoint('a05_chrono_ready')
      ]
    },
    {
      id: 'a05_silos_destroyed',
      when: 'onUnitDestroyed',
      tag: 'a05_silo',
      actions: [
        DirectorActions.objective('obj_a05_silos', 'campaign.A05.objSilos', 'completed'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
