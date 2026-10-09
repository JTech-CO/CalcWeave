import { APP_VERSION } from '../../../packages/release/src';
import { ENGINE_VERSION } from '../../../packages/model/src';
import { parseDeploymentBase } from '../../../scripts/pages-base';
import { appResourcePath, getAppBasePath } from './app-path';
export const OFFLINE_APP_VERSION = APP_VERSION;
export const OFFLINE_ENGINE_VERSION = ENGINE_VERSION;
export interface OfflineStatus {
  phase: 'disabled' | 'installing' | 'ready' | 'update-ready' | 'reload-ready' | 'error';
  online: boolean; offlineReady: boolean; appVersion: string; engineVersion: string;
  releaseId?: string; activeAppVersion?: string; activeEngineVersion?: string;
  waitingReleaseId?: string; waitingAppVersion?: string; waitingEngineVersion?: string; message?: string;
}
export interface OfflineController {
  getStatus(): OfflineStatus;
  checkForUpdate(): Promise<void>;
  applyUpdate(save: () => Promise<void>): Promise<void>;
  dispose(): void;
}
export function canRegisterOffline(environment: { production: boolean; secure: boolean; protocol: string; hostname: string; base: string }): boolean {
  const local = environment.hostname === 'localhost' || environment.hostname === '127.0.0.1' || environment.hostname === '[::1]';
  try { parseDeploymentBase(environment.base); } catch { return false; }
  return environment.production && environment.secure && (environment.protocol === 'https:' || environment.protocol === 'http:' && local);
}
type ReleaseReply = { type: 'OFFLINE_RELEASE'; manifest: { releaseId: string; appVersion: string; engineVersion: string } };
function offlineRequest(worker: ServiceWorker, data: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel(), timeout = setTimeout(() => { channel.port1.close(); reject(new Error('오프라인 릴리스 확인 시간이 초과됐습니다.')); }, 5_000);
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data); };
    try { worker.postMessage(data, [channel.port2]); }
    catch (error) { clearTimeout(timeout); channel.port1.close(); channel.port2.close(); reject(error); }
  });
}
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function offlineRelease(reply: unknown): ReleaseReply['manifest'] {
  const manifest = isRecord(reply) && isRecord(reply.manifest) ? reply.manifest : undefined;
  if (!isRecord(reply) || reply.type !== 'OFFLINE_RELEASE' || !manifest
    || typeof manifest.releaseId !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.releaseId)
    || typeof manifest.appVersion !== 'string' || manifest.appVersion.length > 64 || !/^\d+\.\d+\.\d+$/.test(manifest.appVersion)
    || typeof manifest.engineVersion !== 'string' || manifest.engineVersion.length > 64 || !/^\d+\.\d+\.\d+-(?:m\d+|catalog)$/.test(manifest.engineVersion)) throw new Error('완전한 오프라인 릴리스를 확인하지 못했습니다.');
  return { releaseId: manifest.releaseId, appVersion: manifest.appVersion, engineVersion: manifest.engineVersion };
}

/** Production app scope only. IndexedDB/model data remains outside the SW cache. */
export async function registerOfflineSupport(onStatus: (status: OfflineStatus) => void = () => {}): Promise<OfflineController> {
  let status: OfflineStatus = { phase: 'disabled', online: navigator.onLine, offlineReady: false, appVersion: OFFLINE_APP_VERSION, engineVersion: OFFLINE_ENGINE_VERSION };
  let registration: ServiceWorkerRegistration | undefined, disposed = false, applying = false, savingUpdate = false;
  let documentReleaseId: string | undefined, refreshGeneration = 0, lastCheckAt = 0, checking: Promise<void> | undefined;
  const cleanups: (() => void)[] = [];
  const publish = (next: Partial<OfflineStatus>): void => { status = { ...status, ...next }; if (!disposed) onStatus({ ...status }); };
  const error = (cause: unknown): void => publish({ phase: 'error', message: cause instanceof Error ? cause.message : String(cause) });
  const differsFromDocument = (release: ReleaseReply['manifest']): boolean => release.appVersion !== OFFLINE_APP_VERSION || release.engineVersion !== OFFLINE_ENGINE_VERSION || !!documentReleaseId && release.releaseId !== documentReleaseId;
  const automaticCheck = (): void => {
    if (disposed || !registration || !navigator.onLine || (typeof document !== 'undefined' && document.visibilityState === 'hidden') || Date.now() - lastCheckAt < 30_000) return;
    void controller.checkForUpdate();
  };
  const connection = (): void => { publish({ online: navigator.onLine }); if (navigator.onLine) automaticCheck(); };
  window.addEventListener('online', connection); window.addEventListener('offline', connection); window.addEventListener('focus', automaticCheck);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', automaticCheck);
  cleanups.push(() => {
    window.removeEventListener('online', connection); window.removeEventListener('offline', connection); window.removeEventListener('focus', automaticCheck);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', automaticCheck);
  });
  const controller: OfflineController = {
    getStatus: () => ({ ...status }),
    async checkForUpdate() {
      if (disposed || !registration) return;
      if (checking) return checking;
      lastCheckAt = Date.now();
      checking = (async () => { try { await registration.update(); await refresh(); } catch (cause) { error(cause); } })();
      try { await checking; } finally { checking = undefined; }
    },
    async applyUpdate(save) {
      if (disposed || savingUpdate || applying) throw new Error('업데이트 적용 상태를 확인해 주세요.');
      savingUpdate = true;
      try {
        const waiting = registration?.waiting, worker = waiting ?? registration?.active;
        if (!worker) throw new Error('적용할 오프라인 업데이트가 없습니다.');
        const release = offlineRelease(await offlineRequest(worker, { type: 'GET_RELEASE' }));
        if (!waiting && !differsFromDocument(release)) throw new Error('현재 앱이 이미 최신 릴리스입니다.');
        await save();
        if (disposed || (waiting ? registration?.waiting !== waiting : registration?.waiting || registration?.active !== worker)) throw new Error('업데이트가 바뀌었습니다. 다시 확인한 뒤 적용해 주세요.');
        if (!waiting) { location.reload(); return; }
        applying = true;
        const reply = await offlineRequest(waiting, { type: 'ACTIVATE_RELEASE', releaseId: release.releaseId });
        if (!isRecord(reply) || reply.type !== 'OFFLINE_ACTIVATING' || reply.releaseId !== undefined && reply.releaseId !== release.releaseId) throw new Error('업데이트 활성화를 확인하지 못했습니다.');
      } catch (cause) { applying = false; error(cause); throw cause; }
      finally { savingUpdate = false; }
    },
    dispose() { disposed = true; cleanups.forEach(cleanup => cleanup()); },
  };
  onStatus({ ...status });
  const appBase = getAppBasePath();
  if (!('serviceWorker' in navigator) || !canRegisterOffline({ production: import.meta.env?.PROD ?? false, secure: window.isSecureContext, protocol: location.protocol, hostname: location.hostname, base: appBase })) return controller;
  publish({ phase: 'installing' });
  async function refresh(): Promise<void> {
    if (disposed || !registration) return;
    const generation = ++refreshGeneration, active = registration.active, waiting = registration.waiting;
    let verifiedActive = false;
    try {
      const release = active ? offlineRelease(await offlineRequest(active, { type: 'GET_RELEASE' })) : undefined;
      verifiedActive = !!release;
      const next = waiting && active ? offlineRelease(await offlineRequest(waiting, { type: 'GET_RELEASE' })) : undefined;
      if (disposed || generation !== refreshGeneration) return;
      if (registration.active !== active || registration.waiting !== waiting) { void refresh(); return; }
      if (!documentReleaseId && release && release.appVersion === OFFLINE_APP_VERSION && release.engineVersion === OFFLINE_ENGINE_VERSION) documentReleaseId = release.releaseId;
      publish({ offlineReady: !!release, releaseId: release?.releaseId, activeAppVersion: release?.appVersion, activeEngineVersion: release?.engineVersion,
        waitingReleaseId: next?.releaseId, waitingAppVersion: next?.appVersion, waitingEngineVersion: next?.engineVersion,
        phase: next ? 'update-ready' : release && differsFromDocument(release) ? 'reload-ready' : registration.installing ? 'installing' : release ? 'ready' : 'installing', message: undefined });
    } catch (cause) { if (!disposed && generation === refreshGeneration) { publish({ offlineReady: verifiedActive }); error(cause); } }
  }
  const changed = (): void => { if (applying) { applying = false; location.reload(); } else void refresh(); };
  navigator.serviceWorker.addEventListener('controllerchange', changed);
  cleanups.push(() => navigator.serviceWorker.removeEventListener('controllerchange', changed));
  try {
    registration = await navigator.serviceWorker.register(appResourcePath('/sw.js', appBase), { scope: appBase, updateViaCache: 'none' });
    lastCheckAt = Date.now();
    const watch = (worker: ServiceWorker): void => {
      const stateChanged = (): void => { if (worker.state === 'redundant') error(new Error('업데이트 설치에 실패했습니다. 기존 릴리스는 유지됩니다.')); else if (worker.state === 'installed' || worker.state === 'activated') void refresh(); };
      worker.addEventListener('statechange', stateChanged); cleanups.push(() => worker.removeEventListener('statechange', stateChanged));
    };
    const found = (): void => { if (registration?.installing) { publish({ phase: 'installing' }); watch(registration.installing); } };
    registration.addEventListener('updatefound', found); cleanups.push(() => registration?.removeEventListener('updatefound', found));
    if (registration.installing) watch(registration.installing);
    await refresh();
  } catch (cause) { error(cause); }
  return controller;
}
