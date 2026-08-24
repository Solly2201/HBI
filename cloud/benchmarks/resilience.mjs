/**
 * Section 9 - controlled failure testing.
 *
 *   node --experimental-websocket benchmarks/resilience.mjs
 *
 * Stops one dependency at a time, records exactly what breaks and what keeps
 * working, then brings it back and times the recovery. Nothing is repaired or
 * hardened here - the point is to document the behaviour as it stands.
 */

import { execSync } from 'node:child_process';
import { call, makeUser, subscribeRoom, sleep } from './lib.mjs';

const CWD = 'C:/Users/Solly/Downloads/HBI-Cloud/cloud';
const sh = (cmd, quiet = true) => {
  try {
    return execSync(cmd, {
      cwd: CWD, encoding: 'utf8',
      stdio: ['pipe', 'pipe', quiet ? 'ignore' : 'inherit'],
      env: { ...process.env, MSYS_NO_PATHCONV: '1' },
    }).trim();
  } catch (e) {
    return `ERR:${e.message}`;
  }
};

const report = [];

/** The probe set: one representative call per service, plus the frontend. */
async function probe(ctx) {
  const out = {};
  out['GET /api/restaurants'] = (await call('GET', '/api/restaurants')).status;
  out['POST /api/users/login'] = (await call('POST', '/api/users/login',
    { body: { email: ctx.user.email, password: 'blend123' } })).status;
  out['POST /api/rooms'] = (await call('POST', '/api/rooms', { token: ctx.user.token })).status;
  out[`GET /api/rooms/{code}`] = (await call('GET', `/api/rooms/${ctx.room}`, { token: ctx.user.token })).status;
  out['GET /api/rooms/{code}/candidates'] = (await call('GET', `/api/rooms/${ctx.room}/candidates`,
    { token: ctx.user.token })).status;
  out['POST /api/rooms/{code}/ratings'] = (await call('POST', `/api/rooms/${ctx.room}/ratings`,
    { token: ctx.user.token, body: { restaurantId: ctx.restaurantId, score: 4 } })).status;
  out['GET /api/rooms/{code}/recommendations'] = (await call('GET', `/api/rooms/${ctx.room}/recommendations`,
    { token: ctx.user.token })).status;
  try {
    out['frontend /'] = (await fetch('http://localhost:5173/')).status;
  } catch { out['frontend /'] = 'ERR'; }
  return out;
}

function diff(before, during) {
  const changed = [];
  const same = [];
  Object.keys(before).forEach((k) => {
    if (String(before[k]) !== String(during[k])) changed.push(`${k}: ${before[k]} -> ${during[k]}`);
    else same.push(`${k}: ${during[k]}`);
  });
  return { changed, same };
}

async function waitHealthy(service, timeoutMs = 180000) {
  const t0 = Date.now();
  for (;;) {
    const s = sh(`docker compose ps --format "{{.Service}} {{.Status}}" ${service}`);
    if (/healthy/.test(s)) return Date.now() - t0;
    if (Date.now() - t0 > timeoutMs) return -1;
    // eslint-disable-next-line no-await-in-loop
    await sleep(1000);
  }
}

/** Time until the probe set returns to its pre-failure shape. */
async function waitFunctional(ctx, baseline, timeoutMs = 180000) {
  const t0 = Date.now();
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const p = await probe(ctx);
    const d = diff(baseline, p);
    if (d.changed.length === 0) return Date.now() - t0;
    if (Date.now() - t0 > timeoutMs) return -1;
    // eslint-disable-next-line no-await-in-loop
    await sleep(2000);
  }
}

// -------------------------------------------------------------- fresh context

async function freshContext(tag) {
  const user = await makeUser(`res_${tag}_${Date.now()}`);
  const room = (await call('POST', '/api/rooms', { token: user.token })).data.code;
  await call('PUT', `/api/rooms/${room}/status`, { token: user.token, body: { status: 'PREFERENCES' } });
  await call('POST', `/api/rooms/${room}/preferences`, {
    token: user.token, body: { cuisines: ['Indian', 'Chinese', 'Italian'], maxBudget: 900, maxDistanceKm: 9 },
  });
  await call('PUT', `/api/rooms/${room}/status`, { token: user.token, body: { status: 'RATING' } });
  const shortlist = (await call('GET', `/api/rooms/${room}/candidates`, { token: user.token })).data;
  return { user, room, restaurantId: shortlist?.[0]?.id ?? 1, shortlist };
}

async function scenario(name, service, extra) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`SCENARIO: stop ${service}`);
  console.log('='.repeat(70));

  const ctx = await freshContext(name);
  const before = await probe(ctx);
  console.log('before:', JSON.stringify(before));

  sh(`docker compose stop ${service}`);
  await sleep(3000);

  const during = await probe(ctx);
  const d = diff(before, during);
  console.log('during outage:', JSON.stringify(during));
  console.log('  BROKE     :', d.changed.length ? d.changed.join(' | ') : '(nothing)');
  console.log('  UNAFFECTED:', d.same.join(' | '));

  let extraNotes = [];
  if (extra) extraNotes = await extra(ctx, before);

  const t0 = Date.now();
  sh(`docker compose start ${service}`);
  const healthMs = await waitHealthy(service);
  const funcMs = await waitFunctional(ctx, before);
  const totalMs = Date.now() - t0;

  console.log(`  recovery: container healthy in ${healthMs} ms, `
    + `full function restored ${funcMs >= 0 ? `in ${funcMs} ms` : 'NOT restored within timeout'}`);
  console.log(`  total wall clock from start command to functional: ${totalMs} ms`);

  report.push({
    scenario: `stop ${service}`,
    broke: d.changed,
    unaffected: d.same,
    healthyMs: healthMs,
    functionalMs: funcMs,
    totalRecoveryMs: totalMs,
    notes: extraNotes,
  });
}

// =========================================================================

console.log('HBI Cloud resilience testing');
console.log('Docker restart policy in use:', sh('docker inspect -f "{{.HostConfig.RestartPolicy.Name}}" $(docker compose ps -q rating-service)') || 'none');

// ---- 1. restaurant-service
await scenario('resto', 'restaurant-service', async (ctx) => {
  const notes = [];
  const cands = await call('GET', `/api/rooms/${ctx.room}/candidates`, { token: ctx.user.token });
  notes.push(`candidates during outage: HTTP ${cands.status}, ${Array.isArray(cands.data) ? cands.data.length : '?'} items`);
  const recs = await call('GET', `/api/rooms/${ctx.room}/recommendations`, { token: ctx.user.token });
  notes.push(`recommendations during outage: HTTP ${recs.status}, ${recs.data?.recommendations?.length ?? '?'} items`);
  notes.forEach((n) => console.log(`  NOTE: ${n}`));
  return notes;
});

// ---- 2. room-service
await scenario('room', 'room-service', async (ctx) => {
  const notes = [];
  const r = await call('GET', `/api/rooms/${ctx.room}/ratings`, { token: ctx.user.token });
  notes.push(`ratings progress during outage: HTTP ${r.status}, progress=${JSON.stringify(r.data?.progress)}`);
  notes.forEach((n) => console.log(`  NOTE: ${n}`));
  return notes;
});

// ---- 3. rating-service
await scenario('rating', 'rating-service', async (ctx) => {
  const notes = [];
  const ws = await subscribeRoom(ctx.user.token, ctx.room, () => {}, { timeoutMs: 8000 });
  notes.push(`WebSocket connect during outage: ${ws.connected ? 'CONNECTED' : 'refused'}`);
  try { await ws.close(); } catch { /* nothing to close */ }
  notes.forEach((n) => console.log(`  NOTE: ${n}`));
  return notes;
});

// ---- 4. Kafka
console.log(`\n${'='.repeat(70)}`);
console.log('SCENARIO: stop kafka');
console.log('='.repeat(70));
{
  const ctx = await freshContext('kafka');
  const before = await probe(ctx);
  console.log('before:', JSON.stringify(before));

  const wsEvents = [];
  const ws = await subscribeRoom(ctx.user.token, ctx.room, (e) => wsEvents.push(e));
  console.log(`  WebSocket connected before outage: ${ws.connected}`);

  sh('docker compose stop kafka');
  await sleep(5000);

  const during = await probe(ctx);
  const d = diff(before, during);
  console.log('during outage:', JSON.stringify(during));
  console.log('  BROKE     :', d.changed.length ? d.changed.join(' | ') : '(nothing)');
  console.log('  UNAFFECTED:', d.same.join(' | '));

  // Submit ratings while the broker is down; do the events survive?
  wsEvents.length = 0;
  const submitted = [];
  for (let i = 0; i < 3; i += 1) {
    const rid = ctx.shortlist[i % ctx.shortlist.length].id;
    // eslint-disable-next-line no-await-in-loop
    const res = await call('POST', `/api/rooms/${ctx.room}/ratings`, {
      token: ctx.user.token, body: { restaurantId: rid, score: 5 },
    });
    submitted.push(res.status);
  }
  console.log(`  NOTE: ratings POSTed during Kafka outage returned ${JSON.stringify(submitted)}`);
  await sleep(6000);
  console.log(`  NOTE: WebSocket events received during Kafka outage: ${wsEvents.length} `
    + `(${[...new Set(wsEvents.map((e) => e.type))].join(',') || 'none'})`);

  const persisted = await call('GET', `/api/rooms/${ctx.room}/ratings`, { token: ctx.user.token });
  console.log(`  NOTE: ratings persisted in rating_db despite outage: ${persisted.data?.ratings?.length}`);

  const t0 = Date.now();
  sh('docker compose start kafka');
  const healthMs = await waitHealthy('kafka');
  await sleep(5000);

  wsEvents.length = 0;
  const afterRating = await call('POST', `/api/rooms/${ctx.room}/ratings`, {
    token: ctx.user.token, body: { restaurantId: ctx.shortlist[0].id, score: 3 },
  });
  let recovered = false;
  for (let i = 0; i < 40; i += 1) {
    if (wsEvents.some((e) => e.type === 'RATING_SUBMITTED')) { recovered = true; break; }
    // eslint-disable-next-line no-await-in-loop
    await sleep(500);
  }
  const totalMs = Date.now() - t0;
  console.log(`  recovery: kafka healthy in ${healthMs} ms; `
    + `real-time pipeline ${recovered ? 'RECOVERED' : 'DID NOT recover'} (post-recovery rating HTTP ${afterRating.status})`);
  console.log(`  total wall clock: ${totalMs} ms`);

  const replayed = wsEvents.filter((e) => e.type === 'RATING_SUBMITTED').length;
  console.log(`  NOTE: RATING_SUBMITTED frames seen after recovery: ${replayed} `
    + `(3 were submitted during the outage; anything less than 4 means those were lost)`);

  try { await ws.close(); } catch { /* nothing */ }

  report.push({
    scenario: 'stop kafka',
    broke: d.changed,
    unaffected: d.same,
    healthyMs: healthMs,
    functionalMs: recovered ? totalMs : -1,
    totalRecoveryMs: totalMs,
    notes: [
      `ratings POSTed during outage: ${JSON.stringify(submitted)}`,
      `ws events during outage: ${wsEvents.length}`,
      `events lost during outage: ${3 - Math.max(0, replayed - 1)} of 3`,
      `real-time recovered: ${recovered}`,
    ],
  });
}

// ---- 5. restart a PostgreSQL instance
console.log(`\n${'='.repeat(70)}`);
console.log('SCENARIO: restart rating-db (PostgreSQL)');
console.log('='.repeat(70));
{
  const ctx = await freshContext('pg');
  const before = await probe(ctx);
  console.log('before:', JSON.stringify(before));

  sh('docker compose stop rating-db');
  await sleep(3000);
  const during = await probe(ctx);
  const d = diff(before, during);
  console.log('during outage:', JSON.stringify(during));
  console.log('  BROKE     :', d.changed.length ? d.changed.join(' | ') : '(nothing)');
  console.log('  UNAFFECTED:', d.same.join(' | '));

  const t0 = Date.now();
  sh('docker compose start rating-db');
  const healthMs = await waitHealthy('rating-db');
  const funcMs = await waitFunctional(ctx, before);
  const totalMs = Date.now() - t0;
  const svcState = sh('docker compose ps --format "{{.Service}} {{.Status}}" rating-service');
  console.log(`  recovery: rating-db healthy in ${healthMs} ms, function restored `
    + `${funcMs >= 0 ? `in ${funcMs} ms` : 'NOT within timeout'}`);
  console.log(`  rating-service did NOT need a restart: ${svcState}`);
  console.log(`  total wall clock: ${totalMs} ms`);

  report.push({
    scenario: 'restart rating-db',
    broke: d.changed,
    unaffected: d.same,
    healthyMs: healthMs,
    functionalMs: funcMs,
    totalRecoveryMs: totalMs,
    notes: [`rating-service state after db recovery: ${svcState}`],
  });
}

// ---- 6. plain restart of a healthy service
console.log(`\n${'='.repeat(70)}`);
console.log('SCENARIO: docker compose restart rating-service');
console.log('='.repeat(70));
{
  const ctx = await freshContext('restart');
  const before = await probe(ctx);
  const t0 = Date.now();
  sh('docker compose restart rating-service');
  const healthMs = await waitHealthy('rating-service');
  const funcMs = await waitFunctional(ctx, before);
  console.log(`  healthy again in ${healthMs} ms, functional in ${funcMs} ms`);
  const data = await call('GET', `/api/rooms/${ctx.room}/ratings`, { token: ctx.user.token });
  console.log(`  data survived the restart: ${data.data?.ratings?.length} ratings still present`);
  report.push({
    scenario: 'restart rating-service',
    broke: [], unaffected: [],
    healthyMs: healthMs, functionalMs: funcMs, totalRecoveryMs: Date.now() - t0,
    notes: [`ratings preserved: ${data.data?.ratings?.length}`],
  });
}

// ---- restart counts
console.log(`\n${'='.repeat(70)}`);
console.log('CONTAINER RESTART COUNTS');
console.log('='.repeat(70));
sh('docker compose ps --format "{{.Service}}"').split('\n').filter(Boolean).forEach((s) => {
  const id = sh(`docker compose ps -q ${s}`);
  if (id && !id.startsWith('ERR')) {
    console.log(`  ${s.padEnd(22)} restarts=${sh(`docker inspect -f "{{.RestartCount}}" ${id}`)}`);
  }
});

console.log('\nJSON');
console.log(JSON.stringify(report, null, 2));
