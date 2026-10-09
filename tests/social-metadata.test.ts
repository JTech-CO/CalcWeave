import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PUBLIC_SITE_URL, SITE_OG_IMAGE_URL, pngDimensions, releaseBuildDirectory, releaseEvidencePrefix, verifySocialMetadata } from '../scripts/social-metadata';

const html = readFileSync('apps/web/index.html', 'utf8');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=', 'base64');
const fixtureHead = html.replace(/(property="og:image:(?:width|height)" content=")[^"]+("\s*\/?>)/g, '$11$2');

describe('Static Korean social preview metadata', () => {
  it('verifies the real source head using actual PNG dimensions and public HTTPS URLs', () => {
    expect(verifySocialMetadata(fixtureHead, png)).toEqual({ canonicalUrl: PUBLIC_SITE_URL, imageUrl: SITE_OG_IMAGE_URL, width: 1, height: 1 });
    expect(html).not.toContain('0.8.1');
  });
  it.each([
    [fixtureHead.replace(PUBLIC_SITE_URL, '/CalcWeave/'), 'Canonical'],
    [fixtureHead.replace('property="og:image" content="' + SITE_OG_IMAGE_URL, 'property="og:image" content="https://external.test/social.png'), 'og:image'],
    [fixtureHead.replace('name="twitter:card" content="summary_large_image"', 'name="twitter:card" content="summary"'), 'twitter:card'],
    [fixtureHead.replace('property="og:locale" content="ko_KR"', 'property="og:locale" content="en_US"'), 'og:locale'],
    [fixtureHead.replace('property="og:image:width" content="1"', 'property="og:image:width" content="1200"'), 'OG width'],
    [fixtureHead.replace(/\s*<meta property="og:image:alt"[^>]+>/, ''), 'og:image:alt'],
    [fixtureHead.replace('</head>', '<meta property="og:image" content="' + SITE_OG_IMAGE_URL + '" /></head>'), 'duplicate social metadata'],
  ])('rejects incorrect static metadata: %s', (source, message) => {
    expect(() => verifySocialMetadata(source, png)).toThrow(message);
  });
  it('rejects files disguised as PNG, incomplete headers and invalid dimensions', () => {
    expect(pngDimensions(png)).toEqual({ width: 1, height: 1 });
    expect(() => pngDimensions(png.subarray(0, 24))).toThrow('truncated');
    const wrongSignature = Buffer.from(png); wrongSignature[0] = 0;
    expect(() => pngDimensions(wrongSignature)).toThrow('signature');
    const wrongChunk = Buffer.from(png); wrongChunk.write('IDAT', 12, 'ascii');
    expect(() => pngDimensions(wrongChunk)).toThrow('IHDR');
    const zeroWidth = Buffer.from(png); zeroWidth.writeUInt32BE(0, 16);
    expect(() => pngDimensions(zeroWidth)).toThrow('dimensions');
  });
});

describe('Release evidence destination', () => {
  it('checks the ordinary build by default and supports the two isolated OG build directories', () => {
    expect(releaseBuildDirectory()).toBe('dist');
    for (const directory of ['dist', '.test-generated/og-readme-root-dist', '.test-generated/og-readme-project-dist', '.test-generated/m17-root-dist', '.test-generated/m17-project-dist', '.test-generated/m18-root-dist', '.test-generated/m18-project-dist']) expect(releaseBuildDirectory(directory)).toBe(directory);
  });
  it.each(['', '../dist', '/tmp/dist', 'C:/dist', '.test-generated/source-snapshot/dist', '.test-generated/og-readme-root-dist/../../dist'])('rejects arbitrary release build directories: %s', directory => {
    expect(() => releaseBuildDirectory(directory)).toThrow('Unsupported release build directory');
  });
  it('preserves the default stage paths and offers a separate fixed OG report prefix', () => {
    expect(releaseEvidencePrefix('0.8.1', '0.8.0-catalog')).toBe('pages');
    expect(releaseEvidencePrefix('0.17.3', '0.17.0-m16')).toBe('m16');
    expect(releaseEvidencePrefix('0.17.3', '0.17.0-m16', 'og-readme')).toBe('og-readme');
    expect(releaseEvidencePrefix('0.18.0', '0.17.0-m16')).toBe('m17');
    expect(releaseEvidencePrefix('0.18.1', '0.17.0-m16')).toBe('m17');
    expect(releaseEvidencePrefix('0.18.0', '0.17.0-m16', 'm17')).toBe('m17');
    expect(releaseEvidencePrefix('0.19.0', '0.17.0-m16')).toBe('m18');
    expect(releaseEvidencePrefix('0.19.1', '0.17.0-m16')).toBe('m18');
    expect(releaseEvidencePrefix('0.19.0', '0.17.0-m16', 'm18')).toBe('m18');
    expect(releaseEvidencePrefix('0.20.0', '0.17.0-m16')).toBe('m19');
    expect(releaseEvidencePrefix('0.20.1', '0.17.0-m16')).toBe('m19');
    expect(releaseEvidencePrefix('0.20.0', '0.17.0-m16', 'm19')).toBe('m19');
    expect(releaseBuildDirectory('.test-generated/m19-root-dist')).toBe('.test-generated/m19-root-dist');
    expect(releaseBuildDirectory('.test-generated/m19-project-dist')).toBe('.test-generated/m19-project-dist');
    expect(releaseEvidencePrefix('0.21.0', '0.17.0-m16')).toBe('m20');
    expect(releaseEvidencePrefix('0.22.0', '0.17.0-m16')).toBe('m21');
    expect(releaseEvidencePrefix('0.22.1', '0.17.0-m16', 'm21')).toBe('m21');
    expect(releaseBuildDirectory('.test-generated/m21-root-dist')).toBe('.test-generated/m21-root-dist');
    expect(releaseEvidencePrefix('0.23.0', '0.17.0-m16')).toBe('m22');
    expect(releaseEvidencePrefix('0.23.1', '0.17.0-m16', 'm22')).toBe('m22');
    expect(releaseBuildDirectory('.test-generated/m22-root-dist')).toBe('.test-generated/m22-root-dist');
    expect(releaseBuildDirectory('.test-generated/m22-project-dist')).toBe('.test-generated/m22-project-dist');
    expect(releaseEvidencePrefix('0.24.0', '0.17.0-m16')).toBe('m23');
    expect(releaseEvidencePrefix('0.24.1', '0.17.0-m16', 'm23')).toBe('m23');
    expect(releaseBuildDirectory('.test-generated/m23-root-dist')).toBe('.test-generated/m23-root-dist');
    expect(releaseBuildDirectory('.test-generated/m23-project-dist')).toBe('.test-generated/m23-project-dist');
    expect(releaseEvidencePrefix('0.25.0', '0.17.0-m16')).toBe('m24');
    expect(releaseEvidencePrefix('0.25.1', '0.17.0-m16')).toBe('m24');
    expect(releaseEvidencePrefix('0.25.1', '0.17.0-m16', 'm24')).toBe('m24');
    expect(releaseBuildDirectory('.test-generated/m24-root-dist')).toBe('.test-generated/m24-root-dist');
    expect(releaseBuildDirectory('.test-generated/m24-project-dist')).toBe('.test-generated/m24-project-dist');
    expect(releaseEvidencePrefix('0.26.0', '0.17.0-m16')).toBe('m25');
    expect(releaseEvidencePrefix('0.26.1', '0.17.0-m16', 'm25')).toBe('m25');
    expect(releaseBuildDirectory('.test-generated/m25-root-dist')).toBe('.test-generated/m25-root-dist');
    expect(releaseBuildDirectory('.test-generated/m25-project-dist')).toBe('.test-generated/m25-project-dist');
    expect(releaseEvidencePrefix('0.21.1', '0.17.0-m16')).toBe('m20');
    expect(releaseEvidencePrefix('0.21.0', '0.17.0-m16', 'm20')).toBe('m20');
    expect(releaseBuildDirectory('.test-generated/m20-root-dist')).toBe('.test-generated/m20-root-dist');
    expect(releaseBuildDirectory('.test-generated/m20-project-dist')).toBe('.test-generated/m20-project-dist');
  });
  it.each(['', '../m16', 'm16', '/tmp/result', 'og-readme/../../m16'])('rejects arbitrary or historic report overrides: %s', prefix => {
    expect(() => releaseEvidencePrefix('0.17.3', '0.17.0-m16', prefix)).toThrow('Unsupported release evidence prefix');
  });
});
