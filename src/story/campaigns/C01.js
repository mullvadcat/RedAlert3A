import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'C01',
  act: 'crimson',
  order: 1,
  titleKey: 'campaign.C01.title',
  briefKey: 'campaign.C01.brief',
  mapId: 'twin_bridges',
  factionId: 'crimson',
  enemyFactionId: 'abyssal',
  startingCredits: 10000,
  objectives: [
    { id: 'obj_c01_bridge', labelKey: 'campaign.C01.objBridge', status: 'active' }
  ],
  setup(state) {
    clearLandingZone(state.map, 44, 128, 14);
    spawnMissionGroup(state, 0, 'crimson', [
      { typeId: 'conyard', gx: 40, gz: 126 },
      { typeId: 'power_plant', gx: 48, gz: 120 },
      { typeId: 'barracks', gx: 48, gz: 132 },
      { typeId: 'war_factory', gx: 56, gz: 126 },
      { typeId: 'rhino', x: 112, z: 256, count: 4 },
      { typeId: 'conscript', x: 108, z: 248, count: 8 },
      { typeId: 'engineer', x: 104, z: 256, count: 2 }
    ]);
    spawnMissionGroup(state, 2, 'neutral', [
      { typeId: 'oil_derrick', gx: 116, gz: 126, tag: 'c01_bridge_outpost' }
    ]);
    spawnMissionGroup(state, 1, 'abyssal', [
      { typeId: 'conyard', gx: 208, gz: 126 },
      { typeId: 'power_plant', gx: 214, gz: 120 },
      { typeId: 'pillbox', gx: 196, gz: 126 },
      { typeId: 'grizzly', x: 386, z: 256, count: 3 }
    ]);
  },
  triggers: [
    {
      id: 'c01_intro',
      when: 'onTimer',
      atTick: 8,
      actions: [
        DirectorActions.dialogue('commander_crimson', 'campaign.C01.dlgIntro', 5, '#ef4444'),
        DirectorActions.dialogue('commander_abyssal', 'campaign.C01.dlgAbyssalTaunt', 5, '#38bdf8')
      ]
    },
    {
      id: 'c01_outpost_cap',
      when: 'onCapture',
      tag: 'c01_bridge_outpost',
      byPlayerId: 0,
      actions: [
        DirectorActions.cameraPanTo(232, 252, 0.85, 3000),
        DirectorActions.triggerCheckpoint('c01_bridge_secured'),
        DirectorActions.dialogue('commander_crimson', 'campaign.C01.dlgCaptured', 5, '#ef4444'),
        DirectorActions.choicePrompt('campaign.C01.choiceTitle', 'campaign.C01.choiceBody', [
          {
            labelKey: 'campaign.C01.choiceArmor',
            actions: [
              DirectorActions.spawnWave({
                playerId: 0, factionId: 'crimson', tag: 'c01_armored',
                units: [{ typeId: 'rhino', x: 125, z: 256, count: 3 }]
              }),
              DirectorActions.dialogue('commander_crimson', 'campaign.C01.dlgPickArmor', 4, '#ef4444')
            ]
          },
          {
            labelKey: 'campaign.C01.choiceInfantry',
            actions: [
              DirectorActions.spawnWave({
                playerId: 0, factionId: 'crimson', tag: 'c01_infantry',
                units: [{ typeId: 'tesla_trooper', x: 125, z: 256, count: 4 }]
              }),
              DirectorActions.grantCredits(0, 2000),
              DirectorActions.dialogue('eva_crimson', 'campaign.C01.dlgPickInfantry', 4, '#ef4444')
            ]
          }
        ])
      ]
    },
    {
      id: 'c01_counter',
      when: 'onTimer',
      atTick: 420,
      actions: [
        DirectorActions.dialogue('eva_crimson', 'campaign.C01.dlgCounter', 5, '#ef4444'),
        DirectorActions.spawnWave({
          playerId: 1, factionId: 'abyssal', tag: 'c01_counter',
          x: 376, z: 256, attackMoveX: 180, attackMoveZ: 256,
          units: [
            { typeId: 'grizzly', count: 2 },
            { typeId: 'gi', count: 4 }
          ]
        })
      ]
    },
    {
      id: 'c01_win',
      when: 'onAllEnemiesCleared',
      enemyTeamId: 1,
      minTick: 25,
      actions: [
        DirectorActions.objective('obj_c01_bridge', 'campaign.C01.objBridge', 'completed'),
        DirectorActions.dialogue('commander_crimson', 'campaign.C01.dlgVictory', 5, '#ef4444'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
