import { randomBytes } from 'node:crypto';
import { StorageClient } from '@supabase/storage-js';
import { AuctionError } from './engine';

// Player photos live in a Supabase Storage bucket. The server is the only
// writer (secret key, never shipped to browsers); reads go through the
// bucket's public URLs, so clients need no Supabase credentials at all.
//
// Every upload gets a fresh object path, which makes the public URL immutable:
// projectors and phones can cache it forever and a re-render during a bidding
// war never triggers a refetch. Updating a photo swaps the path (and URL).
//
// We use @supabase/storage-js directly rather than the full supabase-js
// client: supabase-js eagerly constructs a Realtime client, which requires a
// native WebSocket (Node 22+) and crashes on hosts running older Node.
// storage-js is plain fetch and works on any Node version.

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const SECRET_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? '').trim();
export const PHOTO_BUCKET = process.env.SUPABASE_PHOTO_BUCKET || 'player-photos';
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024; // keep in sync with the bucket's file_size_limit

let client: StorageClient | null = null;

export function photosConfigured(): boolean {
  return Boolean(SUPABASE_URL && SECRET_KEY);
}

function bucket() {
  if (!client) {
    client = new StorageClient(`${SUPABASE_URL}/storage/v1`, {
      apikey: SECRET_KEY,
      Authorization: `Bearer ${SECRET_KEY}`,
    });
  }
  return client.from(PHOTO_BUCKET);
}

/** Public CDN URL for a stored photo (immutable — see note above). */
export function photoUrlFor(path: string | null | undefined): string | null {
  if (!path || !SUPABASE_URL) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${PHOTO_BUCKET}/${path}`;
}

export interface SniffedImage {
  ext: 'jpg' | 'png' | 'webp';
  contentType: 'image/jpeg' | 'image/png' | 'image/webp';
}

/** Width and height from a JPEG's frame header (SOF0–SOF15, except the DHT,
 *  JPG and DAC markers), or null if the bytes are not a well-formed JPEG. */
export function jpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { i += 2; continue; } // markers without a length
    if (marker === 0xd9 || marker === 0xda) return null; // end of image / start of scan before any frame
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/** Identify the image type from magic bytes — never trust the client's header. */
export function sniffImage(buf: Buffer): SniffedImage | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: 'png', contentType: 'image/png' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', contentType: 'image/webp' };
  }
  return null;
}

export async function uploadPhoto(path: string, body: Buffer, contentType: string): Promise<void> {
  const { error } = await bucket().upload(path, body, {
    contentType,
    cacheControl: '31536000', // 1 year — paths are unique per upload
    upsert: false,
  });
  if (error) throw new AuctionError(`Could not store the photo: ${error.message}`, 502);
}

/** Move an object inside the bucket (server side, no re-upload). Approving a
 *  pending photo moves it from pending/ to players/, so players/ only ever
 *  holds photos the organiser approved (scripts/relink-photos.mjs relies on it). */
export async function movePhoto(from: string, to: string): Promise<void> {
  const { error } = await bucket().move(from, to);
  if (error) throw new AuctionError(`Could not publish the photo: ${error.message}`, 502);
}

/** Where an upload lands: players/ for the organiser's own uploads (live at
 *  once), pending/ for photos sent through a player's link (await approval).
 *  Every upload gets a fresh path, so every public URL stays immutable. */
export function newPhotoPath(folder: 'players' | 'pending', playerId: string, ext: string): string {
  // The random tail keeps a waiting photo's public URL unguessable; the
  // leading timestamp still sorts the folder (relink-photos.mjs parseInts it).
  return `${folder}/${playerId}/${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`;
}

/** The players/ path a pending photo moves to when it is approved. */
export function approvedPathFor(pendingPath: string): string {
  return pendingPath.replace(/^pending\//, 'players/');
}

/** Best-effort delete of a replaced photo — a leftover object is harmless. */
export function removePhoto(path: string): void {
  if (!photosConfigured()) return;
  bucket().remove([path]).then(
    () => {},
    () => {},
  );
}
