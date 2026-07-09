import type { Server as HttpServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import { Store } from './db';
import { statePayloadFor } from './views';

// Sockets are receive-only: clients mutate via REST, the server pushes
// role-tailored state to every connected socket after each mutation.

export function createSockets(httpServer: HttpServer, store: Store): { io: Server; broadcast: () => void } {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: false },
    serveClient: false,
  });

  function payloadFor(socket: Socket) {
    const token = socket.handshake.auth?.token as string | undefined;
    const session = token ? store.getSession(token) : undefined;
    return statePayloadFor(store, session);
  }

  io.on('connection', (socket) => {
    socket.emit('state', payloadFor(socket));
    // Clients re-auth by reconnecting with a new token in handshake.auth,
    // or by asking for a refresh after logging in over REST.
    socket.on('refresh', (token?: string) => {
      if (typeof token === 'string') socket.handshake.auth = { ...socket.handshake.auth, token };
      socket.emit('state', payloadFor(socket));
    });
  });

  let scheduled = false;
  function broadcast(): void {
    // Coalesce bursts (e.g. bulk add) into one emit per tick.
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      for (const [, socket] of io.of('/').sockets) {
        socket.emit('state', payloadFor(socket));
      }
    });
  }

  return { io, broadcast };
}
