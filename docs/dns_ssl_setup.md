# DNS and SSL Configuration Guide

This document describes how to configure the domain names (DNS) and secure sockets layer (SSL/TLS) certificate provisioning for the production deployment of the GST Tool application.

---

## 1. Domain and DNS Structure

We assume the production domain is `mydomain.com`. The deployment mapping is structured as follows:

| Subdomain | Target Service | Hosting Platform | DNS Record Type | Target Value |
| :--- | :--- | :--- | :--- | :--- |
| `app.mydomain.com` | React Frontend Client | Vercel | CNAME | `cname.vercel-dns.com` |
| `api.mydomain.com` | Kong API Gateway (Backend) | VPS (Ubuntu VM) | A | `<VM_PUBLIC_IP>` |
| `auth.mydomain.com` | Keycloak Identity Provider | VPS (Ubuntu VM) | A | `<VM_PUBLIC_IP>` |
| `storage.mydomain.com` | MinIO Storage Console | VPS (Ubuntu VM) | A | `<VM_PUBLIC_IP>` |

### Step-by-Step DNS Setup:
1. Log in to your DNS Registrar / Manager (e.g., Cloudflare, GoDaddy, Route 53).
2. Create an **A Record** for `api.mydomain.com` pointing to the public IP of your VM server (e.g., `123.45.67.89`). Turn off "Cloudflare Proxying" (Grey Cloud) if using Cloudflare initially so that Traefik can complete Let's Encrypt validation.
3. Create an **A Record** for `auth.mydomain.com` pointing to the same VM public IP.
4. Create an **A Record** for `storage.mydomain.com` pointing to the same VM public IP.
5. Create a **CNAME Record** for `app.mydomain.com` pointing to Vercel: `cname.vercel-dns.com`.

---

## 2. SSL/TLS Certificate Provisioning (Traefik ACME)

For the backend VM, **Traefik** acts as the SSL-terminating reverse proxy. It automatically requests, provisions, and renews TLS certificates from **Let's Encrypt** using the ACME protocol.

### How it Works:
1. When a client visits `https://api.mydomain.com`, Traefik receives the TLS request.
2. If no valid certificate exists, Traefik initiates a **TLS-ALPN-01 challenge** (via port 443) with Let's Encrypt.
3. Let's Encrypt sends a verification challenge to Traefik.
4. Once verified, Let's Encrypt issues a cryptographic certificate.
5. Traefik saves this certificate to `/letsencrypt/acme.json` (inside the mounted volume) and uses it to establish the secure HTTPS connection.
6. The certificate is automatically renewed by Traefik 30 days before expiry.

### Traefik Config Parameters (in `docker-compose.yml`):
- `--certificatesresolvers.letsencrypt.acme.tlschallenge=true`: Enables the secure TLS challenge verification.
- `--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}`: Registration email for Let's Encrypt alerts.
- `--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json`: Persistent path where certificates are stored.

---

## 3. Vercel Frontend Configuration

1. In the Vercel Dashboard, navigate to your project settings -> **Domains**.
2. Click **Add** and enter `app.mydomain.com`.
3. Vercel will prompt you to ensure your DNS contains the CNAME record pointing to `cname.vercel-dns.com`.
4. Vercel automatically issues an SSL certificate for `app.mydomain.com` once the DNS propagates.
5. Under Vercel project **Environment Variables**, configure the following production keys:
   - `VITE_API_URL` = `https://api.mydomain.com`
   - `VITE_DISABLE_RECAPTCHA` = `true` (or `false` + real site key)
