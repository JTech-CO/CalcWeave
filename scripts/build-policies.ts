import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { STATIC_CSP } from './security-build';
import { APP_VERSION } from '../packages/release/src';
import { ENGINE_VERSION } from '../packages/model/src/types';
import { getDeploymentBasePath } from './pages-base';

const deploymentBase = getDeploymentBasePath();
const policyPath = (path: string): string => deploymentBase + path.replace(/^\//, '');

const escape = (text: string): string => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
function inline(text: string): string {
  return escape(text).replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
    if (!/^(?:https:\/\/|mailto:|\/(?!\/))/.test(url)) throw new Error('Unsupported policy link.');
    return `<a href="${url.startsWith('/') ? policyPath(url) : url}" rel="noreferrer">${label}</a>`;
  });
}
function renderMarkdown(source: string): string {
  return source.trim().split(/\r?\n\s*\r?\n/).map(part => {
    if (part.startsWith('# ')) return `<h1>${inline(part.slice(2))}</h1>`;
    if (part.startsWith('## ')) return `<h2>${inline(part.slice(3))}</h2>`;
    return `<p>${inline(part).replace(/\r?\n/g, ' ')}</p>`;
  }).join('\n');
}
const css = `:root{color-scheme:light dark;font:16px/1.75 system-ui,sans-serif;background:#191919;color:#ededed}body{max-width:900px;margin:auto;padding:32px 24px 64px}a{color:#9ebded;text-underline-offset:4px}h1{font-size:2rem;line-height:1.3}h2{font-size:1.25rem;margin-top:2rem}p{overflow-wrap:anywhere}nav{display:flex;flex-wrap:wrap;gap:20px;border-bottom:1px solid #454545;padding-bottom:20px}pre{font:14px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}details{border-bottom:1px solid #454545;padding:16px 0}summary{cursor:pointer}a:focus-visible,summary:focus-visible{outline:3px solid #9ebded;outline-offset:4px}@media(prefers-color-scheme:light){:root{background:#e8e8e8;color:#242424}a{color:#245493}}`;
function html(title: string, body: string): string {
  return `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(STATIC_CSP)}"><meta name="referrer" content="no-referrer"><title>${escape(title)} · CalcWeave</title><style>${css}</style></head><body><nav aria-label="문서 탐색"><a href="${policyPath('/')}">CalcWeave 작업 공간</a><a href="${policyPath('/terms/')}">이용 안내</a><a href="${policyPath('/privacy/')}">개인정보</a><a href="${policyPath('/cookies/')}">브라우저 저장소</a><a href="${policyPath('/notices/')}">오픈소스 고지</a></nav><main>${body}</main></body></html>\n`;
}
for (const [path, title] of [['terms', '베타 이용 안내'], ['privacy', '개인정보와 로컬 데이터'], ['cookies', '쿠키와 브라우저 저장소']] as const) {
  const directory = `apps/web/public/${path}`;
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'index.html'), html(title, renderMarkdown(await readFile(`docs/legal/${path}.md`, 'utf8'))));
}
interface PackageLockEntry { version?: string; dev?: boolean; license?: string }
const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as { packages: Record<string, PackageLockEntry> };
const notices: { name: string; version: string; license: string; text: string }[] = [];
for (const [directory, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!directory || entry.dev) continue;
  if (!/^node_modules\/(?:@?[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/.test(directory) || directory.includes('..')) throw new Error('Unsafe dependency path.');
  const packageInfo = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as { name: string; version: string; license?: string };
  const files = (await readdir(directory)).filter(name => /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(name));
  if (!files.length) throw new Error(`Missing license notice: ${packageInfo.name}`);
  const sections: string[] = [];
  for (const filename of files.sort()) sections.push(`${filename}\n${await readFile(join(directory, filename), 'utf8')}`);
  notices.push({ name: packageInfo.name, version: packageInfo.version, license: packageInfo.license ?? entry.license ?? 'See license text', text: sections.join('\n\n') });
}
const body = `<h1>오픈소스 고지</h1><p>CalcWeave ${escape(APP_VERSION)}의 잠금 파일에 고정된 프로덕션 의존성과 원본 라이선스 문구입니다. 각 패키지의 권리와 사용 조건은 아래 원문을 따릅니다. 개발·빌드 도구는 배포 앱과 구분됩니다.</p>` + notices.map(item => `<details><summary>${escape(item.name)} ${escape(item.version)} · ${escape(item.license)}</summary><pre>${escape(item.text)}</pre></details>`).join('\n');
await mkdir('apps/web/public/notices', { recursive: true });
await writeFile('apps/web/public/notices/index.html', html('오픈소스 고지', body));
await mkdir('docs/evidence', { recursive: true });
const evidencePrefix = String(APP_VERSION) === '0.8.1' ? 'pages' : ENGINE_VERSION.split('-').at(-1);
await writeFile(`docs/evidence/${evidencePrefix}-licenses.json`, JSON.stringify({ generatedAt: new Date().toISOString(), appVersion: APP_VERSION, basePath: deploymentBase, source: 'package-lock.json + installed package original license notices', dependencies: notices.map(({ text: _text, ...metadata }) => metadata) }, null, 2) + '\n');
process.stdout.write(JSON.stringify({ policyPages: 4, productionLicenseNotices: notices.length }) + '\n');
