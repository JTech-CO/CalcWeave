import { ModelError, type IRNode, type SignalValue, type TypedFloat, type TypedSignal } from '../../model/src/types';
import { validateDataType, validateTypedSignal } from '../../model/src/typed';
import { copyAnySignal } from '../../model/src/structured';

const m13Failure = (code: string, nodeId: string, message: string): never => { throw new ModelError([{ code, nodeId, message }]); };
export interface M13FormatToken { literal?: string; kind?: 's' | 'c' | 'd' | 'u' | 'f' | 'e' | 'g'; precision?: number; dtype?: 'string' | 'float64' | 'float32' | 'int32' | 'uint32' }
export interface M13ControlEvent { time: number; order: number; value: number | boolean }
export interface M13ControlReceipt { nodeId: string; time: number; order: number; value: number }
export interface M13LiveEvent { nodeId: string; value: number }
export interface M13RecordEntry { time: number; value: SignalValue }
export interface M13Memory { m13Records?: M13RecordEntry[]; m13RecordTick?: number }
export const M13_STATE_BLOCKS = new Set(['sink.record', 'sink.xy-graph', 'data.output-file', 'data.output-dataset']);
export const M13_CONTROL_BLOCKS = new Set(['dashboard.control', 'math.slider-gain']);

export function m13StringSignal(text: string, id: string): TypedSignal {
  if (text.length > 256) m13Failure('M13_STRING_BUDGET', id, '문자열은 기존 tagged 계약의 UTF-16 256단위를 초과할 수 없습니다.');
  m13CodePoints(text, id);
  return { kind: 'typed', dtype: 'string', shape: [], data: [text] };
}
export function m13CodePoints(text: string, id: string): string[] {
  const points = Array.from(text);
  if (points.some(point => point.length === 1 && point.charCodeAt(0) >= 0xd800 && point.charCodeAt(0) <= 0xdfff)) m13Failure('M13_UNICODE', id, '문자열에 짝이 없는 UTF-16 surrogate가 있습니다.');
  return points;
}
export function m13ReadString(value: SignalValue, id: string): string {
  const typed = validateTypedSignal(value);
  if (typed.dtype !== 'string' || typed.shape.length) m13Failure('M13_STRING_TYPE', id, 'scalar tagged string 신호가 필요합니다.');
  const text = typed.data[0] as string; m13CodePoints(text, id); return text;
}
const m13Fold = (points: string[], insensitive: boolean): string[] => insensitive ? points.map(point => { const code = point.codePointAt(0)!; return code >= 65 && code <= 90 ? String.fromCodePoint(code + 32) : point; }) : points;
export function m13Find(text: string, pattern: string, id: string, insensitive = false): number {
  const source = m13Fold(m13CodePoints(text, id), insensitive), target = m13Fold(m13CodePoints(pattern, id), insensitive);
  if (!target.length) return 1;
  for (let start = 0; start <= source.length - target.length; start += 1) if (target.every((point, index) => point === source[start + index])) return start + 1;
  return -1;
}
export function m13Count(text: string, pattern: string, id: string, insensitive = false): number {
  const source = m13Fold(m13CodePoints(text, id), insensitive), target = m13Fold(m13CodePoints(pattern, id), insensitive);
  if (!target.length) return source.length + 1;
  let count = 0;
  for (let start = 0; start <= source.length - target.length;) { if (target.every((point, index) => point === source[start + index])) { count += 1; start += target.length; } else start += 1; }
  return count;
}
export function m13Integer(value: SignalValue, id: string): bigint {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'object' && !Array.isArray(value) && value.kind === 'typed') {
    const typed = validateTypedSignal(value);
    if (!typed.shape.length && /^(?:u?int)(?:8|16|32|64)$/.test(typed.dtype)) return BigInt(typed.data[0] as string);
  }
  return m13Failure('M13_INTEGER_TYPE', id, '정확한 builtin integer scalar 또는 안전 정수 legacy scalar가 필요합니다.');
}
export function m13Substring(text: string, start: bigint, length: bigint | undefined, id: string): string {
  if (start < 1n || start > 4294967295n || length !== undefined && (length < 0n || length > 4294967295n)) m13Failure('M13_STRING_INDEX', id, '부분문자열 시작은 1 이상의 uint32 범위이며 길이는 0 이상의 uint32 범위여야 합니다.');
  const points = m13CodePoints(text, id); return points.slice(Number(start - 1n), length === undefined ? undefined : Number(start - 1n + length)).join('');
}
export function m13ASCIIToString(value: SignalValue, id: string): TypedSignal {
  const typed = validateTypedSignal(value);
  if (typed.dtype !== 'uint8' || typed.shape.length !== 1 || typed.data.length > 256) m13Failure('M13_ASCII_TYPE', id, 'ASCII에는 길이 1~256의 tagged uint8 vector가 필요합니다.');
  const codes = typed.data.map(cell => Number(cell));
  if (codes.some(code => code > 127)) m13Failure('M13_ASCII_RANGE', id, 'ASCII 변환의 승인 범위는 0~127입니다.');
  const end = codes.indexOf(0); return m13StringSignal(String.fromCharCode(...codes.slice(0, end < 0 ? undefined : end)), id);
}
export function m13StringToASCII(text: string, capacity: number, id: string): TypedSignal {
  const codes = m13CodePoints(text, id).map(point => point.codePointAt(0)!);
  if (codes.some(code => code > 127)) m13Failure('M13_ASCII_RANGE', id, 'ASCII 출력에는 0~127 문자만 사용할 수 있습니다.');
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 256 || codes.length > capacity) m13Failure('M13_ASCII_CAPACITY', id, 'ASCII 고정 출력 크기가 문자열보다 짧거나 1~256 범위를 벗어났습니다.');
  return { kind: 'typed', dtype: 'uint8', shape: [capacity], data: [...codes.map(String), ...Array(capacity - codes.length).fill('0') as string[]] };
}
const m13EncodeFloat = (value: number): TypedFloat => Number.isNaN(value) ? 'NaN' : value === Infinity ? 'Infinity' : value === -Infinity ? '-Infinity' : Object.is(value, -0) ? '-0' : value;
const m13DecodeFloat = (value: TypedFloat): number => value === '-0' ? -0 : value === 'NaN' ? NaN : value === 'Infinity' ? Infinity : value === '-Infinity' ? -Infinity : value;
export function m13ParseNumber(text: string, dtype: 'float64' | 'float32', id: string, invalid: 'error' | 'zero' = 'error', special: 'error' | 'preserve' = 'error'): TypedSignal {
  const literal = text.trim(), valid = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/.test(literal), tagged = /^(?:NaN|[+-]?Infinity)$/.test(literal);
  const error = (): TypedSignal => invalid === 'zero' ? { kind: 'typed', dtype, shape: [], data: [0] } : m13Failure('M13_NUMBER_PARSE', id, '전체 문자열이 유효한 decimal 숫자여야 합니다.');
  if (!valid && !(tagged && special === 'preserve')) return error();
  let number = Number(literal);
  if (valid && !Number.isFinite(number) || special === 'error' && !Number.isFinite(number)) return error();
  const nonzero = /[1-9]/.test(literal.split(/[eE]/)[0]!);
  if (valid && number === 0 && nonzero) return error();
  if (dtype === 'float32') { const rounded = Math.fround(number); if (Number.isFinite(number) && (!Number.isFinite(rounded) || number !== 0 && rounded === 0)) return error(); number = rounded; }
  return { kind: 'typed', dtype, shape: [], data: [m13EncodeFloat(number)] };
}
function m13ScalarNumber(value: SignalValue, id: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'object' && !Array.isArray(value) && value.kind === 'typed') {
    const typed = validateTypedSignal(value); if (!typed.shape.length && (typed.dtype === 'float32' || typed.dtype === 'float64')) return m13DecodeFloat(typed.data[0] as TypedFloat);
  }
  return m13Failure('M13_FLOAT_TYPE', id, 'float64 또는 float32 scalar가 필요합니다.');
}
export function m13ToString(value: SignalValue, id: string): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? '-0' : String(value);
  const typed = validateTypedSignal(value);
  if (typed.shape.length) m13Failure('M13_SCALAR_TYPE', id, '문자열 변환에는 scalar가 필요합니다.');
  const cell = typed.data[0]!;
  if (typed.dtype === 'string' || typed.dtype === 'enum') return cell as string;
  if (typed.dtype === 'boolean') return cell ? 'true' : 'false';
  if (typed.dtype === 'float64' || typed.dtype === 'float32') return String(m13EncodeFloat(m13DecodeFloat(cell as TypedFloat)));
  if (/^(?:u?int)(?:8|16|32|64)$/.test(typed.dtype)) return cell as string;
  if (typed.dtype === 'fixed') {
    const code = BigInt(cell as string), fraction = typed.fixed!.fractionLength;
    if (fraction <= 0) return String(code << BigInt(-fraction));
    const negative = code < 0n, digits = String((negative ? -code : code) * 5n ** BigInt(fraction)).padStart(fraction + 1, '0');
    return `${negative ? '-' : ''}${digits.slice(0, -fraction)}.${digits.slice(-fraction)}`.replace(/0+$/, '').replace(/\.$/, '');
  }
  return m13Failure('M13_SCALAR_TYPE', id, '복소수나 structured 신호의 암묵적 문자열 변환은 지원하지 않습니다.');
}
export function m13Compose(tokens: M13FormatToken[], input: (index: number) => SignalValue, id: string): TypedSignal {
  let index = 0;
  const text = tokens.map(token => {
    if (token.literal !== undefined) return token.literal;
    const value = input(++index);
    if (token.kind === 's') return m13ReadString(value, id);
    if (token.kind === 'd' || token.kind === 'u') { const integer = m13Integer(value, id); if (token.kind === 'u' && integer < 0n) m13Failure('M13_FORMAT_TYPE', id, '%u에는 음수 값을 사용할 수 없습니다.'); return String(integer); }
    const number = m13ScalarNumber(value, id), precision = token.precision ?? 6;
    if (!Number.isFinite(number)) return String(m13EncodeFloat(number));
    const signed = Object.is(number, -0), absolute = signed ? 0 : number;
    const general = (): string => {
      const [mantissa, exponentText] = absolute.toExponential(precision - 1).split('e'), exponent = Number(exponentText), trim = (digits: string): string => digits.includes('.') ? digits.replace(/0+$/, '').replace(/\.$/, '') : digits;
      if (exponent < -4 || exponent >= precision) return `${trim(mantissa!)}e${exponent >= 0 ? '+' : '-'}${String(Math.abs(exponent)).padStart(2, '0')}`;
      const negative = mantissa!.startsWith('-'), digits = mantissa!.replace('-', '').replace('.', ''), point = exponent + 1;
      const expanded = point <= 0 ? `0.${'0'.repeat(-point)}${digits}` : point >= digits.length ? digits + '0'.repeat(point - digits.length) : `${digits.slice(0, point)}.${digits.slice(point)}`;
      return `${negative ? '-' : ''}${trim(expanded)}`;
    };
    const formatted = token.kind === 'f' ? Math.abs(absolute) >= 1e21 ? `${BigInt(absolute)}${precision ? `.${'0'.repeat(precision)}` : ''}` : absolute.toFixed(precision) : token.kind === 'e' ? absolute.toExponential(precision) : general();
    return `${signed ? '-' : ''}${formatted.replace(/e([+-])(\d)$/, (_match, sign: string, digit: string) => `e${sign}0${digit}`)}`;
  }).join('');
  return m13StringSignal(text, id);
}
export function m13Scan(tokens: M13FormatToken[], text: string, id: string, invalid: 'error' | 'zero' = 'error'): Record<string, SignalValue> {
  let cursor = 0, output = 0; const result: Record<string, SignalValue> = {};
  try {
  for (const token of tokens) {
    if (token.literal !== undefined) {
      for (const point of m13CodePoints(token.literal, id)) { if (/\s/.test(point)) { const spaces = /^\s*/.exec(text.slice(cursor))![0]; cursor += spaces.length; } else { if (!text.startsWith(point, cursor)) m13Failure('M13_SCAN_MATCH', id, 'Scan의 literal 부분이 입력과 일치하지 않습니다.'); cursor += point.length; } }
      continue;
    }
    if (token.kind !== 'c') cursor += /^\s*/.exec(text.slice(cursor))![0].length;
    let literal = '';
    if (token.kind === 'c') { literal = m13CodePoints(text.slice(cursor), id)[0] ?? ''; if (!literal) m13Failure('M13_SCAN_MATCH', id, '%c가 읽을 문자가 없습니다.'); }
    else if (token.kind === 's') { literal = /^\S+/.exec(text.slice(cursor))?.[0] ?? ''; if (!literal) m13Failure('M13_SCAN_MATCH', id, '%s가 읽을 문자열이 없습니다.'); }
    else { literal = (token.kind === 'd' || token.kind === 'u' ? /^[+-]?\d+/ : /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?|^(?:NaN|[+-]?Infinity)/).exec(text.slice(cursor))?.[0] ?? ''; if (!literal) m13Failure('M13_SCAN_MATCH', id, 'Scan이 숫자 필드와 일치하지 않습니다.'); }
    cursor += literal.length;
    let value: TypedSignal;
    if (token.kind === 's' || token.kind === 'c') value = m13StringSignal(literal, id);
    else if (token.kind === 'd' || token.kind === 'u') { try { value = validateTypedSignal({ kind: 'typed', dtype: token.kind === 'd' ? 'int32' : 'uint32', shape: [], data: [String(BigInt(literal))] }); } catch { return m13Failure('M13_SCAN_RANGE', id, 'Scan integer 필드가 승인 자료형 범위를 벗어났습니다.'); } }
    else value = m13ParseNumber(literal, token.dtype === 'float64' ? 'float64' : 'float32', id, 'error', 'preserve');
    result[`out${++output}`] = value;
  }
  if (text.slice(cursor).trim()) m13Failure('M13_SCAN_MATCH', id, 'Scan 뒤에 해석하지 않은 문자열이 남았습니다.');
  } catch (error) {
    if (invalid !== 'zero' || !(error instanceof ModelError) || error.diagnostics.some(item => !['M13_SCAN_MATCH', 'M13_SCAN_RANGE', 'M13_NUMBER_PARSE'].includes(item.code))) throw error;
    const fields = tokens.filter(token => token.kind);
    for (let index = output; index < fields.length; index += 1) {
      const dtype = fields[index]!.dtype!;
      result[`out${index + 1}`] = { kind: 'typed', dtype, shape: [], data: [dtype === 'string' ? '' : dtype === 'int32' || dtype === 'uint32' ? '0' : 0] };
    }
  }
  return result;
}
export function m13ValidateControlValue(node: IRNode, value: unknown): number {
  const p = node.parameters;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < Number(p.min) || value > Number(p.max)) return m13Failure('M13_CONTROL_VALUE', node.id, '제어 값이 유한한 범위 안에 있어야 합니다.');
  const step = Number(p.step), grid = (value - Number(p.min)) / step;
  if (!(step > 0) || !Number.isFinite(grid) || Math.abs(grid - Math.round(grid)) > 1e-9 * Math.max(1, Math.abs(grid))) return m13Failure('M13_CONTROL_VALUE', node.id, '제어 값이 지정한 간격에 맞지 않습니다.');
  const options = p.choices as number[] | undefined;
  if (['check-box', 'combo-box', 'push-button', 'radio-button', 'rocker-switch', 'rotary-switch', 'slider-switch', 'toggle-switch'].includes(String(p.kind)) && (!options?.includes(value))) return m13Failure('M13_CONTROL_VALUE', node.id, '제어 값이 선택 목록에 없습니다.');
  return value === 0 ? 0 : value;
}
export function m13AppendControlEvent(node: IRNode, value: unknown, time: number): { controlEvents: M13ControlEvent[]; events: string; receipt: M13ControlReceipt } {
  if (!M13_CONTROL_BLOCKS.has(node.blockType) || !Number.isFinite(time)) return m13Failure('M13_CONTROL_TARGET', node.id, '승인한 live 제어와 유한한 승인 시각이 필요합니다.');
  const checked = m13ValidateControlValue(node, value), prior = node.parameters.controlEvents as M13ControlEvent[] ?? [];
  if (prior.length >= 256) return m13Failure('M13_CONTROL_BUDGET', node.id, '한 제어의 event log는 256개 이하여야 합니다.');
  const order = Math.max(-1, ...prior.map(event => event.order)) + 1;
  if (order > 1000000) return m13Failure('M13_CONTROL_BUDGET', node.id, '한 제어의 event order 상한을 초과했습니다.');
  const controlEvents = [...prior.map(event => ({ ...event })), { time, order, value: checked }].sort((a, b) => a.time - b.time || a.order - b.order);
  return { controlEvents, events: JSON.stringify(controlEvents), receipt: { nodeId: node.id, time, order, value: checked } };
}
export function m13ControlValue(node: IRNode, time: number): number | boolean {
  let value = (node.blockType === 'math.slider-gain' ? node.parameters.gain : node.parameters.initial) as number | boolean;
  for (const event of node.parameters.controlEvents as M13ControlEvent[] ?? []) if (event.time <= time) value = event.value;
  return typeof value === 'number' && value === 0 ? 0 : value;
}
export function m13StopRequest(nodes: IRNode[], values: Map<string, Record<string, SignalValue>>): string | undefined {
  const requested = nodes.filter(node => { if (node.blockType !== 'sink.stop') return false; const endpoint = node.inputs.in!, value = values.get(endpoint.nodeId)?.[endpoint.portId]; return typeof value === 'boolean' ? value : typeof value === 'number' && Number.isFinite(value) && value !== 0; }).map(node => node.id).sort();
  return requested[0];
}
export function m13InitialMemory(_node: IRNode): M13Memory { return { m13Records: [], m13RecordTick: -1 }; }
export function m13InitialOutput(node: IRNode, _memory: M13Memory): Record<string, SignalValue> { return { out: copyAnySignal(node.parameters.recordInitial as SignalValue) }; }
export function m13Read(node: IRNode, memory: M13Memory, input: (port: string) => SignalValue, tick: number, time: number): { outputs: Record<string, SignalValue>; publicationMemory?: M13Memory } {
  if (memory.m13RecordTick === tick) return { outputs: { out: copyAnySignal(memory.m13Records?.at(-1)?.value ?? node.parameters.recordInitial as SignalValue) } };
  const records = memory.m13Records ?? [];
  if (records.length >= Number(node.parameters.capacity)) return m13Failure('M13_RECORD_CAPACITY', node.id, '승인된 기록 샘플 상한을 초과했습니다.');
  let value: SignalValue;
  if (node.blockType === 'sink.xy-graph') { const x = input('x'), y = input('y'); if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return m13Failure('M13_XY_TYPE', node.id, 'XY 기록에는 두 유한 legacy 실수 scalar가 필요합니다.'); value = { kind: 'bus', fields: [{ name: 'x', value: x }, { name: 'y', value: y }] }; }
  else value = copyAnySignal(input('in'));
  return { outputs: { out: copyAnySignal(value) }, publicationMemory: { m13RecordTick: tick, m13Records: [...records, { time, value }] } };
}
export function m13Commit(_node: IRNode, memory: M13Memory): M13Memory { return memory; }
export function m13OperationCost(node: IRNode, inputSize: number, outputSize: number): number | undefined {
  if (node.blockType.startsWith('string.') || node.blockType === 'source.string-constant') return Math.max(1, inputSize * 4 + outputSize * 4 + (['string.string-find', 'string.string-count', 'string.string-contains'].includes(node.blockType) ? 65536 : 2048));
  if (M13_CONTROL_BLOCKS.has(node.blockType)) return Math.max(1, inputSize + outputSize + ((node.parameters.controlEvents as M13ControlEvent[] | undefined)?.length ?? 0) * 4 + 16);
  if (M13_STATE_BLOCKS.has(node.blockType)) return Math.max(1, (inputSize + 1) * Number(node.parameters.capacity) + 16);
  if (node.blockType.startsWith('dashboard.') || ['sink.floating-scope', 'sink.stop', 'signal.probe', 'data.input-table', 'source.waveform', 'data.signal-editor', 'model.support-catalog'].includes(node.blockType)) return Math.max(1, inputSize + outputSize + 16);
  return undefined;
}

/** Compiler-selected strings, displays and deterministic source controls. */
export function evaluateM13Node(node: IRNode, input: (port: string) => SignalValue, time = 0): Record<string, SignalValue> | undefined {
  const p = node.parameters, read = (port = 'in') => m13ReadString(input(port), node.id), insensitive = p.caseSensitive === 'no';
  switch (node.blockType) {
    case 'source.string-constant': return { out: m13StringSignal(String(p.value), node.id) };
    case 'string.ascii-to-string': return { out: m13ASCIIToString(input('in'), node.id) };
    case 'string.string-to-ascii': return { out: m13StringToASCII(read(), Number(p.capacity), node.id), length: { kind: 'typed', dtype: 'uint32', shape: [], data: [String(m13CodePoints(read(), node.id).length)] } };
    case 'string.string-length': return { out: { kind: 'typed', dtype: 'uint32', shape: [], data: [String(m13CodePoints(read(), node.id).length)] } };
    case 'string.string-find': return { out: { kind: 'typed', dtype: 'int32', shape: [], data: [String(m13Find(read(), read('pattern'), node.id, insensitive))] } };
    case 'string.string-count': return { out: { kind: 'typed', dtype: 'uint32', shape: [], data: [String(m13Count(read(), read('pattern'), node.id, insensitive))] } };
    case 'string.string-contains': return { out: m13Find(read(), read('pattern'), node.id, insensitive) !== -1 };
    case 'string.string-compare': { const a = m13Fold(m13CodePoints(read('a'), node.id), insensitive), b = m13Fold(m13CodePoints(read('b'), node.id), insensitive), count = Number(p.firstN) || undefined; return { out: a.slice(0, count).join('') === b.slice(0, count).join('') }; }
    case 'string.string-concatenate': return { out: m13StringSignal(Array.from({ length: Number(p.count) }, (_, index) => read(`in${index + 1}`)).join(''), node.id) };
    case 'string.substring': return { out: m13StringSignal(m13Substring(read(), m13Integer(input('start'), node.id), p.toEnd === 'yes' ? undefined : m13Integer(input('length'), node.id), node.id), node.id) };
    case 'string.parse-number': return { out: m13ParseNumber(read(), p.dtype as 'float64' | 'float32', node.id, p.invalid as 'error' | 'zero', p.special as 'error' | 'preserve') };
    case 'string.parse-enum': { const target = validateDataType(p.type); if (target.dtype !== 'enum') return m13Failure('M13_ENUM_TYPE', node.id, '선언된 enum 자료형이 필요합니다.'); const text = read(); if (!target.enum!.labels.includes(text)) return m13Failure('M13_ENUM_PARSE', node.id, '문자열이 선언된 enum label과 일치하지 않습니다.'); return { out: { kind: 'typed', ...target, shape: [], data: [text] } }; }
    case 'string.to-string': { const value = input('in'); return { out: m13StringSignal(typeof value === 'number' || typeof value === 'object' && !Array.isArray(value) && value.kind === 'typed' && ['float64', 'float32'].includes(value.dtype) ? (m13Compose(p.formatTokens as M13FormatToken[], () => value, node.id).data[0] as string) : m13ToString(value, node.id), node.id) }; }
    case 'string.compose': return { out: m13Compose(p.formatTokens as M13FormatToken[], index => input(`arg${index}`), node.id) };
    case 'string.scan': return m13Scan(p.formatTokens as M13FormatToken[], read(), node.id, p.invalid as 'error' | 'zero');
    case 'dashboard.control': return { out: m13ControlValue(node, time) };
    case 'dashboard.action': return { out: (p.controlEvents as M13ControlEvent[] ?? []).some(event => event.value === true && event.time === time) };
    case 'dashboard.indicator': { const value = input('in'); if (typeof value !== 'number' || !Number.isFinite(value)) return m13Failure('M13_INDICATOR_TYPE', node.id, '표시 값은 유한한 legacy 실수 scalar여야 합니다.'); const band = (p.thresholds as number[]).filter(threshold => value >= threshold).length; return { out: value, band: { kind: 'typed', dtype: 'uint32', shape: [], data: [String(band)] } }; }
    case 'math.slider-gain': { const value = input('in'), gain = m13ControlValue(node, time); if (typeof gain !== 'number') return m13Failure('M13_CONTROL_TYPE', node.id, 'Slider Gain에는 numeric gain이 필요합니다.'); const scale = (cell: SignalValue): SignalValue => { if (Array.isArray(cell)) return cell.map(item => scale(item as SignalValue)) as SignalValue; if (typeof cell !== 'number' || !Number.isFinite(cell)) return m13Failure('M13_CONTROL_TYPE', node.id, 'Slider Gain에는 legacy 실수 scalar/vector/matrix가 필요합니다.'); const out = cell * gain; if (!Number.isFinite(out)) return m13Failure('NUMERIC_NONFINITE', node.id, 'Slider Gain 계산 결과가 유한하지 않습니다.'); return out; }; return { out: scale(value) }; }
    case 'sink.floating-scope': return { out: copyAnySignal(input('in')) };
    case 'sink.stop': { const value = input('in'); if (typeof value !== 'boolean' && typeof value !== 'number') return m13Failure('M13_STOP_TYPE', node.id, 'Stop에는 scalar boolean 또는 실수가 필요합니다.'); if (typeof value === 'number' && !Number.isFinite(value)) return m13Failure('M13_STOP_TYPE', node.id, 'Stop 입력이 유한하지 않습니다.'); return {}; }
    case 'signal.probe': return { out: copyAnySignal(p.probeValue as SignalValue) };
    case 'model.support-catalog': return { out: copyAnySignal(p.catalogValue as SignalValue) };
    case 'data.input-table': case 'data.signal-editor': {
      const times = p.times as number[], values = p.values as (number | boolean | string)[];
      if (!times?.length || times.length !== values?.length) return m13Failure('M13_DATA_IR', node.id, '검증된 표의 시각·값이 필요합니다.');
      const outside = time < times[0]! || time > times.at(-1)!;
      if (outside && p.outside === 'error') return m13Failure('DATASET_OUT_OF_RANGE', node.id, '표 데이터의 시간 범위를 벗어났습니다.');
      let value: number | boolean | string;
      if (outside && p.outside === 'zero') value = p.dataKind === 'string' ? '' : p.dataKind === 'boolean' ? false : 0;
      else { let low = 0, high = times.length; while (low < high) { const middle = (low + high) >>> 1; if (times[middle]! <= time) low = middle + 1; else high = middle; } const index = Math.max(0, low - 1); value = values[index]!; if (p.interpolation === 'linear' && index < times.length - 1 && time >= times[0]!) { const ratio = (time - times[index]!) / (times[index + 1]! - times[index]!); value = (values[index] as number) * (1 - ratio) + (values[index + 1] as number) * ratio; if (!Number.isFinite(value)) return m13Failure('NUMERIC_NONFINITE', node.id, '표 보간 결과가 유한하지 않습니다.'); } }
      return { out: typeof value === 'string' ? m13StringSignal(value, node.id) : value };
    }
    case 'source.waveform': { const frequency = Number(p.frequency), phase = frequency * time + Number(p.phase) / (2 * Math.PI), fraction = ((phase % 1) + 1) % 1, wave = p.kind === 'square' ? fraction < Number(p.duty) ? 1 : -1 : p.kind === 'triangle' ? 1 - 4 * Math.abs(fraction - .5) : p.kind === 'sawtooth' ? 2 * fraction - 1 : Math.sin(2 * Math.PI * phase), out = Number(p.bias) + Number(p.amplitude) * wave; if (!Number.isFinite(out)) return m13Failure('NUMERIC_NONFINITE', node.id, '파형 출력이 유한하지 않습니다.'); return { out }; }
    default: return undefined;
  }
}
