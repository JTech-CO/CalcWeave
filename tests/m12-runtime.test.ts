import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { ModelError, type RunResult } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { M12_INDEPENDENT_DEFINITION_FIXTURES, M12_INDEPENDENT_BOUNDARY_FIXTURES, M12_INDEPENDENT_FAILURE_FIXTURES } from './m12-independent-fixtures';
function near(actual: unknown, expected: unknown, tolerance: number): void {
  if (typeof expected === 'number') { expect(typeof actual).toBe('number'); expect(Math.abs((actual as number) - expected) / Math.max(1, Math.abs(expected))).toBeLessThanOrEqual(tolerance); }
  else if (Array.isArray(expected)) { expect(Array.isArray(actual)).toBe(true); expect((actual as unknown[]).length).toBe(expected.length); expected.forEach((value, index) => near((actual as unknown[])[index], value, tolerance)); }
  else if (expected && typeof expected === 'object') { expect(Object.keys(actual as object).sort()).toEqual(Object.keys(expected).sort()); Object.entries(expected).forEach(([key, value]) => near((actual as Record<string, unknown>)[key], value, tolerance)); }
  else expect(actual).toEqual(expected);
}
describe('M12 actual compiled independent numerical models', () => {
  for (const fixture of [...M12_INDEPENDENT_DEFINITION_FIXTURES, ...M12_INDEPENDENT_BOUNDARY_FIXTURES]) for (const mode of fixture.declaredModes) it(`${fixture.name}/${mode}`, async () => {
    const model = structuredClone(fixture.model); model.execution.mode = mode; const compiled = compileModel(model), result = await runModel(compiled, { maxWallMs: 120000 });
    expect(result.status).toBe('completed'); expect(Object.keys(fixture.expected).sort()).toEqual([...compiled.outputIds].sort());
    for (const [id, series] of Object.entries(fixture.expected)) { expect(result.samples.length).toBe(series.length); series.forEach((value, index) => near(result.samples[index]!.values[id], value, fixture.oracleTolerance)); }
    if (fixture.expectedFinalState) near(result.finalState, fixture.expectedFinalState, fixture.oracleTolerance);
    if (fixture.expectedStateMemory) near(result.stateMemory, fixture.expectedStateMemory, fixture.oracleTolerance);
    if (fixture.name.includes('implicit-stiff')) { expect(result.solverStatistics!.rejectedSteps).toBeGreaterThan(0); expect(result.solverStatistics!.method).toBe('implicit-euler'); }
  }, 120000);
  for (const fixture of M12_INDEPENDENT_FAILURE_FIXTURES) it(`${fixture.name}/${fixture.code}`, async () => {
    let failure: ModelError | undefined;
    try { await runModel(compileModel(fixture.model)); } catch (error) { expect(error).toBeInstanceOf(ModelError); failure = error as ModelError; }
    expect(failure?.diagnostics[0]?.code).toBe(fixture.code);
    if (fixture.expectedPartial) { const partial = failure!.partialResult as RunResult; expect(partial.samples.length).toBe(fixture.expectedPartial.samples); if (fixture.expectedPartial.finalState) near(partial.finalState, fixture.expectedPartial.finalState, fixture.oracleTolerance ?? 1e-10); if (fixture.expectedPartial.stateMemory) near(partial.stateMemory, fixture.expectedPartial.stateMemory, fixture.oracleTolerance ?? 1e-10); }
  });
});
