import { DATASET_LIMITS, ModelError, type DatasetCell } from '../../model/src';

export const XLSX_LIMITS = Object.freeze({ maxInputBytes: DATASET_LIMITS.maxBytes, maxEntries: 64, maxExpandedBytes: 8 * 1024 * 1024, maxEntryBytes: 2 * 1024 * 1024, maxXmlNodes: 100_000, maxDepth: 32 });
export interface XlsxSheet { name: string; columnNames: string[]; rows: (DatasetCell | null)[][] }
export interface BoundedWorkbook { sheets: XlsxSheet[]; sourceHash: string }
function fail(code: string, message: string): never { throw new ModelError([{ code, message }]); }
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function utf8(bytes: Uint8Array): string { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return fail('XLSX_ENCODING', 'XLSX XML은 올바른 UTF-8이어야 합니다.'); } }
/** No extraction to disk; every member is bounded, verified and retained in memory. */
export async function readBoundedXlsxZip(input: Uint8Array): Promise<Map<string, Uint8Array>> {
  if (!(input instanceof Uint8Array) || input.byteLength < 22 || input.byteLength > XLSX_LIMITS.maxInputBytes) fail('XLSX_SIZE', 'XLSX 파일은 2 MiB 이하여야 합니다.');
  const bytes = new Uint8Array(input), view = new DataView(bytes.buffer);
  if (view.getUint32(0, true) !== 0x04034b50) fail('XLSX_MAGIC', '올바른 XLSX ZIP 파일이 아닙니다.');
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break; }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail('XLSX_ZIP', '분할 ZIP 또는 손상된 XLSX는 지원하지 않습니다.');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  if (!count || count > XLSX_LIMITS.maxEntries || count !== view.getUint16(end + 8, true) || start + size !== end) fail('XLSX_ZIP_LIMIT', 'XLSX ZIP 목록의 구조 또는 64개 항목 상한을 확인하세요.');
  const entries = new Map<string, Uint8Array>(), spans: [number, number][] = []; let position = start, total = 0;
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) fail('XLSX_ZIP', 'XLSX ZIP 목록이 손상되었습니다.');
    const flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true), crc = view.getUint32(position + 16, true), compressed = view.getUint32(position + 20, true), expanded = view.getUint32(position + 24, true), nameSize = view.getUint16(position + 28, true), extra = view.getUint16(position + 30, true), comment = view.getUint16(position + 32, true), local = view.getUint32(position + 42, true);
    const next = position + 46 + nameSize + extra + comment;
    if (next > end || !nameSize || nameSize > 240 || flags & ~0x808 || ![0, 8].includes(method) || expanded > XLSX_LIMITS.maxEntryBytes || compressed > XLSX_LIMITS.maxInputBytes || view.getUint16(position + 34, true)) fail('XLSX_ZIP_LIMIT', '암호화·ZIP64·지원하지 않는 압축 또는 큰 항목은 읽을 수 없습니다.');
    const name = utf8(bytes.subarray(position + 46, position + 46 + nameSize));
    if (!/^(?:\[Content_Types\]\.xml|(?:_rels|docProps|xl)\/[A-Za-z0-9_./-]+)$/.test(name) || name.includes('..') || name.includes('//') || /(?:externalLinks|vba|macro|embeddings|activeX|connections|queryTables)/i.test(name) || entries.has(name)) fail('XLSX_UNSAFE_MEMBER', '외부 연결·매크로·경로 이동·중복 항목이 있는 파일은 가져올 수 없습니다.');
    if (local + 30 > start || view.getUint32(local, true) !== 0x04034b50) fail('XLSX_ZIP', 'XLSX 항목의 시작 위치가 잘못되었습니다.');
    const localNameSize = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true), payload = local + 30 + localNameSize + localExtra;
    if (view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method || utf8(bytes.subarray(local + 30, local + 30 + localNameSize)) !== name || payload + compressed > start) fail('XLSX_ZIP', 'XLSX 항목의 목록과 내용이 일치하지 않습니다.');
    if (!(flags & 8) && (view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== compressed || view.getUint32(local + 22, true) !== expanded)) fail('XLSX_ZIP', 'XLSX 항목의 크기·검증값이 일치하지 않습니다.');
    let last = payload + compressed;
    if (flags & 8) {
      const signature = last + 4 <= start && view.getUint32(last, true) === 0x08074b50; const at = last + (signature ? 4 : 0);
      if (at + 12 > start || view.getUint32(at, true) !== crc || view.getUint32(at + 4, true) !== compressed || view.getUint32(at + 8, true) !== expanded) fail('XLSX_ZIP', 'XLSX 데이터 검증 레코드가 일치하지 않습니다.');
      last = at + 12;
    }
    if (spans.some(([a, b]) => local < b && last > a)) fail('XLSX_ZIP', '겹치는 XLSX 항목은 가져올 수 없습니다.');
    spans.push([local, last]);
    let result: Uint8Array;
    if (method === 0) result = bytes.slice(payload, payload + compressed);
    else {
      const stream = new Blob([bytes.slice(payload, payload + compressed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader = stream.getReader(), chunks: Uint8Array[] = []; let length = 0;
      try { while (true) { const next = await reader.read(); if (next.done) break; length += next.value.length; if (length > expanded || length > XLSX_LIMITS.maxEntryBytes || total + length > XLSX_LIMITS.maxExpandedBytes) { await reader.cancel(); fail('XLSX_EXPANSION_LIMIT', 'XLSX 압축 해제 크기 상한을 초과했습니다.'); } chunks.push(next.value); } }
      catch (error) { if (error instanceof ModelError) throw error; fail('XLSX_COMPRESSION', 'XLSX 압축 데이터를 읽을 수 없습니다.'); }
      result = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    }
    total += result.length;
    if (result.length !== expanded || crc32(result) !== crc || total > XLSX_LIMITS.maxExpandedBytes) fail('XLSX_INTEGRITY', 'XLSX 항목의 크기 또는 CRC 검증에 실패했습니다.');
    entries.set(name, result); position = next;
  }
  if (position !== end) fail('XLSX_ZIP', 'XLSX ZIP 목록 길이가 일치하지 않습니다.');
  return entries;
}
interface Xml { name: string; attributes: Record<string, string>; children: Xml[]; text: string }
function decode(text: string): string {
  if (/&(?!amp;|lt;|gt;|quot;|apos;|#(?:[0-9]+|x[0-9a-fA-F]+);)/.test(text)) fail('XLSX_XML', '지원하지 않는 XML 엔터티입니다.');
  return text.replace(/&(?:amp|lt|gt|quot|apos|#(?:[0-9]+|x[0-9a-fA-F]+));/g, entity => {
    const known: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }; if (known[entity]) return known[entity]!;
    const raw = entity.slice(2, -1), value = raw.startsWith('x') ? parseInt(raw.slice(1), 16) : Number(raw);
    if (!Number.isInteger(value) || value > 0x10ffff || value === 0 || value >= 0xd800 && value <= 0xdfff || value < 32 && ![9, 10, 13].includes(value)) fail('XLSX_XML', '올바르지 않은 XML 문자입니다.');
    return String.fromCodePoint(value);
  });
}
/** Small XML grammar: no DTD, entity declarations, CDATA, executable content or network resolver. */
function xml(text: string, budget: { nodes: number }): Xml {
  if (text.length > XLSX_LIMITS.maxEntryBytes || /<!|<\?(?!xml\s)/i.test(text)) fail('XLSX_XML', 'DTD·선언·처리 명령이 있는 XML은 가져올 수 없습니다.');
  text = text.replace(/^\uFEFF?\s*<\?xml\s+[^?]*\?>/, '');
  const root: Xml = { name: '#', attributes: {}, children: [], text: '' }, stack = [root]; let cursor = 0;
  const tokens = /<[^>]*>|[^<]+/g; let match: RegExpExecArray | null;
  while ((match = tokens.exec(text))) {
    if (match.index !== cursor) fail('XLSX_XML', 'XML 태그가 닫히지 않았습니다.'); cursor = tokens.lastIndex; const token = match[0];
    if (!token.startsWith('<')) { stack.at(-1)!.text += decode(token); continue; }
    if (token.startsWith('</')) { const name = token.slice(2, -1).trim(); if (stack.length <= 1 || stack.at(-1)!.name !== name) fail('XLSX_XML', 'XML 태그의 순서가 잘못되었습니다.'); stack.pop(); continue; }
    const parsed = /^<([A-Za-z_][\w:.-]*)([\s\S]*?)(\/?)>$/.exec(token); if (!parsed || ++budget.nodes > XLSX_LIMITS.maxXmlNodes || stack.length > XLSX_LIMITS.maxDepth) fail('XLSX_XML_LIMIT', 'XML 구조 또는 노드·깊이 상한을 확인하세요.');
    const element: Xml = { name: parsed[1]!, attributes: Object.create(null) as Record<string, string>, children: [], text: '' };
    let rest = parsed[2]!, attributes = 0; const attr = /^\s+([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/;
    while (rest.trim()) { const part = attr.exec(rest); if (!part || ++attributes > 64 || (part[2] ?? part[3]!).length > 16_384 || Object.hasOwn(element.attributes, part[1]!)) fail('XLSX_XML', 'XML 속성 구조가 잘못되었습니다.'); element.attributes[part[1]!] = decode(part[2] ?? part[3]!); rest = rest.slice(part[0].length); }
    stack.at(-1)!.children.push(element); if (!parsed[3]) stack.push(element);
  }
  if (cursor !== text.length || stack.length !== 1 || root.children.length !== 1 || root.text.trim()) fail('XLSX_XML', 'XML 문서 구조를 확인하세요.'); return root.children[0]!;
}
const localName = (node: Xml): string => node.name.split(':').at(-1)!;
function descendants(node: Xml, name: string): Xml[] { const found: Xml[] = []; const pending = [node]; while (pending.length) { const item = pending.pop()!; if (localName(item) === name) found.push(item); pending.push(...[...item.children].reverse()); } return found; }
function child(node: Xml, name: string): Xml | undefined { return node.children.find(item => localName(item) === name); }
function cellText(node: Xml): string { const text = descendants(node, 't').map(item => item.text).join(''); if (text.length > DATASET_LIMITS.maxStringLength) fail('XLSX_CELL_LIMIT', '셀 문자열은 1,000자 이하여야 합니다.'); return text; }
function formula(value: DatasetCell | null): void {
  if (typeof value === 'string' && /^[\s]*[=+@-]/.test(value) && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) fail('DATASET_FORMULA', '수식으로 실행될 수 있는 셀은 가져올 수 없습니다. 값을 직접 저장한 파일을 사용하세요.');
}
export function rejectSpreadsheetFormulas(rows: readonly (readonly (DatasetCell | null)[])[]): void { rows.forEach(row => row.forEach(formula)); }
/** Value-only XLSX subset: headers + dense bounded cells, shared/inline strings, booleans, finite numbers. */
export async function importBoundedWorkbook(bytes: Uint8Array): Promise<BoundedWorkbook> {
  const entries = await readBoundedXlsxZip(bytes); const docs = new Map<string, Xml>(), budget = { nodes: 0 };
  for (const [name, value] of entries) if (name.endsWith('.xml') || name.endsWith('.rels')) { const tree = xml(utf8(value), budget); docs.set(name, tree); if (descendants(tree, 'f').length || descendants(tree, 'externalReference').length) fail('XLSX_FORMULA', '수식·외부 참조가 있는 XLSX는 가져올 수 없습니다.'); if (name.endsWith('.rels') && descendants(tree, 'Relationship').some(rel => rel.attributes.TargetMode !== undefined && rel.attributes.TargetMode !== 'Internal' || /^[a-z]+:|^\\|\.\./i.test(rel.attributes.Target ?? ''))) fail('XLSX_EXTERNAL', '외부 또는 경로 이동 연결이 있는 XLSX는 가져올 수 없습니다.'); }
  const types = docs.get('[Content_Types].xml'); if (!types || [...descendants(types, 'Override'), ...descendants(types, 'Default')].some(item => /macro|vba|external|oleObject|activeX/i.test(item.attributes.ContentType ?? ''))) fail('XLSX_CONTENT_TYPE', '매크로·외부 객체 또는 잘못된 XLSX 형식입니다.');
  const workbook = docs.get('xl/workbook.xml'), rels = docs.get('xl/_rels/workbook.xml.rels');
  if (!workbook || !rels || localName(workbook) !== 'workbook' || localName(rels) !== 'Relationships') fail('XLSX_WORKBOOK', 'XLSX 통합 문서와 시트 목록이 필요합니다.');
  const shared = docs.get('xl/sharedStrings.xml'); const strings = shared ? descendants(shared, 'si').map(cellText) : [];
  if (strings.length > DATASET_LIMITS.maxCells) fail('XLSX_CELL_LIMIT', '공유 문자열 상한을 초과했습니다.');
  const relation = new Map(descendants(rels, 'Relationship').map(item => [item.attributes.Id, item.attributes.Target])); const sheets: XlsxSheet[] = [];
  for (const sheet of descendants(workbook, 'sheet')) {
    const name = sheet.attributes.name ?? '', target = relation.get(sheet.attributes['r:id']);
    if (!name || /[\u0000-\u001f\u007f]/.test(name) || name.length > 80 || sheets.some(item => item.name === name) || sheets.length >= 8 || !target || !/^(?:\/xl\/)?worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(target)) fail('XLSX_SHEET', '시트 이름·연결 또는 최대 8개 시트 상한을 확인하세요.');
    const tree = docs.get(target.startsWith('/xl/') ? target.slice(1) : `xl/${target}`); if (!tree || localName(tree) !== 'worksheet') fail('XLSX_SHEET', '시트 내용을 찾을 수 없습니다.');
    if (descendants(tree, 'mergeCell').length) fail('XLSX_MERGED_CELLS', '병합 셀은 표로 읽을 수 없습니다. 병합을 해제하세요.');
    const rows: (DatasetCell | null)[][] = []; let width = 0, cells = 0, previousRow = 0;
    for (const row of descendants(tree, 'row')) {
      const r = Number(row.attributes.r); if (!Number.isInteger(r) || r < 1 || r > DATASET_LIMITS.maxRows + 1 || r <= previousRow) fail('XLSX_ROW_LIMIT', '시트 행의 순서 또는 4,000행 상한을 확인하세요.'); previousRow = r;
      while (rows.length < r) rows.push([]); const current = rows[r - 1]!;
      for (const cell of row.children.filter(item => localName(item) === 'c')) {
        const ref = /^([A-Z]{1,3})([1-9][0-9]*)$/.exec(cell.attributes.r ?? ''); if (!ref || Number(ref[2]) !== r) fail('XLSX_CELL', '셀 주소를 확인하세요.');
        let column = 0; for (const letter of ref[1]!) column = column * 26 + letter.charCodeAt(0) - 64;
        if (column > DATASET_LIMITS.maxColumns || ++cells > DATASET_LIMITS.maxCells + DATASET_LIMITS.maxColumns || current[column - 1] !== undefined) fail('XLSX_CELL_LIMIT', '시트는 16열·20,000셀 이하여야 합니다.');
        width = Math.max(width, column); const raw = child(cell, 'v')?.text ?? '', type = cell.attributes.t ?? 'n'; let value: DatasetCell | null;
        if (type === 's') { const index = Number(raw); if (!/^\d+$/.test(raw) || !Number.isSafeInteger(index) || index >= strings.length) fail('XLSX_STRING', '공유 문자열 주소가 잘못되었습니다.'); value = strings[index]!; }
        else if (type === 'inlineStr') value = cellText(cell);
        else if (type === 'str') value = raw;
        else if (type === 'b') { if (!['0', '1'].includes(raw)) fail('XLSX_BOOLEAN', 'boolean 셀은 0 또는 1이어야 합니다.'); value = raw === '1'; }
        else if (type === 'n') { if (!raw.trim()) value = null; else { value = Number(raw); if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw.trim()) || !Number.isFinite(value)) fail('XLSX_NUMBER', '숫자 셀은 유한한 수여야 합니다.'); } }
        else fail('XLSX_CELL_TYPE', '오류·날짜·지원하지 않는 셀 형식입니다. 날짜는 명시적인 시간 숫자로 바꾸세요.');
        if (typeof value === 'string' && value.length > DATASET_LIMITS.maxStringLength) fail('XLSX_CELL_LIMIT', '셀 문자열은 1,000자 이하여야 합니다.'); formula(value); current[column - 1] = value;
      }
    }
    if (rows.length < 2 || !width || (rows.length - 1) * width > DATASET_LIMITS.maxCells) fail('XLSX_TABLE', '시트에는 머리글과 데이터 행이 필요하며 표는 20,000셀 이하여야 합니다.');
    const normalized = rows.map(row => Array.from({ length: width }, (_, index) => row[index] ?? null));
    const columnNames = normalized.shift()!.map(value => { if (typeof value !== 'string') fail('XLSX_HEADER', '첫 행은 문자열 열 이름이어야 합니다.'); return value; });
    sheets.push({ name, columnNames, rows: normalized });
  }
  if (!sheets.length) fail('XLSX_SHEET', '읽을 시트가 없습니다.');
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)); const sourceHash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  return { sheets, sourceHash };
}
