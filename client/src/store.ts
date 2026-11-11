import { io, Socket } from 'socket.io-client';
import { create } from 'zustand';
import { Presence, StateView } from './types';
import { api } from './api';
import { noteServerTime } from './clock';
import { loadSession } from './session';

/** Emoji reactions arrive in small batches: emoji → how many. They are
 *  moments, not state, so screens subscribe instead of reading the store. */
type ReactionListener = (batch: Record<string, number>) => void;
const reactionListeners = new Set<ReactionListener>();
export function onReactions(fn: ReactionListener): () => void {
  reactionListeners.add(fn);
  return () => {
    reactionListeners.delete(fn);
  };
}

interface AppStore {
  state: StateView | null;
  presence: Presence | null;
  connected: boolean;
  socket: Socket | null;
  connect: () => void;
  refresh: () => void;
  react: (emoji: string) => void;
}

export const useApp = create<AppStore>((set, get) => ({
  state: null,
  presence: null,
  connected: false,
  socket: null,

  connect: () => {
    if (get().socket) return;

    // Never let an older snapshot overwrite a newer one (a zombie socket or a
    // slow poll response must not roll the UI back mid-auction). Equal versions
    // still apply — a role refresh re-sends the same version with new `you`.
    const apply = (next: StateView) => {
      const cur = get().state;
      if (cur && next.version < cur.version) return;
      noteServerTime(next.serverTime); // measured now, as it arrives (see clock.ts)
      set({ state: next });
    };

    const socket = io({
      // Function form: reconnects always present the *current* token, so a
      // captain who signed in after page load stays signed in across drops.
      auth: (cb) => cb({ token: loadSession()?.token ?? '' }),
      reconnectionDelayMax: 4000,
      timeout: 8000,
    });
    socket.on('connect', () => set({ connected: true }));
    socket.on('disconnect', () => set({ connected: false }));
    socket.on('state', apply);
    socket.on('presence', (p: Presence) => {
      if (p && typeof p.watching === 'number') set({ presence: { watching: p.watching, guesses: Number(p.guesses) || 0 } });
    });
    socket.on('reactions', (batch: Record<string, number>) => {
      if (!batch || typeof batch !== 'object') return;
      for (const fn of reactionListeners) fn(batch);
    });
    set({ socket });

    // REST fallback: phones suspend background tabs and kill sockets silently.
    // Re-sync the moment the app becomes visible again, and poll as insurance
    // against zombie connections (also keeps free-tier hosts from idling out).
    const fetchNow = async () => {
      try {
        apply(await api.get<StateView>('/api/state'));
      } catch {
        /* offline — the socket reconnect will heal us */
      }
    };
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      fetchNow();
      const s = get().socket;
      if (s && !s.connected) s.connect();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    window.setInterval(fetchNow, 15_000);
  },

  /** Send an emoji reaction to every screen (the server limits how often). */
  react: (emoji: string) => {
    get().socket?.emit('react', emoji);
  },

  /** Re-request state with the current token (after login/logout). */
  refresh: () => {
    const { socket } = get();
    const token = loadSession()?.token ?? '';
    if (socket) socket.emit('refresh', token);
  },
}));
