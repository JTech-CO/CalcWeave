import { ModelError, type BusSignal, type MessageSignal, type SignalDescriptor, type SignalValue, type StateValue } from './types';
import { cloneTypedSignal, typedDescriptor, typedStorageElements, validateDataType, validateTypedShape, validateTypedSignal } from './typed';
import { UNITS, validateSignal } from './signal';

export const STRUCTURED_LIMITS = Object.freeze({ maxDepth: 8, maxFields: 16, maxBatch: 64, maxElements: 1024, maxStorage: 100000 });
function structuredFailure(message: string): never { throw new ModelError([{ code: 'INVALID_STRUCTURED_SIGNAL', message }]); }
function structuredRecord(value: unknown, keys: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) structuredFailure('일반 JSON 객체만 사용할 수 있습니다.');
  const properties = Object.getOwnPropertyDescriptors(value);
  const names = Reflect.ownKeys(properties);
  if (keys.some(name => !Object.hasOwn(properties, name)) || names.some(name => typeof name !== 'string' || !keys.includes(name) && !optional.includes(name))) structuredFailure('구조화 신호의 필수 키를 확인하세요.');
  const result: Record<string, unknown> = {};
  for (const name of names as string[]) {
    const property = properties[name];
    if (!property || !('value' in property) || !property.enumerable) structuredFailure('접근자·숨긴 속성은 사용할 수 없습니다.');
    result[name] = property.value;
  }
  return result;
}
function structuredArray(value: unknown, maximum: number, empty = false): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || (!empty && value.length === 0)) structuredFailure('구조화 배열의 길이 상한을 확인하세요.');
  const properties = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(properties).length !== value.length + 1) structuredFailure('배열의 빈 칸·추가 속성은 사용할 수 없습니다.');
  return Array.from({ length: value.length }, (_, index) => {
    const property = properties[String(index)];
    if (!property || !('value' in property) || !property.enumerable) structuredFailure('배열 접근자는 사용할 수 없습니다.');
    return property.value;
  });
}
function structuredName(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) && !Object.getOwnPropertyNames(Object.prototype).includes(value) && value !== 'prototype';
}
export function isStructuredSignal(value: unknown): value is BusSignal | MessageSignal {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const property = Object.getOwnPropertyDescriptor(value, 'kind');
  return !!property && 'value' in property && (property.value === 'bus' || property.value === 'messages');
}
/** Own-property inspection precedes reads. Payloads cannot contain messages, including through a bus. */
export function validateAnySignal(value: unknown): SignalValue {
  const inspect = (item: unknown, depth: number, payload: boolean): SignalValue => {
    if (depth > STRUCTURED_LIMITS.maxDepth) structuredFailure('구조화 신호는 깊이8 이하여야 합니다.');
    if (!item || typeof item !== 'object' || Array.isArray(item)) { validateSignal(item); return copyAnySignal(item as SignalValue); }
    const kind = Object.getOwnPropertyDescriptor(item, 'kind');
    if (!kind || !('value' in kind)) structuredFailure('신호 kind를 확인하세요.');
    if (kind.value === 'typed') return validateTypedSignal(item);
    if (kind.value === 'bus') {
      const record = structuredRecord(item, ['kind', 'fields']);
      const seen = new Set<string>();
      const fields = structuredArray(record.fields, STRUCTURED_LIMITS.maxFields).map(field => {
        const record = structuredRecord(field, ['name', 'value']);
        if (!structuredName(record.name) || seen.has(record.name)) structuredFailure('Bus 필드 이름은 안전하고 고유해야 합니다.');
        seen.add(record.name);
        return { name: record.name, value: inspect(record.value, depth + 1, payload) };
      });
      return { kind: 'bus', fields };
    }
    if (kind.value === 'messages' && !payload) {
      const record = structuredRecord(item, ['kind', 'items']);
      const identities = new Set<string>();
      const items = structuredArray(record.items, STRUCTURED_LIMITS.maxBatch, true).map(item => {
        const record = structuredRecord(item, ['producer', 'sequence', 'time', 'priority', 'payload']);
        if (!structuredName(record.producer) || typeof record.sequence !== 'number' || !Number.isSafeInteger(record.sequence) || record.sequence < 0
          || typeof record.time !== 'number' || !Number.isFinite(record.time) || Math.abs(record.time) > 1e9
          || typeof record.priority !== 'number' || !Number.isSafeInteger(record.priority) || Math.abs(record.priority) > 1e6) structuredFailure('메시지 식별자·시각·우선순위 상한을 확인하세요.');
        const identity = `${record.producer}:${record.sequence}`;
        if (identities.has(identity)) structuredFailure('한 batch의 메시지 식별자는 고유해야 합니다.');
        identities.add(identity);
        return { producer: record.producer, sequence: record.sequence, time: record.time, priority: record.priority, payload: inspect(record.payload, depth + 1, true) };
      });
      if (items.some(item => !sameSignalDescriptor(describeAnySignal(item.payload), describeAnySignal(items[0]!.payload)))) structuredFailure('메시지 batch의 payload 자료형·형상은 같아야 합니다.');
      return { kind: 'messages', items };
    }
    structuredFailure('알 수 없는 신호이거나 메시지를 payload로 중첩했습니다.');
  };
  const result = inspect(value, 0, false);
  const logical = (value: SignalValue): number => isStructuredSignal(value) ? value.kind === 'bus'
    ? value.fields.reduce((sum, field) => sum + logical(field.value), 0)
    : value.items.reduce((sum, item) => sum + logical(item.payload), 0)
    : typeof value === 'object' && !Array.isArray(value) ? value.data.length : validateSignal(value).shape.reduce((size, axis) => size * axis, 1);
  if (logical(result) > STRUCTURED_LIMITS.maxElements || structuredStorageElements(result) > STRUCTURED_LIMITS.maxStorage) structuredFailure('한 구조화 값은 논리1024개·가중 저장100000 이하여야 합니다.');
  return result;
}
export function validateStructuredSignal(value: unknown): BusSignal | MessageSignal {
  const signal = validateAnySignal(value);
  if (!isStructuredSignal(signal)) structuredFailure('Bus 또는 메시지 신호를 입력하세요.');
  return signal;
}
export function copyAnySignal(value: SignalValue): SignalValue {
  if (isStructuredSignal(value)) return value.kind === 'bus'
    ? { kind: 'bus', fields: value.fields.map(field => ({ name: field.name, value: copyAnySignal(field.value) })) }
    : { kind: 'messages', items: value.items.map(item => ({ ...item, payload: copyAnySignal(item.payload) })) };
  if (typeof value === 'object' && !Array.isArray(value)) return cloneTypedSignal(value);
  if (!Array.isArray(value)) return value;
  return (Array.isArray(value[0]) ? (value as number[][] | boolean[][]).map(row => [...row]) : [...value]) as SignalValue;
}
/** Internal checkpoints preserve IEEE signed zero; snapshots never call user hooks. */
export function copyStateValue(value: StateValue): StateValue {
  let cells = 0;
  const clone = (value: StateValue, depth: number): StateValue => {
    if (++cells > 2_000_000 || depth > 128) structuredFailure('상태 checkpoint 깊이 상한을 초과했습니다.');
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => clone(item, depth + 1));
    const properties = Object.getOwnPropertyDescriptors(value);
    const result: Record<string, StateValue> = {};
    for (const [key, property] of Object.entries(properties)) {
      if (!('value' in property) || !property.enumerable || ['__proto__', 'constructor', 'prototype'].includes(key)) structuredFailure('상태 checkpoint의 속성을 확인하세요.');
      result[key] = clone(property.value as StateValue, depth + 1);
    }
    return result;
  };
  return clone(value, 0);
}
export function describeAnySignal(value: SignalValue): SignalDescriptor {
  if (isStructuredSignal(value)) return value.kind === 'bus'
    ? { valueType: 'bus', shape: [], unit: '1', bus: { fields: value.fields.map(field => ({ name: field.name, descriptor: describeAnySignal(field.value) })) } }
    : { valueType: 'messages', shape: [], unit: '1', message: { payload: value.items.length ? describeAnySignal(value.items[0]!.payload) : { valueType: 'float64', shape: [], unit: '1' }, maxBatch: STRUCTURED_LIMITS.maxBatch } };
  return typeof value === 'object' && !Array.isArray(value) ? typedDescriptor(value) : validateSignal(value);
}
export function sameSignalDescriptor(a: SignalDescriptor, b: SignalDescriptor): boolean {
  const key = (d: SignalDescriptor): unknown => ({ valueType: d.valueType, shape: d.shape, unit: d.unit, typed: d.typed,
    fields: d.fields, bus: d.bus?.fields.map(field => ({ name: field.name, descriptor: key(field.descriptor) })), message: d.message ? { payload: key(d.message.payload) } : undefined });
  return JSON.stringify(key(a)) === JSON.stringify(key(b));
}
export function structuredStorageElements(value: SignalValue | SignalDescriptor): number {
  if ('valueType' in Object(value)) {
    const descriptor = value as SignalDescriptor;
    if (descriptor.valueType === 'bus') return 1 + (descriptor.bus?.fields.reduce((total, field) => total + 64 + structuredStorageElements(field.descriptor), 0) ?? 0);
    if (descriptor.valueType === 'messages') return 1 + (descriptor.message?.maxBatch ?? 64) * (80 + structuredStorageElements(descriptor.message!.payload));
    if (descriptor.valueType === 'typed') return typedStorageElements(descriptor);
    return descriptor.shape.reduce((total, axis) => total * axis, 1);
  }
  const signal = value as SignalValue;
  if (isStructuredSignal(signal)) return signal.kind === 'bus'
    ? 1 + signal.fields.reduce((total, field) => total + 64 + structuredStorageElements(field.value), 0)
    : 1 + signal.items.reduce((total, item) => total + 80 + structuredStorageElements(item.payload), 0);
  return typeof signal === 'object' && !Array.isArray(signal) ? typedStorageElements(signal) : structuredStorageElements(validateSignal(signal));
}
export function zeroAnySignal(descriptor: SignalDescriptor): SignalValue {
  if (descriptor.valueType === 'bus') return { kind: 'bus', fields: descriptor.bus!.fields.map(field => ({ name: field.name, value: zeroAnySignal(field.descriptor) })) };
  if (descriptor.valueType === 'messages') return { kind: 'messages', items: [] };
  if (descriptor.valueType === 'typed') {
    const type = descriptor.typed!;
    const element = type.dtype === 'complex128' ? { re: 0, im: 0 } : type.dtype === 'boolean' ? false : type.dtype === 'string' ? '' : type.dtype === 'enum' ? type.enum!.labels[0]! : type.dtype === 'float64' || type.dtype === 'float32' ? 0 : '0';
    return validateTypedSignal({ kind: 'typed', ...type, shape: descriptor.shape, data: Array.from({ length: descriptor.shape.reduce((total, axis) => total * axis, 1) }, () => element) });
  }
  const element = descriptor.valueType === 'boolean' ? false : 0;
  return descriptor.shape.length === 0 ? element : descriptor.shape.length === 1 ? Array(descriptor.shape[0]!).fill(element) as SignalValue : Array.from({ length: descriptor.shape[0]! }, () => Array(descriptor.shape[1]!).fill(element)) as SignalValue;
}
/** Validate imported port metadata as strictly as its value, before allocating zeros or state. */
export function validateAnyDescriptor(value: unknown): SignalDescriptor {
  const inspect = (value: unknown, depth: number, inPayload: boolean): SignalDescriptor => {
    if (depth > 8) structuredFailure('자료형 metadata의 깊이 상한을 초과했습니다.');
    const record = structuredRecord(value, ['valueType', 'shape', 'unit'], ['typed', 'fields', 'representation', 'bus', 'message']);
    if (!['float64', 'boolean', 'typed', 'bus', 'messages'].includes(String(record.valueType)) || typeof record.unit !== 'string' || !(UNITS as readonly string[]).includes(record.unit)) structuredFailure('자료형·단위를 확인하세요.');
    const shape = validateTypedShape(record.shape);
    const valueType = record.valueType as SignalDescriptor['valueType'];
    if (valueType !== 'typed' && shape.length > (valueType === 'bus' || valueType === 'messages' ? 0 : 2)) structuredFailure('선언한 자료형의 rank를 확인하세요.');
    const result: SignalDescriptor = { valueType, shape, unit: record.unit };
    if (valueType === 'typed') result.typed = validateDataType(record.typed);
    else if (record.typed !== undefined) structuredFailure('자료형 metadata를 자동 변환할 수 없습니다.');
    if (record.fields !== undefined) {
      const fields = structuredArray(record.fields, 16).map(name => { if (!structuredName(name)) structuredFailure('필드 이름을 확인하세요.'); return name; });
      if (new Set(fields).size !== fields.length || shape.length !== 1 || fields.length !== shape[0]) structuredFailure('동종 bus 필드와 형상이 다릅니다.');
      result.fields = fields;
    }
    if (record.representation !== undefined) {
      if (!['copy', 'virtual', 'nonvirtual'].includes(String(record.representation))) structuredFailure('신호 표현을 확인하세요.');
      result.representation = record.representation as SignalDescriptor['representation'];
    }
    if (valueType === 'bus') {
      if (record.unit !== '1' || record.message !== undefined || record.fields !== undefined) structuredFailure('Bus metadata를 확인하세요.');
      const bus = structuredRecord(record.bus, ['fields']);
      const fields = structuredArray(bus.fields, 16).map(value => { const field = structuredRecord(value, ['name', 'descriptor']); if (!structuredName(field.name)) structuredFailure('필드 이름을 확인하세요.'); return { name: field.name, descriptor: inspect(field.descriptor, depth + 1, inPayload) }; });
      if (new Set(fields.map(field => field.name)).size !== fields.length) structuredFailure('Bus 필드가 중복됩니다.');
      result.bus = { fields };
    } else if (record.bus !== undefined) structuredFailure('자료형과 bus 선언이 다릅니다.');
    if (valueType === 'messages') {
      if (inPayload || record.unit !== '1' || record.fields !== undefined) structuredFailure('메시지 payload에는 메시지를 중첩할 수 없습니다.');
      const message = structuredRecord(record.message, ['payload', 'maxBatch']);
      if (typeof message.maxBatch !== 'number' || !Number.isSafeInteger(message.maxBatch) || message.maxBatch < 1 || message.maxBatch > 64) structuredFailure('메시지 batch 상한을 확인하세요.');
      result.message = { payload: inspect(message.payload, depth + 1, true), maxBatch: message.maxBatch };
    } else if (record.message !== undefined) structuredFailure('자료형과 메시지 선언이 다릅니다.');
    if (structuredStorageElements(result) > 100000) structuredFailure('metadata의 저장 예산을 초과했습니다.');
    return result;
  };
  return inspect(value, 0, false);
}
