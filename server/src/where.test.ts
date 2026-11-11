import assert from 'node:assert/strict';
import os from 'node:os';
import { test } from 'node:test';
import { lanAddresses, reachableFrom } from './where';

const v4 = (address: string, internal = false) => ({
  address, netmask: '255.255.255.0', family: 'IPv4' as const, mac: '00:00:00:00:00:00', internal, cidr: `${address}/24`,
});
const v6 = (address: string) => ({
  address, netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6' as const, mac: '00:00:00:00:00:00', internal: false, cidr: `${address}/64`, scopeid: 0,
});

test('the Wi-Fi address comes first, virtual adapters last, loopback and IPv6 never', () => {
  const addresses = lanAddresses({
    'vEthernet (WSL)': [v4('172.28.96.1')],
    'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
    Ethernet: [v4('10.0.0.7'), v6('fe80::1')],
    'VirtualBox Host-Only Network': [v4('192.168.56.1')],
    'Wi-Fi': [v6('fe80::2'), v4('192.168.1.23')],
  });
  assert.deepEqual(addresses, ['192.168.1.23', '10.0.0.7', '172.28.96.1', '192.168.56.1']);
  assert.deepEqual(lanAddresses({ 'Wi-Fi': [v4('169.254.12.7')], Ethernet: [v4('10.0.0.7')] }), ['10.0.0.7'], 'a self-assigned address means no network there');
  assert.deepEqual(lanAddresses({}), []);
  assert.deepEqual(lanAddresses({ lo: [v4('127.0.0.1', true)], odd: undefined }), []);
});

test('callers who get nothing cost nothing; the machine itself is answered from a short memory', () => {
  const real = os.networkInterfaces;
  let reads = 0;
  os.networkInterfaces = () => {
    reads += 1;
    return real();
  };
  try {
    reachableFrom('192.168.1.50', '0.0.0.0', 4000, false);
    reachableFrom(undefined, '0.0.0.0', 4000, false);
    reachableFrom('127.0.0.1', '127.0.0.1', 4000, false);
    reachableFrom('127.0.0.1', '0.0.0.0', 4000, true);
    assert.equal(reads, 0, 'the adapters are not read for anyone who is refused');
    const first = reachableFrom('127.0.0.1', '0.0.0.0', 4000, false);
    reachableFrom('::1', '0.0.0.0', 4000, false);
    reachableFrom('127.0.0.1', '0.0.0.0', 4000, false);
    assert.equal(reads, 1, 'and once for three calls in a row from the machine itself');
    assert.ok(first.every((u) => /^http:\/\/[0-9.]+:4000$/.test(u)));
  } finally {
    os.networkInterfaces = real;
  }
});

test('only the machine itself is told the Wi-Fi address, and only when phones could use it', () => {
  const lan = ['192.168.1.23', '10.0.0.7'];
  const urls = ['http://192.168.1.23:4000', 'http://10.0.0.7:4000'];
  for (const self of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.deepEqual(reachableFrom(self, '0.0.0.0', 4000, false, lan), urls, self);
  assert.deepEqual(reachableFrom('127.0.0.1', '::', 4000, false, lan), urls);
  assert.deepEqual(reachableFrom('192.168.1.50', '0.0.0.0', 4000, false, lan), [], 'another device already has an address that works');
  assert.deepEqual(reachableFrom(undefined, '0.0.0.0', 4000, false, lan), []);
  assert.deepEqual(reachableFrom('127.0.0.1', '127.0.0.1', 4000, false, lan), [], 'listening on this machine only: no phone can connect');
  assert.deepEqual(reachableFrom('127.0.0.1', '0.0.0.0', 4000, true, lan), [], 'behind a proxy the addresses are the host\'s own');
  assert.deepEqual(reachableFrom('127.0.0.1', '0.0.0.0', 4000, false, []), [], 'no network');
});
