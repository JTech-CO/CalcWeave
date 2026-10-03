import { z } from 'zod';
import { canonicalSemantic, ModelError, sha256, type Dataset } from '../../model/src';
import { importDataset } from '../../data/src';
import { nativeFail, nativeUtf8, rawSha256 } from './bounded-format';
import { inspectMatV5 } from './mat-v5';
import { convertNativeModel } from './native-model';
import { NATIVE_IMPORT_LIMITS, nativeReport, type InteropArchiveInspection, type NativeFormat, type NativeImportOptions, type NativeInspection } from './native-types';

export * from './native-types';
export { rawSha256 } from './bounded-format';
export function nativeFormat(filename: string): NativeFormat {
  if (/\.mat$/i.test(filename)) return 'mat-v5'; if (/\.slx$/i.test(filename)) return 'slx'; if (/\.mdl$/i.test(filename)) return 'mdl'; return nativeFail('NATIVE_FORMAT', 'MAT Level 5·SLX·MDL 파일을 선택하세요.');
}
function validateOptions(options: NativeImportOptions): NativeImportOptions {
  if (!options || typeof options !== 'object' || Array.isArray(options) || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) nativeFail('NATIVE_INPUTS', 'Inport 설정은 일반 JSON 객체여야 합니다.');
  const own = Object.getOwnPropertyDescriptors(options); if (Reflect.ownKeys(own).some(key => key !== 'inports' || !('value' in own[key]!))) nativeFail('NATIVE_INPUTS', 'Inport 설정에는 접근자·추가 필드를 사용할 수 없습니다.');
  if (own.inports) { const values = own.inports.value; if (!values || typeof values !== 'object' || Array.isArray(values) || ![Object.prototype, null].includes(Object.getPrototypeOf(values))) nativeFail('NATIVE_INPUTS', '입력 값은 일반 객체여야 합니다.'); const props = Object.getOwnPropertyDescriptors(values); if (Reflect.ownKeys(props).length > 16 || Reflect.ownKeys(props).some(key => typeof key !== 'string' || !('value' in props[key]!) || typeof props[key]!.value !== 'number' || !Number.isFinite(props[key]!.value))) nativeFail('NATIVE_INPUTS', '입력은 접근자 없는 16개 이하의 유한 숫자여야 합니다.'); }
  const parsed = z.object({ inports: z.record(z.string().max(256), z.number().finite()).refine(values => Object.keys(values).length <= 16).optional() }).strict().safeParse(options);
  if (!parsed.success) nativeFail('NATIVE_INPUTS', 'Inport 설정은 최대 16개의 유한 scalar 입력이어야 합니다.'); if (Object.values(parsed.data.inports ?? {}).some(value => Object.is(value, -0))) nativeFail('NATIVE_INPUT_SIGNED_ZERO', 'signed zero(-0)는 기존 JSON scalar 입력으로 정확히 보존할 수 없습니다.'); return parsed.data;
}
/** Inspect only. Does not evaluate MATLAB, callbacks, native modules, XML or imported JavaScript. */
export async function inspectNativeImport(input: Uint8Array, filename: string, options: NativeImportOptions = {}): Promise<NativeInspection> {
  if (!(input instanceof Uint8Array) || input.byteLength > NATIVE_IMPORT_LIMITS.maxInputBytes) nativeFail('NATIVE_SIZE', 'native 원본은 2 MiB 이하여야 합니다.');
  if (typeof filename !== 'string' || filename.length > 256 || /[\u0000-\u001f]/.test(filename)) nativeFail('NATIVE_FILENAME', '원본 파일명은 제어 문자 없는 256자 이하여야 합니다.');
  const format = nativeFormat(filename), sourceBytes = new Uint8Array(input), sourceHash = await rawSha256(sourceBytes), safeOptions = validateOptions(options);
  const inspection: NativeInspection = { filename, format, sourceBytes, sourceHash, options: safeOptions, report: nativeReport(format), inports: [], variables: [], locations: [] };
  try {
    if (format === 'mat-v5') { inspection.variables = await inspectMatV5(sourceBytes); inspection.locations = inspection.variables.map(variable => ({ kind: 'variable', nativeId: variable.name, location: variable.location })); inspection.report.assumptions = ['CalcWeave 데이터표: N행×K열, 첫 열 시각(s), 나머지 열은 단위 1의 유한 float64 신호입니다.', 'Simulink From File의 첫 행 시각 profile과 다릅니다. 변수명·열 우선 저장을 해석하며 변환 뒤 시각·값을 표로 보관합니다.']; for (const variable of inspection.variables) if (!variable.supported) inspection.report.issues.push({ code: 'MAT_VARIABLE_UNSUPPORTED', severity: 'unsupported', message: variable.reason!, location: variable.location, nativeId: variable.name }); }
    else Object.assign(inspection, await convertNativeModel(sourceBytes, format, safeOptions));
  } catch (error) { inspection.report.parse = 'failed'; inspection.report.execution = 'unsupported'; inspection.report.graphCompile = 'not-applicable'; inspection.report.issues = (error instanceof ModelError ? error.diagnostics : [{ code: 'NATIVE_PARSE', message: '외부 파일을 해석하지 못했습니다.' }]).map(item => ({ code: item.code, message: item.message, severity: 'unsupported', location: { offset: 0 } })); }
  return inspection;
}
export function matVariableDataset(inspection: NativeInspection, name: string): Dataset {
  const variable = inspection.variables.find(item => item.name === name); if (inspection.format !== 'mat-v5' || inspection.report.parse !== 'passed' || !variable?.supported || !variable.rows) nativeFail('MAT_SELECTION', '지원되는 MAT 변수의 첫 열 시각 profile을 선택하세요.');
  const columns = variable.dimensions[1], names = ['time', ...Array.from({ length: columns - 1 }, (_, index) => `signal${index + 1}`)], data = variable.rows.map(row => Object.fromEntries(names.map((key, index) => [key, row[index]])));
  const dataset = importDataset(JSON.stringify(data), { format: 'json', id: `Mat${sha256(name).slice(0, 12)}`, name: name.slice(0, 100), timeColumn: 'time', columns: names.map((key, index) => ({ name: key, kind: 'number', unit: index === 0 ? 's' : '1' })) });
  // The strict model dataset contract remains unchanged. Original-format provenance lives in the archive/report.
  return { ...dataset, sourceHash: inspection.sourceHash, provenance: { format: 'mat-v5', filename: inspection.filename.slice(0, 100), sheet: variable.name.slice(0, 80), sourceHash: inspection.sourceHash, transforms: ['column-major-to-table', 'first-column-time-seconds', 'signal-unit-1'] } };
}
function base64(bytes: Uint8Array): string { let text = ''; for (let at = 0; at < bytes.length; at += 32_768) text += String.fromCharCode(...bytes.subarray(at, at + 32_768)); return btoa(text); }
function fromBase64(value: string, length: number): Uint8Array { if (value.length !== Math.ceil(length / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) nativeFail('INTEROP_BASE64', '원본 base64 길이와 형식이 일치하지 않습니다.'); let decoded: string; try { decoded = atob(value); } catch { return nativeFail('INTEROP_BASE64', '원본 base64를 읽지 못했습니다.'); } const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0)); if (bytes.length !== length || base64(bytes) !== value) nativeFail('INTEROP_BASE64', '원본 base64는 canonical encoding이어야 합니다.'); return bytes; }
function canonical(value: unknown): string { const visit = (item: unknown): unknown => item && typeof item === 'object' ? Array.isArray(item) ? item.map(visit) : Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, visit(val)])) : item; return JSON.stringify(visit(value)); }
function boundArchive(text: string): void { if (text.length > NATIVE_IMPORT_LIMITS.maxArchiveBytes || new TextEncoder().encode(text).byteLength > NATIVE_IMPORT_LIMITS.maxArchiveBytes) nativeFail('INTEROP_ARCHIVE_SIZE', '상호운용 보관 파일은 5 MiB 이하여야 합니다.'); let depth = 0, quoted = false, escaped = false; for (const ch of text) { if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; } else if (ch === '"') quoted = true; else if (ch === '{' || ch === '[') { if (++depth > 32) nativeFail('INTEROP_ARCHIVE_DEPTH', '보관 파일 중첩 깊이가 상한을 넘었습니다.'); } else if (ch === '}' || ch === ']') depth--; } }
export async function createInteropArchive(inspection: NativeInspection, selectedVariable?: string): Promise<string> {
  const current = await inspectNativeImport(inspection.sourceBytes, inspection.filename, inspection.options);
  const dataset = selectedVariable ? matVariableDataset(current, selectedVariable) : undefined, model = current.model;
  const archive = { format: 'calcweave-interop', version: 1, source: { filename: current.filename, format: current.format, byteLength: current.sourceBytes.length, sha256: current.sourceHash, encoding: 'base64', bytes: base64(current.sourceBytes) }, options: current.options, report: current.report, locations: current.locations, ...(model ? { convertedModel: model, convertedModelHash: sha256(canonicalSemantic(model)), convertedModelFileHash: sha256(canonical(model)) } : {}), ...(dataset ? { selectedVariable, convertedDataset: dataset, convertedDatasetHash: sha256(canonical(dataset)) } : {}) };
  const text = JSON.stringify(archive, null, 2); boundArchive(text); return text;
}
/** Archive claims are never trusted: verify raw bytes, reparse and compare every derived report/model value. */
export async function inspectInteropArchive(text: string): Promise<InteropArchiveInspection> {
  boundArchive(text); let value: unknown; try { value = JSON.parse(text); } catch { return nativeFail('INTEROP_ARCHIVE_JSON', '상호운용 보관 JSON이 잘못되었습니다.'); }
  const schema = z.object({ format: z.literal('calcweave-interop'), version: z.literal(1), source: z.object({ filename: z.string().min(1).max(256), format: z.enum(['mat-v5', 'slx', 'mdl']), byteLength: z.number().int().min(0).max(NATIVE_IMPORT_LIMITS.maxInputBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/), encoding: z.literal('base64'), bytes: z.string().max(Math.ceil(NATIVE_IMPORT_LIMITS.maxInputBytes / 3) * 4) }).strict(), options: z.unknown(), report: z.unknown(), locations: z.unknown(), convertedModel: z.unknown().optional(), convertedModelHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), convertedModelFileHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), selectedVariable: z.string().max(256).optional(), convertedDataset: z.unknown().optional(), convertedDatasetHash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().safeParse(value);
  if (!schema.success) nativeFail('INTEROP_ARCHIVE_SCHEMA', '상호운용 보관 파일의 선언 계약을 확인하세요.'); const archive = schema.data, bytes = fromBase64(archive.source.bytes, archive.source.byteLength);
  if (await rawSha256(bytes) !== archive.source.sha256 || nativeFormat(archive.source.filename) !== archive.source.format) nativeFail('INTEROP_SOURCE_HASH', '원본 bytes의 SHA-256 또는 파일 형식이 일치하지 않습니다.');
  const inspection = await inspectNativeImport(bytes, archive.source.filename, validateOptions(archive.options as NativeImportOptions));
  if (canonical(archive.report) !== canonical(inspection.report)) nativeFail('INTEROP_REPORT_MISMATCH', '저장된 보고서와 원본을 다시 해석한 보고서가 다릅니다.');
  if (canonical(archive.locations) !== canonical(inspection.locations)) nativeFail('INTEROP_LOCATION_MISMATCH', '저장된 원본 위치·ID 대응표가 재해석 결과와 다릅니다.');
  if (inspection.model) { if (canonical(archive.convertedModel) !== canonical(inspection.model) || archive.convertedModelHash !== sha256(canonicalSemantic(inspection.model)) || archive.convertedModelFileHash !== sha256(canonical(inspection.model))) nativeFail('INTEROP_MODEL_MISMATCH', '변환 모델·semantic hash·파일 hash가 재해석 결과와 다릅니다.'); }
  else if (archive.convertedModel !== undefined || archive.convertedModelHash !== undefined || archive.convertedModelFileHash !== undefined) nativeFail('INTEROP_MODEL_MISMATCH', '실행 미지원 원본에 모델을 추가할 수 없습니다.');
  const dataset = archive.selectedVariable ? matVariableDataset(inspection, archive.selectedVariable) : undefined;
  if (dataset ? canonical(archive.convertedDataset) !== canonical(dataset) || archive.convertedDatasetHash !== sha256(canonical(dataset)) : archive.convertedDataset !== undefined || archive.convertedDatasetHash !== undefined) nativeFail('INTEROP_DATASET_MISMATCH', '변환 데이터표와 재해석 결과가 다릅니다.');
  return { inspection, ...(dataset ? { selectedVariable: archive.selectedVariable, dataset } : {}) };
}
export function originalNativeFile(inspection: NativeInspection): Uint8Array { return new Uint8Array(inspection.sourceBytes); }
