#!/usr/bin/env bash
# update_zigbee_db.sh
# -------------------
# Updates the Zigbee device database from zigbee-herdsman-converters.
# Run manually or from cron / GitHub Actions.
#
# Usage:
#   ./update_zigbee_db.sh                    # update + deploy to /srv/www/htdocs/zigbee/
#   ./update_zigbee_db.sh --no-deploy        # generate only into dist/ (for GitHub Actions)
#   ./update_zigbee_db.sh --deploy-to /path  # deploy to custom path

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$REPO_ROOT/dist"
DEPLOY_DIR="/srv/www/htdocs/zigbee"
NO_DEPLOY=false

# Parse args
for arg in "$@"; do
  case "$arg" in
    --no-deploy)    NO_DEPLOY=true ;;
    --deploy-to=*)  DEPLOY_DIR="${arg#--deploy-to=}" ;;
  esac
done

echo "════════════════════════════════════════"
echo "  Zigbee Device DB Update"
echo "  Script dir: $SCRIPT_DIR"
echo "  Repo root:  $REPO_ROOT"
echo "════════════════════════════════════════"

# Step 1: update npm package
cd "$SCRIPT_DIR"
echo ""
echo "► Updating zigbee-herdsman-converters..."
npm update zigbee-herdsman-converters 2>&1 | grep -E "(updated|added|npm warn|error)" || true

CURRENT_VERSION=$(node -p "require('./node_modules/zigbee-herdsman-converters/package.json').version" 2>/dev/null || echo "unknown")
echo "  Package version: $CURRENT_VERSION"

# Step 2: run fetch script
echo ""
echo "► Running fetch_devices.js..."
node fetch_devices.js

# Step 3: show results
echo ""
echo "► Generated files:"
ls -lh "$DIST_DIR/"

# Step 4: deploy
if [ "$NO_DEPLOY" = "true" ]; then
  echo ""
  echo "► Skipping deploy (--no-deploy)."
  exit 0
fi

if [ ! -d "$DEPLOY_DIR" ]; then
  echo ""
  echo "✗ Deploy target not found: $DEPLOY_DIR"
  echo "  (Skipping deploy — run with --no-deploy on CI)"
  exit 0
fi

echo ""
echo "► Deploying to $DEPLOY_DIR..."
cp "$DIST_DIR/devices.json"          "$DEPLOY_DIR/devices.json"
cp "$DIST_DIR/devices_compact.json"  "$DEPLOY_DIR/devices_compact.json"
cp "$DIST_DIR/fingerprint_index.json" "$DEPLOY_DIR/fingerprint_index.json"

# Fix permissions if running as root/sudo
if [ -n "$(which chown 2>/dev/null)" ]; then
  chown wwwrun:www "$DEPLOY_DIR/devices.json" \
                   "$DEPLOY_DIR/devices_compact.json" \
                   "$DEPLOY_DIR/fingerprint_index.json" 2>/dev/null || true
fi

echo "✓ Deployed:"
ls -lh "$DEPLOY_DIR/devices"*.json "$DEPLOY_DIR/fingerprint_index.json" 2>/dev/null || true

echo ""
echo "✓ Done — Zigbee device DB updated to v$CURRENT_VERSION"
