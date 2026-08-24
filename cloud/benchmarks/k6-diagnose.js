/*
 * Focused diagnostic: at a given VU count, what exactly are the failures?
 *
 *   k6 run -e VUS=250 -e EP=rating_post benchmarks/k6-diagnose.js
 *
 * Buckets every response by HTTP status (0 = the request never got a response:
 * connection refused, reset, or client timeout) so a "57% error rate" can be
 * attributed to the server or to the test rig.
 */

import http from 'k6/http';
import { Counter, Trend } from 'k6/metrics';

const fixture = JSON.parse(open('./load-fixture.json'));
const GATEWAY = __ENV.GATEWAY || 'http://localhost:8080';
const VUS = Number(__ENV.VUS || 250);
const DUR = __ENV.DUR || '20s';
const EP = __ENV.EP || 'rating_post';

const s0 = new Counter('status_0_no_response');
const s2xx = new Counter('status_2xx');
const s4xx = new Counter('status_4xx');
const s5xx = new Counter('status_5xx');
const sOther = new Counter('status_other');
const lat = new Trend('latency', true);

export const options = {
  scenarios: {
    diag: { executor: 'constant-vus', vus: VUS, duration: DUR, gracefulStop: '10s' },
  },
  summaryTrendStats: ['min', 'avg', 'med', 'p(95)', 'p(99)', 'max'],
};

const pick = (a, i) => a[i % a.length];
const auth = (t) => ({ headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });

export default function () {
  let res;
  if (EP === 'rating_post') {
    const r = pick(fixture.rooms, __VU + __ITER);
    const t = pick(r.memberTokens, __VU);
    res = http.post(
      `${GATEWAY}/api/rooms/${r.code}/ratings`,
      JSON.stringify({ restaurantId: pick(r.restaurantIds, __ITER), score: (__ITER % 5) + 1 }),
      auth(t)
    );
  } else if (EP === 'room_get') {
    const r = pick(fixture.rooms, __VU + __ITER);
    res = http.get(`${GATEWAY}/api/rooms/${r.code}`, auth(r.hostToken));
  } else if (EP === 'recommendations') {
    const r = pick(fixture.rooms, __VU + __ITER);
    res = http.get(`${GATEWAY}/api/rooms/${r.code}/recommendations`, auth(r.hostToken));
  } else {
    res = http.get(`${GATEWAY}/api/restaurants?cuisine=Indian`);
  }

  lat.add(res.timings.duration);
  const c = res.status;
  if (c === 0) s0.add(1);
  else if (c >= 200 && c < 300) s2xx.add(1);
  else if (c >= 400 && c < 500) s4xx.add(1);
  else if (c >= 500) s5xx.add(1);
  else sOther.add(1);
}

export function handleSummary(data) {
  const v = (n) => (data.metrics[n] ? data.metrics[n].values.count : 0);
  const d = data.metrics.latency ? data.metrics.latency.values : {};
  const total = v('status_0_no_response') + v('status_2xx') + v('status_4xx') + v('status_5xx') + v('status_other');
  const out = {
    endpoint: EP,
    vus: VUS,
    total,
    status_0_no_response: v('status_0_no_response'),
    status_2xx: v('status_2xx'),
    status_4xx: v('status_4xx'),
    status_5xx: v('status_5xx'),
    status_other: v('status_other'),
    error_breakdown: data.metrics.http_req_failed
      ? `${(data.metrics.http_req_failed.values.rate * 100).toFixed(2)}%` : null,
    latency: {
      avg: d.avg?.toFixed(1), med: d.med?.toFixed(1),
      p95: d['p(95)']?.toFixed(1), p99: d['p(99)']?.toFixed(1), max: d.max?.toFixed(1),
    },
  };
  let t = `\n### ${EP} @ ${VUS} VUs\n`;
  t += `total=${out.total}  2xx=${out.status_2xx}  4xx=${out.status_4xx}  5xx=${out.status_5xx}  `
    + `no-response(status 0)=${out.status_0_no_response}\n`;
  t += `latency avg=${out.latency.avg} med=${out.latency.med} p95=${out.latency.p95} max=${out.latency.max}\n`;
  return { stdout: t, [__ENV.OUT || `diag-${EP}-${VUS}.json`]: JSON.stringify(out, null, 2) };
}
