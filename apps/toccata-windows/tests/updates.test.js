'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LATEST_RELEASE, parseVersion, compareVersions, parseRelease, checkForUpdates } = require('../data/updates');

function release(tag, names) {
  return {
    tag_name:tag, draft:false, prerelease:false,
    html_url:`https://github.com/WenNinghan/Toccata-Windows/releases/tag/${tag}`,
    assets:names.map(name => ({ name, state:'uploaded',
      browser_download_url:`https://github.com/WenNinghan/Toccata-Windows/releases/download/${tag}/${encodeURIComponent(name)}` })),
  };
}
const response = body => async (url, opts) => {
  assert.equal(url, LATEST_RELEASE);
  assert.equal(opts.headers.Accept, 'application/vnd.github+json');
  return { ok:true, json:async () => body };
};

test('version comparison handles patch, v prefix, prerelease and build metadata', () => {
  assert.equal(compareVersions('v0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('1.0.0-beta.11', '1.0.0-beta.2'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(compareVersions('1.0.0+aaa', '1.0.0+bbb'), 0);
  assert.equal(parseVersion('1.2'), null);
  assert.equal(parseVersion('1.0.0-01'), null);
});

test('newer macOS-only release is never offered as a Windows update', async () => {
  const result = await checkForUpdates({ currentVersion:'0.1.0', fetchImpl:response(release('v0.2.0', ['Toccata-arm64.dmg', 'hash.txt'])) });
  assert.equal(result.status, 'no-windows-asset');
  assert.equal(result.version, 'v0.2.0');
  assert.deepEqual(result.assets, []);
});

test('newer release offers exe and msi without downloading them', async () => {
  let requests = 0;
  const source = response(release('v1.0.0', ['Toccata Setup.exe','Toccata.msi','Toccata.dmg']));
  const result = await checkForUpdates({ currentVersion:'0.1.0', fetchImpl:async (...args) => { requests++; return source(...args); } });
  assert.equal(result.status, 'update-available');
  assert.equal(requests, 1);
  assert.deepEqual(result.assets.map(a => a.name), ['Toccata Setup.exe', 'Toccata.msi']);
  assert.ok(result.assets[0].url.endsWith('Toccata%20Setup.exe'));
  assert.ok(result.release_url.endsWith('/tag/v1.0.0'));
});

test('same or older release reports up-to-date only when Windows assets exist', async () => {
  for (const tag of ['v0.1.0', 'v0.0.9']) {
    const result = await checkForUpdates({ currentVersion:'0.1.0', fetchImpl:response(release(tag, ['Toccata.msi'])) });
    assert.equal(result.status, 'up-to-date');
  }
});

test('macOS-only release never implies a Windows latest version even if tag is the same or older', async () => {
  for (const tag of ['v0.1.0', 'v0.0.9']) {
    const result = await checkForUpdates({ currentVersion:'0.1.0', fetchImpl:response(release(tag, ['Toccata.dmg'])) });
    assert.equal(result.status, 'no-windows-asset');
    assert.deepEqual(result.assets, []);
  }
});

test('rejects untrusted URL, wrong tag, draft or unpublished asset', () => {
  const r = release('v1.0.0', ['valid.exe', 'bad.exe', 'not-uploaded.msi', 'wrong-tag.exe', 'evil.exe']);
  r.assets[1].browser_download_url = 'https://example.org/bad.exe';
  r.assets[2].state = 'new';
  r.assets[3].browser_download_url = 'https://github.com/WenNinghan/Toccata-Windows/releases/download/v0.9.0/wrong-tag.exe';
  r.assets[4].browser_download_url = 'https://github.com/attacker/Toccata/releases/download/v1.0.0/evil.exe';
  assert.deepEqual(parseRelease(r).assets.map(a => a.name), ['valid.exe']);
  assert.equal(parseRelease({ ...r, draft:true }), null);
  assert.ok(parseRelease({ ...r, prerelease:true }), 'Windows preview channel supports prereleases');
});

test('network, HTTP, invalid version and invalid response errors become explicit statuses', async () => {
  assert.deepEqual(await checkForUpdates({ currentVersion:'bad', fetchImpl:response({}) }), { status:'error', reason:'invalid-current-version' });
  assert.deepEqual(await checkForUpdates({ currentVersion:'1.0.0', fetchImpl:async () => { throw new Error('offline'); } }), { status:'error', reason:'network-error' });
  assert.deepEqual(await checkForUpdates({ currentVersion:'1.0.0', fetchImpl:async () => ({ ok:false,status:403 }) }), { status:'error',reason:'http-error',http_status:403 });
  assert.deepEqual(await checkForUpdates({ currentVersion:'1.0.0', fetchImpl:response({ tag_name:'not-semver', assets:[] }) }), { status:'error',reason:'invalid-release' });
});
