/**
 * Section 2 - full functional and edge-case sweep.
 *
 *   node --experimental-websocket benchmarks/functional.mjs
 *
 * Records pass/fail for the complete two-user journey plus every failure mode
 * in the validation brief. It reports what the system does; it does not fix it.
 */

import {
  GATEWAY, call, makeUser, subscribeRoom, probeWs, waitFor, sleep, harness,
} from './lib.mjs';

const h = harness();
const S = Date.now();
const ws = GATEWAY.replace(/^http/, 'ws');

// ===================================================== the happy path
h.section('Player A and Player B - anonymous sessions');

const alice = await makeUser(`fa_alice_${S}`);
h.check('Player A starts a session and gets a JWT', !!alice.token);
const bob = await makeUser(`fa_bob_${S}`);
h.check('Player B starts a session and gets a JWT', !!bob.token);

const profile = await call('GET', `/api/users/${alice.id}`, { token: alice.token });
h.check('GET /api/users/{id} returns the profile', profile.data?.displayName === alice.displayName);

h.section('Room creation and joining');

const created = await call('POST', '/api/rooms', { token: alice.token });
h.check('User A creates a room (201)', created.status === 201, `got ${created.status}`);
const ROOM = created.data?.code;
h.check('room code matches HBI####', /^HBI[A-Z0-9]{4}$/.test(ROOM || ''), ROOM);
h.check('creator is host', created.data?.hostUserId === alice.id);
h.check('room starts in LOBBY', created.data?.status === 'LOBBY', created.data?.status);

// Two live subscribers, so we can prove BOTH users get pushed events.
const aEvents = [];
const bEvents = [];
const aSock = await subscribeRoom(alice.token, ROOM, (e) => aEvents.push(e));
const bSock = await subscribeRoom(bob.token, ROOM, (e) => bEvents.push(e));
h.check('User A WebSocket connected', aSock.connected);
h.check('User B WebSocket connected', bSock.connected);

const joined = await call('POST', `/api/rooms/${ROOM}/join`, { token: bob.token });
h.check('User B joins the room (200)', joined.status === 200, `got ${joined.status}`);
h.check('room reports 2 members', joined.data?.memberCount === 2, `got ${joined.data?.memberCount}`);

h.check('User A received USER_JOINED',
  await waitFor(() => aEvents.some((e) => e.type === 'USER_JOINED' && e.payload?.userId === bob.id)));
h.check('User B received USER_JOINED (both users get real-time updates)',
  await waitFor(() => bEvents.some((e) => e.type === 'USER_JOINED' && e.payload?.userId === bob.id)));

h.section('Preferences and blend start');

const toPrefs = await call('PUT', `/api/rooms/${ROOM}/status`, {
  token: alice.token, body: { status: 'PREFERENCES' },
});
h.check('host starts the blend (LOBBY -> PREFERENCES)', toPrefs.data?.status === 'PREFERENCES');
h.check('ROOM_STATE_CHANGED pushed to User B',
  await waitFor(() => bEvents.some((e) => e.type === 'ROOM_STATE_CHANGED')));

const cuisines = await call('GET', '/api/restaurants/cuisines');
h.check('cuisine list available for selection', cuisines.data?.length >= 5, `${cuisines.data?.length}`);

const pa = await call('POST', `/api/rooms/${ROOM}/preferences`, {
  token: alice.token, body: { cuisines: ['Indian', 'Chinese'], maxBudget: 700, maxDistanceKm: 6 },
});
h.check('User A submits cuisines', pa.status === 200, `got ${pa.status}`);
const pb = await call('POST', `/api/rooms/${ROOM}/preferences`, {
  token: bob.token, body: { cuisines: ['Italian'], maxBudget: 900, maxDistanceKm: 8 },
});
h.check('User B submits cuisines', pb.status === 200, `got ${pb.status}`);

const agg = await call('GET', `/api/rooms/${ROOM}/preferences`, { token: alice.token });
h.check('group cuisines are the union of both players',
  ['Indian', 'Chinese', 'Italian'].every((c) => agg.data?.cuisines?.includes(c)),
  JSON.stringify(agg.data?.cuisines));

await call('PUT', `/api/rooms/${ROOM}/status`, { token: alice.token, body: { status: 'RATING' } });

h.section('Rating');

const shortlist = (await call('GET', `/api/rooms/${ROOM}/candidates`, { token: alice.token })).data;
h.check('shortlist generated', Array.isArray(shortlist) && shortlist.length > 0,
  `got ${shortlist?.length}`);
const fav = shortlist[shortlist.length - 1];

const r1 = await call('POST', `/api/rooms/${ROOM}/ratings`, {
  token: alice.token, body: { restaurantId: fav.id, score: 5 },
});
h.check('rating accepted', r1.status === 200 && r1.data?.accepted === true, `got ${r1.status}`);
h.check('RATING_SUBMITTED pushed to the other user',
  await waitFor(() => bEvents.some((e) => e.type === 'RATING_SUBMITTED')));
h.check('RECOMMENDATIONS_GENERATED pushed',
  await waitFor(() => bEvents.some((e) => e.type === 'RECOMMENDATIONS_GENERATED')));

// -------- duplicate rating (same user, same restaurant, new score)
const dupRate = await call('POST', `/api/rooms/${ROOM}/ratings`, {
  token: alice.token, body: { restaurantId: fav.id, score: 4 },
});
h.check('duplicate rating is accepted as an overwrite (200)', dupRate.status === 200,
  `got ${dupRate.status}`);
const afterDup = await call('GET', `/api/rooms/${ROOM}/ratings`, { token: alice.token });
const mine = (afterDup.data?.ratings || []).filter((r) => r.userId === alice.id && r.restaurantId === fav.id);
h.check('duplicate rating overwrites rather than duplicating', mine.length === 1 && mine[0].score === 4,
  JSON.stringify(mine));

// -------- invalid ratings
for (const [label, body] of [
  ['score 0', { restaurantId: fav.id, score: 0 }],
  ['score 6', { restaurantId: fav.id, score: 6 }],
  ['score null', { restaurantId: fav.id, score: null }],
  ['missing restaurantId', { score: 3 }],
]) {
  const bad = await call('POST', `/api/rooms/${ROOM}/ratings`, { token: alice.token, body });
  h.check(`invalid rating rejected: ${label} (400)`, bad.status === 400, `got ${bad.status}`);
}
const ghost = await call('POST', `/api/rooms/${ROOM}/ratings`, {
  token: alice.token, body: { restaurantId: 999999, score: 3 },
});
h.check('rating a non-existent restaurant id', ghost.status >= 400,
  `got ${ghost.status} -- BUG if 200: no referential check against restaurant-service`);

h.section('Recommendations and decision');

const recs = await call('GET', `/api/rooms/${ROOM}/recommendations`, { token: alice.token });
h.check('recommendations returned and ranked',
  recs.data?.recommendations?.length === shortlist.length,
  `got ${recs.data?.recommendations?.length}`);
h.check('ranks are 1..n in order',
  recs.data.recommendations.every((r, i) => r.rank === i + 1));

// Everyone finishes -> automatic decision.
for (const r of shortlist) {
  // eslint-disable-next-line no-await-in-loop
  await call('POST', `/api/rooms/${ROOM}/ratings`, {
    token: alice.token, body: { restaurantId: r.id, score: r.id === fav.id ? 5 : 2 },
  });
}
for (const r of shortlist) {
  // eslint-disable-next-line no-await-in-loop
  await call('POST', `/api/rooms/${ROOM}/ratings`, {
    token: bob.token, body: { restaurantId: r.id, score: r.id === fav.id ? 5 : 3 },
  });
}

h.check('DECISION_FINALIZED pushed to User A',
  await waitFor(() => aEvents.some((e) => e.type === 'DECISION_FINALIZED')));
h.check('DECISION_FINALIZED pushed to User B',
  await waitFor(() => bEvents.some((e) => e.type === 'DECISION_FINALIZED')));

const decision = await call('GET', `/api/rooms/${ROOM}/decision`, { token: alice.token });
h.check('decision retrievable (200)', decision.status === 200, `got ${decision.status}`);
h.check('decision picked the highest-scored restaurant', decision.data?.restaurantId === fav.id,
  `picked ${decision.data?.restaurant?.name}, expected ${fav.name}`);
h.check('decision was automatic', decision.data?.decidedBy === 'AUTO', decision.data?.decidedBy);

// ===================================================== auth failure modes
h.section('Authentication and authorization');

const noJwt = await call('POST', '/api/rooms');
h.check('missing JWT rejected (401)', noJwt.status === 401, `got ${noJwt.status}`);

const badJwt = await call('POST', '/api/rooms', { token: 'not-a-jwt' });
h.check('malformed JWT rejected (401)', badJwt.status === 401, `got ${badJwt.status}`);

const tamper = alice.token.slice(0, -3) + 'AAA';
const tampered = await call('POST', '/api/rooms', { token: tamper });
h.check('tampered JWT signature rejected (401)', tampered.status === 401, `got ${tampered.status}`);

// A JWT signed with a different secret must not be accepted.
const forged = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: String(alice.id), name: 'Alice', exp: 9999999999 })).toString('base64url'),
  'ZmFrZXNpZ25hdHVyZQ',
].join('.');
const forgedRes = await call('POST', '/api/rooms', { token: forged });
h.check('JWT forged with a wrong signature rejected (401)', forgedRes.status === 401,
  `got ${forgedRes.status}`);

const spoof = await call('POST', '/api/rooms', {
  rawHeaders: { 'X-User-Id': String(alice.id), 'X-User-Name': 'Impostor' },
});
h.check('spoofed X-User-Id without a token rejected (401)', spoof.status === 401, `got ${spoof.status}`);

const spoofWithToken = await call('POST', '/api/rooms', {
  token: bob.token, rawHeaders: { 'X-User-Id': String(alice.id), 'X-User-Name': 'Alice' },
});
const spoofRoom = spoofWithToken.data?.hostUserId;
h.check('gateway overrides a client-supplied X-User-Id with the JWT identity',
  spoofRoom === bob.id, `room host became ${spoofRoom}, expected bob ${bob.id}`);

const otherProfile = await call('PUT', `/api/users/${alice.id}`, {
  token: bob.token, body: { displayName: 'Hacked' },
});
h.check("cannot edit another user's profile (403)", otherProfile.status === 403,
  `got ${otherProfile.status}`);

const stillAlice = await call('GET', `/api/users/${alice.id}`, { token: bob.token });
h.check("other user's profile is readable (documented: profiles are not private)",
  stillAlice.status === 200 && stillAlice.data?.displayName !== 'Hacked',
  `status ${stillAlice.status} name ${stillAlice.data?.displayName}`);

h.check('WebSocket with no token refused', (await probeWs(`${ws}/ws`)) !== 'open');
h.check('WebSocket with bogus token refused', (await probeWs(`${ws}/ws?token=nope`)) !== 'open');
h.check('WebSocket with valid token accepted', (await probeWs(`${ws}/ws?token=${alice.token}`)) === 'open');

// ===================================================== room edge cases
h.section('Room edge cases');

// "0" is not in the room-code alphabet, so this code can never be allocated.
// (The previous fixture, HBIZZZZ, was eventually allocated for real by a load
// run - 75k rooms in, the collision came up - and the test failed spuriously.)
const noSuchRoom = await call('GET', '/api/rooms/HBI0000', { token: alice.token });
h.check('invalid room code returns 404', noSuchRoom.status === 404, `got ${noSuchRoom.status}`);

const joinNoSuch = await call('POST', '/api/rooms/NOPE/join', { token: alice.token });
h.check('joining an invalid room code returns 404', joinNoSuch.status === 404, `got ${joinNoSuch.status}`);

// -------- duplicate join
const dupRoom = (await call('POST', '/api/rooms', { token: alice.token })).data.code;
await call('POST', `/api/rooms/${dupRoom}/join`, { token: bob.token });
const dupJoin = await call('POST', `/api/rooms/${dupRoom}/join`, { token: bob.token });
h.check('duplicate join is idempotent (200, not a duplicate member)',
  dupJoin.status === 200 && dupJoin.data?.memberCount === 2,
  `status ${dupJoin.status} members ${dupJoin.data?.memberCount}`);

// -------- full room
const fullRoom = (await call('POST', '/api/rooms', { token: alice.token })).data.code;
let fullResult = null;
let seated = 1;
for (let i = 0; i < 9; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  const u = await makeUser(`fa_full_${S}_${i}`);
  // eslint-disable-next-line no-await-in-loop
  const res = await call('POST', `/api/rooms/${fullRoom}/join`, { token: u.token });
  if (res.status !== 200) { fullResult = res; break; }
  seated += 1;
}
h.check('room caps at 8 players', seated === 8, `seated ${seated}`);
h.check('9th player refused with 409', fullResult?.status === 409, `got ${fullResult?.status}`);

// -------- room after finalization
const joinDecided = await call('POST', `/api/rooms/${ROOM}/join`, { token: (await makeUser(`fa_late_${S}`)).token });
h.check('joining a DECIDED room is refused (409)', joinDecided.status === 409, `got ${joinDecided.status}`);

const rateAfter = await call('POST', `/api/rooms/${ROOM}/ratings`, {
  token: alice.token, body: { restaurantId: fav.id, score: 1 },
});
const decisionAfter = await call('GET', `/api/rooms/${ROOM}/decision`, { token: alice.token });
h.check('ratings after finalization do not change the decision',
  decisionAfter.data?.restaurantId === fav.id,
  `rating POST returned ${rateAfter.status}; decision now ${decisionAfter.data?.restaurantId}`);
h.check('rating after finalization is still accepted (documented: room is not locked)',
  rateAfter.status === 200, `got ${rateAfter.status}`);

const refinalize = await call('POST', `/api/rooms/${ROOM}/finalize`, { token: alice.token });
h.check('re-finalizing is idempotent', refinalize.data?.restaurantId === fav.id, `got ${refinalize.status}`);

// ===================================================== disconnects
h.section('Disconnects and host handoff');

const hostRoom = (await call('POST', '/api/rooms', { token: alice.token })).data.code;
await call('POST', `/api/rooms/${hostRoom}/join`, { token: bob.token });

// -------- WebSocket disconnect of the host
const hostEvents = [];
const hostSock = await subscribeRoom(alice.token, hostRoom, (e) => hostEvents.push(e));
h.check('host WebSocket connected', hostSock.connected);
await hostSock.close();
await sleep(2500);
const afterHostWsDrop = await call('GET', `/api/rooms/${hostRoom}/members`, { token: bob.token });
const hostRow = afterHostWsDrop.data?.find((m) => m.userId === alice.id);
h.check('host WebSocket disconnect does NOT mark the host inactive (documented behaviour)',
  hostRow?.active === true,
  `host active=${hostRow?.active} -- HBI Web drops players on socket disconnect; HBI Cloud only reacts to an explicit leave`);

// -------- non-host WebSocket disconnect
const guestSock = await subscribeRoom(bob.token, hostRoom, () => {});
await guestSock.close();
await sleep(1500);
const afterGuestWsDrop = await call('GET', `/api/rooms/${hostRoom}/members`, { token: alice.token });
h.check('non-host WebSocket disconnect also leaves membership untouched',
  afterGuestWsDrop.data?.find((m) => m.userId === bob.id)?.active === true);

// -------- explicit host leave -> handoff
const handoff = await call('DELETE', `/api/rooms/${hostRoom}/members/${alice.id}`, { token: alice.token });
h.check('host can leave (200)', handoff.status === 200, `got ${handoff.status}`);
h.check('host role hands off to the remaining player', handoff.data?.hostUserId === bob.id,
  `host is now ${handoff.data?.hostUserId}, expected bob ${bob.id}`);
h.check('departed host is marked inactive',
  handoff.data?.members?.find((m) => m.userId === alice.id)?.active === false);
h.check('new host can now advance the room',
  (await call('PUT', `/api/rooms/${hostRoom}/status`, {
    token: bob.token, body: { status: 'PREFERENCES' },
  })).status === 200);

// -------- non-host leave
const leaveRoom2 = (await call('POST', '/api/rooms', { token: alice.token })).data.code;
await call('POST', `/api/rooms/${leaveRoom2}/join`, { token: bob.token });
const guestLeave = await call('DELETE', `/api/rooms/${leaveRoom2}/members/${bob.id}`, { token: bob.token });
h.check('non-host can leave (200)', guestLeave.status === 200, `got ${guestLeave.status}`);
h.check('host is unchanged when a non-host leaves', guestLeave.data?.hostUserId === alice.id);
h.check('member count drops to 1', guestLeave.data?.memberCount === 1, `got ${guestLeave.data?.memberCount}`);

const kick = await call('DELETE', `/api/rooms/${leaveRoom2}/members/${alice.id}`, { token: bob.token });
h.check('a non-member cannot remove the host (403)', kick.status === 403, `got ${kick.status}`);

// ===================================================== reconnect
h.section('WebSocket reconnection');

const rcRoom = (await call('POST', '/api/rooms', { token: alice.token })).data.code;
const rc1 = [];
const s1 = await subscribeRoom(alice.token, rcRoom, (e) => rc1.push(e));
h.check('initial WebSocket connection', s1.connected);
await s1.close();
await sleep(1000);

const rc2 = [];
const s2 = await subscribeRoom(alice.token, rcRoom, (e) => rc2.push(e));
h.check('WebSocket reconnects with the same token', s2.connected);

await call('POST', `/api/rooms/${rcRoom}/join`, { token: bob.token });
h.check('reconnected client receives new events',
  await waitFor(() => rc2.some((e) => e.type === 'USER_JOINED' && e.payload?.userId === bob.id)));
h.check('events during the disconnect window are NOT replayed (no buffering by design)',
  rc1.length === 0 || !rc1.some((e) => e.payload?.userId === bob.id));
await s2.close();

await aSock.close();
await bSock.close();

const failures = h.summary();
process.exit(failures ? 1 : 0);
