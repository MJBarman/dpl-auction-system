# DCT — Live Auction System 🏏

A production-ready, real-time player auction system, first built from the *DPL Season 4 Auction Plan*
workbook, used for the *Downtown Test Championship (DTC) Season 3* auction, and now seeded for the
*Downtown Champions Trophy (DCT)* auction.
One server, four faces:

| Face | URL | Who |
|---|---|---|
| **Admin / Auctioneer console** | `/admin` | Runs the auction: draws players, records bids, hammers SOLD/UNSOLD, undo, full CRUD |
| **Captain (bidder) dashboard** | `/team` | Private per-team page: purse, spends, remaining, max next bid, live lot, tap-to-bid, private watchlist & target prices |
| **Projector screen** | `/screen` | Broadcast-style big screen for the room: current lot, huge bid display, SOLD animations, purse ticker |
| **Phone page for everyone watching** | `/watch` | The auction made for a phone, upright or sideways: live bids, squads, the pool, guess-the-price, reactions, share cards |

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
Tests: `npm test` (auction-engine, seed, photo-link, session and guessing-game tests).

## Seeded with the DCT list

The database seeds itself on first boot (and on *Factory reset*) from the organiser's DCT list
(see [server/src/seed.ts](server/src/seed.ts)):

- **20 players** in the pool, in the list's order and spelling: Jishnu, Manash, Madhurjya, Kaustav, Kabya, Rohan, Ashish, Uddhab, Binit, Amit, Asif, Chinmoy Sr, Ronny, Debanga, Chinmoy Jr, Hirak Jr, Rahul, Amlan, Sonu, Bhokto — **two teams of 11** (10 bought at auction + the captain). The list had 22: the other two, Saurabh (Saurav) and Angshu (Angshuman), are the captains, so they bid instead of being sold. Player ids follow the list of 22 (`dct-p8` and `dct-p9` stay unused), so no photo folder shifts.
- **Categories come later.** Everyone starts in *Uncategorised* (base 200, drawn last); the last auction's categories are ready to use — Diamond 1,000 / Gold 600 / Emerald 400 / New Players 200 (Players → Edit → Tier). Delete *Uncategorised* in Settings once it's empty. No stats, roles or hot list yet; screens hide the record areas, the MVP column and the hot-list filter while the pool has none.
- **2 teams:** *Team Maka Bharosa* (captain Angshuman) and *Team Badmash Brigade* (captain Saurav). **30,000 pts purse each.** A database from the first DCT seed (all 22 in the pool, *Team 1* / *Team 2*) gets these names and captains on its next start, and the two captains leave its pool unless the auction has begun. Anything the organiser already changed is kept.
- **Rules:** increments +100 to 1,000 · +200 to 3,000 · +250 above; squads of exactly 10 plus the captain — a full team exits bidding; purse guardrail (the organisers' rule): for every player a team still needs after the one on the block, it keeps back the base price of one of the most expensive players still left, so max bid = remaining − that sum. With everyone at 200 a fresh team can bid 30,000 − 9 × 200 = 28,200; categorised as 2 Diamond / 4 Gold / 8 Emerald / 6 New it is 30,000 − (1,000 + 4 × 600 + 4 × 400) = 25,000, and the limit loosens as the expensive players are sold. (Admin → Settings → Reserve per slot adds a floor on top: 0 = base prices only.) Because the reserve always covers the players actually left, both teams can always finish their squads and open the bidding on every player. Leftover points are worth nothing at the end, and once a team is full the other gets every remaining player at base price — captains read all of this under "How bidding works", and the auctioneer can put a rules board on the projector. A strategic timeout after every 8 players; category order with random draws within each; accelerated round for unsold players; rule-8 auto-allotment (base price, largest remaining purse, below-minimum teams first).

The DTC Season 3 seed (24 players with their DTC 1 + DTC 2 records) and the DPL Season 4 seed live in git history; the engine tests keep the DTC 3 pool as a fixture ([server/src/dtc3.fixture.ts](server/src/dtc3.fixture.ts)) because its spread of base prices exercises the guardrail.

## Built to flex (32 players / 8-a-side … 36 players / 9-a-side)

Nothing is hard-coded. In **Admin → Settings** you can change, even mid-event:

- Min/max squad size (e.g. 7–8 for 8-a-side, 8–9 for 9-a-side) — guardrails, feasibility checks and allotment all follow.
- Purse, reserve-per-slot, the full increment ladder, tiers and base prices.
- Player pool: add/edit/delete/bulk-add players; teams: add/rename/recolour.
- The console shows **feasibility warnings** the moment the pool, squad limits and purses stop adding up.

## Running the auction (auctioneer runbook)

1. **Before:** categorise the players; check Players / Teams / Settings; hand each captain their QR code; open `/screen` on the projector (press F11 for full screen — the layout fits 1280×720 and up). Until the start the projector shows the categories (and the hot list, if there is one) beside a **QR code that opens the phone page**; press **📋 Show the rules on the big screen** to brief the captains, then **Start the auction** (starting takes the rules down — the same button brings them back between lots).
2. **Each lot:** **🎲 Draw next player** (digital chit — random within the current tier), record bids with the one-tap team buttons (they always show the correct next increment and grey out with the reason when a team can't bid), then **🔨 SOLD** — or **UNSOLD** if nobody opens. Optional hammer ⏱ timer for going-once drama.
3. **Mistakes:** *Undo last bid* for a mis-tap; the big **↩ Undo** reverses whole actions (sales, draws, unsold, allotments — history survives restarts).
4. **End game:** when the main round finishes the console offers the **accelerated round** (unsold players return, as many passes as you like), then **auto-allot** for anyone still unsold, then **🏁 Complete**.
5. **After:** export the results CSV or a full JSON backup from Settings → Data.

Captains can bid from their phones (server-enforced increments and guardrails) — or turn **device bidding off** in Settings to run a pure voice auction where their pages stay read-only.

## Watching on a phone (`/watch`)

Most of the room follows on a phone, so spectators get their own page instead of a shrunken
projector. A phone that opens `/screen` is sent there by itself (`/screen?big=1` keeps the
projector layout, for a TV or laptop). It reads the same public state as the projector and can
change nothing in the auction.

- **How people get there:** the projector shows a QR code before the start and in every strategic
  timeout, and the landing page has *Watch on this phone*. *Add to Home Screen* (in the page's menu)
  puts it on the phone like an app: the icon opens the phone page for a spectator, the bidding page
  for a captain, the console for the organiser. If the projector is opened as `localhost` on the
  laptop that runs the server, the QR uses the laptop's Wi-Fi address (it is printed under the code,
  so check it is the venue network).
- **Live** — the player on the block, the bid in big rolling digits, who leads, the hammer timer, a
  strip of the latest sales and a play-by-play underneath. SOLD takes over the screen in the buying
  team's colours. Held sideways, the same page becomes a scoreboard: player left, bid right, purses
  along the bottom.
- **Squads** — one team per swipe (both side by side when sideways): points left, max bid, the
  roster so far. **Pool** — every player by category: to come, sold, everyone.
- **Follow a team** — asked once, changeable in the menu. Your team's bids and buys are marked, its
  squad comes first, and the phone gives a short buzz when it takes the lead or buys (Android; an
  iPhone has no vibration for web pages).
- **Sound is off until you tap for it**, so nobody's phone chimes by surprise.
- **Guess the hammer price** — for the first 30 seconds of each player a phone can lock in one
  guess (and a first name). The closest three score 3, 2 and 1; the closest is named under SOLD on
  the projector and the phones, a "Sharpest eyes" board runs all night, and the final board gives a
  *Sharpest eye* award. Undoing a sale takes its points back (the last four players' guesses are
  kept, so an undo two or three steps back still re-scores properly); a restart keeps guesses and
  scores; resetting the auction clears them.
- **Reactions** — six emoji that float up every phone and the projector. One per phone every
  0.4 seconds, at most 40 on the screens every quarter-second however many phones are tapping.
- **Share** — any sale, or a team's squad, as a 1080×1920 picture (the size of a WhatsApp status),
  through the phone's own share sheet, or saved as a file where that isn't possible (pressing and
  holding the picture always works).
- **The phone's Back button** closes an open sheet instead of leaving the page.
- **The count in the corner** is how many screens are connected right now (the projector, the
  console and captains included).

**The organiser's switches** (Admin → Settings → *Phones watching*) work at once, mid-auction too:
*Guess the hammer price*, *Emoji reactions on the screens*, *Show guessers' names* (off: results
show amounts only, and a name typed on a phone is never stored).

**On the venue's own Wi-Fi (plain `http://`)** browsers hold a few things back that they allow on
an `https://` address: the native share sheet (the picture is saved instead), the home-screen
install prompt (the browser menu's *Add to Home screen* still works), and keeping the screen awake.
Everything else is the same.

## Player photos (Supabase Storage)

Each player gets a **private photo-upload link** (`/photo/<secret-code>`), and nothing a link
sends reaches a screen until the organiser approves it:

- **Links open for a set time.** Admin → Players → **📸 Photo links** lists every player. Pick how
  long links stay open (1 hour to 7 days, default 24 hours), then *Open links for the … without a
  photo*, or *Open link* per player. Opening a closed link always makes a new code, so a link that
  leaked earlier never comes back to life. A link closes when its time is up, when its photo is
  approved (single use), or with *Close*; **every link pauses once the auction starts**, so no photo
  can change on the projector mid-auction.
- **Send each link to that player only.** *WhatsApp* opens WhatsApp with the player's own message
  ready to send (pick their chat); *Copy* copies it. There is no "copy all" any more: one list in
  the group chat is how links got misused.
- **You approve every photo.** A new upload waits as *pending*; a card pops up in the corner of
  every console tab with the photo on the screens now beside the new one, *Approve* / *Reject*, the
  phone it came from, and a warning when one phone sent photos for several players. The tab title
  counts waiting photos. Mid-auction the card waits as a small pill. *Someone else has this link?
  Reject and replace it* also swaps the player's link for a new one.
- **Your own uploads go straight up:** Players → Edit → *Upload photo* (no link or approval needed).
- Link uploads must be the still JPEG the upload page makes (it resizes in the browser), up to
  2,400 px a side: PNG and WebP can animate, so a photo could change after approval. Waiting photos
  live under `pending/` in the bucket with an unguessable name; approval moves them to `players/`.
  Every refusal, upload, approval and rejection is in the Log with the phone's tag.

Setup (one-time):

1. Create a [Supabase](https://supabase.com) project and a **public** storage bucket named
   `player-photos` (recommended: 5 MB file-size limit, allowed types `image/jpeg`, `image/png`,
   `image/webp`). *Already done for this project's Supabase instance.*
2. Give the server two env vars — locally copy [server/.env.example](server/.env.example) to
   `server/.env`; on Render/Docker set real env vars:
   - `SUPABASE_URL` — Project Settings → Data API
   - `SUPABASE_SERVICE_ROLE_KEY` — Project Settings → API Keys (`service_role` or a
     `sb_secret_...` key). Server-side only — never ships to browsers.

Without these the app runs normally and shows initials avatars; the upload page politely says
uploads are unavailable. Photos are stored under a **new immutable URL on every upload** with
1-year cache headers, so live-bidding re-renders never refetch or flicker — the swap only
happens when a player actually uploads a new photo.

## Security notes

- **Sign-ins:** the admin PIN and team codes are checked per visitor, counting only wrong guesses
  (20 a minute); the PIN check behind resets and restores allows 5 wrong PINs a minute. Behind a
  proxy the server must know how many hops to trust to tell visitors apart: on Render it trusts
  **1** automatically; elsewhere set `TRUST_PROXY_HOPS` (never more than the real number of
  proxies). Use a long `ADMIN_PIN` on a public host.
- **Sessions** last 14 days. *Sign out* / *Exit* end the token on the server; changing the PIN
  needs the current PIN and signs out every other console; a factory reset signs out every
  captain. Tokens travel only in the `Authorization` header (downloads included), never in URLs.
- **Restore** refuses backups that would break the screens (missing players or categories, a lot on
  a missing player, unknown stages, bad photo paths) and tells you why.
- **Sockets** ignore malformed tokens, answer refreshes a few times a second at most, and drop
  clients that stop reading, so one bad client can't stall or crash the auction.
- The CSV export neutralises cells that start like a spreadsheet formula.
- **The phone page** needs no sign-in and can only read. A guess is one per phone per player, a
  whole number between the base price and the purse, inside the 30-second window; a name is letters
  only (any script), 2 to 16 long. Limits: 30 tries a minute per phone; 240 accepted guesses a
  minute per network address (refused ones don't count, so junk from one phone can't use up a
  venue's allowance); per player, 5 guesses per address when the server runs on the venue's Wi-Fi
  (every phone has its own address there) and 100 behind a proxy such as Render (a whole room can
  share one); 3,000 guesses per player in all. A phone is known only by a random id it keeps, which
  anyone can make more of, so the per-address cap is what stops one person covering every price;
  ten guesses on one player from one address puts a line in the Log. The public state carries a
  short fingerprint of the id, never the id. Reactions must be one of the six emoji; anything else
  a socket sends is ignored.

## Production deployment

> ⚠️ **This app cannot run on Vercel / Netlify.** Those are *serverless* platforms: functions
> spin up per-request and die, so there is no long-running process to hold the WebSocket
> connections and no writable disk for the SQLite database. Deploying there fails with
> `FUNCTION_INVOCATION_FAILED`. Use a host that runs real Node servers instead:

- **Render (easiest):** push this repo to GitHub → [dashboard.render.com](https://dashboard.render.com) → *New + → Blueprint* → pick the repo. The included [render.yaml](render.yaml) configures everything; set your `ADMIN_PIN` when prompted. Free tier works for testing (but spins down when idle and **loses data on restart**) — for the real auction use the Starter plan and uncomment the persistent disk in `render.yaml`.
- **Railway / Fly.io / any VPS or Docker host:** the included [Dockerfile](Dockerfile) builds a ready-to-run image. Mount a volume at `/data` so the database persists, and set `ADMIN_PIN`.
- **Venue laptop over LAN (most reliable for auction night):** `npm run build && npm start` serves everything (UI + API + WebSockets) on one port (`PORT` env, default 4000). Phones on the same Wi-Fi use the printed Network URL (the likeliest Wi-Fi address is printed first, and the projector's QR code points at it) — no internet required, nothing can go down mid-auction.
- Data lives in `server/data/auction.db` (override the folder with `DATA_DIR`). Back it up by copying the file or downloading the JSON backup.
- Every action is written to an append-only **audit log** (Admin → Log) — the official record of the auction.

## Architecture

```
server/  Express + Socket.IO + better-sqlite3 (TypeScript)
  src/engine.ts   pure auction rules — unit-tested (npm test)
  src/api.ts      REST mutations (auth, CRUD, auction actions, export/backup)
  src/sockets.ts  role-tailored live state broadcast; who is watching; emoji reactions
  src/audience.ts the phones' guessing game (kept beside the auction state, never in it)
  src/where.ts    the laptop's address on the Wi-Fi, for the projector's QR code
  src/seed.ts     the Excel plan as data
client/  React + Vite + TypeScript (dark broadcast theme, phone-friendly)
  src/pages/WatchPage.tsx, src/watch/, src/watch.css   the phone page
  src/audience.ts guessing, share cards, add-to-home-screen, buzz
```

Security model: admin PIN → bearer token; per-team private codes → team tokens; spectators read-only; join codes and PINs never appear in the public state; login endpoints are rate-limited; captains' watchlists are visible only to their own team.
