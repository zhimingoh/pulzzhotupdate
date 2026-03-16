const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { loadManifest, validateManifest } = require('../src/lib/manifest');

test('validateManifest returns normalized manifest when all required fields are present', () => {
  const manifest = validateManifest({
    version: '151',
    appVersion: '1.0.0',
    packageName: 'com.Kaukei.Game',
    platform: 'WebGLWxMiniGame',
    channel: 'WxMiniGame',
    assetPackageName: 'DefaultPackage',
    rootPath: 'https://cdn.example.com/hotupdate/StreamingAssets'
  });

  assert.deepEqual(manifest, {
    version: '151',
    appVersion: '1.0.0',
    packageName: 'com.Kaukei.Game',
    platform: 'WebGLWxMiniGame',
    channel: 'WxMiniGame',
    assetPackageName: 'DefaultPackage',
    rootPath: 'https://cdn.example.com/hotupdate/StreamingAssets'
  });
});

test('loadManifest reads and validates manifest from HOTUPDATE_MANIFEST_PATH', async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulzz-manifest-'));
  const manifestPath = path.join(tempRoot, 'latest.json');

  try {
    await fs.writeFile(
      manifestPath,
      JSON.stringify({
        version: '151',
        appVersion: '1.0.0',
        packageName: 'com.Kaukei.Game',
        platform: 'WebGLWxMiniGame',
        channel: 'WxMiniGame',
        assetPackageName: 'DefaultPackage',
        rootPath: 'https://cdn.example.com/hotupdate/StreamingAssets'
      }),
      'utf8'
    );

    process.env.HOTUPDATE_MANIFEST_PATH = manifestPath;

    const manifest = await loadManifest();

    assert.equal(manifest.version, '151');
    assert.equal(manifest.packageName, 'com.Kaukei.Game');
    assert.equal(manifest.rootPath, 'https://cdn.example.com/hotupdate/StreamingAssets');
  } finally {
    delete process.env.HOTUPDATE_MANIFEST_PATH;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('loadManifest reads and validates manifest from HOTUPDATE_MANIFEST_URL', async () => {
  const manifestPayload = JSON.stringify({
    version: '151',
    appVersion: '1.0.0',
    packageName: 'com.Kaukei.Game',
    platform: 'WebGLWxMiniGame',
    channel: 'WxMiniGame',
    assetPackageName: 'DefaultPackage',
    rootPath: 'https://cdn.example.com/hotupdate/StreamingAssets'
  });

  const server = http.createServer((request, response) => {
    if (request.url !== '/latest.json') {
      response.writeHead(404).end();
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(manifestPayload);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    process.env.HOTUPDATE_MANIFEST_URL = `http://127.0.0.1:${port}/latest.json`;

    const manifest = await loadManifest(undefined);

    assert.equal(manifest.version, '151');
    assert.equal(manifest.packageName, 'com.Kaukei.Game');
    assert.equal(manifest.rootPath, 'https://cdn.example.com/hotupdate/StreamingAssets');
  } finally {
    delete process.env.HOTUPDATE_MANIFEST_URL;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
