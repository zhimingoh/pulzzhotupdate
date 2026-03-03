const fs = require('node:fs/promises');
const path = require('node:path');
const { getLegacyHotupdatePrefixRoot, getHotupdatePrefixRoot } = require('./paths');

const COS_IO_TIMEOUT_MS = Number(process.env.COS_IO_TIMEOUT_MS || 120000);
const COS_RETRY_COUNT = Number(process.env.COS_RETRY_COUNT || 3);

function normalizeRelPath(relPath) {
  return relPath.split(path.sep).join('/');
}

function mergeVersionLists(...lists) {
  const merged = new Set();
  for (const list of lists) {
    for (const version of list || []) {
      if (/^\d+$/.test(String(version))) {
        merged.add(String(version));
      }
    }
  }
  return [...merged].sort((a, b) => Number(b) - Number(a));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableCosError(error) {
  if (!error) {
    return false;
  }
  const code = String(error.code || '');
  const message = String(error.message || '').toLowerCase();
  const statusCode = Number(error.statusCode || 0);
  if (statusCode >= 500) {
    return true;
  }
  if (['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN', 'ESOCKETTIMEDOUT'].includes(code)) {
    return true;
  }
  if (['RequestTimeout', 'InternalError', 'ServiceUnavailable', 'SlowDown', 'NetworkingError'].includes(code)) {
    return true;
  }
  return message.includes('timeout') || message.includes('timed out') || message.includes('socket hang up');
}

async function withRetry(task, options = {}) {
  const retries = Number(options.retries ?? COS_RETRY_COUNT);
  const baseDelay = Number(options.baseDelayMs ?? 250);
  let lastError = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (i >= retries || !isRetryableCosError(error)) {
        throw error;
      }
      await sleep(baseDelay * (i + 1));
    }
  }
  throw lastError;
}

async function listFiles(rootDir) {
  const out = [];
  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  await walk(rootDir);
  return out;
}

async function syncToCosMock({ version, sourceDir }) {
  const mockRoot = process.env.PULZZ_COS_MOCK_ROOT;
  if (!mockRoot) {
    return;
  }
  const prefixRoot = path.join(mockRoot, getHotupdatePrefixRoot(), String(version));
  await fs.rm(prefixRoot, { recursive: true, force: true });
  await fs.mkdir(path.dirname(prefixRoot), { recursive: true });
  await fs.cp(sourceDir, prefixRoot, { recursive: true, force: true });
}

async function listVersionsByFsRoot(rootDir) {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => Number(b) - Number(a));
  } catch {
    return [];
  }
}

function createCosClient() {
  const secretId = process.env.TENCENT_SECRET_ID || '';
  const secretKey = process.env.TENCENT_SECRET_KEY || '';
  const bucket = process.env.TENCENT_COS_BUCKET || '';
  const region = process.env.TENCENT_COS_REGION || '';
  if (!secretId || !secretKey || !bucket || !region) {
    const err = new Error('cos_config_missing');
    err.code = 'COS_CONFIG_MISSING';
    throw err;
  }
  // Lazy require so local mode does not need this dependency loaded.
  const COS = require('cos-nodejs-sdk-v5');
  const cos = new COS({ SecretId: secretId, SecretKey: secretKey });
  return { cos, bucket, region };
}

async function listVersionsFromCos() {
  const { cos, bucket, region } = createCosClient();
  const activePrefix = `${getHotupdatePrefixRoot()}/`;
  const legacyPrefix = `${getLegacyHotupdatePrefixRoot()}/`;
  const discovered = new Set();

  async function scan(prefix) {
    let marker = '';
    let shouldContinue = true;
    while (shouldContinue) {
      const page = await withRetry(
        () =>
          new Promise((resolve, reject) => {
            cos.getBucket(
              {
                Bucket: bucket,
                Region: region,
                Prefix: prefix,
                Marker: marker,
                MaxKeys: 1000
              },
              (error, data) => (error ? reject(error) : resolve(data))
            );
          })
      );
      const keys = ((page && page.Contents) || []).map((item) => item.Key).filter(Boolean);
      for (const key of keys) {
        const rest = key.slice(prefix.length);
        const version = rest.split('/')[0];
        if (/^\d+$/.test(version)) {
          discovered.add(version);
        }
      }
      const isTruncated = String(page && page.IsTruncated) === 'true';
      if (isTruncated && keys.length) {
        marker = keys[keys.length - 1];
      } else {
        shouldContinue = false;
      }
    }
  }

  await scan(activePrefix);
  if (legacyPrefix !== activePrefix) {
    await scan(legacyPrefix);
  }
  return [...discovered].sort((a, b) => Number(b) - Number(a));
}

async function listAvailableVersions() {
  const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
  if (driver === 'cos') {
    if (process.env.PULZZ_COS_MOCK_ROOT) {
      const mockRoot = process.env.PULZZ_COS_MOCK_ROOT;
      const [active, legacy] = await Promise.all([
        listVersionsByFsRoot(path.join(mockRoot, getHotupdatePrefixRoot())),
        listVersionsByFsRoot(path.join(mockRoot, getLegacyHotupdatePrefixRoot()))
      ]);
      return mergeVersionLists(active, legacy);
    }
    return listVersionsFromCos();
  }
  const localRootBase = process.env.PULZZ_CDN_ROOT ? process.env.PULZZ_CDN_ROOT : path.join('/opt/pulzz-hotupdate', 'cdn');
  const [active, legacy] = await Promise.all([
    listVersionsByFsRoot(path.join(localRootBase, getHotupdatePrefixRoot())),
    listVersionsByFsRoot(path.join(localRootBase, getLegacyHotupdatePrefixRoot()))
  ]);
  return mergeVersionLists(active, legacy);
}

async function syncToCosReal({ version, sourceDir }) {
  const { cos, bucket, region } = createCosClient();
  const prefixRoot = getHotupdatePrefixRoot();
  const versionPrefixes = [`${prefixRoot}/${version}/`];

  async function listAllKeysByPrefix(prefix) {
    const all = [];
    let marker = '';
    let shouldContinue = true;
    while (shouldContinue) {
      const page = await withRetry(
        () =>
          new Promise((resolve, reject) => {
            cos.getBucket(
              {
                Bucket: bucket,
                Region: region,
                Prefix: prefix,
                Marker: marker,
                MaxKeys: 1000
              },
              (error, data) => (error ? reject(error) : resolve(data))
            );
          })
      );
      const keys = ((page && page.Contents) || []).map((item) => item.Key).filter(Boolean);
      all.push(...keys);
      const isTruncated = String(page && page.IsTruncated) === 'true';
      if (isTruncated && keys.length) {
        marker = keys[keys.length - 1];
      } else {
        shouldContinue = false;
      }
    }
    return all;
  }

  async function deleteKeys(keys) {
    if (!keys.length) {
      return;
    }
    const chunks = [];
    for (let i = 0; i < keys.length; i += 1000) {
      chunks.push(keys.slice(i, i + 1000));
    }
    for (const chunk of chunks) {
      await withRetry(
        () =>
          new Promise((resolve, reject) => {
            cos.deleteMultipleObject(
              {
                Bucket: bucket,
                Region: region,
                Objects: chunk.map((key) => ({ Key: key })),
                Quiet: true
              },
              (error) => (error ? reject(error) : resolve())
            );
          })
      );
    }
  }

  // Keep bucket content deterministic for one version path.
  // This avoids stale files like ".../100/100/*" from previous uploads.
  for (const versionPrefix of versionPrefixes) {
    const staleKeys = await listAllKeysByPrefix(versionPrefix);
    await deleteKeys(staleKeys);
  }

  const files = await listFiles(sourceDir);
  for (const versionPrefix of versionPrefixes) {
    for (const file of files) {
      const rel = normalizeRelPath(path.relative(sourceDir, file));
      const key = `${versionPrefix}${rel}`;
      const body = await fs.readFile(file);
      await withRetry(
        () =>
          new Promise((resolve, reject) => {
            cos.putObject(
              {
                Bucket: bucket,
                Region: region,
                Key: key,
                Body: body,
                Timeout: COS_IO_TIMEOUT_MS
              },
              (error) => {
                if (error) {
                  reject(error);
                  return;
                }
                resolve();
              }
            );
          })
      );
    }
  }
}

async function syncUploadedVersion({ platform, version, sourceDir }) {
  const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
  if (driver !== 'cos') {
    return;
  }

  if (process.env.PULZZ_COS_MOCK_ROOT) {
    await syncToCosMock({ platform, version, sourceDir });
    return;
  }

  await syncToCosReal({ platform, version, sourceDir });
}

module.exports = {
  syncUploadedVersion,
  listAvailableVersions
};
