import { useCallback, useEffect, useRef, useState } from 'react';
import { buzz, REACTIONS } from '../audience';
import { onReactions, useApp } from '../store';
import { vars } from './parts';

// Emoji reactions: taps on the phones, floating up every screen. The server
// relays them in small batches and limits how many; each screen also caps how
// many are on it at once, so a flood can never bury the auction.

interface Float {
  id: number;
  emoji: string;
  x: number;     // 0–1 across the lane
  drift: number; // sideways wander, px
  ms: number;
  size: number;  // scale
  delay: number;
}

const MAX_ON_SCREEN = 26;
const PER_BATCH = 6; // of one emoji, per batch, per screen

function useFloats() {
  const [floats, setFloats] = useState<Float[]>([]);
  const next = useRef(0);
  const add = useCallback((emoji: string, delay = 0) => {
    // With motion turned off nothing floats (and nothing would ever clear).
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setFloats((f) => [...f.slice(-(MAX_ON_SCREEN - 1)), {
      id: ++next.current,
      emoji,
      x: Math.random(),
      drift: (Math.random() - 0.5) * 60,
      ms: 2200 + Math.random() * 1200,
      size: 0.85 + Math.random() * 0.5,
      delay,
    }]);
  }, []);
  const done = useCallback((id: number) => setFloats((f) => f.filter((x) => x.id !== id)), []);
  return { floats, add, done };
}

function FloatLayer({ floats, done, className }: { floats: Float[]; done: (id: number) => void; className: string }) {
  return (
    <div className={className} aria-hidden>
      {floats.map((f) => (
        <span
          key={f.id}
          className="w-float"
          style={vars({ '--x': f.x, '--drift': `${f.drift}px`, '--ms': `${f.ms}ms`, '--s': f.size, '--delay': `${f.delay}ms` })}
          onAnimationEnd={() => done(f.id)}
        >
          {f.emoji}
        </span>
      ))}
    </div>
  );
}

/** The phone: a row of emoji to tap, and everyone's reactions floating up. */
export function ReactionDock({ enabled }: { enabled: boolean }) {
  const react = useApp((s) => s.react);
  const { floats, add, done } = useFloats();
  // My own taps show at once; when the server echoes them back in a batch,
  // that many are skipped so they aren't drawn twice. Each tap waits 1.5 s for
  // its echo (the times below); one that never comes (dropped by a limit) must
  // not swallow somebody else's reaction later.
  const mine = useRef<Record<string, number[]>>({});
  const lastTap = useRef(0);
  const [cooling, setCooling] = useState(false);

  useEffect(() => onReactions((batch) => {
    for (const [emoji, n] of Object.entries(batch)) {
      if (!(REACTIONS as readonly string[]).includes(emoji)) continue;
      const waiting = (mine.current[emoji] ?? []).filter((until) => until > Date.now());
      const own = Math.min(waiting.length, n);
      mine.current[emoji] = waiting.slice(own);
      const others = Math.min(n - own, PER_BATCH);
      for (let i = 0; i < others; i++) add(emoji, i * 110);
    }
  }), [add]);

  const tap = (emoji: string) => {
    const now = Date.now();
    if (now - lastTap.current < 420) return; // the server takes one every 400 ms
    lastTap.current = now;
    (mine.current[emoji] ??= []).push(now + 1500);
    react(emoji);
    add(emoji);
    buzz(8);
    setCooling(true);
    setTimeout(() => setCooling(false), 420);
  };

  return (
    <>
      <FloatLayer floats={floats} done={done} className="w-floats" />
      {enabled && (
        <>
          <div className="w-react-scrim" aria-hidden />
          <div className={`w-react${cooling ? ' cooling' : ''}`} role="group" aria-label="Send a reaction to the big screen">
            {REACTIONS.map((e) => (
              <button key={e} onClick={() => tap(e)} aria-label={`React ${e}`}>{e}</button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

/** The projector: the room's reactions rising from the bottom edge. */
export function ScreenReactions() {
  const { floats, add, done } = useFloats();
  useEffect(() => onReactions((batch) => {
    for (const [emoji, n] of Object.entries(batch)) {
      if (!(REACTIONS as readonly string[]).includes(emoji)) continue;
      for (let i = 0; i < Math.min(n, PER_BATCH); i++) add(emoji, i * 110);
    }
  }), [add]);
  return <FloatLayer floats={floats} done={done} className="w-floats screen" />;
}
