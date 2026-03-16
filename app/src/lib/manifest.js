const fs = require('node:fs/promises');
const path = require('node:path');
const { APP_ROOT } = require('./paths');

const REQUIRED_FIELDS = [
  'version',
  'appVersion',
  'packageName',
  'platform',
  'channel',
  'assetPackageName',
  'rootPath'
];

function normalizeRequiredString(value, fieldName) {
  if (typeof value !== 'string') {
    throw new Error(`Manifest field "${fieldName}" must be a string`);
  }

  const normalizedValue = value.trim();
  if (!normalizedValue) {
    throw new Error(`Manifest field "${fieldName}" is required`);
  }

  return normalizedValue;
}

function validateManifest(rawManifest) {
  if (!rawManifest || typeof rawManifest !== 'object' || Array.isArray(rawManifest)) {
    throw new Error('Manifest must be a JSON object');
  }

  const manifest = {};
  for (const fieldName of REQUIRED_FIELDS) {
    manifest[fieldName] = normalizeRequiredString(rawManifest[fieldName], fieldName);
  }

  return manifest;
}

function getDefaultManifestPath() {
  return path.join(APP_ROOT, 'config', 'latest.json');
}

async function readManifestText({ manifestPath, manifestUrl }) {
  if (manifestPath) {
    return fs.readFile(manifestPath, 'utf8');
  }

  if (manifestUrl) {
    const response = await fetch(manifestUrl);
    if (!response.ok) {
      throw new Error(`Manifest request failed: ${response.status}`);
    }
    return response.text();
  }

  throw new Error('Manifest source is required');
}

async function loadManifest(manifestPath = process.env.HOTUPDATE_MANIFEST_PATH) {
  const manifestUrl = process.env.HOTUPDATE_MANIFEST_URL || '';
  const manifestSourcePath = manifestPath || (manifestUrl ? '' : getDefaultManifestPath());
  const content = await readManifestText({
    manifestPath: manifestSourcePath,
    manifestUrl: manifestUrl || ''
  });
  return validateManifest(JSON.parse(content));
}

module.exports = {
  getDefaultManifestPath,
  loadManifest,
  validateManifest
};
