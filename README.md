# DPL Season 4 — Live Auction System 🏏

A production-ready, real-time player auction system built from the *DPL Season 4 Auction Plan* workbook.
One server, three faces:

| Face | URL | Who |
|---|---|---|
| **Admin / Auctioneer console** | `/admin` | Runs the auction: draws players, records bids, hammers SOLD/UNSOLD, undo, full CRUD |
| **Captain (bidder) dashboard** | `/team` | Private per-team page: purse, spends, remaining, max next bid, live lot, tap-to-bid, private watchlist & target prices |
| **Projector screen** | `/screen` | Broadcast-style big screen for the room: current lot, huge bid display, SOLD animations, purse ticker |

Everything updates live over WebSockets. Everything is persisted to SQLite on every action — a crash or restart loses nothing.

## Quick start

```bash
npm install
npm run build
npm start
```

Then open `http://localhost:4000`.

- The **admin PIN** is printed in the server console at first start (override with the `ADMIN_PIN` env var, change it later in Settings).
- **Captains join with private team codes** — shown as codes, links and QR codes in Admin → Teams. A captain scans the QR on their phone and lands straight on their dashboard.
- The server also prints its **LAN address** — open that on phones connected to the same Wi-Fi for auction night.

For development (hot reload): `npm run dev` → client at `http://localhost:5173`, API at `:4000`.
Tests: `npm test` (auction-engine unit tests).

## Seeded with the real plan

The database seeds itself from the Excel plan on first boot:

- **31 pool players** across Diamond (base 1,000) / Gold (600) / Emerald (400) / New Players (200), with career stats, hot-list ranks, sleeper tags and scouting notes.
- **4 franchises** with captains Kaustav Hazarika, Ashish Bhuyan, Padum Roy and Ankur Saikia, 10,000 pts purse each.
- **Rules as written:** increments +100 to 1,000 · +200 to 3,000 · +500 above; purse guardrail (max bid = remaining − 200 × slots still needed to reach the 7-player minimum — a fresh team's max bid is 8,800, matching the sheet); squads of 7–8; a team that reaches the maximum exits bidding; Diamond → Gold → Emerald → New round order with random draws within each tier; accelerated round for unsold players; rule-8 auto-allotment (base price, largest remaining purse, below-minimum teams first).

## Built to flex (32 players / 8-a-side … 36 players / 9-a-side)

Nothing is hard-coded. In **Admin → Settings** you can change, even mid-event:

- Min/max squad size (e.g. 7–8 for 8-a-side, 8–9 for 9-a-side) — guardrails, feasibility checks and allotment all follow.
- Purse, reserve-per-slot, the full increment ladder, tiers and base prices.
- Player pool: add/edit/delete/bulk-add players; teams: add/rename/recolour.
- The console shows **feasibility warnings** the moment the pool, squad limits and purses stop adding up.

## Running the auction (auctioneer runbook)

1. **Before:** check Players / Teams / Settings; hand each captain their QR code; open `/screen` on the projector; press **Start the auction**.
2. **Each lot:** **🎲 Draw next player** (digital chit — random within the current tier), record bids with the one-tap team buttons (they always show the correct next increment and grey out with the reason when a team can't bid), then **🔨 SOLD** — or **UNSOLD** if nobody opens. Optional hammer ⏱ timer for going-once drama.
3. **Mistakes:** *Undo last bid* for a mis-tap; the big **↩ Undo** reverses whole actions (sales, draws, unsold, allotments — history survives restarts).
4. **End game:** when the main round finishes the console offers the **accelerated round** (unsold players return, as many passes as you like), then **auto-allot** for anyone still unsold, then **🏁 Complete**.
5. **After:** export the results CSV or a full JSON backup from Settings → Data.

Captains can bid from their phones (server-enforced increments and guardrails) — or turn **device bidding off** in Settings to run a pure voice auction where their pages stay read-only.

## Production deployment

> ⚠️ **This app cannot run on Vercel / Netlify.** Those are *serverless* platforms: functions
> spin up per-request and die, so there is no long-running process to hold the WebSocket
> connections and no writable disk for the SQLite database. Deploying there fails with
> `FUNCTION_INVOCATION_FAILED`. Use a host that runs real Node servers instead:

- **Render (easiest):** push this repo to GitHub → [dashboard.render.com](https://dashboard.render.com) → *New + → Blueprint* → pick the repo. The included [render.yaml](render.yaml) configures everything; set your `ADMIN_PIN` when prompted. Free tier works for testing (but spins down when idle and **loses data on restart**) — for the real auction use the Starter plan and uncomment the persistent disk in `render.yaml`.
- **Railway / Fly.io / any VPS or Docker host:** the included [Dockerfile](Dockerfile) builds a ready-to-run image. Mount a volume at `/data` so the database persists, and set `ADMIN_PIN`.
- **Venue laptop over LAN (most reliable for auction night):** `npm run build && npm start` serves everything (UI + API + WebSockets) on one port (`PORT` env, default 4000). Phones on the same Wi-Fi use the printed Network URL — no internet required, nothing can go down mid-auction.
- Data lives in `server/data/auction.db` (override the folder with `DATA_DIR`). Back it up by copying the file or downloading the JSON backup.
- Every action is written to an append-only **audit log** (Admin → Log) — the official record of the auction.

## Architecture

```
server/  Express + Socket.IO + better-sqlite3 (TypeScript)
  src/engine.ts   pure auction rules — unit-tested (npm test)
  src/api.ts      REST mutations (auth, CRUD, auction actions, export/backup)
  src/sockets.ts  role-tailored live state broadcast
  src/seed.ts     the Excel plan as data
client/  React + Vite + TypeScript (dark broadcast theme, phone-friendly)
```

Security model: admin PIN → bearer token; per-team private codes → team tokens; spectators read-only; join codes and PINs never appear in the public state; login endpoints are rate-limited; captains' watchlists are visible only to their own team.
