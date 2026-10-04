import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as engine from './engine';
import { applyDataMigrations, buildInitialState, factoryResetPreview } from './seed';
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

test('DTC 3 teams: Power Rangers (owner Angshumaan, capt. Ashish) and Underdogs (owner Ankur, capt. Saurav); captains are not in the pool', () => {
  const s = fresh();
  assert.deepEqual(
    s.teams.map((t) => [t.id, t.name, t.owner, t.captain]),
    [['t1', 'Power Rangers', 'Angshumaan', 'Ashish'], ['t2', 'Underdogs', 'Ankur', 'Saurav']],
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

test('DTC 3 stats: every season MVP score carries its #rank from the PDF, and only those do', () => {
  const s = fresh();
  for (const p of s.players) {
    const { mvpS1, mvpS2, mvpRankS1, mvpRankS2 } = p.stats;
    assert.equal(mvpRankS1 != null, mvpS1 != null, `${p.name}: DTC 1 rank iff DTC 1 score`);
    assert.equal(mvpRankS2 != null, mvpS2 != null, `${p.name}: DTC 2 rank iff DTC 2 score`);
  }
  const ranks = (name: string) => {
    const st = playerByName(s, name).stats;
    return [st.mvpRankS1 ?? null, st.mvpRankS2 ?? null];
  };
  assert.deepEqual(ranks('Hirak'), [2, 1]);
  assert.deepEqual(ranks('Padum'), [6, 2]);
  assert.deepEqual(ranks('Chandan'), [19, 10]);
  assert.deepEqual(ranks('Madhurjya'), [null, 13]);
  assert.deepEqual(ranks('Chinmoy Jr'), [15, null]);
  assert.deepEqual(ranks('Vishal'), [20, 24]);
  // Within one season, a higher MVP score never ranks lower.
  for (const [score, rank] of [['mvpS1', 'mvpRankS1'], ['mvpS2', 'mvpRankS2']] as const) {
    const played = s.players.filter((p) => p.stats[score] != null);
    for (const a of played) {
      for (const b of played) {
        if (a.stats[score]! > b.stats[score]!) assert.ok(a.stats[rank]! < b.stats[rank]!, `${a.name} above ${b.name} in ${score}`);
      }
    }
  }
});

test('DTC 3 hot list: the top 8 of the overall MVP ranking, in order', () => {
  const s = fresh();
  const hot = s.players.filter((p) => p.demandRank != null).sort((a, b) => a.demandRank! - b.demandRank!);
  assert.deepEqual(hot.map((p) => p.name), ['Hirak', 'Padum', 'Asif', 'Kaustav', 'Uddhab', 'Bhokto', 'Kabya', 'Jishnu']);
  assert.deepEqual(hot.map((p) => p.demandRank), [1, 2, 3, 4, 5, 6, 7, 8]);
  const byMvp = [...s.players].sort((a, b) => (b.stats.mvpTotal ?? -1) - (a.stats.mvpTotal ?? -1)).slice(0, 8);
  assert.deepEqual(byMvp.map((p) => p.name), hot.map((p) => p.name));
  assert.ok(s.players.every((p) => !p.sleeper), 'no sleepers — the PDF names none');
});

test('data migrations top up the live database (no ranks, no hot list, reserve 400) — once', () => {
  const s = fresh();
  // Shape of the live database: no ranks, no hot list, the old 400 reserve,
  // no migrations record.
  delete s.migrations;
  s.settings.reservePerSlot = 400;
  for (const p of s.players) {
    delete p.stats.mvpRankS1;
    delete p.stats.mvpRankS2;
    p.demandRank = null;
  }
  // A roster edit made since then must survive: Deep's slot now holds someone else.
  const deep = playerByName(s, 'Deep');
  deep.name = 'Somebody Else';
  assert.equal(applyDataMigrations(s), true);
  assert.equal(s.settings.reservePerSlot, 0, 'the max bid now follows the base prices still to come');
  const want = fresh();
  for (const p of s.players) {
    if (p.id === deep.id) {
      assert.equal(p.stats.mvpRankS1, undefined, 'a renamed player is left alone');
      continue;
    }
    const w = want.players.find((x) => x.id === p.id)!;
    assert.deepEqual(p.stats, w.stats, `${p.name} stats restored`);
    assert.equal(p.demandRank, w.demandRank, `${p.name} hot-list rank`);
  }
  // Applied once: clearing the hot list or going back to 400 afterwards sticks.
  for (const p of s.players) p.demandRank = null;
  s.settings.reservePerSlot = 400;
  assert.equal(applyDataMigrations(s), false);
  assert.ok(s.players.every((p) => p.demandRank === null));
  assert.equal(s.settings.reservePerSlot, 400);
  // A fresh seed needs no top-up.
  assert.equal(applyDataMigrations(fresh()), false);
});

test('data migrations keep a hot list the auctioneer already set', () => {
  const s = fresh();
  delete s.migrations;
  for (const p of s.players) p.demandRank = null;
  playerByName(s, 'Madhurjya').demandRank = 1;
  applyDataMigrations(s);
  assert.deepEqual(s.players.filter((p) => p.demandRank != null).map((p) => p.name), ['Madhurjya']);
});

test('the reserve moves to base prices (0) only from an untouched 400, with the 30,000 purse', () => {
  const run = (purse: number, reservePerSlot: number, migrations: string[] = []) => {
    const s = fresh();
    s.migrations = migrations;
    Object.assign(s.settings, { purse, reservePerSlot });
    applyDataMigrations(s);
    return s.settings.reservePerSlot;
  };
  assert.equal(run(30000, 400), 0, 'the live site today');
  assert.equal(run(30000, 1000, ['dtc3-reserve-1000']), 0, 'a test copy the never-deployed 1,000 step had touched');
  assert.equal(run(30000, 1000), 1000, 'a 1,000 the auctioneer chose is kept');
  assert.equal(run(30000, 600), 600, 'a reserve the auctioneer chose is kept');
  assert.equal(run(10000, 400), 400, 'not the old 10,000-purse setup');
});

test('the step above 3,000 drops from +500 to +250 only on the untouched ladder, before the auction starts', () => {
  const run = (ladder: { upTo: number | null; step: number }[], stage: 'setup' | 'live' = 'setup') => {
    const s = fresh();
    s.migrations = s.migrations!.filter((id) => id !== 'dtc3-step-250-above-3000');
    s.settings.increments = ladder;
    s.stage = stage;
    applyDataMigrations(s);
    return s.settings.increments.map((r) => r.step);
  };
  const old = () => [{ upTo: 1000, step: 100 }, { upTo: 3000, step: 200 }, { upTo: null, step: 500 }];
  assert.deepEqual(run(old()), [100, 200, 250], 'the live site today');
  assert.deepEqual(run(old(), 'live'), [100, 200, 500], 'never mid-auction');
  assert.deepEqual(run([{ upTo: 1000, step: 100 }, { upTo: null, step: 500 }]), [100, 500], 'an edited ladder is kept');
});

test('factory-reset preview: a fresh seed loses nothing beyond the codes', () => {
  const p = factoryResetPreview(fresh());
  assert.deepEqual(p, {
    stage: 'setup', sold: 0, unsold: 0, watchlistEntries: 0,
    photosUnlinked: [], playersAdded: [], playersRemoved: [], playersEdited: [], teamsChanged: [], settingsChanged: [],
  });
});

test('factory-reset preview lists every result, upload, edit and setting the reset throws away', () => {
  const s = fresh();
  s.stage = 'live';
  Object.assign(playerByName(s, 'Hirak'), { status: 'sold', teamId: 't1', price: 4000 });
  playerByName(s, 'Deep').status = 'unsold';
  playerByName(s, 'Padum').photoPath = 'players/dtc3-p2/123.jpg'; // uploaded after the seed (the seed has none)
  playerByName(s, 'Udit').role = 'Batter';
  s.players = s.players.filter((p) => p.name !== 'Yatrick');
  s.players.push({ ...playerByName(s, 'Ronny'), id: 'p-new', name: 'Guest' });
  s.teams[1].owner = 'Someone';
  s.settings.purse = 25000;
  s.settings.increments[2].step = 500;
  s.watchlists = { t1: { 'dtc3-p1': { starred: true, targetPrice: 5000, note: '' } as any } };
  const p = factoryResetPreview(s);
  assert.equal(p.stage, 'live');
  assert.equal(p.sold, 1);
  assert.equal(p.unsold, 1);
  assert.deepEqual(p.photosUnlinked, ['Padum']);
  assert.deepEqual(p.playersEdited, ['Udit']);
  assert.deepEqual(p.playersRemoved, ['Yatrick']);
  assert.deepEqual(p.playersAdded, ['Guest']);
  assert.deepEqual(p.teamsChanged, ['Underdogs goes back to Underdogs (owner Ankur, capt. Saurav)']);
  assert.deepEqual(p.settingsChanged, [
    'Purse per team: 25,000 → 30,000',
    'Bid increments: +100 to 1,000 · +200 to 3,000 · +500 above → +100 to 1,000 · +200 to 3,000 · +250 above',
  ]);
  assert.equal(p.watchlistEntries, 1);
});

test('data migrations add the team owners to the live teams, once, leaving edited teams alone', () => {
  const s = fresh();
  s.migrations = s.migrations!.filter((id) => id !== 'dtc3-team-owners');
  for (const t of s.teams) delete t.owner; // the live teams predate the owner field
  s.teams[1].name = 'Renamed';
  assert.equal(applyDataMigrations(s), true);
  assert.deepEqual(s.teams.map((t) => t.owner), ['Angshumaan', undefined]);
  // An owner typed in afterwards is never overwritten.
  s.teams[0].owner = 'Someone';
  s.migrations = s.migrations!.filter((id) => id !== 'dtc3-team-owners');
  applyDataMigrations(s);
  assert.equal(s.teams[0].owner, 'Someone');
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

test('increment ladder matches the auction plan (+100 to 1000, +200 to 3000, +250 above)', () => {
  const s = fresh();
  assert.equal(engine.stepFor(s.settings, 200), 100);
  assert.equal(engine.stepFor(s.settings, 999), 100);
  assert.equal(engine.stepFor(s.settings, 1000), 200);
  assert.equal(engine.stepFor(s.settings, 2999), 200);
  assert.equal(engine.stepFor(s.settings, 3000), 250);
  assert.equal(engine.stepFor(s.settings, 9000), 250);
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
  assert.equal(engine.nextMinBid(s), 3250); // 3000 + 250
  engine.placeBid(s, 't1', undefined, 'admin', 3);
  assert.equal(engine.nextMinBid(s), 3500); // 3250 + 250
});

// ---- purse guardrail ----------------------------------------------------------

test('DTC 3 purse is 30,000 per team', () => {
  const s = fresh();
  assert.equal(s.settings.purse, 30000);
  for (const t of s.teams) assert.equal(engine.teamSummary(s, t.id).remaining, 30000);
});

test('fresh team max bid keeps back the base prices of the 11 priciest other players: 30000 − 5800 = 24200', () => {
  const s = fresh();
  assert.equal(s.settings.reservePerSlot, 0, 'the organisers chose the base-price rule');
  const sum = engine.teamSummary(s, 't1');
  // Padum 1000 + four Golds 4 × 600 + six Emeralds 6 × 400, as if Hirak were on the block.
  assert.equal(sum.reserve, 1000 + 4 * 600 + 6 * 400);
  assert.equal(sum.maxBid, 24200);
  assert.equal(sum.remaining, 30000);
  assert.equal(sum.count, 0);
});

test('the max bid follows the base prices still left as the auction goes on', () => {
  // The numbers given to the organisers: Power Rangers win Hirak for 15,000,
  // two Golds, then five Emeralds; the reserve shrinks as categories sell out.
  const s = live();
  s.settings.timeoutEvery = 0;
  let now = 1;
  const sale = (name: string, team: string, price: number) => {
    open(s, playerByName(s, name).id);
    engine.placeBid(s, team, price, 'admin', now++);
    engine.sellLot(s, now++);
  };
  const t1 = () => engine.teamSummary(s, 't1');
  open(s, playerByName(s, 'Hirak').id);
  assert.deepEqual([t1().remaining, t1().reserve, t1().maxBid], [30000, 5800, 24200]);
  engine.placeBid(s, 't1', 15000, 'admin', now++);
  engine.sellLot(s, now++);
  open(s, playerByName(s, 'Padum').id);
  assert.deepEqual([t1().remaining, t1().reserve, t1().maxBid], [15000, 4 * 600 + 6 * 400, 10200]);
  engine.placeBid(s, 't2', 9000, 'admin', now++);
  engine.sellLot(s, now++);
  sale('Asif', 't1', 2000);
  sale('Kaustav', 't2', 1800);
  sale('Uddhab', 't1', 1500);
  sale('Bhokto', 't2', 1200);
  open(s, playerByName(s, 'Kabya').id); // Diamonds and Golds gone: only Emerald money is kept
  assert.deepEqual([t1().remaining, t1().reserve, t1().maxBid], [11500, 8 * 400, 8300]);
  engine.cancelLot(s);
  for (const [i, p] of s.players.filter((x) => x.tierKey === 'emerald').entries()) sale(p.name, i < 5 ? 't1' : 't2', 500);
  open(s, playerByName(s, 'Udit').id); // only New Players left: 200 a player
  assert.deepEqual([t1().remaining, t1().reserve, t1().maxBid], [9000, 3 * 200, 8400]);
});

test('a reserve per slot of 1,000 makes it flat: every max bid is points left − 1,000 × players still needed after this one', () => {
  const s = live();
  s.settings.timeoutEvery = 0;
  s.settings.reservePerSlot = 1000;
  assert.equal(engine.teamSummary(s, 't1').maxBid, 19000);
  let now = 1;
  // Power Rangers buy at prices that leave odd remainders; Underdogs never bid.
  for (const [name, price] of [['Hirak', 12500], ['Padum', 3100], ['Asif', 1700], ['Kabya', 900]] as const) {
    open(s, playerByName(s, name).id);
    const before = engine.teamSummary(s, 't1');
    assert.equal(before.maxBid, before.remaining - 1000 * (12 - before.count - 1), `max bid on ${name}`);
    engine.placeBid(s, 't1', price, 'admin', now++);
    engine.sellLot(s, now++);
  }
  const sum = engine.teamSummary(s, 't1');
  assert.equal(sum.remaining, 30000 - 12500 - 3100 - 1700 - 900);
  assert.equal(sum.count, 4);
  // No base price tops 1,000, so the floor alone sets the reserve.
  assert.equal(sum.reserve, 7 * 1000);
});

test('guardrail blocks a bid that would strand the minimum squad', () => {
  const s = live();
  const hirak = playerByName(s, 'Hirak');
  open(s, hirak.id);
  const check = engine.checkBid(s, 't1', 24300);
  assert.equal(check.ok, false);
  assert.match(check.reason!, /guardrail/i);
  assert.match(check.reason!, /30000 remaining − 5800 kept back for the 11 more players the team still needs/);
  assert.equal(engine.checkBid(s, 't1', 24200).ok, true);
});

test('the max bid shown between lots is the max bid on the next player drawn', () => {
  const s = live();
  s.settings.timeoutEvery = 0;
  const between = engine.teamSummary(s, 't1').maxBid;
  open(s, playerByName(s, 'Padum').id);
  assert.equal(engine.teamSummary(s, 't1').maxBid, between);
  engine.placeBid(s, 't2', 9000, 'admin', 1);
  engine.sellLot(s, 2);
  // Next up is Hirak, the last Diamond: the reserve now prices the Golds and Emeralds.
  const t1Between = engine.teamSummary(s, 't1').maxBid;
  const t2Between = engine.teamSummary(s, 't2').maxBid;
  assert.equal(t1Between, 30000 - (4 * 600 + 7 * 400));
  assert.equal(t2Between, 21000 - (4 * 600 + 6 * 400));
  open(s, playerByName(s, 'Hirak').id);
  assert.equal(engine.teamSummary(s, 't1').maxBid, t1Between);
  assert.equal(engine.teamSummary(s, 't2').maxBid, t2Between);
});

test('guardrail relaxes as the squad fills and the stars are sold', () => {
  const s = live();
  // Give t1 six players at base price via manual assignment (uses "manual" round).
  const newPlayers = s.players.filter((p) => p.tierKey === 'new');
  assert.equal(newPlayers.length, 6);
  for (const p of newPlayers) engine.assignPlayer(s, p.id, 't1', 200);
  let sum = engine.teamSummary(s, 't1');
  assert.equal(sum.count, 6);
  assert.equal(sum.remaining, 30000 - 1200);
  // Five more slots after the next buy: Padum + four Golds are the priciest left.
  assert.equal(sum.reserve, 1000 + 4 * 600);
  assert.equal(sum.maxBid, 28800 - 3400);
  // The stars go to t2; now t1's five slots only need Emerald money.
  for (const name of ['Hirak', 'Padum', 'Asif', 'Kaustav', 'Uddhab', 'Bhokto']) {
    engine.assignPlayer(s, playerByName(s, name).id, 't2', 1000);
  }
  sum = engine.teamSummary(s, 't1');
  assert.equal(sum.reserve, 5 * 400);
  // Five more → count 11: winning the next lot completes the squad → reserve 0.
  for (const p of s.players.filter((x) => x.tierKey === 'emerald').slice(0, 5)) engine.assignPlayer(s, p.id, 't1', 500);
  sum = engine.teamSummary(s, 't1');
  assert.equal(sum.count, 11);
  assert.equal(sum.remaining, 28800 - 2500);
  assert.equal(sum.reserve, 0);
  assert.equal(sum.maxBid, sum.remaining);
});

test('a team that spends its whole max on Hirak can still open every later lot, even when the rival lets every star go unsold', () => {
  // The old flat 400-a-slot reserve allowed 25,600 here; Power Rangers then
  // could not afford to open Padum or any Gold, finished on 11 players with
  // 400 left, and auto-allotment failed on Asif (base 600).
  const s = live();
  s.settings.timeoutEvery = 0;
  let now = 1;
  const lot = (name: string, bids: [string, number?][]) => {
    open(s, playerByName(s, name).id);
    for (const [team, amount] of bids) engine.placeBid(s, team, amount, 'admin', now++);
    if (s.lot!.bids.length) engine.sellLot(s, now++);
    else engine.passLot(s, undefined, now++);
  };
  lot('Hirak', [['t2', 23500], ['t1', 24200]]);
  assert.equal(engine.teamSummary(s, 't1').remaining, 5800);
  for (const name of ['Padum', 'Asif', 'Kaustav', 'Uddhab', 'Bhokto']) {
    open(s, playerByName(s, name).id);
    assert.equal(engine.checkBid(s, 't1', engine.nextMinBid(s)).ok, true, `Power Rangers can open ${name} at base`);
    engine.passLot(s, undefined, now++); // Underdogs let the star go unsold
  }
  // Underdogs outbid Power Rangers on all twelve Emeralds and fill up; Power Rangers take the New Players.
  for (const p of s.players.filter((x) => x.tierKey === 'emerald')) lot(p.name, [['t1'], ['t2', 500]]);
  assert.equal(engine.teamSummary(s, 't2').full, true);
  for (const p of s.players.filter((x) => x.tierKey === 'new')) lot(p.name, [['t1']]);
  engine.startAccelerated(s);
  for (let p = engine.drawNext(s); p; p = engine.drawNext(s)) lot(p.name, [['t1']]);
  engine.completeAuction(s);
  const sum = engine.teamSummary(s, 't1');
  assert.equal(sum.count, 12);
  assert.ok(sum.remaining >= 0);
});

test('with a flat 1,000 reserve, even a 19,000 splurge leaves 1,000 for every slot — enough to open anyone', () => {
  const s = live();
  s.settings.timeoutEvery = 0;
  s.settings.reservePerSlot = 1000;
  open(s, playerByName(s, 'Hirak').id);
  engine.placeBid(s, 't2', 18500, 'admin', 1);
  engine.placeBid(s, 't1', 19000, 'admin', 2);
  assert.equal(engine.checkBid(s, 't2', 19500).ok, false, 'nobody can go past 19,000');
  engine.sellLot(s, 3);
  assert.equal(engine.teamSummary(s, 't1').remaining, 11 * 1000);
  for (const p of s.players.filter((x) => x.status === 'available')) {
    open(s, p.id);
    assert.equal(engine.checkBid(s, 't1', engine.nextMinBid(s)).ok, true, `Power Rangers can open ${p.name}`);
    engine.cancelLot(s);
  }
});

test('the reserve floor is a spending cap, not the safety net', () => {
  // With no floor at all (the default), a splurge cannot price a team out of
  // the players still to come — the reserve follows their real base prices.
  const s = live();
  assert.equal(s.settings.reservePerSlot, 0);
  open(s, playerByName(s, 'Hirak').id);
  engine.placeBid(s, 't1', 24200, 'admin', 1);
  engine.sellLot(s, 2);
  open(s, playerByName(s, 'Padum').id);
  assert.equal(engine.checkBid(s, 't1', 1000).ok, true);
  engine.cancelLot(s);
  // A higher floor limits how much of the purse a single player can take.
  const capped = live();
  capped.settings.reservePerSlot = 1000;
  assert.equal(engine.teamSummary(capped, 't1').maxBid, 30000 - 11 * 1000);
});

test('random auctions never strand a team: every squad completes without force', () => {
  // A seeded fuzz of the guardrail — jump bids up to each team's max, walk-aways,
  // a rival that refuses every star — across purses and reserve floors.
  let seed = 20261011;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  for (let run = 0; run < 400; run++) {
    const s = fresh();
    s.settings.purse = [15000, 20000, 30000, 40000][run % 4];
    s.settings.reservePerSlot = [0, 200, 400, 600, 1000][Math.floor(run / 4) % 5];
    s.settings.timeoutEvery = 0;
    const shy = { t1: rnd() * 0.8, t2: rnd() * 0.8 };
    const starve = { t1: rnd() < 0.3, t2: rnd() < 0.3 };
    let now = 1;
    const runLot = (playerId: string) => {
      open(s, playerId);
      const player = engine.getPlayer(s, playerId);
      for (const t of ['t1', 't2']) {
        if (engine.teamSummary(s, t).count < s.settings.minSquad) {
          assert.ok(engine.checkBid(s, t, engine.nextMinBid(s)).ok, `run ${run}: ${t} can open ${player.name}`);
        }
      }
      for (let g = 0; g < 200; g++) {
        const leader = s.lot!.bids.at(-1)?.teamId;
        const t = leader === 't1' ? 't2' : leader === 't2' ? 't1' : rnd() < 0.5 ? 't1' : 't2';
        if ((starve[t] && (player.tierKey === 'diamond' || player.tierKey === 'gold')) || rnd() < shy[t]) break;
        const sum = engine.teamSummary(s, t);
        const min = engine.nextMinBid(s);
        if (sum.full || min > sum.maxBid) break;
        engine.placeBid(s, t, Math.round(min + (sum.maxBid - min) * rnd() ** 3), 'team', now++);
      }
      if (s.lot!.bids.length) engine.sellLot(s, now++);
      else engine.passLot(s, undefined, now++);
    };
    engine.startAuction(s);
    for (let p = engine.drawNext(s); p; p = engine.drawNext(s)) runLot(p.id);
    for (let pass = 0; pass < 2 && engine.unsoldCount(s) > 0; pass++) {
      engine.startAccelerated(s);
      for (let p = engine.drawNext(s); p; p = engine.drawNext(s)) runLot(p.id);
    }
    if (engine.unsoldCount(s) > 0) engine.allotUnsold(s);
    engine.completeAuction(s); // throws if anyone is short or unsold
    for (const t of s.teams) {
      const sum = engine.teamSummary(s, t.id);
      assert.equal(sum.count, 12);
      assert.ok(sum.remaining >= 0, `run ${run}: ${t.name} overspent`);
    }
  }
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
  assert.equal(out[0].teamId, 't1'); // 25000 left vs t2's 28800, but t1 is below the minimum
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
  assert.equal(out[0].teamId, 't2'); // 29900 left beats t1's 21000
});

// ---- manual assignment & release ------------------------------------------------------

test('assignPlayer blocks overspending and full squads', () => {
  const s = live();
  const kabya = playerByName(s, 'Kabya');
  assert.throws(() => engine.assignPlayer(s, kabya.id, 't1', 30001), /remaining purse/i);
  engine.assignPlayer(s, kabya.id, 't1', 30000);
  assert.equal(engine.teamSummary(s, 't1').remaining, 0);
});

test('releasePlayer refunds the purse', () => {
  const s = live();
  const kabya = playerByName(s, 'Kabya');
  engine.assignPlayer(s, kabya.id, 't1', 3000);
  engine.releasePlayer(s, kabya.id);
  assert.equal(kabya.status, 'available');
  assert.equal(engine.teamSummary(s, 't1').remaining, 30000);
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

test('feasibility warns when an override leaves a team below the purse guardrail', () => {
  const s = live();
  assert.deepEqual(engine.feasibilityWarnings(s), []);
  // The auctioneer's manual assignment bypasses the bid guardrail.
  engine.assignPlayer(s, playerByName(s, 'Hirak').id, 't1', 28000);
  const warning = engine.feasibilityWarnings(s).find((w) => w.startsWith('Power Rangers'));
  assert.ok(warning, 'Power Rangers are flagged');
  // 11 slots still to fill at the priciest base prices left:
  // Padum 1000 + four Golds 2400 + six Emeralds 2400.
  assert.match(warning!, /2000 pts left but the purse guardrail needs 5800 for its last 11 slots/);
  engine.releasePlayer(s, playerByName(s, 'Hirak').id);
  assert.deepEqual(engine.feasibilityWarnings(s), []);
  // With a flat 1,000 reserve the same override is flagged sooner.
  s.settings.reservePerSlot = 1000;
  engine.assignPlayer(s, playerByName(s, 'Hirak').id, 't1', 20000);
  assert.ok(engine.feasibilityWarnings(s).some((w) => /10000 pts left but the purse guardrail needs 11000 for its last 11 slots/.test(w)));
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
