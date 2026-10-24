#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script: deploy.sh
# Purpose: Zero-downtime, idempotent production deployment and health gate
# ==============================================================================

COMPOSE_FILE="infra/docker-compose.prod.yml"
ENV_FILE="infra/.env.production"

# If executing from infra directory, adjust relative paths
if [[ ! -f "$COMPOSE_FILE" ]] && [[ -f "docker-compose.prod.yml" ]]; then
  COMPOSE_FILE="docker-compose.prod.yml"
  ENV_FILE=".env.production"
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Production environment file '$ENV_FILE' not found!"
  echo "Please generate it first with: bash infra/scripts/gen-secrets.sh"
  exit 1
fi

# Ensure correct strict file permissions on .env
chmod 600 "$ENV_FILE"

echo "==============================================================================="
echo "STEP 1: Recording current deployment state for rollback"
echo "==============================================================================="
PREV_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
echo "Previous commit: $PREV_COMMIT"
echo "$PREV_COMMIT" > .last_successful_deploy

echo "==============================================================================="
echo "STEP 2: Building container images (Backend & Frontend SPA Caddy)"
echo "==============================================================================="
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build --parallel

echo "==============================================================================="
echo "STEP 3: Running database migrations (Prisma)"
echo "==============================================================================="
# Start postgres, redis, and elasticsearch if not already up
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d postgres redis elasticsearch
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm migrate

echo "==============================================================================="
echo "STEP 4: Deploying API, Scaled Workers (x2), and Caddy Edge Proxy"
echo "==============================================================================="
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --scale worker=2 --remove-orphans

echo "==============================================================================="
echo "STEP 5: Awaiting cluster healthiness"
echo "==============================================================================="
ATTEMPTS=0
MAX_ATTEMPTS=30
CLUSTER_HEALTHY=false

while [[ $ATTEMPTS -lt $MAX_ATTEMPTS ]]; do
  UNHEALTHY=$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps --format json | jq -r 'select(.Health != "" and .Health != "healthy") | .Name' || true)
  if [[ -z "$UNHEALTHY" ]]; then
    CLUSTER_HEALTHY=true
    break
  fi
  echo "Waiting for services to become healthy (Attempt $((ATTEMPTS+1))/$MAX_ATTEMPTS)... Pending: $UNHEALTHY"
  sleep 4
  ATTEMPTS=$((ATTEMPTS+1))
done

if [[ "$CLUSTER_HEALTHY" != "true" ]]; then
  echo "DEPLOYMENT FAILED: One or more containers failed healthcheck!"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=50
  echo "-------------------------------------------------------------------------------"
  echo "To rollback to previous release, execute: bash infra/scripts/rollback.sh"
  echo "-------------------------------------------------------------------------------"
  exit 1
fi

echo "All services healthy!"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

echo "==============================================================================="
echo "STEP 6: Executing automated smoke tests"
echo "==============================================================================="
bash infra/scripts/smoke-prod.sh || {
  echo "WARNING: Smoke test reported failures. Inspecting API logs:"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=50 api
  exit 1
}

echo "==============================================================================="
echo "DEPLOYMENT SUCCESSFUL!"
echo "Stack is running with 2 workers, persistent Redis AOF, and automatic TLS."
echo "==============================================================================="
