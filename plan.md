# Backend Plan: Production-Grade Email Scheduler

Scope: backend only. Frontend comes after the backend passes its definition of done.
No time boxes. Each milestone ends with **acceptance criteria**, and nothing moves on until they pass.

---

## 1. Guiding principles

1. **Postgres is the source of truth. Redis is a delivery mechanism.** If Redis is wiped, nothing is lost. A reconciler rebuilds the jobs from the DB.
2. **Job payload is just `{ emailId }`.** The worker loads current state from the DB. Payloads stay tiny, 1000+ jobs are cheap, and edits/cancellations are honored.
3. **Two idempotency layers.** BullMQ `jobId = emailId` stops duplicate enqueues. An atomic DB claim stops duplicate sends.
4. **Two rate-control layers.** Slot pre-allocation at schedule time (deterministic, visible in the UI) plus an atomic Redis Lua guard at send time (safety net across workers).
5. **No cron anywhere.** No `node-cron`, no `agenda`, no `setInterval`-style sweepers. Only BullMQ delayed jobs, plus a one-time reconciler at boot.
6. **Honest about guarantees.** State exactly where exactly-once breaks down (see section 7) rather than claiming it.
7. **Prove it, don't claim it.** Chaos and load scripts produce evidence that goes into the README.

---

## 2. Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | Node 20 + TypeScript (strict) | `tsx` for dev, `tsc` for build |
| HTTP | Express 4/5 | Separate `api` and `worker` entrypoints, same codebase |
| Validation | Zod | Env, request bodies, query params |
| DB | PostgreSQL + Prisma | Migrations committed |
| Queue | BullMQ + ioredis | Redis with **AOF on** (`appendonly yes`) |
| SMTP | Nodemailer + Ethereal | Pooled transport per sender |
| Search | Elasticsearch 8 | `@elastic/elasticsearch` |
| Queue UI | `@bull-board/express` | Behind auth |
| Auth | Google OAuth (code flow, server-side) | httpOnly JWT cookie |
| Slack | OAuth v2 (`incoming-webhook` scope) | Per-user stored webhook |
| Logging | pino | Structured, with request and job IDs |
| Tests | Vitest + Supertest | Real Redis/Postgres via docker compose |
| Infra | docker-compose | postgres, redis (AOF), elasticsearch |

---

## 3. Repository layout

```
/
├─ docker-compose.yml
├─ README.md
├─ plan.md
├─ backend/
│  ├─ prisma/schema.prisma
│  ├─ src/
│  │  ├─ server.ts              # API entrypoint
│  │  ├─ worker.ts              # Worker entrypoint (separate process)
│  │  ├─ config/env.ts          # Zod-validated config, single source
│  │  ├─ lib/
│  │  │  ├─ prisma.ts  redis.ts  logger.ts  crypto.ts
│  │  │  └─ redis-scripts/rate-limit.lua
│  │  ├─ queue/
│  │  │  ├─ queues.ts           # email-send, search-index, notifications
│  │  │  └─ reconciler.ts
│  │  ├─ modules/
│  │  │  ├─ auth/  senders/  campaigns/  emails/
│  │  │  ├─ slack/  search/  stats/
│  │  ├─ workers/
│  │  │  ├─ email.worker.ts  index.worker.ts  notify.worker.ts
│  │  ├─ scheduling/slot-allocator.ts   # pure function, heavily tested
│  │  └─ middleware/ (auth, error, validate, requestId)
│  ├─ scripts/ (seed.ts, chaos.ts, load.ts, reindex.ts)
│  └─ test/
```

---

## 4. Configuration (all via env, none hardcoded)

| Var | Purpose | Example |
|---|---|---|
| `DATABASE_URL`, `REDIS_URL`, `ELASTICSEARCH_URL` | Infra | |
| `WORKER_CONCURRENCY` | BullMQ concurrency | `5` |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | Default per-sender min gap | `2000` |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | Default hourly cap per sender | `200` |
| `MAX_EMAILS_PER_HOUR_GLOBAL` | Optional global cap (0 = off) | `0` |
| `JOB_ATTEMPTS`, `JOB_BACKOFF_MS` | Retry policy | `3`, `5000` |
| `STALE_PROCESSING_MS` | When a `PROCESSING` row counts as abandoned | `120000` |
| `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REDIRECT_URI` | Login | |
| `SLACK_CLIENT_ID/SECRET`, `SLACK_REDIRECT_URI` | Slack OAuth (needs HTTPS tunnel) | |
| `JWT_SECRET`, `ENCRYPTION_KEY` | Sessions, AES-256-GCM for stored secrets | |
| `FRONTEND_URL`, `ADMIN_EMAILS` | CORS and redirect; Bull Board allowlist | |

Precedence for the effective limit and delay: **campaign override, then sender override, then env default**, with the global cap enforced on top when set.

---

## 5. Data model (Postgres)

```
users(id, google_id UNIQUE, email, name, avatar_url, created_at)

senders(id, user_id, name, from_email, smtp_host, smtp_port, smtp_user,
        smtp_pass_enc, hourly_limit NULL, min_delay_ms NULL, is_active, created_at)

campaigns(id, user_id, subject, body_template, start_at, delay_ms, hourly_limit,
          total, idempotency_key NULL, created_at,
          UNIQUE(user_id, idempotency_key))

emails(id, campaign_id, user_id, sender_id, to_email, subject, body,
       scheduled_at, status ENUM(SCHEDULED, PROCESSING, SENT, FAILED),
       attempts, message_id, preview_url, last_error,
       claimed_at, sent_at, seq, created_at, updated_at,
       UNIQUE(campaign_id, to_email))
  INDEX (status, scheduled_at)   INDEX (user_id, status, scheduled_at)

slack_integrations(id, user_id UNIQUE, team_name, channel, webhook_url_enc,
                   status ENUM(CONNECTED, DISCONNECTED), connected_at, updated_at)
```

Notes:
- `UNIQUE(campaign_id, to_email)` makes the same lead being submitted twice in one campaign impossible.
- `seq` is the order within a campaign. It is used for ordering when jobs are rescheduled.
- Secrets (`smtp_pass_enc`, `webhook_url_enc`) are encrypted at rest with AES-256-GCM.

---

## 6. Milestones

### M0: Foundations
- Monorepo, TS strict, ESLint/Prettier, `docker-compose.yml` (Postgres, Redis with AOF, Elasticsearch single-node with security off and a small heap).
- `config/env.ts` with Zod, failing fast on bad env.
- pino logger, global error handler, `/health` and `/ready` (checks DB, Redis, ES).
- Prisma schema and first migration.

**Accept:** `docker compose up`, then `npm run dev` boots; `/ready` is green; bad env aborts with a clear message.

### M1: Auth (Google OAuth, real)
- `GET /auth/google` redirects with a `state` (CSRF). `GET /auth/google/callback` exchanges the code, upserts the user, sets an httpOnly + SameSite=Lax JWT cookie, and redirects to `FRONTEND_URL/dashboard`.
- `GET /auth/me` returns name, email, avatar. `POST /auth/logout` clears the cookie.
- `requireAuth` middleware. CORS with credentials restricted to `FRONTEND_URL`.

**Accept:** a real Google login produces a session; protected routes return 401 without the cookie; logout invalidates.

### M2: Senders
- CRUD at `/api/senders`, and `POST /api/senders/ethereal` which calls `nodemailer.createTestAccount()` and stores the credentials.
- Seed script creates 3 Ethereal senders.
- Per-sender `hourly_limit` and `min_delay_ms` overrides.
- Nodemailer transports are cached per sender with pooling, and a `verify()` runs when a sender is created.

**Accept:** a user has multiple active senders; a transport verification failure returns a clear error.

### M3: Slot allocator (pure function, written before the API)
`allocateSlots({ startAt, delayMs, hourlyLimit, senders, count }) → [{ seq, senderId, scheduledAt }]`
- Round-robin across active senders. Per sender, the k-th email is at `startAt + k * max(delayMs, senderMinDelay)`.
- Per sender, no more than `limit` emails fall in any clock-hour window. Overflow rolls to the next hour boundary.
- Deterministic and side-effect free.

**Accept:** unit tests plus property tests (fast-check) prove: no sender exceeds the cap in any hour window; gaps are at least the minimum delay; output order is stable; 10,000 inputs allocate in well under a second.

### M4: Schedule API and enqueue
`POST /api/campaigns`
```json
{ "subject": "...", "body": "Hi {{firstName}}", "startAt": "ISO",
  "delayMs": 2000, "hourlyLimit": 100,
  "recipients": [{ "email": "a@x.com", "vars": { "firstName": "A" } }] }
```
- Also accepts multipart CSV or text upload (useful for Postman), with the same parsing and validation.
- Supports an `Idempotency-Key` header. A repeated key returns the original campaign instead of creating a second.
- Steps: validate, dedupe and normalize recipients, allocate slots, **insert in chunks inside a transaction** (`createMany`), then `queue.addBulk` in chunks with `jobId = emailId` and `delay = max(0, scheduledAt - now)`.
- Enqueue after the transaction commits. If enqueue fails midway, the reconciler (M7) repairs it, so a failed enqueue never loses data.
- Returns `{ campaignId, accepted, duplicatesRemoved, invalid[] }`.

**Accept:** a 1,000-recipient request completes quickly with bounded memory; DB rows and Redis delayed jobs match 1:1; a repeated `Idempotency-Key` creates nothing new.

### M5: Worker (concurrency, claim, send)
Queue `email-send` options: `attempts`, exponential backoff, `removeOnComplete` with age/count caps, `removeOnFail: false`.

Processor flow (order matters):
1. Load email, campaign and sender in one query. If status is `SENT` or `FAILED`, **return** (no-op).
2. Reserve a send slot through the Redis limiter (M6). If denied, update `scheduled_at` in the DB, `job.moveToDelayed(retryAt, token)`, and throw `DelayedError`. The status stays `SCHEDULED` and **no attempt is consumed**.
3. **Atomic claim:** `UPDATE emails SET status='PROCESSING', claimed_at=now(), attempts=attempts+1 WHERE id=$1 AND status='SCHEDULED' RETURNING *`. Zero rows means someone else has it, so return.
4. Send via Nodemailer using a **deterministic `Message-ID`** (`<emailId@your-domain>`), stored at claim time.
5. Mark `SENT` with `sent_at`, `message_id` and `preview_url` (`nodemailer.getTestMessageUrl`). Enqueue an index update.
6. On error: classify. SMTP 4xx or network errors are transient, so release the row back to `SCHEDULED` and rethrow for BullMQ backoff. SMTP 5xx is permanent, so mark `FAILED` and do not retry. After the final attempt, mark `FAILED` with `last_error`.

Other worker requirements:
- `WORKER_CONCURRENCY` from env; `lockDuration` and `stalledInterval` tuned.
- Graceful shutdown: on SIGTERM, `worker.close()` waits for in-flight jobs.
- Redis connection uses `maxRetriesPerRequest: null`.

**Accept:** with concurrency 5, no email is sent twice; failures retry and end as `FAILED` with an error; SIGTERM never drops a job mid-send.

### M6: Rate limiting and minimum delay (Redis Lua, atomic)
One Lua script per send attempt keeps the counter, the gap, and the overflow slotting consistent across any number of workers.

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
  return {1, retry, 0}                      -- LIMITED, reschedule to retry
end

local nextAllowed = tonumber(redis.call('GET', KEYS[2]) or '0')
if now < nextAllowed then
  return {2, nextAllowed, 0}                -- TOO SOON, wait for the gap
end

count = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], win * 2)
redis.call('SET', KEYS[2], now + gap, 'PX', gap * 2)
return {0, 0, (count == limit) and 1 or 0}  -- OK, flag set exactly once when limit is reached
```

Design points:
- **Minimum delay** is enforced through the `gap` key, not a `sleep` in the worker. A sleeping job would hold a concurrency slot and starve other senders.
- **Overflow is rescheduled, never dropped or failed.** Rank-based placement preserves overflow order and spreads it across following hours without a thundering herd at the boundary.
- The effective `limit` and `gap` come from the DB rows (campaign, sender, env precedence). The optional global cap uses the same pattern with a `global` key.
- Fixed clock-hour windows are simple and cheap. Trade-off: a sender can burst up to 2x the cap across a boundary. Document it, and optionally offer a sliding-window variant using a sorted set.
- The third return value fires exactly once per sender per window when the cap is reached. It triggers the Slack notification (M9) without needing a separate dedupe key.

**Accept:** a concurrency test fires 500 parallel limiter calls at limit 100 and exactly 100 are allowed; gaps between allowed calls are at least the minimum; two worker processes together never exceed the cap; overflow keeps order.

### M7: Persistence, restart safety, reconciler
- Redis AOF means delayed jobs survive a Redis restart. A server or worker restart loses nothing because BullMQ state lives in Redis.
- **Boot reconciler** (runs once at worker start, plus an admin-only `POST /admin/reconcile`):
  - `SCHEDULED` rows with no job in Redis: re-enqueue with `jobId = emailId` (safe, since a duplicate `jobId` is ignored).
  - `PROCESSING` rows older than `STALE_PROCESSING_MS`: return to `SCHEDULED` for retry under the policy in section 7.
- Deliberately **not periodic**. A repeating sweeper would be a cron in disguise and breaks the hard constraint. BullMQ's own stalled-job recovery covers in-flight crashes.

**Accept:** (a) restart the API and worker mid-run: remaining emails send on time, none duplicated; (b) `FLUSHALL` Redis, restart: the reconciler rebuilds all pending jobs from Postgres and sending resumes.

### M8: Elasticsearch indexing and search
- Index `emails` with: `to_email` (keyword + text), `subject` and `body` (text), `status` and `sender_id` (keyword), `user_id`, `campaign_id`, `scheduled_at` and `sent_at` (date).
- Indexing runs through a **`search-index` queue** with retries, so an Elasticsearch outage never blocks sending. Documents use `_id = emailId` and **external versioning** (`updated_at` epoch), so out-of-order updates can't regress state.
- Index on create (`SCHEDULED`) and on every status change.
- `GET /api/emails/search?q=&status=&senderId=&from=&to=&page=&limit=` always filtered by `user_id` (tenant isolation), with highlights.
- `scripts/reindex.ts` rebuilds the index from Postgres.

**Accept:** a scheduled email is searchable within seconds; stopping Elasticsearch doesn't stop sending, and indexing catches up after it returns; reindex restores an empty index.

### M9: Slack OAuth and rate-limit notifications
- `GET /api/integrations/slack/connect` returns the authorize URL, with a signed `state` carrying the user ID and a nonce. The `incoming-webhook` scope lets the user pick the channel.
- `GET /api/integrations/slack/callback` exchanges the code at `oauth.v2.access`, encrypts and stores the webhook, and marks `CONNECTED`.
- `DELETE /api/integrations/slack` disconnects. `GET /api/integrations/slack` returns the status.
- On the limiter's "limit reached" flag, enqueue a job on the `notifications` queue. The job looks up the user's integration **at send time** and posts to the webhook (sender, limit, window, how many are waiting, next window).
  - Not connected: skip silently, no error.
  - Connected later: works on the next hit, no redeploy, because nothing is cached.
  - Webhook returns revoked/404/410: mark `DISCONNECTED` and stop.
  - Transient failure: retry with backoff.
- Slack needs HTTPS for the redirect URI, so use a cloudflared/ngrok tunnel during development.

**Accept:** connect, trigger a limit hit, and a real message lands in the chosen Slack channel; disconnect, hit again, and nothing is sent and nothing crashes; reconnect, hit again, and it works.

### M10: Bull Board, stats, observability
- Bull Board at `/admin/queues`, protected by `requireAuth` plus an `ADMIN_EMAILS` allowlist. All three queues are registered.
- `GET /api/stats`: queue counts (waiting, delayed, active, completed, failed), per-sender usage versus limit for the current window, and the next scheduled send.
- `GET /api/emails?status=scheduled|sent|failed&page=&limit=` for the dashboard tables. Sorted by `scheduled_at` for scheduled and by `sent_at` desc for sent. Includes `preview_url`.
- Stretch: worker publishes events to Redis pub/sub and the API exposes them over SSE for live dashboard updates.

**Accept:** Bull Board shows live queue movement; stats match reality during a run.

### M11: Hardening
- Helmet, request-size limits, API rate limiting (Redis-backed) on auth and schedule endpoints.
- Input caps: maximum recipients per request, maximum body size, email format validation, header-injection checks on subject and body.
- Secrets never logged. Errors never leak stack traces to clients.
- Optional stretch: `DELETE /api/campaigns/:id` to cancel (remove delayed jobs, mark rows cancelled).

---

## 7. Delivery guarantees (be explicit in the README)

| Scenario | Outcome |
|---|---|
| Duplicate enqueue of the same email | Ignored by BullMQ (`jobId = emailId`) |
| Two workers pick up the same email | Only one wins the atomic claim |
| Client double-submits the schedule request | Same `Idempotency-Key` returns the original campaign |
| API/worker killed mid-run | Delayed and in-flight jobs resume; no re-send of completed emails |
| Redis loses all data | Reconciler re-enqueues from Postgres |
| **Crash after SMTP accepts but before the DB write** | **The one real gap.** Exactly-once delivery is impossible across two systems. On retry the stale `PROCESSING` row is resent with the **same `Message-ID`** so receivers and mail clients can dedupe. After the maximum attempts it is marked `FAILED` with a clear note. Marking `SENT` immediately after the SMTP response keeps this window to milliseconds. |

---

## 8. Behavior under load (1000+ emails at the same instant)

1. Schedule API inserts in chunks inside one transaction and enqueues in chunks of ~500. Payloads are tiny, so memory stays flat.
2. The slot allocator already spreads sends: per sender, `delay` apart and no more than `limit` per hour. A thousand "simultaneous" requests become a deterministic timeline.
3. If real execution still exceeds a cap (worker lag, backlog, overlapping campaigns), the Lua guard reschedules the overflow into the next window(s) in rank order. Nothing is dropped.
4. Concurrency only parallelizes work. The per-sender gap and hourly counter are shared state in Redis, so adding workers or instances cannot break the limits.
5. The load script (below) demonstrates this with a mock transport.

---

## 9. Test strategy

**Unit**
- Slot allocator: caps per hour, minimum gaps, ordering, round-robin, edge cases (limit 1, huge counts, hour boundaries).
- Config parsing and limit-precedence logic.
- Error classification (transient vs permanent).

**Integration (real Postgres + Redis, Supertest)**
- Limiter: parallel calls respect the cap and the gap; overflow rank placement.
- Worker: claim race (N workers, one email, one send); retry, then `FAILED`; `DelayedError` doesn't consume attempts.
- Reconciler: missing jobs re-enqueued; stale `PROCESSING` recovered; double reconcile is harmless.
- Schedule API: validation, dedupe, idempotency key, large payloads.
- Auth: protected routes; Bull Board access control.
- Slack: not connected, connected, revoked, reconnect.
- Search: indexing, filtering, tenant isolation, ES-down recovery.

**Scripts (evidence for the README and demo)**
- `chaos.ts`: schedule 200 emails, `kill -9` the worker at random points, restart, then assert: every email sent exactly once, `message_id` uniqueness, zero stuck rows. Also a variant that flushes Redis.
- `load.ts`: 2,000 emails, same `startAt`, limit 50/hr, mock transport. Prints per-window send counts, maximum observed rate versus cap, and the minimum observed gap.

---

## 10. Observability

- pino JSON logs with `requestId`, `jobId`, `emailId`, `senderId`.
- Log every limiter decision at debug and every reschedule at info.
- Optional Prometheus-style counters: sent, failed, rescheduled, limit hits.

---

## 11. Decision log (turn these into README "Trade-offs")

| Decision | Reason | Trade-off |
|---|---|---|
| DB as source of truth | Redis loss must not lose emails | Extra writes per send |
| Payload = `{emailId}` | Small jobs, current state, cancel-safe | One DB read per job |
| Lua for limits | Atomic across processes | Slightly more complex than BullMQ limiter |
| Redis gap key over `sleep` | Doesn't waste worker concurrency | More Redis logic |
| Fixed hour windows | Simple, cheap, easy to explain | Up to 2x burst at boundaries |
| Boot-only reconciler | No cron-like sweeps, per brief | Drift is only repaired on restart or admin call |
| Separate worker process | Horizontal scaling, restart demos | Two processes to run |
| ES indexing via queue | ES outage never blocks sending | Eventual consistency |
| Webhook-based Slack | Simple per-user OAuth | Fixed channel chosen at connect time |

---

## 12. README outline (written as you build, not at the end)

1. Overview and architecture diagram (Mermaid: client, API, Postgres, Redis/BullMQ, workers, Ethereal, Elasticsearch, Slack).
2. Run it: `docker compose up`, env setup (`.env.example`), migrations, seed, API, worker.
3. How to set up Ethereal senders.
4. How scheduling works (allocator, delayed jobs).
5. Persistence and restart behavior (DB truth, AOF, reconciler).
6. Rate limiting and concurrency (Lua script, delay value chosen, hourly window behavior, multi-worker safety, trade-offs).
7. Delivery guarantees table (section 7).
8. Behavior under load, with the load script output.
9. Chaos test results.
10. Feature checklist mapped to the brief.
11. Assumptions, shortcuts, trade-offs.

---

## 13. Definition of done (backend)

- [ ] Real Google OAuth login and a protected API
- [ ] Multiple Ethereal senders
- [ ] Schedule API with CSV/JSON, validation, dedupe, idempotency key
- [ ] BullMQ delayed jobs, **no cron**
- [ ] Configurable concurrency, minimum delay and hourly limit (env + per-campaign)
- [ ] Redis-atomic limiter safe across multiple workers; overflow rescheduled, never dropped
- [ ] Live Slack OAuth, and a real message sent on limit hit; clean behavior when disconnected, reconnected
- [ ] Elasticsearch indexing and search
- [ ] Bull Board dashboard behind auth
- [ ] Restart scenario proven; Redis-flush recovery proven
- [ ] No duplicate sends under concurrency (tests + chaos script)
- [ ] 1000+ simultaneous scheduling handled, with load script output saved
- [ ] README complete, `.env.example` present, one-command local setup

---

## 14. Known gotchas

- BullMQ needs `maxRetriesPerRequest: null` on its Redis connections.
- `moveToDelayed` needs the job token from the processor, and the processor must then throw `DelayedError`.
- Redis without AOF loses delayed jobs on restart. Enable `appendonly yes` in compose.
- Slack OAuth needs an HTTPS redirect URI, so set up the tunnel early.
- Google OAuth consent screen needs test users added while in testing mode.
- Elasticsearch in Docker needs a limited heap (`ES_JAVA_OPTS=-Xms512m -Xmx512m`) and `xpack.security.enabled=false` for local use.
- Cookies across origins need `SameSite`, `Secure` and CORS credentials set consistently, or the frontend won't stay logged in.
- Keep the Lua script in its own file and load it via `defineCommand` so it is cached by SHA.

---

## 15. Stretch goals (only after the definition of done)

- Sliding-window limiter variant with a comparison in the README.
- SSE live events for the dashboard.
- Campaign cancel and pause/resume.
- Template variables (`{{firstName}}`) with a safe renderer.
- GitHub Actions CI: lint, typecheck, tests against service containers.
- Per-tenant (per-user) limits on top of per-sender.
- Open API (Swagger) spec generated from the Zod schemas.
