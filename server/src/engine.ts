import { randomInt } from 'node:crypto';
import {
  AuctionSnapshot, Lot, Player, Settings, State, Team, TeamSummary, Tier, TimeoutInfo,
} from './types';

// ---------------------------------------------------------------------------
// The auction engine: pure(ish) functions that read and mutate State in place.
// Every rule from the DPL 4 auction plan lives here so it can be unit-tested.
// Callers (the API layer) are responsible for persistence and broadcasting.
// ---------------------------------------------------------------------------

export class AuctionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function sortedTiers(settings: Settings): Tier[] {
  return [...settings.tiers].sort((a, b) => a.order - b.order);
}

export function tierOf(state: State, player: Player): Tier {
  const tier = state.settings.tiers.find((t) => t.key === player.tierKey);
  if (!tier) throw new AuctionError(`Player "${player.name}" has unknown tier "${player.tierKey}"`, 500);
  return tier;
}

export function basePriceOf(state: State, player: Player): number {
  return player.basePriceOverride ?? tierOf(state, player).basePrice;
}

export function getPlayer(state: State, playerId: string): Player {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) throw new AuctionError('Player not found', 404);
  return p;
}

export function getTeam(state: State, teamId: string): Team {
  const t = state.teams.find((x) => x.id === teamId);
  if (!t) throw new AuctionError('Team not found', 404);
  return t;
}

// --- Money -----------------------------------------------------------------

/** Bid step that applies when the standing bid is `amount`. */
export function stepFor(settings: Settings, amount: number): number {
  for (const rung of settings.increments) {
    if (rung.upTo === null || amount < rung.upTo) return rung.step;
  }
  return settings.increments.length
    ? settings.increments[settings.increments.length - 1].step
    : 100;
}

/** Lowest legal next bid for the open lot. */
export function nextMinBid(state: State): number {
  const lot = requireLot(state);
  const player = getPlayer(state, lot.playerId);
  const base = basePriceOf(state, player);
  if (lot.bids.length === 0) return base;
  const current = lot.bids[lot.bids.length - 1].amount;
  return current + stepFor(state.settings, current);
}

export function teamSummary(state: State, teamId: string): TeamSummary {
  const { settings } = state;
  let spent = 0;
  let count = 0;
  for (const p of state.players) {
    if (p.status === 'sold' && p.teamId === teamId) {
      spent += p.price ?? 0;
      count += 1;
    }
  }
  const remaining = settings.purse - spent;
  // Purse guardrail (rule 6): never bid past what still lets you fill the
  // minimum squad at reserve price. Slots still needed AFTER winning this lot.
  const slotsAfterThis = Math.max(0, settings.minSquad - count - 1);
  const maxBid = remaining - settings.reservePerSlot * slotsAfterThis;
  return {
    id: teamId,
    spent,
    count,
    remaining,
    maxBid: Math.max(0, maxBid),
    full: count >= settings.maxSquad,
  };
}

export function allSummaries(state: State): TeamSummary[] {
  return state.teams.map((t) => teamSummary(state, t.id));
}

// --- Lot lifecycle -----------------------------------------------------------

function requireLot(state: State): Lot {
  if (!state.lot) throw new AuctionError('No player is currently up for auction');
  return state.lot;
}

function requireLive(state: State): void {
  if (state.stage !== 'live' && state.stage !== 'accelerated') {
    throw new AuctionError('The auction is not running');
  }
}

function requireNoTimeout(state: State): void {
  if (state.timeout) {
    throw new AuctionError('Strategic timeout in progress — resume the auction first');
  }
}

export function startAuction(state: State): void {
  if (state.stage !== 'setup') throw new AuctionError('Auction has already started');
  if (state.teams.length < 2) throw new AuctionError('Need at least 2 teams to start');
  if (state.players.length === 0) throw new AuctionError('The player pool is empty');
  state.stage = 'live';
  state.currentTierKey = sortedTiers(state.settings)[0]?.key ?? null;
  state.lot = null;
  state.mainAuctionCount = 0;
  state.timeout = null;
}

/** Players still to be offered in the current phase. */
export function eligiblePool(state: State): Player[] {
  if (state.stage === 'accelerated') {
    return state.players.filter((p) => p.status === 'unsold' && !p.offeredInPass);
  }
  return state.players.filter((p) => p.status === 'available');
}

/**
 * Random "chit draw" of the next player. In the main round we walk tiers in
 * order; in the accelerated round we draw from all unsold players.
 * Returns null when the current phase has nobody left to offer.
 */
export function drawNext(state: State): Player | null {
  requireLive(state);
  requireNoTimeout(state);
  if (state.lot) throw new AuctionError('Close the current lot before drawing the next player');

  if (state.stage === 'accelerated') {
    const pool = eligiblePool(state);
    if (pool.length === 0) return null;
    return pool[randomInt(pool.length)];
  }

  const tiers = sortedTiers(state.settings);
  let idx = tiers.findIndex((t) => t.key === state.currentTierKey);
  if (idx === -1) idx = 0;
  for (; idx < tiers.length; idx++) {
    const pool = state.players.filter(
      (p) => p.status === 'available' && p.tierKey === tiers[idx].key,
    );
    if (pool.length > 0) {
      state.currentTierKey = tiers[idx].key;
      return pool[randomInt(pool.length)];
    }
  }
  // Also offer stray available players whose tier isn't in settings (edited pools).
  const strays = state.players.filter((p) => p.status === 'available');
  if (strays.length > 0) return strays[randomInt(strays.length)];
  return null;
}

export function openLot(state: State, playerId: string, now: number): void {
  requireLive(state);
  requireNoTimeout(state);
  if (state.lot) throw new AuctionError('Another player is already up for auction');
  const player = getPlayer(state, playerId);
  if (player.status === 'sold') throw new AuctionError(`${player.name} is already sold`);
  if (state.stage === 'accelerated' && player.status === 'unsold') {
    player.offeredInPass = true;
  }
  if (state.stage === 'live') state.currentTierKey = player.tierKey;
  state.lot = {
    id: `lot-${now}-${randomInt(1_000_000)}`,
    playerId, bids: [], openedAt: now, timerEndsAt: null,
  };
}

/** Reject actions taken against a lot the client is no longer looking at. */
function requireSameLot(state: State, lotId: string | undefined): Lot {
  const lot = requireLot(state);
  if (lotId !== undefined && lot.id !== lotId) {
    const player = getPlayer(state, lot.playerId);
    throw new AuctionError(
      `Too late — that lot has closed. ${player.name} is up for auction now; check your screen and try again.`,
      409,
    );
  }
  return lot;
}

export interface BidCheck {
  ok: boolean;
  reason?: string;
}

export function checkBid(state: State, teamId: string, amount: number): BidCheck {
  if (!state.lot) return { ok: false, reason: 'No player is up for auction' };
  const summary = teamSummary(state, teamId);
  if (summary.full) {
    return { ok: false, reason: `Squad is full (${state.settings.maxSquad} players) — team has exited the auction` };
  }
  const lot = state.lot;
  const leading = lot.bids[lot.bids.length - 1];
  if (leading && leading.teamId === teamId) {
    return { ok: false, reason: 'Already the leading bidder' };
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, reason: 'Bid must be a positive whole number' };
  }
  const min = nextMinBid(state);
  if (amount < min) return { ok: false, reason: `Minimum next bid is ${min} pts` };
  if (amount > summary.maxBid) {
    return {
      ok: false,
      reason: `Exceeds max bid of ${summary.maxBid} pts (purse guardrail: ${summary.remaining} remaining − ${state.settings.reservePerSlot} × ${Math.max(0, state.settings.minSquad - summary.count - 1)} mandatory slots)`,
    };
  }
  return { ok: true };
}

export function placeBid(
  state: State, teamId: string, amount: number | undefined, by: 'admin' | 'team', now: number,
  lotId?: string, deviceTag?: string,
): void {
  requireLive(state);
  const lot = requireSameLot(state, lotId);
  getTeam(state, teamId);
  const bidAmount = amount ?? nextMinBid(state);
  const check = checkBid(state, teamId, bidAmount);
  if (!check.ok) throw new AuctionError(check.reason ?? 'Invalid bid');
  lot.bids.push({ teamId, amount: bidAmount, by, ts: now, ...(deviceTag ? { deviceTag } : {}) });
  lot.timerEndsAt = null; // any bid resets the hammer timer
}

export function undoBid(state: State, lotId?: string): void {
  const lot = requireSameLot(state, lotId);
  if (lot.bids.length === 0) throw new AuctionError('No bids to undo');
  lot.bids.pop();
  lot.timerEndsAt = null;
}

export interface HammerGuard {
  lotId?: string;
  /** Leading team/price the auctioneer saw when tapping SOLD — rejects the
   *  hammer if another bid slipped in between glance and tap. */
  expectedTeamId?: string;
  expectedPrice?: number;
}

/**
 * Rule: after every `timeoutEvery` players auctioned in the main round (sold
 * OR unsold — every hammer counts), the set ends with a strategic timeout.
 * The auction stays paused until the auctioneer resumes it. The accelerated
 * round runs uninterrupted.
 */
function recordHammer(state: State, now: number): void {
  if (state.stage !== 'live') return;
  state.mainAuctionCount += 1;
  const every = state.settings.timeoutEvery;
  if (every > 0 && state.mainAuctionCount % every === 0) {
    state.timeout = { startedAt: now, setNumber: state.mainAuctionCount / every };
  }
}

export function sellLot(state: State, now: number, guard: HammerGuard = {}): { player: Player; teamId: string; price: number } {
  requireLive(state);
  const lot = requireSameLot(state, guard.lotId);
  const leading = lot.bids[lot.bids.length - 1];
  if (!leading) throw new AuctionError('No bids yet — mark the player UNSOLD instead');
  if ((guard.expectedTeamId !== undefined && leading.teamId !== guard.expectedTeamId)
    || (guard.expectedPrice !== undefined && leading.amount !== guard.expectedPrice)) {
    throw new AuctionError(
      `Hold on — a new bid just landed: ${getTeam(state, leading.teamId).name} now leads at ${leading.amount} pts. Check and hammer again.`,
      409,
    );
  }
  const player = getPlayer(state, lot.playerId);
  player.status = 'sold';
  player.teamId = leading.teamId;
  player.price = leading.amount;
  player.round = state.stage === 'accelerated' ? 'accelerated' : 'main';
  state.lot = null;
  recordHammer(state, now);
  return { player, teamId: leading.teamId, price: leading.amount };
}

export function passLot(state: State, lotId?: string, now = Date.now()): Player {
  requireLive(state);
  const lot = requireSameLot(state, lotId);
  if (lot.bids.length > 0) {
    throw new AuctionError('There is a standing bid — SELL or undo the bid instead');
  }
  const player = getPlayer(state, lot.playerId);
  player.status = 'unsold';
  player.teamId = null;
  player.price = null;
  player.round = null;
  state.lot = null;
  recordHammer(state, now);
  return player;
}

export function cancelLot(state: State): void {
  const lot = requireLot(state);
  const player = getPlayer(state, lot.playerId);
  // Put the player back exactly as they were before the lot opened.
  if (state.stage === 'accelerated' && player.status === 'unsold') {
    player.offeredInPass = false;
  }
  state.lot = null;
}

// --- Strategic timeouts --------------------------------------------------------

/** Auctioneer calls an extra break between lots (outside the every-N cycle). */
export function startTimeout(state: State, now: number): TimeoutInfo {
  requireLive(state);
  if (state.lot) throw new AuctionError('Close the current lot before calling a timeout');
  if (state.timeout) throw new AuctionError('A strategic timeout is already in progress');
  state.timeout = { startedAt: now, setNumber: null };
  return state.timeout;
}

export function resumeAuction(state: State): void {
  if (!state.timeout) throw new AuctionError('No strategic timeout is in progress');
  state.timeout = null;
}

// --- Phase transitions -------------------------------------------------------

export function unsoldCount(state: State): number {
  return state.players.filter((p) => p.status === 'unsold').length;
}

export function startAccelerated(state: State): void {
  if (state.stage !== 'live' && state.stage !== 'accelerated') {
    throw new AuctionError('The auction is not running');
  }
  if (state.lot) throw new AuctionError('Close the current lot first');
  if (state.players.some((p) => p.status === 'available')) {
    throw new AuctionError('The main round is not finished — players are still waiting for their first call');
  }
  if (unsoldCount(state) === 0) throw new AuctionError('No unsold players — nothing to accelerate');
  state.stage = 'accelerated';
  state.timeout = null; // the end-of-sets break flows straight into the accelerated round
  for (const p of state.players) p.offeredInPass = false;
}

/**
 * Rule 8 fallback: allot remaining unsold players at base price to the
 * open-slot team with the largest remaining purse (teams below the minimum
 * squad first). Returns the assignments made; throws if someone cannot be placed.
 */
export function allotUnsold(state: State): { player: Player; teamId: string; price: number }[] {
  if (state.lot) throw new AuctionError('Close the current lot first');
  const unsold = state.players.filter((p) => p.status === 'unsold');
  if (unsold.length === 0) throw new AuctionError('No unsold players to allot');
  // Cheapest first so expensive leftovers land on the fattest purses last.
  unsold.sort((a, b) => basePriceOf(state, a) - basePriceOf(state, b));
  const out: { player: Player; teamId: string; price: number }[] = [];
  for (const player of unsold) {
    const price = basePriceOf(state, player);
    const candidates = state.teams
      .map((t) => teamSummary(state, t.id))
      .filter((s) => !s.full && s.remaining >= price);
    if (candidates.length === 0) {
      throw new AuctionError(
        `Cannot auto-allot ${player.name} (base ${price} pts): no team has both an open slot and enough purse. Assign manually.`,
      );
    }
    const below = candidates.filter((s) => s.count < state.settings.minSquad);
    const pool = below.length > 0 ? below : candidates;
    pool.sort((a, b) => b.remaining - a.remaining || a.count - b.count);
    const target = pool[0];
    player.status = 'sold';
    player.teamId = target.id;
    player.price = price;
    player.round = 'allotted';
    out.push({ player, teamId: target.id, price });
  }
  return out;
}

/** Auctioneer override: assign a player to a team at a given price. */
export function assignPlayer(state: State, playerId: string, teamId: string, price: number): void {
  const player = getPlayer(state, playerId);
  const summary = teamSummary(state, teamId);
  if (state.lot?.playerId === playerId) throw new AuctionError('This player is currently up for auction — close the lot first');
  if (player.status === 'sold') throw new AuctionError(`${player.name} is already sold — release them first`);
  if (!Number.isInteger(price) || price < 0) throw new AuctionError('Price must be a non-negative whole number');
  if (summary.full) throw new AuctionError('That squad is already full');
  if (price > summary.remaining) {
    throw new AuctionError(`Price exceeds the team's remaining purse (${summary.remaining} pts)`);
  }
  player.status = 'sold';
  player.teamId = teamId;
  player.price = price;
  player.round = 'manual';
  player.offeredInPass = false;
}

/** Auctioneer correction: return a sold player to the pool and refund the purse. */
export function releasePlayer(state: State, playerId: string): void {
  const player = getPlayer(state, playerId);
  if (player.status !== 'sold') throw new AuctionError(`${player.name} is not sold`);
  player.status = state.stage === 'accelerated' ? 'unsold' : 'available';
  player.teamId = null;
  player.price = null;
  player.round = null;
  player.offeredInPass = false;
}

export function completeAuction(state: State, force = false): void {
  if (state.lot) throw new AuctionError('Close the current lot first');
  if (!force) {
    const open = state.players.filter((p) => p.status !== 'sold').length;
    if (open > 0) {
      throw new AuctionError(
        `${open} player(s) are not sold yet. Run the accelerated round / allotment, or force-complete.`,
      );
    }
    const short = allSummaries(state).filter((s) => s.count < state.settings.minSquad);
    if (short.length > 0) {
      const names = short.map((s) => getTeam(state, s.id).name).join(', ');
      throw new AuctionError(`Below minimum squad: ${names}. Force-complete to override.`);
    }
  }
  state.stage = 'completed';
  state.lot = null;
  state.timeout = null;
}

export function resetAuction(state: State): void {
  state.stage = 'setup';
  state.currentTierKey = null;
  state.lot = null;
  state.mainAuctionCount = 0;
  state.timeout = null;
  for (const p of state.players) {
    p.status = 'available';
    p.teamId = null;
    p.price = null;
    p.round = null;
    p.offeredInPass = false;
  }
}

// --- Snapshots (undo) --------------------------------------------------------

export function takeSnapshot(state: State, label: string, now: number): AuctionSnapshot {
  return {
    label,
    ts: now,
    stage: state.stage,
    currentTierKey: state.currentTierKey,
    lot: state.lot ? JSON.parse(JSON.stringify(state.lot)) : null,
    mainAuctionCount: state.mainAuctionCount,
    timeout: state.timeout ? { ...state.timeout } : null,
    players: state.players.map((p) => ({
      id: p.id,
      status: p.status,
      teamId: p.teamId ?? null,
      price: p.price ?? null,
      round: p.round ?? null,
      offeredInPass: p.offeredInPass ?? false,
    })),
  };
}

export function restoreSnapshot(state: State, snap: AuctionSnapshot): void {
  state.stage = snap.stage;
  state.currentTierKey = snap.currentTierKey;
  state.lot = snap.lot ? JSON.parse(JSON.stringify(snap.lot)) : null;
  // Older snapshots (pre-timeout feature) leave the current values in place.
  if (snap.mainAuctionCount !== undefined) state.mainAuctionCount = snap.mainAuctionCount;
  if (snap.timeout !== undefined) state.timeout = snap.timeout ? { ...snap.timeout } : null;
  const byId = new Map(snap.players.map((p) => [p.id, p]));
  for (const p of state.players) {
    const s = byId.get(p.id);
    if (!s) continue; // player added after the snapshot — leave untouched
    p.status = s.status;
    p.teamId = s.teamId;
    p.price = s.price;
    p.round = s.round;
    p.offeredInPass = s.offeredInPass;
  }
}

// --- Progress / feasibility ---------------------------------------------------

export interface TierProgress {
  tierKey: string;
  name: string;
  total: number;
  sold: number;
  unsold: number;
  remaining: number;
}

export function progress(state: State): {
  total: number; sold: number; unsold: number; available: number; perTier: TierProgress[];
} {
  const perTier: TierProgress[] = sortedTiers(state.settings).map((t) => {
    const pool = state.players.filter((p) => p.tierKey === t.key);
    return {
      tierKey: t.key,
      name: t.name,
      total: pool.length,
      sold: pool.filter((p) => p.status === 'sold').length,
      unsold: pool.filter((p) => p.status === 'unsold').length,
      remaining: pool.filter((p) => p.status === 'available').length,
    };
  });
  return {
    total: state.players.length,
    sold: state.players.filter((p) => p.status === 'sold').length,
    unsold: unsoldCount(state),
    available: state.players.filter((p) => p.status === 'available').length,
    perTier,
  };
}

/** Sanity warnings shown in the admin console — never blocking. */
export function feasibilityWarnings(state: State): string[] {
  const { settings, teams, players } = state;
  const warnings: string[] = [];
  const n = players.length;
  const lo = teams.length * settings.minSquad;
  const hi = teams.length * settings.maxSquad;
  if (n < lo) {
    warnings.push(`Pool has ${n} players but ${teams.length} teams × min ${settings.minSquad} needs ${lo}. Lower the minimum squad or add players.`);
  }
  if (n > hi) {
    warnings.push(`Pool has ${n} players but ${teams.length} teams × max ${settings.maxSquad} caps at ${hi}. ${n - hi} player(s) cannot be sold — raise the maximum squad or trim the pool.`);
  }
  const minSpend = players.reduce((sum, p) => sum + basePriceOf(state, p), 0);
  const combined = teams.length * settings.purse;
  if (minSpend > combined) {
    warnings.push(`Sum of base prices (${minSpend}) exceeds the combined purse (${combined}). Auction cannot clear.`);
  }
  if (settings.minSquad > settings.maxSquad) {
    warnings.push('Minimum squad is greater than maximum squad.');
  }
  const cheapest = Math.min(...settings.tiers.map((t) => t.basePrice));
  if (Number.isFinite(cheapest) && settings.reservePerSlot < cheapest) {
    warnings.push(`Reserve per slot (${settings.reservePerSlot}) is below the cheapest base price (${cheapest}); the guardrail may not guarantee minimum squads.`);
  }
  return warnings;
}
