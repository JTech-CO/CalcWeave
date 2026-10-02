import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';

export interface OfflineAsset { url: string; sha256: string; bytes: number }
export interface OfflineManifest { schemaVersion: 1; appVersion: string; engineVersion: string; releaseId: string; scope: '/'; assets: OfflineAsset[] }
export const OFFLINE_CACHE_PREFIX = 'calcweave-static-v1-';
export const OFFLINE_ASSET_PATH = /^\/(?:index\.html|(?:terms|privacy|cookies|notices)\/index\.html|assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:js|css|svg|png|jpg|jpeg|webp|ico|woff|woff2))$/;
const offlineHash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

/** Final build bytes only: model data and arbitrary runtime URLs never enter this list. */
export function createOfflineManifest(files: Readonly<Record<string, string | Uint8Array>>, versions: { appVersion: string; engineVersion: string }): OfflineManifest {
  if (!/^\d+\.\d+\.\d+$/.test(versions.appVersion) || !/^\d+\.\d+\.\d+-m\d+$/.test(versions.engineVersion)) throw new Error('Invalid offline release versions.');
  const assets = Object.entries(files).map(([name, source]) => {
    const url = `/${name}`;
    if (!OFFLINE_ASSET_PATH.test(url) || url.includes('..')) throw new Error(`Unsupported offline build asset: ${name}`);
    const bytes = typeof source === 'string' ? Buffer.from(source, 'utf8') : source;
    return { url, bytes: bytes.byteLength, sha256: offlineHash(bytes) };
  }).sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
  if (!assets.some(asset => asset.url === '/index.html') || assets.length > 128 || assets.reduce((total, asset) => total + asset.bytes, 0) > 32 * 1024 * 1024) throw new Error('Offline shell assets are missing or exceed the bounded release size.');
  const meaning = { schemaVersion: 1 as const, ...versions, scope: '/' as const, assets };
  return { ...meaning, releaseId: offlineHash(JSON.stringify(meaning)) };
}

/** Repository-owned fixed SW; manifest entries are validated build data, never user syntax. */
export function generateOfflineWorker(manifest: OfflineManifest): string {
  return `/* CalcWeave static release ${manifest.releaseId}. No model, runtime URL or external response caching. */
const RELEASE = ${JSON.stringify(manifest)};
const PREFIX = ${JSON.stringify(OFFLINE_CACHE_PREFIX)};
const CACHE = PREFIX + RELEASE.releaseId;
const ORIGIN = self.location.origin;
const MANIFEST_URL = ORIGIN + '/offline-manifest.json';
const ASSET_PATH = ${OFFLINE_ASSET_PATH.toString()};
const hex = bytes => Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2,'0')).join('');
const validAsset = asset => asset && typeof asset.url==='string' && ASSET_PATH.test(asset.url) && !asset.url.includes('..') && /^[a-f0-9]{64}$/.test(asset.sha256) && Number.isSafeInteger(asset.bytes) && asset.bytes>=0;
const validManifest = value => value && value.schemaVersion===1 && value.scope==='/' && /^[a-f0-9]{64}$/.test(value.releaseId) && Array.isArray(value.assets) && value.assets.length<=128 && value.assets.every(validAsset) && new Set(value.assets.map(asset=>asset.url)).size===value.assets.length;
async function verified(response, asset) {
  if (!response || response.status!==200 || response.redirected || response.type==='opaque' || response.type==='opaqueredirect') throw new Error('Offline asset response rejected: '+asset.url);
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength!==asset.bytes || hex(await crypto.subtle.digest('SHA-256',bytes))!==asset.sha256) throw new Error('Offline asset digest mismatch: '+asset.url);
  return response;
}
async function cachedManifest(cache) {
  const response=await cache.match(MANIFEST_URL);
  if (!response) return null;
  try { const value=await response.json(); return validManifest(value)?value:null; } catch { return null; }
}
async function verifyCache(cache, manifest) {
  const marker=await cachedManifest(cache);
  if (!marker || marker.releaseId!==manifest.releaseId) throw new Error('Incomplete offline release.');
  for (const asset of manifest.assets) await verified(await cache.match(ORIGIN+asset.url),asset);
}
async function notify(type, message) {
  for (const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})) client.postMessage({type,releaseId:RELEASE.releaseId,message});
}
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const existing=await caches.has(CACHE);
    const cache=await caches.open(CACHE);
    if (existing) { await verifyCache(cache,RELEASE); return; }
    try {
      for (const asset of RELEASE.assets) {
        const response=await fetch(ORIGIN+asset.url,{cache:'no-store',credentials:'same-origin',redirect:'error'});
        await cache.put(ORIGIN+asset.url,await verified(response,asset));
      }
      // Write the marker last. Other active releases never use a partial cache.
      await cache.put(MANIFEST_URL,new Response(JSON.stringify(RELEASE),{headers:{'Content-Type':'application/json;charset=utf-8'}}));
      await verifyCache(cache,RELEASE);
    } catch(error) {
      await caches.delete(CACHE);
      await notify('OFFLINE_INSTALL_FAILED',String(error));
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  // Keep previous verified static releases for old tabs' not-yet-loaded chunks.
  // No skipWaiting here or in install: activation requires an explicit saved update.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  const data=event.data, source=event.source;
  if (!source || source.type!=='window' || new URL(source.url).origin!==ORIGIN || !data || typeof data!=='object') return;
  const reply=value=>event.ports[0]?.postMessage(value);
  if (data.type==='GET_RELEASE') event.waitUntil((async()=>{
    try { await verifyCache(await caches.open(CACHE),RELEASE); reply({type:'OFFLINE_RELEASE',manifest:RELEASE}); }
    catch { reply({type:'OFFLINE_UNAVAILABLE'}); }
  })());
  if (data.type==='ACTIVATE_RELEASE' && data.releaseId===RELEASE.releaseId) event.waitUntil((async()=>{
    await verifyCache(await caches.open(CACHE),RELEASE);
    reply({type:'OFFLINE_ACTIVATING',releaseId:RELEASE.releaseId});
    await self.skipWaiting();
  })());
});
self.addEventListener('fetch', event => {
  const request=event.request, url=new URL(request.url);
  if (request.method!=='GET' || url.origin!==ORIGIN || url.search || request.headers.has('range')) return;
  const policy=['terms','privacy','cookies','notices'].find(name=>url.pathname==='/'+name || url.pathname==='/'+name+'/');
  const path=request.mode==='navigate' && (url.pathname==='/' || url.pathname==='/index.html')?'/index.html':request.mode==='navigate' && policy?'/'+policy+'/index.html':url.pathname;
  if (path!=='/offline-manifest.json' && !ASSET_PATH.test(path)) return;
  event.respondWith((async()=>{
    const current=await caches.open(CACHE);
    if (path==='/offline-manifest.json') {
      const marker=await cachedManifest(current);
      return marker?.releaseId===RELEASE.releaseId?new Response(JSON.stringify(RELEASE),{headers:{'Content-Type':'application/json;charset=utf-8'}}):new Response('Offline release unavailable',{status:503});
    }
    // Current shell is always one release; old chunks are addressed by immutable paths.
    const names=[CACHE,...(await caches.keys()).filter(name=>name.startsWith(PREFIX) && name!==CACHE)];
    for (const name of names) {
      if (path.endsWith('/index.html') && name!==CACHE) continue;
      const cache=await caches.open(name), stored=await cachedManifest(cache);
      const marker=name===CACHE?(stored?.releaseId===RELEASE.releaseId?RELEASE:null):stored;
      const asset=marker?.assets.find(item=>item.url===path);
      if (!asset) continue;
      const response=await cache.match(ORIGIN+path);
      if (response) { try { return await verified(response,asset); } catch { return new Response('Offline asset integrity failure',{status:503}); } }
      // Recover an evicted static asset only with the exact approved digest; never runtime-cache it.
      try { return await verified(await fetch(ORIGIN+path,{cache:'no-store',credentials:'same-origin',redirect:'error'}),asset); } catch { return new Response('Offline asset unavailable',{status:503}); }
    }
    // Static-looking but unlisted paths are outside the cache boundary.
    return fetch(request);
  })());
});
`;
}

/** Read final on-disk build bytes; pre-render chunk snapshots are insufficient. */
export async function writeOfflineRelease(outputDirectory: string, fileNames: string[], versions: { appVersion: string; engineVersion: string }): Promise<OfflineManifest> {
  const files: Record<string, Uint8Array> = {};
  for (const name of fileNames) {
    if (!OFFLINE_ASSET_PATH.test(`/${name}`) || name.includes('..')) throw new Error(`Unsupported offline build asset: ${name}`);
    files[name] = await readFile(join(outputDirectory, name));
  }
  for (const policy of ['terms', 'privacy', 'cookies', 'notices']) {
    try { files[`${policy}/index.html`] = await readFile(join(outputDirectory, policy, 'index.html')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  const manifest = createOfflineManifest(files, versions);
  await writeFile(join(outputDirectory, 'offline-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(outputDirectory, 'sw.js'), generateOfflineWorker(manifest));
  return manifest;
}

export function calcWeaveOfflinePlugin(versions: { appVersion: string; engineVersion: string } = { appVersion: '0.6.0', engineVersion: '0.6.0-m6' }): Plugin {
  let outputDirectory = '';
  return {
    name: 'calcweave-verified-offline-release', apply: 'build', enforce: 'post',
    configResolved(config) { if (config.base !== '/') throw new Error('CalcWeave offline release currently supports only public root base="/".'); outputDirectory = resolve(config.root, config.build.outDir); },
    async writeBundle(_options, bundle) {
      // Rolldown/Vite can replace asset references after generateBundle. The
      // installation digest must describe the bytes that were actually written.
      await writeOfflineRelease(outputDirectory, Object.keys(bundle), versions);
    },
  };
}
