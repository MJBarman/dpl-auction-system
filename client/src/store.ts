import { io, Socket } from 'socket.io-client';
import { create } from 'zustand';
import { StateView } from './types';
import { api } from './api';
import { loadSession } from './session';

interface AppStore {
  state: StateView | null;
  connected: boolean;
  socket: Socket | null;
  connect: () => void;
  refresh: () => void;
}

export const useApp = create<AppStore>((set, get) => ({
  state: null,
  connected: false,
  socket: null,

  connect: () => {
    if (get().socket) return;

    // Never let an older snapshot overwrite a newer one (a zombie socket or a
    // slow poll response must not roll the UI back mid-auction). Equal versions
    // still apply — a role refresh re-sends the same version with new `you`.
    const apply = (next: StateView) => {
      const cur = get().state;
      if (!cur || next.version >= cur.version) set({ state: next });
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

  /** Re-request state with the current token (after login/logout). */
  refresh: () => {
    const { socket } = get();
    const token = loadSession()?.token ?? '';
    if (socket) socket.emit('refresh', token);
  },
}));
