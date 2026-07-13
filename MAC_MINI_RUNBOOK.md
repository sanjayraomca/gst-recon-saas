# GST Tool — Backend Runbook (Mac Mini / Ubuntu Server)

Goal: run the full Docker backend on your office Mac Mini (Ubuntu) behind Traefik + Kong,
exposed publicly at `https://api.<YOURDOMAIN>` so the Vercel frontend can talk to it.

This repo's backend is unchanged — you DO NOT rework any code. You only:
  1. Put a real production `.env` on the server.
  2. Point a DNS A record at the Mac Mini's public IP.
  3. `docker compose up -d`.
  4. Traefik auto-issues the Let's Encrypt cert.

──────────────────────────────────────────────────────────
## 0. Prerequisites on the Mac Mini (Ubuntu)
──────────────────────────────────────────────────────────
- Docker + Docker Compose v2 installed.
  sudo apt update && sudo apt install -y docker.io docker-compose-plugin
  sudo systemctl enable --now docker
  (add your user to docker group: sudo usermod -aG docker $USER, then re-login)
- Ports 80 and 443 open in the office router / firewall, forwarded to the Mac Mini LAN IP.
- A static LAN IP for the Mac Mini (set in router DHCP reservation) so forwarding stays valid.
- A domain you own (e.g. gsttool.com). You'll create a subdomain for the API.

──────────────────────────────────────────────────────────
## 1. DNS (do this first — Let's Encrypt needs it)
──────────────────────────────────────────────────────────
In your DNS provider, add an A record:
    api.<YOURDOMAIN>   ->   <MAC_MINI_PUBLIC_IP>
    auth.<YOURDOMAIN>  ->   <MAC_MINI_PUBLIC_IP>   (Keycloak, if you expose it)
    storage.<YOURDOMAIN> -> <MAC_MINI_PUBLIC_IP>    (Minio console, optional)

Verify it resolves BEFORE starting Traefik:
    nslookup api.<YOURDOMAIN>

Note: Let's Encrypt will only issue a cert if the domain already points here and port 80 is reachable.

──────────────────────────────────────────────────────────
## 2. Production .env
──────────────────────────────────────────────────────────
Copy `gst-recon-saas/.env.example` to `gst-recon-saas/.env` and set REAL values:

  # DB — keep strong passwords
  POSTGRES_MAIN_PASSWORD=<strong-random>
  POSTGRES_KEYCLOAK_PASSWORD=<strong-random>

  # Keycloak
  KEYCLOAK_ADMIN_PASSWORD=<strong-random>
  KEYCLOAK_CLIENT_SECRET=<paste-from-realm-json-or-regenerate>   # see step 3

  # Auth secrets
  JWT_SECRET=<generate: openssl rand -hex 32>

  # Public domains (used by Traefik routing + CORS allowlist)
  API_DOMAIN=api.<YOURDOMAIN>
  KEYCLOAK_DOMAIN=auth.<YOURDOMAIN>
  MINIO_DOMAIN=storage.<YOURDOMAIN>
  ACME_EMAIL=you@<YOURDOMAIN>
  FRONTEND_URL=https://<your-vercel-app>.vercel.app   # CORS allowlist for the frontend

  # Minio
  MINIO_ROOT_PASSWORD=<strong-random>

  # Adesk connector (leave as-is if unused)
  MOCK_ADESK_URL=http://localhost:3002

Do NOT commit `.env` (it's gitignored).

──────────────────────────────────────────────────────────
## 3. Keycloak client secret (must match realm)
──────────────────────────────────────────────────────────
The realm file `infra/keycloak/gsttool-realm.json` defines client `admin-api` with a secret.
Either:
  (a) copy that secret into KEYCLOAK_CLIENT_SECRET in .env, or
  (b) open the realm JSON, change the secret under `"clientId":"admin-api"`, re-save, and put the new value in .env.
They MUST match or every login/refresh fails.

──────────────────────────────────────────────────────────
## 4. Start the stack
──────────────────────────────────────────────────────────
  cd gst-recon-saas
  docker compose up -d --build --remove-orphans

First boot builds 7 Node images (2–4 min) and starts Postgres/Keycloak/Minio/NATS/Kong/Traefik.
Watch it come up:
  docker compose ps
  docker compose logs -f traefik          # watch for "TLS certificate" issuance
  docker compose logs -f tenant-service   # confirm it connects to NATS + DB

──────────────────────────────────────────────────────────
## 5. Verify it's live (from any machine)
──────────────────────────────────────────────────────────
  # Traefik should have redirected :80 -> :443 and issued a cert
  curl -kI https://api.<YOURDOMAIN>/health
  # Expect: HTTP/2 200 with a tenant-service health JSON

  # Auth endpoint (login will hit Keycloak)
  curl -k https://api.<YOURDOMAIN>/auth/login -X POST -H 'Content-Type: application/json' \
       -d '{"email":"test@test.com","password":"test1234!"}'
  # (401 expected if user doesn't exist yet — proves routing + Kong + TLS work)

──────────────────────────────────────────────────────────
## 6. Wire the Vercel frontend
──────────────────────────────────────────────────────────
In the Vercel project settings → Environment Variables, set:
    VITE_API_URL = https://api.<YOURDOMAIN>
Then redeploy. (All api.js calls use this base URL; CORS is open so it just works.)

──────────────────────────────────────────────────────────
## 7. Gotchas / known gaps
──────────────────────────────────────────────────────────
- `EXT_API_URL=http://gsp_api_app:4015` is an EXTERNAL GSP API for LIVE GSTN data fetch.
  It is NOT in compose and is referenced only in workspace-service gstnSyncController.
  Live GSTN sync (auto-pull from GST portal) will NOT work until you build/run that service.
  Everything else (reconciliation, workspaces, ITC, reports, uploads, manual JSON import) works.

- CORS: every service uses `app.use(cors())` (allows ALL origins). Fine for launch.
  To harden later, set an explicit origin allowlist in each service's cors() config.

- Traefik dashboard is exposed on :8085 — firewall it (don't open to public).

- The Mac Mini must stay on and online. For resilience, consider a UPS + the router's
  "keep-alive" and a cron job: `cd /opt/gsttool/gst-recon-saas && docker compose up -d`.

- Backups: schedule `docker exec gst-postgres-main pg_dump ... > backup.sql` (cron) to avoid data loss.
