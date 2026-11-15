// Campaign Registry: 12+1 missions (A01..A06, C01..C06, EX13).

import A01 from './A01.js';
import A02 from './A02.js';
import A03 from './A03.js';
import A04 from './A04.js';
import A05 from './A05.js';
import A06 from './A06.js';
import C01 from './C01.js';
import C02 from './C02.js';
import C03 from './C03.js';
import C04 from './C04.js';
import C05 from './C05.js';
import C06 from './C06.js';
import EX13 from './EX13.js';

export const CAMPAIGN_MISSIONS = [
  A01, A02, A03, A04, A05, A06,
  C01, C02, C03, C04, C05, C06,
  EX13
];

export const CAMPAIGN_MISSION_BY_ID = new Map(
  CAMPAIGN_MISSIONS.map((m) => [m.id, m])
);

export function getCampaignMission(missionId) {
  if (!missionId) return null;
  const clean = String(missionId).trim().toUpperCase();
  return CAMPAIGN_MISSION_BY_ID.get(clean) ?? null;
}
