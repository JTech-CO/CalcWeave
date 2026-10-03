import { describe, expect, it } from 'vitest';
import { createExample, EXAMPLES } from '../apps/web/src/examples';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { parseModel, serializeModel, type BusSignal } from '../packages/model/src';

describe('M12 actual learning-model execution', () => {
  it.each(EXAMPLES.filter(example => example.category === 'solver').map(example => example.id))('%s calculates independent literal or analytic expectations and preserves the source', async id => {
    const model = createExample(id), before = serializeModel(model), result = await runModel(compileModel(model));
    expect(result.status).toBe('completed'); expect(serializeModel(model)).toBe(before);
    const values = result.samples.at(-1)!.values;
    if (id === 'stiff-implicit-decay') {
      expect(result.solverStatistics?.method).toBe('implicit-euler');
      for (const sample of result.samples) expect(Math.abs(Number(sample.values.result) - Math.exp(-1000 * sample.time))).toBeLessThan(.004);
      expect(Number(values.result)).toBeGreaterThan(0); expect(Number(values.result)).toBeLessThan(.008);
    } else if (id === 'algebraic-square-root') {
      for (const sample of result.samples) { expect(sample.values.result).toBeCloseTo(3, 7); expect(Math.abs(Number(sample.values.result) ** 2 - 9)).toBeLessThan(1e-7); }
    } else if (id === 'descriptor-index-one') {
      expect(values.result).toBeCloseTo(2 - Math.exp(-1), 6);
      const state = values['state-result'] as number[]; expect(state[0]).toBeCloseTo(1 - Math.exp(-1), 6); expect(state[1]).toBeCloseTo(1, 10);
    } else if (id === 'variable-delay-vs-transport') {
      expect(values['time-result']).toBeCloseTo(.75, 7); expect(values['transport-result']).toBeCloseTo(.5, 6);
      expect(result.samples[0]!.values).toEqual({ 'time-result': -1, 'transport-result': -1 });
    } else if (id === 'continuous-state-limits') {
      expect(values['first-result']).toBeCloseTo(1, 7); expect(values['second-result']).toBeCloseTo(.25, 7); expect(values['velocity-result']).toBe(0); expect(values['limit-result']).toBe(true);
      expect(result.events?.some(event => event.nodeIds.includes('first'))).toBe(true); expect(result.events?.some(event => event.nodeIds.includes('second'))).toBe(true);
    } else if (id === 'backlash-and-rate-bounds') {
      expect(values['backlash-result']).toBeCloseTo(-.5, 7);
      for (const key of ['rate-result', 'dynamic-result']) for (let index = 1; index < result.samples.length; index++) {
        const previous = result.samples[index - 1]!, current = result.samples[index]!;
        expect(Math.abs(Number(current.values[key]) - Number(previous.values[key]))).toBeLessThanOrEqual(.5 * (current.time - previous.time) + 1e-9);
      }
    } else if (id === 'pid-two-degree-weighting') {
      expect(values['weighted-result']).toBeCloseTo(1, 12); expect(values['plain-result']).toBeCloseTo(2, 12);
      expect(result.samples[0]!.values).toEqual({ 'weighted-result': 0, 'plain-result': 0 });
    } else if (id === 'local-linearization-requests') {
      for (const key of ['timed-result', 'triggered-result']) {
        const bus = values[key] as BusSignal; expect(bus.kind).toBe('bus'); expect(bus.fields.map(field => field.name)).toEqual(['A', 'B', 'C', 'D']);
        for (const [index, expected] of [-2, 3, 4, 5].entries()) expect((bus.fields[index]!.value as number[][])[0]![0]).toBeCloseTo(expected, 8);
      }
      expect(((result.samples[0]!.values['triggered-result'] as BusSignal).fields[0]!.value as number[][])[0]![0]).toBe(0);
    }
    const imported = parseModel(JSON.parse(before)); imported.nodes.reverse(); imported.edges.reverse();
    expect((await runModel(compileModel(imported))).samples).toEqual(result.samples);
  }, 20_000);
});
