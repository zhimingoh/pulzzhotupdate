# Pulzz WxMini Hot-Update Platform V1

Thin hot-update protocol adapter for wxmini, built with **Node.js 20 + Fastify**.

## Recommended Deployment
Use the repo-native deployment script. Do not rely on a one-off command list outside the repository.

### First deployment
```bash
git clone https://github.com/zhimingoh/pulzzhotupdate.git
cd pulzzhotupdate
cp .env.production.example .env.production
$EDITOR .env.production
./scripts/deploy-production.sh
```

### Subsequent updates
```bash
git pull --ff-only
./scripts/deploy-production.sh
```

That is the normal backend deployment flow. You do not need register/publish for routine releases.

## Features
- Keeps the Unity client protocol unchanged
- Serves startup/version endpoints from a single `latest.json` manifest
- Optional admin pages and legacy upload/register/publish routes
- No database dependency

## Domain Model
- API domain: the current Unity client boots from `https://api.kaukei.icu`
- CDN domain: hot-update files and `latest.json` can live on a separate static domain such as `https://cdn.kaukei.icu`
- Recommended manifest URL: `https://cdn.kaukei.icu/hotupdate/latest.json`
- Recommended resource root: `https://cdn.kaukei.icu/hotupdate/StreamingAssets`

The backend no longer needs to infer the CDN from the API hostname. It simply returns the URLs defined by the manifest.

## Tech Stack
- Node.js 20
- Fastify
- PM2 (optional for process management)
- rsync (used by deploy scripts)

## Project Structure
- `app/src/server.js` - HTTP server and routes
- `app/src/lib/response.js` - unified response shape
- `app/src/lib/manifest.js` - `latest.json` loader and validator
- `app/src/lib/state.js` - state read/write
- `app/src/lib/lock.js` - file lock for critical operations
- `app/src/lib/paths.js` - path helpers
- `app/public/admin-ui/index.html` - admin UI
- `app/config/latest.json` - default release manifest path
- `app/config/state.json` - runtime state file (generated/updated at runtime)
- `app/ecosystem.config.js` - PM2 config
- `.env.production.example` - production environment template
- `scripts/deploy.sh` - deploy helper
- `scripts/deploy-production.sh` - recommended production deploy entrypoint
- `scripts/publish-sync.sh` - publish sync helper

## Local Development
```bash
cd app
npm install
npm start
```

Default listen: `127.0.0.1:20808`

## Manifest-Driven Release Flow
The client-facing API reads one manifest file and treats it as the release source of truth.

Default manifest path:
- `app/config/latest.json`

Override with:
- `HOTUPDATE_MANIFEST_PATH`
- `HOTUPDATE_MANIFEST_URL`

Example manifest:
```json
{
  "version": "151",
  "appVersion": "1.0.0",
  "packageName": "com.Kaukei.Game",
  "platform": "WebGLWxMiniGame",
  "channel": "WxMiniGame",
  "assetPackageName": "DefaultPackage",
  "rootPath": "https://cdn.example.com/hotupdate/StreamingAssets"
}
```

Recommended release steps:
1. Upload hot-update files to COS/CDN under the target version directory
2. Update `latest.json` to the version you want live
3. Upload `latest.json`

Rollback is the same operation: change only `latest.json` back to an older version and upload it.

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

## Legacy Admin Operations
These routes still exist for compatibility, but they are no longer the primary release switch in manifest-driven mode.

```bash
# Upload (filename must be numeric, e.g. 100.zip)
curl -s -X POST http://127.0.0.1:20808/admin/upload \
  -F 'platform=wxmini' \
  -F 'file=@100.zip'

# List versions
curl -s 'http://127.0.0.1:20808/admin/versions?platform=wxmini'

# Publish (legacy state flow)
curl -s -X POST http://127.0.0.1:20808/admin/publish \
  -H 'Content-Type: application/json' \
  -d '{"platform":"wxmini","version":"100"}'

# Switch active version (legacy state flow)
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
git clone https://github.com/zhimingoh/pulzzhotupdate.git
cd pulzzhotupdate
cp .env.production.example .env.production
```

### 3) Start service
Edit `.env.production` and set at minimum:

```bash
HOTUPDATE_MANIFEST_URL=https://cdn.kaukei.icu/hotupdate/latest.json
PUBLIC_API_HOST=api.kaukei.icu
DEPLOY_ROOT=/opt/pulzz-hotupdate
```

Then run:

```bash
./scripts/deploy-production.sh
```

The script will:
- sync `app/` into the deploy root
- install production dependencies
- reload PM2 with `--update-env`
- run local health checks against the configured API host

### 3.1) Verify the service is reading the manifest
```bash
curl -s -X POST http://127.0.0.1:20808/api/GameAssetPackageVersion/GetVersion \
  -H 'Content-Type: application/json' \
  -d '{}'
```

You should see:
- `Code: 0`
- `Version` matching `latest.json`
- `RootPath` matching `latest.json`

### Admin Auth (Basic Auth)
- Admin authentication is always enabled for:
  - `/admin-ui/*`
  - `/admin/*`
- Fixed password: `shaar008`
- Optional: set `ADMIN_USERNAME` to require a fixed username.

### 4) Reverse proxy (recommended)
Use Nginx/Caddy to expose service externally and keep app bound to localhost.

## Runtime Paths (default)
- Release manifest: `/opt/pulzz-hotupdate/app/config/latest.json`
- State file: `/opt/pulzz-hotupdate/app/config/state.json`
- Upload path: `/opt/pulzz-hotupdate/cdn/pulzz-gameres/wxmini/{version}`
- Publish target: `/opt/pulzz-hotupdate/cdn/hotupdate/StreamingAssets/com.Kaukei.Game/WebGLWxMiniGame/1.0.0/WxMiniGame/DefaultPackage/{version}`
- API `RootPath`: read from `latest.json`

### Manifest source priority
The service reads the manifest in this order:
1. `HOTUPDATE_MANIFEST_PATH`
2. `HOTUPDATE_MANIFEST_URL`
3. local file `app/config/latest.json`

For production, the recommended mode is `HOTUPDATE_MANIFEST_URL`.

### Repo-native deployment inputs
`scripts/deploy-production.sh` reads these values from `.env.production`:
- `HOTUPDATE_MANIFEST_URL`
- `PUBLIC_API_HOST`
- `DEPLOY_ROOT`
- `HOST`
- `PORT`
- `PULZZ_STATE_PATH`

## Release Checklist
1. Build and upload version files to COS/CDN
2. Confirm the version directory exists remotely
3. Update `hotupdate/latest.json`
4. Upload `hotupdate/latest.json`
5. Call `GameAssetPackageVersion/GetVersion` and confirm `Version` changed

## Rollback Checklist
1. Change only `hotupdate/latest.json` back to the previous version
2. Upload the manifest again
3. Call `GameAssetPackageVersion/GetVersion` and confirm it returned the older version

## Legacy Deploy Script
```bash
./scripts/deploy.sh
```
Default deploy root: `/opt/pulzz-hotupdate`

For new deployments, use `./scripts/deploy-production.sh` instead.

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
