import { FactoryResetPreview, Player, Settings, State, Team } from './types';

// Seeded for the DCT (Downtown Champions Trophy) auction from the organiser's
// list of 22 players. Two of them are the captains — Angshuman ("Angshu" on
// the list) leads Team Maka Bharosa and Saurav ("Saurabh") leads Team Badmash
// Brigade — so they bid instead of being sold, leaving 20 for two teams of 11
// (10 bought at auction + the captain). Each player's category comes later,
// from the admin console: until then everyone sits in "Uncategorised", which
// is drawn last. No stats, roles or hot list yet.
// Everything here is editable from the admin console after first boot.

export const DEFAULT_SETTINGS: Settings = {
  auctionName: 'DCT Player Auction',
  purse: 30000,
  // 11 a side: every team buys exactly 10 at auction, plus its captain.
  minSquad: 10,
  maxSquad: 10,
  // The organisers' rule, kept from the last auction: for every player a team
  // still needs after the one on the block, it keeps back the base price of
  // one of the most expensive players still to be sold (engine.reserveFor).
  // With everyone uncategorised at 200, a fresh team can bid 30,000 − 9 × 200
  // = 28,200; dearer categories lower that, and the limit loosens as they are
  // sold. reservePerSlot is a floor on top: 0 = base prices only.
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
  // For the phones watching: guess each hammer price, emoji reactions on the
  // screens, and guessers' names shown with the results. Each has an off switch.
  audienceGame: true,
  audienceReactions: true,
  audienceNames: true,
  // The last auction's categories, ready to use, and "Uncategorised" holding
  // everyone until the organiser sorts them (delete it in Settings once empty).
  tiers: [
    { key: 'diamond', name: 'Diamond', basePrice: 1000, color: '#67e8f9', order: 1 },
    { key: 'gold', name: 'Gold', basePrice: 600, color: '#fbbf24', order: 2 },
    { key: 'emerald', name: 'Emerald', basePrice: 400, color: '#34d399', order: 3 },
    { key: 'new', name: 'New Players', basePrice: 200, color: '#c4b5fd', order: 4 },
    { key: 'uncategorised', name: 'Uncategorised', basePrice: 200, color: '#94a3b8', order: 5 },
  ],
};

// The organiser's names for the teams and their captains (no owners named).
const TEAM_SEED: Omit<Team, 'code'>[] = [
  { id: 't1', name: 'Team Maka Bharosa', captain: 'Angshuman', owner: '', color: '#f43f5e' },
  { id: 't2', name: 'Team Badmash Brigade', captain: 'Saurav', owner: '', color: '#3b82f6' },
];

// The organiser's list of 22, in its order and spelling (its "to pay" notes and
// star marks left out, as asked). Ids follow this list, so they never shift.
const ORGANISER_LIST: readonly string[] = [
  'Jishnu', 'Manash', 'Madhurjya', 'Kaustav', 'Kabya', 'Rohan', 'Ashish', 'Saurabh',
  'Angshu', 'Uddhab', 'Binit', 'Amit', 'Asif', 'Chinmoy Sr', 'Ronny', 'Debanga',
  'Chinmoy Jr', 'Hirak Jr', 'Rahul', 'Amlan', 'Sonu', 'Bhokto',
];

// The two captains on that list: they bid for their teams, so they are not in
// the pool. Their ids (dct-p8, dct-p9) stay unused, so every other player keeps
// the id — and the photo folder — they had while the pool was 22.
const CAPTAINS_ON_LIST: readonly { id: string; name: string }[] = [
  { id: 'dct-p8', name: 'Saurabh' },
  { id: 'dct-p9', name: 'Angshu' },
];

/** The auction pool: the organiser's list without the captains. */
export const PLAYER_SEED: readonly { id: string; name: string }[] = ORGANISER_LIST
  .map((name, i) => ({ id: `dct-p${i + 1}`, name }))
  .filter((p) => !CAPTAINS_ON_LIST.some((c) => c.id === p.id));

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

/** Heal a state no screen could show: an open lot whose player is gone (an old
 *  undo-after-delete bug, or a hand-edited backup) comes down. Returns true
 *  when anything changed. */
export function repairState(state: State): boolean {
  let changed = false;
  if (state.lot && !state.players.some((p) => p.id === state.lot!.playerId)) {
    state.lot = null;
    changed = true;
  }
  // The play-by-play times and the guessing game's last result travel in
  // backups too. Every screen reads them, so anything that isn't the right
  // shape is dropped here rather than breaking the state they are sent.
  const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  for (const p of state.players) {
    if (p.hammerAt !== null && p.hammerAt !== undefined && !whole(p.hammerAt)) {
      p.hammerAt = null;
      changed = true;
    }
    if (p.bidCount !== null && p.bidCount !== undefined && !whole(p.bidCount)) {
      p.bidCount = null;
      changed = true;
    }
  }
  if (state.guessResult !== null && state.guessResult !== undefined && !wellFormedGuessResult(state.guessResult)) {
    state.guessResult = null;
    changed = true;
  }
  // Team and category colours are written into every screen's styles: only a
  // plain hex colour gets through; anything else becomes grey.
  const hex = /^#[0-9a-fA-F]{3,8}$/;
  for (const holder of [...state.teams, ...state.settings.tiers] as { color?: unknown }[]) {
    if (typeof holder.color !== 'string' || !hex.test(holder.color)) {
      holder.color = '#64748b';
      changed = true;
    }
  }
  return changed;
}

function wellFormedGuessResult(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  return typeof r.lotId === 'string' && typeof r.playerId === 'string' && num(r.price) && num(r.total)
    && Array.isArray(r.top) && r.top.length <= 3
    && r.top.every((g: unknown) => {
      if (!g || typeof g !== 'object') return false;
      const t = g as Record<string, unknown>;
      return (t.name === null || (typeof t.name === 'string' && t.name.length <= 40))
        && num(t.amount) && num(t.off) && typeof t.tag === 'string' && t.tag.length <= 40;
    });
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
  for (const key of ['audienceGame', 'audienceReactions', 'audienceNames'] as const) {
    if (typeof state.settings[key] !== 'boolean') {
      state.settings[key] = DEFAULT_SETTINGS[key];
      changed = true;
    }
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
 *  (a live database is one). Each runs once — recorded in state.migrations —
 *  so none re-applies over later admin edits; a fresh seed is born with all of
 *  them recorded. The DTC 3 top-ups that lived here retired with the switch to
 *  DCT: a DTC 3 database moves to the DCT list by a factory reset. */
const DATA_MIGRATIONS: { id: string; run: (state: State) => void }[] = [
  {
    // The captains were named after the first DCT seed went live (11 Nov
    // 2026). A database from that seed gets the team names and captains — only
    // where the seed's "Team 1"/"Team 2" and blank captain are untouched — and
    // loses the two captains from the pool, matched by id AND name, and only
    // before the auction starts and while they are still unsold and off the
    // block. Anything an organiser already changed stays as it is.
    id: 'dct-captains-named',
    run: (state) => {
      const firstSeedName: Record<string, string> = { t1: 'Team 1', t2: 'Team 2' };
      for (const src of TEAM_SEED) {
        const t = state.teams.find((x) => x.id === src.id);
        if (!t) continue;
        if (t.name === firstSeedName[src.id]) t.name = src.name;
        if (t.name === src.name && !t.captain) t.captain = src.captain;
      }
      if (state.stage !== 'setup') return;
      for (const c of CAPTAINS_ON_LIST) {
        const p = state.players.find((x) => x.id === c.id);
        if (!p || p.name !== c.name || p.status !== 'available' || state.lot?.playerId === p.id) continue;
        state.players = state.players.filter((x) => x !== p);
        for (const wl of Object.values(state.watchlists ?? {})) delete wl[p.id];
      }
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
  const players: Player[] = PLAYER_SEED.map(({ id, name }) => ({
    // Photos upload to players/<id>/… in the bucket, which still holds the DPL
    // (p1…p31) and DTC 3 (dtc3-p1…p24) folders — the "dct-" prefix keeps them
    // apart (scripts/relink-photos.mjs matches folders to players by id).
    id,
    name,
    role: '',
    tierKey: 'uncategorised',
    basePriceOverride: null,
    stats: {},
    notes: '',
    demandRank: null,
    sleeper: false,
    status: 'available',
    teamId: null,
    price: null,
    round: null,
    offeredInPass: false,
    photoPath: null,
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

/** What a factory reset would throw away, measured against a fresh seed, so the
 *  console can spell it out before the auctioneer confirms with the PIN. */
export function factoryResetPreview(current: State): Omit<FactoryResetPreview, 'teamDevices'> {
  const seed = buildInitialState();
  const num = (n: number) => n.toLocaleString('en-IN');
  // key order and undefined fields never count as an edit
  const canon = (v: unknown) => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
    : val));

  const tierList = (s: Settings) => [...s.tiers].sort((a, b) => a.order - b.order);
  const rows: { label: string; show: (s: Settings) => string; sig?: (s: Settings) => string }[] = [
    { label: 'Auction name', show: (s) => s.auctionName },
    { label: 'Purse per team', show: (s) => num(s.purse) },
    { label: 'Min squad', show: (s) => String(s.minSquad) },
    { label: 'Max squad', show: (s) => String(s.maxSquad) },
    { label: 'Reserve per slot', show: (s) => num(s.reservePerSlot) },
    { label: 'Bid increments', show: (s) => s.increments.map((r) => `+${num(r.step)}${r.upTo === null ? ' above' : ` to ${num(r.upTo)}`}`).join(' · ') },
    { label: 'Timeout after every … players', show: (s) => String(s.timeoutEvery) },
    { label: 'Captains bid from their phones', show: (s) => (s.bidderBidding ? 'on' : 'off') },
    { label: 'Show tiers', show: (s) => (s.showTier !== false ? 'on' : 'off') },
    { label: 'Audience guessing game', show: (s) => (s.audienceGame !== false ? 'on' : 'off') },
    { label: 'Emoji reactions on the screens', show: (s) => (s.audienceReactions !== false ? 'on' : 'off') },
    { label: 'Names of guessers shown', show: (s) => (s.audienceNames !== false ? 'on' : 'off') },
    {
      label: 'Tiers & base prices',
      show: (s) => tierList(s).map((t) => `${t.name} ${num(t.basePrice)}`).join(' · '),
      sig: (s) => canon(tierList(s).map((t) => [t.key, t.name, t.basePrice, t.color])),
    },
  ];
  const settingsChanged = rows
    .filter((r) => (r.sig ?? r.show)(current.settings) !== (r.sig ?? r.show)(seed.settings))
    .map((r) => `${r.label}: ${r.show(current.settings)} → ${r.show(seed.settings)}`);

  const seedById = new Map(seed.players.map((p) => [p.id, p]));
  const details = (p: Player) => canon([p.name, p.role, p.tierKey, p.basePriceOverride ?? null, p.stats, p.notes, p.demandRank ?? null, !!p.sleeper]);
  const teamsChanged: string[] = [];
  for (const t of current.teams) {
    const s = seed.teams.find((x) => x.id === t.id);
    if (!s) teamsChanged.push(`${t.name} is deleted`);
    else if (t.name !== s.name || t.captain !== s.captain || (t.owner ?? '') !== (s.owner ?? '') || t.color !== s.color) {
      const who = [s.owner && `owner ${s.owner}`, s.captain && `capt. ${s.captain}`].filter(Boolean).join(', ');
      teamsChanged.push(`${t.name} goes back to ${s.name}${who ? ` (${who})` : ''}`);
    }
  }
  for (const s of seed.teams) if (!current.teams.some((t) => t.id === s.id)) teamsChanged.push(`${s.name} comes back`);

  return {
    stage: current.stage,
    sold: current.players.filter((p) => p.status === 'sold').length,
    unsold: current.players.filter((p) => p.status === 'unsold').length,
    watchlistEntries: Object.values(current.watchlists ?? {}).reduce((n, w) => n + Object.keys(w).length, 0),
    photosUnlinked: current.players
      .filter((p) => { const s = seedById.get(p.id); return !!s && !!p.photoPath && p.photoPath !== s.photoPath; })
      .map((p) => p.name),
    playersAdded: current.players.filter((p) => !seedById.has(p.id)).map((p) => p.name),
    playersRemoved: seed.players.filter((s) => !current.players.some((p) => p.id === s.id)).map((s) => s.name),
    playersEdited: current.players
      .filter((p) => { const s = seedById.get(p.id); return !!s && details(s) !== details(p); })
      .map((p) => p.name),
    teamsChanged,
    settingsChanged,
  };
}
