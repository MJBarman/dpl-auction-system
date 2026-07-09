import { useEffect, useState } from 'react';
import { api } from '../api';
import { EventRow } from '../types';
import { useApp } from '../store';

export default function LogTab() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const version = useApp((s) => s.state?.version);

  useEffect(() => {
    api.get<{ events: EventRow[] }>('/api/admin/log').then((r) => setEvents(r.events)).catch(() => {});
  }, [version]);

  return (
    <div className="card">
      <h3>Audit log</h3>
      <p className="muted small">Every action is recorded — this is the official record of the auction (latest first).</p>
      <table className="table">
        <thead><tr><th>Time</th><th>Type</th><th>What happened</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="muted small nowrap">{new Date(e.ts).toLocaleTimeString()}</td>
              <td><span className={`log-type log-${e.type}`}>{e.type}</span></td>
              <td>{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
