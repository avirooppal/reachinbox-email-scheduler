# ReachInbox: Full-Stack Email Job Scheduler

Production-grade, verifiable distributed email job scheduler built with TypeScript, Node.js, Express, BullMQ, Redis, PostgreSQL (Prisma), Elasticsearch, and React.

### Reviewer Access & Live Endpoints
- **Live Production URL:** [https://reachinbox-email-scheduler-n1js.onrender.com](https://reachinbox-email-scheduler-n1js.onrender.com)
- **Reviewer Demo Credentials:** `demo@example.com` / `DemoPassword123!` *(or click "Continue with Google")*
- **Bull Board Queue Dashboard:** [https://reachinbox-email-scheduler-n1js.onrender.com/admin/queues](https://reachinbox-email-scheduler-n1js.onrender.com/admin/queues)
- **Prometheus Metrics:** [https://reachinbox-email-scheduler-n1js.onrender.com/metrics](https://reachinbox-email-scheduler-n1js.onrender.com/metrics)
- **Health Check:** [https://reachinbox-email-scheduler-n1js.onrender.com/health](https://reachinbox-email-scheduler-n1js.onrender.com/health)

---

## Feature Implementation Mapping

| Category | Requirement (from Brief) | Implementation & Code Location |
|---|---|---|
| **Scheduler Core** | Accept email send requests via API | `POST /api/campaigns` in [`campaigns.routes.ts`](backend/src/modules/campaigns/campaigns.routes.ts) |
| | BullMQ delayed jobs backed by Redis (**Zero Cron**) | `emailQueue.addBulk` in [`queue.bullmq.ts`](backend/src/adapters/queue.bullmq.ts) |
| | Ethereal Fake SMTP multi-sender delivery | `NodemailerTransportAdapter` in [`transport.nodemailer.ts`](backend/src/adapters/transport.nodemailer.ts) |
| | Elasticsearch full-text search & indexing | ES 8 client with external versioning in [`elasticsearch.ts`](backend/src/infra/elasticsearch.ts) & [`search-index.worker.ts`](backend/src/queue/search-index.worker.ts) |
| | Live BullMQ admin queue dashboard | Bull Board UI mounted at `/admin/queues` in [`board.ts`](backend/src/modules/admin/board.ts) |
| **Persistence & Safety** | Survive server/worker crash with zero loss or duplicate | Boot Reconciler in [`reconciler.ts`](backend/src/queue/reconciler.ts) |
| | At-most-once delivery idempotency | Advisory locks + Atomic SQL claim: `UPDATE emails SET status = 'PROCESSING' WHERE id = $id AND status = 'SCHEDULED'` in [`send-handler.ts`](backend/src/core/send-handler.ts) |
| | Tamper-proof audit trail | Append-only event ledger enforced via PostgreSQL engine trigger `trg_email_events_immutable` in [`trigger.sql`](backend/prisma/trigger.sql) |
| **Concurrency & Limits** | Configurable worker concurrency | Worker concurrency control via `WORKER_CONCURRENCY` in [`email.worker.ts`](backend/src/workers/email.worker.ts) |
| | Minimum inter-send delay per sender | Configurable `MIN_DELAY_BETWEEN_EMAILS_MS` (default 2s) enforced via Redis Lua scripts |
| | Hourly rate limiting per sender & global | Distributed Redis Lua scripts ([`fixed.lua`](backend/src/adapters/lua/fixed.lua), [`sliding.lua`](backend/src/adapters/lua/sliding.lua)) |
| | Overflow postponement without message drop | `job.moveToDelayed()` + `DelayedError` reschedules into next valid window without consuming retry limits |
| | Slack rate limit breach notification | Slack OAuth v2 flow & encrypted webhook dispatch in [`slack.routes.ts`](backend/src/modules/integrations/slack.routes.ts) & [`notification.worker.ts`](backend/src/queue/notification.worker.ts) |
| | Automatic sender failover | Circuit breaker trips degraded senders and fails over to healthy siblings in [`breaker.ts`](backend/src/core/breaker.ts) |
| **Frontend UI** | Real Google OAuth login | Google OAuth 2.0 flow with session JWT & profile header in [`LoginPage.tsx`](frontend/src/components/auth/LoginPage.tsx) |
| | Modern dark dashboard layout | Dark UI matching Figma specs in [`AppShell.tsx`](frontend/src/components/layout/AppShell.tsx) & [`Sidebar.tsx`](frontend/src/components/layout/Sidebar.tsx) |
| | Compose modal with CSV recipient parser | Subject, rich body, CSV upload, smart chips, inter-send delay & hourly limit controls in [`ComposePage.tsx`](frontend/src/components/compose/ComposePage.tsx) |
| | Scheduled emails table | Real-time countdown badges, recipient chips, cancel triggers in [`EmailList.tsx`](frontend/src/components/email/EmailList.tsx) |
| | Sent emails table with Ethereal preview | Sent timestamps, status indicators, direct preview modal links in [`EmailRow.tsx`](frontend/src/components/email/EmailRow.tsx) |
| | Email detail & audit ledger | Full MIME HTML renderer with expandable state timeline in [`EmailDetail.tsx`](frontend/src/components/email/EmailDetail.tsx) & [`TimelineView.tsx`](frontend/src/components/email/TimelineView.tsx) |

---

## Architecture & System Design

### 1. Zero-Cron BullMQ Delayed Model
Traditional schedulers poll the database with periodic cron queries (`WHERE scheduled_at <= NOW()`), causing CPU spikes and database contention. This architecture schedules every message as an independent BullMQ delayed job in Redis using deterministic identifiers (`jobId = emailId`). When the delay elapses, Redis pushes the job into the active queue for worker consumption with millisecond precision.

### 2. Dual-Tier Idempotency
- **Planning Level**: `pg_advisory_xact_lock(hashtext(senderId))` ensures concurrent campaign submissions cannot allocate conflicting slots on the same sender.
- **Execution Level**: Workers execute an atomic conditional update (`UPDATE emails SET status = 'PROCESSING' WHERE id = :id AND status = 'SCHEDULED' RETURNING *`). If another worker claimed the job, the query returns zero rows and execution aborts immediately, guaranteeing strictly at-most-once dispatch.

### 3. Atomic Redis Rate Limiting & Monotonic Overflow
- Sender rate limits and inter-email gaps are validated atomically using custom Redis Lua scripts ([`fixed.lua`](backend/src/adapters/lua/fixed.lua) or [`sliding.lua`](backend/src/adapters/lua/sliding.lua)).
- When a sender's hourly quota is reached, jobs are postponed to the next clock window via `job.moveToDelayed()` throwing `DelayedError`. This preserves queue position and prevents job drops or false failures.

### 4. Crash Recovery & Startup Reconciler
If a worker crashes mid-send or Redis is restarted:
- PostgreSQL remains the ACID ground truth.
- On boot, [`reconciler.ts`](backend/src/queue/reconciler.ts) scans all pending `SCHEDULED` emails, compares them with active Redis delayed keys, and resubmits missing jobs.
- Any jobs stuck in `PROCESSING` state for longer than `STALE_PROCESSING_MS` (e.g. killed process) are rolled back to `SCHEDULED` and logged in the audit ledger.

### 5. Append-Only Immutable Event Ledger
Every lifecycle event (`PLANNED`, `ENQUEUED`, `SLOT_RESERVED`, `CLAIMED`, `SENT`, `FAILED`, `CANCELLED`) is written to `email_events`. A native PostgreSQL trigger (`trg_email_events_immutable`) prevents `UPDATE` or `DELETE` operations on this table, ensuring verifiable delivery audit trails.

```mermaid
flowchart TD
    Client["Frontend Client / API"] -->|POST /api/campaigns| API["Express API Server"]
    API -->|Advisory Lock & Capacity Plan| PG[("PostgreSQL\n(Source of Truth)")]
    API -->|Append PLANNED & ENQUEUED| Ledger[("email_events\n(Append-Only Trigger)")]
    API -->|addBulk Delayed Jobs| RedisQueue[("Redis BullMQ\nemail-delivery")]
    
    subgraph Workers ["Worker Pool"]
        W1["Worker 1"]
        W2["Worker 2"]
    end
    
    RedisQueue -->|Pull { emailId }| Workers
    Workers -->|Atomic Lua Check| RedisLimiter[("Redis Rate Limiter\n(Gap + Cap)")]
    RedisLimiter -->|Cap Exceeded| Postpone["job.moveToDelayed()\n+ DelayedError"]
    Postpone --> RedisQueue
    
    RedisLimiter -->|Slot Available| AtomicClaim["Atomic SQL Claim\nUPDATE status='PROCESSING'"]
    AtomicClaim --> PG
    AtomicClaim --> Transport["Nodemailer / Ethereal SMTP"]
    Transport -->|Dispatch Message| SMTP["SMTP Server"]
    
    Transport -->|Success| Ledger
    Transport -->|Failure| Breaker["Circuit Breaker"]
    Breaker -->|Trip OPEN| Failover["Failover Sibling Sender"]
    
    Workers -->|Async Index Event| ESQueue[("search-index queue")]
    ESQueue --> ESWorker["Search Worker"]
    ESWorker --> ES[("Elasticsearch 8\n(Full-Text Search)")]
    
    Workers -->|Limit Breach| SlackQueue[("notifications queue")]
    SlackQueue --> SlackWorker["Slack Worker"]
    SlackWorker --> Slack["Slack Webhook Alert"]
```

---

## Local Setup & Quick Start

### 1. Prerequisites
- Docker & Docker Compose
- Node.js 20+
- npm 10+

### 2. Start Core Infrastructure (Docker)
Start PostgreSQL on port `5434`, Redis with AOF persistence on port `6379`, and Elasticsearch on port `9200`:
```bash
docker compose up -d
```
Verify containers are healthy:
```bash
docker compose ps
```

### 3. Setup & Start Backend
```bash
cd backend
npm install
npm run migrate
npm run seed

# Terminal 1: Start Express API server (runs on http://localhost:4000)
npm run dev:api

# Terminal 2: Start Background Email Worker
npm run dev:worker
```

### 4. Setup & Start Frontend
```bash
cd frontend
npm install

# Terminal 3: Start Vite Web Client (runs on http://localhost:5173)
npm run dev
```

### 5. Root Convenience Commands
From the project root:
```bash
npm run install:all     # Install dependencies for both backend and frontend
npm run build           # Full build (migrations, seeds, tsc, vite build)
npm run dev:api         # Start backend API
npm run dev:worker      # Start backend worker
npm run verify          # Run complete verification harness
```

---

## Environment Variables

### Backend Configuration (`backend/.env`)
```ini
# Application
PORT=4000
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
TRUST_PROXY=1

# Databases & Infrastructure
DATABASE_URL="postgresql://postgres:postgrespassword@localhost:5434/email_scheduler?schema=public"
REDIS_URL="redis://localhost:6379"
ELASTICSEARCH_URL="http://localhost:9200"

# Cryptographic Keys (AES-256-GCM & JWT)
JWT_SECRET="16102559d30cdbbe7d036b2418a94d167f45b526b2d30be678fce4984d1ca55f"
ENCRYPTION_KEY="7645c84306ac289baf1991b20326cfdebea114d1cee9039ab74e67618a67fe35"

# Concurrency & Rate Limiting
WORKER_CONCURRENCY=5
MIN_DELAY_BETWEEN_EMAILS_MS=2000
MAX_EMAILS_PER_HOUR_PER_SENDER=200
MAX_EMAILS_PER_HOUR_GLOBAL=0
RATE_LIMIT_MODE=fixed            # "fixed" or "sliding"
JITTER_PCT=15

# Retries & Stale Processing
JOB_ATTEMPTS=3
JOB_BACKOFF_MS=5000
STALE_PROCESSING_MS=120000

# Circuit Breaker
BREAKER_FAILURES=5
BREAKER_WINDOW_MS=60000
BREAKER_COOLDOWN_MS=120000
ENABLE_FAULT_INJECTION=false

# Google OAuth (Optional locally; pre-configured on live)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI="http://localhost:4000/auth/google/callback"

# Slack OAuth (Optional locally; pre-configured on live)
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI="http://localhost:4000/api/integrations/slack/callback"
```

### Frontend Configuration (`frontend/.env`)
```ini
VITE_BACKEND_URL=http://localhost:4000
```

---

## Verification & Test Harnesses

The repository includes a comprehensive test suite validating all concurrency, rate-limiting, and recovery invariants:

```bash
# Run unit & property-based tests (Vitest + fast-check)
npm --prefix backend run test

# Run 10,000-email virtual-clock simulation
npm --prefix backend run simulate

# Run high-surge load test (2,000 emails burst at same second)
npm --prefix backend run load

# Run chaos test harness (worker kills, Redis flushes, SMTP 451 injection)
npm --prefix backend run chaos

# Run Invariant Auditor against 7 delivery guarantees
npm --prefix backend run audit

# Run all verification suites in sequence
npm run verify
```

### The 7 Core Deliverability Invariants
1. **I1 (At-most-once):** Zero duplicate dispatches; unique SMTP message IDs.
2. **I2 (Hourly Cap):** Hourly delivery never exceeds the sender's limit in any window.
3. **I3 (Minimum Gap):** Inter-send delay strictly respected ($\ge$ configured delay).
4. **I4 (Nothing Lost):** Terminal count + pending count == total scheduled; zero abandoned jobs.
5. **I5 (Never Early):** `sent_at >= scheduled_at` (no early dispatch).
6. **I6 (Monotonic Overflow):** Postponed sends preserve chronological ordering.
7. **I7 (Store Agreement):** Redis delayed jobs match PostgreSQL `SCHEDULED` state with zero drift.

---

## Observability & Operations

- **Queue Management:** Bull Board dashboard at `/admin/queues` allows live inspection of `waiting`, `active`, `delayed`, `completed`, and `failed` jobs.
- **Prometheus Metrics:** Exported at `/metrics` with counters and gauges for queue depths, processing times, and sender statuses.
- **System Health:** Endpoint at `/health` checks connectivity for PostgreSQL, Redis, and Elasticsearch.
- **Elasticsearch Search Indexing:** Full-text search over email subjects, bodies, and recipients via `GET /api/emails/search?q=query`. Reindex anytime using `npm --prefix backend run reindex`.
