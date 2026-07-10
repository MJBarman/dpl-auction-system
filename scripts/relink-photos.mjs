#!/usr/bin/env node
// Re-links player photos after the Render free-tier disk wiped the SQLite
// database. The photo files themselves are safe in Supabase Storage (paths
// are `players/<playerId>/<timestamp>.<ext>`), but a fresh database re-seeds
// every player with photoPath: null, so the server stops emitting photoUrl.
//
// This script: logs in as admin → downloads the live state (and saves a local
// backup) → lists the bucket → points each player's photoPath at the newest
// object in their folder → restores the patched state via /api/admin/restore.
//
// Seeded players keep stable ids (p1, p2, …) across resets, so they re-link
// automatically. Players added later via the admin UI get timestamp ids that
// change on every reset — their folders are reported as orphans at the end.
//
// Usage (PowerShell):
//   $env:ADMIN_PIN = "123456"
//   $env:SUPABASE_URL = "https://xxxx.supabase.co"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "..."
//   node scripts/relink-photos.mjs             # dry run — shows the plan
//   node scripts/relink-photos.mjs --apply     # actually restores state
//
// Optional: APP_URL (default https://dpl-auction.onrender.com),
//           SUPABASE_PHOTO_BUCKET (default player-photos)

import fs from 'node:fs';
import path from 'node:path';

const APP_URL = (process.env.APP_URL || 'https://dpl-auction.onrender.com').replace(/\/+$/, '');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SECRET_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
const BUCKET = process.env.SUPABASE_PHOTO_BUCKET || 'player-photos';
const ADMIN_PIN = (process.env.ADMIN_PIN || '').trim();
const APPLY = process.argv.includes('--apply');

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

if (!ADMIN_PIN) fail('Set ADMIN_PIN (the admin PIN of the live app).');
if (!SUPABASE_URL) fail('Set SUPABASE_URL (same value as in the Render dashboard).');
if (!SECRET_KEY) fail('Set SUPABASE_SERVICE_ROLE_KEY (same value as in the Render dashboard).');

/** fetch with retries — the Render free tier can take ~60s to cold-start. */
async function request(url, options = {}, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.status >= 500 && attempt < tries) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt >= tries) throw err;
      const wait = attempt * 15_000;
      console.log(`  … ${url} not ready (${err.message}), retrying in ${wait / 1000}s (cold start?)`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

async function storageList(prefix) {
  const all = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await request(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: {
        apikey: SECRET_KEY,
        Authorization: `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
    });
    if (!res.ok) fail(`Could not list bucket "${BUCKET}" (${res.status}): ${await res.text()}`);
    const page = await res.json();
    all.push(...page);
    if (page.length < 1000) return all;
  }
}

// 1. Admin login
console.log(`→ Logging in to ${APP_URL} …`);
const loginRes = await request(`${APP_URL}/api/auth/admin`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ pin: ADMIN_PIN }),
});
if (!loginRes.ok) fail(`Admin login failed (${loginRes.status}): ${await loginRes.text()}`);
const { token } = await loginRes.json();
const auth = { Authorization: `Bearer ${token}` };

// 2. Download current state and keep a local safety copy
console.log('→ Downloading current state …');
const backupRes = await request(`${APP_URL}/api/admin/backup.json`, { headers: auth });
if (!backupRes.ok) fail(`Backup download failed (${backupRes.status})`);
const backup = await backupRes.json();
const state = backup.state;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupFile = path.join(process.cwd(), `pre-relink-backup-${stamp}.json`);
fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
console.log(`  saved safety copy: ${backupFile}`);

// 3. Inventory the bucket: newest object per players/<id>/ folder
console.log(`→ Listing bucket "${BUCKET}" …`);
const folders = (await storageList('players')).filter((e) => !e.metadata); // folder entries have no metadata
const newestByPlayer = new Map();
for (const folder of folders) {
  const files = (await storageList(`players/${folder.name}`)).filter((e) => e.metadata);
  if (files.length === 0) continue;
  // File names are `<Date.now()>.<ext>` — the largest numeric prefix is newest.
  files.sort((a, b) => parseInt(b.name, 10) - parseInt(a.name, 10));
  newestByPlayer.set(folder.name, `players/${folder.name}/${files[0].name}`);
}
console.log(`  found photos for ${newestByPlayer.size} player folder(s)`);

// 4. Match folders to players in the live state
const linked = [];
const alreadyLinked = [];
for (const player of state.players) {
  const objectPath = newestByPlayer.get(player.id);
  if (!objectPath) continue;
  newestByPlayer.delete(player.id);
  if (player.photoPath === objectPath) {
    alreadyLinked.push(player.name);
  } else {
    player.photoPath = objectPath;
    linked.push(`${player.name}  ←  ${objectPath}`);
  }
}

console.log(`\nPlan:`);
console.log(`  re-link : ${linked.length} player(s)`);
for (const line of linked) console.log(`    • ${line}`);
if (alreadyLinked.length) console.log(`  already ok: ${alreadyLinked.length} player(s)`);
if (newestByPlayer.size) {
  console.log(`  ⚠ orphaned folders (no player with this id — players added via the admin UI`);
  console.log(`    before the reset; re-upload their photos via their /photo/<code> links):`);
  for (const [id, p] of newestByPlayer) console.log(`    • ${id}: ${p}`);
}
const noPhoto = state.players.filter((p) => !p.photoPath).length;
if (noPhoto) console.log(`  players still without any photo: ${noPhoto}`);

if (!APPLY) {
  console.log('\nDry run — nothing changed. Re-run with --apply to restore.');
  process.exit(0);
}
if (linked.length === 0) {
  console.log('\nNothing to re-link — not restoring.');
  process.exit(0);
}

// 5. Push the patched state back
console.log('\n→ Restoring patched state …');
const restoreRes = await request(`${APP_URL}/api/admin/restore`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ state }),
});
if (!restoreRes.ok) fail(`Restore failed (${restoreRes.status}): ${await restoreRes.text()}`);
console.log(`✓ Done — ${linked.length} photo(s) re-linked. Reload the app to see them.`);
