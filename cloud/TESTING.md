# HBI Microservices Testing Report

> Historical baseline (2026-08-23). The implementation was called "HBI Cloud" at
> the time; it has since been renamed **HBI Microservices** — "cloud" now refers
> only to a possible future deployment environment. Measurements, endpoint names
> and results below are preserved exactly as recorded; later phases renamed the
> restaurant service/endpoints to a food catalogue (see PROJECT_STATUS.md).

A measurement pass over the existing distributed implementation. **No code was changed
and nothing was optimised** — where a test exposed a bug or a limit, it is recorded
here as found.

Every number below was measured on the machine described in *Environment*. Nothing is
estimated or extrapolated; where a measurement is invalid or was not completed, it says
so explicitly.

Run date: 2026-08-23.

---

## 1. Environment

| | |
|---|---|
| Machine | Intel Core i5-11400H @ 2.70 GHz, 6 physical / 12 logical cores |
| Host RAM | 7.7 GB |
| OS | Windows 11 Home Single Language 10.0.26200 |
| **Docker VM limits** | **12 CPUs, 3.96 GB RAM** |
| Docker | 29.7.2, Compose v5.4.0 |
| Java (host) | OpenJDK 23.0.1 (containers build and run on Temurin 21) |
| Node | v21.1.0 (`--experimental-websocket` required for the WebSocket tests) |
| Load tool | k6 v0.55.0 (windows/amd64), run on the host |

**The Docker VM's 3.96 GB is the single most important constraint in this report.**
Eleven containers share it, and at load the services alone reach ~3.0 GB of peak
resident memory. Read every saturation figure with that in mind.

The load generator runs on the same 12 cores as the containers under test. At low and
moderate load this is not material; above ~200 virtual users it becomes impossible to
attribute saturation cleanly, which is discussed in section 4.

---

## 2. Architecture under test

```
React/Vite (nginx :5173)
        |
   API Gateway :8080          Spring Cloud Gateway, JWT verification
        |
  +-----+------+--------------+----------------+
  |            |              |                |
user-svc    room-svc     restaurant-svc    rating-svc
 :8081       :8082          :8083            :8084  (+ STOMP WebSocket hub)
  |            |              |                |
user_db     room_db     restaurant_db      rating_db      4 separate Postgres 16
             |                                 |
        hbi.room-events  ---> Kafka <---  hbi.ratings      single broker, KRaft
```

11 containers: 5 Spring Boot services, 4 PostgreSQL instances, 1 Kafka broker,
1 nginx frontend.

---

## 3. Baseline health check

Clean start from `docker compose down -v` followed by `docker compose up --build`.

| Measurement | Result |
|---|---|
| `docker compose up --build` returns | **18 s** (warm Docker layer cache) |
| All 10 healthchecked services healthy | **50 s** from build start (32 s after `up` returned) |
| Cold build, no layer cache (measured separately) | **~15 min** — five Maven builds and an npm build, each resolving dependencies from scratch |
| Containers started | **11** |
| Containers unhealthy at any point | **0** |
| Container restarts during startup | **0** |

Health progression: 5 healthy at t=19 s (the databases and Kafka), 10 healthy at t=50 s
as the JVMs finished booting.

### Startup warnings — recorded, not fixed

| Service | Count | Content |
|---|---|---|
| api-gateway | 0 | — |
| restaurant-service | 0 | — |
| kafka | 0 | — |
| frontend | 0 | — |
| user-service | 2 | `constraint "ukbpt50..." of relation "hbi_user" does not exist, skipping` |
| room-service | 4 | same pattern for `room`, `room_member` |
| rating-service | 20 | same pattern for `decision`, `preference`, `rating`, `room_candidate`, `recommendation` |

All 26 are the same benign message: Hibernate `ddl-auto: update` issuing
`alter table ... drop constraint if exists` against an empty schema. They are noise, not
faults, but they do make a genuine error easy to miss in the logs.

### Existing smoke test

```
node --experimental-websocket scripts/smoke-test.mjs
```

**54 passed, 0 failed** in 72.1 s. Exit code 0.

---

## 4. Functional tests

Run via `benchmarks/functional.mjs` (new; measurement tooling only).
**70 passed, 2 failed** out of 72 assertions — a **97.2 %** pass rate.

### Core journey

| Test | Result |
|---|---|
| User A registration | PASS |
| User A login (JWT issued) | PASS |
| Profile read `GET /api/users/{id}` | PASS |
| User B registration | PASS |
| User B login | PASS |
| Room creation (201, code matches `HBI####`) | PASS |
| Creator becomes host | PASS |
| Room starts in `LOBBY` | PASS |
| User B joins room | PASS |
| Member count reflects 2 players | PASS |
| Host advances `LOBBY → PREFERENCES` | PASS |
| Cuisine list available | PASS |
| User A submits preferences | PASS |
| User B submits preferences | PASS |
| Group cuisines are the union of both players | PASS |
| Shortlist generated (frozen candidates) | PASS |
| Rating accepted | PASS |
| Recommendations returned and ranked 1..n | PASS |
| Automatic decision once everyone finishes | PASS |
| Decision picks the highest-scored restaurant | PASS |
| Decision recorded as `AUTO` | PASS |

### Real-time delivery (two live WebSocket clients)

| Test | Result |
|---|---|
| User A WebSocket connects | PASS |
| User B WebSocket connects | PASS |
| `USER_JOINED` delivered to User A | PASS |
| `USER_JOINED` delivered to User B | PASS |
| `ROOM_STATE_CHANGED` delivered | PASS |
| `RATING_SUBMITTED` delivered to the other user | PASS |
| `RECOMMENDATIONS_GENERATED` delivered | PASS |
| `DECISION_FINALIZED` delivered to User A | PASS |
| `DECISION_FINALIZED` delivered to User B | PASS |

### Authentication and authorization

| Test | Result |
|---|---|
| Missing JWT rejected (401) | PASS |
| Malformed JWT rejected (401) | PASS |
| Tampered JWT signature rejected (401) | PASS |
| JWT forged with a wrong signing key rejected (401) | PASS |
| Spoofed `X-User-Id` header without a token rejected (401) | PASS |
| Gateway overrides a client-supplied `X-User-Id` with the JWT identity | PASS |
| Cannot edit another user's profile (403) | PASS |
| Another user's profile is readable (documented, not private) | PASS |
| WebSocket with no token refused | PASS |
| WebSocket with bogus token refused | PASS |
| WebSocket with valid token accepted | PASS |

### Room edge cases

| Test | Result |
|---|---|
| Invalid room code → 404 | PASS |
| Joining an invalid room code → 404 | PASS |
| Duplicate join is idempotent (no duplicate member) | PASS |
| Room caps at 8 players | PASS |
| 9th player refused with 409 | PASS |
| Duplicate rating accepted as an overwrite | PASS |
| Duplicate rating does not create a second row | PASS |
| Invalid rating rejected: score 0 | PASS |
| Invalid rating rejected: score 6 | PASS |
| Invalid rating rejected: score null | PASS |
| Invalid rating rejected: missing `restaurantId` | PASS |
| **Rating a non-existent restaurant id** | **FAIL** — returns 200 (see BUG-1) |
| **Joining a finalised room refused** | **FAIL** — returns 200 (see BUG-2) |
| Ratings after finalisation do not change the decision | PASS |
| Re-finalising is idempotent | PASS |

### Disconnects and host handoff

| Test | Result |
|---|---|
| Host WebSocket disconnect does **not** mark the host inactive | PASS (documented behaviour) |
| Non-host WebSocket disconnect leaves membership untouched | PASS (documented behaviour) |
| Host can leave explicitly (200) | PASS |
| Host role hands off to the longest-standing remaining player | PASS |
| Departed host marked inactive | PASS |
| New host can advance the room | PASS |
| Non-host can leave | PASS |
| Host unchanged when a non-host leaves | PASS |
| Member count decrements | PASS |
| A non-member cannot remove the host (403) | PASS |

Worth calling out: HBI Web drops a player when their socket disconnects. **HBI
Microservices does not** — membership only changes on an explicit `DELETE`. A user who closes their
laptop stays in the room and keeps counting toward "all players finished". This is a
behavioural divergence from the other two implementations, not a crash.

### WebSocket reconnection

| Test | Result |
|---|---|
| Initial connection | PASS |
| Reconnect with the same token | PASS |
| Reconnected client receives new events | PASS |
| Events during the disconnect window are not replayed | PASS (no buffering, by design) |

---

## 5. Load test results

`benchmarks/k6-endpoints.js`. Each endpoint runs as its own k6 scenario, one after
another, so no figure is the result of two endpoints competing. All traffic goes
through the API Gateway. 20 s per endpoint at 10–100 VUs.

Latencies are milliseconds, measured client-side (full round trip).

### 10 concurrent users

| Endpoint | Requests | RPS | Avg | Median | p95 | p99 | Max | Error % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `POST /api/users/login` | 2 242 | 112.1 | 89.09 | 85.54 | 117.91 | 145.08 | 299.67 | 0 |
| `GET /api/restaurants` | 22 001 | 1 100.1 | 8.88 | 7.24 | 17.73 | 29.44 | 228.93 | 0 |
| `GET /api/rooms/{code}` | 23 054 | 1 152.7 | 8.46 | 7.00 | 16.37 | 24.32 | 141.80 | 0 |
| `POST /api/rooms` | 9 001 | 450.1 | 21.95 | 19.73 | 38.86 | 57.61 | 107.75 | 0 |
| `POST /api/rooms/{code}/join` | 17 780 | 889.0 | 11.01 | 9.86 | 20.10 | 27.41 | 90.74 | 0 |
| `POST /api/rooms/{code}/ratings` | 4 871 | 243.6 | 40.71 | 36.17 | 70.54 | 109.94 | 288.02 | 0 |
| `GET /api/rooms/{code}/recommendations` | 6 380 | 319.0 | 31.09 | 29.01 | 49.19 | 66.54 | 159.27 | 0 |

Total 85 329 requests, **0 % failures**, 0 dropped iterations.

### 50 concurrent users

| Endpoint | Requests | RPS | Avg | Median | p95 | p99 | Max | Error % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `POST /api/users/login` | 2 176 | 108.8 | 463.97 | 426.51 | 991.47 | 1 204.63 | 1 526.88 | 0 |
| `GET /api/restaurants` | 69 018 | 3 450.9 | 14.35 | 12.82 | 27.86 | 40.68 | 118.80 | 0 |
| `GET /api/rooms/{code}` | 50 516 | 2 525.8 | 19.62 | 17.23 | 39.34 | 60.72 | 185.17 | 0 |
| `POST /api/rooms` | 17 755 | 887.8 | 56.13 | 49.94 | 114.60 | 177.36 | 402.50 | 0 |
| `POST /api/rooms/{code}/join` | 31 367 | 1 568.4 | 31.69 | 28.53 | 62.63 | 85.57 | 212.56 | 0 |
| `POST /api/rooms/{code}/ratings` | 11 142 | 557.1 | 89.54 | 81.54 | 158.69 | 225.10 | 637.96 | 0 |
| `GET /api/rooms/{code}/recommendations` | 9 055 | 452.8 | 110.24 | 99.03 | 201.26 | 304.50 | 615.89 | 0 |

Total 191 029 requests, **0 % failures**, 0 dropped iterations.

### 100 concurrent users

| Endpoint | Requests | RPS | Avg | Median | p95 | p99 | Max | Error % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `POST /api/users/login` | 2 256 | 112.8 | 899.66 | 849.55 | 1 754.74 | 2 252.49 | 2 789.61 | 0 |
| `GET /api/restaurants` | 69 969 | 3 498.5 | 28.45 | 25.56 | 56.68 | 80.04 | 204.35 | 0 |
| `GET /api/rooms/{code}` | 51 660 | 2 583.0 | 38.58 | 34.39 | 77.10 | 111.40 | 272.34 | 0 |
| `POST /api/rooms` | 22 623 | 1 131.2 | 88.25 | 82.13 | 187.68 | 269.10 | 598.83 | 0 |
| `POST /api/rooms/{code}/join` | 31 781 | 1 589.1 | 62.80 | 56.32 | 129.01 | 179.82 | 354.94 | 0 |
| `POST /api/rooms/{code}/ratings` | 13 314 | 665.7 | 150.20 | 137.32 | 274.69 | 359.58 | 2 731.47 | 0.05 |
| `GET /api/rooms/{code}/recommendations` | 10 716 | 535.8 | 187.27 | 177.52 | 309.18 | 381.46 | 647.86 | 0 |

Total 202 319 requests, **0 % overall failures** (a single rating request failed),
0 dropped iterations.

### Summary across levels

| VUs | Total requests | Peak RPS (single endpoint) | Overall error % |
|---:|---:|---:|---:|
| 10 | 85 329 | 1 152.7 (`GET /api/rooms/{code}`) | 0 |
| 50 | 191 029 | 3 450.9 (`GET /api/restaurants`) | 0 |
| 100 | 202 319 | 3 498.5 (`GET /api/restaurants`) | 0 |

**Maximum measured throughput: 3 498 requests/sec** on `GET /api/restaurants` at
100 VUs, with 0 % errors.

### Login does not scale — the clearest result in this report

| VUs | Login RPS | Login avg | Login p95 |
|---:|---:|---:|---:|
| 10 | 112.1 | 89 ms | 118 ms |
| 50 | 108.8 | 464 ms | 991 ms |
| 100 | 112.8 | 900 ms | 1 755 ms |

Throughput is flat at ~110 RPS across a 10× increase in concurrency while latency grows
almost linearly. This is textbook saturation: BCrypt is deliberately CPU-expensive, and
`POST /api/users/login` is CPU-bound at roughly 110 hashes/sec on this hardware. Every
other endpoint scaled 3–4× over the same range.

### Levels above 100 VUs — recorded, then descoped

250 and 500 VUs were run before this session was time-boxed. Both were repeated on a
freshly restarted stack and the results reproduced, so they are recorded here as
observations rather than headline numbers:

- **250 VUs:** onset of failure. Login 12.2 % errors, `GET /api/rooms/{code}` p99 of
  11.2 s, and the last scenario in the sequence (`recommendations`) completed **zero**
  requests in both runs.
- **500 VUs:** collapse. 95.8 % of requests failed.

A diagnostic run (`benchmarks/k6-diagnose.js`) bucketed every response by status:

| Endpoint @ VUs | Total | 2xx | 4xx | 5xx | No response (status 0) |
|---|---:|---:|---:|---:|---:|
| `room_get` @ 250 | 15 140 | 14 787 | 0 | 0 | 353 |
| `rating_post` @ 250 | 115 | 0 | 0 | 0 | 115 |
| `recommendations` @ 250 | 210 | 0 | 0 | 0 | 210 |
| `room_get` @ 500 | 2 286 | 500 | 0 | 0 | 1 786 |
| `recommendations` @ 500 | 1 718 | 55 | 0 | 0 | 1 663 |

**Every single failure was status 0 — no response at all. Zero 4xx, zero 5xx.** The
services never returned an error; connections could not be established or completed.
Confirming this, the gateway and the user, room and restaurant services logged **zero**
ERROR or WARN lines across the entire load campaign.

Contributing factors, honestly unseparated: the Windows host has 16 384 ephemeral ports
with 226 sockets still in `TIME_WAIT` after a run; the JVMs were CPU-contending (peak
`docker stats` CPU across services summed to ~3 400 % against a 1 200 % ceiling); and k6
shares the same 12 cores. An attempt to isolate this by running k6 **inside** the Docker
network worked at 50 VUs (30 166 requests, 0 errors, p95 54.6 ms) but at 250 VUs
exhausted the 3.96 GB VM and **took the Docker engine down entirely**, requiring a
Docker Desktop restart.

So: **the 250/500 figures characterise this test rig at least as much as they
characterise the application.** What can be stated without qualification is that the system
handled **100 VUs with 0 % errors**, and that a separate run at 200 VUs also returned
**0 % errors** across all seven endpoints (140 171 requests, peak 3 378 RPS).

Notably, after every overload the stack self-recovered: **0 container restarts,
0 OOM-kills, all 11 containers still healthy.**

---

## 6. Real-time latency

`benchmarks/realtime-latency.mjs`, 25 iterations, each in a fresh room, on an idle
warm stack. User A acts over REST; a separate subscribed client receives the frame.
Both clients run in one process, so both timestamps come from one clock.

This measures the full path: **REST → service → Kafka → consumer → STOMP → other client.**

| Event | n | Min | Avg | Median | p95 | Max | Timeouts |
|---|---:|---:|---:|---:|---:|---:|---:|
| `USER_JOINED` | 25 | 10 | **14.48** | 14 | 23 | 28 | 0 |
| `RATING_SUBMITTED` | 25 | 6 | **12.08** | 11 | 19 | 27 | 0 |
| `RECOMMENDATIONS_GENERATED` | 25 | 23 | **39.88** | 39 | 64 | 69 | 0 |
| `DECISION_FINALIZED` | 25 | 13 | **29.08** | 28 | 59 | 69 | 0 |

All values in milliseconds. 25/25 iterations completed, 0 abandoned, 0 event timeouts.

`RECOMMENDATIONS_GENERATED` is the slowest because that consumer re-scores the room,
which requires REST calls out to room-service (member count) and restaurant-service
(candidate details) before it can broadcast.

**Invalid measurement, reported for completeness:** the script also tried to isolate the
Kafka leg using the producer's `occurredAt` stamp against the client's receive time.
That produced *negative* values (avg −5.9 ms), which means the container clock is
roughly 6 ms ahead of the host clock. **The producer-stamped leg is unusable and no
Kafka-only latency figure should be quoted from it.** Isolating it properly needs both
timestamps taken on the same host.

---

## 7. Kafka

Configuration: single broker in KRaft mode, both topics at **1 partition, replication
factor 1**, consumer group `hbi-rating-service`, `auto-offset-reset: latest`.

### Cumulative volume after the whole test campaign

| Topic | Messages produced | Consumer offset | **Lag** |
|---|---:|---:|---:|
| `hbi.room-events` | 274 873 | 274 873 | **0** |
| `hbi.ratings` | 47 613 | 47 613 | **0** |

**322 486 events** passed through the broker during this session. The consumer was
**fully caught up — lag 0 on both topics** — after the entire load campaign, including
the 500-VU overload runs. Kafka never became the bottleneck.

### Raw broker ceiling

`kafka-producer-perf-test`, 1 000 records × 200 bytes, single partition, `acks=1`:

| Metric | Value |
|---|---:|
| Throughput | **2 525 records/sec** (0.48 MB/sec) |
| Avg latency | 52.15 ms |
| p50 | 54 ms |
| p95 | 56 ms |
| p99 | 56 ms |
| p99.9 | 349 ms |
| Max | 349 ms |

For comparison, the application's own rating write path sustained **665.7 RPS** at
100 VUs (section 5), each of which publishes one `RATING_SUBMITTED`. So the application
is running at roughly a quarter of this single-partition broker ceiling — Kafka has
headroom, and the limit is in the service, not the broker.

### Application burst

**Not measured — the script failed.** `benchmarks/kafka-bench.sh` invoked
`benchmarks/kafka-burst.mjs` via `$PWD`, which Git Bash on Windows mangled into
`C:\c\Users\...`, so Node exited with `MODULE_NOT_FOUND`. The burst script itself is
correct; the shell wrapper's path is not. Recorded as a tooling defect, not fixed.

### Failed and retried messages

| Metric | Count |
|---|---:|
| `failed handling RATING_SUBMITTED` | 9 |
| Deserialization errors | **1 350 529** |
| Malformed events ignored | 0 |

**BUG-6 — a poison message on `hbi.ratings` causes an unbounded retry loop.
Severity: MEDIUM.** The 1.35 million deserialization errors were **induced by this
test**: `kafka-producer-perf-test` writes raw 200-byte payloads that are not JSON, and
1 000 of them landed on `hbi.ratings`. The consumer cannot deserialize them, and because
there is no `DefaultErrorHandler`, backoff or dead-letter topic configured, it retries
the same record forever — 1.35 million log lines and a stuck offset (lag pinned at
1 000) from a thousand bad records.

This was self-inflicted, but the weakness it exposes is real: **any malformed message on
the topic will wedge the consumer indefinitely and flood the logs.** In production that
could come from a version skew between producer and consumer.
*Suggested fix:* configure a `DefaultErrorHandler` with a bounded retry policy and a
dead-letter topic.

Note that the 9 `failed handling RATING_SUBMITTED` entries are a separate, pre-existing
count from the load runs, and are caught by the listener's own try/catch (the listener
survives them).

---

## 8. Resource usage

Sampled with `docker stats` every ~2 s throughout each load run
(`benchmarks/sample-resources.sh`). CPU % is relative to one core, so 1 200 % is the
whole 12-CPU VM.

### At 100 concurrent users

| Service | CPU avg % | CPU peak % | Mem avg MB | Mem peak MB | Mem peak % of VM |
|---|---:|---:|---:|---:|---:|
| user-service | 114.8 | **1 056.8** | 266.6 | 289.9 | 7.7 |
| rating-service | 109.5 | 505.1 | 497.4 | **626.4** | 16.6 |
| restaurant-service | 52.2 | 370.1 | 311.1 | 329.1 | 8.7 |
| room-service | 121.4 | 345.9 | 465.3 | 510.1 | 13.5 |
| api-gateway | 113.7 | 323.3 | 341.7 | 356.8 | 9.4 |
| kafka | 49.1 | 191.6 | 653.6 | **715.9** | 19.0 |
| room-db | 54.1 | 168.0 | 48.4 | 52.7 | 1.4 |
| rating-db | 27.6 | 112.8 | 40.8 | 44.4 | 1.2 |
| restaurant-db | 12.8 | 92.0 | 32.5 | 38.1 | 1.0 |
| user-db | 1.2 | 4.9 | 29.9 | 39.7 | 1.1 |
| frontend (nginx) | 0.0 | 0.0 | 5.3 | 6.1 | 0.2 |

**Sum of per-service peak memory: 3 009 MB of the 3.96 GB VM (~76 %).**

### Bottleneck

**user-service is the CPU bottleneck**, peaking at 1 056.8 % — very nearly the entire
12-CPU VM from one service — while its database sits at 1.2 % average. The work is
BCrypt hashing, not I/O. This matches the flat ~110 RPS login ceiling exactly.

The **secondary constraint is total VM memory**: Kafka (716 MB peak) and rating-service
(626 MB peak) are the two largest consumers, and the 11 containers together occupy about
three quarters of the VM at load.

Container restarts during the entire load campaign: **0**. OOM-kills: **0**.

---

## 9. Database performance

Not completed within the time-box. One measurement was taken while diagnosing a
separate issue and is reported because it is a real finding:

| Query | Plan | Rows scanned | Execution |
|---|---|---:|---:|
| `select * from hbi_user where lower(email) = lower($1)` | **Seq Scan** | 116 | 0.095 ms |

The unique index on `hbi_user` is on `email`, but both registration
(`existsByEmailIgnoreCase`) and login (`findByEmailIgnoreCase`) query on
`lower(email)`, which that index cannot serve. At 116 rows this costs 0.095 ms and does
not matter; it is O(n) and will matter at scale. There is no functional index on
`lower(email)`.

Indexes present on `hbi_user`: `hbi_user_pkey (id)`, `ukbpt50tktium72bkfev9b7pma1 (email)`.

`benchmarks/db-bench.sh` is written and ready to produce the full table (15 queries
across all four databases, 30 executions each, with `EXPLAIN ANALYZE` timings, table
sizes, index inventory and seq-scan/index-scan counters) but was not run.

---

## 10. Scaling

**Not tested.** Descoped when the session was time-boxed.

The tooling is in place and ready to run: `benchmarks/docker-compose.scale.yml` (an
overlay that removes the published host ports which would otherwise collide on a second
replica) and `benchmarks/scaling-probe.mjs` (two modes: `spread`, which reads each
replica's own `http.server.requests` counter to see whether the gateway distributes
load, and `websocket`, which measures event delivery rate with a replicated
rating-service and reports Kafka partition ownership per replica).

The README's claim that the in-memory STOMP broker prevents rating-service from scaling
horizontally therefore remains **unverified by measurement**. It should not be treated
as confirmed or refuted by this report. The mechanism to check is described in
section 12.

---

## 11. Failure and resilience testing

**Not run as a dedicated suite.** Descoped when the session was time-boxed;
`benchmarks/resilience.mjs` is written and covers stopping restaurant-service,
room-service, rating-service, Kafka, and restarting PostgreSQL, with recovery timing
and Kafka event-loss accounting.

Two resilience observations were nevertheless made incidentally and are real:

1. **The stack survives its own overload.** After a 500-VU run that failed 95.8 % of
   requests, all 11 containers were still healthy with 0 restarts and 0 OOM-kills, and
   the system returned to normal service without intervention.
2. **Docker Desktop itself was the thing that fell over**, not the application — when a k6
   container was added inside the 3.96 GB VM, the Docker engine began returning HTTP 500
   and required a full restart. The application containers came back healthy in ~40 s
   with all data intact on the volumes.

---

## 12. Findings

### Working well

- **Correctness is solid.** 54/54 smoke assertions and 70/72 functional assertions pass,
  including the complete two-user journey, host handoff, room capacity, JWT forgery and
  header-spoofing defences, and WebSocket reconnection.
- **Real-time propagation is genuinely fast.** 12–40 ms average end-to-end through
  REST → Kafka → STOMP, with zero dropped events across 25 iterations. p95 never exceeded
  64 ms.
- **Read endpoints scale well.** `GET /api/restaurants` and `GET /api/rooms/{code}`
  sustained ~3 500 and ~2 583 RPS at 100 VUs with 0 % errors, scaling roughly 3× from
  10 VUs.
- **Zero server-side errors under load.** Across ~480 000 requests including deliberate
  overload, the gateway and the user, room and restaurant services logged no ERROR or
  WARN lines. Failures at overload were connection-level, never 5xx.
- **The system degrades without crashing.** No restarts, no OOM-kills, no manual
  recovery needed after severe overload.
- **Startup is quick and reliable** — 50 s to a fully healthy 11-container stack.

### Bottlenecks

1. **BCrypt login, and it is the dominant one.** Flat ~110 RPS from 10 to 100 VUs while
   p95 grows 118 ms → 1 755 ms. user-service peaks at 1 057 % CPU with its database
   at 1.2 %.
2. **Total VM memory.** 3 009 MB of peak service memory against a 3.96 GB VM leaves
   almost no headroom; this is what made in-container load generation impossible.
3. **`GET /recommendations` is the heaviest application endpoint** — 187 ms average at
   100 VUs versus 38 ms for a plain room read, because it scores on read and makes two
   outbound REST calls per request.

### Bugs

**BUG-1 — Ratings are not validated against the shortlist. Severity: HIGH.**
`POST /api/rooms/{id}/ratings` accepts any `restaurantId` with HTTP 200, including ids
that do not exist. This is not merely cosmetic. `BlendService.progress()` counts *all*
of a user's ratings and compares that count against the shortlist size, so bogus ratings
count toward completion. Verified directly: a user who submitted **only** non-existent
restaurant ids (900000–900004) was counted as "finished", and once the second player
finished for real the room **auto-finalised** — a decision reached with ratings that
never touched a real candidate.
*Root cause:* `saveRating` performs no referential check, and `progress()` does not
restrict its count to candidate restaurants.
*Suggested fix:* reject `restaurantId`s that are not in the room's frozen
`room_candidate` list, and count only candidate ratings in `progress()`.

**BUG-2 — Room status never becomes `DECIDED` server-side. Severity: MEDIUM.**
After automatic finalisation, `POST /api/rooms/{code}/join` still returns 200 and admits
new players to a finished room.
*Root cause:* auto-finalisation happens in rating-service's Kafka consumer, which cannot
change room state — that belongs to room-service. Only the frontend performs the
`PUT /status`, so any client that does not is left with a room stuck in `RATING`.
*Suggested fix:* have room-service consume a `DECISION_FINALIZED` event and move the
room to `DECIDED` itself.

**BUG-3 — First request after an idle period hangs ~30 s. Severity: HIGH (user-facing).**
Reproduced twice in a row on a warm, healthy stack: `POST /api/users/register` timed out
at 30 s, and the immediately following identical requests returned in 85 ms and 84 ms.
*Root cause (likely, not confirmed):* the gateway's Netty connection pool reuses a
keep-alive connection to the downstream service that the Docker network has silently
dropped, and waits for its own timeout before retrying. The characteristic signature is
a single very slow request followed by normal ones.
*Suggested fix:* set `spring.cloud.gateway.httpclient.pool.max-idle-time` below the
network idle timeout, and add a response timeout.

**BUG-4 — Concurrent duplicate ratings throw. Severity: LOW.**
Six `duplicate key value violates unique constraint "ukptimnlochfdf46lbidcuc1qfq"`
errors in rating-service during the high-concurrency runs.
*Root cause:* `saveRating` does find-then-save with no handling for two concurrent
requests for the same `(room, user, restaurant)`; both find nothing and both insert.
*Suggested fix:* catch the constraint violation and retry as an update, or use an upsert.

**BUG-5 — `lower(email)` cannot use the email index. Severity: LOW now, grows with data.**
Confirmed `Seq Scan` for the query on both the login and registration paths. Harmless at
116 rows (0.095 ms), O(n) thereafter.
*Suggested fix:* add a functional unique index on `lower(email)`.

**BUG-6 — no error handling for poison Kafka messages. Severity: MEDIUM.**
A record the consumer cannot deserialize is retried forever: 1 000 bad records produced
1 350 529 error log lines and pinned the consumer offset. No `DefaultErrorHandler`,
backoff or dead-letter topic is configured. Induced by a test tool here, but reachable
in production through any producer/consumer version skew. Full detail in section 7.
*Suggested fix:* a `DefaultErrorHandler` with bounded retries and a DLT.

### Architectural limitations

- **Membership does not react to disconnects.** Unlike HBI Web, closing a browser leaves
  a player active in the room and still counted in "all players finished". A room can be
  blocked indefinitely by someone who walked away.
- **Single Kafka broker, one partition per topic, replication factor 1.** No redundancy,
  and one partition caps consumer parallelism at one instance.
- **In-memory STOMP broker** — the documented barrier to scaling rating-service.
  **Still unverified**; see section 10.
- **`ddl-auto: update`, no migrations.** Also the source of all 26 startup warnings.
- **`auto-offset-reset: latest`** means events produced while the consumer is down are
  never seen.
- **The 3.96 GB Docker VM** is the practical deployment constraint on this machine, not
  anything in the code.

### Recommended next fixes

1. **BUG-1 — validate `restaurantId` against the room's frozen shortlist, and count only
   candidate ratings toward progress.** This is a correctness bug that lets a user force
   a group decision without rating anything real. Highest priority by a clear margin.
2. **BUG-3 — bound the gateway's connection pool idle time.** A 30-second hang on the
   first action after a quiet period is the single worst thing a real user would
   experience, and it is a two-line configuration change.
3. **Make login's cost explicit.** BCrypt at ~110 RPS is the throughput ceiling for the
   whole product's entry point. Either lower the BCrypt work factor to a measured
   target, or accept it and document the number — but the current situation, where the
   only endpoint that cannot scale is the one every user must hit first, should be a
   deliberate choice rather than an accident.

### What was not measured

Stated plainly so nothing here is mistaken for a complete picture:

- Scaling to 2 and 3 replicas (section 10) — tooling ready, not run.
- Dedicated failure/resilience suite (section 11) — tooling ready, not run.
- Full database query baseline (section 9) — tooling ready, only one query measured.
- The Kafka application-burst measurement (section 7) — the shell wrapper had a Windows
  path bug; broker ceiling, cumulative volume and consumer lag were measured.
- Any browser-based UI verification: the Chrome extension reported no connected browser
  instances, so the frontend was only verified programmatically (app shell, SPA routes,
  asset delivery, `/api` proxying).

---

## Appendix — how to reproduce

```bash
cd cloud
docker compose up --build -d

# functional sweep (72 assertions)
node --experimental-websocket benchmarks/functional.mjs

# load sweep, one endpoint scenario at a time
k6 run -e VUS=100 -e DUR=20s -e OUT=results.json benchmarks/k6-endpoints.js

# failure-type breakdown at a given level
k6 run -e VUS=250 -e EP=rating_post benchmarks/k6-diagnose.js

# real-time latency, all waits bounded
node --experimental-websocket benchmarks/realtime-latency.mjs 25

# resource sampling alongside a run
bash benchmarks/sample-resources.sh out.csv 200
node benchmarks/summarise-resources.mjs out.csv

# not yet run
bash benchmarks/kafka-bench.sh 200   # note: burst step has a Git-Bash path bug
bash benchmarks/db-bench.sh 30
node --experimental-websocket benchmarks/scaling-probe.mjs spread restaurant-service 8083
node --experimental-websocket benchmarks/resilience.mjs
```

Load fixtures are seeded once with `node benchmarks/seed-load-data.mjs`.

Every measurement script enforces its own timeouts — per request (15 s), per event
(20 s), per iteration (90 s) and a global watchdog — and prints partial results rather
than hanging.
