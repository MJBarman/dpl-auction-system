import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../store';
import { LotView, PlayerView, StateView, TeamView, Tier } from '../types';
import {
  auctionRules, flatReserve, fmt, formatClock, freshMaxBid, lastTeamBuying, OfflineBanner, overallRank, PlayerPhoto,
  SCREEN_BID_MUTE_KEY, statGroups, statLine, TIMEOUT_COUNTDOWN_MS, useBidSound, useCountdown,
} from '../ui';
import { useTheme } from '../theme';
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

/** Keeps the projector laptop's display awake while this page is showing.
 *  The browser drops the lock whenever the tab is hidden, so it is taken
 *  again each time the page comes back. Needs HTTPS or localhost; elsewhere
 *  (or on battery saver) the request fails and the screen may still sleep. */
function useWakeLock() {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let pending = false;
    let cancelled = false;
    const acquire = async () => {
      if (cancelled || lock || pending || document.visibilityState !== 'visible') return;
      pending = true;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) {
          void l.release();
          return;
        }
        lock = l;
        l.addEventListener('release', () => {
          if (lock === l) lock = null;
        });
      } catch {
        /* not allowed here — the screen may sleep */
      } finally {
        pending = false;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
}

export default function ScreenPage() {
  const { state, connected } = useApp();
  // Chime on each new bid; the projector keeps its own mute preference,
  // independent of the auctioneer's console.
  const { muted, toggleMuted } = useBidSound(state?.lot ?? null, SCREEN_BID_MUTE_KEY);
  const { theme, toggle: toggleTheme } = useTheme();
  useWakeLock();
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
      ? (state.phase.mainRoundDone && !lot ? 'Main round complete'
        : showTier ? `${state.settings.tiers.find((t) => t.key === state.currentTierKey)?.name ?? 'Live'} round`
        : 'Live round')
    : state.stage === 'accelerated' ? 'Accelerated round'
    : 'Auction complete';

  // Which board fills the stage. The timeout and final boards carry every
  // purse themselves, so the purse footer steps aside for them.
  const view =
    state.stage === 'completed' ? 'final'
    : lot && lotPlayer ? 'lot'
    : state.timeout ? 'timeout'
    : state.settings.rulesOnScreen ? 'rules'
    : 'idle';

  return (
    <div
      className="scr-page"
      data-view={view}
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
          key={`${state.stage}-${state.currentTierKey ?? ''}${state.timeout ? '-to' : ''}-${stageLabel}`}
          data-stage={state.timeout ? 'timeout' : state.stage}
        >
          {stageLabel}
        </div>
        <div className="scr-head-right">
          <button
            type="button"
            className="scr-theme"
            onClick={toggleTheme}
            aria-pressed={theme === 'light'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
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
              : state.settings.rulesOnScreen
                ? <RulesBoard state={state} />
                : <ScreenIdle state={state} showTier={showTier} />}
      </main>

      {view !== 'timeout' && view !== 'final' && (
        <TeamsFooter state={state} leadingId={leading?.id ?? null} prevPurse={prevPurseRef.current} />
      )}

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
  const leadKey = `${lot.id}-${leading?.id ?? 'open'}`;

  return (
    <div className="scr-lot">
      <PlayerPanel key={player.id} player={player} players={state.players} tier={tier}>
        <LotContext state={state} player={player} tier={tier} />
      </PlayerPanel>

      <div className="scr-theatre">
        {leading && <div key={`edge-${lot.id}-${leading.id}`} className="scr-edgeflash" aria-hidden />}
        <div className="scr-theatre-top">
          <div className="scr-takeover" key={leadKey}>
            <div className="scr-eyebrow">{leading ? 'Current bid' : 'Opening price'}</div>
            <div className="scr-amount-wrap" key={`${lot.id}-${amount}`}>
              <div className="scr-amount">{fmt(amount)}</div>
              <i className="scr-shockwave" aria-hidden />
            </div>
          </div>
          {secs !== null && <CountdownRing secs={secs} frac={frac} />}
        </div>
        {/* A row of its own under the ring: beside it, "Leading — Power Rangers"
            lost its last letters. keyed-by: team — wipes in on a lead change. */}
        <div key={`plate-${leadKey}`} className={`scr-plate${leading ? (darkInk(leading.color) ? ' dark-ink' : '') : ' open'}`}>
          <span>{leading ? `Leading — ${leading.name}` : 'Who will open the bidding?'}</span>
        </div>
        <div className="scr-nextmin">Next bid ≥ <b>{fmt(lot.nextMinBid)}</b></div>
        <BidFeed state={state} lot={lot} />
      </div>

      {secs !== null && secs <= 3 && <div className="scr-danger-vignette" aria-hidden />}
    </div>
  );
}

function PlayerPanel({ player, players, tier, children }: {
  player: PlayerView;
  players: PlayerView[];
  tier?: Tier;
  children?: ReactNode; // the lot's place in the auction, above the photo
}) {
  const groups = statGroups(player.stats, overallRank(players, player));
  let cell = 0; // running index for the cascade animation across all rows

  return (
    <div className="scr-id">
      {children}
      <div className="scr-id-head">
        <div className="scr-photo-wrap">
          <div className="scr-photo-glow" aria-hidden />
          <div className="scr-photo-frame">
            <PlayerPhoto url={player.photoUrl} name={player.name} size="xl" />
          </div>
        </div>
        <div className="scr-id-text">
          {/* Long names step the type down so they never break mid-word. */}
          <h1 className="scr-name" style={vars({ '--name-scale': Math.min(1, 7 / Math.max(7, player.name.length)) })}>
            {player.name}
          </h1>
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
        </div>
      </div>
      {groups ? (
        <div className="scr-statgroups">
          {groups.map((g) => (
            <div key={g.key} className="scr-sg">
              <div className="scr-sg-title">{g.title}</div>
              {g.items.length > 0 ? (
                <div className="scr-sg-cells">
                  {g.items.map((it) => (
                    <div key={it.label} className="scr-stat" style={vars({ '--i': cell++ })}>
                      <div className="scr-stat-v">{it.value}</div>
                      <div className="scr-stat-l">
                        {it.label}
                        {it.rank ? <b className="scr-stat-rank"> · #{it.rank}</b> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="scr-sg-none" style={vars({ '--i': cell++ })}>{g.none}</div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="scr-debut">First DTC season — no DTC 1 or DTC 2 record</div>
      )}
      {player.notes && <p className="scr-notes">{player.notes}</p>}
    </div>
  );
}

/**
 * Where this lot sits in the auction: "Player 9 of 24 · Emerald 3 of 12 ·
 * Timeout after player 16". Position counts every other player already sold
 * or unsold, so a re-offered or hand-assigned player can't skew it; the
 * timeout comes from the server's hammer count, exactly as the engine calls it.
 * In the accelerated round: how many unsold players are still to come.
 */
function LotContext({ state, player, tier }: { state: StateView; player: PlayerView; tier?: Tier }) {
  const parts: string[] = [];
  let alert: string | null = null;
  if (state.stage === 'accelerated') {
    const left = state.phase.remainingInPhase;
    parts.push(left > 0 ? `${left} more unsold to come` : 'Last unsold player');
  } else {
    const done = (p: PlayerView) => p.id !== player.id && p.status !== 'available';
    const n = state.players.filter(done).length + 1;
    parts.push(`Player ${n} of ${state.players.length}`);
    if (tier) {
      const group = state.players.filter((p) => p.tierKey === player.tierKey);
      parts.push(`${tier.name} ${group.filter(done).length + 1} of ${group.length}`);
    }
    const every = state.settings.timeoutEvery;
    if (every > 0) {
      const hammers = every - (state.phase.auctionedInMain % every); // to the break, this one included
      if (hammers === 1) alert = 'Timeout after this player';
      else if (n + hammers - 1 <= state.players.length) parts.push(`Timeout after player ${n + hammers - 1}`);
    }
  }
  return (
    <div className="scr-lotline">
      {parts.map((p) => <span key={p}>{p}</span>)}
      {alert && <span className="alert">{alert}</span>}
    </div>
  );
}

function BidFeed({ state, lot }: { state: StateView; lot: LotView }) {
  const rows = [...lot.bids].reverse().slice(0, 7);
  const ref = useRef<HTMLDivElement>(null);
  // On a projector the feed only gets the height left over (screen.css,
  // "projector fit"); hide any older row that would show cut in half.
  // Re-measured when the feed resizes and when a new row finishes sliding in.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const trim = () => {
      const kids = Array.from(el.children) as HTMLElement[];
      if (kids.length === 0) return;
      const rowH = kids[0].offsetHeight || 46;
      // New rows slide in from a negative top margin (all of them at once
      // after a reload): count that space back in so an older row doesn't
      // blink out mid-slide.
      const sliding = kids.reduce((sum, k) => sum + Math.min(0, parseFloat(getComputedStyle(k).marginTop) || 0), 0);
      const fit = Math.floor((el.clientHeight - sliding + 1) / rowH);
      kids.forEach((row, i) => row.classList.toggle('cut', i >= fit));
    };
    trim();
    const ro = new ResizeObserver(trim);
    ro.observe(el);
    el.addEventListener('animationend', trim);
    return () => {
      ro.disconnect();
      el.removeEventListener('animationend', trim);
    };
  }, [lot.id, lot.bids.length]);
  if (rows.length === 0) return <div ref={ref} className="scr-feed empty">The floor is open…</div>;
  return (
    <div ref={ref} className="scr-feed">
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
  const hot = state.players
    .filter((p) => p.demandRank)
    .sort((a, b) => (a.demandRank ?? 0) - (b.demandRank ?? 0));
  const { head, detail } = idleHeadline(state, showTier);
  return (
    <div className="scr-idle">
      <div className="scr-watermark" aria-hidden>{watermark}</div>
      <div className="scr-idle-headline">
        {head}
        {detail && <span className="scr-idle-detail">{detail}</span>}
      </div>
      {(showTier || hot.length > 0) && (
        <div className={`scr-boards${showTier && hot.length > 0 ? ' two' : ''}`}>
          {showTier && <CategoryBoard state={state} />}
          {hot.length > 0 && <HotListBoard state={state} players={hot} showTier={showTier} />}
        </div>
      )}
      {/* once the main round is over, the headline carries this */}
      {state.phase.unsold > 0 && !state.phase.mainRoundDone && (
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The idle headline: what the room is waiting for between lots — the next
 *  draw's category with how many are left in it and their base price (the
 *  draw walks the categories in order, like the engine), or what comes next
 *  once the main round is over. */
function idleHeadline(state: StateView, showTier: boolean): { head: ReactNode; detail: string | null } {
  if (state.stage === 'setup') return { head: 'The auction begins shortly', detail: null };
  const last = lastTeamBuying(state);
  if (last) return { head: `${last.name} take the rest at base price`, detail: null };
  if (state.stage === 'accelerated') {
    const n = state.phase.remainingInPhase;
    return {
      head: 'Accelerated round',
      detail: n > 0 ? `${plural(n, 'unsold player')} to come` : 'every unsold player has been offered',
    };
  }
  if (state.phase.mainRoundDone) {
    const n = state.phase.unsold;
    return {
      head: 'Main round complete',
      detail: n > 0 ? `${plural(n, 'unsold player')} return in the accelerated round` : 'every player is sold',
    };
  }
  if (showTier) {
    const tiers = [...state.settings.tiers].sort((a, b) => a.order - b.order);
    for (let i = Math.max(0, tiers.findIndex((t) => t.key === state.currentTierKey)); i < tiers.length; i++) {
      const left = state.players.filter((p) => p.status === 'available' && p.tierKey === tiers[i].key);
      if (left.length === 0) continue;
      const bases = left.map((p) => p.basePrice);
      const lo = Math.min(...bases);
      const hi = Math.max(...bases);
      return {
        head: <>Next draw: <span className="tier" style={vars({ '--tc': tiers[i].color })}>{tiers[i].name}</span></>,
        detail: `${left.length} left · base ${lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`}`,
      };
    }
  }
  return { head: 'Next player coming up', detail: `${plural(state.progress.available, 'player')} left` };
}

/** Every category with its players — the same sheet both captains plan from.
 *  Bought players take their team's colour, unsold ones are struck through. */
function CategoryBoard({ state }: { state: StateView }) {
  return (
    <section className="scr-board scr-cats">
      <div className="scr-board-title">Player categories</div>
      {state.progress.perTier.map((t) => {
        const tier = state.settings.tiers.find((x) => x.key === t.tierKey);
        const tc = tier?.color ?? '#4f7cff';
        return (
          <div key={t.tierKey} className="scr-cat" style={vars({ '--tc': tc })}>
            <div className="scr-cat-head">
              <span className="tname">{t.name}</span>
              {tier && <span className="tbase">base {fmt(tier.basePrice)}</span>}
              <span className="tcount"><b>{t.sold}</b>/{t.total} sold</span>
            </div>
            <span className="scr-tierbar">
              <i style={vars({ '--tc': tc, transform: `scaleX(${t.total ? t.sold / t.total : 0})` })} />
            </span>
            <div className="scr-cat-names">
              {state.players.filter((p) => p.tierKey === t.tierKey).map((p) => {
                const team = state.teams.find((x) => x.id === p.teamId);
                return (
                  <span
                    key={p.id}
                    className={`scr-cat-name ${p.status}`}
                    style={team ? vars({ '--team': team.color }) : undefined}
                    title={team ? `${team.name} · ${fmt(p.price)}` : undefined}
                  >
                    {p.name}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** The hot list (players with a hot-list rank), with each one's headline
 *  numbers and — once the hammer falls — who bought them and for how much. */
function HotListBoard({ state, players, showTier }: { state: StateView; players: PlayerView[]; showTier: boolean }) {
  return (
    <section className="scr-board scr-hot">
      <div className="scr-board-title">Hot list</div>
      <ol className="scr-hot-list">
        {players.map((p) => {
          const tier = showTier ? state.settings.tiers.find((t) => t.key === p.tierKey) : undefined;
          const team = state.teams.find((t) => t.id === p.teamId);
          const line = statLine(p.stats);
          return (
            <li
              key={p.id}
              className={`scr-hot-row ${p.status}`}
              style={team ? vars({ '--team': team.color }) : undefined}
            >
              <span className="hrank">{p.demandRank}</span>
              <PlayerPhoto url={p.photoUrl} name={p.name} size="sm" />
              <span className="hwho">
                <span className="hname">{p.name}</span>
                <span className="hmeta">
                  {tier && <span style={{ color: tier.color }}>{tier.name}</span>}
                  {tier && (line || p.role) ? ' · ' : ''}
                  {line || p.role}
                </span>
              </span>
              {p.stats.mvpTotal !== null && p.stats.mvpTotal !== undefined && (
                <span className="hmvp">{p.stats.mvpTotal.toFixed(2)}<small>MVP pts</small></span>
              )}
              <span className="hstatus">
                {p.status === 'sold'
                  ? <><small>{team?.name}</small>{fmt(p.price)}</>
                  : p.status === 'unsold' ? 'Unsold' : <><small>base</small>{fmt(p.basePrice)}</>}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/* ---------------- rules board ---------------- */

/**
 * The rules for the room, in big type — the auctioneer puts it up from the
 * console to brief the captains (it comes down when the auction starts, and
 * any lot takes over the screen). Built from the live settings.
 */
function RulesBoard({ state }: { state: StateView }) {
  const s = state.settings;
  const tiles: [string, string][] = [
    [fmt(s.purse), 'points per team'],
    [s.minSquad === s.maxSquad ? String(s.minSquad) : `${s.minSquad}–${s.maxSquad}`, 'players each'],
    // A flat reserve is one number worth a tile; the base-price rule is
    // spelled out (with each category's price) in the first rule below.
    ...(flatReserve(state) ? [[fmt(s.reservePerSlot), 'kept for every player still needed'] as [string, string]] : []),
    [fmt(freshMaxBid(state)), 'biggest first bid'],
  ];
  return (
    <div className="scr-rules">
      <div className="scr-rules-title">How the auction works</div>
      <div className="scr-rules-tiles">
        {tiles.map(([value, label], i) => (
          <div key={label} className="scr-rules-tile" style={vars({ '--i': i })}>
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {/* the first rule restates the tiles */}
      <ol className="scr-rules-list">
        {auctionRules(state).slice(1).map((rule, i) => (
          <li key={i} style={vars({ '--i': i })}>{rule}</li>
        ))}
      </ol>
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
      {/* stacked on tall screens, side by side on short ones (screen.css) */}
      <div className="scr-to-top">
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
  const last = lastTeamBuying(state);
  return (
    <footer className="scr-foot">
      {state.teams.map((t) => {
        const prev = prevPurse[t.id];
        const delta = prev === undefined ? 0 : t.remaining - prev;
        const frac = t.purse > 0 ? Math.max(0, Math.min(1, t.remaining / t.purse)) : 0;
        // OUT of this lot: the next bid is past the team's max bid. (A full
        // squad reads FULL instead; the leader just can't outbid itself.)
        const bid = state.lot?.teamBidState.find((b) => b.teamId === t.id);
        const out = !!bid && !bid.canBid && !t.full && t.id !== leadingId;
        return (
          <div
            key={t.id}
            className={`scr-cell${t.id === leadingId ? ' leading' : ''}${t.full ? ' full' : ''}${out ? ' out' : ''}`}
            style={vars({ '--team': t.color, '--team-rgb': rgbTriplet(t.color) })}
          >
            <div className="scr-cell-main">
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
                {t.count}/{state.settings.maxSquad} players{last?.id === t.id ? ' · gets the rest at base' : ''}
              </div>
            </div>
            <div className="scr-cell-side">
              <span className="lbl">{t.full ? 'Squad' : out ? `Max bid ${fmt(t.maxBid)}` : 'Max bid'}</span>
              <span className="val" key={t.full ? 'full' : out ? 'out' : t.maxBid}>
                {t.full ? 'Full' : out ? 'Out' : fmt(t.maxBid)}
              </span>
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

interface Award {
  key: string;
  title: string;
  caption: string;
  player: PlayerView;
  team?: TeamView;
  detail: string;
}

/**
 * The final board's three superlatives, each a different player: the top buy;
 * the steal — the best DTC record (MVP points) bought at base price; and the
 * best value — most MVP points per point spent among the rest. Players with
 * no DTC record can only be the top buy.
 */
function finalAwards(state: StateView): Award[] {
  const sold = state.players.filter((p) => p.status === 'sold' && p.price !== null);
  const mvp = (p: PlayerView) => p.stats.mvpTotal ?? 0;
  const price = (p: PlayerView) => p.price ?? 0;
  const team = (p: PlayerView) => state.teams.find((t) => t.id === p.teamId);
  const taken = new Set<string>();
  const pick = (pool: PlayerView[], order: (a: PlayerView, b: PlayerView) => number) => {
    const best = pool.filter((p) => !taken.has(p.id)).sort((a, b) => order(a, b) || a.name.localeCompare(b.name))[0];
    if (best) taken.add(best.id);
    return best;
  };
  const mvpPts = (p: PlayerView) => `${mvp(p).toFixed(2)} MVP pts`;

  const top = pick(sold, (a, b) => price(b) - price(a) || mvp(b) - mvp(a));
  const steal = pick(sold.filter((p) => mvp(p) > 0 && price(p) === p.basePrice), (a, b) => mvp(b) - mvp(a));
  const value = pick(sold.filter((p) => mvp(p) > 0 && price(p) > 0), (a, b) => mvp(b) / price(b) - mvp(a) / price(a));

  const awards: Award[] = [];
  if (top) {
    const over = price(top) > top.basePrice && top.basePrice > 0;
    awards.push({
      key: 'top', title: 'Top buy', caption: 'most expensive', player: top, team: team(top),
      detail: over ? `${Math.round((price(top) / top.basePrice) * 10) / 10}× base`
        : price(top) === top.basePrice ? 'at base' : `base ${fmt(top.basePrice)}`,
    });
  }
  if (value) awards.push({ key: 'value', title: 'Best value', caption: 'most MVP pts per point', player: value, team: team(value), detail: mvpPts(value) });
  if (steal) awards.push({ key: 'steal', title: 'Steal at base', caption: 'best record at base price', player: steal, team: team(steal), detail: mvpPts(steal) });
  return awards;
}

function FinalBoard({ state }: { state: StateView }) {
  const awards = finalAwards(state);
  return (
    <div className="scr-final">
      <div className="scr-final-title">Auction complete</div>
      <div className="scr-final-sub">{state.settings.auctionName}</div>
      {awards.length > 0 && (
        <div className="scr-awards">
          {awards.map((a, i) => (
            <div key={a.key} className="scr-award" style={vars({ '--i': i, '--team': a.team?.color ?? '#64748b' })}>
              <div className="scr-award-title"><b>{a.title}</b> · {a.caption}</div>
              <div className="scr-award-body">
                <PlayerPhoto url={a.player.photoUrl} name={a.player.name} size="sm" />
                <span className="awho">
                  <span className="aname">{a.player.name}</span>
                  <span className="ateam">{a.team?.name}</span>
                </span>
                <span className="afig">{fmt(a.player.price)}<small>{a.detail}</small></span>
              </div>
            </div>
          ))}
        </div>
      )}
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
                {/* the purse footer is off this board — leftover points are worth nothing, so say so */}
                <div className="cap">Capt. {t.captain} · spent {fmt(t.spent)} · {fmt(t.remaining)} unspent</div>
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
