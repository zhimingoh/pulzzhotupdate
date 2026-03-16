#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT_PATH="${REPO_ROOT}/scripts/deploy-production.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

BIN_DIR="${TMP_DIR}/bin"
DEPLOY_ROOT="${TMP_DIR}/deploy"
ENV_FILE="${TMP_DIR}/.env.production"
mkdir -p "${BIN_DIR}"

cat > "${ENV_FILE}" <<'EOF'
HOTUPDATE_MANIFEST_URL=https://cdn.kaukei.icu/hotupdate/latest.json
PUBLIC_API_HOST=api.kaukei.icu
EOF

cat > "${BIN_DIR}/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm %s\n' "$*" >> "${LOG_FILE:?}"
EOF
chmod +x "${BIN_DIR}/npm"

cat > "${BIN_DIR}/pm2" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'pm2 %s HOTUPDATE_MANIFEST_URL=%s\n' "$*" "${HOTUPDATE_MANIFEST_URL:-}" >> "${LOG_FILE:?}"
EOF
chmod +x "${BIN_DIR}/pm2"

cat > "${BIN_DIR}/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'curl %s\n' "$*" >> "${LOG_FILE:?}"
printf '{"Code":0,"Message":"ok","Data":"{}"}'
EOF
chmod +x "${BIN_DIR}/curl"

export LOG_FILE="${TMP_DIR}/commands.log"
export PATH="${BIN_DIR}:${PATH}"
export DEPLOY_ROOT
export ENV_FILE

bash "${SCRIPT_PATH}"

test -f "${DEPLOY_ROOT}/app/src/server.js"
grep -q 'pm2 startOrReload ecosystem.config.js --update-env HOTUPDATE_MANIFEST_URL=https://cdn.kaukei.icu/hotupdate/latest.json' "${LOG_FILE}"
grep -q 'curl -sSf http://127.0.0.1:20808/api/GameAssetPackageVersion/GetVersion' "${LOG_FILE}"
