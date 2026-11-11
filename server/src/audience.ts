import { createHash } from 'node:crypto';
import { AuctionError, basePriceOf, getPlayer } from './engine';
import { GuessResult, Lot, State } from './types';

// The audience: phones watching the auction. They can guess each hammer price
// (closest wins) and send emoji reactions to the screens. None of it can touch
// the auction itself; it lives beside the auction state, saved in its own row.
//  - One guess per phone per player, only in the first GUESS_WINDOW_MS after
//    the player comes up, so nobody waits for the last bid and copies it.
//  - The closest three score 3, 2 and 1 points; ties go to the earlier guess.
//  - Undoing a sale takes its points back; selling again scores it again. The
//    last few players' guesses are kept for exactly that: an undo two or three
//    steps back still finds them.
//  - A player sold a second time (released and re-auctioned) is scored once:
//    the new sale's points replace the old one's.

/** How long after a player comes up the phones can guess the hammer price. */
export const GUESS_WINDOW_MS = 30_000;
/** The reactions a phone can send. Anything else is ignored. */
export const REACTIONS: readonly string[] = ['🔥', '👏', '😮', '😂', '💸', '🏏'];

const POINTS = [3, 2, 1];
const MAX_GUESSES_PER_LOT = 3000; // far above any real crowd: a bound, not a feature
const KEPT_LOTS = 4;              // the player on the block and the three before
const KEPT_PER_OLD_LOT = 1000;    // an earlier player keeps this many guesses (the first to arrive)

interface Guess {
  name: string;
  amount: number;
  ts: number;
}
interface Award {
  tag: string;
  name: string;
  pts: number;
}
interface LotAwards {
  playerId: string | null;
  rows: Award[];
}
type SavedGuesses = [tag: string, guess: Guess][];
export interface AudienceSave {
  lotId: string | null;
  lots: [lotId: string, guesses: SavedGuesses][]; // oldest first
  awards: Record<string, LotAwards>;              // by lot id
}
export interface BoardRow {
  tag: string;
  name: string | null;
  points: number;
  wins: number;
}
/** Whose network a guess came from, and how many it may send for one player. */
export interface GuessOrigin {
  address: string;
  limit: number;
}

/** The phone has already guessed on this player: `amount` is what it guessed. */
export class AlreadyGuessed extends AuctionError {
  constructor(public readonly amount: number) {
    super(`You already guessed ${amount} for this player`, 409);
  }
}

/** Short public fingerprint of a watching phone (its random id never leaves the server). */
export function audienceTag(deviceId: string): string {
  return createHash('sha256').update(`audience:${deviceId}`).digest('hex').slice(0, 10);
}

/** The id a watch page sends with its guesses, if it is well formed. */
export function audienceDevice(header: unknown): string | null {
  return typeof header === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(header) ? header : null;
}

// A name goes on the big screen, so it is letters only (any script), 2–16 long.
const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{1,15}$/u;
export function cleanName(value: unknown): string {
  const name = typeof value === 'string' ? value.normalize('NFC').replace(/\s+/g, ' ').trim() : '';
  if (!NAME.test(name)) throw new AuctionError('Type your name: 2 to 16 letters');
  return name;
}

export class Audience {
  private lotId: string | null = null;
  /** Guesses by lot, oldest lot first; at most KEPT_LOTS of them. */
  private lots = new Map<string, Map<string, Guess>>();
  private awards: Record<string, LotAwards> = {};
  /** Accepted guesses per network address, by lot. Not saved: a restart forgives. */
  private origins = new Map<string, Map<string, number>>();

  constructor(saved: unknown, private readonly save: (s: AudienceSave) => void = () => {}) {
    // What was saved is only a game's scores: anything in it that isn't the
    // right shape is dropped, so a damaged row can never stop the server.
    if (!saved || typeof saved !== 'object') return;
    const row = saved as Record<string, unknown>;
    const text = (v: unknown): v is string => typeof v === 'string';
    const count = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const guessesOf = (list: unknown): Map<string, Guess> => {
      const out = new Map<string, Guess>();
      if (!Array.isArray(list)) return out;
      for (const pair of list as unknown[]) {
        if (!Array.isArray(pair)) continue;
        const [tag, g] = pair as [unknown, Partial<Guess> | null];
        if (text(tag) && g && typeof g === 'object' && text(g.name) && count(g.amount) && count(g.ts)) {
          out.set(tag, { name: g.name, amount: g.amount, ts: g.ts });
        }
      }
      return out;
    };
    if (text(row.lotId)) this.lotId = row.lotId;
    if (Array.isArray(row.lots)) {
      for (const entry of row.lots as unknown[]) {
        if (Array.isArray(entry) && text(entry[0])) this.lots.set(entry[0], guessesOf(entry[1]));
      }
    } else if (this.lotId && Array.isArray(row.guesses)) {
      this.lots.set(this.lotId, guessesOf(row.guesses)); // a save from before lots were kept
    }
    if (row.awards && typeof row.awards === 'object' && !Array.isArray(row.awards)) {
      for (const [lotId, value] of Object.entries(row.awards as Record<string, unknown>)) {
        // older saves held the list itself; newer ones say whose sale it was
        const holder = (Array.isArray(value) ? { playerId: null, rows: value } : value) as { playerId?: unknown; rows?: unknown } | null;
        if (!holder || typeof holder !== 'object' || !Array.isArray(holder.rows)) continue;
        const rows = (holder.rows as Partial<Award>[])
          .filter((a) => a && typeof a === 'object' && text(a.tag) && text(a.name) && count(a.pts))
          .map((a) => ({ tag: a.tag as string, name: a.name as string, pts: a.pts as number }));
        if (rows.length > 0) this.awards[lotId] = { playerId: text(holder.playerId) ? holder.playerId : null, rows };
      }
    }
  }

  private persist(): void {
    this.save({
      lotId: this.lotId,
      lots: [...this.lots].map(([id, guesses]) => [id, [...guesses]]),
      awards: this.awards,
    });
  }

  /** The lot now on the block. A new one starts with no guesses; one an undo
   *  brought back keeps the guesses it had. */
  sync(lot: Lot | null): void {
    if (!lot || (lot.id === this.lotId && this.lots.has(lot.id))) return;
    const before = this.lotId && this.lotId !== lot.id ? this.lots.get(this.lotId) : undefined;
    if (before && before.size > KEPT_PER_OLD_LOT) {
      this.lots.set(this.lotId as string, new Map([...before].slice(0, KEPT_PER_OLD_LOT)));
    }
    const kept = this.lots.get(lot.id);
    this.lots.delete(lot.id);
    this.lots.set(lot.id, kept ?? new Map()); // newest last
    this.lotId = lot.id;
    for (const id of [...this.lots.keys()].slice(0, -KEPT_LOTS)) {
      this.lots.delete(id);
      this.origins.delete(id);
    }
    this.persist();
  }

  /** How many phones have guessed on this lot. */
  count(lotId: string | null | undefined): number {
    return lotId ? this.lots.get(lotId)?.size ?? 0 : 0;
  }

  /** A phone's guess on the open lot. Throws with the reason when it can't
   *  count. `origin` caps how many guesses one network address may send for
   *  one player; the answer says how many that address has sent now. */
  guess(
    state: State, tag: string, name: string, amount: number, lotId: string, now: number, origin?: GuessOrigin,
  ): { amount: number; closesAt: number; fromAddress: number } {
    if (!state.settings.audienceGame) throw new AuctionError('The guessing game is switched off', 403);
    const lot = state.lot;
    if (!lot || lot.id !== lotId) throw new AuctionError('That player is no longer up — guess on the next one', 409);
    const closesAt = lot.openedAt + GUESS_WINDOW_MS;
    if (now > closesAt) throw new AuctionError('Guessing has closed for this player', 409);
    const base = basePriceOf(state, getPlayer(state, lot.playerId));
    const max = state.settings.purse;
    // Any whole number in range: base prices and bid steps are the organiser's to choose.
    if (!Number.isInteger(amount) || amount < base || amount > max) {
      throw new AuctionError(`Guess a whole number between ${base} and ${max}`);
    }
    this.sync(lot);
    const guesses = this.lots.get(lot.id) as Map<string, Guess>;
    const mine = guesses.get(tag);
    if (mine) throw new AlreadyGuessed(mine.amount);
    if (guesses.size >= MAX_GUESSES_PER_LOT) throw new AuctionError('Too many guesses on this player', 429);
    let fromAddress = 0;
    if (origin) {
      const seen = this.origins.get(lot.id) ?? new Map<string, number>();
      fromAddress = (seen.get(origin.address) ?? 0) + 1;
      if (fromAddress > origin.limit) throw new AuctionError('Too many guesses from this network for this player', 429);
      seen.set(origin.address, fromAddress);
      this.origins.set(lot.id, seen);
    }
    guesses.set(tag, { name, amount, ts: now });
    this.persist();
    return { amount, closesAt, fromAddress };
  }

  /** The lot sold: rank its guesses (closest first, earlier first on a tie)
   *  and score the top three. A player has one standing sale, so points from
   *  an earlier sale of the same player (released, then sold again) go. */
  settle(lotId: string, playerId: string, price: number): GuessResult {
    const entries = [...(this.lots.get(lotId) ?? [])];
    const ranked = entries
      .map(([tag, g]) => ({ tag, name: g.name, amount: g.amount, ts: g.ts, off: Math.abs(g.amount - price) }))
      .sort((a, b) => a.off - b.off || a.ts - b.ts);
    const top = ranked.slice(0, POINTS.length);
    for (const [id, held] of Object.entries(this.awards)) {
      if (id !== lotId && held.playerId === playerId) delete this.awards[id];
    }
    if (top.length > 0) this.awards[lotId] = { playerId, rows: top.map((g, i) => ({ tag: g.tag, name: g.name, pts: POINTS[i] })) };
    else delete this.awards[lotId];
    this.persist();
    return {
      lotId,
      playerId,
      price,
      total: entries.length,
      top: top.map((g) => ({ name: g.name || null, amount: g.amount, off: g.off, tag: g.tag })),
    };
  }

  /** The sale was undone: its points come back off the board. */
  unsettle(lotId: string): void {
    if (!(lotId in this.awards)) return;
    delete this.awards[lotId];
    this.persist();
  }

  /** The best guessers so far. */
  board(limit: number, showNames: boolean): BoardRow[] {
    const by = new Map<string, BoardRow & { name: string }>();
    for (const held of Object.values(this.awards)) {
      for (const a of held.rows) {
        const row = by.get(a.tag) ?? { tag: a.tag, name: a.name, points: 0, wins: 0 };
        row.points += a.pts;
        if (a.pts === POINTS[0]) row.wins += 1;
        if (a.name) row.name = a.name;
        by.set(a.tag, row);
      }
    }
    return [...by.values()]
      // most points, then most outright wins; after that a guesser who gave a
      // name comes before a nameless one, and the rest is just a stable order
      .sort((a, b) => b.points - a.points || b.wins - a.wins || Number(!a.name) - Number(!b.name)
        || a.name.localeCompare(b.name) || a.tag.localeCompare(b.tag))
      .slice(0, limit)
      .map((r) => ({ tag: r.tag, name: showNames && r.name ? r.name : null, points: r.points, wins: r.wins }));
  }

  /** A new event (auction reset, factory reset, restore): everything goes. */
  clear(): void {
    this.lotId = null;
    this.lots.clear();
    this.origins.clear();
    this.awards = {};
    this.persist();
  }
}
