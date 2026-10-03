import { ModelError } from '../../model/src';
import { crc32 } from '../../data/src/bounded-xlsx';
import { NATIVE_IMPORT_LIMITS, type NativeLocation } from './native-types';

export function nativeFail(code: string, message: string): never { throw new ModelError([{ code, message }]); }
export function nativeUtf8(bytes: Uint8Array): string { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return nativeFail('NATIVE_ENCODING', '이 선택 profile은 올바른 UTF-8 텍스트만 읽습니다.'); } }
export async function rawSha256(bytes: Uint8Array): Promise<string> { const owned = new Uint8Array(bytes); const digest = await crypto.subtle.digest('SHA-256', owned.buffer); return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join(''); }
export async function inflateBounded(bytes: Uint8Array, format: 'deflate' | 'deflate-raw', limit: number): Promise<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try { reader = new Blob([new Uint8Array(bytes).buffer]).stream().pipeThrough(new DecompressionStream(format)).getReader(); }
  catch { return nativeFail('NATIVE_COMPRESSION', '이 환경에서 압축 데이터를 해제할 수 없습니다.'); }
  const chunks: Uint8Array[] = []; let length = 0;
  try { while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > limit) { await reader.cancel(); nativeFail('NATIVE_EXPANSION_LIMIT', '압축 해제 크기가 허용 상한을 넘었습니다.'); } chunks.push(next.value); } }
  catch (error) { if (error instanceof ModelError) throw error; return nativeFail('NATIVE_COMPRESSION', '압축 데이터가 손상되었습니다.'); }
  const result = new Uint8Array(length); let at = 0; for (const chunk of chunks) { result.set(chunk, at); at += chunk.length; } return result;
}
/** In-memory ZIP inspection only; names are never used as filesystem paths or network URLs. */
export async function readNativeZip(input: Uint8Array): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(input), view = new DataView(bytes.buffer), limit = NATIVE_IMPORT_LIMITS;
  if (bytes.length < 22 || bytes.length > limit.maxInputBytes || view.getUint32(0, true) !== 0x04034b50) nativeFail('SLX_ZIP', 'SLX ZIP 헤더 또는 크기를 확인하세요.');
  let end = -1; for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at--) if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === bytes.length) { end = at; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) nativeFail('SLX_ZIP', '분할 ZIP 또는 손상된 SLX는 읽을 수 없습니다.');
  const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true), size = view.getUint32(end + 12, true);
  if (!count || count > limit.maxEntries || count !== view.getUint16(end + 8, true) || start + size !== end) nativeFail('SLX_ZIP_LIMIT', 'SLX ZIP 목록이나 64개 항목 상한을 확인하세요.');
  const result = new Map<string, Uint8Array>(), spans: [number, number][] = []; let at = start, total = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) nativeFail('SLX_ZIP', 'ZIP 목록이 손상되었습니다.');
    const flags = view.getUint16(at + 8, true), method = view.getUint16(at + 10, true), crc = view.getUint32(at + 16, true), packed = view.getUint32(at + 20, true), expanded = view.getUint32(at + 24, true), nameSize = view.getUint16(at + 28, true), extra = view.getUint16(at + 30, true), comment = view.getUint16(at + 32, true), local = view.getUint32(at + 42, true), next = at + 46 + nameSize + extra + comment;
    if (next > end || !nameSize || nameSize > 240 || flags & ~0x808 || ![0, 8].includes(method) || expanded > limit.maxExpandedBytes || packed > limit.maxInputBytes || view.getUint16(at + 34, true)) nativeFail('SLX_ZIP_LIMIT', '암호화·ZIP64·지원하지 않는 압축 또는 큰 항목입니다.');
    const name = nativeUtf8(bytes.subarray(at + 46, at + 46 + nameSize));
    if (!/^[A-Za-z0-9_\[\]./-]+$/.test(name) || name.startsWith('/') || name.includes('..') || name.includes('//') || result.has(name)) nativeFail('SLX_UNSAFE_MEMBER', '경로 이동 또는 중복 ZIP 항목입니다.');
    if (local + 30 > start || view.getUint32(local, true) !== 0x04034b50) nativeFail('SLX_ZIP', 'ZIP 항목 위치가 잘못되었습니다.');
    const n = view.getUint16(local + 26, true), e = view.getUint16(local + 28, true), payload = local + 30 + n + e;
    if (payload > start || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method || nativeUtf8(bytes.subarray(local + 30, local + 30 + n)) !== name || payload + packed > start) nativeFail('SLX_ZIP', 'ZIP 목록과 실제 항목이 일치하지 않습니다.');
    if (!(flags & 8) && (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== packed || view.getUint32(local + 22, true) !== expanded)) nativeFail('SLX_ZIP', 'ZIP 항목의 크기·CRC가 일치하지 않습니다.');
    let last = payload + packed;
    if (flags & 8) { const signed = last + 4 <= start && view.getUint32(last, true) === 0x08074b50, p = last + (signed ? 4 : 0); if (p + 12 > start || view.getUint32(p, true) !== crc || view.getUint32(p + 4, true) !== packed || view.getUint32(p + 8, true) !== expanded) nativeFail('SLX_ZIP', 'ZIP data descriptor가 잘못되었습니다.'); last = p + 12; }
    if (spans.some(([a, b]) => local < b && last > a)) nativeFail('SLX_ZIP', '겹치는 ZIP 항목입니다.'); spans.push([local, last]);
    const decoded = method === 0 ? bytes.slice(payload, payload + packed) : await inflateBounded(bytes.subarray(payload, payload + packed), 'deflate-raw', Math.min(expanded, limit.maxExpandedBytes - total)); total += decoded.length;
    if (decoded.length !== expanded || crc32(decoded) !== crc || total > limit.maxExpandedBytes) nativeFail('SLX_INTEGRITY', 'ZIP 압축 해제 크기나 CRC가 일치하지 않습니다.');
    result.set(name, decoded); at = next;
  }
  if (at !== end) nativeFail('SLX_ZIP', 'ZIP 목록 길이가 일치하지 않습니다.'); return result;
}
export interface NativeXml { name: string; attrs: Record<string, string>; text: string; children: NativeXml[]; location: NativeLocation }
export function textLocation(text: string, offset: number, member?: string, path?: string): NativeLocation { const before = text.slice(0, offset), line = before.split('\n').length, last = before.lastIndexOf('\n'); return { offset, line, column: offset - last, ...(member ? { member } : {}), ...(path ? { path } : {}) }; }
export function nativeTextLocator(text: string, member?: string): (offset: number, path?: string) => NativeLocation { const lines = [0]; for (let at = 0; at < text.length; at++) if (text[at] === '\n') lines.push(at + 1); return (offset, path) => { let low = 0, high = lines.length; while (low + 1 < high) { const mid = low + Math.floor((high - low) / 2); if (lines[mid] <= offset) low = mid; else high = mid; } return { offset, line: low + 1, column: offset - lines[low] + 1, ...(member ? { member } : {}), ...(path ? { path } : {}) }; }; }
function decodeXml(text: string): string {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#(?:[0-9]+|x[0-9a-fA-F]+);)/.test(text)) nativeFail('SLX_XML_ENTITY', '외부 또는 정의되지 않은 XML entity는 읽지 않습니다.');
  return text.replace(/&(?:amp|lt|gt|quot|apos|#(?:[0-9]+|x[0-9a-fA-F]+));/g, entity => { const names: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }; if (names[entity] !== undefined) return names[entity]; const raw = entity.slice(2, -1), cp = raw.startsWith('x') ? parseInt(raw.slice(1), 16) : Number(raw); if (!Number.isInteger(cp) || cp > 0x10ffff || cp === 0 || cp >= 0xd800 && cp <= 0xdfff || cp < 32 && ![9, 10, 13].includes(cp)) nativeFail('SLX_XML_ENTITY', '잘못된 XML 문자입니다.'); return String.fromCodePoint(cp); });
}
/** Quote-aware bounded XML grammar. No DTD, custom entities, resolver or executable processing. */
export function parseNativeXml(text: string, member: string, budget = { nodes: 0 }): NativeXml {
  const location = nativeTextLocator(text, member);
  const root: NativeXml = { name: '#', attrs: Object.create(null), text: '', children: [], location: { offset: 0, member } }, stack = [root]; let at = 0;
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) nativeFail('SLX_XML', 'XML에 잘못된 제어 문자가 있습니다.');
  while (at < text.length) {
    if (text[at] !== '<') { const end = text.indexOf('<', at), last = end < 0 ? text.length : end; stack.at(-1)!.text += decodeXml(text.slice(at, last)); at = last; continue; }
    if (text.startsWith('<!--', at)) { const end = text.indexOf('-->', at + 4); if (end < 0 || text.slice(at + 4, end).includes('--')) nativeFail('SLX_XML', 'XML comment가 잘못되었습니다.'); at = end + 3; continue; }
    if (text.startsWith('<?xml ', at) && stack.length === 1 && root.children.length === 0) { const end = text.indexOf('?>', at + 6); if (end < 0) nativeFail('SLX_XML', 'XML 선언이 닫히지 않았습니다.'); at = end + 2; continue; }
    if (text.startsWith('<!', at) || text.startsWith('<?', at)) nativeFail('SLX_XML_ENTITY', 'DTD·CDATA·처리 명령은 이 XML profile에서 지원하지 않습니다.');
    let end = at + 1, quote = ''; for (; end < text.length; end++) { const ch = text[end]; if (quote) { if (ch === quote) quote = ''; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') break; }
    if (end === text.length) nativeFail('SLX_XML', 'XML 태그가 닫히지 않았습니다.'); const token = text.slice(at, end + 1);
    if (token.startsWith('</')) { const name = token.slice(2, -1).trim(); if (stack.length <= 1 || stack.at(-1)!.name !== name) nativeFail('SLX_XML', 'XML 태그 순서가 잘못되었습니다.'); stack.pop(); }
    else { const match = /^<([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)>$/.exec(token); if (!match || ++budget.nodes > NATIVE_IMPORT_LIMITS.maxXmlNodes || stack.length > NATIVE_IMPORT_LIMITS.maxDepth) nativeFail('SLX_XML_LIMIT', 'XML 구조·깊이·노드 상한을 확인하세요.'); const node: NativeXml = { name: match[1], attrs: Object.create(null), children: [], text: '', location: location(at, [...stack.slice(1).map(x => x.name), match[1]].join('/')) }; let rest = match[2], count = 0; while (rest.trim()) { const part = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(rest); if (!part || ++count > 64 || (part[2] ?? part[3]).length > 16_384 || Object.hasOwn(node.attrs, part[1])) nativeFail('SLX_XML', 'XML 속성이 잘못되었습니다.'); node.attrs[part[1]] = decodeXml(part[2] ?? part[3]); rest = rest.slice(part[0].length); } stack.at(-1)!.children.push(node); if (!match[3]) stack.push(node); }
    at = end + 1;
  }
  if (stack.length !== 1 || root.children.length !== 1 || root.text.replace(/^\uFEFF/, '').trim()) nativeFail('SLX_XML', 'XML 문서 구조가 잘못되었습니다.'); return root.children[0];
}
export function xmlDescendants(root: NativeXml, name: string): NativeXml[] { const found: NativeXml[] = [], stack = [root]; while (stack.length) { const node = stack.pop()!; if (node.name.split(':').at(-1) === name) found.push(node); stack.push(...node.children.slice().reverse()); } return found; }
