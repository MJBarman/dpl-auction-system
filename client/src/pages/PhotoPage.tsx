import { ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '../icons';
import { agoText, photoDeviceId, toUploadBlob, untilText } from '../photoLinks';
import { PlayerPhoto } from '../ui';

/** Public photo-upload page behind a per-player secret link (/photo/CODE).
 *  No login: the code in the URL is the credential. The link takes photos only
 *  while the organiser has it open, and a photo reaches the auction screens
 *  only once the organiser approves it. */

interface PhotoInfo {
  name: string;
  role: string;
  tierName: string | null;
  photoUrl: string | null;
  uploadsEnabled: boolean;
  maxBytes: number;
  link: 'open' | 'closed' | 'auction';
  openUntil: number | null;
  pendingSince: number | null;
  serverTime: number;
}

export default function PhotoPage() {
  const { code = '' } = useParams();
  const [info, setInfo] = useState<PhotoInfo | null>(null);
  const [skew, setSkew] = useState(0); // our clock minus the server's
  const [pageError, setPageError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [sentUrl, setSentUrl] = useState<string | null>(null); // the photo sent from this page
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const [, setTick] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/photo/${encodeURIComponent(code)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? 'This link is not valid');
    const next = data as PhotoInfo;
    setSkew(Date.now() - next.serverTime);
    setInfo(next);
  }, [code]);

  useEffect(() => {
    let alive = true;
    load().catch((e) => {
      if (alive) setPageError(e instanceof Error ? e.message : 'Could not load this page');
    });
    return () => {
      alive = false;
    };
  }, [load]);

  // Re-render each minute so an expiring link closes on screen too.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const choose = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let them re-pick the same file after a failure
    if (!file) return;
    setNotice(null);
    try {
      const blob = await toUploadBlob(file);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return { blob, url: URL.createObjectURL(blob) };
      });
    } catch {
      setNotice({ text: 'Could not read that image — please choose a JPG or PNG photo.', kind: 'error' });
    }
  };

  const upload = async () => {
    if (!preview) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/photo/${encodeURIComponent(code)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', 'X-Photo-Device': photoDeviceId() },
        body: preview.blob,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 403) load().catch(() => {}); // the link closed meanwhile: show it closed
        throw new Error(data?.error ?? `Upload failed (${res.status})`);
      }
      // The preview becomes "the photo you sent" (its object URL lives on).
      setSentUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return preview.url;
      });
      setPreview(null);
      setInfo((i) => (i ? { ...i, pendingSince: Date.now() - skew } : i));
      setNotice({ text: 'Sent! Thank you — that’s all you need to do.', kind: 'ok' });
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Upload failed — please try again', kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const cancelPreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setNotice(null);
  };

  if (pageError) {
    return (
      <div className="photo-page">
        <div className="card">
          <h2>Could not open this link</h2>
          <p className="muted">{pageError}</p>
        </div>
      </div>
    );
  }
  if (!info) return <div className="page-loading">Loading…</div>;

  const now = Date.now() - skew;
  const open = info.link === 'open' && info.openUntil !== null && now < info.openUntil;
  const who = (
    <p className="muted">
      Hi <b>{info.name}</b>{info.role ? ` (${info.role}` : ''}{info.role && info.tierName ? `, ${info.tierName})` : info.role ? ')' : ''}!
      {' '}This photo appears next to your name on the big screen and in the team dashboards during the auction.
    </p>
  );

  if (!open) {
    return (
      <div className="photo-page">
        <div className="card">
          <h1><Icon name="camera" /> Your auction photo</h1>
          {who}
          <div className="photo-current">
            <PlayerPhoto url={info.photoUrl} name={info.name} size="xl" />
            <div className="stack">
              <p className="photo-closed">
                {info.link === 'auction' ? 'Photo uploads are closed now that the auction has started.' : 'This link is closed.'}
              </p>
              <p className="muted small">
                {info.photoUrl ? 'This is your photo on the auction screens.' : 'The screens show your initials.'}
                {info.link === 'auction' ? '' : ' To send a new photo, ask the organiser for a new link.'}
              </p>
            </div>
          </div>
          {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}
        </div>
      </div>
    );
  }

  let status: string;
  if (sentUrl) status = 'This is the photo you sent. It goes on the auction screens once the organiser approves it.';
  else if (info.pendingSince) status = `You sent a photo ${agoText(info.pendingSince, now)}. It is waiting for the organiser's approval — you can send a different one instead.`;
  else if (info.photoUrl) status = 'This is your photo on the auction screens. Send a new one to replace it — the organiser checks it first.';
  else status = 'No photo yet — the screens show your initials until the organiser approves one.';
  const waiting = Boolean(sentUrl || info.pendingSince);

  return (
    <div className="photo-page">
      <div className="card">
        <h1><Icon name="camera" /> Your auction photo</h1>
        {who}
        <p className="photo-deadline"><Icon name="timer" /> This link works until {untilText(info.openUntil!)}.</p>

        {!preview && (
          <div className="photo-current">
            {sentUrl
              ? <img className="player-photo xl" src={sentUrl} alt="The photo you sent" />
              : <PlayerPhoto url={info.photoUrl} name={info.name} size="xl" />}
            <div className="stack">
              <p className="muted small">{status}</p>
              <button
                className="btn primary big"
                disabled={!info.uploadsEnabled}
                onClick={() => fileRef.current?.click()}
              >
                {waiting ? 'Send a different photo' : info.photoUrl ? 'Choose a new photo' : 'Choose a photo'}
              </button>
              {!info.uploadsEnabled && (
                <p className="muted small">Uploads are temporarily unavailable — please try again later or tell the organiser.</p>
              )}
            </div>
          </div>
        )}

        {preview && (
          <div className="photo-preview stack">
            <img src={preview.url} alt="Preview" />
            <div className="row" style={{ justifyContent: 'center' }}>
              <button className="btn primary big" style={{ width: 'auto' }} disabled={busy} onClick={upload}>
                {busy ? 'Sending…' : 'Looks good — send it'}
              </button>
              <button className="btn" disabled={busy} onClick={cancelPreview}>Pick another</button>
            </div>
          </div>
        )}

        {notice && <div className={`notice ${notice.kind}`}>{notice.text}</div>}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={choose}
        />
        <p className="muted small">
          A clear, front-facing photo works best. Large photos are resized automatically before upload.
          This link is just for you, so please don't forward it.
        </p>
      </div>
    </div>
  );
}
