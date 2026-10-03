import { DATASET_LIMITS } from '../../model/src';
import { inflateBounded, nativeFail, nativeUtf8 } from './bounded-format';
import { NATIVE_IMPORT_LIMITS, type NativeMatVariable } from './native-types';

interface Tag { type: number; data: Uint8Array; offset: number; next: number }
/** Level-5 MAT elements. Compressed elements are not rounded to an eight-byte boundary. */
function tag(bytes: Uint8Array, at: number, little: boolean): Tag {
  if (at + 8 > bytes.length) nativeFail('MAT_TAG', 'MAT tag가 잘렸습니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), smallType = view.getUint16(at, little), smallSize = view.getUint16(at + 2, little);
  if (smallType && smallSize >= 1 && smallSize <= 4) { if (smallType > 18) nativeFail('MAT_TAG', '잘못된 small MAT tag입니다.'); return { type: smallType, data: bytes.subarray(at + 4, at + 4 + smallSize), offset: at, next: at + 8 }; }
  const type = view.getUint32(at, little), size = view.getUint32(at + 4, little), end = at + 8 + size, next = type === 15 ? end : at + 8 + Math.ceil(size / 8) * 8;
  if (type < 1 || type > 18 || end > bytes.length || next > bytes.length) nativeFail('MAT_TAG', 'MAT element 크기 또는 tag 형식이 잘못되었습니다.');
  return { type, data: bytes.subarray(at + 8, end), offset: at, next };
}
function integerVector(element: Tag, little: boolean): number[] {
  if (element.type !== 5 || element.data.length % 4) nativeFail('MAT_DIMENSIONS', 'MAT 차원은 miINT32 배열이어야 합니다.'); const view = new DataView(element.data.buffer, element.data.byteOffset, element.data.byteLength), result: number[] = [];
  if (element.data.length > 32) nativeFail('MAT_DIMENSIONS', 'MAT 차원 rank가 상한을 넘습니다.'); for (let at = 0; at < element.data.length; at += 4) result.push(view.getInt32(at, little)); return result;
}
function numericValues(element: Tag, little: boolean, count: number): number[] | undefined {
  const width: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 9: 8 }, size = width[element.type]; if (!size) return undefined;
  if (element.data.length !== count * size) nativeFail('MAT_DATA_SIZE', 'MAT 값 개수와 차원이 일치하지 않습니다.'); const view = new DataView(element.data.buffer, element.data.byteOffset, element.data.byteLength), values: number[] = [];
  for (let at = 0; at < element.data.length; at += size) { const value = element.type === 1 ? view.getInt8(at) : element.type === 2 ? view.getUint8(at) : element.type === 3 ? view.getInt16(at, little) : element.type === 4 ? view.getUint16(at, little) : element.type === 5 ? view.getInt32(at, little) : element.type === 6 ? view.getUint32(at, little) : view.getFloat64(at, little); values.push(value); } return values;
}
export async function inspectMatV5(bytes: Uint8Array): Promise<NativeMatVariable[]> {
  if (bytes.length < 128) nativeFail('MAT_HEADER', 'MAT Level 5 헤더가 잘렸습니다.'); const header = nativeUtf8(bytes.subarray(0, 116)).replace(/\0/g, '').trim();
  if (!header.startsWith('MATLAB 5.0 MAT-file')) nativeFail('MAT_VERSION_UNSUPPORTED', 'MAT Level 5 파일만 지원합니다. v4·v7.3/HDF5는 별도 형식입니다.');
  const marker = String.fromCharCode(bytes[126], bytes[127]); if (!['IM', 'MI'].includes(marker)) nativeFail('MAT_ENDIAN', 'MAT endian 표식이 잘못되었습니다.'); const little = marker === 'IM', view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(124, little) !== 0x100) nativeFail('MAT_VERSION_UNSUPPORTED', 'MAT Level 5 version 0x0100만 지원합니다.');
  const result: NativeMatVariable[] = [], names = new Set<string>(); let expanded = 0;
  const matrix = (element: Tag, member?: string) => {
    let at = 0; const flags = tag(element.data, at, little); at = flags.next;
    if (flags.type !== 6 || flags.data.length !== 8) nativeFail('MAT_FLAGS', 'MAT array flags가 잘못되었습니다.'); const flagsView = new DataView(flags.data.buffer, flags.data.byteOffset, flags.data.byteLength), flag = flagsView.getUint32(0, little), klass = flag & 255;
    const dimensionsElement = tag(element.data, at, little); at = dimensionsElement.next; const dimensions = integerVector(dimensionsElement, little);
    if (dimensions.length < 2 || dimensions.some(n => n < 0)) nativeFail('MAT_DIMENSIONS', 'MAT 차원이 잘못되었습니다.');
    const nameElement = tag(element.data, at, little); at = nameElement.next; if (![1, 16].includes(nameElement.type) || !nameElement.data.length || nameElement.data.length > 256) nativeFail('MAT_NAME', '이름 있는 MAT 변수만 읽습니다.'); const name = nativeUtf8(nameElement.data);
    if (/[\u0000-\u001f\u007f]/.test(name) || names.has(name)) nativeFail('MAT_NAME', '중복 또는 잘못된 MAT 변수 이름입니다.'); names.add(name);
    const location = { offset: element.offset, ...(member ? { member } : {}), path: name }, variable: NativeMatVariable = { name, dimensions, location, supported: false };
    if (result.length >= NATIVE_IMPORT_LIMITS.maxMatVariables) nativeFail('MAT_VARIABLE_LIMIT', 'MAT 변수는 64개 이하여야 합니다.');
    let reason = klass !== 6 ? 'mxDOUBLE dense 실수 배열이 아닙니다.' : flag & 0xa00 ? 'complex·logical 배열은 지원하지 않습니다.' : dimensions.length !== 2 ? '2차원 배열만 지원합니다.' : '';
    const count = dimensions.reduce((n, x) => n * x, 1); if (!Number.isSafeInteger(count)) nativeFail('MAT_DIMENSIONS', 'MAT 차원 곱이 너무 큽니다.');
    if (!reason && (dimensions[0] < 2 || dimensions[0] > DATASET_LIMITS.maxRows || dimensions[1] < 2 || dimensions[1] > DATASET_LIMITS.maxColumns || count > DATASET_LIMITS.maxCells)) reason = '2~4,000행·2~16열·20,000셀 데이터표 상한을 확인하세요.';
    if (!reason) { const real = tag(element.data, at, little); at = real.next; const values = numericValues(real, little, count); if (!values) reason = '이 mxDOUBLE real-storage tag는 선택 profile에서 지원하지 않습니다.'; else if (values.some(v => !Number.isFinite(v))) reason = 'NaN·Infinity 값은 데이터표에 사용할 수 없습니다.'; else if (values.some(v => Object.is(v, -0))) reason = 'signed zero(-0)는 기존 JSON 데이터표가 보존하지 못하므로 선택 변환을 지원하지 않습니다. 원본 bytes는 보관할 수 있습니다.'; else { const rows = Array.from({ length: dimensions[0] }, (_, row) => Array.from({ length: dimensions[1] }, (_, col) => values[col * dimensions[0] + row])); if (rows.some((row, index) => Math.abs(row[0]) > 1e9 || index > 0 && row[0] <= rows[index - 1][0])) reason = '첫 열 시각은 유한하고 중복 없이 증가해야 합니다.'; else { variable.supported = true; variable.rows = rows; } } if (at !== element.data.length) reason = '선택 real-double 배열에 추가 data element가 있습니다.'; }
    if (reason) { variable.supported = false; delete variable.rows; variable.reason = reason; } result.push(variable);
  };
  for (let at = 128; at < bytes.length;) {
    const element = tag(bytes, at, little); at = element.next;
    if (element.type === 15) { const decoded = await inflateBounded(element.data, 'deflate', NATIVE_IMPORT_LIMITS.maxExpandedBytes - expanded); expanded += decoded.length; const inner = tag(decoded, 0, little); if (inner.type !== 14 || inner.next !== decoded.length) nativeFail('MAT_COMPRESSED', '압축 element는 하나의 miMATRIX여야 합니다.'); matrix(inner, `miCOMPRESSED@${element.offset}`); }
    else if (element.type === 14) { expanded += element.next - element.offset; if (expanded > NATIVE_IMPORT_LIMITS.maxExpandedBytes) nativeFail('NATIVE_EXPANSION_LIMIT', 'MAT 전체 압축 해제 크기가 8 MiB 상한을 넘었습니다.'); matrix(element); } else nativeFail('MAT_ELEMENT_UNSUPPORTED', 'MAT 최상위 miMATRIX·miCOMPRESSED만 지원합니다.');
  }
  if (!result.length) nativeFail('MAT_EMPTY', 'MAT 파일에 이름 있는 변수가 없습니다.'); return result;
}
