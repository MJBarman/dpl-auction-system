// Wire types mirrored from server/src/types.ts + views.ts. Keep in sync.

export type Stage = 'setup' | 'live' | 'accelerated' | 'completed';
export type PlayerStatus = 'available' | 'sold' | 'unsold';
export type SaleRound = 'main' | 'accelerated' | 'allotted' | 'manual';

export interface Tier {
  key: string;
  name: string;
  basePrice: number;
  color: string;
  order: number;
}

export interface IncrementRung {
  upTo: number | null;
  step: number;
}

export interface Settings {
  auctionName: string;
  purse: number;
  minSquad: number;
  maxSquad: number;
  reservePerSlot: number;
  increments: IncrementRung[];
  bidderBidding: boolean;
  timeoutEvery: number; // strategic timeout after every N main-round players (0 = off)
  showTier: boolean; // show tier names/chips on screens (off hides them everywhere)
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

export interface PlayerView {
  id: string;
  name: string;
  role: string;
  tierKey: string;
  basePrice: number;
  stats: PlayerStats;
  notes: string;
  demandRank: number | null;
  sleeper: boolean;
  status: PlayerStatus;
  teamId: string | null;
  price: number | null;
  round: SaleRound | null;
  photoUrl: string | null;
}

export interface TeamView {
  id: string;
  name: string;
  captain: string;
  color: string;
  purse: number;
  spent: number;
  remaining: number;
  count: number;
  maxBid: number;
  full: boolean;
}

export interface Bid {
  teamId: string;
  amount: number;
  by: 'admin' | 'team';
  ts: number;
  deviceTag?: string; // fingerprint of the signed-in device that sent it
}

export interface LotView {
  id: string;
  playerId: string;
  bids: Bid[];
  openedAt: number;
  timerEndsAt: number | null;
  currentBid: number | null;
  leadingTeamId: string | null;
  nextMinBid: number;
  teamBidState: { teamId: string; canBid: boolean; reason: string | null }[];
}

export interface TierProgress {
  tierKey: string;
  name: string;
  total: number;
  sold: number;
  unsold: number;
  remaining: number;
}

export interface WatchlistEntry {
  playerId: string;
  starred: boolean;
  targetPrice?: number | null;
  note?: string;
}

export type You =
  | { role: 'spectator' }
  | { role: 'admin' }
  | { role: 'team'; teamId: string; deviceTag?: string; watchlist: Record<string, WatchlistEntry> };

export interface TimeoutInfo {
  startedAt: number;
  setNumber: number | null; // which set just completed; null = called manually
}

export interface StateView {
  serverTime: number;
  version: number;
  stage: Stage;
  settings: Settings;
  currentTierKey: string | null;
  teams: TeamView[];
  players: PlayerView[];
  lot: LotView | null;
  timeout: TimeoutInfo | null;
  progress: {
    total: number;
    sold: number;
    unsold: number;
    available: number;
    perTier: TierProgress[];
  };
  phase: {
    remainingInPhase: number;
    unsold: number;
    mainRoundDone: boolean;
    auctionedInMain: number;
  };
  undoLabel: string | null;
  you: You;
  admin?: {
    teamCodes: { teamId: string; code: string }[];
    photoCodes: { playerId: string; code: string }[];
    teamSessions: { teamId: string; devices: number }[];
    warnings: string[];
  };
}

export interface EventRow {
  id: number;
  ts: number;
  type: string;
  detail: string;
}
