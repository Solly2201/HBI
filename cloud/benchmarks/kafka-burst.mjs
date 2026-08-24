/**
 * Fires a burst of ratings through the REST API and measures how fast the
 * pipeline absorbs them.
 *
 * Two numbers come out of this:
 *   ingest    - how quickly the API accepts ratings (and therefore publishes
 *               RATING_SUBMITTED); the write path the user waits on.
 *   drain     - how long the consumer then takes to catch up, measured by
 *               polling the consumer group's lag until it reaches zero.
 */

import { execSync } from 'node:child_process';
import { call, makeUser, sleep, stats } from './lib.mjs';

const BURST = Number(process.argv[2] || 300);
const GROUP = 'hbi-rating-service';
const CONCURRENCY = 20;

function lag() {
  try {
    const out = execSync(
      'docker compose exec -T kafka /opt/kafka/bin/kafka-consumer-groups.sh '
      + `--bootstrap-server kafka:9092 --describe --group ${GROUP}`,
      { cwd: 'C:/Users/Solly/Downloads/HBI-Cloud/cloud', encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, MSYS_NO_PATHCONV: '1' } }
    );
    let total = 0;
    let found = false;
    out.split('\n').forEach((line) => {
      const cols = line.trim().split(/\s+/);
      if (cols.length >= 6 && (cols[1] === 'hbi.ratings' || cols[1] === 'hbi.room-events')) {
        const v = Number(cols[5]);
        if (!Number.isNaN(v)) { total += v; found = true; }
      }
    });
    return found ? total : null;
  } catch {
    return null;
  }
}

const S = Date.now();
console.log(`preparing a room and ${BURST} ratings...`);

const host = await makeUser(`kb_h_${S}`);
const guest = await makeUser(`kb_g_${S}`);
const room = (await call('POST', '/api/rooms', { token: host.token })).data.code;
await call('POST', `/api/rooms/${room}/join`, { token: guest.token });
await call('PUT', `/api/rooms/${room}/status`, { token: host.token, body: { status: 'PREFERENCES' } });
for (const u of [host, guest]) {
  await call('POST', `/api/rooms/${room}/preferences`, {
    token: u.token, body: { cuisines: ['Indian', 'Chinese', 'Italian'] },
  });
}
await call('PUT', `/api/rooms/${room}/status`, { token: host.token, body: { status: 'RATING' } });
const shortlist = (await call('GET', `/api/rooms/${room}/candidates`, { token: host.token })).data;
console.log(`  room ${room}, shortlist ${shortlist.length}`);

const lagBefore = lag();
console.log(`  consumer lag before burst: ${lagBefore}`);
await sleep(500);

// ------------------------------------------------------------------- ingest
const perRequest = [];
let accepted = 0;
let rejected = 0;

const jobs = Array.from({ length: BURST }, (_, i) => i);
const t0 = Date.now();

async function worker() {
  for (;;) {
    const i = jobs.shift();
    if (i === undefined) return;
    const r = shortlist[i % shortlist.length];
    const token = i % 2 === 0 ? host.token : guest.token;
    const started = Date.now();
    // eslint-disable-next-line no-await-in-loop
    const res = await call('POST', `/api/rooms/${room}/ratings`, {
      token, body: { foodId: r.id, score: (i % 5) + 1 },
    });
    perRequest.push(Date.now() - started);
    if (res.status === 200) accepted += 1; else rejected += 1;
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const ingestMs = Date.now() - t0;

console.log('');
console.log('--- INGEST (REST accept + Kafka publish) ---');
console.log(`  events published        : ${accepted} (rejected ${rejected})`);
console.log(`  wall clock              : ${ingestMs} ms`);
console.log(`  producer throughput     : ${(accepted / (ingestMs / 1000)).toFixed(1)} events/sec`);
console.log(`  concurrency             : ${CONCURRENCY} in-flight requests`);
const st = stats(perRequest);
console.log(`  per-request latency ms  : min=${st.min} avg=${st.avg} med=${st.median} p95=${st.p95} max=${st.max}`);

// -------------------------------------------------------------------- drain
console.log('');
console.log('--- CONSUMER DRAIN (lag polled until zero) ---');
const drainStart = Date.now();
let peakLag = 0;
let finalLag = null;
const trace = [];
for (let i = 0; i < 120; i += 1) {
  const l = lag();
  if (l !== null) {
    peakLag = Math.max(peakLag, l);
    trace.push({ t: Date.now() - drainStart, lag: l });
    finalLag = l;
    if (l === 0 && i > 0) break;
  }
  await sleep(250);
}
const drainMs = Date.now() - drainStart;

console.log(`  peak observed lag       : ${peakLag}`);
console.log(`  final lag               : ${finalLag}`);
console.log(`  time to reach zero lag  : ${drainMs} ms (measured after ingest finished)`);
if (accepted > 0) {
  console.log(`  effective consumer rate : ${(accepted / ((ingestMs + drainMs) / 1000)).toFixed(1)} events/sec`);
}
console.log(`  lag trace (ms:lag)      : ${trace.slice(0, 12).map((p) => `${p.t}:${p.lag}`).join('  ')}`);

console.log('');
console.log(JSON.stringify({
  burst: BURST,
  accepted,
  rejected,
  ingestMs,
  producerEventsPerSec: Number((accepted / (ingestMs / 1000)).toFixed(1)),
  requestLatencyMs: st,
  peakLag,
  finalLag,
  drainMs,
}, null, 2));
