// Photo links and uploads, shared by the player's photo page (/photo/CODE)
// and the organiser's photo tools (the review card and Admin → Players).

const DEVICE_KEY = 'dpl.photoDevice';
const HOURS_KEY = 'dpl.photoLinkHours';

const TARGET_EDGE = 900; // longest edge after downscaling
const JPEG_QUALITY = 0.85;

/** Downscale + re-encode in the browser so uploads stay small (~100–300 KB)
 *  regardless of the 10 MB phone-camera original. Throws if the browser
 *  cannot decode the file (e.g. HEIC outside Safari). */
export async function toUploadBlob(file: File): Promise<Blob> {
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

/** A random id this browser keeps, sent with every photo upload so the
 *  organiser's log can tell phones apart. getRandomValues works on plain
 *  http too (phones on the venue Wi-Fi), unlike randomUUID. */
export function photoDeviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* private mode: a new id per visit is fine */
  }
  return id;
}

/** How long a link can be opened for (hours); the server allows 1–168. */
export const LINK_HOURS = [1, 6, 24, 72, 168] as const;
const DEFAULT_LINK_HOURS = 24;

export function hoursText(hours: number): string {
  if (hours % 24 === 0 && hours >= 48) return `${hours / 24} days`;
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

/** The organiser's last choice, so every "Open link" uses the same window. */
export function loadLinkHours(): number {
  try {
    const saved = Number(localStorage.getItem(HOURS_KEY));
    if ((LINK_HOURS as readonly number[]).includes(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  return DEFAULT_LINK_HOURS;
}

export function saveLinkHours(hours: number): void {
  try {
    localStorage.setItem(HOURS_KEY, String(hours));
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
}

export function photoLinkUrl(code: string): string {
  return `${window.location.origin}/photo/${code}`;
}

/** "Tue, 12 Nov, 6:30 pm" in the viewer's own locale and time zone. */
export function untilText(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

export function agoText(ms: number, now: number): string {
  const secs = Math.max(0, Math.round((now - ms) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The message the organiser sends one player, in a private chat. */
export function linkMessage(name: string, auctionName: string, url: string, until: number): string {
  return `Hi ${name}! Here is your photo link for the ${auctionName}:\n${url}\n\n`
    + `The link is just for you, so please don't forward it. It works until ${untilText(until)}.`;
}

/** WhatsApp's own share link: it opens WhatsApp with the message filled in
 *  and lets the organiser pick the chat. */
export function whatsAppHref(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** "Ronny" · "Ronny and Deep" · "Ronny, Deep and Kabya" */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
