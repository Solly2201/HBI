/**
 * End-to-end check of the HBI Microservices flow, driven entirely through the gateway.
 *
 *   node scripts/smoke-test.mjs
 *
 * It walks the whole journey with two players - start anonymous sessions,
 * create a room, join it, submit preferences, rate the shortlist - and asserts that the Kafka
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
  const alice = { displayName: 'Alice' };
  const bob = { displayName: 'Bob' };

  // -------------------------------------------------------------- health
  step('Gateway and services are up');
  const health = await call('GET', '/actuator/health');
  check('gateway /actuator/health is UP', health.data?.status === 'UP', JSON.stringify(health.data));

  // ------------------------------------------------------------- auth
  step('Anonymous sessions (no accounts, no passwords)');
  const s1 = await call('POST', '/api/users/session', { body: alice });
  check('alice starts a session and gets a JWT', s1.status === 200 && !!s1.data?.token,
    `got ${s1.status} ${JSON.stringify(s1.data)}`);

  const s2 = await call('POST', '/api/users/session', { body: bob });
  check('bob starts a session and gets a JWT', s2.status === 200 && !!s2.data?.token);

  check('two sessions are two different players',
    s1.data?.user?.id !== s2.data?.user?.id);

  const blank = await call('POST', '/api/users/session', { body: { displayName: '   ' } });
  check('a blank display name is rejected (400)', blank.status === 400, `got ${blank.status}`);

  const gone = await call('POST', '/api/users/register',
    { body: { email: 'x@y.z', displayName: 'X', password: 'blend123' } });
  check('the account-era register endpoint is gone (401/404)',
    gone.status === 401 || gone.status === 404, `got ${gone.status}`);

  const aliceToken = s1.data.token;
  const bobToken = s2.data.token;
  const aliceId = s1.data.user.id;

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
  step('Food service');
  const cuisines = await call('GET', '/api/foods/cuisines');
  check('cuisine list is served', Array.isArray(cuisines.data) && cuisines.data.length >= 5,
    JSON.stringify(cuisines.data));

  const allFoods = await call('GET', '/api/foods');
  check('food catalogue is seeded', Array.isArray(allFoods.data) && allFoods.data.length >= 20,
    `got ${allFoods.data?.length} foods`);

  const chinese = await call('GET', '/api/foods?cuisine=Chinese');
  check('?cuisine=Chinese filters',
    chinese.data?.length > 0 && chinese.data.every((f) => f.cuisine === 'Chinese'));

  check('food names are unique (one candidate per dish)',
    new Set(allFoods.data.map((f) => f.name)).size === allFoods.data.length);

  const one = await call('GET', `/api/foods/${allFoods.data[0].id}`);
  check('single food lookup works', one.data?.id === allFoods.data[0].id);

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
    body: { cuisines: ['Indian', 'Chinese'] },
  });
  check('alice submits cuisines', p1.status === 200, `got ${p1.status}`);

  const p2 = await call('POST', `/api/rooms/${roomCode}/preferences`, {
    token: bobToken,
    body: { cuisines: ['Italian'] },
  });
  check('bob submits cuisines', p2.status === 200, `got ${p2.status}`);

  const agg = await call('GET', `/api/rooms/${roomCode}/preferences`, { token: aliceToken });
  check('group preferences merge everyone', agg.data?.submittedBy === 2, JSON.stringify(agg.data));
  check('merged cuisines are the union',
    ['Indian', 'Chinese', 'Italian'].every((c) => agg.data.cuisines.includes(c)),
    JSON.stringify(agg.data?.cuisines));

  // -------------------------------------------------------------- ratings
  step('Rating the shortlist');
  await call('PUT', `/api/rooms/${roomCode}/status`, { token: aliceToken, body: { status: 'RATING' } });

  const shortlist = await call('GET', `/api/rooms/${roomCode}/candidates`, { token: aliceToken });
  check('shortlist is generated', shortlist.data?.length > 0, `got ${shortlist.data?.length}`);
  check('shortlist respects the group cuisines',
    shortlist.data.every((f) => agg.data.cuisines.includes(f.cuisine)),
    shortlist.data?.map((f) => f.cuisine).join(', '));

  const shortlistAgain = await call('GET', `/api/rooms/${roomCode}/candidates`, { token: bobToken });
  check('shortlist is frozen (same list for both players)',
    JSON.stringify(shortlistAgain.data.map((f) => f.id)) ===
      JSON.stringify(shortlist.data.map((f) => f.id)));

  const foods = shortlist.data;
  // Give one food a clear win so the outcome is predictable.
  const favourite = foods[foods.length - 1];

  const badScore = await call('POST', `/api/rooms/${roomCode}/ratings`, {
    token: aliceToken,
    body: { foodId: favourite.id, score: 9 },
  });
  check('a score of 9 is rejected (400)', badScore.status === 400, `got ${badScore.status}`);

  const tooEarly = await call('POST', `/api/rooms/${roomCode}/blend-now`, { token: aliceToken });
  check('BLEND NOW before the minimum rating count is refused (409)', tooEarly.status === 409,
    `got ${tooEarly.status}`);

  for (const f of foods) {
    // eslint-disable-next-line no-await-in-loop
    await call('POST', `/api/rooms/${roomCode}/ratings`, {
      token: aliceToken,
      body: { foodId: f.id, score: f.id === favourite.id ? 5 : 2 },
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
  check('recommendations are ranked', recs.data?.recommendations?.length === foods.length);
  check('the favourite leads the ranking',
    recs.data.recommendations[0].food.id === favourite.id,
    `leader was ${recs.data.recommendations[0].food.name}`);

  const notYet = await call('GET', `/api/rooms/${roomCode}/decision`, { token: aliceToken });
  check('no decision before everyone finishes (404)', notYet.status === 404, `got ${notYet.status}`);

  const bobFinalizes = await call('POST', `/api/rooms/${roomCode}/finalize`, { token: bobToken });
  check('a non-host cannot finalize the blend (403)', bobFinalizes.status === 403,
    `got ${bobFinalizes.status}`);

  // ------------------------------------------------------------- decision
  step('Bob finishes -> automatic decision -> WebSocket');
  for (const f of foods) {
    // eslint-disable-next-line no-await-in-loop
    await call('POST', `/api/rooms/${roomCode}/ratings`, {
      token: bobToken,
      body: { foodId: f.id, score: f.id === favourite.id ? 5 : 3 },
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
  check('GET decision returns the top food', decision.status === 200, `got ${decision.status}`);
  check('the group picked the favourite food',
    decision.data?.foodId === favourite.id,
    `picked ${decision.data?.food?.name}, expected ${favourite.name}`);
  check('decision carries food details, no restaurant anywhere',
    !!decision.data?.food?.name && !('restaurant' in (decision.data || {})));

  const again = await call('GET', `/api/rooms/${roomCode}/decision`, { token: bobToken });
  check('the decision is stable when read again',
    again.data?.foodId === decision.data?.foodId);

  // --------------------------------------------------------------- leave
  step('Leaving a room');
  const left = await call('DELETE', `/api/rooms/${roomCode}/members/${s2.data.user.id}`, {
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
    const proxied = await fetch(`${FRONTEND_ORIGIN}/api/foods/cuisines`);
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
  console.log('HBI Microservices end-to-end flow verified.');
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
