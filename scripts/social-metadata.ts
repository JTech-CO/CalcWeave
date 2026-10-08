import assert from 'node:assert/strict';

export const SITE_OG_IMAGE_PATH = 'assets/social/calcweave-og.png';
export const PUBLIC_SITE_URL = 'https://jtech-co.github.io/CalcWeave/';
export const SITE_OG_IMAGE_URL = new URL(SITE_OG_IMAGE_PATH, PUBLIC_SITE_URL).href;
const TITLE = 'CalcWeave · 블록으로 연결하는 수학 계산과 시뮬레이션';
const DESCRIPTION = '수학 학습과 연구를 위한 블록 도식 기반 계산·시뮬레이션 도구. 수학 모델링, 신호 처리와 수치 계산을 수행하고 선택 모델을 TypeScript·Python 코드로 내보냅니다.';
const IMAGE_ALT = '블록 도식으로 연결된 수학 계산과 시뮬레이션을 표현한 CalcWeave 소개 이미지';

function decodeHtml(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#39);/g, entity => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&#39;': "'" })[entity]!);
}
function attributes(source: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(/([A-Za-z][A-Za-z0-9_:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    const key = match[1]!.toLowerCase(); assert(!result.has(key), `Duplicate HTML attribute: ${key}`);
    result.set(key, decodeHtml(match[2] ?? match[3] ?? match[4]!));
  }
  return result;
}

/** Inspect the actual PNG header rather than trusting the file extension or meta dimensions. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  assert(bytes.byteLength >= 33, 'Social image PNG is truncated');
  assert([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value), 'Social image must have a PNG signature');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(view.getUint32(8) === 13 && String.fromCharCode(...bytes.slice(12, 16)) === 'IHDR', 'Social image must start with a PNG IHDR chunk');
  const width = view.getUint32(16), height = view.getUint32(20);
  assert(width > 0 && height > 0 && width <= 8192 && height <= 8192, 'Social image PNG dimensions are invalid');
  return { width, height };
}

/** Static head metadata must be visible to crawlers before any application JavaScript runs. */
export function verifySocialMetadata(html: string, imageBytes: Uint8Array): { canonicalUrl: string; imageUrl: string; width: number; height: number } {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1]; assert(head, 'Missing static document head');
  const meta = [...head.matchAll(/<meta\b([^>]*)>/gi)].map(match => attributes(match[1]!));
  const links = [...head.matchAll(/<link\b([^>]*)>/gi)].map(match => attributes(match[1]!));
  const value = (attribute: 'name' | 'property', key: string): string => {
    const matches = meta.filter(tag => tag.get(attribute) === key);
    assert(matches.length === 1 && matches[0]!.has('content'), `Missing or duplicate social metadata: ${key}`);
    return matches[0]!.get('content')!;
  };
  const canonical = links.filter(tag => tag.get('rel') === 'canonical');
  assert(canonical.length === 1 && canonical[0]!.get('href') === PUBLIC_SITE_URL, 'Canonical must use the actual public HTTPS site URL');
  const titles = [...head.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/gi)];
  assert(titles.length === 1 && decodeHtml(titles[0]![1]!) === TITLE, 'Document title differs from social metadata');
  assert.equal(value('name', 'description'), DESCRIPTION, 'Document description differs from social metadata');
  for (const [key, expected] of Object.entries({
    'og:type': 'website', 'og:site_name': 'CalcWeave', 'og:locale': 'ko_KR',
    'og:title': TITLE, 'og:description': DESCRIPTION, 'og:url': PUBLIC_SITE_URL,
    'og:image': SITE_OG_IMAGE_URL, 'og:image:secure_url': SITE_OG_IMAGE_URL,
    'og:image:type': 'image/png', 'og:image:alt': IMAGE_ALT,
  })) assert.equal(value('property', key), expected, `Unexpected ${key}`);
  for (const [key, expected] of Object.entries({
    'twitter:card': 'summary_large_image', 'twitter:title': TITLE, 'twitter:description': DESCRIPTION,
    'twitter:image': SITE_OG_IMAGE_URL, 'twitter:image:alt': IMAGE_ALT,
  })) assert.equal(value('name', key), expected, `Unexpected ${key}`);
  const dimensions = pngDimensions(imageBytes);
  assert.equal(value('property', 'og:image:width'), String(dimensions.width), 'OG width must match the actual PNG');
  assert.equal(value('property', 'og:image:height'), String(dimensions.height), 'OG height must match the actual PNG');
  return { canonicalUrl: PUBLIC_SITE_URL, imageUrl: SITE_OG_IMAGE_URL, ...dimensions };
}

export function releaseEvidencePrefix(appVersion: string, engineVersion: string, override?: string): string {
  if (override !== undefined) {
    assert(['og-readme', 'm17', 'm18', 'm19', 'm20'].includes(override), 'Unsupported release evidence prefix; use og-readme, m17, m18, m19 or m20');
    return override;
  }
  // M17 adds mathematical explanations and learning UI without changing execution semantics.
  if (/^0\.18\.\d+$/.test(appVersion)) return 'm17';
  if (/^0\.19\.\d+$/.test(appVersion)) return 'm18';
  if (/^0\.20\.\d+$/.test(appVersion)) return 'm19';
  if (/^0\.21\.\d+$/.test(appVersion)) return 'm20';
  return appVersion === '0.8.1' ? 'pages' : engineVersion.split('-').at(-1)!;
}

/** Verification accepts only named, workspace-contained release builds. */
export function releaseBuildDirectory(override?: string): string {
  const directory = override ?? 'dist';
  assert(['dist', '.test-generated/og-readme-root-dist', '.test-generated/og-readme-project-dist', '.test-generated/m17-root-dist', '.test-generated/m17-project-dist', '.test-generated/m18-root-dist', '.test-generated/m18-project-dist', '.test-generated/m19-root-dist', '.test-generated/m19-project-dist', '.test-generated/m20-root-dist', '.test-generated/m20-project-dist'].includes(directory), 'Unsupported release build directory');
  return directory;
}
