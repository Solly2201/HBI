/**
 * End-to-end check of the HBI Cloud flow, driven entirely through the gateway.
 *
 *   node scripts/smoke-test.mjs
 *
 * It walks the whole journey with two users - register, log in, create a room,
 * join it, submit preferences, rate the shortlist - and asserts that the Kafka
 * -> decision -> WebSocket path actually delivers the result to a subscribed
 * browser. Any failure exits non-zero.
 *
 * The STOMP client is borrowed from the frontend's node_modules, so run
 * `npm install` in ../frontend first (the script says so if it is missing).
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:8080';
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

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

function step(title) {
  console.log(`\n=== ${title}`);
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

async function waitFor(label, fn, { attempts = 40, delay = 500 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await fn()) return true;
    // eslint-disable-next-line no-await-in-loop
    await sleep(delay);
  }
  console.log(`  ...gave up waiting for ${label}`);
  return false;
}

// --------------------------------------------------------------------------

async function main() {
  const stamp = Date.now();
  const alice = { email: `alice${stamp}@hbi.test`, displayName: 'Alice', password: 'blend123' };
  const bob = { email: `bob${stamp}@hbi.test`, displayName: 'Bob', password: 'blend123' };

  // -------------------------------------------------------------- health
  step('Gateway and services are up');
  const health = await call('GET', '/actuator/health');
  check('gateway /actuator/health is UP', health.data?.status === 'UP', JSON.stringify(health.data));

  // ------------------------------------------------------------- auth
  step('Registration and login');
  const reg1 = await call('POST', '/api/users/register', { body: alice });
  check('alice registers (201)', reg1.status === 201, `got ${reg1.status}`);

  const dupe = await call('POST', '/api/users/register', { body: alice });
  check('duplicate email is rejected (409)', dupe.status === 409, `got ${dupe.status}`);

  const reg2 = await call('POST', '/api/users/register', { body: bob });
  check('bob registers (201)', reg2.status === 201, `got ${reg2.status}`);

  const badLogin = await call('POST', '/api/users/login', {
    body: { email: alice.email, password: 'wrong-password' },
  });
  check('wrong password is rejected (401)', badLogin.status === 401, `got ${badLogin.status}`);

  const login1 = await call('POST', '/api/users/login', {
    body: { email: alice.email, password: alice.password },
  });
  check('alice logs in and gets a JWT', !!login1.data?.token, JSON.stringify(login1.data));

  const login2 = await call('POST', '/api/users/login', {
    body: { email: bob.email, password: bob.password },
  });
  check('bob logs in and gets a JWT', !!login2.data?.token);

  const aliceToken = login1.data.token;
  const bobToken = login2.data.token;
  const aliceId = login1.data.user.id;

  // --------------------------------------------------------- gateway auth
  step('Gateway enforces authentication');
  const noAuth = await call('POST', '/api/rooms');
  check('creating a room without a token is 401', noAuth.status === 401, `got ${noAuth.status}`);

  const spoofed = await fetch(`${GATEWAY}/api/rooms`, {
    method: 'POST',
    headers: { 'X-User-Id': '1', 'X-User-Name': 'Impostor' },
  });
  check('spoofed X-User-Id header is rejected', spoofed.status === 401, `got ${spoofed.status}`);

  if (typeof WebSocket !== 'undefined') {
    const wsBase = GATEWAY.replace(/^http/, 'ws');
    check('WebSocket without a token is refused',
      (await probeWs(`${wsBase}/ws`)) !== 'open');
    check('WebSocket with a bogus token is refused',
      (await probeWs(`${wsBase}/ws?token=not-a-jwt`)) !== 'open');
  }

  // ------------------------------------------------------------ catalogue
  step('Restaurant service');
  const cuisines = await call('GET', '/api/restaurants/cuisines');
  check('cuisine list is served', Array.isArray(cuisines.data) && cuisines.data.length >= 5,
    JSON.stringify(cuisines.data));

  const allResto = await call('GET', '/api/restaurants');
  check('catalogue is seeded', Array.isArray(allResto.data) && allResto.data.length >= 20,
    `got ${allResto.data?.length} restaurants`);

  const chinese = await call('GET', '/api/restaurants?cuisine=Chinese');
  check('?cuisine=Chinese filters',
    chinese.data?.length > 0 && chinese.data.every((r) => r.cuisine === 'Chinese'));

  const cheap = await call('GET', '/api/restaurants?budget=300');
  check('?budget=300 filters',
    cheap.data?.length > 0 && cheap.data.every((r) => r.avgCostForTwo <= 300));

  const one = await call('GET', `/api/restaurants/${allResto.data[0].id}`);
  check('single restaurant lookup works', one.data?.id === allResto.data[0].id);

  // ----------------------------------------------------------------- room
  step('Room creation and joining');
  const created = await call('POST', '/api/rooms', { token: aliceToken });
  check('alice creates a room (201)', created.status === 201, `got ${created.status}`);
  const roomCode = created.data?.code;
  check('room code looks like an HBI code', /^HBI[A-Z0-9]{4}$/.test(roomCode || ''), roomCode);
  check('creator is the host', created.data?.hostUserId === aliceId);

  // Subscribe BEFORE bob joins, so the join event has to travel
  // room-service -> Kafka -> rating-service -> STOMP -> here.
  step('WebSocket subscription (via the gateway)');
  const events = [];
  const stomp = await connectStomp(aliceToken, roomCode, (e) => events.push(e));
  check('STOMP client connected to /ws', stomp.connected);

  const joined = await call('POST', `/api/rooms/${roomCode}/join`, { token: bobToken });
  check('bob joins the room', joined.status === 200, `got ${joined.status}`);
  check('room now has two members', joined.data?.memberCount === 2, `got ${joined.data?.memberCount}`);

  const gotJoinEvent = await waitFor('USER_JOINED over WebSocket', async () =>
    events.some((e) => e.type === 'USER_JOINED'));
  check('USER_JOINED arrived over WebSocket (Kafka -> STOMP)', gotJoinEvent,
    `saw: ${events.map((e) => e.type).join(', ') || 'nothing'}`);

  const members = await call('GET', `/api/rooms/${roomCode}/members`, { token: aliceToken });
  check('GET members lists both players', members.data?.length === 2);

  const bobAdvances = await call('PUT', `/api/rooms/${roomCode}/status`, {
    token: bobToken,
    body: { status: 'RATING' },
  });
  check('a non-host cannot move the room forward (403)', bobAdvances.status === 403,
    `got ${bobAdvances.status}`);

  // ---------------------------------------------------------- preferences
  step('Preferences');
  await call('PUT', `/api/rooms/${roomCode}/status`, { token: aliceToken, body: { status: 'PREFERENCES' } });

  const p1 = await call('POST', `/api/rooms/${roomCode}/preferences`, {
    token: aliceToken,
    body: { cuisines: ['Indian', 'Chinese'], maxBudget: 700, maxDistanceKm: 6 },
  });
  check('alice submits preferences', p1.status === 200, `got ${p1.status}`);

  const p2 = await call('POST', `/api/rooms/${roomCode}/preferences`, {
    token: bobToken,
    body: { cuisines: ['Italian'], maxBudget: 900, maxDistanceKm: 8 },
  });
  check('bob submits preferences', p2.status === 200, `got ${p2.status}`);

  const agg = await call('GET', `/api/rooms/${roomCode}/preferences`, { token: aliceToken });
  check('group preferences merge everyone', agg.data?.submittedBy === 2, JSON.stringify(agg.data));
  check('merged cuisines are the union',
    ['Indian', 'Chinese', 'Italian'].every((c) => agg.data.cuisines.includes(c)),
    JSON.stringify(agg.data?.cuisines));

  const nonsense = await call('POST', `/api/rooms/${roomCode}/preferences`, {
    token: aliceToken,
    body: { cuisines: ['Indian'], maxBudget: -5, maxDistanceKm: 6 },
  });
  check('invalid budget is rejected (400)', nonsense.status === 400, `got ${nonsense.status}`);

  // -------------------------------------------------------------- ratings
  step('Rating the shortlist');
  await call('PUT', `/api/rooms/${roomCode}/status`, { token: aliceToken, body: { status: 'RATING' } });

  const shortlist = await call('GET', `/api/rooms/${roomCode}/candidates`, { token: aliceToken });
  check('shortlist is generated', shortlist.data?.length > 0, `got ${shortlist.data?.length}`);
  check('shortlist respects the group cuisines',
    shortlist.data.every((r) => agg.data.cuisines.includes(r.cuisine)),
    shortlist.data?.map((r) => r.cuisine).join(', '));

  const shortlistAgain = await call('GET', `/api/rooms/${roomCode}/candidates`, { token: bobToken });
  check('shortlist is frozen (same list for both players)',
    JSON.stringify(shortlistAgain.data.map((r) => r.id)) ===
      JSON.stringify(shortlist.data.map((r) => r.id)));

  const restaurants = shortlist.data;
  // Give one restaurant a clear win so the outcome is predictable.
  const favourite = restaurants[restaurants.length - 1];

  const badScore = await call('POST', `/api/rooms/${roomCode}/ratings`, {
    token: aliceToken,
    body: { restaurantId: favourite.id, score: 9 },
  });
  check('a score of 9 is rejected (400)', badScore.status === 400, `got ${badScore.status}`);

  for (const r of restaurants) {
    // eslint-disable-next-line no-await-in-loop
    await call('POST', `/api/rooms/${roomCode}/ratings`, {
      token: aliceToken,
      body: { restaurantId: r.id, score: r.id === favourite.id ? 5 : 2 },
    });
  }
  check('alice rated the whole shortlist', true);

  const gotRatingEvent = await waitFor('RATING_SUBMITTED over WebSocket', async () =>
    events.some((e) => e.type === 'RATING_SUBMITTED'));
  check('RATING_SUBMITTED arrived over WebSocket (Kafka -> STOMP)', gotRatingEvent);

  const gotRecs = await waitFor('RECOMMENDATIONS_GENERATED', async () =>
    events.some((e) => e.type === 'RECOMMENDATIONS_GENERATED'));
  check('RECOMMENDATIONS_GENERATED pushed after the Kafka event', gotRecs);

  const midProgress = await call('GET', `/api/rooms/${roomCode}/ratings`, { token: aliceToken });
  check('progress shows 1 of 2 players finished',
    midProgress.data?.progress?.membersFinished === 1,
    JSON.stringify(midProgress.data?.progress));

  const recs = await call('GET', `/api/rooms/${roomCode}/recommendations`, { token: aliceToken });
  check('recommendations are ranked', recs.data?.recommendations?.length === restaurants.length);
  check('the favourite leads the ranking',
    recs.data.recommendations[0].restaurant.id === favourite.id,
    `leader was ${recs.data.recommendations[0].restaurant.name}`);

  const notYet = await call('GET', `/api/rooms/${roomCode}/decision`, { token: aliceToken });
  check('no decision before everyone finishes (404)', notYet.status === 404, `got ${notYet.status}`);

  const bobFinalizes = await call('POST', `/api/rooms/${roomCode}/finalize`, { token: bobToken });
  check('a non-host cannot finalize the blend (403)', bobFinalizes.status === 403,
    `got ${bobFinalizes.status}`);

  // ------------------------------------------------------------- decision
  step('Bob finishes -> automatic decision -> WebSocket');
  for (const r of restaurants) {
    // eslint-disable-next-line no-await-in-loop
    await call('POST', `/api/rooms/${roomCode}/ratings`, {
      token: bobToken,
      body: { restaurantId: r.id, score: r.id === favourite.id ? 5 : 3 },
    });
  }

  const gotDecision = await waitFor('DECISION_FINALIZED over WebSocket', async () =>
    events.some((e) => e.type === 'DECISION_FINALIZED'));
  check('DECISION_FINALIZED broadcast to connected browsers', gotDecision,
    `saw: ${[...new Set(events.map((e) => e.type))].join(', ')}`);

  const decisionEvent = events.find((e) => e.type === 'DECISION_FINALIZED');
  check('decision was triggered by everyone finishing',
    decisionEvent?.payload?.trigger === 'ALL_PLAYERS_RATED',
    decisionEvent?.payload?.trigger);

  const decision = await call('GET', `/api/rooms/${roomCode}/decision`, { token: aliceToken });
  check('GET decision returns the final restaurant', decision.status === 200, `got ${decision.status}`);
  check('the group picked the favourite',
    decision.data?.restaurantId === favourite.id,
    `picked ${decision.data?.restaurant?.name}, expected ${favourite.name}`);
  check('decision carries restaurant details', !!decision.data?.restaurant?.name);

  const again = await call('GET', `/api/rooms/${roomCode}/decision`, { token: bobToken });
  check('the decision is stable when read again',
    again.data?.restaurantId === decision.data?.restaurantId);

  // --------------------------------------------------------------- leave
  step('Leaving a room');
  const left = await call('DELETE', `/api/rooms/${roomCode}/members/${login2.data.user.id}`, {
    token: bobToken,
  });
  check('bob leaves the room', left.status === 200, `got ${left.status}`);
  check('member count drops to 1', left.data?.memberCount === 1, `got ${left.data?.memberCount}`);

  const gotLeftEvent = await waitFor('USER_LEFT over WebSocket', async () =>
    events.some((e) => e.type === 'USER_LEFT'));
  check('USER_LEFT arrived over WebSocket', gotLeftEvent);

  // ------------------------------------------------------------ frontend
  step('Frontend');
  try {
    const page = await fetch(FRONTEND_ORIGIN);
    const html = await page.text();
    check('frontend serves the app shell', page.status === 200 && html.includes('<div id="root">'));
    const proxied = await fetch(`${FRONTEND_ORIGIN}/api/restaurants/cuisines`);
    check('frontend proxies /api to the gateway', proxied.status === 200);
    const logo = await fetch(`${FRONTEND_ORIGIN}/images/logo.png`);
    check('original HBI logo is served', logo.status === 200);
  } catch (e) {
    check('frontend reachable', false, e.message);
  }

  stomp.close();

  // ---------------------------------------------------------------- done
  console.log(`\n${'-'.repeat(58)}`);
  console.log(`${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('HBI Cloud end-to-end flow verified.');
}

// --------------------------------------------------------------------------

/** Opens a bare WebSocket and reports how it ended. Used for the auth checks. */
function probeWs(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* already gone */
      }
      resolve('timeout');
    }, 6000);
    const finish = (outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    ws.onopen = () => {
      ws.close();
      finish('open');
    };
    ws.onerror = () => finish('error');
    ws.onclose = () => finish('closed');
  });
}

async function connectStomp(token, roomCode, onEvent) {
  if (typeof WebSocket === 'undefined') {
    console.log('  !! No global WebSocket. Use Node 22+, or re-run with:');
    console.log('     node --experimental-websocket scripts/smoke-test.mjs');
    return { connected: false, close() {} };
  }

  let Client;
  try {
    const require = createRequire(path.join(HERE, '..', 'frontend', 'package.json'));
    ({ Client } = require('@stomp/stompjs'));
  } catch {
    console.log('  !! STOMP client unavailable - run `npm install` in cloud/frontend first.');
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
      // Give the SUBSCRIBE frame a moment to register on the broker.
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

main().catch((e) => {
  console.error('\nSmoke test crashed:', e);
  process.exit(1);
});
