import assert from 'node:assert/strict';
import { parseDeploymentBase } from './pages-base';

// Pages metadata is validated before it controls build paths or publication.
const origin = process.env.CALCWEAVE_PAGES_ORIGIN;
const rawBase = process.env.CALCWEAVE_PAGES_BASE;
assert(typeof rawBase === 'string', 'Pages must provide its configured base_path.');
const base = parseDeploymentBase(`${rawBase}/`);
assert((origin === 'https://jtech-co.github.io' && base === '/CalcWeave/')
  || (origin === 'https://calcweave.com' && base === '/'),
  'Publish only the configured CalcWeave project URL or verified custom-domain root.');
process.stdout.write(JSON.stringify({ origin, base, url: `${origin}${base}` }) + '\n');
