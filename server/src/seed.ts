import { Player, PlayerStats, Settings, State, Team } from './types';

// Seeded from "DPL_Season_4_Auction_Plan_1.xlsx" (exported 7 Jul 2026).
// Everything here is editable from the admin console after first boot.

export const DEFAULT_SETTINGS: Settings = {
  auctionName: 'DPL Season 4 Player Auction',
  purse: 10000,
  minSquad: 7,
  maxSquad: 8,
  reservePerSlot: 200,
  increments: [
    { upTo: 1000, step: 100 },
    { upTo: 3000, step: 200 },
    { upTo: null, step: 500 },
  ],
  bidderBidding: true,
  tiers: [
    { key: 'diamond', name: 'Diamond', basePrice: 1000, color: '#67e8f9', order: 1 },
    { key: 'gold', name: 'Gold', basePrice: 600, color: '#fbbf24', order: 2 },
    { key: 'emerald', name: 'Emerald', basePrice: 400, color: '#34d399', order: 3 },
    { key: 'new', name: 'New Players', basePrice: 200, color: '#c4b5fd', order: 4 },
  ],
};

const TEAM_SEED: Omit<Team, 'code'>[] = [
  { id: 't1', name: 'Franchise 1', captain: 'Kaustav Hazarika', color: '#f43f5e' },
  { id: 't2', name: 'Franchise 2', captain: 'Ashish Bhuyan', color: '#3b82f6' },
  { id: 't3', name: 'Franchise 3', captain: 'Padum Roy', color: '#10b981' },
  { id: 't4', name: 'Franchise 4', captain: 'Ankur Saikia', color: '#f59e0b' },
];

interface PlayerSeed {
  name: string;
  role: string;
  tierKey: string;
  stats: PlayerStats;
  notes: string;
  demandRank?: number;
  sleeper?: boolean;
}

const P = (
  name: string,
  role: string,
  tierKey: string,
  stats: PlayerStats,
  notes: string,
  extra: { demandRank?: number; sleeper?: boolean } = {},
): PlayerSeed => ({ name, role, tierKey, stats, notes, ...extra });

const PLAYER_SEED: PlayerSeed[] = [
  // ---- DIAMOND — base 1000 ----
  P('Hirok Roy', 'Fast bowler', 'diamond',
    { mat: 17, runs: 40, batAvg: 10, batSR: 105.26, wkts: 26, bowlAvg: 5.77, econ: 5.59, mvpS1: 12.864, mvpS2: 14.789, mvpS3: 14.96, bestMvp: '1st (S3)' },
    'Reigning MVP (DPL 3). All-time top wicket-taker (26) with 5 maidens; bats at a 105 strike rate.',
    { demandRank: 1 }),
  P('Chinmoy Deka', 'All-rounder', 'diamond',
    { mat: 15, runs: 197, batAvg: 15.15, batSR: 81.4, wkts: 17, bowlAvg: 7.06, econ: 5.71, mvpS1: 15.9, mvpS2: 16.574, mvpS3: 11.953, bestMvp: '1st (S1)' },
    'DPL 1 MVP. No.1 all-time run-scorer and No.2 wicket-taker; never outside the MVP top 4.',
    { demandRank: 2 }),
  P('Yatrick', 'Bowling all-rounder', 'diamond',
    { mat: 14, runs: 68, batAvg: 6.8, batSR: 75.56, wkts: 8, bowlAvg: 6.38, econ: 3.92, mvpS1: 6.784, mvpS2: 3.317, mvpS3: 13.567, bestMvp: '2nd (S3)' },
    'DPL 3 MVP runner-up (10.647 bowling pts last season); three-season regular, career econ 3.92.',
    { demandRank: 3 }),
  P('Uddhab Deka', 'Fast bowler', 'diamond',
    { mat: 7, wkts: 10, bowlAvg: 5.2, econ: 4.39, mvpS1: 2.796, mvpS3: 12.989, bestMvp: '3rd (S3)' },
    'DPL 3 No.3. A wicket every 7.1 balls at a 4.39 economy — the stingiest 10-wicket bowler in the pool.',
    { demandRank: 4 }),

  // ---- GOLD — base 600 ----
  P('Kabya', 'Top-order batter', 'gold',
    { mat: 13, runs: 149, batAvg: 14.9, batSR: 71.63, wkts: 0, mvpS1: 2.48, mvpS2: 9.185, mvpS3: 3.915, bestMvp: '8th (S2)' },
    'No.2 all-time run-scorer; 9.223 batting pts in DPL 2 — 2nd-best single-season batting tally ever.',
    { demandRank: 5 }),
  P('Jishnu', 'Batting all-rounder', 'gold',
    { mat: 15, runs: 96, batAvg: 9.6, batSR: 75, wkts: 5, bowlAvg: 2, econ: 2.5, mvpS1: 6.149, mvpS2: 8.083, mvpS3: 4.672, bestMvp: '7th (S1)' },
    'Top-10 MVP in all three seasons; joint-best bowling SR (4.80) among 5-wicket takers.',
    { demandRank: 6 }),
  P('Angshuman Sarma Baruah', 'Batter', 'gold',
    { mat: 14, runs: 118, batAvg: 16.86, batSR: 78.15, wkts: 0, mvpS1: 1.203, mvpS2: 7.105, mvpS3: 3.818, bestMvp: '11th (S3)' },
    'Best career average in the 100-run club (16.86); pure top-order bat, productive in S2 and S3.',
    { demandRank: 7 }),
  P('Asif Ali', 'Fast bowler', 'gold',
    { mat: 12, wkts: 7, bowlAvg: 7.71, econ: 3.9, mvpS2: 10.308, mvpS3: 1.78, bestMvp: '6th (S2)' },
    'DPL 2 No.6 MVP; best economy (3.90) among pool bowlers with 7+ wickets.',
    { demandRank: 9 }),
  P('Bhakta Bordoloi', 'Fast bowler', 'gold',
    { mat: 4, wkts: 5, bowlAvg: 4, econ: 5, mvpS3: 6.4, bestMvp: '6th (S3)' },
    'Top-6 MVP finish in his debut season; 5 wickets in just 24 balls.',
    { demandRank: 8 }),
  P('Chandan', 'Bowling all-rounder', 'gold',
    { mat: 6, runs: 30, batAvg: 4.29, batSR: 66.67, wkts: 4, bowlAvg: 2.75, econ: 3.67, mvpS2: 7.793, mvpS3: 1.392, bestMvp: '11th (S2)' },
    '7.793 MVP pts in DPL 2; career bowling average 2.75 at a 3.67 economy.'),
  P('Rahul Ahmed', 'All-rounder', 'gold',
    { mat: 7, runs: 17, batAvg: 8.5, batSR: 80.95, wkts: 5, bowlAvg: 8.2, econ: 5.12, mvpS2: 10.683, bestMvp: '4th (S2)' },
    "DPL 2 No.4 MVP and the season's best fielding pts (2.160). Mapped to 'Rahul' (Team Faguni) — VERIFY identity.",
    { demandRank: 10 }),

  // ---- EMERALD — base 400 ----
  P('Papu', 'Fast bowler', 'emerald',
    { mat: 2, wkts: 3, bowlAvg: 4, econ: 6, mvpS3: 3.3, bestMvp: '13th (S3)' },
    '3 wickets in just 12 balls during a two-match DPL 3 cameo.',
    { sleeper: true }),
  P('Neev', 'All-rounder', 'emerald',
    { mat: 3, runs: 18, batAvg: 6, batSR: 72, wkts: 1, bowlAvg: 32, econ: 4, mvpS3: 3.378, bestMvp: '12th (S3)' },
    'Contributed with bat and ball in DPL 3 (3.378 MVP pts).'),
  P('Manash Barman', 'Batter (LHB)', 'emerald',
    { mat: 3, runs: 24, batAvg: 12, batSR: 120, mvpS3: 3.211, bestMvp: '14th (S3)' },
    "Pool's highest batting strike rate (120.0); left-handed finisher profile.",
    { sleeper: true }),
  P('Madhurja Mazumdar', 'Batter', 'emerald',
    { mat: 5, runs: 17, batAvg: 4.25, batSR: 48.57, mvpS2: 1.212, mvpS3: 1.665, bestMvp: '18th (S3)' },
    'Two-season squad player; handy fielder (0.840 fielding pts in DPL 3).'),
  P('Jigyas', 'Spinner (SLA)', 'emerald',
    { mat: 2, wkts: 2, bowlAvg: 5, econ: 5.45, mvpS1: 0.911, mvpS2: 0.878, bestMvp: '20th (S1)' },
    'The only specialist spinner in the pool — scarcity value on a spin-friendly day.',
    { sleeper: true }),
  P('Sonu Bhaiya', 'Bowler (LA medium)', 'emerald',
    { mat: 7, runs: 8, batAvg: 2.67, batSR: 61.54, wkts: 1, bowlAvg: 39, econ: 7.8, mvpS1: 0.403, mvpS2: 2.281, mvpS3: -0.146, bestMvp: '19th (S2)' },
    'Left-arm variety; has featured in all three seasons.'),
  P('Sujit Haloi (Tiku)', 'Medium bowler (LHB)', 'emerald',
    { mat: 10, runs: 1, batAvg: 0.5, batSR: 16.67, wkts: 6, bowlAvg: 6, econ: 4, mvpS1: 2.54, mvpS2: 2.882, mvpS3: 2.943, bestMvp: '15th (S1)' },
    "Three-season regular (the only bowler to appear in all 3 DPL editions). 6 wkts at avg 6.00, econ 4.00 — quietly reliable. Also known as 'Tiku'."),
  P('Anjishnu', 'Batter', 'emerald',
    { mat: 2, runs: 4, batAvg: 1, batSR: 28.57, mvpS1: 1.045, bestMvp: '18th (S1)' },
    'DPL 1 experience; 0.600 of his MVP pts came from fielding.'),
  P('Chinmoy Deka 2', 'Utility / batter', 'emerald',
    { mat: 5, mvpS1: 0.206, mvpS2: 0.58, bestMvp: '24th (S1)' },
    "Second 'Chinmoy Deka' profile, added late to DPL 4. Two quiet seasons (S1–S2); career line merged under 'Chinmoy Deka' on CricHeroes."),
  P('Prasurjya Pratim Dutta', 'Utility / fielder', 'emerald',
    { mat: 1, mvpS1: 0.224, bestMvp: '23rd (S1)' },
    'All MVP points from fielding; athletic outfield option.'),

  // ---- NEW PLAYERS — base 200, first DPL season ----
  ...['Ajit Ranjan', 'Amlan', 'Bineet', 'Deep', 'Dharmendra', 'Kaustav Saikia', 'Shubham Dey', 'Suman', 'Tanmay', 'Vishal']
    .map((name) =>
      P(name, 'Debut — role TBD', 'new', {},
        name === 'Kaustav Saikia'
          ? 'Debut season — no prior DPL record. Not the captain Kaustav Hazarika (verify identity).'
          : 'Debut season — no prior DPL record.')),
];

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

export function generateCode(len = 6): string {
  const { randomInt } = require('node:crypto') as typeof import('node:crypto');
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** Give every player a unique photo-upload code. Runs on load so databases
 *  (and restored backups) from before the photo feature keep working.
 *  Returns true when anything changed and the state should be re-persisted. */
export function ensurePhotoCodes(state: State): boolean {
  const seen = new Set<string>();
  let changed = false;
  for (const p of state.players) {
    if (!p.photoCode || seen.has(p.photoCode)) {
      let code = generateCode(10);
      while (seen.has(code)) code = generateCode(10);
      p.photoCode = code;
      changed = true;
    }
    seen.add(p.photoCode);
  }
  return changed;
}

export function buildInitialState(): State {
  const teams: Team[] = TEAM_SEED.map((t) => ({ ...t, code: generateCode() }));
  const players: Player[] = PLAYER_SEED.map((p, i) => ({
    id: `p${i + 1}`,
    name: p.name,
    role: p.role,
    tierKey: p.tierKey,
    basePriceOverride: null,
    stats: p.stats,
    notes: p.notes,
    demandRank: p.demandRank ?? null,
    sleeper: p.sleeper ?? false,
    status: 'available',
    teamId: null,
    price: null,
    round: null,
    offeredInPass: false,
    photoPath: null,
    photoCode: generateCode(10),
  }));
  return {
    settings: DEFAULT_SETTINGS,
    teams,
    players,
    stage: 'setup',
    currentTierKey: null,
    lot: null,
    watchlists: {},
    version: 1,
  };
}
