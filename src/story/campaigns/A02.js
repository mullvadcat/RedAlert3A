import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'A02',
  act: 'abyssal',
  order: 2,
  titleKey: 'campaign.A02.title',
  briefKey: 'campaign.A02.brief',
  mapId: 'island_hop',
  factionId: 'abyssal',
  enemyFactionId: 'crimson',
  startingCredits: 12000,
  objectives: [
    { id: 'obj_a02_aegis', labelKey: 'campaign.A02.objNavy', status: 'active' }
  ],
  setup(state) {
    clearLandingZone(state.map, 46, 128, 12);
    spawnMissionGroup(state, 0, 'abyssal', [
      { typeId: 'conyard', gx: 40, gz: 126 },
      { typeId: 'power_plant', gx: 48, gz: 122 },
      { typeId: 'naval_yard', gx: 68, gz: 132 },
      { typeId: 'aegis', x: 148, z: 266, count: 3 },
      { typeId: 'dolphin', x: 156, z: 256, count: 3 }
    ]);
    spawnMissionGroup(state, 1, 'crimson', [
      { typeId: 'conyard', gx: 210, gz: 126 },
      { typeId: 'power_plant', gx: 216, gz: 122 },
      { typeId: 'naval_yard', gx: 186, gz: 126 },
      { typeId: 'kirov', x: 370, z: 256, count: 2, tag: 'a02_kirov' },
      { typeId: 'typhoon', x: 340, z: 260, count: 3 }
    ]);
  },
  triggers: [
    {
      id: 'a02_start',
      when: 'onTimer',
      atTick: 10,
      actions: [
        DirectorActions.dialogue('commander_abyssal', 'campaign.A02.dlgIntro', 5, '#38bdf8'),
        DirectorActions.dialogue('commander_crimson', 'campaign.A02.dlgCrimsonTaunt', 5, '#ef4444'),
        DirectorActions.triggerCheckpoint('a02_start')
      ]
    },
    {
      id: 'a02_wave2',
      when: 'onTimer',
      atTick: 390,
      actions: [
        DirectorActions.dialogue('eva_abyssal', 'campaign.A02.dlgWaveWarning', 5, '#38bdf8'),
        DirectorActions.dialogue('dr_lin_prism', 'campaign.A02.dlgAnomaly', 5, '#67e8f9'),
        DirectorActions.spawnWave({
          playerId: 1, factionId: 'crimson', tag: 'a02_wave2',
          x: 350, z: 244, attackMoveX: 150, attackMoveZ: 258,
          units: [
            { typeId: 'kirov', count: 1, air: true },
            { typeId: 'typhoon', count: 2, naval: true }
          ]
        })
      ]
    },
    {
      id: 'a02_victory',
      when: 'onAllEnemiesCleared',
      enemyTeamId: 1,
      minTick: 25,
      actions: [
        DirectorActions.objective('obj_a02_aegis', 'campaign.A02.objNavy', 'completed'),
        DirectorActions.dialogue('commander_abyssal', 'campaign.A02.dlgVictory', 5, '#38bdf8'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
