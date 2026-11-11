import os from 'node:os';

// Where phones can reach this server when it runs on a laptop at the venue.
// The projector opened on that laptop as "localhost" needs it for the QR code:
// a phone can't open "localhost".

type Interfaces = NodeJS.Dict<os.NetworkInterfaceInfo[]>;

const VIRTUAL = /vethernet|virtual|vmware|vbox|docker|wsl|hyper-v|loopback|bluetooth|tailscale|zerotier/i;
const WIFI = /wi-?fi|wlan|wireless/i;

/** This machine's IPv4 addresses on the local network, the likeliest one first:
 *  Wi-Fi, then other real adapters, then virtual ones (WSL, VMs, VPNs). An
 *  adapter with no network (a self-assigned 169.254.x.x address) is left out. */
export function lanAddresses(interfaces: Interfaces = os.networkInterfaces()): string[] {
  const found: { address: string; rank: number }[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    const rank = VIRTUAL.test(name) ? 2 : WIFI.test(name) ? 0 : 1;
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) found.push({ address: iface.address, rank });
    }
  }
  return found.sort((a, b) => a.rank - b.rank).map((f) => f.address);
}

// Reading the adapters takes a couple of milliseconds on Windows, far more
// than anything else an unauthenticated request can cost here, so the answer
// is remembered for a few seconds.
let recent: { at: number; list: string[] } | null = null;
function recentAddresses(): string[] {
  const now = Date.now();
  if (!recent || now - recent.at > 5000) recent = { at: now, list: lanAddresses() };
  return recent.list;
}

/** The addresses to offer a caller. Only the machine itself is told (anyone
 *  else already has an address that works), only when the server listens on
 *  the network at all, and never behind a proxy: on a host like Render these
 *  would be container addresses nobody outside could use. Callers who get
 *  nothing cost nothing: the adapters are read only for the machine itself. */
export function reachableFrom(
  remote: string | undefined,
  host: string,
  port: number,
  proxied: boolean,
  addresses?: string[],
): string[] {
  const self = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const open = host === '0.0.0.0' || host === '::';
  if (!self || !open || proxied) return [];
  return (addresses ?? recentAddresses()).map((a) => `http://${a}:${port}`);
}
