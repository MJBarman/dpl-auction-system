import { Player, PlayerStats, Settings, State, Team } from './types';

// Seeded from "DTC3_Player_Categories.pdf" — the Downtown Test Championship
// Season 3 auction (11 Oct): 24 pool players in four tiers, each with their
// DTC 1 + DTC 2 combined stats (CricHeroes MVP points, batting, bowling — one
// Test match per season). Captains are not in the pool.
// Everything here is editable from the admin console after first boot.

export const DEFAULT_SETTINGS: Settings = {
  auctionName: 'DTC Season 3 Player Auction',
  purse: 30000,
  // 24 players ÷ 2 teams: every squad buys exactly 12 (captains excluded).
  minSquad: 12,
  maxSquad: 12,
  // The organisers' rule: for every player a team still needs after the one
  // on the block, it keeps back the base price of one of the most expensive
  // players still to be sold (engine.reserveFor) — Diamond 1,000, Gold 600,
  // Emerald 400, New 200. A fresh team can bid 30,000 − (Padum 1,000 + four
  // Golds 2,400 + six Emeralds 2,400) = 24,200 on Hirak, and the limit loosens
  // as the expensive players are sold. reservePerSlot is a floor on top of
  // that: 0 = base prices only (1,000 would make it a flat 1,000 a player).
  reservePerSlot: 0,
  increments: [
    { upTo: 1000, step: 100 },
    { upTo: 3000, step: 200 },
    { upTo: null, step: 250 },
  ],
  bidderBidding: true,
  timeoutEvery: 8, // strategic timeout after every 8 main-round players (0 = off)
  showTier: true,
  rulesOnScreen: false, // the auctioneer puts the rules board on the projector
  tiers: [
    { key: 'diamond', name: 'Diamond', basePrice: 1000, color: '#67e8f9', order: 1 },
    { key: 'gold', name: 'Gold', basePrice: 600, color: '#fbbf24', order: 2 },
    { key: 'emerald', name: 'Emerald', basePrice: 400, color: '#34d399', order: 3 },
    { key: 'new', name: 'New Players', basePrice: 200, color: '#c4b5fd', order: 4 },
  ],
};

const TEAM_SEED: Omit<Team, 'code'>[] = [
  { id: 't1', name: 'Power Rangers', captain: 'Ashish', owner: 'Angshumaan', color: '#f43f5e' },
  { id: 't2', name: 'Underdogs', captain: 'Saurav', owner: 'Ankur', color: '#3b82f6' },
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

// In overall rank order (combined MVP points). Stats are exactly as printed in
// the PDF; a field is left out where it shows "—" (didn't play / bat / bowl).
// mvpS1 / mvpS2 = DTC 1 / DTC 2 MVP points and mvpRankS1 / mvpRankS2 the "#n"
// beside them (rank in that season's MVP table, captains and players outside
// the pool included); mvpTotal is the PDF's own total, which can differ from
// their sum by 0.01 (CricHeroes rounding). demandRank = the hot list: the top 8
// of the overall ranking — both Diamonds, all four Golds and the two leading
// batters.
const PLAYER_SEED: PlayerSeed[] = [
  // ---- DIAMOND — base 1000 · 25+ MVP pts and 10+ wickets each ----
  P('Hirak', 'Fast bowler', 'diamond',
    { mvpTotal: 38.29, mvpS1: 19.19, mvpRankS1: 2, mvpS2: 19.11, mvpRankS2: 1, runs: 16, balls: 29, hs: '12', batAvg: 5.33, wkts: 13, bestWkts: 5, econ: 2.47 },
    'Highest MVP total in the pool — #2 in DTC 1, #1 in DTC 2. 13 wickets incl. a 5-wicket innings, 15 maidens, economy 2.47.',
    { demandRank: 1 }),
  P('Padum', 'Fast bowler', 'diamond',
    { mvpTotal: 25.23, mvpS1: 9.52, mvpRankS1: 6, mvpS2: 15.71, mvpRankS2: 2, runs: 8, balls: 13, hs: '8*', wkts: 10, bestWkts: 4, econ: 3.27 },
    '#2 in DTC 2 with 7 wickets (best 4). 10 wickets overall at one every 13.2 balls — the best strike rate in the pool (min. 4 wkts).',
    { demandRank: 2 }),

  // ---- GOLD — base 600 · 15–19 MVP pts and 4–6 wickets each ----
  P('Asif', 'All-rounder · RA fast', 'gold',
    { mvpTotal: 19.35, mvpS1: 9.82, mvpRankS1: 4, mvpS2: 9.52, mvpRankS2: 4, runs: 36, balls: 29, hs: '16*', batAvg: 18.00, wkts: 4, bestWkts: 2, econ: 2.79 },
    '#4 MVP in both seasons. 36 runs at a strike rate of 124 plus 4 wickets; most fielding points in the pool (2.30).',
    { demandRank: 3 }),
  P('Kaustav', 'All-rounder · RA fast', 'gold',
    { mvpTotal: 15.85, mvpS1: 9.93, mvpRankS1: 3, mvpS2: 5.92, mvpRankS2: 8, runs: 29, balls: 108, hs: '17', batAvg: 7.25, wkts: 4, bestWkts: 2, econ: 2.94 },
    '#3 in DTC 1. 4 wickets with 7 maidens (economy 2.94), plus 29 runs.',
    { demandRank: 4 }),
  P('Uddhab', 'Fast bowler', 'gold',
    { mvpTotal: 15.33, mvpS1: 8.65, mvpRankS1: 7, mvpS2: 6.68, mvpRankS2: 7, wkts: 6, bestWkts: 3, econ: 2.89 },
    '#7 MVP in both seasons. 6 wickets at an average of 8.67, incl. 3 in an innings in DTC 1; economy 2.89.',
    { demandRank: 5 }),
  P('Bhokto', 'Fast bowler', 'gold',
    { mvpTotal: 15.26, mvpS1: 9.55, mvpRankS1: 5, mvpS2: 5.70, mvpRankS2: 9, wkts: 5, bestWkts: 2, econ: 3.57 },
    '#5 in DTC 1. 5 wickets from 22.4 overs with 7 maidens.',
    { demandRank: 6 }),

  // ---- EMERALD — base 400 · batters, support bowlers and squad players, under 9 MVP pts ----
  P('Kabya', 'Batter', 'emerald',
    { mvpTotal: 8.10, mvpS1: 5.00, mvpRankS1: 8, mvpS2: 3.10, mvpRankS2: 17, runs: 64, balls: 159, hs: '25*', batAvg: 21.33 },
    "Leading run-scorer in the pool (64). Topped DTC 1's batting chart with 46 runs (best 25*); DTC average 21.33.",
    { demandRank: 7 }),
  P('Jishnu', 'Batter', 'emerald',
    { mvpTotal: 6.27, mvpS1: 2.70, mvpRankS1: 10, mvpS2: 3.57, mvpRankS2: 14, runs: 41, balls: 111, hs: '17', batAvg: 10.25 },
    "41 runs across both seasons; 3rd on DTC 2's batting chart with 29. 2.15 fielding points.",
    { demandRank: 8 }),
  P('Chandan', 'Batter · part-time medium', 'emerald',
    { mvpTotal: 5.44, mvpS1: 0.40, mvpRankS1: 19, mvpS2: 5.04, mvpRankS2: 10, runs: 16, balls: 61, hs: '12', batAvg: 4.00, wkts: 1, bestWkts: 1, econ: 8.00 },
    '#10 in DTC 2: 12 runs, a wicket in his only over and 1.85 fielding pts — the best single-season fielding score in the pool.'),
  P('Dharmendra', 'Fast bowler', 'emerald',
    { mvpTotal: 5.16, mvpS1: 0.87, mvpRankS1: 13, mvpS2: 4.29, mvpRankS2: 12, runs: 4, balls: 3, hs: '4', batAvg: 4.00, wkts: 1, bestWkts: 1, econ: 3.00 },
    '10 overs at an economy of 3.00 with 3 maidens; #12 in DTC 2.'),
  P('Madhurjya', 'Batter', 'emerald',
    { mvpTotal: 3.90, mvpS2: 3.90, mvpRankS2: 13, runs: 39, balls: 86, hs: '35*', batAvg: 39.00 },
    "DTC 2 only: 39 runs incl. 35*, average 39.00 — 2nd on that season's batting chart."),
  P('Bineet', 'Batter', 'emerald',
    { mvpTotal: 3.60, mvpS1: 1.00, mvpRankS1: 12, mvpS2: 2.60, mvpRankS2: 19, runs: 21, balls: 102, hs: '16', batAvg: 5.25 },
    'Played both seasons: 21 runs (best 16 in DTC 2) and 1.50 fielding points.'),
  P('Sonu', 'All-rounder · LA medium', 'emerald',
    { mvpTotal: 3.35, mvpS2: 3.35, mvpRankS2: 15, runs: 13, balls: 9, hs: '8', batAvg: 13.00, wkts: 1, bestWkts: 1, econ: 4.86 },
    'DTC 2 only: 13 runs off 9 balls (strike rate 144) and 1 wicket with left-arm medium.'),
  P('Chinmoy Sr', 'Batter · part-time medium', 'emerald',
    { mvpTotal: 3.32, mvpS2: 3.32, mvpRankS2: 16, runs: 28, balls: 40, hs: '20', batAvg: 14.00, wkts: 0, econ: 8.00 },
    'DTC 2 only: 28 runs off 40 balls (best 20); bowled 1 over.'),
  P('Amlan', 'Batter', 'emerald',
    { mvpTotal: 0.82, mvpS2: 0.82, mvpRankS2: 22, runs: 8, balls: 7, hs: '4*', batAvg: 8.00 },
    'DTC 2 only: 8 runs off 7 balls (best 4*).'),
  P('Deep', 'Batter (left-handed)', 'emerald',
    { mvpTotal: 0.80, mvpS1: 0.80, mvpRankS1: 14, runs: 8, balls: 24, hs: '8', batAvg: 4.00 },
    'DTC 1 only: 8 runs as a left-handed bat.'),
  P('Chinmoy Jr', 'Utility', 'emerald',
    { mvpTotal: 0.70, mvpS1: 0.70, mvpRankS1: 15 },
    "DTC 1 only: didn't bat or bowl; all 0.70 MVP points came from fielding."),
  P('Vishal', 'Off-spinner', 'emerald',
    { mvpTotal: 0.09, mvpS1: -0.01, mvpRankS1: 20, mvpS2: 0.09, mvpRankS2: 24, runs: 1, balls: 3, hs: '1*', batAvg: 1.00, wkts: 0, econ: 6.00 },
    'Both seasons (as “Vishal” and “Vishal Paul”): 2 overs of off-spin for 12 runs, and 1* with the bat.'),

  // ---- NEW PLAYERS — base 200 · first DTC season, no DTC 1 or DTC 2 record ----
  ...['Udit', 'Ronny', 'Abhigyan', 'Yatrick', 'Debanga', 'Alokesh']
    .map((name) => P(name, 'Debut — role TBD', 'new', {}, '')),
];

// Photos these players uploaded for DPL Season 4, reused for DTC 3 (the user
// confirmed they are the same people): the newest object left in each one's
// DPL bucket folder players/p<n>/, which only that player's DPL photo link
// could write to. Chandan, Deep and Chinmoy Jr (DPL "Chinmoy Deka 2") have no
// photo left there. A new upload through the player's DTC link replaces one.
const DPL_PHOTOS: Record<string, string> = {
  Hirak:      'players/p1/1783692815726.jpg', // DPL "Hirok Roy"
  Asif:       'players/p8/1789999457056.jpg', // DPL "Asif Ali"
  Uddhab:     'players/p4/1783693526411.jpg', // DPL "Uddhab Deka"
  Bhokto:     'players/p9/1783693671755.jpg', // DPL "Bhakta Bordoloi"
  Kabya:      'players/p5/1787575365043.jpg',
  Jishnu:     'players/p6/1789998445217.jpg',
  Dharmendra: 'players/p26/1783694082382.jpg',
  Madhurjya:  'players/p15/1783693859130.jpg', // DPL "Madhurja Mazumdar"
  Bineet:     'players/p24/1783694053816.jpg',
  Sonu:       'players/p17/1789998369388.jpg', // DPL "Sonu Bhaiya"
  'Chinmoy Sr': 'players/p2/1783693432535.jpg', // DPL "Chinmoy Deka"
  Amlan:      'players/p23/1783694027133.jpg',
  Vishal:     'players/p31/1783759203082.jpg',
  Yatrick:    'players/p3/1783682646559.jpg',
};

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

/** Default the strategic-timeout fields on databases (and restored backups)
 *  from before the feature. Returns true when anything changed. */
export function ensureTimeoutFields(state: State): boolean {
  let changed = false;
  if (typeof state.settings.timeoutEvery !== 'number') {
    state.settings.timeoutEvery = DEFAULT_SETTINGS.timeoutEvery;
    changed = true;
  }
  if (typeof state.settings.showTier !== 'boolean') {
    state.settings.showTier = DEFAULT_SETTINGS.showTier;
    changed = true;
  }
  if (typeof state.settings.rulesOnScreen !== 'boolean') {
    state.settings.rulesOnScreen = DEFAULT_SETTINGS.rulesOnScreen;
    changed = true;
  }
  if (typeof state.mainAuctionCount !== 'number') {
    state.mainAuctionCount = 0;
    changed = true;
  }
  if (state.timeout === undefined) {
    state.timeout = null;
    changed = true;
  }
  return changed;
}

/** One-time data changes for databases created before a change to this seed
 *  (the live database is one). Each runs once — recorded in state.migrations —
 *  so none re-applies over later admin edits; a fresh seed is born with all of
 *  them recorded. */
const DATA_MIGRATIONS: { id: string; run: (state: State) => void }[] = [
  {
    // The season MVP ranks and the hot list joined the DTC 3 seed: copy them
    // onto the original players — matched by id AND name, so an edited roster
    // is never overwritten — and fill the hot list only if no one is on it.
    id: 'dtc3-season-ranks-hot-list',
    run: (state) => {
      const hotListEmpty = !state.players.some((p) => p.demandRank != null);
      PLAYER_SEED.forEach((src, i) => {
        const p = state.players.find((x) => x.id === `dtc3-p${i + 1}`);
        if (!p || p.name !== src.name) return;
        for (const key of ['mvpRankS1', 'mvpRankS2'] as const) {
          if (p.stats[key] == null && src.stats[key] != null) p.stats[key] = src.stats[key];
        }
        if (hotListEmpty && src.demandRank != null) p.demandRank = src.demandRank;
      });
    },
  },
  {
    // The organisers' rule for the 30,000 purse: the max bid follows the base
    // prices still to come (reserve per slot 0). Only from the untouched 400 —
    // or the 1,000 that an earlier, never-deployed version of this change
    // ('dtc3-reserve-1000') set on test copies — so an auctioneer's own choice
    // is never overwritten.
    id: 'dtc3-reserve-base-prices',
    run: (state) => {
      const r = state.settings.reservePerSlot;
      const untouched = r === 400 || (r === 1000 && state.migrations?.includes('dtc3-reserve-1000'));
      if (state.settings.purse === 30000 && untouched) state.settings.reservePerSlot = 0;
    },
  },
  {
    // The team owners joined the DTC 3 seed: copy them onto the original teams
    // — matched by id AND name — unless an owner was already typed in.
    id: 'dtc3-team-owners',
    run: (state) => {
      for (const src of TEAM_SEED) {
        const t = state.teams.find((x) => x.id === src.id);
        if (t && t.name === src.name && !t.owner) t.owner = src.owner;
      }
    },
  },
  {
    // The organisers cut the step above 3,000 from +500 to +250. Only from the
    // untouched ladder and before the auction starts, so a ladder the
    // auctioneer edited is kept and steps never change mid-auction.
    id: 'dtc3-step-250-above-3000',
    run: (state) => {
      const old = [{ upTo: 1000, step: 100 }, { upTo: 3000, step: 200 }, { upTo: null, step: 500 }];
      const inc = state.settings.increments;
      const untouched = inc.length === old.length && inc.every((r, i) => r.upTo === old[i].upTo && r.step === old[i].step);
      if (untouched && state.stage === 'setup') inc[2].step = 250;
    },
  },
];

/** Apply the data migrations this state hasn't had yet. Returns true when any
 *  ran and the state should be re-persisted. */
export function applyDataMigrations(state: State): boolean {
  state.migrations ??= [];
  let changed = false;
  for (const m of DATA_MIGRATIONS) {
    if (state.migrations.includes(m.id)) continue;
    m.run(state);
    state.migrations.push(m.id);
    changed = true;
  }
  return changed;
}

export function buildInitialState(): State {
  const teams: Team[] = TEAM_SEED.map((t) => ({ ...t, code: generateCode() }));
  const players: Player[] = PLAYER_SEED.map((p, i) => ({
    // Photos upload to players/<id>/… in the bucket, which still holds the
    // DPL Season 4 folders p1…p31 — the "dtc3-" prefix keeps them apart
    // (scripts/relink-photos.mjs matches folders to players by id).
    id: `dtc3-p${i + 1}`,
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
    photoPath: DPL_PHOTOS[p.name] ?? null,
    photoCode: generateCode(10),
  }));
  return {
    // Clone — states are mutated in place and must never write back into the seed.
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings,
    teams,
    players,
    stage: 'setup',
    currentTierKey: null,
    lot: null,
    mainAuctionCount: 0,
    timeout: null,
    watchlists: {},
    migrations: DATA_MIGRATIONS.map((m) => m.id), // the seed above already carries everything
    version: 1,
  };
}
