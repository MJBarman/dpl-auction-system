import { Store, Session } from './db';
import {
  allSummaries, basePriceOf, checkBid, eligiblePool, feasibilityWarnings,
  nextMinBid, progress, unsoldCount,
} from './engine';
import { State } from './types';

// Builds the wire payloads. Public state deliberately never includes team
// join codes or the admin PIN; private extras are layered per role.

export function publicState(state: State, undoLabel: string | null) {
  const summaries = allSummaries(state);
  const lot = state.lot;
  let lotView: unknown = null;
  if (lot) {
    const leading = lot.bids[lot.bids.length - 1] ?? null;
    lotView = {
      id: lot.id,
      playerId: lot.playerId,
      bids: lot.bids,
      openedAt: lot.openedAt,
      timerEndsAt: lot.timerEndsAt ?? null,
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
        id: t.id, name: t.name, captain: t.captain, color: t.color,
        purse: state.settings.purse,
        spent: s.spent, remaining: s.remaining, count: s.count,
        maxBid: s.maxBid, full: s.full,
      };
    }),
    players: state.players.map((p) => ({
      id: p.id, name: p.name, role: p.role, tierKey: p.tierKey,
      basePrice: basePriceOf(state, p),
      stats: p.stats, notes: p.notes,
      demandRank: p.demandRank ?? null, sleeper: p.sleeper ?? false,
      status: p.status, teamId: p.teamId ?? null, price: p.price ?? null,
      round: p.round ?? null,
    })),
    lot: lotView,
    progress: progress(state),
    phase: {
      remainingInPhase: state.stage === 'live' || state.stage === 'accelerated' ? eligiblePool(state).length : 0,
      unsold: unsoldCount(state),
      mainRoundDone: state.players.every((p) => p.status !== 'available'),
    },
    undoLabel,
  };
}

export function statePayloadFor(store: Store, session: Session | undefined) {
  const state = store.state;
  const base = publicState(state, store.peekUndo()?.label ?? null) as Record<string, unknown>;
  if (session?.role === 'admin') {
    base.you = { role: 'admin' };
    base.admin = {
      teamCodes: state.teams.map((t) => ({ teamId: t.id, code: t.code })),
      warnings: feasibilityWarnings(state),
    };
  } else if (session?.role === 'team' && session.teamId) {
    const team = state.teams.find((t) => t.id === session.teamId);
    base.you = team
      ? {
          role: 'team',
          teamId: team.id,
          watchlist: state.watchlists[team.id] ?? {},
        }
      : { role: 'spectator' };
  } else {
    base.you = { role: 'spectator' };
  }
  return base;
}
