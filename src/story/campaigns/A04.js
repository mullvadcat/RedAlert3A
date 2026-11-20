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
      id: 'a04_intro',
      when: 'onTimer',
      atTick: 8,
      actions: [
        DirectorActions.dialogue('dr_lin_prism', 'campaign.A04.dlgIntro', 5, '#67e8f9'),
        DirectorActions.dialogue('commander_crimson', 'campaign.A04.dlgCrimsonTaunt', 5, '#ef4444')
      ]
    },
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
        }),
        DirectorActions.choicePrompt('campaign.A04.choiceTitle', 'campaign.A04.choiceBody', [
          {
            labelKey: 'campaign.A04.choicePrism',
            actions: [
              DirectorActions.spawnWave({
                playerId: 0, factionId: 'abyssal', tag: 'a04_prism_reinf',
                units: [{ typeId: 'prism', x: 132, z: 252, count: 2 }]
              }),
              DirectorActions.dialogue('dr_lin_prism', 'campaign.A04.dlgPickPrism', 4, '#67e8f9')
            ]
          },
          {
            labelKey: 'campaign.A04.choiceChrono',
            actions: [
              DirectorActions.spawnWave({
                playerId: 0, factionId: 'abyssal', tag: 'a04_chrono_reinf',
                units: [{ typeId: 'chrono', x: 126, z: 260, count: 3 }]
              }),
              DirectorActions.grantCredits(0, 2000),
              DirectorActions.dialogue('eva_abyssal', 'campaign.A04.dlgPickChrono', 4, '#38bdf8')
            ]
          }
        ])
      ]
    },
    {
      id: 'a04_wave2',
      when: 'onTimer',
      atTick: 600,
      actions: [
        DirectorActions.dialogue('abyss0_signal', 'campaign.A04.dlgAbyssSignal', 5, '#c084fc'),
        DirectorActions.dialogue('eva_abyssal', 'campaign.A04.dlgWave2', 5, '#38bdf8'),
        DirectorActions.spawnWave({
          playerId: 1, factionId: 'crimson', tag: 'a04_wave2',
          x: 368, z: 256, attackMoveX: 132, attackMoveZ: 256,
          units: [
            { typeId: 'rhino', count: 3 },
            { typeId: 'v3', count: 2 }
          ]
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
        DirectorActions.dialogue('commander_abyssal', 'campaign.A04.dlgVictory', 5, '#38bdf8'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
