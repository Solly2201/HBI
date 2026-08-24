/*
 * HBI Microservices API benchmark.
 *
 *   k6 run -e VUS=50 -e DUR=20s -e OUT=results-50.json benchmarks/k6-endpoints.js
 *
 * Each endpoint gets its own scenario and they run one after another, so a
 * number is never the result of two endpoints competing for the same JVM.
 * Every request goes through the API Gateway, as a browser would.
 */

import http from 'k6/http';
import { Trend, Rate, Counter } from 'k6/metrics';
import { sleep } from 'k6';

const fixture = JSON.parse(open('./load-fixture.json'));
const GATEWAY = __ENV.GATEWAY || 'http://localhost:8080';
const VUS = Number(__ENV.VUS || 10);
const DUR = __ENV.DUR || '20s';

// One scenario per endpoint, run back to back. GRACE covers ramp-down.
const SLOT = parseInt(DUR, 10);
const GRACE = 5;
const step = SLOT + GRACE;

const ENDPOINTS = [
  'session',
  'foods',
  'room_get',
  'room_create',
  'room_join',
  'rating_post',
  'recommendations',
];

const dur = {};
const errs = {};
const oks = {};
ENDPOINTS.forEach((e) => {
  dur[e] = new Trend(`d_${e}`, true);
  errs[e] = new Rate(`e_${e}`);
  oks[e] = new Counter(`n_${e}`);
});

function scenario(name, i) {
  return {
    executor: 'constant-vus',
    vus: VUS,
    duration: DUR,
    startTime: `${i * step}s`,
    exec: name,
    gracefulStop: `${GRACE}s`,
    tags: { endpoint: name },
  };
}

export const options = {
  discardResponseBodies: false,
  scenarios: Object.fromEntries(ENDPOINTS.map((e, i) => [e, scenario(e, i)])),
  summaryTrendStats: ['min', 'avg', 'med', 'p(95)', 'p(99)', 'max'],
  // Thresholds are recorded, not enforced: a failure here is a finding.
  thresholds: {},
};

const pick = (arr, i) => arr[i % arr.length];

function record(name, res, expected) {
  dur[name].add(res.timings.duration);
  const ok = expected.includes(res.status);
  errs[name].add(!ok);
  if (ok) oks[name].add(1);
  return ok;
}

function auth(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

// ------------------------------------------------------------------ scenarios

export function session() {
  const res = http.post(
    `${GATEWAY}/api/users/session`,
    JSON.stringify({ displayName: `k6_${__VU}_${__ITER}` }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'session' } }
  );
  record('session', res, [200]);
}

export function foods() {
  // The realistic read: the catalogue filtered by a cuisine.
  const c = pick(fixture.cuisines, __VU + __ITER);
  const res = http.get(`${GATEWAY}/api/foods?cuisine=${encodeURIComponent(c)}`, {
    tags: { name: 'foods' },
  });
  record('foods', res, [200]);
}

export function room_get() {
  const r = pick(fixture.rooms, __VU + __ITER);
  const res = http.get(`${GATEWAY}/api/rooms/${r.code}`, {
    ...auth(r.hostToken), tags: { name: 'room_get' },
  });
  record('room_get', res, [200]);
}

export function room_create() {
  const u = pick(fixture.users, __VU + __ITER);
  const res = http.post(`${GATEWAY}/api/rooms`, null, {
    ...auth(u.token), tags: { name: 'room_create' },
  });
  record('room_create', res, [201]);
}

export function room_join() {
  // An existing member re-joining: same lookup, same membership write, same
  // Kafka publish as a first join, without needing 500 distinct accounts.
  const r = pick(fixture.rooms, __VU + __ITER);
  const t = pick(r.memberTokens, __VU);
  const res = http.post(`${GATEWAY}/api/rooms/${r.code}/join`, null, {
    ...auth(t), tags: { name: 'room_join' },
  });
  record('room_join', res, [200]);
}

export function rating_post() {
  const r = pick(fixture.rooms, __VU + __ITER);
  const t = pick(r.memberTokens, __VU);
  const rid = pick(r.foodIds, __ITER);
  const res = http.post(
    `${GATEWAY}/api/rooms/${r.code}/ratings`,
    JSON.stringify({ foodId: rid, score: (__ITER % 5) + 1 }),
    { ...auth(t), tags: { name: 'rating_post' } }
  );
  record('rating_post', res, [200]);
}

export function recommendations() {
  const r = pick(fixture.rooms, __VU + __ITER);
  const res = http.get(`${GATEWAY}/api/rooms/${r.code}/recommendations`, {
    ...auth(r.hostToken), tags: { name: 'recommendations' },
  });
  record('recommendations', res, [200]);
}

// -------------------------------------------------------------------- output

export function handleSummary(data) {
  const m = data.metrics;
  const rows = ENDPOINTS.map((e) => {
    const d = m[`d_${e}`] ? m[`d_${e}`].values : {};
    const n = m[`n_${e}`] ? m[`n_${e}`].values.count : 0;
    const er = m[`e_${e}`] ? m[`e_${e}`].values.rate : null;
    const total = m[`e_${e}`] ? (m[`e_${e}`].values.passes + m[`e_${e}`].values.fails) : 0;
    return {
      endpoint: e,
      vus: VUS,
      duration: DUR,
      requests: total,
      successes: n,
      rps: total > 0 ? Number((total / SLOT).toFixed(2)) : 0,
      avg_ms: d.avg != null ? Number(d.avg.toFixed(2)) : null,
      med_ms: d.med != null ? Number(d.med.toFixed(2)) : null,
      p95_ms: d['p(95)'] != null ? Number(d['p(95)'].toFixed(2)) : null,
      p99_ms: d['p(99)'] != null ? Number(d['p(99)'].toFixed(2)) : null,
      max_ms: d.max != null ? Number(d.max.toFixed(2)) : null,
      error_rate: er != null ? Number((er * 100).toFixed(2)) : null,
    };
  });

  const overall = {
    vus: VUS,
    http_reqs: m.http_reqs ? m.http_reqs.values.count : 0,
    http_req_failed_pct: m.http_req_failed
      ? Number((m.http_req_failed.values.rate * 100).toFixed(2)) : null,
    dropped_iterations: m.dropped_iterations ? m.dropped_iterations.values.count : 0,
  };

  const out = { overall, rows };
  const target = __ENV.OUT || `k6-results-${VUS}.json`;

  let text = `\n### VUS=${VUS} duration=${DUR} per endpoint\n`;
  text += 'endpoint          reqs    rps     avg     med     p95     p99     max    err%\n';
  rows.forEach((r) => {
    text += `${r.endpoint.padEnd(17)}${String(r.requests).padStart(5)}`
      + `${String(r.rps).padStart(8)}${String(r.avg_ms).padStart(8)}${String(r.med_ms).padStart(8)}`
      + `${String(r.p95_ms).padStart(8)}${String(r.p99_ms).padStart(8)}${String(r.max_ms).padStart(8)}`
      + `${String(r.error_rate).padStart(8)}\n`;
  });
  text += `overall http_reqs=${overall.http_reqs} failed=${overall.http_req_failed_pct}% `
    + `dropped_iterations=${overall.dropped_iterations}\n`;

  return {
    stdout: text,
    [target]: JSON.stringify(out, null, 2),
  };
}
