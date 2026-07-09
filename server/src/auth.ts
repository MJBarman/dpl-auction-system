import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
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

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function tokenFromRequest(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  const q = req.query.token;
  if (typeof q === 'string' && q) return q;
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

/** Tiny fixed-window rate limiter for the login endpoints. */
export function loginRateLimiter(maxPerMinute = 20) {
  const hits = new Map<string, { count: number; windowStart: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart > 60_000) {
      hits.set(key, { count: 1, windowStart: now });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > maxPerMinute) {
      res.status(429).json({ error: 'Too many attempts — wait a minute and try again' });
      return;
    }
    next();
  };
}
