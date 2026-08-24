# HBI Cloud

The third implementation of **Hungry but Indecisive?** — the same product as HBI Web and
HBI Mobile, rebuilt as a cloud-native system.

| Implementation | Stack | Status |
|---|---|---|
| **HBI Web** | HTML/CSS/JS + Node.js + Express + **Socket.IO** | existing, untouched |
| **HBI Mobile** | Android (Java/XML) + **Firebase** | existing, untouched |
| **HBI Cloud** | React + Vite → **Spring Cloud Gateway** → Spring Boot microservices, **REST + Kafka + STOMP WebSocket**, database-per-service, Docker | this directory |

HBI Cloud is a **separate implementation**. It shares HBI's business logic, cuisines,
food imagery and branding, but none of its code, and it does not modify or depend on
`web/` or `mobile/` in any way.

---

## Contents

- [Architecture](#architecture)
- [Services](#services)
- [Running it](#running-it)
- [API reference](#api-reference)
- [Kafka events](#kafka-events)
- [Real-time communication](#real-time-communication)
- [Databases](#databases)
- [Authentication](#authentication)
- [Recommendation algorithm](#recommendation-algorithm)
- [Monitoring](#monitoring)
- [Testing](#testing)
- [Deployment](#deployment)
- [Design decisions](#design-decisions)
- [Limitations](#limitations)

---

## Architecture

```text
                          HBI CLOUD WEB
                    React + Vite (nginx, :5173)
                                |
                        REST /api  +  WS /ws
                                |
                                v
                        API GATEWAY  :8080
                     Spring Cloud Gateway
                     verifies JWT, routes
                                |
        +-----------------+-----+------------+-----------------+
        |                 |                  |                 |
        v                 v                  v                 v
   USER SERVICE      ROOM SERVICE     RESTAURANT SERVICE   RATING / DECISION
      :8081            :8082               :8083            SERVICE  :8084
        |                 |                  |                 |
        v                 v                  v                 v
    user_db           room_db          restaurant_db        rating_db
                          |                  ^                 |
                          |                  | REST            |
                          |                  +-----------------+
                          |                                    |
                    hbi.room-events                      hbi.ratings
                          |                                    |
                          +---------------> KAFKA <------------+
                                              |
                                              v
                                   RATING / DECISION SERVICE
                                    consumes both topics,
                                    re-scores, decides
                                              |
                                     STOMP over WebSocket
                                              |
                                              v
                                     ALL CONNECTED BROWSERS
```

The browser only ever talks to the gateway. Services reach each other by Docker
service name — synchronously over REST where an answer is needed immediately, and
asynchronously over Kafka where it is not.

### The user journey

```text
Enter your name          (anonymous session, user-service)
      v
Create or Join Room      (room-service)
      v
Room Lobby               (live via WebSocket)
      v
Select Cuisines          (plus budget and distance)
      v
Rate, one at a time      (the EAT-O-METER, 1..5, NEXT reveals the next candidate)
      v
See Group Progress       (live)
      v
Recommendations          (deterministic scoring)
      v
Final Restaurant         (auto once everyone finishes, or host decides)
```

---

## Services

Five backend services — no more. Preferences, ratings, scoring and the decision all
live together in one service because they are one workflow over one dataset.

| Service | Port | Owns | Talks to |
|---|---|---|---|
| **api-gateway** | 8080 | Routing, JWT verification, the single public entry point | all services |
| **user-service** | 8081 | Anonymous player sessions, JWT issuing, profiles | `user_db` |
| **room-service** | 8082 | Rooms, membership, room state | `room_db`, Kafka (produces) |
| **restaurant-service** | 8083 | Restaurant catalogue, cuisine/budget/distance filtering | `restaurant_db` |
| **rating-service** | 8084 | Preferences, ratings, recommendations, final decision, **WebSocket hub** | `rating_db`, Kafka (produces + consumes), room-service and restaurant-service over REST |
| **frontend** | 5173 | React SPA, nginx, proxies `/api` and `/ws` to the gateway | api-gateway |

---

## Running it

### Prerequisites

- Docker Desktop (or Docker Engine) with Compose v2
- Roughly 4 GB of free RAM — the stack runs four Postgres instances and a Kafka broker

### Start everything

```bash
cd cloud
cp .env.example .env
# edit .env and set a real JWT_SECRET (at least 32 characters)

docker compose up --build
```

Then open **http://localhost:5173**.

To try the multiplayer flow, open a second tab (each tab is its own player), enter a
different name and join with the room ID shown in the lobby. No account or login is
needed — see [Session model](#authentication).

Other devices on the same network can play too: open
`http://<this-machine's-LAN-IP>:5173` from a phone or laptop. The frontend calls the
API and WebSocket on whatever host the page was opened from, and nginx forwards the
original `Host` header, so no configuration is needed for this. `CORS_ALLOWED_ORIGINS`
in `.env` only matters for genuinely cross-origin setups (e.g. the Vite dev server
talking to the gateway directly).

### Everyday commands

```bash
docker compose ps                        # what is running
docker compose logs -f rating-service    # follow one service
docker compose down                      # stop
docker compose down -v                   # stop and wipe the databases
```

### Running a service outside Docker

Each service is a standalone Maven project and reads its configuration from the
environment, so it can be run directly once its database and Kafka are up:

```bash
docker compose up -d user-db room-db restaurant-db rating-db kafka

cd cloud/user-service
JWT_SECRET=your-long-dev-secret-at-least-32-characters \
DATABASE_URL=jdbc:postgresql://localhost:5433/user_db \
  mvn spring-boot:run
```

The default ports in `application.yml` already point at the host-published database
ports (5433–5436) and Kafka on `localhost:29092`.

### Frontend in dev mode

```bash
cd cloud/frontend
npm install
npm run dev            # http://localhost:5173, proxies /api and /ws to :8080
```

### Build the backend without Docker

```bash
cd cloud
mvn -DskipTests package      # builds all five services
mvn test                     # runs the unit tests
```

---

## API reference

Everything is served through the gateway at `http://localhost:8080`.
All endpoints except session creation and restaurant reads need
`Authorization: Bearer <jwt>`.

### User service — `/api/users`

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/users/session` | Start an anonymous session. `{displayName}` → `{token, expiresInSeconds, user}` |
| `GET` | `/api/users/{id}` | Fetch a player's profile |
| `PUT` | `/api/users/{id}` | Update your own display name |

### Room service — `/api/rooms`

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/rooms` | Create a room; the caller becomes host → 201 |
| `POST` | `/api/rooms/{roomId}/join` | Join (or rejoin) a room, max 8 players |
| `GET` | `/api/rooms/{roomId}` | Room with its members |
| `GET` | `/api/rooms/{roomId}/members` | Members only |
| `DELETE` | `/api/rooms/{roomId}/members/{userId}` | Leave, or be removed by the host |
| `PUT` | `/api/rooms/{roomId}/status` | Host advances `LOBBY → PREFERENCES → RATING → DECIDED` |

`{roomId}` is the shareable room code, e.g. `HBI7X92`.

### Restaurant service — `/api/restaurants`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/restaurants` | Whole catalogue |
| `GET` | `/api/restaurants?cuisine=Chinese` | Filter by cuisine (comma-separated for several) |
| `GET` | `/api/restaurants?budget=500` | Cost for two at most 500 |
| `GET` | `/api/restaurants?maxDistanceKm=4` | Within 4 km |
| `GET` | `/api/restaurants?ids=1,2,3` | Bulk lookup (used by the rating service) |
| `GET` | `/api/restaurants/cuisines` | Distinct cuisine list |
| `GET` | `/api/restaurants/{id}` | One restaurant |

### Rating / decision service — `/api/rooms/{roomId}/…`

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/rooms/{roomId}/preferences` | `{cuisines[], maxBudget, maxDistanceKm}` |
| `GET` | `/api/rooms/{roomId}/preferences` | Merged group preferences plus each player's |
| `GET` | `/api/rooms/{roomId}/candidates` | The frozen shortlist this room is rating |
| `POST` | `/api/rooms/{roomId}/ratings` | `{restaurantId, score}` (1–5) → publishes `RATING_SUBMITTED` |
| `GET` | `/api/rooms/{roomId}/ratings` | All ratings plus group progress |
| `GET` | `/api/rooms/{roomId}/recommendations` | Ranked candidates with their scores |
| `POST` | `/api/rooms/{roomId}/finalize` | Host locks in the top result |
| `GET` | `/api/rooms/{roomId}/decision` | The final restaurant (404 until decided) |

`/api/rooms/**` is shared by two services. The gateway routes the six paths above to
the rating service (`order: 0`) and everything else under `/api/rooms/**` to the room
service (`order: 10`).

---

## Kafka events

Two topics, both load-bearing. Kafka is used where the work is genuinely asynchronous
and nowhere else — every read and every write the user waits on is plain REST.

### `hbi.ratings` — decoupling the write from the scoring

```text
POST /api/rooms/{id}/ratings
        |
        v  store the rating, return 200 immediately
   rating-service
        |
        v  RATING_SUBMITTED
      KAFKA
        |
        v
   decision engine: re-score the room, push the new ranking,
                    and finalise if everyone has finished
```

```json
{
  "eventType": "RATING_SUBMITTED",
  "roomId": "HBI7X92",
  "userId": 102,
  "restaurantId": 14,
  "score": 5,
  "occurredAt": "2026-08-23T10:15:30Z"
}
```

### `hbi.room-events` — lobby changes reaching the browsers

The room service knows nothing about WebSockets. It publishes what happened; the
rating service, which owns the hub, turns that into a browser push.

```text
room-service  --(USER_JOINED)-->  KAFKA  -->  rating-service  -->  STOMP  -->  browsers
```

Event types: `ROOM_CREATED`, `USER_JOINED`, `USER_LEFT`, `ROOM_STATE_CHANGED`.

```json
{
  "eventType": "USER_JOINED",
  "roomId": "HBI7X92",
  "status": "LOBBY",
  "hostUserId": 101,
  "userId": 102,
  "displayName": "Bob",
  "occurredAt": "2026-08-23T10:14:02Z"
}
```

Messages are keyed by room code, so all events for one room stay on one partition and
therefore stay in order.

---

## Real-time communication

HBI Web uses Socket.IO. HBI Cloud deliberately does **not** copy that: it uses
**STOMP over WebSocket**, hosted by the rating service and proxied through the gateway.

- Endpoint: `/ws`, reached at `ws://localhost:5173/ws` → gateway → rating service.
  Native WebSocket is what the app uses; a SockJS fallback endpoint is registered on
  the same path for networks that block upgrades.
- Authentication: `?token=<jwt>` — a browser cannot set headers on a WebSocket
  upgrade, so the token rides in the query string. The **gateway** verifies it before
  proxying the upgrade, because once the gateway has accepted an upgrade a downstream
  rejection no longer closes the client's socket. The rating service verifies it again
  during the handshake, which is what protects it if it is ever reached directly.
- Subscription: `/topic/rooms/{roomCode}`

Every message uses one envelope:

```json
{
  "type": "DECISION_FINALIZED",
  "roomId": "HBI7X92",
  "payload": { "...": "..." },
  "timestamp": "2026-08-23T10:20:11Z"
}
```

| `type` | Sent when |
|---|---|
| `ROOM_CREATED` | a room is opened |
| `USER_JOINED` | someone joins |
| `USER_LEFT` | someone leaves |
| `ROOM_STATE_CHANGED` | the host advances the room |
| `RATING_SUBMITTED` | a rating lands |
| `RATING_PROGRESS` | group progress changes |
| `RECOMMENDATIONS_GENERATED` | the ranking is recomputed |
| `DECISION_FINALIZED` | the restaurant is chosen |

The last four all originate from a Kafka consumer, so the diagram in the brief —
*browser → gateway → service → Kafka → decision → WebSocket → all browsers* — is the
real code path, not a drawing.

---

## Databases

Database per service. Four separate PostgreSQL **instances**, not four schemas in one
server, so there is no way for one service to read another's tables.

| Service | Database | Host port | Tables |
|---|---|---|---|
| user-service | `user_db` | 5433 | `hbi_user` |
| room-service | `room_db` | 5434 | `room`, `room_member` |
| restaurant-service | `restaurant_db` | 5435 | `restaurant` |
| rating-service | `rating_db` | 5436 | `preference`, `rating`, `room_candidate`, `recommendation`, `decision` |

When the rating service needs to know who is in a room, it calls
`GET /api/rooms/{code}/members` on the room service. It never opens a connection to
`room_db`.

Schemas are created by Hibernate (`ddl-auto: update`) and `restaurant_db` is seeded on
first boot with 33 restaurants across HBI's eight cuisines.

### Demo restaurant data

PostgreSQL is the single source of truth for restaurant data. `RestaurantSeeder`
populates the `restaurant` table **only when it is empty**; after that, edit the
data directly in `restaurant_db` — no Java changes, no extra config files.

Connect (stack running):

```bash
docker compose exec restaurant-db psql -U hbi restaurant_db
# or from the host: psql -h localhost -p 5435 -U hbi restaurant_db   (password: hbi)
```

Columns: `name`, `cuisine`, `signature_dish`, `avg_cost_for_two` (rupees),
`distance_km`, `base_rating` (display hint out of 5), `image_url`, `area`.

```sql
-- inspect
SELECT id, name, cuisine, signature_dish, avg_cost_for_two, area FROM restaurant;

-- modify a restaurant / dish / image
UPDATE restaurant SET name = 'New Name' WHERE id = 1;
UPDATE restaurant SET signature_dish = 'Vada Pav', image_url = '/images/samosa.jpg' WHERE id = 2;

-- add one (image_url must point at a file in cloud/frontend/public/images/)
INSERT INTO restaurant (name, cuisine, signature_dish, avg_cost_for_two, distance_km, base_rating, image_url, area)
VALUES ('Chai Point', 'Beverages', 'Chai', 100, 0.5, 4.1, '/images/coffee.jpg', 'Vile Parle');

-- remove one
DELETE FROM restaurant WHERE id = 3;
```

Changes are live immediately — the service reads the database on every request.
(Rooms that already froze their shortlist keep rating the restaurants they started
with; new rooms pick up the new data.)

To go back to the stock demo dataset, empty the table and restart the service so the
seeder runs again:

```bash
docker compose exec restaurant-db psql -U hbi restaurant_db -c "TRUNCATE restaurant"
docker compose restart restaurant-service
```

(`docker compose down -v` wipes all four databases and reseeds on the next start.)
The seed list itself lives in
`restaurant-service/src/main/java/io/hbi/cloud/restaurant/RestaurantSeeder.java` —
edit it only if you want a different *default* dataset baked into the image.

### Room lifecycle

Rooms are garbage-collected by inactivity, not by age. Every join, leave, status
change and rating refreshes the room's `last_activity_at` (ratings reach the room
service via the Kafka events it already consumes). A scheduled sweep in the room
service (`CLEANUP_INTERVAL_MS`, default hourly) deletes rooms whose activity is
older than `ROOM_TTL_HOURS` (default 24 h) together with their `room_member` rows,
and publishes `ROOM_DELETED` on `hbi.room-events`; the rating service consumes that
and deletes the room's preferences, ratings, candidates, recommendations and
decision. Deletes are idempotent and members go before their room, so a partially
completed sweep simply finishes on the next pass. An in-progress room is never
deleted while anyone is playing — activity keeps it alive; DECIDED and abandoned
rooms age out. Explicit Leave (with host handoff) and refresh/rejoin behaviour are
unchanged: a temporary disconnect never touches membership.

---

## Authentication

**Anonymous session-based players authenticated using short-lived JWT session
tokens.** There are no user accounts: no registration, no passwords, no login.

The first thing a player does is type a display name; the frontend turns that into
an anonymous session:

```text
POST /api/users/session   {"displayName": "Alice"}
        |
   user-service stores an anonymous player row (id + display name)
   and signs a short-lived HS256 JWT for it
        |
        v
   frontend keeps it in sessionStorage and sends  Authorization: Bearer <jwt>
        |
        v
   API GATEWAY verifies the signature, then stamps
   X-User-Id / X-User-Name onto the proxied request
        |
        v
   the service trusts those two headers
```

The JWT is what carries the authenticated session identity between the client, the
gateway and the microservices — two sessions are two different players, which is how
everyone in a room is told apart. The session lives in `sessionStorage`, so each
browser tab is a separate player and a refresh keeps the player in their room;
closing the tab ends the session. Tokens expire after `JWT_TTL_MINUTES`
(default 12 h); after that the player simply enters a name again.

### The mechanics

- `JWT_SECRET` comes from the environment; every service that needs it refuses to
  start if it is missing or shorter than 32 characters. There is no default in code.
- The gateway **strips** any `X-User-Id` / `X-User-Name` a client tries to send before
  adding its own, so identity cannot be spoofed from outside.
- Public routes: `POST /api/users/session`, `GET /api/restaurants/**`, `/ws/info`
  (a SockJS capability probe carrying no data), and the actuator health endpoints.
- WebSocket upgrades are authenticated at the gateway from the `token` query
  parameter — see [Real-time communication](#real-time-communication).

---

## Recommendation algorithm

Deterministic and explainable — no machine learning. Each shortlisted restaurant gets
five normalised (0–1) signals, combined with fixed weights:

| Signal | Meaning | Weight |
|---|---|---|
| `groupRating` | average submitted score ÷ 5 | 0.50 |
| `cuisineFit` | share of players who asked for that cuisine | 0.20 |
| `budgetFit` | share of players whose budget covers it | 0.12 |
| `distanceFit` | share of players willing to travel that far | 0.10 |
| `coverage` | share of players who actually rated it | 0.08 |

Ties break on restaurant id, so the same inputs always produce the same ranking.
A player who picks no cuisine counts as happy with everything.

The shortlist itself is built from the merged group preferences (union of cuisines,
the most generous budget and distance in the room), capped at `BLEND_SHORTLIST_SIZE`
(default 8) and then **frozen**, so a late joiner cannot change what everyone else is
already rating. If nothing matches, it falls back to the full catalogue rather than
showing an empty screen — the same safety net HBI Web has.

---

## Monitoring

Every service exposes Spring Boot Actuator:

```bash
curl http://localhost:8080/actuator/health     # gateway
curl http://localhost:8081/actuator/health     # user
curl http://localhost:8082/actuator/health     # room
curl http://localhost:8083/actuator/health     # restaurant
curl http://localhost:8084/actuator/health     # rating

curl http://localhost:8084/actuator/info
curl http://localhost:8084/actuator/metrics
curl http://localhost:8080/actuator/gateway/routes   # what the gateway is routing
```

`/actuator/health` includes the database (and, where applicable, Kafka) status, and is
what the Compose healthchecks poll.

---

## Testing

### Unit tests

```bash
cd cloud
mvn test
```

`RecommendationEngineTest` covers the scoring: ranking by group rating, cuisine and
budget/distance influence, tie-breaking determinism, and unrated candidates.

### End-to-end smoke test

With the stack running:

```bash
cd cloud/frontend && npm install    # once, for the STOMP client
cd ..
node scripts/smoke-test.mjs                        # Node 22+
node --experimental-websocket scripts/smoke-test.mjs   # Node 21 and older
```

It drives the complete journey through the gateway with two players — 53 assertions
covering anonymous sessions, gateway authentication, catalogue filtering, rooms,
preferences, rating, scoring, the decision and leaving.

The parts worth pointing at:

- It subscribes over WebSocket **before** the second user joins, so `USER_JOINED`,
  `RATING_SUBMITTED`, `RECOMMENDATIONS_GENERATED` and `DECISION_FINALIZED` can only
  reach it by way of Kafka. If the broker were doing nothing, those four fail.
- It checks that a spoofed `X-User-Id` header, a bogus WebSocket token and a missing
  WebSocket token are all rejected.
- It checks that a non-host can neither advance the room nor finalise the blend.
- It confirms the shortlist is frozen — both players get the same list — and that the
  restaurant the group scored highest is the one actually chosen.

To see the events on the wire while it runs:

```bash
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server kafka:9092 --topic hbi.ratings --from-beginning
```

---

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for deploying to a cloud VM.

---

## Design decisions

Choices worth defending, and why the simpler option won.

**Five services, not ten.** Preferences, ratings, scoring and the decision are one
workflow over one dataset; splitting them would have meant distributed transactions
for no benefit. The brief's optional Recommendation Service is a class
(`RecommendationEngine`) inside the rating service instead.

**The WebSocket hub lives in the rating service.** It is the component that produces
the events players are waiting for. A separate real-time service would have needed
every event forwarded to it and added a hop for nothing.

**Kafka in exactly two places.** Where the work is genuinely asynchronous (scoring
after a rating) and where a service should not need to know about WebSockets (room
events reaching browsers). Everything the user waits on is REST.

**No service discovery.** Docker's DNS resolves service names; Eureka would be
ceremony. Service URLs are environment variables, so they change per environment.

**No Redis, no CQRS, no event sourcing, no Kubernetes.** Nothing in HBI needs them.

**The room shortlist is frozen once.** The alternative — recomputing candidates on
every request — produced a different rating screen for each player.

**`GET /recommendations` scores on read instead of returning the stored ranking.**
The stored rows are written by the Kafka consumer, so they can lag a rating that was
accepted a moment earlier; a player refreshing the page would have seen a stale order.
Scoring is deterministic and the shortlist is eight rows, so recomputing is cheaper
than explaining the staleness. The stored ranking still backs the WebSocket push.

**Hibernate `ddl-auto: update`.** Appropriate for a project that is rebuilt from
scratch; Flyway would be the first change for anything longer-lived.

---

## Limitations

Known and deliberate:

- **`ddl-auto: update`** manages the schema. There are no migrations, so a destructive
  model change would need `docker compose down -v`.
- **Services trust the gateway's `X-User-Id` header.** That is sound only because
  nothing but the gateway is reachable from outside. If a service were exposed
  directly, it would need to verify the JWT itself.
- **One Kafka broker, one partition per topic, replication factor 1.** Fine for a
  demo; not a highly available setup.
- **The STOMP broker is Spring's in-memory `SimpleBroker`.** Running two rating-service
  replicas would mean a browser only receives events from the instance it happens to be
  connected to. A shared broker (or Kafka-fed fan-out per instance) would be needed to
  scale out.
- **The candidate shortlist freeze is last-writer-loses.** Two players requesting it
  at the exact same moment can collide on the unique constraint; the loser detects the
  collision and returns the winner's frozen shortlist, so both players always rate the
  same list.
- **No refresh tokens.** A session JWT lasts 12 hours by default; after that the
  player simply enters a name again.
- **Restaurant data is fictional** and seeded locally. There is no maps or delivery
  integration, and `distanceKm` is a fixed attribute rather than a real distance from
  the user.
- **Room cleanup is activity-based, not presence-based.** A player who closes the
  browser stays flagged active (a refresh must be able to resume, so a WebSocket
  drop never touches membership); an abandoned room therefore lingers until the
  TTL sweep removes it (`ROOM_TTL_HOURS`, default 24 h). Mid-blend, the host's
  "blend now" remains the escape hatch for a room stuck waiting on a vanished
  player.
