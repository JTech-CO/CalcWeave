import { describe, expect, it } from 'vitest';
import { ModelError } from '../packages/model/src';
import { m12Jacobian, m12LinearSolve, m12Newton } from '../packages/runtime/src/numerics';
import { implicitEulerTrial } from '../packages/runtime/src/continuous-solver';

describe('M12 bounded independent numerical kernels', () => {
  it('pivots a real coupled system and owns inputs', () => {
    const a = [[0, 2], [1, -1]], b = [6, 1], before = structuredClone(a);
    expect(m12LinearSolve(a, b, 'linear').solution).toEqual([4, 3]); expect(a).toEqual(before); expect(b).toEqual([6, 1]);
  });
  it('rejects singular and poorly scaled systems with concrete pivots', () => {
    expect(() => m12LinearSolve([[1, 2], [2, 4]], [1, 2], 'singular')).toThrow(ModelError);
    expect(() => m12LinearSolve([[1, 0], [0, 1e-14]], [1, 1], 'ill')).toThrow(/pivot/);
  });
  it('computes central Jacobian of a nonlinear independent polynomial oracle', () => {
    const actual = m12Jacobian(([x, y]) => [x! * x! + 3 * y!, x! * y!], [2, -1], 'jacobian');
    expect(actual[0]![0]).toBeCloseTo(4, 9); expect(actual[0]![1]).toBeCloseTo(3, 9); expect(actual[1]![0]).toBeCloseTo(-1, 9); expect(actual[1]![1]).toBeCloseTo(2, 9);
  });
  it('uses damped Newton for a nonlinear root without mutating the seed', () => {
    const initial = [0.1], work: number[] = [];
    const result = m12Newton(([x]) => [x! * x! - 2], initial, { nodeId: 'root', atol: 1e-12, rtol: 1e-12, charge: value => work.push(value) });
    expect(result.state[0]).toBeCloseTo(1.4142135623730951, 10); expect(result.residual).toBeLessThan(1e-11); expect(initial).toEqual([0.1]); expect(work.every(Number.isSafeInteger)).toBe(true);
  });
  it('reports bounded failure for a residual without a real root', () => {
    expect(() => m12Newton(([x]) => [x! * x! + 1], [1], { nodeId: 'no-root', atol: 1e-12, rtol: 0 })).toThrow(ModelError);
  });
  it('backward Euler solves a stiff RHS rather than making an explicit or RK step', () => {
    const trial = implicitEulerTrial(0, [1], 0.1, (_t, [x]) => [-1000 * x!], { nodeId: 'stiff', atol: 1e-12, rtol: 1e-12 });
    // Exact independent rational: two backward half steps are (1+50)^-2.
    expect(trial.state[0]).toBeCloseTo(1 / 2601, 13); expect(trial.error[0]).toBeCloseTo(1 / 2601 - 1 / 101, 13);
  });
  it('preserves a constant RHS and finite empty-state execution', () => {
    expect(implicitEulerTrial(0, [2], 0.5, () => [4], { nodeId: 'constant', atol: 1e-12, rtol: 0 })).toEqual({ state: [4], error: [0] });
    expect(implicitEulerTrial(0, [], 1, () => [], { nodeId: 'empty', atol: 1e-12, rtol: 0 })).toEqual({ state: [], error: [] });
  });
  it('does not refund failed work or call beyond the dimension bound', () => {
    let called = false;
    expect(() => m12Newton(() => { called = true; return []; }, Array(65).fill(0), { nodeId: 'large', atol: 1e-8, rtol: 1e-6 })).toThrow(/차원/); expect(called).toBe(false);
    expect(() => m12Newton(([x]) => [x! - 1], [0], { nodeId: 'budget', atol: 1e-12, rtol: 0, charge: () => { throw new Error('budget'); } })).toThrow('budget');
  });
});
