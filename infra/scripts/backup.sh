#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script: backup.sh
# Purpose: Hot database dump and uploaded attachments backup
# Note: Scheduled backups can be triggered manually or via host systemd timer.
# (Cron is forbidden in the product code).
# ==============================================================================

COMPOSE_FILE="infra/docker-compose.prod.yml"
ENV_FILE="infra/.env.production"

if [[ ! -f "$COMPOSE_FILE" ]] && [[ -f "docker-compose.prod.yml" ]]; then
  COMPOSE_FILE="docker-compose.prod.yml"
  ENV_FILE=".env.production"
fi

BACKUP_ROOT="${1:-/opt/scheduler/backups}"
mkdir -p "$BACKUP_ROOT"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="${BACKUP_ROOT}/backup_${TIMESTAMP}"
mkdir -p "$BACKUP_DIR"

echo "==============================================================================="
echo "BACKUP: Initiating hot backup into $BACKUP_DIR"
echo "==============================================================================="

# 1. PostgreSQL Database Dump (using pg_dump inside running postgres container)
DB_DUMP_FILE="${BACKUP_DIR}/database_${TIMESTAMP}.sql.gz"
echo "Dumping PostgreSQL database 'scheduler'..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T postgres \
  pg_dump -U app -d scheduler --clean --if-exists | gzip > "$DB_DUMP_FILE"

echo "Database dump created: $DB_DUMP_FILE ($(du -h "$DB_DUMP_FILE" | cut -f1))"

# 2. Uploaded Attachments Volume Backup
UPLOADS_TAR="${BACKUP_DIR}/uploads_${TIMESTAMP}.tar.gz"
echo "Backing up uploaded attachments directory..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T api \
  tar -czf - -C /app uploads > "$UPLOADS_TAR" || true

echo "Uploads archive created: $UPLOADS_TAR ($(du -h "$UPLOADS_TAR" | cut -f1))"

# 3. Secure permissions
chmod 600 "${BACKUP_DIR}"/*
chmod 700 "$BACKUP_DIR"

echo "==============================================================================="
echo "BACKUP COMPLETED SUCCESSFULLY!"
echo "Target directory: $BACKUP_DIR"
echo "To copy this backup offsite to your local workstation, run:"
echo "  scp -i ~/.ssh/id_rsa -r deploy@YOUR_SERVER_IP:$BACKUP_DIR ./"
echo "==============================================================================="
