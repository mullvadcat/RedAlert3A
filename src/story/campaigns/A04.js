import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'A04',
  act: 'abyssal',
  order: 4,
  titleKey: 'campaign.A04.title',
  briefKey: 'campaign.A04.brief',
  mapId: 'refinery_basin',
  factionId: 'abyssal',
  enemyFactionId: 'crimson',
  startingCredits: 14000,
  objectives: [
    { id: 'obj_a04_valley', labelKey: 'campaign.A04.objValley', status: 'active' }
  ],
  setup(state) {
    clearLandingZone(state.map, 46, 128, 14);
    spawnMissionGroup(state, 0, 'abyssal', [
      { typeId: 'conyard', gx: 42, gz: 126 },
      { typeId: 'power_plant', gx: 50, gz: 122 },
      { typeId: 'power_plant', gx: 50, gz: 132 },
      { typeId: 'war_factory', gx: 58, gz: 126 },
      { typeId: 'battle_lab', gx: 40, gz: 118 },
      { typeId: 'prism_tower', gx: 68, gz: 122 },
      { typeId: 'prism_tower', gx: 68, gz: 132 },
      { typeId: 'prism', x: 130, z: 254, count: 3 },
      { typeId: 'chrono', x: 126, z: 262, count: 3 }
    ]);
    spawnMissionGroup(state, 1, 'crimson', [
      { typeId: 'conyard', gx: 208, gz: 126 },
      { typeId: 'power_plant', gx: 214, gz: 120 },
      { typeId: 'war_factory', gx: 198, gz: 126 },
      { typeId: 'rhino', x: 382, z: 256, count: 4 }
    ]);
  },
  triggers: [
    {
      id: 'a04_wave1',
      when: 'onTimer',
      atTick: 180,
      actions: [
        DirectorActions.dialogue('eva_abyssal', 'campaign.A04.dlgWave', 5, '#38bdf8'),
        DirectorActions.triggerCheckpoint('a04_wave_defense'),
        DirectorActions.spawnWave({
          playerId: 1, factionId: 'crimson', tag: 'a04_wave',
          units: [{ typeId: 'rhino', x: 360, z: 256, count: 4, attackMoveX: 130, attackMoveZ: 256 }]
        })
      ]
    },
    {
      id: 'a04_win',
      when: 'onAllEnemiesCleared',
      enemyTeamId: 1,
      minTick: 200,
      actions: [
        DirectorActions.objective('obj_a04_valley', 'campaign.A04.objValley', 'completed'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
