import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../icons';
import { api, signOutOnServer } from '../api';
import { clearSession, loadSession } from '../session';
import { useApp } from '../store';
import { BidSoundToggle, ConnectionDot, OfflineBanner, ThemeToggle, useBidSound, useSoldSound, useToast } from '../ui';
import AuctionConsole from '../admin/AuctionConsole';
import LogTab from '../admin/LogTab';
import PhotoReview from '../admin/PhotoReview';
import PlayersTab from '../admin/PlayersTab';
import SettingsTab from '../admin/SettingsTab';
import TeamsTab from '../admin/TeamsTab';

type Tab = 'auction' | 'players' | 'teams' | 'settings' | 'log';

const TABS: { key: Tab; label: string }[] = [
  { key: 'auction', label: 'Auction' },
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
  // And if the server no longer knows this console (signed out elsewhere, the
  // PIN changed, or two weeks unused), go back to sign-in and say why, rather
  // than leave a console whose every button answers "Admin access required".
  const toast = useToast();
  useEffect(() => {
    if (!state || state.you.role === 'admin') return;
    refresh();
    let alive = true;
    api.get<{ role: string }>('/api/auth/me').then((me) => {
      if (!alive || me.role === 'admin' || loadSession()?.role !== 'admin') return;
      clearSession();
      refresh();
      toast('This console was signed out — sign in again with the admin PIN');
      navigate('/', { replace: true });
    }).catch(() => { /* offline: the next state brings us back here */ });
    return () => {
      alive = false;
    };
  }, [state?.you.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chime on every new bid; the toggle lets the auctioneer mute it mid-event.
  // Called before the early returns below so hook order stays stable.
  const { muted, toggleMuted } = useBidSound(state?.lot ?? null);
  useSoldSound(state, muted); // the gavel on every sale; the same toggle mutes it

  if (!session || session.role !== 'admin') return null;
  if (!state) return <div className="page-loading">Connecting…</div>;

  const signOut = async () => {
    await signOutOnServer(); // the token stops working everywhere, not just here
    clearSession();
    refresh();
    navigate('/');
  };

  return (
    <div className="admin-page">
      <header className="topbar">
        <div className="topbar-left">
          <Link to="/" className="brand"><span className="brand-mark" aria-hidden />{state.settings.auctionName}</Link>
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
          <ThemeToggle />
          <BidSoundToggle muted={muted} onToggle={toggleMuted} />
          <ConnectionDot connected={connected} />
          <button className="btn ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <OfflineBanner connected={connected} />
      {state.admin && state.admin.warnings.length > 0 && tab !== 'settings' && (
        <div className="warnings">
          {state.admin.warnings.map((w, i) => (
            <div key={i} className="warning"><Icon name="warning" /> {w}</div>
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
      <PhotoReview state={state} />
    </div>
  );
}
