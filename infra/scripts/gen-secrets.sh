#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script: gen-secrets.sh
# Purpose: Idempotently generates high-entropy cryptographic secrets for production
# ==============================================================================

TARGET_ENV="${1:-infra/.env.production}"

if [[ -f "$TARGET_ENV" ]]; then
  echo "Target environment file '$TARGET_ENV' already exists."
  read -rp "Overwrite existing secrets in $TARGET_ENV? [y/N]: " confirm
  if [[ "$confirm" != [yY] && "$confirm" != [yY][eE][sS] ]]; then
    echo "Aborted without modifying $TARGET_ENV."
    exit 0
  fi
fi

echo "Generating cryptographically secure secrets..."

PG_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
RED_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 24)
JWT_SEC=$(openssl rand -base64 48 | tr -d '\n')
ENC_KEY=$(openssl rand -hex 32 | tr -d '\n')

cp infra/.env.production.example "$TARGET_ENV"

# Substitute generated values into destination .env
sed -i.bak "s/POSTGRES_PASSWORD=replace_with_generated_strong_postgres_password/POSTGRES_PASSWORD=${PG_PASSWORD}/" "$TARGET_ENV"
sed -i.bak "s/REDIS_PASSWORD=replace_with_generated_strong_redis_password/REDIS_PASSWORD=${RED_PASSWORD}/" "$TARGET_ENV"
sed -i.bak "s/JWT_SECRET=replace_with_openssl_rand_base64_48/JWT_SECRET=${JWT_SEC}/" "$TARGET_ENV"
sed -i.bak "s/ENCRYPTION_KEY=replace_with_openssl_rand_hex_32/ENCRYPTION_KEY=${ENC_KEY}/" "$TARGET_ENV"
rm -f "${TARGET_ENV}.bak"

chmod 600 "$TARGET_ENV"

echo "-------------------------------------------------------------------------------"
echo "Secrets successfully generated and written to $TARGET_ENV with chmod 600."
echo "CRITICAL: Back up your ENCRYPTION_KEY offline. If lost, encrypted SMTP credentials"
echo "and Slack OAuth tokens cannot be decrypted."
echo "-------------------------------------------------------------------------------"
