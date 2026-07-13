#!/bin/bash
# =========================================================================
# setup_cloudflare_tunnel.sh
# Permanent Background Service Setup for Cloudflare Tunnel on Mac Mini
# =========================================================================
#
# Usage:
#   sudo bash setup_cloudflare_tunnel.sh <YOUR_TUNNEL_TOKEN>
#
# =========================================================================

set -e

TOKEN=$1

if [ -z "$TOKEN" ]; then
    echo "❌ Error: Tunnel Token is required."
    echo "Usage: sudo bash setup_cloudflare_tunnel.sh <YOUR_TUNNEL_TOKEN>"
    exit 1
fi

echo "📥 Downloading Cloudflare Tunnel package..."
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb

echo "📦 Installing Cloudflare Tunnel..."
sudo dpkg -i cloudflared.deb || sudo apt-get install -f -y

echo "⚙️  Installing cloudflared as a system daemon service..."
sudo cloudflared service install "$TOKEN"

echo "🚀 Starting cloudflared service..."
if command -v systemctl &> /dev/null; then
    sudo systemctl daemon-reload
    sudo systemctl enable --now cloudflared
    echo "📊 Checking cloudflared service status..."
    sudo systemctl status cloudflared --no-pager
else
    sudo service cloudflared start
fi

echo "✅ Cloudflare Tunnel background service installed and running successfully!"
echo "Now go to Cloudflare Dashboard -> Zero Trust -> Access -> Tunnels and configure the Public Hostname:"
echo "  - Subdomain: api"
echo "  - Domain: yourdomain.com"
echo "  - Service Type: HTTP"
echo "  - URL: localhost:8002"
