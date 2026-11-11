import { useEffect, useMemo, useRef, useState } from 'react';
import { bidLadder, buzz, inkOn, loadStored, MyGuess, NAME_KEY, saveStored, sendGuess } from '../audience';
import { serverNow } from '../clock';
import { Icon } from '../icons';
import { finalAwards, idleHeadline, lotContext } from '../pages/ScreenPage';
import { useApp } from '../store';
import { GuessResult, LotView, PlayerView, StateView, TeamView, Tier } from '../types';
import {
  auctionRules, fmt, formatClock, PlayerPhoto, TIMEOUT_COUNTDOWN_MS, useCountdown, useServerNow,
} from '../ui';
import { ago, Hammer, Letters, Odometer, saleNote, ShareTarget, Sheet, useFit, vars } from './parts';

// The Live tab: the player on the block, the bid, who leads, the guessing
// game, and the play-by-play underneath. Between lots it shows the last sale
// and what comes next; in a timeout or at the end, the state of play.

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts down to `endsAt` on the server's clock: whole seconds left and the
 *  fraction of `totalMs` (or of what was left when first seen) remaining. */
function useDrain(endsAt: number | null, _serverTime?: number, totalMs?: number): { secs: number | null; frac: number } {
  const total = useRef<{ endsAt: number; ms: number } | null>(null);
  const [snap, setSnap] = useState<{ secs: number | null; frac: number }>({ secs: null, frac: 0 });
  useEffect(() => {
    if (!endsAt) {
      total.current = null;
      setSnap({ secs: null, frac: 0 });
      return;
    }
    const tick = () => {
      const left = Math.max(0, endsAt - serverNow());
      if (!total.current || total.current.endsAt !== endsAt) {
        total.current = { endsAt, ms: totalMs ?? Math.max(left, 1000) };
      }
      setSnap({ secs: Math.ceil(left / 1000), frac: Math.min(1, left / total.current.ms) });
    };
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [endsAt, totalMs]);
  return snap;
}

/* ---------------- the player on the block ---------------- */

export function LotStage({ state, lot, player, tier, follow }: {
  state: StateView;
  lot: LotView;
  player: PlayerView;
  tier?: Tier;
  follow: string | null;
}) {
  const leading = lot.leadingTeamId ? state.teams.find((t) => t.id === lot.leadingTeamId) ?? null : null;
  const { parts, alert } = lotContext(state, player, tier);
  const bids = lot.bids.length;

  // Each new bid lands with a slam and a streak of the bidder's colour behind
  // the amount; the digits keep rolling underneath.
  const amountRef = useRef<HTMLDivElement>(null);
  const streakRef = useRef<HTMLSpanElement>(null);
  const seenBids = useRef(bids);
  useEffect(() => {
    if (bids > seenBids.current && !reducedMotion()) {
      const easing = 'cubic-bezier(0.3, 0, 0, 1)';
      amountRef.current?.animate?.([{ transform: 'scale(1.1)' }, { transform: 'scale(1)' }], { duration: 420, easing });
      streakRef.current?.animate?.(
        [{ transform: 'translateX(-120%) skewX(-18deg)', opacity: 0.9 }, { transform: 'translateX(320%) skewX(-18deg)', opacity: 0.9 }],
        { duration: 560, easing },
      );
    }
    seenBids.current = bids;
  }, [bids]);

  // Teams that can't raise any more (full, or past their max bid).
  const out = lot.teamBidState
    .filter((b) => !b.canBid && b.teamId !== lot.leadingTeamId)
    .map((b) => state.teams.find((t) => t.id === b.teamId)?.name)
    .filter((n): n is string => !!n);
  const longest = Math.max(...player.name.split(/\s+/).map((w) => w.length));
  const nameRef = useFit<HTMLHeadingElement>(player.name);

  return (
    <section className="w-lot" style={vars({ '--tier': tier?.color ?? 'var(--ad-text)' })}>
      <div className="w-lot-line">
        {parts.filter((p) => !p.startsWith('Timeout')).map((p) => <span key={p}>{p}</span>)}
        {alert && <b>{alert}</b>}
      </div>
      <div className="w-lot-id">
        <div className="w-lot-photo"><PlayerPhoto url={player.photoUrl} name={player.name} size="lg" /></div>
        <div className="w-lot-who">
          <h1 className="w-lot-name" ref={nameRef} style={vars({ '--fit': Math.min(1, 8 / Math.max(8, longest)) })}>
            <Letters text={player.name} />
          </h1>
          <div className="w-chips">
            {tier && <span className="w-chip tier">{tier.name}</span>}
            {player.role && <span className="w-chip">{player.role}</span>}
            <span className="w-chip line">Base {fmt(player.basePrice)}</span>
          </div>
        </div>
      </div>

      <div className={`w-bid${bids ? ' has' : ''}`}>
        <HammerBar endsAt={lot.timerEndsAt} serverTime={state.serverTime} />
        <div className="w-bid-top">
          <span className="w-label">{bids ? 'Current bid' : 'Bidding opens at'}</span>
          {bids > 0 && <span className="w-label">{bids} bid{bids === 1 ? '' : 's'}</span>}
        </div>
        <div className="w-bid-amount" ref={amountRef}>
          <span className="w-bid-streak" ref={streakRef} aria-hidden />
          <Odometer value={lot.currentBid ?? lot.nextMinBid} />
        </div>
        {leading ? (
          <div
            key={leading.id}
            className={`w-plate${leading.id === follow ? ' mine' : ''}`}
            style={vars({ '--team': leading.color, '--ink': inkOn(leading.color), '--fit': Math.max(0.64, Math.min(1, 14 / leading.name.length)) })}
          >
            <span>Leading</span>
            <b>{leading.name}</b>
          </div>
        ) : (
          <div className="w-plate none"><span>No bids yet</span></div>
        )}
        <div className="w-bid-next">
          <span>{bids ? <>Next bid <b>{fmt(lot.nextMinBid)}</b> or more</> : 'Waiting for the first bid'}</span>
          {out.length > 0 && <span className="w-bid-out">{out.join(' and ')} can’t go higher</span>}
        </div>
      </div>
      <span className="w-sr" aria-live="polite">
        {leading ? `${leading.name} lead at ${fmt(lot.currentBid)}` : `${player.name} is up, base ${fmt(player.basePrice)}`}
      </span>
    </section>
  );
}

/** The auctioneer's hammer timer: a bar that drains, red in the last seconds. */
function HammerBar({ endsAt, serverTime }: { endsAt: number | null; serverTime: number }) {
  const { secs, frac } = useDrain(endsAt, serverTime);
  if (secs === null) return null;
  return (
    <div className={`w-hammer${secs <= 5 ? ' urgent' : ''}`} role="timer">
      <span><Icon name="gavel" /> Going in {secs}</span>
      <b><i style={{ transform: `scaleX(${frac})` }} /></b>
    </div>
  );
}

/* ---------------- guess the hammer price ---------------- */

export function GuessBar({ state, lot, myGuess, onOpen }: {
  state: StateView;
  lot: LotView;
  myGuess: MyGuess | null;
  onOpen: () => void;
}) {
  const guesses = useApp((s) => s.presence?.guesses ?? 0);
  const { secs, frac } = useDrain(lot.guessUntil, state.serverTime, lot.guessUntil ? lot.guessUntil - lot.openedAt : undefined);
  if (!state.settings.audienceGame || lot.guessUntil === null) return null;
  const count = guesses > 0 ? `${guesses} guess${guesses === 1 ? '' : 'es'} in` : '';
  if (myGuess) {
    return (
      <div className="w-guess locked">
        <Icon name="lock" />
        <span>Your guess <b>{fmt(myGuess.amount)}</b></span>
        <em>{count}</em>
      </div>
    );
  }
  if (secs === null || secs <= 0) {
    return (
      <div className="w-guess closed">
        <Icon name="target" />
        <span>Guessing is closed for this player</span>
        <em>{count}</em>
      </div>
    );
  }
  return (
    <button className="w-guess open" onClick={onOpen}>
      <i className="w-guess-drain" style={{ transform: `scaleX(${frac})` }} />
      <Icon name="target" />
      <span>Guess the hammer price</span>
      <b>{secs}s</b>
    </button>
  );
}

export function GuessSheet({ state, lot, player, onClose, onLocked }: {
  state: StateView;
  lot: LotView;
  player: PlayerView;
  onClose: () => void;
  onLocked: (guess: MyGuess, tag: string) => void;
}) {
  const names = state.settings.audienceNames;
  // The hammer can't fall below the standing bid, or above what a team may bid.
  const from = Math.max(player.basePrice, lot.currentBid ?? 0);
  const cap = Math.max(from, ...state.teams.filter((t) => !t.full).map((t) => t.maxBid));
  const ladder = useMemo(() => bidLadder(state.settings.increments, from, cap), [state.settings.increments, from, cap]);
  const [picked, setPicked] = useState<number | null>(null);
  const [name, setName] = useState(() => loadStored<string>(NAME_KEY, ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { secs, frac } = useDrain(lot.guessUntil, state.serverTime, lot.guessUntil ? lot.guessUntil - lot.openedAt : undefined);

  // Start a couple of raises up. If the bidding passes the amount on show it
  // has to move (nobody can win below the standing bid): to the lowest price
  // still possible if the phone had picked one, otherwise to the new default.
  const fallback = ladder[Math.min(2, ladder.length - 1)];
  const amount = picked === null ? fallback : picked >= from ? Math.min(picked, ladder[ladder.length - 1]) : ladder[0];
  const index = Math.max(0, ladder.findIndex((v) => v >= amount));
  // A guess can't be changed once locked, so the amount must never change
  // under a finger on its way to the button: when it moves by itself the
  // button says so and waits a moment before it can be pressed.
  const touched = useRef(0);
  const pick = (v: number) => {
    touched.current = Date.now();
    setPicked(v);
  };
  const shown = useRef(amount);
  const [moved, setMoved] = useState(false);
  useEffect(() => {
    if (shown.current === amount) return;
    shown.current = amount;
    if (Date.now() - touched.current < 300) {
      setMoved(false); // the phone's own change
      return;
    }
    setMoved(true);
    const id = setTimeout(() => setMoved(false), 1300);
    return () => clearTimeout(id);
  }, [amount]);
  const step = (by: number) => pick(ladder[Math.max(0, Math.min(ladder.length - 1, index + by))]);
  const lockRef = useRef<HTMLButtonElement>(null);
  const quick = [...new Set([1, 2, 3, 5]
    .map((m) => ladder.find((v) => v >= player.basePrice * m))
    .filter((v): v is number => v !== undefined))].slice(0, 4);
  const closed = secs !== null && secs <= 0;
  const nameOk = !names || /^[\p{L}\p{M}][\p{L}\p{M} .'-]{1,15}$/u.test(name.trim());

  const lock = async () => {
    setBusy(true);
    setError(null);
    try {
      const clean = name.replace(/\s+/g, ' ').trim();
      const sent = await sendGuess(lot.id, amount, names ? clean : '');
      if (names) saveStored(NAME_KEY, clean);
      buzz(20);
      onLocked({ lotId: lot.id, amount: sent.amount }, sent.tag);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your guess');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet title="Guess the hammer price" name="guess" onClose={onClose}>
      <p className="w-sheet-lead">
        What will <b>{player.name}</b> sell for? One guess per player. The closest three score 3, 2 and 1.
      </p>
      <div className={`w-guess-clock${closed ? ' closed' : ''}`}>
        <span>{closed ? 'Guessing has closed' : `${secs ?? ''}s left to guess`}</span>
        <b><i style={{ transform: `scaleX(${closed ? 0 : frac})` }} /></b>
      </div>
      <div className="w-stepper">
        <button className="w-step" onClick={() => step(-1)} disabled={index <= 0 || closed} aria-label="Lower">−</button>
        <output className="w-stepper-amount" aria-live="polite"><Odometer value={amount} /></output>
        <button className="w-step" onClick={() => step(1)} disabled={index >= ladder.length - 1 || closed} aria-label="Higher">+</button>
      </div>
      <input
        className="w-range"
        type="range"
        min={0}
        max={ladder.length - 1}
        value={index}
        onChange={(e) => pick(ladder[Number(e.target.value)])}
        disabled={closed || ladder.length < 2}
        aria-label="Your guess"
        aria-valuetext={fmt(amount)}
        style={vars({ '--fill': ladder.length > 1 ? index / (ladder.length - 1) : 0 })}
      />
      <div className="w-quick">
        {quick.map((v) => (
          <button key={v} className={`w-chip-btn${v === amount ? ' on' : ''}`} onClick={() => pick(v)} disabled={closed}>
            {fmt(v)}
          </button>
        ))}
      </div>
      {/* a form, so the keyboard's Done / Return key locks the guess in */}
      <form
        className="w-guess-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !closed && nameOk && !moved) lock();
        }}
      >
        {names && (
          <label className="w-field">
            Your name, shown if you’re among the closest
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              // once the keyboard is up, keep the button in view above it
              onFocus={() => setTimeout(() => lockRef.current?.scrollIntoView({ block: 'nearest' }), 350)}
              maxLength={16}
              placeholder="First name"
              autoComplete="given-name"
              enterKeyHint="done"
            />
          </label>
        )}
        {error && <div className="notice error">{error}</div>}
        <button type="submit" ref={lockRef} className="btn primary big" disabled={busy || closed || !nameOk || moved}>
          {busy ? 'Locking in…'
            : closed ? 'Guessing has closed'
              : moved ? `The bidding moved: now ${fmt(amount)}`
                : !nameOk ? 'Type your name to lock in'
                  : `Lock in ${fmt(amount)}`}
        </button>
      </form>
    </Sheet>
  );
}

/** How the guesses on a sale turned out. */
export function GuessResultPanel({ result, myTag }: { result: GuessResult | null; myTag: string | null }) {
  if (!result || result.total === 0) return null;
  const mine = result.top.findIndex((g) => g.tag === myTag);
  return (
    <div className={`w-result${mine === 0 ? ' won' : ''}`}>
      <div className="w-result-head">
        <Icon name="target" /> Closest guesses
        <em>{result.total} guess{result.total === 1 ? '' : 'es'}</em>
      </div>
      <ol>
        {result.top.map((g, i) => (
          <li key={g.tag} className={g.tag === myTag ? 'me' : ''} style={vars({ '--i': i })}>
            <b>{i + 1}</b>
            <span>{g.tag === myTag ? (g.name ? `${g.name} (you)` : 'You') : g.name ?? 'A fan'}</span>
            <strong>{fmt(g.amount)}</strong>
            <em>{g.off === 0 ? 'spot on' : `${fmt(g.off)} off`}</em>
          </li>
        ))}
      </ol>
      {mine === 0 && <div className="w-result-won">You called it</div>}
    </div>
  );
}

/** The best guessers so far. */
export function GuessBoard({ state, myTag }: { state: StateView; myTag: string | null }) {
  if (state.guessBoard.length === 0) return null;
  return (
    <div className="w-board">
      <div className="w-result-head"><Icon name="trophy" /> Sharpest eyes</div>
      <ol>
        {state.guessBoard.map((r, i) => (
          <li key={r.tag} className={r.tag === myTag ? 'me' : ''} style={vars({ '--i': i })}>
            <b>{i + 1}</b>
            <span>{r.tag === myTag ? (r.name ? `${r.name} (you)` : 'You') : r.name ?? 'A fan'}</span>
            <strong>{r.points} pt{r.points === 1 ? '' : 's'}</strong>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------------- between lots ---------------- */

export function IdleStage({ state, showTier, last, myTag, onShare }: {
  state: StateView;
  showTier: boolean;
  last: Hammer | null;
  myTag: string | null;
  onShare: (t: ShareTarget) => void;
}) {
  const { head, detail } = idleHeadline(state, showTier);
  const rules = auctionRules(state);
  const result = last && state.guessResult?.playerId === last.player.id ? state.guessResult : null;
  return (
    <section className="w-idle">
      <h1 className="w-idle-head">{head}</h1>
      {detail && <p className="w-idle-detail">{detail}</p>}
      {state.stage === 'setup' && <NameBand names={state.players.map((p) => p.name)} />}
      {state.stage === 'setup' && showTier && <PoolGlance state={state} />}
      {state.stage === 'setup' && (
        <div className="w-how">
          <div className="w-label">How it works</div>
          <ol>
            <li>{rules[0]}</li>
            <li>{rules[5]}</li>
            {state.settings.audienceGame && <li>Guess each player’s hammer price from here. The closest three score points.</li>}
          </ol>
        </div>
      )}
      {last && last.kind === 'sold' && last.team && (
        <LastSale hammer={last} onShare={() => onShare({ kind: 'sale', playerId: last.player.id })} />
      )}
      {last && last.kind === 'unsold' && (
        <div className="w-last unsold">
          <div className="w-last-tag">Unsold</div>
          <div className="w-last-name">{last.player.name}</div>
          <p>No bids. {last.player.name} comes back in the accelerated round.</p>
        </div>
      )}
      <GuessResultPanel result={result} myTag={myTag} />
      <GuessBoard state={state} myTag={myTag} />
    </section>
  );
}

/** Before the start: everyone in the pool, drifting past in big type. */
function NameBand({ names }: { names: string[] }) {
  if (names.length < 4) return null;
  const shown = names.slice(0, 40);
  return (
    <div className="w-names" aria-hidden>
      <div className="w-names-track" style={vars({ '--n': shown.length })}>
        {[0, 1].map((copy) => shown.map((n, i) => <span key={`${copy}-${i}`} className={i % 2 ? 'o' : ''}>{n}</span>))}
      </div>
    </div>
  );
}

/** Before the start: how many players each category holds, and what they open at. */
function PoolGlance({ state }: { state: StateView }) {
  const groups = [...state.settings.tiers]
    .sort((a, b) => a.order - b.order)
    .map((tier) => ({ tier, n: state.players.filter((p) => p.tierKey === tier.key).length }))
    .filter((g) => g.n > 0);
  if (groups.length === 0) return null;
  const most = Math.max(...groups.map((g) => g.n));
  const total = state.players.length;
  return (
    <div className="w-glance">
      <div className="w-label">The pool · {total} player{total === 1 ? '' : 's'}</div>
      {groups.map((g, i) => (
        <div key={g.tier.key} className="w-glance-row" style={vars({ '--tier': g.tier.color, '--w': g.n / most, '--i': i })}>
          <b>{g.tier.name}</b>
          <span>Base {fmt(g.tier.basePrice)}</span>
          <i aria-hidden><em /></i>
          <strong>{g.n}</strong>
        </div>
      ))}
    </div>
  );
}

function LastSale({ hammer, onShare }: { hammer: Hammer; onShare: () => void }) {
  const { player, team } = hammer;
  if (!team) return null;
  return (
    <div className="w-last" style={vars({ '--team': team.color, '--ink': inkOn(team.color) })}>
      <div className="w-last-top">
        <span className="w-last-tag">Last sale</span>
        <button className="w-link-btn" onClick={onShare}><Icon name="share" /> Share</button>
      </div>
      <div className="w-last-body">
        <PlayerPhoto url={player.photoUrl} name={player.name} size="md" />
        <div className="w-last-who">
          <div className="w-last-name">{player.name}</div>
          <div className="w-last-team">{team.name}</div>
        </div>
        <div className="w-last-price">
          <Odometer value={player.price ?? 0} />
          <span>{saleNote(player)}</span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- strategic timeout ---------------- */

export function TimeoutStage({ state, onSquads }: { state: StateView; onSquads: () => void }) {
  const t = state.timeout!;
  const secs = useCountdown(t.startedAt + TIMEOUT_COUNTDOWN_MS, state.serverTime);
  const done = secs !== null && secs <= 0;
  const shown = secs ?? Math.round(TIMEOUT_COUNTDOWN_MS / 1000);
  const left = state.phase.remainingInPhase;
  return (
    <section className="w-timeout">
      <div className="w-timeout-badge"><Icon name="pause" /> Strategic timeout</div>
      <div className={`w-timeout-clock${!done && shown <= 30 ? ' urgent' : ''}`} role="timer">
        {done ? 'Any moment now' : formatClock(shown)}
      </div>
      <p className="w-idle-detail">
        {t.setNumber !== null ? `Set ${t.setNumber} complete · ` : ''}
        {left} player{left === 1 ? '' : 's'} still in the pool
        {state.phase.unsold > 0 ? ` · ${state.phase.unsold} unsold` : ''}
      </p>
      <button className="btn" onClick={onSquads}>See the squads so far <Icon name="chevron" /></button>
    </section>
  );
}

/* ---------------- the end ---------------- */

export function FinalStage({ state, myTag, onSquads, onShare }: {
  state: StateView;
  myTag: string | null;
  onSquads: () => void;
  onShare: (t: ShareTarget) => void;
}) {
  const awards = finalAwards(state);
  const best = state.guessBoard[0];
  return (
    <section className="w-final">
      <h1 className="w-final-head"><Letters text="Auction complete" /></h1>
      <p className="w-idle-detail">{state.settings.auctionName}</p>
      <div className="w-awards">
        {awards.map((a, i) => (
          <div key={a.key} className="w-award" style={vars({ '--team': a.team?.color ?? 'var(--ad-text)', '--i': i })}>
            <div className="w-award-title">{a.title}<span>{a.caption}</span></div>
            <div className="w-award-body">
              <PlayerPhoto url={a.player.photoUrl} name={a.player.name} size="md" />
              <div>
                <div className="w-last-name">{a.player.name}</div>
                <div className="w-last-team">{a.team?.name}</div>
              </div>
              <div className="w-last-price"><b>{fmt(a.player.price)}</b><span>{a.detail}</span></div>
            </div>
          </div>
        ))}
        {best && (
          <div className="w-award eye" style={vars({ '--team': 'var(--ad-run-mint)', '--i': awards.length })}>
            <div className="w-award-title">Sharpest eye<span>best guesser of the night</span></div>
            <div className="w-award-body">
              <span className="w-award-icon"><Icon name="trophy" /></span>
              <div>
                <div className="w-last-name">{best.tag === myTag ? (best.name ? `${best.name} (you)` : 'You') : best.name ?? 'A fan'}</div>
                <div className="w-last-team">{best.wins} closest guess{best.wins === 1 ? '' : 'es'}</div>
              </div>
              <div className="w-last-price"><b>{best.points}</b><span>points</span></div>
            </div>
          </div>
        )}
      </div>
      <button className="btn primary big" onClick={onSquads}>See the final squads</button>
      <div className="w-final-share">
        {state.teams.map((t) => (
          <button key={t.id} className="btn" onClick={() => onShare({ kind: 'squad', teamId: t.id })}>
            <Icon name="share" /> Share {t.name}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------------- play-by-play ---------------- */

/** A slow ticker of the latest sales, so they're in view while a player is up. */
export function SoldTicker({ history }: { history: Hammer[] }) {
  const sold = history.filter((h) => h.kind === 'sold' && h.team).slice(0, 8);
  if (sold.length === 0) return null;
  const loop = sold.length >= 3; // enough to fill the strip twice over
  return (
    <div className={`w-ticker${loop ? ' loop' : ''}`} aria-label="Latest sales">
      <span className="w-ticker-tag">Sold</span>
      <div className="w-ticker-view">
        <div className="w-ticker-track" style={vars({ '--n': sold.length })}>
          {(loop ? [0, 1] : [0]).map((copy) => sold.map((h) => (
            <span key={`${h.player.id}-${copy}`} className="w-ticker-item" style={vars({ '--team': h.team!.color })} aria-hidden={copy === 1}>
              <b>{h.player.name}</b>
              <i />
              {h.team!.name}
              <strong>{fmt(h.player.price)}</strong>
            </span>
          )))}
        </div>
      </div>
    </div>
  );
}

export function Feed({ state, lot, history, follow, onShare, onPlayer }: {
  state: StateView;
  lot: LotView | null;
  history: Hammer[];
  follow: string | null;
  onShare: (t: ShareTarget) => void;
  onPlayer: (id: string) => void;
}) {
  const now = useServerNow(state.serverTime, 20_000);
  const bids = lot ? [...lot.bids].reverse() : [];
  if (bids.length === 0 && history.length === 0) return null;
  const team = (id: string | null): TeamView | undefined => state.teams.find((t) => t.id === id);
  return (
    <section className="w-feed">
      {bids.length > 0 && (
        <>
          <h2 className="w-feed-title">Bids on this player</h2>
          <ol className="w-feed-list">
            {bids.map((b, i) => {
              const t = team(b.teamId);
              return (
                <li
                  key={`${b.ts}-${b.amount}`}
                  className={`w-feed-bid${i === 0 ? ' top' : ''}${b.teamId === follow ? ' mine' : ''}`}
                  style={vars({ '--team': t?.color ?? '#64748b' })}
                >
                  <span className="w-feed-team">{t?.name ?? 'Team'}</span>
                  {b.teamId === follow && <span className="w-feed-tag">Your team</span>}
                  <b>{fmt(b.amount)}</b>
                </li>
              );
            })}
          </ol>
        </>
      )}
      {history.length > 0 && (
        <>
          <h2 className="w-feed-title">{lot ? 'Earlier' : 'Play-by-play'}</h2>
          <ol className="w-feed-list">
            {history.slice(0, 40).map((h) => (h.kind === 'sold' && h.team ? (
              <li
                key={h.player.id}
                className={`w-feed-sold${h.team.id === follow ? ' mine' : ''}`}
                style={vars({ '--team': h.team.color, '--ink': inkOn(h.team.color) })}
              >
                <button className="w-feed-main" onClick={() => onPlayer(h.player.id)}>
                  <PlayerPhoto url={h.player.photoUrl} name={h.player.name} size="sm" />
                  <span className="w-feed-who">
                    <b>{h.player.name}</b>
                    <span>{h.team.name}{saleNote(h.player) ? ` · ${saleNote(h.player)}` : ''}</span>
                  </span>
                  <span className="w-feed-price">
                    <b>{fmt(h.player.price)}</b>
                    <span>{ago(h.player.hammerAt ?? now, now)}</span>
                  </span>
                </button>
                <button className="w-icon-btn" onClick={() => onShare({ kind: 'sale', playerId: h.player.id })} aria-label={`Share ${h.player.name}'s sale`}>
                  <Icon name="share" />
                </button>
              </li>
            ) : (
              <li key={h.player.id} className="w-feed-unsold">
                <button className="w-feed-main" onClick={() => onPlayer(h.player.id)}>
                  <PlayerPhoto url={h.player.photoUrl} name={h.player.name} size="sm" />
                  <span className="w-feed-who">
                    <b>{h.player.name}</b>
                    <span>Unsold · back in the accelerated round</span>
                  </span>
                  <span className="w-feed-price"><span>{ago(h.player.hammerAt ?? now, now)}</span></span>
                </button>
              </li>
            )))}
          </ol>
        </>
      )}
    </section>
  );
}
