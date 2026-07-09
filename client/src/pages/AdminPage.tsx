import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { clearSession, loadSession } from '../session';
import { useApp } from '../store';
import { ConnectionDot, OfflineBanner } from '../ui';
import AuctionConsole from '../admin/AuctionConsole';
import LogTab from '../admin/LogTab';
import PlayersTab from '../admin/PlayersTab';
import SettingsTab from '../admin/SettingsTab';
import TeamsTab from '../admin/TeamsTab';

type Tab = 'auction' | 'players' | 'teams' | 'settings' | 'log';

const TABS: { key: Tab; label: string }[] = [
  { key: 'auction', label: '🔨 Auction' },
  { key: 'players', label: 'Players' },
  { key: 'teams', label: 'Teams' },
  { key: 'settings', label: 'Settings' },
  { key: 'log', label: 'Log' },
];

export default function AdminPage() {
  const navigate = useNavigate();
  const { state, connected, refresh } = useApp();
  const [tab, setTab] = useState<Tab>('auction');
  const session = loadSession();

  useEffect(() => {
    if (!session || session.role !== 'admin') navigate('/', { replace: true });
  }, [session, navigate]);

  // The socket may have connected before login — make sure we get admin state.
  useEffect(() => {
    if (state && state.you.role !== 'admin') refresh();
  }, [state?.you.role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!session || session.role !== 'admin') return null;
  if (!state) return <div className="page-loading">Connecting…</div>;

  const signOut = () => {
    clearSession();
    refresh();
    navigate('/');
  };

  return (
    <div className="admin-page">
      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="brand">🏏 {state.settings.auctionName}</Link>
          <span className={`stage-chip stage-${state.stage}`}>{state.stage.toUpperCase()}</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`tab${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <ConnectionDot connected={connected} />
          <button className="btn ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <OfflineBanner connected={connected} />
      {state.admin && state.admin.warnings.length > 0 && tab !== 'settings' && (
        <div className="warnings">
          {state.admin.warnings.map((w, i) => (
            <div key={i} className="warning">⚠️ {w}</div>
          ))}
        </div>
      )}

      <main className="admin-main">
        {tab === 'auction' && <AuctionConsole state={state} />}
        {tab === 'players' && <PlayersTab state={state} />}
        {tab === 'teams' && <TeamsTab state={state} />}
        {tab === 'settings' && <SettingsTab state={state} />}
        {tab === 'log' && <LogTab />}
      </main>
    </div>
  );
}
