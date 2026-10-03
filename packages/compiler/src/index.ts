import { getBlockDefinition, getBlockPorts, getDirectFeedthroughPorts, isDirectFeedthrough, type BlockDefinition } from '../../block-library/src';
import { parseExpression } from '../../expression/src';
import {
  canonicalSemantic, continuousStateElementCount, conversionCoefficients, divideUnits, discreteMemoryElementCount, isSafeIdentifier, MODEL_LIMITS, ModelError, multiplyUnits, normalizeSolverSettings, parseModel, reciprocalUnit, SIGNAL_LIMITS, signalElementCount, sqrtUnit, squareUnit, validateSignal,
  type CalcModel, type CompiledModel, type Diagnostic, type IRNode, type SignalDescriptor,
} from '../../model/src';
import { initialDiscreteDescriptor, validateDiscreteParameters } from './discrete';
import { inferContinuousDomains, initialContinuousDescriptor, validateContinuousParameters } from './continuous';
import { datasetSeries } from '../../data/src';
import { flattenHierarchy } from './hierarchy';
import { validateAdvancedParameters } from './advanced';
import { inferExpansionSignal } from './expansion';
import { inferTimeSourceDescriptor, validateTimeSourceParameters } from './time-sources';
import { inferM8Outputs, validateM8Parameters } from './m8';
import { initialM9Outputs, inferM9Outputs, validateM9Parameters, validateM9StateInputs } from './m9';

const compareId = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

function executionDiagnostics(model: CalcModel, outputCount: number): Diagnostic[] {
  const { mode, startTime, stopTime, step } = model.execution;
  const diagnostics: Diagnostic[] = [];
  if (stopTime < startTime) diagnostics.push({ code: 'INVALID_TIME_RANGE', message: '종료 시간은 시작 시간보다 작을 수 없습니다.' });
  if (mode === 'static') {
    if (outputCount + 1 > MODEL_LIMITS.maxRecordedValues) diagnostics.push({ code: 'RESULT_BUDGET_EXCEEDED', message: '결과 기록은 시간축을 포함해 1,000,000개 원소 이하여야 합니다.' });
    return diagnostics;
  }
  if (startTime + step <= startTime || stopTime - step >= stopTime) {
    diagnostics.push({ code: 'UNRESOLVABLE_TIME_STEP', message: '현재 시간에서 표현할 수 없는 시간 간격입니다. 시간 범위를 줄이거나 간격을 늘려 주세요.' });
  }
  const intervals = (stopTime - startTime) / step;
  const rounded = Math.round(intervals);
  if (!Number.isFinite(intervals) || intervals > MODEL_LIMITS.maxSteps) {
    diagnostics.push({ code: 'STEP_BUDGET_EXCEEDED', message: '실행 구간은 10,000개 이하여야 합니다. 종료 시간을 줄이거나 간격을 늘려 주세요.' });
  } else if (Math.abs(intervals - rounded) > 1e-9 * Math.max(1, Math.abs(intervals))) {
    diagnostics.push({ code: 'INVALID_TIME_GRID', message: '종료 시간은 시작 시간에서 시간 간격의 정수 배수에 있어야 합니다.' });
  }
  if ((rounded + 1) * (outputCount + 1) > MODEL_LIMITS.maxRecordedValues) {
    diagnostics.push({ code: 'RESULT_BUDGET_EXCEEDED', message: '결과 기록은 1,000,000개 숫자 이하여야 합니다. 결과 블럭 수나 시간 구간을 줄여 주세요.' });
  }
  return diagnostics;
}

function parseParameters(definition: BlockDefinition, values: Record<string, unknown>, nodeId: string): Record<string, unknown> {
  const fail = (): never => { throw new ModelError([{ code: 'INVALID_PARAMETERS', nodeId, message: `${nodeId}의 파라미터 이름·타입·허용 옵션과 상한을 확인해 주세요.` }]); };
  if (Object.keys(values).some((key) => !Object.hasOwn(definition.parameters, key))) fail();
  const parsed: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(definition.parameters)) {
    const value = Object.hasOwn(values, key) ? values[key] : structuredClone(descriptor.default);
    switch (descriptor.kind) {
      case 'number': case 'integer':
        if (typeof value !== 'number' || !Number.isFinite(value)
          || (descriptor.kind === 'integer' && !Number.isSafeInteger(value))
          || (descriptor.min !== undefined && value < descriptor.min)
          || (descriptor.max !== undefined && value > descriptor.max)) fail();
        break;
      case 'enum': if (typeof value !== 'string' || !descriptor.options?.includes(value)) fail(); break;
      case 'expression': if (typeof value !== 'string' || value.length === 0 || value.length > (descriptor.maxLength ?? 512)) fail(); break;
      case 'text': if (typeof value !== 'string' || value.length > (descriptor.maxLength ?? 64)) fail(); break;
      case 'value': try { validateSignal(value); } catch { fail(); } break;
      case 'numeric-vector':
        if (!Array.isArray(value) || value.length < (descriptor.minLength ?? 0) || value.length > (descriptor.maxLength ?? 16) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) fail();
        break;
    }
    parsed[key] = value;
  }
  if (definition.id === 'nonlinear.saturation' && (parsed.lower as number) > (parsed.upper as number)) fail();
  return parsed;
}

/** Find an actual cyclic path, excluding downstream nodes left over by Kahn's algorithm. */
function findCycle(adjacency: Map<string, Set<string>>): string[] {
  const color = new Map<string, 'active' | 'done'>();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    color.set(id, 'active');
    path.push(id);
    for (const target of [...adjacency.get(id)!].sort(compareId)) {
      if (color.get(target) === 'active') return path.slice(path.indexOf(target)).concat(target);
      if (!color.has(target)) {
        const cycle = visit(target);
        if (cycle) return cycle;
      }
    }
    path.pop();
    color.set(id, 'done');
    return undefined;
  };
  for (const id of [...adjacency.keys()].sort(compareId)) {
    if (!color.has(id)) {
      const cycle = visit(id);
      if (cycle) return cycle;
    }
  }
  return [];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function inferSignals(model: CalcModel, ordered: IRNode[], byId: Map<string, IRNode>, definitions: Map<string, BlockDefinition>): void {
  const originals = new Map(model.nodes.map((node) => [node.id, node]));
  const scalarState = (): SignalDescriptor => ({ valueType: 'float64', shape: [], unit: '1' });
  const sameShape = (a: SignalDescriptor, b: SignalDescriptor): boolean => a.shape.length === b.shape.length && a.shape.every((length, index) => length === b.shape[index]);
  const clone = (descriptor: SignalDescriptor): SignalDescriptor => ({ ...descriptor, shape: [...descriptor.shape] });
  for (const node of ordered) {
    const m9Outputs = initialM9Outputs(node, originals.get(node.id)!.unit ?? '1');
    if (m9Outputs) { Object.assign(node.outputs, m9Outputs); continue; }
    const descriptor = initialDiscreteDescriptor(node, originals.get(node.id)!.unit ?? '1');
    if (descriptor) node.outputs.out = descriptor;
    else {
      const continuous = initialContinuousDescriptor(node);
      if (continuous) node.outputs.out = continuous;
      if (node.blockType === 'continuous.second-order-integrator') node.outputs.velocity = scalarState();
    }
  }
  for (const node of ordered) {
    const fail = (code: string, message: string, portId?: string): never => { throw new ModelError([{ code, message, nodeId: node.id, ...(portId ? { portId } : {}) }]); };
    const input = (port: string): SignalDescriptor => {
      const endpoint = node.inputs[port];
      const descriptor = endpoint && byId.get(endpoint.nodeId)?.outputs[endpoint.portId];
      if (!descriptor) fail('SIGNAL_INFERENCE_FAILED', `${node.id}의 입력 ${port} 형상을 추론할 수 없습니다.`, port);
      return descriptor!;
    };
    const numeric = (port: string): SignalDescriptor => {
      const descriptor = input(port);
      if (descriptor.valueType !== 'float64') fail('TYPE_MISMATCH', `${node.id}의 ${port}에는 float64 신호가 필요합니다.`, port);
      return descriptor;
    };
    const matrix = (port: string, square = false): SignalDescriptor => {
      const descriptor = numeric(port);
      if (descriptor.shape.length !== 2 || descriptor.shape.some(length => length < 1 || length > 32)) fail('MATRIX_SHAPE', '행렬 연산에는 각 축 1~32의 실수 2D 신호를 연결해 주세요.', port);
      if (square && descriptor.shape[0] !== descriptor.shape[1]) fail('MATRIX_SQUARE_REQUIRED', '이 연산에는 정방 행렬이 필요합니다.', port);
      return descriptor;
    };
    const dimensionless = (descriptor: SignalDescriptor, port: string): void => {
      if (descriptor.unit !== '1') fail('UNIT_MISMATCH', `${node.id}의 ${port}에는 단위 없는 신호가 필요합니다. 단위 변환은 자동 적용하지 않습니다.`, port);
    };
    const sameUnit = (a: SignalDescriptor, b: SignalDescriptor, port = 'b'): void => {
      if (a.unit !== b.unit) fail('UNIT_MISMATCH', `${node.id}의 입력 단위 ${a.unit}와 ${b.unit}가 다릅니다.`, port);
    };
    const broadcast = (a: SignalDescriptor, b: SignalDescriptor, port = 'b'): number[] => {
      if (a.shape.length === 0) return [...b.shape];
      if (b.shape.length === 0 || sameShape(a, b)) return [...a.shape];
      return fail('SHAPE_MISMATCH', `${node.id}의 두 비scalar 입력 형상이 다릅니다. 같은 형상 또는 scalar만 연결해 주세요.`, port);
    };
    let output: SignalDescriptor | undefined;
    switch (node.blockType) {
      case 'source.constant': case 'io.input':
        output = validateSignal(node.parameters.value);
        output.unit = originals.get(node.id)!.unit ?? '1';
        if (output.valueType === 'boolean' && output.unit !== '1') fail('UNIT_MISMATCH', 'boolean 신호에는 단위 1만 사용할 수 있습니다.', 'out');
        break;
      case 'source.step': case 'source.ramp': case 'source.sine-wave': case 'source.pulse': case 'source.random': case 'source.repeating-sequence':
        output = { valueType: 'float64', shape: [], unit: originals.get(node.id)!.unit ?? '1' }; break;
      case 'source.clock': case 'source.digital-clock': {
        const declared = originals.get(node.id)!.unit;
        // Explicit 1 is a one-second normalized time coordinate in the M3 contract.
        output = { valueType: 'float64', shape: [], unit: model.execution.mode === 'continuous' && declared === '1' ? '1' : 's' };
        break;
      }
      case 'source.dataset': {
        output = { valueType: node.parameters.dataKind === 'boolean' ? 'boolean' : 'float64', shape: [], unit: String(node.parameters.dataUnit) }; break;
      }
      case 'unit.convert': {
        output = clone(numeric('in'));
        if (output.unit !== node.parameters.from) fail('UNIT_MISMATCH', `변환 입력은 ${String(node.parameters.from)} 단위여야 합니다.`, 'in');
        const coefficients = conversionCoefficients(String(node.parameters.from), String(node.parameters.to));
        node.parameters.unitScale = coefficients.scale; node.parameters.unitOffset = coefficients.offset;
        output.unit = String(node.parameters.to); break;
      }
      case 'route.bus-create': {
        const a = input('a'), b = input('b');
        if (a.valueType !== b.valueType) fail('TYPE_MISMATCH', '이름으로 묶을 두 입력의 자료형이 다릅니다.', 'b');
        if (a.shape.length || b.shape.length) fail('SHAPE_MISMATCH', 'M4 Bus에는 scalar 필드 두 개를 연결해 주세요.');
        sameUnit(a, b);
        const first = String(node.parameters.first), second = String(node.parameters.second);
        if (!isSafeIdentifier(first) || !isSafeIdentifier(second) || first === second) fail('INVALID_BUS_FIELDS', 'Bus 필드에는 서로 다른 안전한 ID를 사용해 주세요.');
        output = { valueType: a.valueType, unit: a.unit, shape: [2], fields: [first, second] }; break;
      }
      case 'route.bus-select': {
        const descriptor = input('in'), index = descriptor.fields?.indexOf(String(node.parameters.field)) ?? -1;
        if (descriptor.shape.length !== 1 || descriptor.shape[0] !== 2 || !descriptor.fields || index < 0) fail('UNKNOWN_BUS_FIELD', '이름으로 묶은 신호에 요청한 필드가 없습니다.', 'in');
        node.parameters.fieldIndex = index;
        output = { valueType: descriptor.valueType, unit: descriptor.unit, shape: [] }; break;
      }
      case 'annotation.note': case 'annotation.model-info': break;
      case 'discrete.unit-delay': case 'discrete.delay': case 'discrete.integrator': case 'discrete.difference':
      case 'discrete.derivative': case 'discrete.fir': case 'discrete.transfer-function': case 'discrete.state-space':
      case 'logic.edge-detect': case 'time.rate-transition': output = node.outputs.out!; break;
      case 'continuous.integrator': case 'continuous.second-order-integrator': case 'continuous.state-space':
      case 'continuous.transfer-function': case 'continuous.zero-pole': case 'continuous.pid': case 'continuous.derivative':
      case 'time.memory': case 'time.zero-order-hold': case 'time.first-order-hold': case 'time.transport-delay':
      case 'logic.hit-crossing': case 'nonlinear.relay': output = node.outputs.out!; break;
      case 'math.gain': case 'math.abs': case 'math.round': case 'nonlinear.saturation': output = clone(numeric('in')); break;
      case 'math.function':
        output = clone(numeric('in'));
        if (output.unit !== '1' && ['square', 'reciprocal'].includes(String(node.parameters.operation))) node.parameters.unitAlgebra = true;
        if (node.parameters.operation === 'square') output.unit = squareUnit(output.unit);
        else if (node.parameters.operation === 'reciprocal') output.unit = reciprocalUnit(output.unit);
        else dimensionless(output, 'in');
        break;
      case 'math.sqrt': output = clone(numeric('in')); if (output.unit !== '1') node.parameters.unitAlgebra = true; output.unit = sqrtUnit(output.unit); break;
      case 'math.trigonometric': case 'math.expression':
        output = clone(numeric('in'));
        dimensionless(output, 'in');
        break;
      case 'math.sum': case 'math.multiply': case 'logic.compare': {
        const a = numeric('a'); const b = numeric('b');
        const shape = broadcast(a, b);
        let unit = a.unit;
        if (node.blockType === 'math.multiply') {
          if (a.unit !== '1' && b.unit !== '1' && (node.parameters.operation !== 'divide' || a.unit !== b.unit)) node.parameters.unitAlgebra = true;
          unit = node.parameters.operation === 'divide' ? divideUnits(a.unit, b.unit) : multiplyUnits(a.unit, b.unit);
        } else sameUnit(a, b);
        output = { valueType: node.blockType === 'logic.compare' ? 'boolean' : 'float64', shape, unit: node.blockType === 'logic.compare' ? '1' : unit };
        break;
      }
      case 'math.minmax': {
        if (node.parameters.strategy === 'reduce') { output = { ...numeric('in'), shape: [] }; break; }
        const a = numeric('a'); const b = numeric('b'); sameUnit(a, b);
        output = { valueType: 'float64', shape: broadcast(a, b), unit: a.unit };
        break;
      }
      case 'logic.boolean': {
        const a = input('a');
        if (a.valueType !== 'boolean') fail('TYPE_MISMATCH', '논리 연산 입력은 boolean이어야 합니다.', 'a');
        dimensionless(a, 'a');
        output = { valueType: 'boolean', shape: [...a.shape], unit: '1' };
        if (node.parameters.operation !== 'not') {
          const b = input('b');
          if (b.valueType !== 'boolean') fail('TYPE_MISMATCH', '논리 연산 입력은 boolean이어야 합니다.', 'b');
          dimensionless(b, 'b'); output.shape = broadcast(a, b);
        }
        break;
      }
      case 'route.switch': {
        const condition = input('condition');
        if (condition.valueType !== 'boolean') fail('TYPE_MISMATCH', '선택 조건에는 boolean scalar가 필요합니다.', 'condition');
        if (condition.shape.length !== 0) fail('SHAPE_MISMATCH', '선택 조건에는 boolean scalar가 필요합니다.', 'condition');
        dimensionless(condition, 'condition');
        const a = input('a'); const b = input('b');
        if (a.valueType !== b.valueType) fail('TYPE_MISMATCH', '선택할 두 입력의 자료형이 다릅니다.', 'b');
        if (!sameShape(a, b)) fail('SHAPE_MISMATCH', '선택할 두 입력은 정확히 같은 형상이어야 합니다.', 'b');
        sameUnit(a, b); output = clone(a); break;
      }
      case 'route.mux': case 'math.concatenate': {
        const a = input('a'); const b = input('b');
        if (a.valueType !== b.valueType) fail('TYPE_MISMATCH', '벡터로 연결할 두 입력의 자료형이 다릅니다.', 'b');
        if (a.shape.length > 1) fail('SHAPE_MISMATCH', '벡터 연결에는 scalar 또는 vector만 사용할 수 있습니다.', 'a');
        if (b.shape.length > 1) fail('SHAPE_MISMATCH', '벡터 연결에는 scalar 또는 vector만 사용할 수 있습니다.', 'b');
        sameUnit(a, b); output = { valueType: a.valueType, shape: [signalElementCount(a) + signalElementCount(b)], unit: a.unit }; break;
      }
      case 'route.demux': {
        const descriptor = input('in');
        if (descriptor.shape.length !== 1 || descriptor.shape[0] !== node.parameters.count) fail('SHAPE_MISMATCH', 'Demux 입력은 출력 개수와 같은 길이의 vector여야 합니다.', 'in');
        for (const port of getBlockPorts({ blockType: node.blockType, parameters: node.parameters }).outputs) node.outputs[port] = { ...descriptor, shape: [] };
        break;
      }
      case 'matrix.reshape': {
        const descriptor = input('in'); const count = signalElementCount(descriptor);
        const rows = node.parameters.rows as number; const columns = node.parameters.columns as number;
        if (node.parameters.form === 'matrix' && rows * columns !== count) fail('SHAPE_MISMATCH', `Reshape의 ${rows}×${columns} 형상과 입력 원소 ${count}개가 일치하지 않습니다.`, 'in');
        output = { ...descriptor, shape: node.parameters.form === 'matrix' ? [rows, columns] : [count] }; break;
      }
      case 'math.matrix-multiply': {
        const a = matrix('a'), b = matrix('b');
        if (a.shape[1] !== b.shape[0]) fail('MATRIX_INNER_DIMENSION', 'A의 열 수와 B의 행 수가 같아야 합니다.', 'b');
        output = { valueType: 'float64', shape: [a.shape[0]!, b.shape[1]!], unit: multiplyUnits(a.unit, b.unit) }; break;
      }
      case 'matrix.transpose': {
        const a = matrix('in'); output = { valueType: 'float64', shape: [a.shape[1]!, a.shape[0]!], unit: a.unit }; break;
      }
      case 'matrix.determinant': case 'matrix.inverse': case 'matrix.cholesky': case 'matrix.lu': {
        const a = matrix('in', true); dimensionless(a, 'in');
        if (node.blockType === 'matrix.lu') {
          for (const port of ['lower', 'upper', 'permutation']) node.outputs[port] = { valueType: 'float64', shape: [...a.shape], unit: '1' };
        } else output = { valueType: 'float64', shape: node.blockType === 'matrix.determinant' ? [] : [...a.shape], unit: '1' };
        break;
      }
      case 'matrix.solve': {
        const a = matrix('a', true), b = matrix('b'); dimensionless(a, 'a');
        if (a.shape[0] !== b.shape[0]) fail('MATRIX_RHS_DIMENSION', 'B의 행 수는 A의 크기와 같아야 합니다.', 'b');
        output = { valueType: 'float64', shape: [...b.shape], unit: b.unit }; break;
      }
      case 'lookup.2d': case 'lookup.prelookup': {
        for (const port of node.blockType === 'lookup.2d' ? ['row', 'column'] : ['in']) {
          const descriptor = numeric(port); dimensionless(descriptor, port);
          if (descriptor.shape.length) fail('SHAPE_MISMATCH', '이 Lookup 입력에는 scalar 신호를 연결해 주세요.', port);
        }
        if (node.blockType === 'lookup.2d') output = { ...scalarState(), unit: originals.get(node.id)!.unit ?? '1' };
        else { node.outputs.index = scalarState(); node.outputs.fraction = scalarState(); }
        break;
      }
      case 'fixed.quantize': {
        output = clone(numeric('in'));
        node.outputs.stored = { valueType: 'float64', shape: [...output.shape], unit: '1' }; break;
      }
      case 'lookup.interpolated': {
        output = clone(numeric('in')); dimensionless(output, 'in');
        output.unit = originals.get(node.id)!.unit ?? '1'; break;
      }
      case 'logic.bitwise': {
        const a = numeric('a'); dimensionless(a, 'a');
        if (a.shape.length !== 0) fail('SHAPE_MISMATCH', '비트 연산에는 unsigned integer scalar가 필요합니다.', 'a');
        if (!['not', 'shift-left', 'shift-right'].includes(node.parameters.operation as string)) {
          const b = numeric('b'); dimensionless(b, 'b');
          if (b.shape.length !== 0) fail('SHAPE_MISMATCH', '비트 연산에는 unsigned integer scalar가 필요합니다.', 'b');
        }
        output = scalarState(); break;
      }
      case 'sink.display': case 'io.output': case 'io.terminator': case 'sink.scope': output = clone(input('in')); break;
      default: {
        const declaredUnit = originals.get(node.id)!.unit ?? '1';
        const m8Outputs = inferM8Outputs(node, input, declaredUnit) ?? inferM9Outputs(node, input, declaredUnit);
        if (m8Outputs) Object.assign(node.outputs, m8Outputs);
        else output = inferExpansionSignal(node, input, declaredUnit) ?? inferTimeSourceDescriptor(node, declaredUnit);
        break;
      }
    }
    if (output) node.outputs.out = output;
    const declaredUnit = originals.get(node.id)!.unit;
    for (const [port, descriptor] of Object.entries(node.outputs)) {
      if (signalElementCount(descriptor) > SIGNAL_LIMITS.maxElements || descriptor.shape.some((length) => length > SIGNAL_LIMITS.maxAxis)) fail('SIGNAL_SIZE_EXCEEDED', '한 신호는 1,024개 원소 이하여야 합니다.', port);
      if (declaredUnit !== undefined && !(node.blockType === 'fixed.quantize' && port === 'stored') && declaredUnit !== descriptor.unit) fail('UNIT_ANNOTATION_MISMATCH', `지정한 단위 ${declaredUnit}가 추론 단위 ${descriptor.unit}와 다릅니다.`, port);
    }
  }
  for (const node of ordered) {
    if (validateM9StateInputs(node, port => { const endpoint = node.inputs[port]; const descriptor = endpoint && byId.get(endpoint.nodeId)?.outputs[endpoint.portId]; if (!descriptor) throw new ModelError([{ code: 'SIGNAL_INFERENCE_FAILED', nodeId: node.id, portId: port, message: 'M9 입력의형상을추론할수없습니다.' }]); return descriptor; })) continue;
    if (definitions.get(node.id)!.state === 'none' || node.blockType === 'source.random') continue;
    const endpoint = node.inputs.in!;
    const input = byId.get(endpoint.nodeId)!.outputs[endpoint.portId]!;
    const fail = (code: string, message: string, portId = 'in'): never => { throw new ModelError([{ code, nodeId: node.id, portId, message }]); };
    if (node.blockType.startsWith('continuous.') || ['time.memory', 'time.zero-order-hold', 'time.first-order-hold', 'time.transport-delay', 'logic.hit-crossing', 'nonlinear.relay'].includes(node.blockType)) {
      if (input.valueType !== 'float64') fail('TYPE_MISMATCH', '연속 상태·사건 입력은 단위 없는 float64 scalar여야 합니다.');
      if (input.shape.length !== 0) fail('SHAPE_MISMATCH', '연속 상태·사건 입력은 단위 없는 float64 scalar여야 합니다.');
      if (input.unit !== '1') fail('UNIT_MISMATCH', '연속 상태·사건 입력은 단위 없는 float64 scalar여야 합니다.');
    } else {
      const output = node.outputs.out!;
      if (input.valueType !== output.valueType) fail('TYPE_MISMATCH', '상태 입력의 자료형은 초기값과 같아야 합니다.');
      if (!sameShape(input, output)) fail('SHAPE_MISMATCH', '상태 입력의 형상은 초기값과 정확히 같아야 합니다. scalar broadcast는 적용하지 않습니다.');
      if (input.unit !== output.unit) fail('UNIT_MISMATCH', '상태 입력의 단위는 지정한 초기값 단위와 같아야 합니다.');
    }
    if (node.parameters.reset === 'level' || node.parameters.reset === 'rising') {
      const reset = node.inputs.reset!; const descriptor = byId.get(reset.nodeId)!.outputs[reset.portId]!;
      if (descriptor.valueType !== 'boolean') fail('TYPE_MISMATCH', '초기화 입력은 boolean scalar여야 합니다.', 'reset');
      if (descriptor.shape.length !== 0) fail('SHAPE_MISMATCH', '초기화 입력은 boolean scalar여야 합니다.', 'reset');
      if (descriptor.unit !== '1') fail('UNIT_MISMATCH', '초기화 입력은 단위 없는 boolean이어야 합니다.', 'reset');
    }
  }
  const intermediateCount = ordered.reduce((sum, node) => sum + Object.values(node.outputs).reduce((count, descriptor) => count + signalElementCount(descriptor), 0), 0);
  if (intermediateCount > SIGNAL_LIMITS.maxIntermediateElements) throw new ModelError([{ code: 'INTERMEDIATE_BUDGET_EXCEEDED', message: '모델의 중간 신호는 합계 100,000개 원소 이하여야 합니다. 신호 크기나 블럭 수를 줄여 주세요.' }]);
}

/** Compile bounded typed contracts; editor text is parsed into AST and never executed as code. */
function compileFlatModel(input: unknown): CompiledModel {
  const model = parseModel(input);
  if (model.execution.mode === 'continuous') model.execution.solver = normalizeSolverSettings(model.execution);
  const diagnostics: Diagnostic[] = [];
  const definitions = new Map<string, BlockDefinition>();
  const nodeById = new Map<string, IRNode>();
  for (const node of model.nodes) {
    const definition = getBlockDefinition(node.blockType);
    if (!definition) {
      diagnostics.push({ code: 'UNKNOWN_BLOCK', nodeId: node.id, message: `${node.id}의 블럭은 현재 지원 목록에 없습니다.` });
      continue;
    }
    definitions.set(node.id, definition);
    if (node.blockVersion !== definition.version) {
      diagnostics.push({ code: 'UNSUPPORTED_BLOCK_VERSION', nodeId: node.id, message: `${node.id}의 블럭 버전은 지원하지 않습니다.` });
    }
    if (!definition.supportedModes.includes(model.execution.mode)) {
      diagnostics.push({ code: 'UNSUPPORTED_MODE', nodeId: node.id, message: `${definition.label} 블럭은 ${definition.supportedModes.join(', ')} 모드에서 사용할 수 있습니다.` });
    }
    try {
      const parameters = parseParameters(definition, node.parameters, node.id);
      // Normalize defaults into the snapshot so UI, runtime, and generated code share one meaning.
      node.parameters = { ...parameters };
      const sampleTime = node.sampleTime ?? { period: 1, offset: 0 };
      if (model.execution.mode === 'discrete') node.sampleTime = { ...sampleTime };
      if ((model.execution.mode === 'static' || definition.id === 'source.clock') && (sampleTime.period !== 1 || sampleTime.offset !== 0)) {
        throw new ModelError([{ code: 'UNSUPPORTED_SAMPLE_TIME', nodeId: node.id, message: '이 모드 또는 Clock에는 기본 샘플시간 1/0만 사용할 수 있습니다.' }]);
      }
      const ir: IRNode = { id: node.id, blockType: definition.id, parameters, inputs: {}, outputs: {}, sampleTime: { ...sampleTime } };
      if (definition.id === 'source.dataset') {
        const dataset = model.datasets?.find(item => item.id === parameters.datasetId);
        if (!dataset) throw new ModelError([{ code: 'DATASET_REFERENCE_MISSING', nodeId: node.id, message: '재생할 데이터셋이 프로젝트에 없습니다. 데이터 탭에서 가져와 주세요.' }]);
        const series = datasetSeries(dataset, String(parameters.column));
        if (series.kind === 'boolean' && parameters.interpolation !== 'previous') throw new ModelError([{ code: 'DATASET_INTERPOLATION', nodeId: node.id, message: 'boolean 열은 previous 보간을 사용해 주세요.' }]);
        Object.assign(ir.parameters, { times: series.times, values: series.values, dataKind: series.kind, dataUnit: series.unit, dataVersion: dataset.version, sourceHash: dataset.sourceHash, contentHash: dataset.contentHash });
        // Preserve the portable reference; data arrays belong only to compiled IR.
        node.parameters = { datasetId: parameters.datasetId, column: parameters.column, interpolation: parameters.interpolation, outside: parameters.outside };
      }
      validateDiscreteParameters(ir, model);
      validateContinuousParameters(ir, model);
      validateAdvancedParameters(ir);
      validateTimeSourceParameters(ir, model);
      validateM8Parameters(ir);
      validateM9Parameters(ir, model);
      if (definition.id === 'math.expression') ir.expression = parseExpression(parameters.expression as string);
      nodeById.set(node.id, ir);
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      diagnostics.push(...error.diagnostics.map((diagnostic) => ({ ...diagnostic, nodeId: node.id })));
    }
  }
  if (diagnostics.length > 0) throw new ModelError(diagnostics.slice(0, 20));

  const adjacency = new Map<string, Set<string>>(model.nodes.map((node) => [node.id, new Set<string>()]));
  const ports = new Map(model.nodes.map((node) => [node.id, getBlockPorts(node)]));
  const indegree = new Map<string, number>(model.nodes.map((node) => [node.id, 0]));
  const writtenInputs = new Set<string>();
  for (const edge of [...model.edges].sort((a, b) => compareId(a.id, b.id))) {
    const source = definitions.get(edge.source.nodeId);
    const target = definitions.get(edge.target.nodeId);
    if (!source || !target) {
      const missingId = !source ? edge.source.nodeId : edge.target.nodeId;
      diagnostics.push({ code: 'UNKNOWN_ENDPOINT', nodeId: missingId, message: `연결 ${edge.id}의 블럭 ${missingId}가 존재하지 않습니다.` });
      continue;
    }
    if (!ports.get(edge.source.nodeId)!.outputs.includes(edge.source.portId)) {
      diagnostics.push({ code: 'UNKNOWN_OUTPUT_PORT', nodeId: edge.source.nodeId, portId: edge.source.portId, message: `${edge.source.nodeId}에 출력 포트 ${edge.source.portId}가 없습니다.` });
      continue;
    }
    if (!ports.get(edge.target.nodeId)!.inputs.includes(edge.target.portId)) {
      diagnostics.push({ code: 'UNKNOWN_INPUT_PORT', nodeId: edge.target.nodeId, portId: edge.target.portId, message: `${edge.target.nodeId}에 입력 포트 ${edge.target.portId}가 없습니다.` });
      continue;
    }
    const inputKey = `${edge.target.nodeId}:${edge.target.portId}`;
    if (writtenInputs.has(inputKey)) {
      diagnostics.push({ code: 'MULTIPLE_INPUT_WRITERS', nodeId: edge.target.nodeId, portId: edge.target.portId, message: `${edge.target.nodeId}의 ${edge.target.portId}에는 한 연결만 사용할 수 있습니다.` });
      continue;
    }
    writtenInputs.add(inputKey);
    nodeById.get(edge.target.nodeId)!.inputs[edge.target.portId] = { ...edge.source };
    if (getDirectFeedthroughPorts(nodeById.get(edge.target.nodeId)!).includes(edge.target.portId) && !adjacency.get(edge.source.nodeId)!.has(edge.target.nodeId)) {
      adjacency.get(edge.source.nodeId)!.add(edge.target.nodeId);
      indegree.set(edge.target.nodeId, indegree.get(edge.target.nodeId)! + 1);
    }
  }
  for (const node of model.nodes) {
    for (const portId of getBlockPorts(node).inputs) {
      if (!writtenInputs.has(`${node.id}:${portId}`)) diagnostics.push({
        code: 'REQUIRED_INPUT_MISSING', nodeId: node.id, portId,
        message: `${node.id}의 입력 ${portId}에 연결이 필요합니다.`,
      });
    }
  }
  const outputIds = model.nodes.filter((node) => node.blockType === 'sink.display' || node.blockType === 'io.output' || node.blockType === 'sink.scope').map((node) => node.id).sort(compareId);
  const stateIds = model.nodes.filter((node) => definitions.get(node.id)!.state !== 'none').map((node) => node.id).sort(compareId);
  if (outputIds.length === 0) diagnostics.push({ code: 'OUTPUT_REQUIRED', message: '모델에 결과 블럭을 한 개 이상 연결해 주세요.' });
  if (diagnostics.length > 0) throw new ModelError(diagnostics.slice(0, 20));

  const ready = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort(compareId);
  const ordered: IRNode[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(nodeById.get(id)!);
    for (const target of [...adjacency.get(id)!].sort(compareId)) {
      const degree = indegree.get(target)! - 1;
      indegree.set(target, degree);
      if (degree === 0) { ready.push(target); ready.sort(compareId); }
    }
  }
  if (ordered.length !== model.nodes.length) {
    const cycle = findCycle(adjacency);
    const shownPath = cycle.slice(0, 12).join(' → ');
    const omitted = cycle.length > 12 ? ` → … (${cycle.length - 12}개 연결 생략)` : '';
    const message = `현재 입력을 즉시 사용하는 순환입니다: ${shownPath}${omitted}. 의도한 지연이나 상태를 명시해 주세요.`;
    throw new ModelError([...new Set(cycle)].slice(0, 20).map((nodeId) => ({
      code: 'CYCLIC_DEPENDENCY', nodeId,
      message,
    })));
  }
  inferSignals(model, ordered, nodeById, definitions);
  inferContinuousDomains(model, ordered);
  if (model.execution.mode === 'discrete') {
    for (const edge of model.edges) {
      const source = nodeById.get(edge.source.nodeId)!; const target = nodeById.get(edge.target.nodeId)!;
      if (getBlockDefinition(source.blockType)!.sampleTime === 'constant' || target.blockType === 'time.rate-transition') continue;
      if (source.sampleTime.period !== target.sampleTime.period || source.sampleTime.offset !== target.sampleTime.offset) {
        diagnostics.push({ code: 'SAMPLE_TIME_MISMATCH', nodeId: target.id, portId: edge.target.portId, message: `입력 ${edge.target.portId}의 샘플시간이 다릅니다. ${source.sampleTime.period}/${source.sampleTime.offset} → ${target.sampleTime.period}/${target.sampleTime.offset} 사이에 Rate Transition을 연결해 주세요.` });
      }
    }
  }
  const stateElements = model.execution.mode === 'discrete' ? discreteMemoryElementCount(ordered) : model.execution.mode === 'continuous' ? discreteMemoryElementCount(ordered) + ordered.reduce((count, node) => count + continuousStateElementCount(node), 0) : 0;
  if (stateElements > MODEL_LIMITS.maxStateElements) diagnostics.push({ code: 'STATE_BUDGET_EXCEEDED', message: '상태·유지 출력·rate 경계 메모리는 합계 100,000개 원소 이하여야 합니다. 지연 횟수나 신호 크기를 줄여 주세요.' });
  const outputTypes = Object.fromEntries(outputIds.map((id) => [id, nodeById.get(id)!.outputs.out!]));
  diagnostics.push(...executionDiagnostics(model, Object.values(outputTypes).reduce((count, descriptor) => count + signalElementCount(descriptor), 0)));
  if (diagnostics.length > 0) throw new ModelError(diagnostics.slice(0, 20));
  return deepFreeze({ model, nodes: ordered, outputIds, outputTypes, stateIds, stateElements, semanticKey: canonicalSemantic(model) });
}

/** Compile a portable project while retaining the hierarchy and data snapshot. */
export function compileModel(input: unknown): CompiledModel {
  const original = parseModel(input);
  for (const node of [...original.nodes, ...(original.subsystems ?? []).flatMap(definition => definition.nodes)]) {
    const definition = getBlockDefinition(node.blockType);
    if (definition) node.parameters = parseParameters(definition, node.parameters, node.id);
    if (original.execution.mode === 'discrete') node.sampleTime = { ...(node.sampleTime ?? { period: 1, offset: 0 }) };
  }
  if (original.execution.mode === 'continuous') original.execution.solver = normalizeSolverSettings(original.execution);
  const flattened = flattenHierarchy(original);
  const compiled = compileFlatModel(flattened.model);
  original.execution = structuredClone(compiled.model.execution);
  validateDashboard(original, compiled);
  return deepFreeze({ ...compiled, model: original, semanticKey: canonicalSemantic(original), ...(flattened.instances.length ? { hierarchy: { origins: flattened.origins, instances: flattened.instances } } : {}) });
}

function validateDashboard(model: CalcModel, compiled: CompiledModel): void {
  for (const widget of model.dashboard ?? []) {
    const node = model.nodes.find(item => item.id === widget.nodeId);
    const fail = (): never => { throw new ModelError([{ code: 'INVALID_DASHBOARD_BINDING', nodeId: widget.nodeId, message: '대시보드의 연결 대상·값 유형·범위를 확인해 주세요.' }]); };
    if (!node) fail();
    if (widget.kind === 'slider' || widget.kind === 'toggle') {
      const parameter = widget.parameter ?? 'value';
      if (!(node!.blockType === 'source.constant' || node!.blockType === 'io.input') && !(widget.kind === 'slider' && node!.blockType === 'math.gain' && parameter === 'gain')) fail();
      if (node!.blockType !== 'math.gain' && parameter !== 'value') fail();
      const current = node!.parameters[parameter];
      if (widget.kind === 'toggle' ? typeof current !== 'boolean' : typeof current !== 'number' || !Number.isFinite(current)) fail();
      if (widget.kind === 'slider' && (!(Number.isFinite(widget.min) && Number.isFinite(widget.max) && Number.isFinite(widget.step)) || widget.min! >= widget.max! || widget.step! <= 0 || current as number < widget.min! || current as number > widget.max!)) fail();
    } else {
      const descriptor = compiled.outputTypes[widget.nodeId];
      if (!descriptor || descriptor.shape.length || descriptor.valueType !== 'float64') fail();
      if (widget.kind === 'gauge' && (!(Number.isFinite(widget.min) && Number.isFinite(widget.max)) || widget.min! >= widget.max!)) fail();
    }
  }
}
