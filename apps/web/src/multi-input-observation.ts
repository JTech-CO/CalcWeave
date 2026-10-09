import { validateAnyDescriptor, validateAnySignal, type RunResult, type RunSample, type SignalDescriptor, type SignalValue } from '../../../packages/model/src';
import { prepareScopeObservation, SCOPE_OBSERVATION_LIMITS, type ScopeObservationReport, type ScopeObservationRun, type ScopeTimeWindow } from '../../../packages/analysis/src/scope-observation';

export const MULTI_INPUT_OBSERVATION_LIMITS = Object.freeze({ inputs: 16, samples: SCOPE_OBSERVATION_LIMITS.samplesPerRun, recordedElements: SCOPE_OBSERVATION_LIMITS.totalRecordedElements });
export interface InputObservationChannel extends ScopeObservationRun { port: string; inputIndex: number }
export interface InputObservationProjection { channels: InputObservationChannel[]; diagnostics: string[] }

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error('다중 입력 기록은 일반 데이터 객체여야 합니다.');
  return input as Record<string, unknown>;
}
function own(input: unknown, key: string): unknown {
  const property = Object.getOwnPropertyDescriptor(record(input), key);
  if (!property || !('value' in property) || !property.enumerable) throw new Error('다중 입력 기록의 접근자·숨김 속성은 허용하지 않습니다.');
  return property.value;
}
function denseArray(input: unknown, maximum: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length > maximum) throw new Error('다중 입력 기록의 배열 길이 상한을 확인하세요.');
  const properties = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(properties).length !== input.length + 1) throw new Error('다중 입력 기록의 빈 칸·추가 속성은 허용하지 않습니다.');
  return Array.from({ length: input.length }, (_, index) => {
    const property = properties[String(index)];
    if (!property || !('value' in property) || !property.enumerable) throw new Error('다중 입력 기록의 배열 접근자는 허용하지 않습니다.');
    return property.value;
  });
}
function elements(value: SignalValue): number {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.kind === 'bus') return value.fields.reduce((total, field) => total + elements(field.value), 0);
    if (value.kind === 'messages') return value.items.reduce((total, item) => total + elements(item.payload), 0);
    return value.data.length;
  }
  if (Array.isArray(value)) return Array.isArray(value[0]) ? (value as (number[] | boolean[])[]).reduce((total, row) => total + row.length, 0) : value.length;
  return 1;
}

/** A bounded view copy of a multi-input sink bundle. The original samples and values are never changed. */
export function projectInputObservations(samples: RunSample[], outputId: string, descriptor: SignalDescriptor | undefined, status?: RunResult['status']): InputObservationProjection {
  try {
    if (typeof outputId !== 'string' || !outputId.length || outputId.length > 160) throw new Error('다중 입력 출력 ID를 확인하세요.');
    if (status !== undefined && !['completed', 'cancelled', 'failed'].includes(status)) throw new Error('다중 입력 실행 상태를 확인하세요.');
    const declared = validateAnyDescriptor(descriptor);
    if (declared.valueType !== 'bus' || !declared.bus || declared.bus.fields.length < 2 || declared.bus.fields.length > MULTI_INPUT_OBSERVATION_LIMITS.inputs) throw new Error('다중 입력 그래프는 2~16개의 입력 기록을 지원합니다.');
    const fields = declared.bus.fields;
    if (fields.some((field, index) => field.name !== (index === 0 ? 'in' : `in${index + 1}`))) throw new Error('다중 입력 기록의 입력 순서가 선언과 다릅니다.');
    const source = denseArray(samples, MULTI_INPUT_OBSERVATION_LIMITS.samples);
    const channels: InputObservationChannel[] = fields.map((field, index) => ({ id: field.name, port: field.name, inputIndex: index, label: `입력 ${index + 1} · ${field.name}`, samples: [], descriptor: field.descriptor, status }));
    let inspected = 0, previous = -Infinity;
    for (const sample of source) {
      const time = own(sample, 'time');
      if (typeof time !== 'number' || !Number.isFinite(time) || time <= previous) throw new Error('다중 입력 기록 시각은 유한하고 엄격히 증가해야 합니다.');
      previous = time;
      const bundle = validateAnySignal(own(own(sample, 'values'), outputId));
      if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle) || bundle.kind !== 'bus' || bundle.fields.length !== fields.length || bundle.fields.some((field, index) => field.name !== fields[index]!.name)) throw new Error('실행 중 입력 개수·순서가 달라 그래프를 비교할 수 없습니다.');
      // Count times for every projected channel, as each curve owns its own time/value record.
      inspected += bundle.fields.reduce((total, field) => total + 1 + elements(field.value), 0);
      if (inspected > MULTI_INPUT_OBSERVATION_LIMITS.recordedElements) throw new Error('다중 입력의 시각과 신호 원소는 전체 1,000,000개 이하여야 합니다.');
      bundle.fields.forEach((field, index) => channels[index]!.samples.push({ time, values: { input: field.value } }));
    }
    return { channels, diagnostics: [] };
  } catch (error) {
    return { channels: [], diagnostics: [error instanceof Error ? error.message : '다중 입력 기록을 검증하지 못했습니다.'] };
  }
}

export function inputComponentChoices(descriptor: SignalDescriptor | undefined): { index: number; label: string }[] {
  try {
    const declared = validateAnyDescriptor(descriptor);
    if (declared.valueType === 'bus' || declared.valueType === 'messages' || declared.valueType === 'boolean' || declared.valueType === 'typed' && (declared.shape.length > 1 || ['boolean', 'complex128', 'string', 'enum'].includes(declared.typed!.dtype))) return [];
    const axes = declared.shape, count = axes.reduce((size, axis) => size * axis, 1);
    return Array.from({ length: count }, (_, index) => ({ index, label: axes.length === 0 ? '값' : axes.length === 1 ? `[${index + 1}]` : `[${Math.floor(index / axes[1]!) + 1}, ${index % axes[1]! + 1}]` }));
  } catch { return []; }
}

/** Overlay raw numeric values with their independent descriptors; no casts, scaling or interpolation. */
export function prepareInputOverlay(channels: InputObservationChannel[], selectedComponents: readonly number[], window?: ScopeTimeWindow): ScopeObservationReport {
  const report: ScopeObservationReport = { status: 'empty', diagnostics: [], shape: [], unit: '1', components: [], domain: { start: 0, end: 0 }, window: { start: 0, end: 0 }, yDomain: { minimum: 0, maximum: 0 }, curves: [] };
  if (!channels.length || channels.length > MULTI_INPUT_OBSERVATION_LIMITS.inputs) { report.status = 'invalid'; report.diagnostics = ['그래프 입력 개수 상한을 확인하세요.']; return report; }
  let start = Infinity, end = -Infinity, minimum = Infinity, maximum = -Infinity;
  const units = new Set<string>();
  for (const channel of channels) {
    const component = selectedComponents[channel.inputIndex] ?? 0;
    const item = prepareScopeObservation([channel], 'input', component, window);
    if (item.status !== 'ready') { report.diagnostics.push(`${channel.label}: ${item.diagnostics.join(' ') || '기록된 수치 값이 없습니다.'}`); continue; }
    units.add(item.unit);
    const coordinate = item.components.find(choice => choice.index === component)?.label;
    const unit = item.unit === '1' ? '단위 없음' : item.unit;
    report.curves.push(...item.curves.map(curve => ({ ...curve, label: `${channel.label}${item.shape.length ? ` ${coordinate}` : ''} · ${unit}` })));
    report.diagnostics.push(...item.diagnostics.map(message => `${channel.label}: ${message}`));
    start = Math.min(start, item.domain.start); end = Math.max(end, item.domain.end);
    if (item.curves.some(curve => curve.visiblePoints.some(point => point.value !== null))) { minimum = Math.min(minimum, item.yDomain.minimum); maximum = Math.max(maximum, item.yDomain.maximum); }
  }
  if (!report.curves.length) { report.status = report.diagnostics.length ? 'unsupported' : 'empty'; return report; }
  report.status = 'ready'; report.domain = { start, end };
  report.window = window ? { start: Math.max(start, window.start), end: Math.min(end, window.end) } : { start, end };
  if (minimum !== Infinity) report.yDomain = { minimum, maximum };
  report.unit = units.size === 1 ? [...units][0]! : '각 곡선 단위 참조';
  if (units.size > 1) report.diagnostics.push('단위가 다른 입력을 같은 수치 축에 표시합니다. 각 곡선의 단위를 확인하거나 각각 보기를 사용하세요.');
  return report;
}
