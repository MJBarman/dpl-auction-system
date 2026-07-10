// Loads server/.env (if present) into process.env before any other module
// reads it — import this FIRST in index.ts. Zero-dependency stand-in for
// dotenv; real deployments (Render, Docker) set env vars directly and never
// need the file. Existing env vars always win over the file.

import fs from 'node:fs';
import path from 'node:path';

// dev: server/src/../.env — prod build: server/dist/../.env — both = server/.env
for (const file of [path.join(__dirname, '..', '.env'), path.join(process.cwd(), '.env')]) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
  break;
}
