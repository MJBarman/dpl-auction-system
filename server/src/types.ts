// Domain types for the DPL auction system.
// The client keeps a mirrored copy in client/src/types.ts — keep them in sync.

export type Stage = 'setup' | 'live' | 'accelerated' | 'completed';

export type PlayerStatus = 'available' | 'sold' | 'unsold';

export type SaleRound = 'main' | 'accelerated' | 'allotted' | 'manual';

export interface Tier {
  key: string;          // stable id, e.g. "diamond"
  name: string;         // display name, e.g. "Diamond"
  basePrice: number;    // pts
  color: string;        // hex accent
  order: number;        // auction round order, ascending
}

export interface IncrementRung {
  upTo: number | null;  // bid step applies while current bid < upTo; null = no upper bound
  step: number;
}

export interface Settings {
  auctionName: string;
  purse: number;          // per-franchise purse in pts
  minSquad: number;       // players bought at auction (excl. captain)
  maxSquad: number;
  reservePerSlot: number; // pts reserved per unfilled mandatory slot (guardrail)
  increments: IncrementRung[];
  bidderBidding: boolean; // captains may bid from their own devices
  timeoutEvery: number;   // strategic timeout after every N main-round players (0 = off)
  showTier: boolean;      // show tier names/chips on screens (off hides them everywhere)
  rulesOnScreen: boolean; // projector shows the rules board between lots
  audienceGame: boolean;      // phones watching can guess each hammer price
  audienceReactions: boolean; // emoji reactions from phones float on the screens
  audienceNames: boolean;     // show guessers' names (off: amounts only)
  tiers: Tier[];
}

export interface PlayerStats {
  mat?: number | null;
  runs?: number | null;
  balls?: number | null;    // balls faced
  hs?: string | null;       // highest score, "*" = not out (e.g. "25*")
  batAvg?: number | null;
  batSR?: number | null;
  wkts?: number | null;
  bestWkts?: number | null; // most wickets in an innings
  bowlAvg?: number | null;
  econ?: number | null;
  mvpTotal?: number | null; // MVP points summed across the seasons below
  mvpS1?: number | null;
  mvpS2?: number | null;
  mvpS3?: number | null;
  mvpRankS1?: number | null; // position in that season's MVP table (#n)
  mvpRankS2?: number | null;
  bestMvp?: string | null;
}

export interface Player {
  id: string;
  name: string;
  role: string;
  tierKey: string;
  basePriceOverride?: number | null; // null/undefined = use tier base price
  stats: PlayerStats;
  notes: string;
  demandRank?: number | null; // hot-list rank from the plan
  sleeper?: boolean;
  status: PlayerStatus;
  teamId?: string | null;     // when sold
  price?: number | null;      // hammer price
  round?: SaleRound | null;
  offeredInPass?: boolean;    // offered in current accelerated pass
  hammerAt?: number | null;   // when the player was last sold or went unsold (the play-by-play order)
  bidCount?: number | null;   // bids on the lot that sold them (0 = unsold, null = allotted/assigned)
  photoPath?: string | null;  // the approved photo: object path in the Supabase photo bucket
  photoCode?: string;         // secret in the player's photo-upload link
  photoLinkUntil?: number | null;     // the link takes uploads until then (ms); null/absent = closed
  pendingPhoto?: PendingPhoto | null; // sent through the link, waiting for the organiser
}

/** A photo a player sent through their link. It reaches the screens only once
 *  the organiser approves it; until then the approved photo (or initials) stays. */
export interface PendingPhoto {
  path: string;       // object path under pending/ in the photo bucket
  uploadedAt: number;
  device: string;     // short fingerprint of the phone that sent it
}

export interface Team {
  id: string;
  name: string;
  captain: string;
  owner?: string; // shown with the team name on the projector
  color: string;
  code: string; // private join code for the captain
}

/** What a factory reset would throw away (GET /api/admin/factory-reset/preview). */
export interface FactoryResetPreview {
  stage: Stage;
  sold: number;
  unsold: number;
  watchlistEntries: number;  // captains' starred players and target prices
  photosUnlinked: string[];  // players whose current photo is not the seed's
  playersAdded: string[];    // not in the seed: deleted by the reset
  playersRemoved: string[];  // seed players that were deleted: they come back
  playersEdited: string[];   // seed players whose details were edited
  teamsChanged: string[];
  settingsChanged: string[]; // "Label: current → default"
  teamDevices: number;       // phones signed in to a team (they stay signed in)
}

export interface Bid {
  teamId: string;
  amount: number;
  by: 'admin' | 'team'; // who recorded it
  ts: number;
  deviceTag?: string;   // fingerprint of the signed-in device that sent it
}

export interface Lot {
  id: string;      // unique per opened lot — bids must quote it so a stale
                   // client can never bid on a player it isn't looking at
  playerId: string;
  bids: Bid[];
  openedAt: number;
  timerEndsAt?: number | null;
}

export interface WatchlistEntry {
  playerId: string;
  starred: boolean;
  targetPrice?: number | null;
  note?: string;
}

/** Active strategic timeout — the auction pauses until the auctioneer resumes. */
export interface TimeoutInfo {
  startedAt: number;
  setNumber: number | null; // which set just completed; null = called manually
}

/** How the phones' guesses on a sold lot turned out: the closest few. */
export interface GuessResult {
  lotId: string;
  playerId: string;
  price: number;
  total: number; // guesses made on the lot
  top: { name: string | null; amount: number; off: number; tag: string }[];
}

export interface State {
  settings: Settings;
  teams: Team[];
  players: Player[];
  stage: Stage;
  currentTierKey: string | null;
  lot: Lot | null;
  mainAuctionCount: number; // players hammered (sold/unsold) in the main round
  timeout: TimeoutInfo | null;
  // teamId -> playerId -> entry (private captain planning data)
  watchlists: Record<string, Record<string, WatchlistEntry>>;
  guessResult?: GuessResult | null; // the audience's guesses on the last player sold
  migrations?: string[]; // one-time data top-ups already applied (see seed.ts)
  version: number; // bumped on every mutation
}

export interface AuctionSnapshot {
  label: string;
  ts: number;
  stage: Stage;
  currentTierKey: string | null;
  lot: Lot | null;
  mainAuctionCount?: number;
  timeout?: TimeoutInfo | null;
  players: Pick<Player, 'id' | 'status' | 'teamId' | 'price' | 'round' | 'offeredInPass' | 'hammerAt' | 'bidCount'>[];
  guessResult?: GuessResult | null;
}

export interface TeamSummary {
  id: string;
  spent: number;
  count: number;
  remaining: number;
  reserve: number; // kept back to fill the slots still needed after this lot
  maxBid: number;
  full: boolean;
}

export interface EventRow {
  id: number;
  ts: number;
  type: string;
  detail: string;
}
