import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as engine from './engine';
import { buildInitialState } from './seed';
import { State } from './types';

function fresh(): State {
  return buildInitialState();
}

function live(): State {
  const s = fresh();
  engine.startAuction(s);
  return s;
}

function open(s: State, playerId: string): void {
  engine.openLot(s, playerId, 1000);
}

function playerByName(s: State, name: string) {
  const p = s.players.find((x) => x.name === name);
  assert.ok(p, `player ${name} exists`);
  return p!;
}

// ---- increment ladder -------------------------------------------------------

test('increment ladder matches the auction plan (+100 to 1000, +200 to 3000, +500 above)', () => {
  const s = fresh();
  assert.equal(engine.stepFor(s.settings, 200), 100);
  assert.equal(engine.stepFor(s.settings, 999), 100);
  assert.equal(engine.stepFor(s.settings, 1000), 200);
  assert.equal(engine.stepFor(s.settings, 2999), 200);
  assert.equal(engine.stepFor(s.settings, 3000), 500);
  assert.equal(engine.stepFor(s.settings, 9000), 500);
});

test('nextMinBid opens at base price then climbs the ladder', () => {
  const s = live();
  const hirok = playerByName(s, 'Hirok Roy'); // diamond, base 1000
  open(s, hirok.id);
  assert.equal(engine.nextMinBid(s), 1000);
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  assert.equal(s.lot!.bids[0].amount, 1000);
  assert.equal(engine.nextMinBid(s), 1200); // 1000 + 200
  engine.placeBid(s, 't2', 3000, 'admin', 2); // jump bid allowed
  assert.equal(engine.nextMinBid(s), 3500); // 3000 + 500
});

// ---- purse guardrail ----------------------------------------------------------

test('fresh team max bid matches the sheet: 10000 − 200 × 6 = 8800', () => {
  const s = fresh();
  const sum = engine.teamSummary(s, 't1');
  assert.equal(sum.maxBid, 8800);
  assert.equal(sum.remaining, 10000);
  assert.equal(sum.count, 0);
});

test('guardrail blocks a bid that would strand the minimum squad', () => {
  const s = live();
  const hirok = playerByName(s, 'Hirok Roy');
  open(s, hirok.id);
  const check = engine.checkBid(s, 't1', 8900);
  assert.equal(check.ok, false);
  assert.match(check.reason!, /guardrail/i);
  assert.equal(engine.checkBid(s, 't1', 8800).ok, true);
});

test('guardrail relaxes as the squad fills', () => {
  const s = live();
  // Give t1 six players at base price via manual assignment (uses "manual" round).
  const newPlayers = s.players.filter((p) => p.tierKey === 'new').slice(0, 6);
  for (const p of newPlayers) engine.assignPlayer(s, p.id, 't1', 200);
  const sum = engine.teamSummary(s, 't1');
  assert.equal(sum.count, 6);
  assert.equal(sum.remaining, 10000 - 1200);
  // One more mandatory slot after this one? count=6 → after winning, 7 ≥ min → reserve 0.
  assert.equal(sum.maxBid, 8800);
});

test('a full squad exits the auction', () => {
  const s = live();
  const pool = s.players.filter((p) => p.tierKey === 'new' || p.tierKey === 'emerald').slice(0, 8);
  for (const p of pool) engine.assignPlayer(s, p.id, 't1', 200);
  const sum = engine.teamSummary(s, 't1');
  assert.equal(sum.full, true);
  const hirok = playerByName(s, 'Hirok Roy');
  open(s, hirok.id);
  const check = engine.checkBid(s, 't1', 1000);
  assert.equal(check.ok, false);
  assert.match(check.reason!, /full/i);
});

// ---- bidding rules -------------------------------------------------------------

test('leading bidder cannot raise against themselves', () => {
  const s = live();
  open(s, playerByName(s, 'Kabya').id);
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  assert.equal(engine.checkBid(s, 't1', 700).ok, false);
  assert.equal(engine.checkBid(s, 't2', 700).ok, true);
});

test('bid below the minimum is rejected', () => {
  const s = live();
  open(s, playerByName(s, 'Kabya').id); // gold, base 600
  assert.equal(engine.checkBid(s, 't1', 500).ok, false);
  engine.placeBid(s, 't1', 600, 'admin', 1);
  assert.equal(engine.checkBid(s, 't2', 650).ok, false); // min is 700
});

test('undoBid removes only the last bid', () => {
  const s = live();
  open(s, playerByName(s, 'Kabya').id);
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  engine.placeBid(s, 't2', undefined, 'admin', 2);
  engine.undoBid(s);
  assert.equal(s.lot!.bids.length, 1);
  assert.equal(s.lot!.bids[0].teamId, 't1');
});

// ---- sell / pass / cancel -------------------------------------------------------

test('sellLot books the sale to the leading bidder and frees the lot', () => {
  const s = live();
  const kabya = playerByName(s, 'Kabya');
  open(s, kabya.id);
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  engine.placeBid(s, 't3', undefined, 'admin', 2);
  const sale = engine.sellLot(s, 3);
  assert.equal(sale.teamId, 't3');
  assert.equal(sale.price, 700);
  assert.equal(kabya.status, 'sold');
  assert.equal(kabya.round, 'main');
  assert.equal(s.lot, null);
  assert.equal(engine.teamSummary(s, 't3').spent, 700);
});

test('selling with no bids fails; passing with bids fails', () => {
  const s = live();
  open(s, playerByName(s, 'Kabya').id);
  assert.throws(() => engine.sellLot(s, 1), /no bids/i);
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  assert.throws(() => engine.passLot(s), /standing bid/i);
});

test('passLot marks the player unsold', () => {
  const s = live();
  const kabya = playerByName(s, 'Kabya');
  open(s, kabya.id);
  engine.passLot(s);
  assert.equal(kabya.status, 'unsold');
  assert.equal(s.lot, null);
});

// ---- draw & tier progression ------------------------------------------------------

test('drawNext walks tiers in order: all diamonds before any gold', () => {
  const s = live();
  for (let i = 0; i < 4; i++) {
    const p = engine.drawNext(s);
    assert.ok(p);
    assert.equal(p!.tierKey, 'diamond');
    engine.openLot(s, p!.id, i);
    engine.passLot(s);
  }
  const next = engine.drawNext(s);
  assert.equal(next!.tierKey, 'gold');
});

test('main round ends when everyone has been offered once', () => {
  const s = live();
  for (const p of s.players) p.status = 'unsold';
  assert.equal(engine.drawNext(s), null);
});

// ---- accelerated round -----------------------------------------------------------

test('accelerated round re-offers unsold players once per pass', () => {
  const s = live();
  for (const p of s.players) p.status = 'sold';
  const a = playerByName(s, 'Papu');
  const b = playerByName(s, 'Neev');
  a.status = 'unsold';
  b.status = 'unsold';
  a.teamId = b.teamId = null;
  engine.startAccelerated(s);
  assert.equal(s.stage, 'accelerated');
  const first = engine.drawNext(s)!;
  engine.openLot(s, first.id, 1);
  engine.passLot(s);
  const second = engine.drawNext(s)!;
  assert.notEqual(second.id, first.id);
  engine.openLot(s, second.id, 2);
  engine.placeBid(s, 't2', undefined, 'admin', 3);
  engine.sellLot(s, 4);
  assert.equal(second.round, 'accelerated');
  assert.equal(engine.drawNext(s), null); // pass exhausted
});

test('accelerated round cannot start while the main round is unfinished', () => {
  const s = live();
  assert.throws(() => engine.startAccelerated(s), /main round/i);
});

// ---- allotment ----------------------------------------------------------------------

test('allotUnsold sends players to the open-slot team with the largest purse, below-minimum teams first', () => {
  const s = live();
  s.settings.minSquad = 1;
  s.settings.maxSquad = 8;
  // t1 has spent heavily; t2 has spent nothing but already has a player (meets min).
  const gold = s.players.filter((p) => p.tierKey === 'gold');
  engine.assignPlayer(s, gold[0].id, 't1', 5000);
  engine.assignPlayer(s, gold[1].id, 't2', 600);
  const papu = playerByName(s, 'Papu');
  for (const p of s.players) if (p.status === 'available') p.status = 'sold';
  papu.status = 'unsold';
  papu.teamId = null;
  papu.price = null;
  // t3 and t4 are below min (0 players); both have 10000 remaining → t3 (fewest players tiebreak, equal) gets it.
  const out = engine.allotUnsold(s);
  assert.equal(out.length, 1);
  assert.ok(['t3', 't4'].includes(out[0].teamId));
  assert.equal(out[0].price, 400);
  assert.equal(papu.round, 'allotted');
});

test('allotUnsold prefers the larger remaining purse among open teams', () => {
  const s = live();
  s.settings.minSquad = 0; // nobody is "below minimum" — pure purse comparison
  const gold = s.players.filter((p) => p.tierKey === 'gold');
  engine.assignPlayer(s, gold[0].id, 't1', 9000);
  engine.assignPlayer(s, gold[1].id, 't2', 100);
  const papu = playerByName(s, 'Papu');
  for (const p of s.players) if (p.status === 'available') p.status = 'sold';
  papu.status = 'unsold';
  papu.teamId = null;
  const out = engine.allotUnsold(s);
  // t3/t4 untouched at 10000 — must beat t2's 9900.
  assert.ok(['t3', 't4'].includes(out[0].teamId));
});

// ---- manual assignment & release ------------------------------------------------------

test('assignPlayer blocks overspending and full squads', () => {
  const s = live();
  const kabya = playerByName(s, 'Kabya');
  assert.throws(() => engine.assignPlayer(s, kabya.id, 't1', 10001), /remaining purse/i);
  engine.assignPlayer(s, kabya.id, 't1', 10000);
  assert.equal(engine.teamSummary(s, 't1').remaining, 0);
});

test('releasePlayer refunds the purse', () => {
  const s = live();
  const kabya = playerByName(s, 'Kabya');
  engine.assignPlayer(s, kabya.id, 't1', 3000);
  engine.releasePlayer(s, kabya.id);
  assert.equal(kabya.status, 'available');
  assert.equal(engine.teamSummary(s, 't1').remaining, 10000);
});

// ---- snapshots (undo) --------------------------------------------------------------------

test('snapshot restore rolls back a sale exactly', () => {
  const s = live();
  const kabya = playerByName(s, 'Kabya');
  open(s, kabya.id);
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  const snap = engine.takeSnapshot(s, 'Undo: sale', 2);
  engine.sellLot(s, 3);
  assert.equal(kabya.status, 'sold');
  engine.restoreSnapshot(s, snap);
  assert.equal(kabya.status, 'available');
  assert.ok(s.lot);
  assert.equal(s.lot!.bids.length, 1);
  assert.equal(engine.teamSummary(s, 't1').spent, 0);
});

// ---- strategic timeouts -------------------------------------------------------------

/** Hammer `n` players through the main round: odd draws sell to alternating
 *  teams at base price, even draws go unsold. */
function hammer(s: State, n: number, startTs = 100): void {
  for (let i = 0; i < n; i++) {
    const p = engine.drawNext(s);
    assert.ok(p, `draw ${i + 1} found a player`);
    engine.openLot(s, p!.id, startTs + i);
    if (i % 2 === 0) {
      engine.placeBid(s, i % 4 < 2 ? 't1' : 't2', undefined, 'admin', startTs + i);
      engine.sellLot(s, startTs + i);
    } else {
      engine.passLot(s, undefined, startTs + i);
    }
  }
}

test('every 8th hammer ends the set with a strategic timeout; resume continues the cycle', () => {
  const s = live();
  assert.equal(s.settings.timeoutEvery, 8);
  hammer(s, 7);
  assert.equal(s.timeout, null);
  assert.equal(s.mainAuctionCount, 7);
  hammer(s, 1); // 8th player — sold or unsold, the set is over
  assert.ok(s.timeout);
  assert.equal(s.timeout!.setNumber, 1);
  // The floor is closed until the auctioneer resumes.
  assert.throws(() => engine.drawNext(s), /timeout/i);
  assert.throws(() => engine.openLot(s, s.players.find((p) => p.status === 'available')!.id, 9), /timeout/i);
  engine.resumeAuction(s);
  assert.equal(s.timeout, null);
  hammer(s, 8, 200); // next set of 8 → timeout again
  assert.equal(s.timeout!.setNumber, 2);
  assert.equal(s.mainAuctionCount, 16);
});

test('accelerated round runs without automatic timeouts', () => {
  const s = live();
  for (const p of s.players) p.status = 'sold';
  const unsoldNames = ['Papu', 'Neev', 'Kabya'];
  for (const name of unsoldNames) {
    const p = playerByName(s, name);
    p.status = 'unsold';
    p.teamId = null;
    p.price = null;
  }
  s.mainAuctionCount = 7; // one hammer away from a timeout in the main round
  engine.startAccelerated(s);
  const p = engine.drawNext(s)!;
  engine.openLot(s, p.id, 1);
  engine.passLot(s, undefined, 2);
  assert.equal(s.timeout, null);
  assert.equal(s.mainAuctionCount, 7); // accelerated hammers don't advance the sets
});

test('timeoutEvery = 0 disables the timeout cycle', () => {
  const s = live();
  s.settings.timeoutEvery = 0;
  hammer(s, 9);
  assert.equal(s.timeout, null);
  assert.equal(s.mainAuctionCount, 9); // still counted for the record
});

test('auctioneer can call a manual timeout between lots, but not mid-lot or twice', () => {
  const s = live();
  engine.startTimeout(s, 50);
  assert.equal(s.timeout!.setNumber, null); // manual break, not a set boundary
  assert.throws(() => engine.startTimeout(s, 51), /already/i);
  engine.resumeAuction(s);
  assert.throws(() => engine.resumeAuction(s), /no strategic timeout/i);
  const p = engine.drawNext(s)!;
  engine.openLot(s, p.id, 52);
  assert.throws(() => engine.startTimeout(s, 53), /current lot/i);
});

test('undoing the set-closing hammer also lifts the timeout', () => {
  const s = live();
  hammer(s, 7);
  const p = engine.drawNext(s)!;
  engine.openLot(s, p.id, 90);
  engine.placeBid(s, 't3', undefined, 'admin', 91);
  const snap = engine.takeSnapshot(s, 'Undo: sale', 92);
  engine.sellLot(s, 93);
  assert.ok(s.timeout);
  engine.restoreSnapshot(s, snap);
  assert.equal(s.timeout, null);
  assert.equal(s.mainAuctionCount, 7);
});

test('starting the accelerated round or resetting clears any active timeout', () => {
  const s = live();
  for (const p of s.players) p.status = 'unsold';
  engine.startTimeout(s, 10);
  engine.startAccelerated(s);
  assert.equal(s.timeout, null);
  const s2 = live();
  engine.startTimeout(s2, 10);
  engine.resetAuction(s2);
  assert.equal(s2.timeout, null);
  assert.equal(s2.mainAuctionCount, 0);
});

// ---- completion & feasibility ---------------------------------------------------------------

test('completeAuction refuses while players are unsold, unless forced', () => {
  const s = live();
  assert.throws(() => engine.completeAuction(s), /not sold/i);
  engine.completeAuction(s, true);
  assert.equal(s.stage, 'completed');
});

test('feasibility flags a pool that cannot fit team limits (robust for 32 vs 36 players)', () => {
  const s = fresh();
  // 31 players, 4 teams, min 7 max 8 → [28, 32] contains 31 → no size warning.
  assert.equal(engine.feasibilityWarnings(s).filter((w) => w.includes('teams ×')).length, 0);
  // 9-a-side scenario: min 8, max 9 → [32, 36]; 31 players is short.
  s.settings.minSquad = 8;
  s.settings.maxSquad = 9;
  assert.ok(engine.feasibilityWarnings(s).some((w) => w.includes('needs 32')));
  // Add 5 players → 36 → fits again.
  for (let i = 0; i < 5; i++) {
    s.players.push({ ...s.players[0], id: `x${i}`, name: `Extra ${i}`, tierKey: 'new', status: 'available' });
  }
  assert.equal(engine.feasibilityWarnings(s).filter((w) => w.includes('teams ×')).length, 0);
});

test('reset returns every player to the pool', () => {
  const s = live();
  const kabya = playerByName(s, 'Kabya');
  engine.assignPlayer(s, kabya.id, 't2', 800);
  engine.resetAuction(s);
  assert.equal(s.stage, 'setup');
  assert.equal(kabya.status, 'available');
  assert.equal(engine.teamSummary(s, 't2').spent, 0);
});

// ---- stale-client guards (lot id + hammer guard) ------------------------------

test('a bid quoting a closed lot id is rejected (stale phone cannot bid on the wrong player)', () => {
  const s = live();
  open(s, playerByName(s, 'Kabya').id);
  const staleLotId = s.lot!.id;
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  engine.sellLot(s, 2);
  open(s, playerByName(s, 'Hirok Roy').id);
  assert.notEqual(s.lot!.id, staleLotId);
  assert.throws(() => engine.placeBid(s, 't2', undefined, 'team', 3, staleLotId), /too late/i);
  // Quoting the current lot id works.
  engine.placeBid(s, 't2', undefined, 'team', 4, s.lot!.id);
  assert.equal(s.lot!.bids.length, 1);
});

test('hammer guard rejects SOLD when a new bid landed after the auctioneer looked', () => {
  const s = live();
  open(s, playerByName(s, 'Kabya').id);
  engine.placeBid(s, 't1', undefined, 'admin', 1); // 600
  // Auctioneer sees t1 @ 600 and reaches for the hammer…
  const seen = { lotId: s.lot!.id, expectedTeamId: 't1', expectedPrice: 600 };
  // …but t2 sneaks in at 700.
  engine.placeBid(s, 't2', undefined, 'team', 2);
  assert.throws(() => engine.sellLot(s, 3, seen), /new bid just landed/i);
  // Selling with the fresh view succeeds.
  const sale = engine.sellLot(s, 4, { lotId: s.lot!.id, expectedTeamId: 't2', expectedPrice: 700 });
  assert.equal(sale.teamId, 't2');
  assert.equal(sale.price, 700);
});

test('passLot with a stale lot id is rejected', () => {
  const s = live();
  open(s, playerByName(s, 'Kabya').id);
  const staleLotId = s.lot!.id;
  engine.passLot(s, staleLotId); // same lot — fine
  open(s, playerByName(s, 'Hirok Roy').id);
  assert.throws(() => engine.passLot(s, staleLotId), /too late/i);
});

test('bids carry the fingerprint of the device that placed them', () => {
  const s = live();
  open(s, playerByName(s, 'Kabya').id);
  engine.placeBid(s, 't1', undefined, 'team', 1, s.lot!.id, 'a1b2c3');
  assert.equal(s.lot!.bids[0].deviceTag, 'a1b2c3');
  engine.placeBid(s, 't2', undefined, 'admin', 2, s.lot!.id);
  assert.equal(s.lot!.bids[1].deviceTag, undefined); // optional — old callers still work
});

test('undo-bid quoting a closed lot id is rejected (late tap cannot pop the next lot\'s bid)', () => {
  const s = live();
  open(s, playerByName(s, 'Kabya').id);
  const staleLotId = s.lot!.id;
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  engine.sellLot(s, 2);
  open(s, playerByName(s, 'Hirok Roy').id);
  engine.placeBid(s, 't2', undefined, 'admin', 3);
  assert.throws(() => engine.undoBid(s, staleLotId), /too late/i);
  assert.equal(s.lot!.bids.length, 1); // t2's bid survived
  engine.undoBid(s, s.lot!.id); // scoped to the lot on screen — works
  assert.equal(s.lot!.bids.length, 0);
});

test('each opened lot gets a unique id', () => {
  const s = live();
  const ids = new Set<string>();
  for (const name of ['Kabya', 'Hirok Roy']) {
    open(s, playerByName(s, name).id);
    ids.add(s.lot!.id);
    engine.cancelLot(s);
  }
  assert.equal(ids.size, 2);
});
