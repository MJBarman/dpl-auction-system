import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { AuctionError } from './engine';
import { PendingPhoto, Player, State } from './types';

// Photo-upload links, the rules in one place (the routes in api.ts are thin):
//  - A link takes uploads only while it is open: the organiser opens it for a
//    set number of hours, and it closes when that time is up, when the photo
//    sent through it is approved, or when the organiser closes it.
//  - Every link pauses once the auction starts, so a photo can never be
//    swapped on the projector mid-auction.
//  - A photo sent through a link waits as the player's pending photo; only the
//    organiser's approval puts it on the screens.

export const PHOTO_LINK_MAX_HOURS = 24 * 7;
const HOUR_MS = 3_600_000;

export type PhotoLinkStatus = 'open' | 'closed' | 'auction';

export function photoLinkStatus(state: State, player: Player, now: number): PhotoLinkStatus {
  if (state.stage !== 'setup') return 'auction';
  return player.photoLinkUntil != null && now < player.photoLinkUntil ? 'open' : 'closed';
}

export interface OpenedLink {
  code: string;
  until: number;
  codeChanged: boolean; // false = an open link kept its code and got a new end time
}

/** Open a player's link for `hours` from now. A closed link always gets a new
 *  code, so a link that leaked earlier never comes back to life. An open link
 *  keeps its code (the message already sent keeps working) and only gets the
 *  new end time, unless `newCode` asks for a fresh code anyway. */
export function openPhotoLink(
  state: State, player: Player, now: number, hours: number, newCode: boolean, makeCode: () => string,
): OpenedLink {
  if (state.stage !== 'setup') {
    throw new AuctionError('Photo links can only be opened before the auction starts');
  }
  if (!Number.isInteger(hours) || hours < 1 || hours > PHOTO_LINK_MAX_HOURS) {
    throw new AuctionError(`A photo link can stay open for 1 to ${PHOTO_LINK_MAX_HOURS} hours`);
  }
  const codeChanged = newCode || !player.photoCode || photoLinkStatus(state, player, now) !== 'open';
  if (codeChanged) player.photoCode = makeCode();
  player.photoLinkUntil = now + hours * HOUR_MS;
  return { code: player.photoCode!, until: player.photoLinkUntil, codeChanged };
}

/** Close a link now. Returns false when it was not open. */
export function closePhotoLink(state: State, player: Player, now: number): boolean {
  const wasOpen = photoLinkStatus(state, player, now) === 'open';
  player.photoLinkUntil = null;
  return wasOpen;
}

/** Keep a photo sent through the link as the player's pending photo, in place
 *  of any earlier one. Returns the pending photo it replaced, whose stored
 *  object the caller deletes. */
export function setPendingPhoto(player: Player, pending: PendingPhoto): PendingPhoto | null {
  const replaced = player.pendingPhoto ?? null;
  player.pendingPhoto = pending;
  return replaced;
}

/** The approved photo goes live and the link closes: a link is single-use, so
 *  changing the photo again needs a new link from the organiser. A newer photo
 *  that arrived while this one was being published stays pending. Returns the
 *  photo it replaced on the screens, whose stored object the caller deletes. */
export function applyApprovedPhoto(player: Player, pendingPath: string, livePath: string): string | null {
  const previous = player.photoPath ?? null;
  player.photoPath = livePath;
  if (player.pendingPhoto?.path === pendingPath) player.pendingPhoto = null;
  player.photoLinkUntil = null;
  return previous === livePath ? null : previous;
}

/** Short fingerprint of the phone behind an upload: the random id the photo
 *  page keeps in that browser, or, without one, its address and browser. One
 *  phone sending photos for several players shows up as one tag in the log. */
export function photoDeviceTag(req: Request): string {
  const sent = req.get('x-photo-device');
  const source = sent && /^[A-Za-z0-9_-]{8,64}$/.test(sent)
    ? `id:${sent}`
    : `ip:${req.ip ?? ''}|${req.get('user-agent') ?? ''}`;
  return createHash('sha256').update(source).digest('hex').slice(0, 6);
}

/** "24 h" / "3 days" — how long a link was opened for, in log lines. */
export function hoursLabel(hours: number): string {
  return hours % 24 === 0 && hours >= 48 ? `${hours / 24} days` : `${hours} h`;
}
