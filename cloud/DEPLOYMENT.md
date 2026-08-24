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
cd HBI/cloud
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
| `CORS_ALLOWED_ORIGINS` | api-gateway | Only needed for `npm run dev` |
| `*_SERVICE_URL` | gateway, rating-service | Internal addresses, set by Compose |

**Never commit `.env`.** It is already covered by `.gitignore`.

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
is convenient while developing. **On a public VM, stop publishing them.** Create a
`docker-compose.prod.yml` next to it:

```yaml
services:
  user-db:            {ports: !reset []}
  room-db:            {ports: !reset []}
  food-db:            {ports: !reset []}
  rating-db:          {ports: !reset []}
  kafka:              {ports: !reset []}
  user-service:       {ports: !reset []}
  room-service:       {ports: !reset []}
  food-service:       {ports: !reset []}
  rating-service:     {ports: !reset []}
  api-gateway:        {ports: !reset []}
  frontend:
    ports: ["127.0.0.1:5173:80"]
```

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Now only the reverse proxy can reach the application, and the databases and Kafka are
reachable only from inside the Docker network. Confirm with `docker compose ps` and
`sudo ss -tlnp`.

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

Each database is a named Docker volume:

```bash
docker compose exec -T user-db \
  pg_dump -U hbi user_db > user_db-$(date +%F).sql
```

Repeat for `room_db`, `food_db` and `rating_db`. `food_db` re-seeds itself
on an empty database, so it is the least critical.

Restore:

```bash
docker compose exec -T user-db psql -U hbi user_db < user_db-2026-08-23.sql
```

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
