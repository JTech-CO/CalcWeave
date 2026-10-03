import { M8_BLOCK_IDS } from '../../block-library/src/m8';
import { ModelError, divideUnits, multiplyUnits, signalElementCount, sqrtUnit, squareUnit, validateSignal, type IRNode, type SignalDescriptor } from '../../model/src';

const supported: ReadonlySet<string> = new Set(M8_BLOCK_IDS);
const m8Error = (node: IRNode, code: string, message: string, portId = 'in'): never => { throw new ModelError([{ code, nodeId: node.id, portId, message }]); };
function m8Indices(node: IRNode, values: number[], limit: number, permutation = false): void {
  if (values.some(index => !Number.isSafeInteger(index) || index < 0 || index >= limit) || new Set(values).size !== values.length || (permutation && values.length !== limit)) m8Error(node, 'INVALID_INDEX', 'index는 입력 범위 안의 서로 다른 0-based 정수여야 하며 순열은 해당 축 전체를 포함해야 합니다.');
}
function m8Axis(node: IRNode, values: number[]): void {
  if (values.length < 2 || values.length > 32 || values.some((value, index) => !Number.isFinite(value) || (index > 0 && value <= values[index - 1]!))) m8Error(node, 'INVALID_LOOKUP', '조회 축은 2~32개의 유한한 strictly increasing 값이어야 합니다.');
}
/** Parameter shape limits are checked before a table is traversed or allocated by execution. */
export function validateM8Parameters(node: IRNode): void {
  const p = node.parameters;
  if (node.blockType === 'math.gain-matrix') { const value = validateSignal(p.K); if (value.valueType !== 'float64' || (value.shape.length === 2 && value.shape.some(axis => axis > 32))) m8Error(node, 'INVALID_PARAMETERS', 'K는 유한한 숫자 scalar·벡터 또는 각 축 32 이하 행렬이어야 합니다.'); }
  if (node.blockType === 'math.sum-inputs' && ((p.signs as number[]).length !== p.count || (p.signs as number[]).some(value => value !== 1 && value !== -1))) m8Error(node, 'INVALID_PARAMETERS', 'signs는 입력 수와 같은 길이의 +1/-1 벡터여야 합니다.');
  if (node.blockType === 'math.product-inputs' && ((p.operations as string).length !== p.count || !/^[*/]+$/.test(p.operations as string) || (p.mode === 'matrix' && (p.operations as string).includes('/')))) m8Error(node, 'INVALID_PARAMETERS', 'operations는 입력 수와 같은 길이의 */ 문자열이며 행렬 곱은 *만 허용합니다.');
  if (node.blockType === 'logic.combine' && p.operation === 'not' && p.count !== 1) m8Error(node, 'INVALID_PARAMETERS', 'not은 한 입력만 허용합니다.');
  if (node.blockType === 'route.demux-widths' && ((p.widths as number[]).some(value => !Number.isSafeInteger(value) || value < 1 || value > 1024) || (p.widths as number[]).reduce((a, b) => a + b, 0) > 1024)) m8Error(node, 'INVALID_PARAMETERS', '각 출력 폭은 양의 정수이며 합은 1,024 이하여야 합니다.');
  if (node.blockType === 'logic.truth-table') {
    const table = p.table;
    if (!Array.isArray(table) || table.length < 2 || table.length > 256 || table.some(value => typeof value !== 'boolean')) m8Error(node, 'INVALID_TRUTH_TABLE', '진리표는 2~256개의 boolean 벡터여야 합니다.');
  }
  if (node.blockType === 'verify.bounds' && p.source === 'static' && ['range', 'gap'].includes(p.kind as string) && (p.lower as number) > (p.upper as number)) m8Error(node, 'INVALID_PARAMETERS', 'lower는 upper 이하여야 합니다.');
  if (node.blockType === 'lookup.direct') {
    const dimensions = p.dimensions as number[];
    if (dimensions.some(value => !Number.isSafeInteger(value) || value < 1 || value > 32) || dimensions.reduce((a, b) => a * b, 1) > 1024 || dimensions.reduce((a, b) => a * b, 1) !== (p.table as number[]).length) m8Error(node, 'INVALID_LOOKUP', 'rank 1~10의 각 크기는 1~32이며 table 길이는 크기의 곱(1,024 이하)과 같아야 합니다.');
  }
  if (node.blockType === 'lookup.nd') {
    let count = 1;
    for (let axis = 1; axis <= (p.rank as number); axis++) { const values = p[`axis${axis}`] as number[]; m8Axis(node, values); count *= values.length; }
    if (count > 1024 || count !== (p.table as number[]).length) m8Error(node, 'INVALID_LOOKUP', 'nD 표는 활성 축 길이의 곱과 같고 1,024개 원소 이하여야 합니다.');
  }
}

export function inferM8Outputs(node: IRNode, input: (port: string) => SignalDescriptor, declaredUnit = '1'): Record<string, SignalDescriptor> | undefined {
  if (!supported.has(node.blockType)) return undefined;
  const fail = (code: string, message: string, port = 'in'): never => m8Error(node, code, message, port);
  const copy = (value: SignalDescriptor, shape = value.shape, unit = value.unit): SignalDescriptor => ({ valueType: value.valueType, shape: [...shape], unit });
  const scalar = (valueType: SignalDescriptor['valueType'] = 'float64', unit = '1'): SignalDescriptor => ({ valueType, shape: [], unit });
  const out = (descriptor: SignalDescriptor): Record<string, SignalDescriptor> => ({ out: descriptor });
  const numeric = (port = 'in'): SignalDescriptor => { const value = input(port); if (value.valueType !== 'float64') fail('TYPE_MISMATCH', 'float64 숫자 입력이 필요합니다.', port); return value; };
  const sameShape = (a: SignalDescriptor, b: SignalDescriptor): boolean => a.shape.length === b.shape.length && a.shape.every((length, axis) => length === b.shape[axis]);
  const unitless = (value: SignalDescriptor, port = 'in'): void => { if (value.unit !== '1') fail('UNIT_MISMATCH', '단위 없는 입력이 필요합니다.', port); };
  const numericScalar = (port: string, unit = true): SignalDescriptor => { const value = numeric(port); if (value.shape.length) fail('SHAPE_MISMATCH', 'scalar 입력이 필요합니다.', port); if (unit) unitless(value, port); return value; };
  const matrix = (square = false, numbers = true): SignalDescriptor => { const value = numbers ? numeric() : input('in'); if (value.shape.length !== 2 || value.shape.some(length => length > 32)) fail('MATRIX_SHAPE', '각 축 1~32의 2D 행렬이 필요합니다.'); if (square && value.shape[0] !== value.shape[1]) fail('MATRIX_SQUARE_REQUIRED', '정방 행렬이 필요합니다.'); return value; };
  const bound = (value: SignalDescriptor, port: string): void => { const other = numeric(port); if (value.unit !== other.unit) fail('UNIT_MISMATCH', '입력과 경계의 단위가 같아야 합니다.', port); if (other.shape.length && !sameShape(value, other)) fail('SHAPE_MISMATCH', '경계는 scalar 또는 입력과 같은 형상이어야 합니다.', port); };
  const broadcast = (a: SignalDescriptor, b: SignalDescriptor, port: string): number[] => { if (a.shape.length && b.shape.length && !sameShape(a, b)) fail('SHAPE_MISMATCH', '비scalar 입력의 형상은 같아야 합니다.', port); return [...(a.shape.length ? a.shape : b.shape)]; };
  const indexInput = (port: string): SignalDescriptor => { const value = numeric(port); unitless(value, port); if (value.shape.length > 1) fail('SHAPE_MISMATCH', 'index 입력은 scalar 또는 벡터여야 합니다.', port); return value; };
  const matrixProduct = (a: SignalDescriptor, b: SignalDescriptor, unit: string): SignalDescriptor => { if ([a, b].some(value => value.shape.length !== 0 && (value.shape.length !== 2 || value.shape.some(axis => axis > 32)))) fail('MATRIX_SHAPE', '행렬 곱은 scalar 또는 각 축 32 이하 2D 행렬이어야 합니다.'); if (!a.shape.length) return copy(b, b.shape, unit); if (!b.shape.length) return copy(a, a.shape, unit); if (a.shape[1] !== b.shape[0]) fail('MATRIX_SHAPE', '행렬 곱의 안쪽 축이 같아야 합니다.'); return copy(a, [a.shape[0]!, b.shape[1]!], unit); };
  const query = (rank: number): void => { const value = numeric(); unitless(value); if (rank === 1 ? value.shape.length !== 0 && !(value.shape.length === 1 && value.shape[0] === 1) : value.shape.length !== 1 || value.shape[0] !== rank) fail('SHAPE_MISMATCH', '조회 입력은 rank1 scalar 또는 활성 rank 길이의 벡터여야 합니다.'); };
  const id = node.blockType, p = node.parameters;
  switch (id) {
    case 'nonlinear.friction': case 'nonlinear.wrap-to-zero': case 'math.negate': case 'math.increment': return out(copy(numeric()));
    case 'math.signed-sqrt': { const value = numeric(); return out(copy(value, value.shape, sqrtUnit(value.unit))); }
    case 'math.reciprocal-sqrt': { const value = numeric(); return out(copy(value, value.shape, divideUnits('1', sqrtUnit(value.unit)))); }
    case 'math.sine-wave-function': { const value = numeric(); if (!['1', 's'].includes(value.unit)) fail('UNIT_MISMATCH', '입력 시간은 단위 없는 값 또는 초(s)여야 합니다.'); return out(copy(value, value.shape, declaredUnit)); }
    case 'nonlinear.dead-zone-dynamic': case 'nonlinear.saturation-dynamic': case 'logic.interval-dynamic': { const value = numeric(); bound(value, 'lower'); bound(value, 'upper'); return out(id === 'logic.interval-dynamic' ? { valueType: 'boolean', shape: [...value.shape], unit: '1' } : copy(value)); }
    case 'logic.compare-constant': { const value = numeric(); return out({ valueType: 'boolean', shape: [...value.shape], unit: '1' }); }
    case 'logic.truth-table': { const value = input('in'); if (value.valueType !== 'boolean') fail('TYPE_MISMATCH', '진리표에는 boolean 벡터가 필요합니다.'); if (value.shape.length !== 1 || value.shape[0]! > 8) fail('SHAPE_MISMATCH', '진리표 입력은 길이 1~8의 벡터여야 합니다.'); if ((p.table as boolean[]).length !== 2 ** value.shape[0]!) fail('INVALID_TRUTH_TABLE', '진리표 길이는 2^입력 폭과 같아야 합니다.'); return out(scalar('boolean')); }
    case 'matrix.assign': { const value = input('in'), replacement = input('value'), indices = p.indices as number[]; if (!value.shape.length) fail('SHAPE_MISMATCH', '대입 대상은 벡터 또는 행렬이어야 합니다.'); m8Indices(node, indices, signalElementCount(value)); if (value.valueType !== replacement.valueType) fail('TYPE_MISMATCH', '대입 값과 대상의 타입이 같아야 합니다.', 'value'); if (value.unit !== replacement.unit) fail('UNIT_MISMATCH', '대입 값과 대상의 단위가 같아야 합니다.', 'value'); if (replacement.shape.length && !(replacement.shape.length === 1 && replacement.shape[0] === indices.length)) fail('SHAPE_MISMATCH', '대입 값은 scalar 또는 index 수와 같은 길이의 벡터여야 합니다.', 'value'); return out(copy(value)); }
    case 'matrix.find-nonzero': { const value = input('in'); const positions = { valueType: 'float64', shape: [signalElementCount(value)], unit: '1' } as SignalDescriptor; return { indices: copy(positions), rows: copy(positions), columns: copy(positions), count: scalar() }; }
    case 'matrix.permute-dimensions': { const value = input('in'); if (!value.shape.length) fail('SHAPE_MISMATCH', '축 순열에는 벡터 또는 행렬이 필요합니다.'); const order = p.order as number[]; m8Indices(node, order, value.shape.length, true); return out(copy(value, order.map(axis => value.shape[axis]!))); }
    case 'matrix.squeeze': return out(copy(input('in')));
    case 'matrix.expand-scalar': return out({ valueType: 'float64', shape: p.form === 'matrix' ? [p.rows as number, p.columns as number] : [p.length as number], unit: declaredUnit });
    case 'matrix.is-symmetric': matrix(true); return out(scalar('boolean'));
    case 'matrix.is-triangular': matrix(); return out(scalar('boolean'));
    case 'matrix.square': { const value = numeric(); if (!value.shape.length || (value.shape.length === 2 && value.shape.some(axis => axis > 32))) fail('MATRIX_SHAPE', '벡터 또는 각 축 32 이하 행렬이 필요합니다.'); const columns = value.shape.length === 1 ? 1 : value.shape[1]!; return out(copy(value, [columns, columns], squareUnit(value.unit))); }
    case 'matrix.permute-rows-cols': { const value = matrix(false, false); m8Indices(node, p.rows as number[], value.shape[0]!, true); m8Indices(node, p.columns as number[], value.shape[1]!, true); return out(copy(value)); }
    case 'route.manual-switch': case 'route.multiport-switch': { const first = input(id === 'route.manual-switch' ? 'a' : 'in1'); const ports = id === 'route.manual-switch' ? ['b'] : Array.from({ length: (p.count as number) - 1 }, (_, index) => `in${index + 2}`); for (const port of ports) { const value = input(port); if (first.valueType !== value.valueType) fail('TYPE_MISMATCH', '모든 데이터 입력의 타입이 같아야 합니다.', port); if (!sameShape(first, value)) fail('SHAPE_MISMATCH', '모든 데이터 입력의 형상이 같아야 합니다.', port); if (first.unit !== value.unit) fail('UNIT_MISMATCH', '모든 데이터 입력의 단위가 같아야 합니다.', port); } if (id === 'route.multiport-switch') numericScalar('index'); return out(copy(first)); }
    case 'verify.assert': { if (input('in').valueType !== 'boolean') fail('TYPE_MISMATCH', 'Assertion에는 boolean 입력이 필요합니다.'); return out(scalar('boolean')); }
    case 'verify.bounds': { const value = numeric(); if (p.source === 'dynamic') { if (p.kind !== 'upper') bound(value, 'lower'); if (p.kind !== 'lower') bound(value, 'upper'); } return out({ valueType: 'boolean', shape: [...value.shape], unit: '1' }); }
    case 'lookup.direct': query((p.dimensions as number[]).length); return out(scalar('float64', declaredUnit));
    case 'lookup.nd': query(p.rank as number); return out(scalar('float64', declaredUnit));
    case 'lookup.interpolate-prelookup': numericScalar('index'); numericScalar('fraction'); return out(scalar('float64', declaredUnit));
    case 'lookup.dynamic': { const value = numericScalar('in', false), axes = numeric('breakpoints'), table = numeric('table'); if (axes.shape.length !== 1 || table.shape.length !== 1 || axes.shape[0]! < 2 || axes.shape[0] !== table.shape[0]) fail('SHAPE_MISMATCH', '동적 축·표는 같은 길이 2~1,024의 벡터여야 합니다.'); if (value.unit !== axes.unit) fail('UNIT_MISMATCH', 'query와 breakpoints 단위가 같아야 합니다.', 'breakpoints'); return out(scalar('float64', table.unit)); }
    case 'math.gain-matrix': {
      const value = numeric(), k = validateSignal(p.K);
      if (p.mode === 'elementwise') return out(copy(value, broadcast(value, k, 'in')));
      if (!k.shape.length) return out(copy(value));
      if (k.shape.length !== 2 || k.shape.some(axis => axis > 32)) fail('MATRIX_SHAPE', 'left/right의 K는 scalar 또는 각 축 32 이하 행렬이어야 합니다.');
      if (value.shape.length === 1) { const axis = p.mode === 'left' ? 1 : 0; if (value.shape[0] !== k.shape[axis]) fail('MATRIX_SHAPE', 'K와 벡터의 곱 축이 같아야 합니다.'); return out(copy(value, [k.shape[1 - axis]!])); }
      return out(p.mode === 'left' ? matrixProduct(k, value, value.unit) : matrixProduct(value, k, value.unit));
    }
    case 'math.sum-inputs': case 'math.product-inputs': case 'logic.combine': {
      let result = id === 'logic.combine' ? copy(input('in1')) : copy(numeric('in1'));
      let productUnit = '1';
      for (let index = 0; index < (p.count as number); index++) {
        const port = `in${index + 1}`, value = id === 'logic.combine' ? input(port) : numeric(port);
        if (id === 'math.sum-inputs' && result.unit !== value.unit) fail('UNIT_MISMATCH', '합 입력의 단위가 같아야 합니다.', port);
        if (id === 'logic.combine' && value.unit !== '1') fail('UNIT_MISMATCH', '논리 truth 입력은 단위 없는 값이어야 합니다.', port);
        if (id === 'math.product-inputs') productUnit = (p.operations as string)[index] === '/' ? divideUnits(productUnit, value.unit) : multiplyUnits(productUnit, value.unit);
        if (id === 'math.product-inputs' && p.mode === 'matrix') { if (index === 0) result = matrixProduct(scalar(), value, productUnit); else result = matrixProduct(result, value, productUnit); }
        else result = copy(result, broadcast(result, value, port), id === 'math.product-inputs' ? productUnit : result.unit);
      }
      return out(id === 'logic.combine' ? { valueType: 'boolean', shape: [...result.shape], unit: '1' } : result);
    }
    case 'route.switch-threshold': { const a = input('a'), b = input('b'), condition = input('condition'); if (a.valueType !== b.valueType) fail('TYPE_MISMATCH', 'a/b 자료형이 같아야 합니다.', 'b'); if (a.unit !== b.unit) fail('UNIT_MISMATCH', 'a/b 단위가 같아야 합니다.', 'b'); const data = copy(a, broadcast(a, b, 'b')); return out(copy(data, broadcast(data, condition, 'condition'))); }
    case 'vector.select-dynamic': { const value = input('in'); if (value.shape.length !== 1) fail('SHAPE_MISMATCH', '1D 벡터가 필요합니다.'); const indices = indexInput('indices'); return out(copy(value, indices.shape)); }
    case 'matrix.select-dynamic': { const value = matrix(false, false), rows = indexInput('rows'), columns = indexInput('columns'); if (signalElementCount(rows) > 32 || signalElementCount(columns) > 32) fail('MATRIX_SHAPE', '각 index 목록은 32개 이하여야 합니다.'); return out(copy(value, [signalElementCount(rows), signalElementCount(columns)])); }
    case 'route.mux-inputs': { const first = input('in1'); let length = 0; for (let index = 0; index < (p.count as number); index++) { const port = `in${index + 1}`, value = input(port); if (value.valueType !== first.valueType) fail('TYPE_MISMATCH', '묶을 입력의 타입이 같아야 합니다.', port); if (value.unit !== first.unit) fail('UNIT_MISMATCH', '묶을 입력의 단위가 같아야 합니다.', port); if (value.shape.length > 1) fail('SHAPE_MISMATCH', 'Mux 입력은 scalar 또는 벡터여야 합니다.', port); length += signalElementCount(value); } return out(copy(first, [length])); }
    case 'route.demux-widths': { const value = input('in'), widths = p.widths as number[]; if (value.shape.length !== 1 || widths.reduce((a, b) => a + b, 0) !== value.shape[0]) fail('SHAPE_MISMATCH', '출력 폭 합은 입력 벡터 길이와 같아야 합니다.'); return Object.fromEntries(widths.map((width, index) => [`out${index + 1}`, copy(value, width === 1 ? [] : [width])])); }
    case 'math.concatenate-inputs': { const first = input('in1'), rank = first.shape.length > 1 ? 2 : 1, axis = p.axis as number; if (rank === 1 && axis !== 0) fail('SHAPE_MISMATCH', '벡터 결합은 축0만 허용합니다.'); const shape = rank === 1 ? [0] : [...first.shape]; if (rank === 2) shape[axis] = 0; for (let index = 0; index < (p.count as number); index++) { const port = `in${index + 1}`, value = input(port); if (first.valueType !== value.valueType) fail('TYPE_MISMATCH', '결합 입력의 타입이 같아야 합니다.', port); if (first.unit !== value.unit) fail('UNIT_MISMATCH', '결합 입력의 단위가 같아야 합니다.', port); if (rank === 1) { if (value.shape.length > 1) fail('SHAPE_MISMATCH', '벡터와 행렬은 함께 결합할 수 없습니다.', port); shape[0]! += signalElementCount(value); } else { if (value.shape.length !== 2 || value.shape[1 - axis] !== first.shape[1 - axis]) fail('SHAPE_MISMATCH', '결합 축 외의 행렬 크기가 같아야 합니다.', port); shape[axis]! += value.shape[axis]!; } } if (rank === 2 && shape.some(size => size > 32)) fail('MATRIX_SHAPE', '결합 행렬 각 축은 32 이하여야 합니다.'); return out(copy(first, shape)); }
    case 'matrix.reshape-column-major': { const value = input('in'), shape = p.form === 'matrix' ? [p.rows as number, p.columns as number] : [p.length as number]; if (shape.reduce((a, b) => a * b, 1) !== signalElementCount(value)) fail('SHAPE_MISMATCH', 'reshape 전후 원소 수가 같아야 합니다.'); return out(copy(value, shape)); }
    case 'reduce.axis': { const boolean = p.operation === 'all' || p.operation === 'any', value = boolean ? input('in') : numeric(); if (boolean && value.valueType !== 'boolean') fail('TYPE_MISMATCH', 'all/any 집계에는 boolean 신호가 필요합니다.'); if (p.operation === 'product') unitless(value); if (p.axis !== 'all' && value.shape.length !== 2) fail('SHAPE_MISMATCH', 'rows/columns 집계에는 2D 행렬이 필요합니다.'); return out(copy(value, p.axis === 'all' ? [] : [value.shape[p.axis === 'rows' ? 1 : 0]!])); }
    default: return fail('SIGNAL_INFERENCE_FAILED', 'M8 블럭의 출력 계약이 없습니다.');
  }
}

/** Value jumps require solver events. Continuous sinks may still sample these operations. */
export function m8HasUnregisteredJump(node: IRNode): boolean {
  if (node.blockType === 'nonlinear.friction') return node.parameters.offset !== 0;
  if (node.blockType === 'nonlinear.wrap-to-zero') return node.parameters.threshold !== 0;
  if (['logic.compare-constant', 'logic.interval-dynamic', 'logic.truth-table', 'matrix.find-nonzero', 'matrix.is-symmetric', 'matrix.is-triangular', 'verify.assert', 'verify.bounds', 'lookup.direct'].includes(node.blockType)) return true;
  return ['lookup.interpolate-prelookup', 'lookup.dynamic', 'lookup.nd'].includes(node.blockType) && node.parameters.interpolation !== 'linear';
}

/** A fixed selector is continuous in its data; only a changing selection control introduces a jump. */
export function m8JumpControlPorts(node: IRNode): string[] {
  if (node.blockType === 'route.multiport-switch') return ['index'];
  if (node.blockType === 'route.switch-threshold') return ['condition'];
  if (node.blockType === 'vector.select-dynamic') return ['indices'];
  if (node.blockType === 'matrix.select-dynamic') return ['rows', 'columns'];
  if (node.blockType === 'lookup.interpolate-prelookup' && node.parameters.interpolation === 'linear') return ['index'];
  return [];
}
