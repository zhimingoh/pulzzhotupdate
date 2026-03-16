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
HEALTHCHECK_RETRIES="${HEALTHCHECK_RETRIES:-10}"
HEALTHCHECK_INTERVAL_SECONDS="${HEALTHCHECK_INTERVAL_SECONDS:-1}"

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

health_check() {
  local name="$1"
  local path="$2"
  local attempt=1

  while (( attempt <= HEALTHCHECK_RETRIES )); do
    if curl -sSf "http://${HOST}:${PORT}${path}" \
      -H "Host: ${PUBLIC_API_HOST}" \
      -H 'X-Forwarded-Proto: https' \
      -H 'Content-Type: application/json' \
      -d '{}'; then
      echo
      return 0
    fi

    if (( attempt == HEALTHCHECK_RETRIES )); then
      echo "[ERROR] ${name} health check failed after ${HEALTHCHECK_RETRIES} attempts." >&2
      return 1
    fi

    echo "[WARN] ${name} health check attempt ${attempt}/${HEALTHCHECK_RETRIES} failed; retrying in ${HEALTHCHECK_INTERVAL_SECONDS}s..." >&2
    sleep "${HEALTHCHECK_INTERVAL_SECONDS}"
    attempt="$((attempt + 1))"
  done
}

if command -v pm2 >/dev/null 2>&1; then
  export PM2_CWD="${APP_DST}"
  pm2 startOrReload ecosystem.config.js --update-env
  pm2 save >/dev/null 2>&1 || true

  echo "[INFO] Health check: GameGlobalInfo"
  health_check "GameGlobalInfo" "/api/GameGlobalInfo/GetInfo"

  echo "[INFO] Health check: GameAssetPackageVersion"
  health_check "GameAssetPackageVersion" "/api/GameAssetPackageVersion/GetVersion"
else
  echo "[WARN] pm2 not found; deploy completed but service was not reloaded."
  echo "[WARN] Start manually in ${APP_DST}: node src/server.js"
fi
