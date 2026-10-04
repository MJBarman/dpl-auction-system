import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { LotView, PlayerStats, PlayerView, StateView, TeamView, Tier } from './types';
import { Icon } from './icons';
import { playBidSound, playSoldSound, unlockAudio } from './sound';
import { useTheme } from './theme';

export const fmt = (n: number | null | undefined): string =>
  n === null || n === undefined ? '–' : n.toLocaleString('en-IN');

export const statVal = (v: number | null | undefined): string =>
  v === null || v === undefined ? '–' : String(v);

/** Two-decimal stats (MVP points, averages, economy) read "8.10", not "8.1". */
const statDec = (v: number | null | undefined): string =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '–';

export interface StatItem {
  label: string;
  value: string;
  rank?: number | null; // "#n" in that season's MVP table
}

export interface StatGroup {
  key: 'mvp' | 'bat' | 'bowl';
  title: string;
  items: StatItem[]; // empty = the player never batted / bowled
  none: string;      // what to say instead when items is empty
}

/** Where a player sits in the pool's overall ranking (combined MVP points),
 *  as on the badges of the DTC 3 category sheet. */
export function overallRank(players: PlayerView[], player: PlayerView): number | null {
  const mvp = player.stats.mvpTotal;
  if (mvp === null || mvp === undefined) return null;
  return 1 + players.filter((p) => (p.stats.mvpTotal ?? -Infinity) > mvp).length;
}

/** A player's record in the three column groups of the DTC 3 category sheet:
 *  MVP points (with each season's #rank), batting, bowling. Strike rate is
 *  derived from runs and balls. Null when there is no DTC record at all. */
export function statGroups(stats: PlayerStats, rank?: number | null): StatGroup[] | null {
  const played = [stats.mvpTotal, stats.mvpS1, stats.mvpS2].some((v) => v !== null && v !== undefined);
  const batted = stats.runs !== null && stats.runs !== undefined;
  const bowled = [stats.wkts, stats.econ].some((v) => v !== null && v !== undefined);
  if (!played && !batted && !bowled) return null;
  const season = (label: string, v?: number | null, r?: number | null): StatItem =>
    v === null || v === undefined ? { label, value: 'DNP' } : { label, value: statDec(v), rank: r ?? null };
  const sr = batted && stats.balls ? statDec((stats.runs! / stats.balls) * 100) : '–';
  return [
    {
      key: 'mvp',
      title: 'MVP',
      none: '',
      items: [
        { label: 'Total', value: statDec(stats.mvpTotal) },
        season('DTC 1', stats.mvpS1, stats.mvpRankS1),
        season('DTC 2', stats.mvpS2, stats.mvpRankS2),
        ...(rank ? [{ label: 'Overall', value: `#${rank}` }] : []),
      ],
    },
    {
      key: 'bat',
      title: 'Batting',
      none: 'Did not bat',
      items: batted
        ? [
            { label: 'Runs', value: statVal(stats.runs) },
            { label: 'Balls', value: statVal(stats.balls) },
            { label: 'HS', value: stats.hs || '–' },
            { label: 'Avg', value: statDec(stats.batAvg) },
            { label: 'SR', value: sr },
          ]
        : [],
    },
    {
      key: 'bowl',
      title: 'Bowling',
      none: 'Did not bowl',
      items: bowled
        ? [
            { label: 'Wkts', value: statVal(stats.wkts) },
            { label: 'Best', value: statVal(stats.bestWkts) },
            { label: 'Econ', value: statDec(stats.econ) },
          ]
        : [],
    },
  ];
}

/** One-line summary in the style of the category sheet's player cards,
 *  e.g. "13 wkts · 16 runs · econ 2.47". */
export function statLine(stats: PlayerStats): string {
  const parts: string[] = [];
  const wkts = stats.wkts ?? 0;
  if (wkts > 0) parts.push(`${wkts} wkt${wkts === 1 ? '' : 's'}`);
  if (stats.runs !== null && stats.runs !== undefined) parts.push(`${stats.runs} run${stats.runs === 1 ? '' : 's'}`);
  if (wkts > 0 && stats.econ !== null && stats.econ !== undefined) parts.push(`econ ${statDec(stats.econ)}`);
  if (parts.length === 0 && stats.mvpTotal !== null && stats.mvpTotal !== undefined) parts.push('fielding only');
  return parts.join(' · ');
}

// ---- the rules in plain words -------------------------------------------------

/** True when the reserve per slot covers every base price, so each open slot
 *  keeps the same flat amount. Otherwise (the DTC 3 rule) each open slot keeps
 *  the base price of one of the most expensive players still left. */
export function flatReserve(state: StateView): boolean {
  return !state.players.some((p) => p.basePrice > state.settings.reservePerSlot);
}

/** The most a team can bid on its first player: the purse minus what it keeps
 *  back for its other minSquad − 1 places — one of the priciest base prices
 *  still left each (never under the reserve per slot) — with the priciest
 *  player on the block, as when the top category opens the auction. Mirrors
 *  the server's engine.reserveFor. */
export function maxFirstBid(purse: number, minSquad: number, reservePerSlot: number, basePrices: number[]): number {
  const others = [...basePrices].sort((a, b) => b - a).slice(1);
  let keep = 0;
  for (let i = 0; i < minSquad - 1; i++) keep += Math.max(reservePerSlot, others[i] ?? 0);
  return Math.max(0, purse - keep);
}

export function freshMaxBid(state: StateView): number {
  const s = state.settings;
  return maxFirstBid(s.purse, s.minSquad, s.reservePerSlot, state.players.map((p) => p.basePrice));
}

/** The one team still buying once every other squad is full, while players
 *  are left to sell — they get the rest at base price. Null otherwise. */
export function lastTeamBuying(state: StateView): TeamView | null {
  if (state.teams.length < 2 || state.stage === 'setup' || state.stage === 'completed') return null;
  const open = state.teams.filter((t) => !t.full);
  return open.length === 1 && state.players.some((p) => p.status !== 'sold') ? open[0] : null;
}

/** The auction's rules, built from the live settings so they always match
 *  what the server enforces — for the captains' dashboards and the
 *  projector's rules board. */
export function auctionRules(state: StateView): string[] {
  const s = state.settings;
  const reserve = fmt(s.reservePerSlot);
  const fresh = fmt(freshMaxBid(state));
  const squad = s.minSquad === s.maxSquad ? `exactly ${s.minSquad}` : `${s.minSquad}–${s.maxSquad}`;
  const tiers = [...s.tiers].sort((a, b) => a.order - b.order);
  const order = tiers.map((t) => t.name).join(' → ');
  const prices = tiers.map((t) => `${t.name} ${fmt(t.basePrice)}`).join(' · ');
  const steps = s.increments.map((r) => `+${fmt(r.step)}${r.upTo !== null ? ` up to ${fmt(r.upTo)}` : ' above'}`).join(' · ');
  return [
    `Each team has ${fmt(s.purse)} points to buy ${squad} players. Captains are not in the pool.`,
    flatReserve(state)
      ? `Keep ${reserve} for every player you still need: max bid = points left − ${reserve} × players you still need after this one. So no first buy can go over ${fresh}.`
      : `For every player you still need after this one, keep back the base price of one of the most expensive players still left (${prices})${s.reservePerSlot > 0 ? `, and never less than ${reserve}` : ''}. Max bid = points left − that. Your first buy can go up to ${fresh}, and you get more room as the expensive players are sold.`,
    'Leftover points are worth nothing when the auction ends, so plan to spend them.',
    state.teams.length === 2
      ? `A team with ${s.maxSquad} players is out of the bidding. The other team then gets every remaining player at base price.`
      : `A team with ${s.maxSquad} players is out of the bidding; the teams still buying share the rest.`,
    `Bid steps: ${steps}.`,
    `Order: ${order}, drawn at random within each category.${s.timeoutEvery > 0 ? ` Strategic timeout after every ${s.timeoutEvery} players.` : ''}`,
    'Players nobody bids on come back in an accelerated round. Anyone still unsold goes at base price to the team with the most points left that still needs players.',
  ];
}

/** One team's guardrail arithmetic right now, e.g. "30,000 left − 5,800
 *  kept for the 11 more players you need after the next one = max bid 24,200". */
export function maxBidLine(state: StateView, team: TeamView): string {
  if (team.full) return `Your squad is full (${team.count}) — you are out of the bidding.`;
  const after = Math.max(0, state.settings.minSquad - team.count - 1);
  if (after === 0) return `One player to go: you can bid everything you have left, ${fmt(team.remaining)}.`;
  return `You now: ${fmt(team.remaining)} left − ${fmt(team.reserve)} kept for the ${after} more player${after === 1 ? '' : 's'} you need after the next one = max bid ${fmt(team.maxBid)}.`;
}

export function tierFor(state: StateView, key: string): Tier | undefined {
  return state.settings.tiers.find((t) => t.key === key);
}

export function TierBadge({ state, tierKey }: { state: StateView; tierKey: string }) {
  const tier = tierFor(state, tierKey);
  if (!tier || state.settings.showTier === false) return null;
  return (
    <span className="tier-badge" style={{ color: tier.color, borderColor: tier.color }}>
      {tier.name}
    </span>
  );
}

/** A player's full DTC record — MVP, batting and bowling rows. Pass the whole
 *  pool to show where the player sits in the overall ranking too. */
export function StatsGrid({ player, players, compact }: { player: PlayerView; players?: PlayerView[]; compact?: boolean }) {
  const groups = statGroups(player.stats, players ? overallRank(players, player) : null);
  if (!groups) return <div className="muted small">No DTC 1 or DTC 2 record — first DTC season.</div>;
  return (
    <div className={`stat-groups${compact ? ' compact' : ''}`}>
      {groups.map((g) => (
        <div key={g.key} className="stat-group">
          <div className="stat-group-title">{g.title}</div>
          {g.items.length > 0 ? (
            <div className="stats-grid">
              {g.items.map((it) => (
                <div key={it.label} className="stat-cell">
                  <div className="stat-value">
                    {it.value}
                    {it.rank ? <span className="stat-rank">#{it.rank}</span> : null}
                  </div>
                  <div className="stat-label">{it.label}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="stat-none">{g.none}</div>
          )}
        </div>
      ))}
    </div>
  );
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

/** Player headshot with an initials fallback.
 *  Memoised on purpose: during a bidding war every bid replaces the whole
 *  state snapshot and re-renders the page, but this component's props (a
 *  stable URL string + name) don't change, so React never touches the <img>
 *  and the browser never refetches — no flicker on the projector or phones.
 *  Each upload gets a fresh immutable URL, so a changed photo still shows up. */
export const PlayerPhoto = React.memo(function PlayerPhoto({ url, name, size = 'md' }: {
  url: string | null;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!url || failedUrl === url) {
    return <span className={`player-photo ${size} placeholder`} role="img" aria-label={name}>{initialsOf(name)}</span>;
  }
  return (
    <img
      className={`player-photo ${size}`}
      src={url}
      alt={name}
      loading={size === 'sm' ? 'lazy' : 'eager'}
      decoding="async"
      draggable={false}
      onError={() => setFailedUrl(url)}
    />
  );
});

export function PlayerBadges({ player }: { player: PlayerView }) {
  return (
    <span className="player-badges">
      {player.demandRank ? <span className="badge hot">HOT #{player.demandRank}</span> : null}
      {player.sleeper ? <span className="badge sleeper">SLEEPER</span> : null}
    </span>
  );
}

export function useCountdown(endsAt: number | null, serverTime: number): number | null {
  // Correct for client/server clock skew using the last state's serverTime.
  const skewRef = useRef(0);
  useEffect(() => {
    skewRef.current = Date.now() - serverTime;
  }, [serverTime]);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!endsAt) {
      setLeft(null);
      return;
    }
    const tick = () => {
      const remaining = Math.max(0, endsAt - (Date.now() - skewRef.current));
      setLeft(Math.ceil(remaining / 1000));
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt]);
  return left;
}

/** Display length of the strategic-timeout countdown. Cosmetic only — the break
 *  still runs until the auctioneer resumes; this just tells the room how much of
 *  the intended 5-minute pause is left. */
export const TIMEOUT_COUNTDOWN_MS = 5 * 60 * 1000;

/** Whole-second count → m:ss (e.g. 300 → "5:00", 7 → "0:07", 0 → "0:00"). */
export function formatClock(totalSecs: number): string {
  const t = Math.max(0, Math.floor(totalSecs));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ---- auction sounds ---------------------------------------------------------

// Default (auctioneer console) mute key. Each screen passes its own key so the
// console, the projector and every captain's phone keep independent,
// per-device mute preferences. One toggle covers the bid chime and SOLD.
export const CONSOLE_BID_MUTE_KEY = 'dpl.bidSound.muted';
export const SCREEN_BID_MUTE_KEY = 'dpl.bidSound.muted.screen';
export const TEAM_BID_MUTE_KEY = 'dpl.bidSound.muted.team';

function loadMuted(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false; // private mode / storage disabled — default to audible
  }
}

/**
 * Plays a chime once per genuinely new bid on the current lot, and exposes a
 * mute preference (persisted under `storageKey` so it survives a reload
 * mid-auction, and so different screens can mute independently).
 *
 * Fires only on a bid *count increase* for the same lot, so it stays silent on
 * the first render, on a fresh lot appearing, on an undo (count drops), and on
 * the many socket re-renders a bidding war produces. The AudioContext is
 * unlocked on the viewer's first interaction so that later bids arriving over
 * the socket — which carry no user gesture — are still allowed to sound.
 */
export function useBidSound(
  lot: LotView | null,
  storageKey: string = CONSOLE_BID_MUTE_KEY,
): { muted: boolean; toggleMuted: () => void } {
  const [muted, setMuted] = useState<boolean>(() => loadMuted(storageKey));
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    // Try immediately — if the document already has (sticky) user activation,
    // e.g. the operator clicked through to the big screen, this unlocks the
    // context up front so the very first bid can sound. Otherwise the listeners
    // below unlock on the first interaction on this screen.
    unlockAudio();
    // On a phone a touch only counts as a user gesture when the finger
    // lifts (pointerup / touchend / click), so listen for those as well as
    // the mouse-down and key presses that unlock desktop browsers.
    const unlock = () => unlockAudio();
    const events = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, unlock, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, unlock);
    };
  }, []);

  const lotId = lot?.id ?? null;
  const count = lot?.bids.length ?? 0;
  const seen = useRef<{ lotId: string | null; count: number }>({ lotId: null, count: 0 });
  useEffect(() => {
    const prev = seen.current;
    seen.current = { lotId, count };
    if (lotId === null || prev.lotId !== lotId) return; // first load or a new lot
    if (count > prev.count && !mutedRef.current) playBidSound();
  }, [lotId, count]);

  const toggleMuted = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      try {
        localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* ignore — preference just won't persist */
      }
      return next;
    });
  }, [storageKey]);

  return { muted, toggleMuted };
}

/**
 * Plays the SOLD gavel once per sale, on whichever screen calls it (console,
 * projector, captains' phones), unless that screen is muted. A sale is a player
 * going to "sold" in the main or accelerated round — the same rule as the
 * projector's SOLD takeover — so manual assignments, auto-allotment, undo and
 * the first snapshot after a (re)load stay silent.
 */
export function useSoldSound(state: StateView | null, muted: boolean): void {
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const before = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!state) return;
    const prev = before.current;
    before.current = new Map(state.players.map((p) => [p.id, p.status]));
    if (!prev) return; // first snapshot: never ring for sales that already happened
    const sale = state.players.some((p) =>
      p.status === 'sold'
      && (p.round === 'main' || p.round === 'accelerated')
      && prev.has(p.id)
      && prev.get(p.id) !== 'sold');
    if (sale && !mutedRef.current) playSoldSound();
  }, [state]);
}

/** Toggle for the auction sounds (bid chime and SOLD). Reads as a live on/off
 *  state, not a fire button. */
export function BidSoundToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`btn ghost sound-toggle${muted ? ' muted' : ''}`}
      onClick={onToggle}
      aria-pressed={!muted}
      title={muted ? 'Sounds are off — click to turn on the bid and SOLD sounds' : 'Sounds are on — click to mute the bid and SOLD sounds'}
    >
      {muted ? 'Sounds off' : 'Sounds on'}
    </button>
  );
}

/** Light/dark switch. Shows what a click will switch *to*, like a light switch. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const toLight = theme === 'dark';
  return (
    <button
      type="button"
      className="btn ghost theme-toggle"
      onClick={toggle}
      aria-pressed={theme === 'light'}
      title={toLight ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {toLight ? 'Light' : 'Dark'}
    </button>
  );
}

export function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span className={`conn-dot ${connected ? 'on' : 'off'}`} title={connected ? 'Live' : 'Reconnecting…'}>
      {connected ? 'LIVE' : 'OFFLINE'}
    </span>
  );
}

/** Full-width warning shown while the live socket is down, so nobody acts on a stale screen. */
export function OfflineBanner({ connected }: { connected: boolean }) {
  if (connected) return null;
  return (
    <div className="offline-banner" role="alert">
      <Icon name="warning" /> Connection lost — reconnecting… this screen may be out of date.
    </div>
  );
}

// ---- toasts -----------------------------------------------------------------

interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'ok';
}

const ToastCtx = createContext<(text: string, kind?: 'error' | 'ok') => void>(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const push = useCallback((text: string, kind: 'error' | 'ok' = 'error') => {
    const id = ++idRef.current;
    setToasts((ts) => [...ts, { id, text, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Wrap an async action: show API errors as toasts. */
export function useAction() {
  const toast = useToast();
  return useCallback(
    async (fn: () => Promise<unknown>, okMessage?: string) => {
      try {
        await fn();
        if (okMessage) toast(okMessage, 'ok');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Something went wrong');
      }
    },
    [toast],
  );
}

export function Modal({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn ghost" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
