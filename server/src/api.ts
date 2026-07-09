import { Router, type Request, type Response, type NextFunction } from 'express';
import { Store } from './db';
import {
  loginRateLimiter, newToken, requireAdmin, requireTeam, safeEqual,
} from './auth';
import * as engine from './engine';
import { AuctionError } from './engine';
import { buildInitialState, generateCode } from './seed';
import { statePayloadFor } from './views';
import {
  IncrementRung, Player, PlayerStats, Settings, State, Tier,
} from './types';

interface ApiDeps {
  store: Store;
  broadcast: () => void;
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
  for (const key of ['mat', 'runs', 'batAvg', 'batSR', 'wkts', 'bowlAvg', 'econ', 'mvpS1', 'mvpS2', 'mvpS3'] as const) {
    const n = numOrNull(src[key]);
    if (n !== null) stats[key] = n;
  }
  if (typeof src.bestMvp === 'string' && src.bestMvp.trim()) stats.bestMvp = src.bestMvp.trim().slice(0, 40);
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

export function createApi({ store, broadcast, getPin, setPin }: ApiDeps): Router {
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

  // ---- auth ----
  router.post('/auth/admin', loginRateLimiter(), (req, res) => {
    const pin = str(req.body?.pin, 'PIN', { max: 64 });
    if (!safeEqual(pin, getPin())) throw new AuctionError('Wrong PIN', 401);
    const token = newToken();
    store.createSession({ token, role: 'admin', teamId: null, createdAt: Date.now() });
    res.json({ token, role: 'admin' });
  });

  router.post('/auth/team', loginRateLimiter(), (req, res) => {
    const code = str(req.body?.code, 'Team code', { max: 32 }).toUpperCase();
    const team = store.state.teams.find((t) => t.code.toUpperCase() === code);
    if (!team) throw new AuctionError('Unknown team code', 401);
    const token = newToken();
    store.createSession({ token, role: 'team', teamId: team.id, createdAt: Date.now() });
    res.json({ token, role: 'team', teamId: team.id, teamName: team.name });
  });

  router.get('/auth/me', (req, res) => {
    if (!req.session) {
      res.json({ role: 'spectator' });
      return;
    }
    res.json({ role: req.session.role, teamId: req.session.teamId ?? null });
  });

  // ---- state snapshot (role-aware) ----
  router.get('/state', (req, res) => {
    res.json(statePayloadFor(store, req.session));
  });

  // =========================================================================
  // Team (captain) endpoints
  // =========================================================================
  router.post('/team/bid', requireTeam, (req, res) => {
    const teamId = req.session!.teamId!;
    if (!store.state.settings.bidderBidding) {
      throw new AuctionError('Bidding from captain devices is disabled — call your bid out to the auctioneer');
    }
    const amount = optionalInt(req.body?.amount, 'Bid amount', { min: 1 });
    mutate(null, 'bid', () => {
      engine.placeBid(store.state, teamId, amount ?? undefined, 'team', Date.now());
    }, () => {
      const lot = store.state.lot!;
      const bid = lot.bids[lot.bids.length - 1];
      return `${teamName(teamId)} bid ${bid.amount} pts on ${engine.getPlayer(store.state, lot.playerId).name} (from captain's device)`;
    });
    res.json({ ok: true });
  });

  router.put('/team/watchlist/:playerId', requireTeam, (req, res) => {
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
    res.json({ ok: true });
  });

  router.post('/admin/teams', requireAdmin, (req, res) => {
    const b = req.body ?? {};
    const team = {
      id: `t${Date.now()}`,
      name: str(b.name, 'Team name', { max: 60 }),
      captain: b.captain !== undefined ? str(b.captain, 'Captain', { max: 60, allowEmpty: true }) : '',
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

  router.put('/admin/pin', requireAdmin, (req, res) => {
    const pin = str(req.body?.pin, 'PIN', { max: 64 });
    if (pin.length < 4) throw new AuctionError('PIN must be at least 4 characters');
    setPin(pin);
    store.logEvent('settings', 'Admin PIN changed');
    res.json({ ok: true });
  });

  // =========================================================================
  // Admin — running the auction
  // =========================================================================
  router.post('/admin/auction/start', requireAdmin, (req, res) => {
    mutate(null, 'auction', () => {
      engine.startAuction(store.state);
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
        return p;
      },
      (p) => `${p.name} is up for auction (base ${engine.basePriceOf(store.state, p)} pts)`,
    );
    res.json({ ok: true, playerId: player.id });
  });

  router.post('/admin/auction/bid', requireAdmin, (req, res) => {
    const teamId = str(req.body?.teamId, 'Team');
    const amount = optionalInt(req.body?.amount, 'Bid amount', { min: 1 });
    mutate(null, 'bid', () => {
      engine.placeBid(store.state, teamId, amount ?? undefined, 'admin', Date.now());
    }, () => {
      const lot = store.state.lot!;
      const bid = lot.bids[lot.bids.length - 1];
      return `${teamName(teamId)} bid ${bid.amount} pts on ${engine.getPlayer(store.state, lot.playerId).name}`;
    });
    res.json({ ok: true });
  });

  router.post('/admin/auction/undo-bid', requireAdmin, (_req, res) => {
    mutate(null, 'bid', () => engine.undoBid(store.state), () => 'Last bid withdrawn');
    res.json({ ok: true });
  });

  router.post('/admin/auction/sold', requireAdmin, (_req, res) => {
    const result = mutate('Undo: sale', 'sale', () => engine.sellLot(store.state, Date.now()),
      (r) => `SOLD — ${r.player.name} to ${teamName(r.teamId)} for ${r.price} pts`);
    res.json({ ok: true, playerId: result.player.id, teamId: result.teamId, price: result.price });
  });

  router.post('/admin/auction/unsold', requireAdmin, (_req, res) => {
    const player = mutate('Undo: unsold', 'sale', () => engine.passLot(store.state),
      (p) => `UNSOLD — ${p.name} (no bids)`);
    res.json({ ok: true, playerId: player.id });
  });

  router.post('/admin/auction/cancel-lot', requireAdmin, (_req, res) => {
    mutate(null, 'lot', () => engine.cancelLot(store.state), () => 'Lot cancelled — player returned to the queue');
    res.json({ ok: true });
  });

  router.post('/admin/auction/undo', requireAdmin, (_req, res) => {
    const snap = store.popUndo();
    if (!snap) throw new AuctionError('Nothing to undo');
    engine.restoreSnapshot(store.state, snap);
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

  router.post('/admin/auction/reset', requireAdmin, (req, res) => {
    if (req.body?.confirm !== true) throw new AuctionError('Pass confirm: true to reset the auction');
    mutate(null, 'auction', () => {
      engine.resetAuction(store.state);
      store.clearUndo();
    }, () => 'Auction reset — all sales cleared, pool restored (teams/players/settings kept)');
    res.json({ ok: true });
  });

  router.post('/admin/factory-reset', requireAdmin, (req, res) => {
    if (req.body?.confirm !== true) throw new AuctionError('Pass confirm: true to factory-reset');
    store.replaceState(buildInitialState());
    store.logEvent('system', 'Factory reset — restored the original DPL Season 4 seed');
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
      const t = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
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

  router.post('/admin/restore', requireAdmin, (req, res) => {
    const body = req.body ?? {};
    const state = body.state as State | undefined;
    if (!state || !Array.isArray(state.players) || !Array.isArray(state.teams) || !state.settings) {
      throw new AuctionError('Not a valid backup file');
    }
    state.version = (store.state.version ?? 0) + 1;
    store.replaceState(state);
    store.logEvent('system', 'State restored from a backup file');
    broadcast();
    res.json({ ok: true });
  });

  // ---- error handling ----
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AuctionError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error('[api] unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return router;
}
