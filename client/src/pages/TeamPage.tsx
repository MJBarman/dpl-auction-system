import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { clearSession, loadSession } from '../session';
import { useApp } from '../store';
import { PlayerView, StateView, WatchlistEntry } from '../types';
import {
  ConnectionDot, fmt, Modal, OfflineBanner, PlayerBadges, StatsGrid, TierBadge, useAction, useCountdown,
} from '../ui';

export default function TeamPage() {
  const navigate = useNavigate();
  const { state, connected, refresh } = useApp();
  const session = loadSession();
  const [tab, setTab] = useState<'live' | 'squad' | 'pool'>('live');

  useEffect(() => {
    if (!session || session.role !== 'team') navigate('/', { replace: true });
  }, [session, navigate]);

  useEffect(() => {
    if (state && state.you.role !== 'team') refresh();
  }, [state?.you.role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session || session.role !== 'team') return null;
  if (!state) return <div className="page-loading">Connecting…</div>;

  const you = state.you;
  const team = you.role === 'team' ? state.teams.find((t) => t.id === you.teamId) : null;
  if (!team) {
    // Team was deleted or the code was regenerated.
    return (
      <div className="page-loading">
        <p>Your session is no longer valid — ask the auctioneer for a fresh code.</p>
        <button className="btn" onClick={() => { clearSession(); refresh(); navigate('/'); }}>Back to start</button>
      </div>
    );
  }
  const watchlist = you.role === 'team' ? you.watchlist : {};

  return (
    <div className="team-page" style={{ ['--team-color' as any]: team.color }}>
      <header className="topbar">
        <div className="topbar-left">
          <span className="dot big-dot" style={{ background: team.color }} />
          <div>
            <div className="brand">{team.name}</div>
            <div className="muted small">Capt. {team.captain} — your private dashboard</div>
          </div>
        </div>
        <nav className="tabs">
          <button className={`tab${tab === 'live' ? ' active' : ''}`} onClick={() => setTab('live')}>Live</button>
          <button className={`tab${tab === 'squad' ? ' active' : ''}`} onClick={() => setTab('squad')}>My squad</button>
          <button className={`tab${tab === 'pool' ? ' active' : ''}`} onClick={() => setTab('pool')}>Pool & watchlist</button>
        </nav>
        <div className="topbar-right">
          <ConnectionDot connected={connected} />
          <button className="btn ghost" onClick={() => { clearSession(); refresh(); navigate('/'); }}>Exit</button>
        </div>
      </header>

      <OfflineBanner connected={connected} />
      <MoneyBar state={state} teamId={team.id} />

      <main className="team-main">
        {tab === 'live' && <LiveTab state={state} teamId={team.id} watchlist={watchlist} />}
        {tab === 'squad' && <SquadTab state={state} teamId={team.id} />}
        {tab === 'pool' && <PoolTab state={state} teamId={team.id} watchlist={watchlist} />}
      </main>
    </div>
  );
}

function MoneyBar({ state, teamId }: { state: StateView; teamId: string }) {
  const team = state.teams.find((t) => t.id === teamId)!;
  const slotsLeft = Math.max(0, state.settings.minSquad - team.count);
  return (
    <div className="money-bar">
      <div className="money-cell">
        <div className="money-value">{fmt(team.remaining)}</div>
        <div className="money-label">Remaining</div>
      </div>
      <div className="money-cell">
        <div className="money-value">{fmt(team.spent)}</div>
        <div className="money-label">Spent</div>
      </div>
      <div className="money-cell">
        <div className="money-value">{team.count}<span className="muted">/{state.settings.maxSquad}</span></div>
        <div className="money-label">Squad{slotsLeft > 0 ? ` (${slotsLeft} more needed)` : ''}</div>
      </div>
      <div className="money-cell accent">
        <div className="money-value">{team.full ? '—' : fmt(team.maxBid)}</div>
        <div className="money-label">Max next bid</div>
      </div>
    </div>
  );
}

function LiveTab({ state, teamId, watchlist }: { state: StateView; teamId: string; watchlist: Record<string, WatchlistEntry> }) {
  const run = useAction();
  const [bidding, setBidding] = useState(false);
  const team = state.teams.find((t) => t.id === teamId)!;
  const lot = state.lot;
  const player = lot ? state.players.find((p) => p.id === lot.playerId) : null;
  const timer = useCountdown(lot?.timerEndsAt ?? null, state.serverTime);
  const myBidState = lot?.teamBidState.find((x) => x.teamId === teamId);
  const leading = lot?.leadingTeamId === teamId;
  const wl = player ? watchlist[player.id] : undefined;

  return (
    <div className="live-grid">
      <div>
        {state.stage === 'setup' && (
          <div className="card center-note">
            <h2>Waiting for the auction to start…</h2>
            <p className="muted">Use “Pool & watchlist” to plan: star targets and set your private max prices.</p>
          </div>
        )}
        {state.stage === 'completed' && <div className="card center-note"><h2>🏁 Auction complete</h2><p className="muted">Check “My squad” for your final roster.</p></div>}
        {(state.stage === 'live' || state.stage === 'accelerated') && !player && (
          <div className="card center-note">
            <h2>Between lots</h2>
            <p className="muted">The auctioneer is drawing the next player…</p>
          </div>
        )}
        {player && lot && (
          <div className={`card lot-card${leading ? ' you-lead' : ''}`}>
            <div className="lot-head">
              <div>
                <TierBadge state={state} tierKey={player.tierKey} /> <PlayerBadges player={player} />
                <h1 className="lot-name">{player.name}</h1>
                <div className="muted">{player.role || '—'} · base {fmt(player.basePrice)} pts</div>
                {wl && (wl.starred || wl.targetPrice != null) && (
                  <div className="wl-hint">
                    ⭐ On your watchlist{wl.targetPrice != null ? ` — your target: ${fmt(wl.targetPrice)} pts` : ''}
                    {wl.targetPrice != null && lot.currentBid !== null && lot.currentBid >= wl.targetPrice ? ' (passed!)' : ''}
                  </div>
                )}
              </div>
              <div className="lot-bid-box">
                {timer !== null && <div className={`hammer-timer${timer <= 3 ? ' urgent' : ''}`}>{timer}s</div>}
                <div className="lot-bid-amount">{lot.currentBid !== null ? fmt(lot.currentBid) : `Opens at ${fmt(player.basePrice)}`}</div>
                <div className="lot-bid-team">
                  {leading
                    ? '✅ YOU are leading'
                    : lot.leadingTeamId
                      ? `${state.teams.find((t) => t.id === lot.leadingTeamId)?.name} leads`
                      : 'No bids yet'}
                </div>
              </div>
            </div>
            <StatsGrid stats={player.stats} />
            {player.notes && <p className="notes">{player.notes}</p>}

            {state.settings.bidderBidding ? (
              <button
                className={`btn primary bid-big${leading ? ' leading' : ''}`}
                disabled={!myBidState?.canBid || bidding}
                onClick={async () => {
                  // Quote the lot and the exact amount on the button: if the
                  // auction moved on (or a rival bid landed first), the server
                  // rejects instead of bidding blind on the wrong thing.
                  setBidding(true);
                  try {
                    await run(() => api.post('/api/team/bid', { lotId: lot.id, amount: lot.nextMinBid }));
                  } finally {
                    setBidding(false);
                  }
                }}
              >
                {leading
                  ? 'You lead — waiting for a counter-bid'
                  : myBidState?.canBid
                    ? `BID ${fmt(lot.nextMinBid)} PTS`
                    : myBidState?.reason ?? 'Cannot bid'}
              </button>
            ) : (
              <p className="muted small center-note">Call your bids out to the auctioneer — device bidding is off.</p>
            )}
            {!team.full && myBidState?.canBid === false && !leading && myBidState.reason?.startsWith('Exceeds') && (
              <p className="muted small">The next bid would break your purse guardrail (max {fmt(team.maxBid)} pts).</p>
            )}
          </div>
        )}

        {lot && lot.bids.length > 0 && (
          <div className="card">
            <h3>Bidding on this player</h3>
            {[...lot.bids].reverse().slice(0, 8).map((b, i) => {
              const t = state.teams.find((x) => x.id === b.teamId);
              return (
                <div key={lot.bids.length - i} className={`bid-row${i === 0 ? ' leading' : ''}`}>
                  <span className="dot" style={{ background: t?.color }} />
                  <span>{t?.id === teamId ? 'You' : t?.name}</span>
                  <span className="bid-amt">{fmt(b.amount)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <RivalsCard state={state} teamId={teamId} />
        <RecentSales state={state} teamId={teamId} />
      </div>
    </div>
  );
}

function RivalsCard({ state, teamId }: { state: StateView; teamId: string }) {
  return (
    <div className="card">
      <h3>All purses</h3>
      <table className="table">
        <thead><tr><th>Team</th><th>Left</th><th>Squad</th></tr></thead>
        <tbody>
          {state.teams.map((t) => (
            <tr key={t.id} className={t.id === teamId ? 'row-you' : ''}>
              <td><span className="dot" style={{ background: t.color }} /> {t.id === teamId ? `${t.name} (you)` : t.name}</td>
              <td className="num">{fmt(t.remaining)}</td>
              <td className="num">{t.count}/{state.settings.maxSquad}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentSales({ state, teamId }: { state: StateView; teamId: string }) {
  const sold = state.players
    .filter((p) => p.status === 'sold')
    .sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
    .slice(0, 8);
  if (sold.length === 0) return null;
  return (
    <div className="card">
      <h3>Top sales so far</h3>
      {sold.map((p) => {
        const t = state.teams.find((x) => x.id === p.teamId);
        return (
          <div key={p.id} className="bid-row">
            <span className="dot" style={{ background: t?.color }} />
            <span>{p.name}</span>
            <span className="muted small">{t?.id === teamId ? 'you' : t?.name}</span>
            <span className="bid-amt">{fmt(p.price)}</span>
          </div>
        );
      })}
    </div>
  );
}

function SquadTab({ state, teamId }: { state: StateView; teamId: string }) {
  const team = state.teams.find((t) => t.id === teamId)!;
  const roster = state.players
    .filter((p) => p.status === 'sold' && p.teamId === teamId)
    .sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  return (
    <div className="card">
      <h2 style={{ color: team.color }}>{team.name} — {roster.length} bought</h2>
      <p className="muted small">Plus captain {team.captain}. Spent {fmt(team.spent)} of {fmt(team.purse)} pts.</p>
      {roster.length === 0 ? (
        <p className="muted">No players yet — your spends will appear here the moment the hammer falls.</p>
      ) : (
        <table className="table">
          <thead><tr><th>Player</th><th>Role</th><th>Tier</th><th>Price</th><th>How</th></tr></thead>
          <tbody>
            {roster.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="muted">{p.role}</td>
                <td><TierBadge state={state} tierKey={p.tierKey} /></td>
                <td className="num">{fmt(p.price)}</td>
                <td className="muted small">{p.round === 'main' ? 'auction' : p.round}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PoolTab({ state, teamId, watchlist }: { state: StateView; teamId: string; watchlist: Record<string, WatchlistEntry> }) {
  const run = useAction();
  const [filter, setFilter] = useState<'all' | 'available' | 'starred'>('available');
  const [editing, setEditing] = useState<PlayerView | null>(null);

  const players = useMemo(() => {
    let list = [...state.players];
    if (filter === 'available') list = list.filter((p) => p.status !== 'sold');
    if (filter === 'starred') list = list.filter((p) => watchlist[p.id]?.starred);
    const tierOrder = new Map(state.settings.tiers.map((t) => [t.key, t.order]));
    return list.sort((a, b) => (tierOrder.get(a.tierKey) ?? 99) - (tierOrder.get(b.tierKey) ?? 99) || (a.demandRank ?? 99) - (b.demandRank ?? 99));
  }, [state.players, filter, watchlist, state.settings.tiers]);

  const toggleStar = (p: PlayerView) => {
    const cur = watchlist[p.id];
    run(() => api.put(`/api/team/watchlist/${p.id}`, {
      starred: !cur?.starred,
      targetPrice: cur?.targetPrice ?? null,
      note: cur?.note ?? '',
    }));
  };

  return (
    <div className="card">
      <div className="row space-between wrap">
        <h2>Player pool</h2>
        <div className="row">
          {(['available', 'starred', 'all'] as const).map((f) => (
            <button key={f} className={`tab${filter === f ? ' active' : ''}`} onClick={() => setFilter(f)}>
              {f === 'available' ? 'Still to buy' : f === 'starred' ? '⭐ Watchlist' : 'Everyone'}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small">⭐ stars, target prices and notes are private to your team — nobody else can see them.</p>
      <table className="table pool-table">
        <thead><tr><th></th><th>Player</th><th>Tier</th><th>Role</th><th>Base</th><th>My target</th><th>Status</th></tr></thead>
        <tbody>
          {players.map((p) => {
            const wl = watchlist[p.id];
            const soldTo = p.teamId ? state.teams.find((t) => t.id === p.teamId) : null;
            return (
              <tr key={p.id} className={p.status === 'sold' ? 'row-dim' : ''}>
                <td><button className={`star${wl?.starred ? ' on' : ''}`} onClick={() => toggleStar(p)}>{wl?.starred ? '⭐' : '☆'}</button></td>
                <td onClick={() => setEditing(p)} className="clickable">
                  {p.name} <PlayerBadges player={p} />
                  {wl?.note ? <div className="muted small">📝 {wl.note}</div> : null}
                </td>
                <td><TierBadge state={state} tierKey={p.tierKey} /></td>
                <td className="muted small">{p.role}</td>
                <td className="num">{fmt(p.basePrice)}</td>
                <td className="num">{wl?.targetPrice != null ? fmt(wl.targetPrice) : '—'}</td>
                <td>
                  {p.status === 'sold'
                    ? <span className="muted small">{soldTo?.id === teamId ? '✅ yours' : `→ ${soldTo?.name}`} ({fmt(p.price)})</span>
                    : <span className={`status status-${p.status}`}>{p.status}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editing && (
        <WatchlistModal
          state={state}
          player={editing}
          entry={watchlist[editing.id]}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function WatchlistModal({ state, player, entry, onClose }: {
  state: StateView; player: PlayerView; entry?: WatchlistEntry; onClose: () => void;
}) {
  const run = useAction();
  const [starred, setStarred] = useState(entry?.starred ?? false);
  const [target, setTarget] = useState(entry?.targetPrice != null ? String(entry.targetPrice) : '');
  const [note, setNote] = useState(entry?.note ?? '');

  return (
    <Modal title={player.name} onClose={onClose}>
      <div className="row" style={{ marginBottom: 8 }}>
        <TierBadge state={state} tierKey={player.tierKey} />
        <span className="muted">{player.role} · base {fmt(player.basePrice)} pts</span>
      </div>
      <StatsGrid stats={player.stats} compact />
      {player.notes && <p className="notes">{player.notes}</p>}
      <hr className="sep" />
      <p className="muted small">Private planning — only your team sees this.</p>
      <label className="check">
        <input type="checkbox" checked={starred} onChange={(e) => setStarred(e.target.checked)} /> ⭐ On my watchlist
      </label>
      <div className="form-grid">
        <label>My max price (pts)<input className="input" type="number" value={target} onChange={(e) => setTarget(e.target.value)} /></label>
        <label>Note<input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></label>
      </div>
      <div className="row end">
        <button className="btn primary" onClick={() => run(async () => {
          await api.put(`/api/team/watchlist/${player.id}`, {
            starred,
            targetPrice: target.trim() === '' ? null : Number(target),
            note,
          });
          onClose();
        }, 'Saved')}>
          Save
        </button>
      </div>
    </Modal>
  );
}
