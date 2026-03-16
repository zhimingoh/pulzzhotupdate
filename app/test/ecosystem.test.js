const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('ecosystem config uses HOTUPDATE_MANIFEST_URL from environment when provided', () => {
  process.env.HOTUPDATE_MANIFEST_URL = 'https://cdn.kaukei.icu/hotupdate/latest.json';
  process.env.HOST = '127.0.0.9';
  process.env.PORT = '29999';

  try {
    const configPath = path.resolve(__dirname, '..', 'ecosystem.config.js');
    delete require.cache[configPath];
    const config = require(configPath);
    const env = config.apps[0].env;

    assert.equal(env.HOTUPDATE_MANIFEST_URL, 'https://cdn.kaukei.icu/hotupdate/latest.json');
    assert.equal(env.HOST, '127.0.0.9');
    assert.equal(env.PORT, '29999');
  } finally {
    delete process.env.HOTUPDATE_MANIFEST_URL;
    delete process.env.HOST;
    delete process.env.PORT;
  }
});
