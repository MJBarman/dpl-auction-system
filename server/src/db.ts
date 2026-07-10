import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { AuctionSnapshot, EventRow, State } from './types';
import { buildInitialState, ensurePhotoCodes } from './seed';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const MAX_UNDO = 200;

export interface Session {
  token: string;
  role: 'admin' | 'team';
  teamId: string | null;
  createdAt: number;
}

export class Store {
  private db: Database.Database;
  state: State;
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
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get('state') as { value: string } | undefined;
    if (row) {
      this.state = JSON.parse(row.value) as State;
      if (ensurePhotoCodes(this.state)) this.saveState(); // pre-photo-feature database
    } else {
      this.state = buildInitialState();
      this.saveState();
      this.logEvent('system', 'Fresh database initialised with the DPL Season 4 seed data');
    }
    const undoRow = this.db.prepare('SELECT value FROM kv WHERE key = ?').get('undo') as { value: string } | undefined;
    this.undoStack = undoRow ? (JSON.parse(undoRow.value) as AuctionSnapshot[]) : [];
  }

  saveState(): void {
    this.state.version += 1;
    this.db
      .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('state', JSON.stringify(this.state));
  }

  replaceState(next: State): void {
    ensurePhotoCodes(next); // restored backups may predate the photo feature
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
      .prepare('INSERT INTO sessions (token, role, teamId, createdAt) VALUES (?, ?, ?, ?)')
      .run(s.token, s.role, s.teamId, s.createdAt);
  }

  getSession(token: string): Session | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as Session | undefined;
  }

  deleteSessionsForTeam(teamId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE teamId = ?').run(teamId);
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
