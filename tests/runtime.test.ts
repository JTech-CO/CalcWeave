import { describe, expect, it } from 'vitest';
import { M8_FIXTURES, m8Model } from './m8-fixtures';
import { M10_INDEPENDENT_FIXTURES } from './m10-independent-fixtures';
import { M11_INDEPENDENT_DEFINITION_FIXTURES } from './m11-independent-fixtures';
import { compileModel } from '../packages/compiler/src/index';
import { ModelError } from '../packages/model/src/types';
import type { CalcEdge, CalcModel, CalcNode } from '../packages/model/src/types';
import { runModel } from '../packages/runtime/src/index';
import { blockRegistry } from '../packages/block-library/src';
import { expressionNodeCount } from '../packages/expression/src';
import { nodeOperationCost } from '../packages/runtime/src/kernels';
import { M1_ENGINE_FIXTURES, M1_FAILURE_FIXTURES, unaryFixture } from './m1-engine-fixtures';
import { M2_ENGINE_FIXTURES, m2Edge, m2Model, m2Node, m2Unary, rateTransitionFixture, seededFixture, unsignedFixture } from './m2-engine-fixtures';
import { m4Oracles } from '../scripts/m4-oracles';
import { m5Oracles } from '../scripts/m5-oracles';
import { EXPANSION_FIXTURES, expansionModel } from './block-expansion-fixtures';

function numeric(value: unknown): number {
  if (typeof value !== 'number') throw new Error('Expected a numeric scalar result');
  return value;
}

function node(id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode {
  return { id, blockType, parameters, label: id, blockVersion: 1 };
}
function edge(source: string, target: string, port = 'in'): CalcEdge {
  return { id: `${source}-${target}-${port}`, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId: port } };
}
function model(nodes: CalcNode[], edges: CalcEdge[], mode: CalcModel['execution']['mode'], step = 1, stopTime = 5): CalcModel {
  return { schemaVersion: 1, modelId: 'runtime-test', name: 'Runtime test', nodes, edges, execution: { mode, startTime: 0, stopTime, step }, layout: {} };
}
function decay(step: number, stopTime = 1): CalcModel {
  return model([
    node('state', 'continuous.integrator', { initial: 1 }),
    node('negative', 'math.gain', { gain: -1 }),
    node('result', 'sink.display'),
  ], [edge('state', 'negative'), edge('negative', 'state'), edge('state', 'result')], 'continuous', step, stopTime);
}
function feedback(nodesOrder?: string[], stopTime = 5, step = 1): CalcModel {
  const nodes = [
    node('state', 'discrete.unit-delay', { initial: 0 }),
    node('constant', 'source.constant', { value: 1 }),
    node('gain', 'math.gain', { gain: 0.9 }),
    node('sum', 'math.sum'),
    node('result', 'sink.display'),
  ];
  return model(nodesOrder ? nodesOrder.map((id) => nodes.find((n) => n.id === id)!) : nodes, [
    edge('state', 'gain'), edge('gain', 'sum', 'a'), edge('constant', 'sum', 'b'),
    edge('sum', 'state'), edge('state', 'result'),
  ], 'discrete', step, stopTime);
}

describe('M0 scalar runtime', () => {
  it('calculates an independently known static result', async () => {
    const compiled = compileModel(model([
      node('three', 'source.constant', { value: 3 }), node('four', 'io.input', { value: 4 }),
      node('sum', 'math.sum'), node('gain', 'math.gain', { gain: 2 }), node('result', 'sink.display'),
    ], [edge('three', 'sum', 'a'), edge('four', 'sum', 'b'), edge('sum', 'gain'), edge('gain', 'result')], 'static'));
    const run = await runModel(compiled);
    expect(run.samples).toEqual([{ time: 0, values: { result: 14 } }]);
    expect(run.finalState).toEqual({});
    expect(run.steps).toBe(1);
    expect(run.status).toBe('completed');
  });

  it('reads old delay state before atomically committing the recurrence', async () => {
    const run = await runModel(compileModel(feedback()));
    expect(run.samples.map((sample) => sample.time)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(run.samples.map((sample) => sample.values.result)).toEqual([0, 1, 1.9, 2.71, 3.439, 4.0951]);
    expect(run.finalState.state).toBe(run.samples.at(-1)!.values.result);
    const shuffled = await runModel(compileModel(feedback(['sum', 'result', 'constant', 'gain', 'state'])));
    expect(shuffled.samples).toEqual(run.samples);
    expect(shuffled.finalState).toEqual(run.finalState);
  });

  it('commits coupled states simultaneously', async () => {
    const run = await runModel(compileModel(model([
      node('a', 'discrete.unit-delay', { initial: 1 }), node('b', 'discrete.unit-delay', { initial: 2 }),
      node('viewA', 'sink.display'), node('viewB', 'sink.display'),
    ], [edge('b', 'a'), edge('a', 'b'), edge('a', 'viewA'), edge('b', 'viewB')], 'discrete', 1, 2)));
    expect(run.samples.map((sample) => sample.values)).toEqual([
      { viewA: 1, viewB: 2 }, { viewA: 2, viewB: 1 }, { viewA: 1, viewB: 2 },
    ]);
  });

  it('uses the integer tick index rather than accumulating time', async () => {
    const run = await runModel(compileModel(feedback(undefined, 0.3, 0.1)));
    expect(run.samples).toHaveLength(4);
    expect(run.samples.map((sample) => sample.time)).toEqual([0, 0.1, 0.2, 3 * 0.1]);
  });

  it('RK4 follows exp(-t) with fourth order step-halving convergence', async () => {
    const coarse = await runModel(compileModel(decay(0.2)));
    const fine = await runModel(compileModel(decay(0.1)));
    const error = (value: number) => Math.abs(value - Math.exp(-1));
    expect(coarse.samples[0]!.values.result).toBe(1);
    expect(coarse.finalState.state).toBe(coarse.samples.at(-1)!.values.result);
    expect(error(numeric(fine.finalState.state))).toBeLessThan(4e-7);
    expect(error(numeric(coarse.finalState.state)) / error(numeric(fine.finalState.state))).toBeGreaterThan(15);
    expect(error(numeric(coarse.finalState.state)) / error(numeric(fine.finalState.state))).toBeLessThan(19);
  });

  it('evaluates coupled RK4 derivatives from a single stage state', async () => {
    const oscillator = model([
      node('x', 'continuous.integrator', { initial: 1 }), node('v', 'continuous.integrator', { initial: 0 }),
      node('negativeX', 'math.gain', { gain: -1 }), node('viewX', 'sink.display'), node('viewV', 'sink.display'),
    ], [edge('v', 'x'), edge('x', 'negativeX'), edge('negativeX', 'v'), edge('x', 'viewX'), edge('v', 'viewV')], 'continuous', 0.01, 1);
    const run = await runModel(compileModel(oscillator));
    expect(run.finalState.x).toBeCloseTo(Math.cos(1), 8);
    expect(run.finalState.v).toBeCloseTo(-Math.sin(1), 8);
    expect(numeric(run.finalState.x) ** 2 + numeric(run.finalState.v) ** 2).toBeCloseTo(1, 8);
  });

  it('does not overflow an unscaled weighted slope when the accepted increment is finite', async () => {
    const run = await runModel(compileModel(model([
      node('source', 'source.constant', { value: 1e308 }),
      node('state', 'continuous.integrator', { initial: 0 }), node('result', 'sink.display'),
    ], [edge('source', 'state'), edge('state', 'result')], 'continuous', 1e-9, 1e-9)));
    expect(Number.isFinite(run.finalState.state)).toBe(true);
    expect(numeric(run.finalState.state) / 1e299).toBeCloseTo(1, 14);
  });

  it('returns a partial cancelled run with the last recorded committed state', async () => {
    const controller = new AbortController();
    const run = await runModel(compileModel(feedback(undefined, 1000)), {
      signal: controller.signal,
      onProgress: ({ steps }) => { if (steps >= 64) controller.abort(); },
    });
    expect(run.status).toBe('cancelled');
    expect(run.steps).toBeGreaterThan(0);
    expect(run.steps).toBeLessThan(1001);
    expect(run.finalState.state).toBe(run.samples.at(-1)!.values.result);
  });

  it('yields so timer-driven cancellation is observable', async () => {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 0);
    try {
      const run = await runModel(compileModel(feedback(undefined, 1000)), { signal: controller.signal });
      expect(run.status).toBe('cancelled');
      expect(run.steps).toBeLessThan(1001);
      expect(run.finalState.state).toBe(run.samples.at(-1)!.values.result);
    } finally { clearTimeout(abortTimer); }
  });

  it('returns no samples when cancelled before the run starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const run = await runModel(compileModel(feedback()), { signal: controller.signal });
    expect(run.status).toBe('cancelled');
    expect(run.samples).toEqual([]);
    expect(run.finalState).toEqual({ state: 0 });
  });

  it('rejects resource budget overrides outside absolute bounds', async () => {
    await expect(runModel(compileModel(feedback()), { maxWallMs: Infinity })).rejects.toMatchObject({ diagnostics: [{ code: 'RUNTIME_OPTIONS' }] });
    await expect(runModel(compileModel(feedback()), { maxRecordedValues: 1_000_001 })).rejects.toMatchObject({ diagnostics: [{ code: 'RUNTIME_OPTIONS' }] });
    await expect(runModel(compileModel(feedback()), { maxRecordedValues: 5 })).rejects.toMatchObject({ diagnostics: [{ code: 'RUNTIME_RECORD_BUDGET' }] });
  });

  it('rejects an expensive graph before performing RK4 stages', async () => {
    const inputModel = decay(1, 10_000);
    // 1,000 total nodes × (10,001 recorded + 40,000 stage evaluations).
    for (let index = 0; index < 997; index += 1) {
      inputModel.nodes.push(node(`extra${index}`, 'source.constant', { value: 0 }));
    }
    await expect(runModel(compileModel(inputModel))).rejects.toMatchObject({ diagnostics: [{ code: 'RUNTIME_OPERATION_BUDGET' }] });
  });

  it('enforces a wall clock budget with a stable diagnostic', async () => {
    await expect(runModel(compileModel(feedback()), { maxWallMs: Number.MIN_VALUE })).rejects.toMatchObject({ diagnostics: [{ code: 'RUNTIME_WALL_BUDGET' }] });
  });

  it('diagnoses arithmetic overflow at the block that produced it', async () => {
    const compiled = compileModel(model([
      node('source', 'source.constant', { value: 1e308 }), node('gain', 'math.gain', { gain: 10 }), node('result', 'sink.display'),
    ], [edge('source', 'gain'), edge('gain', 'result')], 'static'));
    try { await runModel(compiled); throw new Error('Expected a numeric diagnostic.'); }
    catch (error) {
      expect(error).toBeInstanceOf(ModelError);
      expect((error as ModelError).diagnostics[0]).toMatchObject({ code: 'NUMERIC_NONFINITE', nodeId: 'gain' });
    }
  });
});

describe('M1 typed static runtime', () => {
  it.each(M1_ENGINE_FIXTURES)('$name', async ({ model: inputModel, expected }) => {
    const result = await runModel(compileModel(inputModel));
    expect(result.samples).toEqual([{ time: 0, values: expected }]);
    expect(result.finalState).toEqual({});
    expect(result.steps).toBe(1);
    expect(result.status).toBe('completed');
  });

  it.each(M1_FAILURE_FIXTURES)('reports $fixture.name at its producing node', async ({ fixture, code }) => {
    await expect(runModel(compileModel(fixture.model))).rejects.toMatchObject({ diagnostics: [{ code, nodeId: 'operation' }] });
  });

  it('covers every current static canonical block with actual fixtures', () => {
    const covered = new Set([...M1_ENGINE_FIXTURES, ...M2_ENGINE_FIXTURES, ...m4Oracles(), ...m5Oracles(), ...EXPANSION_FIXTURES.map(fixture => ({ model: expansionModel(fixture) })), ...M8_FIXTURES.map(fixture => ({ model: m8Model(fixture) })), ...M10_INDEPENDENT_FIXTURES, ...M11_INDEPENDENT_DEFINITION_FIXTURES, { model: unsignedFixture('and',1,1) }].flatMap((fixture) => fixture.model.nodes.map((entry) => entry.blockType)));
    expect(blockRegistry.filter((definition) => definition.supportedModes.includes('static')).map((definition) => definition.id).filter((id) => !covered.has(id))).toEqual([]);
  });

  it('counts array elements and timestamps in the record budget, including maximum accepted signal size', async () => {
    const fixture = unaryFixture('maximum signal', 'math.abs', Array.from({ length: 1024 }, (_, i) => -i), {}, []);
    const compiled = compileModel(fixture.model);
    await expect(runModel(compiled, { maxRecordedValues: 1024 })).rejects.toMatchObject({ diagnostics: [{ code: 'RUNTIME_RECORD_BUDGET' }] });
    const result = await runModel(compiled, { maxRecordedValues: 1025 });
    expect(result.samples[0]!.values.result).toEqual(Array.from({ length: 1024 }, (_, i) => i));
  });

  it('charges expression AST work per array element and leaves the source snapshot immutable', async () => {
    const original = Array.from({ length: 1024 }, () => 2);
    const fixture = unaryFixture('expression array cost', 'math.expression', original, { expression: 'x+x+x+x+x' }, []);
    const compiled = compileModel(fixture.model);
    const operation = compiled.nodes.find((entry) => entry.id === 'operation')!;
    expect(nodeOperationCost(operation, new Map(compiled.nodes.map((entry) => [entry.id, entry])))).toBe(1024 * expressionNodeCount(operation.expression!));
    original[0] = 999;
    expect((await runModel(compiled)).samples[0]!.values.result).toEqual(Array.from({ length: 1024 }, () => 10));
    expect(Object.isFrozen(compiled.nodes.find((entry) => entry.id === 'input')!.parameters.value)).toBe(true);
  });
});

describe('M2 fixed tick typed runtime', () => {
  function close(actual: unknown, expected: unknown): void {
    if (typeof expected === 'number') expect(actual).toBeCloseTo(expected, 12);
    else if (Array.isArray(expected)) { expect(Array.isArray(actual)).toBe(true); expect((actual as unknown[]).length).toBe(expected.length); expected.forEach((value,index) => close((actual as unknown[])[index],value)); }
    else expect(actual).toBe(expected);
  }
  it.each(M2_ENGINE_FIXTURES)('$name', async ({model: input, expected}) => {
    const result = await runModel(compileModel(input));
    expect(result.status).toBe('completed'); expect(result.steps).toBe(expected.length);
    result.samples.forEach((sample,index) => close(sample.values.result,expected[index]));
    expect(result.samples.map((sample) => sample.time)).toEqual(expected.map((_,tick) => input.execution.startTime + tick * input.execution.step));
  });
  it.each([
    { name:'fast to slow', producer:1,consumer:2,offset:0,expected:[-1,-1,1,1,3,3,5,5,7,7,9] },
    { name:'slow to fast', producer:2,consumer:1,offset:0,expected:[-1,0,0,2,2,4,4,6,6,8,8] },
    { name:'producer offset',producer:2,consumer:1,offset:1,expected:[-1,-1,1,1,3,3,5,5,7,7,9] },
    { name:'five base ticks to fast',producer:5,consumer:1,offset:0,expected:[-1,0,0,0,0,0,5,5,5,5,5] },
    { name:'same rate still delays publication',producer:1,consumer:1,offset:0,expected:[-1,0,1,2,3,4,5,6,7,8,9] },
  ])('read-before-write $name', async ({producer,consumer,offset,expected}) => {
    const input = rateTransitionFixture(producer,consumer,offset);
    const result = await runModel(compileModel(input));
    expect(result.samples.map((sample) => sample.values.result)).toEqual(expected);
    input.nodes.reverse(); input.edges.reverse();
    const shuffled = await runModel(compileModel(input));
    expect(shuffled.samples).toEqual(result.samples); expect(shuffled.stateMemory).toEqual(result.stateMemory);
  });
  it('holds outputs before the first source and consumer hit', async () => {
    const input = rateTransitionFixture(2,2,1,1);
    const result = await runModel(compileModel(input));
    expect(result.samples.map((sample) => sample.values.result)).toEqual([0,-1,-1,1,1,3,3,5,5,7,7]);
  });
  it('preserves small positive phases when a sequence period is much larger', async () => {
    const input=m2Model([m2Node('source','source.repeating-sequence',{times:[0,1e9],values:[0,1]}),m2Node('result','sink.scope')],[m2Edge('source','result')],1e-9,1e-9);
    expect((await runModel(compileModel(input))).samples[1]!.values.result).toBe(1e-18);
  });
  it('keeps final output projection distinct from next-state memory at a not-due terminal tick', async () => {
    const input = m2Model([m2Node('input','source.constant',{value:3}),m2Node('delay','discrete.unit-delay',{initial:0},2),m2Node('result','sink.scope',{},2)], [m2Edge('input','delay'),m2Edge('delay','result')],1);
    const result = await runModel(compileModel(input));
    expect(result.samples.map((sample) => sample.values.result)).toEqual([0,0]);
    expect(result.finalState.delay).toBe(0); expect(result.stateMemory?.delay).toEqual({value:3});
  });
  it('uses period times base-step for forward Euler and simultaneous feedback state', async () => {
    const input = m2Model([m2Node('input','source.constant',{value:1}),m2Node('state','discrete.integrator',{initial:0},2),m2Node('result','sink.scope',{},2)], [m2Edge('input','state'),m2Edge('state','result')],3,.5);
    const result = await runModel(compileModel(input));
    expect(result.samples.map((sample) => sample.values.result)).toEqual([0,0,1,1,2,2,3]);
    expect(result.finalState.state).toBe(3);
  });
  it('prioritizes level reset on the next commit without changing the current sample', async () => {
    const input = m2Model([
      m2Node('input','source.constant',{value:1}),m2Node('resetPulse','source.pulse',{phase:2,period:10,width:1}),m2Node('zero','source.constant',{value:0}),
      m2Node('resetFlag','logic.compare',{operation:'gt'}),m2Node('state','discrete.integrator',{initial:5,reset:'level'}),m2Node('result','sink.scope'),
    ],[m2Edge('resetPulse','resetFlag','a'),m2Edge('zero','resetFlag','b'),m2Edge('input','state'),m2Edge('resetFlag','state','reset'),m2Edge('state','result')],4);
    const result = await runModel(compileModel(input));
    expect(result.samples.map((sample) => sample.values.result)).toEqual([5,6,7,5,6]);
    expect(result.finalState.state).toBe(6);
  });
  it('supports strictly proper FIR feedback without an algebraic loop', async () => {
    const input = m2Model([m2Node('one','source.constant',{value:1}),m2Node('state','discrete.fir',{coefficients:[0,1],initial:0}),m2Node('sum','math.sum'),m2Node('result','sink.scope')],
      [m2Edge('one','sum','a'),m2Edge('state','sum','b'),m2Edge('sum','state'),m2Edge('state','result')],3);
    expect((await runModel(compileModel(input))).samples.map((sample) => sample.values.result)).toEqual([0,1,2,3]);
  });
  it.each(['uniform','normal'] as const)('restarts seeded %s draws and isolates nodes from execution order', async (distribution) => {
    const input = seededFixture(distribution), compiled = compileModel(input);
    const first = await runModel(compiled), second = await runModel(compiled);
    expect(second.samples).toEqual(first.samples); expect(second.stateMemory).toEqual(first.stateMemory);
    input.nodes.push(m2Node('other','source.random',{distribution,seed:99})); input.nodes.reverse();
    expect((await runModel(compileModel(input))).samples).toEqual(first.samples);
    const offset = await runModel(compileModel(seededFixture(distribution,1,2,1)));
    expect(offset.samples.map((sample) => sample.values.result)).toEqual([0,first.samples[0]!.values.result,first.samples[0]!.values.result,first.samples[1]!.values.result,first.samples[1]!.values.result,first.samples[2]!.values.result]);
  });
  it('matches published LCG32 states with one draw per uniform hit', async () => {
    const result = await runModel(compileModel(seededFixture('uniform')));
    expect(result.samples.map((sample) => sample.values.result)).toEqual([1015568748,1586005467,2165703038,3027450565,217083232,1587069247].map((state) => (state+.5)/4294967296));
    expect(result.stateMemory?.source).toEqual({seed:1587069247});
  });
  it.each([
    ['and',170,85,8,1,0],['or',170,85,8,1,255],['xor',170,255,8,1,85],['not',0,0,8,1,255],
    ['shift-left',128,0,8,1,0],['shift-right',128,0,8,1,64],['not',0,0,32,1,4294967295],
    ['shift-left',2147483648,0,32,1,0],['shift-right',4294967295,0,32,31,1],
  ])('unsigned %s(%s) width %s wraps and masks explicitly', async (operation,a,b,width,shift,expected) => {
    expect((await runModel(compileModel(unsignedFixture(String(operation),Number(a),Number(b),Number(width),Number(shift))))).samples[0]!.values.result).toBe(expected);
  });
  it.each([1.5,-1,256])('rejects unsigned inputs outside the declared integer width: %s', async (a) => {
    await expect(runModel(compileModel(unsignedFixture('not',a)))).rejects.toMatchObject({diagnostics:[{code:'NUMERIC_INTEGER_RANGE',nodeId:'operation'}]});
  });
  it('rejects Lookup extrapolation with a node diagnostic and interpolates large finite endpoints', async () => {
    await expect(runModel(compileModel(m2Unary('lookup.interpolated',{extrapolation:'error'},2,0)))).rejects.toMatchObject({diagnostics:[{code:'LOOKUP_RANGE',nodeId:'operation'}]});
    const run = await runModel(compileModel(m2Unary('lookup.interpolated',{breakpoints:[-1e308,1e308],values:[-1e308,1e308]},0,0)));
    expect(run.samples[0]!.values.result).toBe(0);
  });
  it('detaches state memory and samples from the frozen model and repeated runs', async () => {
    const compiled = compileModel(m2Unary('discrete.delay',{steps:2,initial:[[0,0]]},[[3,4]],3));
    const result = await runModel(compiled), reference = await runModel(compiled);
    ((result.stateMemory?.operation as {history:number[][][]}).history[0]![0]!)[0]=99;
    (result.samples[0]!.values.result as number[][])[0]![0]=99;
    expect((await runModel(compiled)).samples).toEqual(reference.samples);
    expect((await runModel(compiled)).stateMemory).toEqual(reference.stateMemory);
  });
  it('pauses at a tick boundary and excludes paused wall time from the active budget', async () => {
    let paused = false, resume: (()=>void)|undefined, previousSteps=0;
    const changes:boolean[]=[]; const started=performance.now();
    const result = await runModel(compileModel(m2Unary('discrete.integrator',{initial:0},1,5)), {
      maxWallMs:150, control:{isPaused:()=>paused,waitForResume:()=>new Promise<void>((resolve)=>{resume=resolve;})},
      onProgress:({steps})=>{previousSteps=steps;if(steps===1)paused=true;},
      onPauseChange:(value)=>{changes.push(value);if(value)setTimeout(()=>{expect(previousSteps).toBe(1);paused=false;resume?.();},200);},
    });
    expect(result.status).toBe('completed'); expect(changes).toEqual([true,false]);
    expect(performance.now()-started).toBeGreaterThanOrEqual(190); expect(result.elapsedMs).toBeLessThan(150);
    expect(result.samples.map((sample)=>sample.values.result)).toEqual([0,1,2,3,4,5]);
  });
  it('cancels while paused even when the caller never resolves its wait promise', async () => {
    const controller=new AbortController(); const changes:boolean[]=[];
    const result=await runModel(compileModel(m2Unary('discrete.integrator',{initial:0},1,5)),{
      signal:controller.signal,control:{isPaused:()=>true,waitForResume:()=>new Promise<void>(()=>{})},
      onPauseChange:(value)=>{changes.push(value);if(value)setTimeout(()=>controller.abort(),0);},
    });
    expect(result.status).toBe('cancelled');expect(result.samples).toEqual([]);expect(changes).toEqual([true,false]);
  });
  it.each([
    ['discrete.unit-delay',{initial:0},0],['discrete.delay',{initial:0,steps:2},0],['discrete.integrator',{initial:0},0],
    ['discrete.fir',{initial:0,coefficients:[1,1]},1],['discrete.transfer-function',{initial:0,numerator:[1],denominator:[1,-.5]},1],
    ['discrete.state-space',{initial:[0],A:[[.5]],B:[1],C:[1],D:0},0],
  ])('level reset restores all %s memory after each sample', async (blockType,parameters,expected) => {
    const input=m2Unary(String(blockType),{...(parameters as Record<string,unknown>),reset:'level'},1,3);
    input.nodes.push(m2Node('reset','source.constant',{value:true}));input.edges.push(m2Edge('reset','operation','reset'));
    expect((await runModel(compileModel(input))).samples.map((sample)=>sample.values.result)).toEqual([expected,expected,expected,expected]);
  });
});
