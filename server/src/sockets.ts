import type { Server as HttpServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import { REACTIONS } from './audience';
import { deviceTagOf } from './auth';
import { Session, Store } from './db';
import { statePayloadFor } from './views';

// Clients change the auction over REST only; the server pushes role-tailored
// state to every connected socket after each change. Beside the state, two
// light channels serve the phones watching: `presence` (how many are watching,
// how many have guessed) and `reactions` (emoji taps, relayed in small batches).
//
// Everything a socket sends is untrusted: a token that isn't a short string is
// ignored (a non-string once crashed the process inside SQLite), a refresh is
// answered at most a few times a second, a socket that stops reading is
// dropped instead of queueing snapshots without limit, and a reaction must be
// one of a fixed set, at most a couple a second per phone, a few dozen a
// batch from everyone.

const MAX_TOKEN = 128;
const REFRESH_EVERY_MS = 400;  // answer a socket's refreshes at most this often
const MAX_QUEUED = 30;         // snapshots waiting to be written before a socket counts as dead
const PRESENCE_EVERY_MS = 1000;
const REACT_EVERY_MS = 400;    // one reaction per phone per this long
const REACT_BATCH_MS = 250;    // reactions are relayed together this often
const REACT_BATCH_MAX = 40;    // ...and at most this many per batch from everyone

function tokenOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_TOKEN ? value : undefined;
}

export function createSockets(httpServer: HttpServer, store: Store): {
  io: Server;
  broadcast: () => void;
  presenceChanged: () => void;
} {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: false },
    serveClient: false,
    // Phones on venue Wi-Fi drop silently (screen lock, network switch).
    // Tight ping cycle detects dead connections in ~20s instead of ~45s so
    // captains reconnect (and get fresh state) quickly.
    pingInterval: 10_000,
    pingTimeout: 10_000,
    maxHttpBufferSize: 16_000, // clients only ever send a token or an emoji
  });

  const sessionOf = (socket: Socket): Session | undefined => {
    const token = tokenOf(socket.handshake.auth?.token);
    return token ? store.getSession(token) : undefined;
  };

  /** The socket's payload. One broadcast builds each role's payload once
   *  (`cache`) instead of once per connected phone. */
  function payloadFor(socket: Socket, cache?: Map<string, Record<string, unknown>>) {
    const session = sessionOf(socket);
    if (!cache) return statePayloadFor(store, session);
    const key = session ? `${session.role}:${session.teamId ?? ''}` : 'public';
    let base = cache.get(key);
    if (!base) {
      base = statePayloadFor(store, session);
      cache.set(key, base);
    }
    // A captain's payload carries the fingerprint of their own device.
    if (session?.role === 'team') return { ...base, you: { ...(base.you as object), deviceTag: deviceTagOf(session.token) } };
    return base;
  }

  /** Send the state, unless the socket has stopped reading: then drop it (its
   *  client reconnects and gets a fresh snapshot). Never throws. */
  function send(socket: Socket, cache?: Map<string, Record<string, unknown>>): void {
    try {
      const queued = (socket.conn as unknown as { writeBuffer?: unknown[] }).writeBuffer?.length ?? 0;
      if (queued > MAX_QUEUED) {
        socket.disconnect(true);
        return;
      }
      socket.emit('state', payloadFor(socket, cache));
    } catch (err) {
      console.error('[sockets] could not send state:', err);
    }
  }

  // ---- presence: how many are watching, how many have guessed -----------------
  const presence = () => ({
    watching: io.of('/').sockets.size,
    guesses: store.audience.count(store.state.lot?.id),
  });
  let presenceTimer: NodeJS.Timeout | null = null;
  let lastPresence = '';
  function presenceChanged(): void {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      try {
        const now = presence();
        const key = `${now.watching}:${now.guesses}`;
        if (key === lastPresence) return;
        lastPresence = key;
        io.emit('presence', now);
      } catch (err) {
        console.error('[sockets] could not send presence:', err);
      }
    }, PRESENCE_EVERY_MS);
    presenceTimer.unref();
  }

  // ---- reactions: emoji taps, relayed to every screen in small batches ---------
  let batch: Record<string, number> = {};
  let batchSize = 0;
  let batchTimer: NodeJS.Timeout | null = null;
  function react(emoji: string): void {
    if (batchSize >= REACT_BATCH_MAX) return; // a flood shows as a full batch, no more
    batch[emoji] = (batch[emoji] ?? 0) + 1;
    batchSize += 1;
    if (batchTimer) return;
    batchTimer = setTimeout(() => {
      const out = batch;
      batch = {};
      batchSize = 0;
      batchTimer = null;
      io.emit('reactions', out);
    }, REACT_BATCH_MS);
    batchTimer.unref();
  }

  io.on('connection', (socket) => {
    send(socket);
    try {
      socket.emit('presence', presence());
    } catch {
      /* the next presence change reaches it */
    }
    presenceChanged();

    // Clients re-auth by reconnecting with a new token in handshake.auth,
    // or by asking for a refresh after logging in over REST.
    let last = 0;
    let timer: NodeJS.Timeout | null = null;
    socket.on('refresh', (token?: unknown) => {
      // A string replaces the token; an empty (or junk) one signs the socket
      // out, which is what Sign out sends. Anything else leaves it as it was.
      if (typeof token === 'string') socket.handshake.auth = { ...socket.handshake.auth, token: tokenOf(token) ?? '' };
      if (timer) return; // a refresh is already on its way
      const wait = Math.max(0, last + REFRESH_EVERY_MS - Date.now());
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        send(socket);
      }, wait);
    });

    let lastReact = 0;
    socket.on('react', (emoji?: unknown) => {
      if (typeof emoji !== 'string' || !REACTIONS.includes(emoji)) return;
      if (store.state.settings.audienceReactions === false) return;
      const now = Date.now();
      if (now - lastReact < REACT_EVERY_MS) return;
      lastReact = now;
      react(emoji);
    });

    socket.on('disconnect', () => {
      if (timer) clearTimeout(timer);
      presenceChanged();
    });
  });

  let scheduled = false;
  function broadcast(): void {
    // Coalesce bursts (e.g. bulk add) into one emit per tick.
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      const cache = new Map<string, Record<string, unknown>>();
      for (const [, socket] of io.of('/').sockets) send(socket, cache);
      presenceChanged(); // a new lot resets the guess count
    });
  }

  return { io, broadcast, presenceChanged };
}
