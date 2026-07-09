import { useRef, useState } from 'react';
import { api, downloadUrl } from '../api';
import { IncrementRung, StateView, Tier } from '../types';
import { useAction, useToast } from '../ui';

export default function SettingsTab({ state }: { state: StateView }) {
  const run = useAction();
  const toast = useToast();
  const s = state.settings;

  const [form, setForm] = useState({
    auctionName: s.auctionName,
    purse: String(s.purse),
    minSquad: String(s.minSquad),
    maxSquad: String(s.maxSquad),
    reservePerSlot: String(s.reservePerSlot),
    bidderBidding: s.bidderBidding,
  });
  const [increments, setIncrements] = useState<{ upTo: string; step: string }[]>(
    s.increments.map((r) => ({ upTo: r.upTo === null ? '' : String(r.upTo), step: String(r.step) })),
  );
  const [tiers, setTiers] = useState(
    s.tiers.map((t) => ({ key: t.key, name: t.name, basePrice: String(t.basePrice), color: t.color })),
  );
  const [pin, setPin] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const save = () =>
    run(async () => {
      const body = {
        auctionName: form.auctionName,
        purse: Number(form.purse),
        minSquad: Number(form.minSquad),
        maxSquad: Number(form.maxSquad),
        reservePerSlot: Number(form.reservePerSlot),
        bidderBidding: form.bidderBidding,
        increments: increments.map((r): IncrementRung => ({
          upTo: r.upTo.trim() === '' ? null : Number(r.upTo),
          step: Number(r.step),
        })),
        tiers: tiers.map((t, i): Omit<Tier, 'order'> & { order?: number } => ({
          key: t.key,
          name: t.name,
          basePrice: Number(t.basePrice),
          color: t.color,
        })),
      };
      await api.put('/api/admin/settings', body);
    }, 'Settings saved');

  const restore = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!window.confirm('Restore this backup? The current auction state will be replaced.')) return;
      await api.post('/api/admin/restore', { state: parsed.state ?? parsed });
      toast('Backup restored', 'ok');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Restore failed');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="settings-stack">
      <div className="card">
        <h3>Auction format</h3>
        <p className="muted small">
          Robust by design: 8-a-side (min 7 / max 8 bought players) or 9-a-side (min 8 / max 9) — set it here and the
          guardrails, feasibility checks and allotment follow automatically.
        </p>
        <div className="form-grid">
          <label>Auction name<input className="input" value={form.auctionName} onChange={(e) => setForm({ ...form, auctionName: e.target.value })} /></label>
          <label>Purse per team (pts)<input className="input" type="number" value={form.purse} onChange={(e) => setForm({ ...form, purse: e.target.value })} /></label>
          <label>Min squad (bought)<input className="input" type="number" value={form.minSquad} onChange={(e) => setForm({ ...form, minSquad: e.target.value })} /></label>
          <label>Max squad (bought)<input className="input" type="number" value={form.maxSquad} onChange={(e) => setForm({ ...form, maxSquad: e.target.value })} /></label>
          <label>Reserve per slot (pts)<input className="input" type="number" value={form.reservePerSlot} onChange={(e) => setForm({ ...form, reservePerSlot: e.target.value })} /></label>
          <label className="check">
            <input type="checkbox" checked={form.bidderBidding} onChange={(e) => setForm({ ...form, bidderBidding: e.target.checked })} />
            Captains may bid from their own devices
          </label>
        </div>
      </div>

      <div className="card">
        <h3>Bid increments</h3>
        <p className="muted small">Leave the last threshold empty for “and above”. Plan default: +100 to 1,000 · +200 to 3,000 · +500 above.</p>
        {increments.map((r, i) => (
          <div className="row" key={i}>
            <span className="muted small rung-label">+{r.step || '?'} up to</span>
            <input className="input" type="number" placeholder="∞" value={r.upTo}
              onChange={(e) => setIncrements(increments.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))} />
            <span className="muted small">step</span>
            <input className="input" type="number" value={r.step}
              onChange={(e) => setIncrements(increments.map((x, j) => (j === i ? { ...x, step: e.target.value } : x)))} />
            <button className="btn ghost" disabled={increments.length <= 1}
              onClick={() => setIncrements(increments.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="btn ghost" onClick={() => setIncrements([...increments, { upTo: '', step: '100' }])}>+ Add rung</button>
      </div>

      <div className="card">
        <h3>Tiers & base prices</h3>
        {tiers.map((t, i) => (
          <div className="row" key={t.key || i}>
            <input className="input grow" value={t.name}
              onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className="input" type="number" value={t.basePrice}
              onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, basePrice: e.target.value } : x)))} />
            <input className="input color" type="color" value={t.color}
              onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
            <button className="btn ghost" disabled={tiers.length <= 1}
              onClick={() => setTiers(tiers.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button className="btn ghost" onClick={() => setTiers([...tiers, { key: '', name: 'New tier', basePrice: '200', color: '#94a3b8' }])}>
          + Add tier
        </button>
        <p className="muted small">Tier order here = auction round order. A tier with players in it can’t be removed.</p>
      </div>

      <button className="btn primary big" onClick={save}>💾 Save settings</button>

      <div className="card">
        <h3>Security</h3>
        <div className="row">
          <input className="input" type="password" placeholder="New admin PIN (min 4 chars)" value={pin} onChange={(e) => setPin(e.target.value)} />
          <button className="btn" disabled={pin.trim().length < 4}
            onClick={() => run(async () => { await api.put('/api/admin/pin', { pin: pin.trim() }); setPin(''); }, 'PIN changed')}>
            Change PIN
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Data</h3>
        <div className="row wrap">
          <a className="btn" href={downloadUrl('/api/admin/export.csv')} download>⬇ Export results (CSV)</a>
          <a className="btn" href={downloadUrl('/api/admin/backup.json')} download>⬇ Download backup (JSON)</a>
          <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Restore backup…</button>
          <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
        </div>
        <p className="muted small">Everything is also saved continuously to <code>server/data/auction.db</code> — a restart loses nothing.</p>
      </div>

      <div className="card danger">
        <h3>Danger zone</h3>
        <div className="row wrap">
          <button className="btn warn" onClick={() => {
            if (window.confirm('Reset the auction? All sales are cleared; players, teams and settings are kept.')) {
              run(() => api.post('/api/admin/auction/reset', { confirm: true }), 'Auction reset');
            }
          }}>
            Reset auction (keep pool)
          </button>
          <button className="btn warn" onClick={() => {
            if (window.confirm('Factory reset? EVERYTHING returns to the original DPL Season 4 seed — teams, players, settings, codes.')) {
              run(() => api.post('/api/admin/factory-reset', { confirm: true }), 'Factory reset done');
            }
          }}>
            Factory reset (reseed)
          </button>
        </div>
      </div>
    </div>
  );
}
