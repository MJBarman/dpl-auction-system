import { CSSProperties, ReactNode, RefObject, useEffect, useLayoutEffect, useRef } from 'react';
import { Icon } from '../icons';
import { PlayerView, StateView, TeamView } from '../types';
import { fmt } from '../ui';

// Small pieces the watch page's tabs share.

export const vars = (v: Record<string, string | number>): CSSProperties => v as CSSProperties;

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** A number whose digits roll to their new value, like a scoreboard. Columns
 *  are keyed from the right, so 9,800 → 10,000 rolls the digits it keeps and
 *  grows a new one on the left. */
export function Odometer({ value, className = '' }: { value: number; className?: string }) {
  const text = fmt(value);
  const chars = text.split('');
  return (
    <span className={`w-odo ${className}`} role="img" aria-label={text}>
      {chars.map((ch, i) => {
        const fromRight = chars.length - i;
        return /\d/.test(ch) ? (
          <span key={`d${fromRight}`} className="w-odo-col" aria-hidden>
            <span className="w-odo-strip" style={{ transform: `translateY(-${Number(ch) * 10}%)` }}>
              {DIGITS.map((d) => <span key={d}>{d}</span>)}
            </span>
          </span>
        ) : (
          <span key={`s${fromRight}`} className="w-odo-sep" aria-hidden>{ch}</span>
        );
      })}
    </span>
  );
}

/** For a headline name: shrinks the text until its longest word fits the box
 *  it sits in, so a long name is never cut off at the edge of the screen. It
 *  measures the real text (any script, any font), never goes above the size
 *  the stylesheet gives or below `min` px (under that the word may break), and
 *  fits again when the box changes size or the web font arrives. */
export function useFit<T extends HTMLElement>(text: string, min = 16): RefObject<T> {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const fit = () => {
      el.style.fontSize = '';
      el.classList.remove('w-fit-break');
      let size = parseFloat(getComputedStyle(el).fontSize);
      for (let i = 0; i < 10 && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 0.5; i++) {
        if (size <= min) {
          el.classList.add('w-fit-break');
          break;
        }
        size = Math.max(min, Math.floor(size * Math.min(0.96, el.clientWidth / el.scrollWidth)));
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const watcher = typeof ResizeObserver === 'function' ? new ResizeObserver(again) : null;
    if (el.parentElement) watcher?.observe(el.parentElement);
    document.fonts?.ready.then(again).catch(() => { /* the fallback font is already measured */ });
    return () => {
      cancelAnimationFrame(frame);
      watcher?.disconnect();
    };
  }, [text, min]);
  return ref;
}

/** One square per squad place: filled as the team buys. */
export function Pips({ total, filled }: { total: number; filled: number }) {
  const n = Math.max(0, Math.min(total, 16));
  // A squad bigger than the row is shown in proportion.
  const on = total > n ? Math.round((Math.min(filled, total) / total) * n) : filled;
  return (
    <span className="w-pips" aria-hidden>
      {Array.from({ length: n }, (_, i) => <i key={i} className={i < on ? 'on' : ''} />)}
    </span>
  );
}

/** The pieces of a word that can each be animated by themselves. Latin
 *  letters stand alone; a word in a script that joins or stacks its letters
 *  (Assamese, Bengali, Devanagari, Arabic…) stays whole, because cut apart its
 *  vowel signs and conjuncts would come loose from their letters. */
function pieces(word: string): string[] {
  return /[^\u0000-\u024f\u2000-\u206f]/.test(word) ? [word] : Array.from(word);
}

/** Text as one span per letter, so CSS can bring the letters in one after another. */
export function Letters({ text }: { text: string }) {
  let i = 0;
  return (
    <span className="w-letters" aria-label={text}>
      {text.split(' ').filter(Boolean).map((word, w) => (
        <span key={w} className="w-word" aria-hidden>
          {pieces(word).map((ch) => {
            const n = i++;
            return <span key={n} style={vars({ '--i': n })}>{ch}</span>;
          })}
        </span>
      ))}
    </span>
  );
}

// ---- the phone's Back button closes a sheet -----------------------------------------------------
// While any sheet is open one extra history entry is held, so Back takes that
// entry (and the sheet with it) instead of leaving the page. A sheet closed
// any other way takes the entry out again, unless another sheet has opened in
// its place (the menu handing over to the team picker) or the page has
// navigated on (a link inside the sheet).
const openSheets: { close: () => void }[] = [];
let heldEntry: string | null = null;
let listeningForBack = false;

function onBack(): void {
  if (!heldEntry) return; // our own tidy-up, or nothing of ours on the stack
  heldEntry = null;       // the entry is gone: Back took it
  openSheets[openSheets.length - 1]?.close();
}

function holdBack(sheet: { close: () => void }): () => void {
  openSheets.push(sheet);
  if (!listeningForBack) {
    window.addEventListener('popstate', onBack);
    listeningForBack = true;
  }
  if (!heldEntry) {
    const mark = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    try {
      window.history.pushState({ ...(window.history.state ?? {}), wSheet: mark }, '');
      heldEntry = mark;
    } catch {
      /* no history to push to here: Back simply leaves, as before */
    }
  }
  return () => {
    const at = openSheets.indexOf(sheet);
    if (at >= 0) openSheets.splice(at, 1);
    // wait a tick: a sheet opening in this one's place keeps the entry
    setTimeout(() => {
      if (openSheets.length > 0 || !heldEntry) return;
      const mark = heldEntry;
      heldEntry = null;
      if (window.history.state?.wSheet === mark) window.history.back();
    }, 0);
  };
}

/** A bottom sheet. Tapping outside, Escape, or the phone's Back button closes it. */
export function Sheet({ title, onClose, children, name }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  name: string; // for styling and tests: data-sheet
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // The phone's Back button closes the sheet (see holdBack).
  const closeNow = useRef(onClose);
  closeNow.current = onClose;
  useEffect(() => holdBack({ close: () => closeNow.current() }), []);
  // Focus goes into the sheet while it is open and back where it was after.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    box.current?.focus({ preventScroll: true });
    return () => {
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="w-sheet-back" onClick={onClose}>
      <div
        className="w-sheet"
        ref={box}
        tabIndex={-1}
        data-sheet={name}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-sheet-head">
          <h3>{title}</h3>
          <button className="w-icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="w-sheet-body">{children}</div>
      </div>
    </div>
  );
}

/** "now" · "4m" · "2h": how long ago something happened. */
export function ago(ts: number, now: number): string {
  const secs = Math.max(0, Math.round((now - ts) / 1000));
  if (secs < 45) return 'now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

/** A hammer that has fallen: a sale or a player nobody bid for. */
export interface Hammer {
  player: PlayerView;
  team: TeamView | null;
  kind: 'sold' | 'unsold';
}

/** Every hammer so far, latest first: the play-by-play. */
export function hammerHistory(state: StateView): Hammer[] {
  return state.players
    .filter((p) => p.hammerAt !== null && (p.status === 'sold' || p.status === 'unsold'))
    .sort((a, b) => (b.hammerAt ?? 0) - (a.hammerAt ?? 0))
    .map((p) => ({
      player: p,
      team: state.teams.find((t) => t.id === p.teamId) ?? null,
      kind: p.status === 'sold' ? 'sold' as const : 'unsold' as const,
    }));
}

/** What a picture can be shared of. */
export type ShareTarget = { kind: 'sale'; playerId: string } | { kind: 'squad'; teamId: string };

/** How a sale happened, in a few words. */
export function saleNote(p: PlayerView): string {
  if (p.round === 'allotted') return 'allotted at base';
  if (p.round === 'manual') return 'assigned';
  const parts: string[] = [];
  if (p.price !== null && p.price === p.basePrice) parts.push('at base');
  else if (p.price !== null && p.basePrice > 0) parts.push(`${Math.round((p.price / p.basePrice) * 10) / 10}× base`);
  if (p.bids && p.bids > 1) parts.push(`${p.bids} bids`);
  if (p.round === 'accelerated') parts.push('accelerated round');
  return parts.join(' · ');
}
