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

const cuisines = await call('GET', '/api/foods/cuisines');
h.check('cuisine list available for selection', cuisines.data?.length >= 5, `${cuisines.data?.length}`);

const pa = await call('POST', `/api/rooms/${ROOM}/preferences`, {
  token: alice.token, body: { cuisines: ['Indian', 'Chinese'] },
});
h.check('User A submits cuisines', pa.status === 200, `got ${pa.status}`);
const pb = await call('POST', `/api/rooms/${ROOM}/preferences`, {
  token: bob.token, body: { cuisines: ['Italian'] },
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
  token: alice.token, body: { foodId: fav.id, score: 5 },
});
h.check('rating accepted', r1.status === 200 && r1.data?.accepted === true, `got ${r1.status}`);
h.check('RATING_SUBMITTED pushed to the other user',
  await waitFor(() => bEvents.some((e) => e.type === 'RATING_SUBMITTED')));
h.check('RECOMMENDATIONS_GENERATED pushed',
  await waitFor(() => bEvents.some((e) => e.type === 'RECOMMENDATIONS_GENERATED')));

// -------- duplicate rating (same user, same food, new score)
const dupRate = await call('POST', `/api/rooms/${ROOM}/ratings`, {
  token: alice.token, body: { foodId: fav.id, score: 4 },
});
h.check('duplicate rating is accepted as an overwrite (200)', dupRate.status === 200,
  `got ${dupRate.status}`);
const afterDup = await call('GET', `/api/rooms/${ROOM}/ratings`, { token: alice.token });
const mine = (afterDup.data?.ratings || []).filter((r) => r.userId === alice.id && r.foodId === fav.id);
h.check('duplicate rating overwrites rather than duplicating', mine.length === 1 && mine[0].score === 4,
  JSON.stringify(mine));

// -------- invalid ratings
for (const [label, body] of [
  ['score 0', { foodId: fav.id, score: 0 }],
  ['score 6', { foodId: fav.id, score: 6 }],
  ['score null', { foodId: fav.id, score: null }],
  ['missing foodId', { score: 3 }],
]) {
  const bad = await call('POST', `/api/rooms/${ROOM}/ratings`, { token: alice.token, body });
  h.check(`invalid rating rejected: ${label} (400)`, bad.status === 400, `got ${bad.status}`);
}
const ghost = await call('POST', `/api/rooms/${ROOM}/ratings`, {
  token: alice.token, body: { foodId: 999999, score: 3 },
});
h.check('rating a non-existent food id is rejected', ghost.status >= 400,
  `got ${ghost.status} -- BUG if 200: no referential check against the shortlist`);

h.section('Recommendations and decision');

const recs = await call('GET', `/api/rooms/${ROOM}/recommendations`, { token: alice.token });
h.check('recommendations returned and ranked',
  recs.data?.recommendations?.length === shortlist.length,
  `got ${recs.data?.recommendations?.length}`);
h.check('ranks are 1..n in order',
  recs.data.recommendations.every((r, i) => r.rank === i + 1));

// Everyone finishes -> automatic decision.
for (const f of shortlist) {
  // eslint-disable-next-line no-await-in-loop
  await call('POST', `/api/rooms/${ROOM}/ratings`, {
    token: alice.token, body: { foodId: f.id, score: f.id === fav.id ? 5 : 2 },
  });
}
for (const f of shortlist) {
  // eslint-disable-next-line no-await-in-loop
  await call('POST', `/api/rooms/${ROOM}/ratings`, {
    token: bob.token, body: { foodId: f.id, score: f.id === fav.id ? 5 : 3 },
  });
}

h.check('DECISION_FINALIZED pushed to User A',
  await waitFor(() => aEvents.some((e) => e.type === 'DECISION_FINALIZED')));
h.check('DECISION_FINALIZED pushed to User B',
  await waitFor(() => bEvents.some((e) => e.type === 'DECISION_FINALIZED')));

const decision = await call('GET', `/api/rooms/${ROOM}/decision`, { token: alice.token });
h.check('decision retrievable (200)', decision.status === 200, `got ${decision.status}`);
h.check('decision picked the highest-scored food', decision.data?.foodId === fav.id,
  `picked ${decision.data?.food?.name}, expected ${fav.name}`);
h.check('decision was automatic', decision.data?.decidedBy === 'AUTO', decision.data?.decidedBy);
h.check('no restaurant data anywhere in the decision',
  !JSON.stringify(decision.data).toLowerCase().includes('restaurant'),
  JSON.stringify(decision.data));

const finalRecsA = await call('GET', `/api/rooms/${ROOM}/recommendations`, { token: alice.token });
const finalRecsB = await call('GET', `/api/rooms/${ROOM}/recommendations`, { token: bob.token });
h.check('both players read the same final food ranking',
  JSON.stringify(finalRecsA.data?.recommendations?.map((r) => r.food?.id))
    === JSON.stringify(finalRecsB.data?.recommendations?.map((r) => r.food?.id)));
h.check('ranking entries are food items with name and cuisine',
  finalRecsA.data.recommendations.every((r) => r.food?.name && r.food?.cuisine));

// ===================================================== early blend (4A)
h.section('Optional early blend - BLEND NOW');

{
  const carol = await makeUser(`fa_eb_a_${S}`);
  const dave = await makeUser(`fa_eb_b_${S}`);
  const room = (await call('POST', '/api/rooms', { token: carol.token })).data.code;
  await call('POST', `/api/rooms/${room}/join`, { token: dave.token });
  await call('PUT', `/api/rooms/${room}/status`, { token: carol.token, body: { status: 'PREFERENCES' } });
  await call('POST', `/api/rooms/${room}/preferences`, { token: carol.token, body: { cuisines: [] } });
  await call('POST', `/api/rooms/${room}/preferences`, { token: dave.token, body: { cuisines: [] } });
  await call('PUT', `/api/rooms/${room}/status`, { token: carol.token, body: { status: 'RATING' } });
  const foods = (await call('GET', `/api/rooms/${room}/candidates`, { token: carol.token })).data;
  const progress0 = (await call('GET', `/api/rooms/${room}/ratings`, { token: carol.token })).data.progress;
  const min = progress0.minRatingsRequired;
  h.check('server states the minimum rating count (half the shortlist, rounded up)',
    min === Math.max(1, Math.ceil(foods.length / 2)),
    `min ${min} for shortlist ${foods.length}`);

  // Below the minimum: refused.
  for (let i = 0; i < min - 1; i += 1) {
    await call('POST', `/api/rooms/${room}/ratings`, {
      token: carol.token, body: { foodId: foods[i].id, score: 5 },
    });
  }
  const early = await call('POST', `/api/rooms/${room}/blend-now`, { token: carol.token });
  h.check('player cannot BLEND NOW below the minimum (409)', early.status === 409,
    `got ${early.status} after ${min - 1} ratings`);

  // At the minimum: allowed, and the player is finished without rating the rest.
  await call('POST', `/api/rooms/${room}/ratings`, {
    token: carol.token, body: { foodId: foods[min - 1].id, score: 4 },
  });
  const done = await call('POST', `/api/rooms/${room}/blend-now`, { token: carol.token });
  h.check('player can BLEND NOW at the minimum (200)', done.status === 200, `got ${done.status}`);
  h.check('player counts as finished without rating the remaining foods',
    done.data?.progress?.membersFinished === 1
      && done.data?.progress?.finishedUserIds?.includes(carol.id),
    JSON.stringify(done.data?.progress));

  const dupDone = await call('POST', `/api/rooms/${room}/blend-now`, { token: carol.token });
  h.check('pressing BLEND NOW twice is harmless (200)', dupDone.status === 200, `got ${dupDone.status}`);

  // The other player's view: correct waiting state, and a refresh resumes it.
  const daveView = (await call('GET', `/api/rooms/${room}/ratings`, { token: dave.token })).data;
  h.check('the other player sees 1 of 2 finished', daveView.progress?.membersFinished === 1,
    JSON.stringify(daveView.progress));
  const carolRefresh = (await call('GET', `/api/rooms/${room}/ratings`, { token: carol.token })).data;
  h.check('a refresh still reports the early-blended player as finished',
    carolRefresh.progress?.finishedUserIds?.includes(carol.id));

  // Dave finishes fully -> automatic decision that includes Carol's partial ratings.
  for (const f of foods) {
    await call('POST', `/api/rooms/${room}/ratings`, { token: dave.token, body: { foodId: f.id, score: 3 } });
  }
  const decided = await waitFor(async () => (await call('GET', `/api/rooms/${room}/decision`,
    { token: dave.token })).status === 200, { attempts: 60, delay: 250 });
  h.check('room auto-finalises once the early blender and the full rater are both done', decided);
  const recsAfter = (await call('GET', `/api/rooms/${room}/recommendations`, { token: dave.token })).data;
  const topFood = recsAfter.recommendations?.[0]?.food?.id;
  h.check("the early player's partial ratings are included (their 5-scored food leads)",
    topFood === foods[0].id,
    `leader ${topFood}, expected ${foods[0].id}`);
}

// ===================================================== host threshold (4B)
h.section('Host early start / force blend - 50% threshold');

{
  const host = await makeUser(`fa_ht_h_${S}`);
  const guest = await makeUser(`fa_ht_g_${S}`);
  const room = (await call('POST', '/api/rooms', { token: host.token })).data.code;
  await call('POST', `/api/rooms/${room}/join`, { token: guest.token });
  await call('PUT', `/api/rooms/${room}/status`, { token: host.token, body: { status: 'PREFERENCES' } });
  await call('POST', `/api/rooms/${room}/preferences`, { token: host.token, body: { cuisines: [] } });
  await call('PUT', `/api/rooms/${room}/status`, { token: host.token, body: { status: 'RATING' } });
  const foods = (await call('GET', `/api/rooms/${room}/candidates`, { token: host.token })).data;
  const min = (await call('GET', `/api/rooms/${room}/ratings`, { token: host.token }))
    .data.progress.minRatingsRequired;

  // Below the threshold (0 of 2 eligible): refused even for the host.
  const below = await call('POST', `/api/rooms/${room}/finalize`, { token: host.token });
  h.check('host below the 50% threshold is refused (409)', below.status === 409, `got ${below.status}`);

  // One short of eligibility is still below.
  for (let i = 0; i < min - 1; i += 1) {
    await call('POST', `/api/rooms/${room}/ratings`, { token: host.token, body: { foodId: foods[i].id, score: 4 } });
  }
  const stillBelow = await call('POST', `/api/rooms/${room}/finalize`, { token: host.token });
  h.check('host still refused while nobody has reached the minimum (409)',
    stillBelow.status === 409, `got ${stillBelow.status}`);

  // Exactly at the threshold: 1 of 2 active players eligible = 50%.
  await call('POST', `/api/rooms/${room}/ratings`, {
    token: host.token, body: { foodId: foods[min - 1].id, score: 4 },
  });
  const nonHost = await call('POST', `/api/rooms/${room}/finalize`, { token: guest.token });
  h.check('non-host is refused even when the threshold is met (403)', nonHost.status === 403,
    `got ${nonHost.status}`);
  const atThreshold = await call('POST', `/api/rooms/${room}/finalize`, { token: host.token });
  h.check('host exactly at the 50% threshold may force the blend (200)', atThreshold.status === 200,
    `got ${atThreshold.status}`);
  h.check('forced decision is recorded as HOST', atThreshold.data?.decidedBy === 'HOST',
    atThreshold.data?.decidedBy);

  const repeat = await call('POST', `/api/rooms/${room}/finalize`, { token: host.token });
  h.check('repeated finalization is idempotent (same food)',
    repeat.status === 200 && repeat.data?.foodId === atThreshold.data?.foodId,
    `got ${repeat.status} / ${repeat.data?.foodId}`);
}

{
  // Inactive players must not count toward the threshold.
  const host = await makeUser(`fa_ht2_h_${S}`);
  const guest = await makeUser(`fa_ht2_g_${S}`);
  const leaver = await makeUser(`fa_ht2_l_${S}`);
  const room = (await call('POST', '/api/rooms', { token: host.token })).data.code;
  await call('POST', `/api/rooms/${room}/join`, { token: guest.token });
  await call('POST', `/api/rooms/${room}/join`, { token: leaver.token });
  await call('PUT', `/api/rooms/${room}/status`, { token: host.token, body: { status: 'PREFERENCES' } });
  await call('POST', `/api/rooms/${room}/preferences`, { token: host.token, body: { cuisines: [] } });
  await call('PUT', `/api/rooms/${room}/status`, { token: host.token, body: { status: 'RATING' } });
  const foods = (await call('GET', `/api/rooms/${room}/candidates`, { token: host.token })).data;
  const min = (await call('GET', `/api/rooms/${room}/ratings`, { token: host.token }))
    .data.progress.minRatingsRequired;

  for (let i = 0; i < min; i += 1) {
    await call('POST', `/api/rooms/${room}/ratings`, { token: host.token, body: { foodId: foods[i].id, score: 4 } });
  }
  // 1 of 3 active eligible: below threshold.
  const with3 = await call('POST', `/api/rooms/${room}/finalize`, { token: host.token });
  h.check('1 eligible of 3 active is below 50% (409)', with3.status === 409, `got ${with3.status}`);

  // The third player leaves; 1 of 2 active eligible = 50% -> allowed.
  await call('DELETE', `/api/rooms/${room}/members/${leaver.id}`, { token: leaver.token });
  const with2 = await call('POST', `/api/rooms/${room}/finalize`, { token: host.token });
  h.check('after a player leaves, inactive players no longer count: 1 of 2 = 50% (200)',
    with2.status === 200, `got ${with2.status}`);
}

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

// "0" is not in the room-code alphabet, so this code can never be allocated
// for real and collide with the fixture.
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
  token: alice.token, body: { foodId: fav.id, score: 1 },
});
const decisionAfter = await call('GET', `/api/rooms/${ROOM}/decision`, { token: alice.token });
h.check('ratings after finalization do not change the decision',
  decisionAfter.data?.foodId === fav.id,
  `rating POST returned ${rateAfter.status}; decision now ${decisionAfter.data?.foodId}`);
h.check('rating after finalization is still accepted (documented: room is not locked)',
  rateAfter.status === 200, `got ${rateAfter.status}`);

const refinalize = await call('POST', `/api/rooms/${ROOM}/finalize`, { token: alice.token });
h.check('re-finalizing is idempotent', refinalize.data?.foodId === fav.id, `got ${refinalize.status}`);

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
  `host active=${hostRow?.active} -- HBI Web drops players on socket disconnect; HBI Microservices only reacts to an explicit leave`);

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

// ===================================================== session rate limiting
h.section('Anonymous session rate limiting (gateway)');

{
  // The limiter keys on the last X-Forwarded-For hop, so a made-up test
  // address gets its own bucket and this burst cannot throttle the real
  // callers used by the rest of the suite (or a suite run right after).
  const spoof = { 'X-Forwarded-For': '198.51.100.42' };
  const burst = [];
  for (let i = 0; i < 70; i += 1) {
    burst.push(await call('POST', '/api/users/session', {
      body: { displayName: `rl_${S}_${i}` }, rawHeaders: spoof, attempts: 1,
    }));
  }
  const ok = burst.filter((r) => r.status === 200).length;
  const throttled = burst.filter((r) => r.status === 429).length;
  h.check('a session burst is throttled with 429 once the bucket empties',
    throttled > 0, `got ${ok}x200 ${throttled}x429`);
  h.check('the burst capacity is honoured before throttling begins (~60)',
    ok >= 55 && ok <= 65, `got ${ok}x200`);
  h.check('every response is 200 or 429 (nothing breaks)',
    burst.every((r) => r.status === 200 || r.status === 429),
    JSON.stringify([...new Set(burst.map((r) => r.status))]));

  const other = await call('POST', '/api/users/session', {
    body: { displayName: `rl_ok_${S}` }, rawHeaders: { 'X-Forwarded-For': '198.51.100.43' },
  });
  h.check('a different caller is unaffected by the throttled one', other.status === 200,
    `got ${other.status}`);
}

const failures = h.summary();
process.exit(failures ? 1 : 0);
