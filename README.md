# Outbox: Verifiable Email Scheduler Backend

A production-grade, verifiable email scheduling backend built in Node.js, TypeScript, PostgreSQL, Redis BullMQ, and Elasticsearch. Designed specifically to solve real cold-outreach deliverability challenges with strict deterministic guarantees, zero cron reliance, and formal invariant auditing.

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

