import { io, Socket } from 'socket.io-client';
import { create } from 'zustand';
import { StateView } from './types';
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
    const socket = io({
      auth: { token: loadSession()?.token ?? '' },
      reconnectionDelayMax: 4000,
    });
    socket.on('connect', () => set({ connected: true }));
    socket.on('disconnect', () => set({ connected: false }));
    socket.on('state', (state: StateView) => set({ state }));
    set({ socket });
  },

  /** Re-request state with the current token (after login/logout). */
  refresh: () => {
    const { socket } = get();
    const token = loadSession()?.token ?? '';
    if (socket) socket.emit('refresh', token);
  },
}));
