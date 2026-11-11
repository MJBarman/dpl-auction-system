import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Store, Session } from './db';

declare module 'express-serve-static-core' {
  interface Request {
    session?: Session;
  }
}

export function ensurePin(store: Store): string {
  const envPin = process.env.ADMIN_PIN;
  if (envPin && envPin.trim()) {
    store.setPin(envPin.trim());
    return envPin.trim();
  }
  let pin = store.getPin();
  if (!pin) {
    pin = String(randomInt(100000, 1000000)); // 6 digits
    store.setPin(pin);
  }
  return pin;
}

export function newToken(): string {
  return randomBytes(24).toString('hex');
}

/** Short public fingerprint of a session token. Safe to show in logs and on
 *  screens (it's a truncated hash — the token cannot be recovered from it),
 *  and stable for the life of the session, so every bid can be traced to the
 *  exact signed-in device that placed it. */
export function deviceTagOf(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 6);
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** The bearer token, from the Authorization header only: a token in a URL
 *  ends up in browser history, download lists and proxy logs. */
export function tokenFromRequest(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim() || null;
  return null;
}

export function attachSession(store: Store) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = tokenFromRequest(req);
    if (token) req.session = store.getSession(token);
    next();
  };
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.role !== 'admin') {
    res.status(401).json({ error: 'Admin access required' });
    return;
  }
  next();
}

export function requireTeam(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.role !== 'team' || !req.session.teamId) {
    res.status(401).json({ error: 'Captain access required' });
    return;
  }
  next();
}

interface LimitOptions {
  max: number;                       // requests (or failures) per window
  windowMs?: number;
  key?: (req: Request) => string;    // default: the client address (needs `trust proxy` behind a proxy)
  failuresOnly?: boolean;            // count only failed answers…
  isFailure?: (status: number) => boolean; // …as judged by this (default: 400 and up)
  countWhen?: (status: number) => boolean; // or: count only answers this says yes to (e.g. accepted ones)
  message?: string;                  // the 429 text
}

/** Tiny fixed-window rate limiter. With `failuresOnly`, people who type the
 *  right PIN or code never use up the budget, and one visitor's wrong guesses
 *  never lock anybody else out (with `trust proxy` set right, see index.ts).
 *  Old windows are swept, so the map can't grow without limit. */
export function rateLimiter({
  max, windowMs = 60_000, key = (req) => req.ip ?? 'unknown', failuresOnly = false, isFailure = (status) => status >= 400,
  countWhen, message = 'Too many attempts — wait a minute and try again',
}: LimitOptions) {
  const judged = countWhen ?? (failuresOnly ? isFailure : null);
  const hits = new Map<string, { count: number; windowStart: number }>();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, e] of hits) if (now - e.windowStart > windowMs) hits.delete(k);
  }, windowMs);
  sweep.unref();
  return (req: Request, res: Response, next: NextFunction) => {
    const k = key(req);
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || now - entry.windowStart > windowMs) {
      entry = { count: 0, windowStart: now };
      hits.set(k, entry);
    }
    if (entry.count >= max) {
      res.status(429).json({ error: message });
      return;
    }
    if (judged) {
      const e = entry;
      res.on('finish', () => {
        if (res.statusCode !== 429 && judged(res.statusCode)) e.count += 1;
      });
    } else {
      entry.count += 1;
    }
    next();
  };
}

/** Sign-in and PIN checks: wrong guesses per visitor per minute. */
export function loginRateLimiter(maxFailuresPerMinute = 20) {
  return rateLimiter({ max: maxFailuresPerMinute, failuresOnly: true });
}
