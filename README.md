# Outbox: Verifiable Email Scheduler Backend & Dashboard

> **Hiring Assignment:** Full-stack Email Job Scheduler for [ReachInbox.ai](https://reachinbox.ai) (Outbox Labs).  
> **Live Production URL:** [https://reachinbox-email-scheduler-n1js.onrender.com](https://reachinbox-email-scheduler-n1js.onrender.com)  
> **Reviewer Demo Credentials:** `demo@example.com` / `DemoPassword123!` (or sign in with any Google account).  
> **Bull Board Queue Dashboard:** [https://reachinbox-email-scheduler-n1js.onrender.com/admin/queues](https://reachinbox-email-scheduler-n1js.onrender.com/admin/queues)  
> **Prometheus Metrics:** [https://reachinbox-email-scheduler-n1js.onrender.com/metrics](https://reachinbox-email-scheduler-n1js.onrender.com/metrics)

---

## Feature Implementation Mapping

| Category | Requirement (from Brief) | Implementation & Location in Code |
|---|---|---|
| **Backend: Scheduler** | Accept email send requests via API | `POST /api/campaigns` (`backend/src/modules/campaigns/campaigns.routes.ts`) |
| | BullMQ delayed jobs backed by Redis (**Zero Cron**) | `emailQueue.addBulk` (`backend/src/adapters/queue.bullmq.ts`) |
| | Ethereal Email fake SMTP multi-sender delivery | `NodemailerTransportAdapter` (`backend/src/adapters/transport.nodemailer.ts`) |
| | Elasticsearch search & indexing | ES 8 client with full-text search (`GET /api/emails/search`) |
| | Live BullMQ dashboard | Bull Board UI mounted at `/admin/queues` (`backend/src/modules/admin/board.ts`) |
| **Backend: Persistence** | Survive server restart without losing or duplicating jobs | `reconciler.ts` runs on boot, scans PostgreSQL ground truth |
| | At-most-once idempotency | Atomic PostgreSQL claim lock: `UPDATE ... WHERE status = 'SCHEDULED' RETURNING *` |
| **Backend: Concurrency** | Configurable worker concurrency | `WORKER_CONCURRENCY` env (`backend/src/workers/email.worker.ts`) |
| | Delay between each email send | Configurable `MIN_DELAY_BETWEEN_EMAILS_MS` (default 2s) |
| | Hourly rate limiting per sender & global | Distributed Redis Lua sliding-window script (`backend/src/adapters/lua/`) |
| | Reschedule over-limit jobs into next hour window | `job.moveToDelayed()` + `DelayedError` (no dropped jobs, order preserved) |
| | Slack notification on rate limit hit | Live Slack OAuth v2 flow (`/api/integrations/slack`) + encrypted webhook alert |
| | High load surge handling | 10k email simulation & 2k surge load tests passing (`tools/simulate.ts`, `tools/load.ts`) |
| **Frontend: Auth & Shell** | Real Google OAuth login (no mock) | Google OAuth 2.0 flow with user name, email, avatar header & logout |
| | Figma-faithful dashboard layout | Dark modern theme matching Figma design (`frontend/src/components/layout/`) |
| **Frontend: Views** | Compose New Email with CSV upload | Subject, body, CSV lead parser with email count detection, delay & rate inputs |
| | Scheduled Emails Table | Email, subject, scheduled time badge, loading skeletons, empty state |
| | Sent Emails Table with Ethereal Previews | Email, subject, sent time, direct links to rendered Ethereal Web Viewer |
| | Code quality & UX | Full TypeScript typings, TanStack Query auto-polling (3s), Sonner toasts |

---

## 1. Thesis and Architecture

### System Thesis
Most outbound delivery engines fail due to two architectural traps:
1. **Cron/Polling sweepers** that query `WHERE scheduled_at <= NOW()` at fixed intervals, inducing thundering herds and unbounded lock contention.
2. **In-memory rate limiters** that drift or leak across multiple concurrent worker replicas.

Outbox eliminates both traps:
- **Zero Cron**: Delivery schedules are modeled exclusively as BullMQ delayed jobs with deterministic Redis keys (`jobId = emailId`).
- **PostgreSQL Source of Truth**: BullMQ carries minimal state (`{ emailId }`), decoupling job state from payload corruption.
- **Atomic Two-Tier Idempotency**: Jobs are deduplicated at the Redis layer (`jobId`), and atomically claimed at the PostgreSQL layer via `UPDATE emails SET status = 'PROCESSING' WHERE id = $id AND status = 'SCHEDULED' RETURNING *`.
- **Atomic Redis Lua Limiter**: Minimum delay (inter-send gaps) and hourly caps are enforced via a single multi-key Lua script with external `now` injection. Overflows are postponed via `moveToDelayed` + `DelayedError` without consuming retry attempts or dropping messages.
- **Append-Only Immutable Event Ledger**: Enforced at the database engine level via PostgreSQL trigger (`trg_email_events_immutable`) blocking any `UPDATE` or `DELETE` on `email_events`.
- **Mathematical Invariant Auditor**: Continuous validation of 7 core deliverability invariants against ground truth data.

```mermaid
flowchart TD
    Client["Client / API Consumer"] -->|POST /api/campaigns| API["Express API Server"]
    API -->|1. Advisory Lock & Slot Plan| PG[("PostgreSQL\n(Source of Truth)")]
    API -->|2. Append PLANNED & ENQUEUED| Ledger[("email_events\n(Append-Only Trigger)")]
    API -->|3. addBulk delayed jobs| RedisQueue[("Redis BullMQ\nemail-delivery")]
    
    subgraph Workers ["Multi-Worker Cluster"]
        W1["Worker Replica 1"]
        W2["Worker Replica 2"]
        W3["Worker Replica 3"]
    end
    
    RedisQueue -->|Pull { emailId }| Workers
    Workers -->|Atomic Lua Reserve| RedisLimiter[("Redis Atomic Limiter\n(Limit & Min Gap)")]
    RedisLimiter -->|Cap / Gap Exceeded| Postpone["job.moveToDelayed()\n+ DelayedError"]
    Postpone --> RedisQueue
    
    RedisLimiter -->|Slot Granted| AtomicClaim["Atomic DB Claim\nUPDATE status='PROCESSING'"]
    AtomicClaim --> PG
    AtomicClaim --> Transport["Nodemailer Pool / Ethereal"]
    Transport -->|Dispatch with <emailId@domain>| SMTP["SMTP Server"]
    
    Transport -->|Success| Ledger
    Transport -->|Failure| Breaker["Circuit Breaker & Failover"]
    Breaker -->|Trip OPEN| Sibling["Failover to Healthy Sibling"]
    
    Workers -->|Async Event| ESQueue[("search-index queue")]
    ESQueue --> ESWorker["Search Index Worker"]
    ESWorker --> ES[("Elasticsearch\n(External Versioning)")]
    
    Workers -->|Cap Hit| SlackQueue[("notifications queue")]
    SlackQueue --> SlackWorker["Slack Notification Worker"]
    SlackWorker --> Slack["Slack Incoming Webhook"]
```

---

## 2. Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+

### Boot the Stack
```bash
# 1. Start infrastructure (PostgreSQL on 5434, Redis with AOF on 6379, Elasticsearch on 9200)
docker compose up -d

# 2. Install dependencies & initialize database
cd backend
npm install
npm run migrate
npm run seed

# 3. Start API server (Terminal 1)
npm run dev:api

# 4. Start Worker (Terminal 2 - spawn additional terminals to test multi-worker safety)
npm run dev:worker
```

### Run Full Verification in One Command
```bash
npm run verify
```
This executes:
1. Vitest full unit and property test suites.
2. 10,000-email virtual-clock simulation across multiple senders.
3. Chaos suite (worker crashes, Redis loss, 3 parallel worker contention, SMTP fault injections).
4. Load harness (2,000 emails surging at the exact same start timestamp).
5. Mathematical Invariant Auditor across all 7 deliverability invariants.

---

## 3. Environment Configuration (`.env.example`)

All configuration is strictly validated on startup using Zod schemas (`src/config/env.ts`):

```bash
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Database & Cache (Real ports mapped from docker-compose.yml)
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/email_scheduler?schema=public"
REDIS_URL="redis://localhost:6379"
ELASTICSEARCH_URL="http://localhost:9200"

# Cryptographic Keys (32-byte hex for AES-256-GCM and JWT)
JWT_SECRET="00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

# Queue & Delivery Mechanics
JOB_ATTEMPTS=3
MAX_CONCURRENCY=10
DEFAULT_HOURLY_LIMIT=100
DEFAULT_MIN_DELAY_MS=2000
DEFAULT_JITTER_PCT=15
RATE_LIMIT_MODE=fixed # "fixed" | "sliding"

# Circuit Breaker Defaults
BREAKER_FAILURES=5
BREAKER_WINDOW_MS=60000
BREAKER_COOLDOWN_MS=60000

# Slack & Google OAuth (Optional in dev/test, gated test bypass provided)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI="http://localhost:3000/auth/google/callback"
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI="http://localhost:3000/api/integrations/slack/callback"
```

---

## 4. How Scheduling Works

```
           Campaign Input (N recipients, delayMs, hourlyLimit, jitterPct)
                                         │
                                         ▼
            pg_advisory_xact_lock(hashtext(senderId))  [Pessimistic Mutual Exclusion]
                                         │
                                         ▼
                 Query existing planned_at slots for active senders
                                         │
                                         ▼
       Pure First-Fit Slot Allocator: (startAt, delayMs, hourlyLimit, jitter)
                                         │
                      ┌──────────────────┴──────────────────┐
                      ▼                                     ▼
        email rows (planned_at)               email_events (PLANNED)
                      │
                      ▼
        BullMQ Delayed Jobs: delayMs = max(0, planned_at - now) (jobId = emailId)
```

1. **Advisory Locking**: `pg_advisory_xact_lock(hashtext(senderId))` prevents two concurrent campaign submissions from stepping on the same sender's timeline slots.
2. **Deterministic Jitter**: Applies non-negative cryptographic hash jitter (`seq` + `seed`) so scheduled slots never shift backwards before `startAt`.
3. **Pure Capacity Planner**: First-fit timeline slot allocation maps recipients across healthy senders with strict clock-hour cap and inter-send delay enforcement.

---

## 5. Persistence, Crash Recovery & The Reconciler

- **Redis AOF**: Redis is configured with `--appendonly yes` in `docker-compose.yml`, ensuring BullMQ delayed job metadata survives container restarts.
- **Crash Recovery**: If workers crash or Redis is cleared (`FLUSHALL`), the system state never drifts.
- **The Reconciler (`src/queue/reconciler.ts`)**:
  - Automatically executes once on worker startup, or on-demand via `POST /admin/reconcile`.
  - Re-enqueues missing BullMQ jobs for all `SCHEDULED` emails using bulk Redis set checking (`bull:email-delivery:delayed`, `wait`, `active`).
  - Reclaims stale `PROCESSING` jobs (unacknowledged for >5 minutes due to worker `kill -9`) back to `SCHEDULED` and logs a `RECOVERED` event.

---

## 6. Rate Limiting: Fixed vs Sliding Window

Atomic rate limiting is implemented via custom multi-key Lua scripts (`src/adapters/lua/fixed.lua` and `src/adapters/lua/sliding.lua`):

- **Fixed Window**: Bounded to clock-hour boundaries (`floor(now / 3600000)`). Allows boundary bursts (e.g., 50 at 10:59, 50 at 11:01).
- **Sliding Window**: Uses a Redis sorted set (`ZADD` + `ZREMRANGEBYSCORE`) to enforce rolling 60-minute window limits.
- **Virtual Clock Injection**: `now` is strictly supplied as an argument from the caller—never queried inside Lua via `redis.call('TIME')`. This enables deterministic, multi-day fast-forward testing in seconds.

### Empirical Boundary Burst Comparison (from `docs/evidence/simulate.txt`)
```text
--- SCENARIO 2: Rate Limiter Trade-off Analysis (Fixed vs Sliding) ---
Submitting 50 emails at 10:59 followed by 50 emails at 11:01 (Limit: 50/hr)
Fixed Mode:   Allowed 100/100 sends in a 2-minute span (Boundary Burst allowed due to hour rollover).
Sliding Mode: Allowed 50/100 sends in the same 2-minute rolling window (Rolling Cap enforced).
```

---

## 7. The Event Ledger & The 7 Invariants

Every state transition writes an append-only row to `email_events` in the same database transaction. The PostgreSQL trigger `trg_email_events_immutable` raises an exception if any query attempts an `UPDATE` or `DELETE` on this table.

The Invariant Auditor (`tools/audit.ts`) verifies 7 non-negotiable delivery guarantees:

| Invariant | Description | Verification Logic |
| :--- | :--- | :--- |
| **I1: At-most-once** | No email sent more than once; unique `messageId`. | `count(type = 'SENT') == 1` per email; duplicate `message_id == 0`. |
| **I2: Hourly Cap** | Never exceeds `hourlyLimit` in any clock-hour. | Max observed rate per sender per hour $\le$ sender cap. |
| **I3: Minimum Gap** | Consecutive sends respect `minDelayMs`. | Send time difference $\ge$ configured delay (-5ms skew allowance). |
| **I4: Nothing Lost** | No email stuck or forgotten. | Terminal count + pending == total scheduled; zero stuck in `PROCESSING`. |
| **I5: Never Early** | No email sent before its scheduled time. | `sent_at >= scheduled_at` (-1s skew allowance). |
| **I6: Monotonic Overflow** | Postponed sends retain chronological order. | Consecutive `RESCHEDULED` targets must be monotonic. |
| **I7: Store Agreement** | Redis delayed jobs match Postgres `SCHEDULED`. | Missing Redis jobs for pending rows == 0. |

---

## 8. Real Verification Evidence

All outputs below are real stdout logs captured from local test execution and persisted in `docs/evidence/`:

### 1. Multi-Day Virtual-Clock Simulation (`docs/evidence/simulate.txt`)
- **Dataset**: 10,000 emails across 3 senders over 2.29 simulated days.
- **Throughput**: 10,000 emails dispatched in **53.50 seconds** wall-clock time (~187 emails/sec).
```text
AUDIT campaign=85405096-a27c-4165-8c1d-39c92735f428  emails=10000  senders=3  window=2026-10-23..2026-10-25
 ✔ I1 at-most-once        10000 sends audited, 0 duplicate sends, 0 duplicate message_ids
 ✔ I2 hourly cap          max 60/hr observed, cap 60 (within limits)
 ✔ I3 min gap             min observed 2.00s, required 2.00s
 ✔ I4 nothing lost        10000 sent, 0 failed, 0 stuck (all drained)
 ✔ I5 never early         0 early send violations detected
 ✔ I6 overflow order      monotonic
 ✔ I7 stores agree        0 drift (missing Redis jobs for SCHEDULED rows)
RESULT: PASS
```

### 2. High-Surge Load Test (`docs/evidence/load.txt`)
- **Dataset**: 2,000 emails submitted at the exact same start timestamp (`2026-10-23T10:00:00Z`), Limit: 50/hr.
- **Result**: Capacity planner and limiter smoothly distributed all 2,000 emails across 40 clock-hour buckets. Exactly 50 emails sent in each hour.
```text
Observed Per-Hour Send Distribution:
  2026-10-23T10:00Z: 50 emails
  2026-10-23T11:00Z: 50 emails
  2026-10-23T12:00Z: 50 emails
  ... (40 total hourly buckets)
Max Observed Hourly Rate: 50 emails/hr (Cap: 50)
Min Observed Inter-Send Gap: 2.00s (Required: 2.00s)
RESULT: PASS
```

### 3. Chaos Engineering Harness (`docs/evidence/chaos.txt`)
- **Scenarios Tested**:
  - 3 parallel worker processes competing for the same BullMQ delayed queue.
  - Worker crash mid-send (`kill -9`) with unacknowledged `PROCESSING` jobs.
  - Complete Redis state loss with DB reconciliation.
  - Faulty SMTP transport with 30% transient 451 error rates.
- **Audit Outcome**: `RESULT: PASS` (Zero duplicate sends, zero lost emails, zero limiter breaches).

---

## 9. Observability & Operations

- **Bull Board Dashboard**: Accessible at `http://localhost:3000/admin/queues` (protected by admin authentication).
- **Prometheus Metrics**: Available at `GET /metrics` (`outbox_emails_sent_total`, `outbox_queue_depth`, etc.).
- **System Stats**: `GET /api/stats` returns live queue counts, sender capacities, and next scheduled delivery time.
- **Elasticsearch Search**: Full-text fuzzy search with keyword highlights via `GET /api/emails/search?q=query`.
- **Offline Index Reconstruction**: `npm run reindex` rebuilds Elasticsearch index from PostgreSQL truth with external document versioning.

---

## 10. Frontend Web Application

A pixel-faithful, responsive single-page web client matching the 7 Figma designs in `./design/` built with React 18, Vite, TypeScript, Tailwind CSS, TanStack Query, and TipTap.

### Quick Start
```bash
# In terminal 1 (with backend running):
cd frontend
npm install
npm run dev      # http://localhost:5173
```

### Supported User Capabilities
- **Authentication**: Google OAuth 2.0 flow and Email/Password authentication (`/auth/login`, `/auth/register`). Default seeded account: `oliver.brown@domain.io` / `password123`.
- **Dashboard Lists**:
  - **Scheduled View** (`/scheduled`): Real-time countdown badges (`Tue 9:15:12 AM`), recipient chips, snippet previews, and one-click star toggles.
  - **Sent View** (`/sent`): Sent/Failed state pills, sent timestamps (`Nov 3, 10:23 AM`), and Elasticsearch/SQL search.
- **Search & Filtering**: Instant search across subject, body, and recipient with star filters and manual queue refresh.
- **Compose Campaign** (`/compose`):
  - **Sender Selection**: Auto-rotation or specific sender selection with `+ Add Ethereal sender` on-the-fly generation.
  - **Recipient Chips**: Smart chip parsing on commas, spaces, or semicolons; `+N` popover modal for lists > 3 recipients; CSV file upload button.
  - **Delivery Controls**: Configurable inter-send delay (seconds) and sender hourly limits.
  - **Send Later**: Popover with quick presets ("Tomorrow, 10:00 AM", etc.) and datetime picker.
  - **Rich Text Editor**: TipTap editor with floating formatting toolbar (headings, lists, bold, italic, underline, alignment).
  - **Multipart Attachments**: File uploads up to 15MB total with thumbnail previews and downloads.
- **Email Detail View** (`/emails/:id`): Full HTML email rendering with callouts, sender details popover, attachment downloads, and expandable **Delivery Timeline & Audit Ledger** showing real-time event states (`PLANNED`, `ENQUEUED`, `SLOT_RESERVED`, `CLAIMED`, `SENT`).

### Visual Evidence (1440x900 Captures)
Real screenshot evidence captured from the running application against the live backend stack is stored in `docs/frontend-evidence/`:
1. `docs/frontend-evidence/01-login.png` - Login Card & OAuth
2. `docs/frontend-evidence/02-scheduled.png` - Scheduled Emails View
3. `docs/frontend-evidence/03-compose-send-later.png` - Compose with Send Later Popover
4. `docs/frontend-evidence/04-sent.png` - Sent Emails View
5. `docs/frontend-evidence/05-compose-attachment.png` - Compose with File Attachment
6. `docs/frontend-evidence/06-email-detail.png` - Email Detail, HTML Callouts & Timeline Expander
7. `docs/frontend-evidence/07-compose-recipients.png` - Recipient Chips (+4 Popover) & Upload List

---

## 11. Production Deployment & Live Stack

The Outbox stack is packaged for turnkey, single-VPS production deployment on Ubuntu 24.04 LTS with Docker Compose behind a Caddy edge reverse proxy. Full copy-paste commands and console click-paths are documented in [DEPLOY.md](file:///c:/Users/aviroop/Desktop/outbox/DEPLOY.md).

### Live Architecture
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

### Live Deployment & Reviewer Access
- **Live URL:** `https://reachinbox-email-scheduler-n1js.onrender.com`
- **Queue Dashboard (Bull Board):** `https://reachinbox-email-scheduler-n1js.onrender.com/admin/queues`
- **Prometheus Metrics:** `https://reachinbox-email-scheduler-n1js.onrender.com/metrics`
- **Health Check:** `https://reachinbox-email-scheduler-n1js.onrender.com/health`

Reviewers can access the live system through multiple zero-friction pathways:
1. **Seeded Demo Account (Immediate Access):**
   - **URL:** `https://reachinbox-email-scheduler-n1js.onrender.com/login`
   - **Email:** `demo@example.com`
   - **Password:** `DemoPassword123!`
2. **Google OAuth 2.0:**
   - Real Google sign-in is enabled via an OAuth Client ID requesting only non-sensitive scopes (`openid`, `email`, `profile`). The app is published to production, so any reviewer with a Google account can sign in without needing pre-allowlisting.
3. **Slack OAuth Integration:**
   - Multi-workspace public distribution is activated on the Slack app, enabling reviewers to connect their own Slack workspace to receive real-time rate limit notifications.
4. **Ethereal Mail Previews:**
   - Emails dispatch safely to Ethereal mock SMTP with preview URLs embedded in the UI and API, ensuring zero outbound spam while proving complete MIME rendering and attachment delivery.

### Key Production Hardening Guarantees
- **No Published DB Ports:** Only Caddy publishes ports 80 and 443. PostgreSQL (5432), Redis (6379), and Elasticsearch (9200) run strictly inside the isolated Docker `internal` network, immune to host port scans and UFW bypasses.
- **Production Kill-Switch Safety:** `ENABLE_FAULT_INJECTION` is hardcoded to `false` in production. Both the API and Worker refuse to boot if `ENABLE_FAULT_INJECTION` is enabled in production.
- **Zero Cron in Product:** Scheduling is 100% driven by BullMQ delayed queues with PostgreSQL atomic claim locks. Server backups are triggered via `infra/scripts/backup.sh` or optional host systemd timers, completely decoupled from email delivery.
- **Restart & Crash Resilience:** Scheduled jobs survive container restarts and Redis data flushes. The boot reconciler scans PostgreSQL ground truth and restores any missing BullMQ jobs automatically upon worker startup.
- **Redis Rate Limiting:** All authentication endpoints (`/auth/login`, `/auth/register`) are protected by a sliding-window Redis rate limiter (10 attempts/minute per IP) returning HTTP 429.

### Deployment & Verification Artifacts
- **Deployment Runbook:** [DEPLOY.md](file:///c:/Users/aviroop/Desktop/outbox/DEPLOY.md)
- **Production Compose Stack:** `infra/docker-compose.prod.yml`
- **Caddy Edge Config:** `infra/Caddyfile`
- **Automated Bootstrap Script:** `infra/scripts/bootstrap-server.sh`
- **Deployment Script:** `infra/scripts/deploy.sh`
- **Automated Smoke Test:** `infra/scripts/smoke-prod.sh`
- **Hot Backup & Scratch Restore:** `infra/scripts/backup.sh`, `infra/scripts/restore.sh`

---

## 12. Assumptions, Trade-offs & Demo Guide

### Assumptions & Architectural Trade-offs
1. **PostgreSQL as Primary Source of Truth vs Pure Redis:**
   - *Trade-off:* Relying solely on Redis makes scheduling faster, but risking data loss upon Redis memory eviction or persistence lag.
   - *Design Choice:* BullMQ carries only minimal pointers (`{ emailId }`). All campaign, recipient, attachment, and status states live in ACID PostgreSQL with an append-only event ledger. Redis can be flushed at any time (`FLUSHALL`) and the boot reconciler will rebuild 100% of missing jobs without data loss.
2. **Two-Tier Idempotency (Advisory Lock + Atomic Claim):**
   - *Trade-off:* Slightly higher database transaction overhead during campaign submission.
   - *Design Choice:* `pg_advisory_xact_lock(hashtext(senderId))` prevents slot collisions during bulk planning across concurrent API requests. When a worker pulls a job, `UPDATE emails SET status = 'PROCESSING' WHERE id = $id AND status = 'SCHEDULED'` guarantees at-most-once delivery even if two workers receive the same job ID.
3. **Delayed Error Postponement vs Retries for Rate Limiting:**
   - *Trade-off:* BullMQ jobs remain in `delayed` state rather than immediately completing or failing.
   - *Design Choice:* When a sender reaches their hourly quota, jobs are rescheduled into the next clock hour via `job.moveToDelayed()` without consuming the job's `attempts` counter. This prevents legitimate emails from being marked as dead-letter failures.
4. **Single-Service Edge Proxy (Caddy / Render Unified):**
   - *Trade-off:* Single domain routing.
   - *Design Choice:* Eliminates cross-origin cookie issues (`SameSite=Lax`), ensures HTTPS redirect URIs match on all platforms, and simplifies OAuth callback handling.

### Demo Video Walkthrough (< 5 Minutes)
1. **Login & Dashboard:** Sign in with Google (or `demo@example.com`). Observe user name and avatar in top header.
2. **Compose Campaign:** Open **Compose New Email**, enter Subject and Body, upload a CSV of leads (observe detected email count), set inter-send delay and hourly limit.
3. **Live Dispatch & Ethereal Previews:** Navigate to **Scheduled** tab -> watch real-time countdown -> navigate to **Sent** tab -> click an email to open the live **Ethereal Web Viewer** showing rendered MIME HTML.
4. **Queue Observability:** Open `/admin/queues` to inspect live BullMQ queue states (`Waiting`, `Active`, `Delayed`).
5. **Restart Scenario:** Explain that upon container or process restart, `reconciler.ts` queries PostgreSQL for all pending `SCHEDULED` emails and restores their BullMQ delayed timers with zero duplicate sends.



