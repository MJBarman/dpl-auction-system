import express, { Router, type Request, type Response, type NextFunction } from 'express';
import { Store } from './db';
import { createHash } from 'node:crypto';
import { AlreadyGuessed, audienceDevice, audienceTag, cleanName } from './audience';
import {
  deviceTagOf, loginRateLimiter, newToken, rateLimiter, requireAdmin, requireTeam, safeEqual,
} from './auth';
import * as engine from './engine';
import { AuctionError } from './engine';
import {
  applyApprovedPhoto, closePhotoLink, hoursLabel, openPhotoLink, PHOTO_LINK_MAX_HOURS, photoDeviceTag,
  photoLinkStatus, setPendingPhoto,
} from './photoLinks';
import {
  approvedPathFor, jpegSize, movePhoto, newPhotoPath, PHOTO_MAX_BYTES, photosConfigured, photoUrlFor, removePhoto,
  SniffedImage, sniffImage, uploadPhoto,
} from './photos';
import { buildInitialState, ensurePhotoCodes, ensureTimeoutFields, factoryResetPreview, generateCode } from './seed';
import { publicState, statePayloadFor } from './views';
import {
  IncrementRung, Player, PlayerStats, Settings, State, Tier,
} from './types';

interface ApiDeps {
  store: Store;
  broadcast: () => void;
  presenceChanged?: () => void; // the watching / guess counts moved
  proxied?: boolean;            // behind a reverse proxy (a hosted deployment), not a laptop on the venue's Wi-Fi
  getPin: () => string;
  setPin: (pin: string) => void;
}

// ---- tiny validators --------------------------------------------------------

function str(v: unknown, name: string, opts: { max?: number; allowEmpty?: boolean } = {}): string {
  if (typeof v !== 'string') throw new AuctionError(`${name} must be text`);
  const out = v.trim();
  if (!opts.allowEmpty && !out) throw new AuctionError(`${name} is required`);
  if (out.length > (opts.max ?? 200)) throw new AuctionError(`${name} is too long`);
  return out;
}

function int(v: unknown, name: string, opts: { min?: number; max?: number } = {}): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    throw new AuctionError(`${name} must be a whole number`);
  }
  if (opts.min !== undefined && n < opts.min) throw new AuctionError(`${name} must be ≥ ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new AuctionError(`${name} must be ≤ ${opts.max}`);
  return n;
}

function optionalInt(v: unknown, name: string, opts: { min?: number; max?: number } = {}): number | null {
  if (v === undefined || v === null || v === '') return null;
  return int(v, name, opts);
}

function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === '' || v === '–' || v === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanStats(v: unknown): PlayerStats {
  const src = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const stats: PlayerStats = {};
  for (const key of [
    'mat', 'runs', 'balls', 'batAvg', 'batSR', 'wkts', 'bestWkts', 'bowlAvg', 'econ',
    'mvpTotal', 'mvpS1', 'mvpS2', 'mvpS3', 'mvpRankS1', 'mvpRankS2',
  ] as const) {
    const n = numOrNull(src[key]);
    if (n !== null) stats[key] = n;
  }
  // Text stats: the highest score keeps its not-out star ("25*").
  for (const key of ['hs', 'bestMvp'] as const) {
    const raw = src[key];
    const t = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
    if (t && t !== '–' && t !== '-') stats[key] = t.slice(0, 40);
  }
  return stats;
}

function cleanSettings(body: unknown, current: Settings, state: State): Settings {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const next: Settings = JSON.parse(JSON.stringify(current));

  if (b.auctionName !== undefined) next.auctionName = str(b.auctionName, 'Auction name', { max: 120 });
  if (b.purse !== undefined) next.purse = int(b.purse, 'Purse', { min: 0, max: 100_000_000 });
  if (b.minSquad !== undefined) next.minSquad = int(b.minSquad, 'Minimum squad', { min: 0, max: 100 });
  if (b.maxSquad !== undefined) next.maxSquad = int(b.maxSquad, 'Maximum squad', { min: 1, max: 100 });
  if (b.reservePerSlot !== undefined) next.reservePerSlot = int(b.reservePerSlot, 'Reserve per slot', { min: 0, max: 1_000_000 });
  if (b.bidderBidding !== undefined) next.bidderBidding = Boolean(b.bidderBidding);
  if (b.timeoutEvery !== undefined) next.timeoutEvery = int(b.timeoutEvery, 'Timeout frequency', { min: 0, max: 500 });
  if (b.showTier !== undefined) next.showTier = Boolean(b.showTier);
  if (b.rulesOnScreen !== undefined) next.rulesOnScreen = Boolean(b.rulesOnScreen);
  if (b.audienceGame !== undefined) next.audienceGame = Boolean(b.audienceGame);
  if (b.audienceReactions !== undefined) next.audienceReactions = Boolean(b.audienceReactions);
  if (b.audienceNames !== undefined) next.audienceNames = Boolean(b.audienceNames);

  if (next.minSquad > next.maxSquad) throw new AuctionError('Minimum squad cannot exceed maximum squad');

  if (b.increments !== undefined) {
    if (!Array.isArray(b.increments) || b.increments.length === 0) {
      throw new AuctionError('At least one increment rung is required');
    }
    const rungs: IncrementRung[] = b.increments.map((r: unknown, i: number) => {
      const rr = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
      return {
        upTo: optionalInt(rr.upTo, `Rung ${i + 1} threshold`, { min: 1 }),
        step: int(rr.step, `Rung ${i + 1} step`, { min: 1, max: 1_000_000 }),
      };
    });
    for (let i = 0; i < rungs.length - 1; i++) {
      if (rungs[i].upTo === null) throw new AuctionError('Only the last increment rung may be open-ended');
      if (rungs[i + 1].upTo !== null && (rungs[i + 1].upTo as number) <= (rungs[i].upTo as number)) {
        throw new AuctionError('Increment thresholds must be strictly increasing');
      }
    }
    if (rungs[rungs.length - 1].upTo !== null) rungs.push({ upTo: null, step: rungs[rungs.length - 1].step });
    next.increments = rungs;
  }

  if (b.tiers !== undefined) {
    if (!Array.isArray(b.tiers) || b.tiers.length === 0) throw new AuctionError('At least one tier is required');
    const tiers: Tier[] = b.tiers.map((t: unknown, i: number) => {
      const tt = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
      const name = str(tt.name, `Tier ${i + 1} name`, { max: 40 });
      const rawKey = typeof tt.key === 'string' && tt.key.trim() ? tt.key.trim() : name;
      const key = rawKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `tier-${i + 1}`;
      return {
        key,
        name,
        basePrice: int(tt.basePrice, `Tier ${i + 1} base price`, { min: 0, max: 100_000_000 }),
        color: typeof tt.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(tt.color) ? tt.color : '#94a3b8',
        order: i + 1,
      };
    });
    const keys = new Set(tiers.map((t) => t.key));
    if (keys.size !== tiers.length) throw new AuctionError('Tier names must be unique');
    const orphan = state.players.find((p) => !keys.has(p.tierKey));
    if (orphan) {
      throw new AuctionError(`Cannot remove tier "${orphan.tierKey}" — player "${orphan.name}" is in it. Move or delete the player first.`);
    }
    next.tiers = tiers;
  }
  return next;
}

// ---- router ------------------------------------------------------------------

export function createApi({ store, broadcast, getPin, setPin, presenceChanged = () => {}, proxied = false }: ApiDeps): Router {
  const router = Router();

  /** Run a mutation: optional undo snapshot, engine work, persist, log, broadcast.
   *  If the engine throws mid-mutation, the in-memory state is rolled back so it
   *  never diverges from what is persisted. */
  function mutate<T>(undoLabel: string | null, eventType: string, fn: () => T, detail?: (r: T) => string): T {
    const before = JSON.stringify(store.state);
    const snap = undoLabel ? engine.takeSnapshot(store.state, undoLabel, Date.now()) : null;
    let result: T;
    try {
      result = fn();
    } catch (err) {
      store.state = JSON.parse(before) as State;
      throw err;
    }
    if (snap) store.pushUndo(snap);
    store.saveState();
    store.logEvent(eventType, detail ? detail(result) : undoLabel ?? eventType);
    broadcast();
    return result;
  }

  const teamName = (id: string | null | undefined) =>
    store.state.teams.find((t) => t.id === id)?.name ?? id ?? '?';

  // The wiping actions (auction reset, factory reset, restore) take the admin PIN
  // again even on a signed-in console; attempts are rate-limited like sign-in.
  // Only a wrong PIN (403) counts: a backup file refused after the PIN was
  // accepted must not lock the organiser out.
  const pinAgainLimiter = rateLimiter({ max: 5, failuresOnly: true, isFailure: (status) => status === 403 });
  function requirePinAgain(req: Request, action: string, refusal: string): void {
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    if (!pin || !safeEqual(pin, getPin())) {
      store.logEvent('auth', `${action} refused — wrong PIN`);
      throw new AuctionError(`Wrong PIN — ${refusal}`, 403);
    }
  }

  // ---- auth ----
  // Wrong admin PINs are limited per visitor (20 a minute) and across everyone
  // (100 an hour): with enough addresses, per-visitor limits alone would let a
  // 6-digit PIN be guessed within the hour. Signed-in consoles keep working
  // while sign-in is paused.
  const adminPinBudget = rateLimiter({
    max: 100, windowMs: 3_600_000, key: () => 'everyone', failuresOnly: true,
    message: 'Too many wrong PINs — admin sign-in is paused for a while. Consoles already signed in keep working.',
  });
  router.post('/auth/admin', loginRateLimiter(), adminPinBudget, (req, res) => {
    const pin = str(req.body?.pin, 'PIN', { max: 64 });
    if (!safeEqual(pin, getPin())) {
      store.logEvent('auth', 'Admin sign-in refused — wrong PIN');
      throw new AuctionError('Wrong PIN', 401);
    }
    const token = newToken();
    store.createSession({ token, role: 'admin', teamId: null, createdAt: Date.now() });
    store.logEvent('auth', `Auctioneer signed in (device #${deviceTagOf(token)})`);
    res.json({ token, role: 'admin' });
  });

  router.post('/auth/team', loginRateLimiter(), (req, res) => {
    const code = str(req.body?.code, 'Team code', { max: 32 }).toUpperCase();
    const team = store.state.teams.find((t) => t.code.toUpperCase() === code);
    if (!team) throw new AuctionError('Unknown team code', 401);
    const token = newToken();
    store.createSession({ token, role: 'team', teamId: team.id, createdAt: Date.now() });
    // Every join is on the record: a shared/forwarded link shows up here as
    // extra devices, which is the first thing to check when a team disputes
    // a bid ("we never tapped") — and the session count backs it up live.
    const devices = store.countSessionsForTeam(team.id);
    store.logEvent('auth', `${team.name} signed in on a new device (#${deviceTagOf(token)})${
      devices > 1 ? ` — ${devices} devices now hold this team's code` : ''}`);
    broadcast(); // admin Teams tab shows live device counts
    res.json({ token, role: 'team', teamId: team.id, teamName: team.name });
  });

  router.get('/auth/me', (req, res) => {
    if (!req.session) {
      res.json({ role: 'spectator' });
      return;
    }
    res.json({ role: req.session.role, teamId: req.session.teamId ?? null });
  });

  /** Sign out for real: the token stops working everywhere, not just on this screen. */
  router.post('/auth/logout', (req, res) => {
    const s = req.session;
    if (s) {
      store.deleteSession(s.token);
      store.logEvent('auth', s.role === 'admin'
        ? `Auctioneer signed out (device #${deviceTagOf(s.token)})`
        : `${teamName(s.teamId)} signed out a device (#${deviceTagOf(s.token)})`);
      if (s.role === 'team') broadcast(); // the Teams tab's device counts
    }
    res.json({ ok: true });
  });

  // ---- state snapshot (role-aware) ----
  router.get('/state', (req, res) => {
    res.json(statePayloadFor(store, req.session));
  });

  // =========================================================================
  // Player photos — public endpoints behind a per-player secret link.
  // The organiser opens a player's link for a set time and sends it to that
  // player alone. A photo sent through it waits for the organiser's approval
  // and only then reaches the screens; approving it closes the link. The
  // rules live in photoLinks.ts.
  // =========================================================================
  const playerByPhotoCode = (code: unknown) =>
    typeof code === 'string' && code
      ? store.state.players.find((p) => p.photoCode && safeEqual(p.photoCode, code))
      : undefined;

  /** Unique upload code for a new (or re-keyed) player. */
  const newPhotoCode = () => {
    let code = generateCode(10);
    while (store.state.players.some((p) => p.photoCode === code)) code = generateCode(10);
    return code;
  };

  const INVALID_PHOTO_LINK = 'This photo link is not valid — ask the organiser for a new one';

  /** The player whose link this is, provided it takes uploads right now. A
   *  refusal on a real link goes in the log with the phone that tried. */
  const playerWithOpenLink = (code: unknown, device: string): Player => {
    const player = playerByPhotoCode(code);
    if (!player) throw new AuctionError(INVALID_PHOTO_LINK, 404);
    const status = photoLinkStatus(store.state, player, Date.now());
    if (status === 'open') return player;
    store.logEvent('photo', `Refused a photo for ${player.name}: ${status === 'auction'
      ? 'links are paused while the auction is on'
      : 'the link is closed'} (phone #${device})`);
    throw new AuctionError(status === 'auction'
      ? 'Photo uploads are closed now that the auction has started'
      : 'This photo link has expired — ask the organiser to send you a new one', 403);
  };

  /** The image in a raw upload body, identified from its bytes. */
  const imageFrom = (body: unknown): { body: Buffer; kind: SniffedImage } => {
    if (!photosConfigured()) throw new AuctionError('Photo uploads are not set up on the server yet — tell the organiser', 503);
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AuctionError('Send the image bytes as the request body (JPEG, PNG or WebP)', 415);
    }
    const kind = sniffImage(body);
    if (!kind) throw new AuctionError('That file does not look like a JPEG, PNG or WebP image', 415);
    return { body, kind };
  };
  const rawImage = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: PHOTO_MAX_BYTES });

  /** A player's upload must be the still JPEG the photo page makes on a
   *  canvas (at most 900 px a side). PNG and WebP can animate, so a photo that
   *  looked fine at approval could turn into something else mid-auction; a
   *  JPEG can't. The size cap also keeps huge decode bombs off the screens. */
  const PLAYER_PHOTO_MAX_EDGE = 2400;
  const stillJpegFrom = (raw: unknown): { body: Buffer; kind: SniffedImage } => {
    const image = imageFrom(raw);
    const size = image.kind.ext === 'jpg' ? jpegSize(image.body) : null;
    if (!size) throw new AuctionError('Please send the photo from the upload page (it sends a JPEG)', 415);
    if (size.width < 1 || size.height < 1 || size.width > PLAYER_PHOTO_MAX_EDGE || size.height > PLAYER_PHOTO_MAX_EDGE) {
      throw new AuctionError('That image is too big — please send it from the upload page, which resizes it', 415);
    }
    return image;
  };
  // Uploads through a link: 10 a minute per link, and a cap per visitor.
  const photoPerLink = rateLimiter({ max: 10, key: (req) => `link:${String(req.params.code).slice(0, 40)}` });
  const photoPerVisitor = rateLimiter({ max: 60 });

  // The pending photo being moved into place right now, per player: a second
  // tap on Approve, or a Reject racing it, can't act on it twice, and an
  // upload that replaces it meanwhile must not delete it from under the move.
  const publishing = new Map<string, string>();

  router.get('/photo/:code', (req, res) => {
    const player = playerByPhotoCode(req.params.code);
    if (!player) throw new AuctionError(INVALID_PHOTO_LINK, 404);
    const now = Date.now();
    const link = photoLinkStatus(store.state, player, now);
    res.json({
      name: player.name,
      role: player.role,
      tierName: store.state.settings.tiers.find((t) => t.key === player.tierKey)?.name ?? null,
      photoUrl: photoUrlFor(player.photoPath),
      uploadsEnabled: photosConfigured(),
      maxBytes: PHOTO_MAX_BYTES,
      link,
      openUntil: link === 'open' ? player.photoLinkUntil : null,
      pendingSince: player.pendingPhoto?.uploadedAt ?? null,
      serverTime: now,
    });
  });

  router.post(
    '/photo/:code',
    photoPerVisitor,
    photoPerLink,
    // Check the link before reading the body, so a closed link never takes the bytes.
    (req, _res, next) => {
      try {
        playerWithOpenLink(req.params.code, photoDeviceTag(req));
        next();
      } catch (err) {
        next(err);
      }
    },
    rawImage,
    async (req, res, next) => {
      try {
        const device = photoDeviceTag(req);
        const player = playerWithOpenLink(req.params.code, device); // it may have closed while the body arrived
        const { body, kind } = stillJpegFrom(req.body);
        const objectPath = newPhotoPath('pending', player.id, kind.ext);
        await uploadPhoto(objectPath, body, kind.contentType);
        let current: Player;
        try {
          current = playerWithOpenLink(req.params.code, device); // ...or while it went to storage
        } catch (err) {
          removePhoto(objectPath);
          throw err;
        }
        const replaced = mutate(null, 'photo',
          () => setPendingPhoto(current, { path: objectPath, uploadedAt: Date.now(), device }),
          (r) => `New photo for ${current.name} is waiting for approval — sent from phone #${device}${
            r ? ' (it replaces the one that was waiting)' : ''}`);
        if (replaced && publishing.get(current.id) !== replaced.path) removePhoto(replaced.path);
        res.json({ ok: true, pending: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // =========================================================================
  // The audience (phones watching): guess the hammer price. Reactions travel
  // over the socket (sockets.ts). Rules in audience.ts.
  // =========================================================================
  // Limits, tightest first:
  //  - one phone: 30 tries a minute, whatever comes of them;
  //  - one network address: 240 ACCEPTED guesses a minute. Refused ones don't
  //    count, so junk from one phone can't use up a whole venue's allowance
  //    (a venue can sit behind one Wi-Fi address);
  //  - one network address, one player: a handful when every phone has its own
  //    address (a laptop on the venue's Wi-Fi), a hundred behind a proxy,
  //    where the whole room may share one. A phone id is only a random string,
  //    so this is what stops one person covering every price.
  const perAddressPerLot = proxied ? 100 : 5;
  const phoneLimiter = rateLimiter({ max: 30, key: (req) => `guess:${audienceDevice(req.get('x-device')) ?? req.ip}` });
  const acceptedLimiter = rateLimiter({ max: 240, countWhen: (status) => status === 200, message: 'Too many guesses from this network — wait a minute' });
  router.post('/audience/guess', phoneLimiter, acceptedLimiter, (req, res) => {
    const device = audienceDevice(req.get('x-device'));
    if (!device) throw new AuctionError('Open the watch page to play');
    const tag = audienceTag(device);
    const name = store.state.settings.audienceNames !== false ? cleanName(req.body?.name) : '';
    const amount = int(req.body?.amount, 'Your guess', { min: 0 });
    const lotId = str(req.body?.lotId, 'Lot', { max: 80 });
    const address = req.ip ?? 'unknown';
    try {
      const out = store.audience.guess(store.state, tag, name, amount, lotId, Date.now(), { address, limit: perAddressPerLot });
      // Ten from one address on one player is worth the organiser's eye: it
      // may be a family on one hotspot, or one person guessing ten times.
      if (out.fromAddress === 10) {
        const lot = store.state.lot;
        const who = lot ? engine.getPlayer(store.state, lot.playerId).name : 'a player';
        const network = createHash('sha256').update(`network:${address}`).digest('hex').slice(0, 6);
        store.logEvent('audience', `10 guesses on ${who} have come from one network (#${network}). If it looks like one person, Settings → Phones watching can hide names or stop the game.`);
      }
      presenceChanged();
      res.json({ ok: true, amount: out.amount, closesAt: out.closesAt, tag });
    } catch (err) {
      // The phone has guessed already (its first answer may have been lost on
      // the way back): say what it guessed, so it can show the guess as locked.
      if (err instanceof AlreadyGuessed) {
        res.status(409).json({ error: err.message, amount: err.amount, tag });
        return;
      }
      throw err;
    }
  });

  // =========================================================================
  // Team (captain) endpoints
  // =========================================================================
  router.post('/team/bid', requireTeam, (req, res) => {
    const teamId = req.session!.teamId!;
    if (!store.state.settings.bidderBidding) {
      throw new AuctionError('Bidding from captain devices is disabled — call your bid out to the auctioneer');
    }
    // A captain's bid must quote exactly what their screen showed: which lot
    // and what price. Blind bids ("whatever is open, at whatever the next
    // step is") are refused outright — an out-of-date page can never place a
    // bid its captain didn't see.
    if (req.body?.lotId === undefined || req.body?.amount === undefined) {
      throw new AuctionError('Your app is out of date — pull down to refresh the page and bid again');
    }
    const amount = int(req.body.amount, 'Bid amount', { min: 1 });
    const lotId = str(req.body.lotId, 'Lot');
    const deviceTag = deviceTagOf(req.session!.token);
    mutate(null, 'bid', () => {
      engine.placeBid(store.state, teamId, amount, 'team', Date.now(), lotId, deviceTag);
    }, () => {
      const lot = store.state.lot!;
      const bid = lot.bids[lot.bids.length - 1];
      return `${teamName(teamId)} bid ${bid.amount} pts on ${engine.getPlayer(store.state, lot.playerId).name} (captain's device #${deviceTag})`;
    });
    res.json({ ok: true });
  });

  // Each watchlist save writes the whole state and pushes it to every screen, so
  // one device gets a generous cap (no real captain comes near 2 a second).
  const watchlistLimiter = rateLimiter({ max: 120, key: (req) => `wl:${req.session?.token ?? req.ip}` });
  router.put('/team/watchlist/:playerId', requireTeam, watchlistLimiter, (req, res) => {
    const teamId = req.session!.teamId!;
    const player = engine.getPlayer(store.state, req.params.playerId);
    const wl = (store.state.watchlists[teamId] ??= {});
    const starred = Boolean(req.body?.starred);
    const targetPrice = optionalInt(req.body?.targetPrice, 'Target price', { min: 0, max: 100_000_000 });
    const note = req.body?.note !== undefined ? str(req.body.note, 'Note', { max: 300, allowEmpty: true }) : '';
    if (!starred && targetPrice === null && !note) {
      delete wl[player.id];
    } else {
      wl[player.id] = { playerId: player.id, starred, targetPrice, note };
    }
    store.saveState();
    broadcast();
    res.json({ ok: true });
  });

  // =========================================================================
  // Admin — roster & config management
  // =========================================================================
  router.post('/admin/players', requireAdmin, (req, res) => {
    const b = req.body ?? {};
    const tierKey = str(b.tierKey, 'Tier');
    if (!store.state.settings.tiers.some((t) => t.key === tierKey)) throw new AuctionError('Unknown tier');
    const player: Player = {
      id: `p${Date.now()}${Math.floor(Math.random() * 1000)}`,
      name: str(b.name, 'Name', { max: 80 }),
      role: b.role !== undefined ? str(b.role, 'Role', { max: 80, allowEmpty: true }) : '',
      tierKey,
      basePriceOverride: optionalInt(b.basePriceOverride, 'Base price override', { min: 0 }),
      stats: cleanStats(b.stats),
      notes: b.notes !== undefined ? str(b.notes, 'Notes', { max: 600, allowEmpty: true }) : '',
      demandRank: optionalInt(b.demandRank, 'Demand rank', { min: 1, max: 999 }),
      sleeper: Boolean(b.sleeper),
      status: 'available',
      teamId: null,
      price: null,
      round: null,
      offeredInPass: false,
      photoPath: null,
      photoCode: newPhotoCode(),
    };
    mutate(null, 'roster', () => store.state.players.push(player), () => `Added player ${player.name} (${tierKey})`);
    res.json({ ok: true, id: player.id });
  });

  router.post('/admin/players/bulk', requireAdmin, (req, res) => {
    const tierKey = str(req.body?.tierKey, 'Tier');
    if (!store.state.settings.tiers.some((t) => t.key === tierKey)) throw new AuctionError('Unknown tier');
    const text = str(req.body?.text, 'Player list', { max: 20_000 });
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) throw new AuctionError('No players in the list');
    if (lines.length > 200) throw new AuctionError('Too many players at once (max 200)');
    const added: string[] = [];
    mutate(null, 'roster', () => {
      for (const line of lines) {
        const [name, role] = line.split(',').map((s) => s.trim());
        if (!name) continue;
        store.state.players.push({
          id: `p${Date.now()}${Math.floor(Math.random() * 100000)}${added.length}`,
          name: name.slice(0, 80),
          role: (role ?? '').slice(0, 80),
          tierKey,
          basePriceOverride: null,
          stats: {},
          notes: '',
          demandRank: null,
          sleeper: false,
          status: 'available',
          teamId: null, price: null, round: null, offeredInPass: false,
          photoPath: null, photoCode: newPhotoCode(),
        });
        added.push(name);
      }
    }, () => `Bulk-added ${added.length} player(s) to ${tierKey}`);
    res.json({ ok: true, added: added.length });
  });

  router.put('/admin/players/:id', requireAdmin, (req, res) => {
    const player = engine.getPlayer(store.state, req.params.id);
    const b = req.body ?? {};
    mutate(null, 'roster', () => {
      if (b.name !== undefined) player.name = str(b.name, 'Name', { max: 80 });
      if (b.role !== undefined) player.role = str(b.role, 'Role', { max: 80, allowEmpty: true });
      if (b.tierKey !== undefined) {
        const tierKey = str(b.tierKey, 'Tier');
        if (!store.state.settings.tiers.some((t) => t.key === tierKey)) throw new AuctionError('Unknown tier');
        if (store.state.lot?.playerId === player.id) throw new AuctionError('Player is up for auction — close the lot first');
        player.tierKey = tierKey;
      }
      if (b.basePriceOverride !== undefined) player.basePriceOverride = optionalInt(b.basePriceOverride, 'Base price override', { min: 0 });
      if (b.stats !== undefined) player.stats = cleanStats(b.stats);
      if (b.notes !== undefined) player.notes = str(b.notes, 'Notes', { max: 600, allowEmpty: true });
      if (b.demandRank !== undefined) player.demandRank = optionalInt(b.demandRank, 'Demand rank', { min: 1, max: 999 });
      if (b.sleeper !== undefined) player.sleeper = Boolean(b.sleeper);
    }, () => `Edited player ${player.name}`);
    res.json({ ok: true });
  });

  router.delete('/admin/players/:id', requireAdmin, (req, res) => {
    const player = engine.getPlayer(store.state, req.params.id);
    if (player.status === 'sold') throw new AuctionError('Player is sold — release them first');
    if (store.state.lot?.playerId === player.id) throw new AuctionError('Player is up for auction — close the lot first');
    mutate(null, 'roster', () => {
      store.state.players = store.state.players.filter((p) => p.id !== player.id);
      for (const wl of Object.values(store.state.watchlists)) delete wl[player.id];
    }, () => `Removed player ${player.name} from the pool`);
    if (player.photoPath) removePhoto(player.photoPath);
    if (player.pendingPhoto) removePhoto(player.pendingPhoto.path);
    res.json({ ok: true });
  });

  // ---- player photos: links, approvals and the organiser's own uploads ----
  const linkHours = (v: unknown) => int(v, 'Hours', { min: 1, max: PHOTO_LINK_MAX_HOURS });

  /** Open (or extend) one player's link; `newCode: true` also replaces the code. */
  router.post('/admin/players/:id/photo-link', requireAdmin, (req, res) => {
    const player = engine.getPlayer(store.state, req.params.id);
    const hours = linkHours(req.body?.hours);
    const link = mutate(null, 'photo',
      () => openPhotoLink(store.state, player, Date.now(), hours, req.body?.newCode === true, newPhotoCode),
      (r) => (r.codeChanged
        ? `New photo link for ${player.name}, open for ${hoursLabel(hours)} — any older link for ${player.name} stops working`
        : `${player.name}'s photo link now stays open for ${hoursLabel(hours)} from now (same link)`));
    res.json({ ok: true, code: link.code, until: link.until });
  });

  router.post('/admin/players/:id/photo-link/close', requireAdmin, (req, res) => {
    const player = engine.getPlayer(store.state, req.params.id);
    mutate(null, 'photo', () => closePhotoLink(store.state, player, Date.now()),
      () => `Closed ${player.name}'s photo link`);
    res.json({ ok: true });
  });

  router.post('/admin/photo-links/open', requireAdmin, (req, res) => {
    const hours = linkHours(req.body?.hours);
    const ids: unknown = req.body?.playerIds;
    if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) {
      throw new AuctionError('Choose whose photo links to open');
    }
    const players = [...new Set(ids as string[])].map((id) => engine.getPlayer(store.state, id));
    mutate(null, 'photo', () => {
      const now = Date.now();
      for (const p of players) openPhotoLink(store.state, p, now, hours, false, newPhotoCode);
    }, () => `Opened photo links for ${hoursLabel(hours)}: ${players.map((p) => p.name).join(', ')}`);
    res.json({ ok: true, opened: players.length });
  });

  router.post('/admin/photo-links/close', requireAdmin, (_req, res) => {
    const closed = mutate(null, 'photo', () => {
      const now = Date.now();
      return store.state.players.filter((p) => closePhotoLink(store.state, p, now)).map((p) => p.name);
    }, (names) => (names.length
      ? `Closed every open photo link: ${names.join(', ')}`
      : 'Closed every photo link (none was open)'));
    res.json({ ok: true, closed: closed.length });
  });

  /** The pending photo goes on the screens; `path` must be the photo the
   *  organiser looked at, so a newer upload is never approved unseen. */
  router.post('/admin/players/:id/photo/approve', requireAdmin, async (req, res, next) => {
    try {
      const player = engine.getPlayer(store.state, req.params.id);
      const path = str(req.body?.path, 'Photo', { max: 300 });
      const pending = player.pendingPhoto;
      if (!pending) throw new AuctionError(`${player.name} has no photo waiting for approval`, 409);
      if (pending.path !== path) throw new AuctionError(`${player.name} sent a newer photo — look at that one first`, 409);
      if (publishing.has(player.id)) throw new AuctionError(`${player.name}'s photo is already being approved`, 409);
      publishing.set(player.id, pending.path);
      try {
        const livePath = approvedPathFor(pending.path);
        try {
          await movePhoto(pending.path, livePath);
        } catch (err) {
          // A newer upload replaced this photo while the move failed: nothing
          // points at it any more, so don't leave it behind in pending/.
          const now = store.state.players.find((p) => p.id === player.id);
          if (now?.pendingPhoto?.path !== pending.path) removePhoto(pending.path);
          throw err;
        }
        const current = store.state.players.find((p) => p.id === player.id); // the roster may have changed meanwhile
        if (!current) {
          removePhoto(livePath);
          throw new AuctionError(`${player.name} was removed from the pool`, 409);
        }
        const previous = mutate(null, 'photo', () => applyApprovedPhoto(current, pending.path, livePath),
          () => `Approved ${current.name}'s new photo (sent from phone #${pending.device}) — it is on the screens now, and the link is closed`);
        if (previous) removePhoto(previous);
        res.json({ ok: true, photoUrl: photoUrlFor(livePath) });
      } finally {
        publishing.delete(player.id);
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/players/:id/photo/reject', requireAdmin, (req, res) => {
    const player = engine.getPlayer(store.state, req.params.id);
    const path = str(req.body?.path, 'Photo', { max: 300 });
    const pending = player.pendingPhoto;
    if (!pending || pending.path !== path) {
      throw new AuctionError('That photo is no longer waiting — it was already handled or replaced', 409);
    }
    if (publishing.has(player.id)) throw new AuctionError(`${player.name}'s photo is being approved right now`, 409);
    // "Reject and replace the link": for a link someone else has got hold of.
    // The player keeps the same time window on a new code, sent to them again.
    // A closed link needs no replacing: it already takes nothing, and opening
    // it again always makes a new code.
    const linkOpen = photoLinkStatus(store.state, player, Date.now()) === 'open';
    const replaceLink = req.body?.newLink === true && linkOpen;
    mutate(null, 'photo', () => {
      player.pendingPhoto = null;
      if (replaceLink) player.photoCode = newPhotoCode();
    }, () => `Rejected a photo sent on ${player.name}'s link from phone #${pending.device} — it never reached the screens${
      replaceLink ? `; ${player.name}'s link was replaced, so the old one no longer works`
        : linkOpen ? '; the link stays open until it expires' : ''}`);
    removePhoto(pending.path);
    res.json({ ok: true, newLink: replaceLink });
  });

  /** The organiser's own upload goes on the screens at once (no approval, no link needed). */
  router.post('/admin/players/:id/photo', requireAdmin, rawImage, async (req, res, next) => {
    try {
      const player = engine.getPlayer(store.state, req.params.id);
      const { body, kind } = imageFrom(req.body);
      const objectPath = newPhotoPath('players', player.id, kind.ext);
      await uploadPhoto(objectPath, body, kind.contentType);
      const current = store.state.players.find((p) => p.id === player.id); // the roster may have changed meanwhile
      if (!current) {
        removePhoto(objectPath);
        throw new AuctionError(`${player.name} was removed from the pool`, 409);
      }
      const previous = mutate(null, 'photo', () => {
        const before = current.photoPath ?? null;
        current.photoPath = objectPath;
        return before;
      }, () => `Organiser uploaded a new photo for ${current.name} (console #${deviceTagOf(req.session!.token)}) — it is on the screens now`);
      if (previous && previous !== objectPath) removePhoto(previous);
      res.json({ ok: true, photoUrl: photoUrlFor(objectPath) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/admin/teams', requireAdmin, (req, res) => {
    const b = req.body ?? {};
    const team = {
      id: `t${Date.now()}`,
      name: str(b.name, 'Team name', { max: 60 }),
      captain: b.captain !== undefined ? str(b.captain, 'Captain', { max: 60, allowEmpty: true }) : '',
      owner: b.owner !== undefined ? str(b.owner, 'Owner', { max: 60, allowEmpty: true }) : '',
      color: typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : '#64748b',
      code: generateCode(),
    };
    mutate(null, 'teams', () => store.state.teams.push(team), () => `Added team ${team.name}`);
    res.json({ ok: true, id: team.id });
  });

  router.put('/admin/teams/:id', requireAdmin, (req, res) => {
    const team = engine.getTeam(store.state, req.params.id);
    const b = req.body ?? {};
    mutate(null, 'teams', () => {
      if (b.name !== undefined) team.name = str(b.name, 'Team name', { max: 60 });
      if (b.captain !== undefined) team.captain = str(b.captain, 'Captain', { max: 60, allowEmpty: true });
      if (b.owner !== undefined) team.owner = str(b.owner, 'Owner', { max: 60, allowEmpty: true });
      if (b.color !== undefined && typeof b.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(b.color)) team.color = b.color;
    }, () => `Edited team ${team.name}`);
    res.json({ ok: true });
  });

  router.delete('/admin/teams/:id', requireAdmin, (req, res) => {
    const team = engine.getTeam(store.state, req.params.id);
    if (store.state.players.some((p) => p.status === 'sold' && p.teamId === team.id)) {
      throw new AuctionError('Team owns sold players — release them first');
    }
    if (store.state.lot && store.state.lot.bids.some((b) => b.teamId === team.id)) {
      throw new AuctionError('Team has bids on the open lot — close the lot first');
    }
    mutate(null, 'teams', () => {
      store.state.teams = store.state.teams.filter((t) => t.id !== team.id);
      delete store.state.watchlists[team.id];
      store.deleteSessionsForTeam(team.id);
    }, () => `Removed team ${team.name}`);
    res.json({ ok: true });
  });

  router.post('/admin/teams/:id/regenerate-code', requireAdmin, (req, res) => {
    const team = engine.getTeam(store.state, req.params.id);
    mutate(null, 'teams', () => {
      team.code = generateCode();
      store.deleteSessionsForTeam(team.id); // kick devices using the old code
    }, () => `Regenerated join code for ${team.name}`);
    res.json({ ok: true, code: team.code });
  });

  router.put('/admin/settings', requireAdmin, (req, res) => {
    mutate(null, 'settings', () => {
      store.state.settings = cleanSettings(req.body, store.state.settings, store.state);
    }, () => 'Settings updated');
    res.json({ ok: true });
  });

  // Changing the PIN takes the current one (a borrowed or stolen console
  // can't lock the organiser out), and signs every other console out.
  router.put('/admin/pin', requireAdmin, pinAgainLimiter, (req, res) => {
    const current = typeof req.body?.currentPin === 'string' ? req.body.currentPin.trim() : '';
    if (!current || !safeEqual(current, getPin())) {
      store.logEvent('auth', 'PIN change refused — wrong current PIN');
      throw new AuctionError('Wrong current PIN — the PIN was not changed', 403);
    }
    const pin = str(req.body?.pin, 'PIN', { max: 64 });
    if (pin.length < 4) throw new AuctionError('PIN must be at least 4 characters');
    setPin(pin);
    const signedOut = store.deleteAdminSessionsExcept(req.session!.token);
    store.logEvent('settings', `Admin PIN changed${signedOut ? ` — ${signedOut} other console${signedOut === 1 ? '' : 's'} signed out` : ''}`);
    if (signedOut) broadcast(); // the signed-out consoles find out at once and go back to sign-in
    res.json({ ok: true, signedOut });
  });

  // =========================================================================
  // Admin — running the auction
  // =========================================================================
  router.post('/admin/auction/start', requireAdmin, (req, res) => {
    mutate(null, 'auction', () => {
      engine.startAuction(store.state);
      store.state.settings.rulesOnScreen = false; // the briefing is over — the projector goes live
      store.clearUndo();
    }, () => 'Auction started');
    res.json({ ok: true });
  });

  router.post('/admin/auction/next', requireAdmin, (req, res) => {
    const requestedId = req.body?.playerId ? str(req.body.playerId, 'Player') : null;
    const player = mutate(
      'Undo: player draw',
      'lot',
      () => {
        const p = requestedId
          ? engine.getPlayer(store.state, requestedId)
          : engine.drawNext(store.state);
        if (!p) {
          throw new AuctionError(
            store.state.stage === 'accelerated'
              ? 'Every unsold player has been offered in this pass. Start another pass or allot the rest.'
              : 'The main round is complete — start the accelerated round for unsold players, or complete the auction.',
          );
        }
        engine.openLot(store.state, p.id, Date.now());
        store.audience.sync(store.state.lot);
        return p;
      },
      (p) => `${p.name} is up for auction (base ${engine.basePriceOf(store.state, p)} pts)`,
    );
    res.json({ ok: true, playerId: player.id });
  });

  router.post('/admin/auction/bid', requireAdmin, (req, res) => {
    const teamId = str(req.body?.teamId, 'Team');
    const amount = optionalInt(req.body?.amount, 'Bid amount', { min: 1 });
    // Same rule as captains: the console quotes the lot it is showing, so a
    // stale admin screen can't record a bid against the wrong player.
    if (req.body?.lotId === undefined) {
      throw new AuctionError('This console is out of date — refresh the page and record the bid again');
    }
    const lotId = str(req.body.lotId, 'Lot');
    const deviceTag = deviceTagOf(req.session!.token);
    mutate(null, 'bid', () => {
      engine.placeBid(store.state, teamId, amount ?? undefined, 'admin', Date.now(), lotId, deviceTag);
    }, () => {
      const lot = store.state.lot!;
      const bid = lot.bids[lot.bids.length - 1];
      return `${teamName(teamId)} bid ${bid.amount} pts on ${engine.getPlayer(store.state, lot.playerId).name} (recorded by auctioneer #${deviceTag})`;
    });
    res.json({ ok: true });
  });

  router.post('/admin/auction/undo-bid', requireAdmin, (req, res) => {
    // Lot-scoped so a late tap can never pop a bid on the *next* player.
    const lotId = req.body?.lotId !== undefined ? str(req.body.lotId, 'Lot') : undefined;
    mutate(null, 'bid', () => engine.undoBid(store.state, lotId), () => {
      const lot = store.state.lot!;
      return `Last bid withdrawn on ${engine.getPlayer(store.state, lot.playerId).name}`;
    });
    res.json({ ok: true });
  });

  // When a hammer completes a set, the engine pauses the auction — reflect it
  // in the same audit line so the log reads like the room experienced it.
  const timeoutNote = () => {
    const t = store.state.timeout;
    return t && t.setNumber !== null
      ? ` · ⏸ set ${t.setNumber} complete (${store.state.settings.timeoutEvery} players) — strategic timeout`
      : '';
  };

  router.post('/admin/auction/sold', requireAdmin, (req, res) => {
    const guard: engine.HammerGuard = {
      lotId: req.body?.lotId !== undefined ? str(req.body.lotId, 'Lot') : undefined,
      expectedTeamId: req.body?.expectedTeamId !== undefined ? str(req.body.expectedTeamId, 'Team') : undefined,
      expectedPrice: optionalInt(req.body?.expectedPrice, 'Expected price', { min: 0 }) ?? undefined,
    };
    const result = mutate('Undo: sale', 'sale', () => {
      const lotId = store.state.lot?.id;
      const r = engine.sellLot(store.state, Date.now(), guard);
      // The phones' guesses on this player are scored with the hammer.
      store.state.guessResult = lotId && store.state.settings.audienceGame !== false
        ? store.audience.settle(lotId, r.player.id, r.price)
        : null;
      return r;
    }, (r) => `SOLD — ${r.player.name} to ${teamName(r.teamId)} for ${r.price} pts${timeoutNote()}`);
    presenceChanged();
    res.json({ ok: true, playerId: result.player.id, teamId: result.teamId, price: result.price });
  });

  router.post('/admin/auction/unsold', requireAdmin, (req, res) => {
    const lotId = req.body?.lotId !== undefined ? str(req.body.lotId, 'Lot') : undefined;
    const player = mutate('Undo: unsold', 'sale', () => {
      const p = engine.passLot(store.state, lotId, Date.now());
      store.state.guessResult = null; // no hammer price to guess
      return p;
    }, (p) => `UNSOLD — ${p.name} (no bids)${timeoutNote()}`);
    res.json({ ok: true, playerId: player.id });
  });

  router.post('/admin/auction/timeout', requireAdmin, (_req, res) => {
    mutate(null, 'auction', () => engine.startTimeout(store.state, Date.now()),
      () => 'Strategic timeout — called by the auctioneer');
    res.json({ ok: true });
  });

  router.post('/admin/auction/resume', requireAdmin, (_req, res) => {
    mutate(null, 'auction', () => engine.resumeAuction(store.state),
      () => 'Strategic timeout over — auction resumed');
    res.json({ ok: true });
  });

  router.post('/admin/auction/cancel-lot', requireAdmin, (_req, res) => {
    mutate(null, 'lot', () => engine.cancelLot(store.state), () => 'Lot cancelled — player returned to the queue');
    res.json({ ok: true });
  });

  router.post('/admin/auction/undo', requireAdmin, (_req, res) => {
    const snap = store.popUndo();
    if (!snap) throw new AuctionError('Nothing to undo');
    engine.restoreSnapshot(store.state, snap);
    if (store.state.lot) store.audience.unsettle(store.state.lot.id);
    store.saveState();
    store.logEvent('undo', `Undid: ${snap.label.replace(/^Undo: /, '')}`);
    broadcast();
    res.json({ ok: true });
  });

  router.post('/admin/auction/timer', requireAdmin, (req, res) => {
    const seconds = optionalInt(req.body?.seconds, 'Seconds', { min: 0, max: 600 });
    mutate(null, 'timer', () => {
      const lot = store.state.lot;
      if (!lot) throw new AuctionError('No player is up for auction');
      lot.timerEndsAt = seconds ? Date.now() + seconds * 1000 : null;
    }, () => (seconds ? `Hammer timer: ${seconds}s` : 'Hammer timer cleared'));
    res.json({ ok: true });
  });

  router.post('/admin/auction/accelerated', requireAdmin, (_req, res) => {
    mutate('Undo: accelerated round', 'auction', () => engine.startAccelerated(store.state),
      () => 'Accelerated round started — unsold players return to the block');
    res.json({ ok: true });
  });

  router.post('/admin/auction/allot', requireAdmin, (_req, res) => {
    const results = mutate('Undo: auto-allotment', 'sale', () => engine.allotUnsold(store.state),
      (rs) => `Auto-allotted ${rs.length} unsold player(s) at base price: ${rs.map((r) => `${r.player.name} → ${teamName(r.teamId)}`).join(', ')}`);
    res.json({ ok: true, assigned: results.map((r) => ({ playerId: r.player.id, teamId: r.teamId, price: r.price })) });
  });

  router.post('/admin/auction/assign', requireAdmin, (req, res) => {
    const playerId = str(req.body?.playerId, 'Player');
    const teamId = str(req.body?.teamId, 'Team');
    const price = int(req.body?.price, 'Price', { min: 0 });
    mutate('Undo: manual assignment', 'sale', () => engine.assignPlayer(store.state, playerId, teamId, price),
      () => `Manually assigned ${engine.getPlayer(store.state, playerId).name} to ${teamName(teamId)} for ${price} pts`);
    res.json({ ok: true });
  });

  router.post('/admin/auction/release', requireAdmin, (req, res) => {
    const playerId = str(req.body?.playerId, 'Player');
    mutate('Undo: release', 'sale', () => engine.releasePlayer(store.state, playerId),
      () => `Released ${engine.getPlayer(store.state, playerId).name} back to the pool (purse refunded)`);
    res.json({ ok: true });
  });

  router.post('/admin/auction/complete', requireAdmin, (req, res) => {
    mutate('Undo: complete auction', 'auction', () => engine.completeAuction(store.state, Boolean(req.body?.force)),
      () => 'Auction completed');
    res.json({ ok: true });
  });

  router.post('/admin/auction/reset', requireAdmin, pinAgainLimiter, (req, res) => {
    if (req.body?.confirm !== true) throw new AuctionError('Pass confirm: true to reset the auction');
    requirePinAgain(req, 'Auction reset', 'nothing was reset');
    mutate(null, 'auction', () => {
      engine.resetAuction(store.state);
      store.audience.clear();
      store.clearUndo();
    }, () => 'Auction reset — all sales cleared, pool restored (teams/players/settings kept)');
    res.json({ ok: true });
  });

  router.get('/admin/factory-reset/preview', requireAdmin, (_req, res) => {
    const teamDevices = store.state.teams.reduce((n, t) => n + store.countSessionsForTeam(t.id), 0);
    res.json({ ...factoryResetPreview(store.state), teamDevices });
  });

  router.post('/admin/factory-reset', requireAdmin, pinAgainLimiter, (req, res) => {
    if (req.body?.confirm !== true) throw new AuctionError('Pass confirm: true to factory-reset');
    requirePinAgain(req, 'Factory reset', 'nothing was reset');
    const fresh = buildInitialState();
    // Keep versions monotonic so clients never mistake the reset for stale state.
    fresh.version = (store.state.version ?? 0) + 1;
    store.replaceState(fresh);
    store.audience.clear();
    // A reset starts a new event: the old captains' phones are signed out
    // (their teams' codes are new anyway).
    store.deleteTeamSessions();
    store.logEvent('system', 'Factory reset — restored the original DCT seed; every captain device was signed out');
    broadcast();
    res.json({ ok: true });
  });

  // ---- log & export ----
  router.get('/admin/log', requireAdmin, (_req, res) => {
    res.json({ events: store.recentEvents() });
  });

  router.get('/admin/export.csv', requireAdmin, (_req, res) => {
    const s = store.state;
    const esc = (v: unknown) => {
      let t = v === null || v === undefined ? '' : String(v);
      // A cell that starts like a formula (=, +, -, @, tab, CR) would run as one
      // in Excel or Sheets; a leading apostrophe keeps it plain text.
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
      return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const lines: string[] = [];
    lines.push('RESULTS');
    lines.push('Player,Tier,Role,Base Price,Status,Price,Team,Captain,Round');
    for (const p of [...s.players].sort((a, b) => (b.price ?? -1) - (a.price ?? -1))) {
      const team = s.teams.find((t) => t.id === p.teamId);
      const tier = s.settings.tiers.find((t) => t.key === p.tierKey);
      lines.push([
        p.name, tier?.name ?? p.tierKey, p.role, engine.basePriceOf(s, p),
        p.status, p.price ?? '', team?.name ?? '', team?.captain ?? '', p.round ?? '',
      ].map(esc).join(','));
    }
    lines.push('');
    lines.push('TEAMS');
    lines.push('Team,Captain,Purse,Spent,Remaining,Players');
    for (const t of s.teams) {
      const sum = engine.teamSummary(s, t.id);
      const roster = s.players
        .filter((p) => p.status === 'sold' && p.teamId === t.id)
        .map((p) => `${p.name} (${p.price})`)
        .join('; ');
      lines.push([t.name, t.captain, s.settings.purse, sum.spent, sum.remaining, roster].map(esc).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="dpl-auction-results.csv"');
    res.send('﻿' + lines.join('\r\n'));
  });

  router.get('/admin/backup.json', requireAdmin, (_req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="dpl-auction-backup.json"');
    res.json({ exportedAt: Date.now(), state: store.state, events: store.allEvents() });
  });

  router.post('/admin/restore', requireAdmin, pinAgainLimiter, (req, res) => {
    requirePinAgain(req, 'Restore', 'nothing was restored');
    const body = req.body ?? {};
    const state = body.state as State | undefined;
    const problem = backupProblem(state);
    if (problem) throw new AuctionError(`Not a valid backup file: ${problem} — nothing was restored`);
    state!.version = (store.state.version ?? 0) + 1;
    store.replaceState(state!);
    store.audience.clear();
    store.logEvent('system', 'State restored from a backup file');
    broadcast();
    res.json({ ok: true });
  });

  /** Why a backup can't be restored, or null when it can. Beyond the shape
   *  checks, it dry-runs everything a screen builds from state, so a file that
   *  would crash every screen (or the server) is refused up front. */
  function backupProblem(state: State | undefined): string | null {
    const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
    if (!isObj(state) || !Array.isArray(state.players) || !Array.isArray(state.teams) || !isObj(state.settings)) {
      return 'it has no players, teams or settings';
    }
    const s = state.settings;
    if (!Array.isArray(s.tiers) || s.tiers.length === 0 || !Array.isArray(s.increments) || s.increments.length === 0) {
      return 'its settings have no tiers or bid steps';
    }
    if (!['setup', 'live', 'accelerated', 'completed'].includes(state.stage)) return 'its stage is unknown';
    const tierKeys = new Set(s.tiers.map((t) => t?.key));
    const ids = new Set<string>();
    for (const p of state.players) {
      if (!isObj(p) || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' || ids.has(p.id)) return 'a player is malformed or listed twice';
      if (!tierKeys.has(p.tierKey)) return `${p.name} is in a category the file doesn't have`;
      if (!['available', 'sold', 'unsold'].includes(p.status)) return `${p.name} has an unknown status`;
      if (p.photoPath != null && (typeof p.photoPath !== 'string' || p.photoPath.includes('..'))) return `${p.name} has a bad photo path`;
      ids.add(p.id);
    }
    const teamIds = new Set<string>();
    for (const t of state.teams) {
      if (!isObj(t) || typeof t.id !== 'string' || typeof t.name !== 'string' || typeof t.code !== 'string' || !t.code) return 'a team is malformed';
      teamIds.add(t.id);
    }
    if (state.players.some((p) => p.status === 'sold' && !teamIds.has(p.teamId ?? ''))) return 'a sold player belongs to a team the file doesn\'t have';
    if (state.lot != null && (!isObj(state.lot) || !ids.has(state.lot.playerId) || !Array.isArray(state.lot.bids))) return 'its open lot is broken';
    try {
      const copy = JSON.parse(JSON.stringify(state)) as State;
      ensurePhotoCodes(copy);
      ensureTimeoutFields(copy);
      publicState(copy, null);
      engine.feasibilityWarnings(copy);
    } catch (err) {
      return `the app can't read it (${err instanceof Error ? err.message : 'unknown error'})`;
    }
    return null;
  }

  // ---- error handling ----
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AuctionError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    // Body-parser errors (oversized upload, malformed JSON) carry a 4xx status.
    const status = (err as { statusCode?: unknown }).statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      res.status(status).json({
        error: status === 413 ? 'That image is too large — maximum 5 MB' : 'Bad request',
      });
      return;
    }
    console.error('[api] unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return router;
}
