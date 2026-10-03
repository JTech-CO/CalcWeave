import { ModelError } from '../../model/src/types';

/** Encode validated compiler data as literals. Strings/keys remain JSON-escaped data. */
export function executionLiteral(value: unknown): string {
  let cells = 0;
  const encode = (value: unknown, depth: number): string => {
    if (++cells > 2_000_000 || depth > 64) throw new ModelError([{ code: 'EXPORT_RESOURCE_LIMIT', message: '생성 IR의 구조 상한을 초과했습니다.' }]);
    if (typeof value === 'number') return Object.is(value, -0) ? '-0' : JSON.stringify(value);
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    if (Array.isArray(value)) return '[' + value.map(item => encode(item, depth + 1)).join(',') + ']';
    if (typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      return '{' + Object.entries(Object.getOwnPropertyDescriptors(value)).filter(([, property]) => 'value' in property && property.value !== undefined).map(([key, property]) => JSON.stringify(key) + ':' + encode(property.value, depth + 1)).join(',') + '}';
    }
    throw new ModelError([{ code: 'EXPORT_INVALID_IR', message: '승인된 데이터만 코드로 내보낼 수 있습니다.' }]);
  };
  return encode(value, 0);
}
