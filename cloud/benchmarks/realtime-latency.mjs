/**
 * Section 4 - end-to-end real-time propagation latency.
 *
 *   node --experimental-websocket benchmarks/realtime-latency.mjs [iterations]
 *
 * User A acts over REST; User B is subscribed over WebSocket. We measure the
 * wall-clock gap between A's action and B's frame arriving, which is the whole
 * path the brief cares about:
 *
 *   REST -> service -> Kafka -> consumer -> STOMP -> other browser
 *
 * Both clients run in this process, so the two timestamps come off the same
 * clock and no skew is involved. The trade-off is that the figure includes this
 * process's own event-loop scheduling, which is why the server-side Kafka
 * component is also reported separately using the occurredAt stamp the producer
 * writes into the event.
 *
 * Every wait in here is bounded. An iteration that exceeds its deadline is
 * abandoned and counted, and a global watchdog prints whatever has been
 * collected and exits rather than hanging.
 */

import {
  call, makeUser, subscribeRoom, sleep, stats, transport, withDeadline,
} from './lib.mjs';

const ITER = Number(process.argv[2] || 30);
const EVENT_TIMEOUT_MS = Number(process.env.EVENT_TIMEOUT_MS || 20000);
const ITERATION_DEADLINE_MS = Number(process.env.ITERATION_DEADLINE_MS || 90000);
const GLOBAL_DEADLINE_MS = Number(process.env.GLOBAL_DEADLINE_MS || 15 * 60 * 1000);

const samples = {
  USER_JOINED: [],
  RATING_SUBMITTED: [],
  RECOMMENDATIONS_GENERATED: [],
  DECISION_FINALIZED: [],
};
// Producer-stamped -> observer-received, for events that carry occurredAt.
const kafkaLeg = { USER_JOINED: [], RATING_SUBMITTED: [] };
const timeouts = {
  USER_JOINED: 0, RATING_SUBMITTED: 0, RECOMMENDATIONS_GENERATED: 0, DECISION_FINALIZED: 0,
};

let completedIterations = 0;
let abandonedIterations = 0;
const abandonReasons = [];
let printed = false;

// -------------------------------------------------------------------- output

function report(reason) {
  if (printed) return;
  printed = true;

  console.log('\n');
  if (reason) console.log(`!! ${reason}\n`);
  console.log(`iterations completed: ${completedIterations}/${ITER}  abandoned: ${abandonedIterations}`);
  if (abandonReasons.length) {
    console.log(`abandon reasons: ${[...new Set(abandonReasons)].slice(0, 5).join(' | ')}`);
  }

  console.log('\nEND-TO-END (REST call issued -> other client receives the frame), ms');
  console.log('event                        n    min    avg    med    p95    max  timeouts');
  for (const [k, v] of Object.entries(samples)) {
    const s = stats(v);
    if (!s) {
      console.log(`${k.padEnd(28)}  no samples${String(timeouts[k]).padStart(28)}`);
      continue;
    }
    console.log(
      `${k.padEnd(28)}${String(s.n).padStart(3)}${String(s.min).padStart(7)}`
      + `${String(s.avg).padStart(7)}${String(s.median).padStart(7)}`
      + `${String(s.p95).padStart(7)}${String(s.max).padStart(7)}`
      + `${String(timeouts[k]).padStart(10)}`
    );
  }

  console.log('\nPRODUCER-STAMPED LEG (event occurredAt -> frame received), ms');
  console.log('  Kafka publish + consume + STOMP fan-out, excluding the inbound HTTP call');
  console.log('event                        n    min    avg    med    p95    max');
  for (const [k, v] of Object.entries(kafkaLeg)) {
    const s = stats(v);
    if (!s) continue;
    console.log(
      `${k.padEnd(28)}${String(s.n).padStart(3)}${String(s.min).padStart(7)}`
      + `${String(s.avg).padStart(7)}${String(s.median).padStart(7)}`
      + `${String(s.p95).padStart(7)}${String(s.max).padStart(7)}`
    );
  }

  console.log(`\ntransport: retries=${transport.retries} timeouts=${transport.timeouts} `
    + `hard-failures=${transport.failures}`);

  console.log('\nJSON');
  console.log(JSON.stringify({
    iterations: ITER,
    completedIterations,
    abandonedIterations,
    transport,
    endToEnd: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, stats(v)])),
    producerStampedLeg: Object.fromEntries(Object.entries(kafkaLeg).map(([k, v]) => [k, stats(v)])),
    eventTimeouts: timeouts,
  }, null, 2));
}

// A hard ceiling on the whole script: print what we have, then leave.
const watchdog = setTimeout(() => {
  report(`GLOBAL DEADLINE of ${GLOBAL_DEADLINE_MS} ms reached - reporting partial results`);
  process.exit(2);
}, GLOBAL_DEADLINE_MS);

process.on('SIGINT', () => { report('interrupted'); process.exit(130); });

/** Resolves with the first matching event, or null once the timeout expires. */
function expect(bucket, type, match, timeoutMs = EVENT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      const hit = bucket.find((e) => e.type === type && (!match || match(e)));
      if (hit) {
        clearInterval(tick);
        resolve(hit);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(tick);
        resolve(null);
      }
    }, 2);
  });
}

// ------------------------------------------------------------------ one pass

async function runIteration(i, host) {
  const roomRes = await call('POST', '/api/rooms', { token: host.token });
  if (roomRes.status !== 201) throw new Error(`room create HTTP ${roomRes.status}`);
  const room = roomRes.data.code;

  const seen = [];
  const observer = await subscribeRoom(host.token, room, (e) => seen.push(e), { timeoutMs: 15000 });
  if (!observer.connected) throw new Error('observer failed to connect');

  try {
    // ------------------------------------------------ USER_JOINED
    const guest = await makeUser(`rt_g_${Date.now()}_${i}`);
    seen.length = 0;
    let t0 = Date.now();
    await call('POST', `/api/rooms/${room}/join`, { token: guest.token });
    let ev = await expect(seen, 'USER_JOINED', (e) => e.payload?.userId === guest.id);
    if (ev) {
      samples.USER_JOINED.push(ev.receivedAt - t0);
      if (ev.payload?.occurredAt) {
        kafkaLeg.USER_JOINED.push(ev.receivedAt - Date.parse(ev.payload.occurredAt));
      }
    } else {
      timeouts.USER_JOINED += 1;
    }

    // ------------------------------------------------ drive to RATING
    await call('PUT', `/api/rooms/${room}/status`, { token: host.token, body: { status: 'PREFERENCES' } });
    for (const u of [host, guest]) {
      await call('POST', `/api/rooms/${room}/preferences`, {
        token: u.token, body: { cuisines: ['Indian', 'Chinese'], maxBudget: 900, maxDistanceKm: 9 },
      });
    }
    await call('PUT', `/api/rooms/${room}/status`, { token: host.token, body: { status: 'RATING' } });
    const shortlist = (await call('GET', `/api/rooms/${room}/candidates`, { token: host.token })).data;
    if (!Array.isArray(shortlist) || shortlist.length === 0) throw new Error('empty shortlist');

    // -------------------------- RATING_SUBMITTED + RECOMMENDATIONS
    seen.length = 0;
    t0 = Date.now();
    await call('POST', `/api/rooms/${room}/ratings`, {
      token: host.token, body: { restaurantId: shortlist[0].id, score: 5 },
    });

    ev = await expect(seen, 'RATING_SUBMITTED');
    if (ev) {
      samples.RATING_SUBMITTED.push(ev.receivedAt - t0);
      if (ev.payload?.occurredAt) {
        kafkaLeg.RATING_SUBMITTED.push(ev.receivedAt - Date.parse(ev.payload.occurredAt));
      }
    } else {
      timeouts.RATING_SUBMITTED += 1;
    }

    ev = await expect(seen, 'RECOMMENDATIONS_GENERATED');
    if (ev) samples.RECOMMENDATIONS_GENERATED.push(ev.receivedAt - t0);
    else timeouts.RECOMMENDATIONS_GENERATED += 1;

    // ------------------------------------------------ DECISION_FINALIZED
    for (const r of shortlist) {
      await call('POST', `/api/rooms/${room}/ratings`, {
        token: guest.token, body: { restaurantId: r.id, score: 4 },
      });
    }
    for (let k = 1; k < shortlist.length; k += 1) {
      await call('POST', `/api/rooms/${room}/ratings`, {
        token: host.token, body: { restaurantId: shortlist[k].id, score: 3 },
      });
    }
    seen.length = 0;
    t0 = Date.now();
    // The rating that completes the room and triggers the decision.
    await call('POST', `/api/rooms/${room}/ratings`, {
      token: host.token, body: { restaurantId: shortlist[0].id, score: 5 },
    });
    ev = await expect(seen, 'DECISION_FINALIZED', null, EVENT_TIMEOUT_MS);
    if (ev) samples.DECISION_FINALIZED.push(ev.receivedAt - t0);
    else timeouts.DECISION_FINALIZED += 1;
  } finally {
    await observer.close();
  }
}

// ---------------------------------------------------------------------- main

console.log(`measuring real-time latency over ${ITER} iterations`);
console.log(`  per-request timeout ${process.env.REQUEST_TIMEOUT_MS || 15000} ms, `
  + `per-event ${EVENT_TIMEOUT_MS} ms, per-iteration ${ITERATION_DEADLINE_MS} ms, `
  + `global ${GLOBAL_DEADLINE_MS} ms\n`);

const host = await withDeadline(makeUser(`rt_host_${Date.now()}`), 30000, 'host registration');

for (let i = 0; i < ITER; i += 1) {
  try {
    await withDeadline(runIteration(i, host), ITERATION_DEADLINE_MS, `iteration ${i}`);
    completedIterations += 1;
  } catch (e) {
    abandonedIterations += 1;
    abandonReasons.push(e.message);
    console.log(`\n  iteration ${i} abandoned: ${e.message}`);
  }
  process.stdout.write(`\r  ${i + 1}/${ITER} done=${completedIterations} abandoned=${abandonedIterations}`);
  await sleep(120);
}

clearTimeout(watchdog);
report();
process.exit(0);
