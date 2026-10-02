import { parseDeploymentBase } from '../../../scripts/pages-base';

/** Vite supplies the deployment prefix; plain Node imports keep the root fallback. */
export function getAppBasePath(): string { return parseDeploymentBase(import.meta.env?.BASE_URL ?? '/'); }

/** Only repository-owned local resources are resolved beneath the app's scope. */
export function appResourcePath(path: string, base = getAppBasePath()): string {
  if (!/^\/(?:[A-Za-z0-9][A-Za-z0-9._-]*(?:\/|$))*$/.test(path)) throw new Error('앱 리소스 경로를 확인해 주세요.');
  return parseDeploymentBase(base) + path.slice(1);
}
