import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createExportManifest, exportTypeScript, type ExportManifest } from '../packages/codegen-ts/src/index';
import { sha256 } from '../packages/codegen-ts/src/sha256';
import { buildFixedTemplates } from '../packages/codegen-ts/sync-runtime-templates';
import { KERNEL_TEMPLATE } from '../packages/codegen-ts/src/kernels-template';
import { DISCRETE_TEMPLATE } from '../packages/codegen-ts/src/discrete-template';
import { CONTINUOUS_TEMPLATE } from '../packages/codegen-ts/src/continuous-template';
import { SIGNAL_TYPES_TEMPLATE } from '../packages/codegen-ts/src/signal-types-template';
import { compileModel } from '../packages/compiler/src/index';
import type { CalcEdge, CalcModel, CalcNode, RunResult } from '../packages/model/src/types';
import { runModel } from '../packages/runtime/src/index';
import { M1_ENGINE_FIXTURES, M1_FAILURE_FIXTURES, unaryFixture } from './m1-engine-fixtures';
import { M2_ENGINE_FIXTURES, m2Edge, m2Model, m2Node, m2Unary, rateTransitionFixture, seededFixture, unsignedFixture } from './m2-engine-fixtures';
import { M13_INDEPENDENT_DEFINITION_FIXTURES } from './m13-independent-fixtures';

function node(id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode {
  return { id, blockType, parameters, label: id, blockVersion: 1 };
}
function edge(source: string, target: string, port = 'in'): CalcEdge {
  return { id: `${source}-${target}-${port}`, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId: port } };
}
function model(nodes: CalcNode[], edges: CalcEdge[], mode: CalcModel['execution']['mode'], stopTime = 5): CalcModel {
  return { schemaVersion: 1, modelId: 'codegen-test', name: 'Codegen test', nodes, edges, execution: { mode, startTime: 0, stopTime, step: 1 }, layout: {} };
}

describe('M13 executable child metadata', () => {
  it.each(['initial', 'scheduled'] as const)('canonicalizes %s control zero through actual standalone JSON replay', async origin => {
    const value = model([node('Control', 'dashboard.control', { min: -1, max: 1, step: 1, initial: origin === 'initial' ? -0 : 1, events: origin === 'scheduled' ? '[{"time":0,"order":0,"value":-0}]' : '[]' }), node('Text', 'string.to-string'), node('Result', 'sink.display')], [edge('Control', 'Text'), edge('Text', 'Result')], 'discrete', 1);
    const compiled = compileModel(value), native = await runModel(compiled), standalone = await independentRun(exportTypeScript(compiled));
    expect(native.samples.every(sample => Object.is(sample.values.Control, 0))).toBe(true);
    expect(native.samples.map(sample => sample.values.Result)).toEqual([{ kind: 'typed', dtype: 'string', shape: [], data: ['0'] }, { kind: 'typed', dtype: 'string', shape: [], data: ['0'] }]);
    expect(standalone.samples).toEqual(native.samples); expect(standalone.finalState).toEqual(native.finalState);
  });
  it.each(['string', 'dataset'] as const)('includes nested %s capabilities and actually executes the standalone program', async kind => {
    const source = kind === 'string' ? node('Source', 'source.string-constant', { value: 'ASCII' }) : node('Source', 'data.input-table', { datasetId: 'data', column: 'value', interpolation: 'linear' });
    const value = model([node('Call', 'hierarchy.atomic', { definitionId: 'Child' }), node('Result', 'sink.display')], [edge('Call', 'Result')], 'discrete', 1);
    value.execution.step = .5;
    value.subsystems = [{ id: 'Child', name: 'Child', version: 1, nodes: [source, node('Output', 'io.output')], edges: [edge('Source', 'Output')], inputs: [], outputs: [{ id: 'out', nodeId: 'Output' }], layout: {} }];
    if (kind === 'dataset') value.datasets = structuredClone(M13_INDEPENDENT_DEFINITION_FIXTURES.find(fixture => fixture.model.nodes.some(item => item.blockType === 'data.input-table'))!.model.datasets);
    const compiled = compileModel(value), manifest = await createExportManifest(compiled);
    expect(manifest.targetVersion).toBe('typescript-m13-v1');
    expect(manifest.dataReferences.map(data => data.id)).toEqual(kind === 'dataset' ? ['data'] : []);
    const native = await runModel(compiled), standalone = await independentRun(exportTypeScript(compiled, manifest), undefined, manifest);
    expect(standalone.samples).toEqual(native.samples); expect(standalone.finalState).toEqual(native.finalState); expect(standalone.stateMemory).toEqual(native.stateMemory);
    expect(native.samples.map(sample => sample.values.Result)).toEqual(kind === 'dataset' ? [2, 4, 6] : Array.from({ length: 3 }, () => ({ kind: 'typed', dtype: 'string', shape: [], data: ['ASCII'] })));
  });
});

let checkedStandaloneTypes = false;
describe('M14 pinned adapter export boundaries', () => {
  it('pins a nested affine ABI and executes the actual standalone WASM program', async () => {
    const value = model([node('Call', 'hierarchy.atomic', { definitionId: 'Child' }), node('Result', 'sink.display')], [edge('Call', 'Result')], 'discrete', 1);
    value.subsystems = [{ id: 'Child', name: 'Child', version: 1, nodes: [node('Source', 'source.constant', { value: 3 }), node('Wasm', 'adapter.wasm-affine', { gain: 2, bias: -1 }), node('Output', 'io.output')], edges: [edge('Source', 'Wasm'), edge('Wasm', 'Output')], inputs: [], outputs: [{ id: 'out', nodeId: 'Output' }], layout: {} }];
    const compiled = compileModel(value), manifest = await createExportManifest(compiled);
    expect(manifest.targetVersion).toBe('typescript-m14-v1');
    expect(manifest.adapterReferences).toHaveLength(1);
    expect(manifest.adapterReferences![0]!.profile.artifact).toMatchObject({ byteLength: 48, sha256: 'fc7801ff3c8d616c38773a0e26af62181f8281c8f06430193d0ed20fb239cb95', abiVersion: 1 });
    const native = await runModel(compiled), standalone = await independentRun(exportTypeScript(compiled, manifest), undefined, manifest);
    expect(native.samples.map(sample => sample.values.Result)).toEqual([5, 5]);
    const { elapsedMs: _elapsed, ...stable } = native;
    expect(standalone).toEqual(stable);
  });
});
async function independentRun(source: string, mutateFirstResult?: (result: Omit<RunResult, 'elapsedMs'>) => void, expectedManifest?: ExportManifest): Promise<Omit<RunResult, 'elapsedMs'>> {
  const result = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, reportDiagnostics: true });
  expect(result.diagnostics?.filter((d) => d.category === ts.DiagnosticCategory.Error)).toEqual([]);
  const folder = await mkdtemp(join(tmpdir(), 'calcweave-codegen-'));
  const filename = join(folder, 'model.mjs');
  const typeFilename = join(folder, 'model.ts');
  try {
    if (!checkedStandaloneTypes) {
      await writeFile(typeFilename, source, 'utf8');
      const program = ts.createProgram([typeFilename], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true, noEmit: true, types: [], lib: ['lib.es2022.d.ts'], skipLibCheck: true });
      expect(ts.getPreEmitDiagnostics(program).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error).map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))).toEqual([]);
      checkedStandaloneTypes = true;
    }
    await writeFile(filename, result.outputText, 'utf8');
    // Trusted generator output is loaded as a real standalone Node ESM module.
    // The module has no import from CalcWeave's engine and no eval/VM execution.
    const generated = await import(/* @vite-ignore */ pathToFileURL(filename).href);
    if (expectedManifest) {
      const firstManifest = generated.getManifest();
      expect(firstManifest).toEqual(expectedManifest);
      firstManifest.execution.stopTime = 999999;
      expect(generated.getManifest()).toEqual(expectedManifest);
    }
    const first = generated.run();
    if (mutateFirstResult) { mutateFirstResult(first); return generated.run(); }
    return first;
  } finally {
    await unlink(filename).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    await unlink(typeFilename).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(folder);
  }
}

describe('standalone TypeScript export', () => {
  it('runs independently and matches the known static answer and runtime output', async () => {
    const compiled = compileModel(model([
      node('three', 'source.constant', { value: 3 }), node('four', 'io.input', { value: 4 }),
      node('two', 'source.constant', { value: 2 }), node('sum', 'math.sum'), node('product', 'math.multiply'), node('result', 'sink.display'),
    ], [edge('three', 'sum', 'a'), edge('four', 'sum', 'b'), edge('sum', 'product', 'a'), edge('two', 'product', 'b'), edge('product', 'result')], 'static'));
    const browserRun = await runModel(compiled);
    const generated = await independentRun(exportTypeScript(compiled));
    expect(generated.samples).toEqual([{ time: 0, values: { result: 14 } }]);
    expect(generated).toEqual({ samples: browserRun.samples, finalState: browserRun.finalState, status: browserRun.status, steps: browserRun.steps });
  });

  it('matches a delay feedback recurrence at every tick and final state', async () => {
    const compiled = compileModel(model([
      node('state', 'discrete.unit-delay', { initial: 0 }), node('constant', 'source.constant', { value: 1 }),
      node('gain', 'math.gain', { gain: 0.9 }), node('sum', 'math.sum'), node('result', 'sink.display'),
    ], [edge('state', 'gain'), edge('gain', 'sum', 'a'), edge('constant', 'sum', 'b'), edge('sum', 'state'), edge('state', 'result')], 'discrete'));
    const actual = await independentRun(exportTypeScript(compiled));
    const expected = await runModel(compiled);
    expect(actual.samples).toEqual(expected.samples);
    expect(actual.finalState).toEqual(expected.finalState);
    expect(actual.steps).toBe(expected.steps);
    expect(actual.samples.at(-1)!.values.result).toBe(4.0951);
  });

  it('keeps labels out of executable code', async () => {
    const inputModel = model([node('source', 'source.constant', { value: 7 }), node('result', 'sink.display')], [edge('source', 'result')], 'static');
    inputModel.nodes[0]!.label = '"; globalThis.compromised = true; /* <script>alert(1)</script>\u2028';
    const source = exportTypeScript(compileModel(inputModel));
    expect(source).not.toContain('compromised');
    expect(source).not.toMatch(/\beval\s*\(|new\s+Function|\bimport\s/);
    expect((await independentRun(source)).samples[0]!.values.result).toBe(7);
  });

  it('runs continuous export independently with every sample and final memory matching', async () => {
    const compiled = compileModel(model([
      node('state', 'continuous.integrator', { initial: 1 }), node('gain', 'math.gain', { gain: -1 }), node('result', 'sink.display'),
    ], [edge('state', 'gain'), edge('gain', 'state'), edge('state', 'result')], 'continuous'));
    const { elapsedMs: _elapsed, ...expected } = await runModel(compiled);
    expect(await independentRun(exportTypeScript(compiled))).toEqual(expected);
  });
});

describe('M2 standalone typed discrete export and manifest', () => {
  it.each(M2_ENGINE_FIXTURES)('$name matches every runtime sample and internal state', async ({model: input}) => {
    const compiled = compileModel(input), browser = await runModel(compiled);
    const manifest = await createExportManifest(compiled);
    const generated = await independentRun(exportTypeScript(compiled,manifest),undefined,manifest);
    const {elapsedMs:_elapsed,...reference}=browser;
    expect(generated).toEqual(reference);
  });
  it.each(['uniform','normal'] as const)('seeded %s standalone execution repeats the same PRNG memory', async (distribution) => {
    const compiled=compileModel(seededFixture(distribution)), browser=await runModel(compiled);
    const generated=await independentRun(exportTypeScript(compiled),(result)=>{result.samples[0]!.values.result=999;});
    const {elapsedMs:_elapsed,...reference}=browser;
    expect(generated).toEqual(reference);
  });
  it.each([[1,2,0,0],[2,1,0,0],[5,1,0,0],[1,5,0,0],[2,1,1,0],[2,2,1,1]])('Rate Transition %s to %s offset %s/%s matches held outputs and publication memory', async (producer,consumer,producerOffset,consumerOffset) => {
    const compiled=compileModel(rateTransitionFixture(producer,consumer,producerOffset,consumerOffset));
    const generated=await independentRun(exportTypeScript(compiled)), browser=await runModel(compiled);
    const {elapsedMs:_elapsed,...reference}=browser;
    expect(generated).toEqual(reference);
  });
  it.each(['and','or','xor','not','shift-left','shift-right'])('unsigned %s standalone kernel', async (operation) => {
    const compiled=compileModel(unsignedFixture(operation,4294967295,2147483648,32,31));
    const generated=await independentRun(exportTypeScript(compiled)), browser=await runModel(compiled);
    expect(generated.samples).toEqual(browser.samples);
  });
  it.each([
    {name:'unsigned range',input:unsignedFixture('not',1.25),code:'NUMERIC_INTEGER_RANGE'},
    {name:'Lookup extrapolation',input:m2Unary('lookup.interpolated',{extrapolation:'error'},2,0),code:'LOOKUP_RANGE'},
    {name:'Forward Euler overflow',input:m2Unary('discrete.integrator',{initial:1e308,gain:10},1e308,1),code:'NUMERIC_NONFINITE'},
    {name:'FIR overflow',input:m2Unary('discrete.fir',{coefficients:[10],initial:0},1e308,1),code:'NUMERIC_NONFINITE'},
    {name:'Transfer overflow',input:m2Unary('discrete.transfer-function',{numerator:[10],denominator:[1],initial:0},1e308,1),code:'NUMERIC_NONFINITE'},
    {name:'State Space overflow',input:m2Unary('discrete.state-space',{A:[[10]],B:[0],C:[1],D:0,initial:[1e308]},0,1),code:'NUMERIC_NONFINITE'},
  ])('$name has the same stable block diagnostic', async ({input,code}) => {
    const compiled=compileModel(input);
    await expect(runModel(compiled)).rejects.toMatchObject({diagnostics:[{code,nodeId:'operation'}]});
    await expect(independentRun(exportTypeScript(compiled))).rejects.toMatchObject({diagnostics:[{code,nodeId:'operation'}]});
  });
  it('preserves typed array reset and terminal state memory in the exported program', async () => {
    const input=m2Model([m2Node('input','source.constant',{value:[[1,2]]}),m2Node('reset','source.constant',{value:true}),m2Node('state','discrete.delay',{steps:2,initial:[[0,0]],reset:'level'}),m2Node('result','sink.scope')],
      [m2Edge('input','state'),m2Edge('reset','state','reset'),m2Edge('state','result')],3);
    const compiled=compileModel(input), browser=await runModel(compiled);
    const generated=await independentRun(exportTypeScript(compiled),(result)=>{
      ((result.stateMemory?.state as {history:number[][][]}).history[0]![0]!)[0]=999;
      (result.finalState.state as number[][])[0]![0]=999;
    });
    const {elapsedMs:_elapsed,...reference}=browser;expect(generated).toEqual(reference);
    expect(generated.samples.map((sample)=>sample.values.result)).toEqual([[[0,0]],[[0,0]],[[0,0]],[[0,0]]]);
  });
  it.each(['lookup.interpolated','logic.bitwise','sink.scope'])('M2 stateless %s also exports static execution', async (blockType) => {
    const input=blockType==='logic.bitwise'?unsignedFixture('not',0):blockType==='lookup.interpolated'?m2Unary(blockType,{},.5,0):m2Model([m2Node('input','source.constant',{value:[[1,2]]}),m2Node('result','sink.scope')],[m2Edge('input','result')],0);
    input.execution.mode='static';const compiled=compileModel(input);
    expect((await independentRun(exportTypeScript(compiled))).samples).toEqual((await runModel(compiled)).samples);
  });
  it('keeps fixed export templates synchronized with repository numerical sources', async () => {
    const templates=await buildFixedTemplates();expect(KERNEL_TEMPLATE).toBe(templates.kernels);expect(DISCRETE_TEMPLATE).toBe(templates.discrete);expect(CONTINUOUS_TEMPLATE).toBe(templates.continuous);expect(SIGNAL_TYPES_TEMPLATE).toBe(templates.signalTypes);
  });
  it.each(['','abc','CalcWeave 수학 😀', 'x'.repeat(100000)])('fixed SHA-256 matches the platform implementation for UTF-8 data', (input) => {
    expect(sha256(input)).toBe(createHash('sha256').update(input,'utf8').digest('hex'));
  });
  it('computes the same manifest with synchronous export and Web Crypto and rejects another model hash', async () => {
    const compiled=compileModel(seededFixture('normal',42,2,1)),manifest=await createExportManifest(compiled);
    expect(manifest.modelHash).toBe(createHash('sha256').update(compiled.semanticKey).digest('hex'));
    expect(manifest.nodes.source).toEqual({sampleTime:{period:2,offset:1},seed:42,randomAlgorithm:'lcg32-boxmuller-v1'});
    expect(manifest.rateTransitionPolicy).toBe('read-before-write');expect(manifest.dataReferences).toEqual([]);
    await independentRun(exportTypeScript(compiled),undefined,manifest);
    expect(()=>exportTypeScript(compiled,{...manifest,modelHash:'0'.repeat(64)})).toThrowError(expect.objectContaining({diagnostics:[expect.objectContaining({code:'EXPORT_MANIFEST_MISMATCH'})]}));
  });
  it('adds the original failed sample tick and time to output and transition diagnostics', async () => {
    const output=m2Model([m2Node('input','source.ramp',{initial:1,slope:-1}),m2Node('operation','math.function',{operation:'reciprocal'}),m2Node('result','sink.scope')],
      [m2Edge('input','operation'),m2Edge('operation','result')],3);
    const transition=m2Unary('discrete.integrator',{initial:1e308,gain:10},1e308,3);
    for (const [input,code,tick,time] of [[output,'NUMERIC_DIVIDE_BY_ZERO',1,1],[transition,'NUMERIC_NONFINITE',0,0]] as const) {
      const compiled=compileModel(input);
      let expected:unknown;
      try { await runModel(compiled);throw new Error('Expected a diagnostic'); }
      catch(error) { expected=(error as {diagnostics:unknown[]}).diagnostics;expect(expected).toEqual([expect.objectContaining({code,nodeId:'operation',tick,time})]); }
      await expect(independentRun(exportTypeScript(compiled))).rejects.toMatchObject({diagnostics:expected});
    }
  });
  it('returns the same structured preflight operation budget diagnostic without running a tick', async () => {
    const input=m2Model([m2Node('input','source.constant',{value:Array(1024).fill(1)}),m2Node('a','math.gain'),m2Node('b','math.gain'),m2Node('c','math.gain'),m2Node('reduction','math.minmax',{strategy:'reduce'}),m2Node('result','sink.scope')],
      [m2Edge('input','a'),m2Edge('a','b'),m2Edge('b','c'),m2Edge('c','reduction'),m2Edge('reduction','result')],10000);
    const compiled=compileModel(input),diagnostics=[{code:'RUNTIME_OPERATION_BUDGET',message:'계산 연산 한도를 초과했습니다.'}];
    await expect(runModel(compiled)).rejects.toMatchObject({diagnostics});
    await expect(independentRun(exportTypeScript(compiled))).rejects.toMatchObject({diagnostics});
  });
});

describe('M1 standalone typed TypeScript parity', () => {
  it.each(M1_ENGINE_FIXTURES)('$name matches independent execution and the known answer', async ({ model: inputModel, expected }) => {
    const compiled = compileModel(inputModel);
    const actual = await independentRun(exportTypeScript(compiled));
    const browser = await runModel(compiled);
    expect(actual.samples).toEqual([{ time: 0, values: expected }]);
    expect(actual).toEqual({ samples: browser.samples, finalState: browser.finalState, status: browser.status, steps: browser.steps });
  });

  it.each(M1_FAILURE_FIXTURES)('$fixture.name fails with the same diagnostic in standalone code', async ({ fixture, code }) => {
    const compiled = compileModel(fixture.model);
    await expect(independentRun(exportTypeScript(compiled))).rejects.toMatchObject({ diagnostics: [{ code, nodeId: 'operation' }] });
    await expect(runModel(compiled)).rejects.toMatchObject({ diagnostics: [{ code, nodeId: 'operation' }] });
  });

  it('serializes only the validated AST instead of the expression source text', async () => {
    const expression = 'min(x, 3) + abs(x)';
    const compiled = compileModel(unaryFixture('safe AST export', 'math.expression', -2, { expression }, 0).model);
    const source = exportTypeScript(compiled);
    expect(source).not.toContain(expression);
    expect(source).not.toMatch(/\beval\s*\(|new\s+Function|\bimport\s/);
    expect((await independentRun(source)).samples[0]!.values.result).toBe(0);
  });

  it('keeps vector and matrix inputs intact after consumers edit results and rerun the same exported module', async () => {
    for (const value of [[1, 2], [[1, 2], [3, 4]]] as const) {
      const inputModel = model([node('source', 'source.constant', { value }), node('result', 'sink.display')], [edge('source', 'result')], 'static');
      const compiled = compileModel(inputModel);
      const mutate = (result: Omit<RunResult, 'elapsedMs'>): void => {
        const recorded = result.samples[0]!.values.result;
        expect(Array.isArray(recorded)).toBe(true);
        if (!Array.isArray(recorded)) throw new Error('Expected array result');
        if (Array.isArray(recorded[0])) (recorded as number[][])[0]![0] = 999;
        else (recorded as number[])[0] = 999;
      };
      const rerun = await independentRun(exportTypeScript(compiled), mutate);
      const browserFirst = await runModel(compiled);
      mutate(browserFirst);
      const browserRerun = await runModel(compiled);
      expect(rerun.samples[0]!.values.result).toEqual(value);
      expect(browserRerun.samples).toEqual(rerun.samples);
    }
  });
});
