import { ModelError } from '../../model/src/types';

export interface M12NewtonOptions { nodeId: string; atol: number; rtol: number; maxIterations?: number; fdStep?: number; charge?: (work: number) => void }
export interface M12NewtonResult { state: number[]; residual: number; iterations: number; pivotRatio: number }
const m12NumericalFailure = (code: string, id: string, message: string): never => { throw new ModelError([{ code, nodeId: id, message }]); };
const m12Finite = (value: number, id: string): number => Number.isFinite(value) ? value : m12NumericalFailure('M12_NUMERIC_NONFINITE', id, '유한한 수치 잔차·Jacobian이 필요합니다.');

/** Owned dense elimination. The selected solver rejects badly scaled/singular pivots. */
export function m12LinearSolve(matrix: number[][], rhs: number[], id: string, charge: (work: number) => void = () => {}): { solution: number[]; pivotRatio: number } {
  const n = rhs.length;
  if (n < 1 || n > 64 || matrix.length !== n || matrix.some(row => row.length !== n)) m12NumericalFailure('M12_LINEAR_DIMENSION', id, '밀집 수치 풀이의 차원은1~64여야 합니다.');
  charge(n * n * n + 4 * n * n + n);
  const a = matrix.map(row => row.map(value => m12Finite(value, id))), b = rhs.map(value => m12Finite(value, id));
  const scale = Math.max(...a.map(row => Math.max(...row.map(Math.abs))));
  if (!(scale > 0)) m12NumericalFailure('M12_NEWTON_SINGULAR', id, 'Jacobian이 특이합니다(pivot=0).');
  let minimum = Infinity, maximum = 0;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row]![col]!) > Math.abs(a[pivot]![col]!)) pivot = row;
    const magnitude = Math.abs(a[pivot]![col]!);
    if (!(magnitude > scale * 1e-12)) m12NumericalFailure('M12_NEWTON_SINGULAR', id, `Jacobian의 상대 pivot이1e-12 이하여서 풀 수 없습니다(pivot=${magnitude},scale=${scale}).`);
    minimum = Math.min(minimum, magnitude); maximum = Math.max(maximum, magnitude);
    [a[col], a[pivot]] = [a[pivot]!, a[col]!]; [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    for (let row = col + 1; row < n; row += 1) {
      const factor = a[row]![col]! / a[col]![col]!; a[row]![col] = 0;
      for (let j = col + 1; j < n; j += 1) a[row]![j] = m12Finite(a[row]![j]! - factor * a[col]![j]!, id);
      b[row] = m12Finite(b[row]! - factor * b[col]!, id);
    }
  }
  const solution = Array(n).fill(0) as number[];
  for (let row = n - 1; row >= 0; row -= 1) solution[row] = m12Finite((b[row]! - a[row]!.slice(row + 1).reduce((sum, value, j) => sum + value * solution[row + j + 1]!, 0)) / a[row]![row]!, id);
  return { solution, pivotRatio: maximum / minimum };
}

/** Central differences use the actual representable separation, including large coordinates. */
export function m12Jacobian(fn: (x: number[]) => number[], x: number[], id: string, fdStep = Math.cbrt(Number.EPSILON), charge: (work: number) => void = () => {}): number[][] {
  if (x.length < 1 || x.length > 64 || !(fdStep > 0) || !Number.isFinite(fdStep)) m12NumericalFailure('M12_JACOBIAN_DIMENSION', id, 'Jacobian 차원·차분 간격을 확인하세요.');
  let result: number[][] | undefined;
  for (let j = 0; j < x.length; j += 1) {
    const h = fdStep * Math.max(1, Math.abs(x[j]!)), plus = [...x], minus = [...x]; plus[j] = x[j]! + h; minus[j] = x[j]! - h;
    const separation = plus[j]! - minus[j]!;
    if (!(separation > 0) || !Number.isFinite(separation)) m12NumericalFailure('M12_DIFFERENCE_RESOLUTION', id, '운전점에서 유한 차분 간격을 표현할 수 없습니다.');
    const a = fn(plus), b = fn(minus);
    if (a.length !== b.length || a.length < 1 || a.length > 64 || result && result.length !== a.length) m12NumericalFailure('M12_JACOBIAN_DIMENSION', id, 'Jacobian 함수의 출력 차원이 바뀌었습니다.');
    result ??= Array.from({ length: a.length }, () => Array(x.length).fill(0) as number[]);
    charge(a.length * 3 + x.length * 2);
    for (let i = 0; i < a.length; i += 1) result[i]![j] = m12Finite((a[i]! - b[i]!) / separation, id);
  }
  return result!;
}

/** No state, output publication, RNG or history mutation occurs during a Newton trial. */
export function m12Newton(fn: (x: number[]) => number[], initial: number[], options: M12NewtonOptions): M12NewtonResult {
  const { nodeId: id, atol, rtol } = options, charge = options.charge ?? (() => {}), maxIterations = options.maxIterations ?? 32;
  if (initial.length < 1 || initial.length > 64 || !(atol > 0) || !Number.isFinite(atol) || rtol < 0 || !Number.isFinite(rtol) || !Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 32) m12NumericalFailure('M12_NEWTON_OPTIONS', id, 'Newton 차원·허용오차·반복 한도를 확인하세요.');
  let x = initial.map(value => m12Finite(value, id)), pivotRatio = 1;
  const residual = (point: number[]): number[] => { charge(point.length * 3 + 1); const value = fn([...point]); if (value.length !== x.length) m12NumericalFailure('M12_RESIDUAL_DIMENSION', id, '미지수와 잔차의 차원이 같아야 합니다.'); return value.map(element => m12Finite(element, id)); };
  const norm = (value: number[], point: number[]): number => value.reduce((maximum, element, index) => Math.max(maximum, Math.abs(element) / (atol + rtol * Math.max(Math.abs(initial[index]!), Math.abs(point[index]!)))), 0);
  let value = residual(x), error = norm(value, x);
  for (let iteration = 0; iteration <= maxIterations; iteration += 1) {
    charge(x.length * 4);
    if (error <= 1) return { state: x, residual: Math.max(...value.map(Math.abs)), iterations: iteration, pivotRatio };
    if (iteration === maxIterations) break;
    const jacobian = m12Jacobian(residual, x, id, options.fdStep, charge), solved = m12LinearSolve(jacobian, value.map(element => -element), id, charge);
    pivotRatio = Math.max(pivotRatio, solved.pivotRatio);
    let accepted = false;
    for (let search = 0; search < 12; search += 1) {
      charge(x.length * 3 + 1);
      const factor = 2 ** -search, candidate = x.map((element, index) => m12Finite(element + factor * solved.solution[index]!, id));
      let next: number[];
      try { next = residual(candidate); } catch (failure) { if (failure instanceof ModelError && failure.diagnostics.every(item => item.code === 'M12_NUMERIC_NONFINITE' || item.code.startsWith('NUMERIC_'))) continue; throw failure; }
      const candidateError = norm(next, candidate);
      if (candidateError <= 1 || candidateError < error * (1 - 1e-4 * factor)) { x = candidate; value = next; error = candidateError; accepted = true; break; }
    }
    if (!accepted) m12NumericalFailure('M12_NEWTON_CONVERGENCE', id, `Newton 선형 탐색12회가 잔차를 줄이지 못했습니다(iteration=${iteration},residual=${Math.max(...value.map(Math.abs))}).`);
  }
  return m12NumericalFailure('M12_NEWTON_CONVERGENCE', id, `Newton 반복${maxIterations}회에서 수렴하지 못했습니다(residual=${Math.max(...value.map(Math.abs))}).`);
}
