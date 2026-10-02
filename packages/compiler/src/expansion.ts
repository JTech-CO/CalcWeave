import { EXPANSION_BLOCK_IDS } from '../../block-library/src/expansion';
import { ModelError, multiplyUnits, signalElementCount, squareUnit, type IRNode, type SignalDescriptor } from '../../model/src';

const supported: ReadonlySet<string> = new Set(EXPANSION_BLOCK_IDS);
const unitlessUnary = new Set(['math.cbrt', 'math.expm1', 'math.log1p', 'math.log2', 'math.exp2', 'math.sinh', 'math.cosh', 'math.tanh', 'math.asinh', 'math.acosh', 'math.atanh', 'math.sinc', 'math.polynomial']);
/** Shape and unit inference is independent of runtime values; invalid indices never reach execution. */
export function inferExpansionSignal(node: IRNode, input: (port: string) => SignalDescriptor, declaredUnit = '1'): SignalDescriptor | undefined {
  if (!supported.has(node.blockType)) return undefined;
  const fail = (code: string, message: string, portId = 'in'): never => { throw new ModelError([{ code, message, nodeId: node.id, portId }]); };
  const copy = (value: SignalDescriptor, shape = value.shape, unit = value.unit): SignalDescriptor => ({ valueType: value.valueType, shape: [...shape], unit });
  const numeric = (port = 'in'): SignalDescriptor => { const value = input(port); if (value.valueType !== 'float64') fail('TYPE_MISMATCH', '이 연산에는 float64 숫자 입력이 필요합니다.', port); return value; };
  const vector = (port = 'in', numbers = true): SignalDescriptor => { const value = numbers ? numeric(port) : input(port); if (value.shape.length !== 1) fail('SHAPE_MISMATCH', '이 연산에는 1D 벡터가 필요합니다.', port); return value; };
  const matrix = (port = 'in', numbers = true, square = false): SignalDescriptor => { const value = numbers ? numeric(port) : input(port); if (value.shape.length !== 2 || value.shape.some(length => length > 32)) fail('MATRIX_SHAPE', '행렬의 각 축은 1~32여야 합니다.', port); if (square && value.shape[0] !== value.shape[1]) fail('MATRIX_SQUARE_REQUIRED', '정방 행렬을 연결해 주세요.', port); return value; };
  const unitless = (value: SignalDescriptor, port = 'in'): void => { if (value.unit !== '1') fail('UNIT_MISMATCH', '단위 없는 입력이 필요합니다.', port); };
  const sameUnit = (a: SignalDescriptor, b: SignalDescriptor): void => { if (a.unit !== b.unit) fail('UNIT_MISMATCH', '두 입력의 단위가 같아야 합니다.', 'b'); };
  const sameType = (a: SignalDescriptor, b: SignalDescriptor): void => { if (a.valueType !== b.valueType) fail('TYPE_MISMATCH', '두 입력의 자료형이 같아야 합니다.', 'b'); };
  const sameShape = (a: SignalDescriptor, b: SignalDescriptor): boolean => a.shape.length === b.shape.length && a.shape.every((length, index) => length === b.shape[index]);
  const indexList = (name: string, length: number): number[] => { const indices = node.parameters[name] as number[]; if (indices.some(index => !Number.isSafeInteger(index) || index < 0 || index >= length)) fail('INVALID_INDEX', '선택 index는 입력 범위 안의 0부터 시작하는 정수여야 합니다.'); return indices; };
  const id = node.blockType, p = node.parameters;
  if (unitlessUnary.has(id)) { const value = numeric(); unitless(value); return copy(value); }
  if (id === 'math.bias' || id === 'nonlinear.dead-zone' || id === 'nonlinear.quantizer') {
    if (id === 'nonlinear.dead-zone' && (p.lower as number) > (p.upper as number)) fail('INVALID_PARAMETERS', 'lower는 upper 이하여야 합니다.');
    return copy(numeric());
  }
  if (id === 'math.sign' || id === 'logic.is-integer' || id === 'logic.interval') {
    const value = numeric(); if (id === 'logic.interval' && (p.lower as number) > (p.upper as number)) fail('INVALID_PARAMETERS', 'lower는 upper 이하여야 합니다.');
    return { valueType: id === 'math.sign' ? 'float64' : 'boolean', shape: [...value.shape], unit: '1' };
  }
  if (['math.power', 'math.hypot', 'math.atan2', 'math.mod', 'math.remainder', 'logic.approx-equal'].includes(id)) {
    const a = numeric('a'), b = numeric('b');
    if (id === 'math.power') { unitless(a, 'a'); unitless(b, 'b'); } else sameUnit(a, b);
    if (a.shape.length && b.shape.length && !sameShape(a, b)) fail('SHAPE_MISMATCH', '비scalar 두 입력은 같은 형상이어야 합니다.', 'b');
    return { valueType: id === 'logic.approx-equal' ? 'boolean' : 'float64', shape: [...(a.shape.length ? a.shape : b.shape)], unit: id === 'math.atan2' ? 'rad' : id === 'logic.approx-equal' ? '1' : a.unit };
  }
  if (id.startsWith('reduce.')) {
    const value = id === 'reduce.all' || id === 'reduce.any' ? input('in') : numeric();
    if ((id === 'reduce.all' || id === 'reduce.any') && value.valueType !== 'boolean') fail('TYPE_MISMATCH', 'all/any에는 boolean 입력이 필요합니다.');
    if (id === 'reduce.product') unitless(value);
    return copy(value, [], id === 'reduce.variance' ? squareUnit(value.unit) : value.unit);
  }
  if (id === 'vector.dot' || id === 'vector.cross' || id === 'vector.convolve') {
    const a = vector('a'), b = vector('b');
    if (id !== 'vector.convolve' && a.shape[0] !== b.shape[0]) fail('SHAPE_MISMATCH', '두 벡터의 길이가 같아야 합니다.', 'b');
    if (id === 'vector.cross' && a.shape[0] !== 3) fail('SHAPE_MISMATCH', '외적에는 길이 3의 두 벡터가 필요합니다.');
    return { valueType: 'float64', shape: id === 'vector.dot' ? [] : [id === 'vector.convolve' ? a.shape[0]! + b.shape[0]! - 1 : 3], unit: multiplyUnits(a.unit, b.unit) };
  }
  if (id.startsWith('vector.')) {
    const anyType = ['vector.reverse', 'vector.select', 'vector.slice', 'vector.repeat'].includes(id);
    const value = vector('in', !anyType), length = value.shape[0]!;
    if (id === 'vector.cumprod') unitless(value);
    if (id === 'vector.difference') { if (length < 2) fail('SHAPE_MISMATCH', '차분에는 길이 2 이상 벡터가 필요합니다.'); return copy(value, [length - 1]); }
    if (id === 'vector.select') return copy(value, [indexList('indices', length).length]);
    if (id === 'vector.slice') { if ((p.start as number) + (p.count as number) > length) fail('INVALID_INDEX', 'slice 범위가 입력 벡터를 벗어났습니다.'); return copy(value, [p.count as number]); }
    if (id === 'vector.repeat') return copy(value, [length * (p.count as number)]);
    return copy(value, value.shape, id === 'vector.normalize' ? '1' : value.unit);
  }
  if (id === 'matrix.identity') return { valueType: 'float64', shape: [p.size as number, p.size as number], unit: '1' };
  if (id === 'matrix.diag-create') { const value = vector('in', false); if (value.shape[0]! > 32) fail('MATRIX_SHAPE', '대각 행렬의 축은 32 이하여야 합니다.'); return copy(value, [value.shape[0]!, value.shape[0]!]); }
  if (id === 'matrix.horizontal' || id === 'matrix.vertical' || id === 'matrix.kronecker') {
    const a = matrix('a', id === 'matrix.kronecker'), b = matrix('b', id === 'matrix.kronecker');
    if (id === 'matrix.kronecker') { const shape = [a.shape[0]! * b.shape[0]!, a.shape[1]! * b.shape[1]!]; if (shape.some(length => length > 32)) fail('MATRIX_SHAPE', 'Kronecker 출력 각 축은 32 이하여야 합니다.'); return copy(a, shape, multiplyUnits(a.unit, b.unit)); }
    sameUnit(a, b); sameType(a, b);
    const fixedAxis = id === 'matrix.horizontal' ? 0 : 1, growingAxis = 1 - fixedAxis;
    if (a.shape[fixedAxis] !== b.shape[fixedAxis]) fail('SHAPE_MISMATCH', '결합 방향 외의 행렬 축이 같아야 합니다.', 'b');
    const shape = [...a.shape]; shape[growingAxis] += b.shape[growingAxis]!;
    if (shape[growingAxis]! > 32) fail('MATRIX_SHAPE', '결합 행렬의 각 축은 32 이하여야 합니다.');
    return copy(a, shape);
  }
  if (id.startsWith('matrix.')) {
    const value = matrix('in', id === 'matrix.trace' || id === 'matrix.symmetrize', id === 'matrix.trace' || id === 'matrix.symmetrize');
    if (id === 'matrix.trace') return copy(value, []);
    if (id === 'matrix.diagonal') return copy(value, [Math.min(...value.shape)]);
    if (id === 'matrix.select') return copy(value, [indexList('rows', value.shape[0]!).length, indexList('columns', value.shape[1]!).length]);
    if (id === 'matrix.row' || id === 'matrix.column') { const axis = id === 'matrix.row' ? 0 : 1; if ((p.index as number) >= value.shape[axis]!) fail('INVALID_INDEX', '선택한 행·열 index가 행렬을 벗어났습니다.'); return copy(value, [value.shape[1 - axis]!]); }
    return copy(value);
  }
  if (id === 'source.linspace' || id === 'source.logspace') return { valueType: 'float64', shape: [p.count as number], unit: declaredUnit };
  if (id === 'source.zeros') return { valueType: 'float64', shape: p.form === 'matrix' ? [p.rows as number, p.columns as number] : [p.length as number], unit: declaredUnit };
  return fail('SIGNAL_INFERENCE_FAILED', '신규 블럭의 출력 계약이 없습니다.');
}
