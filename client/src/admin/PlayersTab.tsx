import { useMemo, useState } from 'react';
import { api } from '../api';
import { PlayerView, StateView } from '../types';
import { fmt, Modal, PlayerPhoto, useAction, useToast } from '../ui';

/** The player's photo-upload link (admin-only — the code is a secret). */
function photoLinkFor(state: StateView, playerId: string): string | null {
  const code = state.admin?.photoCodes.find((c) => c.playerId === playerId)?.code;
  return code ? `${window.location.origin}/photo/${code}` : null;
}

const STAT_FIELDS: { key: string; label: string }[] = [
  { key: 'mat', label: 'Matches' },
  { key: 'runs', label: 'Runs' },
  { key: 'batAvg', label: 'Bat avg' },
  { key: 'batSR', label: 'Bat SR' },
  { key: 'wkts', label: 'Wickets' },
  { key: 'bowlAvg', label: 'Bowl avg' },
  { key: 'econ', label: 'Economy' },
  { key: 'mvpS1', label: 'MVP S1' },
  { key: 'mvpS2', label: 'MVP S2' },
  { key: 'mvpS3', label: 'MVP S3' },
];

export default function PlayersTab({ state }: { state: StateView }) {
  const run = useAction();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<PlayerView | null>(null);
  const [adding, setAdding] = useState(false);
  const [bulk, setBulk] = useState(false);
  const [assigning, setAssigning] = useState<PlayerView | null>(null);

  const players = useMemo(() => {
    const q = query.trim().toLowerCase();
    return state.players
      .filter((p) => (!tierFilter || p.tierKey === tierFilter))
      .filter((p) => (!statusFilter || p.status === statusFilter))
      .filter((p) => (!q || p.name.toLowerCase().includes(q) || p.role.toLowerCase().includes(q)));
  }, [state.players, query, tierFilter, statusFilter]);

  return (
    <div className="card">
      <div className="row wrap">
        <input className="input grow" placeholder="Search players…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select className="input" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}>
          <option value="">All tiers</option>
          {state.settings.tiers.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
        </select>
        <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="available">Available</option>
          <option value="sold">Sold</option>
          <option value="unsold">Unsold</option>
        </select>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add player</button>
        <button className="btn" onClick={() => setBulk(true)}>Bulk add</button>
        <button
          className="btn"
          title="Copy every player's photo-upload link — paste into the players' group chat"
          onClick={async () => {
            const lines = state.players
              .map((p) => {
                const link = photoLinkFor(state, p.id);
                return link ? `${p.name}: ${link}` : null;
              })
              .filter(Boolean)
              .join('\n');
            try {
              await navigator.clipboard.writeText(lines);
              toast('All photo-upload links copied — share each player their own link', 'ok');
            } catch {
              toast('Could not copy — open a player with Edit to copy links one by one');
            }
          }}
        >
          📸 Copy photo links
        </button>
      </div>

      <table className="table players-table">
        <thead>
          <tr><th>Player</th><th>Tier</th><th>Role</th><th>Base</th><th>Status</th><th>Team</th><th>Price</th><th></th></tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const tier = state.settings.tiers.find((t) => t.key === p.tierKey);
            const team = state.teams.find((t) => t.id === p.teamId);
            return (
              <tr key={p.id}>
                <td>
                  <div className="player-cell">
                    <PlayerPhoto url={p.photoUrl} name={p.name} size="sm" />
                    <span>{p.name}{p.demandRank ? <span className="badge hot small-badge">#{p.demandRank}</span> : null}</span>
                  </div>
                </td>
                <td style={{ color: tier?.color }}>{tier?.name ?? p.tierKey}</td>
                <td className="muted">{p.role}</td>
                <td className="num">{fmt(p.basePrice)}</td>
                <td><span className={`status status-${p.status}`}>{p.status}</span></td>
                <td>{team?.name ?? ''}</td>
                <td className="num">{p.price !== null ? fmt(p.price) : ''}</td>
                <td className="actions">
                  <button className="btn ghost" onClick={() => setEditing(p)}>Edit</button>
                  {p.status !== 'sold' && state.stage !== 'setup' && (
                    <button className="btn ghost" onClick={() => setAssigning(p)}>Assign</button>
                  )}
                  {p.status === 'sold' && (
                    <button
                      className="btn ghost warn-text"
                      onClick={() => run(() => api.post('/api/admin/auction/release', { playerId: p.id }), `${p.name} released`)}
                    >
                      Release
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">{players.length} of {state.players.length} players shown.</p>

      {(adding || editing) && (
        <PlayerModal
          state={state}
          player={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
        />
      )}
      {bulk && <BulkModal state={state} onClose={() => setBulk(false)} />}
      {assigning && <AssignModal state={state} player={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}

function PlayerModal({ state, player, onClose }: { state: StateView; player: PlayerView | null; onClose: () => void }) {
  const run = useAction();
  const [form, setForm] = useState(() => ({
    name: player?.name ?? '',
    role: player?.role ?? '',
    tierKey: player?.tierKey ?? state.settings.tiers[0]?.key ?? '',
    basePriceOverride: player ? '' : '', // shown only as override; blank = tier base
    notes: player?.notes ?? '',
    demandRank: player?.demandRank ? String(player.demandRank) : '',
    sleeper: player?.sleeper ?? false,
    stats: Object.fromEntries(STAT_FIELDS.map((f) => [f.key, (player?.stats as any)?.[f.key] ?? ''])) as Record<string, unknown>,
    bestMvp: player?.stats.bestMvp ?? '',
  }));

  const save = () =>
    run(async () => {
      const body = {
        name: form.name,
        role: form.role,
        tierKey: form.tierKey,
        basePriceOverride: form.basePriceOverride === '' ? null : Number(form.basePriceOverride),
        notes: form.notes,
        demandRank: form.demandRank === '' ? null : Number(form.demandRank),
        sleeper: form.sleeper,
        stats: { ...form.stats, bestMvp: form.bestMvp },
      };
      if (player) await api.put(`/api/admin/players/${player.id}`, body);
      else await api.post('/api/admin/players', body);
      onClose();
    }, player ? 'Player updated' : 'Player added');

  const remove = () =>
    run(async () => {
      if (!player) return;
      if (!window.confirm(`Remove ${player.name} from the pool?`)) return;
      await api.del(`/api/admin/players/${player.id}`);
      onClose();
    }, 'Player removed');

  return (
    <Modal title={player ? `Edit ${player.name}` : 'Add player'} onClose={onClose}>
      <div className="form-grid">
        <label>Name<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Role<input className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></label>
        <label>Tier
          <select className="input" value={form.tierKey} onChange={(e) => setForm({ ...form, tierKey: e.target.value })}>
            {state.settings.tiers.map((t) => <option key={t.key} value={t.key}>{t.name} ({fmt(t.basePrice)})</option>)}
          </select>
        </label>
        <label>Base price override<input className="input" type="number" placeholder="tier default" value={form.basePriceOverride} onChange={(e) => setForm({ ...form, basePriceOverride: e.target.value })} /></label>
        <label>Hot-list rank<input className="input" type="number" value={form.demandRank} onChange={(e) => setForm({ ...form, demandRank: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={form.sleeper} onChange={(e) => setForm({ ...form, sleeper: e.target.checked })} /> Sleeper pick</label>
      </div>
      <details>
        <summary>Career stats</summary>
        <div className="form-grid">
          {STAT_FIELDS.map((f) => (
            <label key={f.key}>{f.label}
              <input
                className="input"
                type="number"
                step="any"
                value={String(form.stats[f.key] ?? '')}
                onChange={(e) => setForm({ ...form, stats: { ...form.stats, [f.key]: e.target.value } })}
              />
            </label>
          ))}
          <label>Best MVP<input className="input" value={form.bestMvp} onChange={(e) => setForm({ ...form, bestMvp: e.target.value })} /></label>
        </div>
      </details>
      <label>Notes<textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      {player && <PhotoLinkBox state={state} player={player} />}
      <div className="row end">
        {player && <button className="btn warn" onClick={remove}>Delete</button>}
        <button className="btn primary" disabled={!form.name.trim()} onClick={save}>{player ? 'Save' : 'Add'}</button>
      </div>
    </Modal>
  );
}

function PhotoLinkBox({ state, player }: { state: StateView; player: PlayerView }) {
  const run = useAction();
  const toast = useToast();
  // Read the live player for the photo: the modal's `player` prop is a snapshot
  // from when it was opened, and the photo may have been uploaded since.
  const live = state.players.find((p) => p.id === player.id) ?? player;
  const link = photoLinkFor(state, player.id);

  return (
    <div className="join-box">
      <PlayerPhoto url={live.photoUrl} name={live.name} size="md" />
      <div className="grow">
        <div className="muted small">Photo-upload link — send it to {live.name}; the same link also updates the photo later</div>
        <div className="row wrap">
          <button
            className="btn ghost"
            disabled={!link}
            onClick={async () => {
              if (!link) return;
              try {
                await navigator.clipboard.writeText(link);
                toast('Photo link copied', 'ok');
              } catch {
                toast(link, 'ok'); // clipboard blocked (non-HTTPS) — show it instead
              }
            }}
          >
            Copy link
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              if (window.confirm('Generate a new photo link? The old link stops working immediately.')) {
                run(() => api.post(`/api/admin/players/${player.id}/regenerate-photo-code`), 'New photo link generated');
              }
            }}
          >
            New link
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkModal({ state, onClose }: { state: StateView; onClose: () => void }) {
  const run = useAction();
  const [tierKey, setTierKey] = useState(state.settings.tiers[state.settings.tiers.length - 1]?.key ?? '');
  const [text, setText] = useState('');
  return (
    <Modal title="Bulk add players" onClose={onClose}>
      <p className="muted small">One player per line: <code>Name</code> or <code>Name, Role</code>. Handy when the pool grows to 32 or 36.</p>
      <label>Tier
        <select className="input" value={tierKey} onChange={(e) => setTierKey(e.target.value)}>
          {state.settings.tiers.map((t) => <option key={t.key} value={t.key}>{t.name} ({fmt(t.basePrice)})</option>)}
        </select>
      </label>
      <textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Rohit, Batter\nVirat\nBumrah, Fast bowler'} />
      <div className="row end">
        <button
          className="btn primary"
          disabled={!text.trim()}
          onClick={() => run(async () => {
            await api.post('/api/admin/players/bulk', { tierKey, text });
            onClose();
          }, 'Players added')}
        >
          Add all
        </button>
      </div>
    </Modal>
  );
}

function AssignModal({ state, player, onClose }: { state: StateView; player: PlayerView; onClose: () => void }) {
  const run = useAction();
  const [teamId, setTeamId] = useState('');
  const [price, setPrice] = useState(String(player.basePrice));
  return (
    <Modal title={`Assign ${player.name}`} onClose={onClose}>
      <p className="muted small">Auctioneer override — books the player to a team at any price (their decision is final). Bypasses the bid guardrail but never the remaining purse.</p>
      <label>Team
        <select className="input" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">Choose team…</option>
          {state.teams.map((t) => {
            const full = t.full;
            return <option key={t.id} value={t.id} disabled={full}>{t.name} — {fmt(t.remaining)} left{full ? ' (full)' : ''}</option>;
          })}
        </select>
      </label>
      <label>Price (pts)<input className="input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
      <div className="row end">
        <button
          className="btn primary"
          disabled={!teamId || price === ''}
          onClick={() => run(async () => {
            await api.post('/api/admin/auction/assign', { playerId: player.id, teamId, price: Number(price) });
            onClose();
          }, `${player.name} assigned`)}
        >
          Assign
        </button>
      </div>
    </Modal>
  );
}
