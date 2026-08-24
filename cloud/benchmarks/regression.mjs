/**
 * Regression tests for the hardening pass (BUG-1..BUG-6).
 *
 *   node --experimental-websocket benchmarks/regression.mjs
 *
 * Every wait is bounded; the script cannot hang. Exit code = number of
 * failed assertions.
 */

import {
  call, makeUser, subscribeRoom, waitFor, sleep, harness,
} from './lib.mjs';

const h = harness();
const S = Date.now();

// A global watchdog so nothing can hold the process open past 5 minutes.
const watchdog = setTimeout(() => {
  console.error('\nWATCHDOG: regression suite exceeded 5 minutes, aborting.');
  process.exit(99);
}, 300_000);

/** Drives a fresh two-user room to the RATING stage; returns the cast. */
async function roomAtRating(tag) {
  const alice = await makeUser(`rg_${tag}_a_${S}`);
  const bob = await makeUser(`rg_${tag}_b_${S}`);
  const room = (await call('POST', '/api/rooms', { token: alice.token })).data.code;
  await call('POST', `/api/rooms/${room}/join`, { token: bob.token });
  await call('PUT', `/api/rooms/${room}/status`, { token: alice.token, body: { status: 'PREFERENCES' } });
  const prefs = { cuisines: [], maxBudget: 2000, maxDistanceKm: 20 };
  await call('POST', `/api/rooms/${room}/preferences`, { token: alice.token, body: prefs });
  await call('POST', `/api/rooms/${room}/preferences`, { token: bob.token, body: prefs });
  await call('PUT', `/api/rooms/${room}/status`, { token: alice.token, body: { status: 'RATING' } });
  const candidates = (await call('GET', `/api/rooms/${room}/candidates`, { token: alice.token })).data;
  return { alice, bob, room, candidates };
}

// ================================================== BUG-1: rating validation

h.section('BUG-1 - ratings validated against the frozen shortlist');

{
  const { alice, bob, room, candidates } = await roomAtRating('b1');
  h.check('shortlist frozen', Array.isArray(candidates) && candidates.length > 0,
    `got ${candidates?.length}`);

  const valid = await call('POST', `/api/rooms/${room}/ratings`, {
    token: alice.token, body: { restaurantId: candidates[0].id, score: 5 },
  });
  h.check('valid candidate rating accepted (200)', valid.status === 200, `got ${valid.status}`);

  const ghost = await call('POST', `/api/rooms/${room}/ratings`, {
    token: alice.token, body: { restaurantId: 999999, score: 3 },
  });
  h.check('non-existent restaurant rejected (422)', ghost.status === 422, `got ${ghost.status}`);

  const real = await call('GET', '/api/restaurants', { token: alice.token });
  const offList = real.data.map((r) => r.id).find((id) => !candidates.some((c) => c.id === id));
  if (offList) {
    const off = await call('POST', `/api/rooms/${room}/ratings`, {
      token: alice.token, body: { restaurantId: offList, score: 3 },
    });
    h.check('real restaurant NOT on the shortlist rejected (422)', off.status === 422,
      `got ${off.status}`);
  }

  // Alice finishes the shortlist properly.
  for (const c of candidates) {
    await call('POST', `/api/rooms/${room}/ratings`, {
      token: alice.token, body: { restaurantId: c.id, score: 4 },
    });
  }

  // Bob only ever *attempts* bogus ids - every one rejected.
  for (let i = 0; i < candidates.length; i += 1) {
    await call('POST', `/api/rooms/${room}/ratings`, {
      token: bob.token, body: { restaurantId: 900000 + i, score: 5 },
    });
  }

  const prog = await call('GET', `/api/rooms/${room}/ratings`, { token: alice.token });
  h.check('only the real rater counts as finished', prog.data?.progress?.membersFinished === 1,
    `got ${prog.data?.progress?.membersFinished}`);
  h.check('bogus attempts stored zero ratings for Bob',
    !prog.data?.ratings?.some((r) => r.userId === bob.id),
    JSON.stringify(prog.data?.ratings?.filter((r) => r.userId === bob.id)));

  await sleep(1500); // give the consumer time to (incorrectly) finalise
  const decision = await call('GET', `/api/rooms/${room}/decision`, { token: alice.token });
  h.check('bogus ratings do NOT trigger auto-finalisation (404)', decision.status === 404,
    `got ${decision.status}`);
}

// ============================== BUG-2: DECIDED rooms reject new players

h.section('BUG-2 - a finished room refuses new joins');

{
  const { alice, bob, room, candidates } = await roomAtRating('b2');

  const carol = await makeUser(`rg_b2_c_${S}`);
  const before = await call('POST', `/api/rooms/${room}/join`, { token: carol.token });
  h.check('joining before the decision is allowed (200)', before.status === 200,
    `got ${before.status}`);
  // That third player never rates, so remove them to let the room finish.
  await call('DELETE', `/api/rooms/${room}/members/${carol.id}`, { token: alice.token });

  for (const c of candidates) {
    await call('POST', `/api/rooms/${room}/ratings`, { token: alice.token, body: { restaurantId: c.id, score: 4 } });
    await call('POST', `/api/rooms/${room}/ratings`, { token: bob.token, body: { restaurantId: c.id, score: 3 } });
  }

  const decided = await waitFor(async () => (await call('GET', `/api/rooms/${room}/decision`,
    { token: alice.token })).status === 200, { attempts: 40, delay: 250 });
  h.check('room auto-finalises once everyone finished', decided);

  const statusDecided = await waitFor(async () => (await call('GET', `/api/rooms/${room}`,
    { token: alice.token })).data?.status === 'DECIDED', { attempts: 40, delay: 250 });
  h.check('room status becomes DECIDED server-side (via Kafka)', statusDecided);

  const late = await call('POST', `/api/rooms/${room}/join`,
    { token: (await makeUser(`rg_b2_d_${S}`)).token });
  h.check('joining a DECIDED room refused (409)', late.status === 409, `got ${late.status}`);
}

// ==================== BUG-4: concurrent duplicate ratings stay consistent

h.section('BUG-4 - concurrent duplicate ratings');

{
  const { alice, room, candidates } = await roomAtRating('b4');
  const target = candidates[0].id;

  const burst = await Promise.all(Array.from({ length: 10 }, () => call(
    'POST', `/api/rooms/${room}/ratings`,
    { token: alice.token, body: { restaurantId: target, score: 4 }, attempts: 1 },
  )));
  const statuses = burst.map((r) => r.status);
  h.check('10 concurrent identical ratings all succeed (200)',
    statuses.every((s) => s === 200), `got ${JSON.stringify(statuses)}`);

  const after = await call('GET', `/api/rooms/${room}/ratings`, { token: alice.token });
  const rows = after.data?.ratings?.filter((r) => r.userId === alice.id && r.restaurantId === target);
  h.check('exactly one stored row for the (user, restaurant)', rows?.length === 1,
    `got ${rows?.length}`);
  h.check('stored score is correct', rows?.[0]?.score === 4, `got ${rows?.[0]?.score}`);

  const overwrite = await call('POST', `/api/rooms/${room}/ratings`, {
    token: alice.token, body: { restaurantId: target, score: 2 },
  });
  h.check('sequential duplicate still overwrites', overwrite.status === 200
    && (await call('GET', `/api/rooms/${room}/ratings`, { token: alice.token }))
      .data.ratings.find((r) => r.userId === alice.id && r.restaurantId === target)?.score === 2);
}

// ============================ Kafka: valid events flow end-to-end over WS

h.section('Kafka + WebSocket - valid events still flow after the hardening');

{
  const { alice, bob, room, candidates } = await roomAtRating('kf');
  const events = [];
  const sock = await subscribeRoom(bob.token, room, (e) => events.push(e));
  h.check('subscriber connected', sock.connected);

  await call('POST', `/api/rooms/${room}/ratings`, {
    token: alice.token, body: { restaurantId: candidates[0].id, score: 5 },
  });
  h.check('RATING_SUBMITTED reaches the other user via Kafka->STOMP',
    await waitFor(() => events.some((e) => e.type === 'RATING_SUBMITTED'), { attempts: 80 }));
  h.check('RECOMMENDATIONS_GENERATED reaches the other user',
    await waitFor(() => events.some((e) => e.type === 'RECOMMENDATIONS_GENERATED'), { attempts: 80 }));

  for (const c of candidates) {
    await call('POST', `/api/rooms/${room}/ratings`, { token: alice.token, body: { restaurantId: c.id, score: 4 } });
    await call('POST', `/api/rooms/${room}/ratings`, { token: bob.token, body: { restaurantId: c.id, score: 3 } });
  }
  h.check('DECISION_FINALIZED reaches the subscriber',
    await waitFor(() => events.some((e) => e.type === 'DECISION_FINALIZED'), { attempts: 80 }));
  await sock.close();
}

const failures = h.summary();
clearTimeout(watchdog);
process.exit(failures);
