import { blockRegistry, getBlockDefinition, getBlockPorts } from '../../block-library/src';
import { M13_BLOCK_IDS, M13_RECORDING_IDS, parseM13Format, type M13FormatToken } from '../../block-library/src/m13';
import { ENGINE_VERSION, ModelError, conversionCoefficients, isSafeIdentifier, normalizeSolverSettings, structuredStorageElements, validateDataType, zeroAnySignal, type CalcModel, type IRNode, type SignalDescriptor, type SignalValue } from '../../model/src';

const ids = new Set<string>(M13_BLOCK_IDS), recordings = new Set<string>(M13_RECORDING_IDS.filter(id => id !== 'sink.floating-scope'));
export const isM13Block = (id: string): boolean => ids.has(id);
export interface M13ControlEvent { time: number; order: number; value: number | boolean }
const copy = <T>(value: T): T => structuredClone(value);
const scalar = (valueType: 'float64' | 'boolean' = 'float64', unit = '1'): SignalDescriptor => ({ valueType, shape: [], unit });
const typed = (dtype: 'string' | 'uint8' | 'uint32' | 'int32' | 'float32' | 'float64', shape: number[] = []): SignalDescriptor => ({ valueType: 'typed', shape, unit: '1', typed: { dtype } });
const bus = (fields: [string, SignalDescriptor][]): SignalDescriptor => ({ valueType: 'bus', shape: [], unit: '1', bus: { fields: fields.map(([name, descriptor]) => ({ name, descriptor })) } });
function fail(node: IRNode, code: string, message: string, portId?: string): never { throw new ModelError([{ code, nodeId: node.id, message, ...(portId ? { portId } : {}) }]); }
function numericScalar(node: IRNode, value: SignalDescriptor, port: string, dimensionless = false): void { if (value.valueType !== 'float64' || value.shape.length || dimensionless && value.unit !== '1') fail(node, 'M13_NUMERIC_SCALAR', '유한한 실수 scalar 입력이 필요합니다.', port); }
function stringScalar(node: IRNode, value: SignalDescriptor, port: string): void { if (value.valueType !== 'typed' || value.typed?.dtype !== 'string' || value.shape.length || value.unit !== '1') fail(node, 'M13_STRING_SCALAR', '단위 없는 typed 문자열 scalar 입력이 필요합니다.', port); }
function integerScalar(node: IRNode, value: SignalDescriptor, port: string): void { if (value.shape.length || value.unit !== '1' || value.valueType !== 'float64' && !(value.valueType === 'typed' && ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32'].includes(value.typed?.dtype ?? ''))) fail(node, 'M13_INTEGER_INDEX', '인덱스는 단위 없는 정수 scalar 입력이어야 합니다.', port); }
function controlValue(node: IRNode, value: number): void { const grid = (value - Number(node.parameters.min)) / Number(node.parameters.step); if (!Number.isFinite(grid) || Math.abs(grid - Math.round(grid)) > 1e-9 * Math.max(1, Math.abs(grid))) fail(node, 'M13_CONTROL_STEP', '조작 값은 선언된 간격에 맞아야 합니다.'); }
export function parseM13Json(text: unknown, maxLength = 16_384): unknown {
  if (typeof text !== 'string' || text.length > maxLength) throw new Error('bounded JSON text required');
  const value: unknown = JSON.parse(text); let count = 0;
  const visit = (item: unknown, depth: number): void => { if (++count > 2_048 || depth > 8) throw new Error('JSON resource limit'); if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('finite JSON number required'); if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) { if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('unsafe JSON key'); visit(child, depth + 1); } };
  visit(value, 0); return value;
}
function controlEvents(node: IRNode, model: CalcModel, action = false): void {
  let input: unknown; try { input = parseM13Json(node.parameters.events); } catch { fail(node, 'M13_CONTROL_EVENTS', '이벤트는 상한 안의 안전한 JSON 배열이어야 합니다.'); }
  if (!Array.isArray(input) || input.length > 256) fail(node, 'M13_CONTROL_EVENTS', '노드 이벤트는256개 이하여야 합니다.');
  const result: M13ControlEvent[] = []; const orders = new Set<number>(); let previousTime = -Infinity, previousOrder = -1;
  for (const event of input as unknown[]) {
    if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).sort().join(',') !== 'order,time,value') fail(node, 'M13_CONTROL_EVENTS', '이벤트 필드는 time/order/value만 허용합니다.');
    const value = event as M13ControlEvent;
    if (typeof value.time !== 'number' || !Number.isFinite(value.time) || value.time < model.execution.startTime || value.time > model.execution.stopTime || !Number.isSafeInteger(value.order) || value.order < 0 || value.order > 1_000_000 || orders.has(value.order) || value.time < previousTime || value.time === previousTime && value.order <= previousOrder || (action ? typeof value.value !== 'boolean' : typeof value.value !== 'number' || !Number.isFinite(value.value))) fail(node, 'M13_CONTROL_EVENTS', '이벤트는 시각·동일 시각 순서로 정렬되고 유일한order와 유효한값을 가져야 합니다.');
    if (!action && (value.value as number < Number(node.parameters.min) || value.value as number > Number(node.parameters.max))) fail(node, 'M13_CONTROL_RANGE', '조작 값이 선언 범위를 벗어났습니다.');
    if (!action) controlValue(node, value.value as number);
    if (!action && node.blockType === 'dashboard.control' && ['check-box', 'combo-box', 'push-button', 'radio-button', 'rocker-switch', 'rotary-switch', 'slider-switch', 'toggle-switch'].includes(String(node.parameters.kind)) && !(node.parameters.choices as number[]).includes(value.value as number)) fail(node, 'M13_CONTROL_CHOICE', '선택 조작은 등록된 선택 값만 사용할 수 있습니다.');
    previousTime = value.time; previousOrder = value.order; orders.add(value.order); result.push(copy(value));
  }
  node.parameters.controlEvents = result;
}
export function validateM13Parameters(node: IRNode, model: CalcModel, depth = 0): void {
  if (!isM13Block(node.blockType)) return;
  const p = node.parameters;
  if (node.blockType === 'sink.stop' && depth !== 0) fail(node, 'M13_STOP_ROOT_ONLY', '실행 종료 블럭은 루트 그래프에만 둘 수 있습니다. 하위 호출의 중단 전파는 별도 계약입니다.');
  if (['string.compose', 'string.scan', 'string.to-string'].includes(node.blockType)) { let tokens: M13FormatToken[]; try { tokens = parseM13Format(String(p.format), node.blockType === 'string.scan' ? 'scan' : 'compose'); } catch { fail(node, 'M13_FORMAT_UNSUPPORTED', '형식은 승인된 토큰과 최대8개 scalar 변환만 사용할 수 있습니다.'); } if (node.blockType === 'string.to-string' && tokens!.filter(token => token.kind).length !== 1) fail(node, 'M13_FORMAT_UNSUPPORTED', 'To String 형식에는 하나의 변환만 사용할 수 있습니다.'); p.formatTokens = tokens!; }
  if (node.blockType === 'string.parse-enum' && validateDataType(p.type).dtype !== 'enum') fail(node, 'M13_ENUM_TYPE', 'String to Enum에는 실제 enum 자료형 설정이 필요합니다.');
  if (['dashboard.control', 'math.slider-gain'].includes(node.blockType)) {
    if (!(Number(p.min) < Number(p.max)) || !Number.isFinite(Number(p.max) - Number(p.min)) || !(Number(p.step) > 0) || Number(p.step) > Number(p.max) - Number(p.min)) fail(node, 'M13_CONTROL_RANGE', '유한한 min<max 범위 및0<step≤범위가 필요합니다.');
    const initial = node.blockType === 'math.slider-gain' ? p.gain : p.initial;
    if (typeof initial !== 'number' || !Number.isFinite(initial) || initial < Number(p.min) || initial > Number(p.max)) fail(node, 'M13_CONTROL_RANGE', '초기 조작 값은 범위 안의 유한한 숫자여야 합니다.');
    controlValue(node, initial);
    if (node.blockType === 'dashboard.control') { const choices = p.choices as number[]; if (new Set(choices).size !== choices.length || choices.some(value => value < Number(p.min) || value > Number(p.max))) fail(node, 'M13_CONTROL_CHOICE', '선택 값은 범위 안의 서로 다른 숫자여야 합니다.'); if (['check-box', 'push-button', 'rocker-switch', 'slider-switch', 'toggle-switch'].includes(String(p.kind)) && choices.length !== 2) fail(node, 'M13_CONTROL_CHOICE', '이진 조작에는 정확히 두 선택 값이 필요합니다.'); if (['check-box', 'combo-box', 'push-button', 'radio-button', 'rocker-switch', 'rotary-switch', 'slider-switch', 'toggle-switch'].includes(String(p.kind)) && !choices.includes(initial)) fail(node, 'M13_CONTROL_CHOICE', '초기 값은 등록된 선택 값이어야 합니다.'); }
    controlEvents(node, model);
  }
  if (node.blockType === 'dashboard.action') controlEvents(node, model, true);
  if (node.blockType === 'dashboard.indicator') { if (!(Number(p.min) < Number(p.max))) fail(node, 'M13_INDICATOR_RANGE', '표시의 min은max보다 작아야 합니다.'); const thresholds = p.thresholds as number[]; if (thresholds.some((value, index) => index > 0 && value <= thresholds[index - 1]!)) fail(node, 'M13_INDICATOR_RANGE', '구간 경계는 중복 없이 증가해야 합니다.'); let labels: unknown; try { labels = parseM13Json(p.labels, 2_048); } catch { fail(node, 'M13_INDICATOR_LABELS', '구간 이름은 안전한 JSON 문자열 배열이어야 합니다.'); } if (!Array.isArray(labels) || labels.length !== thresholds.length + 1 || labels.some(value => typeof value !== 'string' || value.length > 64)) fail(node, 'M13_INDICATOR_LABELS', '구간 이름은 경계 수+1개이고64자 이하여야 합니다.'); p.indicatorLabels = labels; }
  if (recordings.has(node.blockType) && !isSafeIdentifier(String(p.name))) fail(node, 'M13_RECORD_NAME', '기록 이름은 안전한64자 식별자여야 합니다.');
  if (['data.input-table', 'data.signal-editor'].includes(node.blockType)) { const dataset = model.datasets?.find(item => item.id === p.datasetId); if (!dataset) fail(node, 'DATASET_REFERENCE_MISSING', '재생할 프로젝트 데이터셋이 없습니다.'); const index = dataset!.columns.findIndex(column => column.name === p.column), timeIndex = dataset!.columns.findIndex(column => column.name === dataset!.timeColumn); if (index < 0) fail(node, 'UNKNOWN_DATASET_COLUMN', '선택한 데이터 열이 없습니다.'); const column = dataset!.columns[index]!, timeUnit = dataset!.columns[timeIndex]!.unit, scale = timeUnit === '1' ? 1 : conversionCoefficients(timeUnit, 's').scale, values = dataset!.rows.map(row => row[index]!); if (column.kind !== 'number' && p.interpolation !== 'previous') fail(node, 'DATASET_INTERPOLATION', 'boolean·문자열 열은 previous 보간을 사용하세요.'); if (column.kind === 'string' && (values as string[]).some(value => value.length > 256)) fail(node, 'M13_STRING_BOUND', '문자열 시계열은 각256 UTF-16 단위 이하여야 합니다.'); Object.assign(p, { times: dataset!.rows.map(row => (row[timeIndex] as number) * scale), values, dataKind: column.kind, dataUnit: column.unit, dataVersion: dataset!.version, sourceHash: dataset!.sourceHash, contentHash: dataset!.contentHash, dataProvenance: copy(dataset!.provenance ?? null) }); }
  if (node.blockType === 'source.waveform' && model.execution.mode === 'continuous' && p.kind !== 'sine') fail(node, 'M13_WAVEFORM_CONTINUOUS_BOUNDARY', '연속 waveform 선택 계약은 sine입니다. 다른 파형은 이산 모드에서 재생하세요.');
}
/** Resolve a floating observer to a real producer, including its causality dependency. */
export function prepareM13Bindings(nodes: IRNode[]): [string, string][] {
  const byId = new Map(nodes.map(node => [node.id, node])), dependencies: [string, string][] = [];
  for (const node of nodes) if (node.blockType === 'sink.floating-scope') { const id = String(node.parameters.sourceNodeId), port = String(node.parameters.sourcePortId), source = byId.get(id); if (!isSafeIdentifier(id) || !isSafeIdentifier(port) || !source || !getBlockPorts(source).outputs.includes(port)) fail(node, 'M13_FLOATING_REFERENCE', 'Floating Scope는 같은 그래프의 실제 출력 포트를 참조해야 합니다.'); node.inputs.in = { nodeId: id, portId: port }; dependencies.push([id, node.id]); }
  return dependencies;
}
function logicalWidth(descriptor: SignalDescriptor): number { if (descriptor.valueType === 'bus') return descriptor.bus!.fields.reduce((sum, field) => sum + logicalWidth(field.descriptor), 0); if (descriptor.valueType === 'messages') return descriptor.message!.maxBatch * logicalWidth(descriptor.message!.payload); return descriptor.shape.reduce((product, axis) => product * axis, 1); }
function complex(descriptor: SignalDescriptor): boolean { return descriptor.typed?.dtype === 'complex128' || descriptor.valueType === 'bus' && descriptor.bus!.fields.some(field => complex(field.descriptor)) || descriptor.valueType === 'messages' && complex(descriptor.message!.payload); }
export function inferM13Outputs(node: IRNode, input: (port: string) => SignalDescriptor, model: CalcModel, byId: Map<string, IRNode>): Record<string, SignalDescriptor> | undefined {
  if (!isM13Block(node.blockType)) return undefined;
  const p = node.parameters;
  switch (node.blockType) {
    case 'source.string-constant': return { out: typed('string') };
    case 'string.ascii-to-string': { const descriptor = input('in'); if (descriptor.valueType !== 'typed' || descriptor.typed?.dtype !== 'uint8' || descriptor.shape.length !== 1 || descriptor.shape[0]! > 256 || descriptor.unit !== '1') fail(node, 'M13_ASCII_VECTOR', 'ASCII 입력은 길이1~256의 단위 없는 typed uint8 vector여야 합니다.', 'in'); return { out: typed('string') }; }
    case 'string.compose': { let index = 0; for (const token of p.formatTokens as M13FormatToken[]) if (token.kind) { const port = `arg${++index}`, descriptor = input(port), accepted = token.kind === 'd' || token.kind === 'u' ? ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64'] : ['float32', 'float64']; if (token.kind === 's') stringScalar(node, descriptor, port); else if (descriptor.shape.length || descriptor.unit !== '1' || !(descriptor.valueType === 'float64' || descriptor.valueType === 'typed' && accepted.includes(descriptor.typed?.dtype ?? ''))) fail(node, 'M13_FORMAT_INPUT', '정수 형식은 정확한 integer, 실수 형식은 float 자료형 scalar를 사용하세요. legacy 숫자는 실행 시 해당 형식 범위를 검증합니다.', port); } return { out: typed('string') }; }
    case 'string.scan': { stringScalar(node, input('in'), 'in'); const fields = (p.formatTokens as M13FormatToken[]).filter(token => token.kind); return Object.fromEntries(fields.map((token, index) => [`out${index + 1}`, typed(token.dtype!)])); }
    case 'string.string-compare': stringScalar(node, input('a'), 'a'); stringScalar(node, input('b'), 'b'); return { out: scalar('boolean') };
    case 'string.string-concatenate': for (let index = 1; index <= Number(p.count); index++) stringScalar(node, input(`in${index}`), `in${index}`); return { out: typed('string') };
    case 'string.string-contains': case 'string.string-count': case 'string.string-find': stringScalar(node, input('in'), 'in'); stringScalar(node, input('pattern'), 'pattern'); return { out: node.blockType === 'string.string-contains' ? scalar('boolean') : typed(node.blockType === 'string.string-find' ? 'int32' : 'uint32') };
    case 'string.string-length': stringScalar(node, input('in'), 'in'); return { out: typed('uint32') };
    case 'string.string-to-ascii': stringScalar(node, input('in'), 'in'); return { out: typed('uint8', [Number(p.capacity)]), length: typed('uint32') };
    case 'string.parse-number': stringScalar(node, input('in'), 'in'); return { out: typed(p.dtype as 'float32' | 'float64') };
    case 'string.parse-enum': stringScalar(node, input('in'), 'in'); return { out: { valueType: 'typed', shape: [], unit: '1', typed: validateDataType(p.type) } };
    case 'string.substring': stringScalar(node, input('in'), 'in'); integerScalar(node, input('start'), 'start'); if (p.toEnd !== 'yes') integerScalar(node, input('length'), 'length'); return { out: typed('string') };
    case 'string.to-string': { const descriptor = input('in'); if (descriptor.shape.length || descriptor.unit !== '1' || descriptor.valueType === 'bus' || descriptor.valueType === 'messages' || descriptor.typed?.dtype === 'complex128') fail(node, 'M13_TO_STRING_TYPE', '문자열 변환은 승인된 단위 없는 scalar만 받습니다.', 'in'); if ((descriptor.valueType === 'float64' || descriptor.valueType === 'typed' && ['float32', 'float64'].includes(descriptor.typed?.dtype ?? '')) && (p.formatTokens as M13FormatToken[]).some(token => token.kind === 's')) fail(node, 'M13_FORMAT_INPUT', '실수 To String 형식은 숫자 변환이어야 합니다.', 'in'); return { out: typed('string') }; }
    case 'dashboard.control': return { out: scalar() };
    case 'dashboard.action': return { out: scalar('boolean') };
    case 'dashboard.indicator': numericScalar(node, input('in'), 'in'); return { out: copy(input('in')), band: typed('uint32') };
    case 'math.slider-gain': { const descriptor = input('in'); if (descriptor.valueType !== 'float64') fail(node, 'M13_GAIN_TYPE', '조작 배율은 기존 실수 신호만 받습니다.', 'in'); return { out: copy(descriptor) }; }
    case 'data.input-table': case 'data.signal-editor': return { out: p.dataKind === 'string' ? typed('string') : scalar(p.dataKind === 'boolean' ? 'boolean' : 'float64', String(p.dataUnit)) };
    case 'source.waveform': return { out: scalar() };
    case 'sink.stop': { const descriptor = input('in'); if (descriptor.shape.length || descriptor.unit !== '1' || !['float64', 'boolean'].includes(descriptor.valueType)) fail(node, 'M13_STOP_TYPE', '실행 종료 요청은 단위 없는 숫자 또는 boolean scalar여야 합니다.', 'in'); return {}; }
    case 'sink.floating-scope': return { out: copy(input('in')) };
    case 'signal.probe': { const descriptor = input('in'), source = byId.get(node.inputs.in!.nodeId)!, constant = getBlockDefinition(source.blockType)!.sampleTime === 'constant', Ts = model.execution.mode === 'continuous' ? normalizeSolverSettings(model.execution).discreteStep : model.execution.step; const values: Record<string, SignalValue> = { width: logicalWidth(descriptor), rank: descriptor.shape.length, dimensions: Array.from({ length: 8 }, (_, index) => descriptor.shape[index] ?? 0), complex: complex(descriptor), samplePeriod: constant ? 0 : source.sampleTime.period * Ts, sampleOffset: constant ? 0 : source.sampleTime.offset * Ts }; p.probeValue = { kind: 'bus', fields: Object.entries(values).map(([name, value]) => ({ name, value })) }; p.probeSignalDescriptor = copy(descriptor); return { out: bus([['width', scalar()], ['rank', scalar()], ['dimensions', { ...scalar(), shape: [8] }], ['complex', scalar('boolean')], ['samplePeriod', scalar('float64', 's')], ['sampleOffset', scalar('float64', 's')]]) }; }
    case 'model.support-catalog': { const values: Record<string, SignalValue> = { blockCount: blockRegistry.length, engine: { kind: 'typed', dtype: 'string', shape: [], data: [ENGINE_VERSION] }, staticSupported: blockRegistry.filter(definition => definition.supportedModes.includes('static')).length, discreteSupported: blockRegistry.filter(definition => definition.supportedModes.includes('discrete')).length, continuousSupported: blockRegistry.filter(definition => definition.supportedModes.includes('continuous')).length }; p.catalogValue = { kind: 'bus', fields: Object.entries(values).map(([name, value]) => ({ name, value })) }; return { out: bus([['blockCount', scalar()], ['engine', typed('string')], ['staticSupported', scalar()], ['discreteSupported', scalar()], ['continuousSupported', scalar()]]) }; }
    case 'sink.record': case 'data.output-file': case 'data.output-dataset': case 'sink.xy-graph': { let descriptor: SignalDescriptor; if (node.blockType === 'sink.xy-graph') { numericScalar(node, input('x'), 'x'); numericScalar(node, input('y'), 'y'); descriptor = bus([['x', copy(input('x'))], ['y', copy(input('y'))]]); } else descriptor = copy(input('in')); p.recordDescriptor = descriptor; p.recordInitial = zeroAnySignal(descriptor); p.m13StateElements = Number(p.capacity) * (structuredStorageElements(descriptor) + 1) + 8; return { out: descriptor }; }
  }
  return undefined;
}
export function validateM13StateInputs(node: IRNode): boolean { return isM13Block(node.blockType); }
