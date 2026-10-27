#!/usr/bin/env bash
# Deploy the HazardWatch website to IBM Code Engine.
# Run from the repo root (the folder containing frontend/ and Dockerfile.frontend):
#   VISION_URL=https://vision-service.<id>.au-syd.codeengine.appdomain.cloud \
#   FRONTEND_ENV=$HOME/Developer/garage-boilerplate-basic/frontend/.env.local \
#   REGISTRY_IMAGE=au.icr.io/team7-hazardwatch/hazardwatch-web REGISTRY_SECRET=icr-au \
#   bash deploy-frontend.sh
set -euo pipefail

REGION="${REGION:-au-syd}"
RG="${RG:-Default}"
PROJECT="${PROJECT:-team7-hazardwatch}"
APP="${APP:-hazardwatch-web}"
VISION_URL="${VISION_URL:?Set VISION_URL to the vision-service address}"
FRONTEND_ENV="${FRONTEND_ENV:-frontend/.env.local}"
BUILD_SIZE="${BUILD_SIZE:-large}"

[ -f frontend/package.json ] || { echo "Run this from the repo root."; exit 1; }
[ -f Dockerfile.frontend ]   || { echo "Dockerfile.frontend not found in this folder."; exit 1; }

REG_ARGS=()
if [ -n "${REGISTRY_IMAGE:-}" ]; then
  REG_ARGS+=(--image "$REGISTRY_IMAGE")
  [ -n "${REGISTRY_SECRET:-}" ] && REG_ARGS+=(--registry-secret "$REGISTRY_SECRET")
fi

# Public build settings only: NEXT_PUBLIC_* values are visible in the browser by design.
ENVPROD=frontend/.env.production
BUILD_DIR="$(mktemp -d)"
trap 'rm -f "$ENVPROD"; rm -rf "$BUILD_DIR"' EXIT
: > "$ENVPROD"
if [ -f "$FRONTEND_ENV" ]; then
  grep -E '^NEXT_PUBLIC_[A-Z0-9_]+=.+' "$FRONTEND_ENV" \
    | grep -vE '^NEXT_PUBLIC_(APP_URL|VISION_API_URL)=' >> "$ENVPROD" || true
else
  echo "Note: $FRONTEND_ENV not found; building with default public settings."
fi
echo "NEXT_PUBLIC_VISION_API_URL=${VISION_URL%/}" >> "$ENVPROD"
echo "Build settings written: $(cut -d= -f1 "$ENVPROD" | tr '\n' ' ')"

# Build from a clean copy: the IBM CLI cannot package pnpm's node_modules symlinks.
rsync -a \
  --exclude node_modules --exclude .git --exclude .next --exclude dist \
  --exclude .env --exclude .env.local --exclude .vercel --exclude .claude \
  --exclude vision-service --exclude '_tmp_*' --exclude 'Claude outputs' \
  ./ "$BUILD_DIR"/
echo "Clean build copy: $(du -sh "$BUILD_DIR" | cut -f1)"

command -v docker >/dev/null 2>&1 || { echo "Docker is not installed. Install Docker Desktop first (https://www.docker.com/products/docker-desktop/), open it, then rerun."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is installed but not running. Open Docker Desktop, wait until it says running, then rerun."; exit 1; }

: "${REGISTRY_IMAGE:?Set REGISTRY_IMAGE, e.g. docker.io/USER/hazardwatch-web}"
: "${REGISTRY_SECRET:?Set REGISTRY_SECRET, e.g. dockerhub}"
DH_USER="${DH_USER:-$(echo "$REGISTRY_IMAGE" | cut -d/ -f2)}"
TAG="$(date +%y%m%d%H%M)"
IMAGE="${REGISTRY_IMAGE}:${TAG}"

echo "Step 1/3: log in to Docker Hub as $DH_USER (paste your access token when asked for the password)"
if grep -q 'docker.io' "$HOME/.docker/config.json" 2>/dev/null && [ "${FORCE_LOGIN:-0}" != "1" ]; then
  echo "Already logged in to Docker Hub (set FORCE_LOGIN=1 to log in again)."
else
  docker login -u "$DH_USER" docker.io
fi

echo "Step 2/3: building and pushing $IMAGE (linux/amd64) ..."
docker buildx build --platform linux/amd64 -f "$BUILD_DIR/Dockerfile.frontend" -t "$IMAGE" --push "$BUILD_DIR"

ibmcloud target -r "$REGION" -g "$RG" >/dev/null
ibmcloud ce project select --name "$PROJECT"

echo "Step 3/3: deploying $IMAGE to Code Engine ..."
if ibmcloud ce app get --name "$APP" >/dev/null 2>&1; then VERB=update; else VERB=create; fi
ibmcloud ce app "$VERB" --name "$APP" \
  --image "$IMAGE" \
  --registry-secret "$REGISTRY_SECRET" \
  --port 8080 --cpu 1 --memory 2G \
  --min-scale 1 --max-scale 2 \
  --wait

echo
echo "Website URL:"
ibmcloud ce app get --name "$APP" -o url
