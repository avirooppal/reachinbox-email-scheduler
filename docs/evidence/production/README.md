# Production Verification Evidence (V1 - V13)

This directory contains production verification runs and artifacts for the Outbox Email Scheduler stack deployed on Ubuntu 24.04 LTS behind Caddy.

## Verification Matrix & Execution Runbook

| ID | Check | Verification Command | Expected Production Output | Status in Runbook Mode |
|---|---|---|---|---|
| **V1** | HTTPS & HTTP->HTTPS Redirect | `curl -I http://{$DOMAIN}` & `curl -I https://{$DOMAIN}` | `HTTP/1.1 308 Permanent Redirect` -> `HTTP/2 200` with HSTS header | Human executes on server |
| **V2** | `/health` (Liveness) & `/ready` (Readiness) | `curl -s https://{$DOMAIN}/health` & `curl -s https://{$DOMAIN}/ready` | `{"status":"ok"}` & `{"status":"ready","checks":{"postgres":"ok","redis":"ok","elasticsearch":"ok"}}` | Human executes on server |
| **V3** | DB / Cache Isolation | `nc -z -w 2 $SERVER_IP 5432 6379 9200` | Connection refused / timeout on all 3 ports (no external ports bound) | Human executes from remote machine |
| **V4** | Real Google OAuth Login | Web browser: `https://{$DOMAIN}/auth/google` | User authenticated, redirected to `/scheduled`, session cookie set | Human executes in browser |
| **V5** | Campaign Schedule & Sent Flow | Web browser / Live API | Emails transition from `SCHEDULED` to `SENT` with Ethereal preview links | Human executes in browser |
| **V6** | Elasticsearch Query Search | `curl -s "https://{$DOMAIN}/api/emails/search?q=test"` | Matches indexed emails and returns full payload | Human executes |
| **V7** | **Restart Safety** | `docker compose restart api worker` during scheduled window | Emails dispatch on schedule without duplicate sends (`I1` invariant satisfied) | Human executes on server |
| **V8** | **Redis Loss Recovery** | Draining Redis queue followed by worker restart | Reconciler executes on boot: rebuilds BullMQ jobs from PostgreSQL ground truth | Verified in automated chaos harness |
| **V9** | **Rate Limiting & Real Slack Webhook** | Trigger hourly limit overflow | Slack alert fired via webhook; graceful degradation on disconnect | Human executes with Slack app |
| **V10** | Bull Board Access Guard | `curl -s -o /dev/null -w "%{http_code}" https://{$DOMAIN}/admin/queues` | HTTP `401` or `403` for anonymous / non-admin; `200` for `ADMIN_EMAILS` | Human executes on server |
| **V11** | Resource Headroom (1k Load) | `docker stats --no-stream` & `free -m` | RAM usage well within 4GB host capacity, swap available, no container OOMs | Human executes during load |
| **V12** | Hot Backup & Restore | `bash infra/scripts/backup.sh` & `bash infra/scripts/restore.sh <dump> --test-db` | Database dump created, restored into scratch DB with matching row counts | Human executes on server |
| **V13** | Invariant Auditor Post-Verification | `docker compose exec api node dist/server.js` or `npm run audit` | All 7 invariants (`I1` - `I7`) report `RESULT: PASS` | Human executes on server |

---

## Instructions for Storing Artifacts
When executing on the remote server:
1. Run `bash infra/scripts/smoke-prod.sh` and save output to `docs/evidence/production/smoke_output.txt`.
2. Run `docker compose exec -T api node dist/tools/audit.js` and save output to `docs/evidence/production/audit_output.txt`.
3. Save screenshots for V4 (Google login) and V9 (Slack notification) into this directory.
