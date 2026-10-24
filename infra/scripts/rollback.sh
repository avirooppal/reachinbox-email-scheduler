#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script: rollback.sh
# Purpose: Emergency rollback to previously recorded release commit
# Note: Migrations are strictly written to be backward-compatible for 1 release.
# ==============================================================================

COMPOSE_FILE="infra/docker-compose.prod.yml"
ENV_FILE="infra/.env.production"

if [[ ! -f "$COMPOSE_FILE" ]] && [[ -f "docker-compose.prod.yml" ]]; then
  COMPOSE_FILE="docker-compose.prod.yml"
  ENV_FILE=".env.production"
fi

if [[ ! -f ".last_successful_deploy" ]]; then
  echo "ERROR: .last_successful_deploy record not found. Cannot determine previous commit."
  exit 1
fi

TARGET_COMMIT=$(cat .last_successful_deploy | tr -d ' \r\n')
CURRENT_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

if [[ "$TARGET_COMMIT" == "$CURRENT_COMMIT" ]]; then
  echo "Warning: Target rollback commit is identical to current HEAD ($CURRENT_COMMIT)."
fi

echo "==============================================================================="
echo "INITIATING ROLLBACK TO COMMIT: $TARGET_COMMIT"
echo "==============================================================================="

git checkout "$TARGET_COMMIT"

echo "Rebuilding containers for rollback release..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build

echo "Restarting services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --scale worker=2 --remove-orphans

echo "Awaiting health check stabilization..."
sleep 10
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

bash infra/scripts/smoke-prod.sh || {
  echo "CRITICAL: Smoke test failed following rollback. Reviewing container logs:"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=50
  exit 1
}

echo "==============================================================================="
echo "ROLLBACK COMPLETE AND VERIFIED HEALTHY."
echo "==============================================================================="
