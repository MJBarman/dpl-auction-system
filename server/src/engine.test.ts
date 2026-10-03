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

// ---- DTC 3 seed (DTC3_Player_Categories.pdf) ----------------------------------

test('DTC 3 pool: 24 players — 2 Diamond, 4 Gold, 12 Emerald, 6 New', () => {
  const s = fresh();
  assert.equal(s.players.length, 24);
  const count = (key: string) => s.players.filter((p) => p.tierKey === key).length;
  assert.deepEqual(
    { diamond: count('diamond'), gold: count('gold'), emerald: count('emerald'), new: count('new') },
    { diamond: 2, gold: 4, emerald: 12, new: 6 },
  );
  assert.equal(new Set(s.players.map((p) => p.name)).size, 24, 'player names are unique');
  assert.equal(new Set(s.players.map((p) => p.id)).size, 24, 'player ids are unique');
});

test('DTC 3 teams: Power Rangers (Ashish) and Underdogs (Saurav); captains are not in the pool', () => {
  const s = fresh();
  assert.deepEqual(
    s.teams.map((t) => [t.id, t.name, t.captain]),
    [['t1', 'Power Rangers', 'Ashish'], ['t2', 'Underdogs', 'Saurav']],
  );
  for (const t of s.teams) assert.ok(!s.players.some((p) => p.name === t.captain), `${t.captain} is not for sale`);
});

test('DTC 3 tiers follow the combined MVP points, highest first', () => {
  const s = fresh();
  const ranked = s.players.filter((p) => p.tierKey !== 'new');
  assert.equal(ranked.length, 18);
  // Seeded in overall-rank order: totals strictly fall from #1 Hirak to #18 Vishal.
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i - 1].stats.mvpTotal! > ranked[i].stats.mvpTotal!, `${ranked[i - 1].name} outranks ${ranked[i].name}`);
  }
  // Tier lines sit at the big drops: 25.2 → 19.3 (Diamond → Gold), 15.3 → 8.1 (Gold → Emerald).
  for (const p of ranked) {
    const mvp = p.stats.mvpTotal!;
    assert.equal(p.tierKey, mvp >= 25 ? 'diamond' : mvp >= 15 ? 'gold' : 'emerald', `${p.name} (${mvp} MVP pts)`);
  }
  // New players have no DTC 1 or DTC 2 record at all.
  for (const p of s.players.filter((x) => x.tierKey === 'new')) assert.deepEqual(p.stats, {});
});

test('DTC 3 stats: every MVP total matches its DTC 1 + DTC 2 split (to CricHeroes rounding)', () => {
  const s = fresh();
  for (const p of s.players.filter((x) => x.tierKey !== 'new')) {
    const { mvpTotal, mvpS1, mvpS2 } = p.stats;
    assert.ok(mvpS1 != null || mvpS2 != null, `${p.name} has a season split`);
    const sum = (mvpS1 ?? 0) + (mvpS2 ?? 0);
    assert.ok(Math.abs(sum - mvpTotal!) <= 0.011, `${p.name}: ${mvpS1} + ${mvpS2} vs total ${mvpTotal}`);
  }
});

test('DTC 3 stats: batting and bowling lines are internally consistent', () => {
  const s = fresh();
  for (const p of s.players) {
    const { runs, balls, hs, batAvg, wkts, bestWkts, econ } = p.stats;
    if (hs != null) {
      assert.match(hs, /^\d+\*?$/, `${p.name} HS`);
      assert.ok(parseInt(hs, 10) <= runs!, `${p.name}: HS ${hs} within ${runs} runs`);
      assert.ok(balls != null, `${p.name} batted, so balls faced are known`);
    }
    if (batAvg != null) {
      // runs ÷ average = dismissals, a whole number (averages are printed to 2 dp).
      const outs = runs! / batAvg;
      assert.ok(Math.abs(outs - Math.round(outs)) < 0.01, `${p.name}: ${runs} runs at ${batAvg}`);
    }
    if (bestWkts != null) assert.ok(bestWkts <= wkts!, `${p.name}: best ${bestWkts} of ${wkts} wkts`);
    if (wkts != null) assert.ok(econ != null, `${p.name} bowled, so economy is known`);
  }
});

test('DTC 3 settings: squads of exactly 12 clear the pool with no feasibility warnings', () => {
  const s = fresh();
  assert.equal(s.settings.minSquad, 12);
  assert.equal(s.settings.maxSquad, 12);
  assert.equal(s.teams.length * s.settings.maxSquad, s.players.length);
  assert.deepEqual(engine.feasibilityWarnings(s), []);
  // The DPL squads (7–8) could never clear this pool: 2 × 8 = 16 < 24.
  s.settings.minSquad = 7;
  s.settings.maxSquad = 8;
  assert.ok(engine.feasibilityWarnings(s).some((w) => w.includes('8 player(s) cannot be sold')));
});

test('DTC 3 reuses the DPL photos of the 14 returning players that still have one — one photo each', () => {
  const s = fresh();
  const withPhoto = s.players.filter((p) => p.photoPath);
  assert.deepEqual(withPhoto.map((p) => p.name).sort(), [
    'Amlan', 'Asif', 'Bhokto', 'Bineet', 'Chinmoy Sr', 'Dharmendra', 'Hirak',
    'Jishnu', 'Kabya', 'Madhurjya', 'Sonu', 'Uddhab', 'Vishal', 'Yatrick',
  ]);
  assert.equal(playerByName(s, 'Chinmoy Sr').photoPath, 'players/p2/1783693432535.jpg'); // DPL "Chinmoy Deka"
  // A new upload deletes the replaced object, so a shared photo would vanish for the other player.
  assert.equal(new Set(withPhoto.map((p) => p.photoPath)).size, withPhoto.length, 'no two players share a photo');
  for (const p of withPhoto) assert.match(p.photoPath!, /^players\/p\d+\/\d+\.(jpg|png|webp)$/, p.name);
});

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
  const hirak = playerByName(s, 'Hirak'); // diamond, base 1000
  open(s, hirak.id);
  assert.equal(engine.nextMinBid(s), 1000);
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  assert.equal(s.lot!.bids[0].amount, 1000);
  assert.equal(engine.nextMinBid(s), 1200); // 1000 + 200
  engine.placeBid(s, 't2', 3000, 'admin', 2); // jump bid allowed
  assert.equal(engine.nextMinBid(s), 3500); // 3000 + 500
});

// ---- purse guardrail ----------------------------------------------------------

test('fresh team max bid keeps 400 for each of the other 11 slots: 10000 − 400 × 11 = 5600', () => {
  const s = fresh();
  const sum = engine.teamSummary(s, 't1');
  assert.equal(sum.maxBid, 5600);
  assert.equal(sum.remaining, 10000);
  assert.equal(sum.count, 0);
});

test('guardrail blocks a bid that would strand the minimum squad', () => {
  const s = live();
  const hirak = playerByName(s, 'Hirak');
  open(s, hirak.id);
  const check = engine.checkBid(s, 't1', 5700);
  assert.equal(check.ok, false);
  assert.match(check.reason!, /guardrail/i);
  assert.equal(engine.checkBid(s, 't1', 5600).ok, true);
});

test('guardrail relaxes as the squad fills', () => {
  const s = live();
  // Give t1 six players at base price via manual assignment (uses "manual" round).
  const newPlayers = s.players.filter((p) => p.tierKey === 'new');
  assert.equal(newPlayers.length, 6);
  for (const p of newPlayers) engine.assignPlayer(s, p.id, 't1', 200);
  let sum = engine.teamSummary(s, 't1');
  assert.equal(sum.count, 6);
  assert.equal(sum.remaining, 10000 - 1200);
  assert.equal(sum.maxBid, 8800 - 400 * 5); // five more mandatory slots after the next buy
  // Five more → count 11: winning the next lot completes the squad → reserve 0.
  for (const p of s.players.filter((x) => x.tierKey === 'emerald').slice(0, 5)) engine.assignPlayer(s, p.id, 't1', 500);
  sum = engine.teamSummary(s, 't1');
  assert.equal(sum.count, 11);
  assert.equal(sum.remaining, 8800 - 2500);
  assert.equal(sum.maxBid, sum.remaining);
});

test('the 400 reserve lets a team that spends its whole max bid on a Diamond still fill all 12', () => {
  const s = live();
  s.settings.timeoutEvery = 0; // no breaks in this walk-through
  open(s, playerByName(s, 'Hirak').id);
  engine.placeBid(s, 't1', 5600, 'admin', 1); // the most a fresh team may bid
  engine.sellLot(s, 2);
  assert.equal(engine.teamSummary(s, 't1').remaining, 4400); // = 400 × 11 open slots
  const emeralds = s.players.filter((p) => p.tierKey === 'emerald').slice(0, 11);
  for (const [i, p] of emeralds.entries()) {
    open(s, p.id);
    assert.equal(engine.teamSummary(s, 't1').maxBid, 400);
    engine.placeBid(s, 't1', undefined, 'admin', 10 + i); // base price, 400
    engine.sellLot(s, 10 + i);
  }
  const sum = engine.teamSummary(s, 't1');
  assert.equal(sum.count, 12);
  assert.equal(sum.full, true);
  assert.equal(sum.remaining, 0);
});

test('why the reserve is 400: at 200, the same Diamond splurge prices a team out of every Emerald', () => {
  const s = live();
  s.settings.reservePerSlot = 200;
  open(s, playerByName(s, 'Hirak').id);
  engine.placeBid(s, 't1', 7800, 'admin', 1); // 10000 − 200 × 11
  engine.sellLot(s, 2);
  open(s, playerByName(s, 'Kabya').id); // emerald, base 400
  const check = engine.checkBid(s, 't1', 400);
  assert.equal(check.ok, false);
  assert.match(check.reason!, /guardrail/i);
});

test('a full squad exits the auction', () => {
  const s = live();
  const pool = s.players.filter((p) => p.tierKey === 'new' || p.tierKey === 'emerald').slice(0, s.settings.maxSquad);
  assert.equal(pool.length, 12);
  for (const p of pool) engine.assignPlayer(s, p.id, 't1', 200);
  const sum = engine.teamSummary(s, 't1');
  assert.equal(sum.full, true);
  const hirak = playerByName(s, 'Hirak');
  open(s, hirak.id);
  const check = engine.checkBid(s, 't1', 1000);
  assert.equal(check.ok, false);
  assert.match(check.reason!, /full/i);
});

// ---- bidding rules -------------------------------------------------------------

test('leading bidder cannot raise against themselves', () => {
  const s = live();
  open(s, playerByName(s, 'Asif').id);
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  assert.equal(engine.checkBid(s, 't1', 700).ok, false);
  assert.equal(engine.checkBid(s, 't2', 700).ok, true);
});

test('bid below the minimum is rejected', () => {
  const s = live();
  open(s, playerByName(s, 'Asif').id); // gold, base 600
  assert.equal(engine.checkBid(s, 't1', 500).ok, false);
  engine.placeBid(s, 't1', 600, 'admin', 1);
  assert.equal(engine.checkBid(s, 't2', 650).ok, false); // min is 700
});

test('undoBid removes only the last bid', () => {
  const s = live();
  open(s, playerByName(s, 'Asif').id);
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  engine.placeBid(s, 't2', undefined, 'admin', 2);
  engine.undoBid(s);
  assert.equal(s.lot!.bids.length, 1);
  assert.equal(s.lot!.bids[0].teamId, 't1');
});

// ---- sell / pass / cancel -------------------------------------------------------

test('sellLot books the sale to the leading bidder and frees the lot', () => {
  const s = live();
  const asif = playerByName(s, 'Asif');
  open(s, asif.id);
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  engine.placeBid(s, 't2', undefined, 'admin', 2);
  const sale = engine.sellLot(s, 3);
  assert.equal(sale.teamId, 't2');
  assert.equal(sale.price, 700);
  assert.equal(asif.status, 'sold');
  assert.equal(asif.round, 'main');
  assert.equal(s.lot, null);
  assert.equal(engine.teamSummary(s, 't2').spent, 700);
});

test('selling with no bids fails; passing with bids fails', () => {
  const s = live();
  open(s, playerByName(s, 'Asif').id);
  assert.throws(() => engine.sellLot(s, 1), /no bids/i);
  engine.placeBid(s, 't1', undefined, 'admin', 1);
  assert.throws(() => engine.passLot(s), /standing bid/i);
});

test('passLot marks the player unsold', () => {
  const s = live();
  const asif = playerByName(s, 'Asif');
  open(s, asif.id);
  engine.passLot(s);
  assert.equal(asif.status, 'unsold');
  assert.equal(s.lot, null);
});

// ---- draw & tier progression ------------------------------------------------------

test('drawNext walks tiers in order: all diamonds before any gold', () => {
  const s = live();
  const diamonds = s.players.filter((p) => p.tierKey === 'diamond').length;
  assert.equal(diamonds, 2);
  for (let i = 0; i < diamonds; i++) {
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
  const a = playerByName(s, 'Jishnu');
  const b = playerByName(s, 'Chandan');
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

test('allotUnsold sends players to below-minimum teams first, even over a larger purse', () => {
  const s = live();
  s.settings.minSquad = 2;
  // t1 has spent heavily and is below the minimum; t2 meets it with plenty left.
  const gold = s.players.filter((p) => p.tierKey === 'gold');
  engine.assignPlayer(s, gold[0].id, 't1', 5000);
  engine.assignPlayer(s, gold[1].id, 't2', 600);
  engine.assignPlayer(s, gold[2].id, 't2', 600);
  const jishnu = playerByName(s, 'Jishnu');
  for (const p of s.players) if (p.status === 'available') p.status = 'sold';
  jishnu.status = 'unsold';
  jishnu.teamId = null;
  jishnu.price = null;
  const out = engine.allotUnsold(s);
  assert.equal(out.length, 1);
  assert.equal(out[0].teamId, 't1'); // 5000 left vs t2's 8800, but t1 is below the minimum
  assert.equal(out[0].price, 400);
  assert.equal(jishnu.round, 'allotted');
});

test('allotUnsold prefers the larger remaining purse among open teams', () => {
  const s = live();
  s.settings.minSquad = 0; // nobody is "below minimum" — pure purse comparison
  const gold = s.players.filter((p) => p.tierKey === 'gold');
  engine.assignPlayer(s, gold[0].id, 't1', 9000);
  engine.assignPlayer(s, gold[1].id, 't2', 100);
  const jishnu = playerByName(s, 'Jishnu');
  for (const p of s.players) if (p.status === 'available') p.status = 'sold';
  jishnu.status = 'unsold';
  jishnu.teamId = null;
  const out = engine.allotUnsold(s);
  assert.equal(out[0].teamId, 't2'); // 9900 left beats t1's 1000
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
  const unsoldNames = ['Jishnu', 'Chandan', 'Kabya'];
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
  engine.placeBid(s, 't1', undefined, 'admin', 91);
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

test('feasibility flags a pool that cannot fit team limits', () => {
  const s = fresh();
  // 24 players, 2 teams, squads of exactly 12 → [24, 24] contains 24 → no size warning.
  assert.equal(engine.feasibilityWarnings(s).filter((w) => w.includes('teams ×')).length, 0);
  // Squads of 13 → [26, 26]; 24 players is short.
  s.settings.minSquad = 13;
  s.settings.maxSquad = 13;
  assert.ok(engine.feasibilityWarnings(s).some((w) => w.includes('needs 26')));
  // Add 2 players → 26 → fits again.
  for (let i = 0; i < 2; i++) {
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
  open(s, playerByName(s, 'Hirak').id);
  assert.notEqual(s.lot!.id, staleLotId);
  assert.throws(() => engine.placeBid(s, 't2', undefined, 'team', 3, staleLotId), /too late/i);
  // Quoting the current lot id works.
  engine.placeBid(s, 't2', undefined, 'team', 4, s.lot!.id);
  assert.equal(s.lot!.bids.length, 1);
});

test('hammer guard rejects SOLD when a new bid landed after the auctioneer looked', () => {
  const s = live();
  open(s, playerByName(s, 'Asif').id);
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
  open(s, playerByName(s, 'Hirak').id);
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
  open(s, playerByName(s, 'Hirak').id);
  engine.placeBid(s, 't2', undefined, 'admin', 3);
  assert.throws(() => engine.undoBid(s, staleLotId), /too late/i);
  assert.equal(s.lot!.bids.length, 1); // t2's bid survived
  engine.undoBid(s, s.lot!.id); // scoped to the lot on screen — works
  assert.equal(s.lot!.bids.length, 0);
});

test('each opened lot gets a unique id', () => {
  const s = live();
  const ids = new Set<string>();
  for (const name of ['Kabya', 'Hirak']) {
    open(s, playerByName(s, name).id);
    ids.add(s.lot!.id);
    engine.cancelLot(s);
  }
  assert.equal(ids.size, 2);
});
