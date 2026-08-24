/**
 * Section 6 - does replicating a service actually work?
 *
 *   node --experimental-websocket benchmarks/scaling-probe.mjs <mode>
 *
 * mode = spread    : how requests are distributed across replicas
 * mode = websocket : whether real-time events survive a replicated rating-service
 *
 * The README claims the in-memory STOMP broker prevents rating-service from
 * scaling horizontally. This measures whether that is true and, if so, what
 * a user actually experiences.
 */

import { execSync } from 'node:child_process';
import { call, makeUser, subscribeRoom, sleep } from './lib.mjs';

const MODE = process.argv[2] || 'spread';
const CWD = new URL('..', import.meta.url);  // the distributed/ directory this probe lives under
const COMPOSE = 'docker compose -f docker-compose.yml -f benchmarks/docker-compose.scale.yml';

function sh(cmd) {
  return execSync(cmd, {
    cwd: CWD, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  }).trim();
}

function replicaIds(service) {
  return sh(`${COMPOSE} ps -q ${service}`).split('\n').filter(Boolean);
}

/** Total HTTP requests each replica has served, read from its own actuator. */
function requestCounts(service, port) {
  return replicaIds(service).map((id) => {
    try {
      const raw = sh(
        `docker exec ${id} wget -qO- http://localhost:${port}/actuator/metrics/http.server.requests`
      );
      const json = JSON.parse(raw);
      const count = json.measurements?.find((m) => m.statistic === 'COUNT')?.value ?? 0;
      return { id: id.slice(0, 12), count: Math.round(count) };
    } catch {
      return { id: id.slice(0, 12), count: null };
    }
  });
}

// ------------------------------------------------------------------- spread

if (MODE === 'spread') {
  const service = process.argv[3] || 'food-service';
  const port = process.argv[4] || '8083';
  const requests = Number(process.argv[5] || 300);

  const before = requestCounts(service, port);
  console.log(`${service}: ${before.length} replica(s)`);
  before.forEach((r) => console.log(`  ${r.id} baseline requests=${r.count}`));

  const t0 = Date.now();
  const batch = 20;
  for (let i = 0; i < requests; i += batch) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(Array.from({ length: batch }, () => call('GET', '/api/foods?cuisine=Indian')));
  }
  const ms = Date.now() - t0;

  const after = requestCounts(service, port);
  console.log(`\nsent ${requests} requests through the gateway in ${ms} ms `
    + `(${(requests / (ms / 1000)).toFixed(1)} req/s)`);
  console.log('per-replica delta:');
  let served = 0;
  after.forEach((r, i) => {
    const d = (r.count ?? 0) - (before[i]?.count ?? 0);
    served += d;
    console.log(`  ${r.id}  +${d}`);
  });
  console.log(`total accounted for: ${served}`);
  const deltas = after.map((r, i) => (r.count ?? 0) - (before[i]?.count ?? 0));
  const active = deltas.filter((d) => d > 0).length;
  console.log(`replicas that served traffic: ${active}/${after.length}`);
  if (after.length > 1 && active === 1) {
    console.log('FINDING: all traffic went to a single replica - the gateway is not spreading load.');
  }
  process.exit(0);
}

// ---------------------------------------------------------------- websocket

if (MODE === 'websocket') {
  const iterations = Number(process.argv[3] || 20);
  const ids = replicaIds('rating-service');
  console.log(`rating-service replicas: ${ids.length}`);
  ids.forEach((id) => console.log(`  ${id.slice(0, 12)}`));

  // Which replica actually owns the Kafka partitions?
  console.log('\nKafka partition ownership:');
  ids.forEach((id) => {
    try {
      const assigned = sh(`docker logs ${id} 2>&1 | grep -c "partitions assigned: \\[hbi"`);
      const owns = sh(`docker logs ${id} 2>&1 | grep "partitions assigned" | tail -2`);
      console.log(`  ${id.slice(0, 12)} assignment-log-lines=${assigned}`);
      owns.split('\n').filter(Boolean).forEach((l) => {
        const m = l.match(/partitions assigned: (\[.*\])/);
        if (m) console.log(`     ${m[1]}`);
      });
    } catch {
      console.log(`  ${id.slice(0, 12)} (could not read logs)`);
    }
  });

  const host = await makeUser(`sc_h_${Date.now()}`);
  let delivered = 0;
  let missed = 0;
  const latencies = [];

  for (let i = 0; i < iterations; i += 1) {
    const room = (await call('POST', '/api/rooms', { token: host.token })).data.code;
    const seen = [];
    const sock = await subscribeRoom(host.token, room, (e) => seen.push(e));
    if (!sock.connected) { console.log(`  iter ${i}: no socket`); continue; }

    const guest = await makeUser(`sc_g_${Date.now()}_${i}`);
    const t0 = Date.now();
    await call('POST', `/api/rooms/${room}/join`, { token: guest.token });

    let got = null;
    for (let w = 0; w < 100; w += 1) {
      got = seen.find((e) => e.type === 'USER_JOINED' && e.payload?.userId === guest.id);
      if (got) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(50);
    }
    if (got) { delivered += 1; latencies.push(got.receivedAt - t0); } else { missed += 1; }
    await sock.close();
    process.stdout.write(`\r  ${i + 1}/${iterations} delivered=${delivered} missed=${missed}`);
  }

  console.log('\n');
  console.log(`USER_JOINED delivered : ${delivered}/${iterations}`);
  console.log(`USER_JOINED missed    : ${missed}/${iterations}`);
  console.log(`delivery rate         : ${((delivered / iterations) * 100).toFixed(1)}%`);
  if (latencies.length) {
    const s = [...latencies].sort((a, b) => a - b);
    console.log(`latency ms            : min=${s[0]} med=${s[Math.floor(s.length / 2)]} max=${s[s.length - 1]}`);
  }
  if (missed > 0) {
    console.log('\nFINDING: events were lost. With more than one rating-service replica a browser');
    console.log('only receives events produced by the replica holding its WebSocket, and only that');
    console.log('replica that also owns the Kafka partition can produce them.');
  }
  process.exit(0);
}

console.log('unknown mode');
process.exit(1);
