#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script: smoke-prod.sh
# Purpose: Non-destructive production health & security verification (V1, V2, V3, V10)
# Usage: ./smoke-prod.sh [DOMAIN_OR_URL]
# ==============================================================================

TARGET_URL="${1:-}"

if [[ -z "$TARGET_URL" ]]; then
  if [[ -f ".env.production" ]]; then
    DOMAIN=$(grep -E '^DOMAIN=' .env.production | cut -d '=' -f2 | tr -d ' "\r\n')
    TARGET_URL="https://${DOMAIN}"
  elif [[ -f "infra/.env.production" ]]; then
    DOMAIN=$(grep -E '^DOMAIN=' infra/.env.production | cut -d '=' -f2 | tr -d ' "\r\n')
    TARGET_URL="https://${DOMAIN}"
  else
    TARGET_URL="https://localhost"
  fi
fi

# Strip trailing slash
TARGET_URL="${TARGET_URL%/}"
HOST=$(echo "$TARGET_URL" | sed -E 's|https?://||' | cut -d':' -f1)

echo "==============================================================================="
echo "SMOKE TEST: Running Production Stack Verifications on: $TARGET_URL"
echo "Host: $HOST"
echo "==============================================================================="

PASSED=0
FAILED=0

record_result() {
  local check_id="$1"
  local desc="$2"
  local status="$3"
  local details="$4"

  if [[ "$status" == "PASS" ]]; then
    echo -e " \033[32m✔\033[0m [${check_id}] ${desc}: ${details}"
    PASSED=$((PASSED + 1))
  else
    echo -e " \033[31m✖\033[0m [${check_id}] ${desc}: ${details}"
    FAILED=$((FAILED + 1))
  fi
}

# --- V1: HTTPS & HTTP-to-HTTPS Redirect ---
echo -e "\n--- Running V1: TLS & HTTP Redirect Verification ---"
HTTP_REDIRECT_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://${HOST}" || echo "ERR")
if [[ "$HTTP_REDIRECT_CODE" =~ ^(301|302|308)$ ]]; then
  record_result "V1-REDIRECT" "HTTP Redirects to HTTPS" "PASS" "HTTP code $HTTP_REDIRECT_CODE"
else
  record_result "V1-REDIRECT" "HTTP Redirects to HTTPS" "FAIL" "Received code: $HTTP_REDIRECT_CODE"
fi

HTTPS_STATUS=$(curl -k -s -o /dev/null -w "%{http_code}" "$TARGET_URL" || echo "ERR")
if [[ "$HTTPS_STATUS" =~ ^(200|302)$ ]]; then
  record_result "V1-HTTPS" "HTTPS Edge Serving SPA" "PASS" "Status $HTTPS_STATUS"
else
  record_result "V1-HTTPS" "HTTPS Edge Serving SPA" "FAIL" "Status $HTTPS_STATUS"
fi

# --- V2: Liveness & Readiness Endpoints ---
echo -e "\n--- Running V2: Health & Readiness Probes ---"
HEALTH_JSON=$(curl -k -s -f "${TARGET_URL}/health" || echo "{}")
HEALTH_STATUS=$(echo "$HEALTH_JSON" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "error")
if [[ "$HEALTH_STATUS" == "ok" ]]; then
  record_result "V2-LIVENESS" "/health endpoint" "PASS" "status: ok"
else
  record_result "V2-LIVENESS" "/health endpoint" "FAIL" "response: $HEALTH_JSON"
fi

READY_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" "${TARGET_URL}/ready" || echo "ERR")
READY_JSON=$(curl -k -s "${TARGET_URL}/ready" || echo "{}")
if [[ "$READY_CODE" == "200" ]]; then
  record_result "V2-READINESS" "/ready cluster components" "PASS" "Postgres, Redis, and Elasticsearch healthy"
else
  record_result "V2-READINESS" "/ready cluster components" "FAIL" "HTTP $READY_CODE - $READY_JSON"
fi

# --- V3: Network Isolation Check (Ports 5432, 6379, 9200 unreachable) ---
echo -e "\n--- Running V3: Network Isolation & UFW Leak Test ---"
for PORT in 5432 6379 9200; do
  SERVICE_NAME="Unknown"
  [[ "$PORT" == "5432" ]] && SERVICE_NAME="PostgreSQL"
  [[ "$PORT" == "6379" ]] && SERVICE_NAME="Redis"
  [[ "$PORT" == "9200" ]] && SERVICE_NAME="Elasticsearch"

  # Test TCP reachability with 2s timeout
  if nc -z -w 2 "$HOST" "$PORT" &>/dev/null || (echo >/dev/tcp/"$HOST"/"$PORT") &>/dev/null; then
    record_result "V3-ISOLATION" "$SERVICE_NAME port $PORT isolated" "FAIL" "CRITICAL: Port $PORT is reachable from outside!"
  else
    record_result "V3-ISOLATION" "$SERVICE_NAME port $PORT isolated" "PASS" "Port $PORT closed/unreachable externally"
  fi
done

# --- V10: Access Control on Bull Board & Admin Routes ---
echo -e "\n--- Running V10: Bull Board Anonymous Access Guard ---"
ADMIN_CODE=$(curl -k -s -o /dev/null -w "%{http_code}" "${TARGET_URL}/admin/queues" || echo "ERR")
if [[ "$ADMIN_CODE" == "401" || "$ADMIN_CODE" == "403" ]]; then
  record_result "V10-SECURITY" "Bull Board gated from anonymous access" "PASS" "HTTP status $ADMIN_CODE (Access Denied)"
else
  record_result "V10-SECURITY" "Bull Board gated from anonymous access" "FAIL" "Unexpected response code: $ADMIN_CODE"
fi

echo "==============================================================================="
echo "SMOKE TEST SUMMARY: $PASSED passed, $FAILED failed."
if [[ $FAILED -eq 0 ]]; then
  echo "OVERALL RESULT: PASS"
  exit 0
else
  echo "OVERALL RESULT: FAIL"
  exit 1
fi
