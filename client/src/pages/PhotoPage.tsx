import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PlayerPhoto } from '../ui';

/** Public photo-upload page behind a per-player secret link (/photo/CODE).
 *  Players get their link from the organiser and can revisit it any time to
 *  replace their photo. No login — the code in the URL is the credential. */

interface PhotoInfo {
  name: string;
  role: string;
  tierName: string | null;
  photoUrl: string | null;
  uploadsEnabled: boolean;
  maxBytes: number;
}

const TARGET_EDGE = 900; // longest edge after downscaling
const JPEG_QUALITY = 0.85;

/** Downscale + re-encode in the browser so uploads stay small (~100–300 KB)
 *  regardless of the 10 MB phone-camera original. Throws if the browser
 *  cannot decode the file (e.g. HEIC outside Safari). */
async function toUploadBlob(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = objectUrl;
    await img.decode();
    const scale = Math.min(1, TARGET_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('Could not encode the image');
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function PhotoPage() {
  const { code } = useParams();
  const [info, setInfo] = useState<PhotoInfo | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'error' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/photo/${code}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? 'This link is not valid');
        if (alive) setInfo(data as PhotoInfo);
      })
      .catch((e) => {
        if (alive) setPageError(e instanceof Error ? e.message : 'Could not load this page');
      });
    return () => {
      alive = false;
    };
  }, [code]);

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
      const res = await fetch(`/api/photo/${code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg' },
        body: preview.blob,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Upload failed (${res.status})`);
      setInfo((i) => (i ? { ...i, photoUrl: data.photoUrl as string } : i));
      URL.revokeObjectURL(preview.url);
      setPreview(null);
      setNotice({ text: 'Photo saved! It is already live on the auction screens. You can come back to this link any time to change it.', kind: 'ok' });
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

  return (
    <div className="photo-page">
      <div className="card">
        <h1>📸 Your auction photo</h1>
        <p className="muted">
          Hi <b>{info.name}</b>{info.role ? ` (${info.role}` : ''}{info.role && info.tierName ? `, ${info.tierName})` : info.role ? ')' : ''}!
          {' '}This photo appears next to your name on the big screen and in the team dashboards during the auction.
        </p>

        {!preview && (
          <div className="photo-current">
            <PlayerPhoto url={info.photoUrl} name={info.name} size="xl" />
            <div className="stack">
              <p className="muted small">
                {info.photoUrl
                  ? 'This is your current photo. Upload a new one to replace it.'
                  : 'No photo yet — the screens show your initials until you upload one.'}
              </p>
              <button
                className="btn primary big"
                disabled={!info.uploadsEnabled}
                onClick={() => fileRef.current?.click()}
              >
                {info.photoUrl ? 'Choose a new photo' : 'Choose a photo'}
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
                {busy ? 'Uploading…' : 'Looks good — upload'}
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
        <p className="muted small">A clear, front-facing photo works best. Large photos are resized automatically before upload.</p>
      </div>
    </div>
  );
}
