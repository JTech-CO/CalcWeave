import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { ModelError, type CalcEdge, type CalcModel, type CalcNode, type SignalValue } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';

const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters, ...(blockType === 'source.clock' ? { unit: '1' } : {}) });
const edge = (source: string, target: string, targetPort = 'in', sourcePort = 'out'): CalcEdge => ({ id: `${source}-${sourcePort}-${target}-${targetPort}`, source: { nodeId: source, portId: sourcePort }, target: { nodeId: target, portId: targetPort } });
function model(nodes: CalcNode[], edges: CalcEdge[], step = 0.1, stopTime = 1, solver: CalcModel['execution']['solver'] = {}): CalcModel {
  return { schemaVersion: 1, modelId: 'm3-runtime-test', name: 'M3 runtime test', nodes, edges, execution: { mode: 'continuous', startTime: 0, stopTime, step, solver }, layout: {} };
}
const number = (value: SignalValue | undefined): number => { if (typeof value !== 'number') throw new Error('Expected scalar'); return value; };
const values = (result: Awaited<ReturnType<typeof runModel>>, id = 'view'): number[] => result.samples.map((sample) => number(sample.values[id]));
function unary(type: string, parameters: Record<string, unknown>, source = node('source', 'source.constant', { value: 1 }), solver: CalcModel['execution']['solver'] = {}): CalcModel {
  return model([source, node('state', type, parameters), node('view', 'sink.scope')], [edge('source', 'state'), edge('state', 'view')], 0.1, 1, solver);
}

describe('M3 accepted continuous and hybrid execution', () => {
  it('reevaluates Clock at RK stages and integrates t exactly', async () => {
    const run = await runModel(compileModel(unary('continuous.integrator', {}, node('source', 'source.clock'))));
    run.samples.forEach((sample) => expect(number(sample.values.view)).toBeCloseTo(sample.time ** 2 / 2, 13));
    expect(run.solverStatistics).toMatchObject({ method: 'rk4', acceptedSteps: 10, rejectedSteps: 0 });
  });
  it('splits off-grid discontinuities and uses the left stage endpoint', async () => {
    const run = await runModel(compileModel(unary('continuous.transfer-function', { numerator: [1], denominator: [1, 1] }, node('source', 'source.step', { stepTime: 0.37 }), { maxStep: 0.02, initialStep: 0.02 })));
    run.samples.forEach((sample) => expect(number(sample.values.view)).toBeCloseTo(sample.time < 0.37 ? 0 : 1 - Math.exp(-(sample.time - 0.37)), 8));
  });
  it('integrates both second order states simultaneously', async () => {
    const m = model([node('state', 'continuous.second-order-integrator', { initialPosition: 1, initialVelocity: 0 }), node('negative', 'math.gain', { gain: -1 }), node('view', 'sink.scope'), node('velocity', 'sink.scope')], [edge('state', 'negative'), edge('negative', 'state'), edge('state', 'view'), edge('state', 'velocity', 'in', 'velocity')], 0.1, 1, { initialStep: 0.01, maxStep: 0.01 });
    const run = await runModel(compileModel(m));
    expect(values(run).at(-1)).toBeCloseTo(Math.cos(1), 9); expect(values(run, 'velocity').at(-1)).toBeCloseTo(-Math.sin(1), 9);
    expect(run.stateMemory?.state).toEqual({ state: [number(run.finalState.state), values(run, 'velocity').at(-1)] });
  });
  it.each([
    ['continuous.state-space', { A: [[-1]], B: [1], C: [1], D: 0, initial: [0] }],
    ['continuous.zero-pole', { zeros: [], poles: [-1], gain: 1, initial: [0] }],
  ])('has independent first order step response for %s', async (type, parameters) => {
    const run = await runModel(compileModel(unary(type as string, parameters as Record<string, unknown>, undefined, { initialStep: 0.01, maxStep: 0.01 })));
    expect(values(run).at(-1)).toBeCloseTo(1 - Math.exp(-1), 9);
  });
  it('implements parallel PID with filtered derivative state', async () => {
    const run = await runModel(compileModel(unary('continuous.pid', { kp: 2, ki: 1, kd: 0.5, filterN: 4 }, undefined, { initialStep: 0.005, maxStep: 0.005 })));
    run.samples.forEach((sample) => expect(number(sample.values.view)).toBeCloseTo(2 + sample.time + 2 * Math.exp(-4 * sample.time), 8));
  });
  it('Memory reads the previous accepted major-step input', async () => {
    const run = await runModel(compileModel(unary('time.memory', { initial: -1 }, node('source', 'source.clock'), { initialStep: 0.05, maxStep: 0.05 })));
    expect(values(run)[0]).toBe(-1); run.samples.slice(1).forEach((sample) => expect(number(sample.values.view)).toBeCloseTo(sample.time - 0.05, 13));
  });
  it('Transport Delay uses accepted causal history with prehistory initial', async () => {
    const run = await runModel(compileModel(unary('time.transport-delay', { delay: 0.15, initial: 0 }, node('source', 'source.clock'), { initialStep: 0.04, maxStep: 0.04 })));
    run.samples.forEach((sample) => expect(number(sample.values.view)).toBeCloseTo(Math.max(0, sample.time - 0.15), 12));
    const history = (run.stateMemory?.state as { history: { time: number; value: number }[] }).history;
    expect(history[0]!.time).toBeLessThanOrEqual(0.85); expect(history.length).toBeLessThan(10);
  });
  it('splits delayed prehistory and source jumps without interpolating across them', async () => {
    const m = model([node('source', 'source.step', { stepTime: 0.37, before: 1, after: 2 }), node('delay', 'time.transport-delay', { delay: 0.15, initial: 0 }), node('state', 'continuous.integrator'), node('view', 'sink.scope'), node('delayView', 'sink.scope')], [edge('source', 'delay'), edge('delay', 'state'), edge('state', 'view'), edge('delay', 'delayView')], 0.1, 1, { initialStep: 0.08, maxStep: 0.08 });
    const run = await runModel(compileModel(m));
    run.samples.forEach((sample) => { expect(number(sample.values.view)).toBeCloseTo(Math.max(0, sample.time - 0.15) + Math.max(0, sample.time - 0.52), 8); expect(number(sample.values.delayView)).toBe(sample.time < 0.15 ? 0 : sample.time < 0.52 ? 1 : 2); });
  });
  it('ZOH and causal FOH sample the current tick without looking ahead', async () => {
    const hold = node('state', 'time.zero-order-hold', { initial: -1 }); hold.sampleTime = { period: 2, offset: 0 };
    const m = model([node('clock', 'source.clock'), hold, node('view', 'sink.scope')], [edge('clock', 'state'), edge('state', 'view')], 0.05, 0.4, { discreteStep: 0.1, initialStep: 0.05, maxStep: 0.05 });
    const zoh = await runModel(compileModel(m)); expect(values(zoh)).toEqual([0, 0, 0, 0, 0.2, 0.2, 0.2, 0.2, 0.4]);
    m.nodes[1]!.blockType = 'time.first-order-hold';
    const foh = await runModel(compileModel(m)); foh.samples.forEach((sample) => expect(number(sample.values.view)).toBeCloseTo(sample.time < 0.2 ? 0 : sample.time, 12));
  });
  it.each(['time.zero-order-hold', 'time.first-order-hold'])('samples current discrete publication with %s', async (type) => {
    const clock = node('clock', 'source.digital-clock'); clock.unit = '1';
    const m = model([clock, node('gain', 'math.gain', { gain: 2 }), node('hold', type), node('view', 'sink.scope')], [edge('clock', 'gain'), edge('gain', 'hold'), edge('hold', 'view')], 0.1, 0.3, { discreteStep: 0.1 });
    const run = await runModel(compileModel(m)); run.samples.forEach((sample) => expect(number(sample.values.view)).toBeCloseTo(2 * sample.time, 13));
  });
  it.each(['time.zero-order-hold', 'time.first-order-hold'])('evaluates producer ancestry before %s and downstream reciprocal without a stale-zero failure', async (type) => {
    const clock = node('clock', 'source.digital-clock'); clock.unit = '1';
    const m = model([clock, node('gain', 'math.gain', { gain: 2 }), node('hold', type, { initial: 0 }), node('reciprocal', 'math.function', { operation: 'reciprocal' }), node('view', 'sink.scope')], [edge('clock', 'gain'), edge('gain', 'hold'), edge('hold', 'reciprocal'), edge('reciprocal', 'view')], 0.1, 1.3, { discreteStep: 0.1 });
    m.execution.startTime = 1;
    const run = await runModel(compileModel(m)); run.samples.forEach((sample) => expect(number(sample.values.view)).toBeCloseTo(1 / (2 * sample.time), 13));
  });
  it('captures hold chains from current publication in dependency order', async () => {
    const clock = node('clock', 'source.digital-clock'); clock.unit = '1';
    const m = model([clock, node('first', 'time.zero-order-hold'), node('gain', 'math.gain', { gain: 2 }), node('second', 'time.first-order-hold'), node('view', 'sink.scope')], [edge('clock', 'first'), edge('first', 'gain'), edge('gain', 'second'), edge('second', 'view')], 0.1, 0.3, { discreteStep: 0.1 });
    const run = await runModel(compileModel(m)); run.samples.forEach((sample) => expect(number(sample.values.view)).toBeCloseTo(2 * sample.time, 13));
  });
  it('preserves one RNG draw per due tick through multiple capture ancestors', async () => {
    const m = model([node('random', 'source.random', { seed: 0 }), node('holdA', 'time.zero-order-hold'), node('holdB', 'time.first-order-hold'), node('view', 'sink.scope'), node('other', 'sink.scope')], [edge('random', 'holdA'), edge('random', 'holdB'), edge('holdA', 'view'), edge('holdB', 'other')], 0.1, 0.3, { discreteStep: 0.1 });
    const run = await runModel(compileModel(m)); let seed = 0;
    run.samples.forEach((sample) => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; const expected = (seed + 0.5) / 4294967296; expect(sample.values.view).toBe(expected); expect(sample.values.other).toBe(expected); });
    expect(run.stateMemory!.random).toEqual({ seed });
  });
  it('preserves M2 Unit Delay publication inside an ODE', async () => {
    const m = model([node('constant', 'source.constant', { value: 1 }), node('hold', 'time.zero-order-hold'), node('delay', 'discrete.unit-delay'), node('integrator', 'continuous.integrator'), node('view', 'sink.scope')], [edge('constant', 'hold'), edge('hold', 'delay'), edge('delay', 'integrator'), edge('integrator', 'view')], 0.05, 0.5, { discreteStep: 0.1, initialStep: 0.02, maxStep: 0.02 });
    const run = await runModel(compileModel(m)); run.samples.forEach((sample) => expect(number(sample.values.view)).toBeCloseTo(Math.max(0, sample.time - 0.1), 12));
  });
  it.each([false, true])('publishes Rate Transition from global producer metadata including hold=%s', async (withHold) => {
    const source = node('source', 'source.constant', { value: 3 }); source.sampleTime = { period: 2, offset: 0 };
    const hold = node('hold', 'time.zero-order-hold'); hold.sampleTime = { period: 2, offset: 0 };
    const m = model([source, ...(withHold ? [hold] : []), node('transition', 'time.rate-transition', { initial: -1 }), node('view', 'sink.scope')], [...(withHold ? [edge('source', 'hold')] : []), edge(withHold ? 'hold' : 'source', 'transition'), edge('transition', 'view')], 0.1, 0.3, { discreteStep: 0.1 });
    const run = await runModel(compileModel(m)); expect(values(run)).toEqual([-1, 3, 3, 3]);
  });
  it('refines HitCrossing then resets and captures the post-reset value at a shared tick', async () => {
    const m = model([node('ramp', 'source.ramp'), node('crossing', 'logic.hit-crossing', { threshold: 0.5, direction: 'rising' }), node('one', 'source.constant'), node('state', 'continuous.integrator', { reset: 'rising' }), node('hold', 'time.zero-order-hold'), node('delay', 'discrete.unit-delay', { initial: -1 }), node('view', 'sink.scope'), node('delayed', 'sink.scope')], [edge('ramp', 'crossing'), edge('one', 'state'), edge('crossing', 'state', 'reset'), edge('state', 'hold'), edge('hold', 'delay'), edge('state', 'view'), edge('delay', 'delayed')], 0.25, 1, { discreteStep: 0.25, initialStep: 0.15, maxStep: 0.15, eventTolerance: 1e-10 });
    const run = await runModel(compileModel(m)); values(run).forEach((value, index) => expect(value).toBeCloseTo([0, 0.25, 0, 0.25, 0.5][index]!, 13)); values(run, 'delayed').forEach((value, index) => expect(value).toBeCloseTo([-1, 0, 0.25, 0, 0.25][index]!, 13));
    expect(run.events).toContainEqual({ time: 0.5, kind: 'crossing', nodeIds: ['crossing'] }); expect(run.events).toContainEqual({ time: 0.5, kind: 'reset', nodeIds: ['state'] });
  });
  it('does not reset an unrelated high boolean input when another HitCrossing fires', async () => {
    const m = model([node('one', 'source.constant'), node('true', 'source.constant', { value: true }), node('state', 'continuous.integrator', { reset: 'rising' }), node('ramp', 'source.ramp'), node('crossing', 'logic.hit-crossing', { threshold: 0.5, direction: 'rising' }), node('view', 'sink.scope'), node('hitView', 'sink.scope')], [edge('one', 'state'), edge('true', 'state', 'reset'), edge('ramp', 'crossing'), edge('state', 'view'), edge('crossing', 'hitView')], 0.25, 1);
    const run = await runModel(compileModel(m)); run.samples.forEach((sample) => expect(number(sample.values.view)).toBeCloseTo(sample.time, 13)); expect(run.events?.filter((event) => event.kind === 'reset')).toEqual([]);
  });
  it('locates hysteretic relay sine crossings and changes only accepted memory', async () => {
    const m = unary('nonlinear.relay', { onThreshold: 0.5, offThreshold: -0.5 }, node('source', 'source.sine-wave'), { initialStep: 0.03, maxStep: 0.03, eventTolerance: 1e-10 });
    const run = await runModel(compileModel(m)); expect(run.events?.filter((event) => event.kind === 'relay').map((event) => event.time)).toHaveLength(2);
    expect(run.events?.[0]!.time).toBeCloseTo(1 / 12, 9); expect(run.events?.[1]!.time).toBeCloseTo(7 / 12, 9);
  });
  it.each([[2, 'off', 1], [-2, 'on', 0], [0.5, 'off', 0], [0.5, 'on', 1]])('initializes Relay input %s from hysteresis band and configured state %s', async (input, initial, expected) => {
    const run = await runModel(compileModel(unary('nonlinear.relay', { onThreshold: 1, offThreshold: 0, initial }, node('source', 'source.constant', { value: input }))));
    expect(values(run)[0]).toBe(expected); expect(values(run).every((value) => value === expected)).toBe(true);
    expect(run.events?.length).toBe(input === 2 || input === -2 ? 1 : 0); if (run.events?.length) expect(run.events[0]!.time).toBe(0);
  });
  it('settles chained Relay publications at an off-grid source event', async () => {
    const m = model([node('step', 'source.step', { stepTime: 0.37, before: 0, after: 2 }), node('first', 'nonlinear.relay', { onThreshold: 1, offThreshold: 0, onValue: 2, offValue: 0 }), node('second', 'nonlinear.relay', { onThreshold: 1, offThreshold: 0 }), node('view', 'sink.scope')], [edge('step', 'first'), edge('first', 'second'), edge('second', 'view')], 0.1, 1);
    const run = await runModel(compileModel(m)); expect(values(run)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1]); expect(run.events?.filter((event) => event.kind === 'relay').every((event) => Math.abs(event.time - 0.37) < 1e-8)).toBe(true); expect(run.solverStatistics!.events).toBe(2);
  });
  it('processes relay and HitCrossing on discrete publication jumps', async () => {
    const m = model([node('pulse', 'source.pulse', { period: 4, width: 2, phase: 1 }), node('relay', 'nonlinear.relay', { onThreshold: 0.8, offThreshold: 0.2 }), node('hit', 'logic.hit-crossing', { threshold: 0.5, direction: 'either' }), node('view', 'sink.scope'), node('hitView', 'sink.scope')], [edge('pulse', 'relay'), edge('pulse', 'hit'), edge('relay', 'view'), edge('hit', 'hitView')], 0.1, 0.5, { discreteStep: 0.1 });
    const run = await runModel(compileModel(m)); expect(values(run)).toEqual([0, 1, 1, 0, 0, 1]); expect(run.samples.map((sample) => sample.values.hitView)).toEqual([false, true, false, true, false, true]);
    expect(run.events?.filter((event) => event.kind === 'relay')).toHaveLength(3);
  });
  it('records one reset for each held HitCrossing at a tick and recaptures FOH idempotently', async () => {
    const m = model([node('pulse', 'source.pulse', { period: 4, width: 2, amplitude: 1 }), node('hit', 'logic.hit-crossing', { threshold: 0.5, direction: 'either' }), node('one', 'source.constant'), node('state', 'continuous.integrator', { reset: 'rising' }), node('hold', 'time.first-order-hold'), node('view', 'sink.scope'), node('heldView', 'sink.scope')], [edge('pulse', 'hit'), edge('hit', 'state', 'reset'), edge('one', 'state'), edge('state', 'hold'), edge('state', 'view'), edge('hold', 'heldView')], 0.25, 1, { discreteStep: 0.25 });
    const run = await runModel(compileModel(m)); values(run).forEach((value, index) => expect(value).toBeCloseTo([0, 0.25, 0, 0.25, 0][index]!, 13)); expect(run.events).toHaveLength(6); expect(run.solverStatistics!.events).toBe(6); expect(values(run, 'heldView').every(Number.isFinite)).toBe(true);
  });
  it('fails a chattering relay boundary with no partially committed relay memory', async () => {
    const m = model([node('relay', 'nonlinear.relay', { onThreshold: 1, offThreshold: 0, initial: 'off', onValue: 0, offValue: 2 }), node('view', 'sink.scope')], [edge('relay', 'relay'), edge('relay', 'view')], 0.1, 1, { maxEvents: 3 });
    await expect(runModel(compileModel(m))).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'RUNTIME_EVENT_BUDGET', time: 0 })], partialResult: expect.objectContaining({ status: 'failed', steps: 0, stateMemory: { relay: { on: false } } }) });
  });
  it('RK45 rejects trials, meets independently known decay, and reports counts', async () => {
    const m = model([node('state', 'continuous.integrator', { initial: 1 }), node('gain', 'math.gain', { gain: -10 }), node('view', 'sink.scope')], [edge('state', 'gain'), edge('gain', 'state'), edge('state', 'view')], 0.5, 1, { method: 'rk45', initialStep: 0.5, maxStep: 0.5, atol: 1e-10, rtol: 1e-9 });
    const run = await runModel(compileModel(m)); expect(values(run).at(-1)).toBeCloseTo(Math.exp(-10), 9); expect(run.solverStatistics!.rejectedSteps).toBeGreaterThan(0); expect(run.solverStatistics!.evaluations).toBeGreaterThan(run.solverStatistics!.acceptedSteps * 7);
  });
  it('keeps internal RK steps independent of unused discreteStep and output spacing', async () => {
    const m = model([node('state', 'continuous.integrator', { initial: 1 }), node('gain', 'math.gain', { gain: -1 }), node('view', 'sink.scope')], [edge('state', 'gain'), edge('gain', 'state'), edge('state', 'view')], 1, 1, { discreteStep: 0.01, initialStep: 0.2, maxStep: 0.2 });
    const coarse = await runModel(compileModel(m)); m.execution.solver = { ...m.execution.solver, initialStep: 0.1, maxStep: 0.1 }; const fine = await runModel(compileModel(m));
    expect(coarse.solverStatistics!.acceptedSteps).toBe(5); expect(fine.solverStatistics!.acceptedSteps).toBe(10);
    const ratio = Math.abs(values(coarse).at(-1)! - Math.exp(-1)) / Math.abs(values(fine).at(-1)! - Math.exp(-1)); expect(ratio).toBeGreaterThan(15); expect(ratio).toBeLessThan(19);
  });
  it('keeps last accepted state and output when the first rejection exceeds its budget', async () => {
    const m = model([node('state', 'continuous.integrator', { initial: 1 }), node('gain', 'math.gain', { gain: -10 }), node('view', 'sink.scope')], [edge('state', 'gain'), edge('gain', 'state'), edge('state', 'view')], 0.5, 1, { method: 'rk45', initialStep: 0.5, maxStep: 0.5, atol: 1e-12, rtol: 1e-12, maxRejects: 0 });
    let error: unknown; try { await runModel(compileModel(m)); } catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics[0]!.code).toBe('RUNTIME_REJECTION_BUDGET'); expect((error as ModelError).partialResult).toMatchObject({ status: 'failed', finalState: { state: 1 }, steps: 1 });
  });
  it('stops at the accepted-step budget with the last valid state', async () => {
    const m = unary('continuous.integrator', {}, undefined, { maxSteps: 1 });
    try { await runModel(compileModel(m)); throw new Error('Expected budget failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(ModelError); const failure = error as ModelError;
      expect(failure.diagnostics[0]).toMatchObject({ code: 'RUNTIME_INTERNAL_STEP_BUDGET', time: 0.1 });
      expect(failure.partialResult!.solverStatistics!.acceptedSteps).toBe(1); expect(number(failure.partialResult!.finalState.state)).toBeCloseTo(0.1, 13); expect(failure.partialResult!.samples).toHaveLength(2);
    }
  });
  it('fails the stage-evaluation budget before committing any trial state', async () => {
    const m = unary('continuous.integrator', {}, undefined, { maxEvaluations: 3 });
    await expect(runModel(compileModel(m))).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'RUNTIME_EVALUATION_BUDGET', time: 0.1 })], partialResult: expect.objectContaining({ status: 'failed', finalState: { state: 0 }, steps: 1 }) });
  });
  it('reports the original node and stage time on non-finite ODE arithmetic', async () => {
    const m = unary('continuous.integrator', {}, node('source', 'source.ramp', { slope: 1e308 }), { maxStep: 0.1, initialStep: 0.1 });
    m.execution.stopTime = 2;
    try { await runModel(compileModel(m)); throw new Error('Expected numeric failure'); }
    catch (error) { expect((error as ModelError).diagnostics[0]).toMatchObject({ code: 'NUMERIC_NONFINITE', nodeId: 'source' }); expect((error as ModelError).diagnostics[0]!.time).toBeGreaterThan(1.7); expect((error as ModelError).partialResult!.solverStatistics!.acceptedSteps).toBeGreaterThan(0); }
  });
  it('splits saturation lower and upper crossings', async () => {
    const m = model([node('ramp', 'source.ramp'), node('clip', 'nonlinear.saturation', { lower: 0.2, upper: 0.7 }), node('state', 'continuous.integrator'), node('view', 'sink.scope')], [edge('ramp', 'clip'), edge('clip', 'state'), edge('state', 'view')], 0.25, 1, { initialStep: 0.25, maxStep: 0.25, eventTolerance: 1e-10 });
    const run = await runModel(compileModel(m)); const expected = (t: number) => t <= 0.2 ? 0.2 * t : t <= 0.7 ? 0.04 + (t * t - 0.04) / 2 : 0.265 + 0.7 * (t - 0.7);
    run.samples.forEach((sample) => expect(number(sample.values.view)).toBeCloseTo(expected(sample.time), 8)); expect(run.events?.map((event) => event.time)[0]).toBeCloseTo(0.2, 8); expect(run.events?.map((event) => event.time)[1]).toBeCloseTo(0.7, 8);
  });
  it('preserves typed algebraic array branches beside scalar ODEs', async () => {
    const m = model([node('array', 'source.constant', { value: [-1, 0.5, 2] }), node('clip', 'nonlinear.saturation', { lower: 0, upper: 1 }), node('view', 'sink.scope')], [edge('array', 'clip'), edge('clip', 'view')]);
    const run = await runModel(compileModel(m)); expect(run.samples.every((sample) => JSON.stringify(sample.values.view) === '[0,0.5,1]')).toBe(true); expect(run.events).toEqual([]);
  });
  it('does not advance RNG on rejected RK stages', async () => {
    const m = model([node('random', 'source.random', { seed: 0 }), node('state', 'continuous.integrator', { initial: 1 }), node('gain', 'math.gain', { gain: -10 }), node('view', 'sink.scope'), node('randomView', 'sink.scope')], [edge('state', 'gain'), edge('gain', 'state'), edge('state', 'view'), edge('random', 'randomView')], 0.1, 1, { discreteStep: 0.1, method: 'rk45', initialStep: 0.1, maxStep: 0.1, atol: 1e-12, rtol: 1e-12 });
    const adaptive = await runModel(compileModel(m)); m.execution.solver = { ...m.execution.solver, method: 'rk4', initialStep: 0.01, maxStep: 0.01 }; const fixed = await runModel(compileModel(m));
    expect(values(adaptive, 'randomView')).toEqual(values(fixed, 'randomView')); expect(adaptive.stateMemory!.random).toEqual(fixed.stateMemory!.random); expect(adaptive.solverStatistics!.rejectedSteps).toBeGreaterThan(0);
  });
  it('pause/resume retains boundary state and excludes paused time from wall budget', async () => {
    let paused = false, resume: (() => void) | undefined, didPause = false;
    const control = { isPaused: () => paused, waitForResume: () => new Promise<void>((resolve) => { resume = resolve; }) };
    const run = await runModel(compileModel(unary('continuous.integrator', {}, undefined, { initialStep: 0.01, maxStep: 0.01 })), { maxWallMs: 1000, control,
      onProgress: () => { if (!didPause) { paused = true; didPause = true; } }, onPauseChange: (value) => { if (value) setTimeout(() => { paused = false; resume?.(); }, 20); } });
    expect(didPause).toBe(true); expect(run.status).toBe('completed'); expect(values(run).at(-1)).toBeCloseTo(1, 13);
  });
  it('abort wakes a paused run without committing another boundary', async () => {
    const abort = new AbortController(); let paused = false;
    const run = await runModel(compileModel(unary('continuous.integrator', {})), { signal: abort.signal, control: { isPaused: () => paused, waitForResume: () => new Promise<void>(() => {}) }, onProgress: () => { paused = true; }, onPauseChange: (value) => { if (value) abort.abort(); } });
    expect(run.status).toBe('cancelled'); expect(run.samples).toHaveLength(1); expect(run.finalState.state).toBe(0); expect(run.solverStatistics!.acceptedSteps).toBe(0);
  });
});
