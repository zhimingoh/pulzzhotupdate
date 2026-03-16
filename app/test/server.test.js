const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const FIXED_ADMIN_PASSWORD = 'shaar008';

function adminAuthHeader(password, username = 'admin') {
  const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function buildMultipart(fields, file) {
  const boundary = `----pulzz-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const parts = [];

  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }

  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: application/zip\r\n\r\n`
      )
    );
    parts.push(file.content);
    parts.push(Buffer.from('\r\n'));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

async function setupApp(options = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulzz-test-'));
  const appRoot = path.join(tempRoot, 'app');

  process.env.PULZZ_ROOT = tempRoot;
  process.env.PULZZ_APP_ROOT = appRoot;
  process.env.PULZZ_CDN_ROOT = path.join(tempRoot, 'cdn');
  process.env.PULZZ_STATE_PATH = path.join(appRoot, 'config', 'state.json');
  process.env.STORAGE_DRIVER = options.storageDriver || 'local';
  process.env.PULZZ_COS_MOCK_ROOT = options.cosMockRoot || '';
  process.env.ADMIN_PASSWORD = options.adminPassword || '';
  process.env.ADMIN_USERNAME = options.adminUsername || '';
  if (Object.hasOwn(options, 'cdnRootPath')) {
    process.env.CDN_ROOT_PATH = String(options.cdnRootPath || '');
  } else {
    delete process.env.CDN_ROOT_PATH;
  }
  if (Object.hasOwn(options, 'cdnAppendStreamingAssets')) {
    process.env.CDN_APPEND_STREAMING_ASSETS = String(options.cdnAppendStreamingAssets);
  } else {
    delete process.env.CDN_APPEND_STREAMING_ASSETS;
  }
  if (Object.hasOwn(options, 'cdnStreamingSegment')) {
    process.env.CDN_STREAMING_SEGMENT = String(options.cdnStreamingSegment || '');
  } else {
    delete process.env.CDN_STREAMING_SEGMENT;
  }

  delete require.cache[require.resolve('../src/lib/paths')];
  delete require.cache[require.resolve('../src/lib/state')];
  delete require.cache[require.resolve('../src/lib/lock')];
  delete require.cache[require.resolve('../src/lib/response')];
  delete require.cache[require.resolve('../src/lib/storage')];
  delete require.cache[require.resolve('../src/server')];
  const { createServer } = require('../src/server');
  const app = await createServer();

  return {
    app,
    tempRoot,
    cleanup: async () => {
      await app.close();
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  };
}

test('client api returns fixed app version', async () => {
  const ctx = await setupApp();
  try {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/GameAppVersion/GetVersion', payload: { AppVersion: '9.9.9' } });
    assert.equal(res.statusCode, 200);
    const json = res.json();
    assert.equal(json.Code, 0);
    const data = JSON.parse(json.Data);
    assert.equal(data.AppVersion, '1.0.0');
    assert.equal(data.PackageName, 'com.Kaukei.Game');
  } finally {
    await ctx.cleanup();
  }
});

test('global info api returns check urls for startup flow', async () => {
  const ctx = await setupApp();
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/GameGlobalInfo/GetInfo',
      headers: { host: 'api.kaukei.com' }
    });
    assert.equal(res.statusCode, 200);
    const json = res.json();
    assert.equal(json.Code, 0);
    const data = JSON.parse(json.Data);
    assert.equal(data.CheckAppVersionUrl, 'https://api.kaukei.com/api/GameAppVersion/GetVersion');
    assert.equal(data.CheckResourceVersionUrl, 'https://api.kaukei.com/api/GameAssetPackageVersion/GetVersion');
  } finally {
    await ctx.cleanup();
  }
});

test('asset package version api returns version and root path', async () => {
  const ctx = await setupApp();
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/GameAssetPackageVersion/GetVersion',
      headers: { host: 'api.kaukei.com' }
    });
    assert.equal(res.statusCode, 200);
    const json = res.json();
    assert.equal(json.Code, 0);
    const data = JSON.parse(json.Data);
    assert.equal(data.Version, '0');
    assert.equal(data.PackageName, 'com.Kaukei.Game');
    assert.equal(data.RootPath, 'https://cdn.kaukei.com/hotupdate/StreamingAssets');
    assert.equal(data.AssetPackageName, 'DefaultPackage');
  } finally {
    await ctx.cleanup();
  }
});

test('asset package version root path can opt-out from StreamingAssets suffix', async () => {
  const ctx = await setupApp({ cdnAppendStreamingAssets: '0' });
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/GameAssetPackageVersion/GetVersion',
      headers: { host: 'api.kaukei.com' }
    });
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.json().Data);
    assert.equal(data.RootPath, 'https://cdn.kaukei.com/hotupdate');
  } finally {
    await ctx.cleanup();
  }
});

test('asset package version appends StreamingAssets for custom CDN root path', async () => {
  const ctx = await setupApp({ cdnRootPath: 'https://cdn.kaukei.com/custom-hotupdate/' });
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/GameAssetPackageVersion/GetVersion',
      headers: { host: 'api.kaukei.com' }
    });
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.json().Data);
    assert.equal(data.RootPath, 'https://cdn.kaukei.com/custom-hotupdate/StreamingAssets');
  } finally {
    await ctx.cleanup();
  }
});

test('upload invalid filename returns 4001', async () => {
  const ctx = await setupApp();
  try {
    const zip = new AdmZip();
    zip.addFile('x.txt', Buffer.from('ok'));
    const mp = buildMultipart({ platform: 'wxmini' }, { filename: 'abc.zip', content: zip.toBuffer() });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/admin/upload',
      headers: {
        'content-type': mp.contentType,
        authorization: adminAuthHeader(FIXED_ADMIN_PASSWORD, 'any-user')
      },
      payload: mp.body
    });

    assert.equal(res.statusCode, 400);
    const json = res.json();
    assert.equal(json.Code, 4001);
  } finally {
    await ctx.cleanup();
  }
});

test('register version succeeds when version exists in storage', async () => {
  const ctx = await setupApp();
  try {
    const existingVersionDir = path.join(
      ctx.tempRoot,
      'cdn/hotupdate/com.Kaukei.Game/WebGLWxMiniGame/1.0.0/WxMiniGame/DefaultPackage/112'
    );
    await fs.mkdir(existingVersionDir, { recursive: true });
    await fs.writeFile(path.join(existingVersionDir, 'manifest.json'), '{}');

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/admin/register',
      headers: {
        'content-type': 'application/json',
        authorization: adminAuthHeader(FIXED_ADMIN_PASSWORD, 'any-user')
      },
      payload: { platform: 'wxmini', version: '112' }
    });

    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.Code, 0);
    assert.equal(body.Message, 'registered');
  } finally {
    await ctx.cleanup();
  }
});

test('register version fails when version is not in storage', async () => {
  const ctx = await setupApp();
  try {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/admin/register',
      headers: {
        'content-type': 'application/json',
        authorization: adminAuthHeader(FIXED_ADMIN_PASSWORD, 'any-user')
      },
      payload: { platform: 'wxmini', version: '999' }
    });

    assert.equal(res.statusCode, 400);
    const body = res.json();
    assert.equal(body.Code, 4004);
    assert.equal(body.Message, 'version_not_found');
  } finally {
    await ctx.cleanup();
  }
});

test('admin routes require basic auth', async () => {
  const ctx = await setupApp();
  try {
    const unauth = await ctx.app.inject({
      method: 'GET',
      url: '/admin/versions?platform=wxmini'
    });
    assert.equal(unauth.statusCode, 401);

    const auth = await ctx.app.inject({
      method: 'GET',
      url: '/admin/versions?platform=wxmini',
      headers: { authorization: adminAuthHeader(FIXED_ADMIN_PASSWORD) }
    });
    assert.equal(auth.statusCode, 200);
    assert.equal(auth.json().Code, 0);
  } finally {
    await ctx.cleanup();
  }
});

test('upload then publish updates current version using streaming-assets layout', async () => {
  const ctx = await setupApp();
  try {
    const zip = new AdmZip();
    zip.addFile('100/config.json', Buffer.from('{"k":1}'));
    const mp = buildMultipart({ platform: 'wxmini' }, { filename: '100.zip', content: zip.toBuffer() });

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: '/admin/upload',
      headers: {
        'content-type': mp.contentType,
        authorization: adminAuthHeader(FIXED_ADMIN_PASSWORD, 'any-user')
      },
      payload: mp.body
    });

    assert.equal(uploadRes.statusCode, 200);
    assert.equal(uploadRes.json().Code, 0);

    const publishRes = await ctx.app.inject({
      method: 'POST',
      url: '/admin/publish',
      headers: { authorization: adminAuthHeader(FIXED_ADMIN_PASSWORD, 'any-user') },
      payload: { platform: 'wxmini', version: '100' }
    });

    assert.equal(publishRes.statusCode, 200);
    assert.equal(publishRes.json().Code, 0);

    const state = JSON.parse(await fs.readFile(path.join(ctx.tempRoot, 'app', 'config', 'state.json'), 'utf8'));
    assert.equal(state.currentVersion, '100');

    const publishedPath = path.join(
      ctx.tempRoot,
      'cdn/hotupdate/StreamingAssets/com.Kaukei.Game/WebGLWxMiniGame/1.0.0/WxMiniGame/DefaultPackage/100/config.json'
    );
    assert.equal(await fs.readFile(publishedPath, 'utf8'), '{"k":1}');
  } finally {
    await ctx.cleanup();
  }
});

test('upload with cos driver syncs files to cos mock path', async () => {
  const ctx = await setupApp({
    storageDriver: 'cos',
    cosMockRoot: path.join(os.tmpdir(), 'pulzz-cos-mock')
  });
  try {
    const zip = new AdmZip();
    zip.addFile('101/config.json', Buffer.from('{"k":2}'));
    const mp = buildMultipart({ platform: 'wxmini' }, { filename: '101.zip', content: zip.toBuffer() });

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: '/admin/upload',
      headers: {
        'content-type': mp.contentType,
        authorization: adminAuthHeader(FIXED_ADMIN_PASSWORD, 'any-user')
      },
      payload: mp.body
    });

    assert.equal(uploadRes.statusCode, 200);
    assert.equal(uploadRes.json().Code, 0);

    const uploadedCurrent = await fs.readFile(
      path.join(
        os.tmpdir(),
        'pulzz-cos-mock/hotupdate/StreamingAssets/com.Kaukei.Game/WebGLWxMiniGame/1.0.0/WxMiniGame/DefaultPackage/101/config.json'
      ),
      'utf8'
    );
    assert.equal(uploadedCurrent, '{"k":2}');
  } finally {
    await fs.rm(path.join(os.tmpdir(), 'pulzz-cos-mock'), { recursive: true, force: true });
    await ctx.cleanup();
  }
});

test('upload zip generated from directory does not create nested version folder', async () => {
  const ctx = await setupApp();
  const zipTempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pulzz-zip-'));
  try {
    const contentDir = path.join(zipTempRoot, '100');
    await fs.mkdir(contentDir, { recursive: true });
    await fs.writeFile(path.join(contentDir, 'config.json'), '{"k":3}');

    // Reproduce real operator flow: `zip -r 100.zip 100`
    execFileSync('zip', ['-rq', '100.zip', '100'], { cwd: zipTempRoot });
    const zipBuffer = await fs.readFile(path.join(zipTempRoot, '100.zip'));
    const mp = buildMultipart({ platform: 'wxmini' }, { filename: '100.zip', content: zipBuffer });

    const uploadRes = await ctx.app.inject({
      method: 'POST',
      url: '/admin/upload',
      headers: {
        'content-type': mp.contentType,
        authorization: adminAuthHeader(FIXED_ADMIN_PASSWORD, 'any-user')
      },
      payload: mp.body
    });

    assert.equal(uploadRes.statusCode, 200);
    assert.equal(uploadRes.json().Code, 0);

    const expected = path.join(
      ctx.tempRoot,
      'cdn/hotupdate/StreamingAssets/com.Kaukei.Game/WebGLWxMiniGame/1.0.0/WxMiniGame/DefaultPackage/100/config.json'
    );
    const unexpected = path.join(
      ctx.tempRoot,
      'cdn/hotupdate/StreamingAssets/com.Kaukei.Game/WebGLWxMiniGame/1.0.0/WxMiniGame/DefaultPackage/100/100/config.json'
    );
    assert.equal(await fs.readFile(expected, 'utf8'), '{"k":3}');
    assert.equal(fsSync.existsSync(unexpected), false);
  } finally {
    await fs.rm(zipTempRoot, { recursive: true, force: true });
    await ctx.cleanup();
  }
});
