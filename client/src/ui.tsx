import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { LotView, PlayerStats, PlayerView, StateView, Tier } from './types';
import { playBidSound, unlockAudio } from './sound';

export const fmt = (n: number | null | undefined): string =>
  n === null || n === undefined ? '–' : n.toLocaleString('en-IN');

export const statVal = (v: number | null | undefined): string =>
  v === null || v === undefined ? '–' : String(v);

export function tierFor(state: StateView, key: string): Tier | undefined {
  return state.settings.tiers.find((t) => t.key === key);
}

export function TierBadge({ state, tierKey }: { state: StateView; tierKey: string }) {
  const tier = tierFor(state, tierKey);
  if (!tier) return null;
  return (
    <span className="tier-badge" style={{ color: tier.color, borderColor: tier.color }}>
      {tier.name}
    </span>
  );
}

export function StatsGrid({ stats, compact }: { stats: PlayerStats; compact?: boolean }) {
  const cells: [string, string][] = [
    ['Mat', statVal(stats.mat)],
    ['Runs', statVal(stats.runs)],
    ['Bat Avg', statVal(stats.batAvg)],
    ['Bat SR', statVal(stats.batSR)],
    ['Wkts', statVal(stats.wkts)],
    ['Bowl Avg', statVal(stats.bowlAvg)],
    ['Econ', statVal(stats.econ)],
    ['Best MVP', stats.bestMvp ?? '–'],
  ];
  const shown = compact ? cells.filter(([, v]) => v !== '–') : cells;
  if (shown.length === 0) return <div className="muted small">No prior DPL record — debut season.</div>;
  return (
    <div className={`stats-grid${compact ? ' compact' : ''}`}>
      {shown.map(([label, value]) => (
        <div key={label} className="stat-cell">
          <div className="stat-value">{value}</div>
          <div className="stat-label">{label}</div>
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

// ---- bid sound --------------------------------------------------------------

// Default (auctioneer console) mute key. Each screen passes its own key so the
// console and the projector keep independent, per-device mute preferences.
export const CONSOLE_BID_MUTE_KEY = 'dpl.bidSound.muted';
export const SCREEN_BID_MUTE_KEY = 'dpl.bidSound.muted.screen';

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
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
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

/** Toggle for the bid chime. Reads as a live on/off state, not a fire button. */
export function BidSoundToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`btn ghost sound-toggle${muted ? ' muted' : ''}`}
      onClick={onToggle}
      aria-pressed={!muted}
      title={muted ? 'Bid sound is off — click to turn it on' : 'Bid sound is on — click to mute'}
    >
      {muted ? '🔇 Bid sound off' : '🔔 Bid sound on'}
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
      ⚠️ Connection lost — reconnecting… this screen may be out of date.
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
          <button className="btn ghost" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
