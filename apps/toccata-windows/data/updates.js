'use strict';

// The Windows channel belongs to this port; macOS assets are never executable updates.
const LATEST_RELEASE = 'https://api.github.com/repos/WenNinghan/Toccata-Windows/releases?per_page=30';
const RELEASE_PATH = '/WenNinghan/Toccata-Windows/releases/';

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value.trim());
  if (!match) return null;
  const numbers = match.slice(1, 4).map(Number);
  if (!numbers.every(Number.isSafeInteger)) return null;
  const prerelease = match[4] ? match[4].split('.') : [];
  if (prerelease.some(part => /^\d+$/.test(part) && (part.length > 1 && part.startsWith('0') || !Number.isSafeInteger(Number(part))))) return null;
  return { major:numbers[0], minor:numbers[1], patch:numbers[2], prerelease };
}

function compareVersions(left, right) {
  const a = typeof left === 'string' ? parseVersion(left) : left;
  const b = typeof right === 'string' ? parseVersion(right) : right;
  if (!a || !b) throw new TypeError('Invalid semantic version');
  for (const part of ['major','minor','patch']) if (a[part] !== b[part]) return a[part] < b[part] ? -1 : 1;
  if (!a.prerelease.length || !b.prerelease.length) return a.prerelease.length ? -1 : b.prerelease.length ? 1 : 0;
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    if (a.prerelease[i] === undefined) return -1;
    if (b.prerelease[i] === undefined) return 1;
    const x = a.prerelease[i], y = b.prerelease[i];
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) < Number(y) ? -1 : 1;
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function repositoryUrl(value, pathPrefix) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.port) return null;
    const decoded = decodeURIComponent(url.pathname);
    if (!decoded.startsWith(pathPrefix) || decoded.includes('\\') || url.search || url.hash) return null;
    return { url:url.href, decoded };
  } catch (_) { return null; }
}

function parseRelease(release) {
  if (!release || typeof release !== 'object' || release.draft === true) return null;
  const legacy = /^windows-preview-\d{8}$/.test(release.tag_name||'');
  const version = parseVersion(legacy?'0.1.0':release.tag_name);
  if (!version || !Array.isArray(release.assets)) return null;
  const tag = release.tag_name.trim();
  const releaseLink = repositoryUrl(release.html_url, RELEASE_PATH + 'tag/' + tag);
  const assets = [];
  for (const asset of release.assets) {
    if (!asset || typeof asset.name !== 'string' || /[\\/\x00-\x1f]/.test(asset.name)) continue;
    const compatible=/\.(exe|msi)$/i.test(asset.name)||(/toccata.*windows.*x64\.zip$/i.test(asset.name)&&!/(source|arm64|ia32)/i.test(asset.name));
    const checksum=/^SHA256SUMS\.txt$/i.test(asset.name)||/\.zip\.sha256$/i.test(asset.name);
    if(!compatible&&!checksum)continue;
    if (asset.state != null && asset.state !== 'uploaded') continue;
    const assetPrefix = RELEASE_PATH + 'download/' + tag + '/';
    const link = repositoryUrl(asset.browser_download_url, assetPrefix);
    if (!link || link.decoded.slice(assetPrefix.length) !== asset.name) continue;
    assets.push({ name:asset.name, url:link.url, size:Number.isSafeInteger(asset.size)?asset.size:null, digest:typeof asset.digest==='string'&&/^sha256:[a-f0-9]{64}$/i.test(asset.digest)?asset.digest.toLowerCase():null, checksum });
  }
  return {
    version:legacy?'0.1.0':tag,
    tag,
    release_url:releaseLink?.decoded === RELEASE_PATH + 'tag/' + tag ? releaseLink.url : null,
    assets:assets.filter(a=>!a.checksum),
    checksum:assets.find(a=>a.checksum)||null,
  };
}

/** Explicit user action only. The caller supplies currentVersion and may inject
 * fetchImpl for tests. Always returns a status suitable for display. */
async function checkForUpdates({ currentVersion, fetchImpl = globalThis.fetch } = {}) {
  if (!parseVersion(currentVersion)) return { status:'error', reason:'invalid-current-version' };
  if (typeof fetchImpl !== 'function') return { status:'error', reason:'network-unavailable' };
  try {
    const response = await fetchImpl(LATEST_RELEASE, {
      headers:{ Accept:'application/vnd.github+json' },
      signal:AbortSignal.timeout(10000),
    });
    if (!response || response.ok !== true) return { status:'error', reason:'http-error', http_status:response?.status ?? null };
    const body=await response.json();
    const release=(Array.isArray(body)?body:[body]).map(parseRelease).filter(Boolean).sort((a,b)=>compareVersions(b.version,a.version))[0];
    if (!release) return { status:'error', reason:'invalid-release' };
    const zip=release.assets.find(a=>a.name.toLowerCase().endsWith('.zip'));
    const base = { current_version:currentVersion, version:release.version, release_url:release.release_url, assets:release.assets, checksum:release.checksum, can_download:!!zip&&!!(zip.digest||release.checksum) };
    if (release.assets.length === 0) return { status:'no-windows-asset', ...base };
    if (compareVersions(release.version, currentVersion) <= 0) return { status:'up-to-date', ...base };
    return { status:'update-available', ...base };
  } catch (error) {
    return { status:'error', reason:error?.name === 'TimeoutError' ? 'timeout' : 'network-error' };
  }
}

module.exports = { LATEST_RELEASE, parseVersion, compareVersions, parseRelease, checkForUpdates };
