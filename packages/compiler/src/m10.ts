import { M10_BLOCK_IDS } from '../../block-library/src/m10';
import { ModelError, SIGNAL_LIMITS, UNITS, divideUnits, multiplyUnits, validateSignal, type IRNode, type SignalDescriptor, type TypedDataType, type TypedSignal } from '../../model/src';
import { equalDataType, typedDataType, typedDescriptor, validateDataType, validateTypedSignal } from '../../model/src/typed';

const ids: ReadonlySet<string> = new Set(M10_BLOCK_IDS);
const integers: ReadonlySet<string> = new Set(['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64']);
const reals: ReadonlySet<string> = new Set(['float64', 'float32', ...integers, 'fixed']);
const fail = (node: IRNode, code: string, message: string, portId?: string): never => { throw new ModelError([{ code, message, nodeId: node.id, ...(portId ? { portId } : {}) }]); };
const copy = (descriptor: SignalDescriptor): SignalDescriptor => structuredClone(descriptor);
const widthOf = (type: TypedDataType): number => type.dtype === 'fixed' ? type.fixed!.wordLength : Number(type.dtype.replace(/^u?int/, ''));
const unsigned = (bits: number): TypedDataType => ({ dtype: bits <= 8 ? 'uint8' : bits <= 16 ? 'uint16' : bits <= 32 ? 'uint32' : 'uint64' });
const typeOnly = (type: TypedDataType): TypedDataType => validateDataType({ dtype: type.dtype, ...(type.fixed ? { fixed: type.fixed } : {}), ...(type.enum ? { enum: type.enum } : {}) });
const typed = (type: TypedDataType, shape: number[], unit = '1'): SignalDescriptor => ({ valueType: 'typed', typed: typeOnly(type), shape: [...shape], unit });
const sameShape = (a: SignalDescriptor, b: SignalDescriptor): boolean => a.shape.length === b.shape.length && a.shape.every((axis, index) => axis === b.shape[index]);
const dimensions = (node: IRNode, values: unknown): number[] => {
  if (!Array.isArray(values) || values.length > 8 || values.some(axis => !Number.isInteger(axis) || axis < 1 || axis > SIGNAL_LIMITS.maxAxis) || values.reduce((size, axis) => size * axis, 1) > SIGNAL_LIMITS.maxElements) fail(node, 'TYPED_SHAPE', '형상은 rank0~8, 축1~1,024, 전체1,024개 원소 이하여야 합니다.');
  return values as number[];
};

export function validateM10Parameters(node: IRNode): void {
  if (!ids.has(node.blockType)) return;
  const p = node.parameters;
  const signal = (key: string): TypedSignal => {
    try { return validateTypedSignal(p[key]); } catch (error) { if (error instanceof ModelError) throw new ModelError(error.diagnostics.map(diagnostic => ({ ...diagnostic, nodeId: node.id }))); throw error; }
  };
  switch (node.blockType) {
    case 'source.typed': signal('value'); break;
    case 'source.enum': if (signal('value').dtype !== 'enum') fail(node, 'TYPE_MISMATCH', 'Enumerated Constant에는 선언된 enum 값이 필요합니다.'); break;
    case 'tensor.reshape': dimensions(node, p.dimensions); break;
    case 'tensor.permute': {
      const order = p.order as number[];
      if (order.some(axis => !Number.isInteger(axis) || axis < 0 || axis >= order.length) || new Set(order).size !== order.length) fail(node, 'TYPED_AXIS', '축 순열은 모든0-based 축을 한 번씩 포함해야 합니다.');
      break;
    }
    case 'signal.specification': dimensions(node, p.dimensions); if ((p.lower as number) > (p.upper as number)) fail(node, 'INVALID_PARAMETERS', '최소 범위는 최대 범위 이하여야 합니다.'); break;
    case 'logic.bit-mask': {
      const bits = p.bits as number[];
      if (bits.some(bit => !Number.isInteger(bit) || bit < 0 || bit > 63) || new Set(bits).size !== bits.length) fail(node, 'TYPED_BIT_RANGE', '비트 위치는 중복 없는0~63 정수여야 합니다.');
      break;
    }
    case 'logic.extract-bits': if ((p.low as number) > (p.high as number)) fail(node, 'TYPED_BIT_RANGE', 'low는 high 이하여야 합니다.'); break;
    case 'logic.bits-to-integer': if (!integers.has(validateDataType(p.target).dtype)) fail(node, 'TYPE_MISMATCH', '비트 묶음의 출력은 built-in 정수 자료형이어야 합니다.'); break;
    case 'fixed.trigonometric': if ((p.points as number) > Math.min(1024, 2 ** ((p.wordLength as number) - 2) + 1)) fail(node, 'INVALID_PARAMETERS', 'LUT 점 수는 min(1,024, 2^(WL−2)+1) 이하여야 합니다.'); break;
    case 'fixed.state-space': {
      const initial = signal('initial');
      if (initial.dtype !== 'fixed' || initial.shape.length !== 1 || initial.shape[0]! > 8) fail(node, 'TYPE_MISMATCH', '초기 상태는 길이1~8인 fixed 벡터여야 합니다.');
      const n = initial.shape[0]!, A = signal('A'), B = signal('B'), C = signal('C'), D = signal('D');
      for (const [key, value] of [['A', A], ['B', B], ['C', C], ['D', D]] as const) if (value.shape.length !== 2 || value.shape.some(axis => axis > 8) || !equalDataType(typeOnly(value), typeOnly(initial))) fail(node, 'TYPE_MISMATCH', `${key}는 각 축1~8, 초기 상태와 같은 fixed 자료형·스케일 행렬이어야 합니다.`);
      if (A.shape[0] !== n || A.shape[1] !== n || B.shape[0] !== n || C.shape[1] !== n || D.shape[0] !== C.shape[0] || D.shape[1] !== B.shape[1]) fail(node, 'TYPED_STATE_SPACE_SHAPE', 'A N×N, B N×M, C P×N, D P×M과 initial N의 크기가 일치해야 합니다.');
      break;
    }
    case 'signal.unit-system': {
      let allowed: unknown;
      try { allowed = JSON.parse(String(p.allowedUnits)); } catch { fail(node, 'INVALID_UNIT_SYSTEM', '허용 단위는 JSON 배열이어야 합니다.'); }
      if (!Array.isArray(allowed) || !allowed.length || allowed.length > UNITS.length || allowed.some(unit => typeof unit !== 'string' || !(UNITS as readonly string[]).includes(unit)) || new Set(allowed).size !== allowed.length || !allowed.includes('1')) fail(node, 'INVALID_UNIT_SYSTEM', '허용 단위는 단위1을 포함하는 중복 없는 승인 목록이어야 합니다.');
      node.parameters.unitAllowlist = [...allowed as string[]];
      break;
    }
  }
}

/** The selected fixed-point state is known before its non-feedthrough input is visited. */
export function initialM10Outputs(node: IRNode, unit = '1'): Record<string, SignalDescriptor> | undefined {
  if (node.blockType !== 'fixed.state-space') return undefined;
  const initial = validateTypedSignal(node.parameters.initial), C = validateTypedSignal(node.parameters.C);
  return { out: typed(initial, [C.shape[0]!], unit) };
}

/** Only explicit references and directly connected propagated casts form this bounded inverse constraint. */
export function applyM10TypePropagation(ordered: readonly IRNode[], byId: Map<string, IRNode>): void {
  const constraints = new Map<string, TypedDataType>();
  const active = new Set<string>();
  const reference = (node: IRNode, port: string): TypedDataType => {
    const endpoint = node.inputs[port], producer = (endpoint && byId.get(endpoint.nodeId)) ?? fail(node, 'TYPE_PROPAGATION_REFERENCE', '참조는 out 자료형이 확정된 신호에 직접 연결해야 합니다.', port);
    if (endpoint!.portId !== 'out') fail(node, 'TYPE_PROPAGATION_REFERENCE', '참조는 out 자료형이 확정된 신호에 직접 연결해야 합니다.', port);
    if (active.has(producer.id)) fail(node, 'TYPE_PROPAGATION_CYCLE', '자료형 참조에 순환이 있습니다.', port);
    active.add(producer.id);
    let result: TypedDataType;
    if (producer.blockType === 'source.typed' || producer.blockType === 'source.enum') result = typeOnly(validateTypedSignal(producer.parameters.value));
    else if (producer.blockType === 'source.constant' || producer.blockType === 'io.input') result = typedDataType(validateSignal(producer.parameters.value));
    else if (producer.blockType === 'signal.cast' && producer.parameters.source === 'explicit') result = validateDataType(producer.parameters.target);
    else if (producer.blockType === 'signal.cast-inherited') result = reference(producer, 'reference');
    else if (producer.blockType === 'signal.representation') result = reference(producer, 'in');
    else fail(node, 'TYPE_PROPAGATION_REFERENCE', '현재 역전파 참조는 상수·명시 cast·참조 cast·copy의 확정 자료형만 지원합니다.', port);
    active.delete(producer.id);
    return result!;
  };
  for (const node of ordered.filter(node => node.blockType === 'signal.type-propagation')) {
    const ref1 = reference(node, 'ref1'), ref2 = reference(node, 'ref2');
    let target = ref1;
    if (node.parameters.rule === 'widest-integer') {
      if (!integers.has(ref1.dtype) || !integers.has(ref2.dtype) || ref1.dtype.startsWith('u') !== ref2.dtype.startsWith('u')) fail(node, 'TYPE_PROPAGATION_RULE', 'widest-integer 규칙은 같은 signedness의 built-in 정수 참조 두 개가 필요합니다.');
      target = widthOf(ref1) >= widthOf(ref2) ? ref1 : ref2;
    }
    const endpoint = node.inputs.prop, producer = (endpoint && byId.get(endpoint.nodeId)) ?? fail(node, 'TYPE_PROPAGATION_TARGET', 'prop에는 source=propagated인 cast의 out을 직접 연결해야 합니다.', 'prop');
    if (endpoint!.portId !== 'out' || producer.blockType !== 'signal.cast' || producer.parameters.source !== 'propagated') fail(node, 'TYPE_PROPAGATION_TARGET', 'prop에는 source=propagated인 cast의 out을 직접 연결해야 합니다.', 'prop');
    const prior = constraints.get(producer.id);
    if (prior && !equalDataType(prior, target)) fail(node, 'TYPE_PROPAGATION_CONFLICT', '한 cast에 서로 다른 역전파 자료형이 지정됐습니다.', 'prop');
    constraints.set(producer.id, target);
  }
  for (const node of ordered.filter(node => node.blockType === 'signal.cast' && node.parameters.source === 'propagated')) {
    const target = constraints.get(node.id);
    if (!target) fail(node, 'TYPE_PROPAGATION_UNRESOLVED', 'propagated cast에는 직접 연결된 Data Type Propagation constraint가 필요합니다.');
    node.parameters.propagatedTarget = structuredClone(target);
  }
}

/** Legacy kernels continue to accept exactly their previous finite real/boolean contracts. */
export function guardM10LegacyInputs(node: IRNode, input: (port: string) => SignalDescriptor | undefined): void {
  if (ids.has(node.blockType) || ['sink.display', 'sink.scope', 'io.output', 'io.terminator'].includes(node.blockType)) return;
  for (const port of Object.keys(node.inputs)) if (input(port)?.valueType === 'typed') fail(node, 'TYPE_MISMATCH', '기존 블럭에는 명시 To Legacy Signal 경계로 변환한 유한 float64/boolean을 연결해 주세요.', port);
}

export function inferM10Outputs(node: IRNode, input: (port: string) => SignalDescriptor, declaredUnit = '1'): Record<string, SignalDescriptor> | undefined {
  if (!ids.has(node.blockType)) return undefined;
  const p = node.parameters;
  const out = (value: SignalDescriptor): Record<string, SignalDescriptor> => ({ out: value });
  const requireTyped = (port = 'in'): SignalDescriptor => { const value = input(port); if (value.valueType !== 'typed' || !value.typed) fail(node, 'TYPE_MISMATCH', '명시된 typed 신호가 필요합니다.', port); return value; };
  const real = (port = 'in'): SignalDescriptor => { const value = input(port); if (value.valueType === 'boolean' || value.valueType === 'typed' && !reals.has(value.typed!.dtype)) fail(node, 'TYPE_MISMATCH', '실수 자료형 신호가 필요합니다.', port); return value; };
  const int = (port = 'in'): SignalDescriptor => { const value = requireTyped(port); if (!integers.has(value.typed!.dtype)) fail(node, 'TYPE_MISMATCH', 'built-in 정수 typed 신호가 필요합니다.', port); if (value.unit !== '1') fail(node, 'UNIT_MISMATCH', '비트 연산은 단위1 정수만 사용할 수 있습니다.', port); return value; };
  const fixed = (): SignalDescriptor => { const value = requireTyped(); if (value.typed!.dtype !== 'fixed') fail(node, 'TYPE_MISMATCH', 'binary-point fixed 신호가 필요합니다.', 'in'); return value; };
  const complex = (): SignalDescriptor => { const value = requireTyped(); if (value.typed!.dtype !== 'complex128') fail(node, 'TYPE_MISMATCH', 'complex128 신호가 필요합니다.', 'in'); return value; };
  const pairShape = (a: SignalDescriptor, b: SignalDescriptor, port: string): number[] => { if (a.shape.length && b.shape.length && !sameShape(a, b)) fail(node, 'SHAPE_MISMATCH', '두 비scalar 형상은 같아야 합니다.', port); return [...(a.shape.length ? a.shape : b.shape)]; };
  const sameUnit = (a: SignalDescriptor, b: SignalDescriptor, port: string): void => { if (a.unit !== b.unit) fail(node, 'UNIT_MISMATCH', '입력 단위가 같아야 합니다.', port); };
  switch (node.blockType) {
    case 'source.typed': case 'source.enum': {
      const value = validateTypedSignal(p.value);
      if (['boolean', 'string', 'enum'].includes(value.dtype) && declaredUnit !== '1') fail(node, 'UNIT_MISMATCH', '논리·문자·열거 신호에는 단위1만 사용할 수 있습니다.', 'out');
      return out(typedDescriptor(value, declaredUnit));
    }
    case 'signal.cast': {
      const value = input('in'), target = validateDataType(p.source === 'propagated' ? p.propagatedTarget : p.target);
      if (['boolean', 'string', 'enum'].includes(target.dtype) && value.unit !== '1') fail(node, 'UNIT_MISMATCH', '논리·문자·열거로 변환할 신호는 단위1이어야 합니다.');
      return out(typed(target, value.shape, value.unit));
    }
    case 'signal.cast-inherited': {
      const value = input('in'), target = typedDataType(input('reference'));
      if (['boolean', 'string', 'enum'].includes(target.dtype) && value.unit !== '1') fail(node, 'UNIT_MISMATCH', '논리·문자·열거로 변환할 신호는 단위1이어야 합니다.');
      return out(typed(target, value.shape, value.unit));
    }
    case 'signal.to-legacy': {
      const value = requireTyped(), type = value.typed!;
      if (value.shape.length > 2 || !reals.has(type.dtype) && type.dtype !== 'boolean') fail(node, 'TYPE_MISMATCH', 'Legacy 경계는 real/boolean의 scalar·vector·2D만 지원합니다.');
      return out({ valueType: type.dtype === 'boolean' ? 'boolean' : 'float64', shape: [...value.shape], unit: value.unit });
    }
    case 'signal.type-duplicate': if (!equalDataType(typedDataType(input('a')), typedDataType(input('b')))) fail(node, 'TYPE_CONSTRAINT_MISMATCH', '두 입력의 자료형·스케일·열거 선언이 다릅니다.', 'b'); return {};
    case 'signal.type-propagation': return {};
    case 'signal.scaling-strip': {
      const value = requireTyped(), type = value.typed!;
      if (!reals.has(type.dtype) && type.dtype !== 'boolean') fail(node, 'TYPE_MISMATCH', '스케일 제거에는 numeric 또는 boolean 신호만 사용할 수 있습니다.');
      if (type.dtype !== 'fixed') return out(copy(value));
      const wordLength = type.fixed!.wordLength, name = `${type.fixed!.signed ? 'int' : 'uint'}${wordLength <= 8 ? 8 : wordLength <= 16 ? 16 : wordLength <= 32 ? 32 : 64}`;
      return out(typed(validateDataType({ dtype: name }), value.shape));
    }
    case 'signal.representation': {
      const value = input('in');
      if (p.representation !== 'copy' && (!value.fields || value.shape.length !== 1 || value.shape[0] !== value.fields.length)) fail(node, 'BUS_REPRESENTATION', 'virtual/nonvirtual은 기존 동종 scalar named-bus만 지원합니다.');
      return out({ ...copy(value), representation: p.representation as 'copy' | 'virtual' | 'nonvirtual' });
    }
    case 'signal.specification': {
      const value = input('in');
      if (p.checkType === 'yes' && !equalDataType(typedDataType(value), validateDataType(p.type))) fail(node, 'TYPE_CONSTRAINT_MISMATCH', '신호의 자료형·스케일·열거 선언이 지정한 규격과 다릅니다.');
      if (p.checkShape === 'yes' && !sameShape(value, { ...value, shape: p.dimensions as number[] })) fail(node, 'SHAPE_MISMATCH', '신호 형상이 지정한 규격과 다릅니다.');
      if (p.range === 'finite') real();
      return out(copy(value));
    }
    case 'signal.width': return out({ valueType: 'float64', shape: [], unit: '1' });
    case 'signal.bus-to-vector': {
      const value = input('in');
      if (!value.fields || value.shape.length !== 1 || value.shape[0] !== value.fields.length || value.valueType !== 'float64') fail(node, 'BUS_REPRESENTATION', '기존 동종 numeric scalar named-bus만 일반 벡터로 변환할 수 있습니다.');
      const descriptor = copy(value); delete descriptor.fields; delete descriptor.representation; return out(descriptor);
    }
    case 'signal.unit-system': return {};
    case 'logic.bit-mask': { const value = int(); if ((p.bits as number[]).some(bit => bit >= widthOf(value.typed!))) fail(node, 'TYPED_BIT_RANGE', '비트 위치가 입력 정수 폭을 벗어났습니다.'); return out(copy(value)); }
    case 'logic.extract-bits': { const value = int(); if ((p.high as number) >= widthOf(value.typed!)) fail(node, 'TYPED_BIT_RANGE', '추출 범위가 입력 정수 폭을 벗어났습니다.'); return out(typed(unsigned((p.high as number) - (p.low as number) + 1), value.shape)); }
    case 'logic.float-extract-bits': {
      const value = requireTyped(), dtype = value.typed!.dtype;
      if (!['float32', 'float64'].includes(dtype) || value.unit !== '1') fail(node, 'TYPE_MISMATCH', 'IEEE 비트 추출에는 단위1 typed float32/64가 필요합니다.');
      const bits = p.part === 'sign' ? 1 : p.part === 'exponent' ? dtype === 'float32' ? 8 : 11 : p.part === 'fraction' ? dtype === 'float32' ? 23 : 52 : dtype === 'float32' ? 32 : 64;
      return out(typed(unsigned(bits), value.shape));
    }
    case 'logic.integer-to-bits': { const value = int(); if (value.shape.length || (p.width as number) > widthOf(value.typed!)) fail(node, 'TYPED_BIT_RANGE', '정수→비트에는 scalar와 정수 자료형 폭 이하의 width가 필요합니다.'); return out(typed({ dtype: 'boolean' }, [p.width as number])); }
    case 'logic.bits-to-integer': {
      const value = input('in'), dtype = typedDataType(value), target = validateDataType(p.target);
      if (dtype.dtype !== 'boolean' || value.shape.length !== 1 || value.shape[0]! > widthOf(target) || value.unit !== '1') fail(node, 'TYPED_BIT_RANGE', '비트 입력은 출력 정수 폭 이하의 boolean 벡터여야 합니다.');
      return out(typed(target, []));
    }
    case 'logic.shift-arithmetic': {
      if (p.mode === 'binary-point') { const value = fixed(), spec = value.typed!.fixed!, fractionLength = spec.fractionLength - (p.shift as number); if (fractionLength < -64 || fractionLength > 64) fail(node, 'TYPED_FIXED_RANGE', '시프트 결과의 소수 비트 수는−64~64여야 합니다.'); return out(typed({ dtype: 'fixed', fixed: { ...spec, fractionLength } }, value.shape, value.unit)); }
      const value = int(); if (Math.abs(p.shift as number) >= widthOf(value.typed!)) fail(node, 'TYPED_BIT_RANGE', '산술 시프트의 절대값은 정수 폭보다 작아야 합니다.'); return out(copy(value));
    }
    case 'logic.bitwise-typed': { const a = int('a'); if (p.operation === 'not') return out(copy(a)); const b = int('b'); if (!equalDataType(a.typed!, b.typed!)) fail(node, 'TYPE_MISMATCH', '비트 입력 자료형이 같아야 합니다.', 'b'); return out(typed(a.typed!, pairShape(a, b, 'b'))); }
    case 'fixed.integer-increment': return out(copy(fixed()));
    case 'fixed.trigonometric': { const value = real(); if (value.unit !== '1') fail(node, 'UNIT_MISMATCH', 'LUT 입력은 단위 없는 normalized phase여야 합니다.'); return out(typed({ dtype: 'fixed', fixed: { signed: true, wordLength: p.wordLength as number, fractionLength: (p.wordLength as number) - 2 } }, value.shape)); }
    case 'fixed.state-space': return node.outputs;
    case 'complex.from-parts': { const a = real('real'), b = real('imag'); sameUnit(a, b, 'imag'); return out(typed({ dtype: 'complex128' }, pairShape(a, b, 'imag'), a.unit)); }
    case 'complex.from-polar': { const magnitude = real('magnitude'), angle = real('angle'); if (!['1', 'rad'].includes(angle.unit)) fail(node, 'UNIT_MISMATCH', '위상은 단위1 또는 rad이어야 합니다.', 'angle'); return out(typed({ dtype: 'complex128' }, pairShape(magnitude, angle, 'angle'), magnitude.unit)); }
    case 'complex.to-parts': { const value = complex(); return { real: typed({ dtype: 'float64' }, value.shape, value.unit), imag: typed({ dtype: 'float64' }, value.shape, value.unit) }; }
    case 'complex.to-polar': { const value = complex(); return { magnitude: typed({ dtype: 'float64' }, value.shape, value.unit), angle: typed({ dtype: 'float64' }, value.shape, 'rad') }; }
    case 'complex.hermitian': case 'complex.is-hermitian': {
      const value = complex(); if (value.shape.length !== 2 || value.shape.some(axis => axis > 32) || node.blockType === 'complex.is-hermitian' && value.shape[0] !== value.shape[1]) fail(node, 'MATRIX_SHAPE', '켤레 전치는 각 축1~32, Hermitian 검사는 정방 complex128 행렬이어야 합니다.');
      return out(node.blockType === 'complex.is-hermitian' ? typed({ dtype: 'boolean' }, []) : typed({ dtype: 'complex128' }, [value.shape[1]!, value.shape[0]!], value.unit));
    }
    case 'complex.dot': {
      const a = requireTyped('a'), b = requireTyped('b');
      if (a.typed!.dtype !== 'complex128' || b.typed!.dtype !== 'complex128') fail(node, 'TYPE_MISMATCH', '복소수 내적에는 complex128 벡터 두 개가 필요합니다.');
      if (a.shape.length !== 1 || !sameShape(a, b)) fail(node, 'SHAPE_MISMATCH', '복소수 내적에는 같은 길이의 벡터 두 개가 필요합니다.');
      return out(typed({ dtype: 'complex128' }, [], multiplyUnits(a.unit, b.unit)));
    }
    case 'typed.math': {
      const a = requireTyped('a'), b = requireTyped('b');
      if (!equalDataType(a.typed!, b.typed!) || !reals.has(a.typed!.dtype) && a.typed!.dtype !== 'complex128') fail(node, 'TYPE_MISMATCH', '같은 numeric typed 자료형·스케일의 두 입력이 필요합니다.', 'b');
      if (['add', 'subtract'].includes(String(p.operation))) sameUnit(a, b, 'b');
      const unit = p.operation === 'multiply' ? multiplyUnits(a.unit, b.unit) : p.operation === 'divide' ? divideUnits(a.unit, b.unit) : a.unit;
      return out(typed(a.typed!, pairShape(a, b, 'b'), unit));
    }
    case 'tensor.reshape': { const value = requireTyped(), shape = p.dimensions as number[]; if (shape.reduce((size, axis) => size * axis, 1) !== value.shape.reduce((size, axis) => size * axis, 1)) fail(node, 'SHAPE_MISMATCH', 'reshape 전후 원소 수는 같아야 합니다.'); return out(typed(value.typed!, shape, value.unit)); }
    case 'tensor.permute': { const value = requireTyped(), order = p.order as number[]; if (order.length !== value.shape.length) fail(node, 'TYPED_AXIS', '순열 길이는 신호 rank와 같아야 합니다.'); return out(typed(value.typed!, order.map(axis => value.shape[axis]!), value.unit)); }
    case 'tensor.squeeze': { const value = requireTyped(); return out(typed(value.typed!, value.shape.filter(axis => axis !== 1), value.unit)); }
  }
  return undefined;
}

export function validateM10StateInputs(node: IRNode, input: (port: string) => SignalDescriptor): boolean {
  if (node.blockType !== 'fixed.state-space') return false;
  const value = input('in'), initial = validateTypedSignal(node.parameters.initial), B = validateTypedSignal(node.parameters.B);
  if (value.valueType !== 'typed' || !equalDataType(value.typed!, typeOnly(initial))) fail(node, 'TYPE_MISMATCH', '상태 공간 입력은 초기 상태와 같은 fixed 자료형·스케일이어야 합니다.', 'in');
  if (value.shape.length !== 1 || value.shape[0] !== B.shape[1]) fail(node, 'TYPED_STATE_SPACE_SHAPE', '입력은 B의 열 수와 같은 길이의 벡터여야 합니다.', 'in');
  if (value.unit !== node.outputs.out!.unit) fail(node, 'UNIT_MISMATCH', '상태 공간 입력·상태·출력은 같은 단위여야 합니다.', 'in');
  return true;
}

export function validateM10UnitSystems(ordered: readonly IRNode[]): void {
  const configurations = ordered.filter(node => node.blockType === 'signal.unit-system');
  if (configurations.length > 1) fail(configurations[1]!, 'UNIT_SYSTEM_CONFLICT', '프로젝트에는 한 개의 단위 허용 범위 설정만 사용할 수 있습니다.');
  const configuration = configurations[0];
  if (!configuration) return;
  const allowed = new Set(configuration.parameters.unitAllowlist as string[]);
  for (const node of ordered) for (const [port, descriptor] of Object.entries(node.outputs)) if (!allowed.has(descriptor.unit)) fail(node, 'UNIT_SYSTEM_SCOPE', `출력 단위 ${descriptor.unit}는 프로젝트 허용 범위에 없습니다.`, port);
}
