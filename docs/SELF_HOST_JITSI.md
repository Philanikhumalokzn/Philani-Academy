# Self-hosting Jitsi Meet — Quickstart and Checklist

This document outlines options and concrete steps to self-host Jitsi Meet for production use. It contains a quick Ubuntu (`apt`) install and a Docker-Compose option, plus configuration notes for JWT authentication (Prosody), coturn TURN server, Jibri (recording), TLS, and scaling guidance.

> Note: This guide is intentionally concise. For full reference, consult the official Jitsi docs: https://jitsi.org/ and https://github.com/jitsi/jitsi-meet

---

## Overview of components

- `jitsi-meet` (web app)
- `prosody` (XMPP, auth)
- `jicofo` (conference focus)
- `jitsi-videobridge (jvb)` (media router) — can run multiple nodes
- `coturn` (TURN server) — for NAT traversal and reliability
- `jibri` (recording/streaming) — each instance records one session at a time
- `nginx` (reverse proxy) or built-in web listener + Let's Encrypt for TLS

---

## Option A — Quick install (Ubuntu / apt)

1. Create a fresh Ubuntu 22.04 VM (or similar). Ensure you have a public DNS name (e.g., `meet.example.com`) and A/AAAA records pointing to the server.
2. Update packages:

```bash
sudo apt update && sudo apt upgrade -y
```

3. Install the Jitsi Meet package (official repo):

```bash
# Add the Jitsi package repository
sudo apt install -y gnupg2 curl
curl https://download.jitsi.org/jitsi-key.gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/jitsi-keyring.gpg
echo 'deb [signed-by=/usr/share/keyrings/jitsi-keyring.gpg] https://download.jitsi.org stable/' | sudo tee /etc/apt/sources.list.d/jitsi-stable.list
sudo apt update
sudo apt install -y jitsi-meet
```

4. During install it will ask for the hostname and whether to use Let's Encrypt. Choose your host and let the installer configure TLS, or choose to configure later.

5. Install coturn (recommended) and configure TURN credentials (see below).

6. If you need recordings/streaming, install Jibri on a separate machine (see Jibri notes below).


## Option B — Docker-Compose (recommended for multi-service deployments)

1. Use the `jitsi/docker-jitsi-meet` project: https://github.com/jitsi/docker-jitsi-meet
2. Clone and follow the project's `.env` and `docker-compose.yml` setup. The repo provides env variables for TZ, HTTP/HTTPS ports, TURN, and Jibri integration.

High level steps:

```bash
git clone https://github.com/jitsi/docker-jitsi-meet.git
cd docker-jitsi-meet
cp env.example .env
# Edit .env to set PUBLIC_URL and relevant secrets
docker-compose up -d
```

Docker approach is convenient for separating services (web, prosody, jicofo, jvb, coturn, jibri) and scaling JVB by adding more containers or hosts.

---

## Prosody — JWT auth (recommended for programmatic control)

1. Enable the `mod_auth_token` module on Prosody conf. This lets you issue short-lived JWT tokens server-side to control who can create/join rooms.
2. Example Prosody config snippet (`/etc/prosody/conf.d/meet.example.com.cfg.lua`):

```lua
VirtualHost "meet.example.com"
    modules_enabled = {
        "bosh";
        "ping";
        -- ... other modules
        "token_verification"; -- if needed
    }

-- Token auth config
Component "auth.meet.example.com" "token"
    app_id = "your_app_id"
    app_secret = "your_app_secret"
    allow_empty_token = false
```

3. On your application server, sign JWT tokens with `app_secret` and include required claims (room, context.user, iss/aud/lifetime). The client uses the token via JWT param or `configOverwrite.token` depending on your integration.

Official docs: https://jitsi.github.io/handbook/docs/devops-guide/devops-guide-quickstart

---

## coturn (TURN) — NAT traversal and reliability

- Install `coturn` on a public IP. Configure long-term credentials and enable TLS if possible.
- Required for reliable media connectivity when participants are behind strict NATs.

Sample `turnserver.conf` keys:

```
listening-port=3478
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=YOUR_SECRET
realm=meet.example.com
cert=/path/to/fullchain.pem
pkey=/path/to/privkey.pem
no-stdout-log

alt-listening-port=443
```

Provide the TURN credentials to the Jitsi stack (docker env or prosody config) so clients and JVB can use it.

---

## Jibri (recording/streaming)

- Jibri requires a separate VM/container with Chrome, ffmpeg and Jibri package.
- Each Jibri handles one recording at a time; scale by adding more Jibri instances.
- Secure Jibri with proper firewall rules and service accounts.

Official Jibri docs: https://github.com/jitsi/jibri

---

## TLS and reverse proxy

- Use Let's Encrypt for certificates (ACME). The jitsi apt installer can request certs automatically for a single host.
- For more complex setups, put `nginx` or a cloud LB in front with TLS termination and proxy to the Jitsi services.

---

## Scaling notes

- For large-scale deployments, run multiple JVB nodes and use Octo to route between regions.
- Keep Prosody/Jicofo separate from JVB; they are control-plane services with lighter resource needs.
- Monitor CPU, memory, and network; use Prometheus + Grafana dashboards.

---

## Quick checklist to go to production

- [ ] DNS and TLS configured for your Jitsi domain
- [ ] coturn deployed and reachable
- [ ] Deploy Jitsi (apt or docker) and verify basic meeting creation
- [ ] Configure JWT (Prosody) and integrate with your application to mint tokens
- [ ] Deploy at least one Jibri for recording if needed
- [ ] Add monitoring and alerts
- [ ] Plan autoscaling / additional JVB nodes

---

## Useful links

- Jitsi Handbook: https://jitsi.github.io/handbook/
- Docker project: https://github.com/jitsi/docker-jitsi-meet
- Jibri: https://github.com/jitsi/jibri
- Prosody mod_auth_token docs: https://github.com/jitsi/lib-jitsi-meet/tree/master/doc


----

If you'd like, I can now:
- Add a `.env.example` and wire `NEXT_PUBLIC_JITSI_DOMAIN` into the app (quick).
- Implement server-side JWT minting example (Node/Next API route) and client wiring for authenticated joins.
- Produce a step-by-step Ubuntu script that automates the apt install and minimal configuration.

Tell me which one you want next and I'll proceed.