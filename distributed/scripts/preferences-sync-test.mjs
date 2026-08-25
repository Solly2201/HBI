/**
 * Focused two-client check of the cuisine-selection (preferences) screen sync.
 *
 *   node scripts/preferences-sync-test.mjs
 *
 * Reproduces the LAN bug setup with two players, each holding their own
 * WebSocket subscription (two devices):
 *
 *   - host submits cuisines  -> the guest's socket must receive
 *     PREFERENCES_SUBMITTED with submittedBy=1
 *   - guest submits cuisines -> the host's socket must receive
 *     PREFERENCES_SUBMITTED with submittedBy=2 and the merged cuisines
 *   - GET /preferences must carry perPlayer entries, which is what a
 *     refreshed device uses to rebuild its "locked in" state
 *
 * The STOMP client is borrowed from the frontend's node_modules, so run
 * `npm install` in ../frontend first (the script says so if it is missing).
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:8080';

let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ''}`);
  }
}

async function call(method, url, { token, body } = {}) {
  const res = await fetch(`${GATEWAY}${url}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(label, fn, { attempts = 40, delay = 250 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await fn()) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(delay);
  }
  console.log(`  ...gave up waiting for ${label}`);
  return false;
}

async function connectStomp(token, roomCode, onEvent) {
  let Client;
  try {
    const require = createRequire(path.join(HERE, '..', 'frontend', 'package.json'));
    ({ Client } = require('@stomp/stompjs'));
  } catch {
    console.log('  !! STOMP client unavailable - run `npm install` in distributed/frontend first.');
    return { connected: false, close() {} };
  }

  const wsUrl = `${GATEWAY.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
  const client = new Client({
    webSocketFactory: () => new WebSocket(wsUrl),
    reconnectDelay: 0,
    debug: () => {},
  });

  const connected = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 15000);
    client.onConnect = () => {
      clearTimeout(timer);
      client.subscribe(`/topic/rooms/${roomCode}`, (frame) => {
        try {
          onEvent(JSON.parse(frame.body));
        } catch {
          /* ignore */
        }
      });
      setTimeout(() => resolve(true), 400);
    };
    client.onStompError = () => {
      clearTimeout(timer);
      resolve(false);
    };
    client.activate();
  });

  return { connected, close: () => client.deactivate() };
}

async function main() {
  console.log('\n=== Two-client cuisine-selection sync');

  const s1 = await call('POST', '/api/users/session', { body: { displayName: 'LaptopHost' } });
  const s2 = await call('POST', '/api/users/session', { body: { displayName: 'PhoneGuest' } });
  check('two sessions started', !!s1.data?.token && !!s2.data?.token);
  const hostToken = s1.data.token;
  const guestToken = s2.data.token;
  const hostId = s1.data.user.id;
  const guestId = s2.data.user.id;

  const created = await call('POST', '/api/rooms', { token: hostToken });
  const roomCode = created.data?.code;
  check('host created a room', created.status === 201 && !!roomCode, `got ${created.status}`);

  await call('POST', `/api/rooms/${roomCode}/join`, { token: guestToken });

  // Each player holds their own socket, like the two devices on the LAN.
  const hostEvents = [];
  const guestEvents = [];
  const hostStomp = await connectStomp(hostToken, roomCode, (e) => hostEvents.push(e));
  const guestStomp = await connectStomp(guestToken, roomCode, (e) => guestEvents.push(e));
  check('both clients connected over STOMP', hostStomp.connected && guestStomp.connected);

  await call('PUT', `/api/rooms/${roomCode}/status`, {
    token: hostToken,
    body: { status: 'PREFERENCES' },
  });

  // ---------------------------------------- host submits, guest must see it
  const p1 = await call('POST', `/api/rooms/${roomCode}/preferences`, {
    token: hostToken,
    body: { cuisines: ['Indian', 'Chinese'] },
  });
  check('host submitted cuisines', p1.status === 200, `got ${p1.status}`);
  check('host response carries the aggregate', p1.data?.group?.submittedBy === 1,
    JSON.stringify(p1.data?.group));

  const guestSaw = await waitFor('PREFERENCES_SUBMITTED on the guest socket', async () =>
    guestEvents.some((e) => e.type === 'PREFERENCES_SUBMITTED' && e.payload?.submittedBy === 1));
  check('guest received PREFERENCES_SUBMITTED (submittedBy=1)', guestSaw,
    `saw: ${guestEvents.map((e) => e.type).join(', ') || 'nothing'}`);

  // ---------------------------------------- guest submits, host must see it
  const p2 = await call('POST', `/api/rooms/${roomCode}/preferences`, {
    token: guestToken,
    body: { cuisines: ['Italian'] },
  });
  check('guest submitted cuisines', p2.status === 200, `got ${p2.status}`);

  const hostSaw = await waitFor('PREFERENCES_SUBMITTED on the host socket', async () =>
    hostEvents.some((e) => e.type === 'PREFERENCES_SUBMITTED' && e.payload?.submittedBy === 2));
  check('host received PREFERENCES_SUBMITTED (submittedBy=2)', hostSaw,
    `saw: ${hostEvents.map((e) => `${e.type}:${e.payload?.submittedBy ?? ''}`).join(', ') || 'nothing'}`);

  const finalEvent = [...hostEvents].reverse()
    .find((e) => e.type === 'PREFERENCES_SUBMITTED' && e.payload?.submittedBy === 2);
  check('pushed aggregate merges both players\' cuisines',
    ['Indian', 'Chinese', 'Italian'].every((c) => finalEvent?.payload?.cuisines?.includes(c)),
    JSON.stringify(finalEvent?.payload?.cuisines));

  // -------------------------------- what a refreshed device reconstructs from
  const agg = await call('GET', `/api/rooms/${roomCode}/preferences`, { token: hostToken });
  check('GET /preferences reports both submissions', agg.data?.submittedBy === 2,
    JSON.stringify(agg.data));
  const mineHost = (agg.data?.perPlayer || []).find((p) => p.userId === hostId);
  const mineGuest = (agg.data?.perPlayer || []).find((p) => p.userId === guestId);
  check('perPlayer lets the host rebuild "locked in" after a refresh',
    JSON.stringify(mineHost?.cuisines) === JSON.stringify(['Indian', 'Chinese']),
    JSON.stringify(mineHost));
  check('perPlayer lets the guest rebuild "locked in" after a refresh',
    JSON.stringify(mineGuest?.cuisines) === JSON.stringify(['Italian']),
    JSON.stringify(mineGuest));

  hostStomp.close();
  guestStomp.close();

  console.log(`\n${'-'.repeat(58)}`);
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('Cuisine-selection sync verified for two clients.');
}

main().catch((e) => {
  console.error('\nPreferences sync test crashed:', e);
  process.exit(1);
});
