# Deployment Runbook: Production Stack for Outbox Email Scheduler

> **Audience:** Human owner / operator deploying the Outbox stack to a live server.  
> **Target Shape:** Ubuntu 24.04 LTS VPS with Docker Compose behind Caddy edge reverse proxy.  
> **Key Decisions:** Same-origin deployment, automatic Let's Encrypt TLS, non-root containers, persistent AOF Redis, Postgres source-of-truth, zero product cron.  
> **Verified Date:** October 2026.

---

## 1. Overview

```
Internet ──▶ DNS (A record) ──▶ VPS (Ubuntu 24.04 LTS)
                                  │
                         ┌────────▼─────────┐  :80/:443 (only public ports, plus 22 for SSH)
                         │  Caddy (auto TLS) │  serves /srv/frontend, proxies /api /auth /admin
                         └───┬───────────┬──┘
                      edge   │           │
                   ┌─────────▼──┐   ┌────▼───────┐
                   │ api        │   │ worker ×2  │   same image, different command
                   └──┬───┬───┬─┘   └──┬───┬───┬─┘
              internal│   │   │        │   │   │   (no published ports)
             ┌────────▼┐ ┌▼───────┐ ┌──▼───────┐
             │Postgres │ │ Redis  │ │Elasticsearch│   volumes: pgdata, redisdata(AOF), esdata, uploads
             └─────────┘ └────────┘ └──────────┘
Outbound: Ethereal SMTP, Google OAuth, Slack OAuth + webhooks
```

- **What you will have at the end:** A hardened, highly available, production-grade email scheduler running under your own domain with automatic HTTPS, live Google OAuth authentication, Slack webhook alert delivery, Elasticsearch indexing, and zero-downtime worker restart recovery.
- **Estimated Setup Time:** ~35–45 minutes.
- **Estimated Hosting Cost:** $0 (Oracle Always Free, if capacity available) or ~$5.99–$24/month (Hetzner, DigitalOcean, or AWS Lightsail).

---

## 2. Key Decisions & Provider Sizing

### 2.1 Minimum Resource Sizing
The production cluster runs:
- **Elasticsearch 8.13:** 512 MB JVM heap + container runtime (~1.2 GB cap)
- **PostgreSQL 16:** ~256–512 MB RAM
- **Redis 7.2 (AOF persistence):** ~128–256 MB RAM
- **API service:** ~256–512 MB RAM
- **2 Worker instances:** ~256–512 MB RAM each
- **Caddy Edge Proxy:** ~64–128 MB RAM
- **Total Minimum Recommended:** **2 vCPU, 4 GB RAM, 40 GB NVMe/SSD, plus 2 GB Swap**.

### 2.2 Provider Comparison Matrix (Verified Live — October 2026)

| Provider | Plan / Tier | vCPU / RAM / Disk | Monthly Cost (USD / EUR) | Best Region for Reviewers | Caveats & Availability Notes |
|---|---|---|---|---|---|
| **Hetzner Cloud** | `CX23` (Cost-Optimized AMD) | 2 vCPU / 4 GB RAM / 40 GB NVMe | **€5.99/mo** (~$6.50/mo) | EU (Falkenstein/Helsinki) or Singapore (+20%) | **Top Budget Recommendation.** High demand occasionally causes stock delays in specific regions. |
| **DigitalOcean** | Basic Droplet (Shared CPU) | 2 vCPU / 4 GB RAM / 80 GB SSD | **$24.00/mo** | Bangalore (`blr1`) or Singapore (`sgp1`) | Extremely reliable provisioning; Indian bank card foreign currency markup may apply. |
| **AWS Lightsail** | 4 GB Linux Bundle | 2 vCPU / 4 GB RAM / 80 GB SSD | **$24.00/mo** (+ 18% GST in India) | Mumbai (`ap-south-1`) | Predictable pricing; Mumbai region has 2 TB outbound transfer limit instead of 4 TB. |
| **Oracle Cloud (OCI)** | Ampere A1 (Always Free) | 2 OCPU / 12 GB RAM / 50 GB Disk | **$0.00 (Free)** | Mumbai, Hyderabad, Singapore | Free tier was halved from 4 OCPU to 2 OCPU in mid-2026. Frequent "Out of Capacity" errors during provisioning. |

### 2.3 Default Recommendation
- **Primary Choice:** **Hetzner Cloud CX23** (€5.99/mo) or **DigitalOcean 4GB Droplet in Bangalore/Singapore** ($24/mo).
- **Domain:** Any subdomain you own (e.g., `scheduler.yourdomain.com`) or a top-level domain pointing to the server IPv4.
- **Reviewer Login Strategy:** Provide a **seeded demo account** (email/password) in the README so reviewers can instantly test without OAuth roadblocks, combined with **Google OAuth (Published to Production with non-sensitive scopes)** so reviewers with Google accounts can log in seamlessly.

---

## 3. Step-by-Step Account Setup & Console Click-Paths

Follow these steps in strict sequence. The server and DNS must exist before completing Google and Slack redirect URI configurations.

### 3.1 Domain DNS Setup
1. Open your DNS provider (Cloudflare, Namecheap, Route 53, GoDaddy).
2. Add a new **A Record**:
   - **Name:** `scheduler` (or `@` if root domain)
   - **Target / IPv4 Address:** `<YOUR_SERVER_PUBLIC_IP>`
   - **TTL:** Auto or 300 seconds (5 minutes)
   - **Proxy Status:** **DNS Only** (disable Cloudflare orange-cloud proxy initially so Caddy can perform direct ACME HTTP-01 challenges).
3. **Verification Command (run on your local machine):**
   ```bash
   dig +short scheduler.yourdomain.com
   # Expected Output: Your server's IPv4 address
   ```

---

### 3.2 Google Cloud OAuth Setup (Verified October 2026 UI)
1. Navigate to the **[Google Cloud Console](https://console.cloud.google.com/)**.
2. Select or create a project (e.g., `email-scheduler-prod`).
3. In the left navigation menu, go to **APIs & Services** > **OAuth consent screen**.
   - **User Type:** Select **External**, then click **Create**.
   - **App Name:** `Outbox Email Scheduler`
   - **User support email:** Your email address.
   - **Authorized domains:** Add your top-level domain (e.g., `yourdomain.com`).
   - **Developer contact information:** Your email address.
   - Click **Save and Continue**.
4. **Scopes:**
   - Click **Add or Remove Scopes**.
   - Select only the non-sensitive standard OpenID Connect scopes:
     - `.../auth/userinfo.email`
     - `.../auth/userinfo.profile`
     - `openid`
   - Click **Update** > **Save and Continue**.
5. **Publishing Status (Critical to avoid 7-day token expiry):**
   - Under **OAuth consent screen** > **Publishing status**, click **Publish App**.
   - Confirm the prompt. Because only non-sensitive scopes (`openid`, `email`, `profile`) are requested, **no Google app verification review is required**. Any Google user can now sign in without hitting a 100-user limit or 7-day expiration!
6. **Create Credentials:**
   - In the left menu, click **Credentials** > **Create Credentials** > **OAuth client ID**.
   - **Application type:** `Web application`.
   - **Name:** `Outbox Web Client`.
   - **Authorized JavaScript origins:** `https://scheduler.yourdomain.com`
   - **Authorized redirect URIs:**
     - `https://scheduler.yourdomain.com/auth/google/callback`
     - `http://localhost:4000/auth/google/callback` (optional for local dev)
   - Click **Create**.
7. **Copy Credentials to `.env`:**
   - Copy **Client ID** -> `GOOGLE_CLIENT_ID`
   - Copy **Client Secret** -> `GOOGLE_CLIENT_SECRET`
   - Set `GOOGLE_REDIRECT_URI=https://scheduler.yourdomain.com/auth/google/callback`

---

### 3.3 Slack App Setup with Multi-Workspace Distribution (Verified October 2026 UI)
1. Navigate to **[Slack API Apps](https://api.slack.com/apps)**.
2. Click **Create New App** > **From scratch**.
   - **App Name:** `Outbox Scheduler Alerts`
   - **Pick a workspace to develop your app in:** Select your personal/test workspace.
   - Click **Create App**.
3. **Configure Incoming Webhooks & Scopes:**
   - In the left sidebar, click **OAuth & Permissions**.
   - Under **Redirect URLs**, click **Add New Redirect URL**:
     - Enter: `https://scheduler.yourdomain.com/api/integrations/slack/callback`
     - Click **Save URLs**.
   - Scroll down to **Scopes** > **Bot Token Scopes**:
     - Click **Add an OAuth Scope** and select `incoming-webhook`.
4. **Enable Multi-Workspace Distribution:**
   - In the left sidebar, click **Manage Distribution** (under *Settings*).
   - Review the requirements checklist (App Name, Icon, Description). Fill in any missing items.
   - Click **Activate Public Distribution**.  
     *(Note: This does NOT submit your app to the public directory; it simply unlocks cross-workspace installation so reviewers can connect their own Slack workspaces via OAuth).*
5. **Copy Credentials to `.env`:**
   - Return to **Basic Information** (in the left sidebar).
   - Under **App Credentials**, copy:
     - **Client ID** -> `SLACK_CLIENT_ID`
     - **Client Secret** -> `SLACK_CLIENT_SECRET`
   - Set `SLACK_REDIRECT_URI=https://scheduler.yourdomain.com/api/integrations/slack/callback`

---

## 4. Server Setup & Hardening

Log into your fresh VPS as `root`:
```bash
ssh root@YOUR_SERVER_IP
```

### 4.1 Clone Repository and Run Bootstrap
```bash
# Clone repository
git clone https://github.com/YOUR_ORG/outbox.git /opt/scheduler
cd /opt/scheduler

# Run automated idempotent server bootstrap
bash infra/scripts/bootstrap-server.sh
```

**What you will see when it succeeds:**
```
[CHECK] Firewall status:
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)
To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere

[CHECK] Docker version:
Docker version 27.x.x
Docker Compose version v2.29.x

[CHECK] Virtual memory mapping for Elasticsearch:
vm.max_map_count = 262144

[CHECK] Swap space:
Swap: 2.0Gi 0B 2.0Gi
BOOTSTRAP COMPLETE!
```

**If you don't:**
- If `ufw` fails to activate, ensure iptables is supported on your kernel.
- If Docker installation fails, verify outbound DNS resolution (`curl -I https://download.docker.com`).

---

## 5. Configure Secrets & Deploy

Switch to the newly provisioned `deploy` user:
```bash
su - deploy
cd /opt/scheduler
```

### 5.1 Generate Cryptographic Secrets
```bash
bash infra/scripts/gen-secrets.sh infra/.env.production
```
This automatically populates high-entropy random keys for `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, and `ENCRYPTION_KEY`, and sets `chmod 600`.

### 5.2 Edit Environment Configuration
Edit `infra/.env.production` using `nano` or `vim`:
```bash
nano infra/.env.production
```
Fill in the human variables:
```ini
DOMAIN=scheduler.yourdomain.com
FRONTEND_URL=https://scheduler.yourdomain.com
ACME_EMAIL=your-email@example.com

ADMIN_EMAILS=your-google-email@example.com

GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://scheduler.yourdomain.com/auth/google/callback

SLACK_CLIENT_ID=your-slack-client-id
SLACK_CLIENT_SECRET=your-slack-client-secret
SLACK_REDIRECT_URI=https://scheduler.yourdomain.com/api/integrations/slack/callback

ENABLE_FAULT_INJECTION=false
```

### 5.3 Execute Deployment
```bash
bash infra/scripts/deploy.sh
```

**What you will see when it succeeds:**
```
===============================================================================
STEP 5: Awaiting cluster healthiness
===============================================================================
All services healthy!
NAME                      IMAGE                            STATUS
scheduler-api             email-scheduler-backend:latest   Up (healthy)
scheduler-caddy           email-scheduler-caddy:latest     Up
scheduler-elasticsearch   elasticsearch:8.13.4             Up (healthy)
scheduler-postgres        postgres:16-alpine               Up (healthy)
scheduler-redis           redis:7.2-alpine                 Up (healthy)
scheduler-worker-1        email-scheduler-backend:latest   Up
scheduler-worker-2        email-scheduler-backend:latest   Up

===============================================================================
SMOKE TEST SUMMARY: 7 passed, 0 failed.
OVERALL RESULT: PASS
===============================================================================
DEPLOYMENT SUCCESSFUL!
```

---

## 6. Seed Demo Account for Reviewers

Ensure reviewers can log in immediately even if they do not use Google OAuth:
```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production exec -T api node -e "
import('./dist/infra/prisma.js').then(async ({ prisma }) => {
  const { hashPassword } = await import('./dist/utils/password.js');
  const user = await prisma.user.upsert({
    where: { email: 'demo@example.com' },
    update: { passwordHash: hashPassword('DemoPassword123!') },
    create: {
      email: 'demo@example.com',
      name: 'Reviewer Demo',
      passwordHash: hashPassword('DemoPassword123!')
    }
  });
  console.log('Seeded demo account:', user.email);
  process.exit(0);
});
"
```
Reviewer credentials are now active:
- **Email:** `demo@example.com`
- **Password:** `DemoPassword123!`

---

## 7. Production Verification (V1 to V13 Checklist)

Run these checks and save evidence outputs to `docs/evidence/production/`:

### 7.1 Automated Smoke Verification (V1, V2, V3, V10)
```bash
bash infra/scripts/smoke-prod.sh https://scheduler.yourdomain.com | tee docs/evidence/production/smoke_output.txt
```

### 7.2 Real Google Login (V4)
1. Open an Incognito browser window.
2. Visit `https://scheduler.yourdomain.com/login`.
3. Click **Continue with Google**.
4. Authenticate with your Google account.
5. Confirm successful redirect to `/scheduled` with your user profile active. Capture a screenshot for evidence.

### 7.3 Live Campaign Scheduling & Sent Flow (V5)
1. On the UI, click **Compose** (`/compose`).
2. Add subject `Production Verification Campaign`, 3 recipients (`test1@ethereal.email`, `test2@ethereal.email`, `test3@ethereal.email`).
3. Set schedule time to 1 minute in the future.
4. Click **Schedule Campaign**.
5. Observe items appearing in **Scheduled** tab, then transitioning to **Sent** tab within 60–90 seconds.
6. Click any sent email and click the **Ethereal Preview URL** to inspect rendered HTML.

### 7.4 Elasticsearch Query Search (V6)
```bash
curl -s "https://scheduler.yourdomain.com/api/emails/search?q=Verification" \
  -H "Cookie: auth_token=YOUR_AUTH_COOKIE" | jq .
```
Verify matching records are returned from Elasticsearch.

### 7.5 Restart Safety Verification (V7)
1. Schedule a campaign of 50 emails 3 minutes into the future.
2. Restart the API and workers mid-flight:
   ```bash
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production restart api worker
   ```
3. Or test full container teardown and startup:
   ```bash
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production down
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production up -d --scale worker=2
   ```
4. Verify all 50 emails send on time with **zero duplicate sends** by running the auditor:
   ```bash
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production exec -T api node dist/tools/audit.js
   ```

### 7.6 Rate Limiting & Real Slack Webhook (V9)
1. Connect Slack via the UI: **Settings** > **Integrations** > **Connect Slack**. Install the app to your Slack workspace.
2. Configure a sender with an hourly limit of `5` emails/hour.
3. Schedule 10 emails.
4. Confirm 5 emails deliver immediately, and the remaining 5 are deferred.
5. Confirm an automated alert arrives in your Slack channel stating that the rate limit threshold was reached.
6. Disconnect Slack in the UI, schedule another batch, and confirm the system operates smoothly without crashes. Reconnect Slack.

### 7.7 Non-Destructive Backup & Restore Test (V12)
```bash
# Take hot backup
bash infra/scripts/backup.sh

# Run non-destructive restore into scratch database
LATEST_BACKUP=$(ls -td /opt/scheduler/backups/backup_* | head -1)
bash infra/scripts/restore.sh "$LATEST_BACKUP/database_"*.sql.gz --test-db
```
Expected output: `NON-DESTRUCTIVE RESTORE VERIFICATION: PASS`.

---

## 8. Five-Minute Live Demo Script for Video Submission

| Timing | Action on Screen | Key Points to Explain |
|---|---|---|
| **0:00 - 0:45** | Open `https://scheduler.yourdomain.com/login`. Sign in using Google OAuth. | Point out same-origin URL, automatic TLS certificate issued by Caddy, and secure cookie session. |
| **0:45 - 1:30** | Go to **Compose**. Upload an attachment, set a delay, schedule a campaign for 5 recipients. | Show immediate appearance in **Scheduled** tab with countdown badge. |
| **1:30 - 2:30** | In terminal, run `docker compose restart worker` while jobs are pending. | Explain BullMQ persistent Redis AOF + Postgres event ledger. Show emails continue sending on time without duplication. |
| **2:30 - 3:30** | Trigger rate limit on sender capped at 5/hr. Switch to Slack channel. | Show real Slack webhook alert notification arriving in real-time. |
| **3:30 - 4:15** | Open sent emails list. Click **Ethereal Preview Link**. | Show that emails rendered and delivered with attachments safely in Ethereal mock SMTP. |
| **4:15 - 5:00** | Run `npm run audit` inside container. | Show the 7 core invariants (`I1` to `I7`) reporting all green `PASS`. |

---

## 9. Operations & Maintenance

### 9.1 Viewing Logs
```bash
# View API server logs
docker compose -f infra/docker-compose.prod.yml logs -f --tail=100 api

# View Worker logs
docker compose -f infra/docker-compose.prod.yml logs -f --tail=100 worker

# View Caddy access & TLS logs
docker compose -f infra/docker-compose.prod.yml logs -f --tail=100 caddy
```

### 9.2 Scaling Workers
```bash
# Scale to 3 workers
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production up -d --scale worker=3
```

### 9.3 Accessing Bull Board Queue UI
- Log in as the user specified in `ADMIN_EMAILS`.
- Navigate to `https://scheduler.yourdomain.com/admin/queues`.
- You will see the active BullMQ `email-delivery` queue, active jobs, delayed counts, and memory statistics. Anonymous users are rejected with HTTP 401/403.

### 9.4 Rotating Secrets
1. Generate new keys using `openssl rand -base64 48`.
2. Update `infra/.env.production`.
3. Run `bash infra/scripts/deploy.sh`.
*(Note: Never rotate `ENCRYPTION_KEY` without first migrating existing encrypted sender SMTP passwords in PostgreSQL).*

---

## 10. Troubleshooting Reference

| Symptom | Probable Cause | Exact Fix |
|---|---|---|
| **Google `redirect_uri_mismatch`** | Redirect URI in Google Cloud Console does not match current host. | Open Google Cloud Console > Credentials > Edit Web Client > Ensure Authorized Redirect URI has exact match: `https://YOUR_DOMAIN/auth/google/callback`. |
| **Google "Access blocked: app not verified"** | App is in Testing mode with unlisted users, or requested sensitive scopes. | Ensure consent screen only requests `openid`, `email`, `profile`. Click **Publish App** to switch to In Production. Alternatively, add reviewer email to **Test users**. |
| **Slack redirect URI mismatch** | Slack app OAuth redirect URL does not match domain. | In api.slack.com > OAuth & Permissions > Add `https://YOUR_DOMAIN/api/integrations/slack/callback`. Click Save URLs. |
| **TLS Certificate not issued (HTTP 502 / SSL Error)** | DNS A record has not propagated, or port 80/443 is blocked. | Verify `dig +short YOUR_DOMAIN`. Check `sudo ufw status`. Check Caddy logs: `docker compose logs caddy`. |
| **Elasticsearch exits with code 137 (OOM)** | JVM heap exceeded container memory limit or host lacks RAM. | Check `free -m`. Ensure swap is active (`swapon --show`). Check `ES_JAVA_OPTS=-Xms512m -Xmx512m` in compose. |
| **Elasticsearch `max virtual memory areas vm.max_map_count [65530] is too low`** | Host kernel parameter not set. | Run `sudo sysctl -w vm.max_map_count=262144`. Ensure `/etc/sysctl.d/99-elasticsearch.conf` contains `vm.max_map_count=262144`. |
| **Session cookie not set / user logged out on refresh** | Browser rejecting cookie over HTTP, or `trust proxy` mismatch. | Ensure accessing via `https://`. Ensure `TRUST_PROXY=1` is set in `.env.production`. |
| **Bull Board returns 403 Forbidden** | Logged-in email does not match `ADMIN_EMAILS`. | Add your email to `ADMIN_EMAILS=your-email@example.com` in `infra/.env.production` and run `bash infra/scripts/deploy.sh`. |

---

## 11. Teardown & Cost Control

When the evaluation or demonstration is complete, tear down everything to avoid ongoing billing:

```bash
# 1. Stop all containers and remove volumes
cd /opt/scheduler
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production down -v

# 2. On your cloud provider dashboard:
# - Terminate / Destroy the VPS instance (Hetzner, DigitalOcean, or AWS Lightsail)
# - Delete any associated persistent block storage volumes or snapshots
# - Remove the DNS A record from your DNS manager
```
