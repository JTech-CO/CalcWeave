import { ModelError } from '../../model/src';

export const CONTROL_LIMITS = Object.freeze({ maxStates: 4, maxMatrixMagnitude: 1e6, minFrequency: 1e-6, maxFrequency: 1e6, maxFrequencyPoints: 801, maxRootLocusPoints: 81, maxGain: 1e6, maxWork: 2_000_000 });
export interface ComplexValue { real: number; imag: number }
export interface ControlStateSpace { A: number[][]; B: number[][]; C: number[][]; D: number[][]; domain?: 'continuous' }
export interface ControlAnalysisSpec { frequencyMin?: number; frequencyMax?: number; frequencyPoints?: number; rootLocusGains?: number[] }
export interface FrequencyPoint { omega: number; real: number | null; imag: number | null; magnitude: number | null; gainDb: number | null; phaseDegrees: number | null; status: 'finite' | 'zero' | 'singular' | 'nonfinite' }
export interface GainCrossover { omega: number; phaseDegrees: number; phaseMarginDegrees: number }
export interface PhaseCrossover { omega: number; magnitude: number; gainMargin: number; gainMarginDb: number }
export interface ControlMargins { convention: 'unity-negative-feedback-open-loop'; status: 'finite-crossings' | 'no-crossing-in-range' | 'incomplete'; gainCrossovers: GainCrossover[]; phaseCrossovers: PhaseCrossover[]; phaseMarginDegrees: number | null; gainMargin: number | null; gainMarginDb: number | null; diagnostics: string[] }
export interface RootLocusPoint { gain: number; poles: ComplexValue[]; status: 'completed' | 'ill-posed' | 'unsupported'; diagnostics: string[] }
export interface ControlAnalysisReport { stateSpace: ControlStateSpace; stateOrder: number; denominator: number[]; numerator: number[]; poles: ComplexValue[]; zeros: ComplexValue[]; zeroTransfer: boolean; stability: 'stable' | 'unstable' | 'boundary'; bode: FrequencyPoint[]; margins: ControlMargins; rootLocus: RootLocusPoint[]; diagnostics: string[]; frequencyRange: { minimum: number; maximum: number; points: number } }

function fail(code: string, message: string): never { throw new ModelError([{ code, message }]); }
function plain(value: unknown, allowed: readonly string[], code = 'CONTROL_INPUT'): void {
  if (value === null || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code, '일반 데이터 객체만 사용할 수 있습니다.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !allowed.includes(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable)) fail(code, '접근자·숨김 필드·지원하지 않는 필드는 사용할 수 없습니다.');
}
function array(value: unknown, minimum: number, maximum: number, code = 'CONTROL_INPUT'): asserts value is unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length < minimum || value.length > maximum) fail(code, `길이 ${minimum}~${maximum}의 일반 배열을 사용해 주세요.`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1 || Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable))) fail(code, '배열의 빈 칸·접근자·추가 필드를 사용할 수 없습니다.');
}
function matrix(value: unknown): number[][] {
  array(value, 1, CONTROL_LIMITS.maxStates);
  return value.map((row) => { array(row, 1, CONTROL_LIMITS.maxStates); return row.map((cell) => { if (typeof cell !== 'number' || !Number.isFinite(cell) || Math.abs(cell) > CONTROL_LIMITS.maxMatrixMagnitude) fail('CONTROL_INPUT', '행렬 원소는 절댓값 10⁶ 이하의 유한한 실수여야 합니다.'); return cell; }); });
}
function validateStateSpace(value: unknown): ControlStateSpace {
  plain(value, ['A', 'B', 'C', 'D', 'domain']);
  const source = value as ControlStateSpace;
  if (source.domain !== undefined && source.domain !== 'continuous') fail('CONTROL_DOMAIN', '연속 시간 상태공간만 분석합니다. 이산·descriptor 행렬은 자동 변환하지 않습니다.');
  const A = matrix(source.A), B = matrix(source.B), C = matrix(source.C), D = matrix(source.D), n = A.length;
  if (A.some((row) => row.length !== n) || B.length !== n || B.some((row) => row.length !== 1) || C.length !== 1 || C[0]!.length !== n || D.length !== 1 || D[0]!.length !== 1) fail('CONTROL_SISO', '1~4차 SISO 상태공간 A(n×n), B(n×1), C(1×n), D(1×1)이 필요합니다. MIMO 채널·고차 모델은 자동 축소하지 않습니다.');
  return { A, B, C, D, domain: 'continuous' };
}
/** Read the actual M12 bus without invoking accessors or coercing typed/string data. */
export function readLinearizationStateSpace(value: unknown): ControlStateSpace {
  plain(value, ['kind', 'fields'], 'CONTROL_LINEARIZATION_BUS');
  const bus = value as { kind: unknown; fields: unknown[] };
  if (bus.kind !== 'bus') fail('CONTROL_LINEARIZATION_BUS', '실제로 기록된 A/B/C/D 선형화 bus가 필요합니다.');
  array(bus.fields, 4, 4, 'CONTROL_LINEARIZATION_BUS');
  const fields: Partial<Record<'A' | 'B' | 'C' | 'D', unknown>> = {};
  for (const value of bus.fields) {
    plain(value, ['name', 'value'], 'CONTROL_LINEARIZATION_BUS');
    const field = value as { name: string; value: unknown };
    if (!['A', 'B', 'C', 'D'].includes(field.name) || Object.hasOwn(fields, field.name)) fail('CONTROL_LINEARIZATION_BUS', '선형화 bus에는 고유한 A/B/C/D 필드 네 개가 필요합니다.');
    fields[field.name as 'A' | 'B' | 'C' | 'D'] = field.value;
  }
  return validateStateSpace(fields);
}
const complex = (real = 0, imag = 0): ComplexValue => ({ real, imag });
const add = (a: ComplexValue, b: ComplexValue): ComplexValue => complex(a.real + b.real, a.imag + b.imag);
const sub = (a: ComplexValue, b: ComplexValue): ComplexValue => complex(a.real - b.real, a.imag - b.imag);
const mul = (a: ComplexValue, b: ComplexValue): ComplexValue => complex(a.real * b.real - a.imag * b.imag, a.real * b.imag + a.imag * b.real);
const magnitude = (a: ComplexValue): number => Math.hypot(a.real, a.imag);
function divide(a: ComplexValue, b: ComplexValue): ComplexValue {
  // Scaling avoids an unnecessary overflow in |b|².
  const scale = Math.max(Math.abs(b.real), Math.abs(b.imag));
  if (scale === 0) return complex(NaN, NaN);
  const real = b.real / scale, imag = b.imag / scale, denominator = real * real + imag * imag;
  return complex((a.real / scale * real + a.imag / scale * imag) / denominator, (a.imag / scale * real - a.real / scale * imag) / denominator);
}
function polynomial(coefficients: number[], at: ComplexValue): ComplexValue { return coefficients.reduce((value, coefficient) => add(mul(value, at), complex(coefficient)), complex()); }
function stateResponse(state: ControlStateSpace, omega: number, charge: (work: number) => void): ComplexValue | undefined {
  const n = state.A.length, rows = state.A.map((row, index) => [...row.map((value, column) => complex(-value, index === column ? omega : 0)), complex(state.B[index]![0]!)]);
  const scale = Math.max(omega, ...state.A.flat().map(Math.abs));
  for (let column = 0; column < n; column += 1) {
    charge(n * n * 12);
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) if (magnitude(rows[row]![column]!) > magnitude(rows[pivot]![column]!)) pivot = row;
    if (magnitude(rows[pivot]![column]!) <= 32 * Number.EPSILON * scale) return;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const divisor = rows[column]![column]!;
    for (let index = column; index <= n; index += 1) rows[column]![index] = divide(rows[column]![index]!, divisor);
    for (let row = 0; row < n; row += 1) if (row !== column) { const factor = rows[row]![column]!; for (let index = column; index <= n; index += 1) rows[row]![index] = sub(rows[row]![index]!, mul(factor, rows[column]![index]!)); }
  }
  // Validate the solved original complex equations before reporting a frequency sample.
  const solution = rows.map((row) => row[n]!);
  for (let row = 0; row < n; row += 1) {
    const products = state.A[row]!.map((value, column) => mul(complex(-value, row === column ? omega : 0), solution[column]!)), rhs = state.B[row]![0]!, residual = magnitude(sub(products.reduce(add, complex()), complex(rhs))), norm = Math.abs(rhs) + products.reduce((sum, value) => sum + magnitude(value), 0);
    if (!Number.isFinite(residual) || residual > 1e-8 * Math.max(1e-300, norm)) return;
  }
  return solution.reduce((sum, value, index) => add(sum, mul(complex(state.C[0]![index]!), value)), complex(state.D[0]![0]!));
}
function trim(coefficients: number[]): number[] { let first = 0; while (first < coefficients.length - 1 && coefficients[first] === 0) first += 1; return coefficients.slice(first); }
function roots(input: number[], charge: (work: number) => void): ComplexValue[] {
  const coefficients = trim(input), degree = coefficients.length - 1;
  if (!degree) return [];
  const leading = coefficients[0]!, normalized = coefficients.map((value) => value / leading);
  if (normalized.some((value) => !Number.isFinite(value))) fail('CONTROL_ROOT_NUMERIC', '다항식 정규화의 수치 범위를 초과했습니다.');
  let result: ComplexValue[];
  if (degree === 1) result = [complex(-normalized[1]!)];
  else if (degree === 2) {
    const b = normalized[1]!, c = normalized[2]!, discriminant = b * b - 4 * c;
    if (discriminant >= 0) { const q = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(discriminant)); result = q === 0 ? [complex(), complex()] : [complex(q), complex(c / q)]; }
    else { const imag = Math.sqrt(-discriminant) / 2; result = [complex(-b / 2, -imag), complex(-b / 2, imag)]; }
  } else {
    // Scale s=r*z so bounded Durand–Kerner iterates have order-one coefficients.
    const scale = Math.max(1e-12, ...normalized.slice(1).map((value, index) => Math.abs(value) ** (1 / (index + 1))));
    const scaled = normalized.map((value, index) => value / scale ** index), radius = 1 + Math.max(...scaled.slice(1).map(Math.abs));
    let estimates = Array.from({ length: degree }, (_, index) => complex(radius * Math.cos(2 * Math.PI * (index + 0.23) / degree), radius * Math.sin(2 * Math.PI * (index + 0.23) / degree)));
    let converged = false;
    for (let iteration = 0; iteration < 240; iteration += 1) {
      charge(degree * degree * 8);
      let maximumChange = 0;
      const next = estimates.map((value, index) => {
        let denominator = complex(1);
        for (let other = 0; other < degree; other += 1) if (index !== other) denominator = mul(denominator, sub(value, estimates[other]!));
        const change = divide(polynomial(scaled, value), denominator), replacement = sub(value, change);
        maximumChange = Math.max(maximumChange, magnitude(change));
        return replacement;
      });
      estimates = next;
      if (estimates.some((value) => !Number.isFinite(value.real) || !Number.isFinite(value.imag))) break;
      if (maximumChange < 1e-10) { converged = true; break; }
    }
    if (!converged) fail('CONTROL_ROOT_UNCERTAIN', '3~4차 근 계산이 수렴하지 않았습니다. 반복·근접 극점은 저차 모델이나 다른 수치 도구로 확인해 주세요.');
    result = estimates.map((value) => complex(value.real * scale, value.imag * scale));
  }
  if (degree >= 3 && result.some((root, index) => result.some((other, position) => position !== index && magnitude(sub(root, other)) < 1e-6 * Math.max(1, magnitude(root), magnitude(other))))) fail('CONTROL_ROOT_UNCERTAIN', '3~4차 다항식의 반복·근접 근에서는 극점의 실수부와 안정성을 확정하지 않습니다. 저차 모델 또는 별도 수치 해석으로 확인해 주세요.');
  for (const root of result) {
    charge(coefficients.length * 8);
    const residual = magnitude(polynomial(normalized, root)), norm = normalized.reduce((sum, value) => sum * Math.max(1, magnitude(root)) + Math.abs(value), 0);
    if (!Number.isFinite(root.real) || !Number.isFinite(root.imag) || !Number.isFinite(norm) || residual > 1e-7 * Math.max(1, norm)) fail('CONTROL_ROOT_UNCERTAIN', '다항식 근의 원시 잔차를 검증하지 못했습니다. 행렬의 수치 크기와 반복 극점을 확인해 주세요.');
    if (Math.abs(root.imag) <= 1e-9 * Math.max(1, Math.abs(root.real))) root.imag = 0;
  }
  return result.sort((a, b) => a.real - b.real || a.imag - b.imag);
}
/** Direct bounded determinant expansion avoids subtracting large matrix traces. */
function determinantPolynomial(cells: number[][][], charge: (work: number) => void): number[] {
  const n = cells.length, sums = Array<number>(n + 1).fill(0), corrections = Array<number>(n + 1).fill(0);
  const visit = (columns: number[]): void => {
    if (columns.length !== n) { for (let column = 0; column < n; column += 1) if (!columns.includes(column)) visit([...columns, column]); return; }
    let inversions = 0;
    for (let left = 0; left < n; left += 1) for (let right = left + 1; right < n; right += 1) if (columns[left]! > columns[right]!) inversions += 1;
    let product = [inversions % 2 ? -1 : 1];
    for (let row = 0; row < n; row += 1) {
      const cell = cells[row]![columns[row]!]!, next = Array<number>(product.length + cell.length - 1).fill(0);
      charge(product.length * cell.length);
      for (let index = 0; index < product.length; index += 1) for (let power = 0; power < cell.length; power += 1) {
        const term = product[index]! * cell[power]!;
        if (term === 0 && product[index] !== 0 && cell[power] !== 0) fail('CONTROL_TRANSFER_NUMERIC', '다항식 계수의 곱이 float64 최소 크기 아래로 내려갔습니다. 영 전달함수로 처리하지 않습니다. 행렬의 수치 크기를 조정해 주세요.');
        next[index + power] = next[index + power]! + term;
      }
      product = next;
    }
    product.forEach((value, index) => { const adjusted = value - corrections[index]!, total = sums[index]! + adjusted; corrections[index] = (total - sums[index]!) - adjusted; sums[index] = total; });
  };
  visit([]); return trim(sums.reverse());
}
function transfer(state: ControlStateSpace, charge: (work: number) => void): { denominator: number[]; numerator: number[] } {
  const n = state.A.length, cells = state.A.map((row, index) => row.map((value, column) => index === column ? [-value, 1] : [-value]));
  const denominator = determinantPolynomial(cells, charge), bordered = cells.map((row, index) => [...row, [-state.B[index]![0]!]]);
  bordered.push([...state.C[0]!.map((value) => [value]), [state.D[0]![0]!]]);
  const numerator = determinantPolynomial(bordered, charge);
  if ([...denominator, ...numerator].some((value) => !Number.isFinite(value))) fail('CONTROL_TRANSFER_NUMERIC', '상태공간에서 전달 다항식을 계산하는 수치 범위를 초과했습니다.');
  return { denominator, numerator };
}
function phaseMargin(phase: number): number { const wrapped = ((180 + phase) % 360 + 360) % 360; return wrapped > 180 ? wrapped - 360 : wrapped; }
function nearestBranches(previous: ComplexValue[], next: ComplexValue[]): ComplexValue[] {
  if (previous.length !== next.length) return next;
  let best = next, minimum = Infinity;
  const visit = (selected: ComplexValue[], remaining: ComplexValue[]): void => {
    if (!remaining.length) { const distance = selected.reduce((sum, value, index) => sum + magnitude(sub(value, previous[index]!)), 0); if (distance < minimum) { minimum = distance; best = selected; } return; }
    remaining.forEach((value, index) => visit([...selected, value], remaining.filter((_, other) => other !== index)));
  };
  visit([], next); return best;
}

/** Analyze a supplied continuous SISO local matrix snapshot as open-loop L(s). */
export function analyzeContinuousSiso(input: ControlStateSpace, spec: ControlAnalysisSpec = {}): ControlAnalysisReport {
  const stateSpace = validateStateSpace(input); plain(spec, ['frequencyMin', 'frequencyMax', 'frequencyPoints', 'rootLocusGains'], 'CONTROL_OPTIONS');
  const minimum = spec.frequencyMin ?? 0.01, maximum = spec.frequencyMax ?? 100, points = spec.frequencyPoints ?? 201;
  if (typeof minimum !== 'number' || typeof maximum !== 'number' || !Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < CONTROL_LIMITS.minFrequency || maximum > CONTROL_LIMITS.maxFrequency || minimum >= maximum || !Number.isSafeInteger(points) || points < 2 || points > CONTROL_LIMITS.maxFrequencyPoints) fail('CONTROL_OPTIONS', '주파수는 10⁻⁶~10⁶ rad/s의 증가 범위, 표본은 2~801개여야 합니다.');
  const gains = spec.rootLocusGains ?? Array.from({ length: 41 }, (_, index) => index / 4);
  array(gains, 0, CONTROL_LIMITS.maxRootLocusPoints, 'CONTROL_OPTIONS');
  if (gains.some((value, index) => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > CONTROL_LIMITS.maxGain || index > 0 && value <= gains[index - 1]!)) fail('CONTROL_OPTIONS', '근궤적 이득은 중복 없이 증가하는 0~10⁶ 실수여야 합니다.');
  let work = 0;
  const charge = (amount: number): void => { work += amount; if (work > CONTROL_LIMITS.maxWork) fail('CONTROL_WORK_BUDGET', '제어계 분석의 계산 상한을 초과했습니다. 표본·이득 개수를 줄여 주세요.'); };
  const { denominator, numerator } = transfer(stateSpace, charge), zeroTransfer = numerator.every((value) => value === 0), poles = roots(denominator, charge), zeros = zeroTransfer ? [] : roots(numerator, charge);
  const diagnostics = ['상태 극점과 미약분 전달 영점을 표시합니다. pole-zero 상쇄를 자동 적용하지 않습니다.'];
  if (gains.length) diagnostics.push('근궤적은 지정 이득의 원시 근 표본이며, 근접·반복 근에서는 가지 연결이 유일하지 않습니다.');
  if (zeroTransfer) diagnostics.push('영 전달함수입니다. dB·위상·여유를 정의하지 않습니다. 상태 극점은 그대로 표시합니다.');
  const evaluate = (omega: number): FrequencyPoint => {
    const response = stateResponse(stateSpace, omega, charge);
    if (!response) return { omega, real: null, imag: null, magnitude: null, gainDb: null, phaseDegrees: null, status: 'singular' };
    const gain = magnitude(response);
    if (![response.real, response.imag, gain].every(Number.isFinite)) return { omega, real: null, imag: null, magnitude: null, gainDb: null, phaseDegrees: null, status: 'nonfinite' };
    if (gain === 0) return { omega, real: response.real, imag: response.imag, magnitude: 0, gainDb: null, phaseDegrees: null, status: 'zero' };
    return { omega, real: response.real, imag: response.imag, magnitude: gain, gainDb: 20 * Math.log10(gain), phaseDegrees: Math.atan2(response.imag, response.real) * 180 / Math.PI, status: 'finite' };
  };
  const bode = Array.from({ length: points }, (_, index) => evaluate(index === 0 ? minimum : index === points - 1 ? maximum : Math.exp(Math.log(minimum) + index / (points - 1) * Math.log(maximum / minimum))));
  // Independently compare polynomial extraction with the direct state solution.
  for (const point of bode) {
    if (point.status !== 'finite' && point.status !== 'zero') continue;
    charge((denominator.length + numerator.length) * 8);
    const at = complex(0, point.omega), estimated = divide(polynomial(numerator, at), polynomial(denominator, at)), direct = complex(point.real!, point.imag!), scale = Math.max(1e-300, magnitude(estimated), magnitude(direct));
    if (!Number.isFinite(estimated.real) || !Number.isFinite(estimated.imag) || magnitude(sub(estimated, direct)) > 1e-6 * scale) fail('CONTROL_TRANSFER_UNCERTAIN', '전달 다항식과 원시 상태공간 주파수 응답이 수치적으로 일치하지 않습니다. 극점·영점·근궤적을 확정하지 않습니다. 행렬의 크기와 조건을 확인해 주세요.');
  }
  let previousPhase: number | undefined;
  for (const point of bode) {
    if (point.phaseDegrees === null) { previousPhase = undefined; continue; }
    if (previousPhase !== undefined) { while (point.phaseDegrees - previousPhase > 180) point.phaseDegrees -= 360; while (point.phaseDegrees - previousPhase < -180) point.phaseDegrees += 360; }
    previousPhase = point.phaseDegrees;
  }
  const margins: ControlMargins = { convention: 'unity-negative-feedback-open-loop', status: 'no-crossing-in-range', gainCrossovers: [], phaseCrossovers: [], phaseMarginDegrees: null, gainMargin: null, gainMarginDb: null, diagnostics: ['선택한 국소 행렬을 개루프 L(s)로 보고 unity 음의 피드백을 가정합니다. 전체 도식의 폐루프를 자동 추론하지 않습니다.', '유한 로그 주파수 표본과 구간 내 이분법 교차 탐색입니다. 접선 교차·좁은 교차·범위 밖 교차를 모두 검출한다고 보장하지 않습니다.'] };
  const refine = (left: FrequencyPoint, right: FrequencyPoint, kind: 'gain' | 'phase'): FrequencyPoint | undefined => {
    const value = (point: FrequencyPoint): number => kind === 'gain' ? Math.log(point.magnitude!) : point.imag! / point.magnitude!;
    let a = left, b = right;
    if (Math.abs(value(a)) < 1e-12) return a;
    if (Math.abs(value(b)) < 1e-12) return b;
    for (let iteration = 0; iteration < 48; iteration += 1) { const middle = evaluate(Math.sqrt(a.omega * b.omega)); if (middle.status !== 'finite') return; const current = value(middle); if (Math.abs(current) < 1e-12 || b.omega / a.omega - 1 < 1e-11) return middle; if (value(a) * current <= 0) b = middle; else a = middle; }
    return evaluate(Math.sqrt(a.omega * b.omega));
  };
  const unique = (items: { omega: number }[], omega: number): boolean => !items.some((item) => Math.abs(Math.log(item.omega / omega)) < 1e-7);
  const flatNegative = bode.every((point) => point.status === 'finite' && point.real! < 0 && Math.abs(point.imag!) < 1e-12 * point.magnitude!);
  const flatUnity = bode.every((point) => point.status === 'finite' && Math.abs(Math.log(point.magnitude!)) < 1e-12);
  if (flatNegative) margins.diagnostics.push('위상이 선택 범위 전체에서 ±180°입니다. 고립된 위상 교차 주파수·단일 이득 여유를 정하지 않습니다.');
  if (flatUnity) margins.diagnostics.push('선택 범위 전체가 0 dB입니다. 고립된 이득 교차 주파수·단일 위상 여유를 정하지 않습니다.');
  let phasePlateau = false;
  for (let index = 1; index < bode.length; index += 1) {
    const a = bode[index - 1]!, b = bode[index]!;
    if (a.status !== 'finite' || b.status !== 'finite') { margins.status = 'incomplete'; continue; }
    if (!flatUnity && Math.log(a.magnitude!) * Math.log(b.magnitude!) <= 0) {
      const point = refine(a, b, 'gain');
      if (point && unique(margins.gainCrossovers, point.omega)) { let phase = point.phaseDegrees!; const reference = (a.phaseDegrees! + b.phaseDegrees!) / 2; while (phase - reference > 180) phase -= 360; while (phase - reference < -180) phase += 360; margins.gainCrossovers.push({ omega: point.omega, phaseDegrees: phase, phaseMarginDegrees: phaseMargin(phase) }); }
      else if (!point) margins.status = 'incomplete';
    }
    const zeroImagA = Math.abs(a.imag! / a.magnitude!) < 1e-12, zeroImagB = Math.abs(b.imag! / b.magnitude!) < 1e-12;
    if (zeroImagA && zeroImagB && a.real! < 0 && b.real! < 0) phasePlateau = true;
    if (!flatNegative && !(zeroImagA && zeroImagB) && (a.imag! * b.imag! < 0 || zeroImagA || zeroImagB)) {
      const point = refine(a, b, 'phase');
      if (point && point.real! < 0 && unique(margins.phaseCrossovers, point.omega)) {
        const gainMargin = 1 / point.magnitude!;
        if (Number.isFinite(gainMargin)) margins.phaseCrossovers.push({ omega: point.omega, magnitude: point.magnitude!, gainMargin, gainMarginDb: -20 * Math.log10(point.magnitude!) });
        else { margins.status = 'incomplete'; if (!margins.diagnostics.includes('이득 여유가 float64 범위를 초과해 숫자로 표시하지 않습니다.')) margins.diagnostics.push('이득 여유가 float64 범위를 초과해 숫자로 표시하지 않습니다.'); }
      }
      else if (!point) margins.status = 'incomplete';
    }
  }
  if (margins.gainCrossovers.length) margins.phaseMarginDegrees = margins.gainCrossovers.reduce((best, item) => Math.abs(item.phaseMarginDegrees) < Math.abs(best) ? item.phaseMarginDegrees : best, margins.gainCrossovers[0]!.phaseMarginDegrees);
  if (margins.phaseCrossovers.length) { const closest = margins.phaseCrossovers.reduce((best, item) => Math.abs(item.gainMarginDb) < Math.abs(best.gainMarginDb) ? item : best); margins.gainMargin = closest.gainMargin; margins.gainMarginDb = closest.gainMarginDb; }
  if (margins.status !== 'incomplete' && (margins.gainCrossovers.length || margins.phaseCrossovers.length)) margins.status = 'finite-crossings';
  if (!margins.gainCrossovers.length) margins.diagnostics.push('선택 범위에서 0 dB 교차를 찾지 못했습니다. 위상 여유는 미확정이며 무한대로 표시하지 않습니다.');
  if (!margins.phaseCrossovers.length) margins.diagnostics.push('선택 범위에서 고립된 -180° 교차를 찾지 못했습니다. 이득 여유는 미확정이며 무한대로 표시하지 않습니다.');
  if (phasePlateau && !flatNegative) margins.diagnostics.push('일부 구간의 위상이 ±180°에 머뭅니다. 그 구간의 표본을 고립된 위상 교차로 계산하지 않습니다.');
  if (flatNegative || flatUnity || phasePlateau) margins.status = 'incomplete';
  const rootLocus: RootLocusPoint[] = []; let previous: ComplexValue[] = [], rootBudgetExhausted = false;
  for (const gain of gains) {
    if (rootBudgetExhausted) { rootLocus.push({ gain, poles: [], status: 'unsupported', diagnostics: ['근궤적의 공유 계산 한도를 사용해 이후 이득 표본을 계산하지 않았습니다.'] }); continue; }
    const leading = 1 + gain * stateSpace.D[0]![0]!;
    if (Math.abs(leading) <= 32 * Number.EPSILON * Math.max(1, Math.abs(gain * stateSpace.D[0]![0]!))) { rootLocus.push({ gain, poles: [], status: 'ill-posed', diagnostics: ['1+kD=0으로 unity 음의 피드백의 대수 경계를 풀 수 없습니다.'] }); previous = []; continue; }
    const offset = denominator.length - numerator.length, characteristic = denominator.map((value, index) => value + (index >= offset ? gain * numerator[index - offset]! : 0));
    try { const current = roots(characteristic, charge), arranged = nearestBranches(previous, current); rootLocus.push({ gain, poles: arranged, status: 'completed', diagnostics: [] }); previous = arranged; }
    catch (error) { if (error instanceof ModelError && error.diagnostics.some((item) => item.code === 'CONTROL_WORK_BUDGET')) rootBudgetExhausted = true; rootLocus.push({ gain, poles: [], status: 'unsupported', diagnostics: [error instanceof ModelError ? error.diagnostics[0]!.message : '근궤적 근을 검증하지 못했습니다.'] }); previous = []; }
  }
  const stabilityScale = Math.max(1, ...poles.map(magnitude)), tolerance = 1e-9 * stabilityScale;
  const stability = poles.some((pole) => pole.real > tolerance) ? 'unstable' : poles.some((pole) => pole.real >= -tolerance) ? 'boundary' : 'stable';
  if (stability === 'boundary') diagnostics.push('허수축 경계와 가까운 상태 극점입니다. 수치 허용 오차 안의 안정성을 단정하지 않습니다.');
  return { stateSpace, stateOrder: stateSpace.A.length, denominator, numerator, poles, zeros, zeroTransfer, stability, bode, margins, rootLocus, diagnostics, frequencyRange: { minimum, maximum, points } };
}
