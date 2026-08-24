# HBI Cloud — Current Project Status

Status after the hardening and re-testing pass of 2026-08-23/24. The baseline this
report compares against is **[TESTING.md](TESTING.md)** (2026-08-23), which measured
the system before any fix. Nothing in that baseline was modified.

All numbers below were measured, not estimated. Where the test rig degraded the
measurement, that is stated.

---

## Architecture

Unchanged in shape from the baseline — five Spring Boot services behind one gateway,
database-per-service, Kafka for the two genuinely asynchronous paths, STOMP for push:

```
React/Vite (nginx :5173)
        |
   API Gateway :8080          Spring Cloud Gateway, JWT verification
        |                     + bounded connection pool & response timeout (new)
  +-----+------+--------------+----------------+
  |            |              |                |
user-svc    room-svc     restaurant-svc    rating-svc
 :8081       :8082          :8083            :8084  (+ STOMP WebSocket hub)
  |            |              |                |
user_db     room_db     restaurant_db      rating_db      4 separate Postgres 16
             |                                 |
        hbi.room-events  ---> Kafka <---  hbi.ratings     single broker, KRaft
             |                                 |          + hbi.*.DLT dead-letter
             +--- room-svc now also consumes hbi.ratings  topics (new)
                  (DECISION_FINALIZED -> room DECIDED)
```

One event flow was added: when a blend finalises (auto or by host), the rating
service publishes `DECISION_FINALIZED` on `hbi.ratings`; the room service consumes
it and moves the room to `DECIDED`. Room state stays owned by the room service —
the rating service still never touches `room_db`.

## Implemented features

Everything in the baseline still works, verified end-to-end this session:
registration/login (BCrypt + HS256 JWT), rooms with host handoff and an 8-player
cap, preference merging, frozen candidate shortlists, 1–5 ratings, deterministic
recommendation scoring, automatic and host-forced decisions, live updates over
Kafka → STOMP to all connected browsers, JWT verification and header-spoofing
protection at the gateway.

New behaviour this pass:

- Ratings are **validated against the room's frozen shortlist** (422 otherwise).
- A room whose blend has finished is **marked DECIDED server-side** and refuses
  new joins (409).
- A malformed Kafka record is retried at most 3 times, then **parked on a
  dead-letter topic**; the consumer continues.
- Concurrent duplicate ratings resolve cleanly (upsert semantics, one row).
- The first request after an idle period no longer hangs ~30 s.
- `lower(email)` login/registration lookups use a functional unique index.

## Test status

| Suite | Baseline | Now |
|---|---:|---:|
| Unit tests (`RecommendationEngineTest`) | 5/5 | **5/5** |
| Smoke suite (`scripts/smoke-test.mjs`) | 54/54 | **54/54** |
| Functional suite (`benchmarks/functional.mjs`) | 70/72 | **72/72** |
| Bug-fix regression suite (`benchmarks/regression.mjs`, new) | — | **19/19** |
| Kafka poison-message test (`benchmarks/kafka-poison-test.sh`, new) | — | **6/6** |

One functional assertion (`invalid room code returns 404`) failed spuriously mid-pass
because its "invalid" fixture code `HBIZZZZ` had been genuinely allocated by the
baseline load campaign (75,782 rooms in `room_db`). The fixture now uses `HBI0000`,
which contains a character outside the room-code alphabet and can never be allocated.
The system's behaviour was correct; the fixture was not.

## Performance

Measured with the same tool (k6 v0.55.0) and script as the baseline, 20 s per
endpoint, all traffic through the gateway.

**Environment caveat, stated up front:** the host was measurably slower during this
session than during the baseline campaign (Docker Desktop restarted twice, more
memory pressure). Even the 10-VU numbers are below baseline across the board, which
cannot be an application regression at that load. Absolute cross-campaign
comparisons therefore understate the current system; the load-bearing facts are the
error rates and the intra-session scaling behaviour.

### 10 VUs — 57,064 requests, 0 % errors

| Endpoint | RPS | avg | med | p95 | p99 |
|---|---:|---:|---:|---:|---:|
| `POST /login` | 79.2 | 126 | 100 | 257 | 499 |
| `GET /restaurants` | 736.6 | 13.4 | 9.8 | 27.9 | 55.5 |
| `GET /rooms/{code}` | 646.6 | 15.2 | 11.5 | 26.3 | 60.7 |
| `POST /rooms` | 240.5 | 41.2 | 35.6 | 77.3 | 132.8 |
| `POST /rooms/{code}/join` | 592.8 | 16.6 | 14.5 | 32.4 | 53.0 |
| `POST /ratings` | 201.2 | 49.4 | 44.6 | 83.1 | 130.9 |
| `GET /recommendations` | 356.5 | 27.8 | 26.0 | 44.2 | 58.2 |

### 50 VUs — 194,592 requests, 0 % errors

| Endpoint | RPS | avg | med | p95 | p99 |
|---|---:|---:|---:|---:|---:|
| `POST /login` | 100.2 | 502 | 452 | 1 064 | 1 801 |
| `GET /restaurants` | **3 609.9** | 13.7 | 12.3 | 26.1 | 36.9 |
| `GET /rooms/{code}` | 2 466.4 | 20.1 | 17.3 | 39.9 | 70.0 |
| `POST /rooms` | 644.4 | 77.5 | 58.7 | 180.8 | 467.3 |
| `POST /rooms/{code}/join` | 1 674.9 | 29.7 | 26.2 | 55.6 | 85.8 |
| `POST /ratings` | 547.0 | 91.2 | 81.6 | 150.0 | 223.5 |
| `GET /recommendations` | 686.9 | 72.6 | 68.8 | 113.0 | 145.8 |

At 50 VUs the fixed system **beats the baseline** on peak throughput (3 610 vs
3 451 RPS on `GET /restaurants`) and on the two rating-service endpoints
(`recommendations` p95 113 ms vs 201 ms; `ratings` p95 150 ms vs 159 ms) — the
added shortlist validation did not cost measurable latency.

### 100 VUs — 65,901 requests, 0 % errors (on a freshly restarted engine)

| Endpoint | RPS | avg | med | p95 | p99 |
|---|---:|---:|---:|---:|---:|
| `POST /login` | 82.8 | 1 229 | 1 082 | 3 313 | 3 496 |
| `GET /restaurants` | 920.4 | 108 | 80 | 186 | 361 |
| `GET /rooms/{code}` | 650.3 | 154 | 128 | 353 | 500 |
| `POST /rooms` | 378.5 | 266 | 244 | 591 | 794 |
| `POST /rooms/{code}/join` | 769.9 | 130 | 121 | 305 | 417 |
| `POST /ratings` | 168.3 | 596 | 499 | 1 347 | 2 275 |
| `GET /recommendations` | 325.1 | 309 | 294 | 512 | 637 |

All seven scenarios completed with zero failures. Absolute throughput is below the
baseline's 100-VU figures; given that the same gap exists at 10 VUs, this is the
host, not the code.

Two earlier 100-VU attempts in this session collapsed (scenarios completing zero
requests, no server-side errors — the baseline's documented 250-VU rig signature).
Both were run while the rating-service consumer was still chewing through a
10 000+ event backlog from the previous k6 rating scenario, on a Docker Desktop
backend that had already been through one crash. A fresh engine and a drained
backlog produced the clean run above. This attribution matters — see
*Architectural limitations*.

### Login

Unchanged and unchangeable without a policy decision: BCrypt caps logins at
~80–110 RPS on this hardware regardless of concurrency. It is the entry-point
bottleneck, it is CPU-bound in user-service, and it is a deliberate security
property, not an accident. Documented here so it stays a choice.

## Real-time latency

`benchmarks/realtime-latency.mjs`, 25 iterations, warm idle stack — full path
REST → Kafka → consumer → STOMP → subscribed client (same-process clocks):

| Event | avg ms (baseline) | med | p95 (baseline) | max | timeouts |
|---|---:|---:|---:|---:|---:|
| `USER_JOINED` | **7.5** (14.5) | 7 | **9** (23) | 9 | 0 |
| `RATING_SUBMITTED` | **8.7** (12.1) | 8 | **11** (19) | 14 | 0 |
| `RECOMMENDATIONS_GENERATED` | **25.1** (39.9) | 23 | **33** (64) | 47 | 0 |
| `DECISION_FINALIZED` | **27.4** (29.1) | 22 | **34** (59) | 133 | 0 |

24/25 iterations completed (one abandoned on a transport retry during setup, not an
event loss); zero event timeouts. Every event class is **faster than the baseline**,
most by ~35–45 % — consistent with the leaner consumer path (no more blanket
try/catch, and the eventType filter short-circuits non-rating events).

## Kafka

- Consumer lag on both topics: **0** after every test in this pass, including
  after a 1 000-record poison backlog and ~16 000 genuine rating events.
- Poison handling verified twice: once against the **real backlog** left on the
  broker by the baseline campaign (1 000 unparseable records — all parked on
  dead-letter topics, exactly 1 000 accounted for, valid events interleaved in
  the backlog processed normally), and once by fresh injection
  (`kafka-poison-test.sh`: consumer back to lag 0 within 30 s, record on
  `hbi.ratings.DLT`, bounded logging, CPU normal, next valid message consumed).
- Wedged-consumer cost, measured before the fix: lag pinned at 1 020, the
  rating service burning a **full core (105 % CPU) while idle**, and log volume
  so large that `docker compose logs` could not complete in 90 s.

## Before vs after

| Metric | Baseline | Current |
|---|---:|---:|
| Functional tests | 70/72 | **72/72** |
| Rating with a non-existent restaurant id | 200 accepted, counted toward completion, could force a decision | **422 rejected, never counted** |
| Joining a room after its blend finished | 200 admitted | **409 refused** (room `DECIDED` via Kafka) |
| First request after ~5 min idle | ~30 s hang (reproduced: 30.0 s, then 5.7 s, then 139 ms) | **0.18 s** after a 9-min idle window |
| Poison Kafka record | infinite retry, lag pinned, 105 % CPU, log flood | **≤3 attempts → DLT, lag 0 ≤ 30 s, CPU ~2 %** |
| Concurrent duplicate ratings | `duplicate key` 500s under load (6 observed) | **10/10 concurrent submissions → 200, one row** |
| `lower(email)` login lookup | Seq Scan (157 rows filtered) | **Index Scan**, 0.074 → 0.043 ms |
| Rating p95 @ 50 VUs | 159 ms | **150 ms** |
| Recommendations p95 @ 50 VUs | 201 ms | **113 ms** |
| Peak measured RPS | 3 499 (@100 VU) | 3 610 (@50 VU; 100-VU host-limited this session) |

## Bugs fixed

**BUG-1 (HIGH) — ratings accepted arbitrary restaurant ids.**
Root cause confirmed in code: `BlendService.saveRating` did no referential check and
`progress()` counted every rating a user had ever submitted against the shortlist
size, so bogus ids counted toward "finished" and could trigger auto-finalisation.
Fix: `saveRating` now resolves the room's frozen candidate set (freezing it first
if no one has fetched it yet) and rejects anything else with 422; `progress()`
counts only candidate ratings. Regression: 7 assertions, including "a user who
submits only bogus ids is never counted finished and never triggers a decision".

**BUG-2 (MED) — finished rooms kept admitting players.**
The join guard already existed (`RoomController.join` returns 409 for `DECIDED`
rooms); what was missing was anything server-side ever *setting* `DECIDED` — the
decision happens in the rating service's Kafka consumer, which cannot write room
state. Fix: `BlendService.finalise` publishes `DECISION_FINALIZED` on `hbi.ratings`
(same key, so ordered after the rating that caused it); a new room-service listener
consumes it, sets the room `DECIDED` and emits `ROOM_STATE_CHANGED`. The rating
service's own listener now filters on `eventType`, which it previously never
checked. Regression: 4 assertions (join before decision, auto-finalise, status
flips to DECIDED via Kafka, late join refused 409).

**BUG-3 (HIGH) — ~30 s hang on the first request after idle.**
Reproduced before fixing: after ~4.5 min of idle, a request through the gateway hung
the full 30 s client timeout with no response, the next took 5.7 s, the third 139 ms —
while a request straight to the service was instant. Cause consistent with the
baseline diagnosis: the gateway's Netty pool reusing keep-alive connections the
Docker network had silently dropped, with no idle bound and no response timeout
configured at all. Fix (gateway `application.yml`): pool `max-idle-time: 30s`,
`eviction-interval: 30s`, `connect-timeout: 3000`, and `response-timeout: 15s` as a
hard backstop. Verified: after a guaranteed 9-minute idle window, first proxied
request 183 ms, second 76 ms; gateway health and direct-service probes instant.

**BUG-4 (LOW) — concurrent duplicate ratings threw 500.**
Find-then-save race on the `(room, user, restaurant)` unique constraint. Fix: the
controller catches `DataIntegrityViolationException` and retries once — the retry
finds the now-existing row and applies the score as an update. The API returns 200
either way and exactly one row exists. Regression: 10 simultaneous identical
submissions → 10× 200, one row, correct score; sequential overwrite still works.

**BUG-5 (LOW) — `lower(email)` sequential scan.**
Both login and registration query on `lower(email)`, which the plain unique index
on `email` cannot serve. Hibernate cannot declare a functional index, so
`EmailIndexInitializer` creates `ix_hbi_user_email_lower` (unique, idempotent) at
startup. Verified by `EXPLAIN ANALYZE` before/after on the same data: Seq Scan
filtering 156 rows → Index Scan, 0.074 ms → 0.043 ms at 157 rows. Marginal today,
O(log n) from now on.

**BUG-6 (HIGH) — poison Kafka messages retried forever.**
The consumer used a bare `JsonDeserializer`; an unparseable record threw before the
listener, the offset never advanced, and the container retried it indefinitely —
the baseline campaign's 1 000 raw perf-test records produced 1.35 M error log lines,
and this session found the consumer still wedged on that same backlog (lag 1 020,
105 % CPU, unusable logs). Fix: `ErrorHandlingDeserializer` wrappers on both
consumers, plus a `DefaultErrorHandler` with `FixedBackOff(1s, 2)` and a
`DeadLetterPublishingRecoverer` publishing to `<topic>.DLT` (explicit resolver —
this spring-kafka version's default suffix is `-dlt`). Deserialization failures
skip retries entirely. The room service's new consumer gets the same deserializer
protection with bounded retry + log-and-skip (no second DLT copy of the same
record). Verified against the real 1 000-record backlog *and* fresh injection;
exactly 1 000 records accounted for on the dead-letter topics, lag 0, valid
messages interleaved with poison processed normally.

## Remaining bugs

- **The candidate-freeze race** documented in the README is still present: two
  players fetching the shortlist at the same moment can collide on the unique
  constraint; one request 500s and the retry succeeds. Unchanged by this pass.
- **A rating burst degrades the stack for minutes afterwards** (new finding, see
  below). Not user-visible at human rating rates; very visible under k6.
- Login above ~80–110 RPS saturates a core per ~110 hashes/s (BCrypt, by design).

## Architectural limitations

- **Per-event re-scoring is the real scalability ceiling, not the broker.** Every
  `RATING_SUBMITTED` event triggers a full room re-score: progress (REST to
  room-service), recompute (REST to restaurant-service + delete/insert of the
  stored ranking), completion check (second progress call). Measured drain rate on
  an idle stack: ~40–70 events/s. A k6 scenario that pushes ~11 000 rating events
  in 20 s therefore leaves **minutes** of single-partition backlog, during which
  the consumer's REST fan-out and DB churn degrade every other endpoint — this is
  what sank two of this session's 100-VU runs. At human rates (a room of 8 people
  rating 8 restaurants) it is irrelevant. The right fix, if load matters, is
  coalescing: re-score a room at most once per short window rather than once per
  event.
- **One Kafka broker, one partition per topic, RF 1** — unchanged; caps consumer
  parallelism at one instance and has no redundancy.
- **In-memory STOMP broker** — unchanged; still the documented barrier to running
  two rating-service replicas, still unverified by measurement (the scaling probe
  exists but was not run in this pass either).
- **`ddl-auto: update`, no migrations** — unchanged, plus the 26 benign-but-noisy
  constraint warnings at every boot. `EmailIndexInitializer` is a small step
  outside that model and would fold naturally into Flyway later.
- **Membership still ignores disconnects** — closing the browser leaves a player
  active and counted toward "everyone finished" until they explicitly leave or
  are removed. Divergence from HBI Web, unchanged.
- **`auto-offset-reset: latest`** — events produced while a consumer is down are
  skipped on its first-ever boot (no committed offset). With committed offsets
  and the DLT in place this matters less than it did.
- **The 3.96 GB Docker VM remains the binding constraint of the test rig.**
  Docker Desktop itself failed twice during this session (once during five
  concurrent in-container Maven builds, once degrading silently until restarted);
  the application containers survived both with data intact.

## Deployment readiness

| Aspect | State |
|---|---|
| Local Docker | Solid. `docker compose up --build` from clean → all healthy. Survived two engine crashes with volumes intact. |
| AWS readiness | Good for a single VM (t3.medium+) per DEPLOYMENT.md. Kafka hardening now makes unattended operation plausible. |
| Secrets | `.env`-based, no defaults in code, JWT ≥32 chars enforced. Fine for a VM; would move to SSM/Secrets Manager if managed services enter. |
| Database | Per-service Postgres on volumes; pg_dump backup procedure documented. No migrations (accepted risk). |
| HTTPS | Not in the stack, by design — Caddy/nginx recipe in DEPLOYMENT.md handles TLS + WebSocket upgrade. |
| WebSockets | Work through the frontend proxy and gateway; token-authenticated at both layers. Single-instance only (SimpleBroker). |
| Monitoring | Actuator health/info/metrics on every service; compose healthchecks. No dashboards/alerts (acceptable at this scale). |
| Port exposure | Compose publishes every service and DB port to the host — right for development, wrong for a public VM. The `docker-compose.prod.yml` override in DEPLOYMENT.md (§ Locking down the ports) is **required**, not optional, before any public deployment: services trust the gateway's `X-User-Id` header, so a reachable :8082 is an authentication bypass. |

## Recommended next phases

### Must do before AWS

1. **Create the `docker-compose.prod.yml` port-lockdown override and deploy with
   it.** Why: published service ports + header-trust = identity spoofing for
   anyone who can reach the VM. Complexity: minutes (the file is already written
   out in DEPLOYMENT.md). Necessary: absolutely.
2. **TLS via Caddy exactly as DEPLOYMENT.md describes.** Why: JWTs and passwords
   in cleartext otherwise; browsers increasingly refuse insecure WebSockets.
   Complexity: low. Necessary: yes for anything public.
3. **Real secrets in `.env` on the VM** (generated JWT secret, strong DB
   password) and a cron'd `pg_dump`. Complexity: trivial. Necessary: yes.

### Should do

1. **Coalesce consumer re-scoring** (at most one recompute per room per, say,
   250 ms). Why: turns the measured burst-backlog weakness into a non-issue and
   is a genuinely good talking point (measured problem → targeted fix →
   re-measured). Complexity: moderate (a small per-room debounce in the
   listener). CV/viva value: high.
2. **Flyway migrations** replacing `ddl-auto: update`. Why: kills the 26 boot
   warnings, makes schema changes deployable, folds in the email index; it is
   the first thing a reviewer of "cloud-ready" claims looks for. Complexity:
   low-moderate (four small baseline migrations). CV/viva value: high.
3. **Basic login rate limiting at the gateway** (e.g. token-bucket per IP on
   `/api/users/login`). Why: BCrypt's 110 hashes/s makes login a cheap DoS
   target; a limiter converts a measured bottleneck into a defended one.
   Complexity: low (Spring Cloud Gateway has a filter; or document the decision
   not to). CV/viva value: moderate.
4. **Run the already-written resilience and scaling probes**
   (`resilience.mjs`, `scaling-probe.mjs`) on a quiet rig. Why: they exist, they
   answer the two remaining unverified claims (recovery behaviour, SimpleBroker
   scaling barrier), and they cost only run time. Complexity: trivial.

### Nice to have

- **Managed Postgres (RDS)** for one or all services — the compose override is
  already documented; mostly a cost/effort call for a college project.
- **Member liveness** (mark inactive on WebSocket disconnect after a grace
  period) — closes the "walked away, blocks the room" gap; needs care with the
  service boundary (the hub is in rating-service, membership in room-service —
  an event on the existing topics would fit the architecture).
- **A `/metrics`-scraping Prometheus + Grafana pair** — nice demo material, real
  operational value only beyond a single VM.

### Do not do

- **Kubernetes, service mesh, Redis, Elasticsearch, GraphQL, CQRS, event
  sourcing, a second broker, more microservices.** Nothing in the measured
  behaviour of this system needs any of them; each would add operational surface
  to a stack whose binding constraint is a 4 GB VM. The five-service shape with
  two Kafka topics is the right size for this product.
- **Multi-partition topics / consumer groups scaling** — pointless while there
  is one consumer instance, and the ordering-per-room guarantee (keyed by room
  code) is worth keeping simple.
- **Raising BCrypt throughput by lowering the work factor** — do not trade the
  security property for a benchmark number; rate-limit instead.

---

*Test artefacts from this pass: `benchmarks/regression.mjs`,
`benchmarks/kafka-poison-test.sh`, k6 JSON summaries under
`benchmarks/results/post-k6-*.json`.*
