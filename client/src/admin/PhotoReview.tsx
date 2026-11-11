import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { agoText, nameList } from '../photoLinks';
import { StateView } from '../types';
import { PlayerPhoto, useAction, useServerNow } from '../ui';

const TITLE_COUNT = /^\(\d+\)\s*/;

/** The organiser's notification for photos: whenever a player sends a photo
 *  through their link, this card pops up in the corner of every console tab
 *  with the photo on the screens now beside the new one, and Approve / Reject.
 *  Nothing reaches the projector or the captains until it is approved. Mid-
 *  auction it waits as a small pill instead of covering the console. */
export default function PhotoReview({ state }: { state: StateView }) {
  const run = useAction();
  const now = useServerNow(state.serverTime, 30_000);
  const pending = useMemo(
    () => [...(state.admin?.pendingPhotos ?? [])].sort((a, b) => a.uploadedAt - b.uploadedAt),
    [state.admin?.pendingPhotos],
  );
  const auctionOn = state.stage !== 'setup';
  const [hidden, setHidden] = useState(auctionOn);
  const [busy, setBusy] = useState(false);
  const seen = useRef<Set<string> | null>(null);

  // Starting the auction tucks the card away, so it never sits on the console.
  useEffect(() => {
    if (auctionOn) setHidden(true);
  }, [auctionOn]);

  // A photo that wasn't there before brings the card back (except mid-auction).
  useEffect(() => {
    const paths = pending.map((p) => p.path);
    if (seen.current === null) {
      seen.current = new Set(paths);
      return;
    }
    const known = seen.current;
    const fresh = paths.some((p) => !known.has(p));
    paths.forEach((p) => known.add(p));
    if (fresh && !auctionOn) setHidden(false);
  }, [pending, auctionOn]);

  // The tab title carries the count, so a console in a background tab still shows it.
  useEffect(() => {
    const base = document.title.replace(TITLE_COUNT, '');
    document.title = pending.length ? `(${pending.length}) ${base}` : base;
  }, [pending.length]);
  useEffect(() => () => {
    document.title = document.title.replace(TITLE_COUNT, '');
  }, []);

  const item = pending[0];
  const player = item ? state.players.find((p) => p.id === item.playerId) : undefined;
  if (!item || !player) return null;

  if (hidden) {
    return (
      <button className="photo-review-pill" onClick={() => setHidden(false)}>
        <Icon name="camera" /> {pending.length} photo{pending.length === 1 ? '' : 's'} to approve
      </button>
    );
  }

  // Replacing only matters while the link still takes photos: a closed link
  // takes nothing, and opening it again always makes a new code.
  const until = state.admin?.photoLinks.find((l) => l.playerId === player.id)?.openUntil ?? null;
  const linkOpen = state.stage === 'setup' && until !== null && until > now;

  const sameDevice = pending
    .filter((p) => p.playerId !== item.playerId && p.device === item.device)
    .map((p) => state.players.find((x) => x.id === p.playerId)?.name)
    .filter((n): n is string => !!n);

  const act = async (verb: 'approve' | 'reject', newLink = false) => {
    setBusy(true);
    await run(
      () => api.post(`/api/admin/players/${player.id}/photo/${verb}`, { path: item.path, newLink }),
      verb === 'approve' ? `${player.name}'s new photo is on the screens`
        : newLink ? `Rejected. ${player.name} has a new link: send it from Players → Photo links`
          : 'Rejected — it never reached the screens',
    );
    setBusy(false);
  };

  return (
    <section className="photo-review" aria-label="Photo waiting for your approval">
      <div className="photo-review-head">
        <span className="photo-review-title">
          <Icon name="camera" /> New photo{pending.length > 1 ? ` · 1 of ${pending.length}` : ''}
        </span>
        <button className="btn ghost" onClick={() => setHidden(true)} aria-label="Hide for now" title="Hide for now">
          <Icon name="close" />
        </button>
      </div>
      <div className="photo-review-pair">
        <figure>
          <PlayerPhoto url={player.photoUrl} name={player.name} size="md" />
          <figcaption>{player.photoUrl ? 'On screens now' : 'Now: initials'}</figcaption>
        </figure>
        <figure className="photo-review-new">
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" title="Open the whole photo">
              <PlayerPhoto url={item.url} name={player.name} size="lg" />
            </a>
          ) : (
            <PlayerPhoto url={null} name={player.name} size="lg" />
          )}
          <figcaption>New</figcaption>
        </figure>
      </div>
      <p className="photo-review-name">{player.name}</p>
      <p className="muted small">Sent {agoText(item.uploadedAt, now)} from phone #{item.device}</p>
      {sameDevice.length > 0 && (
        <p className="photo-review-flag">
          <Icon name="warning" />
          <span>The same phone also sent the photo{sameDevice.length > 1 ? 's' : ''} for {nameList(sameDevice)}.</span>
        </p>
      )}
      <div className="row">
        <button className="btn warn grow" disabled={busy} onClick={() => act('reject')}>Reject</button>
        <button className="btn primary grow" disabled={busy} onClick={() => act('approve')}>Approve</button>
      </div>
      {linkOpen && (
        <button className="photo-review-replace" disabled={busy} onClick={() => act('reject', true)}>
          Someone else has this link? Reject and replace it
        </button>
      )}
    </section>
  );
}
