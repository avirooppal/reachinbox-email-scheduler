#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Script: bootstrap-server.sh
# Purpose: Idempotent Ubuntu 24.04 LTS host bootstrap for Outbox Stack
# Must be executed as root on fresh VPS instance.
# ==============================================================================

if [[ $EUID -ne 0 ]]; then
   echo "ERROR: This script must be run as root (use sudo or root shell)." 
   exit 1
fi

echo "==============================================================================="
echo "STEP 1: System Package Updates & Essential Security Tools"
echo "==============================================================================="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y --no-install-recommends \
    curl \
    git \
    ufw \
    fail2ban \
    unattended-upgrades \
    ca-certificates \
    gnupg \
    lsb-release \
    jq

# Enable unattended security updates
dpkg-reconfigure -f noninteractive -p low unattended-upgrades

echo "==============================================================================="
echo "STEP 2: Deploy User Provisioning"
echo "==============================================================================="
DEPLOY_USER="deploy"
if ! id "$DEPLOY_USER" &>/dev/null; then
    echo "Creating system user '$DEPLOY_USER'..."
    adduser --disabled-password --gecos "" "$DEPLOY_USER"
    usermod -aG sudo "$DEPLOY_USER"
    echo "$DEPLOY_USER ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-${DEPLOY_USER}"
    chmod 0440 "/etc/sudoers.d/90-${DEPLOY_USER}"
fi

# Authorize SSH public key for deploy user (copy from root if present)
mkdir -p "/home/${DEPLOY_USER}/.ssh"
if [[ -f "/root/.ssh/authorized_keys" ]] && [[ ! -f "/home/${DEPLOY_USER}/.ssh/authorized_keys" ]]; then
    cp "/root/.ssh/authorized_keys" "/home/${DEPLOY_USER}/.ssh/authorized_keys"
    echo "Copied root authorized_keys to /home/${DEPLOY_USER}/.ssh/authorized_keys."
fi
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
chmod 700 "/home/${DEPLOY_USER}/.ssh"
chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys" 2>/dev/null || true

echo "==============================================================================="
echo "STEP 3: Firewall (UFW) Configuration"
echo "==============================================================================="
# Set safe default firewall policies
ufw default deny incoming
ufw default allow outgoing

# Only expose SSH, HTTP, and HTTPS publicly
ufw allow 22/tcp comment "SSH Remote Administration"
ufw allow 80/tcp comment "HTTP (Caddy Let's Encrypt challenge & redirect)"
ufw allow 443/tcp comment "HTTPS (Caddy Auto-TLS Edge Proxy)"

# Enable UFW without prompting
ufw --force enable

echo "==============================================================================="
echo "STEP 4: Swap File (2 GB) Configuration"
echo "==============================================================================="
if ! swapon --show | grep -q "/swapfile"; then
    echo "Allocating 2 GB swap file at /swapfile..."
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    if ! grep -q "/swapfile" /etc/fstab; then
        echo "/swapfile none swap sw 0 0" >> /etc/fstab
    fi
    echo "Swap initialized."
else
    echo "Swapfile already configured."
fi

# Set swappiness to 10 for server workloads
sysctl vm.swappiness=10
echo "vm.swappiness=10" > /etc/sysctl.d/99-swappiness.conf

echo "==============================================================================="
echo "STEP 5: Elasticsearch Memory Mapping (vm.max_map_count)"
echo "==============================================================================="
CURRENT_MAP=$(sysctl -n vm.max_map_count)
if [[ "$CURRENT_MAP" -lt 262144 ]]; then
    echo "Setting vm.max_map_count=262144 persistently..."
    sysctl -w vm.max_map_count=262144
    echo "vm.max_map_count=262144" > /etc/sysctl.d/99-elasticsearch.conf
else
    echo "vm.max_map_count already satisfies requirement (${CURRENT_MAP} >= 262144)."
fi

echo "==============================================================================="
echo "STEP 6: Docker Engine & Compose Installation (Official Repository)"
echo "==============================================================================="
if ! command -v docker &>/dev/null; then
    echo "Installing Docker Engine from official Docker repository..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
    echo "Docker Engine already installed: $(docker --version)"
fi

usermod -aG docker "$DEPLOY_USER"

# Configure Docker daemon log rotation to prevent disk fill
mkdir -p /etc/docker
cat <<'EOF' > /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
systemctl restart docker

echo "==============================================================================="
echo "STEP 7: Application Directory Setup"
echo "==============================================================================="
APP_DIR="/opt/scheduler"
mkdir -p "$APP_DIR"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$APP_DIR"
chmod 755 "$APP_DIR"

echo "==============================================================================="
echo "STEP 8: Verification Checklist"
echo "==============================================================================="
echo "[CHECK] Firewall status:"
ufw status verbose

echo -e "\n[CHECK] Docker version:"
docker --version
docker compose version

echo -e "\n[CHECK] Virtual memory mapping for Elasticsearch:"
sysctl vm.max_map_count

echo -e "\n[CHECK] Swap space:"
free -h

echo "==============================================================================="
echo "BOOTSTRAP COMPLETE!"
echo "You can now log in as '${DEPLOY_USER}' and deploy the stack into ${APP_DIR}."
echo "==============================================================================="
