import { describe, expect, it } from 'vitest';
import { createExample } from '../apps/web/src/examples';
import { evaluateGuidedLesson, getGuidedLesson, GUIDED_LESSONS } from '../apps/web/src/learning';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { explainDiagram } from '../packages/analysis/src/diagram-equations';
import type { CalcModel, RunResult } from '../packages/model/src';

function parameters(model: CalcModel, id: string, values: Record<string, unknown>): void {
  Object.assign(model.nodes.find(node => node.id === id)!.parameters, values);
}
const execute = (model: CalcModel) => runModel(compileModel(model));

describe('M17 guided mathematical observations', () => {
  it('uses three real examples and keeps unknown lessons unavailable', () => {
    expect(GUIDED_LESSONS.map(lesson => lesson.exampleId)).toEqual(['first-calculation', 'discrete-feedback', 'continuous-decay']);
    for (const lesson of GUIDED_LESSONS) expect(createExample(lesson.exampleId).modelId).toBe(lesson.exampleId);
    expect(getGuidedLesson(null)).toBeUndefined();
    expect(getGuidedLesson('unknown')).toBeUndefined();
  });

  it('compares the default product to an independently known value', async () => {
    const model = createExample('first-calculation'), result = await execute(model);
    expect(result.samples[0].values.result).toBe(6);
    expect(evaluateGuidedLesson(model, 'first-calculation', result, true)).toMatchObject({
      status: 'verified', formula: 'y = 3 × 2', observations: [{ time: 0, expected: 6, actual: 6 }],
    });
  });

  it('derives edited values rather than relying on default example parameters', async () => {
    const model = createExample('first-calculation');
    parameters(model, 'value', { value: -2 }); parameters(model, 'gain', { gain: 4 });
    const assessment = evaluateGuidedLesson(model, 'first-calculation', await execute(model), true);
    expect(assessment.status).toBe('verified'); expect(assessment.observations[0].expected).toBe(-8);
    expect(assessment.formula).toBe('y = 4 × -2');
  });

  it('observes old delay state before the recurrence is committed', async () => {
    const model = createExample('discrete-feedback'), result = await execute(model);
    expect(result.samples.slice(0, 3).map(sample => sample.values.result)).toEqual([0, 1, 1.9]);
    const assessment = evaluateGuidedLesson(model, 'discrete-feedback', result, true);
    expect(assessment.status).toBe('verified'); expect(assessment.expectedSummary).toContain('10에 가까워집니다');
    expect(assessment.observations[0].actual).toBe(0);
  });

  it.each(['++', '+-', '-+', '--'])('accounts for Sum signs %s with nondefault gain and initial state', async signs => {
    const model = createExample('discrete-feedback');
    parameters(model, 'input', { value: 2 }); parameters(model, 'delay', { initial: 3 });
    parameters(model, 'gain', { gain: 0.5 }); parameters(model, 'sum', { signs });
    const result = await execute(model), a = signs[0] === '+' ? 2 : -2, b = signs[1] === '+' ? 0.5 : -0.5;
    expect(result.samples[1].values.result).toBe(a + b * 3);
    const assessment = evaluateGuidedLesson(model, 'discrete-feedback', result, true);
    expect(assessment.status).toBe('verified'); expect(assessment.observations[1].expected).toBe(a + b * 3);
  });

  it('uses actual recorded timestamps and a nonzero discrete start time', async () => {
    const model = createExample('discrete-feedback');
    model.execution = { mode: 'discrete', startTime: 2, stopTime: 4, step: 0.5 };
    const assessment = evaluateGuidedLesson(model, 'discrete-feedback', await execute(model), true);
    expect(assessment.status).toBe('verified'); expect(assessment.observations.map(row => row.time)).toEqual([2, 2.5, 3, 4]);
  });

  it('compares continuous integration against the exponential analytical solution', async () => {
    const model = createExample('continuous-decay'), result = await execute(model);
    expect(result.samples.at(-1)!.values.result).toBeCloseTo(Math.exp(-5), 7);
    const assessment = evaluateGuidedLesson(model, 'continuous-decay', result, true);
    expect(assessment.status).toBe('verified'); expect(assessment.observations.at(-1)!.expected).toBe(Math.exp(-5));
  });

  it('respects edited decay coefficients, initial values and a shifted start time', async () => {
    const model = createExample('continuous-decay');
    parameters(model, 'state', { initial: 2 }); parameters(model, 'gain', { gain: -2 });
    model.execution = { mode: 'continuous', startTime: 3, stopTime: 5, step: 0.025 };
    const assessment = evaluateGuidedLesson(model, 'continuous-decay', await execute(model), true);
    expect(assessment.status).toBe('verified'); expect(assessment.formula).toContain('x(3) = 2');
    expect(assessment.expectedSummary).toContain('(t − 3)'); expect(assessment.observations.at(-1)!.expected).toBe(2 * Math.exp(-4));
  });

  it('does not declare convergence for a gain above the recurrence stability range', async () => {
    const model = createExample('discrete-feedback'); parameters(model, 'gain', { gain: 1.1 });
    const assessment = evaluateGuidedLesson(model, 'discrete-feedback', await execute(model), true);
    expect(assessment.status).toBe('verified'); expect(assessment.expectedSummary).toContain('수렴 조건');
    expect(assessment.expectedSummary).not.toContain('가까워집니다');
  });

  it('requires an actual current run rather than treating a revealed hint as success', async () => {
    const model = createExample('first-calculation');
    expect(evaluateGuidedLesson(model, 'first-calculation', null, true)).toMatchObject({ status: 'awaiting-run', observations: [{ actual: null }] });
    const old = await execute(model); parameters(model, 'gain', { gain: 4 });
    const stale = evaluateGuidedLesson(model, 'first-calculation', old, false);
    expect(stale.status).toBe('stale'); expect(stale.observations[0]).toMatchObject({ expected: 8, actual: null });
    expect(evaluateGuidedLesson(model, 'first-calculation', old, true).status).toBe('difference');
  });

  it.each(['cancelled', 'failed'] as const)('does not assess a %s run as successful', async status => {
    const model = createExample('continuous-decay'), completed = await execute(model);
    const result: RunResult = { ...completed, status };
    const assessment = evaluateGuidedLesson(model, 'continuous-decay', result, true);
    expect(assessment.status).toBe('incomplete'); expect(assessment.observations.every(row => row.actual === null)).toBe(true);
  });

  it('requires all samples and checks interior values instead of only the endpoint', async () => {
    const model = createExample('discrete-feedback'), result = await execute(model);
    const truncated = { ...result, samples: result.samples.slice(0, 3) };
    expect(evaluateGuidedLesson(model, 'discrete-feedback', truncated, true).status).toBe('incomplete');
    const altered = structuredClone(result); altered.samples[8].values.result = 123;
    expect(evaluateGuidedLesson(model, 'discrete-feedback', altered, true).status).toBe('difference');
    const wrongGrid = structuredClone(result); wrongGrid.samples[8].time += 0.25;
    expect(evaluateGuidedLesson(model, 'discrete-feedback', wrongGrid, true).status).toBe('difference');
  });

  it('rejects changed wiring even when the original modelId is preserved', async () => {
    const model = createExample('first-calculation'), originalResult = await execute(model);
    model.edges[1].source.nodeId = 'value';
    expect(evaluateGuidedLesson(model, 'first-calculation', originalResult, true).status).toBe('mismatch');
    expect(explainDiagram(model).status).toBe('supported');
  });

  it('keeps general partial equation support separate from a lesson topology', () => {
    const model = createExample('first-calculation');
    model.nodes[1].blockType = 'math.sqrt'; model.nodes[1].parameters = {};
    const extra = { id: 'unknown-in-lesson', blockType: 'math.sinc', label: 'sinc', blockVersion: 1 as const, parameters: {} };
    model.nodes.push(extra); model.edges.push({ id: 'extra', source: { nodeId: 'value', portId: 'out' }, target: { nodeId: extra.id, portId: 'in' } });
    expect(explainDiagram(model).status).toBe('partial');
    expect(evaluateGuidedLesson(model, 'first-calculation', null, true).status).toBe('mismatch');
  });

  it('does not flatten multi-rate or reset options into a simple recurrence', () => {
    const reset = createExample('discrete-feedback'); parameters(reset, 'delay', { reset: 'level' });
    expect(evaluateGuidedLesson(reset, 'discrete-feedback', null, true).status).toBe('mismatch');
    const rate = createExample('discrete-feedback');
    for (const node of rate.nodes) node.sampleTime = { period: 2, offset: 0 };
    expect(evaluateGuidedLesson(rate, 'discrete-feedback', null, true).status).toBe('mismatch');
  });

  it('declines non-scalar inputs and invalid numeric settings without throwing', () => {
    const array = createExample('first-calculation'); parameters(array, 'value', { value: [2, 3] });
    expect(evaluateGuidedLesson(array, 'first-calculation', null, true).status).toBe('mismatch');
    const invalid = createExample('first-calculation'); parameters(invalid, 'gain', { gain: Infinity });
    expect(evaluateGuidedLesson(invalid, 'first-calculation', null, true).status).toBe('mismatch');
  });

});
