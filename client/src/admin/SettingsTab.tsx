import { useEffect, useRef, useState } from 'react';
import { api, downloadUrl } from '../api';
import { Icon } from '../icons';
import { FactoryResetPreview, IncrementRung, StateView, Tier } from '../types';
import { maxFirstBid, Modal, useAction, useToast } from '../ui';

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
    timeoutEvery: String(s.timeoutEvery),
    showTier: s.showTier,
  });
  const [increments, setIncrements] = useState<{ upTo: string; step: string }[]>(
    s.increments.map((r) => ({ upTo: r.upTo === null ? '' : String(r.upTo), step: String(r.step) })),
  );
  const [tiers, setTiers] = useState(
    s.tiers.map((t) => ({ key: t.key, name: t.name, basePrice: String(t.basePrice), color: t.color })),
  );
  const [pin, setPin] = useState('');
  const [factoryReset, setFactoryReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // "With these numbers": the form's purse, squad and reserve, with each
  // player on their tier's base price as edited here (per-player overrides kept).
  const savedBase = new Map(s.tiers.map((t) => [t.key, t.basePrice]));
  const formBase = new Map(tiers.map((t) => [t.key, Number(t.basePrice)]));
  const firstBuyMax = maxFirstBid(
    Number(form.purse), Number(form.minSquad), Number(form.reservePerSlot),
    state.players.map((p) => (p.basePrice === savedBase.get(p.tierKey) ? formBase.get(p.tierKey) ?? p.basePrice : p.basePrice)),
  );

  const save = () =>
    run(async () => {
      const body = {
        auctionName: form.auctionName,
        purse: Number(form.purse),
        minSquad: Number(form.minSquad),
        maxSquad: Number(form.maxSquad),
        reservePerSlot: Number(form.reservePerSlot),
        bidderBidding: form.bidderBidding,
        timeoutEvery: Number(form.timeoutEvery),
        showTier: form.showTier,
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
          <label>Timeout after every … players<input className="input" type="number" min={0} value={form.timeoutEvery} onChange={(e) => setForm({ ...form, timeoutEvery: e.target.value })} /></label>
          <label className="check">
            <input type="checkbox" checked={form.bidderBidding} onChange={(e) => setForm({ ...form, bidderBidding: e.target.checked })} />
            Captains may bid from their own devices
          </label>
        </div>
        <p className="muted small">
          Purse guardrail: for every player a team still needs after the one on the block, it keeps back the base
          price of one of the most expensive players still left — or the reserve per slot, if that is more (0 = base
          prices only). So both teams can always finish their squads and open the bidding on any player; a bigger
          reserve per slot caps how much one player can take.
          {Number(form.purse) > 0 && Number(form.minSquad) > 0
            ? ` With these numbers a fresh team can bid at most ${firstBuyMax.toLocaleString('en-IN')}.`
            : ''}
        </p>
        <p className="muted small">
          Strategic timeout: the main round pauses after every {form.timeoutEvery || '0'} players auctioned so teams can regroup — the projector shows the standings until the auctioneer resumes. Set to 0 to turn timeouts off. The accelerated round runs without breaks.
        </p>
      </div>

      <div className="card">
        <h3>Bid increments</h3>
        <p className="muted small">Leave the last threshold empty for “and above”. Plan default: +100 to 1,000 · +200 to 3,000 · +250 above.</p>
        {increments.map((r, i) => (
          <div className="row" key={i}>
            <span className="muted small rung-label">+{r.step || '?'} up to</span>
            <input className="input" type="number" placeholder="∞" value={r.upTo}
              onChange={(e) => setIncrements(increments.map((x, j) => (j === i ? { ...x, upTo: e.target.value } : x)))} />
            <span className="muted small">step</span>
            <input className="input" type="number" value={r.step}
              onChange={(e) => setIncrements(increments.map((x, j) => (j === i ? { ...x, step: e.target.value } : x)))} />
            <button className="btn ghost" disabled={increments.length <= 1} aria-label="Remove this rung"
              onClick={() => setIncrements(increments.filter((_, j) => j !== i))}><Icon name="close" /></button>
          </div>
        ))}
        <button className="btn ghost" onClick={() => setIncrements([...increments, { upTo: '', step: '100' }])}>+ Add rung</button>
      </div>

      <div className="card">
        <h3>Tiers & base prices</h3>
        <label className="check">
          <input type="checkbox" checked={form.showTier} onChange={(e) => setForm({ ...form, showTier: e.target.checked })} />
          Show tiers on the auction screen &amp; dashboards
        </label>
        <p className="muted small">
          Off hides every tier label — the projector player card &amp; round name, the idle tier board, the console stage chips, and the team squad/pool tiers. Base prices and the round order below are unaffected.
        </p>
        {tiers.map((t, i) => (
          <div className="row" key={t.key || i}>
            <input className="input grow" value={t.name}
              onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <input className="input" type="number" value={t.basePrice}
              onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, basePrice: e.target.value } : x)))} />
            <input className="input color" type="color" value={t.color}
              onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
            <button className="btn ghost" disabled={tiers.length <= 1} aria-label="Remove this tier"
              onClick={() => setTiers(tiers.filter((_, j) => j !== i))}><Icon name="close" /></button>
          </div>
        ))}
        <button className="btn ghost" onClick={() => setTiers([...tiers, { key: '', name: 'New tier', basePrice: '200', color: '#94a3b8' }])}>
          + Add tier
        </button>
        <p className="muted small">Tier order here = auction round order. A tier with players in it can’t be removed.</p>
      </div>

      <button className="btn primary big" onClick={save}>Save settings</button>

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
          <a className="btn" href={downloadUrl('/api/admin/export.csv')} download><Icon name="download" /> Export results (CSV)</a>
          <a className="btn" href={downloadUrl('/api/admin/backup.json')} download><Icon name="download" /> Download backup (JSON)</a>
          <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="upload" /> Restore backup…</button>
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
          <button className="btn warn" onClick={() => setFactoryReset(true)}>
            Factory reset (reseed)
          </button>
        </div>
      </div>
      {factoryReset && <FactoryResetModal state={state} onClose={() => setFactoryReset(false)} />}
    </div>
  );
}

/** Factory reset behind the admin PIN, with everything it throws away spelled out first. */
function FactoryResetModal({ state, onClose }: { state: StateView; onClose: () => void }) {
  const run = useAction();
  const [preview, setPreview] = useState<FactoryResetPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);

  // re-check whenever the state moves, so the list never describes an older auction
  useEffect(() => {
    api.get<FactoryResetPreview>('/api/admin/factory-reset/preview').then(
      (p) => { setPreview(p); setLoadError(null); },
      (e) => setLoadError(e instanceof Error ? e.message : 'Could not check what would be lost'),
    );
  }, [state.version]);

  const lost: string[] = [];
  if (preview) {
    const p = preview;
    if (p.sold + p.unsold > 0 || p.stage !== 'setup') {
      lost.push(`All auction results: ${p.sold} sold and ${p.unsold} unsold players, with every price. The auction goes back to Setup.`);
    }
    lost.push('Every player gets a new photo-upload link. Links you have already sent stop working.');
    if (p.photosUnlinked.length > 0) {
      lost.push(`These photos stop showing: ${p.photosUnlinked.join(', ')}. They were uploaded after the original setup; the files stay in storage, but the app no longer links them.`);
    }
    lost.push(`Both teams get new codes and QR join links; the old ones stop working.${p.teamDevices > 0 ? ` The ${p.teamDevices} phone${p.teamDevices === 1 ? '' : 's'} already signed in stay signed in.` : ''}`);
    for (const t of p.teamsChanged) lost.push(`Team: ${t}.`);
    if (p.playersAdded.length > 0) lost.push(`Players you added are deleted: ${p.playersAdded.join(', ')}.`);
    if (p.playersRemoved.length > 0) lost.push(`Players you removed come back: ${p.playersRemoved.join(', ')}.`);
    if (p.playersEdited.length > 0) lost.push(`Your edits to these players are lost: ${p.playersEdited.join(', ')}.`);
    if (p.settingsChanged.length > 0) lost.push(`Settings go back to the defaults: ${p.settingsChanged.join('; ')}.`);
    if (p.watchlistEntries > 0) lost.push(`The captains' private watchlists are cleared (${p.watchlistEntries} starred players and target prices).`);
    lost.push('The undo history is cleared.');
  }

  const reset = () =>
    run(async () => {
      setBusy(true);
      try {
        await api.post('/api/admin/factory-reset', { confirm: true, pin: pin.trim() });
        onClose();
      } finally {
        setBusy(false);
        setPin('');
      }
    }, 'Factory reset done');

  return (
    <Modal title="Factory reset" onClose={onClose}>
      <p>
        This puts the whole app back to the original DTC Season 3 setup. It can’t be undone, and Undo doesn’t
        cover it.
      </p>
      {loadError && <p className="notice error">{loadError}</p>}
      {!preview && !loadError && <p className="muted small">Checking what would be lost…</p>}
      {preview && (
        <div className="notice error">
          <b>What you lose</b>
          <ul className="reset-list">
            {lost.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <span className="muted small">Kept: the admin PIN, the event log and the photo files in storage.</span>
        </div>
      )}
      <p className="muted small">Download a backup first: Restore backup can bring everything back.</p>
      <a className="btn" href={downloadUrl('/api/admin/backup.json')} download><Icon name="download" /> Download backup (JSON)</a>
      <form className="stack" style={{ marginTop: 16 }} onSubmit={(e) => { e.preventDefault(); if (pin.trim() && preview && !busy) reset(); }}>
        <label>
          Type the admin PIN to confirm
          <input className="input" type="password" inputMode="numeric" autoComplete="off" value={pin}
            onChange={(e) => setPin(e.target.value)} placeholder="Admin PIN" />
        </label>
        <div className="row end">
          <button type="submit" className="btn warn" disabled={!pin.trim() || !preview || busy}>
            {busy ? 'Resetting…' : 'Factory reset'}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
