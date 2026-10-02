import type { Plugin } from 'vite';
import { parseDeploymentBase } from './pages-base';

// GitHub Pages does not consume host-specific `_headers` files. Ship the supported
// meta directives as well as the stronger Vite development/preview HTTP policy.
export const STATIC_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:", "worker-src 'self'", "connect-src 'self'",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'",
].join('; ');
export function calcWeaveSecurityPlugin(): Plugin {
  return {
    name: 'calcweave-static-security', apply: 'build',
    configResolved(config) { parseDeploymentBase(config.base); },
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: STATIC_CSP }, injectTo: 'head-prepend' },
        { tag: 'meta', attrs: { name: 'referrer', content: 'no-referrer' }, injectTo: 'head-prepend' },
      ],
    },
  };
}
