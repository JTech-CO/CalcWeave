import { describe, expect, it } from 'vitest';
import { BLOCK_REGISTRY } from '../packages/block-library/src';
import { BLOCK_SYMBOLS, getBlockSymbol } from '../apps/web/src/block-symbols';

describe('block library symbols', () => {
  it('provides a visible, compact symbol for every block actually offered by the library', () => {
    for (const definition of BLOCK_REGISTRY) {
      expect(Object.hasOwn(BLOCK_SYMBOLS, definition.id), `${definition.englishName} has an explicit symbol`).toBe(true);
      const symbol = getBlockSymbol(definition.id);
      expect(symbol, `${definition.id} cannot render an empty icon`).toMatch(/\S/u);
      expect(Array.from(symbol).length, `${definition.id} fits a compact icon`).toBeLessThanOrEqual(5);
      expect(symbol).not.toMatch(/[\p{Cc}\p{Cf}\p{Cs}]/u);
    }
  });

  it('preserves meaningful marks for previously blank mathematical blocks and never reflects unknown IDs', () => {
    const corrected = ['nonlinear.friction', 'nonlinear.dead-zone-dynamic', 'nonlinear.saturation-dynamic', 'nonlinear.wrap-to-zero', 'math.signed-sqrt'];
    const symbols = corrected.map(getBlockSymbol);
    expect(new Set(symbols).size).toBe(corrected.length);
    expect(symbols).not.toContain(getBlockSymbol('future.unknown-block'));
    expect(getBlockSymbol('math.signed-sqrt')).toContain('√');
    expect(getBlockSymbol('nonlinear.wrap-to-zero')).toContain('0');
    for (const id of ['future.unknown-block', '__proto__', 'constructor', 'toString', '', '<img src=x onerror=alert(1)>']) {
      expect(getBlockSymbol(id)).toBe('B');
    }
    expect(Object.isFrozen(BLOCK_SYMBOLS)).toBe(true);
  });
});
