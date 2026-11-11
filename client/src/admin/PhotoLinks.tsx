import { ChangeEvent, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import {
  hoursText, LINK_HOURS, linkMessage, loadLinkHours, photoLinkUrl, saveLinkHours, toUploadBlob, untilText,
  whatsAppHref,
} from '../photoLinks';
import { loadSession } from '../session';
import { PlayerView, StateView } from '../types';
import { Modal, PlayerPhoto, useAction, useServerNow, useToast } from '../ui';

// The organiser's photo tools: the "Photo links" sheet (every player's link,
// opened for a set time and sent one to one) and the photo box in a player's
// Edit form (the same link actions, plus uploading a photo yourself).

type LinkStatus = 'open' | 'closed' | 'paused';

function linkFor(state: StateView, playerId: string) {
  return state.admin?.photoLinks.find((l) => l.playerId === playerId) ?? null;
}

/** Mirrors the server: a link is open while its window runs, but only in
 *  Setup; once the auction starts, a running link is paused. */
function linkStatus(state: StateView, playerId: string, now: number): LinkStatus {
  const until = linkFor(state, playerId)?.openUntil ?? null;
  const running = until !== null && until > now;
  if (!running) return 'closed';
  return state.stage === 'setup' ? 'open' : 'paused';
}

function linkText(state: StateView, playerId: string, now: number): string {
  const status = linkStatus(state, playerId, now);
  if (status === 'open') return `link open until ${untilText(linkFor(state, playerId)!.openUntil!)}`;
  if (status === 'paused') return 'link paused while the auction is on';
  return 'link closed';
}

function photoText(player: PlayerView, pending: boolean): string {
  if (pending) return 'New photo waiting for you';
  return player.photoUrl ? 'Photo on the screens' : 'No photo yet';
}

/** Open, send, copy, replace or close one player's link. */
function PhotoLinkActions({ state, player, hours, now, showNewLink = false }: {
  state: StateView;
  player: PlayerView;
  hours: number;
  now: number;
  showNewLink?: boolean;
}) {
  const run = useAction();
  const toast = useToast();
  const status = linkStatus(state, player.id, now);
  const link = linkFor(state, player.id);
  if (state.stage !== 'setup' || !link) return null; // links only open before the auction

  if (status !== 'open') {
    return (
      <button
        className="btn"
        onClick={() => run(
          () => api.post(`/api/admin/players/${player.id}/photo-link`, { hours }),
          `${player.name}'s link is open for ${hoursText(hours)} — now send it to ${player.name}`,
        )}
      >
        Open link
      </button>
    );
  }

  const message = linkMessage(player.name, state.settings.auctionName, photoLinkUrl(link.code), link.openUntil!);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast(`Message with ${player.name}'s link copied`, 'ok');
    } catch {
      window.prompt(`Copy this message for ${player.name}`, message); // clipboard needs https
    }
  };
  return (
    <>
      <a className="btn" href={whatsAppHref(message)} target="_blank" rel="noopener noreferrer">
        <Icon name="send" /> WhatsApp
      </a>
      <button className="btn ghost" onClick={copy}>Copy</button>
      {showNewLink && (
        <button
          className="btn ghost"
          onClick={() => {
            if (window.confirm(`Make a new link for ${player.name}? The current one stops working at once.`)) {
              run(() => api.post(`/api/admin/players/${player.id}/photo-link`, { hours, newCode: true }),
                `New link for ${player.name} — send it again`);
            }
          }}
        >
          New link
        </button>
      )}
      <button
        className="btn ghost warn-text"
        onClick={() => run(() => api.post(`/api/admin/players/${player.id}/photo-link/close`), `${player.name}'s link is closed`)}
      >
        Close
      </button>
    </>
  );
}

/** Admin → Players → Photo links: every player's link and photo at a glance. */
export function PhotoLinksModal({ state, onClose }: { state: StateView; onClose: () => void }) {
  const run = useAction();
  const now = useServerNow(state.serverTime, 30_000);
  const [hours, setHoursState] = useState(loadLinkHours);
  const setHours = (h: number) => {
    setHoursState(h);
    saveLinkHours(h);
  };
  const pendingIds = new Set((state.admin?.pendingPhotos ?? []).map((p) => p.playerId));
  const setup = state.stage === 'setup';
  const withoutPhoto = state.players.filter((p) => !p.photoUrl && !pendingIds.has(p.id));
  const running = state.players.filter((p) => linkStatus(state, p.id, now) !== 'closed');

  return (
    <Modal title="Photo links" onClose={onClose} wide>
      <p className="muted small">
        Send each player their own link in a private chat, never in a group. A link takes photos only while
        it is open, and every photo waits for your approval before it reaches the screens.
      </p>
      {!setup && (
        <div className="notice info">
          The auction has started, so every photo link is paused. You can still upload a photo yourself from a
          player's Edit form.
        </div>
      )}
      <div className="photo-links-bar">
        <label>
          Links stay open for
          <select className="input" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            {LINK_HOURS.map((h) => <option key={h} value={h}>{hoursText(h)}</option>)}
          </select>
        </label>
        <button
          className="btn primary"
          disabled={!setup || withoutPhoto.length === 0}
          onClick={() => run(
            () => api.post('/api/admin/photo-links/open', { hours, playerIds: withoutPhoto.map((p) => p.id) }),
            `Links open for ${hoursText(hours)} — send each one with WhatsApp`,
          )}
        >
          {withoutPhoto.length
            ? `Open links for the ${withoutPhoto.length} without a photo`
            : 'Every player has a photo'}
        </button>
        <button
          className="btn"
          disabled={running.length === 0}
          onClick={() => run(() => api.post('/api/admin/photo-links/close'), 'Every photo link is closed')}
        >
          Close all links
        </button>
      </div>
      <ul className="photo-links">
        {state.players.map((p) => (
          <li key={p.id}>
            <PlayerPhoto url={p.photoUrl} name={p.name} size="sm" />
            <div className="photo-links-who">
              <b>{p.name}</b>
              <span className={`small${pendingIds.has(p.id) ? ' photo-links-pending' : ' muted'}`}>
                {photoText(p, pendingIds.has(p.id))} · {linkText(state, p.id, now)}
              </span>
            </div>
            <div className="photo-links-actions">
              <PhotoLinkActions state={state} player={p} hours={hours} now={now} />
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** The photo box in a player's Edit form: their link, plus an upload of your
 *  own that goes on the screens at once (no link or approval needed). */
export function PlayerPhotoBox({ state, player }: { state: StateView; player: PlayerView }) {
  const toast = useToast();
  const now = useServerNow(state.serverTime, 30_000);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // The live player: the form's `player` is a snapshot from when it opened.
  const live = state.players.find((p) => p.id === player.id) ?? player;
  const pending = (state.admin?.pendingPhotos ?? []).some((p) => p.playerId === player.id);
  const status = linkStatus(state, player.id, now);

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file can be picked again after a failure
    if (!file) return;
    let blob: Blob;
    try {
      blob = await toUploadBlob(file);
    } catch {
      toast('Could not read that image — choose a JPG or PNG photo');
      return;
    }
    setBusy(true);
    try {
      const session = loadSession();
      const res = await fetch(`/api/admin/players/${player.id}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'image/jpeg', ...(session ? { Authorization: `Bearer ${session.token}` } : {}) },
        body: blob,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Upload failed (${res.status})`);
      toast(`${live.name}'s new photo is on the screens`, 'ok');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed — please try again');
    } finally {
      setBusy(false);
    }
  };

  let line: string;
  if (status === 'open') line = `Photo link open until ${untilText(linkFor(state, player.id)!.openUntil!)}. Send it to ${live.name} in a private chat.`;
  else if (state.stage !== 'setup') line = 'Photo links are paused while the auction is on. You can still upload a photo yourself.';
  else line = `Photo link closed. Open it to let ${live.name} send a photo; you approve it before it goes on the screens.`;

  return (
    <div className="join-box photo-box">
      <PlayerPhoto url={live.photoUrl} name={live.name} size="md" />
      <div className="grow">
        <div className="muted small">{line}</div>
        {pending && <div className="small photo-links-pending">A new photo from {live.name} is waiting for your approval.</div>}
        <div className="row wrap">
          <PhotoLinkActions state={state} player={live} hours={loadLinkHours()} now={now} showNewLink />
          <button className="btn ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" /> {busy ? 'Uploading…' : 'Upload photo'}
          </button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={upload} />
      </div>
    </div>
  );
}
