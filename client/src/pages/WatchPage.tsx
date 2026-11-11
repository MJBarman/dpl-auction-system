import { Component, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  buzz, BUZZ_KEY, canBuzz, FOLLOW_KEY, GUESS_KEY, hasStored, inkOn, loadStored, MyGuess, renderSaleCard,
  renderSquadCard, sharePicture, TAG_KEY, useInstall, useStored,
} from '../audience';
import { Icon, IconName } from '../icons';
import { useApp } from '../store';
import { useTheme } from '../theme';
import { PlayerView, StateView, TeamView } from '../types';
import {
  fmt, OfflineBanner, PlayerPhoto, useBidSound, useDrawSound, useSoldSound, WATCH_BID_MUTE_KEY,
} from '../ui';
import {
  Feed, FinalStage, GuessBar, GuessSheet, IdleStage, LotStage, SoldTicker, TimeoutStage,
} from '../watch/LiveTab';
import { hammerHistory, Letters, Odometer, Pips, ShareTarget, Sheet, useFit, vars } from '../watch/parts';
import { ReactionDock } from '../watch/Reactions';
import { PlayerSheet, PoolTab, SquadsTab } from '../watch/Tabs';
import { useWakeLock } from './ScreenPage';
import '../watch.css';

/** The auction on a phone (/watch): for everyone following along who isn't
 *  bidding. Live shows the player on the block and a play-by-play; Squads and
 *  Pool answer "who has whom" and "who's left" at any moment. Viewers can back
 *  a team, guess each hammer price, react, and share a sale as a picture. It
 *  reads the same public state as the projector and can change nothing. */

type Tab = 'live' | 'squads' | 'pool';
/** How recent a hammer must be to take over the screen. */
const FRESH_HAMMER_MS = 10_000;
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'live', label: 'Live', icon: 'radio' },
  { key: 'squads', label: 'Squads', icon: 'shield' },
  { key: 'pool', label: 'Pool', icon: 'rows' },
];

type SheetState =
  | null
  | { kind: 'menu' }
  | { kind: 'follow' }
  | { kind: 'guess' }
  | { kind: 'share'; target: ShareTarget }
  | { kind: 'player'; id: string };

interface Flash {
  id: number;
  kind: 'sold' | 'unsold';
  player: PlayerView;
  team?: TeamView;
}

/** If the page ever fails to draw, say so and offer a reload, rather than
 *  leave a blank screen in the middle of the auction. */
class WatchBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('[watch] the page failed to draw:', error);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="w-crash" role="alert">
        <h1>Something went wrong</h1>
        <p>The auction is still running. Reload to carry on watching.</p>
        <button className="btn primary big" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}

export default function WatchPage() {
  return <WatchBoundary><Watch /></WatchBoundary>;
}

function Watch() {
  const { state, connected, presence } = useApp();
  // A spectator's phone starts silent: sound is one tap away, never a surprise.
  const { muted, toggleMuted } = useBidSound(state?.lot ?? null, WATCH_BID_MUTE_KEY, true);
  useSoldSound(state, muted);
  useDrawSound(state, muted);
  useWakeLock();
  const { theme, toggle: toggleTheme } = useTheme();
  const [tab, setTabOnly] = useState<Tab>('live');
  // A tab opens at its top, not wherever the last one was scrolled to.
  const setTab = (next: Tab) => {
    setTabOnly(next);
    try {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }
  };
  const [follow, setFollow] = useStored<string | null>(FOLLOW_KEY, null); // a team id, 'none', or null = not asked yet
  const [buzzOn, setBuzzOn] = useStored<boolean>(BUZZ_KEY, true);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [squadFocus, setSquadFocus] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [myGuess, setMyGuess] = useState<MyGuess | null>(() => loadStored<MyGuess | null>(GUESS_KEY, null));
  const [myTag, setMyTag] = useState<string | null>(() => loadStored<string | null>(TAG_KEY, null));
  const [soundAsked, setSoundAsked] = useState(() => hasStored(WATCH_BID_MUTE_KEY));

  const followRef = useRef(follow);
  followRef.current = follow;
  const buzzRef = useRef(buzzOn);
  buzzRef.current = buzzOn;

  // The first visit asks which team you back (it can be skipped).
  const ready = state !== null;
  useEffect(() => {
    if (!ready || followRef.current !== null) return;
    const id = setTimeout(() => setSheet((s) => s ?? { kind: 'follow' }), 900);
    return () => clearTimeout(id);
  }, [ready]);

  // SOLD and UNSOLD take over the screen for a moment; your team taking the
  // lead gives a short buzz.
  const prev = useRef<StateView | null>(null);
  const flashId = useRef(0);
  useEffect(() => {
    const before = prev.current;
    prev.current = state;
    if (!before || !state) return;
    // Only a hammer that has just fallen takes over the screen: a phone that
    // slept through three sales, or an undo that puts an old sale back, must
    // not replay a SOLD from minutes ago. Of several at once, the latest.
    let latest: { kind: 'sold' | 'unsold'; player: PlayerView } | null = null;
    for (const p of state.players) {
      if (p.hammerAt === null || state.serverTime - p.hammerAt > FRESH_HAMMER_MS) continue;
      const old = before.players.find((x) => x.id === p.id);
      if (!old) continue;
      const kind = old.status !== 'sold' && p.status === 'sold' && (p.round === 'main' || p.round === 'accelerated') ? 'sold' as const
        : old.status === 'available' && p.status === 'unsold' ? 'unsold' as const
          : null;
      if (kind && (!latest || p.hammerAt > (latest.player.hammerAt ?? 0))) latest = { kind, player: p };
    }
    if (latest) {
      const p = latest.player;
      if (latest.kind === 'sold') {
        setFlash({ id: ++flashId.current, kind: 'sold', player: p, team: state.teams.find((t) => t.id === p.teamId) });
        if (buzzRef.current) buzz(p.teamId === followRef.current ? [70, 50, 70, 50, 220] : [60, 40, 140]);
      } else {
        setFlash({ id: ++flashId.current, kind: 'unsold', player: p });
        if (buzzRef.current) buzz(40);
      }
      return;
    }
    const leader = state.lot?.leadingTeamId;
    if (state.lot && before.lot?.id === state.lot.id && leader && leader !== before.lot.leadingTeamId
      && leader === followRef.current && buzzRef.current) {
      buzz(25);
    }
  }, [state]);
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash((f) => (f?.id === flash.id ? null : f)), flash.kind === 'sold' ? 4200 : 1900);
    return () => clearTimeout(id);
  }, [flash]);

  // A new player takes the stage from the last SOLD. A guess sheet belongs to
  // one player: it closes when he leaves the block, or is replaced by another.
  const lotId = state?.lot?.id ?? null;
  useEffect(() => {
    if (lotId) setFlash(null);
    setSheet((s) => (s?.kind === 'guess' ? null : s));
  }, [lotId]);

  const history = useMemo(() => (state ? hammerHistory(state) : []), [state?.players, state?.teams]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state) return <div className="page-loading">Connecting…</div>;

  const showTier = state.settings.showTier !== false;
  const lot = state.lot;
  const lotPlayer = lot ? state.players.find((p) => p.id === lot.playerId) ?? null : null;
  const tier = lotPlayer ? state.settings.tiers.find((t) => t.key === lotPlayer.tierKey) : undefined;
  const leading = lot?.leadingTeamId ? state.teams.find((t) => t.id === lot.leadingTeamId) ?? null : null;
  const followTeam = state.teams.find((t) => t.id === follow) ?? null;
  const followId = followTeam?.id ?? null;
  const view = state.stage === 'completed' ? 'final' : lot && lotPlayer ? 'lot' : state.timeout ? 'timeout' : 'idle';
  const guess = lot && myGuess?.lotId === lot.id ? myGuess : null;
  const sheetPlayer = sheet?.kind === 'player' ? state.players.find((p) => p.id === sheet.id) ?? null : null;
  // The emoji bar: on the Live tab, once the auction is running, while the organiser allows it.
  const dock = tab === 'live' && view !== 'final' && state.settings.audienceReactions && state.stage !== 'setup';

  const pickTeam = (id: string) => {
    setFollow(id);
    setSheet(null);
    if (buzzOn) buzz(15);
  };
  const openSquad = (teamId: string) => {
    setSquadFocus(teamId);
    setTab('squads');
  };
  const share = (target: ShareTarget) => setSheet({ kind: 'share', target });
  const sound = () => {
    toggleMuted();
    setSoundAsked(true);
  };

  return (
    <div
      className="w-page"
      data-tab={tab}
      data-view={view}
      data-dock={dock ? '' : undefined}
      style={vars({
        '--follow': followTeam?.color ?? 'var(--ad-run-mint)',
        '--lead': leading?.color ?? tier?.color ?? 'transparent',
      })}
    >
      <header className="w-head">
        <Link to="/" className="w-brand"><i aria-hidden /><span>{state.settings.auctionName}</span></Link>
        <span className={`w-watching${connected ? '' : ' off'}`} title={connected ? 'Screens connected right now' : 'Reconnecting'}>
          <i aria-hidden />
          {connected ? (presence ? <><Icon name="eye" /><Odometer value={presence.watching} /></> : 'Live') : 'Offline'}
        </span>
        <button
          className={`w-icon-btn${muted ? '' : ' on'}`}
          onClick={sound}
          aria-pressed={!muted}
          aria-label={muted ? 'Sound is off. Turn the auction sounds on' : 'Sound is on. Turn the auction sounds off'}
        >
          <Icon name={muted ? 'mute' : 'volume'} />
        </button>
        <button className="w-icon-btn" onClick={() => setSheet({ kind: 'menu' })} aria-label="More"><Icon name="more" /></button>
      </header>
      <OfflineBanner connected={connected} />

      <Scoreboard state={state} leadingId={leading?.id ?? null} follow={followId} onPick={openSquad} />

      <main className="w-main" key={tab}>
        {tab === 'live' && (
          <>
            {muted && !soundAsked && (
              <button className="w-sound-hint" onClick={sound}><Icon name="mute" /> Tap for sound</button>
            )}
            {view === 'lot' && lot && lotPlayer && (
              <>
                <SoldTicker history={history} />
                <LotStage key={lot.id} state={state} lot={lot} player={lotPlayer} tier={showTier ? tier : undefined} follow={followId} />
                <GuessBar state={state} lot={lot} myGuess={guess} onOpen={() => setSheet({ kind: 'guess' })} />
              </>
            )}
            {view === 'idle' && (
              <IdleStage state={state} showTier={showTier} last={history[0] ?? null} myTag={myTag} onShare={share} />
            )}
            {view === 'timeout' && <TimeoutStage state={state} onSquads={() => setTab('squads')} />}
            {view === 'final' && <FinalStage state={state} myTag={myTag} onSquads={() => setTab('squads')} onShare={share} />}
            <Feed
              state={state}
              lot={view === 'lot' ? lot : null}
              history={history}
              follow={followId}
              onShare={share}
              onPlayer={(id) => setSheet({ kind: 'player', id })}
            />
          </>
        )}
        {tab === 'squads' && (
          <SquadsTab
            state={state}
            follow={followId}
            focus={squadFocus}
            onFollow={pickTeam}
            onShare={share}
            onPlayer={(id) => setSheet({ kind: 'player', id })}
          />
        )}
        {tab === 'pool' && <PoolTab state={state} onPlayer={(id) => setSheet({ kind: 'player', id })} />}
      </main>

      {tab === 'live' && view !== 'final' && <ReactionDock enabled={dock} />}

      <nav className="w-tabs" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} aria-current={tab === t.key ? 'page' : undefined} onClick={() => setTab(t.key)}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
            {t.key === 'live' && lot && <i className="w-tabs-live" aria-hidden />}
          </button>
        ))}
        <i className="w-tabs-ink" style={vars({ '--tab': TABS.findIndex((t) => t.key === tab) })} aria-hidden />
      </nav>

      {flash && (
        <Takeover
          key={flash.id}
          flash={flash}
          state={state}
          mine={flash.team?.id === followId && followId !== null}
          myTag={myTag}
          onShare={() => {
            setFlash(null);
            share({ kind: 'sale', playerId: flash.player.id });
          }}
          onClose={() => setFlash(null)}
        />
      )}

      {sheet?.kind === 'menu' && (
        <MenuSheet
          muted={muted}
          onSound={sound}
          buzzOn={buzzOn}
          onBuzz={() => {
            setBuzzOn(!buzzOn);
            if (!buzzOn) buzz(30);
          }}
          followTeam={followTeam}
          onFollow={() => setSheet({ kind: 'follow' })}
          theme={theme}
          onTheme={toggleTheme}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'follow' && (
        <FollowSheet
          state={state}
          follow={followId}
          onPick={pickTeam}
          onClose={() => {
            if (follow === null) setFollow('none'); // asked once; "Just watching" until they choose
            setSheet(null);
          }}
        />
      )}
      {sheet?.kind === 'guess' && lot && lotPlayer && (
        <GuessSheet
          state={state}
          lot={lot}
          player={lotPlayer}
          onClose={() => setSheet(null)}
          onLocked={(g, tag) => {
            setMyGuess(g);
            setMyTag(tag); // from the answer itself: storage may be blocked
            setSheet(null);
          }}
        />
      )}
      {sheet?.kind === 'share' && <ShareSheet state={state} target={sheet.target} onClose={() => setSheet(null)} />}
      {sheetPlayer && <PlayerSheet state={state} player={sheetPlayer} onClose={() => setSheet(null)} onShare={share} />}
    </div>
  );
}

/* ---------------- scoreboard: every team's purse and squad, always in view ---------------- */

/** A team's name on the scoreboard, always in full: it shrinks to fit its
 *  half of the board, and only a name still too long at 11px takes a second
 *  line. Following a team adds a marker in front, so that refits it too. */
function ScoreName({ name, mine }: { name: string; mine: boolean }) {
  const ref = useFit<HTMLSpanElement>(mine ? `${name}\u0000mine` : name, 11);
  return <span ref={ref} className="w-score-name">{name}</span>;
}

function Scoreboard({ state, leadingId, follow, onPick }: {
  state: StateView;
  leadingId: string | null;
  follow: string | null;
  onPick: (teamId: string) => void;
}) {
  const max = state.settings.maxSquad;
  const duel = state.teams.length === 2;
  // With more teams than fit, the strip scrolls: your team first, and it
  // slides to whoever has just taken the lead.
  const teams = useMemo(
    () => (state.teams.length > 2 ? [...state.teams].sort((a, b) => Number(b.id === follow) - Number(a.id === follow)) : state.teams),
    [state.teams, follow],
  );
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = strip.current;
    const lead = el?.querySelector<HTMLElement>('.w-score-team.leading');
    if (!el || !lead || el.scrollWidth <= el.clientWidth) return;
    el.scrollTo({ left: Math.max(0, lead.offsetLeft - (el.clientWidth - lead.offsetWidth) / 2), behavior: 'smooth' });
  }, [leadingId]);
  // A purse that just changed floats the difference off the board ("−1,600").
  const before = useRef<Record<string, number>>({});
  const [deltas, setDeltas] = useState<Record<string, { id: number; amount: number }>>({});
  useEffect(() => {
    const moved: Record<string, { id: number; amount: number }> = {};
    for (const t of state.teams) {
      const was = before.current[t.id];
      if (was !== undefined && was !== t.remaining) moved[t.id] = { id: Date.now(), amount: t.remaining - was };
      before.current[t.id] = t.remaining;
    }
    if (Object.keys(moved).length > 0) setDeltas((d) => ({ ...d, ...moved }));
  }, [state.teams]);
  return (
    <div
      ref={strip}
      className={`w-score${duel ? ' duel' : state.teams.length > 2 ? ' multi' : ''}`}
      style={vars({ '--n': Math.min(state.teams.length, 4) })}
    >
      {teams.map((t) => (
        <button
          key={t.id}
          className={`w-score-team${t.id === leadingId ? ' leading' : ''}${t.id === follow ? ' mine' : ''}${t.full ? ' full' : ''}`}
          style={vars({ '--team': t.color })}
          onClick={() => onPick(t.id)}
          aria-label={`${t.name}: ${fmt(t.remaining)} points left, ${t.count} of ${max} bought. Open the squad`}
        >
          <ScoreName name={t.name} mine={t.id === follow} />
          <span className="w-score-purse">
            <Odometer value={t.remaining} />
            {deltas[t.id] && (
              <i key={deltas[t.id].id} className={`w-score-delta${deltas[t.id].amount > 0 ? ' up' : ''}`} aria-hidden>
                {deltas[t.id].amount > 0 ? '+' : '−'}{fmt(Math.abs(deltas[t.id].amount))}
              </i>
            )}
          </span>
          <span className="w-score-meta">
            <Pips total={max} filled={t.count} />
            <span>{t.count}/{max}</span>
          </span>
        </button>
      ))}
      {duel && <span className="w-score-vs" aria-hidden>VS</span>}
    </div>
  );
}

/* ---------------- SOLD / UNSOLD takeover ---------------- */

function Takeover({ flash, state, mine, myTag, onShare, onClose }: {
  flash: Flash;
  state: StateView;
  mine: boolean;
  myTag: string | null;
  onShare: () => void;
  onClose: () => void;
}) {
  // The price rolls up once the name has landed; with motion reduced it is simply there.
  const [price, setPrice] = useState(() => (window.matchMedia('(prefers-reduced-motion: reduce)').matches ? flash.player.price ?? 0 : 0));
  useEffect(() => {
    const id = setTimeout(() => setPrice(flash.player.price ?? 0), 620);
    return () => clearTimeout(id);
  }, [flash]);
  const nameRef = useFit<HTMLDivElement>(flash.player.name);
  const confetti = useMemo(() => Array.from({ length: 16 }, (_, i) => ({
    x: Math.random() * 100,
    delay: 300 + Math.random() * 500,
    turn: (Math.random() - 0.5) * 720,
    drift: (Math.random() - 0.5) * 120,
    kind: i % 3,
  })), []);

  if (flash.kind === 'unsold' || !flash.team) {
    return (
      <div className="w-take unsold" onClick={onClose} role="status">
        <div className="w-take-inner">
          <div className="w-take-stamp">Unsold</div>
          <div className="w-take-name" ref={nameRef}>{flash.player.name}</div>
          <p>No bids. Back in the accelerated round.</p>
        </div>
      </div>
    );
  }
  const team = flash.team;
  const result = state.guessResult?.playerId === flash.player.id ? state.guessResult : null;
  const best = result?.top[0];
  return (
    <div
      className={`w-take sold${mine ? ' mine' : ''}`}
      style={vars({ '--team': team.color, '--ink': inkOn(team.color) })}
      onClick={onClose}
      role="status"
    >
      <div className="w-take-wipe" aria-hidden />
      <div className="w-take-confetti" aria-hidden>
        {confetti.map((c, i) => (
          <i key={i} className={`k${c.kind}`} style={vars({ '--x': `${c.x}%`, '--delay': `${c.delay}ms`, '--turn': `${c.turn}deg`, '--drift': `${c.drift}px` })} />
        ))}
      </div>
      <div className="w-take-inner">
        <div className="w-take-sold"><Letters text="SOLD" /></div>
        <div className="w-take-photo"><PlayerPhoto url={flash.player.photoUrl} name={flash.player.name} size="lg" /></div>
        <div className="w-take-name" ref={nameRef} style={vars({ '--fit': Math.max(0.55, Math.min(1, 14 / flash.player.name.length)) })}>{flash.player.name}</div>
        <div className="w-take-team" style={vars({ '--tfit': Math.max(0.6, Math.min(1, 16 / team.name.length)) })}>
          {mine ? 'Your team gets the player' : 'Goes to'}<b>{team.name}</b>
        </div>
        <div className="w-take-price"><Odometer value={price} /><span>pts</span></div>
        {best && (
          <div className="w-take-guess">
            <Icon name="target" />
            {best.tag === myTag ? 'You were closest' : `Closest guess: ${best.name ?? 'a fan'}`}
            <b>{fmt(best.amount)}</b>
          </div>
        )}
        <button
          className="btn"
          onClick={(e) => {
            e.stopPropagation();
            onShare();
          }}
        >
          <Icon name="share" /> Share
        </button>
      </div>
    </div>
  );
}

/* ---------------- sheets ---------------- */

function FollowSheet({ state, follow, onPick, onClose }: {
  state: StateView;
  follow: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="Who are you backing?" name="follow" onClose={onClose}>
      <p className="w-sheet-lead">Pick a team and its bids, buys and squad come first. You can change this any time from the menu.</p>
      <div className="w-teams">
        {state.teams.map((t, i) => (
          <button
            key={t.id}
            className={`w-team-tile${t.id === follow ? ' on' : ''}`}
            style={vars({ '--team': t.color, '--ink': inkOn(t.color), '--i': i })}
            onClick={() => onPick(t.id)}
            aria-pressed={t.id === follow}
          >
            <b>{t.name}</b>
            <span>{t.captain ? `Capt. ${t.captain}` : `${t.count}/${state.settings.maxSquad} bought`}</span>
          </button>
        ))}
      </div>
      <button className="btn wide" onClick={() => onPick('none')}>Just watching</button>
    </Sheet>
  );
}

function MenuSheet({ muted, onSound, buzzOn, onBuzz, followTeam, onFollow, theme, onTheme, onClose }: {
  muted: boolean;
  onSound: () => void;
  buzzOn: boolean;
  onBuzz: () => void;
  followTeam: TeamView | null;
  onFollow: () => void;
  theme: 'light' | 'dark';
  onTheme: () => void;
  onClose: () => void;
}) {
  const { how, install } = useInstall();
  return (
    <Sheet title="Settings" name="menu" onClose={onClose}>
      <div className="w-rows">
        <button className="w-row" onClick={onSound} role="switch" aria-checked={!muted}>
          <Icon name={muted ? 'mute' : 'volume'} />
          <span><b>Sound</b><small>New player, each bid, and the SOLD gavel</small></span>
          <i className={`w-switch${muted ? '' : ' on'}`} aria-hidden />
        </button>
        {canBuzz() && (
          <button className="w-row" onClick={onBuzz} role="switch" aria-checked={buzzOn}>
            <Icon name="vibrate" />
            <span><b>Buzz on SOLD</b><small>A short vibration, even with sound off</small></span>
            <i className={`w-switch${buzzOn ? ' on' : ''}`} aria-hidden />
          </button>
        )}
        <button className="w-row" onClick={onFollow}>
          <Icon name="shield" />
          <span><b>Your team</b><small>{followTeam ? followTeam.name : 'Just watching'}</small></span>
          <Icon name="chevron" />
        </button>
        <button className="w-row" onClick={onTheme}>
          <Icon name="sun" />
          <span><b>{theme === 'dark' ? 'Light' : 'Dark'} mode</b><small>Now: {theme}</small></span>
          <Icon name="chevron" />
        </button>
        {how === 'prompt' && (
          <button className="w-row" onClick={install}>
            <Icon name="install" />
            <span><b>Add to Home Screen</b><small>Opens full screen, like an app</small></span>
            <Icon name="chevron" />
          </button>
        )}
        {how === 'ios' && (
          <div className="w-row static">
            <Icon name="install" />
            <span><b>Add to Home Screen</b><small>Tap the Share button, then “Add to Home Screen”</small></span>
          </div>
        )}
        {how === 'none' && (
          <div className="w-row static">
            <Icon name="install" />
            <span><b>Add to Home Screen</b><small>In your browser’s menu, choose “Add to Home screen” or “Install”</small></span>
          </div>
        )}
        <Link className="w-row" to="/screen?big=1">
          <Icon name="monitor" />
          <span><b>Big-screen layout</b><small>The projector view, for a TV or laptop</small></span>
          <Icon name="chevron" />
        </Link>
      </div>
    </Sheet>
  );
}

/** Makes the picture, shows it, and hands it to the phone's share sheet. */
function ShareSheet({ state, target, onClose }: { state: StateView; target: ShareTarget; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const blob = useRef<Blob | null>(null);
  const info = useRef<{ file: string; text: string }>({ file: 'auction.png', text: '' });

  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    (async () => {
      try {
        let picture: Blob;
        const auctionName = state.settings.auctionName;
        if (target.kind === 'sale') {
          const p = state.players.find((x) => x.id === target.playerId);
          const team = p ? state.teams.find((t) => t.id === p.teamId) : undefined;
          if (!p || !team || p.status !== 'sold' || p.price === null) throw new Error('That sale is no longer on the books');
          const tier = state.settings.showTier !== false ? state.settings.tiers.find((t) => t.key === p.tierKey) : undefined;
          picture = await renderSaleCard({
            auctionName, playerName: p.name, photoUrl: p.photoUrl, teamName: team.name, teamColor: team.color,
            price: p.price, tierName: tier?.name ?? null, bids: p.bids,
          });
          info.current = { file: `${p.name}-sold.png`.replace(/\s+/g, '-').toLowerCase(), text: `${p.name} goes to ${team.name} for ${fmt(p.price)} — ${auctionName}` };
        } else {
          const team = state.teams.find((t) => t.id === target.teamId);
          if (!team) throw new Error('That team is no longer in the auction');
          const players = state.players
            .filter((p) => p.teamId === team.id && p.status === 'sold')
            .sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
            .map((p) => ({ name: p.name, price: p.price ?? 0 }));
          picture = await renderSquadCard({
            auctionName, teamName: team.name, teamColor: team.color, captain: team.captain, spent: team.spent, players,
          });
          info.current = { file: `${team.name}-squad.png`.replace(/\s+/g, '-').toLowerCase(), text: `${team.name} — ${auctionName}` };
        }
        if (!alive) return;
        blob.current = picture;
        made = URL.createObjectURL(picture);
        setUrl(made);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Could not make the picture');
      }
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!blob.current) return;
    const how = await sharePicture(blob.current, info.current.file, info.current.text);
    setNote(how === 'saved' ? 'Saved to your downloads' : how === 'shared' ? 'Shared' : null);
  };

  return (
    <Sheet title="Share" name="share" onClose={onClose}>
      <div className="w-share">
        {error ? <div className="notice error">{error}</div>
          : url ? <img src={url} alt="The picture to share" />
          : <div className="w-share-wait">Making your picture…</div>}
      </div>
      {note && <div className="notice ok">{note}</div>}
      <button className="btn primary big" disabled={!url} onClick={send}><Icon name="share" /> Share picture</button>
      {url && <p className="w-sheet-lead w-share-tip">Or press and hold the picture to save or share it.</p>}
    </Sheet>
  );
}
