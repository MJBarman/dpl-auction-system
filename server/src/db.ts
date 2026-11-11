import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { Audience, AudienceSave } from './audience';
import { AuctionSnapshot, EventRow, State } from './types';
import { applyDataMigrations, buildInitialState, ensurePhotoCodes, ensureTimeoutFields, repairState } from './seed';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MAX_UNDO = 200;
/** A sign-in ends after two weeks WITHOUT USE: a console or phone that keeps
 *  being used stays signed in through setup and the event, while a forgotten
 *  or leaked token stops working on its own. */
export const SESSION_TTL_MS = 14 * 24 * 3_600_000;
/** How often a session's last use is written back (not on every request). */
const SEEN_EVERY_MS = 3_600_000;

export interface Session {
  token: string;
  role: 'admin' | 'team';
  teamId: string | null;
  createdAt: number;
  lastSeenAt?: number | null;
}

export class Store {
  private db: Database.Database;
  state: State;
  /** The phones watching: their guesses and scores (see audience.ts). */
  audience: Audience;
  private undoStack: AuctionSnapshot[] = [];

  constructor(dbFile?: string) {
    const file = dbFile ?? path.join(DATA_DIR, 'auction.db');
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        detail TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        teamId TEXT,
        createdAt INTEGER NOT NULL
      );
    `);
    // Sessions expire after SESSION_TTL_MS without use, so a database from
    // before that needs the column that records the last use.
    const sessionCols = this.db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[];
    if (!sessionCols.some((c) => c.name === 'lastSeenAt')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN lastSeenAt INTEGER');
    }
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get('state') as { value: string } | undefined;
    if (row) {
      this.state = JSON.parse(row.value) as State;
      // Migrations for databases created before newer features.
      const migrated = [ensurePhotoCodes(this.state), ensureTimeoutFields(this.state), applyDataMigrations(this.state), repairState(this.state)];
      if (migrated.some(Boolean)) this.saveState();
    } else {
      this.state = buildInitialState();
      this.saveState();
      this.logEvent('system', 'Fresh database initialised with the DCT seed data');
    }
    const undoRow = this.db.prepare('SELECT value FROM kv WHERE key = ?').get('undo') as { value: string } | undefined;
    this.undoStack = undoRow ? (JSON.parse(undoRow.value) as AuctionSnapshot[]) : [];
    this.audience = new Audience(this.getJson<AudienceSave>('audience'), (s) => this.setJson('audience', s));
  }

  /** A JSON value kept beside the state (undefined when missing or unreadable). */
  getJson<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return undefined;
    }
  }

  setJson(key: string, value: unknown): void {
    this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  saveState(): void {
    this.state.version += 1;
    this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('state', JSON.stringify(this.state));
  }

  replaceState(next: State): void {
    ensurePhotoCodes(next); // restored backups may predate the photo feature
    ensureTimeoutFields(next);
    applyDataMigrations(next);
    repairState(next);
    this.state = next;
    this.undoStack = [];
    this.persistUndo();
    this.saveState();
  }

  // --- undo stack ---
  pushUndo(snap: AuctionSnapshot): void {
    this.undoStack.push(snap);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.persistUndo();
  }

  popUndo(): AuctionSnapshot | undefined {
    const snap = this.undoStack.pop();
    this.persistUndo();
    return snap;
  }

  peekUndo(): AuctionSnapshot | undefined {
    return this.undoStack[this.undoStack.length - 1];
  }

  clearUndo(): void {
    this.undoStack = [];
    this.persistUndo();
  }

  private persistUndo(): void {
    this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('undo', JSON.stringify(this.undoStack));
  }

  // --- events (audit log) ---
  logEvent(type: string, detail: string): void {
    this.db.prepare('INSERT INTO events (ts, type, detail) VALUES (?, ?, ?)').run(Date.now(), type, detail);
  }

  recentEvents(limit = 250): EventRow[] {
    return this.db
      .prepare('SELECT id, ts, type, detail FROM events ORDER BY id DESC LIMIT ?')
      .all(limit) as EventRow[];
  }

  allEvents(): EventRow[] {
    return this.db.prepare('SELECT id, ts, type, detail FROM events ORDER BY id ASC').all() as EventRow[];
  }

  // --- sessions ---
  createSession(s: Session): void {
    this.db
      .prepare('INSERT INTO sessions (token, role, teamId, createdAt, lastSeenAt) VALUES (?, ?, ?, ?, ?)')
      .run(s.token, s.role, s.teamId, s.createdAt, s.createdAt);
  }

  /** The live session for a token. Anything but a plausible token string is
   *  ignored (SQLite throws on binding objects or booleans); a session unused
   *  for SESSION_TTL_MS has expired, and each use keeps it alive. */
  getSession(token: unknown): Session | undefined {
    if (typeof token !== 'string' || token.length === 0 || token.length > 128) return undefined;
    const s = this.db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as Session | undefined;
    if (!s) return undefined;
    const now = Date.now();
    const seen = s.lastSeenAt ?? s.createdAt;
    if (now - seen > SESSION_TTL_MS) {
      this.deleteSession(token);
      return undefined;
    }
    if (now - seen > SEEN_EVERY_MS) {
      this.db.prepare('UPDATE sessions SET lastSeenAt = ? WHERE token = ?').run(now, token);
      s.lastSeenAt = now;
    }
    return s;
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  deleteSessionsForTeam(teamId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE teamId = ?').run(teamId);
  }

  /** Signs out every captain's device (a factory reset starts a new event). */
  deleteTeamSessions(): void {
    this.db.prepare("DELETE FROM sessions WHERE role = 'team'").run();
  }

  /** Signs out every other console (after a PIN change). */
  deleteAdminSessionsExcept(token: string): number {
    return this.db.prepare("DELETE FROM sessions WHERE role = 'admin' AND token <> ?").run(token).changes;
  }

  /** How many devices currently hold a live session for this team. */
  countSessionsForTeam(teamId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE teamId = ? AND COALESCE(lastSeenAt, createdAt) > ?')
      .get(teamId, Date.now() - SESSION_TTL_MS) as { n: number };
    return row.n;
  }

  // --- admin pin (kv) ---
  getPin(): string | undefined {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get('adminPin') as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as string) : undefined;
  }

  setPin(pin: string): void {
    this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('adminPin', JSON.stringify(pin));
  }

  close(): void {
    this.db.close();
  }
}
