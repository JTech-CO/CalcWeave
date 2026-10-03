import { describe, expect, it } from 'vitest';
import { analyzeExpressionGradient, compareModelResolution } from '../packages/analysis/src';
import type { CalcModel } from '../packages/model/src';

const decay = (): CalcModel => ({ schemaVersion: 1, modelId: 'Resolution', name: 'Decay resolution', nodes: [{ id: 'State', blockType: 'continuous.integrator', blockVersion: 1, label: 'State', parameters: { initial: 1 } }, { id: 'Rate', blockType: 'math.gain', blockVersion: 1, label: 'Rate', parameters: { gain: -1 } }, { id: 'Result', blockType: 'sink.scope', blockVersion: 1, label: 'Result', parameters: {} }], edges: [{ id: 'Rate', source: { nodeId: 'State', portId: 'out' }, target: { nodeId: 'Rate', portId: 'in' } }, { id: 'Loop', source: { nodeId: 'Rate', portId: 'out' }, target: { nodeId: 'State', portId: 'in' } }, { id: 'Result', source: { nodeId: 'State', portId: 'out' }, target: { nodeId: 'Result', portId: 'in' } }], layout: {}, execution: { mode: 'continuous', startTime: 0, stopTime: 2, step: 1, solver: { method: 'rk4', initialStep: 1, maxStep: 1 } } });

describe('M12 public gradient and actual resolution tools', () => {
  it.each([['x^3', 3, 27], ['sin(x)', 0, 1], ['exp(x)', 0, 1], ['log(x)', 2, 0.5], ['x*x+2*x', -4, -6]] as const)('compares h/h2 against analytic gradient of %s', (source, x, expected) => {
    const result = analyzeExpressionGradient(source, x); expect(result.derivative).toBeCloseTo(expected, 8); expect(result.evaluations).toBe(5); expect(Number.isFinite(result.differenceEstimate)).toBe(true);
  });
  it.each(['abs(x)', 'floor(x)', 'min(x,1)', 'x.constructor', 'globalThis.process.exit()'])('rejects non-smooth or executable source %s', source => expect(() => analyzeExpressionGradient(source, 0)).toThrow());
  it('rejects excessive point, unresolved difference and unsupported step before evaluation', () => {
    for (const [x, h] of [[Infinity, 1e-4], [1e13, 1e-4], [0, 1e-12], [0, 1]]) expect(() => analyzeExpressionGradient('x', x!, h!)).toThrow();
  });
  it('executes two distinct real RK4 resolutions on the same grid and improves analytic decay', async () => {
    const model = decay(), before = JSON.stringify(model), result = await compareModelResolution(model);
    expect(JSON.stringify(model)).toBe(before); expect(result.status).toBe('completed'); expect(result.samplesCompared).toBe(3); expect(result.elementsCompared).toBe(3);
    expect(result.coarse.samples.map(x => x.time)).toEqual([0, 1, 2]); expect(result.fine!.samples.map(x => x.time)).toEqual([0, 1, 2]);
    expect(result.coarse.samples[1]!.values.Result).toBeCloseTo(0.375, 14);
    const reference = Math.exp(-2), coarse = Number(result.coarse.samples[2]!.values.Result), fine = Number(result.fine!.samples[2]!.values.Result);
    expect(Math.abs(fine - reference)).toBeLessThan(Math.abs(coarse - reference)); expect(result.maximumAbsoluteDifference).toBeCloseTo(0.00682915581597222, 14);
    expect(result.coarse.solverStatistics!.acceptedSteps).toBe(2); expect(result.fine!.solverStatistics!.acceptedSteps).toBe(4);
  });
  it('accepts cancellation without manufacturing a comparison and retains last complete samples', async () => {
    const controller = new AbortController(); controller.abort(); const result = await compareModelResolution(decay(), 2, controller.signal);
    expect(result.status).toBe('cancelled'); expect(result.outputs).toEqual([]); expect(result.fine).toBeUndefined();
  });
  it('rejects unbounded ratio and non-continuous models', async () => {
    await expect(compareModelResolution(decay(), 9)).rejects.toThrow(); const model = decay(); model.execution.mode = 'discrete'; await expect(compareModelResolution(model)).rejects.toThrow();
  });
});
