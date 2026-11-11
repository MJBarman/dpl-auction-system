import { BoardRow, GUESS_WINDOW_MS } from './audience';
import { deviceTagOf } from './auth';
import { Store, Session } from './db';
import {
  allSummaries, basePriceOf, checkBid, eligiblePool, feasibilityWarnings,
  nextMinBid, progress, unsoldCount,
} from './engine';
import { photoUrlFor } from './photos';
import { State } from './types';

// Builds the wire payloads. Public state deliberately never includes team
// join codes or the admin PIN; private extras are layered per role.

export function publicState(state: State, undoLabel: string | null, extras: { guessBoard?: BoardRow[] } = {}) {
  const game = state.settings.audienceGame !== false;
  const names = state.settings.audienceNames !== false;
  const summaries = allSummaries(state);
  // A lot that points at a missing player (a bad backup, say) shows as no lot
  // rather than failing every screen's state.
  const lot = state.lot && state.players.some((p) => p.id === state.lot!.playerId) ? state.lot : null;
  let lotView: unknown = null;
  if (lot) {
    const leading = lot.bids[lot.bids.length - 1] ?? null;
    lotView = {
      id: lot.id,
      playerId: lot.playerId,
      bids: lot.bids,
      openedAt: lot.openedAt,
      timerEndsAt: lot.timerEndsAt ?? null,
      // Until when the phones watching may guess this player's hammer price.
      guessUntil: game ? lot.openedAt + GUESS_WINDOW_MS : null,
      currentBid: leading?.amount ?? null,
      leadingTeamId: leading?.teamId ?? null,
      nextMinBid: nextMinBid(state),
      teamBidState: state.teams.map((t) => {
        const c = checkBid(state, t.id, nextMinBid(state));
        return { teamId: t.id, canBid: c.ok, reason: c.ok ? null : c.reason };
      }),
    };
  }
  return {
    serverTime: Date.now(),
    version: state.version,
    stage: state.stage,
    settings: state.settings,
    currentTierKey: state.currentTierKey,
    teams: state.teams.map((t) => {
      const s = summaries.find((x) => x.id === t.id)!;
      return {
        id: t.id, name: t.name, captain: t.captain, owner: t.owner ?? '', color: t.color,
        purse: state.settings.purse,
        spent: s.spent, remaining: s.remaining, count: s.count,
        reserve: s.reserve, maxBid: s.maxBid, full: s.full,
      };
    }),
    players: state.players.map((p) => ({
      id: p.id, name: p.name, role: p.role, tierKey: p.tierKey,
      basePrice: basePriceOf(state, p),
      stats: p.stats, notes: p.notes,
      demandRank: p.demandRank ?? null, sleeper: p.sleeper ?? false,
      status: p.status, teamId: p.teamId ?? null, price: p.price ?? null,
      round: p.round ?? null,
      photoUrl: photoUrlFor(p.photoPath),
      // For the play-by-play: when the hammer fell, and after how many bids.
      hammerAt: p.hammerAt ?? null,
      bids: p.bidCount ?? null,
    })),
    lot: lotView,
    timeout: state.timeout ?? null,
    progress: progress(state),
    phase: {
      remainingInPhase: state.stage === 'live' || state.stage === 'accelerated' ? eligiblePool(state).length : 0,
      unsold: unsoldCount(state),
      mainRoundDone: state.players.every((p) => p.status !== 'available'),
      auctionedInMain: state.mainAuctionCount ?? 0,
    },
    undoLabel,
    // The audience's guessing game: how the last sale's guesses turned out and
    // who guesses best. Names only while the organiser allows them.
    guessResult: game && state.guessResult
      ? { ...state.guessResult, top: state.guessResult.top.map((g) => ({ ...g, name: names ? g.name : null })) }
      : null,
    guessBoard: game ? (extras.guessBoard ?? []).map((r) => ({ ...r, name: names ? r.name : null })) : [],
  };
}

export function statePayloadFor(store: Store, session: Session | undefined) {
  const state = store.state;
  const base = publicState(state, store.peekUndo()?.label ?? null, {
    guessBoard: store.audience.board(5, state.settings.audienceNames !== false),
  }) as Record<string, unknown>;
  if (session?.role === 'admin') {
    base.you = { role: 'admin' };
    base.admin = {
      teamCodes: state.teams.map((t) => ({ teamId: t.id, code: t.code })),
      // Secret per-player photo-upload codes — admin-only, like team codes —
      // and until when each link takes uploads (null = closed).
      photoLinks: state.players.map((p) => ({
        playerId: p.id, code: p.photoCode ?? '', openUntil: p.photoLinkUntil ?? null,
      })),
      // Photos sent through a link, waiting for the organiser. Admin-only: no
      // other screen ever sees a photo before it is approved.
      pendingPhotos: state.players.flatMap((p) => (p.pendingPhoto
        ? [{
            playerId: p.id,
            path: p.pendingPhoto.path,
            url: photoUrlFor(p.pendingPhoto.path),
            uploadedAt: p.pendingPhoto.uploadedAt,
            device: p.pendingPhoto.device,
          }]
        : [])),
      // Live device counts: >1 device on a team's code is the tell-tale of a
      // forwarded join link, and the fix is one tap away (New code).
      teamSessions: state.teams.map((t) => ({ teamId: t.id, devices: store.countSessionsForTeam(t.id) })),
      warnings: feasibilityWarnings(state),
    };
  } else if (session?.role === 'team' && session.teamId) {
    const team = state.teams.find((t) => t.id === session.teamId);
    base.you = team
      ? {
          role: 'team',
          teamId: team.id,
          deviceTag: deviceTagOf(session.token),
          watchlist: state.watchlists[team.id] ?? {},
        }
      : { role: 'spectator' };
  } else {
    base.you = { role: 'spectator' };
  }
  return base;
}
