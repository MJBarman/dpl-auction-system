// The watching phones' side of the auction: who they follow, the guessing
// game, buzzes, installing to the home screen, and the share cards.
import { useCallback, useEffect, useState } from 'react';
import { IncrementRung } from './types';

export const REACTIONS = ['🔥', '👏', '😮', '😂', '💸', '🏏'] as const;

const DEVICE_KEY = 'dpl.watch.device';
export const FOLLOW_KEY = 'dpl.watch.team';
export const NAME_KEY = 'dpl.watch.name';
export const BUZZ_KEY = 'dpl.watch.buzz';
export const GUESS_KEY = 'dpl.watch.guess';
export const TAG_KEY = 'dpl.watch.tag';

// ---- small stored preferences ----------------------------------------------------

export function loadStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode: the choice lasts for this visit */
  }
}

export function hasStored(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

/** A value kept in localStorage, as React state. */
export function useStored<T>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => loadStored(key, fallback));
  const set = useCallback((next: T) => {
    setValue(next);
    saveStored(key, next);
  }, [key]);
  return [value, set];
}

/** A random id this browser keeps, so the game knows one phone from another.
 *  getRandomValues works on plain http too (phones on the venue Wi-Fi). */
export function watchDeviceId(): string {
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
    /* a new id per visit is fine */
  }
  return id;
}

// ---- the guessing game ---------------------------------------------------------------

/** Every price a lot can reach by plain raises from `from` up to `cap`: the
 *  amounts a guess can be. With very small bid steps the list is thinned (it
 *  keeps its first and last price) so the slider stays usable. */
export function bidLadder(increments: IncrementRung[], from: number, cap: number): number[] {
  const stepFor = (amount: number) => {
    for (const rung of increments) if (rung.upTo === null || amount < rung.upTo) return rung.step;
    return increments.length ? increments[increments.length - 1].step : 100;
  };
  const start = Math.max(1, Math.round(from));
  const out: number[] = [];
  for (let v = start, i = 0; v <= cap && i < 20_000; i++) {
    out.push(v);
    v += Math.max(1, Math.round(stepFor(v)));
  }
  if (out.length === 0) out.push(start);
  const MOST = 240;
  if (out.length <= MOST) return out;
  const every = Math.ceil(out.length / MOST);
  const thin = out.filter((_, i) => i % every === 0);
  if (thin[thin.length - 1] !== out[out.length - 1]) thin.push(out[out.length - 1]);
  return thin;
}

export interface MyGuess {
  lotId: string;
  amount: number;
}

/** Send this phone's guess for the open lot. Throws with the server's reason. */
export async function sendGuess(lotId: string, amount: number, name: string): Promise<{ amount: number; tag: string }> {
  const res = await fetch('/api/audience/guess', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device': watchDeviceId() },
    body: JSON.stringify({ lotId, amount, name }),
  });
  const data = await res.json().catch(() => null);
  // "You already guessed" comes with the guess the server holds: an earlier
  // answer was lost on the way back (or this phone guessed in another tab).
  // Either way the guess is locked, so it is shown as locked.
  const already = res.status === 409 && typeof data?.amount === 'number' && typeof data?.tag === 'string';
  if (!res.ok && !already) throw new Error(data?.error ?? `Could not send your guess (${res.status})`);
  saveStored(GUESS_KEY, { lotId, amount: data.amount } satisfies MyGuess);
  saveStored(TAG_KEY, data.tag);
  return { amount: data.amount, tag: data.tag };
}

// ---- buzz -------------------------------------------------------------------------------

/** A short vibration where the phone supports it (Android; iPhones ignore it). */
export function buzz(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not allowed here */
  }
}
export const canBuzz = (): boolean => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

// ---- colour helpers --------------------------------------------------------------------

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
export function rgbTriplet(hex: string): string {
  const c = rgb(hex);
  return c ? `${c[0]}, ${c[1]}, ${c[2]}` : '255, 255, 255';
}
/** Black or white ink, whichever reads on this fill. */
export function inkOn(hex: string): '#000000' | '#ffffff' {
  const c = rgb(hex);
  if (!c) return '#ffffff';
  // The projector's rule (ScreenPage darkInk): black from mid-brightness up.
  // At 140 the greens and teals got white ink at barely 2.4 : 1.
  return (c[0] * 299 + c[1] * 587 + c[2] * 114) / 1000 >= 127 ? '#000000' : '#ffffff';
}

// ---- add to home screen ------------------------------------------------------------------

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let installPrompt: InstallPrompt | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep it for our own button
    installPrompt = e as InstallPrompt;
    installListeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installListeners.forEach((fn) => fn());
  });
}

export type InstallState = 'installed' | 'prompt' | 'ios' | 'none';

/** How this phone can put the page on its home screen, if at all. */
export function useInstall(): { how: InstallState; install: () => Promise<void> } {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    installListeners.add(fn);
    return () => {
      installListeners.delete(fn);
    };
  }, []);
  const standalone = typeof window !== 'undefined'
    && (window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
  const ios = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const how: InstallState = standalone ? 'installed' : installPrompt ? 'prompt' : ios ? 'ios' : 'none';
  const install = useCallback(async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    bump((n) => n + 1);
  }, []);
  return { how, install };
}

// ---- share cards: a picture of a sale, or of a squad, for WhatsApp status -----------------

const W = 1080;
const H = 1920;
const MINT = '#8dfe8e';
const DISPLAY = 'Anton, "Arial Narrow", Impact, sans-serif';
const HEADING = '"Barlow Condensed", "Arial Narrow", sans-serif';

async function fontsReady(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`400 120px ${DISPLAY}`),
      document.fonts.load(`700 60px ${HEADING}`),
      document.fonts.load(`800 60px ${HEADING}`),
    ]);
  } catch {
    /* the fallbacks draw instead */
  }
}

/** The photo as something a canvas can draw without being tainted, or null
 *  (no photo, blocked by CORS, offline): the card then shows initials. */
async function loadPhoto(url: string | null): Promise<ImageBitmap | null> {
  if (!url || typeof createImageBitmap !== 'function') return null;
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

function initials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

/** Draw `text` at the largest size up to `max` that fits `width`; returns the size used. */
function fitText(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, max: number, width: number): number {
  let px = max;
  ctx.font = font(px);
  while (px > 24 && ctx.measureText(text).width > width) {
    px -= 4;
    ctx.font = font(px);
  }
  return px;
}

/** Latin text can be drawn letter by letter (for the spacing); scripts that
 *  join or stack their letters (Assamese, Bengali, Devanagari, Arabic…) must
 *  be drawn whole, or the vowel signs come apart from their letters. */
const lettersStandAlone = (text: string): boolean => !/[^\u0000-\u024f\u2000-\u206f]/.test(text);

function spaced(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, gap: number): void {
  if (!lettersStandAlone(text)) {
    ctx.fillText(text, x, y);
    return;
  }
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + gap;
  }
}

/** Letter-spaced text at the largest size up to `max` that fits `width`. */
function fitSpaced(
  ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, max: number, width: number, x: number, y: number, gap: number,
): void {
  let px = max;
  ctx.font = font(px);
  const wide = () => ctx.measureText(text).width + (lettersStandAlone(text) ? gap * Math.max(0, [...text].length - 1) : 0);
  while (px > 20 && wide() > width) {
    px -= 2;
    ctx.font = font(px);
  }
  spaced(ctx, text, x, y, gap);
}

function cover(ctx: CanvasRenderingContext2D, img: ImageBitmap, x: number, y: number, size: number): void {
  const s = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, x, y, size, size);
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture'))), 'image/png');
  });
}

export interface SaleCard {
  auctionName: string;
  playerName: string;
  photoUrl: string | null;
  teamName: string;
  teamColor: string;
  price: number;
  tierName?: string | null;
  bids?: number | null;
}

/** "SOLD" poster for one sale: 1080 × 1920, the size of a WhatsApp status. */
export async function renderSaleCard(card: SaleCard): Promise<Blob> {
  await fontsReady();
  const photo = await loadPhoto(card.photoUrl);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not make the picture');
  const ink = inkOn(card.teamColor);
  const num = (n: number) => n.toLocaleString('en-IN');

  // black ground, the team's colour falling diagonally across the top
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = card.teamColor;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, 900);
  ctx.lineTo(0, 1120);
  ctx.closePath();
  ctx.fill();

  // brand line
  ctx.fillStyle = ink === '#000000' ? '#000' : MINT;
  ctx.fillRect(72, 84, 12, 56);
  ctx.fillStyle = ink;
  ctx.textBaseline = 'alphabetic';
  fitSpaced(ctx, card.auctionName.toUpperCase(), (p) => `700 ${p}px ${HEADING}`, 44, W - 104 - 72, 104, 128, 4);

  // SOLD
  ctx.font = `400 340px ${DISPLAY}`;
  spaced(ctx, 'SOLD', 60, 470, 10);

  // the photo in an offset frame
  const size = 720;
  const px = (W - size) / 2;
  const py = 540;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 6;
  ctx.strokeRect(px + 24, py + 24, size, size);
  ctx.fillStyle = '#1e1e1e';
  ctx.fillRect(px, py, size, size);
  if (photo) {
    cover(ctx, photo, px, py, size);
  } else {
    ctx.fillStyle = '#929396';
    ctx.font = `400 300px ${DISPLAY}`;
    ctx.textAlign = 'center';
    ctx.fillText(initials(card.playerName), W / 2, py + size / 2 + 110);
    ctx.textAlign = 'left';
  }
  if (card.tierName) {
    ctx.font = `700 40px ${HEADING}`;
    const label = card.tierName.toUpperCase();
    const tw = ctx.measureText(label).width + 20 * (label.length - 1) * 0.2 + 48;
    ctx.fillStyle = '#000';
    ctx.fillRect(px, py + size - 72, tw, 72);
    ctx.fillStyle = '#fff';
    spaced(ctx, label, px + 24, py + size - 22, 4);
  }

  // name
  ctx.fillStyle = '#fff';
  const name = card.playerName.toUpperCase();
  fitText(ctx, name, (p) => `400 ${p}px ${DISPLAY}`, 170, W - 144);
  ctx.fillText(name, 72, 1460);

  // to the team
  ctx.fillStyle = '#929396';
  ctx.font = `700 40px ${HEADING}`;
  spaced(ctx, 'GOES TO', 72, 1540, 6);
  const team = card.teamName.toUpperCase();
  const tpx = fitText(ctx, team, (p) => `400 ${p}px ${DISPLAY}`, 84, W - 144 - 64);
  const plateW = Math.min(W - 144, ctx.measureText(team).width + 64);
  ctx.fillStyle = card.teamColor;
  ctx.fillRect(72, 1566, plateW, 120);
  ctx.fillStyle = ink;
  ctx.fillText(team, 104, 1566 + 60 + tpx * 0.36);

  // price
  ctx.fillStyle = '#fff';
  ctx.font = `400 170px ${DISPLAY}`;
  const price = num(card.price);
  ctx.fillText(price, 72, 1872);
  const pw = ctx.measureText(price).width;
  ctx.fillStyle = MINT;
  ctx.font = `800 64px ${HEADING}`;
  ctx.fillText('PTS', 72 + pw + 22, 1872);
  if (card.bids && card.bids > 1) {
    ctx.fillStyle = '#929396';
    ctx.font = `700 40px ${HEADING}`;
    ctx.textAlign = 'right';
    ctx.fillText(`AFTER ${card.bids} BIDS`, W - 72, 1872);
    ctx.textAlign = 'left';
  }
  photo?.close();
  return toBlob(canvas);
}

export interface SquadCard {
  auctionName: string;
  teamName: string;
  teamColor: string;
  captain?: string;
  spent: number;
  players: { name: string; price: number }[];
}

/** A team's whole squad on one poster. */
export async function renderSquadCard(card: SquadCard): Promise<Blob> {
  await fontsReady();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not make the picture');
  const ink = inkOn(card.teamColor);
  const num = (n: number) => n.toLocaleString('en-IN');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = card.teamColor;
  ctx.fillRect(0, 0, W, 520);

  ctx.fillStyle = ink === '#000000' ? '#000' : MINT;
  ctx.fillRect(72, 84, 12, 56);
  ctx.fillStyle = ink;
  ctx.textBaseline = 'alphabetic';
  fitSpaced(ctx, card.auctionName.toUpperCase(), (p) => `700 ${p}px ${HEADING}`, 44, W - 104 - 72, 104, 128, 4);
  const team = card.teamName.toUpperCase();
  fitText(ctx, team, (p) => `400 ${p}px ${DISPLAY}`, 190, W - 144);
  ctx.fillText(team, 72, 380);
  const sub = [card.captain ? `CAPT. ${card.captain.toUpperCase()}` : '', `${card.players.length} BOUGHT`, `${num(card.spent)} SPENT`]
    .filter(Boolean).join('  ·  ');
  fitSpaced(ctx, sub, (p) => `700 ${p}px ${HEADING}`, 44, W - 144, 72, 460, 3);

  const rows = card.players.slice(0, 14);
  const top = 600;
  const rowH = Math.min(104, (H - top - 80) / Math.max(rows.length, 1));
  rows.forEach((p, i) => {
    const y = top + i * rowH;
    ctx.fillStyle = '#3b3b3c';
    ctx.fillRect(72, y + rowH - 2, W - 144, 2);
    ctx.fillStyle = '#929396';
    ctx.font = `800 40px ${HEADING}`;
    ctx.fillText(String(i + 1).padStart(2, '0'), 72, y + rowH * 0.66);
    ctx.fillStyle = '#fff';
    const price = num(p.price);
    ctx.font = `800 56px ${HEADING}`;
    const pw = ctx.measureText(price).width;
    ctx.textAlign = 'right';
    ctx.fillText(price, W - 72, y + rowH * 0.68);
    ctx.textAlign = 'left';
    const nm = p.name.toUpperCase();
    fitText(ctx, nm, (px) => `400 ${px}px ${DISPLAY}`, 64, W - 144 - 110 - pw - 40);
    ctx.fillText(nm, 160, y + rowH * 0.7);
  });
  return toBlob(canvas);
}

/** Hand the picture to the phone's share sheet (WhatsApp, status, …); where
 *  that isn't possible, save it as a file instead. */
export async function sharePicture(blob: Blob, fileName: string, text: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const file = new File([blob], fileName, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      /* fall through to saving */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
