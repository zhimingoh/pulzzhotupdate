# Pulzz WxMini Hot-Update Platform V1

Production-ready hot-update backend for wxmini, built with **Node.js 20 + Fastify**.

## Features
- Hot-update version management (upload / publish / switch)
- Admin web UI
- JSON file state (no DB dependency)
- Serialized publish/switch with lock to avoid race conditions

## Tech Stack
- Node.js 20
- Fastify
- PM2 (optional for process management)
- rsync (used by deploy scripts)

## Project Structure
- `app/src/server.js` - HTTP server and routes
- `app/src/lib/response.js` - unified response shape
- `app/src/lib/state.js` - state read/write
- `app/src/lib/lock.js` - file lock for critical operations
- `app/src/lib/paths.js` - path helpers
- `app/public/admin-ui/index.html` - admin UI
- `app/config/state.json` - runtime state file (generated/updated at runtime)
- `app/ecosystem.config.js` - PM2 config
- `scripts/deploy.sh` - deploy helper
- `scripts/publish-sync.sh` - publish sync helper

## Local Development
```bash
cd app
npm install
npm start
```

Default listen: `127.0.0.1:20808`

## API Smoke Test
```bash
# 1) Global info
curl -s -X POST http://127.0.0.1:20808/api/GameGlobalInfo/GetInfo \
  -H 'Content-Type: application/json' \
  -d '{"AppVersion":"9.9.9"}'

# 2) App version
curl -s -X POST http://127.0.0.1:20808/api/GameAppVersion/GetVersion \
  -H 'Content-Type: application/json' \
  -d '{"AppVersion":"9.9.9"}'

# 3) Asset package version
curl -s -X POST http://127.0.0.1:20808/api/GameAssetPackageVersion/GetVersion \
  -H 'Content-Type: application/json' \
  -d '{}'
```

## Admin Operations
```bash
# Upload (filename must be numeric, e.g. 100.zip)
curl -s -X POST http://127.0.0.1:20808/admin/upload \
  -F 'platform=wxmini' \
  -F 'file=@100.zip'

# List versions
curl -s 'http://127.0.0.1:20808/admin/versions?platform=wxmini'

# Publish
curl -s -X POST http://127.0.0.1:20808/admin/publish \
  -H 'Content-Type: application/json' \
  -d '{"platform":"wxmini","version":"100"}'

# Switch active version
curl -s -X POST http://127.0.0.1:20808/admin/switch \
  -H 'Content-Type: application/json' \
  -d '{"platform":"wxmini","version":"100"}'
```

## Production Deployment
### 1) Server prerequisites
- Linux server
- Node.js 20+
- npm
- rsync
- PM2 (recommended)

### 2) Clone and install
```bash
git clone <YOUR_REPO_URL>
cd pulzz-v1/app
npm ci --omit=dev || npm install --omit=dev
```

### 3) Start service
```bash
# Option A: direct
npm start

# Option B: PM2 (recommended)
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### Admin Auth (Basic Auth)
- Admin authentication is always enabled for:
  - `/admin-ui/*`
  - `/admin/*`
- Fixed password: `shaar008`
- Optional: set `ADMIN_USERNAME` to require a fixed username.

### 4) Reverse proxy (recommended)
Use Nginx/Caddy to expose service externally and keep app bound to localhost.

## Runtime Paths (default)
- State file: `/opt/pulzz-hotupdate/app/config/state.json`
- Upload path: `/opt/pulzz-hotupdate/cdn/pulzz-gameres/wxmini/{version}`
- Publish target: `/opt/pulzz-hotupdate/cdn/hotupdate/StreamingAssets/com.Kaukei.Game/WebGLWxMiniGame/1.0.0/WxMiniGame/DefaultPackage/{version}`
- API `RootPath` default: `https://cdn.<domain>/hotupdate/StreamingAssets`

### CDN RootPath config
- `CDN_ROOT_PATH`: custom base URL for `GameAssetPackageVersion.GetVersion -> RootPath`
- `CDN_APPEND_STREAMING_ASSETS`: defaults to `true`; appends `/StreamingAssets` to `CDN_ROOT_PATH` (or default root)
- `CDN_STREAMING_SEGMENT`: custom segment instead of `StreamingAssets`

## Deploy Script
```bash
./scripts/deploy.sh
```
Default deploy root: `/opt/pulzz-hotupdate`

## Response Format
All endpoints use `HttpJsonResult`:
```json
{
  "Code": 0,
  "Message": "ok",
  "Data": "{...json string...}"
}
```

## Security Notes
- Keep service behind reverse proxy / firewall
- Do not expose admin endpoints without access control
- Keep Binance/API-like secrets out of repo (`.env`, config files)
- `state.json` is runtime data and excluded from version control
