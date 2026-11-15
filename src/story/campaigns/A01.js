import { DirectorActions } from '../director.js';
import { spawnMissionGroup, clearLandingZone } from './missionHelper.js';

export default {
  id: 'A01',
  act: 'abyssal',
  order: 1,
  titleKey: 'campaign.A01.title',
  briefKey: 'campaign.A01.brief',
  mapId: 'harbor',
  factionId: 'abyssal',
  enemyFactionId: 'crimson',
  startingCredits: 9000,
  objectives: [
    { id: 'obj_capture_outpost', labelKey: 'campaign.A01.objCapture', status: 'active' },
    { id: 'obj_clear_beach', labelKey: 'campaign.A01.objClear', status: 'active' }
  ],
  setup(state) {
    clearLandingZone(state.map, 40, 128, 14);
    clearLandingZone(state.map, 110, 128, 10);
    spawnMissionGroup(state, 0, 'abyssal', [
      { typeId: 'conyard', gx: 36, gz: 124 },
      { typeId: 'power_plant', gx: 44, gz: 120 },
      { typeId: 'barracks', gx: 44, gz: 130 },
      { typeId: 'grizzly', x: 105, z: 256, count: 4 },
      { typeId: 'gi', x: 112, z: 260, count: 6 },
      { typeId: 'engineer', x: 108, z: 252, count: 2 },
      { typeId: 'hover_transport', x: 96, z: 244, count: 1 }
    ]);
    // Neutral coastal tech airport outpost ready for engineer capture
    spawnMissionGroup(state, 2, 'neutral', [
      { typeId: 'tech_airport', gx: 108, gz: 126, tag: 'a01_outpost' }
    ]);
    // Enemy beach garrison
    spawnMissionGroup(state, 1, 'crimson', [
      { typeId: 'barracks', gx: 204, gz: 124 },
      { typeId: 'power_plant', gx: 210, gz: 118 },
      { typeId: 'pillbox', gx: 196, gz: 126 },
      { typeId: 'conscript', x: 380, z: 254, count: 6 },
      { typeId: 'rhino', x: 388, z: 258, count: 2 }
    ]);
  },
  triggers: [
    {
      id: 'a01_intro',
      when: 'onTimer',
      atTick: 5,
      actions: [
        DirectorActions.dialogue('eva_abyssal', 'campaign.A01.dlgIntro', 5, '#38bdf8')
      ]
    },
    {
      id: 'a01_capture_outpost',
      when: 'onCapture',
      tag: 'a01_outpost',
      byPlayerId: 0,
      actions: [
        DirectorActions.objective('obj_capture_outpost', 'campaign.A01.objCapture', 'completed'),
        DirectorActions.cameraPanTo(216, 252, 0.8, 3000),
        DirectorActions.dialogue('commander_abyssal', 'campaign.A01.dlgCaptured', 5, '#38bdf8'),
        DirectorActions.triggerCheckpoint('a01_outpost_secured'),
        DirectorActions.choicePrompt('campaign.A01.choiceTitle', 'campaign.A01.choiceBody', [
          {
            labelKey: 'campaign.A01.choiceArmor',
            actions: [
              DirectorActions.spawnWave({
                playerId: 0, factionId: 'abyssal', tag: 'a01_reinf',
                units: [{ typeId: 'grizzly', x: 130, z: 256, count: 3 }]
              }),
              DirectorActions.dialogue('eva_abyssal', 'campaign.A01.dlgReinf', 4, '#38bdf8')
            ]
          },
          {
            labelKey: 'campaign.A01.choiceCredits',
            actions: [
              DirectorActions.grantCredits(0, 3500),
              DirectorActions.dialogue('eva_abyssal', 'campaign.A01.dlgCredits', 4, '#38bdf8')
            ]
          }
        ])
      ]
    },
    {
      id: 'a01_victory',
      when: 'onAllEnemiesCleared',
      enemyTeamId: 1,
      minTick: 20,
      actions: [
        DirectorActions.objective('obj_clear_beach', 'campaign.A01.objClear', 'completed'),
        DirectorActions.victory(0)
      ]
    }
  ]
};
