import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';

// Historical baselines/evidence retain their original bytes, including old paths.
// This check covers the current documentation surface and updater link templates.
const required = [
  'README.md', 'docs/01-technical-whitepaper.md', 'docs/02-design-whitepaper.md',
  'docs/operations.md', 'docs/validation.md', 'docs/block-coverage.md', 'docs/support-matrix.md',
  'docs/legal/terms.md', 'docs/legal/privacy.md', 'docs/legal/cookies.md',
] as const;
const retired = [
  ...Array.from({ length: 16 }, (_, i) => [`m${i}-contract.md`, `m${i}-validation.md`]).flat(),
  '03-milestone-roadmap.md', '04-sane-design-revision.md', '05-simulink-coverage-roadmap.md',
  'block-expansion-plan.md', 'catalog-contract.md', 'catalog-validation.md',
  'm6-deployment.md', 'm6-operations.md', 'm6-security.md',
  'pages-deployment.md', 'pages-launch-review.md', 'pages-validation.md',
] as const;
assert.equal(retired.length, 44);
const root = resolve('.');
const retiredSet = new Set<string>(retired);
const withinRoot = (path: string): boolean => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !/^[A-Za-z]:/.test(rel);
};
const exists = async (path: string): Promise<boolean> => stat(path).then(() => true, error => {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
  throw error;
});
for (const path of required) assert(await exists(path), `Missing current document: ${path}`);
for (const name of retired) assert(!(await exists(`docs/${name}`)), `Retired document reintroduced: docs/${name}`);

const current = [...new Set([
  ...required,
  ...(await readdir('docs')).filter(name => name.endsWith('.md')).map(name => `docs/${name}`),
  ...(await readdir('docs/legal')).filter(name => name.endsWith('.md')).map(name => `docs/legal/${name}`),
])];
const content = new Map(await Promise.all(current.map(async path => [resolve(path), await readFile(path, 'utf8')] as const)));
const prose = (text: string): string => text.replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, '');
function anchors(text: string): Set<string> {
  const result = new Set<string>(), repetitions = new Map<string, number>();
  for (const match of prose(text).matchAll(/^#{1,6} (.+?)(?:[ \t]+#+)?[ \t]*$/gm)) {
    const base = match[1]!.replace(/<[^>]*>/g, '').toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replace(/ /g, '-');
    const ordinal = repetitions.get(base) ?? 0;
    result.add(ordinal ? `${base}-${ordinal}` : base); repetitions.set(base, ordinal + 1);
  }
  for (const match of text.matchAll(/<(?:a|span)\b[^>]*\bid=["']([^"']+)["'][^>]*>/g)) result.add(match[1]!);
  return result;
}
let localLinks = 0, localAnchors = 0, externalLinks = 0;
for (const [path, text] of content) {
  const body = prose(text);
  for (const name of retired) assert(!body.includes(name), `${relative(root, path)} references retired document ${name}`);
  const links = [...body.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\)/g)].map(match => match[1] ?? match[2]!);
  for (const link of links) {
    if (/^https?:\/\//.test(link) || /^mailto:/.test(link)) { externalLinks++; continue; }
    assert(!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(link), `Unexpected current-document link scheme: ${link}`);
    const [rawTarget, fragment] = link.split('#');
    assert(!rawTarget!.includes('?'), `Local document links must name a file: ${link}`);
    const target = rawTarget ? resolve(dirname(path), decodeURIComponent(rawTarget)) : path;
    assert(withinRoot(target), `Document link escapes workspace: ${relative(root, path)} -> ${link}`);
    assert(!retiredSet.has(target.split(/[\\/]/).at(-1)!), `Retired document linked: ${link}`);
    assert(await exists(target), `Missing local link: ${relative(root, path)} -> ${link}`);
    localLinks++;
    // Historical baseline/reference fragments are preserved, not rerendered here.
    if (fragment && content.has(target)) {
      assert(anchors(content.get(target)!).has(decodeURIComponent(fragment)), `Missing current-document anchor: ${relative(root, path)} -> ${link}`);
      localAnchors++;
    }
  }
}
const updaterSources = (await readdir('scripts')).filter(name => /^update-(?:catalog|m\d+)-coverage\.ts$/.test(name));
for (const name of updaterSources) {
  const source = await readFile(`scripts/${name}`, 'utf8');
  for (const retiredName of retired) assert(!source.includes(retiredName), `Coverage updater would reintroduce a retired document link: scripts/${name} -> ${retiredName}`);
}
const roadmapVerifier = await readFile('scripts/verify-roadmap.ts', 'utf8');
for (const name of ['03-milestone-roadmap.md', '05-simulink-coverage-roadmap.md']) assert(!roadmapVerifier.includes(name), `Roadmap verifier still consumes ${name}`);
process.stdout.write(JSON.stringify({ currentDocuments: current.length, requiredDocuments: required.length, retiredDocumentsAbsent: retired.length,
  localLinks, localAnchors, externalLinksDeclaredOnly: externalLinks, updaterSources: updaterSources.length,
  historicalBaselinesAndEvidenceExcluded: true, externalAvailabilityVerified: false }, null, 2) + '\n');
