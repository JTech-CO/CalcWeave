import { evaluateM11Node, m11OperationCost } from './m11';
import { m12OperationCost } from './m12';
import { evaluateM13Node, m13OperationCost } from './m13';
import { evaluateM14Node, m14OperationCost } from './m14';
import { evaluateExpression, expressionNodeCount } from '../../expression/src';
import { ModelError, type IRNode, type SignalDescriptor, type SignalValue } from '../../model/src/types';
import { matrixMultiply, transpose, determinant, inverse, solve, cholesky, lu, lookup2D, prelookup } from '../../advanced-math/src';
import { quantizeFixed, type FixedQuantizationOptions } from '../../quantization/src';
import { evaluateExpansionNode } from './expansion';
import { evaluateTimeSourceNode } from './time-sources';
import { evaluateM8Node, m8OperationCost } from './m8';
import { m9OperationCost } from './m9';
import { cloneTypedSignal, equalDataType, typedDescriptor, typedStorageElements, validateTypedSignal } from '../../model/src/typed';
import { evaluateM10Node, m10OperationCost } from './m10';
import { copyAnySignal, describeAnySignal, sameSignalDescriptor, structuredStorageElements, validateAnySignal } from '../../model/src/structured';

export function numericFailure(code: string, nodeId: string, message: string): never {
  throw new ModelError([{ code, nodeId, message }]);
}

export function finiteNumber(value: unknown, nodeId: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    numericFailure('NUMERIC_NONFINITE', nodeId, '계산 결과 또는 입력이 유한한 실수가 아닙니다.');
  }
  return value;
}

export function signalElements(descriptor: SignalDescriptor): number {
  if (descriptor.valueType === 'bus' || descriptor.valueType === 'messages') return structuredStorageElements(descriptor);
  if (descriptor.valueType === 'typed') return typedStorageElements(descriptor);
  return descriptor.shape.reduce((size, dimension) => size * dimension, 1);
}

/** Results own their array storage; editing a result cannot mutate the next run's inputs. */
export function copySignal(value: SignalValue): SignalValue {
  if (typeof value === 'object' && !Array.isArray(value)) return copyAnySignal(value);
  if (!Array.isArray(value)) return value;
  return Array.isArray(value[0])
    ? (value as number[][] | boolean[][]).map((row) => [...row]) as number[][] | boolean[][]
    : [...value] as number[] | boolean[];
}

export function nodeOperationCost(node: IRNode, byId: Map<string, IRNode>): number {
  const outputSize = Object.values(node.outputs).reduce((count, descriptor) => count + signalElements(descriptor), 0);
  const inputSize = Object.values(node.inputs).reduce((count, endpoint) => {
    const descriptor = byId.get(endpoint.nodeId)?.outputs[endpoint.portId];
    if (!descriptor) numericFailure('RUNTIME_INVALID_IR', node.id, '입력 포트의 자료형 정보가 없습니다.');
    return Math.max(count, signalElements(descriptor));
  }, 0);
  const inputShape = (port: string): number[] => {
    const endpoint = node.inputs[port];
    return endpoint ? byId.get(endpoint.nodeId)!.outputs[endpoint.portId]!.shape : [];
  };
  const m8Cost = m8OperationCost(node, inputSize, outputSize);
  if (m8Cost !== undefined) return m8Cost;
  const m9Cost = m9OperationCost(node, inputSize, outputSize);
  if (m9Cost !== undefined) return m9Cost;
  const m11Cost = m11OperationCost(node, inputSize, outputSize);
  if (m11Cost !== undefined) return m11Cost;
  const m12Cost = m12OperationCost(node, inputSize, outputSize);
  if (m12Cost !== undefined) return m12Cost;
  const m13Cost = m13OperationCost(node, inputSize, outputSize);
  if (m13Cost !== undefined) return m13Cost;
  const m14Cost = m14OperationCost(node, inputSize, outputSize);
  if (m14Cost !== undefined) return m14Cost;
  const m10Cost = m10OperationCost(node, inputSize, outputSize);
  if (m10Cost !== undefined) return m10Cost;
  if (node.blockType === 'math.matrix-multiply') {
    const a = inputShape('a'), b = inputShape('b');
    return 8 * a[0]! * a[1]! * b[1]! + a[0]! * a[1]! + b[0]! * b[1]! + outputSize;
  }
  if (node.blockType === 'vector.convolve') {
    return 4 * signalElements(byId.get(node.inputs.a!.nodeId)!.outputs[node.inputs.a!.portId]!) * signalElements(byId.get(node.inputs.b!.nodeId)!.outputs[node.inputs.b!.portId]!) + outputSize;
  }
  if (['matrix.determinant', 'matrix.inverse', 'matrix.solve', 'matrix.cholesky', 'matrix.lu'].includes(node.blockType)) {
    const size = inputShape(node.blockType === 'matrix.solve' ? 'a' : 'in')[0]!;
    // Pivoting, scale handling, residual/condition work and multi-RHS storage are charged.
    return 32 * size ** 3 + 32 * size ** 2 + 8 * size * inputSize + outputSize;
  }
  let factor = node.expression ? expressionNodeCount(node.expression) : 1;
  if (['source.chirp', 'source.gaussian-pulse', 'source.damped-sine', 'source.exponential', 'source.logistic', 'source.sinc-pulse'].includes(node.blockType)) factor = 64;
  if (node.blockType.startsWith('reduce.') || node.blockType.startsWith('vector.') || ['matrix.trace', 'matrix.diagonal', 'matrix.diag-create', 'matrix.identity', 'matrix.select', 'matrix.row', 'matrix.column', 'matrix.horizontal', 'matrix.vertical', 'matrix.triangle', 'matrix.symmetrize', 'matrix.kronecker', 'source.linspace', 'source.logspace', 'source.zeros'].includes(node.blockType)) factor = 32;
  if (['math.cbrt', 'math.expm1', 'math.log1p', 'math.log2', 'math.exp2', 'math.sinh', 'math.cosh', 'math.tanh', 'math.asinh', 'math.acosh', 'math.atanh', 'math.sinc', 'math.power', 'math.hypot', 'math.atan2', 'math.mod', 'math.remainder', 'math.bias', 'math.sign', 'nonlinear.dead-zone', 'nonlinear.quantizer', 'logic.interval', 'logic.is-integer', 'logic.approx-equal'].includes(node.blockType)) factor = 64;
  if (node.blockType === 'math.polynomial') factor = (node.parameters.coefficients as number[]).length * 4;
  if (node.blockType === 'vector.sort' || node.blockType === 'reduce.median') factor = 8 * Math.max(1, Math.ceil(Math.log2(inputSize)));
  if (node.blockType === 'matrix.transpose') factor = 3;
  if (node.blockType === 'fixed.quantize') factor = 1_100; // bounded binary64 BigInt work (≤1,074-bit shifts), per emitted element
  if (node.blockType === 'lookup.prelookup') factor = (node.parameters.breakpoints as number[]).length + 8;
  if (node.blockType === 'lookup.2d') factor = (node.parameters.rowBreakpoints as number[]).length * (node.parameters.columnBreakpoints as number[]).length + (node.parameters.rowBreakpoints as number[]).length + (node.parameters.columnBreakpoints as number[]).length + 24;
  if (node.blockType === 'discrete.fir') factor = (node.parameters.coefficients as number[]).length * 2;
  if (node.blockType === 'discrete.transfer-function') factor = ((node.parameters.numerator as number[]).length + (node.parameters.denominator as number[]).length) * 2;
  if (node.blockType === 'discrete.state-space') factor = (node.parameters.initial as number[]).length ** 2 + 3 * (node.parameters.initial as number[]).length;
  if (node.blockType === 'continuous.state-space') factor = (node.parameters.initial as number[]).length ** 2 + 3 * (node.parameters.initial as number[]).length;
  if (node.blockType === 'continuous.transfer-function' || node.blockType === 'continuous.zero-pole') factor = Math.max(1, (node.parameters.initial as number[]).length * 3);
  if (node.blockType === 'time.transport-delay') factor = 32;
  if (node.blockType === 'discrete.delay') factor = Number(node.parameters.steps) + 1;
  if (node.blockType === 'lookup.interpolated') factor = Math.ceil(Math.log2((node.parameters.breakpoints as number[]).length)) + 3;
  if (node.blockType === 'source.repeating-sequence') factor = Math.ceil(Math.log2((node.parameters.times as number[]).length)) + 3;
  if (node.blockType === 'source.dataset') factor = Math.ceil(Math.log2((node.parameters.times as number[]).length)) + 5;
  return Math.max(1, outputSize, inputSize) * factor;
}

function flatten(value: SignalValue): (number | boolean)[] {
  if (typeof value === 'object' && !Array.isArray(value)) throw new ModelError([{ code: 'RUNTIME_TYPE_MISMATCH', message: '기존 계산 경로에는 자료형 경계 블럭을 연결하세요.' }]);
  if (!Array.isArray(value)) return [value];
  return Array.isArray(value[0]) ? (value as number[][] | boolean[][]).flat() : value as number[] | boolean[];
}

function shaped(values: (number | boolean)[], shape: number[]): SignalValue {
  if (shape.length === 0) return values[0]!;
  if (shape.length === 1) return values as number[] | boolean[];
  return Array.from({ length: shape[0]! }, (_, row) => values.slice(row * shape[1]!, (row + 1) * shape[1]!)) as number[][] | boolean[][];
}

/** Verify every emitted port against immutable compiler metadata, including multi-output nodes. */
export function checkSignal(value: SignalValue | undefined, descriptor: SignalDescriptor, nodeId: string): SignalValue {
  if (value === undefined) numericFailure('RUNTIME_INVALID_IR', nodeId, '실행 출력이 중간 표현에 없습니다.');
  if (descriptor.valueType === 'bus' || descriptor.valueType === 'messages') {
    const signal = validateAnySignal(value), actual = describeAnySignal(signal);
    const same = (v: SignalValue, d: SignalDescriptor): boolean => {
      if (d.valueType === 'bus') return typeof v === 'object' && !Array.isArray(v) && v.kind === 'bus' && v.fields.length === d.bus!.fields.length && v.fields.every((field, index) => field.name === d.bus!.fields[index]!.name && same(field.value, d.bus!.fields[index]!.descriptor));
      if (d.valueType === 'messages') return typeof v === 'object' && !Array.isArray(v) && v.kind === 'messages' && v.items.length <= d.message!.maxBatch && v.items.every(item => same(item.payload, d.message!.payload));
      const a = describeAnySignal(v); return sameSignalDescriptor({ ...a, unit: d.unit, fields: d.fields, representation: d.representation }, d);
    };
    if (actual.valueType !== descriptor.valueType || !same(signal, descriptor)) numericFailure('RUNTIME_TYPE_MISMATCH', nodeId, 'Bus·메시지 필드·payload 자료형이 선언과 다릅니다.');
    return value;
  }
  if (descriptor.valueType === 'typed') {
    try {
      const typed = validateTypedSignal(value), actual = typedDescriptor(typed);
      if (actual.shape.length !== descriptor.shape.length || actual.shape.some((axis, index) => axis !== descriptor.shape[index])) numericFailure('RUNTIME_SHAPE_MISMATCH', nodeId, '자료형 출력의 형상이 검증한 포트와 다릅니다.');
      if (!descriptor.typed || !equalDataType(actual.typed!, descriptor.typed)) numericFailure('RUNTIME_TYPE_MISMATCH', nodeId, '출력 자료형·고정소수점 스케일·열거 선언이 검증한 포트와 다릅니다.');
      return value;
    } catch (error) {
      if (error instanceof ModelError) throw new ModelError(error.diagnostics.map(diagnostic => ({ ...diagnostic, nodeId })));
      throw error;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) numericFailure('RUNTIME_TYPE_MISMATCH', nodeId, '기존 계산 경로에는 명시적인 자료형 경계 블럭을 연결하세요.');
  const shape = descriptor.shape;
  if (shape.length === 0 ? Array.isArray(value)
    : shape.length === 1 ? !Array.isArray(value) || value.length !== shape[0] || value.some(Array.isArray)
      : !Array.isArray(value) || value.length !== shape[0] || value.some((row) => !Array.isArray(row) || row.length !== shape[1] || row.some(Array.isArray))) {
    numericFailure('RUNTIME_SHAPE_MISMATCH', nodeId, '실행 출력의 차원이 검증한 포트와 다릅니다.');
  }
  for (const element of flatten(value)) {
    if (descriptor.valueType === 'float64') finiteNumber(element, nodeId);
    else if (typeof element !== 'boolean') numericFailure('RUNTIME_TYPE_MISMATCH', nodeId, '실행 출력의 자료형이 검증한 포트와 다릅니다.');
  }
  return value;
}

/** M1 finite real/boolean kernels. Arbitrary model text never becomes executable syntax. */
export function evaluateSignalNode(node: IRNode, input: (port: string) => SignalValue, state?: SignalValue, time = 0): Record<string, SignalValue> {
  const m14 = evaluateM14Node(node, input);
  if (m14 !== undefined) return m14;
  const m13 = evaluateM13Node(node, input, time);
  if (m13 !== undefined) return m13;
  const m11 = evaluateM11Node(node, input, time);
  if (m11) return m11;
  const m10 = evaluateM10Node(node, input);
  if (m10) return m10;
  const m8 = evaluateM8Node(node, input);
  if (m8) return m8;
  const expansion = evaluateExpansionNode(node, input);
  if (expansion) return expansion;
  const timeSource = evaluateTimeSourceNode(node, time);
  if (timeSource) return timeSource;
  const id = node.id;
  const descriptor = node.outputs.out;
  const shape = descriptor?.shape ?? [];
  const count = descriptor ? signalElements(descriptor) : 1;
  const parameter = (key: string): number => finiteNumber(node.parameters[key], id);
  const option = (key: string): string => String(node.parameters[key]);
  const unary = (operation: (value: number) => number): SignalValue => shaped(flatten(input('in')).map((value) => finiteNumber(operation(finiteNumber(value, id)), id)), shape);
  const numericPair = (operation: (a: number, b: number) => number | boolean): SignalValue => {
    const a = flatten(input('a')), b = flatten(input('b'));
    return shaped(Array.from({ length: count }, (_, index) => {
      const result = operation(finiteNumber(a[a.length === 1 ? 0 : index], id), finiteNumber(b[b.length === 1 ? 0 : index], id));
      return typeof result === 'boolean' ? result : finiteNumber(result, id);
    }), shape);
  };
  const domain = (valid: boolean): void => { if (!valid) numericFailure('NUMERIC_DOMAIN', id, '입력값이 함수의 실수 정의역을 벗어났습니다.'); };
  const divide = (a: number, b: number): number => {
    if (b === 0) numericFailure('NUMERIC_DIVIDE_BY_ZERO', id, '0으로 나눌 수 없습니다. 제수 입력을 확인해 주세요.');
    return a / b;
  };
  const advanced = <T>(operation: () => T): T => {
    try { return operation(); }
    catch (error) {
      if (error instanceof ModelError) throw new ModelError(error.diagnostics.map(diagnostic => ({ ...diagnostic, nodeId: id })));
      throw error;
    }
  };
  let value: SignalValue;
  switch (node.blockType) {
    case 'annotation.note': case 'annotation.model-info': return {};
    case 'source.dataset': value = replayDataset(node, time); break;
    case 'unit.convert': value = unary(x => x * parameter('unitScale') + parameter('unitOffset')); break;
    case 'route.bus-create': value = [input('a'), input('b')] as number[] | boolean[]; break;
    case 'route.bus-select': value = (input('in') as number[] | boolean[])[parameter('fieldIndex')]!; break;
    case 'source.constant': case 'io.input': value = node.parameters.value as SignalValue; break;
    case 'math.gain': value = unary((x) => x * parameter('gain')); break;
    case 'math.sum': {
      const signs = option('signs');
      value = numericPair((a, b) => (signs[0] === '-' ? -a : a) + (signs[1] === '-' ? -b : b)); break;
    }
    case 'math.multiply': value = numericPair(option('operation') === 'divide' ? divide : (a, b) => a * b); break;
    case 'math.abs': value = unary(Math.abs); break;
    case 'math.sqrt': value = unary((x) => { domain(x >= 0); return Math.sqrt(x); }); break;
    case 'math.function': value = unary((x) => {
      switch (option('operation')) {
        case 'exp': return Math.exp(x);
        case 'log': domain(x > 0); return Math.log(x);
        case 'log10': domain(x > 0); return Math.log10(x);
        case 'square': return x * x;
        case 'reciprocal': return divide(1, x);
        default: return numericFailure('RUNTIME_INVALID_IR', id, '지원하지 않는 수학 함수입니다.');
      }
    }); break;
    case 'math.trigonometric': value = unary((x) => {
      switch (option('operation')) {
        case 'sin': return Math.sin(x); case 'cos': return Math.cos(x); case 'tan': return Math.tan(x);
        case 'asin': domain(x >= -1 && x <= 1); return Math.asin(x);
        case 'acos': domain(x >= -1 && x <= 1); return Math.acos(x);
        case 'atan': return Math.atan(x);
        default: return numericFailure('RUNTIME_INVALID_IR', id, '지원하지 않는 삼각 함수입니다.');
      }
    }); break;
    case 'math.round': value = unary((x) => {
      switch (option('operation')) {
        case 'round': return Math.round(x); case 'floor': return Math.floor(x);
        case 'ceil': return Math.ceil(x); case 'trunc': return Math.trunc(x);
        default: return numericFailure('RUNTIME_INVALID_IR', id, '지원하지 않는 반올림 방식입니다.');
      }
    }); break;
    case 'math.minmax': {
      const operation = option('operation') === 'max' ? Math.max : Math.min;
      if (option('strategy') === 'reduce') {
        const elements = flatten(input('in')).map((element) => finiteNumber(element, id));
        value = elements.reduce((a, b) => operation(a, b));
      } else value = numericPair(operation);
      break;
    }
    case 'logic.compare': value = numericPair((a, b) => {
      switch (option('operation')) {
        case 'eq': return a === b; case 'ne': return a !== b; case 'lt': return a < b;
        case 'le': return a <= b; case 'gt': return a > b; case 'ge': return a >= b;
        default: return numericFailure('RUNTIME_INVALID_IR', id, '지원하지 않는 비교 연산입니다.');
      }
    }); break;
    case 'logic.boolean': {
      const a = flatten(input('a')), b = option('operation') === 'not' ? [] : flatten(input('b'));
      value = shaped(Array.from({ length: count }, (_, index) => {
        const first = a[a.length === 1 ? 0 : index], second = b[b.length === 1 ? 0 : index];
        if (typeof first !== 'boolean' || (option('operation') !== 'not' && typeof second !== 'boolean')) numericFailure('RUNTIME_TYPE_MISMATCH', id, '논리 연산에는 boolean 입력이 필요합니다.');
        switch (option('operation')) {
          case 'not': return !first; case 'and': return first && second!;
          case 'or': return first || second!; case 'xor': return first !== second;
          default: return numericFailure('RUNTIME_INVALID_IR', id, '지원하지 않는 논리 연산입니다.');
        }
      }), shape); break;
    }
    case 'route.switch': {
      const condition = input('condition');
      if (typeof condition !== 'boolean') numericFailure('RUNTIME_TYPE_MISMATCH', id, '선택 조건에는 boolean scalar가 필요합니다.');
      value = input(condition ? 'a' : 'b'); break;
    }
    case 'nonlinear.saturation': value = unary((x) => Math.min(parameter('upper'), Math.max(parameter('lower'), x))); break;
    case 'route.mux': case 'math.concatenate': value = [...flatten(input('a')), ...flatten(input('b'))] as number[] | boolean[]; break;
    case 'route.demux': {
      const elements = flatten(input('in'));
      return Object.fromEntries(Object.keys(node.outputs).map((port) => [port, elements[Number(port.slice(3)) - 1]!]));
    }
    case 'matrix.reshape': value = shaped(flatten(input('in')), shape); break;
    case 'math.matrix-multiply': value = advanced(() => matrixMultiply(input('a') as number[][], input('b') as number[][])); break;
    case 'matrix.transpose': value = advanced(() => transpose(input('in') as number[][])); break;
    case 'matrix.determinant': value = advanced(() => determinant(input('in') as number[][])); break;
    case 'matrix.inverse': value = advanced(() => inverse(input('in') as number[][])); break;
    case 'matrix.solve': value = advanced(() => solve(input('a') as number[][], input('b') as number[][])); break;
    case 'matrix.cholesky': value = advanced(() => cholesky(input('in') as number[][])); break;
    case 'matrix.lu': return advanced(() => {
      const decomposition = lu(input('in') as number[][]);
      const permutation = decomposition.permutation.map(index => Array.from({ length: decomposition.permutation.length }, (_, column) => column === index ? 1 : 0));
      return { lower: decomposition.lower, upper: decomposition.upper, permutation };
    });
    case 'lookup.2d': value = advanced(() => lookup2D(finiteNumber(input('row'), id), finiteNumber(input('column'), id), node.parameters as unknown as Parameters<typeof lookup2D>[2])); break;
    case 'lookup.prelookup': return advanced(() => {
      const found = prelookup(finiteNumber(input('in'), id), node.parameters.breakpoints as number[], option('extrapolation') as Parameters<typeof prelookup>[2]);
      return { index: found.index, fraction: found.fraction };
    });
    case 'fixed.quantize': return advanced(() => {
      const codes = flatten(input('in')).map(element => quantizeFixed(finiteNumber(element, id), node.parameters as unknown as FixedQuantizationOptions));
      return { out: shaped(codes.map(code => code.value), shape), stored: shaped(codes.map(code => code.stored), shape) };
    });
    case 'sink.display': case 'sink.scope':
      value = node.outputs.out!.valueType === 'bus' && Number(node.parameters.inputCount ?? 1) > 1
        ? { kind: 'bus', fields: node.outputs.out!.bus!.fields.map(field => ({ name: field.name, value: copySignal(input(field.name)) })) }
        : input('in');
      break;
    case 'io.output': case 'io.terminator': value = input('in'); break;
    case 'lookup.interpolated': value = unary((x) => interpolateTable(x, node.parameters.breakpoints as number[], node.parameters.values as number[], option('interpolation'), option('extrapolation'), id)); break;
    case 'logic.bitwise': {
      const width = parameter('width'), mask = width === 32 ? 0xffffffff : 2 ** width - 1;
      const unsigned = (port: string): number => {
        const number = finiteNumber(input(port), id);
        if (!Number.isSafeInteger(number) || number < 0 || number > mask) numericFailure('NUMERIC_INTEGER_RANGE', id, '비트 입력은 ' + width + '비트 unsigned 정수여야 합니다.');
        return number;
      };
      const a = unsigned('a');
      let bits: number;
      switch (option('operation')) {
        case 'and': bits = a & unsigned('b'); break;
        case 'or': bits = a | unsigned('b'); break;
        case 'xor': bits = a ^ unsigned('b'); break;
        case 'not': bits = ~a; break;
        case 'shift-left': bits = a << parameter('shift'); break;
        case 'shift-right': bits = a >>> parameter('shift'); break;
        default: return numericFailure('RUNTIME_INVALID_IR', id, '지원하지 않는 비트 연산입니다.');
      }
      value = (bits & mask) >>> 0; break;
    }
    case 'math.expression': {
      if (!node.expression) numericFailure('RUNTIME_INVALID_IR', id, '검증한 수식 AST가 없습니다.');
      value = unary((x) => {
        try { return evaluateExpression(node.expression!, x); }
        catch (error) {
          if (error instanceof ModelError) throw new ModelError(error.diagnostics.map((diagnostic) => ({ ...diagnostic, nodeId: id })));
          throw error;
        }
      }); break;
    }
    case 'discrete.unit-delay': if (state === undefined) numericFailure('RUNTIME_INVALID_IR', id, '상태 값이 없습니다.'); value = state; break;
    case 'continuous.integrator': value = finiteNumber(state, id); break;
    default: return numericFailure('RUNTIME_UNSUPPORTED_BLOCK', id, '지원하지 않는 실행 블럭입니다.');
  }
  return { out: value };
}

/** Binary search on a validated immutable time axis; previous never reads ahead. */
export function replayDataset(node: IRNode, time: number): number | boolean {
  const times = node.parameters.times as number[], values = node.parameters.values as (number | boolean)[];
  const first = times[0]!, last = times.at(-1)!;
  if (time < first || time > last) {
    if (node.parameters.outside === 'error') numericFailure('DATASET_TIME_RANGE', node.id, '실행 시각이 데이터 시간 범위를 벗어났습니다.');
    if (node.parameters.outside === 'zero') return node.parameters.dataKind === 'boolean' ? false : 0;
    return values[time < first ? 0 : values.length - 1]!;
  }
  let low = 0, high = times.length - 1;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (times[middle]! <= time) low = middle; else high = middle - 1; }
  if (times[low] === time || low === times.length - 1 || node.parameters.interpolation === 'previous') return values[low]!;
  const ratio = (time - times[low]!) / (times[low + 1]! - times[low]!);
  return finiteNumber((1 - ratio) * (values[low] as number) + ratio * (values[low + 1] as number), node.id);
}

/** Bounded binary search; exact endpoints preserve the supplied table values. */
export function interpolateTable(x: number, breakpoints: number[], values: number[], interpolation: string, extrapolation: string, nodeId: string): number {
  if (x < breakpoints[0]! || x > breakpoints.at(-1)!) {
    if (extrapolation === 'error') numericFailure('LOOKUP_RANGE', nodeId, '입력이 Lookup 표 범위를 벗어났습니다.');
    return x < breakpoints[0]! ? values[0]! : values.at(-1)!;
  }
  let low = 0, high = breakpoints.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (x < breakpoints[middle]!) high = middle; else low = middle;
  }
  if (x === breakpoints[high]!) return values[high]!;
  if (interpolation === 'previous' || x === breakpoints[low]!) return values[low]!;
  // Weighted interpolation avoids overflow in a difference between large endpoints.
  const scale = Math.max(Math.abs(x), Math.abs(breakpoints[low]!), Math.abs(breakpoints[high]!));
  const difference = breakpoints[high]! - breakpoints[low]!;
  const ratio = Number.isFinite(difference) ? (x - breakpoints[low]!) / difference
    : (x / scale - breakpoints[low]! / scale) / (breakpoints[high]! / scale - breakpoints[low]! / scale);
  return finiteNumber(values[low]! * (1 - ratio) + values[high]! * ratio, nodeId);
}
