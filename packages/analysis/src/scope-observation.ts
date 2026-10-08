import { decodeTypedFloat, SIGNAL_LIMITS, validateDataType, validateTypedSignal, type RunResult, type RunSample, type SignalDescriptor, type TypedDataType, type TypedFloat } from '../../model/src';

export const SCOPE_OBSERVATION_LIMITS = Object.freeze({ runs: 3, samplesPerRun: 10_001, elementsPerSignal: SIGNAL_LIMITS.maxElements, totalRecordedElements: 1_000_000, labelLength: 160 });
export interface ScopeObservationRun { id: string; label: string; samples: RunSample[]; descriptor?: SignalDescriptor; status?: RunResult['status'] }
export interface ScopeTimeWindow { start: number; end: number }
export interface ScopeObservationPoint { sampleIndex: number; time: number; value: number | null; exact: string }
export interface ScopeObservationCurve { id: string; label: string; status: RunResult['status']; approximate: boolean; points: ScopeObservationPoint[]; visiblePoints: ScopeObservationPoint[] }
export interface ScopeObservationReport {
  status: 'ready' | 'empty' | 'unsupported' | 'incompatible' | 'invalid';
  diagnostics: string[]; shape: number[]; unit: string; components: { index: number; label: string }[];
  domain: ScopeTimeWindow; window: ScopeTimeWindow; yDomain: { minimum: number; maximum: number }; curves: ScopeObservationCurve[];
}
export interface ScopeCursorSample {
  runId: string; label: string; status: RunResult['status']; targetTime: number; sampleTime: number; sampleIndex: number;
  value: number | null; exact: string; approximate: boolean;
}

class ScopeObservationError extends Error {
  constructor(readonly state: 'unsupported' | 'incompatible' | 'invalid', message: string) { super(message); }
}
function invalid(message: string): never { throw new ScopeObservationError('invalid', message); }
function unsupported(message: string): never { throw new ScopeObservationError('unsupported', message); }
function incompatible(message: string): never { throw new ScopeObservationError('incompatible', message); }

/** Read data properties only: imported samples must never execute getters or hooks. */
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid('관측 입력은 일반 데이터 객체여야 합니다.');
  return input as Record<string, unknown>;
}
function own(input: Record<string, unknown>, key: string, required = true): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) { if (required) invalid('관측 입력의 필수 필드가 없습니다.'); return undefined; }
  if (!('value' in descriptor) || !descriptor.enumerable) invalid('관측 입력의 접근자와 숨김 속성은 허용하지 않습니다.');
  return descriptor.value;
}
function array(input: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || input.length < min || input.length > max) invalid('관측 배열 길이가 허용 범위를 벗어났습니다.');
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).length !== input.length + 1) invalid('관측 배열에는 빈 칸이나 추가 속성을 사용할 수 없습니다.');
  return Array.from({ length: input.length }, (_, index) => {
    const item = descriptors[String(index)];
    if (!item || !('value' in item) || !item.enumerable) invalid('관측 배열에 접근자나 빈 칸이 있습니다.');
    return item.value as unknown;
  });
}
function label(input: unknown, name: string): string {
  if (typeof input !== 'string' || !input.length || input.length > SCOPE_OBSERVATION_LIMITS.labelLength) invalid(`${name}은 1~160자 문자열이어야 합니다.`);
  return input;
}
function shape(input: unknown, rank: number): number[] {
  const axes = array(input, 0, rank).map(axis => {
    if (typeof axis !== 'number' || !Number.isInteger(axis) || axis < 1 || axis > SIGNAL_LIMITS.maxAxis) invalid('관측 신호의 차원이 허용 범위를 벗어났습니다.');
    return axis;
  });
  if (axes.reduce((count, axis) => count * axis, 1) > SIGNAL_LIMITS.maxElements) invalid('관측 신호는 1,024개 원소 이하여야 합니다.');
  return axes;
}
function equalShape(a: number[], b: number[]): boolean { return a.length === b.length && a.every((axis, index) => axis === b[index]); }
function numericType(type: TypedDataType): boolean { return !['boolean', 'complex128', 'string', 'enum'].includes(type.dtype); }
function checkedDescriptor(input: unknown): SignalDescriptor {
  const value = object(input), valueType = own(value, 'valueType'), unit = own(value, 'unit');
  if (typeof unit !== 'string' || !unit.length || unit.length > 64) invalid('관측 단위는 1~64자 문자열이어야 합니다.');
  if (valueType === 'boolean' || valueType === 'bus' || valueType === 'messages') unsupported('boolean·버스·메시지 신호는 수치 곡선으로 자동 변환하지 않습니다.');
  if (valueType === 'float64') return { valueType, shape: shape(own(value, 'shape'), 2), unit };
  if (valueType !== 'typed') invalid('관측 신호 자료형을 확인하세요.');
  const typed = validateDataType(own(value, 'typed'));
  if (!numericType(typed)) unsupported('boolean·복소수·문자열·열거형 신호는 수치 곡선으로 자동 변환하지 않습니다.');
  const axes = array(own(value, 'shape'), 0, 8);
  if (axes.length > 1) unsupported('Typed 수치 곡선은 스칼라와 벡터를 지원합니다.');
  return { valueType, shape: shape(axes, 1), unit, typed };
}

interface ExtractedSignal { descriptor: SignalDescriptor; cells: { value: number | null; exact: string }[]; approximate: boolean }
const exactNumber = (value: number): string => Object.is(value, -0) ? '-0' : String(value);
const finiteOrGap = (value: number): number | null => Number.isFinite(value) ? value : null;
function extract(input: unknown): ExtractedSignal {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const candidate = object(input), kind = own(candidate, 'kind');
    if (kind === 'bus' || kind === 'messages') unsupported('버스·메시지 출력은 수치 곡선으로 자동 변환하지 않습니다. 원본 기록에서 필드·payload·발행 순서를 확인하세요.');
    if (kind !== 'typed') invalid('관측 신호 객체의 태그를 확인하세요.');
    // The model validator retains exact integer/fixed decimal codes and IEEE tags.
    const value = validateTypedSignal(input);
    if (!numericType(value)) unsupported('boolean·복소수·문자열·열거형 출력은 수치 곡선으로 자동 변환하지 않습니다.');
    if (value.shape.length > 1) unsupported('Typed 수치 곡선은 스칼라와 벡터를 지원합니다.');
    const type = validateDataType({ dtype: value.dtype, ...(value.fixed ? { fixed: value.fixed } : {}) });
    const integral = value.dtype === 'fixed' || /^(u?int)/.test(value.dtype);
    const cells = value.data.map(cell => {
      const decoded = integral ? Number(cell) * (value.dtype === 'fixed' ? 2 ** -value.fixed!.fractionLength : 1) : decodeTypedFloat(cell as TypedFloat);
      const exact = value.dtype === 'fixed' ? `${String(cell)} × 2^(${-value.fixed!.fractionLength}) (저장 코드 ${String(cell)})` : String(cell);
      return { value: finiteOrGap(decoded), exact };
    });
    return { descriptor: { valueType: 'typed', shape: [...value.shape], unit: '1', typed: type }, cells, approximate: true };
  }
  let axes: number[] = [], items: unknown[];
  if (Array.isArray(input)) {
    const first = array(input, 1, SIGNAL_LIMITS.maxAxis);
    if (Array.isArray(first[0])) {
      const firstRow = array(first[0], 1, SIGNAL_LIMITS.maxAxis);
      if (first.length * firstRow.length > SIGNAL_LIMITS.maxElements) invalid('관측 신호는 1,024개 원소 이하여야 합니다.');
      const rows = first.map((row, index) => {
        const cells = index === 0 ? firstRow : array(row, 1, SIGNAL_LIMITS.maxAxis);
        if (cells.length !== firstRow.length) invalid('관측 행렬의 모든 행은 같은 길이여야 합니다.');
        return cells;
      });
      axes = [rows.length, firstRow.length]; items = rows.flat();
    } else { axes = [first.length]; items = first; }
  } else items = [input];
  if (items.length > SIGNAL_LIMITS.maxElements) invalid('관측 신호는 1,024개 원소 이하여야 합니다.');
  if (items.every(item => typeof item === 'boolean')) unsupported('boolean 출력은 수치 곡선으로 자동 변환하지 않습니다.');
  if (items.some(item => typeof item !== 'number')) invalid('관측 신호에는 같은 자료형의 실수만 사용할 수 있습니다.');
  return { descriptor: { valueType: 'float64', shape: axes, unit: '1' }, cells: (items as number[]).map(value => ({ value: finiteOrGap(value), exact: exactNumber(value) })), approximate: false };
}
function sameDescriptor(a: SignalDescriptor, b: SignalDescriptor, includeUnit = true): boolean {
  return a.valueType === b.valueType && equalShape(a.shape, b.shape) && (!includeUnit || a.unit === b.unit) && JSON.stringify(a.typed) === JSON.stringify(b.typed);
}
function components(axes: number[]): { index: number; label: string }[] {
  const count = axes.reduce((product, axis) => product * axis, 1);
  return Array.from({ length: count }, (_, index) => ({ index, label: !axes.length ? '값' : axes.length === 1 ? `[${index + 1}]` : `[${Math.floor(index / axes[1]!) + 1}, ${index % axes[1]! + 1}]` }));
}
function initialReport(): ScopeObservationReport { return { status: 'empty', diagnostics: [], shape: [], unit: '1', components: [], domain: { start: 0, end: 0 }, window: { start: 0, end: 0 }, yDomain: { minimum: 0, maximum: 0 }, curves: [] }; }

/** Project bounded raw observations only; no execution, interpolation, casts into the engine or mutation. */
export function prepareScopeObservation(runs: ScopeObservationRun[], outputId: string, componentIndex = 0, window?: ScopeTimeWindow): ScopeObservationReport {
  const report = initialReport();
  try {
    label(outputId, '출력 ID');
    if (!Number.isInteger(componentIndex) || componentIndex < 0 || componentIndex >= SIGNAL_LIMITS.maxElements) invalid('성분 번호는 0~1,023의 정수여야 합니다.');
    const sources = array(runs, 1, SCOPE_OBSERVATION_LIMITS.runs), ids = new Set<string>();
    let shared: SignalDescriptor | undefined, start = Infinity, end = -Infinity, inspectedElements = 0;
    for (const source of sources) {
      const run = object(source), id = label(own(run, 'id'), '실행 ID'), name = label(own(run, 'label'), '실행 이름');
      if (ids.has(id)) invalid('실행 ID는 중복될 수 없습니다.'); ids.add(id);
      const status = own(run, 'status', false) ?? 'completed';
      if (!['completed', 'cancelled', 'failed'].includes(status as string)) invalid('실행 상태를 확인하세요.');
      const declared = own(run, 'descriptor', false), explicit = declared === undefined ? undefined : checkedDescriptor(declared);
      let actual = explicit, previous = -Infinity, approximate = false;
      const points: ScopeObservationPoint[] = [];
      const samples = array(own(run, 'samples'), 0, SCOPE_OBSERVATION_LIMITS.samplesPerRun);
      for (let index = 0; index < samples.length; index++) {
        const sample = object(samples[index]), time = own(sample, 'time');
        if (typeof time !== 'number' || !Number.isFinite(time) || time <= previous) invalid('원시 관측 시간은 유한하며 엄격히 증가해야 합니다.');
        previous = time;
        const values = object(own(sample, 'values')), observed = extract(own(values, outputId));
        inspectedElements += 1 + observed.cells.length;
        if (inspectedElements > SCOPE_OBSERVATION_LIMITS.totalRecordedElements) invalid('원시 관측 시간과 신호 원소는 모든 중첩 실행을 합쳐 1,000,000개 이하여야 합니다.');
        if (actual && !sameDescriptor(actual, observed.descriptor, false)) incompatible('실행 중 신호 형상 또는 자료형이 달라 선언된 출력과 비교할 수 없습니다.');
        actual ??= observed.descriptor;
        if (componentIndex >= observed.cells.length) invalid('선택한 성분이 출력 형상 범위를 벗어났습니다.');
        const selected = observed.cells[componentIndex]!;
        points.push({ sampleIndex: index, time, value: selected.value, exact: selected.exact });
        approximate ||= observed.approximate;
        start = Math.min(start, time); end = Math.max(end, time);
      }
      if (actual) {
        if (componentIndex >= actual.shape.reduce((product, axis) => product * axis, 1)) invalid('선택한 성분이 출력 형상 범위를 벗어났습니다.');
        if (shared && !sameDescriptor(shared, actual)) incompatible('중첩하려는 실행의 자료형·형상·단위가 다릅니다. 같은 출력 조건으로 실행하세요.');
        shared ??= actual;
      }
      report.curves.push({ id, label: name, status: status as RunResult['status'], approximate, points, visiblePoints: [] });
    }
    if (shared) { report.shape = [...shared.shape]; report.unit = shared.unit; report.components = components(shared.shape); }
    if (start === Infinity) { report.diagnostics.push('기록된 원시 샘플이 없습니다.'); return report; }
    report.domain = { start, end };
    if (window === undefined) report.window = { start, end };
    else {
      const value = object(window), requestedStart = own(value, 'start'), requestedEnd = own(value, 'end');
      if (typeof requestedStart !== 'number' || !Number.isFinite(requestedStart) || typeof requestedEnd !== 'number' || !Number.isFinite(requestedEnd) || requestedEnd <= requestedStart) invalid('관측 구간은 유한한 시작·종료 시간이 필요하며 종료가 시작보다 커야 합니다.');
      if (requestedEnd < start || requestedStart > end) invalid('관측 구간에 기록된 실행 시간이 없습니다.');
      report.window = { start: Math.max(start, requestedStart), end: Math.min(end, requestedEnd) };
    }
    let minimum = Infinity, maximum = -Infinity;
    for (const curve of report.curves) {
      curve.visiblePoints = curve.points.filter(point => point.time >= report.window.start && point.time <= report.window.end);
      for (const point of curve.visiblePoints) if (point.value !== null) { minimum = Math.min(minimum, point.value); maximum = Math.max(maximum, point.value); }
    }
    if (minimum !== Infinity) report.yDomain = { minimum, maximum };
    else report.diagnostics.push('이 관측 구간에 유한한 수치 샘플이 없습니다.');
    report.status = 'ready';
    return report;
  } catch (error) {
    report.status = error instanceof ScopeObservationError ? error.state : 'invalid';
    report.diagnostics = [error instanceof ScopeObservationError ? error.message : '관측 신호가 모델의 자료형 검증을 통과하지 못했습니다.'];
    report.curves = [];
    return report;
  }
}

/** Normalize without overflowing (maximum - minimum) for ±1e308 and preserve a constant axis at the center. */
export function normalizeScopeCoordinate(value: number, minimum: number, maximum: number): number {
  if (![value, minimum, maximum].every(Number.isFinite) || minimum > maximum) return 0.5;
  if (minimum === maximum) return 0.5;
  const clamped = Math.min(maximum, Math.max(minimum, value)), range = maximum - minimum;
  const ratio = Number.isFinite(range) ? (clamped - minimum) / range : (() => {
    const scale = Math.max(Math.abs(minimum), Math.abs(maximum));
    return (clamped / scale - minimum / scale) / (maximum / scale - minimum / scale);
  })();
  return Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0.5));
}

/** Each run selects its own real raw sample, with the earlier sample winning an exact tie. */
export function nearestScopeSamples(report: ScopeObservationReport, targetTime: number): ScopeCursorSample[] {
  if (report.status !== 'ready' || !Number.isFinite(targetTime)) return [];
  return report.curves.flatMap(curve => {
    const points = curve.visiblePoints;
    if (!points.length) return [];
    let lo = 0, hi = points.length;
    while (lo < hi) { const middle = Math.floor((lo + hi) / 2); if (points[middle]!.time < targetTime) lo = middle + 1; else hi = middle; }
    let point = points[Math.min(lo, points.length - 1)]!;
    const earlier = points[lo - 1];
    if (earlier && targetTime !== point.time) {
      // Scaled distance also works when the two finite times span an overflowing subtraction.
      const earlierDistance = Math.abs(targetTime - earlier.time), laterDistance = Math.abs(point.time - targetTime);
      const scale = Math.max(1, Math.abs(targetTime), Math.abs(point.time), Math.abs(earlier.time));
      if (Number.isFinite(earlierDistance) && Number.isFinite(laterDistance)
        ? earlierDistance <= laterDistance
        : Math.abs(targetTime / scale - earlier.time / scale) <= Math.abs(point.time / scale - targetTime / scale)) point = earlier;
    }
    return [{ runId: curve.id, label: curve.label, status: curve.status, targetTime, sampleTime: point.time, sampleIndex: point.sampleIndex, value: point.value, exact: point.exact, approximate: curve.approximate }];
  });
}
