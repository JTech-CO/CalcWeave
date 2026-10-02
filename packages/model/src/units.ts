import { ModelError } from './types';
import { UNITS } from './signal';

type Dimensions = readonly [number, number, number, number, number, number, number, number];
interface UnitDefinition { dimensions: Dimensions; scale: number; offset: number }
const dimensions = (length = 0, time = 0, mass = 0, current = 0, temperature = 0, amount = 0, luminous = 0, angle = 0): Dimensions => [length, time, mass, current, temperature, amount, luminous, angle];
/** Value in base units = value * scale + offset. Angles retain their own dimension. */
const UNIT_DEFINITIONS: Readonly<Record<string, UnitDefinition>> = Object.freeze({
  '1': { dimensions: dimensions(), scale: 1, offset: 0 },
  m: { dimensions: dimensions(1), scale: 1, offset: 0 },
  cm: { dimensions: dimensions(1), scale: 0.01, offset: 0 },
  mm: { dimensions: dimensions(1), scale: 0.001, offset: 0 },
  km: { dimensions: dimensions(1), scale: 1000, offset: 0 },
  s: { dimensions: dimensions(0, 1), scale: 1, offset: 0 },
  ms: { dimensions: dimensions(0, 1), scale: 0.001, offset: 0 },
  min: { dimensions: dimensions(0, 1), scale: 60, offset: 0 },
  kg: { dimensions: dimensions(0, 0, 1), scale: 1, offset: 0 },
  g: { dimensions: dimensions(0, 0, 1), scale: 0.001, offset: 0 },
  A: { dimensions: dimensions(0, 0, 0, 1), scale: 1, offset: 0 },
  K: { dimensions: dimensions(0, 0, 0, 0, 1), scale: 1, offset: 0 },
  C: { dimensions: dimensions(0, 0, 0, 0, 1), scale: 1, offset: 273.15 },
  mol: { dimensions: dimensions(0, 0, 0, 0, 0, 1), scale: 1, offset: 0 },
  cd: { dimensions: dimensions(0, 0, 0, 0, 0, 0, 1), scale: 1, offset: 0 },
  rad: { dimensions: dimensions(0, 0, 0, 0, 0, 0, 0, 1), scale: 1, offset: 0 },
  deg: { dimensions: dimensions(0, 0, 0, 0, 0, 0, 0, 1), scale: Math.PI / 180, offset: 0 },
  V: { dimensions: dimensions(2, -3, 1, -1), scale: 1, offset: 0 },
  mV: { dimensions: dimensions(2, -3, 1, -1), scale: 0.001, offset: 0 },
  Hz: { dimensions: dimensions(0, -1), scale: 1, offset: 0 },
  N: { dimensions: dimensions(1, -2, 1), scale: 1, offset: 0 },
  Pa: { dimensions: dimensions(-1, -2, 1), scale: 1, offset: 0 },
  J: { dimensions: dimensions(2, -2, 1), scale: 1, offset: 0 },
  W: { dimensions: dimensions(2, -3, 1), scale: 1, offset: 0 },
  'm/s': { dimensions: dimensions(1, -1), scale: 1, offset: 0 },
  'm/s^2': { dimensions: dimensions(1, -2), scale: 1, offset: 0 },
  'm^2': { dimensions: dimensions(2), scale: 1, offset: 0 },
});
function unitDefinition(unit: string): UnitDefinition {
  if (!Object.hasOwn(UNIT_DEFINITIONS, unit)) throw new ModelError([{ code: 'UNSUPPORTED_UNIT', message: `지원하지 않는 단위 ${unit}입니다.` }]);
  return UNIT_DEFINITIONS[unit]!;
}
export function compatibleUnits(from: string, to: string): boolean {
  const a = unitDefinition(from), b = unitDefinition(to);
  return a.dimensions.every((value, index) => value === b.dimensions[index]);
}
/** Explicit affine conversion; incompatible dimensions never silently pass. */
export function conversionCoefficients(from: string, to: string): { scale: number; offset: number } {
  const a = unitDefinition(from), b = unitDefinition(to);
  if (!compatibleUnits(from, to)) throw new ModelError([{ code: 'UNIT_MISMATCH', message: `${from}와 ${to}는 호환되지 않는 단위입니다.` }]);
  return { scale: a.scale / b.scale, offset: (a.offset - b.offset) / b.scale };
}
function combinedUnit(left: string, right: string, sign: 1 | -1): string {
  const a = unitDefinition(left), b = unitDefinition(right);
  if (a.offset || b.offset) throw new ModelError([{ code: 'UNIT_OPERATION_UNSUPPORTED', message: '섭씨와 같은 오프셋 단위는 K로 명시적으로 변환한 뒤 계산하세요.' }]);
  const target = a.dimensions.map((value, index) => value + sign * b.dimensions[index]!);
  const scale = sign === 1 ? a.scale * b.scale : a.scale / b.scale;
  const match = UNITS.find((unit) => {
    const candidate = UNIT_DEFINITIONS[unit]!;
    return candidate.offset === 0 && candidate.scale === scale && candidate.dimensions.every((value, index) => value === target[index]);
  });
  if (!match) throw new ModelError([{ code: 'UNIT_OPERATION_UNSUPPORTED', message: `${left} ${sign === 1 ? '×' : '÷'} ${right}의 결과 단위는 승인 목록에 없습니다. 기본 단위로 변환하거나 지원 단위를 사용하세요.` }]);
  return match;
}
export function multiplyUnits(left: string, right: string): string { return combinedUnit(left, right, 1); }
export function divideUnits(left: string, right: string): string { return combinedUnit(left, right, -1); }
export function squareUnit(unit: string): string { return multiplyUnits(unit, unit); }
export function reciprocalUnit(unit: string): string { return divideUnits('1', unit); }
export function sqrtUnit(unit: string): string {
  const value = unitDefinition(unit);
  if (value.offset) throw new ModelError([{ code: 'UNIT_OPERATION_UNSUPPORTED', message: '오프셋 단위의 제곱근은 지원하지 않습니다.' }]);
  const target = value.dimensions.map((item) => item / 2), scale = Math.sqrt(value.scale);
  const match = UNITS.find((candidate) => {
    const definition = UNIT_DEFINITIONS[candidate]!;
    return definition.offset === 0 && definition.scale === scale && definition.dimensions.every((item, index) => item === target[index]);
  });
  if (!match) throw new ModelError([{ code: 'UNIT_OPERATION_UNSUPPORTED', message: `${unit}의 제곱근 단위는 승인 목록에 없습니다.` }]);
  return match;
}
