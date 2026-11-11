import './env'; // must run first — later imports read process.env at load time
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createApi } from './api';
import { attachSession, ensurePin } from './auth';
import { Store } from './db';
import { PHOTO_BUCKET, photosConfigured } from './photos';
import { createSockets } from './sockets';
import { lanAddresses, reachableFrom } from './where';

const PORT = Number(process.env.PORT) || 4000;
const HOST = process.env.HOST || '0.0.0.0';

const store = new Store();
let adminPin = ensurePin(store);

const app = express();
app.disable('x-powered-by');

// Behind a reverse proxy (Render) every request arrives from the proxy, so the
// per-visitor sign-in limits need Express to read the visitor's address from
// X-Forwarded-For. Trust exactly the proxy hops in front of the app — never
// `true`, which would let a visitor fake their own address. TRUST_PROXY_HOPS
// overrides; on Render (which sets RENDER) it defaults to 1, Render's own
// guidance. Locally there is no proxy: 0.
const trustHops = Number(process.env.TRUST_PROXY_HOPS ?? (process.env.RENDER ? 1 : 0));
if (Number.isInteger(trustHops) && trustHops > 0) app.set('trust proxy', trustHops);

// JSON bodies stay small (every route parses them before any sign-in check);
// only a backup restore needs room for a whole auction.
const smallJson = express.json({ limit: '200kb' });
const restoreJson = express.json({ limit: '4mb' });
app.use((req, res, next) => (req.path === '/api/admin/restore' ? restoreJson : smallJson)(req, res, next));
// A body that isn't valid JSON (or is too big) gets a short JSON answer, not
// Express's HTML error page with a stack trace.
app.use((err: Error & { type?: string; status?: number }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request body is not valid JSON' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The request body is too large' });
  if (typeof err.status === 'number' && err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: 'Bad request' });
  next(err);
});

const server = http.createServer(app);
const { broadcast, presenceChanged } = createSockets(server, store);

// The projector opened on this machine as "localhost" asks where phones on the
// Wi-Fi can reach the server, for its QR code (rules in where.ts).
app.get('/api/where', (req, res) => {
  res.json({ lan: reachableFrom(req.socket.remoteAddress, HOST, PORT, trustHops > 0) });
});

app.use('/api', attachSession(store), createApi({
  store,
  broadcast,
  presenceChanged,
  proxied: trustHops > 0,
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
    res.type('text/plain').send('Auction server is running. Build the client (npm run build) to serve the UI from here.');
  });
}

// Last stop for anything unexpected outside the API router: a plain JSON 500,
// never Express's HTML page with a stack trace.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] unexpected error:', err);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});

server.listen(PORT, HOST, () => {
  const title = store.state.settings.auctionName;
  console.log('');
  console.log(`  ${title}`);
  console.log(`  ${'-'.repeat(title.length)}`);
  console.log(`  Node:    ${process.version}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const addr of lanAddresses()) {
    console.log(`  Network: http://${addr}:${PORT}   (open this on phones on the same Wi-Fi)`);
  }
  console.log('');
  // A PIN from the environment is never echoed into the host's logs; a
  // generated one is printed, since the log is the only place to read it.
  console.log(process.env.ADMIN_PIN?.trim()
    ? '  Admin PIN: set by the ADMIN_PIN env var'
    : `  Admin PIN: ${adminPin}   (generated — set ADMIN_PIN to choose your own; change it in Settings)`);
  if (trustHops > 0) console.log(`  Proxy:   trusting ${trustHops} hop(s) of X-Forwarded-For for visitor addresses`);
  console.log('  Team join codes are shown in the admin console under "Teams".');
  console.log(photosConfigured()
    ? `  Player photos: Supabase bucket "${PHOTO_BUCKET}" — upload links in Admin → Players.`
    : '  Player photos: disabled — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to enable uploads (see server/.env.example).');
  console.log('');
});

process.on('SIGINT', () => {
  console.log('\nShutting down…');
  server.close();
  store.close();
  process.exit(0);
});
