# Switch backend laptop → Mac Mini (ZERO code changes)

Goal: move the running backend from this laptop to the office Mac Mini without editing
any code. Everything is env-driven; the only differences between the two machines are:
  (1) DNS A record pointing at the new IP
  (2) the values in `.env` (API_DOMAIN / FRONTEND_URL / secrets)
  (3) a `vercel env` update for VITE_API_URL, then `vercel deploy --prod`

──────────────────────────────────────────────────────────
## What is ALREADY laptop-agnostic (verified)
──────────────────────────────────────────────────────────
- Frontend reads only `import.meta.env.VITE_API_URL` (build-time env). No hardcoded URL in src/.
- Every backend service uses `app.use(cors())` → open to all origins (Vercel works anywhere).
- All DB/NATS/Keycloak URLs come from env vars (defaults resolve to Docker service names).
- The only `localhost` references in the repo are throwaway test scripts (*.js) and a .bak file
  — NOT part of the running app.

So: no code edit is needed to relocate. Only env + DNS.

──────────────────────────────────────────────────────────
## Step 1 — On the Mac Mini (Ubuntu)
──────────────────────────────────────────────────────────
1. Install Docker + compose v2 (sudo apt install docker.io docker-compose-plugin; usermod -aG docker $USER).
2. Copy the repo to /opt/gsttool/gst-recon-saas (git clone or scp).
3. Create /opt/gsttool/gst-recon-saas/.env from the template below, setting:
     API_DOMAIN=api.<YOURDOMAIN>
     KEYCLOAK_DOMAIN=auth.<YOURDOMAIN>
     MINIO_DOMAIN=storage.<YOURDOMAIN>
     FRONTEND_URL=https://gsttool-alpha.vercel.app   # your Vercel URL (unchanged)
     ACME_EMAIL=you@<YOURDOMAIN>
     + strong POSTGRES_*/KEYCLOAK_*/MINIO_*/JWT_SECRET values
   (Kong's 8002 is already published in docker-compose.yml for tunnel/local use; on the
    Mac Mini Traefik is the public entrypoint, so that port is harmless.)
4. docker compose up -d --build --remove-orphans
5. Wait for Let's Encrypt cert (docker compose logs -f traefik → "Certificates obtained").

──────────────────────────────────────────────────────────
## Step 2 — DNS (do this when you want the switch to go live)
──────────────────────────────────────────────────────────
Point your DNS A record:  api.<YOURDOMAIN>  →  <MAC_MINI_PUBLIC_IP>
Verify:  nslookup api.<YOURDOMAIN>

──────────────────────────────────────────────────────────
## Step 3 — Repoint the Vercel frontend (the ONLY frontend change)
──────────────────────────────────────────────────────────
On ANY machine with the Vercel token:
    vercel env rm VITE_API_URL production --yes --token <TOKEN>
    vercel env add VITE_API_URL production https://api.<YOURDOMAIN> --token <TOKEN>
    cd recon_frontend && vercel deploy --prod --token <TOKEN> --yes
Done. No frontend code changes.

──────────────────────────────────────────────────────────
## Rollback (if Mac Mini dies)
──────────────────────────────────────────────────────────
If the office loses power/network, restart the laptop tunnel and flip VITE_API_URL back:
    # on laptop:
    ./cloudflared.exe tunnel --url http://localhost:8002 --no-autoupdate   # capture new URL
    vercel env rm VITE_API_URL production --yes --token <TOKEN>
    vercel env add VITE_API_URL production <NEW_TUNNEL_URL> --token <TOKEN>
    vercel deploy --prod --token <TOKEN> --yes
(Or just keep the laptop as primary and Mac Mini as hot standby — same env flip.)

──────────────────────────────────────────────────────────
## .env template (Mac Mini)
──────────────────────────────────────────────────────────
POSTGRES_MAIN_DB=gst_main
POSTGRES_MAIN_USER=gst_user
POSTGRES_MAIN_PASSWORD=<strong>
POSTGRES_KEYCLOAK_DB=keycloak
POSTGRES_KEYCLOAK_USER=keycloak
POSTGRES_KEYCLOAK_PASSWORD=<strong>
KEYCLOAK_ADMIN_USERNAME=admin
KEYCLOAK_ADMIN_PASSWORD=<strong>
KEYCLOAK_REALM=gsttool
KEYCLOAK_CLIENT_ID=admin-api
KEYCLOAK_CLIENT_SECRET=<must match infra/keycloak/gsttool-realm.json admin-api secret>
KEYCLOAK_URL=http://keycloak:8080
JWT_SECRET=<openssl rand -hex 32>
API_DOMAIN=api.<YOURDOMAIN>
KEYCLOAK_DOMAIN=auth.<YOURDOMAIN>
MINIO_DOMAIN=storage.<YOURDOMAIN>
ACME_EMAIL=you@<YOURDOMAIN>
FRONTEND_URL=https://gsttool-alpha.vercel.app
MINIO_ROOT_USER=<strong>
MINIO_ROOT_PASSWORD=<strong>
MINIO_DEFAULT_BUCKETS=gst-uploads
MOCK_ADESK_URL=http://localhost:3002
EXT_API_URL=http://gsp_api_app:4015   # external GSP service (live GSTN sync) — optional, has fallback
