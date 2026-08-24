# Deploying HBI Microservices

HBI Microservices is designed to run on a single VM with Docker Compose — the steps
below target a cloud VM (e.g. AWS EC2), which is a documented deployment path, not a
deployment that currently exists. That is the right size for this system: one broker,
a few small databases and a handful of services. There is no Kubernetes, and none is
needed.

---

## What you need

- A Linux VM with **2 vCPU and 4 GB RAM** (AWS `t3.medium`, GCP `e2-medium`, Azure
  `B2s`, or any DigitalOcean/Hetzner equivalent). 2 GB is not enough once four
  Postgres instances and Kafka are running.
- 20 GB of disk.
- Docker Engine and the Compose plugin.
- Inbound TCP **80** and **443** open. Nothing else should be exposed — see
  [Locking down the ports](#locking-down-the-ports).

---

## 1. Prepare the VM

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker            # or log out and back in

docker --version && docker compose version
```

---

## 2. Get the code

```bash
git clone https://github.com/Solly2201/HBI.git
cd HBI/distributed
```

---

## 3. Configure

```bash
cp .env.example .env
```

Generate a real signing key and put it in `.env`:

```bash
openssl rand -base64 48
```

```dotenv
JWT_SECRET=<the value you just generated>
JWT_TTL_MINUTES=720

DATABASE_USERNAME=hbi
DATABASE_PASSWORD=<a strong password>

BLEND_SHORTLIST_SIZE=12
```

Every setting the services read comes from the environment:

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | all four data services | JDBC URL (Compose injects the per-service value) |
| `DATABASE_USERNAME` | all four data services | Database user |
| `DATABASE_PASSWORD` | all four data services | Database password |
| `JWT_SECRET` | gateway, user-service, rating-service | HS256 signing key, minimum 32 characters |
| `JWT_TTL_MINUTES` | user-service | Token lifetime |
| `KAFKA_BOOTSTRAP_SERVERS` | room-service, rating-service | Broker address |
| `KAFKA_RATINGS_TOPIC` | rating-service | Default `hbi.ratings` |
| `KAFKA_ROOM_EVENTS_TOPIC` | room-service, rating-service | Default `hbi.room-events` |
| `BLEND_SHORTLIST_SIZE` | rating-service | Food items per blend (players may stop after half) |
| `ROOM_TTL_HOURS` | room-service | Idle rooms older than this are swept (default 24 h) |
| `CLEANUP_INTERVAL_MS` | room-service | How often the TTL sweep runs (default hourly) |
| `RESCORE_INTERVAL_MS` | rating-service | Re-score a room at most once per window (default 250 ms) |
| `SESSION_RATE_CAPACITY` | api-gateway | Anonymous-session burst per caller (default 60) |
| `SESSION_RATE_REFILL_PER_MINUTE` | api-gateway | Session tokens regained per minute (default 60; consider 10 in production) |
| `CORS_ALLOWED_ORIGINS` | api-gateway | Only needed for `npm run dev` |
| `*_SERVICE_URL` | gateway, rating-service | Internal addresses, set by Compose |
| `REDIS_HOST` / `REDIS_PORT` | rating-service | WebSocket fan-out channel, set by Compose |

### Secrets

- **Local/demo defaults**: `.env.example` ships placeholder values (`hbi`/`hbi`
  database credentials, a dummy JWT secret). They are fine on a laptop and
  nowhere else.
- **Production secrets**: generate a fresh `JWT_SECRET` (`openssl rand -base64 48`)
  and a strong `DATABASE_PASSWORD`, and put them only in the `.env` file on the
  VM. There are no secret defaults in code — every service that needs
  `JWT_SECRET` refuses to start without one of at least 32 characters.
- **Never commit** `.env`, generated keys, TLS certificates, or database dumps.
  `.env` is already covered by `.gitignore`; keep it that way.

---

## 4. Start

```bash
docker compose up --build -d
docker compose ps
```

The first build takes several minutes — it compiles five Maven projects and the React
app. Wait until every service reports `healthy`:

```bash
watch docker compose ps
```

Verify:

```bash
curl -s localhost:8080/actuator/health
curl -s localhost:8080/api/foods/cuisines
curl -s localhost:5173 | head -5
```

The application is on **port 5173**.

---

## 5. Put it behind a real hostname

The `frontend` container already runs nginx and proxies `/api` and `/ws` to the
gateway. For a public deployment, add a TLS terminator in front of it.

Install Caddy — it obtains and renews certificates automatically and handles the
WebSocket upgrade without extra configuration:

```bash
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddyfile
hbi.example.com {
    reverse_proxy localhost:5173
}
```

```bash
sudo systemctl reload caddy
```

That is all — HTTPS, HTTP/2 and the WebSocket upgrade for `/ws` work out of the box.

**Where TLS terminates.** At the reverse proxy (Caddy or nginx) on the VM — nothing
inside the Docker network speaks TLS, and nothing needs to: with the production
override the only listener the proxy can reach is the loopback-bound frontend. Port
**443** is the public port; run HTTP (80) only as a redirect to HTTPS, never as the
production protocol — the JWT rides in an `Authorization` header and in the WebSocket
query string, so plaintext HTTP would expose sessions. Certificates are obtained and
renewed by Caddy automatically (or supplied to nginx via Let's Encrypt); they live on
the VM and are never committed to the repository.

To be explicit about status: this TLS setup is **documented configuration, not a
running deployment** — there is currently no public HTTPS endpoint for HBI.

<details>
<summary>nginx instead of Caddy</summary>

```nginx
server {
    listen 443 ssl http2;
    server_name hbi.example.com;

    ssl_certificate     /etc/letsencrypt/live/hbi.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hbi.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:5173;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # required for /ws
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

</details>

---

## Locking down the ports

`docker-compose.yml` publishes the service and database ports to the host because that
is convenient while developing. **On a public VM, stop publishing them** — the backend
services trust the identity headers stamped by the gateway, so a directly reachable
service port is an authentication bypass, and the databases and Kafka must never face
the Internet.

The override is committed as **`docker-compose.prod.yml`**. It unpublishes every
service, database and Kafka port and binds the frontend to loopback only
(`127.0.0.1:5173`), for the reverse proxy to front:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Public/internal split with the override active:

| Reachable from outside | Everything else |
|---|---|
| reverse proxy :80/:443 → frontend `127.0.0.1:5173` | gateway, user/room/food/rating services, all four PostgreSQL instances, Kafka — Docker-network only |

The browser still reaches the API and WebSocket because the frontend's nginx proxies
`/api` and `/ws` to the gateway *inside* the Docker network. Confirm nothing else is
published with `docker compose ps` and `sudo ss -tlnp`.

Local development keeps using plain `docker compose up` with all ports published —
nothing about the dev workflow changes.

---

## Using managed databases

To swap a service onto RDS / Cloud SQL / Azure Database, point its `DATABASE_URL` at
the managed instance and drop the local container:

```yaml
services:
  user-service:
    environment:
      DATABASE_URL: jdbc:postgresql://user-db.abc123.eu-west-1.rds.amazonaws.com:5432/user_db
      DATABASE_USERNAME: ${RDS_USERNAME}
      DATABASE_PASSWORD: ${RDS_PASSWORD}
    depends_on: !reset []
```

Keep one database per service — that boundary is the point of the architecture.
The same applies to Kafka: set `KAFKA_BOOTSTRAP_SERVERS` to an MSK / Confluent Cloud
endpoint and remove the `kafka` service.

---

## Operating it

```bash
docker compose logs -f                     # everything
docker compose logs -f rating-service      # one service
docker compose restart rating-service
docker compose pull && docker compose up -d --build    # deploy an update
```

Health, for a monitoring probe:

```bash
curl -fs localhost:8080/actuator/health | grep -q UP && echo ok
```

### Backups

**Status: the Docker deployment provides no automated backups.** Each database is a
named Docker volume on the host, nothing more. For local development that is the
right amount of backup (the data is demo data and `food_db` re-seeds itself); for
any deployment whose data should survive, backups must be added deliberately.

What needs backing up, in order of value:

| Database | Contents | Loss impact |
|---|---|---|
| `room_db` | rooms, membership | active games lost |
| `rating_db` | preferences, ratings, rankings, decisions | active games lost |
| `user_db` | anonymous player rows | minor — players just enter a name again |
| `food_db` | food catalogue | none — re-seeds itself when empty |

Kafka needs no backup: both topics carry transient events already persisted in
PostgreSQL by the time they are consumed.

**Recommended strategy for a persistent deployment: use managed PostgreSQL**
(RDS / Cloud SQL / Azure Database) and let it do the backing up — automated
snapshots, point-in-time recovery, storage and patching are exactly the chores a
managed database removes. The compose override for pointing a service at a managed
instance is documented below; keep one database per service.

**If staying on containerized PostgreSQL** (fine for a temporary classroom/demo
deployment), a nightly `pg_dump` per database is adequate:

```bash
docker compose exec -T user-db \
  pg_dump -U hbi user_db > user_db-$(date +%F).sql
```

Repeat for `room_db`, `food_db` and `rating_db`, run it from cron, and copy the
dumps off the VM. Restore:

```bash
docker compose exec -T user-db psql -U hbi user_db < user_db-2026-08-23.sql
```

Recovery expectation with nightly dumps is losing up to a day of rooms — acceptable
for a game of "what should we eat", unacceptable for much else, which is the case
for managed PostgreSQL in one sentence. No AWS resources are provisioned by this
repository; managed PostgreSQL is a recommendation, not something that exists.

---

## Session rate limiting

`POST /api/users/session` is the one unauthenticated write in the system, so the
gateway throttles it per caller: a burst of `SESSION_RATE_CAPACITY` (default 60)
refilling at `SESSION_RATE_REFILL_PER_MINUTE` (default 60). Excess requests get
**429** with a JSON message. No other endpoint is rate-limited — everything else
requires a JWT that this endpoint issues.

The caller key is the last `X-Forwarded-For` hop (appended by the frontend's own
nginx, so clients cannot forge their way past it) or the socket address when the
gateway is called directly. The counters are in-memory in the single gateway
instance — deliberately no Redis. The defaults are generous so local multi-tab play
and the test suites never hit them; for a public deployment set something like
`SESSION_RATE_CAPACITY=10` / `SESSION_RATE_REFILL_PER_MINUTE=10` in `.env`.

---

## Scaling out the rating path

The real-time pipeline is horizontally scalable:

```text
Kafka (3 partitions per topic, keyed by room code)
   → rating-service replicas (consumer group splits the partitions)
      → Redis pub/sub (one channel; every replica relays to its own browsers)
         → STOMP WebSocket clients
```

- **Why Redis exists**: each replica's STOMP broker is in-memory and only reaches
  the browsers connected to that replica. Without a bridge, two replicas meant
  half the players stopped receiving events (measured before the fix: 0/10
  cross-instance deliveries). Every event is now published once to one Redis
  channel and each replica — including the originator — relays it to its local
  subscribers, so each browser gets each event exactly once.
- **What Redis stores**: nothing. It carries in-flight WebSocket frames and has
  persistence disabled. Users, rooms, ratings, recommendations, decisions and the
  catalogue live in PostgreSQL; durable events live in Kafka. A Redis outage
  degrades real-time delivery to instance-local (each browser still sees events
  its own replica produced), REST and rating persistence continue unaffected, and
  fan-out recovers automatically when Redis returns.
- **Partitions**: three per topic, keyed by room code — one room's events stay
  ordered on one partition while rooms spread across replicas. Three is enough
  for the replica counts a single VM can host; it is not a throughput ceiling
  worth raising speculatively.

To run replicas (works with the production override, which publishes no service
ports; for local experiments use `benchmarks/docker-compose.scale.yml` which
unpublishes them for the same reason):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --scale rating-service=3
```

What still does not scale by replication: the gateway and each PostgreSQL
instance are single containers (vertical scaling / managed replacements are the
production answer), and the single Kafka broker is a demo-grade setup.

The gateway also survives backend redeploys now: its DNS cache is capped at a
few seconds and idle pooled connections are evicted, so recreating a service
container (new IP) heals without restarting the gateway.

On AWS, the Redis container maps to **ElastiCache (Redis OSS)** the same way the
databases map to RDS — an optional managed replacement for a long-lived
deployment, not something local operation needs.

---

## Schema initialization and migrations

Each service creates its own schema with Hibernate (`ddl-auto: update`) on boot.
Two hand-written migration shims cover the schema changes the project has actually
made: `rating-service`'s `schema.sql` (runs before Hibernate; converts
restaurant-era volumes to the food domain, no-op on fresh databases) and
`user-service`'s `LegacySchemaCleanup` (drops account-era columns). Fresh volumes
and existing volumes both initialize automatically; nothing manual to run.

Flyway was evaluated for this phase and deliberately **not** introduced: the
current mechanism is idempotent, has been exercised against real old volumes, and
the data at stake is demo data. Retro-fitting versioned baselines across four
databases adds real migration risk for no present benefit. For any longer-lived
deployment, moving to Flyway (baseline per database, `ddl-auto: validate`) is the
first recommended change, and the two shims above would fold into its first
versioned migrations.

---

## Operator runbook — is it healthy?

Everything reuses the health endpoints and logs the services already expose; there
is no separate observability stack, deliberately.

| What | How | Healthy looks like |
|---|---|---|
| Everything at a glance | `docker compose ps` | every service `Up (healthy)` |
| Gateway | `curl -s localhost:8080/actuator/health` | `"status":"UP"` |
| user-service | `curl -s localhost:8081/actuator/health` | `"status":"UP"` |
| room-service | `curl -s localhost:8082/actuator/health` | `"status":"UP"` |
| food-service | `curl -s localhost:8083/actuator/health` | `"status":"UP"` |
| rating-service | `curl -s localhost:8084/actuator/health` | `"status":"UP"` (includes its DB and Kafka) |
| PostgreSQL (each) | `docker compose exec user-db pg_isready -U hbi` | `accepting connections` |
| Kafka | `docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:9092 --list` | lists `hbi.ratings`, `hbi.room-events` |
| Redis (WS fan-out) | `docker compose exec redis redis-cli ping` | `PONG` (an outage only degrades real-time fan-out to instance-local) |
| Kafka consumer lag | `... kafka-consumer-groups.sh --bootstrap-server kafka:9092 --describe --group hbi-rating-service` | LAG 0 or briefly small |
| Poison messages | same, topics `hbi.ratings.DLT` / `hbi.room-events.DLT` | empty unless something malformed arrived |
| Application failures | `docker compose logs --since 1h \| grep -iE "error\|exception"` | nothing recurring |
| End-to-end | open the frontend, create a room | lobby appears, second tab joins live |

With the production override the service ports are not published, so run the
`curl`s inside the network instead: `docker compose exec api-gateway wget -qO- http://localhost:8080/actuator/health`.
The compose healthchecks poll `/actuator/health` (which covers each service's
database and, where used, Kafka) every 10 s and mark the container unhealthy on
failure — `docker compose ps` is therefore the single most useful command.

---

## Troubleshooting

**A service restarts with `JWT_SECRET must be set`** — `.env` is missing or the value
is shorter than 32 characters.

**`rating-service` cannot reach Kafka on startup** — Compose waits for the broker's
healthcheck, but if you started services individually, bring `kafka` up first.

**The lobby does not update live** — the WebSocket is not getting through. Check that
your reverse proxy forwards the `Upgrade` and `Connection` headers, and look for
handshake rejections in `docker compose logs rating-service`.

**Ratings save but no recommendation appears** — the Kafka consumer is not running.
`docker compose logs rating-service | grep "kafka <-"` should show each event as it is
consumed.

**Out of memory / containers killed** — the VM is too small. Four Postgres instances
plus Kafka plus five JVMs need 4 GB. The services already cap themselves with
`-XX:MaxRAMPercentage=75`.

**Port 5173 or 8080 already in use** — change the host side of the mapping in
`docker-compose.yml`, e.g. `"8090:8080"`.
