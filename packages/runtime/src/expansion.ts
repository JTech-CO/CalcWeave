import { ModelError, type IRNode, type SignalValue } from '../../model/src/types';

const expansionFunctions: Readonly<Record<string, (x: number) => number>> = Object.freeze({
  'math.cbrt': Math.cbrt, 'math.expm1': Math.expm1, 'math.log1p': Math.log1p, 'math.log2': Math.log2,
  'math.exp2': x => 2 ** x, 'math.sinh': Math.sinh, 'math.cosh': Math.cosh, 'math.tanh': Math.tanh,
  'math.asinh': Math.asinh, 'math.acosh': Math.acosh, 'math.atanh': Math.atanh,
});
function expansionFail(nodeId: string, code: string, message: string): never { throw new ModelError([{ code, nodeId, message }]); }
function expansionFinite(value: unknown, nodeId: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) expansionFail(nodeId, 'NUMERIC_NONFINITE', '신규 연산의 입력·중간값·출력은 유한한 실수여야 합니다.');
  return value as number;
}
function expansionFlat(value: SignalValue): (number | boolean)[] {
  if (typeof value === 'object' && !Array.isArray(value)) throw new ModelError([{ code: 'RUNTIME_TYPE_MISMATCH', message: '이 연산은 기존 실수·논리 신호만 지원합니다. 명시적인 자료형 경계를 연결하세요.' }]);
  return !Array.isArray(value) ? [value] : Array.isArray(value[0]) ? (value as number[][] | boolean[][]).flat() : [...value] as number[] | boolean[];
}
function expansionShape(values: (number | boolean)[], shape: number[]): SignalValue {
  if (!shape.length) return values[0]!;
  if (shape.length === 1) return values as number[] | boolean[];
  return Array.from({ length: shape[0]! }, (_, row) => values.slice(row * shape[1]!, (row + 1) * shape[1]!)) as number[][] | boolean[][];
}
function expansionMean(values: number[], nodeId: string): number {
  let sum = 0, compensation = 0;
  for (const value of values) {
    const next = sum + value;
    if (!Number.isFinite(next)) {
      const scale = Math.max(...values.map(Math.abs));
      return expansionFinite(expansionMean(values.map(item => item / scale), nodeId) * scale, nodeId);
    }
    compensation += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  const total = sum + compensation;
  if (Number.isFinite(total)) return expansionFinite(total / values.length, nodeId);
  const scale = Math.max(...values.map(Math.abs));
  return expansionFinite(expansionMean(values.map(item => item / scale), nodeId) * scale, nodeId);
}
function expansionAveragePair(a: number, b: number, nodeId: string): number {
  if (a === b) return a;
  const sum = a + b;
  return expansionFinite(Number.isFinite(sum) ? sum / 2 : a / 2 + b / 2, nodeId);
}
function expansionStd(values: number[], nodeId: string): number {
  // Translate before scaling so a large common offset does not erase small differences.
  // Opposite extreme signs can overflow subtraction; raw scaling remains safe in that case.
  const shifted = values.map(value => value - values[0]!);
  const centered = shifted.every(Number.isFinite) ? shifted : values;
  const scale = Math.max(...centered.map(Math.abs));
  if (scale === 0) return 0;
  const normalized = centered.map(value => value / scale), mean = expansionMean(normalized, nodeId);
  const variance = normalized.reduce((sum, value) => sum + (value - mean) ** 2 / values.length, 0);
  return expansionFinite(scale * Math.sqrt(variance), nodeId);
}

/** Fixed mathematical kernels. Arbitrary model text is never used as JS source or a function name. */
export function evaluateExpansionNode(node: IRNode, input: (port: string) => SignalValue): Record<string, SignalValue> | undefined {
  const id = node.id, kind = node.blockType, p = node.parameters, shape = node.outputs.out?.shape ?? [];
  const finite = (value: unknown): number => expansionFinite(value, id);
  const numbers = (port = 'in'): number[] => expansionFlat(input(port)).map(finite);
  const unary = (operation: (x: number) => number | boolean): SignalValue => expansionShape(numbers().map(x => { const value = operation(x); return typeof value === 'boolean' ? value : finite(value); }), shape);
  const binary = (operation: (a: number, b: number) => number | boolean): SignalValue => {
    const a = numbers('a'), b = numbers('b'), count = shape.reduce((n, axis) => n * axis, 1);
    return expansionShape(Array.from({ length: count }, (_, index) => { const value = operation(a[a.length === 1 ? 0 : index]!, b[b.length === 1 ? 0 : index]!); return typeof value === 'boolean' ? value : finite(value); }), shape);
  };
  const domain = (valid: boolean): void => { if (!valid) expansionFail(id, 'NUMERIC_DOMAIN', '신규 연산의 실수 정의역을 벗어났습니다.'); };
  const array = (port = 'in'): (number | boolean)[] => expansionFlat(input(port));
  const matrix = (port = 'in'): (number | boolean)[][] => input(port) as number[][] | boolean[][];
  let value: SignalValue;
  if (Object.hasOwn(expansionFunctions, kind)) return { out: unary(x => {
    if (kind === 'math.log1p') domain(x > -1);
    if (kind === 'math.log2') domain(x > 0);
    if (kind === 'math.acosh') domain(x >= 1);
    if (kind === 'math.atanh') domain(Math.abs(x) < 1);
    return expansionFunctions[kind]!(x);
  }) };
  switch (kind) {
    case 'math.bias': value = unary(x => x + finite(p.bias)); break;
    case 'math.sign': value = unary(Math.sign); break;
    case 'math.sinc': value = unary(x => x === 0 ? 1 : Number.isInteger(x) ? 0 : Math.sin(Math.PI * x) / (Math.PI * x)); break;
    case 'math.polynomial': value = unary(x => (p.coefficients as number[]).reduce((acc, coefficient) => finite(finite(acc * x) + coefficient), 0)); break;
    case 'math.power': value = binary((a, b) => { domain(!(a < 0 && !Number.isInteger(b)) && !(a === 0 && b < 0)); return a ** b; }); break;
    case 'math.hypot': value = binary(Math.hypot); break;
    case 'math.atan2': value = binary(Math.atan2); break;
    case 'math.mod': case 'math.remainder': value = binary((a, b) => { if (b === 0) expansionFail(id, 'NUMERIC_DIVIDE_BY_ZERO', '나머지의 제수는 0이 아니어야 합니다.'); const rem = a % b; return kind === 'math.mod' && rem !== 0 && Math.sign(rem) !== Math.sign(b) ? rem + b : rem; }); break;
    case 'nonlinear.dead-zone': value = unary(x => x < (p.lower as number) ? x - (p.lower as number) : x > (p.upper as number) ? x - (p.upper as number) : 0); break;
    case 'nonlinear.quantizer': value = unary(x => { const quotient = finite(x / finite(p.step)), absolute = Math.abs(quotient), base = Math.floor(absolute); return Math.sign(quotient) * (base + (absolute - base >= .5 ? 1 : 0)) * finite(p.step); }); break;
    case 'logic.interval': value = unary(x => x >= (p.lower as number) && x <= (p.upper as number)); break;
    case 'logic.is-integer': value = unary(Number.isInteger); break;
    case 'logic.approx-equal': value = binary((a, b) => Math.abs(a - b) <= (p.tolerance as number)); break;
    case 'reduce.all': value = array().every(item => item === true); break;
    case 'reduce.any': value = array().some(item => item === true); break;
    case 'reduce.sum': value = numbers().reduce((sum, x) => finite(sum + x), 0); break;
    case 'reduce.product': value = numbers().reduce((product, x) => finite(product * x), 1); break;
    case 'reduce.mean': value = expansionMean(numbers(), id); break;
    case 'reduce.median': { const values = numbers().sort((a, b) => a < b ? -1 : a > b ? 1 : 0), middle = Math.floor(values.length / 2); value = values.length % 2 ? values[middle]! : expansionAveragePair(values[middle - 1]!, values[middle]!, id); break; }
    case 'reduce.variance': { const std = expansionStd(numbers(), id); value = finite(std * std); break; }
    case 'reduce.std': value = expansionStd(numbers(), id); break;
    case 'reduce.norm1': value = numbers().reduce((sum, x) => finite(sum + Math.abs(x)), 0); break;
    case 'reduce.norm2': value = finite(Math.hypot(...numbers())); break;
    case 'reduce.norm-inf': value = Math.max(...numbers().map(Math.abs)); break;
    case 'reduce.rms': { const values = numbers(), scale = Math.max(...values.map(Math.abs)); value = scale === 0 ? 0 : finite(scale * Math.sqrt(values.reduce((sum, x) => sum + (x / scale) ** 2 / values.length, 0))); break; }
    case 'vector.dot': { const a = numbers('a'), b = numbers('b'); value = a.reduce((sum, x, index) => finite(sum + finite(x * b[index]!)), 0); break; }
    case 'vector.cross': { const a = numbers('a'), b = numbers('b'); value = [finite(finite(a[1]! * b[2]!) - finite(a[2]! * b[1]!)), finite(finite(a[2]! * b[0]!) - finite(a[0]! * b[2]!)), finite(finite(a[0]! * b[1]!) - finite(a[1]! * b[0]!))]; break; }
    case 'vector.normalize': { const values = numbers(), scale = Math.max(...values.map(Math.abs)); domain(scale > 0); const norm = Math.hypot(...values.map(x => x / scale)); value = values.map(x => finite((x / scale) / norm)); break; }
    case 'vector.reverse': value = array().reverse() as number[] | boolean[]; break;
    case 'vector.sort': value = numbers().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0) * (p.order === 'ascending' ? 1 : -1)); break;
    case 'vector.cumsum': case 'vector.cumprod': { let accumulated = kind === 'vector.cumsum' ? 0 : 1; value = numbers().map(x => accumulated = finite(kind === 'vector.cumsum' ? accumulated + x : accumulated * x)); break; }
    case 'vector.difference': { const values = numbers(); value = values.slice(1).map((x, index) => finite(x - values[index]!)); break; }
    case 'vector.select': { const values = array(); value = (p.indices as number[]).map(index => values[index]!) as number[] | boolean[]; break; }
    case 'vector.slice': value = array().slice(p.start as number, (p.start as number) + (p.count as number)) as number[] | boolean[]; break;
    case 'vector.repeat': { const values = array(); value = Array.from({ length: p.count as number }, () => values).flat() as number[] | boolean[]; break; }
    case 'vector.convolve': { const a = numbers('a'), b = numbers('b'), out = Array(a.length + b.length - 1).fill(0) as number[]; for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] = finite(out[i + j]! + finite(a[i]! * b[j]!)); value = out; break; }
    case 'matrix.trace': value = matrix().reduce((sum: number, row, index) => finite(sum + finite(row[index])), 0); break;
    case 'matrix.diagonal': { const values = matrix(); value = Array.from({ length: Math.min(values.length, values[0]!.length) }, (_, index) => values[index]![index]!) as number[] | boolean[]; break; }
    case 'matrix.diag-create': { const values = array(), zero = typeof values[0] === 'boolean' ? false : 0; value = values.map((x, row) => values.map((_, column) => row === column ? x : zero)) as number[][] | boolean[][]; break; }
    case 'matrix.identity': value = Array.from({ length: p.size as number }, (_, row) => Array.from({ length: p.size as number }, (_, column) => row === column ? 1 : 0)); break;
    case 'matrix.select': { const values = matrix(); value = (p.rows as number[]).map(row => (p.columns as number[]).map(column => values[row]![column]!)) as number[][] | boolean[][]; break; }
    case 'matrix.row': value = [...matrix()[p.index as number]!] as number[] | boolean[]; break;
    case 'matrix.column': value = matrix().map(row => row[p.index as number]!) as number[] | boolean[]; break;
    case 'matrix.horizontal': { const a = matrix('a'), b = matrix('b'); value = a.map((row, index) => [...row, ...b[index]!]) as number[][] | boolean[][]; break; }
    case 'matrix.vertical': value = [...matrix('a').map(row => [...row]), ...matrix('b').map(row => [...row])] as number[][] | boolean[][]; break;
    case 'matrix.triangle': { const values = matrix(), zero = typeof values[0]![0] === 'boolean' ? false : 0; value = values.map((row, i) => row.map((x, j) => (p.part === 'upper' ? j >= i : j <= i) ? x : zero)) as number[][] | boolean[][]; break; }
    case 'matrix.symmetrize': { const values = matrix(); value = values.map((row, i) => row.map((x, j) => expansionAveragePair(finite(x), finite(values[j]![i]), id))); break; }
    case 'matrix.kronecker': { const a = matrix('a'), b = matrix('b'); value = Array.from({ length: a.length * b.length }, (_, row) => Array.from({ length: a[0]!.length * b[0]!.length }, (_, column) => finite(finite(a[Math.floor(row / b.length)]![Math.floor(column / b[0]!.length)]) * finite(b[row % b.length]![column % b[0]!.length])))); break; }
    case 'source.linspace': case 'source.logspace': { const start = finite(p.start), stop = finite(p.stop), count = p.count as number; value = Array.from({ length: count }, (_, index) => { const t = count === 1 ? 0 : index / (count - 1); const x = index === 0 || start === stop ? start : index === count - 1 ? stop : finite(start * (1 - t) + stop * t); return finite(kind === 'source.logspace' ? 10 ** x : x); }); break; }
    case 'source.zeros': value = p.form === 'matrix' ? Array.from({ length: p.rows as number }, () => Array(p.columns as number).fill(0)) : Array(p.length as number).fill(0); break;
    default: return undefined;
  }
  return { out: value };
}
