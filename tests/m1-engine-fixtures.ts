import type { CalcEdge, CalcModel, CalcNode, SignalValue } from '../packages/model/src';

export interface EngineFixture { name: string; model: CalcModel; expected: Record<string, SignalValue> }
export const block = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, parameters, label: id, blockVersion: 1 });
export const connect = (source: string, target: string, targetPort = 'in', sourcePort = 'out'): CalcEdge => ({ id: `${source}-${sourcePort}-${target}-${targetPort}`, source: { nodeId: source, portId: sourcePort }, target: { nodeId: target, portId: targetPort } });
export function staticModel(nodes: CalcNode[], edges: CalcEdge[]): CalcModel {
  return { schemaVersion: 1, modelId: 'typed-fixture', name: 'Typed calculation', nodes, edges, execution: { mode: 'static', startTime: 0, stopTime: 0, step: 1 }, layout: {} };
}
export function unaryFixture(name: string, type: string, input: SignalValue, parameters: Record<string, unknown>, expected: SignalValue): EngineFixture {
  return { name, model: staticModel([block('input', 'source.constant', { value: input }), block('operation', type, parameters), block('result', 'sink.display')], [connect('input', 'operation'), connect('operation', 'result')]), expected: { result: expected } };
}
export function pairFixture(name: string, type: string, a: SignalValue, b: SignalValue, parameters: Record<string, unknown>, expected: SignalValue): EngineFixture {
  return { name, model: staticModel([block('first', 'source.constant', { value: a }), block('second', 'io.input', { value: b }), block('operation', type, parameters), block('result', 'sink.display')], [connect('first', 'operation', 'a'), connect('second', 'operation', 'b'), connect('operation', 'result')]), expected: { result: expected } };
}

/** Expected answers are explicit finite real/boolean examples, including every M1 option. */
export const M1_ENGINE_FIXTURES: EngineFixture[] = [
  unaryFixture('Gain keeps a matrix shape', 'math.gain', [[1, -2], [3, 4]], { gain: 2 }, [[2, -4], [6, 8]]),
  ...(['++', '+-', '-+', '--'] as const).map((signs, index) => pairFixture(`Sum signs ${signs}`, 'math.sum', [1, 2], 3, { signs }, [[4, 5], [-2, -1], [2, 1], [-4, -5]][index]!)),
  pairFixture('Product multiplies a matrix by a scalar', 'math.multiply', [[1, 2]], 3, { operation: 'multiply' }, [[3, 6]]),
  pairFixture('Product divides a vector by a scalar', 'math.multiply', [8, 12], 4, { operation: 'divide' }, [2, 3]),
  unaryFixture('Abs', 'math.abs', [-2, 0, 3], {}, [2, 0, 3]),
  unaryFixture('Exp', 'math.function', 0, { operation: 'exp' }, 1),
  unaryFixture('Log', 'math.function', [1, Math.E], { operation: 'log' }, [0, 1]),
  unaryFixture('Log10', 'math.function', [1, 100], { operation: 'log10' }, [0, 2]),
  unaryFixture('Square', 'math.function', [[-2, 3]], { operation: 'square' }, [[4, 9]]),
  unaryFixture('Reciprocal', 'math.function', [2, -4], { operation: 'reciprocal' }, [0.5, -0.25]),
  unaryFixture('Sin', 'math.trigonometric', [0, Math.PI / 2], { operation: 'sin' }, [0, 1]),
  unaryFixture('Cos', 'math.trigonometric', [0, Math.PI], { operation: 'cos' }, [1, -1]),
  unaryFixture('Tan', 'math.trigonometric', 0, { operation: 'tan' }, 0),
  unaryFixture('Asin', 'math.trigonometric', [0, 1], { operation: 'asin' }, [0, Math.PI / 2]),
  unaryFixture('Acos', 'math.trigonometric', [0, 1], { operation: 'acos' }, [Math.PI / 2, 0]),
  unaryFixture('Atan', 'math.trigonometric', [0, 1], { operation: 'atan' }, [0, Math.PI / 4]),
  unaryFixture('Round half toward positive infinity', 'math.round', [-1.5, 1.5], { operation: 'round' }, [-1, 2]),
  unaryFixture('Floor', 'math.round', [-1.2, 1.2], { operation: 'floor' }, [-2, 1]),
  unaryFixture('Ceil', 'math.round', [-1.2, 1.2], { operation: 'ceil' }, [-1, 2]),
  unaryFixture('Trunc', 'math.round', [-1.8, 1.8], { operation: 'trunc' }, [-1, 1]),
  pairFixture('Pairwise Min broadcasts scalar', 'math.minmax', [[3, -2], [4, 1]], 2, { operation: 'min', strategy: 'pairwise' }, [[2, -2], [2, 1]]),
  pairFixture('Pairwise Max', 'math.minmax', [3, 1], [2, 4], { operation: 'max', strategy: 'pairwise' }, [3, 4]),
  unaryFixture('Reduce Min visits all matrix elements', 'math.minmax', [[3, -2], [4, 1]], { operation: 'min', strategy: 'reduce' }, -2),
  unaryFixture('Reduce Max visits all matrix elements', 'math.minmax', [[3, -2], [4, 1]], { operation: 'max', strategy: 'reduce' }, 4),
  unaryFixture('Sqrt', 'math.sqrt', [[0, 4], [9, 16]], {}, [[0, 2], [3, 4]]),
  ...(['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const).map((operation, index) => pairFixture(`Comparison ${operation}`, 'logic.compare', [1, 2, 3], 2, { operation }, [[false, true, false], [true, false, true], [true, false, false], [true, true, false], [false, false, true], [false, true, true]][index]!)),
  pairFixture('Boolean And matrix/scalar', 'logic.boolean', [[true, false], [false, true]], true, { operation: 'and' }, [[true, false], [false, true]]),
  pairFixture('Boolean Or', 'logic.boolean', [true, false], [false, true], { operation: 'or' }, [true, true]),
  pairFixture('Boolean Xor', 'logic.boolean', [true, false], [true, true], { operation: 'xor' }, [false, true]),
  { name: 'Boolean Not needs only input a', model: staticModel([block('input', 'source.constant', { value: [true, false] }), block('operation', 'logic.boolean', { operation: 'not' }), block('result', 'sink.display')], [connect('input', 'operation', 'a'), connect('operation', 'result')]), expected: { result: [false, true] } },
  unaryFixture('Saturation', 'nonlinear.saturation', [-2, 0.5, 2], { lower: 0, upper: 1 }, [0, 0.5, 1]),
  pairFixture('Mux joins scalar/vector numbers', 'route.mux', 2, [3, 5], {}, [2, 3, 5]),
  pairFixture('Concatenate joins boolean vectors', 'math.concatenate', [true, false], true, {}, [true, false, true]),
  unaryFixture('Reshape vector to row-major matrix', 'matrix.reshape', [1, 2, 3, 4], { form: 'matrix', rows: 2, columns: 2 }, [[1, 2], [3, 4]]),
  unaryFixture('Reshape matrix to vector', 'matrix.reshape', [[1, 2], [3, 4]], { form: 'vector' }, [1, 2, 3, 4]),
  unaryFixture('Expression applies to every vector element', 'math.expression', [-2, 0, 2], { expression: 'x^2 + max(x, 0)' }, [4, 0, 6]),
  unaryFixture('Expression precedence and right-associative power', 'math.expression', 0, { expression: '-2^2 + 2^-2 + 2^3^2' }, 508.25),
  { name: 'Demux preserves selected source ports and Outport records while Terminator does not', model: staticModel([
    block('source', 'source.constant', { value: [2, 5, 11] }), block('split', 'route.demux', { count: 3 }), block('sum', 'math.sum'), block('output', 'io.output'), block('middle', 'sink.display'), block('unused', 'io.terminator'),
  ], [connect('source', 'split'), connect('split', 'sum', 'a', 'out1'), connect('split', 'sum', 'b', 'out3'), connect('sum', 'output'), connect('split', 'middle', 'in', 'out2'), connect('split', 'unused', 'in', 'out2')]), expected: { middle: 5, output: 13 } },
  { name: 'Demux maximum 16 outputs preserves two-digit port numbers', model: staticModel([
    block('source', 'source.constant', { value: Array.from({ length: 16 }, (_, index) => index + 1) }), block('split', 'route.demux', { count: 16 }), block('sum', 'math.sum'), block('result', 'sink.display'),
  ], [connect('source', 'split'), connect('split', 'sum', 'a', 'out10'), connect('split', 'sum', 'b', 'out16'), connect('sum', 'result')]), expected: { result: 26 } },
  { name: 'Demux preserves boolean values', model: staticModel([
    block('source', 'source.constant', { value: [true, false] }), block('split', 'route.demux', { count: 2 }), block('result', 'sink.display'),
  ], [connect('source', 'split'), connect('split', 'result', 'in', 'out2')]), expected: { result: false } },
  ...[true, false].map((condition) => ({ name: `Switch with boolean matrix data chooses ${condition ? 'a' : 'b'}`, model: staticModel([
    block('first', 'source.constant', { value: [[true, false]] }), block('second', 'source.constant', { value: [[false, true]] }), block('condition', 'source.constant', { value: condition }), block('select', 'route.switch'), block('result', 'sink.display'),
  ], [connect('first', 'select', 'a'), connect('second', 'select', 'b'), connect('condition', 'select', 'condition'), connect('select', 'result')]), expected: { result: condition ? [[true, false]] : [[false, true]] } })),
  unaryFixture('Every allowed expression function is interpreted', 'math.expression', 1, { expression: 'abs(-1)+sqrt(4)+sin(0)+cos(0)+tan(0)+asin(0)+acos(1)+atan(0)+exp(0)+log(1)+log10(1)+floor(1.2)+ceil(1.2)+round(1.2)+trunc(1.2)+min(1,2)+max(1,2)+pi-pi+e-e' }, 13),
];

export const M1_FAILURE_FIXTURES = [
  { fixture: pairFixture('Division by a zero element', 'math.multiply', [1, 2], [1, 0], { operation: 'divide' }, 0), code: 'NUMERIC_DIVIDE_BY_ZERO' },
  { fixture: unaryFixture('Reciprocal of zero', 'math.function', 0, { operation: 'reciprocal' }, 0), code: 'NUMERIC_DIVIDE_BY_ZERO' },
  { fixture: unaryFixture('Log zero', 'math.function', 0, { operation: 'log' }, 0), code: 'NUMERIC_DOMAIN' },
  { fixture: unaryFixture('Log10 negative', 'math.function', -1, { operation: 'log10' }, 0), code: 'NUMERIC_DOMAIN' },
  { fixture: unaryFixture('Negative Sqrt', 'math.sqrt', [-1, 4], {}, 0), code: 'NUMERIC_DOMAIN' },
  { fixture: unaryFixture('Asin above range', 'math.trigonometric', 2, { operation: 'asin' }, 0), code: 'NUMERIC_DOMAIN' },
  { fixture: unaryFixture('Acos below range', 'math.trigonometric', -2, { operation: 'acos' }, 0), code: 'NUMERIC_DOMAIN' },
  { fixture: unaryFixture('Exp overflow', 'math.function', 1000, { operation: 'exp' }, 0), code: 'NUMERIC_NONFINITE' },
  { fixture: unaryFixture('Expression zero division', 'math.expression', 0, { expression: '1/x' }, 0), code: 'NUMERIC_DIVIDE_BY_ZERO' },
  { fixture: unaryFixture('Expression complex power rejected', 'math.expression', -1, { expression: 'x^0.5' }, 0), code: 'NUMERIC_DOMAIN' },
  { fixture: unaryFixture('Expression function domain', 'math.expression', 0, { expression: 'log(x)' }, 0), code: 'NUMERIC_DOMAIN' },
];
