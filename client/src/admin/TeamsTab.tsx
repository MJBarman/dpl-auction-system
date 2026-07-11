import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { StateView, TeamView } from '../types';
import { fmt, Modal, useAction, useToast } from '../ui';

export default function TeamsTab({ state }: { state: StateView }) {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <div className="teams-grid">
        {state.teams.map((t) => (
          <TeamCard key={t.id} state={state} team={t} />
        ))}
        <button className="card add-team" onClick={() => setAdding(true)}>+ Add team</button>
      </div>
      {adding && <TeamModal onClose={() => setAdding(false)} />}
    </div>
  );
}

function TeamCard({ state, team }: { state: StateView; team: TeamView }) {
  const run = useAction();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const code = state.admin?.teamCodes.find((c) => c.teamId === team.id)?.code ?? '——';
  const joinUrl = `${window.location.origin}/join/${code}`;

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(joinUrl, { margin: 1, width: 160, color: { dark: '#0b1020', light: '#ffffff' } })
      .then((url) => { if (alive) setQr(url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [joinUrl]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      toast('Join link copied', 'ok');
    } catch {
      toast(joinUrl, 'ok'); // clipboard blocked (non-HTTPS) — show it instead
    }
  };

  const roster = state.players.filter((p) => p.status === 'sold' && p.teamId === team.id);
  const devices = state.admin?.teamSessions?.find((s) => s.teamId === team.id)?.devices ?? 0;

  return (
    <div className="card team-card" style={{ borderTop: `3px solid ${team.color}` }}>
      <div className="row space-between">
        <h3 style={{ color: team.color }}>{team.name}</h3>
        <button className="btn ghost" onClick={() => setEditing(true)}>Edit</button>
      </div>
      <div className="muted">Captain: {team.captain || '—'}</div>
      <div className="team-money">
        <span>Spent {fmt(team.spent)}</span>
        <span>Left {fmt(team.remaining)}</span>
        <span>{team.count}/{state.settings.maxSquad} players</span>
      </div>
      <div className="join-box">
        {qr && <img src={qr} alt="Join QR" className="qr" />}
        <div>
          <div className="muted small">Captain's private join code</div>
          <div className="join-code">{code}</div>
          <div className="row">
            <button className="btn ghost" onClick={copy}>Copy link</button>
            <button
              className="btn ghost"
              onClick={() => {
                if (window.confirm('Regenerate the code? The captain’s signed-in devices will be logged out.')) {
                  run(() => api.post(`/api/admin/teams/${team.id}/regenerate-code`), 'New code generated');
                }
              }}
            >
              New code
            </button>
          </div>
          <div className={`small ${devices > 1 ? 'warn-text' : 'muted'}`}>
            {devices === 0
              ? 'No devices signed in yet'
              : devices === 1
                ? '1 device signed in'
                : `⚠ ${devices} devices signed in — every one of them can bid. Unexpected? "New code" logs them all out.`}
          </div>
        </div>
      </div>
      {roster.length > 0 && (
        <ul className="mini-roster">
          {roster.map((p) => <li key={p.id}>{p.name} <span className="muted">({fmt(p.price)})</span></li>)}
        </ul>
      )}
      {editing && <TeamModal team={team} onClose={() => setEditing(false)} />}
    </div>
  );
}

function TeamModal({ team, onClose }: { team?: TeamView; onClose: () => void }) {
  const run = useAction();
  const [form, setForm] = useState({
    name: team?.name ?? '',
    captain: team?.captain ?? '',
    color: team?.color ?? '#64748b',
  });

  const save = () =>
    run(async () => {
      if (team) await api.put(`/api/admin/teams/${team.id}`, form);
      else await api.post('/api/admin/teams', form);
      onClose();
    }, team ? 'Team updated' : 'Team added');

  const remove = () =>
    run(async () => {
      if (!team) return;
      if (!window.confirm(`Delete ${team.name}? This only works if they own no players.`)) return;
      await api.del(`/api/admin/teams/${team.id}`);
      onClose();
    }, 'Team deleted');

  return (
    <Modal title={team ? `Edit ${team.name}` : 'Add team'} onClose={onClose}>
      <div className="form-grid">
        <label>Team name<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Captain<input className="input" value={form.captain} onChange={(e) => setForm({ ...form, captain: e.target.value })} /></label>
        <label>Colour<input className="input color" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} /></label>
      </div>
      <div className="row end">
        {team && <button className="btn warn" onClick={remove}>Delete</button>}
        <button className="btn primary" disabled={!form.name.trim()} onClick={save}>{team ? 'Save' : 'Add'}</button>
      </div>
    </Modal>
  );
}
