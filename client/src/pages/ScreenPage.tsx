import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store';
import { PlayerView, StateView } from '../types';
import { ConnectionDot, fmt, OfflineBanner, PlayerBadges, PlayerPhoto, StatsGrid, TierBadge, useCountdown } from '../ui';

/** Full-screen broadcast display for the projector / TV. */
export default function ScreenPage() {
  const { state, connected } = useApp();
  const [flash, setFlash] = useState<{ kind: 'sold' | 'unsold'; player: PlayerView; teamName?: string; teamColor?: string; price?: number } | null>(null);
  const prevRef = useRef<StateView | null>(null);

  // Detect SOLD / UNSOLD transitions to run the overlay animation.
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!prev || !state) return;
    for (const p of state.players) {
      const old = prev.players.find((x) => x.id === p.id);
      if (!old) continue;
      if (old.status !== 'sold' && p.status === 'sold' && (p.round === 'main' || p.round === 'accelerated')) {
        const team = state.teams.find((t) => t.id === p.teamId);
        setFlash({ kind: 'sold', player: p, teamName: team?.name, teamColor: team?.color, price: p.price ?? undefined });
        return;
      }
      if (old.status === 'available' && p.status === 'unsold') {
        setFlash({ kind: 'unsold', player: p });
        return;
      }
    }
  }, [state]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  if (!state) return <div className="page-loading">Connecting…</div>;

  return (
    <div className="screen-page">
      <header className="screen-head">
        <Link to="/" className="brand">🏏 {state.settings.auctionName}</Link>
        <div className="screen-stage">
          {state.stage === 'setup' && 'Starting soon'}
          {state.stage === 'live' && `LIVE — ${state.settings.tiers.find((t) => t.key === state.currentTierKey)?.name ?? ''} round`}
          {state.stage === 'accelerated' && 'ACCELERATED ROUND'}
          {state.stage === 'completed' && 'AUCTION COMPLETE'}
        </div>
        <ConnectionDot connected={connected} />
      </header>

      <OfflineBanner connected={connected} />

      <main className="screen-main">
        {state.stage === 'completed'
          ? <FinalBoard state={state} />
          : state.lot
            ? <ScreenLot state={state} />
            : <ScreenIdle state={state} />}
      </main>

      <footer className="screen-teams">
        {state.teams.map((t) => (
          <div key={t.id} className="screen-team" style={{ borderColor: t.color }}>
            <div className="screen-team-name" style={{ color: t.color }}>{t.name}</div>
            <div className="screen-team-money">{fmt(t.remaining)}</div>
            <div className="muted small">{t.count}/{state.settings.maxSquad} players{t.full ? ' · FULL' : ''}</div>
          </div>
        ))}
      </footer>

      {flash && (
        <div className={`flash-overlay ${flash.kind}`} style={{ ['--flash-color' as any]: flash.teamColor ?? '#94a3b8' }}>
          <div className="flash-inner">
            <div className="flash-word">{flash.kind === 'sold' ? 'SOLD!' : 'UNSOLD'}</div>
            <PlayerPhoto url={flash.player.photoUrl} name={flash.player.name} size="lg" />
            <div className="flash-player">{flash.player.name}</div>
            {flash.kind === 'sold' && (
              <div className="flash-detail">
                to <b style={{ color: flash.teamColor }}>{flash.teamName}</b> for <b>{fmt(flash.price ?? null)} pts</b>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScreenLot({ state }: { state: StateView }) {
  const lot = state.lot!;
  const player = state.players.find((p) => p.id === lot.playerId)!;
  const leading = lot.leadingTeamId ? state.teams.find((t) => t.id === lot.leadingTeamId) : null;
  const timer = useCountdown(lot.timerEndsAt, state.serverTime);

  return (
    <div className="screen-lot">
      <div className="screen-lot-player">
        <div className="screen-player-head">
          <PlayerPhoto url={player.photoUrl} name={player.name} size="xl" />
          <div>
            <div><TierBadge state={state} tierKey={player.tierKey} /> <PlayerBadges player={player} /></div>
            <h1>{player.name}</h1>
            <div className="screen-role">{player.role || ''} · base price {fmt(player.basePrice)} pts</div>
          </div>
        </div>
        <StatsGrid stats={player.stats} />
        {player.notes && <p className="notes">{player.notes}</p>}
      </div>
      <div className="screen-lot-bid" style={{ borderColor: leading?.color }}>
        {timer !== null && <div className={`hammer-timer huge${timer <= 3 ? ' urgent' : ''}`}>{timer}</div>}
        <div className="screen-bid-label">{leading ? 'CURRENT BID' : 'OPENING PRICE'}</div>
        <div className="screen-bid-amount">{fmt(lot.currentBid ?? player.basePrice)}</div>
        <div className="screen-bid-team" style={{ color: leading?.color }}>
          {leading ? leading.name : 'Who will open?'}
        </div>
        <div className="screen-next-min muted">next bid ≥ {fmt(lot.nextMinBid)}</div>
        <div className="screen-bid-history">
          {[...lot.bids].reverse().slice(0, 6).map((b, i) => {
            const t = state.teams.find((x) => x.id === b.teamId);
            return (
              <div key={lot.bids.length - i} className="bid-row">
                <span className="dot" style={{ background: t?.color }} />
                <span>{t?.name}</span>
                <span className="bid-amt">{fmt(b.amount)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ScreenIdle({ state }: { state: StateView }) {
  const recent = state.players
    .filter((p) => p.status === 'sold')
    .slice()
    .reverse()
    .slice(0, 6);
  return (
    <div className="screen-idle">
      <div className="screen-idle-left">
        <h2>{state.stage === 'setup' ? 'The auction will begin shortly' : 'Next player coming up…'}</h2>
        <div className="stagebar big">
          {state.progress.perTier.map((t) => {
            const tier = state.settings.tiers.find((x) => x.key === t.tierKey);
            return (
              <div key={t.tierKey} className="tier-chip" style={{ borderColor: tier?.color }}>
                <span style={{ color: tier?.color }}>{t.name}</span>
                <span className="muted">{t.sold}/{t.total} sold</span>
              </div>
            );
          })}
        </div>
        {state.phase.unsold > 0 && (
          <p className="muted">{state.phase.unsold} unsold player(s) will return in the accelerated round.</p>
        )}
      </div>
      {recent.length > 0 && (
        <div className="screen-idle-right">
          <h3>Latest signings</h3>
          {recent.map((p) => {
            const t = state.teams.find((x) => x.id === p.teamId);
            return (
              <div key={p.id} className="bid-row">
                <PlayerPhoto url={p.photoUrl} name={p.name} size="sm" />
                <span>{p.name}</span>
                <span className="muted small">{t?.name}</span>
                <span className="bid-amt">{fmt(p.price)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FinalBoard({ state }: { state: StateView }) {
  return (
    <div className="results-grid screen-results">
      {state.teams.map((t) => (
        <div key={t.id} className="result-team" style={{ borderColor: t.color }}>
          <h3 style={{ color: t.color }}>{t.name}</h3>
          <div className="muted small">Capt. {t.captain} · spent {fmt(t.spent)}</div>
          <ul>
            {state.players
              .filter((p) => p.teamId === t.id && p.status === 'sold')
              .sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
              .map((p) => (
                <li key={p.id}>{p.name} <span className="muted">({fmt(p.price)})</span></li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
