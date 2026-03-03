const path = require('node:path');

const ROOT = process.env.PULZZ_ROOT || '/opt/pulzz-hotupdate';
const APP_ROOT = process.env.PULZZ_APP_ROOT || path.join(ROOT, 'app');
const CDN_ROOT = process.env.PULZZ_CDN_ROOT || path.join(ROOT, 'cdn');

const CONSTANTS = {
  packageName: 'com.smartdog.bbqgame',
  platform: 'WebGLWxMiniGame',
  channel: 'WxMiniGame',
  assetPackageName: 'DefaultPackage',
  appVersion: '1.0.0'
};

function parseBoolEnv(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function getStreamingAssetsSegment() {
  return String(process.env.CDN_STREAMING_SEGMENT || 'StreamingAssets')
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

function shouldUseStreamingAssetsRoot() {
  return parseBoolEnv(process.env.CDN_APPEND_STREAMING_ASSETS, true);
}

function getAssetsPrefixRoot() {
  return (process.env.COS_PREFIX_ROOT || 'pulzz-gameres').toLowerCase();
}

function getLegacyHotupdatePrefixRoot() {
  return path.posix.join(
    'hotupdate',
    CONSTANTS.packageName,
    CONSTANTS.platform,
    CONSTANTS.appVersion,
    CONSTANTS.channel,
    CONSTANTS.assetPackageName
  );
}

function getHotupdatePrefixRoot() {
  const baseParts = ['hotupdate'];
  if (shouldUseStreamingAssetsRoot()) {
    const streamingSegment = getStreamingAssetsSegment();
    if (streamingSegment) {
      baseParts.push(streamingSegment);
    }
  }
  return path.posix.join(
    ...baseParts,
    CONSTANTS.packageName,
    CONSTANTS.platform,
    CONSTANTS.appVersion,
    CONSTANTS.channel,
    CONSTANTS.assetPackageName
  );
}

function getStateFilePath() {
  return process.env.PULZZ_STATE_PATH || path.join(ROOT, 'data', 'state.json');
}

function getUploadRoot() {
  return getPublishBasePath();
}

function getPublishBasePath() {
  return path.join(CDN_ROOT, getHotupdatePrefixRoot());
}

function getPublishTarget(version) {
  return path.join(getPublishBasePath(), String(version));
}

module.exports = {
  ROOT,
  APP_ROOT,
  CDN_ROOT,
  getAssetsPrefixRoot,
  getHotupdatePrefixRoot,
  getLegacyHotupdatePrefixRoot,
  getStreamingAssetsSegment,
  CONSTANTS,
  shouldUseStreamingAssetsRoot,
  getStateFilePath,
  getUploadRoot,
  getPublishBasePath,
  getPublishTarget
};
