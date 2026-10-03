import { ModelError, type SignalDescriptor } from './types';
import { typedStorageElements } from './typed';
import { structuredStorageElements } from './structured';

export const UNITS = Object.freeze(['1', 'm', 'cm', 'mm', 'km', 's', 'ms', 'min', 'kg', 'g', 'A', 'K', 'C', 'mol', 'cd', 'rad', 'deg', 'V', 'mV', 'Hz', 'N', 'Pa', 'J', 'W', 'm/s', 'm/s^2', 'm^2'] as const);
export const SIGNAL_LIMITS = Object.freeze({ maxElements: 1_024, maxAxis: 1_024, maxIntermediateElements: 100_000 });

function invalid(message: string): never { throw new ModelError([{ code: 'INVALID_SIGNAL', message }]); }

/** Inspect arrays without invoking accessors; finite, homogeneous, dense JSON values only. */
function arrayItems(value: unknown[]): unknown[] {
  if (Object.getPrototypeOf(value) !== Array.prototype || value.length === 0 || value.length > SIGNAL_LIMITS.maxAxis) {
    invalid('배열은 1~1,024개 원소를 가진 일반 배열이어야 합니다.');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) invalid('배열에는 빈 칸이나 추가 속성을 사용할 수 없습니다.');
  const items: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) invalid('배열에는 빈 칸이나 접근자를 사용할 수 없습니다.');
    items.push(descriptor.value);
  }
  return items;
}

/** Infer a bounded signal shape without converting boolean to numbers. */
export function validateSignal(value: unknown): SignalDescriptor {
  let valueType: SignalDescriptor['valueType'] | undefined;
  let count = 0;
  const scalar = (item: unknown): void => {
    const type = typeof item === 'number' && Number.isFinite(item) ? 'float64' : typeof item === 'boolean' ? 'boolean' : undefined;
    if (!type) invalid('신호 값은 유한한 float64 또는 boolean이어야 합니다.');
    if (valueType && type !== valueType) invalid('한 신호에는 숫자와 boolean을 섞을 수 없습니다.');
    valueType = type;
    if (++count > SIGNAL_LIMITS.maxElements) invalid('한 신호는 1,024개 원소 이하여야 합니다.');
  };
  let shape: number[] = [];
  if (Array.isArray(value)) {
    const items = arrayItems(value);
    if (Array.isArray(items[0])) {
      let columns = 0;
      for (const row of items) {
        if (!Array.isArray(row)) invalid('2D 신호의 모든 행은 같은 길이의 배열이어야 합니다.');
        const cells = arrayItems(row);
        if (!columns) columns = cells.length;
        if (cells.length !== columns) invalid('2D 신호의 모든 행은 같은 길이여야 합니다.');
        for (const item of cells) scalar(item);
      }
      shape = [items.length, columns];
    } else {
      for (const item of items) scalar(item);
      shape = [items.length];
    }
  } else scalar(value);
  return { valueType: valueType!, shape, unit: '1' };
}

export function signalElementCount(descriptor: SignalDescriptor): number {
  if (descriptor.valueType === 'bus' || descriptor.valueType === 'messages') return structuredStorageElements(descriptor);
  if (descriptor.valueType === 'typed') return typedStorageElements(descriptor);
  return descriptor.shape.reduce((product, length) => product * length, 1);
}

export function formatSignalShape(descriptor: SignalDescriptor): string {
  return descriptor.shape.length === 0 ? 'scalar' : descriptor.shape.length === 1 ? `vector[${descriptor.shape[0]}]` : `${descriptor.shape.length === 2 ? 'matrix' : 'tensor'}[${descriptor.shape.join('×')}]`;
}
