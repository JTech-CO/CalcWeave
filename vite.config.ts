import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { calcWeaveOfflinePlugin } from './scripts/offline-build.ts';
import { calcWeaveSecurityPlugin } from './scripts/security-build.ts';
import { calcWeaveProvenancePlugin } from './scripts/release-provenance.ts';
import { ENGINE_VERSION } from './packages/model/src/types.ts';
import { getDeploymentBasePath } from './scripts/pages-base.ts';

const APP_VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig(({ command, isPreview }) => {
  const dev = command === 'serve' && !isPreview;
  const nonce = dev ? randomBytes(18).toString('base64') : undefined;
  const csp = [
    "default-src 'self'", `script-src 'self' 'wasm-unsafe-eval'${nonce ? ` 'nonce-${nonce}'` : ''}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "worker-src 'self'",
    `connect-src 'self'${dev ? ' ws://127.0.0.1:5173' : ''}`,
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
  const headers = {
    'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()', 'X-Robots-Tag': 'noindex',
  };
  return {
    base: getDeploymentBasePath(),
    root: fileURLToPath(new URL('./apps/web', import.meta.url)),
    plugins: [react(), calcWeaveSecurityPlugin(), calcWeaveProvenancePlugin(), calcWeaveOfflinePlugin({ appVersion: APP_VERSION, engineVersion: ENGINE_VERSION })], html: { cspNonce: nonce },
    server: { host: '127.0.0.1', port: 5173, strictPort: true, headers, cors: false,
      fs: { allow: [fileURLToPath(new URL('.', import.meta.url))] } },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true, headers, cors: false },
    build: { outDir: '../../dist', emptyOutDir: true, sourcemap: false },
  };
});
