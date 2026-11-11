import { useEffect, useMemo, useRef, useState } from 'react';
import { inkOn } from '../audience';
import { Icon } from '../icons';
import { PlayerView, StateView, TeamView } from '../types';
import { fmt, PlayerPhoto, poolHasRecords, StatsGrid } from '../ui';
import { Odometer, Pips, saleNote, ShareTarget, Sheet, vars } from './parts';

// The Squads and Pool tabs, and the sheet for one player.

/* ---------------- squads: one team per swipe ---------------- */

export function SquadsTab({ state, follow, focus, onFollow, onShare, onPlayer }: {
  state: StateView;
  follow: string | null;
  focus: string | null; // the team to open on
  onFollow: (teamId: string) => void;
  onShare: (t: ShareTarget) => void;
  onPlayer: (id: string) => void;
}) {
  // The team you follow comes first.
  const teams = useMemo(
    () => [...state.teams].sort((a, b) => Number(b.id === follow) - Number(a.id === follow)),
    [state.teams, follow],
  );
  const rail = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const go = (i: number, smooth = true) => {
    const el = rail.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * i, behavior: smooth ? 'smooth' : 'auto' });
    setIndex(i);
  };
  // Open on the team that was tapped on the scoreboard.
  useEffect(() => {
    const i = teams.findIndex((t) => t.id === focus);
    if (i > 0) go(i, false);
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  // Following a team moves it to the front: go with it, so the squad on
  // screen is still the one whose button was just tapped.
  const followed = useRef(follow);
  useEffect(() => {
    if (followed.current === follow) return;
    followed.current = follow;
    go(0, false);
  }, [follow]); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    const el = rail.current;
    if (!el || el.clientWidth === 0) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index) setIndex(i);
  };

  return (
    <div className="w-squads">
      <div className="w-squad-nav" role="tablist" aria-label="Teams">
        {teams.map((t, i) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={i === index}
            className={i === index ? 'on' : ''}
            style={vars({ '--team': t.color })}
            onClick={() => go(i)}
          >
            {t.name}
          </button>
        ))}
      </div>
      <div className="w-squad-rail" ref={rail} onScroll={onScroll}>
        {teams.map((t) => (
          <SquadPanel
            key={t.id}
            state={state}
            team={t}
            mine={t.id === follow}
            onFollow={() => onFollow(t.id)}
            onShare={() => onShare({ kind: 'squad', teamId: t.id })}
            onPlayer={onPlayer}
          />
        ))}
      </div>
      {teams.length > 1 && (
        <div className="w-dots" aria-hidden>
          {teams.map((t, i) => <i key={t.id} className={i === index ? 'on' : ''} />)}
        </div>
      )}
    </div>
  );
}

function SquadPanel({ state, team, mine, onFollow, onShare, onPlayer }: {
  state: StateView;
  team: TeamView;
  mine: boolean;
  onFollow: () => void;
  onShare: () => void;
  onPlayer: (id: string) => void;
}) {
  const squad = state.players
    .filter((p) => p.teamId === team.id && p.status === 'sold')
    .sort((a, b) => (b.price ?? 0) - (a.price ?? 0));
  const max = state.settings.maxSquad;
  const open = Math.max(0, max - squad.length);
  const frac = team.purse > 0 ? Math.max(0, Math.min(1, team.remaining / team.purse)) : 0;
  const who = [team.owner && `Owner ${team.owner}`, team.captain && `Capt. ${team.captain}`].filter(Boolean).join(' · ');
  return (
    <article
      className="w-squad"
      style={vars({ '--team': team.color, '--ink': inkOn(team.color), '--fit': Math.max(0.6, Math.min(1, 16 / team.name.length)) })}
      aria-label={team.name}
    >
      <header className="w-squad-head">
        <h2>{team.name}</h2>
        {who && <p>{who}</p>}
        <div className="w-squad-purse">
          <div>
            <span className="w-label">Points left</span>
            <Odometer value={team.remaining} />
          </div>
          <div>
            <span className="w-label">Bought</span>
            <b>{team.count}<small>/{max}</small></b>
          </div>
        </div>
        <div className="w-fuel"><i style={{ transform: `scaleX(${frac})` }} /></div>
        <div className="w-squad-meta">
          <Pips total={max} filled={team.count} />
          <span>{team.full ? 'Squad full' : `Max bid ${fmt(team.maxBid)}`}</span>
        </div>
      </header>
      <div className="w-squad-actions">
        <button className={`btn${mine ? ' ok' : ''}`} onClick={onFollow} aria-pressed={mine}>
          {mine ? <><Icon name="check" /> Following</> : 'Follow this team'}
        </button>
        <button className="btn" onClick={onShare} disabled={squad.length === 0}><Icon name="share" /> Share</button>
      </div>
      <ol className="w-roster">
        {team.captain && (
          <li className="cap">
            <span className="w-roster-n">C</span>
            <span className="w-roster-name">{team.captain}</span>
            <span className="w-roster-note">Captain</span>
          </li>
        )}
        {squad.map((p, i) => (
          <li key={p.id} style={vars({ '--i': i })}>
            <button onClick={() => onPlayer(p.id)}>
              <span className="w-roster-n">{String(i + 1).padStart(2, '0')}</span>
              <PlayerPhoto url={p.photoUrl} name={p.name} size="sm" />
              <span className="w-roster-name"><span>{p.name}</span>{i === 0 && squad.length > 1 && <em>Top buy</em>}</span>
              <b>{fmt(p.price)}</b>
            </button>
          </li>
        ))}
        {open > 0 && (
          <li className="open">
            <span className="w-roster-n">{String(squad.length + 1).padStart(2, '0')}</span>
            <span className="w-roster-note">{open} place{open === 1 ? '' : 's'} still to fill</span>
          </li>
        )}
      </ol>
    </article>
  );
}

/* ---------------- pool: every player by category ---------------- */

type PoolFilter = 'left' | 'sold' | 'all';

export function PoolTab({ state, onPlayer }: { state: StateView; onPlayer: (id: string) => void }) {
  const [filter, setFilter] = useState<PoolFilter>(state.stage === 'completed' ? 'all' : 'left');
  const showTier = state.settings.showTier !== false;
  const left = state.players.filter((p) => p.status !== 'sold');
  const sold = state.players.filter((p) => p.status === 'sold');
  const shown = filter === 'left' ? left : filter === 'sold' ? sold : state.players;
  const tiers = [...state.settings.tiers].sort((a, b) => a.order - b.order);
  const groups = showTier
    ? tiers.map((t) => ({ tier: t, all: state.players.filter((p) => p.tierKey === t.key), players: shown.filter((p) => p.tierKey === t.key) }))
      .filter((g) => g.all.length > 0)
    : [{ tier: null, all: state.players, players: shown }];
  const tabs: { key: PoolFilter; label: string; n: number }[] = [
    { key: 'left', label: 'To come', n: left.length },
    { key: 'sold', label: 'Sold', n: sold.length },
    { key: 'all', label: 'Everyone', n: state.players.length },
  ];
  return (
    <div className="w-pool">
      <div className="w-seg" role="tablist" aria-label="Show">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={filter === t.key} className={filter === t.key ? 'on' : ''} onClick={() => setFilter(t.key)}>
            {t.label} <span>{t.n}</span>
          </button>
        ))}
      </div>
      {groups.map(({ tier, all, players }) => {
        const done = all.filter((p) => p.status === 'sold').length;
        return (
          <section key={tier?.key ?? 'all'} className="w-pool-group" style={vars({ '--tier': tier?.color ?? 'var(--ad-text)' })}>
            {tier && (
              <header className="w-pool-head">
                <h2>{tier.name}</h2>
                <span className="w-label">Base {fmt(tier.basePrice)}</span>
                <span className="w-pool-count">{done}/{all.length} sold</span>
                <div className="w-fuel"><i style={{ transform: `scaleX(${all.length ? done / all.length : 0})` }} /></div>
              </header>
            )}
            {players.length === 0 ? (
              <p className="w-pool-empty">{filter === 'left' ? 'All sold.' : filter === 'sold' ? 'None sold yet.' : 'No players.'}</p>
            ) : (
              <ul className="w-pool-list">
                {players.map((p) => <PoolRow key={p.id} state={state} player={p} onPlayer={onPlayer} />)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function PoolRow({ state, player, onPlayer }: { state: StateView; player: PlayerView; onPlayer: (id: string) => void }) {
  const team = player.status === 'sold' ? state.teams.find((t) => t.id === player.teamId) : undefined;
  const live = state.lot?.playerId === player.id;
  return (
    <li className={`w-pool-row${live ? ' live' : ''}${player.status === 'sold' ? ' sold' : ''}`}>
      <button onClick={() => onPlayer(player.id)} style={team ? vars({ '--team': team.color }) : undefined}>
        <PlayerPhoto url={player.photoUrl} name={player.name} size="sm" />
        <span className="w-pool-who">
          <b>{player.name}</b>
          {player.role && <span>{player.role}</span>}
        </span>
        {live ? (
          <span className="w-pool-live">On the block</span>
        ) : team ? (
          <span className="w-pool-sold"><i />{team.name}<b>{fmt(player.price)}</b></span>
        ) : player.status === 'unsold' ? (
          <span className="w-pool-unsold">Unsold</span>
        ) : (
          <span className="w-pool-base">{fmt(player.basePrice)}</span>
        )}
      </button>
    </li>
  );
}

/* ---------------- one player ---------------- */

export function PlayerSheet({ state, player, onClose, onShare }: {
  state: StateView;
  player: PlayerView;
  onClose: () => void;
  onShare: (t: ShareTarget) => void;
}) {
  const tier = state.settings.showTier !== false ? state.settings.tiers.find((t) => t.key === player.tierKey) : undefined;
  const team = player.status === 'sold' ? state.teams.find((t) => t.id === player.teamId) : undefined;
  const live = state.lot?.playerId === player.id;
  return (
    <Sheet title={player.name} name="player" onClose={onClose}>
      <div className="w-player" style={vars({ '--tier': tier?.color ?? 'var(--ad-text)' })}>
        <div className="w-lot-photo"><PlayerPhoto url={player.photoUrl} name={player.name} size="lg" /></div>
        <div className="w-chips">
          {tier && <span className="w-chip tier">{tier.name}</span>}
          {player.role && <span className="w-chip">{player.role}</span>}
          <span className="w-chip line">Base {fmt(player.basePrice)}</span>
        </div>
      </div>
      {team ? (
        <div className="w-player-sold" style={vars({ '--team': team.color, '--ink': inkOn(team.color) })}>
          <span>Sold to</span>
          <b>{team.name}</b>
          <strong>{fmt(player.price)}</strong>
          {saleNote(player) && <em>{saleNote(player)}</em>}
        </div>
      ) : (
        <p className="w-player-status">
          {live ? 'On the block right now.'
            : player.status === 'unsold' ? 'Unsold so far. Comes back in the accelerated round.'
            : state.stage === 'setup' ? 'Waiting for the auction to start.'
            : 'Still to come.'}
        </p>
      )}
      {poolHasRecords(state.players) && <StatsGrid player={player} players={state.players} compact />}
      {player.notes && <p className="w-sheet-lead">{player.notes}</p>}
      {team && (
        <button className="btn primary big" onClick={() => onShare({ kind: 'sale', playerId: player.id })}>
          <Icon name="share" /> Share this sale
        </button>
      )}
    </Sheet>
  );
}
