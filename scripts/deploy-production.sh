#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${REPO_ROOT}/.env.production}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[ERROR] Missing env file: ${ENV_FILE}"
  echo "[INFO] Copy .env.production.example to .env.production and fill it first."
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/pulzz-hotupdate}"
APP_SRC="${REPO_ROOT}/app"
APP_DST="${DEPLOY_ROOT}/app"
PUBLIC_API_HOST="${PUBLIC_API_HOST:-api.kaukei.icu}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-20808}"

if [[ -z "${HOTUPDATE_MANIFEST_URL:-}" ]]; then
  echo "[ERROR] HOTUPDATE_MANIFEST_URL is required."
  exit 1
fi

mkdir -p "${APP_DST}"

echo "[INFO] Repo root       : ${REPO_ROOT}"
echo "[INFO] Deploy root     : ${DEPLOY_ROOT}"
echo "[INFO] Manifest URL    : ${HOTUPDATE_MANIFEST_URL}"
echo "[INFO] Public API Host : ${PUBLIC_API_HOST}"

rsync -a --delete "${APP_SRC}/" "${APP_DST}/"

cd "${APP_DST}"
npm ci --omit=dev || npm install --omit=dev

if command -v pm2 >/dev/null 2>&1; then
  export PM2_CWD="${APP_DST}"
  pm2 startOrReload ecosystem.config.js --update-env
  pm2 save >/dev/null 2>&1 || true

  echo "[INFO] Health check: GameGlobalInfo"
  curl -sSf "http://${HOST}:${PORT}/api/GameGlobalInfo/GetInfo" \
    -H "Host: ${PUBLIC_API_HOST}" \
    -H 'X-Forwarded-Proto: https' \
    -H 'Content-Type: application/json' \
    -d '{}'
  echo

  echo "[INFO] Health check: GameAssetPackageVersion"
  curl -sSf "http://${HOST}:${PORT}/api/GameAssetPackageVersion/GetVersion" \
    -H "Host: ${PUBLIC_API_HOST}" \
    -H 'X-Forwarded-Proto: https' \
    -H 'Content-Type: application/json' \
    -d '{}'
  echo
else
  echo "[WARN] pm2 not found; deploy completed but service was not reloaded."
  echo "[WARN] Start manually in ${APP_DST}: node src/server.js"
fi
