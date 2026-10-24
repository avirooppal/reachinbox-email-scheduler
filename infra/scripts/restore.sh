#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script: restore.sh
# Purpose: Disaster recovery restore from database dump archive
# Usage: ./restore.sh <path_to_database.sql.gz> [--test-db]
# ==============================================================================

COMPOSE_FILE="infra/docker-compose.prod.yml"
ENV_FILE="infra/.env.production"

if [[ ! -f "$COMPOSE_FILE" ]] && [[ -f "docker-compose.prod.yml" ]]; then
  COMPOSE_FILE="docker-compose.prod.yml"
  ENV_FILE=".env.production"
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <path_to_database.sql.gz> [--test-db]"
  exit 1
fi

DUMP_FILE="$1"
TEST_MODE="${2:-}"

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: Backup file '$DUMP_FILE' does not exist!"
  exit 1
fi

if [[ "$TEST_MODE" == "--test-db" ]]; then
  TARGET_DB="scheduler_scratch"
  echo "==============================================================================="
  echo "NON-DESTRUCTIVE VERIFICATION: Restoring into scratch database '$TARGET_DB'"
  echo "==============================================================================="
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
    psql -U app -d postgres -c "DROP DATABASE IF EXISTS ${TARGET_DB};"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
    psql -U app -d postgres -c "CREATE DATABASE ${TARGET_DB};"

  gunzip -c "$DUMP_FILE" | docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
    psql -U app -d "$TARGET_DB"

  echo "Scratch database restored successfully. Verifying email table count:"
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
    psql -U app -d "$TARGET_DB" -c "SELECT COUNT(*) AS total_emails FROM emails;"
  echo "Cleaning up scratch database '$TARGET_DB'..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
    psql -U app -d postgres -c "DROP DATABASE ${TARGET_DB};"
  echo "NON-DESTRUCTIVE RESTORE VERIFICATION: PASS"
  exit 0
fi

echo "==============================================================================="
echo "WARNING: PRODUCTION RESTORE WILL OVERWRITE LIVE DATA IN DATABASE 'scheduler'!"
echo "==============================================================================="
read -rp "Are you absolutely sure you want to proceed? [type 'RESTORE']: " confirm
if [[ "$confirm" != "RESTORE" ]]; then
  echo "Restore aborted by user."
  exit 1
fi

echo "Stopping API and Worker containers before database restoration..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop api worker

echo "Restoring database from $DUMP_FILE..."
gunzip -c "$DUMP_FILE" | docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  psql -U app -d scheduler

echo "Restarting API and Workers (triggering boot reconciler)..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" start api worker

echo "Awaiting health check..."
sleep 5
bash infra/scripts/smoke-prod.sh

echo "==============================================================================="
echo "RESTORE AND RECONCILIATION COMPLETE."
echo "==============================================================================="
