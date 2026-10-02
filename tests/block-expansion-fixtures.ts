import type { CalcModel, SignalValue } from '../packages/model/src';
import type { ExpansionBlockType } from '../packages/block-library/src/expansion';

export interface ExpansionFixture { id: ExpansionBlockType; inputs: Record<string, SignalValue>; parameters: Record<string, unknown>; expected: SignalValue }
const unary = (id: ExpansionBlockType, value: SignalValue, expected: SignalValue, parameters: Record<string, unknown> = {}): ExpansionFixture => ({ id, inputs: { in: value }, expected, parameters });
const pair = (id: ExpansionBlockType, a: SignalValue, b: SignalValue, expected: SignalValue, parameters: Record<string, unknown> = {}): ExpansionFixture => ({ id, inputs: { a, b }, expected, parameters });
const source = (id: ExpansionBlockType, expected: SignalValue, parameters: Record<string, unknown>): ExpansionFixture => ({ id, inputs: {}, expected, parameters });
/** Hand-computed or analytic expectations, independent of the implementation's dispatch/helpers. */
export const EXPANSION_FIXTURES: readonly ExpansionFixture[] = [
  unary('math.bias', [1, 3], [3, 5], { bias: 2 }), unary('math.sign', [-3, 0, 4], [-1, 0, 1]),
  unary('math.cbrt', [-8, 0, 27], [-2, 0, 3]), unary('math.expm1', [0, Math.LN2], [0, 1]), unary('math.log1p', [0, 1], [0, Math.LN2]),
  unary('math.log2', [1, 2, 8], [0, 1, 3]), unary('math.exp2', [-1, 0, 3], [.5, 1, 8]),
  unary('math.sinh', [-Math.LN2, 0, Math.LN2], [-.75, 0, .75]), unary('math.cosh', [-Math.LN2, 0, Math.LN2], [1.25, 1, 1.25]), unary('math.tanh', [-Math.LN2, 0, Math.LN2], [-.6, 0, .6]),
  unary('math.asinh', [-.75, 0, .75], [-Math.LN2, 0, Math.LN2]), unary('math.acosh', [1, 1.25], [0, Math.LN2]), unary('math.atanh', [-.6, 0, .6], [-Math.LN2, 0, Math.LN2]),
  unary('math.sinc', [0, 1, -1, .5], [1, 0, 0, 2 / Math.PI]),
  unary('math.polynomial', [0, 1, 2], [1, 0, 3], { coefficients: [2, -3, 1] }),
  pair('math.power', [2, 3, 4], 2, [4, 9, 16]), pair('math.hypot', 3, 4, 5), pair('math.atan2', 1, 1, Math.PI / 4),
  pair('math.mod', [-5, 5], 3, [1, 2]), pair('math.remainder', [-5, 5], 3, [-2, 2]),
  unary('nonlinear.dead-zone', [-2, 0, 3], [-1, 0, 2], { lower: -1, upper: 1 }),
  unary('nonlinear.quantizer', [-.75, -.25, .25, .75], [-1, -.5, .5, 1], { step: .5 }),
  unary('logic.interval', [-1, 0, 2], [false, true, false], { lower: 0, upper: 1 }),
  unary('logic.is-integer', [1, 1.5, -2], [true, false, true]),
  pair('logic.approx-equal', [1, 2], [1.1, 2.5], [true, false], { tolerance: .2 }),
  unary('reduce.sum', [[1, 2], [3, 4]], 10), unary('reduce.product', [1, 2, 3], 6),
  unary('reduce.mean', [1, 2, 3], 2), unary('reduce.median', [3, 1, 4, 2], 2.5),
  unary('reduce.variance', [1, 2, 3], 2 / 3), unary('reduce.std', [1, 2, 3], Math.sqrt(2 / 3)),
  unary('reduce.rms', [1, 2, 3], Math.sqrt(14 / 3)), unary('reduce.norm1', [-3, 4], 7),
  unary('reduce.norm2', [3, 4], 5), unary('reduce.norm-inf', [-3, 4], 4),
  unary('reduce.all', [true, false], false), unary('reduce.any', [[false, false], [false, true]], true),
  pair('vector.dot', [1, 2, 3], [4, 5, 6], 32), pair('vector.cross', [1, 0, 0], [0, 1, 0], [0, 0, 1]),
  unary('vector.normalize', [3, 4], [.6, .8]), unary('vector.reverse', [true, false, false], [false, false, true]),
  unary('vector.sort', [3, 1, 2], [1, 2, 3]), unary('vector.cumsum', [1, 2, 3], [1, 3, 6]),
  unary('vector.cumprod', [2, 3, 4], [2, 6, 24]), unary('vector.difference', [1, 4, 9], [3, 5]),
  unary('vector.select', [10, 20, 30], [30, 10, 30], { indices: [2, 0, 2] }),
  unary('vector.slice', [10, 20, 30, 40], [20, 30], { start: 1, count: 2 }),
  unary('vector.repeat', [1, 2], [1, 2, 1, 2], { count: 2 }),
  pair('vector.convolve', [1, 2], [3, 4], [3, 10, 8]),
  unary('matrix.trace', [[1, 2], [3, 4]], 5), unary('matrix.diagonal', [[1, 2, 3], [4, 5, 6]], [1, 5]),
  unary('matrix.diag-create', [2, 3], [[2, 0], [0, 3]]), source('matrix.identity', [[1, 0], [0, 1]], { size: 2 }),
  unary('matrix.select', [[1, 2, 3], [4, 5, 6]], [[1, 3]], { rows: [0], columns: [0, 2] }),
  unary('matrix.row', [[1, 2], [3, 4]], [3, 4], { index: 1 }),
  unary('matrix.column', [[1, 2], [3, 4]], [2, 4], { index: 1 }),
  pair('matrix.horizontal', [[1], [2]], [[3, 4], [5, 6]], [[1, 3, 4], [2, 5, 6]]),
  pair('matrix.vertical', [[1, 2]], [[3, 4]], [[1, 2], [3, 4]]),
  unary('matrix.triangle', [[1, 2], [3, 4]], [[1, 2], [0, 4]], { part: 'upper' }),
  unary('matrix.symmetrize', [[1, 2], [4, 3]], [[1, 3], [3, 3]]),
  pair('matrix.kronecker', [[1, 2]], [[3], [4]], [[3, 6], [4, 8]]),
  source('source.linspace', [0, .25, .5, .75, 1], { start: 0, stop: 1, count: 5 }),
  source('source.logspace', [1, 10, 100], { start: 0, stop: 2, count: 3 }),
  source('source.zeros', [[0, 0], [0, 0]], { form: 'matrix', length: 3, rows: 2, columns: 2 }),
];

export function expansionModel(fixture: ExpansionFixture, mode: CalcModel['execution']['mode'] = 'static'): CalcModel {
  return { schemaVersion: 1, modelId: 'expansion_test', name: fixture.id,
    nodes: [...Object.entries(fixture.inputs).map(([port, value]) => ({ id: `input_${port}`, blockType: 'source.constant', blockVersion: 1 as const, label: port, parameters: { value } })),
      { id: 'operation', blockType: fixture.id, blockVersion: 1, label: fixture.id, parameters: structuredClone(fixture.parameters) },
      { id: 'result', blockType: 'sink.display', blockVersion: 1, label: 'result', parameters: {} }],
    edges: [...Object.keys(fixture.inputs).map(port => ({ id: `to_${port}`, source: { nodeId: `input_${port}`, portId: 'out' }, target: { nodeId: 'operation', portId: port } })),
      { id: 'to_result', source: { nodeId: 'operation', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }],
    execution: { mode, startTime: 0, stopTime: .2, step: .1 }, layout: {},
  };
}
