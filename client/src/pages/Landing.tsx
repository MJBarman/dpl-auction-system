import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { loadSession, saveSession } from '../session';
import { useApp } from '../store';
import { ConnectionDot, ThemeToggle, useToast } from '../ui';

export default function Landing() {
  const navigate = useNavigate();
  const toast = useToast();
  const { state, connected, refresh } = useApp();
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const session = loadSession();

  const joinTeam = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post<{ token: string; teamId: string; teamName: string }>('/api/auth/team', { code: code.trim() });
      saveSession({ token: res.token, role: 'team', teamId: res.teamId, teamName: res.teamName });
      refresh();
      navigate('/team');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not join');
    }
  };

  const loginAdmin = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post<{ token: string }>('/api/auth/admin', { pin: pin.trim() });
      saveSession({ token: res.token, role: 'admin' });
      refresh();
      navigate('/admin');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Wrong PIN');
    }
  };

  return (
    <div className="landing">
      <header className="landing-hero">
        <div className="landing-title-row">
          <h1>{state?.settings.auctionName ?? 'DPL Season 4 Player Auction'}</h1>
          <ConnectionDot connected={connected} />
          <ThemeToggle />
        </div>
        <p className="muted">
          {state
            ? `${state.progress.total} players · ${state.teams.length} franchises · ${state.settings.purse.toLocaleString('en-IN')} pts purse each`
            : 'Connecting…'}
        </p>
        {state && state.stage !== 'setup' && (
          <p className={`stage-banner stage-${state.stage}`}>
            {state.stage === 'live' && '● Auction is LIVE'}
            {state.stage === 'accelerated' && '● Accelerated round in progress'}
            {state.stage === 'completed' && 'Auction completed'}
          </p>
        )}
      </header>

      <div className="landing-cards">
        <section className="card">
          <h2>🧢 Captain / Bidder</h2>
          <p className="muted small">Enter your private team code to open your team dashboard.</p>
          {session?.role === 'team' ? (
            <div className="stack">
              <Link className="btn primary big" to="/team">Open {session.teamName ?? 'my team'} dashboard</Link>
              <p className="muted small">Signed in already on this device.</p>
            </div>
          ) : (
            <form onSubmit={joinTeam} className="stack">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="TEAM CODE"
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={12}
                className="input code-input"
              />
              <button className="btn primary big" disabled={!code.trim()}>Join as captain</button>
            </form>
          )}
        </section>

        <section className="card">
          <h2>📺 Auction Screen</h2>
          <p className="muted small">Full-screen live display for the projector or TV in the room.</p>
          <Link className="btn big" to="/screen">Open the big screen</Link>
        </section>

        <section className="card">
          <h2>🔨 Auctioneer (Admin)</h2>
          <p className="muted small">Run the auction: draw players, record bids, hammer sales.</p>
          {session?.role === 'admin' ? (
            <Link className="btn big" to="/admin">Open admin console</Link>
          ) : showPin ? (
            <form onSubmit={loginAdmin} className="stack">
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Admin PIN"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                className="input code-input"
              />
              <button className="btn big" disabled={!pin.trim()}>Sign in</button>
            </form>
          ) : (
            <button className="btn big" onClick={() => setShowPin(true)}>Admin sign-in</button>
          )}
        </section>
      </div>

      <footer className="muted small landing-foot">
        The admin PIN is printed in the server console at startup. Captains get their codes from the auctioneer.
      </footer>
    </div>
  );
}
