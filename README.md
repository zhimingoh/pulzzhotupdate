# Pulzz WxMini Hot-Update Platform V1

Thin hot-update protocol adapter for wxmini, built with **Node.js 20 + Fastify**.

## Recommended Deployment
If you just want the new manifest flow online, do this:

1. Deploy the service and keep it bound to `127.0.0.1:20808`
2. Set `HOTUPDATE_MANIFEST_URL` to your CDN manifest, for example `https://cdn.your-domain.com/hotupdate/latest.json`
3. Upload version files to `hotupdate/StreamingAssets/com.Kaukei.Game/WebGLWxMiniGame/1.0.0/WxMiniGame/DefaultPackage/<version>/`
4. Upload `hotupdate/latest.json`
5. Reload PM2

That is the normal release flow. You do not need register/publish for routine releases.

## Features
- Keeps the Unity client protocol unchanged
- Serves startup/version endpoints from a single `latest.json` manifest
- Optional admin pages and legacy upload/register/publish routes
- No database dependency

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
- `scripts/deploy.sh` - deploy helper
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
git clone <YOUR_REPO_URL>
cd pulzzhotupdate/app
npm ci --omit=dev || npm install --omit=dev
```

### 3) Start service
Edit `app/ecosystem.config.js` first and replace:

```js
HOTUPDATE_MANIFEST_URL: "https://cdn.example.com/hotupdate/latest.json"
```

with your real CDN URL, for example:

```js
HOTUPDATE_MANIFEST_URL: "https://cdn.kaukei.com/hotupdate/latest.json"
```

```bash
# Option A: direct
npm start

# Option B: PM2 (recommended)
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

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
