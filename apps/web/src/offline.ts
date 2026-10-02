import { APP_VERSION } from '../../../packages/release/src';
import { ENGINE_VERSION } from '../../../packages/model/src';
export const OFFLINE_APP_VERSION = APP_VERSION;
export const OFFLINE_ENGINE_VERSION = ENGINE_VERSION;
export interface OfflineStatus {
  phase: 'disabled' | 'installing' | 'ready' | 'update-ready' | 'error';
  online: boolean; offlineReady: boolean; appVersion: string; engineVersion: string;
  releaseId?: string; waitingReleaseId?: string; message?: string;
}
export interface OfflineController {
  getStatus(): OfflineStatus;
  checkForUpdate(): Promise<void>;
  applyUpdate(save: () => Promise<void>): Promise<void>;
  dispose(): void;
}
export function canRegisterOffline(environment: { production: boolean; secure: boolean; protocol: string; hostname: string; base: string }): boolean {
  const local = environment.hostname === 'localhost' || environment.hostname === '127.0.0.1' || environment.hostname === '[::1]';
  return environment.production && environment.secure && environment.base === '/' && (environment.protocol === 'https:' || environment.protocol === 'http:' && local);
}
type ReleaseReply = { type: 'OFFLINE_RELEASE'; manifest: { releaseId: string; appVersion: string; engineVersion: string } };
function offlineRequest(worker: ServiceWorker, data: Record<string, string>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel(), timeout = setTimeout(() => { channel.port1.close(); reject(new Error('오프라인 릴리스 확인 시간이 초과됐습니다.')); }, 5_000);
    channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data as Record<string, unknown>); };
    try { worker.postMessage(data, [channel.port2]); }
    catch (error) { clearTimeout(timeout); channel.port1.close(); channel.port2.close(); reject(error); }
  });
}
function offlineRelease(reply: Record<string, unknown>): ReleaseReply['manifest'] {
  const manifest = reply.manifest as ReleaseReply['manifest'] | undefined;
  if (reply.type !== 'OFFLINE_RELEASE' || !manifest || !/^[a-f0-9]{64}$/.test(manifest.releaseId) || typeof manifest.appVersion !== 'string' || typeof manifest.engineVersion !== 'string') throw new Error('완전한 오프라인 릴리스를 확인하지 못했습니다.');
  return manifest;
}

/** Production root shell only. IndexedDB/model data remains outside the SW cache. */
export async function registerOfflineSupport(onStatus: (status: OfflineStatus) => void = () => {}): Promise<OfflineController> {
  let status: OfflineStatus = { phase: 'disabled', online: navigator.onLine, offlineReady: false, appVersion: OFFLINE_APP_VERSION, engineVersion: OFFLINE_ENGINE_VERSION };
  let registration: ServiceWorkerRegistration | undefined, disposed = false, applying = false;
  const cleanups: (() => void)[] = [];
  const publish = (next: Partial<OfflineStatus>): void => { status = { ...status, ...next }; if (!disposed) onStatus({ ...status }); };
  const error = (cause: unknown): void => publish({ phase: 'error', message: cause instanceof Error ? cause.message : String(cause) });
  const connection = (): void => publish({ online: navigator.onLine });
  window.addEventListener('online', connection); window.addEventListener('offline', connection);
  cleanups.push(() => { window.removeEventListener('online', connection); window.removeEventListener('offline', connection); });
  const controller: OfflineController = {
    getStatus: () => ({ ...status }),
    async checkForUpdate() { if (!registration) return; try { await registration.update(); await refresh(); } catch (cause) { error(cause); } },
    async applyUpdate(save) {
      const waiting = registration?.waiting;
      if (!waiting) throw new Error('적용할 오프라인 업데이트가 없습니다.');
      const release = offlineRelease(await offlineRequest(waiting, { type: 'GET_RELEASE' }));
      await save();
      if (registration?.waiting !== waiting) throw new Error('업데이트가 바뀌었습니다. 다시 확인한 뒤 적용해 주세요.');
      applying = true;
      try { const reply = await offlineRequest(waiting, { type: 'ACTIVATE_RELEASE', releaseId: release.releaseId }); if (reply.type !== 'OFFLINE_ACTIVATING') throw new Error('업데이트 활성화를 확인하지 못했습니다.'); }
      catch (cause) { applying = false; error(cause); throw cause; }
    },
    dispose() { disposed = true; cleanups.forEach(cleanup => cleanup()); },
  };
  onStatus({ ...status });
  if (!('serviceWorker' in navigator) || !canRegisterOffline({ production: import.meta.env.PROD, secure: window.isSecureContext, protocol: location.protocol, hostname: location.hostname, base: import.meta.env.BASE_URL })) return controller;
  publish({ phase: 'installing' });
  async function refresh(): Promise<void> {
    if (disposed || !registration) return;
    try {
      const active = registration.active;
      if (active) {
        try { const release = offlineRelease(await offlineRequest(active, { type: 'GET_RELEASE' })); publish({ offlineReady: true, releaseId: release.releaseId, phase: 'ready', message: undefined }); }
        catch (cause) { publish({ offlineReady: false }); error(cause); }
      }
      if (registration.waiting && registration.active) {
        const release = offlineRelease(await offlineRequest(registration.waiting, { type: 'GET_RELEASE' }));
        publish({ phase: 'update-ready', waitingReleaseId: release.releaseId, message: undefined });
      }
    } catch (cause) { error(cause); }
  }
  const changed = (): void => { if (applying) { applying = false; location.reload(); } else void refresh(); };
  navigator.serviceWorker.addEventListener('controllerchange', changed);
  cleanups.push(() => navigator.serviceWorker.removeEventListener('controllerchange', changed));
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
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
