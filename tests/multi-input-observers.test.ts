import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { getBlockDefinition, getBlockPorts } from '../packages/block-library/src';
import { compileModel } from '../packages/compiler/src';
import { exportTypeScript } from '../packages/codegen-ts/src';
import { exportPython, getPythonDiagnostics, PYTHON_M7_TARGET } from '../packages/codegen-python/src';
import { generateWasm, getWasmDiagnostics } from '../packages/codegen-wasm/src';
import { createExportManifest } from '../packages/codegen-ts/src';
import { validateRunHistory } from '../apps/web/src/run-history';
import { canonicalSemantic, ModelError, type BusSignal, type CalcEdge, type CalcModel, type CalcNode, type RunResult, type SignalValue } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';

const observerTypes = ['sink.display', 'sink.scope'] as const;
const portName = (index: number) => index === 0 ? 'in' : `in${index + 1}`;
function node(id: string, blockType: string, parameters: Record<string, unknown> = {}, unit?: string): CalcNode {
  return { id, blockType, blockVersion: 1, label: id, parameters, ...(unit ? { unit } : {}) };
}
function edge(source: string, target: string, port = 'in'): CalcEdge {
  return { id: `${source}-${target}-${port}`, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId: port } };
}
function model(type: typeof observerTypes[number], values: SignalValue[], mode: CalcModel['execution']['mode'] = 'static', options: { omitCount?: boolean; units?: string[] } = {}): CalcModel {
  return { schemaVersion: 1, modelId: 'multi-observer', name: 'Multi observer', layout: {},
    nodes: [...values.map((value, index) => node(`source${index}`, 'source.signal', { value }, options.units?.[index])), node('observer', type, options.omitCount ? {} : { inputCount: values.length })],
    edges: values.map((_, index) => edge(`source${index}`, 'observer', portName(index))),
    execution: { mode, startTime: 0, stopTime: 2, step: 1 } };
}
function legacyModel(type: typeof observerTypes[number], count = 2): CalcModel {
  const value = model(type, Array.from({ length: count }, (_, index) => index + 1));
  value.nodes.slice(0, count).forEach(item => item.blockType = 'source.constant');
  return value;
}
function withComputedZero(value: CalcModel): CalcModel {
  value.nodes.find(item => item.id === 'source0')!.parameters.value = [-2, 2];
  value.nodes.push(node('zeroGain', 'math.gain', { gain: 0 }));
  value.edges.find(item => item.source.nodeId === 'source0')!.source.nodeId = 'zeroGain';
  value.edges.push(edge('source0', 'zeroGain'));
  return value;
}
const bus = (values: SignalValue[]): BusSignal => ({ kind: 'bus', fields: values.map((value, index) => ({ name: portName(index), value })) });
function failure(action: () => unknown, code: string) {
  try { action(); } catch (error) {
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).diagnostics.some(item => item.code === code)).toBe(true);
    return;
  }
  throw new Error(`Expected ${code}`);
}
async function standalone(compiled: ReturnType<typeof compileModel>): Promise<Omit<RunResult, 'elapsedMs'>> {
  const source = exportTypeScript(compiled);
  const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, reportDiagnostics: true });
  expect(javascript.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error)).toEqual([]);
  const directory = await mkdtemp(join(tmpdir(), 'calcweave-multi-observer-'));
  try {
    const filename = join(directory, 'model.mjs');
    await writeFile(filename, javascript.outputText);
    const generated = await import(/* @vite-ignore */ pathToFileURL(filename).href) as { run(): Omit<RunResult, 'elapsedMs'> };
    return generated.run();
  } finally { await rm(directory, { recursive: true, force: true }); }
}

describe.each(observerTypes)('%s independent observation inputs', type => {
  it('declares an explicit bounded count and keeps the original first port', () => {
    expect(getBlockDefinition(type)!.parameters.inputCount).toEqual({ kind: 'integer', label: '입력 개수', default: 1, min: 1, max: 16 });
    expect(getBlockPorts({ blockType: type, parameters: {} }).inputs).toEqual(['in']);
    expect(getBlockPorts({ blockType: type, parameters: { inputCount: 16 } }).inputs).toEqual(['in', ...Array.from({ length: 15 }, (_, index) => `in${index + 2}`)]);
    expect(getBlockPorts({ blockType: type, parameters: { inputCount: 99999999 } }).inputs).toEqual(['in']);
  });
  it.each([0, -1, 17, 1.5, NaN, Infinity, '2', null])('rejects invalid count %s before allocation', count => {
    const value = legacyModel(type);
    value.nodes.at(-1)!.parameters.inputCount = count;
    failure(() => compileModel(value), typeof count === 'number' && !Number.isFinite(count) ? 'NONFINITE_INPUT' : 'INVALID_PARAMETERS');
  });
  it.each([false, true])('retains single-input raw values and descriptor for omitCount=%s', async omitCount => {
    const raw: SignalValue = { kind: 'bus', fields: [{ name: 'original', value: [2, 3] }, { name: 'flag', value: true }] };
    const source = model(type, [raw], 'static', { omitCount });
    const compiled = compileModel(source);
    const result = await runModel(compiled);
    expect(result.samples[0]!.values.observer).toEqual(raw);
    expect(compiled.outputTypes.observer).toEqual(compiled.nodes.find(item => item.id === 'source0')!.outputs.out);
    expect(compiled.model.nodes.find(item => item.id === 'observer')!.parameters).toEqual(omitCount ? {} : { inputCount: 1 });
    expect(compiled.nodes.find(item => item.id === 'observer')!.parameters).toEqual(omitCount ? {} : { inputCount: 1 });
    expect(compiled.semanticKey).toBe(canonicalSemantic(source));
  });
  it.each(['static', 'discrete', 'continuous'] as const)('records independently shaped/typed signals in %s without numeric conversion', async mode => {
    const values: SignalValue[] = [3, [4, 5], [[6, 7], [8, 9]], true,
      { kind: 'typed', dtype: 'uint64', shape: [], data: ['9007199254740993'] },
      { kind: 'typed', dtype: 'float32', shape: [2], data: [1.5, -2] },
      { kind: 'typed', dtype: 'complex128', shape: [], data: [{ re: 2, im: -3 }] },
      { kind: 'bus', fields: [{ name: 'nested', value: false }] }];
    const compiled = compileModel(model(type, values, mode));
    const result = await runModel(compiled);
    expect(result.status).toBe('completed');
    expect(result.samples.every(sample => JSON.stringify(sample.values.observer) === JSON.stringify(bus(values)))).toBe(true);
    const fields = compiled.outputTypes.observer!.bus!.fields;
    expect(fields.map(field => field.name)).toEqual(values.map((_, index) => portName(index)));
    fields.forEach((field, index) => expect(field.descriptor).toEqual(compiled.nodes.find(item => item.id === `source${index}`)!.outputs.out));
  });
  it('retains different input units rather than enforcing a shared unit', async () => {
    const compiled = compileModel(model(type, [2, [5, 7]], 'discrete', { units: ['m', 's'] }));
    expect(compiled.outputTypes.observer!.unit).toBe('1');
    expect(compiled.outputTypes.observer!.bus!.fields.map(field => field.descriptor.unit)).toEqual(['m', 's']);
    expect((await runModel(compiled)).samples[0]!.values.observer).toEqual(bus([2, [5, 7]]));
  });
  it('requires every declared input and rejects two writers or unknown ports', () => {
    const missing = legacyModel(type, 3); missing.edges.pop();
    failure(() => compileModel(missing), 'REQUIRED_INPUT_MISSING');
    const duplicate = legacyModel(type); duplicate.edges[1]!.target.portId = 'in';
    failure(() => compileModel(duplicate), 'MULTIPLE_INPUT_WRITERS');
    const unknown = legacyModel(type); unknown.edges[1]!.target.portId = 'in3';
    failure(() => compileModel(unknown), 'UNKNOWN_INPUT_PORT');
  });
  it('orders ports numerically through in16 and accepts 1024 combined numeric elements', async () => {
    const values = Array.from({ length: 16 }, (_, index) => Array(64).fill(index + 1) as number[]);
    const compiled = compileModel(model(type, values));
    expect((await runModel(compiled)).samples[0]!.values.observer).toEqual(bus(values));
  });
  it('rejects a combined 1025-element bus at compilation', () => {
    failure(() => compileModel(model(type, [Array(1024).fill(2) as number[], 3])), 'OBSERVER_SIGNAL_LIMIT');
  });
  it('rejects a new wrapper beyond the existing depth bound before runtime', () => {
    let nested: SignalValue = 2;
    for (let depth = 0; depth < 8; depth++) nested = { kind: 'bus', fields: [{ name: 'nested', value: nested }] };
    failure(() => compileModel(model(type, [nested, 3])), 'OBSERVER_SIGNAL_LIMIT');
  });
  it('charges the combined output against the full run recording budget', () => {
    const value = legacyModel(type, 16); value.execution.mode = 'discrete'; value.execution.stopTime = 10000;
    failure(() => compileModel(value), 'RESULT_BUDGET_EXCEEDED');
  });
  it('preserves signed zero and gives samples their own array storage', async () => {
    const compiled = compileModel(withComputedZero(model(type, [[-2, 2], [4, 5]], 'discrete')));
    const result = await runModel(compiled), first = result.samples[0]!.values.observer as BusSignal;
    expect(Object.is((first.fields[0]!.value as number[])[0], -0)).toBe(true);
    (first.fields[0]!.value as number[])[1] = 99;
    expect((result.samples[1]!.values.observer as BusSignal).fields[0]!.value).toEqual([-0, 0]);
    expect((await runModel(compiled)).samples[0]!.values.observer).toEqual(bus([[-0, 0], [4, 5]]));
  });
  it('does not hide typed NaN/Infinity values inside a combined recording', async () => {
    const value = model(type, [2, { kind: 'typed', dtype: 'float64', shape: [2], data: [0, 1] }]);
    value.nodes.push(node('denominator', 'source.typed', { value: { kind: 'typed', dtype: 'float64', shape: [], data: [0] } }), node('divide', 'typed.math', { operation: 'divide', special: 'preserve' }));
    value.edges.find(item => item.source.nodeId === 'source1')!.source.nodeId = 'divide';
    value.edges.push(edge('source1', 'divide', 'a'), edge('denominator', 'divide', 'b'));
    const result = await runModel(compileModel(value));
    const typed = (result.samples[0]!.values.observer as BusSignal).fields[1]!.value;
    if (typeof typed !== 'object' || Array.isArray(typed) || typed.kind !== 'typed') throw new Error('Expected typed result');
    expect(typed.data).toEqual(['NaN', 'Infinity']);
  });
  it('round-trips a finite mixed-unit multi-input history snapshot', async () => {
    const compiled = compileModel(model(type, [2, [5, 7]], 'discrete', { units: ['m', 's'] })), result = await runModel(compiled);
    const manifest = await createExportManifest(compiled);
    const history = validateRunHistory([{ id: 'multi-history', label: 'Recorded', createdAt: '2026-10-09T00:00:00Z', model: compiled.model, semanticHash: manifest.modelHash, engineVersion: manifest.engineVersion, manifest, result, outputIds: compiled.outputIds, outputTypes: compiled.outputTypes }]);
    expect(history[0]!.result.samples).toEqual(result.samples);
    expect(history[0]!.outputTypes.observer!.bus!.fields.map(field => field.descriptor.unit)).toEqual(['m', 's']);
  });
  it('rejects unsupported Python and WASM exports with an explicit observer diagnostic', () => {
    const compiled = compileModel(legacyModel(type));
    expect(getPythonDiagnostics(compiled).some(item => item.code === 'PYTHON_MULTI_INPUT_OBSERVER_UNSUPPORTED')).toBe(true);
    expect(getPythonDiagnostics(compiled, PYTHON_M7_TARGET).some(item => item.code === 'PYTHON_MULTI_INPUT_OBSERVER_UNSUPPORTED')).toBe(true);
    failure(() => exportPython(compiled), 'PYTHON_MULTI_INPUT_OBSERVER_UNSUPPORTED');
    failure(() => exportPython(compiled, undefined, PYTHON_M7_TARGET), 'PYTHON_MULTI_INPUT_OBSERVER_UNSUPPORTED');
    expect(getWasmDiagnostics(compiled).some(item => item.code === 'WASM_MULTI_INPUT_OBSERVER_UNSUPPORTED')).toBe(true);
    failure(() => generateWasm(compiled), 'WASM_MULTI_INPUT_OBSERVER_UNSUPPORTED');
  });
  it('retains existing single-input Python/WASM eligibility and declares structured TS capability only for multiple inputs', async () => {
    const one = compileModel(legacyModel(type, 1)), many = compileModel(legacyModel(type));
    expect(getPythonDiagnostics(one)).toEqual([]); expect(getPythonDiagnostics(one, PYTHON_M7_TARGET)).toEqual([]);
    expect(getWasmDiagnostics(one)).toEqual([]);
    expect((await createExportManifest(one)).targetVersion).toBe('typescript-m2-v1');
    expect((await createExportManifest(many)).targetVersion).toBe('typescript-m11-v1');
  });
  it('records both actual time-varying inputs at every observation rather than reusing one input', async () => {
    const value = legacyModel(type); value.execution = { mode: 'continuous', startTime: 0, stopTime: 1, step: .25 };
    value.nodes[0]!.blockType = 'source.ramp'; value.nodes[0]!.parameters = { startTime: 0, slope: 2, initial: 1 };
    value.nodes[1]!.blockType = 'source.sine-wave'; value.nodes[1]!.parameters = { frequency: 1, amplitude: 3, phase: 0, bias: 4 };
    const result = await runModel(compileModel(value));
    expect(result.samples.map(sample => (sample.values.observer as BusSignal).fields[0]!.value)).toEqual([1, 1.5, 2, 2.5, 3]);
    result.samples.forEach((sample, index) => expect((sample.values.observer as BusSignal).fields[1]!.value).toBeCloseTo([4, 7, 4, 1, 4][index]!, 12));
  });
  it('checks every secondary input rate and preserves explicit transition/hold behavior', async () => {
    const value = legacyModel(type); value.execution.mode = 'discrete'; value.execution.stopTime = 4;
    value.nodes[1]!.blockType = 'source.ramp'; value.nodes[1]!.parameters = { startTime: 0, slope: 2, initial: 1 }; value.nodes[1]!.sampleTime = { period: 2, offset: 0 };
    failure(() => compileModel(value), 'SAMPLE_TIME_MISMATCH');
    value.nodes.push(node('transition', 'time.rate-transition', { initial: -1 }));
    value.edges[1]!.source.nodeId = 'transition'; value.edges.push(edge('source1', 'transition'));
    const result = await runModel(compileModel(value));
    expect(result.samples.map(sample => (sample.values.observer as BusSignal).fields[0]!.value)).toEqual([1, 1, 1, 1, 1]);
    expect(result.samples.map(sample => (sample.values.observer as BusSignal).fields[1]!.value)).toEqual([-1, 1, 1, 5, 5]);
  });
  it.each(['static', 'discrete', 'continuous'] as const)('executes actual standalone TypeScript with raw complex/mixed-shape values in %s', async mode => {
    const values: SignalValue[] = [[-2, 2], { kind: 'typed', dtype: 'uint64', shape: [], data: ['9007199254740993'] }, { kind: 'typed', dtype: 'complex128', shape: [], data: [{ re: 2, im: -3 }] }];
    const compiled = compileModel(withComputedZero(model(type, values, mode)));
    const expected = await runModel(compiled), generated = await standalone(compiled);
    expect(generated.samples).toEqual(expected.samples);
    expect(generated.finalState).toEqual(expected.finalState);
    expect(generated.status).toBe('completed');
    expect(Object.is(((generated.samples[0]!.values.observer as BusSignal).fields[0]!.value as number[])[0], -0)).toBe(true);
  });
});
