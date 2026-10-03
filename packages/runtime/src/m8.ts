import { ModelError, type IRNode, type SignalValue } from '../../model/src/types';
import { matrixMultiply, transpose } from '../../advanced-math/src';

function m8Fail(nodeId: string, code: string, message: string): never { throw new ModelError([{ code, nodeId, message }]); }
function m8Finite(value: unknown, nodeId: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) m8Fail(nodeId, 'NUMERIC_NONFINITE', '입력·중간값·출력은 유한한 실수여야 합니다.');
  return value as number;
}
function m8Flat(value: SignalValue): (number | boolean)[] {
  if (typeof value === 'object' && !Array.isArray(value)) throw new ModelError([{ code: 'RUNTIME_TYPE_MISMATCH', message: '이 연산은 기존 실수·논리 신호만 지원합니다. 명시적인 자료형 경계를 연결하세요.' }]);
  return !Array.isArray(value) ? [value] : Array.isArray(value[0]) ? (value as number[][] | boolean[][]).flat() : [...value] as number[] | boolean[];
}
function m8Shape(values: (number | boolean)[], shape: number[]): SignalValue {
  if (!shape.length) return values[0]!;
  if (shape.length === 1) return values as number[] | boolean[];
  return Array.from({ length: shape[0]! }, (_, row) => values.slice(row * shape[1]!, (row + 1) * shape[1]!)) as number[][] | boolean[][];
}
function m8Copy(value: SignalValue): SignalValue {
  return !Array.isArray(value) ? value : Array.isArray(value[0]) ? (value as number[][] | boolean[][]).map(row => [...row]) as number[][] | boolean[][] : [...value] as number[] | boolean[];
}
function m8Scale(value: SignalValue, gain: number, id: string): SignalValue {
  const shape = !Array.isArray(value) ? [] : Array.isArray(value[0]) ? [value.length, value[0]!.length] : [value.length];
  return m8Shape(m8Flat(value).map(element => m8Finite(m8Finite(element, id) * gain, id)), shape);
}
function m8Mean(values: number[], id: string): number {
  let sum = 0, compensation = 0;
  for (const value of values) {
    const next = sum + value;
    if (!Number.isFinite(next)) { const scale = Math.max(...values.map(Math.abs)); return m8Finite(m8Mean(values.map(item => item / scale), id) * scale, id); }
    compensation += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum; sum = next;
  }
  const total = sum + compensation;
  if (Number.isFinite(total)) return m8Finite(total / values.length, id);
  const scale = Math.max(...values.map(Math.abs)); return m8Finite(m8Mean(values.map(item => item / scale), id) * scale, id);
}
function m8VectorGram(values: number[], id: string): number {
  const scale = Math.max(...values.map(Math.abs));
  if (scale === 0) return 0;
  if (scale < Math.sqrt(2 ** -1022)) {
    const normalized = values.reduce((sum, value) => sum + (value / scale) ** 2, 0);
    // Multiply by scale twice without first underflowing scale squared.
    return m8Finite((normalized * scale) * scale, id);
  }
  let sum = 0, compensation = 0;
  for (const value of values) {
    const square = m8Finite(value * value, id), next = m8Finite(sum + square, id);
    compensation += Math.abs(sum) >= square ? (sum - next) + square : (square - next) + sum; sum = next;
  }
  return m8Finite(sum + compensation, id);
}
function m8Integer(value: unknown, min: number, max: number, id: string): number {
  const index = m8Finite(value, id);
  if (!Number.isSafeInteger(index) || index < min || index > max) m8Fail(id, 'NUMERIC_INDEX_RANGE', 'index는 허용 범위 안의 정수여야 합니다.');
  return index;
}
/** Exact knots and constant extrapolation retain the supplied value, including subnormals. */
function m8Lerp(a: number, b: number, fraction: number, id: string): number {
  if (fraction === 0 || a === b) return a;
  if (fraction === 1) return b;
  if (fraction >= 0 && fraction <= 1) {
    if (Math.max(Math.abs(a), Math.abs(b)) < 2 ** -1021) {
      // An exact power-of-two rescaling avoids independently rounding each
      // subnormal product before their sum. The final multiplication rounds once.
      const scaled = (a * 2 ** 1022) * (1 - fraction) + (b * 2 ** 1022) * fraction;
      return m8Finite(scaled * 2 ** -1022, id);
    }
    return m8Finite(a * (1 - fraction) + b * fraction, id);
  }
  const difference = b - a, product = difference * fraction;
  if (Number.isFinite(difference) && Number.isFinite(product)) return m8Finite(a + product, id);
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return m8Finite(scale * (a / scale + fraction * (Number.isFinite(difference) ? difference / scale : b / scale - a / scale)), id);
}
function m8Segment(value: number, points: number[], outside: string, id: string): { index: number; fraction: number } {
  if (points.length < 2 || points.length > 1024 || points.some((point, index) => !Number.isFinite(point) || index > 0 && point <= points[index - 1]!)) m8Fail(id, 'INVALID_BREAKPOINTS', '조회 축은 엄격히 증가하는 유한한 2~1,024개 숫자여야 합니다.');
  const last = points.length - 1;
  if (value < points[0]! || value > points[last]!) {
    if (outside === 'error') m8Fail(id, 'LOOKUP_OUT_OF_RANGE', '조회 입력이 축의 범위를 벗어났습니다.');
    if (outside === 'clip') value = Math.max(points[0]!, Math.min(points[last]!, value));
  }
  let index = 0;
  if (value >= points[last]!) index = last - 1;
  else { let lower = 0, upper = last; while (lower + 1 < upper) { const middle = Math.floor((lower + upper) / 2); if (value >= points[middle]!) lower = middle; else upper = middle; } index = lower; }
  const a = points[index]!, b = points[index + 1]!, numerator = value - a, denominator = b - a;
  const scale = Math.max(Math.abs(value), Math.abs(a), Math.abs(b));
  const fraction = Number.isFinite(numerator) && Number.isFinite(denominator) ? numerator / denominator : (value / scale - a / scale) / (b / scale - a / scale);
  return { index, fraction: m8Finite(fraction, id) };
}
function m8TableValue(table: number[], index: number, fraction: number, interpolation: string, id: string): number {
  if (interpolation === 'nearest') return table[index + (fraction > .5 ? 1 : 0)]!;
  if (interpolation === 'previous') return table[index + (fraction >= 1 ? 1 : 0)]!;
  if (interpolation === 'linear') return m8Lerp(table[index]!, table[index + 1]!, fraction, id);
  return m8Fail(id, 'RUNTIME_INVALID_IR', '승인하지 않은 보간 방식입니다.');
}
function m8LookupND(query: number[], axes: number[][], table: number[], interpolation: string, outside: string, id: string): number {
  const segments = axes.map((points, axis) => m8Segment(query[axis]!, points, outside, id));
  const strides = axes.map((_, axis) => axes.slice(axis + 1).reduce((count, points) => count * points.length, 1));
  if (interpolation !== 'linear') {
    const offset = segments.reduce((sum, segment, axis) => sum + (segment.index + (interpolation === 'nearest' ? segment.fraction > .5 ? 1 : 0 : segment.fraction >= 1 ? 1 : 0)) * strides[axis]!, 0);
    return m8Finite(table[offset], id);
  }
  // Last axis is fastest in the parameter table; interpolation never creates n-D signals.
  const interpolate = (axis: number, offset: number): number => {
    if (axis === axes.length) return m8Finite(table[offset], id);
    const { index, fraction } = segments[axis]!, stride = strides[axis]!;
    if (fraction === 1) return interpolate(axis + 1, offset + (index + 1) * stride);
    const lower = interpolate(axis + 1, offset + index * stride);
    if (fraction === 0) return lower;
    const upper = interpolate(axis + 1, offset + (index + 1) * stride);
    return m8Lerp(lower, upper, fraction, id);
  };
  return interpolate(0, 0);
}

/** Conservative costs include every runtime table validation and every lookup corner. */
export function m8OperationCost(node: IRNode, inputSize: number, outputSize: number): number | undefined {
  const kind = String(node.blockType), size = Math.max(1, inputSize, outputSize), p = node.parameters;
  if (kind === 'lookup.nd') {
    const rank = Number(p.rank), axes = Array.from({ length: rank }, (_, index) => p[`axis${index + 1}`] as number[]);
    return 16 * (p.table as number[]).length + 32 * axes.reduce((sum, axis) => sum + axis.length, 0) + 64 * 2 ** rank;
  }
  if (kind === 'lookup.direct' || kind === 'lookup.interpolate-prelookup') return 16 * (p.table as number[]).length + 64;
  if (kind === 'lookup.dynamic') return 64 * size;
  if (kind === 'logic.truth-table') return 16 * (p.table as boolean[]).length + 32 * size;
  if (kind === 'matrix.square') return 32 * size * node.outputs.out!.shape[0]! + 32 * size;
  if (kind === 'math.gain-matrix') return 32 * size * Math.max(...node.outputs.out!.shape, 1) + 32 * size;
  if (kind === 'math.product-inputs' && p.mode === 'matrix') return 64 * size * Math.max(...node.outputs.out!.shape, 1) * Number(p.count);
  if (['math.sum-inputs', 'math.product-inputs', 'logic.combine', 'route.mux-inputs', 'math.concatenate-inputs'].includes(kind)) return 128 * size * Number(p.count);
  if (['route.switch-threshold', 'vector.select-dynamic', 'matrix.select-dynamic', 'route.demux-widths', 'matrix.reshape-column-major', 'reduce.axis'].includes(kind)) return 128 * size;
  if (['matrix.assign', 'matrix.find-nonzero', 'matrix.permute-dimensions', 'matrix.squeeze', 'matrix.expand-scalar', 'matrix.is-symmetric', 'matrix.is-triangular', 'matrix.permute-rows-cols'].includes(kind)) return 64 * size;
  if (['nonlinear.friction', 'nonlinear.dead-zone-dynamic', 'nonlinear.saturation-dynamic', 'nonlinear.wrap-to-zero', 'logic.compare-constant', 'logic.interval-dynamic', 'math.signed-sqrt', 'math.reciprocal-sqrt', 'math.negate', 'math.sine-wave-function', 'math.increment', 'route.manual-switch', 'route.multiport-switch', 'verify.assert', 'verify.bounds'].includes(kind)) return 128 * size;
  return undefined;
}

/** Stateless finite scalar/vector/2D M8 kernels. User values are data, never JS syntax. */
export function evaluateM8Node(node: IRNode, input: (port: string) => SignalValue): Record<string, SignalValue> | undefined {
  const id = node.id, kind = String(node.blockType), p = node.parameters, shape = node.outputs.out?.shape ?? [];
  const finite = (value: unknown): number => m8Finite(value, id);
  const number = (key: string): number => finite(p[key]);
  const numbers = (port = 'in'): number[] => m8Flat(input(port)).map(finite);
  const unary = (operation: (x: number) => number | boolean): SignalValue => m8Shape(numbers().map(x => { const result = operation(x); return typeof result === 'boolean' ? result : finite(result); }), shape);
  const domain = (valid: boolean): void => { if (!valid) m8Fail(id, 'NUMERIC_DOMAIN', '입력이 함수의 실수 정의역을 벗어났습니다.'); };
  const bounds = (operation: (x: number, lower: number, upper: number) => number | boolean): SignalValue => {
    const values = numbers(), lower = numbers('lower'), upper = numbers('upper'), count = shape.reduce((size, axis) => size * axis, 1);
    return m8Shape(Array.from({ length: count }, (_, index) => {
      const lo = lower[lower.length === 1 ? 0 : index]!, hi = upper[upper.length === 1 ? 0 : index]!;
      if (lo > hi) m8Fail(id, 'INVALID_DYNAMIC_BOUNDS', '동적 하한은 상한보다 크지 않아야 합니다.');
      const result = operation(values[values.length === 1 ? 0 : index]!, lo, hi);
      return typeof result === 'boolean' ? result : finite(result);
    }), shape);
  };
  const inRange = (x: number, lower: number, upper: number): boolean => (p.lowerClosed === 'open' ? x > lower : x >= lower) && (p.upperClosed === 'open' ? x < upper : x <= upper);
  const count = shape.reduce((size, axis) => size * axis, 1);
  const ports = () => Array.from({ length: number('count') }, (_, index) => input(`in${index + 1}`));
  const advanced = <T>(operation: () => T): T => { try { return operation(); } catch (error) { if (error instanceof ModelError) throw new ModelError(error.diagnostics.map(diagnostic => ({ ...diagnostic, nodeId: id }))); throw error; } };
  let value: SignalValue;
  switch (kind) {
    case 'nonlinear.friction': value = unary(x => x === 0 ? x : Math.sign(x) * finite(number('gain') * Math.abs(x) + number('offset'))); break;
    case 'nonlinear.dead-zone-dynamic': value = bounds((x, lower, upper) => x < lower ? x - lower : x > upper ? x - upper : 0); break;
    case 'nonlinear.saturation-dynamic': value = bounds((x, lower, upper) => Math.min(upper, Math.max(lower, x))); break;
    case 'nonlinear.wrap-to-zero': value = unary(x => (p.comparator === 'ge' ? x >= number('threshold') : x > number('threshold')) ? 0 : x); break;
    case 'logic.compare-constant': value = unary(x => {
      const c = number('constant');
      switch (p.operator) { case 'gt': return x > c; case 'gte': return x >= c; case 'lt': return x < c; case 'lte': return x <= c; case 'eq': return x === c; case 'neq': return x !== c; default: return m8Fail(id, 'RUNTIME_INVALID_IR', '승인하지 않은 비교 연산입니다.'); }
    }); break;
    case 'logic.interval-dynamic': value = bounds(inRange); break;
    case 'logic.truth-table': {
      const elements = m8Flat(input('in')), table = p.table as boolean[];
      if (elements.some(item => typeof item !== 'boolean')) m8Fail(id, 'RUNTIME_TYPE_MISMATCH', '진리표 입력은 boolean 벡터여야 합니다.');
      const index = elements.reduce<number>((row, bit) => row * 2 + (bit ? 1 : 0), 0);
      if (table.length !== 2 ** elements.length || table.some(item => typeof item !== 'boolean')) m8Fail(id, 'RUNTIME_INVALID_IR', '진리표의 행 수 또는 출력 자료형이 잘못되었습니다.');
      value = table[index]!; break;
    }
    case 'math.signed-sqrt': value = unary(x => Math.sign(x) * Math.sqrt(Math.abs(x))); break;
    case 'math.reciprocal-sqrt': value = unary(x => { if (x === 0) m8Fail(id, 'NUMERIC_DIVIDE_BY_ZERO', '0의 제곱근으로 나눌 수 없습니다.'); domain(x > 0); return 1 / Math.sqrt(x); }); break;
    case 'math.negate': value = unary(x => -x); break;
    case 'math.sine-wave-function': value = unary(x => number('amplitude') * Math.sin(finite(number('frequency') * x + number('phase'))) + number('bias')); break;
    case 'math.increment': value = unary(x => { const result = finite(x + number('delta')); return p.clamp === 'zero' ? Math.max(0, result) : result; }); break;
    case 'math.gain-matrix': {
      const gain = p.K as SignalValue, signal = input('in');
      if (p.mode === 'elementwise') {
        const a = m8Flat(signal).map(finite), b = m8Flat(gain).map(finite);
        value = m8Shape(Array.from({ length: count }, (_, index) => finite(a[a.length === 1 ? 0 : index]! * b[b.length === 1 ? 0 : index]!)), shape);
      } else {
        if (!Array.isArray(gain)) { value = m8Scale(signal, finite(gain), id); break; }
        if (!Array.isArray(signal)) { value = m8Scale(gain, finite(signal), id); break; }
        const matrix = Array.isArray(signal) && Array.isArray(signal[0]) ? signal as number[][] : p.mode === 'right' ? [numbers()] : numbers().map(element => [element]);
        const K = gain as number[][];
        value = m8Shape(m8Flat(advanced(() => p.mode === 'right' ? matrixMultiply(matrix, K) : matrixMultiply(K, matrix))), shape);
      }
      break;
    }
    case 'math.sum-inputs': {
      const inputs = ports().map(signal => m8Flat(signal).map(finite)), signs = p.signs as number[];
      value = m8Shape(Array.from({ length: count }, (_, index) => inputs.reduce((sum, values, port) => finite(sum + signs[port]! * values[values.length === 1 ? 0 : index]!), 0)), shape); break;
    }
    case 'math.product-inputs': {
      const inputs = ports();
      if (p.mode === 'matrix') {
        let result = m8Copy(inputs[0]!);
        for (const signal of inputs.slice(1)) result = !Array.isArray(result) ? m8Scale(signal, finite(result), id) : !Array.isArray(signal) ? m8Scale(result, finite(signal), id) : advanced(() => matrixMultiply(result as number[][], signal as number[][]));
        value = m8Shape(m8Flat(result), shape);
      } else {
        const values = inputs.map(signal => m8Flat(signal).map(finite)), operations = String(p.operations);
        value = m8Shape(Array.from({ length: count }, (_, index) => values.reduce((result, elements, port) => {
          const operand = elements[elements.length === 1 ? 0 : index]!;
          if (operations[port] === '/') { if (operand === 0) m8Fail(id, 'NUMERIC_DIVIDE_BY_ZERO', '곱셈 블록에서 0으로 나눌 수 없습니다.'); return finite(result / operand); }
          return finite(result * operand);
        }, 1)), shape);
      }
      break;
    }
    case 'logic.combine': {
      const inputs = ports().map(signal => m8Flat(signal));
      value = m8Shape(Array.from({ length: count }, (_, index) => {
        const values = inputs.map(elements => { const element = elements[elements.length === 1 ? 0 : index]!; return typeof element === 'boolean' ? element : finite(element) !== 0; });
        const parity = values.reduce((result, element) => result !== element, false);
        switch (p.operation) { case 'and': return values.every(Boolean); case 'or': return values.some(Boolean); case 'xor': return parity; case 'nand': return !values.every(Boolean); case 'nor': return !values.some(Boolean); case 'xnor': return !parity; case 'not': return !values[0]; default: return m8Fail(id, 'RUNTIME_INVALID_IR', '승인하지 않은 논리 연산입니다.'); }
      }), shape); break;
    }
    case 'route.switch-threshold': {
      const conditions = m8Flat(input('condition')), a = m8Flat(input('a')), b = m8Flat(input('b'));
      value = m8Shape(Array.from({ length: count }, (_, index) => {
        const condition = conditions[conditions.length === 1 ? 0 : index]!, x = typeof condition === 'boolean' ? Number(condition) : finite(condition), threshold = number('threshold');
        const selected = p.criterion === 'gt' ? x > threshold : p.criterion === 'ge' ? x >= threshold : x !== threshold;
        const elements = selected ? a : b; return elements[elements.length === 1 ? 0 : index]!;
      }), shape); break;
    }
    case 'vector.select-dynamic': { const elements = m8Flat(input('in')), base = number('indexBase'); value = m8Shape(numbers('indices').map(index => elements[m8Integer(index - base, 0, elements.length - 1, id)]!), shape); break; }
    case 'matrix.select-dynamic': { const matrix = input('in') as number[][] | boolean[][], base = number('indexBase'); value = numbers('rows').map(row => numbers('columns').map(column => matrix[m8Integer(row - base, 0, matrix.length - 1, id)]![m8Integer(column - base, 0, matrix[0]!.length - 1, id)]!)) as number[][] | boolean[][]; break; }
    case 'route.mux-inputs': value = ports().flatMap(m8Flat) as number[] | boolean[]; break;
    case 'route.demux-widths': {
      const elements = m8Flat(input('in')), widths = p.widths as number[]; let offset = 0;
      return Object.fromEntries(widths.map((width, index) => { const items = elements.slice(offset, offset + width); offset += width; return [`out${index + 1}`, width === 1 ? items[0]! : items as number[] | boolean[]]; }));
    }
    case 'math.concatenate-inputs': {
      const inputs = ports();
      if (shape.length !== 2) value = inputs.flatMap(m8Flat) as number[] | boolean[];
      else if (p.axis === 0) value = inputs.flatMap(signal => (signal as number[][] | boolean[][]).map(row => [...row])) as number[][] | boolean[][];
      else value = (inputs[0] as number[][] | boolean[][]).map((_, row) => inputs.flatMap<number | boolean>(signal => (signal as number[][] | boolean[][])[row]!)) as number[][] | boolean[][];
      break;
    }
    case 'matrix.reshape-column-major': {
      const signal = input('in'), matrix = Array.isArray(signal) && Array.isArray(signal[0]) ? signal as number[][] | boolean[][] : undefined;
      const elements = matrix ? matrix[0]!.flatMap((_, column) => matrix.map(row => row[column]!)) : m8Flat(signal);
      value = shape.length === 2 ? Array.from({ length: shape[0]! }, (_, row) => Array.from({ length: shape[1]! }, (_, column) => elements[column * shape[0]! + row]!)) as number[][] | boolean[][] : m8Shape(elements, shape); break;
    }
    case 'reduce.axis': {
      const signal = input('in'), matrix = signal as number[][] | boolean[][];
      const reduce = (elements: (number | boolean)[]): number | boolean => {
        if (p.operation === 'all' || p.operation === 'any') { if (elements.some(item => typeof item !== 'boolean')) m8Fail(id, 'RUNTIME_TYPE_MISMATCH', '논리 집계에는 boolean 입력이 필요합니다.'); return p.operation === 'all' ? elements.every(Boolean) : elements.some(Boolean); }
        const values = elements.map(finite);
        switch (p.operation) { case 'sum': return values.reduce((sum, x) => finite(sum + x), 0); case 'product': return values.reduce((product, x) => finite(product * x), 1); case 'mean': return m8Mean(values, id); case 'min': return Math.min(...values); case 'max': return Math.max(...values); default: return m8Fail(id, 'RUNTIME_INVALID_IR', '승인하지 않은 축 집계입니다.'); }
      };
      value = p.axis === 'all' ? reduce(m8Flat(signal)) : p.axis === 'rows' ? matrix[0]!.map((_, column) => reduce(matrix.map(row => row[column]!))) as number[] | boolean[] : matrix.map(row => reduce(row)) as number[] | boolean[]; break;
    }
    case 'matrix.assign': {
      const elements = m8Flat(input('in')), replacements = m8Flat(input('value')), indices = p.indices as number[];
      if (replacements.length !== 1 && replacements.length !== indices.length) m8Fail(id, 'RUNTIME_SHAPE_MISMATCH', '대입 값은 scalar 또는 index 수와 같은 벡터여야 합니다.');
      indices.forEach((index, offset) => { elements[m8Integer(index, 0, elements.length - 1, id)] = replacements[replacements.length === 1 ? 0 : offset]!; });
      value = m8Shape(elements, shape); break;
    }
    case 'matrix.find-nonzero': {
      const signal = input('in'), matrix = Array.isArray(signal) && Array.isArray(signal[0]) ? signal as number[][] | boolean[][] : m8Flat(signal).map(element => [element]);
      const width = matrix.length * matrix[0]!.length, base = number('indexBase'), sentinel = base === 0 ? -1 : 0;
      const indices = Array<number>(width).fill(sentinel), rows = [...indices], columns = [...indices]; let count = 0;
      for (let column = 0; column < matrix[0]!.length; column++) for (let row = 0; row < matrix.length; row++) {
        const element = matrix[row]![column]!;
        if (typeof element === 'number') finite(element);
        if (element !== 0 && element !== false) { indices[count] = column * matrix.length + row + base; rows[count] = row + base; columns[count] = column + base; count++; }
      }
      return { indices, rows, columns, count };
    }
    case 'matrix.permute-dimensions': {
      const original = input('in');
      value = shape.length === 2 && (p.order as number[])[0] === 1 ? (original as number[][] | boolean[][])[0]!.map((_, column) => (original as number[][] | boolean[][]).map(row => row[column]!)) as number[][] | boolean[][] : m8Copy(original); break;
    }
    case 'matrix.squeeze': value = m8Shape(m8Flat(input('in')), shape); break;
    case 'matrix.expand-scalar': value = m8Shape(Array(shape.reduce((size, axis) => size * axis, 1)).fill(number('value')), shape); break;
    case 'matrix.is-symmetric': {
      const matrix = input('in') as number[][], tolerance = number('tolerance');
      value = matrix.every((row, r) => row.every((element, c) => Math.abs(finite(element) - finite(matrix[c]![r])) <= tolerance)); break;
    }
    case 'matrix.is-triangular': {
      const matrix = input('in') as number[][], tolerance = number('tolerance');
      const upper = matrix.every((row, r) => row.every((element, c) => c >= r || Math.abs(finite(element)) <= tolerance));
      const lower = matrix.every((row, r) => row.every((element, c) => c <= r || Math.abs(finite(element)) <= tolerance));
      value = p.part === 'upper' ? upper : p.part === 'lower' ? lower : upper || lower; break;
    }
    case 'matrix.square': {
      try { const signal = input('in'); value = Array.isArray(signal) && Array.isArray(signal[0]) ? matrixMultiply(transpose(signal as number[][]), signal as number[][]) : [[m8VectorGram(numbers(), id)]]; }
      catch (error) { if (error instanceof ModelError) throw new ModelError(error.diagnostics.map(diagnostic => ({ ...diagnostic, nodeId: id }))); throw error; }
      break;
    }
    case 'matrix.permute-rows-cols': { const matrix = input('in') as number[][] | boolean[][]; value = (p.rows as number[]).map(row => (p.columns as number[]).map(column => matrix[row]![column]!)) as number[][] | boolean[][]; break; }
    case 'route.manual-switch': value = m8Copy(input(number('selected') === 1 ? 'a' : 'b')); break;
    case 'route.multiport-switch': {
      const raw = finite(input('index')), base = number('indexBase'), count = number('count');
      if (!Number.isSafeInteger(raw)) m8Fail(id, 'NUMERIC_INDEX_RANGE', '선택 index는 정수여야 합니다.');
      const index = p.outside === 'clamp' ? Math.min(count - 1, Math.max(0, raw - base)) : m8Integer(raw - base, 0, count - 1, id);
      value = m8Copy(input(`in${index + 1}`)); break;
    }
    case 'verify.assert': {
      const elements = m8Flat(input('in'));
      if (elements.some(item => typeof item !== 'boolean')) m8Fail(id, 'RUNTIME_TYPE_MISMATCH', 'Assertion에는 boolean 입력이 필요합니다.');
      const valid = p.mode === 'any' ? elements.some(Boolean) : elements.every(Boolean);
      if (!valid) m8Fail(id, 'VERIFY_VIOLATION', 'Assertion 조건을 만족하지 않았습니다.'); value = true; break;
    }
    case 'verify.bounds': {
      const elements = numbers(), lower = p.source === 'dynamic' && p.kind !== 'upper' ? numbers('lower') : [number('lower')], upper = p.source === 'dynamic' && p.kind !== 'lower' ? numbers('upper') : [number('upper')];
      value = m8Shape(elements.map((x, index) => {
        const lo = lower[lower.length === 1 ? 0 : index]!, hi = upper[upper.length === 1 ? 0 : index]!;
        if (!['lower', 'upper'].includes(String(p.kind)) && lo > hi) m8Fail(id, 'INVALID_DYNAMIC_BOUNDS', '검사 하한은 상한보다 크지 않아야 합니다.');
        const above = p.lowerClosed === 'open' ? x > lo : x >= lo, below = p.upperClosed === 'open' ? x < hi : x <= hi;
        const valid = p.kind === 'lower' ? above : p.kind === 'upper' ? below : p.kind === 'gap' ? !inRange(x, lo, hi) : above && below;
        if (!valid) m8Fail(id, 'VERIFY_VIOLATION', '입력이 지정한 경계 조건을 만족하지 않았습니다.'); return true;
      }), shape); break;
    }
    case 'lookup.direct': {
      const query = numbers(), dimensions = p.dimensions as number[], base = number('indexBase'); let offset = 0;
      dimensions.forEach((dimension, axis) => { const index = query[axis]! - base; const valid = p.outside === 'clamp' ? Math.min(dimension - 1, Math.max(0, m8Integer(index, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, id))) : m8Integer(index, 0, dimension - 1, id); offset = offset * dimension + valid; });
      value = finite((p.table as number[])[offset]); break;
    }
    case 'lookup.interpolate-prelookup': {
      const table = (p.table as number[]).map(finite), rawIndex = finite(input('index')), rawFraction = finite(input('fraction'));
      let index = m8Integer(rawIndex, p.outside === 'clamp' ? -Number.MAX_SAFE_INTEGER : 0, p.outside === 'clamp' ? Number.MAX_SAFE_INTEGER : table.length - 2, id), fraction = rawFraction;
      if (p.outside === 'clamp') { index = Math.max(0, Math.min(table.length - 2, index)); fraction = Math.max(0, Math.min(1, fraction)); }
      else if (fraction < 0 || fraction > 1) m8Fail(id, 'LOOKUP_OUT_OF_RANGE', '보간 fraction은 0~1이어야 합니다.');
      value = m8TableValue(table, index, fraction, String(p.interpolation), id); break;
    }
    case 'lookup.dynamic': {
      const points = numbers('breakpoints'), table = numbers('table');
      if (points.length !== table.length || points.length < 2 || points.length > 1024) m8Fail(id, 'INVALID_DYNAMIC_LOOKUP', '동적 축과 표는 같은 길이의 2~1,024개 벡터여야 합니다.');
      const found = m8Segment(finite(input('in')), points, p.outside === 'clamp' ? 'clip' : String(p.outside), id);
      value = m8TableValue(table, found.index, found.fraction, String(p.interpolation), id); break;
    }
    case 'lookup.nd': {
      const rank = number('rank'), axes = Array.from({ length: rank }, (_, index) => p[`axis${index + 1}`] as number[]), table = (p.table as number[]).map(finite);
      value = m8LookupND(numbers(), axes, table, String(p.interpolation), p.outside === 'clamp' ? 'clip' : String(p.outside), id); break;
    }
    default: return undefined;
  }
  return { out: value };
}
