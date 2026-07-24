import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store';
import { LotView, PlayerView, StateView, Tier } from '../types';
import {
  fmt, formatClock, OfflineBanner, PlayerPhoto, SCREEN_BID_MUTE_KEY, statVal, TIMEOUT_COUNTDOWN_MS,
  useBidSound, useCountdown,
} from '../ui';
import '../screen.css';

/* Animation keying discipline (see screen.css header):
   keyed-by: player | bid | team | event — remounts drive entry animations;
   ambient loops live on stable elements that never remount. */

const vars = (v: Record<string, string | number>): CSSProperties => v as CSSProperties;

function rgbTriplet(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '148, 163, 184';
  const n = parseInt(m[1], 16);
  return `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Light team colors (amber, emerald, the gold tier) need near-black ink on top —
 *  white text blooms unreadably on a projector over those fills. */
function darkInk(hex?: string | null): boolean {
  if (!hex) return false;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 >= 127;
}

interface FlashInfo {
  id: number;
  kind: 'sold' | 'unsold';
  player: PlayerView;
  teamName?: string;
  teamColor?: string;
  price?: number;
}

export default function ScreenPage() {
  const { state, connected } = useApp();
  // Chime on each new bid; the projector keeps its own mute preference,
  // independent of the auctioneer's console.
  const { muted, toggleMuted } = useBidSound(state?.lot ?? null, SCREEN_BID_MUTE_KEY);
  const [flash, setFlash] = useState<FlashInfo | null>(null);
  const prevRef = useRef<StateView | null>(null);
  const flashIdRef = useRef(0);

  // Track each team's previous purse so the footer can float a "−1,200" delta.
  // Read during render (holds last render's values), updated after commit.
  const prevPurseRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!state) return;
    const m: Record<string, number> = {};
    for (const t of state.teams) m[t.id] = t.remaining;
    prevPurseRef.current = m;
  }, [state]);

  // Detect SOLD / UNSOLD transitions to run the takeover sequence.
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!prev || !state) return;
    for (const p of state.players) {
      const old = prev.players.find((x) => x.id === p.id);
      if (!old) continue;
      if (old.status !== 'sold' && p.status === 'sold' && (p.round === 'main' || p.round === 'accelerated')) {
        const team = state.teams.find((t) => t.id === p.teamId);
        setFlash({
          id: ++flashIdRef.current,
          kind: 'sold',
          player: p,
          teamName: team?.name,
          teamColor: team?.color,
          price: p.price ?? undefined,
        });
        return;
      }
      if (old.status === 'available' && p.status === 'unsold') {
        setFlash({ id: ++flashIdRef.current, kind: 'unsold', player: p });
        return;
      }
    }
  }, [state]);

  // The exit fade is baked into CSS at 3450ms; this only unmounts afterwards.
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash((f) => (f?.id === flash.id ? null : f)), 4000);
    return () => clearTimeout(id);
  }, [flash]);

  if (!state) return <div className="page-loading">Connecting…</div>;

  const showTier = state.settings.showTier !== false;
  const lot = state.lot;
  const lotPlayer = lot ? state.players.find((p) => p.id === lot.playerId) ?? null : null;
  const tierKey = lotPlayer?.tierKey ?? state.currentTierKey ?? state.settings.tiers[0]?.key;
  const tier = state.settings.tiers.find((t) => t.key === tierKey);
  // Keep the accent color for ambient theming even when tier names are hidden.
  const tierColor = tier?.color ?? '#4f7cff';
  const leading = lot?.leadingTeamId ? state.teams.find((t) => t.id === lot.leadingTeamId) ?? null : null;
  const leadColor = leading?.color ?? tierColor;

  const stageLabel =
    state.timeout ? 'Strategic timeout'
    : state.stage === 'setup' ? 'Starting soon'
    : state.stage === 'live'
      ? (showTier ? `${state.settings.tiers.find((t) => t.key === state.currentTierKey)?.name ?? 'Live'} round` : 'Live round')
    : state.stage === 'accelerated' ? 'Accelerated round'
    : 'Auction complete';

  return (
    <div
      className="scr-page"
      style={vars({
        '--tier': tierColor,
        '--tier-rgb': rgbTriplet(tierColor),
        '--lead': leadColor,
        '--lead-on': leading ? 0.07 : 0,
      })}
    >
      {/* stable — ambient loops must never restart */}
      <div className="scr-ambient" aria-hidden>
        <div className="scr-beam a" />
        <div className="scr-beam b" />
        <div className="scr-gridlines" />
        <div className="scr-leadtint" />
        <div className="scr-vignette" />
      </div>

      <header className="scr-head">
        <Link to="/" className="scr-brand">
          <span className="scr-brand-bar" />
          {state.settings.auctionName}
        </Link>
        <div
          className="scr-stagechip"
          key={`${state.stage}-${state.currentTierKey ?? ''}${state.timeout ? '-to' : ''}`}
          data-stage={state.timeout ? 'timeout' : state.stage}
        >
          {stageLabel}
        </div>
        <div className="scr-head-right">
          <button
            type="button"
            className={`scr-sound${muted ? ' muted' : ''}`}
            onClick={toggleMuted}
            aria-pressed={!muted}
            aria-label={muted ? 'Bid sound is off — click to turn it on' : 'Bid sound is on — click to mute'}
            title={muted ? 'Bid sound off' : 'Bid sound on'}
          >
            {muted ? '🔇' : '🔔'}
          </button>
          <div className={`scr-live${connected ? '' : ' off'}`}>
            <span className="scr-live-dot"><i /><i /></span>
            {connected ? 'LIVE' : 'OFFLINE'}
          </div>
        </div>
      </header>

      <OfflineBanner connected={connected} />

      <main className="scr-main">
        {state.stage === 'completed'
          ? <FinalBoard state={state} />
          : lot && lotPlayer
            ? <ScreenLot state={state} lot={lot} player={lotPlayer} tier={showTier ? tier : undefined} leading={leading} />
            : state.timeout
              ? <TimeoutBoard state={state} />
              : <ScreenIdle state={state} showTier={showTier} />}
      </main>

      <TeamsFooter state={state} leadingId={leading?.id ?? null} prevPurse={prevPurseRef.current} />

      {flash && <FlashOverlay key={flash.id} flash={flash} />}
    </div>
  );
}

/* ---------------- live lot ---------------- */

function ScreenLot({ state, lot, player, tier, leading }: {
  state: StateView;
  lot: LotView;
  player: PlayerView;
  tier?: Tier;
  leading: { id: string; name: string; color: string } | null;
}) {
  const { secs, frac } = useHammer(lot.timerEndsAt, state.serverTime);
  const amount = lot.currentBid ?? player.basePrice;

  return (
    <div className="scr-lot">
      <PlayerPanel key={player.id} player={player} tier={tier} />

      <div className="scr-theatre">
        {leading && <div key={`edge-${lot.id}-${leading.id}`} className="scr-edgeflash" aria-hidden />}
        <div className="scr-theatre-top">
          <div className="scr-takeover" key={`${lot.id}-${leading?.id ?? 'open'}`}>
            <div className="scr-eyebrow">{leading ? 'Current bid' : 'Opening price'}</div>
            <div className="scr-amount-wrap" key={`${lot.id}-${amount}`}>
              <div className="scr-amount">{fmt(amount)}</div>
              <i className="scr-shockwave" aria-hidden />
            </div>
            <div className={`scr-plate${leading ? (darkInk(leading.color) ? ' dark-ink' : '') : ' open'}`}>
              <span>{leading ? `Leading — ${leading.name}` : 'Who will open the bidding?'}</span>
            </div>
          </div>
          {secs !== null && <CountdownRing secs={secs} frac={frac} />}
        </div>
        <div className="scr-nextmin">Next bid ≥ <b>{fmt(lot.nextMinBid)}</b></div>
        <BidFeed state={state} lot={lot} />
      </div>

      {secs !== null && secs <= 3 && <div className="scr-danger-vignette" aria-hidden />}
    </div>
  );
}

function PlayerPanel({ player, tier }: { player: PlayerView; tier?: Tier }) {
  const cells: [string, string][] = [
    ['Mat', statVal(player.stats.mat)],
    ['Runs', statVal(player.stats.runs)],
    ['Bat Avg', statVal(player.stats.batAvg)],
    ['Bat SR', statVal(player.stats.batSR)],
    ['Wkts', statVal(player.stats.wkts)],
    ['Bowl Avg', statVal(player.stats.bowlAvg)],
    ['Econ', statVal(player.stats.econ)],
    ['Best MVP', player.stats.bestMvp ?? '–'],
  ].filter(([, v]) => v !== '–') as [string, string][];

  return (
    <div className="scr-id">
      <div className="scr-photo-wrap">
        <div className="scr-photo-glow" aria-hidden />
        <div className="scr-photo-frame">
          <PlayerPhoto url={player.photoUrl} name={player.name} size="xl" />
        </div>
      </div>
      <h1 className="scr-name">{player.name}</h1>
      <div className="scr-meta">
        {tier && (
          <span className="scr-tierchip" style={{ color: tier.color, borderColor: tier.color }}>
            {tier.name}
          </span>
        )}
        {player.role && <span className="scr-rolechip">{player.role}</span>}
        {player.demandRank ? <span className="scr-badge hot">HOT #{player.demandRank}</span> : null}
        {player.sleeper && <span className="scr-badge sleeper">SLEEPER</span>}
        <span className="scr-basechip">Base {fmt(player.basePrice)}</span>
      </div>
      {cells.length > 0 ? (
        <div className="scr-stats">
          {cells.map(([label, value], i) => (
            <div key={label} className="scr-stat" style={vars({ '--i': i })}>
              <div className="scr-stat-v">{value}</div>
              <div className="scr-stat-l">{label}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="scr-debut">Debut season — no prior DPL record</div>
      )}
      {player.notes && <p className="scr-notes">{player.notes}</p>}
    </div>
  );
}

function BidFeed({ state, lot }: { state: StateView; lot: LotView }) {
  const rows = [...lot.bids].reverse().slice(0, 7);
  if (rows.length === 0) return <div className="scr-feed empty">The floor is open…</div>;
  return (
    <div className="scr-feed">
      {rows.map((b, i) => {
        const t = state.teams.find((x) => x.id === b.teamId);
        // Absolute index in the full history: old rows keep their key and
        // never remount — only the newest row plays the entry animation.
        const abs = lot.bids.length - i;
        return (
          <div key={`${lot.id}-${abs}`} className="scr-bid-row" style={vars({ '--team': t?.color ?? '#64748b' })}>
            <i className="bar" aria-hidden />
            <span className="team">{t?.name ?? '—'}</span>
            <span className="amt">{fmt(b.amount)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Countdown with clock-skew correction plus the ring fraction. The total is
 *  captured from the first tick after each timerEndsAt value, so the ring
 *  starts full no matter what duration the auctioneer chose. */
function useHammer(endsAt: number | null, serverTime: number): { secs: number | null; frac: number } {
  const skewRef = useRef(0);
  useEffect(() => {
    skewRef.current = Date.now() - serverTime;
  }, [serverTime]);
  const totalRef = useRef<{ endsAt: number; totalMs: number } | null>(null);
  const [snap, setSnap] = useState<{ secs: number | null; frac: number }>({ secs: null, frac: 0 });
  useEffect(() => {
    if (!endsAt) {
      totalRef.current = null;
      setSnap({ secs: null, frac: 0 });
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, endsAt - (Date.now() - skewRef.current));
      if (!totalRef.current || totalRef.current.endsAt !== endsAt) {
        totalRef.current = { endsAt, totalMs: Math.max(remaining, 1000) };
      }
      setSnap({ secs: Math.ceil(remaining / 1000), frac: Math.min(1, remaining / totalRef.current.totalMs) });
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [endsAt]);
  return snap;
}

function CountdownRing({ secs, frac }: { secs: number; frac: number }) {
  const R = 84;
  const C = 2 * Math.PI * R;
  return (
    <div className={`scr-ring${secs <= 3 ? ' urgent' : ''}`}>
      <svg viewBox="0 0 200 200" aria-hidden>
        <circle className="track" cx="100" cy="100" r={R} />
        <circle className="arc" cx="100" cy="100" r={R} strokeDasharray={C} strokeDashoffset={C * (1 - frac)} />
      </svg>
      <div className="scr-ring-num" key={secs}>{secs}</div>
    </div>
  );
}

/* ---------------- idle ---------------- */

function ScreenIdle({ state, showTier }: { state: StateView; showTier: boolean }) {
  const recent = state.players.filter((p) => p.status === 'sold').slice().reverse().slice(0, 12);
  const watermark = state.settings.auctionName.split(/\s+/).slice(0, 3).join(' ');
  const marquee = recent.length >= 4;
  const copies = marquee ? [0, 1] : [0];
  return (
    <div className="scr-idle">
      <div className="scr-watermark" aria-hidden>{watermark}</div>
      <div className="scr-idle-headline">
        {state.stage === 'setup' ? 'The auction begins shortly' : 'Next player coming up'}
      </div>
      {showTier && (
        <div className="scr-tierboard">
          {state.progress.perTier.map((t) => {
            const tc = state.settings.tiers.find((x) => x.key === t.tierKey)?.color ?? '#4f7cff';
            return (
              <div key={t.tierKey} className="scr-tierrow">
                <span className="tname" style={{ color: tc }}>{t.name}</span>
                <span className="tcount"><b>{t.sold}</b>/{t.total} sold</span>
                <span className="scr-tierbar">
                  <i style={vars({ '--tc': tc, transform: `scaleX(${t.total ? t.sold / t.total : 0})` })} />
                </span>
              </div>
            );
          })}
        </div>
      )}
      {state.phase.unsold > 0 && (
        <div className="scr-unsold-note">
          {state.phase.unsold} unsold player{state.phase.unsold === 1 ? '' : 's'} will return in the accelerated round
        </div>
      )}
      {recent.length > 0 && (
        <div className="scr-ticker">
          <div className="scr-ticker-label">Latest signings</div>
          <div className={`scr-ticker-track ${marquee ? 'marquee' : 'static'}`}>
            {copies.map((c) =>
              recent.map((p) => {
                const t = state.teams.find((x) => x.id === p.teamId);
                return (
                  <div key={`${p.id}-${c}`} className="scr-signing" style={vars({ '--team': t?.color ?? '#64748b' })}>
                    <PlayerPhoto url={p.photoUrl} name={p.name} size="sm" />
                    <span className="sname">{p.name}</span>
                    <span className="steam">{t?.name}</span>
                    <span className="sprice">{fmt(p.price)}</span>
                  </div>
                );
              }),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- strategic timeout board ---------------- */

/**
 * End-of-set break: the auction pauses and the room studies the state of play —
 * every purse, every squad bought so far, and how many players are still to come.
 * Stays up until the auctioneer resumes.
 */
function TimeoutBoard({ state }: { state: StateView }) {
  const t = state.timeout!;
  const poolLeft = state.phase.remainingInPhase;
  // Cosmetic countdown driven by the server-stamped start, so late-joining
  // screens land on the same reading. Falls back to the full duration for the
  // single render before the first tick, so it never flashes 0:00.
  const secs = useCountdown(t.startedAt + TIMEOUT_COUNTDOWN_MS, state.serverTime);
  const finished = secs !== null && secs <= 0;
  const shown = secs ?? Math.round(TIMEOUT_COUNTDOWN_MS / 1000);
  return (
    <div className="scr-timeout">
      <div className="scr-to-badge"><i aria-hidden />STRATEGIC TIMEOUT</div>
      <div className={`scr-to-timer${finished ? ' done' : ''}${!finished && shown <= 30 ? ' urgent' : ''}`} role="timer" aria-live="off">
        {finished ? (
          <span className="scr-to-timer-done">Countdown finished</span>
        ) : (
          <>
            <span className="scr-to-timer-clock">{formatClock(shown)}</span>
            <span className="scr-to-timer-label">Time remaining</span>
          </>
        )}
      </div>
      <div className="scr-final-sub">
        {t.setNumber !== null ? `Set ${t.setNumber} complete · ` : ''}
        {poolLeft} player{poolLeft === 1 ? '' : 's'} still in the pool
        {state.phase.unsold > 0 ? ` · ${state.phase.unsold} unsold` : ''}
      </div>
      <div className="scr-final-grid">
        {state.teams.map((team, ci) => {
          const squad = state.players
            .filter((p) => p.teamId === team.id && p.status === 'sold')
            .sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
          const frac = team.purse > 0 ? Math.max(0, Math.min(1, team.remaining / team.purse)) : 0;
          return (
            <div
              key={team.id}
              className="scr-final-col"
              style={vars({ '--i': ci, '--team': team.color, '--team-rgb': rgbTriplet(team.color) })}
            >
              <div className={`scr-final-head${darkInk(team.color) ? ' dark-ink' : ''}`} style={vars({ '--i': ci })}>
                <h3>{team.name}</h3>
                <div className="cap">Capt. {team.captain}</div>
              </div>
              <div className="scr-to-purse">
                <div className="row1">
                  <span className="label">Purse left</span>
                  <span className="amount">{fmt(team.remaining)}</span>
                </div>
                <div className="scr-fuel"><i style={{ transform: `scaleX(${frac})` }} /></div>
                <div className="row2">
                  <span>{team.count}/{state.settings.maxSquad} bought{team.full ? ' · FULL' : ''}</span>
                  {!team.full && <span>max bid {fmt(team.maxBid)}</span>}
                </div>
              </div>
              <div className="scr-final-rows">
                {squad.length === 0 && <div className="scr-final-empty">No players yet</div>}
                {squad.map((p, i) => (
                  <div
                    key={p.id}
                    className={`scr-final-row${i === 0 ? ' top-buy' : ''}`}
                    style={vars({ '--i': i, '--ci': ci })}
                  >
                    <span className="fname">{p.name}</span>
                    {i === 0 && <span className="fchip">TOP BUY</span>}
                    <span className="fprice">{fmt(p.price)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- footer ---------------- */

function TeamsFooter({ state, leadingId, prevPurse }: {
  state: StateView;
  leadingId: string | null;
  prevPurse: Record<string, number>;
}) {
  return (
    <footer className="scr-foot">
      {state.teams.map((t) => {
        const prev = prevPurse[t.id];
        const delta = prev === undefined ? 0 : t.remaining - prev;
        const frac = t.purse > 0 ? Math.max(0, Math.min(1, t.remaining / t.purse)) : 0;
        return (
          <div
            key={t.id}
            className={`scr-cell${t.id === leadingId ? ' leading' : ''}${t.full ? ' full' : ''}`}
            style={vars({ '--team': t.color, '--team-rgb': rgbTriplet(t.color) })}
          >
            <div className="scr-cell-name">{t.name}</div>
            <div className="scr-purse-row">
              <span className="scr-purse" key={t.remaining}>{fmt(t.remaining)}</span>
              {delta !== 0 && (
                <span key={`d-${t.remaining}`} className={`scr-delta${delta > 0 ? ' up' : ''}`}>
                  {delta > 0 ? `+${fmt(delta)}` : `−${fmt(-delta)}`}
                </span>
              )}
            </div>
            <div className="scr-squad">
              {t.count}/{state.settings.maxSquad} players{t.full ? ' · FULL' : ''}
            </div>
            <div className="scr-fuel"><i style={{ transform: `scaleX(${frac})` }} /></div>
          </div>
        );
      })}
    </footer>
  );
}

/* ---------------- SOLD / UNSOLD takeover ---------------- */

function FlashOverlay({ flash }: { flash: FlashInfo }) {
  const color = flash.teamColor ?? '#64748b';
  const dark = flash.kind === 'sold' && darkInk(color);

  // One particle set per hammer event; stable across the socket re-renders
  // that happen while the overlay plays.
  const confetti = useMemo(() => {
    if (flash.kind !== 'sold') return [];
    return Array.from({ length: 70 }, (_, i) => ({
      l: Math.random() * 100,
      dx: (Math.random() - 0.5) * 36,
      rot: 540 + Math.random() * 1000,
      dl: 700 + Math.random() * 800,
      d: 2200 + Math.random() * 1000,
      w: 7 + Math.random() * 6,
      h: 10 + Math.random() * 9,
      r: Math.random() < 0.3 ? '50%' : '2px',
      c: [color, '#fbbf24', '#f4f7ff'][i % 3],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash.id]);

  const priceChars = flash.kind === 'sold' ? fmt(flash.price ?? null).split('') : [];

  return (
    <div
      className={`scr-flash ${flash.kind}${dark ? ' dark-ink' : ''}`}
      style={vars({ '--fc': color, '--fc-rgb': rgbTriplet(color) })}
      role="status"
    >
      <div className="scr-flash-scrim" />
      <div className="scr-flash-panel a" />
      <div className="scr-flash-panel b" />
      <div className="scr-flash-white" aria-hidden />
      <div className="scr-flash-shake">
        <div className="scr-stamp">{flash.kind === 'sold' ? 'SOLD' : 'UNSOLD'}</div>
        <i className="scr-flash-shock" aria-hidden />
        <div className="scr-flash-card">
          <PlayerPhoto url={flash.player.photoUrl} name={flash.player.name} size="xl" />
          <div className="scr-flash-name">{flash.player.name}</div>
        </div>
        {flash.kind === 'sold' ? (
          <div className="scr-payoff">
            <span className="scr-payoff-team">{flash.teamName}</span>
            <span className="scr-payoff-price">
              {priceChars.map((ch, i) => (
                <span key={i} className="ch" style={vars({ '--i': i })}>{ch}</span>
              ))}
              <span className="pts">PTS</span>
            </span>
          </div>
        ) : (
          <div className="scr-payoff unsold-line">Base {fmt(flash.player.basePrice)} — no bids</div>
        )}
      </div>
      {confetti.length > 0 && (
        <div className="scr-confetti" aria-hidden>
          {confetti.map((p, i) => (
            <i
              key={i}
              style={vars({
                '--l': `${p.l}%`,
                '--dx': `${p.dx}vw`,
                '--rot': `${p.rot}deg`,
                '--dl': `${p.dl}ms`,
                '--d': `${p.d}ms`,
                '--w': `${p.w}px`,
                '--h': `${p.h}px`,
                '--r': p.r,
                '--c': p.c,
              })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- final board ---------------- */

function FinalBoard({ state }: { state: StateView }) {
  return (
    <div className="scr-final">
      <div className="scr-final-title">Auction complete</div>
      <div className="scr-final-sub">{state.settings.auctionName}</div>
      <div className="scr-final-grid">
        {state.teams.map((t, ci) => {
          const squad = state.players
            .filter((p) => p.teamId === t.id && p.status === 'sold')
            .sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
          return (
            <div
              key={t.id}
              className="scr-final-col"
              style={vars({ '--i': ci, '--team': t.color, '--team-rgb': rgbTriplet(t.color) })}
            >
              <div className={`scr-final-head${darkInk(t.color) ? ' dark-ink' : ''}`} style={vars({ '--i': ci })}>
                <h3>{t.name}</h3>
                <div className="cap">Capt. {t.captain} · spent {fmt(t.spent)}</div>
              </div>
              <div className="scr-final-rows">
                {squad.length === 0 && <div className="scr-final-empty">No players signed</div>}
                {squad.map((p, i) => (
                  <div
                    key={p.id}
                    className={`scr-final-row${i === 0 ? ' top-buy' : ''}`}
                    style={vars({ '--i': i, '--ci': ci })}
                  >
                    <span className="fname">{p.name}</span>
                    {i === 0 && <span className="fchip">TOP BUY</span>}
                    <span className="fprice">{fmt(p.price)}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
