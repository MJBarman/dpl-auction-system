import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AlreadyGuessed, Audience, audienceDevice, audienceTag, cleanName, GUESS_WINDOW_MS, REACTIONS } from './audience';
import { Store } from './db';
import * as engine from './engine';
import { buildInitialState, ensureTimeoutFields, repairState } from './seed';
import { publicState, statePayloadFor } from './views';
import { State } from './types';

const T0 = 1_800_000_000_000;

/** A live auction of 20 with the first player on the block (opened at T0). */
function liveLot(): { s: State; lotId: string; playerId: string } {
  const s = buildInitialState();
  s.players = s.players.slice(0, 20);
  engine.startAuction(s);
  engine.openLot(s, s.players[0].id, T0);
  return { s, lotId: s.lot!.id, playerId: s.players[0].id };
}

// ---- the play-by-play needs to know when each hammer fell ----------------------------

test('a sale records when the hammer fell and after how many bids; undo takes both back', () => {
  const { s } = liveLot();
  const snap = engine.takeSnapshot(s, 'Undo: sale', T0 + 1);
  engine.placeBid(s, 't1', undefined, 'admin', T0 + 2);
  engine.placeBid(s, 't2', undefined, 'admin', T0 + 3);
  engine.placeBid(s, 't1', undefined, 'admin', T0 + 4);
  const { player } = engine.sellLot(s, T0 + 5000);
  assert.equal(player.hammerAt, T0 + 5000);
  assert.equal(player.bidCount, 3);
  engine.restoreSnapshot(s, snap);
  assert.equal(player.status, 'available');
  assert.equal(player.hammerAt, null);
  assert.equal(player.bidCount, null);
});

test('unsold, allotted and assigned players get a hammer time too; release and reset clear it', () => {
  const { s } = liveLot();
  const [a, b, c] = s.players;
  engine.passLot(s, undefined, T0 + 100);
  assert.deepEqual([a.status, a.hammerAt, a.bidCount], ['unsold', T0 + 100, 0]);
  engine.assignPlayer(s, b.id, 't1', 500, T0 + 200);
  assert.deepEqual([b.hammerAt, b.bidCount], [T0 + 200, null]);
  s.timeout = null;
  const allotted = engine.allotUnsold(s, T0 + 300);
  assert.equal(allotted.length, 1);
  assert.deepEqual([a.status, a.round, a.hammerAt, a.bidCount], ['sold', 'allotted', T0 + 300, null]);
  engine.releasePlayer(s, b.id);
  assert.deepEqual([b.status, b.hammerAt, b.bidCount], ['available', null, null]);
  engine.resetAuction(s);
  assert.ok(s.players.every((p) => p.hammerAt === null && p.bidCount === null));
  assert.equal(c.status, 'available');
});

test('an undo snapshot from before these fields existed leaves the hammer times alone', () => {
  const { s } = liveLot();
  engine.placeBid(s, 't1', undefined, 'admin', T0 + 1);
  engine.sellLot(s, T0 + 2);
  const old = engine.takeSnapshot(s, 'old', T0 + 3);
  for (const p of old.players) {
    delete (p as { hammerAt?: unknown }).hammerAt;
    delete (p as { bidCount?: unknown }).bidCount;
  }
  delete old.guessResult;
  s.guessResult = { lotId: 'x', playerId: s.players[0].id, price: 200, total: 0, top: [] };
  engine.restoreSnapshot(s, old);
  assert.equal(s.players[0].hammerAt, T0 + 2);
  assert.equal(s.players[0].bidCount, 1);
  assert.ok(s.guessResult, 'and the last guess result');
});

// ---- guesses ------------------------------------------------------------------------------

test('a phone gets one guess per player, inside the first 30 seconds, between base price and the purse', () => {
  const { s, lotId } = liveLot();
  const a = new Audience(undefined);
  assert.deepEqual(a.guess(s, 'tag-1', 'Rahul', 1200, lotId, T0 + 1000), { amount: 1200, closesAt: T0 + GUESS_WINDOW_MS, fromAddress: 0 });
  assert.equal(a.count(lotId), 1);
  assert.throws(() => a.guess(s, 'tag-1', 'Rahul', 1400, lotId, T0 + 2000), /already guessed 1200/);
  assert.throws(() => a.guess(s, 'tag-2', 'Priya', 150, lotId, T0 + 2000), /between 200 and 30000/, 'below base');
  assert.throws(() => a.guess(s, 'tag-2', 'Priya', 30050, lotId, T0 + 2000), /between 200 and 30000/, 'above the purse');
  assert.throws(() => a.guess(s, 'tag-2', 'Priya', 1200.5, lotId, T0 + 2000), /whole number between 200 and 30000/);
  assert.throws(() => a.guess(s, 'tag-2', 'Priya', Number.NaN, lotId, T0 + 2000), /whole number/);
  assert.equal(a.guess(s, 'tag-odd', 'Odd', 1225, lotId, T0 + 2000).amount, 1225, 'any whole number in range counts, whatever the bid steps are');
  assert.throws(() => a.guess(s, 'tag-2', 'Priya', 1200, 'another-lot', T0 + 2000), /no longer up/);
  assert.equal(a.guess(s, 'tag-2', 'Priya', 1200, lotId, T0 + GUESS_WINDOW_MS).amount, 1200, 'the last instant still counts');
  assert.throws(() => a.guess(s, 'tag-3', 'Deep', 1200, lotId, T0 + GUESS_WINDOW_MS + 1), /Guessing has closed/);
  assert.equal(a.count(lotId), 3);
  assert.equal(a.count('another-lot'), 0);
});

test('no guesses with the game switched off, or with nobody on the block', () => {
  const { s, lotId } = liveLot();
  const a = new Audience(undefined);
  s.settings.audienceGame = false;
  assert.throws(() => a.guess(s, 'tag-1', 'Rahul', 1200, lotId, T0 + 1), /switched off/);
  s.settings.audienceGame = true;
  engine.passLot(s, undefined, T0 + 2);
  assert.throws(() => a.guess(s, 'tag-1', 'Rahul', 1200, lotId, T0 + 3), /no longer up/);
});

test('a new player starts with no guesses; the last few players keep theirs, for undo', () => {
  const { s, lotId } = liveLot();
  const a = new Audience(undefined);
  a.guess(s, 'tag-1', 'Rahul', 1200, lotId, T0 + 1);
  a.sync(s.lot);
  assert.equal(a.count(lotId), 1);
  engine.passLot(s, undefined, T0 + 2);
  a.sync(null);
  assert.equal(a.count(lotId), 1);
  const ids = [lotId];
  for (let i = 1; i <= 4; i++) {
    engine.openLot(s, s.players[i].id, T0 + 10 * i);
    a.sync(s.lot);
    ids.push(s.lot!.id);
    assert.equal(a.count(s.lot!.id), 0, 'a new player starts empty');
    a.guess(s, 'tag-1', 'Rahul', 1200, s.lot!.id, T0 + 10 * i + 1);
    assert.equal(a.count(ids[i - 1]), i === 4 ? 1 : 1, 'the player before keeps his');
    if (i < 4) engine.passLot(s, undefined, T0 + 10 * i + 2);
  }
  assert.deepEqual(ids.map((id) => a.count(id)), [0, 1, 1, 1, 1], 'four players are kept; the fifth back is let go');
});

test('an undo two steps back still finds the guesses: sell, draw the next, undo, undo, sell again', () => {
  const { s, lotId, playerId } = liveLot();
  const a = new Audience(undefined);
  a.guess(s, 't1', 'One', 1600, lotId, T0 + 1);
  a.guess(s, 't2', 'Two', 1000, lotId, T0 + 2);
  const beforeSale = engine.takeSnapshot(s, 'Undo: sale', T0 + 3);
  engine.placeBid(s, 't1', undefined, 'admin', T0 + 4);
  engine.sellLot(s, T0 + 5);
  a.settle(lotId, playerId, 1000);
  const beforeDraw = engine.takeSnapshot(s, 'Undo: player draw', T0 + 6);
  engine.openLot(s, s.players[1].id, T0 + 7);
  a.sync(s.lot);
  a.guess(s, 't1', 'One', 400, s.lot!.id, T0 + 8);
  engine.restoreSnapshot(s, beforeDraw); // the draw is undone: nobody on the block
  engine.restoreSnapshot(s, beforeSale); // the sale is undone: the first player is back
  a.unsettle(s.lot!.id);
  assert.equal(s.lot!.id, lotId);
  assert.deepEqual(a.board(5, true), []);
  assert.equal(a.count(lotId), 2, 'his guesses are still here');
  assert.throws(() => a.guess(s, 't1', 'One', 1800, lotId, T0 + 9), AlreadyGuessed, 'and the phones are still held to them');
  const again = a.settle(lotId, playerId, 1600);
  assert.equal(again.total, 2);
  assert.deepEqual(a.board(5, true).map((b) => [b.name, b.points]), [['One', 3], ['Two', 2]]);
});

test('an earlier player keeps at most his first 1,000 guesses', () => {
  const { s, lotId } = liveLot();
  const a = new Audience(undefined);
  for (let i = 0; i < 1100; i++) a.guess(s, `tag-${i}`, 'Crowd', 1200, lotId, T0 + 1);
  assert.equal(a.count(lotId), 1100);
  engine.passLot(s, undefined, T0 + 2);
  engine.openLot(s, s.players[1].id, T0 + 3);
  a.sync(s.lot);
  assert.equal(a.count(lotId), 1000);
  assert.throws(() => a.guess(s, 'tag-0', 'Crowd', 400, lotId, T0 + 4), /no longer up/);
});

test('a player sold twice (released, auctioned again) is scored once', () => {
  const { s, lotId, playerId } = liveLot();
  const a = new Audience(undefined);
  a.guess(s, 't1', 'One', 1600, lotId, T0 + 1);
  a.settle(lotId, playerId, 1600);
  engine.placeBid(s, 't1', undefined, 'admin', T0 + 2);
  engine.sellLot(s, T0 + 3);
  engine.releasePlayer(s, playerId);
  assert.deepEqual(a.board(5, true).map((b) => [b.name, b.points]), [['One', 3]], 'the first hammer\'s points stand until he is sold again');
  engine.openLot(s, playerId, T0 + 10);
  a.sync(s.lot);
  a.guess(s, 't2', 'Two', 1000, s.lot!.id, T0 + 11);
  a.settle(s.lot!.id, playerId, 1000);
  assert.deepEqual(a.board(5, true).map((b) => [b.name, b.points]), [['Two', 3]], 'the new sale replaces the old one');
});

test('one network address can send only so many guesses for one player', () => {
  const { s, lotId } = liveLot();
  const a = new Audience(undefined);
  const home = { address: '10.0.0.5', limit: 2 };
  assert.equal(a.guess(s, 't1', 'One', 1200, lotId, T0 + 1, home).fromAddress, 1);
  assert.equal(a.guess(s, 't2', 'Two', 1200, lotId, T0 + 2, home).fromAddress, 2);
  assert.throws(() => a.guess(s, 't3', 'Three', 1200, lotId, T0 + 3, home), /Too many guesses from this network/);
  assert.equal(a.count(lotId), 2, 'the refused one was not kept');
  assert.equal(a.guess(s, 't3', 'Three', 1200, lotId, T0 + 4, { address: '10.0.0.6', limit: 2 }).fromAddress, 1, 'another address is not affected');
  assert.throws(() => a.guess(s, 't1', 'One', 1400, lotId, T0 + 5, home), AlreadyGuessed, 'a repeat is "already guessed", not "too many"');
  assert.equal(a.guess(s, 't4', 'Four', 1200, lotId, T0 + 6).fromAddress, 0, 'with no address given there is no cap');
  engine.passLot(s, undefined, T0 + 7);
  engine.openLot(s, s.players[1].id, T0 + 8);
  assert.equal(a.guess(s, 't1', 'One', 400, s.lot!.id, T0 + 9, home).fromAddress, 1, 'the count starts again with the next player');
});

test('a second guess from the same phone says what it guessed the first time', () => {
  const { s, lotId } = liveLot();
  const a = new Audience(undefined);
  a.guess(s, 't1', 'One', 1450, lotId, T0 + 1);
  try {
    a.guess(s, 't1', 'One', 1600, lotId, T0 + 2);
    assert.fail('should have refused');
  } catch (err) {
    assert.ok(err instanceof AlreadyGuessed);
    assert.equal(err.amount, 1450);
    assert.equal(err.status, 409);
    assert.match(err.message, /already guessed 1450/);
  }
});

test('the closest three score 3, 2 and 1; a tie goes to the earlier guess', () => {
  const { s, lotId, playerId } = liveLot();
  const a = new Audience(undefined);
  a.guess(s, 'far', 'Far', 5000, lotId, T0 + 1);
  a.guess(s, 'late-200', 'Late', 1400, lotId, T0 + 9);     // 200 off, guessed later
  a.guess(s, 'early-200', 'Early', 1800, lotId, T0 + 2);   // 200 off, guessed first
  a.guess(s, 'exact', 'Exact', 1600, lotId, T0 + 20);
  a.guess(s, 'fifth', 'Fifth', 2600, lotId, T0 + 3);
  const r = a.settle(lotId, playerId, 1600);
  assert.equal(r.total, 5);
  assert.deepEqual(r.top.map((g) => [g.name, g.amount, g.off]), [['Exact', 1600, 0], ['Early', 1800, 200], ['Late', 1400, 200]]);
  assert.deepEqual(a.board(5, true).map((b) => [b.name, b.points, b.wins]), [['Exact', 3, 1], ['Early', 2, 0], ['Late', 1, 0]]);
  assert.deepEqual(a.board(5, false).map((b) => b.name), [null, null, null], 'names hidden when the organiser turns them off');
  assert.equal(a.board(2, true).length, 2);
});

test('undoing a sale takes its points back, and selling again never counts twice', () => {
  const { s, lotId, playerId } = liveLot();
  const a = new Audience(undefined);
  a.guess(s, 't1', 'One', 1600, lotId, T0 + 1);
  a.guess(s, 't2', 'Two', 1000, lotId, T0 + 2);
  a.settle(lotId, playerId, 1600);
  assert.deepEqual(a.board(5, true).map((b) => [b.name, b.points]), [['One', 3], ['Two', 2]]);
  a.unsettle(lotId);
  assert.deepEqual(a.board(5, true), []);
  a.settle(lotId, playerId, 1000); // sold again, at another price
  a.settle(lotId, playerId, 1000); // and a retried request
  assert.deepEqual(a.board(5, true).map((b) => [b.name, b.points, b.wins]), [['Two', 3, 1], ['One', 2, 0]]);
});

test('points add up across players; a sale nobody guessed on scores nothing', () => {
  const { s, lotId, playerId } = liveLot();
  const a = new Audience(undefined);
  a.guess(s, 't1', 'One', 1600, lotId, T0 + 1);
  a.settle(lotId, playerId, 1600);
  engine.placeBid(s, 't1', undefined, 'admin', T0 + 2);
  engine.sellLot(s, T0 + 3);
  engine.openLot(s, s.players[1].id, T0 + 10);
  a.sync(s.lot);
  const second = s.lot!.id;
  a.guess(s, 't1', 'One', 400, second, T0 + 11);
  a.guess(s, 't2', 'Two', 200, second, T0 + 12);
  a.settle(second, s.players[1].id, 200);
  assert.deepEqual(a.board(5, true).map((b) => [b.name, b.points, b.wins]), [['One', 5, 1], ['Two', 3, 1]]);
  const empty = a.settle('lot-nobody-guessed', 'p', 500);
  assert.deepEqual([empty.total, empty.top], [0, []]);
  assert.equal(a.board(5, true).length, 2);
  a.clear();
  assert.deepEqual(a.board(5, true), []);
  assert.equal(a.count(second), 0);
});

test('on a tie the board puts a named guesser before a nameless one', () => {
  const { s, lotId, playerId } = liveLot();
  const a = new Audience(undefined);
  a.guess(s, 'anon', '', 1600, lotId, T0 + 1);
  a.settle(lotId, playerId, 1600);
  engine.placeBid(s, 't1', undefined, 'admin', T0 + 2);
  engine.sellLot(s, T0 + 3);
  engine.openLot(s, s.players[1].id, T0 + 10);
  a.sync(s.lot);
  a.guess(s, 'named', 'Zubeen', 400, s.lot!.id, T0 + 11);
  a.settle(s.lot!.id, s.players[1].id, 400);
  assert.deepEqual(a.board(5, true).map((b) => [b.name, b.points, b.wins]), [['Zubeen', 3, 1], [null, 3, 1]]);
});

test('guesses and scores survive a restart', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dpl-audience-')), 'auction.db');
  let store = new Store(file);
  store.state.players = store.state.players.slice(0, 20);
  engine.startAuction(store.state);
  engine.openLot(store.state, store.state.players[0].id, T0);
  const lotId = store.state.lot!.id;
  store.saveState();
  store.audience.guess(store.state, 't1', 'One', 1600, lotId, T0 + 1);
  store.audience.settle(lotId, store.state.players[0].id, 1600);
  store.close();
  store = new Store(file);
  assert.equal(store.audience.count(lotId), 1);
  assert.deepEqual(store.audience.board(5, true).map((b) => [b.name, b.points]), [['One', 3]]);
  assert.throws(() => store.audience.guess(store.state, 't1', 'One', 1800, lotId, T0 + 2), /already guessed/);
  store.close();
});

test('a damaged saved row starts the game empty instead of stopping the server', () => {
  for (const junk of [null, 42, 'text', [], { guesses: 'no' }, { guesses: [1, 'x', [1, 2], ['tag', null], ['tag', { name: 5 }]], awards: [] }, { awards: { lot: 'x', other: [null, 3, { tag: 't' }] }, lotId: 9 }]) {
    const a = new Audience(junk as never);
    assert.deepEqual(a.board(5, true), [], JSON.stringify(junk));
    assert.equal(a.count('lot'), 0);
  }
  const kept = new Audience({
    lotId: 'lot-1',
    guesses: [['good', { name: 'One', amount: 400, ts: 1 }], ['bad', { name: 'Two', amount: 'x', ts: 2 }] as never],
    awards: { 'lot-0': [{ tag: 'good', name: 'One', pts: 3 }, { tag: 'bad' } as never] },
  });
  assert.equal(kept.count('lot-1'), 1, 'the well-formed guess is kept');
  assert.deepEqual(kept.board(5, true).map((b) => [b.name, b.points]), [['One', 3]]);
});

test('names for the big screen: letters only, 2 to 16 long, any script', () => {
  for (const ok of ['Rahul', 'Anne-Marie', 'O\'Neil', 'J. Deka', 'রাহুল', 'मनश', 'Zoë']) assert.equal(cleanName(ok), ok.normalize('NFC'), ok);
  assert.equal(cleanName('  Rahul   Deka '), 'Rahul Deka', 'spaces tidied');
  for (const bad of ['', 'A', 'x'.repeat(17), 'Rahul99', '<script>', 'http://x.co', 'Rahul 🔥', '-Rahul', '12', null, undefined, 42, {}]) {
    assert.throws(() => cleanName(bad), /2 to 16 letters/, JSON.stringify(bad));
  }
});

test('device ids are checked and never shown raw', () => {
  assert.equal(audienceDevice('abcdef0123456789'), 'abcdef0123456789');
  for (const bad of [undefined, '', 'short', 'x'.repeat(65), 'has space 12345', '../../etc/passwd', 42, {}]) assert.equal(audienceDevice(bad), null, String(bad));
  const tag = audienceTag('abcdef0123456789');
  assert.match(tag, /^[0-9a-f]{10}$/);
  assert.equal(audienceTag('abcdef0123456789'), tag);
  assert.notEqual(audienceTag('abcdef0123456780'), tag);
  assert.equal(REACTIONS.length, 6);
  assert.equal(new Set(REACTIONS).size, 6);
});

// ---- what the screens are told ----------------------------------------------------------------

test('public state carries the play-by-play fields and the guessing game, and honours the off switches', () => {
  const store = new Store(':memory:');
  const s = store.state;
  s.players = s.players.slice(0, 20);
  engine.startAuction(s);
  engine.openLot(s, s.players[0].id, T0);
  const lotId = s.lot!.id;
  let view = publicState(s, null) as any;
  assert.equal(view.lot.guessUntil, T0 + GUESS_WINDOW_MS);
  assert.deepEqual([view.players[0].hammerAt, view.players[0].bids], [null, null]);
  store.audience.guess(s, 'tag-1', 'Rahul', 400, lotId, T0 + 1);
  engine.placeBid(s, 't1', undefined, 'admin', T0 + 2);
  const sale = engine.sellLot(s, T0 + 3);
  s.guessResult = store.audience.settle(lotId, sale.player.id, sale.price);
  view = statePayloadFor(store, undefined) as any;
  assert.deepEqual([view.players[0].hammerAt, view.players[0].bids], [T0 + 3, 1]);
  assert.deepEqual(view.guessResult.top.map((g: any) => [g.name, g.amount, g.off]), [['Rahul', 400, 200]]);
  assert.deepEqual(view.guessBoard.map((b: any) => [b.name, b.points]), [['Rahul', 3]]);
  s.settings.audienceNames = false;
  view = statePayloadFor(store, undefined) as any;
  assert.equal(view.guessResult.top[0].name, null);
  assert.equal(view.guessBoard[0].name, null);
  assert.equal(view.guessResult.top[0].amount, 400, 'amounts still show');
  s.settings.audienceGame = false;
  view = statePayloadFor(store, undefined) as any;
  assert.equal(view.guessResult, null);
  assert.deepEqual(view.guessBoard, []);
  engine.openLot(s, s.players[1].id, T0 + 10);
  assert.equal((publicState(s, null) as any).lot.guessUntil, null);
  store.close();
});

test('a backup with a malformed guess result or hammer time is cleaned, not shown', () => {
  const good = { lotId: 'l', playerId: 'p', price: 400, total: 2, top: [{ name: 'Zubeen', amount: 400, off: 0, tag: 'abc' }, { name: null, amount: 600, off: 200, tag: 'def' }] };
  const ok = buildInitialState();
  ok.guessResult = structuredClone(good);
  ok.players[0].hammerAt = T0;
  ok.players[0].bidCount = 3;
  assert.equal(repairState(ok), false, 'a well-formed one is left alone');
  assert.deepEqual(ok.guessResult, good);
  for (const bad of ['text', 42, [], {}, { ...good, top: 'x' }, { ...good, top: [null] }, { ...good, top: [{ name: 5, amount: 1, off: 1, tag: 't' }] },
    { ...good, top: [{ name: 'x'.repeat(41), amount: 1, off: 1, tag: 't' }] }, { ...good, price: 'free' }, { ...good, total: -1 }, { ...good, top: [good.top[0], good.top[0], good.top[0], good.top[0]] }]) {
    const s = buildInitialState();
    s.guessResult = bad as never;
    assert.equal(repairState(s), true, JSON.stringify(bad).slice(0, 60));
    assert.equal(s.guessResult, null);
    assert.doesNotThrow(() => publicState(s, null));
  }
  const odd = buildInitialState();
  odd.teams[0].color = 'url(https://example.com/x.png)';
  odd.teams[1].color = '#3b82f6';
  odd.settings.tiers[0].color = 'red; background: black' as never;
  assert.equal(repairState(odd), true);
  assert.deepEqual([odd.teams[0].color, odd.teams[1].color, odd.settings.tiers[0].color], ['#64748b', '#3b82f6', '#64748b'], 'only plain hex colours reach the screens');
  const s = buildInitialState();
  s.players[0].hammerAt = 'yesterday' as never;
  s.players[1].hammerAt = -5;
  s.players[2].bidCount = 2.5;
  s.players[3].bidCount = { $gt: 0 } as never;
  assert.equal(repairState(s), true);
  assert.deepEqual(s.players.slice(0, 4).map((p) => [p.hammerAt ?? null, p.bidCount ?? null]), [[null, null], [null, null], [null, null], [null, null]]);
});

test('a database from before the audience features gets them switched on', () => {
  const s = buildInitialState();
  for (const key of ['audienceGame', 'audienceReactions', 'audienceNames'] as const) delete (s.settings as Partial<State['settings']>)[key];
  assert.equal(ensureTimeoutFields(s), true);
  assert.deepEqual([s.settings.audienceGame, s.settings.audienceReactions, s.settings.audienceNames], [true, true, true]);
  s.settings.audienceReactions = false;
  assert.equal(ensureTimeoutFields(s), false, 'a choice the organiser made is kept');
  assert.equal(s.settings.audienceReactions, false);
});
