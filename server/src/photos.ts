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

/** Best-effort delete of a replaced photo — a leftover object is harmless. */
export function removePhoto(path: string): void {
  if (!photosConfigured()) return;
  bucket().remove([path]).then(
    () => {},
    () => {},
  );
}
