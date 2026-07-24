import { useMemo, useState } from 'react';
import { api } from '../api';
import { StateView } from '../types';
import {
  fmt, formatClock, PlayerBadges, PlayerPhoto, StatsGrid, TIMEOUT_COUNTDOWN_MS, TierBadge, useAction, useCountdown,
} from '../ui';

export default function AuctionConsole({ state }: { state: StateView }) {
  const run = useAction();
  const lotPlayer = state.lot ? state.players.find((p) => p.id === state.lot!.playerId) : null;

  return (
    <div className="console">
      <StageBar state={state} />
      <div className="console-grid">
        <div className="console-left">
          {state.stage === 'setup' && <SetupPanel state={state} />}
          {(state.stage === 'live' || state.stage === 'accelerated') &&
            (lotPlayer
              ? <LotCard state={state} />
              : state.timeout
                ? <TimeoutPanel state={state} />
                : <BetweenLots state={state} />)}
          {state.stage === 'completed' && <ResultsPanel state={state} />}
        </div>
        <div className="console-right">
          {state.lot && lotPlayer && <BidPanel state={state} />}
          <PurseTable state={state} />
          {state.undoLabel && (
            <button
              className="btn warn wide"
              onClick={() => run(() => api.post('/api/admin/auction/undo'), 'Undone')}
            >
              ↩ {state.undoLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Set arithmetic for the every-N-players timeout cycle (main round only). */
function setInfo(state: StateView) {
  const every = state.settings.timeoutEvery;
  const count = state.phase.auctionedInMain;
  if (every <= 0) return null;
  return {
    every,
    inSet: count % every,                    // players auctioned in the running set
    setNumber: Math.floor(count / every) + 1, // set currently being auctioned
    untilBreak: every - (count % every),
  };
}

function StageBar({ state }: { state: StateView }) {
  const sets = state.stage === 'live' ? setInfo(state) : null;
  const showTier = state.settings.showTier !== false;
  return (
    <div className="stagebar">
      {showTier && state.progress.perTier.map((t) => {
        const tier = state.settings.tiers.find((x) => x.key === t.tierKey);
        const active = state.currentTierKey === t.tierKey && (state.stage === 'live');
        return (
          <div key={t.tierKey} className={`tier-chip${active ? ' active' : ''}`} style={{ borderColor: tier?.color }}>
            <span style={{ color: tier?.color }}>{t.name}</span>
            <span className="muted">{t.sold}/{t.total} sold{t.unsold ? ` · ${t.unsold} unsold` : ''}</span>
          </div>
        );
      })}
      <div className="tier-chip">
        <span>Total</span>
        <span className="muted">{state.progress.sold}/{state.progress.total} sold</span>
      </div>
      {sets && (
        <div className={`tier-chip${state.timeout ? ' timeout-chip' : ''}`}>
          <span>{state.timeout ? '⏸ Timeout' : `Set ${sets.setNumber}`}</span>
          <span className="muted">
            {state.timeout ? 'auction paused' : `${sets.inSet}/${sets.every} auctioned`}
          </span>
        </div>
      )}
    </div>
  );
}

function SetupPanel({ state }: { state: StateView }) {
  const run = useAction();
  return (
    <div className="card">
      <h2>Ready to start</h2>
      <p className="muted">
        {state.progress.total} players · {state.teams.length} teams · purse {fmt(state.settings.purse)} pts ·
        squads {state.settings.minSquad}–{state.settings.maxSquad} ·
        increments {state.settings.increments.map((r) => `+${r.step}${r.upTo ? ` to ${fmt(r.upTo)}` : ' above'}`).join(', ')}
      </p>
      <p className="muted small">
        Round order: {state.settings.tiers.map((t) => t.name).join(' → ')}. Players are drawn at random within each tier (digital chit draw).
        Check Players / Teams / Settings tabs first — everything can still be edited later.
      </p>
      <button className="btn primary big" onClick={() => run(() => api.post('/api/admin/auction/start'), 'Auction is live!')}>
        ▶ Start the auction
      </button>
    </div>
  );
}

function TimeoutPanel({ state }: { state: StateView }) {
  const run = useAction();
  const t = state.timeout!;
  const every = state.settings.timeoutEvery;
  const secs = useCountdown(t.startedAt + TIMEOUT_COUNTDOWN_MS, state.serverTime);
  const finished = secs !== null && secs <= 0;
  return (
    <div className="card timeout-card">
      <h2>⏸ Strategic timeout</h2>
      <div className={`timeout-timer${finished ? ' done' : ''}`} role="timer" aria-live="off">
        {finished
          ? 'Countdown finished'
          : `⏱ ${formatClock(secs ?? Math.round(TIMEOUT_COUNTDOWN_MS / 1000))} remaining`}
      </div>
      <p className="muted">
        {t.setNumber !== null
          ? `Set ${t.setNumber} complete — ${every} players auctioned. `
          : 'Break called by the auctioneer. '}
        {state.phase.remainingInPhase > 0
          ? `${state.phase.remainingInPhase} player(s) still in the pool.`
          : 'No players left in this round.'}
        {' '}Every screen is showing the team standings until you resume.
      </p>
      <div className="results-grid">
        {state.teams.map((team) => {
          const roster = state.players
            .filter((p) => p.status === 'sold' && p.teamId === team.id)
            .sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
          return (
            <div key={team.id} className="result-team" style={{ borderColor: team.color }}>
              <h3 style={{ color: team.color }}>{team.name}</h3>
              <div className="muted small">
                {fmt(team.remaining)} pts left · {team.count}/{state.settings.maxSquad} players
                {team.full ? ' · FULL' : ` · max bid ${fmt(team.maxBid)}`}
              </div>
              <ul>
                {roster.length === 0 && <li className="muted">No players yet</li>}
                {roster.map((p) => (
                  <li key={p.id}>{p.name} <span className="muted">({fmt(p.price)})</span></li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <button className="btn primary big" onClick={() => run(() => api.post('/api/admin/auction/resume'), 'Auction resumed')}>
        ▶ Resume the auction
      </button>
    </div>
  );
}

function BetweenLots({ state }: { state: StateView }) {
  const run = useAction();
  const [pickId, setPickId] = useState('');
  const eligible = useMemo(() => {
    if (state.stage === 'accelerated') return state.players.filter((p) => p.status === 'unsold');
    return state.players.filter((p) => p.status === 'available');
  }, [state]);
  const phaseDone = state.phase.remainingInPhase === 0;
  const sets = state.stage === 'live' ? setInfo(state) : null;
  const showTier = state.settings.showTier !== false;

  return (
    <div className="card">
      {!phaseDone ? (
        <>
          <h2>{state.stage === 'accelerated' ? 'Accelerated round' : 'Next lot'}</h2>
          <p className="muted">
            {state.phase.remainingInPhase} player(s) left in this {state.stage === 'accelerated' ? 'pass' : 'round'}.
            {sets && ` Strategic timeout after ${sets.untilBreak} more player${sets.untilBreak === 1 ? '' : 's'} (set ${sets.setNumber}: ${sets.inSet}/${sets.every}).`}
          </p>
          <button className="btn primary big" onClick={() => run(() => api.post('/api/admin/auction/next'))}>
            🎲 Draw next player
          </button>
          <div className="row" style={{ marginTop: 12 }}>
            <select className="input" value={pickId} onChange={(e) => setPickId(e.target.value)}>
              <option value="">…or pick a specific player</option>
              {eligible.map((p) => (
                <option key={p.id} value={p.id}>
                  {showTier ? `${p.name} (${state.settings.tiers.find((t) => t.key === p.tierKey)?.name ?? p.tierKey})` : p.name}
                </option>
              ))}
            </select>
            <button
              className="btn"
              disabled={!pickId}
              onClick={() => run(() => api.post('/api/admin/auction/next', { playerId: pickId }).then(() => setPickId('')))}
            >
              Put up
            </button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn ghost"
              onClick={() => run(() => api.post('/api/admin/auction/timeout'), 'Strategic timeout')}
            >
              ⏸ Call a strategic timeout now
            </button>
          </div>
        </>
      ) : (
        <PhaseEnd state={state} />
      )}
    </div>
  );
}

function PhaseEnd({ state }: { state: StateView }) {
  const run = useAction();
  const unsold = state.phase.unsold;
  return (
    <>
      <h2>{state.stage === 'accelerated' ? 'Accelerated pass complete' : 'Main round complete'}</h2>
      {unsold > 0 ? (
        <>
          <p className="muted">{unsold} player(s) unsold: {state.players.filter((p) => p.status === 'unsold').map((p) => p.name).join(', ')}.</p>
          <div className="stack">
            <button className="btn primary" onClick={() => run(() => api.post('/api/admin/auction/accelerated'), 'Accelerated round started')}>
              ⚡ {state.stage === 'accelerated' ? 'Run another accelerated pass' : 'Start accelerated round'}
            </button>
            <button
              className="btn"
              onClick={() => run(() => api.post('/api/admin/auction/allot'), 'Unsold players allotted at base price')}
            >
              📋 Auto-allot unsold at base price (largest purse first)
            </button>
            <p className="muted small">Auto-allot follows rule 8: each unsold player goes at base price to the open-slot team with the largest remaining purse (teams below the minimum first). You can also assign manually from the Players tab.</p>
          </div>
        </>
      ) : (
        <p className="muted">Every player in the pool is sold. 🎉</p>
      )}
      <button
        className="btn ok big"
        style={{ marginTop: 12 }}
        onClick={() => run(() => api.post('/api/admin/auction/complete', { force: unsold > 0 }), 'Auction completed')}
      >
        🏁 Complete the auction{unsold > 0 ? ' (force)' : ''}
      </button>
    </>
  );
}

function LotCard({ state }: { state: StateView }) {
  const player = state.players.find((p) => p.id === state.lot!.playerId)!;
  const lot = state.lot!;
  const leading = lot.leadingTeamId ? state.teams.find((t) => t.id === lot.leadingTeamId) : null;
  const timer = useCountdown(lot.timerEndsAt, state.serverTime);

  return (
    <div className="card lot-card">
      <div className="lot-head">
        <div className="lot-id">
          <PlayerPhoto url={player.photoUrl} name={player.name} size="md" />
          <div>
            <TierBadge state={state} tierKey={player.tierKey} /> <PlayerBadges player={player} />
            <h1 className="lot-name">{player.name}</h1>
            <div className="muted">{player.role || '—'} · base {fmt(player.basePrice)} pts</div>
          </div>
        </div>
        <div className="lot-bid-box">
          {timer !== null && <div className={`hammer-timer${timer <= 3 ? ' urgent' : ''}`}>{timer}s</div>}
          <div className="lot-bid-amount">{lot.currentBid !== null ? fmt(lot.currentBid) : `Opens at ${fmt(player.basePrice)}`}</div>
          <div className="lot-bid-team" style={{ color: leading?.color }}>
            {leading ? `${leading.name} leads` : 'No bids yet'}
          </div>
        </div>
      </div>
      <StatsGrid stats={player.stats} />
      {player.notes && <p className="notes">{player.notes}</p>}
      <BidHistory state={state} />
    </div>
  );
}

function BidHistory({ state }: { state: StateView }) {
  const lot = state.lot!;
  if (lot.bids.length === 0) return null;
  const items = [...lot.bids].reverse().slice(0, 12);
  return (
    <div className="bid-history">
      {items.map((b, i) => {
        const team = state.teams.find((t) => t.id === b.teamId);
        return (
          <div key={lot.bids.length - i} className={`bid-row${i === 0 ? ' leading' : ''}`}>
            <span className="dot" style={{ background: team?.color }} />
            <span>{team?.name ?? b.teamId}</span>
            <span className="muted small">
              {b.by === 'team' ? 'captain' : 'auctioneer'}
              {b.deviceTag ? ` · #${b.deviceTag}` : ''}
            </span>
            <span className="bid-amt">{fmt(b.amount)}</span>
          </div>
        );
      })}
    </div>
  );
}

function BidPanel({ state }: { state: StateView }) {
  const run = useAction();
  const lot = state.lot!;
  const [customTeam, setCustomTeam] = useState('');
  const [customAmount, setCustomAmount] = useState('');

  // Every bid quotes the lot id and the exact amount shown on the button, so a
  // tap can never land on a different player (or price) than the one on screen.
  const bid = (teamId: string, amount?: number) =>
    run(() => api.post('/api/admin/auction/bid', { teamId, lotId: lot.id, amount: amount ?? lot.nextMinBid }));

  return (
    <div className="card bid-panel">
      <h3>Record a bid — next min {fmt(lot.nextMinBid)}</h3>
      <div className="bid-buttons">
        {state.teams.map((t) => {
          const bs = lot.teamBidState.find((x) => x.teamId === t.id);
          const disabled = !bs?.canBid;
          return (
            <button
              key={t.id}
              className="btn bid-btn"
              style={{ borderColor: t.color, color: disabled ? undefined : t.color }}
              disabled={disabled}
              title={bs?.reason ?? ''}
              onClick={() => bid(t.id)}
            >
              <span className="bid-btn-name">{t.name}</span>
              <span className="bid-btn-amt">{disabled ? (bs?.reason?.includes('leading') ? 'LEADING' : 'OUT') : fmt(lot.nextMinBid)}</span>
            </button>
          );
        })}
      </div>
      <div className="row">
        <select className="input" value={customTeam} onChange={(e) => setCustomTeam(e.target.value)}>
          <option value="">Custom bid: team…</option>
          {state.teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <input
          className="input"
          type="number"
          placeholder="amount"
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
          min={lot.nextMinBid}
        />
        <button
          className="btn"
          disabled={!customTeam || !customAmount}
          onClick={() => {
            bid(customTeam, Number(customAmount));
            setCustomAmount('');
          }}
        >
          Bid
        </button>
      </div>
      <div className="row hammer-row">
        <button
          className="btn ok big grow"
          disabled={!lot.leadingTeamId}
          onClick={() => run(() => api.post('/api/admin/auction/sold', {
            // Hammer guard: sell exactly what is on this screen — if a bid
            // slips in between glance and tap, the server rejects the hammer.
            lotId: lot.id,
            expectedTeamId: lot.leadingTeamId,
            expectedPrice: lot.currentBid,
          }))}
        >
          🔨 SOLD {lot.currentBid ? `· ${fmt(lot.currentBid)}` : ''}
        </button>
        <button
          className="btn warn"
          disabled={lot.bids.length > 0}
          title={lot.bids.length > 0 ? 'There is a standing bid' : ''}
          onClick={() => run(() => api.post('/api/admin/auction/unsold', { lotId: lot.id }))}
        >
          UNSOLD
        </button>
      </div>
      <div className="row">
        <button className="btn ghost" disabled={lot.bids.length === 0} onClick={() => run(() => api.post('/api/admin/auction/undo-bid', { lotId: lot.id }))}>
          ↩ Undo last bid
        </button>
        <button className="btn ghost" onClick={() => run(() => api.post('/api/admin/auction/cancel-lot'))}>
          Cancel lot
        </button>
        {[10, 20].map((s) => (
          <button key={s} className="btn ghost" onClick={() => run(() => api.post('/api/admin/auction/timer', { seconds: s }))}>
            ⏱ {s}s
          </button>
        ))}
        {lot.timerEndsAt && (
          <button className="btn ghost" onClick={() => run(() => api.post('/api/admin/auction/timer', { seconds: 0 }))}>
            Clear ⏱
          </button>
        )}
      </div>
    </div>
  );
}

function PurseTable({ state }: { state: StateView }) {
  return (
    <div className="card">
      <h3>Live purse tracker</h3>
      <table className="table">
        <thead>
          <tr><th>Team</th><th>Left</th><th>Squad</th><th>Max bid</th></tr>
        </thead>
        <tbody>
          {state.teams.map((t) => (
            <tr key={t.id} className={t.full ? 'row-dim' : ''}>
              <td><span className="dot" style={{ background: t.color }} /> {t.name}{t.full ? ' ✅' : ''}</td>
              <td className="num">{fmt(t.remaining)}</td>
              <td className="num">{t.count}/{state.settings.maxSquad}</td>
              <td className="num">{t.full ? '—' : fmt(t.maxBid)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Max bid = remaining − {state.settings.reservePerSlot} × slots still needed to reach {state.settings.minSquad}.</p>
    </div>
  );
}

function ResultsPanel({ state }: { state: StateView }) {
  const run = useAction();
  return (
    <div className="card">
      <h2>🏁 Auction complete</h2>
      <div className="results-grid">
        {state.teams.map((t) => (
          <div key={t.id} className="result-team" style={{ borderColor: t.color }}>
            <h3 style={{ color: t.color }}>{t.name}</h3>
            <div className="muted small">Capt. {t.captain} · spent {fmt(t.spent)} · left {fmt(t.remaining)}</div>
            <ul>
              {state.players
                .filter((p) => p.teamId === t.id && p.status === 'sold')
                .sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
                .map((p) => (
                  <li key={p.id}>
                    {p.name} <span className="muted">({fmt(p.price)})</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="muted small">Export the full results from Settings → Data. Need to fix something? Undo, or release a player from the Players tab.</p>
      <button className="btn warn" onClick={() => run(() => api.post('/api/admin/auction/undo'), 'Reopened')}>
        ↩ Reopen the auction (undo complete)
      </button>
    </div>
  );
}
