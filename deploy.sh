#!/bin/bash
set -e

# Production Deployment Script for GST Tool Backend
# ================================================

echo "🚀 Starting Production Deployment..."

# 1. Pull latest changes
echo "📥 Pulling latest code..."
git pull origin main

# 2. Setup directories and permissions
echo "📁 Setting up directories..."
mkdir -p letsencrypt
chmod 755 letsencrypt
touch letsencrypt/acme.json
chmod 600 letsencrypt/acme.json

# 3. Build and recreate containers
echo "🏗️  Rebuilding and launching containers..."
docker compose up -d --build --remove-orphans

# 4. Wait for services to become healthy
echo "⏳ Waiting for services to start..."
sleep 20

# 5. Check Health of All Services
echo "🏥 Running service health checks..."
SERVICES=("gst-postgres-main" "gst-postgres-keycloak" "gst-keycloak" "gst-kong" "gst-minio" "gst-nats" "gst-tenant-service" "gst-workspace-service" "gst-gstn-service" "gst-upload-service" "gst-report-service" "gst-json-import-service" "gst-notification-service")

FAILED_SERVICES=()

for SERVICE in "${SERVICES[@]}"; do
    STATUS=$(docker inspect --format='{{json .State.Health.Status}}' "$SERVICE" 2>/dev/null || echo "\"unknown\"")
    echo "Service $SERVICE health status: $STATUS"
    
    # Remove quotes
    STATUS=${STATUS%\"}
    STATUS=${STATUS#\"}
    
    if [ "$STATUS" == "unhealthy" ]; then
        FAILED_SERVICES+=("$SERVICE")
    fi
done

if [ ${#FAILED_SERVICES[@]} -ne 0 ]; then
    echo "❌ Deployment Verification Failed! The following services are unhealthy:"
    for FAILED in "${FAILED_SERVICES[@]}"; do
        echo "  - $FAILED"
        echo "LOGS for $FAILED:"
        docker logs --tail 20 "$FAILED"
    done
    exit 1
else
    echo "✅ All backend services are healthy! Deployment completed successfully."
fi
