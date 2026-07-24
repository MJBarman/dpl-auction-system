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
  tiers: Tier[];
}

export interface PlayerStats {
  mat?: number | null;
  runs?: number | null;
  batAvg?: number | null;
  batSR?: number | null;
  wkts?: number | null;
  bowlAvg?: number | null;
  econ?: number | null;
  mvpS1?: number | null;
  mvpS2?: number | null;
  mvpS3?: number | null;
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
  photoPath?: string | null;  // object path in the Supabase photo bucket
  photoCode?: string;         // secret in the player's photo-upload link
}

export interface Team {
  id: string;
  name: string;
  captain: string;
  color: string;
  code: string; // private join code for the captain
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
  players: Pick<Player, 'id' | 'status' | 'teamId' | 'price' | 'round' | 'offeredInPass'>[];
}

export interface TeamSummary {
  id: string;
  spent: number;
  count: number;
  remaining: number;
  maxBid: number;
  full: boolean;
}

export interface EventRow {
  id: number;
  ts: number;
  type: string;
  detail: string;
}
