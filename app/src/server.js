const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Fastify = require('fastify');
const multipart = require('@fastify/multipart');
const fastifyStatic = require('@fastify/static');
const AdmZip = require('adm-zip');
const { success, failure } = require('./lib/response');
const { withFileLock } = require('./lib/lock');
const { loadManifest } = require('./lib/manifest');
const {
  CONSTANTS,
  getUploadRoot,
  getStateFilePath,
  getStreamingAssetsSegment,
  shouldUseStreamingAssetsRoot
} = require('./lib/paths');
const {
  ensureStateFile,
  readState,
  recordUpload,
  setCurrentVersion
} = require('./lib/state');
const { syncUploadedVersion, listAvailableVersions } = require('./lib/storage');

const ADMIN_PLATFORM = 'wxmini';
const ERROR_CODES = {
  INVALID_VERSION_NAME: 4001,
  ZIP_STRUCTURE_MISMATCH: 4002,
  INVALID_PLATFORM: 4003,
  VERSION_NOT_FOUND: 4004,
  INVALID_REQUEST: 4005,
  LOCK_BUSY: 4006,
  FILE_TOO_LARGE: 4007,
  INTERNAL: 5000
};
const FIXED_ADMIN_PASSWORD = 'shaar008';

function splitHeaderFirst(value) {
  return String(value || '').split(',')[0].trim();
}

function ensureNoTrailingSlash(url) {
  return String(url || '').replace(/\/+$/, '');
}

function joinUrl(base, endpointPath) {
  const normalizedBase = ensureNoTrailingSlash(base);
  const normalizedPath = endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
  return `${normalizedBase}${normalizedPath}`;
}

function appendPathSegmentIfMissing(base, segment) {
  const normalizedBase = ensureNoTrailingSlash(base);
  const normalizedSegment = String(segment || '')
    .trim()
    .replace(/^\/+|\/+$/g, '');
  if (!normalizedSegment) {
    return normalizedBase;
  }
  if (normalizedBase.toLowerCase().endsWith(`/${normalizedSegment.toLowerCase()}`)) {
    return normalizedBase;
  }
  return `${normalizedBase}/${normalizedSegment}`;
}

function getRequestBaseUrl(request) {
  const proto = splitHeaderFirst(request.headers['x-forwarded-proto']) || 'https';
  const host = splitHeaderFirst(request.headers['x-forwarded-host']) || request.headers.host || 'api.kaukei.com';
  return `${proto}://${host}`;
}

function getCheckAppVersionUrl(request) {
  if (process.env.CHECK_APP_VERSION_URL) {
    return process.env.CHECK_APP_VERSION_URL;
  }
  return joinUrl(getRequestBaseUrl(request), '/api/GameAppVersion/GetVersion');
}

function getCheckResourceVersionUrl(request) {
  if (process.env.CHECK_RESOURCE_VERSION_URL) {
    return process.env.CHECK_RESOURCE_VERSION_URL;
  }
  return joinUrl(getRequestBaseUrl(request), '/api/GameAssetPackageVersion/GetVersion');
}

function getResourceRootPath(request) {
  const configuredRootPath = process.env.CDN_ROOT_PATH;
  const reqBase = getRequestBaseUrl(request);
  const cdnBase = reqBase.replace('://api.', '://cdn.');
  const defaultRootPath = joinUrl(cdnBase, '/hotupdate');
  const resourceRootPath = configuredRootPath || defaultRootPath;

  if (!shouldUseStreamingAssetsRoot()) {
    return ensureNoTrailingSlash(resourceRootPath);
  }

  return appendPathSegmentIfMissing(resourceRootPath, getStreamingAssetsSegment());
}

function parseBasicAuth(authorization) {
  if (!authorization || typeof authorization !== 'string') {
    return null;
  }
  const [scheme, encoded] = authorization.split(' ');
  if (!scheme || !encoded || scheme.toLowerCase() !== 'basic') {
    return null;
  }
  let decoded = '';
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch (error) {
    return null;
  }
  const separator = decoded.indexOf(':');
  if (separator < 0) {
    return null;
  }
  return {
    username: decoded.slice(0, separator),
    password: decoded.slice(separator + 1)
  };
}

function safeEqualText(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function normalizeZipEntryName(name) {
  return name.replaceAll('\\', '/').replace(/^\/+/, '');
}

function parseVersionFromFilename(filename) {
  const parsed = path.parse(filename || '');
  if (parsed.ext.toLowerCase() !== '.zip') {
    return null;
  }
  if (!/^\d+$/.test(parsed.name)) {
    return null;
  }
  return parsed.name;
}

function inspectArchiveLayout(zip, version) {
  const entries = zip
    .getEntries()
    .map((entry) => {
      const normalized = normalizeZipEntryName(entry.entryName);
      return {
        name: normalized,
        // Directory markers like "100/" should not be treated as root files.
        isDirectory: entry.isDirectory || normalized.endsWith('/')
      };
    })
    .filter((entry) => entry.name && !entry.name.startsWith('__MACOSX/') && entry.name !== '__MACOSX');

  if (entries.length === 0) {
    return { ok: false, flatten: false };
  }

  const topFolders = new Set();
  let hasRootFile = false;

  for (const entry of entries) {
    const parts = entry.name.split('/').filter(Boolean);
    if (entry.isDirectory) {
      if (parts.length >= 1) {
        topFolders.add(parts[0]);
      }
      continue;
    }
    if (parts.length === 1) {
      hasRootFile = true;
      continue;
    }
    topFolders.add(parts[0]);
  }

  if (topFolders.size === 1 && !hasRootFile) {
    const onlyFolder = [...topFolders][0];
    if (onlyFolder !== version) {
      return { ok: false, flatten: false };
    }
    return { ok: true, flatten: true };
  }

  if (topFolders.size > 1 && !hasRootFile) {
    return { ok: false, flatten: false };
  }

  return { ok: true, flatten: false };
}

async function extractZipToVersion(filePath, version, uploadRoot) {
  const zip = new AdmZip(filePath);
  const layout = inspectArchiveLayout(zip, version);
  if (!layout.ok) {
    const error = new Error('zip_structure_mismatch');
    error.code = 'ZIP_STRUCTURE_MISMATCH';
    throw error;
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pulzz-upload-'));
  const destDir = path.join(uploadRoot, version);

  try {
    zip.extractAllTo(tempDir, true);
    await fs.rm(destDir, { recursive: true, force: true });
    await fs.mkdir(destDir, { recursive: true });

    const sourceDir = layout.flatten ? path.join(tempDir, version) : tempDir;
    await fs.cp(sourceDir, destDir, { recursive: true, force: true });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function applyVersion(version, action) {
  const lockPath = `${getStateFilePath()}.publish.lock`;

  return withFileLock(lockPath, async () => {
    const available = await listAvailableVersions(ADMIN_PLATFORM);
    if (!available.includes(version)) {
      const err = new Error('version_not_found');
      err.code = 'VERSION_NOT_FOUND';
      throw err;
    }
    const state = await readState();
    if (state.currentVersion === version) {
      return { alreadyCurrent: true };
    }

    await setCurrentVersion(version, action);
    return { alreadyCurrent: false };
  }).catch((error) => {
    if (error.code === 'LOCK_TIMEOUT') {
      const lockError = new Error('lock_busy');
      lockError.code = 'LOCK_BUSY';
      throw lockError;
    }
    throw error;
  });
}

async function createServer() {
  const app = Fastify({ logger: true });
  const adminPassword = FIXED_ADMIN_PASSWORD;
  const adminUsername = String(process.env.ADMIN_USERNAME || '');
  const adminAuthEnabled = true;
  const uploadLimitMb = Number(process.env.UPLOAD_MAX_MB || 512);

  await ensureStateFile();

  await app.register(multipart, {
    limits: {
      fileSize: Math.max(1, uploadLimitMb) * 1024 * 1024
    }
  });
  await app.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'public', 'admin-ui'),
    prefix: '/admin-ui/'
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!adminAuthEnabled) {
      return;
    }
    const pathName = request.raw.url || '';
    const isAdminRoute = pathName.startsWith('/admin/') || pathName.startsWith('/admin-ui');
    if (!isAdminRoute) {
      return;
    }

    const credential = parseBasicAuth(request.headers.authorization);
    const passwordOk = credential && safeEqualText(credential.password, adminPassword);
    const usernameOk = !adminUsername || (credential && safeEqualText(credential.username, adminUsername));
    if (passwordOk && usernameOk) {
      return;
    }

    reply.header('WWW-Authenticate', 'Basic realm="Pulzz Admin", charset="UTF-8"');
    if (pathName.startsWith('/admin/')) {
      return reply.code(401).send(failure(401, 'unauthorized', {}));
    }
    return reply.code(401).type('text/plain').send('Unauthorized');
  });

  app.get('/admin-ui', async (request, reply) => {
    reply.redirect('/admin-ui/');
  });

  app.post('/api/GameGlobalInfo/GetInfo', async (request) => {
    await loadManifest();
    return success({
      CheckAppVersionUrl: getCheckAppVersionUrl(request),
      CheckResourceVersionUrl: getCheckResourceVersionUrl(request),
      AOTCodeList: process.env.AOT_CODE_LIST || '[]',
      Content: process.env.GLOBAL_INFO_CONTENT || '{}'
    });
  });

  app.post('/api/GameAppVersion/GetVersion', async () => {
    const manifest = await loadManifest();
    return success({
      IsForce: false,
      AppDownloadUrl: '',
      IsUpgrade: false,
      UpdateAnnouncement: '',
      UpdateTitle: '',
      PackageName: manifest.packageName,
      Platform: manifest.platform,
      Channel: manifest.channel,
      AppVersion: manifest.appVersion,
      CurrentVersion: manifest.version
    });
  });

  app.post('/api/GameAssetPackageVersion/GetVersion', async () => {
    const manifest = await loadManifest();
    return success({
      Language: '',
      Version: manifest.version,
      PackageName: manifest.packageName,
      Platform: manifest.platform,
      Channel: manifest.channel,
      AssetPackageName: manifest.assetPackageName,
      RootPath: manifest.rootPath,
      AppVersion: manifest.appVersion,
      CurrentVersion: manifest.version
    });
  });

  app.post('/admin/upload', async (request, reply) => {
    const parts = request.parts();
    let platform = '';
    let fileName = '';
    let fileBuffer = null;

    for await (const part of parts) {
      if (part.type === 'field' && part.fieldname === 'platform') {
        platform = String(part.value || '').trim();
      }
      if (part.type === 'file' && part.fieldname === 'file') {
        fileName = part.filename || '';
        fileBuffer = await part.toBuffer();
      }
    }

    if (platform !== ADMIN_PLATFORM) {
      return reply.code(400).send(failure(ERROR_CODES.INVALID_PLATFORM, 'invalid_platform', {}));
    }

    if (!fileBuffer) {
      return reply.code(400).send(failure(ERROR_CODES.INVALID_REQUEST, 'missing_file', {}));
    }

    const version = parseVersionFromFilename(fileName);
    if (!version) {
      return reply.code(400).send(failure(ERROR_CODES.INVALID_VERSION_NAME, 'invalid_version_filename', {}));
    }

    const tempFile = path.join(os.tmpdir(), `pulzz-upload-${Date.now()}-${Math.random().toString(16).slice(2)}.zip`);

    try {
      await fs.mkdir(getUploadRoot(ADMIN_PLATFORM), { recursive: true });
      await fs.writeFile(tempFile, fileBuffer);
      await extractZipToVersion(tempFile, version, getUploadRoot(ADMIN_PLATFORM));
      await syncUploadedVersion({
        platform,
        version,
        sourceDir: path.join(getUploadRoot(ADMIN_PLATFORM), version)
      });
      const overwrite = await recordUpload(version);
      return success({ version, platform }, overwrite ? 'uploaded_overwrite' : 'uploaded');
    } catch (error) {
      request.log.error(error);
      if (error.code === 'FST_REQ_FILE_TOO_LARGE' || error.statusCode === 413) {
        return reply.code(413).send(failure(ERROR_CODES.FILE_TOO_LARGE, 'file_too_large', {}));
      }
      if (error.code === 'ZIP_STRUCTURE_MISMATCH') {
        return reply.code(400).send(failure(ERROR_CODES.ZIP_STRUCTURE_MISMATCH, 'zip_structure_mismatch', {}));
      }
      if (error.code === 'COS_CONFIG_MISSING') {
        return reply.code(500).send(failure(ERROR_CODES.INTERNAL, 'cos_config_missing', {}));
      }
      if (error.message) {
        return reply.code(500).send(failure(ERROR_CODES.INTERNAL, `internal_error:${error.message}`, {}));
      }
      return reply.code(500).send(failure(ERROR_CODES.INTERNAL, 'internal_error', {}));
    } finally {
      await fs.rm(tempFile, { force: true });
    }
  });

  app.post('/admin/register', async (request, reply) => {
    const { platform, version } = request.body || {};
    if (platform !== ADMIN_PLATFORM) {
      return reply.code(400).send(failure(ERROR_CODES.INVALID_PLATFORM, 'invalid_platform', {}));
    }
    if (!/^\d+$/.test(String(version || ''))) {
      return reply.code(400).send(failure(ERROR_CODES.INVALID_REQUEST, 'invalid_version', {}));
    }

    try {
      const discovered = await listAvailableVersions(platform);
      if (!discovered.includes(version)) {
        return reply.code(400).send(failure(ERROR_CODES.VERSION_NOT_FOUND, 'version_not_found', {}));
      }
      const overwrite = await recordUpload(version);
      return success({ version, platform }, overwrite ? 'registered_overwrite' : 'registered');
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send(failure(ERROR_CODES.INTERNAL, 'internal_error', {}));
    }
  });

  app.get('/admin/versions', async (request, reply) => {
    const { platform } = request.query;
    if (platform !== ADMIN_PLATFORM) {
      return reply.code(400).send(failure(ERROR_CODES.INVALID_PLATFORM, 'invalid_platform', {}));
    }

    const manifest = await loadManifest();
    const state = await readState();
    const discovered = await listAvailableVersions(platform);
    const versionsToShow = [...new Set([...discovered, manifest.version])].sort((a, b) => Number(b) - Number(a));
    const stateMap = new Map((state.versions || []).map((v) => [v.version, v]));
    const versions = versionsToShow.map((version) => {
      const item = stateMap.get(version) || {};
      return {
        version,
        uploadedAt: item.uploadedAt || '',
        publishedAt: item.publishedAt || ''
      };
    });
    return success({
      platform,
      currentVersion: manifest.version,
      versions,
      history: state.history
    });
  });

  async function handlePublishOrSwitch(request, reply, action) {
    const { platform, version } = request.body || {};

    if (platform !== ADMIN_PLATFORM) {
      return reply.code(400).send(failure(ERROR_CODES.INVALID_PLATFORM, 'invalid_platform', {}));
    }

    if (!/^\d+$/.test(String(version || ''))) {
      return reply.code(400).send(failure(ERROR_CODES.INVALID_REQUEST, 'invalid_version', {}));
    }

    try {
      const discovered = await listAvailableVersions(platform);
      if (!discovered.includes(version)) {
        return reply.code(400).send(failure(ERROR_CODES.VERSION_NOT_FOUND, 'version_not_found', {}));
      }

      const result = await applyVersion(version, action);
      if (result.alreadyCurrent) {
        return success({ version, platform }, 'already_current');
      }
      return success({ version, platform }, action === 'publish' ? 'published' : 'switched');
    } catch (error) {
      request.log.error(error);
      if (error.code === 'LOCK_BUSY') {
        return reply.code(409).send(failure(ERROR_CODES.LOCK_BUSY, 'lock_busy', {}));
      }
      if (error.code === 'VERSION_NOT_FOUND') {
        return reply.code(400).send(failure(ERROR_CODES.VERSION_NOT_FOUND, 'version_not_found', {}));
      }
      return reply.code(500).send(failure(ERROR_CODES.INTERNAL, 'internal_error', {}));
    }
  }

  app.post('/admin/publish', async (request, reply) => handlePublishOrSwitch(request, reply, 'publish'));
  app.post('/admin/switch', async (request, reply) => handlePublishOrSwitch(request, reply, 'switch'));

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    reply.code(500).send(failure(ERROR_CODES.INTERNAL, 'internal_error', {}));
  });

  return app;
}

async function start() {
  const app = await createServer();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 20808);
  await app.listen({ host, port });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  createServer,
  start,
  ERROR_CODES
};
