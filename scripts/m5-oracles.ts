import type { CalcModel, ExecutionMode, SignalValue } from '../packages/model/src';

export interface M5Oracle {
  id: string;
  model: CalcModel;
  reference: string;
  tolerance: number;
  relativeTolerance?: number;
  expected: Record<string, (time: number, index: number) => SignalValue>;
  expectedUnits?: Record<string, string>;
  residuals?: { kind: 'inverse' | 'solve' | 'cholesky' | 'lu'; matrix: number[][]; rhs?: number[][]; outputs: string[]; tolerance: number }[];
}
export interface M5FailureOracle { id: string; model: CalcModel; expectedCode: string; nodeId: string; minimumPartialSamples?: number; expectedPartial?: M5Oracle['expected'] }
export function m5Graph(id: string, mode: ExecutionMode = 'static', stop = 1, step = 0.1): CalcModel {
  return { schemaVersion: 1, modelId: id, name: id, nodes: [], edges: [], layout: {}, execution: { mode, startTime: 0, stopTime: stop, step,
    ...(mode === 'continuous' ? { solver: { method: 'rk4', initialStep: 0.08, minStep: 1e-10, maxStep: 0.08, discreteStep: step } } : {}) } };
}
export function m5Node(model: CalcModel, id: string, blockType: string, parameters: Record<string, unknown> = {}, unit?: string): void {
  model.nodes.push({ id, blockType, blockVersion: 1, label: id, parameters, ...(unit ? { unit } : {}) });
}
export function m5Wire(model: CalcModel, source: string, target: string, targetPort = 'in', sourcePort = 'out'): void {
  model.edges.push({ id: `${source}-${sourcePort}-${target}-${targetPort}`, source: { nodeId: source, portId: sourcePort }, target: { nodeId: target, portId: targetPort } });
}
export function m5Scope(model: CalcModel, source: string, id = 'result', sourcePort = 'out'): void { m5Node(model, id, 'sink.scope'); m5Wire(model, source, id, 'in', sourcePort); }
const pivotA = [[0, 2, 1], [1, 1, 0], [2, 0, 1]];
const inverseA = [[-0.25, 0.5, 0.25], [0.25, 0.5, -0.25], [0.5, -1, 0.5]];
const lowerA = [[1, 0, 0], [0, 1, 0], [0.5, 0.5, 1]];
const upperA = [[2, 0, 1], [0, 2, 1], [0, 0, -1]];
const permutationA = [[0, 0, 1], [1, 0, 0], [0, 1, 0]];
export const m5LookupParameters = { rowBreakpoints: [-2, 1, 5], columnBreakpoints: [-3, 2, 6], table: [[36, -19, -63], [6, 11, 15], [-34, 51, 119]], interpolation: 'linear', extrapolation: 'clip' };
function lookupInputs(model: CalcModel, row: number, column: number): void { m5Node(model, 'row', 'source.constant', { value: row }); m5Node(model, 'column', 'source.constant', { value: column }); }
function lookupNode(model: CalcModel, id: string, extra: Record<string, unknown> = {}): void { m5Node(model, id, 'lookup.2d', { ...m5LookupParameters, ...extra }); m5Wire(model, 'row', id, 'row'); m5Wire(model, 'column', id, 'column'); }
export function m5Oracles(): M5Oracle[] {
  const fixtures: M5Oracle[] = [];
  const add = (model: CalcModel, reference: string, expected: M5Oracle['expected'], extra: Partial<M5Oracle> = {}): void => { fixtures.push({ id: model.modelId, model, reference, tolerance: 2e-11, expected, ...extra }); };
  {
    const model = m5Graph('F05-rectangular-product'); m5Node(model, 'a', 'source.constant', { value: [[1, 2, 3], [4, 5, 6]] }, 'm'); m5Node(model, 'b', 'source.constant', { value: [[7, 8], [9, 10], [11, 12]] }, 'm');
    m5Node(model, 'product', 'math.matrix-multiply'); m5Wire(model, 'a', 'product', 'a'); m5Wire(model, 'b', 'product', 'b'); m5Scope(model, 'product');
    add(model, 'Hand row/column dot products: (2x3)(3x2)=[[58,64],[139,154]], unit m*m=m^2; no elementwise broadcasting.', { result: () => [[58, 64], [139, 154]] }, { expectedUnits: { result: 'm^2' } });
  }
  {
    const model = m5Graph('F05-rectangular-transpose'); m5Node(model, 'a', 'source.constant', { value: [[1, -2, 3], [4, 5, 6]] }, 'm'); m5Node(model, 'transpose', 'matrix.transpose'); m5Wire(model, 'a', 'transpose'); m5Scope(model, 'transpose');
    add(model, 'Transpose swaps explicit 2D row/column indices: [[1,4],[-2,5],[3,6]], preserving m.', { result: () => [[1, 4], [-2, 5], [3, 6]] }, { expectedUnits: { result: 'm' } });
  }
  {
    const model = m5Graph('F05-determinant-pivot'); m5Node(model, 'a', 'source.constant', { value: pivotA }); m5Node(model, 'det', 'matrix.determinant'); m5Wire(model, 'a', 'det'); m5Scope(model, 'det');
    add(model, 'Direct cofactor expansion: -2*(1)+1*(-2)=-4; first zero pivot requires partial pivoting.', { result: () => -4 });
  }
  {
    const model = m5Graph('F05-determinant-singular-zero'); m5Node(model, 'a', 'source.constant', { value: [[1, 2], [2, 4]] }); m5Node(model, 'det', 'matrix.determinant'); m5Wire(model, 'a', 'det'); m5Scope(model, 'det');
    add(model, 'Exact singular determinant 1*4-2*2=0 is a valid scalar result.', { result: () => 0 });
  }
  {
    const model = m5Graph('F05-inverse-pivot'); m5Node(model, 'a', 'source.constant', { value: pivotA }); m5Node(model, 'inverse', 'matrix.inverse'); m5Wire(model, 'a', 'inverse'); m5Scope(model, 'inverse');
    add(model, 'Three hand-solved unit RHS columns give inverse=[[-1/4,1/2,1/4],[1/4,1/2,-1/4],[1/2,-1,1/2]].', { result: () => inverseA }, { residuals: [{ kind: 'inverse', matrix: pivotA, outputs: ['result'], tolerance: 2e-12 }] });
  }
  {
    const model = m5Graph('F05-solve-multiple-rhs'); const A = [[3, 1], [1, 2]], B = [[6, 5], [7, 0]];
    m5Node(model, 'a', 'source.constant', { value: A }); m5Node(model, 'b', 'source.constant', { value: B }, 'm'); m5Node(model, 'solve', 'matrix.solve'); m5Wire(model, 'a', 'solve', 'a'); m5Wire(model, 'b', 'solve', 'b'); m5Scope(model, 'solve');
    add(model, 'Independent multiplication A*[[1,2],[3,-1]]=[[6,5],[7,0]]; solve retains multi-RHS 2D and B unit m.', { result: () => [[1, 2], [3, -1]] }, { expectedUnits: { result: 'm' }, residuals: [{ kind: 'solve', matrix: A, rhs: B, outputs: ['result'], tolerance: 2e-12 }] });
  }
  {
    const model = m5Graph('F05-cholesky'); const A = [[4, 12, -16], [12, 37, -43], [-16, -43, 98]], L = [[2, 0, 0], [6, 1, 0], [-8, 5, 3]];
    m5Node(model, 'a', 'source.constant', { value: A }); m5Node(model, 'factor', 'matrix.cholesky'); m5Wire(model, 'a', 'factor'); m5Scope(model, 'factor');
    add(model, 'Hand triangular factor L=[[2,0,0],[6,1,0],[-8,5,3]], whose L*L^T equals all nine A entries.', { result: () => L }, { residuals: [{ kind: 'cholesky', matrix: A, outputs: ['result'], tolerance: 2e-11 }] });
  }
  {
    const model = m5Graph('F05-lu-pivot-permutation'); m5Node(model, 'a', 'source.constant', { value: pivotA }); m5Node(model, 'factor', 'matrix.lu'); m5Wire(model, 'a', 'factor'); m5Scope(model, 'factor', 'lower', 'lower'); m5Scope(model, 'factor', 'upper', 'upper'); m5Scope(model, 'factor', 'permutation', 'permutation');
    add(model, 'Hand partial pivoting visits original rows [2,0,1], with two row swaps. Matrix P*A=L*U; P is an explicit 0/1 matrix.', { lower: () => lowerA, upper: () => upperA, permutation: () => permutationA }, { residuals: [{ kind: 'lu', matrix: pivotA, outputs: ['lower', 'upper', 'permutation'], tolerance: 2e-12 }] });
  }
  for (const exponent of [-300, 300]) {
    const model = m5Graph(`F05-scaled-inverse-${exponent < 0 ? 'small' : 'large'}`); const scale = 10 ** exponent;
    m5Node(model, 'a', 'source.constant', { value: [[2 * scale, scale], [scale, 2 * scale]] }); m5Node(model, 'inverse', 'matrix.inverse'); m5Wire(model, 'a', 'inverse'); m5Scope(model, 'inverse');
    add(model, `Scale-independent inverse for 1e${exponent}*[[2,1],[1,2]] is (1e${-exponent}/3)*[[2,-1],[-1,2]]. Nonzero expected entries use relative tolerance.`, { result: () => [[2 / (3 * scale), -1 / (3 * scale)], [-1 / (3 * scale), 2 / (3 * scale)]] }, { tolerance: 0, relativeTolerance: 2e-12, residuals: [{ kind: 'inverse', matrix: [[2 * scale, scale], [scale, 2 * scale]], outputs: ['result'], tolerance: 2e-12 }] });
  }
  {
    const model = m5Graph('F05-bilinear-nonuniform'); lookupInputs(model, 0.5, 3); lookupNode(model, 'lookup'); m5Scope(model, 'lookup');
    add(model, 'Nonuniform row[-2,1,5]/column[-3,2,6] samples global bilinear f(r,c)=2r-3c+4rc+7. At(.5,3), f=5.', { result: () => 5 });
  }
  {
    const model = m5Graph('F05-lookup-both-axes-outside'); lookupInputs(model, -4, 10); lookupNode(model, 'linear-lookup', { extrapolation: 'linear' }); lookupNode(model, 'clipped-lookup'); m5Scope(model, 'linear-lookup', 'linear'); m5Scope(model, 'clipped-lookup', 'clipped');
    add(model, 'Both-axis extrapolation: f(-4,10)=-191 using first/last intervals; clip projects to(-2,6) with table value -63.', { linear: () => -191, clipped: () => -63 });
  }
  for (const [id, row, column, interpolation, expected] of [['nearest-low-tie', -0.5, -0.5, 'nearest', 36], ['nearest-high-tie', 3, 4, 'nearest', 11], ['previous-internal-knot', 1, 2, 'previous', 11], ['previous-between', 4, 5, 'previous', 11], ['previous-last', 5, 6, 'previous', 119]] as const) {
    const model = m5Graph(`F05-${id}`); lookupInputs(model, row, column); lookupNode(model, 'lookup', { interpolation }); m5Scope(model, 'lookup');
    add(model, `Independent ${interpolation} row/column interval selection at(${row},${column}) gives original table value ${expected}; midpoint ties select lower indices and exact knots select that knot.`, { result: () => expected });
  }
  {
    const model = m5Graph('F05-prelookup-knots-extrapolation'); const values = [['inside', 1, 'clip', 1, 0], ['last', 5, 'clip', 1, 1], ['left-clip', -4, 'clip', 0, 0], ['right-clip', 10, 'clip', 1, 1], ['left-linear', -4, 'linear', 0, -2 / 3], ['right-linear', 10, 'linear', 1, 9 / 4]] as const;
    const expected: M5Oracle['expected'] = {};
    for (const [id, value, extrapolation, index, fraction] of values) { m5Node(model, `${id}-input`, 'source.constant', { value }); m5Node(model, id, 'lookup.prelookup', { breakpoints: [-2, 1, 5], extrapolation }); m5Wire(model, `${id}-input`, id); m5Scope(model, id, `${id}-index`, 'index'); m5Scope(model, id, `${id}-fraction`, 'fraction'); expected[`${id}-index`] = () => index; expected[`${id}-fraction`] = () => fraction; }
    add(model, 'Hand interval/fraction: internal knot1→(1,0), final5→(1,1), clipping endpoints, linear outside first/last intervals without clamping fractions.', expected);
  }
  for (const mode of ['discrete', 'continuous'] as const) {
    const model = m5Graph(`F05-temporal-lookup-${mode}`, mode, 1, 0.125); m5Node(model, 'row', mode === 'continuous' ? 'source.clock' : 'source.ramp', {}, '1'); m5Node(model, 'column', 'source.constant', { value: 2.5 }); lookupNode(model, 'lookup'); m5Scope(model, 'lookup');
    m5Node(model, 'prelookup', 'lookup.prelookup', { breakpoints: [0, 0.25, 1], extrapolation: 'clip' }); m5Wire(model, 'row', 'prelookup'); m5Scope(model, 'prelookup', 'index', 'index'); m5Scope(model, 'prelookup', 'fraction', 'fraction');
    const expected: M5Oracle['expected'] = { result: (t) => 12 * t - 0.5, index: (t) => t < 0.25 ? 0 : 1, fraction: (t) => t < 0.25 ? t / 0.25 : (t - 0.25) / 0.75 };
    if (mode === 'continuous') { m5Node(model, 'integrator', 'continuous.integrator'); m5Wire(model, 'lookup', 'integrator'); m5Scope(model, 'integrator', 'integral'); expected.integral = (t) => 6 * t * t - 0.5 * t; }
    add(model, `Time-domain algebraic ${mode} fixture: f(t,2.5)=12t-.5, prelookup actual knot .25/final1; continuous exact integral6t^2-.5t uses every stage.`, expected, { tolerance: 2e-9 });
  }
  const halfValues = [[-3.5, -2.5, -1.5, -0.5], [0.5, 1.5, 2.5, 3.5]];
  for (const [rounding, expected] of [['nearest-even', [[-4, -2, -2, 0], [0, 2, 2, 4]]], ['floor', [[-4, -3, -2, -1], [0, 1, 2, 3]]], ['ceil', [[-3, -2, -1, 0], [1, 2, 3, 4]]], ['toward-zero', [[-3, -2, -1, 0], [0, 1, 2, 3]]]] as const) {
    const model = m5Graph(`F05-quantize-${rounding}`); m5Node(model, 'input', 'source.constant', { value: halfValues }, 'm'); m5Node(model, 'quantize', 'fixed.quantize', { wordLength: 8, fractionLength: 0, signedness: 'signed', rounding, overflow: 'error' }); m5Wire(model, 'input', 'quantize'); m5Scope(model, 'quantize'); m5Scope(model, 'quantize', 'stored', 'stored');
    add(model, `Independent half-integer rounding table for ${rounding}; same2D shape, out unit m and exact stored codes unit1.`, { result: () => expected.map((row) => [...row]), stored: () => expected.map((row) => [...row]) }, { tolerance: 0, expectedUnits: { result: 'm', stored: '1' } });
  }
  for (const [signedness, expected] of [['unsigned', [0, 0, 4294967295, 1, 1, 4294967295, 0, 0]], ['signed', [0, 0, -1, 1, 1, -1, 0, 0]]] as const) {
    const model = m5Graph(`F05-quantize-32bit-${signedness}-wrap`); m5Node(model, 'input', 'source.constant', { value: [-Number.MAX_VALUE, Number.MAX_VALUE, -4294967297, 4294967297, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, -Number.MIN_VALUE, Number.MIN_VALUE] });
    m5Node(model, 'quantize', 'fixed.quantize', { wordLength: 32, fractionLength: 0, signedness, rounding: 'nearest-even', overflow: 'wrap' }); m5Wire(model, 'input', 'quantize'); m5Scope(model, 'quantize'); m5Scope(model, 'quantize', 'stored', 'stored');
    add(model, `Exact modulo2^32 of IEEE integers: MAX_VALUE divisibleby2^32, ±(2^32+1) and ±(2^53-1) retain independent lower-bit residues. ${signedness} code interpretation, tiny values round0.`, { result: () => [...expected], stored: () => [...expected] }, { tolerance: 0 });
  }
  {
    const model = m5Graph('F05-quantize-32bit-saturate-fraction'); m5Node(model, 'input', 'source.constant', { value: [-0.5, 0.5, 2 ** -33, -(2 ** -33), 3 * 2 ** -33, -(3 * 2 ** -33), Number.MIN_VALUE, -Number.MIN_VALUE, -0] });
    m5Node(model, 'quantize', 'fixed.quantize', { wordLength: 32, fractionLength: 32, signedness: 'signed', rounding: 'nearest-even', overflow: 'saturate' }); m5Wire(model, 'input', 'quantize'); m5Scope(model, 'quantize'); m5Scope(model, 'quantize', 'stored', 'stored');
    const stored = [-2147483648, 2147483647, 0, 0, 2, -2, 0, 0, 0];
    add(model, 'Signed32/F32 codes saturate +.5 to2^31-1; exact half ties .5code→0,1.5code→2 and symmetric negatives; subnormal/negativezero become+0.', { result: () => stored.map((value) => value / 2 ** 32), stored: () => stored }, { tolerance: 0 });
  }
  {
    const model = m5Graph('F05-quantize-subnormal-directed'); m5Node(model, 'input', 'source.constant', { value: [Number.MIN_VALUE, -Number.MIN_VALUE] });
    const expected: M5Oracle['expected'] = {};
    for (const [rounding, stored] of [['ceil', [1, 0]], ['floor', [0, -1]]] as const) { m5Node(model, rounding, 'fixed.quantize', { wordLength: 32, fractionLength: 32, signedness: 'signed', rounding, overflow: 'error' }); m5Wire(model, 'input', rounding); m5Scope(model, rounding, `${rounding}-out`); m5Scope(model, rounding, `${rounding}-stored`, 'stored'); expected[`${rounding}-out`] = () => stored.map((value) => value / 2 ** 32); expected[`${rounding}-stored`] = () => [...stored]; }
    add(model, 'Exact rational ±2^-1074: ceil producesstored[1,0], floor[0,-1] atF32 without losing the nonzero remainder through floatunderflow.', expected, { tolerance: 0 });
  }
  {
    const model = m5Graph('F05-quantize-unsigned-saturation'); m5Node(model, 'input', 'source.constant', { value: [-Number.MAX_VALUE, Number.MAX_VALUE, -1, 4294967295, 4294967296] });
    m5Node(model, 'quantize', 'fixed.quantize', { wordLength: 32, fractionLength: 0, signedness: 'unsigned', rounding: 'toward-zero', overflow: 'saturate' }); m5Wire(model, 'input', 'quantize'); m5Scope(model, 'quantize'); m5Scope(model, 'quantize', 'stored', 'stored');
    const expected = [0, 4294967295, 0, 4294967295, 4294967295];
    add(model, 'Unsigned32 saturation independently clamps negative integers to0 and positive overflow to2^32-1, including finite MAX_VALUE.', { result: () => expected, stored: () => expected }, { tolerance: 0 });
  }
  {
    const model = m5Graph('F05-discrete-matrix-memory', 'discrete', 0.5, 0.125); m5Node(model, 'a', 'source.constant', { value: [[1, 2, 3], [4, 5, 6]] }); m5Node(model, 'transpose', 'matrix.transpose'); m5Wire(model, 'a', 'transpose');
    m5Node(model, 'delay', 'discrete.unit-delay', { initial: [[0, 0], [0, 0], [0, 0]] }); m5Wire(model, 'transpose', 'delay'); m5Scope(model, 'delay');
    add(model, 'Typed3x2 UnitDelay publishes all-zero initial matrix at tick0 and the independently transposed matrix at every later tick; no extra final transition.', { result: (_t, i) => i === 0 ? [[0, 0], [0, 0], [0, 0]] : [[1, 4], [2, 5], [3, 6]] });
  }
  return fixtures;
}

export function m5FailureOracles(): M5FailureOracle[] {
  const fixtures: M5FailureOracle[] = [];
  const matrixFailure = (id: string, type: string, value: number[][], expectedCode: string): void => {
    const model = m5Graph(`F05-failure-${id}`); m5Node(model, 'a', 'source.constant', { value }); m5Node(model, 'bad', type); m5Wire(model, 'a', 'bad'); m5Scope(model, 'bad');
    fixtures.push({ id: model.modelId, model, expectedCode, nodeId: 'bad' });
  };
  matrixFailure('inverse-singular', 'matrix.inverse', [[1, 2], [2, 4]], 'MATRIX_SINGULAR');
  matrixFailure('inverse-ill-conditioned', 'matrix.inverse', [[1, 0], [0, 1e-14]], 'MATRIX_ILL_CONDITIONED');
  matrixFailure('cholesky-not-positive', 'matrix.cholesky', [[1, 2], [2, 1]], 'MATRIX_NOT_POSITIVE_DEFINITE');
  matrixFailure('cholesky-not-symmetric', 'matrix.cholesky', [[1, 0.2], [0.3, 1]], 'MATRIX_NOT_SYMMETRIC');
  matrixFailure('determinant-underflow', 'matrix.determinant', [[1e-300, 0], [0, 1e-300]], 'MATRIX_NUMERIC_UNDERFLOW');
  matrixFailure('determinant-overflow', 'matrix.determinant', [[1e300, 0], [0, 1e300]], 'MATRIX_NUMERIC_NONFINITE');
  {
    const model = m5Graph('F05-failure-lookup-both-axes'); lookupInputs(model, -4, 10); lookupNode(model, 'bad', { extrapolation: 'error' }); m5Scope(model, 'bad');
    fixtures.push({ id: model.modelId, model, expectedCode: 'LOOKUP_OUT_OF_RANGE', nodeId: 'bad' });
  }
  {
    const model = m5Graph('F05-failure-prelookup-outside'); m5Node(model, 'input', 'source.constant', { value: 10 }); m5Node(model, 'bad', 'lookup.prelookup', { breakpoints: [-2, 1, 5], extrapolation: 'error' }); m5Wire(model, 'input', 'bad'); m5Scope(model, 'bad', 'result', 'fraction');
    fixtures.push({ id: model.modelId, model, expectedCode: 'LOOKUP_OUT_OF_RANGE', nodeId: 'bad' });
  }
  for (const mode of ['static', 'discrete'] as const) {
    const model = m5Graph(`F05-failure-quantize-overflow-${mode}`, mode, 0.5, 0.1);
    m5Node(model, 'input', mode === 'static' ? 'source.constant' : 'source.ramp', mode === 'static' ? { value: 128 } : { slope: 1000 });
    m5Node(model, 'bad', 'fixed.quantize', { wordLength: 8, fractionLength: 0, overflow: 'error' }); m5Wire(model, 'input', 'bad'); m5Scope(model, 'bad');
    fixtures.push({ id: model.modelId, model, expectedCode: 'FIXED_POINT_OVERFLOW', nodeId: 'bad', ...(mode === 'discrete' ? { minimumPartialSamples: 2, expectedPartial: { result: (time: number) => time * 1000 } } : {}) });
  }
  {
    const model = m5Graph('F05-failure-continuous-singular-after-step', 'continuous', 0.6, 0.1); m5Node(model, 'step', 'source.step', { stepTime: 0.3, before: 1, after: 0 }); m5Node(model, 'identity', 'source.constant', { value: [[1, 0], [0, 1]] });
    m5Node(model, 'scale', 'math.multiply'); m5Wire(model, 'step', 'scale', 'a'); m5Wire(model, 'identity', 'scale', 'b'); m5Node(model, 'bad', 'matrix.inverse'); m5Wire(model, 'scale', 'bad'); m5Scope(model, 'bad');
    fixtures.push({ id: model.modelId, model, expectedCode: 'MATRIX_SINGULAR', nodeId: 'bad', minimumPartialSamples: 3, expectedPartial: { result: () => [[1, 0], [0, 1]] } });
  }
  {
    const model = m5Graph('F05-failure-discrete-lookup-after-range', 'discrete', 0.5, 0.1); m5Node(model, 'row', 'source.ramp'); m5Node(model, 'column', 'source.constant', { value: 1 });
    m5Node(model, 'bad', 'lookup.2d', { rowBreakpoints: [0, 0.25], columnBreakpoints: [0, 2], table: [[0, 2], [0.25, 2.25]], extrapolation: 'error' }); m5Wire(model, 'row', 'bad', 'row'); m5Wire(model, 'column', 'bad', 'column'); m5Scope(model, 'bad');
    fixtures.push({ id: model.modelId, model, expectedCode: 'LOOKUP_OUT_OF_RANGE', nodeId: 'bad', minimumPartialSamples: 3, expectedPartial: { result: (time) => time + 1 } });
  }
  return fixtures;
}
