/**
 * Creates the fixture data the k6 load tests run against, and writes it to
 * benchmarks/load-fixture.json.
 *
 * Seeding here rather than inside k6's setup() keeps the measured window free
 * of registration work, so the numbers describe the endpoints under test.
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { call, makeUser } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USERS = Number(process.env.POOL_USERS || 40);
const ROOMS = Number(process.env.POOL_ROOMS || 20);
const STAMP = Date.now();
const PASSWORD = 'blend123';

console.log(`seeding ${USERS} users and ${ROOMS} rooms...`);

const users = [];
for (let i = 0; i < USERS; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  const u = await makeUser(`load_${STAMP}_${i}`);
  users.push({ id: u.id, email: u.email, password: PASSWORD, token: u.token });
}
console.log(`  ${users.length} users`);

const rooms = [];
for (let i = 0; i < ROOMS; i += 1) {
  const host = users[i % users.length];
  // eslint-disable-next-line no-await-in-loop
  const created = await call('POST', '/api/rooms', { token: host.token });
  const code = created.data?.code;
  if (!code) {
    throw new Error(`room creation failed: ${created.status} ${JSON.stringify(created.data)}`);
  }

  // Seat a few more players so member lookups are not trivially small.
  const seated = [host];
  for (let m = 1; m <= 3; m += 1) {
    const guest = users[(i + m * 7) % users.length];
    if (seated.some((s) => s.id === guest.id)) continue;
    // eslint-disable-next-line no-await-in-loop
    await call('POST', `/api/rooms/${code}/join`, { token: guest.token });
    seated.push(guest);
  }

  // Drive the room to RATING with a frozen shortlist.
  // eslint-disable-next-line no-await-in-loop
  await call('PUT', `/api/rooms/${code}/status`, { token: host.token, body: { status: 'PREFERENCES' } });
  for (const p of seated) {
    // eslint-disable-next-line no-await-in-loop
    await call('POST', `/api/rooms/${code}/preferences`, {
      token: p.token,
      body: { cuisines: ['Indian', 'Chinese', 'Italian'], maxBudget: 900, maxDistanceKm: 9 },
    });
  }
  // eslint-disable-next-line no-await-in-loop
  await call('PUT', `/api/rooms/${code}/status`, { token: host.token, body: { status: 'RATING' } });
  // eslint-disable-next-line no-await-in-loop
  const shortlist = (await call('GET', `/api/rooms/${code}/candidates`, { token: host.token })).data;

  // One rating in place so /recommendations has something to score.
  if (shortlist?.length) {
    // eslint-disable-next-line no-await-in-loop
    await call('POST', `/api/rooms/${code}/ratings`, {
      token: host.token, body: { restaurantId: shortlist[0].id, score: 4 },
    });
  }

  rooms.push({
    code,
    hostToken: host.token,
    hostId: host.id,
    memberTokens: seated.map((s) => s.token),
    restaurantIds: (shortlist || []).map((r) => r.id),
  });
  if ((i + 1) % 5 === 0) console.log(`  ${i + 1}/${ROOMS} rooms`);
}

const catalogue = (await call('GET', '/api/restaurants')).data;

const fixture = {
  stamp: STAMP,
  users,
  rooms,
  restaurantIds: catalogue.map((r) => r.id),
  cuisines: [...new Set(catalogue.map((r) => r.cuisine))],
};

const out = path.join(HERE, 'load-fixture.json');
fs.writeFileSync(out, JSON.stringify(fixture, null, 2));
console.log(`wrote ${out}`);
console.log(`  users=${users.length} rooms=${rooms.length} restaurants=${fixture.restaurantIds.length}`);
console.log(`  shortlist size per room=${rooms[0]?.restaurantIds.length}`);
