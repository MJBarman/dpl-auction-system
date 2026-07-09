import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { saveSession } from '../session';
import { useApp } from '../store';

/** QR-code landing: /join/CODE signs the captain in and opens their dashboard. */
export default function JoinPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const refresh = useApp((s) => s.refresh);
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || !code) return;
    attempted.current = true;
    api
      .post<{ token: string; teamId: string; teamName: string }>('/api/auth/team', { code })
      .then((res) => {
        saveSession({ token: res.token, role: 'team', teamId: res.teamId, teamName: res.teamName });
        refresh();
        navigate('/team', { replace: true });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not join'));
  }, [code, navigate, refresh]);

  return (
    <div className="landing">
      <div className="card" style={{ maxWidth: 420, margin: '15vh auto' }}>
        {error ? (
          <>
            <h2>Could not join</h2>
            <p className="muted">{error}</p>
            <button className="btn" onClick={() => navigate('/')}>Back to start</button>
          </>
        ) : (
          <h2>Joining your team…</h2>
        )}
      </div>
    </div>
  );
}
