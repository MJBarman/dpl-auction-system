import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { PlayerStats, PlayerView, StateView, Tier } from './types';

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

export function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <span className={`conn-dot ${connected ? 'on' : 'off'}`} title={connected ? 'Live' : 'Reconnecting…'}>
      {connected ? 'LIVE' : 'OFFLINE'}
    </span>
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
