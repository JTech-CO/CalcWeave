import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { APP_VERSION, getReleaseCatalog } from '../packages/release/src';
import { isOfflineAssetUrl, type OfflineManifest } from './offline-build';
import { parseDeploymentBase } from './pages-base';
import { PYTHON_TARGET, PYTHON_M7_TARGET } from '../packages/codegen-python/src/capabilities';
import { WASM_TARGET } from '../packages/codegen-wasm/src/capabilities';
import { MODEL_PACKAGE_PERMISSIONS, MODEL_PACKAGE_REGISTRY } from '../packages/model-package/src';
import { BUILTIN_ADAPTER_PROFILES, UNAVAILABLE_ADAPTER_PROFILES } from '../packages/model/src/m14-adapters';
import { M14_WASM_BYTES, inspectM14Wasm } from '../packages/runtime/src/m14-wasm';
import { SITE_OG_IMAGE_PATH, releaseBuildDirectory, releaseEvidencePrefix, verifySocialMetadata } from './social-metadata';
import { readSourceCommit, sourceCommitFromEnvironment } from './release-provenance';

const catalog = getReleaseCatalog(), checks: string[] = [];
const evidenceStage = releaseEvidencePrefix(APP_VERSION, catalog.engineVersion, process.env.CALCWEAVE_RELEASE_EVIDENCE_PREFIX);
const buildDirectory = releaseBuildDirectory(process.env.CALCWEAVE_RELEASE_BUILD_DIRECTORY);
function check(condition: unknown, message: string): void { assert(condition, message); checks.push(message); }
check(catalog.version === APP_VERSION && /^\d+\.\d+\.\d+-(?:m\d+|catalog)$/.test(catalog.engineVersion), 'app/engine release versions');
check(catalog.blocks.length >= 144 && new Set(catalog.blocks.map(block => block.id)).size === catalog.blocks.length, 'single registry retains catalog definitions with unique executable IDs');
check(PYTHON_TARGET.blockIds.length === 69 && new Set(PYTHON_TARGET.blockIds).size === 69 && PYTHON_M7_TARGET.blockIds.length === 51 && PYTHON_M7_TARGET.blockIds.every(id => PYTHON_TARGET.blockIds.includes(id)) && catalog.blocks.every(block => block.exportTargets.includes('python') === PYTHON_TARGET.blockIds.includes(block.id)), 'Python release metadata matches versioned capabilities and preserves all51 predecessor IDs');
check(WASM_TARGET.blockIds.length === 16 && new Set(WASM_TARGET.blockIds).size === 16 && catalog.blocks.every(block => block.exportTargets.includes('wasm') === WASM_TARGET.blockIds.includes(block.id)), 'WASM release metadata matches selected scalar target capabilities');
check(catalog.codeTargets.cCpp.available === false && catalog.codeTargets.cCpp.executableGeneratorApproved === false, 'C/C++ emission is not advertised as verified execution');
check(PYTHON_TARGET.supportedModes.join(',') === 'static,discrete', 'Python target does not claim continuous solver support');
check(MODEL_PACKAGE_REGISTRY.length === catalog.blocks.length && MODEL_PACKAGE_PERMISSIONS.join(',') === 'local-model' && Object.isFrozen(MODEL_PACKAGE_REGISTRY), 'model packages bind approved immutable registry and local-only permissions');
check(BUILTIN_ADAPTER_PROFILES.length === 3 && UNAVAILABLE_ADAPTER_PROFILES.length === 8 && UNAVAILABLE_ADAPTER_PROFILES.every(profile => profile.availability === 'unavailable' && profile.exportTargets.length === 0), 'trusted adapter execution and unavailable native requirements remain distinct');
for (const profile of BUILTIN_ADAPTER_PROFILES.filter(profile => profile.artifact)) {
  const bytes = M14_WASM_BYTES[profile.id]!, inspected = inspectM14Wasm(bytes, profile.id);
  check(createHash('sha256').update(Uint8Array.from(bytes)).digest('hex') === profile.artifact!.sha256 && inspected.imports === 0 && inspected.memories === 0 && !inspected.loops && !inspected.calls, `pinned straight-line WASM artifact ${profile.id}`);
}
const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
check(packageJson.version === catalog.version, 'package/release catalog version agreement');
const manifest = JSON.parse(await readFile(join(buildDirectory, 'offline-manifest.json'), 'utf8')) as OfflineManifest;
const scope = parseDeploymentBase(manifest.scope);
check(manifest.schemaVersion === 1 && manifest.appVersion === catalog.version && manifest.engineVersion === catalog.engineVersion, 'offline release version and bounded deployment scope agreement');
const { releaseId, ...meaning } = manifest;
check(createHash('sha256').update(JSON.stringify(meaning)).digest('hex') === releaseId, 'releaseId binds complete static asset manifest');
check(manifest.assets.length <= 128 && new Set(manifest.assets.map(asset => asset.url)).size === manifest.assets.length, 'bounded unique offline allowlist');
for (const asset of manifest.assets) {
  check(isOfflineAssetUrl(asset.url, scope) && /^[a-f0-9]{64}$/.test(asset.sha256), `safe static asset ${asset.url}`);
  const bytes = await readFile(join(buildDirectory, asset.url.slice(scope.length)));
  check(bytes.byteLength === asset.bytes && createHash('sha256').update(bytes).digest('hex') === asset.sha256, `final built bytes match ${asset.url}`);
}
check(manifest.assets.reduce((total, asset) => total + asset.bytes, 0) <= 32 * 1024 * 1024, 'offline shell size limit');
const html = await readFile(join(buildDirectory, 'index.html'), 'utf8');
const expectedSourceCommit = sourceCommitFromEnvironment(process.env);
const sourceCommit = readSourceCommit(html, expectedSourceCommit !== undefined);
check(expectedSourceCommit === undefined || sourceCommit === expectedSourceCommit, 'release source identity matches the build environment');
const socialMetadata = verifySocialMetadata(html, await readFile(join(buildDirectory, SITE_OG_IMAGE_PATH)));
check(manifest.assets.some(asset => asset.url === scope + SITE_OG_IMAGE_PATH), 'public social PNG is included in the verified offline release');
check(socialMetadata.canonicalUrl.startsWith('https://') && socialMetadata.imageUrl.startsWith(socialMetadata.canonicalUrl), 'static Korean OG/Twitter metadata uses actual public HTTPS URLs and PNG dimensions');
const decodedHtml = html.replaceAll('&#39;', "'").replaceAll('&apos;', "'");
check(decodedHtml.includes('http-equiv="Content-Security-Policy"') && decodedHtml.includes("script-src 'self' 'wasm-unsafe-eval'") && decodedHtml.includes("object-src 'none'") && !decodedHtml.includes("'unsafe-eval'"), 'production CSP permits pinned WASM while blocking dynamic/inline JavaScript evaluation');
check(html.indexOf('Content-Security-Policy') < html.indexOf('<script') && !/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), 'CSP precedes external-only application scripts');
check(html.includes('name="referrer" content="no-referrer"'), 'production referrer policy');
for (const policy of ['terms', 'privacy', 'cookies', 'notices']) {
  const path = `${scope}${policy}/index.html`, source = await readFile(join(buildDirectory, policy, 'index.html'), 'utf8');
  check(manifest.assets.some(asset => asset.url === path) && source.includes('Content-Security-Policy') && source.includes('lang="ko"') && source.includes(`href="${scope}"`), `offline accessible protected policy ${policy}`);
  if (policy !== 'notices') check(source.includes('JTech-Co') && source.includes('jtech-bryan@proton.me'), `operator/contact in ${policy}`);
}
async function files(directory: string): Promise<string[]> {
  return (await Promise.all((await readdir(directory, { withFileTypes: true })).map(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]))).flat();
}
const builtFiles = await files(buildDirectory);
check(!builtFiles.some(path => path.endsWith('.map') || /(?:^|[\\/])\.env/.test(path)), 'no source maps or environment files distributed');
for (const file of builtFiles.filter(path => /\.(js|css)$/.test(path) && !path.endsWith('sw.js'))) check(manifest.assets.some(asset => asset.url === scope + relative(buildDirectory, file).replaceAll('\\', '/')), 'all code/Worker/lazy chunks are in static release');
const secretPattern = /(?:\b(?:sk-(?:proj-)?|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
for (const path of builtFiles.filter(path => /\.(js|html|json)$/.test(path))) check(!secretPattern.test(await readFile(path, 'utf8')), `no recognized secret material in ${relative(buildDirectory, path)}`);
const workflow = await readFile('.github/workflows/pages.yml', 'utf8');
check(!workflow.includes('pull_request_target') && !/^\s+pull_request:/m.test(workflow) && /workflow_dispatch:/.test(workflow)
  && /^  push:\r?\n    branches: \[main\]/m.test(workflow), 'publication follows trusted main pushes or explicit main dispatch only');
const trustedMain = "if: github.repository == 'JTech-CO/CalcWeave' && github.ref == 'refs/heads/main' && github.event.repository.default_branch == 'main'";
check(workflow.split(trustedMain).length === 3 && workflow.includes('group: calcweave-pages-${{ github.ref }}') && workflow.includes('cancel-in-progress: true'), 'both jobs reject untrusted refs and newer main runs cancel obsolete main releases');
check(/^permissions:\r?\n  contents: read\r?\n/m.test(workflow) && /    permissions:\r?\n      contents: read\r?\n      pages: write\r?\n      id-token: write\r?\n/m.test(workflow)
  && !workflow.includes('contents: write') && !workflow.includes('actions: write'), 'verification is read-only and only deployment receives Pages OIDC permissions');
const approvedActions = new Set([
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  'actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97',
  'actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b',
  'actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b',
  'actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e',
  'actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333',
]);
const actualActions = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map(match => match[1]!);
check(new Set(actualActions).size === approvedActions.size && actualActions.every(action => approvedActions.has(action)), 'only official Actions at the independently verified commit allowlist');
check(workflow.includes("python-version: '3.14'") && workflow.includes('npm run verify:m7'), 'workflow executes actual approved Python target parity');
const targetValidator = await readFile('scripts/verify-pages-target.ts', 'utf8');
check(workflow.includes('npx tsx scripts/verify-pages-target.ts') && targetValidator.includes('https://jtech-co.github.io') && targetValidator.includes('/CalcWeave/') && targetValidator.includes('https://calcweave.com'), 'workflow validates the exact approved project/custom-domain destination');
check(workflow.includes("CALCWEAVE_BASE_PATH: ${{ format('{0}/', steps.pages.outputs.base_path) }}") && workflow.includes('npm run test:e2e:pages') && workflow.indexOf('Verify the exact Pages artifact') < workflow.indexOf('actions/upload-pages-artifact'), 'configured-path build and verification precede artifact publication');
check(workflow.includes('npm test -- --maxWorkers=2 --reporter=default --reporter=json --outputFile.json=.test-generated/ci-unit-results.json')
  && workflow.includes('CALCWEAVE_UNIT_RESULTS: .test-generated/ci-unit-results.json'), 'M16 gate consumes current bounded-worker CI test results');
check(workflow.includes('git ls-remote --exit-code origin refs/heads/main') && workflow.includes('test "$current_main" = "$GITHUB_SHA"')
  && workflow.indexOf('Refuse publication of a superseded main revision') < workflow.indexOf('Publish verified static artifact'), 'publication refuses a commit superseded on main immediately before deploy');
check(workflow.includes('name: github-pages') && workflow.includes('digest-mismatch: error') && workflow.includes("filter='data'")
  && workflow.includes('scripts/verify-published-release.ts "$CALCWEAVE_PAGES_URL" .test-generated/published-artifact "$GITHUB_SHA"')
  && workflow.indexOf('Verify the public release against this exact artifact and commit') > workflow.indexOf('Publish verified static artifact')
  && workflow.includes('npm run verify:pages:browser'), 'published bytes and fresh public app are checked against the same run artifact and commit');
await mkdir('docs/evidence', { recursive: true });
const evidence = { generatedAt: new Date().toISOString(), appVersion: catalog.version, engineVersion: catalog.engineVersion, scope, releaseId, sourceCommit: sourceCommit ?? null, checks, files: manifest.assets, totalStaticBytes: manifest.assets.reduce((total, asset) => total + asset.bytes, 0), socialMetadata, publicDeploymentClaimed: false };
await writeFile(`docs/evidence/${evidenceStage}-${scope === '/' ? 'root' : 'project'}-release-verification.json`, JSON.stringify(evidence, null, 2) + '\n');
process.stdout.write(JSON.stringify({ checks: checks.length, staticFiles: manifest.assets.length, totalStaticBytes: evidence.totalStaticBytes, releaseId }) + '\n');
