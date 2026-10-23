# Backend Plan: A Verifiable Email Scheduler

Scope: backend only. The frontend comes after the backend meets its definition of done.
No time boxes. Each milestone ends with **acceptance criteria**, and nothing moves on until they pass.

---

## 0. Thesis

Most submissions for this brief will say "it's reliable". This one **proves it**.

> Every guarantee in the README maps to a written **invariant**, and every invariant has an **executable check** that runs against chaos, load and simulated multi-day runs.

Four ideas carry the whole design:

1. **Capacity-planned timeline.** Sends are not just delayed. They are *planned* onto a per-sender timeline at schedule time. A **preview endpoint** tells the user exactly when a campaign will finish before they commit.
2. **Append-only event ledger.** Every state change is recorded once. That single ledger powers the audit, the "why was this delayed?" explanations, the live UI feed and the Slack message.
3. **Invariant auditor.** A tool that reads the ledger and asserts: no duplicate sends, no cap breaches, no gap violations, nothing lost, nothing sent early.
4. **Deterministic simulator with a virtual clock.** Run 7 days of sending in seconds, using the same core logic as production, and audit the result.

Around them sit domain-aware touches that a cold-email platform would care about: sender **failover**, **jitter**, and a pluggable **limiter strategy**.

---

## 1. Guiding principles

1. **Postgres is the source of truth. Redis is a delivery mechanism.** If Redis is wiped, nothing is lost. A reconciler rebuilds jobs from the DB.
2. **Job payload is just `{ emailId }`.** The worker loads current state from the DB, so payloads stay tiny and cancel/edit-safe.
3. **Plan first, guard at runtime.** The planner makes collisions rare. The atomic limiter makes breaches impossible.
4. **Two idempotency layers.** BullMQ `jobId = emailId` stops duplicate enqueues. An atomic DB claim stops duplicate sends.
5. **No cron anywhere.** No cron libraries and no OS cron. No `setInterval` sweepers. Only BullMQ delayed jobs, plus a one-time reconciler at boot.
6. **Hexagonal core.** Business logic depends on ports (`Clock`, `Transport`, `Limiter`, `Repo`, `EventLog`). BullMQ, Nodemailer and real time are adapters. This is what makes the simulator possible.
7. **Honest guarantees.** State exactly where exactly-once breaks down (section 9).
8. **Never trade Tier 0 for flash.** See the scope guard in section 17.

---

## 2. What makes this different

| Differentiator | What it is | Why it impresses | Where it shows up |
|---|---|---|---|
| **Slot planner + preview** | Per-sender timeline, first-fit placement, serialized with an advisory lock | Collision-free scheduling, and users see the finish ETA before committing | Demo, Compose UI |
| **Event ledger** | Append-only `email_events` with typed events | One source for audit, explainability, live feed | `GET /emails/:id/timeline` |
| **Invariant auditor** | CLI and admin endpoint that checks 7 invariants | Turns "trust me" into a pass/fail report | README, demo |
| **Virtual-clock simulator** | Real limiter and planner logic, simulated time and transport | 7 simulated days in seconds, repeatable | README evidence |
| **Chaos harness** | `kill -9`, Redis flush, SMTP faults, multi-worker | Proves restart and idempotency claims | Demo |
| **Sender failover** | Circuit breaker reroutes to healthy senders | Real-world resilience, visibly demoable | Demo |
| **Jitter** | Deterministic, seeded variance on gaps | Cold-email domain awareness | Planner |
| **Limiter strategies** | `fixed` (per the brief) and `sliding` (precise), compared in the simulator | Shows the trade-off with numbers | README |
| **Demo as code** | `npm run demo:*` scripts, one per video scene | Flawless, repeatable 5-minute video | Submission |

---

## 3. Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node 20 + TypeScript (strict) | `tsx` for dev |
| HTTP | Express | Separate `api` and `worker` entrypoints, same codebase |
| Validation | Zod | Env, bodies, queries |
| DB | PostgreSQL + Prisma | Raw SQL where needed (advisory locks) |
| Queue | BullMQ + ioredis | Redis with **AOF on** |
| SMTP | Nodemailer + Ethereal | Pooled transport per sender |
| Search | Elasticsearch 8 | `@elastic/elasticsearch` |
| Queue UI | `@bull-board/express` | Behind auth |
| Auth | Google OAuth (code flow, server-side) | httpOnly JWT cookie |
| Slack | OAuth v2, `incoming-webhook` scope | Per-user stored webhook |
| Logging / metrics | pino, `prom-client` | Optional Grafana in compose |
| Tests | Vitest, Supertest, fast-check | Real Redis and Postgres |

---

## 4. Repository layout

```
/
├─ docker-compose.yml          # postgres, redis(AOF), elasticsearch, [prometheus, grafana]
├─ README.md   plan.md
├─ docs/evidence/              # audit, chaos, load, simulation outputs
├─ backend/
│  ├─ prisma/schema.prisma
│  ├─ src/
│  │  ├─ server.ts   worker.ts            # entrypoints
│  │  ├─ config/env.ts
│  │  ├─ core/                            # PURE. No Express, BullMQ, Nodemailer
│  │  │  ├─ ports.ts                      # Clock, Transport, Limiter, Repo, EventLog
│  │  │  ├─ planner/ (allocator.ts, jitter.ts, preview.ts)
│  │  │  ├─ send-handler.ts               # the one function that processes an email
│  │  │  ├─ limiter-strategy.ts
│  │  │  └─ errors.ts                     # transient vs permanent classification
│  │  ├─ adapters/
│  │  │  ├─ clock.system.ts  clock.virtual.ts
│  │  │  ├─ transport.nodemailer.ts  transport.mock.ts  transport.faulty.ts
│  │  │  ├─ limiter.redis.ts   lua/fixed.lua  lua/sliding.lua
│  │  │  ├─ repo.prisma.ts   eventlog.prisma.ts
│  │  │  └─ queue.bullmq.ts
│  │  ├─ modules/ (auth, senders, campaigns, emails, slack, search, admin, stats)
│  │  ├─ workers/ (email.worker.ts, index.worker.ts, notify.worker.ts)
│  │  └─ queue/reconciler.ts
│  ├─ tools/ (audit.ts, simulate.ts, chaos.ts, load.ts, reindex.ts, demo/*.ts)
│  └─ test/
```

---

## 5. Configuration (all env, none hardcoded)

| Var | Purpose | Example |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL`, `ELASTICSEARCH_URL` | Infra | |
| `WORKER_CONCURRENCY` | BullMQ concurrency | `5` |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | Default per-sender minimum gap | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Default hourly cap per sender | `200` |
| `MAX_EMAILS_PER_HOUR_GLOBAL` | Optional global cap (0 = off) | `0` |
| `RATE_LIMIT_MODE` | `fixed` or `sliding` | `fixed` |
| `JITTER_PCT` | Extra random spacing, deterministic per email | `15` |
| `JOB_ATTEMPTS`, `JOB_BACKOFF_MS` | Retry policy | `3`, `5000` |
| `STALE_PROCESSING_MS` | When `PROCESSING` counts as abandoned | `120000` |
| `BREAKER_FAILURES`, `BREAKER_WINDOW_MS`, `BREAKER_COOLDOWN_MS` | Circuit breaker | `5`, `60000`, `120000` |
| `ENABLE_FAULT_INJECTION` | Chaos endpoints (never in prod) | `false` |
| `GOOGLE_*`, `SLACK_*`, `JWT_SECRET`, `ENCRYPTION_KEY`, `FRONTEND_URL`, `ADMIN_EMAILS` | Auth and integrations | |

Effective limit and delay precedence: **campaign, then sender, then env default**, with the global cap enforced on top when set.

---

## 6. Data model (Postgres)

```
users(id, google_id UNIQUE, email, name, avatar_url, created_at)

senders(id, user_id, name, from_email, smtp_host, smtp_port, smtp_user, smtp_pass_enc,
        hourly_limit NULL, min_delay_ms NULL, is_active,
        health ENUM(HEALTHY, DEGRADED, OPEN), health_changed_at, created_at)

campaigns(id, user_id, subject, body_template, start_at, delay_ms, hourly_limit,
          total, idempotency_key NULL, planned_finish_at, created_at,
          UNIQUE(user_id, idempotency_key))

emails(id, campaign_id, user_id, sender_id, to_email, subject, body, seq,
       planned_at,            -- immutable: what the planner promised
       scheduled_at,          -- mutable: where it sits now (after any reschedule)
       status ENUM(SCHEDULED, PROCESSING, SENT, FAILED),
       attempts, message_id, preview_url, last_error,
       claimed_at, sent_at, created_at, updated_at,
       UNIQUE(campaign_id, to_email),
       UNIQUE(sender_id, planned_at))       -- DB-enforced timeline collision guard
  INDEX (status, scheduled_at)   INDEX (user_id, status, scheduled_at)

email_events(id BIGSERIAL, email_id, campaign_id, sender_id, type, at TIMESTAMPTZ,
             data JSONB)                    -- APPEND-ONLY. No UPDATE, no DELETE.
  INDEX (email_id, id)   INDEX (sender_id, type, at)

slack_integrations(id, user_id UNIQUE, team_name, channel, webhook_url_enc,
                   status ENUM(CONNECTED, DISCONNECTED), connected_at, updated_at)
```

Event types and payloads:

| Type | `data` |
|---|---|
| `PLANNED` | `{ plannedAt, senderId, jitterMs }` |
| `ENQUEUED` | `{ delayMs }` |
| `RESCHEDULED` | `{ from, to, reason: RATE_LIMIT \| MIN_GAP \| SENDER_OPEN }` |
| `SLOT_RESERVED` | `{ reservedAt, limit, gapMs, windowCount, mode }` |
| `CLAIMED` | `{ attempt, workerId }` |
| `SENT` | `{ messageId, previewUrl }` |
| `SMTP_ERROR` | `{ code, transient, message }` |
| `FAILOVER` | `{ fromSender, toSender }` |
| `RECOVERED` | `{ from: PROCESSING, reason: STALE }` |
| `FAILED` | `{ reason }` |

Secrets (`smtp_pass_enc`, `webhook_url_enc`) are AES-256-GCM encrypted at rest.
`email_events` writes happen in the same transaction as the state change they describe, so the ledger can never disagree with the table.

---

## 7. Architecture

```
            ┌─────────────┐   schedule / preview    ┌──────────────┐
  Client ──▶│  API (Express)│────────────────────────▶│  Postgres    │◀─ source of truth
            └──────┬──────┘   planner + ledger       │ emails,events│
                   │ addBulk(jobId=emailId)           └──────▲───────┘
                   ▼                                         │
            ┌─────────────┐   delayed jobs         ┌────────┴───────┐
            │ Redis/BullMQ │◀──────────────────────│ Worker × N     │
            │ (AOF)        │  moveToDelayed        │ send-handler   │──▶ Ethereal SMTP
            │ + Lua limiter│◀─ reserve slot ───────│ (core, ports)  │──▶ search-index queue ─▶ Elasticsearch
            └─────────────┘                        └────────┬───────┘──▶ notifications queue ─▶ Slack
                                                            │
                                         Auditor / Simulator read the ledger and the same core
```

The `send-handler` in `core/` is the only place sending logic lives. Production wires it to BullMQ, Redis and Nodemailer. The simulator wires it to a virtual clock, a mock transport and an in-process time-ordered queue. **Same logic, different adapters.**

---

## 8. Milestones

### M0: Foundations
- Monorepo, TS strict, lint, `docker-compose.yml` (Postgres, Redis with `appendonly yes`, Elasticsearch single-node with security off and a small heap).
- Zod `config/env.ts`, pino logger, error handler, `/health` and `/ready`.
- `core/ports.ts` with the five port interfaces and system adapters for `Clock`.
- Prisma schema and first migration (section 6).

**Accept:** `docker compose up` then `npm run dev` boots; `/ready` checks DB, Redis and ES; bad env aborts with a clear message.

### M1: Auth (real Google OAuth)
- `/auth/google`, `/auth/google/callback` (state-checked), `/auth/me`, `/auth/logout`. httpOnly SameSite=Lax JWT cookie, redirect to `FRONTEND_URL/dashboard`.
- `requireAuth` middleware, CORS with credentials.

**Accept:** a real Google login creates a session; protected routes return 401 without it.

### M2: Senders
- CRUD at `/api/senders`; `POST /api/senders/ethereal` creates a test account via `nodemailer.createTestAccount()`.
- Seed script creates 3 senders. Transports are pooled and cached, and `verify()` runs at creation.
- Per-sender `hourly_limit` and `min_delay_ms` overrides. `health` defaults to `HEALTHY`.

**Accept:** a user has several active senders; a bad SMTP config returns a clear error.

### M3: Event ledger (foundation for everything after)
- `EventLog` port with a Prisma adapter: `append(tx, event)`. Append-only enforced at the DB level (revoke UPDATE/DELETE on `email_events` for the app role, or a trigger that raises).
- Helper `withLedger(tx, emailId, mutation, event)` that applies a state change and its event atomically.
- `GET /api/emails/:id/timeline` returns the ordered events, plus a plain-English `summary` ("Planned for 10:00. Delayed 52 min: hourly limit reached. Sent 10:52.").

**Accept:** mutating an event row fails; every state-changing code path writes exactly one event in the same transaction (tested).

### M4: Planner (pure function, written before the API)
`allocate({ startAt, delayMs, hourlyLimit, jitterPct, senders[], occupied: Map<senderId, sortedTimes[]>, count, seed })` returns `[{ seq, senderId, plannedAt }]`.

- Round-robin across **HEALTHY** senders (`OPEN` ones are skipped).
- **First-fit on each sender's timeline:** a candidate time is valid if it respects the minimum gap to its neighbors in `occupied` and keeps the clock-hour under `limit` (counting already-occupied slots). Otherwise it moves on to the next free slot.
- **Jitter:** extra spacing in `[0, JITTER_PCT% × gap]`, derived from `hash(seed, seq)` so reruns are identical. Jitter only **adds** to the gap, so the minimum is never violated.
- `preview(...)` runs the same function without persisting and returns `finishAt`, per-hour counts, per-sender split and warnings (e.g. "will take 9 days at current limits").
- Persistence side (in M5): inside one transaction, take `pg_advisory_xact_lock(hash(senderId))` for each involved sender, read the occupied window, allocate, insert. This serializes concurrent campaign submissions so two campaigns never claim the same slot. `UNIQUE(sender_id, planned_at)` is the backstop.

**Accept:** property tests (fast-check) prove: no sender exceeds the cap in any clock hour; gaps are at least the minimum even with jitter; same seed gives same output; no collisions with pre-occupied slots; 10,000 emails allocate in well under a second.

### M5: Schedule and Preview APIs
- `POST /api/campaigns/preview` returns the planner's `preview` output. Nothing is written.
- `POST /api/campaigns`:
  ```json
  { "subject": "...", "body": "Hi {{firstName}}", "startAt": "ISO",
    "delayMs": 2000, "hourlyLimit": 100,
    "recipients": [{ "email": "a@x.com", "vars": { "firstName": "A" } }] }
  ```
  Also accepts multipart CSV/text (for Postman), parsed and validated identically.
- `Idempotency-Key` header: a repeated key returns the original campaign.
- Steps: validate, normalize and dedupe, take sender locks, plan, insert emails and `PLANNED` events in chunked `createMany` in one transaction, commit, then `addBulk` in chunks with `jobId = emailId` and `delay = max(0, plannedAt - now)`, then append `ENQUEUED` events.
- Enqueue happens after commit. If it fails midway, the reconciler repairs it, so data is never lost.
- Response: `{ campaignId, accepted, duplicatesRemoved, invalid[], plannedFinishAt }`.

**Accept:** 1,000 recipients process quickly with bounded memory; DB rows and Redis delayed jobs match 1:1; preview and the real plan agree exactly for the same input; repeated `Idempotency-Key` creates nothing.

### M6: Send handler and worker
`core/send-handler.ts` is `handle(emailId, ctx)` with `ctx = { clock, repo, limiter, transport, events }`. The BullMQ worker is a thin adapter around it.

Flow:
1. Load email, campaign and sender. If status is `SENT` or `FAILED`, return (no-op).
2. If the sender's health is `OPEN`, fail over (M11) or reschedule.
3. `limiter.reserve(...)` (M7). If denied: update `scheduled_at`, append `RESCHEDULED`, `moveToDelayed`, throw `DelayedError`. Status stays `SCHEDULED` and **no attempt is consumed**.
4. **Atomic claim:** `UPDATE emails SET status='PROCESSING', claimed_at=now(), attempts=attempts+1 WHERE id=$1 AND status='SCHEDULED' RETURNING *`, with a `CLAIMED` event in the same transaction. Zero rows means return.
5. Send with a deterministic `Message-ID` (`<emailId@domain>`).
6. Mark `SENT` (+ `SENT` event) with `message_id` and `preview_url`, and enqueue the index update.
7. On error: classify. Transient (SMTP 4xx, network) releases the row to `SCHEDULED` and rethrows for backoff. Permanent (5xx) marks `FAILED`. Every error appends `SMTP_ERROR`. After the final attempt, mark `FAILED`.

BullMQ adapter: configurable `WORKER_CONCURRENCY`, tuned `lockDuration` and `stalledInterval`, `maxRetriesPerRequest: null`, SIGTERM handled by `worker.close()`.

**Accept:** with concurrency 5, no email is sent twice; failures retry and end as `FAILED` with a recorded reason; SIGTERM never drops an in-flight job.

### M7: Limiter (Lua, atomic, strategy-based)
`Limiter.reserve({ senderId, now, limit, gapMs })` returns `ALLOWED | LIMITED(retryAt) | TOO_SOON(retryAt)` plus a `limitReachedNow` flag.

**Strategy `fixed` (default, matches the brief's `hour_window + sender` keying):**
```lua
-- KEYS[1] = rl:{sender}:{windowStart}      hourly counter
-- KEYS[2] = gap:{sender}                   next allowed send time (ms)
-- KEYS[3] = spill:{sender}:{windowStart}   overflow rank for this window
-- ARGV: now_ms, limit, min_delay_ms, window_ms, window_start
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit, gap, win = tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local now, wstart = tonumber(ARGV[1]), tonumber(ARGV[5])

if count >= limit then
  local rank = redis.call('INCR', KEYS[3])
  redis.call('PEXPIRE', KEYS[3], win * 3)
  local retry = wstart + win + math.floor((rank - 1) / limit) * win + ((rank - 1) % limit) * gap
  return {1, retry, 0}                       -- LIMITED
end

local nextAllowed = tonumber(redis.call('GET', KEYS[2]) or '0')
if now < nextAllowed then return {2, nextAllowed, 0} end   -- TOO_SOON

count = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], win * 2)
redis.call('SET', KEYS[2], now + gap, 'PX', gap * 2)
return {0, 0, (count == limit) and 1 or 0}   -- ALLOWED (+ flag exactly once at the cap)
```

**Strategy `sliding` (precise):** a sorted set of send timestamps per sender. Entries older than `now - window` are pruned, and `ZCARD >= limit` means limited. The k-th overflow waits until the k-th oldest entry ages out, so a rolling hour never exceeds the cap. This removes the fixed window's boundary burst. It is shipped only if the simulator and auditor pass with it.

Design points:
- `now` is **passed in**, never read inside Lua. That is what lets the simulator drive the real script with a virtual clock.
- Minimum delay uses the `gap` key, not a `sleep`, so concurrency slots are never wasted.
- Overflow is rescheduled in rank order, never dropped.
- `SLOT_RESERVED` is written on every allowance, recording `reservedAt`, `limit`, `gapMs`, `windowCount` and `mode`. The auditor uses these records.
- The `limitReachedNow` flag fires exactly once per sender per window and triggers Slack (M13).

**Accept:** 500 parallel `reserve` calls at limit 100 allow exactly 100; reserved times are at least the gap apart; two worker processes together never exceed the cap; overflow keeps order; the simulator shows the fixed-window boundary burst versus the sliding mode's rolling cap.

### M8: Persistence and reconciler
- Redis AOF means delayed jobs survive a Redis restart. A server or worker restart loses nothing.
- **Boot reconciler** (once at worker start, plus admin-only `POST /admin/reconcile`):
  - `SCHEDULED` rows with no job: re-enqueue with `jobId = emailId` (duplicate `jobId`s are ignored).
  - `PROCESSING` rows older than `STALE_PROCESSING_MS`: append `RECOVERED` and return to `SCHEDULED` under the policy in section 9.
- Deliberately **not periodic**. A repeating sweeper is a cron in disguise. BullMQ's stalled-job recovery covers in-flight crashes.

**Accept:** (a) kill API and worker mid-run, restart: remaining emails send on time with no duplicates; (b) `FLUSHALL` Redis, restart: the reconciler rebuilds every pending job and sending resumes.

### M9: Invariant auditor
`npm run audit -- --campaign <id>` (or `--all`) and admin-only `GET /admin/audit`. Reads Postgres and the ledger and prints a pass/fail report.

| # | Invariant | How it is checked |
|---|---|---|
| I1 | **At most one send per email** | `COUNT(SENT) <= 1` per `email_id`; `message_id` is unique |
| I2 | **Hourly cap never exceeded** | From `SLOT_RESERVED`: per sender, count in each clock hour (fixed) or any rolling hour (sliding), compared with the `limit` recorded in the event |
| I3 | **Minimum gap respected** | Per sender, consecutive `reservedAt` differences >= recorded `gapMs`. Reservation times are audited, not SMTP completion times, because SMTP latency varies |
| I4 | **Nothing lost** | Every `PLANNED` email reaches a terminal state (`SENT` or `FAILED`) once the campaign is drained |
| I5 | **Nothing sent early** | `SENT.at >= scheduled_at` at the time of send |
| I6 | **Overflow order preserved** | Within a sender, `RESCHEDULED` targets are monotonic in rank |
| I7 | **Stores agree** | Postgres status matches the ES doc, and every `SCHEDULED` row has a Redis job (a report, since ES is eventually consistent) |

Example output (this goes in the README):
```
AUDIT campaign=c_92ab  emails=2000  senders=3  window=2026-10-23..2026-10-25
 ✔ I1 at-most-once        2000/2000 unique sends, 0 duplicate message_ids
 ✔ I2 hourly cap          max 50/hr observed, cap 50 (fixed mode)
 ✔ I3 min gap             min observed 2.31s, required 2.00s
 ✔ I4 nothing lost        2000 sent, 0 failed, 0 stuck
 ✔ I5 never early         0 violations
 ✔ I6 overflow order      monotonic
 ✔ I7 stores agree        0 drift
RESULT: PASS
```

**Accept:** deliberately corrupt data (insert a duplicate `SENT`, shift a timestamp) and the auditor catches it. The auditor passes after every chaos, load and simulation run.

### M10: Simulator, chaos and load (the evidence)
**Simulator** (`tools/simulate.ts`):
- Wires `core/send-handler` to `VirtualClock`, `MockTransport` and an in-process queue ordered by virtual time. The real Lua limiter and real planner run against real Redis and Postgres, with `now` injected.
- Scenarios: 10k emails over 7 simulated days with 3 senders; two overlapping campaigns on one sender; the adversarial boundary case (burst at 10:59, then 11:01) comparing `fixed` vs `sliding`; senders going down and recovering.
- Always ends with the auditor.
- Honest scope: the simulator verifies decision logic and invariants. BullMQ's own behavior is verified by the chaos script, not simulated.

**Chaos** (`tools/chaos.ts`), against real processes:
- Schedule 200 emails, `kill -9` workers at random points, restart, then audit.
- Variant: `FLUSHALL` Redis mid-run, then rely on the reconciler.
- Variant: 3 worker processes running in parallel, then audit (proves the limits hold across instances).
- Variant: SMTP fault injection (`POST /admin/faults`) to exercise retries and failover.

**Load** (`tools/load.ts`):
- 2,000 emails at the same `startAt`, limit 50/hr, mock transport. Prints per-hour send counts, max observed rate vs cap, min observed gap.

**Accept:** all three produce output saved to `docs/evidence/`, each ending in `RESULT: PASS`.

### M11: Sender health, circuit breaker, failover
- Per sender, Redis tracks failures in `BREAKER_WINDOW_MS`. At `BREAKER_FAILURES`, the sender goes `OPEN` (persisted in `senders.health`) for `BREAKER_COOLDOWN_MS`, then `DEGRADED` (one probe send), then `HEALTHY` on success.
- When a job's sender is `OPEN`, the handler **fails over** to another `HEALTHY` sender: updates `sender_id` and appends `FAILOVER`. The destination sender's limiter still applies, so caps are never bypassed. If none are healthy, the job is rescheduled past the cooldown with reason `SENDER_OPEN`.
- The planner skips `OPEN` senders for new campaigns.
- Fault injection (`ENABLE_FAULT_INJECTION`): `POST /admin/faults { senderId, mode: "smtp_down" | "slow" | "flaky", rate }`.

**Accept:** inject `smtp_down` on one sender mid-run; its emails move to the others, nothing is lost, caps hold, and the auditor passes.

### M12: Elasticsearch
- Index `emails` with `to_email` (keyword + text), `subject` and `body` (text), `status` and `sender_id` (keyword), `user_id`, `campaign_id`, `planned_at`, `scheduled_at`, `sent_at`.
- Indexing runs through a **`search-index` queue** with retries, so an ES outage never blocks sending. Documents use `_id = emailId` and **external versioning** (`updated_at` epoch) so out-of-order updates can't regress state.
- `GET /api/emails/search?q=&status=&senderId=&from=&to=&page=&limit=`, always filtered by `user_id`, with highlights.
- `tools/reindex.ts` rebuilds the index from Postgres.

**Accept:** a scheduled email is searchable within seconds; stopping ES doesn't stop sending, and indexing catches up afterwards; reindex restores an empty index.

### M13: Slack OAuth and notifications
- `GET /api/integrations/slack/connect` returns the authorize URL with a signed `state` (user ID + nonce). The `incoming-webhook` scope lets the user pick the channel.
- Callback exchanges the code at `oauth.v2.access`, encrypts and stores the webhook, marks `CONNECTED`. `DELETE` disconnects. `GET` returns status.
- On the limiter's `limitReachedNow` flag, enqueue a `notifications` job. At send time it looks up the user's integration and posts: sender, limit, window, how many emails are waiting, and when the next window opens. It can also link to the email's timeline.
  - Not connected: skip silently.
  - Connected later: works on the next hit, no redeploy.
  - Revoked webhook (404/410): mark `DISCONNECTED`.
  - Transient failure: retry with backoff.
- Slack needs an HTTPS redirect URI, so run a cloudflared/ngrok tunnel.

**Accept:** a real message lands in Slack when the cap is hit; disconnect then hit sends nothing and doesn't crash; reconnect then hit works again.

### M14: Operations and observability
- Bull Board at `/admin/queues` behind `requireAuth` plus an `ADMIN_EMAILS` allowlist, with all three queues registered.
- `GET /api/stats`: queue counts, per-sender usage vs limit for the current window, sender health, next scheduled send.
- `GET /api/emails?status=scheduled|sent|failed&page=&limit=` for the dashboard tables, including `planned_at`, `scheduled_at`, `preview_url`.
- `GET /metrics` (Prometheus): sends, failures, reschedules, limit hits, failovers, queue depth, per-sender usage. A provisioned Grafana dashboard in compose is optional (see the cut order in section 17).
- Optional: worker events published via Redis pub/sub and exposed as SSE for a live dashboard feed.

**Accept:** Bull Board shows live movement; `/api/stats` matches reality during a run.

### M15: Demo as code, README, hardening
- Demo scripts, one per video scene (section 12), each deterministic and idempotent: `npm run demo:schedule`, `demo:restart`, `demo:ratelimit`, `demo:failover`, `demo:audit`.
- README built from section 14, with real evidence from `docs/evidence/`.
- Hardening: helmet, body-size limits, Redis-backed API rate limiting on auth and schedule endpoints, header-injection checks on subject and body, recipient caps, secrets never logged, no stack traces to clients.

**Accept:** a fresh clone reaches a green demo with `docker compose up`, `npm run seed` and `npm run demo:*`.

---

## 9. Delivery guarantees (README table)

| Scenario | Outcome |
|---|---|
| Duplicate enqueue of the same email | Ignored by BullMQ (`jobId = emailId`) |
| Two workers pick up the same email | Only one wins the atomic claim |
| Client double-submits the schedule request | Same `Idempotency-Key` returns the original campaign |
| Two campaigns planned concurrently on one sender | Advisory lock serializes; `UNIQUE(sender_id, planned_at)` backstops |
| API/worker killed mid-run | Delayed and in-flight jobs resume; completed emails are not resent |
| Redis loses all data | Reconciler re-enqueues from Postgres |
| A sender's SMTP goes down | Breaker opens; emails fail over; caps still enforced |
| **Crash after SMTP accepts but before the DB write** | **The one real gap.** Exactly-once across two systems is impossible. On retry, the stale `PROCESSING` row is resent with the **same `Message-ID`** so receivers can dedupe. Marking `SENT` immediately after the SMTP response keeps the window to milliseconds. This is stated openly in the README. |

---

## 10. Behavior under load (1000+ emails at the same instant)

1. The schedule API inserts in chunks inside one transaction and enqueues in chunks of ~500. Payloads are tiny, so memory stays flat.
2. The **planner already spreads the load**: per sender, spaced by the gap, never more than `limit` per hour. A thousand "simultaneous" requests become a deterministic timeline, and the preview shows its finish time.
3. If real execution still breaches a cap (worker lag, overlapping campaigns, failover), the Lua guard reschedules the overflow into later windows in rank order. Nothing is dropped.
4. Concurrency only parallelizes work. The gap and the counters are shared Redis state, so adding workers or instances cannot break limits.
5. `tools/load.ts` and the simulator demonstrate this with numbers, and the auditor confirms it.

---

## 11. Test strategy

**Unit:** planner (caps, gaps, jitter determinism, collisions, hour boundaries, limit 1, huge counts), error classification, limit precedence, ledger helpers.
**Integration (real Postgres + Redis):** limiter concurrency, claim race, retry-to-`FAILED`, `DelayedError` not consuming attempts, reconciler (including double-run), schedule API (validation, dedupe, idempotency, concurrent campaigns on one sender), auth and Bull Board access, Slack states, search and tenant isolation, ES-down recovery, breaker and failover.
**Property-based (fast-check):** planner invariants; limiter invariants under random arrival patterns.
**Evidence tools:** simulator, chaos, load. Every run ends with the auditor.

---

## 12. Demo storyline (max 5 minutes, all scripted)

| Time | Scene | Command |
|---|---|---|
| 0:00 | Preview a 500-email campaign: finish ETA and per-hour chart, then schedule it | `demo:schedule` |
| 0:45 | Scheduled tab, Bull Board, Elasticsearch search, one email's timeline | UI + `GET /emails/:id/timeline` |
| 1:30 | `kill -9` everything, restart, emails still go out on time, then flush Redis and watch the reconciler rebuild | `demo:restart` |
| 2:30 | Hit the hourly limit: live Slack message arrives, jobs roll into the next window | `demo:ratelimit` |
| 3:15 | Kill one sender's SMTP: emails fail over, caps hold | `demo:failover` |
| 3:50 | Run the auditor: seven green checks | `demo:audit` |
| 4:20 | Simulation: 7 simulated days in seconds, `fixed` vs `sliding` numbers | `npm run simulate` |
| 4:45 | One slide of the architecture and trade-offs | |

---

## 13. Decision log (README "Trade-offs")

| Decision | Reason | Trade-off |
|---|---|---|
| DB as source of truth | Redis loss must not lose emails | Extra writes per send |
| Payload = `{emailId}` | Small jobs, current state, cancel-safe | One DB read per job |
| Plan first, guard at runtime | Fewer collisions, visible ETA | Planner complexity |
| Append-only ledger in the same transaction | Audit and explainability for free | More rows (indexed, prunable) |
| Hexagonal core | Enables the simulator and fast tests | More files and interfaces |
| Lua with injected `now` | Atomic, and drivable by a virtual clock | Slightly more complex than BullMQ's limiter |
| Redis gap key instead of `sleep` | Doesn't waste concurrency | More Redis logic |
| `fixed` default, `sliding` optional | Matches the brief, and the simulator quantifies the difference | Two code paths to test |
| Boot-only reconciler | No cron-like sweeps, per the brief | Drift is repaired only on restart or admin call |
| Failover via breaker | Real-world resilience | Extra state to reason about |
| ES indexing through a queue | ES outage never blocks sending | Eventual consistency |
| Webhook-based Slack | Simple per-user OAuth | Channel fixed at connect time |

---

## 14. README outline (write each section as you build)

1. Thesis and architecture diagram (Mermaid).
2. Quick start: `docker compose up`, `.env.example`, migrate, seed, run API and worker(s).
3. Ethereal setup.
4. How scheduling works (planner, preview, delayed jobs).
5. Persistence and restart behavior (DB truth, AOF, reconciler).
6. Rate limiting and concurrency (Lua, the delay value chosen, `fixed` vs `sliding`, multi-worker safety, trade-offs).
7. The ledger and the seven invariants, with real audit output.
8. Delivery guarantees (section 9 table).
9. Behavior under load, with the load and simulator outputs.
10. Chaos results.
11. Feature checklist mapped to the brief.
12. Assumptions, shortcuts, trade-offs.

---

## 15. Definition of done

**Tier 0: the brief (non-negotiable)**
- [ ] Real Google OAuth login and a protected API
- [ ] Multiple Ethereal senders
- [ ] Schedule API (CSV/JSON), BullMQ delayed jobs, **no cron**
- [ ] Configurable concurrency, minimum delay, hourly limit
- [ ] Redis-atomic limiter safe across workers; overflow rescheduled, never dropped
- [ ] Live Slack OAuth with a real message on limit hit; clean disconnect and reconnect
- [ ] Elasticsearch indexing and search
- [ ] Bull Board dashboard
- [ ] Restart scenario proven; no duplicate sends
- [ ] 1000+ simultaneous scheduling handled
- [ ] README, `.env.example`, one-command setup

**Tier 1: the differentiators**
- [ ] Event ledger, append-only, written in the same transaction as state changes
- [ ] Planner with first-fit, advisory lock and `planned_at` vs `scheduled_at`
- [ ] Preview endpoint whose output matches the real plan exactly
- [ ] Invariant auditor with 7 checks, and a test that proves it catches corruption
- [ ] Simulator and chaos and load evidence saved in `docs/evidence/`, all `PASS`
- [ ] Per-email timeline endpoint

**Tier 2: the polish**
- [ ] Sender circuit breaker and failover
- [ ] Jitter
- [ ] `sliding` limiter strategy with the simulator comparison
- [ ] Prometheus metrics (and optional Grafana)
- [ ] Demo-as-code scripts matching the video

---

## 16. Known gotchas

- BullMQ needs `maxRetriesPerRequest: null` on its Redis connections.
- `moveToDelayed` needs the job token, and the processor must then throw `DelayedError`.
- Redis without AOF loses delayed jobs on restart. Enable `appendonly yes`.
- Pass `now` into Lua as an argument. Never call `redis.call('TIME')` in the script, or the simulator can't control it.
- Advisory locks must be taken in a consistent sender order to avoid deadlocks.
- Audit reservation times for the gap invariant, not SMTP completion times.
- Slack OAuth needs HTTPS for the redirect URI, so set up a tunnel early.
- Google OAuth consent screen needs test users while in testing mode.
- Elasticsearch in Docker needs `ES_JAVA_OPTS=-Xms512m -Xmx512m` and `xpack.security.enabled=false` locally.
- Cross-origin cookies need consistent `SameSite`, `Secure` and CORS credentials.
- Load the Lua scripts via `defineCommand` so they are cached by SHA.

---

## 17. Scope guard: what to cut, in order

Build in milestone order. If scope must shrink, cut from the bottom of this list first:

1. Grafana dashboard (keep `/metrics`)
2. `sliding` limiter strategy (keep the simulator's `fixed` analysis)
3. Jitter
4. SSE live feed
5. Failover (keep the circuit breaker's reschedule behavior)

**Never cut:** Tier 0, the ledger, the auditor, the chaos evidence, and the README. Those carry the "proof" thesis. A smaller scope with a passing audit beats a larger one without.

---

## 18. Stretch (only after everything above)

- Sender **warm-up ramp**: gradually raising the effective hourly limit for new senders.
- Recipient-timezone **send windows** (for example, business hours only).
- Campaign cancel and pause/resume (remove delayed jobs, append ledger events).
- GitHub Actions CI with service containers.
- Per-tenant limits on top of per-sender.
- OpenAPI spec generated from the Zod schemas.
