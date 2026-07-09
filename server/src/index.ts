import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApi } from './api';
import { attachSession, ensurePin } from './auth';
import { Store } from './db';
import { createSockets } from './sockets';

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';

const store = new Store();
let adminPin = ensurePin(store);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

const server = http.createServer(app);
const { broadcast } = createSockets(server, store);

app.use('/api', attachSession(store), createApi({
  store,
  broadcast,
  getPin: () => adminPin,
  setPin: (pin: string) => {
    adminPin = pin;
    store.setPin(pin);
  },
}));

// Serve the built client (production). In dev, Vite serves the client with a proxy.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send('DPL Auction server is running. Build the client (npm run build) to serve the UI from here.');
  });
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address);
    }
  }
  return out;
}

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  DPL Season 4 Auction System');
  console.log('  ---------------------------');
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const addr of lanAddresses()) {
    console.log(`  Network: http://${addr}:${PORT}   (open this on phones on the same Wi-Fi)`);
  }
  console.log('');
  console.log(`  Admin PIN: ${adminPin}   (override with the ADMIN_PIN env var; change it in Settings)`);
  console.log('  Team join codes are shown in the admin console under "Teams".');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\nShutting down…');
  server.close();
  store.close();
  process.exit(0);
});
