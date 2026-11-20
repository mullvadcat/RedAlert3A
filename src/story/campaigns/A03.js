import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'A03',
  act: 'abyssal',
  order: 3,
  titleKey: 'campaign.A03.title',
  briefKey: 'campaign.A03.brief',
  mapId: 'frost_pass',
  factionId: 'abyssal',
  enemyFactionId: 'crimson',
  startingCredits: 10000,
  objectives: [
    { id: 'obj_a03_v3', labelKey: 'campaign.A03.objV3', status: 'active' }
  ],
  setup(state) {
    clearLandingZone(state.map, 44, 128, 12);
    spawnMissionGroup(state, 0, 'abyssal', [
      { typeId: 'conyard', gx: 40, gz: 126 },
      { typeId: 'power_plant', gx: 46, gz: 120 },
      { typeId: 'barracks', gx: 48, gz: 132 },
      { typeId: 'airforce_radar', gx: 36, gz: 118 },
      { typeId: 'rocketeer', x: 110, z: 252, count: 6 },
      { typeId: 'nighthawk', x: 100, z: 248, count: 1 },
      { typeId: 'shadow', x: 102, z: 256, count: 1 }
    ]);
    spawnMissionGroup(state, 1, 'crimson', [
      { typeId: 'conyard', gx: 208, gz: 126 },
      { typeId: 'power_plant', gx: 214, gz: 120 },
      { typeId: 'v3', x: 390, z: 244, count: 3, tag: 'a03_v3_battery' },
      { typeId: 'flak_trooper', x: 386, z: 252, count: 4 }
    ]);
  },
  triggers: [
    {
      id: 'a03_intro',
      when: 'onTimer',
      atTick: 8,
      actions: [
        DirectorActions.dialogue('commander_abyssal', 'campaign.A03.dlgIntro', 5, '#38bdf8'),
        DirectorActions.dialogue('hero_shadow', 'campaign.A03.dlgShadowRecon', 5, '#22d3ee')
      ]
    },
    {
      id: 'a03_patrol',
      when: 'onTimer',
      atTick: 360,
      actions: [
        DirectorActions.dialogue('eva_abyssal', 'campaign.A03.dlgPatrol', 5, '#38bdf8'),
        DirectorActions.spawnWave({
          playerId: 1, factionId: 'crimson', tag: 'a03_patrol',
          x: 376, z: 256, attackMoveX: 160, attackMoveZ: 256,
          units: [
            { typeId: 'flak_trooper', count: 4 },
            { typeId: 'rhino', count: 2 }
          ]
        })
      ]
    },
    {
      id: 'a03_v3_down',
      when: 'onUnitDestroyed',
      tag: 'a03_v3_battery',
      actions: [
        DirectorActions.objective('obj_a03_v3', 'campaign.A03.objV3', 'completed'),
        DirectorActions.triggerCheckpoint('a03_v3_cleared'),
        DirectorActions.dialogue('eva_abyssal', 'campaign.A03.dlgV3Cleared', 4, '#38bdf8'),
        DirectorActions.dialogue('abyss0_signal', 'campaign.A03.dlgAbyssPulse', 5, '#c084fc')
      ]
    },
    {
      id: 'a03_win',
      when: 'onAllEnemiesCleared',
      enemyTeamId: 1,
      minTick: 25,
      actions: [
        DirectorActions.dialogue('commander_abyssal', 'campaign.A03.dlgVictory', 5, '#38bdf8'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
