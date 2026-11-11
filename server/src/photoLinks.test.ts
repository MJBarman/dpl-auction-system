import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from 'express';
import { Store } from './db';
import * as engine from './engine';
import {
  applyApprovedPhoto, closePhotoLink, hoursLabel, openPhotoLink, photoDeviceTag, photoLinkStatus, setPendingPhoto,
} from './photoLinks';
import { approvedPathFor } from './photos';
import { buildInitialState } from './seed';
import { publicState, statePayloadFor } from './views';
import { Player, State } from './types';

const HOUR = 3_600_000;
const T0 = 1_800_000_000_000;

let codes = 0;
const makeCode = () => `CODE${++codes}`;

function setup(): { s: State; p: Player } {
  const s = buildInitialState();
  return { s, p: s.players[0] };
}

test('a link nobody opened takes no uploads — including every link from before this change', () => {
  const { s, p } = setup();
  assert.ok(p.photoCode, 'every player still has a code');
  assert.equal(p.photoLinkUntil, undefined);
  assert.equal(photoLinkStatus(s, p, T0), 'closed');
});

test('opening a closed link gives it a new code and an end time; it closes on its own when the time is up', () => {
  const { s, p } = setup();
  const old = p.photoCode;
  const link = openPhotoLink(s, p, T0, 24, false, makeCode);
  assert.notEqual(link.code, old, 'a leaked old link never comes back to life');
  assert.equal(p.photoCode, link.code);
  assert.equal(link.until, T0 + 24 * HOUR);
  assert.equal(link.codeChanged, true);
  assert.equal(photoLinkStatus(s, p, T0 + 24 * HOUR - 1), 'open');
  assert.equal(photoLinkStatus(s, p, T0 + 24 * HOUR), 'closed');
});

test('re-opening an open link keeps its code (the message already sent still works) and moves the end time', () => {
  const { s, p } = setup();
  const first = openPhotoLink(s, p, T0, 24, false, makeCode);
  const again = openPhotoLink(s, p, T0 + 20 * HOUR, 6, false, makeCode);
  assert.equal(again.code, first.code);
  assert.equal(again.codeChanged, false);
  assert.equal(again.until, T0 + 26 * HOUR);
});

test('"New link" replaces the code of an open link; re-opening an expired link always does', () => {
  const { s, p } = setup();
  const first = openPhotoLink(s, p, T0, 1, false, makeCode);
  const fresh = openPhotoLink(s, p, T0 + 10, 1, true, makeCode);
  assert.notEqual(fresh.code, first.code);
  assert.equal(fresh.codeChanged, true);
  const reopened = openPhotoLink(s, p, T0 + 2 * HOUR, 1, false, makeCode); // fresh expired at T0 + 1 h
  assert.notEqual(reopened.code, fresh.code);
});

test('links stay open between 1 hour and 7 days', () => {
  const { s, p } = setup();
  for (const bad of [0, -1, 169, 1.5, NaN]) {
    assert.throws(() => openPhotoLink(s, p, T0, bad, false, makeCode), /1 to 168 hours/, String(bad));
  }
  assert.equal(openPhotoLink(s, p, T0, 168, false, makeCode).until, T0 + 168 * HOUR);
  assert.equal(hoursLabel(1), '1 h');
  assert.equal(hoursLabel(24), '24 h');
  assert.equal(hoursLabel(72), '3 days');
  assert.equal(hoursLabel(168), '7 days');
});

test('every link pauses once the auction starts and comes back if the auction is reset', () => {
  const { s, p } = setup();
  openPhotoLink(s, p, T0, 24, false, makeCode);
  engine.startAuction(s);
  assert.equal(photoLinkStatus(s, p, T0 + 1), 'auction');
  assert.throws(() => openPhotoLink(s, p, T0 + 1, 24, false, makeCode), /before the auction starts/);
  engine.resetAuction(s);
  assert.equal(s.stage, 'setup');
  assert.equal(photoLinkStatus(s, p, T0 + 2), 'open');
});

test('closing a link stops it at once and says whether it was open', () => {
  const { s, p } = setup();
  assert.equal(closePhotoLink(s, p, T0), false);
  openPhotoLink(s, p, T0, 24, false, makeCode);
  assert.equal(closePhotoLink(s, p, T0 + 1), true);
  assert.equal(photoLinkStatus(s, p, T0 + 2), 'closed');
  assert.equal(p.photoLinkUntil, null);
});

test('a second photo through the link replaces the one waiting, which the caller deletes', () => {
  const { p } = setup();
  const a = { path: `pending/${p.id}/1.jpg`, uploadedAt: T0, device: 'aaaaaa' };
  const b = { path: `pending/${p.id}/2.jpg`, uploadedAt: T0 + 1, device: 'bbbbbb' };
  assert.equal(setPendingPhoto(p, a), null);
  assert.deepEqual(setPendingPhoto(p, b), a);
  assert.deepEqual(p.pendingPhoto, b);
});

test('approving puts the photo on the screens, closes the link and hands back the photo it replaced', () => {
  const { s, p } = setup();
  p.photoPath = `players/${p.id}/100.jpg`;
  openPhotoLink(s, p, T0, 24, false, makeCode);
  const pending = { path: `pending/${p.id}/200.jpg`, uploadedAt: T0, device: 'aaaaaa' };
  setPendingPhoto(p, pending);
  const live = approvedPathFor(pending.path);
  assert.equal(live, `players/${p.id}/200.jpg`);
  assert.equal(applyApprovedPhoto(p, pending.path, live), `players/${p.id}/100.jpg`);
  assert.equal(p.photoPath, live);
  assert.equal(p.pendingPhoto, null);
  assert.equal(photoLinkStatus(s, p, T0 + 1), 'closed', 'a link is single-use');
});

test('a newer photo that arrives while one is being approved stays waiting', () => {
  const { p } = setup();
  p.photoPath = null;
  const first = { path: `pending/${p.id}/1.jpg`, uploadedAt: T0, device: 'aaaaaa' };
  const newer = { path: `pending/${p.id}/2.jpg`, uploadedAt: T0 + 1, device: 'aaaaaa' };
  setPendingPhoto(p, first);
  setPendingPhoto(p, newer); // lands mid-approval
  assert.equal(applyApprovedPhoto(p, first.path, approvedPathFor(first.path)), null, 'no photo before, nothing to delete');
  assert.equal(p.photoPath, `players/${p.id}/1.jpg`, 'the photo the organiser saw goes live');
  assert.deepEqual(p.pendingPhoto, newer);
});

test('approving never deletes the photo it just published', () => {
  const { p } = setup();
  p.photoPath = `players/${p.id}/5.jpg`;
  assert.equal(applyApprovedPhoto(p, `pending/${p.id}/5.jpg`, `players/${p.id}/5.jpg`), null);
});

test('the phone tag follows the photo page\'s device id, and falls back to address + browser', () => {
  const req = (headers: Record<string, string>, ip = '10.0.0.1') =>
    ({ ip, get: (h: string) => headers[h.toLowerCase()] }) as unknown as Request;
  const one = photoDeviceTag(req({ 'x-photo-device': 'device-one-1234' }));
  assert.match(one, /^[0-9a-f]{6}$/);
  assert.equal(photoDeviceTag(req({ 'x-photo-device': 'device-one-1234' }, '10.9.9.9')), one, 'same phone on another network');
  assert.notEqual(photoDeviceTag(req({ 'x-photo-device': 'device-two-1234' })), one);
  const bare = photoDeviceTag(req({ 'user-agent': 'Phone A' }));
  assert.equal(photoDeviceTag(req({ 'user-agent': 'Phone A', 'x-photo-device': 'bad id!' })), bare, 'a malformed id is ignored');
  assert.notEqual(photoDeviceTag(req({ 'user-agent': 'Phone B' })), bare);
});

test('only the organiser\'s state carries pending photos and link end times; every other screen sees the approved photo only', () => {
  const store = new Store(':memory:');
  const p = store.state.players[0];
  p.photoLinkUntil = T0;
  p.pendingPhoto = { path: `pending/${p.id}/9.jpg`, uploadedAt: T0, device: 'abcdef' };
  const pub = JSON.stringify(publicState(store.state, null));
  assert.ok(!pub.includes('pending/'), 'no pending photo in public state');
  assert.ok(!pub.includes(p.photoCode!), 'no photo code in public state');
  for (const role of ['team', 'spectator'] as const) {
    const session = role === 'team' ? { token: 't', role, teamId: 't1', createdAt: 0 } : undefined;
    const json = JSON.stringify(statePayloadFor(store, session));
    assert.ok(!json.includes('pending/'), `no pending photo for ${role}`);
  }
  const admin = statePayloadFor(store, { token: 'a', role: 'admin', teamId: null, createdAt: 0 }) as {
    admin: { pendingPhotos: { playerId: string; path: string; device: string }[]; photoLinks: { playerId: string; openUntil: number | null }[] };
  };
  assert.deepEqual(admin.admin.pendingPhotos.map((x) => [x.playerId, x.path, x.device]), [[p.id, `pending/${p.id}/9.jpg`, 'abcdef']]);
  assert.equal(admin.admin.photoLinks.find((l) => l.playerId === p.id)?.openUntil, T0);
  store.close();
});

// ---- hardening found by the security review ------------------------------------

test('the photo size check reads a JPEG\'s frame header and refuses anything else', async () => {
  const { jpegSize } = await import('./photos');
  const jpeg = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xf4, 0x02, 0x58, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // SOF0 500×600
    0xff, 0xd9, // EOI
  ]);
  assert.deepEqual(jpegSize(jpeg), { width: 600, height: 500 });
  assert.equal(jpegSize(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0])), null, 'a PNG is not a JPEG');
  assert.equal(jpegSize(jpeg.subarray(0, 24)), null, 'a truncated JPEG has no size');
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0, 0, 0, 0, 0])), null, 'scan before any frame header');
});

test('undo after deleting the player it would put back on the block leaves no lot (it used to crash every screen)', () => {
  const s = buildInitialState();
  engine.startAuction(s);
  const x = s.players[0];
  engine.openLot(s, x.id, 1);
  const snap = engine.takeSnapshot(s, 'Undo: unsold', 2);
  engine.passLot(s, undefined, 3);
  s.players = s.players.filter((p) => p.id !== x.id); // the organiser deletes the unsold player
  engine.restoreSnapshot(s, snap);
  assert.equal(s.lot, null);
  assert.doesNotThrow(() => publicState(s, null));
});

test('a stored state whose lot points at a missing player is repaired on load', async () => {
  const { repairState } = await import('./seed');
  const s = buildInitialState();
  s.lot = { id: 'L1', playerId: 'gone', bids: [], openedAt: 1 };
  assert.doesNotThrow(() => publicState(s, null), 'the screens show no lot rather than failing');
  assert.equal(repairState(s), true);
  assert.equal(s.lot, null);
  assert.equal(repairState(s), false);
});

test('sessions: junk tokens are ignored, sign-out and expiry end a token, a PIN change signs out other consoles', async () => {
  const { SESSION_TTL_MS } = await import('./db');
  const store = new Store(':memory:');
  for (const junk of [true, {}, [], 42, '', 'x'.repeat(500), null, undefined]) {
    assert.equal(store.getSession(junk), undefined, `token ${JSON.stringify(junk)}`);
  }
  const now = Date.now();
  store.createSession({ token: 'admin-a', role: 'admin', teamId: null, createdAt: now });
  store.createSession({ token: 'admin-b', role: 'admin', teamId: null, createdAt: now });
  store.createSession({ token: 'team-1', role: 'team', teamId: 't1', createdAt: now });
  store.createSession({ token: 'old', role: 'team', teamId: 't1', createdAt: now - SESSION_TTL_MS - 1 });
  assert.equal(store.getSession('old'), undefined, 'a two-week-old sign-in has expired');
  assert.equal(store.countSessionsForTeam('t1'), 1, 'expired devices are not counted');
  assert.equal(store.deleteAdminSessionsExcept('admin-a'), 1);
  assert.ok(store.getSession('admin-a'));
  assert.equal(store.getSession('admin-b'), undefined);
  store.deleteSession('admin-a');
  assert.equal(store.getSession('admin-a'), undefined);
  store.deleteTeamSessions();
  assert.equal(store.getSession('team-1'), undefined);
  store.close();
});

test('sessions slide: each use keeps a sign-in alive; two weeks unused ends it; older databases get the column', async () => {
  const { SESSION_TTL_MS } = await import('./db');
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const Database = (await import('better-sqlite3')).default;
  // A database from before the change: sessions without lastSeenAt.
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dpl-sessions-')), 'auction.db');
  const old = new Database(file);
  old.exec('CREATE TABLE sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, teamId TEXT, createdAt INTEGER NOT NULL)');
  const day = 24 * 3_600_000;
  old.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('used-yesterday', 'admin', null, Date.now() - day);
  old.close();
  const store = new Store(file);
  assert.ok(store.getSession('used-yesterday'), 'an existing session survives the column being added');
  // Signed in 20 days ago but used 13 days ago: still in, and the use is recorded.
  const now = Date.now();
  store.createSession({ token: 'long-event', role: 'admin', teamId: null, createdAt: now - 20 * day });
  (store as unknown as { db: InstanceType<typeof Database> }).db
    .prepare('UPDATE sessions SET lastSeenAt = ? WHERE token = ?').run(now - 13 * day, 'long-event');
  const s = store.getSession('long-event');
  assert.ok(s, 'a session used within two weeks is alive, whenever it signed in');
  assert.ok(s!.lastSeenAt! >= now, 'the use moves its expiry on');
  // Unused for more than two weeks: gone.
  store.createSession({ token: 'forgotten', role: 'team', teamId: 't1', createdAt: now - SESSION_TTL_MS - 1000 });
  assert.equal(store.getSession('forgotten'), undefined);
  store.close();
});
