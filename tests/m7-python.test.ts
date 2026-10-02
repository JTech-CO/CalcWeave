import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { createPythonExportManifest, exportPython, getPythonDiagnostics, PYTHON_TARGET } from '../packages/codegen-python/src';
import { importDataset } from '../packages/data/src';
import { ModelError, type CalcModel, type CompiledModel, type RunResult, type SubsystemDefinition } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { block, connect, M1_ENGINE_FIXTURES, M1_FAILURE_FIXTURES, staticModel } from './m1-engine-fixtures';
import { m2Edge, M2_ENGINE_FIXTURES, m2Model, m2Node, m2Unary, rateTransitionFixture, seededFixture, unsignedFixture } from './m2-engine-fixtures';

const execute = promisify(execFile);
// These tests execute the generated program with an actual independent Python interpreter.
const python = ['python', 'python3', 'py'].find(command => {
  try { return /^Python 3\.(1[0-9]|[2-9][0-9])\./.test(execFileSync(command, ['--version'], { encoding: 'utf8', windowsHide: true }).trim()); }
  catch { return false; }
});
if (!python) throw new Error('M7 independent execution tests require Python 3.10+ on PATH.');

type PortableResult = Omit<RunResult, 'elapsedMs'>;
type PortableError = { name: string; diagnostics: ModelError['diagnostics']; partialResult?: PortableResult };
type Reply = { manifest: ReturnType<typeof createPythonExportManifest>; result?: PortableResult; error?: PortableError };
function stableResult(result: RunResult | PortableResult): PortableResult {
  const { elapsedMs: _elapsed, ...rest } = result as RunResult; return rest;
}
function near(actual: unknown, expected: unknown): void {
  if (typeof expected === 'number') {
    expect(typeof actual).toBe('number'); expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(1e-12 * Math.max(1, Math.abs(expected))); return;
  }
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual)).toBe(true); expect((actual as unknown[]).length).toBe(expected.length);
    expected.forEach((value, index) => near((actual as unknown[])[index], value)); return;
  }
  if (expected !== null && typeof expected === 'object') {
    expect(Object.keys(actual as object).sort()).toEqual(Object.keys(expected).sort());
    for (const [key, value] of Object.entries(expected)) near((actual as Record<string, unknown>)[key], value); return;
  }
  expect(actual).toEqual(expected);
}
async function generated(compiled: CompiledModel, source = exportPython(compiled), harness?: string): Promise<Reply & Record<string, unknown>> {
  const directory = await mkdtemp(join(tmpdir(), 'calcweave-m7-python-'));
  const filename = join(directory, 'model.py'), runner = join(directory, 'verify.py');
  try {
    await writeFile(filename, source, 'utf8');
    if (harness) await writeFile(runner, harness, 'utf8');
    let stdout: string;
    try { stdout = (await execute(python!, ['-B', '-I', harness ? runner : filename], { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true })).stdout; }
    catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      if (failure.code !== 1 || !failure.stdout) throw error;
      stdout = failure.stdout; const parsed = JSON.parse(stdout) as Reply; expect(parsed.error?.name).toBe('ModelError');
    }
    return JSON.parse(stdout);
  } finally {
    if (harness) await unlink(runner);
    await unlink(filename); await rmdir(directory);
  }
}
async function parity(model: CalcModel): Promise<Reply> {
  const compiled = compileModel(model), original = JSON.stringify(compiled), runtime = await runModel(compiled), reply = await generated(compiled);
  expect(reply.error).toBeUndefined(); near(reply.result, stableResult(runtime)); expect(JSON.stringify(compiled)).toBe(original);
  expect(reply.manifest).toEqual(createPythonExportManifest(compiled)); return reply;
}

describe('M7 standalone Python approved static/discrete target', () => {
  it('has frozen capability metadata and source/IR hash-bound manifests', async () => {
    expect(PYTHON_TARGET.blockIds).toHaveLength(51); expect(Object.isFrozen(PYTHON_TARGET.blockIds)).toBe(true);
    const compiled = compileModel(M1_ENGINE_FIXTURES[0]!.model), metadata = createPythonExportManifest(compiled);
    expect(metadata).toMatchObject({ targetVersion: 'python-m7-v1', runtime: 'python-standard-library', minimumVersion: '3.10' });
    expect(metadata.modelHash).toBe(createHash('sha256').update(compiled.semanticKey).digest('hex'));
    expect(metadata.artifactDataHash).toMatch(/^[0-9a-f]{64}$/);
    const source = exportPython(compiled, metadata), hex = source.match(/_DATA_TEXT = bytes.fromhex\("([a-f0-9]+)"\)/)![1]!;
    expect(createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex')).toBe(metadata.artifactDataHash);
    expect(source).not.toMatch(/\beval\s*\(|\bexec\s*\(|\bimport\s+(numpy|calcweave|urllib|requests|subprocess|os)\b/);
    metadata.execution.startTime = 99; expect(createPythonExportManifest(compiled).execution.startTime).toBe(0);
    expect(() => exportPython(compiled, metadata)).toThrow(ModelError);
    const altered = structuredClone(compiled); altered.nodes[0]!.parameters.value = 123;
    expect(() => exportPython(altered)).toThrowError(expect.objectContaining({ diagnostics: [{ code: 'PYTHON_INVALID_IR', message: expect.any(String) }] }));
    const alteredKey = structuredClone(compiled); alteredKey.semanticKey += ' ';
    expect(() => exportPython(alteredKey)).toThrow(ModelError);
    expect((await generated(compiled)).manifest).toEqual(createPythonExportManifest(compiled));
  });

  it.each(M1_ENGINE_FIXTURES)('executes actual Python: $name', async fixture => {
    const reply = await parity(fixture.model); near(reply.result!.samples[0]!.values, fixture.expected);
  });
  it.each(M2_ENGINE_FIXTURES)('executes fixed-tick actual Python: $name', async fixture => {
    const reply = await parity(fixture.model); near(reply.result!.samples.map(sample => sample.values.result), fixture.expected);
  });
  it.each(M1_FAILURE_FIXTURES)('reports bounded numerical failure: $fixture.name', async ({ fixture, code }) => {
    const compiled = compileModel(fixture.model), reply = await generated(compiled);
    expect(reply.error).toMatchObject({ name: 'ModelError', diagnostics: [{ code, nodeId: 'operation' }], partialResult: { samples: [], finalState: {}, status: 'failed', steps: 0 } });
  });
  it.each([[1, 2, 0, 0], [2, 1, 0, 0], [2, 3, 1, 2], [3, 2, 2, 1]])('retains read-before-write publication at rates %s/%s', async (producer, consumer, producerOffset, consumerOffset) => {
    await parity(rateTransitionFixture(producer, consumer, producerOffset, consumerOffset));
  });
  it.each(['uniform', 'normal'] as const)('uses independent seeded %s state exactly once per due tick', async distribution => {
    await parity(seededFixture(distribution, 0xffffffff, 2, 1));
  });
  it.each(['and', 'or', 'xor', 'not', 'shift-left', 'shift-right'])('preserves unsigned 32-bit %s semantics', async operation => {
    await parity(unsignedFixture(operation, 0xefffffff, 0x80000001, 32, 31));
  });

  it('commits reset at the prior due boundary and never after the terminal sample', async () => {
    const model = m2Unary('discrete.integrator', { initial: [[2, 3]], gain: 2, reset: 'level' }, [[1, 2]], 2, .5);
    model.nodes.push(m2Node('reset', 'source.constant', { value: true })); model.edges.push(m2Edge('reset', 'operation', 'reset'));
    const reply = await parity(model); expect(reply.result!.samples.every(sample => JSON.stringify(sample.values.result) === '[[2,3]]')).toBe(true);
    const single = await parity(m2Unary('discrete.unit-delay', { initial: 3 }, 8, 0));
    expect(single.result!.finalState).toEqual({ operation: 3 }); expect(single.result!.stateMemory).toBeUndefined();
  });
  it('performs large integer-looking coefficients and time arithmetic in binary64', async () => {
    // These JSON literals look like integers but originated as rounded JS doubles.
    // Python arbitrary integer intermediates would change cancellation products.
    await parity(m2Unary('discrete.state-space', { A: [[9007199254740993000]], B: [-9007199254740993000], C: [1], D: 0, initial: [1] }, 1, 1));
    await parity(m2Unary('discrete.fir', { coefficients: [9007199254740993000, -9007199254740993000], initial: 3 }, 3, 1));
    const ramp = m2Model([m2Node('source', 'source.ramp', { slope: 9007199254740993000, initial: -27021597764222980000 }), m2Node('result', 'sink.scope')], [m2Edge('source', 'result')], 4);
    await parity(ramp);
  });
  it('rolls back held, random, matrix and transition state on failed evaluation', async () => {
    const model = m2Model([
      m2Node('a-random', 'source.random', { seed: 42 }), m2Node('b-source', 'source.ramp', { initial: 2, slope: -1 }),
      m2Node('c-matrix', 'source.constant', { value: [[3, 4]] }), m2Node('d-delay', 'discrete.unit-delay', { initial: [[-1, -2]] }),
      m2Node('e-error', 'math.expression', { expression: '1/x' }), m2Node('result', 'sink.scope'), m2Node('delay-result', 'sink.scope'),
    ], [m2Edge('b-source', 'e-error'), m2Edge('e-error', 'result'), m2Edge('c-matrix', 'd-delay'), m2Edge('d-delay', 'delay-result')], 4);
    const compiled = compileModel(model); let error: ModelError | undefined;
    try { await runModel(compiled); } catch (found) { error = found as ModelError; }
    expect(error).toBeInstanceOf(ModelError);
    const reply = await generated(compiled); expect(reply.error?.diagnostics).toMatchObject([{ code: 'NUMERIC_DIVIDE_BY_ZERO', nodeId: 'e-error', tick: 2, time: 2 }]);
    near(reply.error!.partialResult, stableResult(error!.partialResult!));
  });
  it('rolls back state when a transition itself overflows, retaining diagnostic prior tick', async () => {
    const model = m2Unary('discrete.integrator', { initial: 0, gain: 1e308 }, 1, 3);
    const compiled = compileModel(model), reply = await generated(compiled);
    expect(reply.error).toMatchObject({ diagnostics: [{ code: 'NUMERIC_NONFINITE', nodeId: 'operation', tick: 1, time: 1 }], partialResult: { steps: 2, finalState: { operation: 1e308 } } });
    let failure: ModelError | undefined; try { await runModel(compiled); } catch (error) { failure = error as ModelError; }
    near(reply.error!.partialResult, stableResult(failure!.partialResult!));
  });

  it('replays embedded datasets offline, with exact source/content references and bounds', async () => {
    const model = m2Model([m2Node('source', 'source.dataset', { datasetId: 'data', column: 'value', interpolation: 'linear', outside: 'hold' }), m2Node('result', 'sink.scope')], [m2Edge('source', 'result')], 3, .5);
    model.datasets = [importDataset('time,value\n0,10\n2,30', { id: 'data', name: 'source', format: 'csv', timeColumn: 'time', columns: [{ name: 'time', kind: 'number', unit: 's' }, { name: 'value', kind: 'number', unit: '1' }] })];
    const reply = await parity(model); expect(reply.manifest.dataReferences[0]!.contentHash).toBe(model.datasets[0]!.contentHash);
    model.nodes[0]!.parameters.outside = 'error'; const failed = await generated(compileModel(model));
    expect(failed.error).toMatchObject({ diagnostics: [{ code: 'DATASET_TIME_RANGE', nodeId: 'source', tick: 5, time: 2.5 }], partialResult: { steps: 5 } });
    model.datasets = [importDataset('time,value\n0,true\n1,false', { id: 'data', name: 'source', format: 'csv', timeColumn: 'time', columns: [{ name: 'time', kind: 'number', unit: 's' }, { name: 'value', kind: 'boolean', unit: '1' }] })];
    model.nodes[0]!.parameters.interpolation = 'previous'; model.nodes[0]!.parameters.outside = 'zero'; await parity(model);
  });
  it('bounds duplicated dataset IR before combined JSON and hexadecimal allocation', () => {
    const rows = Array.from({ length: 4000 }, (_, index) => `${index},${Number.MAX_VALUE}`).join('\n');
    const dataset = importDataset('time,value\n' + rows, { id: 'data', name: 'source', format: 'csv', timeColumn: 'time', columns: [{ name: 'time', kind: 'number', unit: 's' }, { name: 'value', kind: 'number', unit: '1' }] });
    const model = staticModel([...Array.from({ length: 100 }, (_, index) => block(`data${index}`, 'source.dataset', { datasetId: 'data', column: 'value', interpolation: 'previous' })), block('result', 'sink.display')], [connect('data0', 'result')]); model.datasets = [dataset];
    const compiled = compileModel(model);
    expect(() => createPythonExportManifest(compiled)).toThrowError(expect.objectContaining({ diagnostics: [expect.objectContaining({ code: 'EXPORT_RESOURCE_LIMIT' })] }));
    expect(() => exportPython(compiled)).toThrow(ModelError);
  });
  it('preserves explicit units and homogeneous named buses without host lookups', async () => {
    const model = staticModel([block('a', 'source.constant', { value: 50 }), block('b', 'source.constant', { value: 100 }), block('bus', 'route.bus-create', { first: 'x', second: 'y' }), block('select', 'route.bus-select', { field: 'y' }), block('convert', 'unit.convert', { from: 'cm', to: 'm' }), block('result', 'sink.display'), block('note', 'annotation.note', { text: '\"\"\"; __import__(\"os\").system(\"exit\") #\n</script>한글' }), block('info', 'annotation.model-info')], [connect('a', 'bus', 'a'), connect('b', 'bus', 'b'), connect('bus', 'select'), connect('select', 'convert'), connect('convert', 'result')]);
    model.nodes[0]!.unit = 'cm'; model.nodes[1]!.unit = 'cm';
    const reply = await parity(model); expect(reply.result!.samples[0]!.values.result).toBe(1); expect(reply.manifest.outputTypes.result!.unit).toBe('m');
    expect(exportPython(compileModel(model))).not.toContain('__import__');
  });
  it('expands supported nested diagrams and keeps definition references', async () => {
    const definition: SubsystemDefinition = { id: 'gainDef', version: 1, name: 'subsystem', nodes: [block('in', 'io.input'), block('gain', 'math.gain', { gain: 3 }), block('out', 'io.output')], edges: [connect('in', 'gain'), connect('gain', 'out')], layout: {}, inputs: [{ id: 'in', nodeId: 'in' }], outputs: [{ id: 'out', nodeId: 'out' }] };
    const model = staticModel([block('input', 'source.constant', { value: [2, 4] }), block('box', 'hierarchy.subsystem', { definitionId: 'gainDef', version: 1 }), block('result', 'sink.display')], [connect('input', 'box'), connect('box', 'result')]); model.subsystems = [definition];
    const reply = await parity(model); expect(reply.result!.samples[0]!.values.result).toEqual([6, 12]); expect(reply.manifest.hierarchyReferences).toHaveLength(1);
  });
  it('owns independent manifest, sample, memory and rerun arrays in imported Python', async () => {
    const compiled = compileModel(m2Unary('discrete.unit-delay', { initial: [[-1, -2]] }, [[3, 4]], 2));
    const harness = `import importlib.util,json,pathlib\nspec=importlib.util.spec_from_file_location("portable",pathlib.Path(__file__).with_name("model.py"))\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nfirst=m.run()\nfirst["samples"][1]["values"]["result"][0][0]=999\nassert first["finalState"]["operation"]==[[3,4]]\nfirst["finalState"]["operation"][0][0]=888\nassert first["stateMemory"]["operation"]["value"]==[[3,4]]\nfirst["stateMemory"]["operation"]["value"][0][0]=777\nmetadata=m.get_manifest()\nmetadata["execution"]["stopTime"]=99\nsecond=m.run()\nprint(json.dumps({"manifest":m.get_manifest(),"result":second},allow_nan=False))\n`;
    const reply = await generated(compiled, exportPython(compiled), harness); near(reply.result, stableResult(await runModel(compiled)));
    const tampered = exportPython(compiled).replace(/(_DATA_TEXT = bytes.fromhex\(")([a-f0-9]{2})/, '$100');
    const corrupted = await generated(compiled, tampered); expect(corrupted.error?.diagnostics[0]!.code).toBe('EXPORT_DATA_HASH_MISMATCH');
  });
  it('rejects continuous and unsupported advanced blocks before emitting any program', () => {
    const advanced = staticModel([block('source', 'source.constant', { value: [[1, 0], [0, 1]] }), block('matrix', 'matrix.inverse'), block('result', 'sink.display')], [connect('source', 'matrix'), connect('matrix', 'result')]);
    const compiled = compileModel(advanced); expect(getPythonDiagnostics(compiled)).toEqual([{ code: 'PYTHON_UNSUPPORTED_BLOCK', nodeId: 'matrix', message: expect.any(String) }]);
    expect(() => createPythonExportManifest(compiled)).toThrow(ModelError); expect(() => exportPython(compiled)).toThrow(ModelError);
    const continuous = staticModel([block('source', 'source.constant'), block('state', 'continuous.integrator'), block('result', 'sink.display')], [connect('source', 'state'), connect('state', 'result')]);
    continuous.execution = { mode: 'continuous', startTime: 0, stopTime: 1, step: .1 };
    const unsupported = getPythonDiagnostics(compileModel(continuous)); expect(unsupported.some(diagnostic => diagnostic.code === 'PYTHON_UNSUPPORTED_MODE' && diagnostic.nodeId === 'state')).toBe(true);
    expect(() => exportPython(compileModel(continuous))).toThrow(ModelError);
  });
  it('reports unsupported nested primitives at the original root block and subdiagram path', () => {
    const inner: SubsystemDefinition = { id: 'inner', version: 1, name: 'inner', nodes: [block('in', 'io.input', { value: [[1, 0], [0, 1]] }), block('inverse', 'matrix.inverse'), block('out', 'io.output')], edges: [connect('in', 'inverse'), connect('inverse', 'out')], layout: {}, inputs: [{ id: 'in', nodeId: 'in' }], outputs: [{ id: 'out', nodeId: 'out' }] };
    const outer: SubsystemDefinition = { id: 'outer', version: 1, name: 'outer', nodes: [block('in', 'io.input', { value: [[1, 0], [0, 1]] }), block('nested', 'hierarchy.subsystem', { definitionId: 'inner', version: 1 }), block('out', 'io.output')], edges: [connect('in', 'nested'), connect('nested', 'out')], layout: {}, inputs: [{ id: 'in', nodeId: 'in' }], outputs: [{ id: 'out', nodeId: 'out' }] };
    const model = staticModel([block('source', 'source.constant', { value: [[1, 0], [0, 1]] }), block('box', 'hierarchy.subsystem', { definitionId: 'outer', version: 1 }), block('result', 'sink.display')], [connect('source', 'box'), connect('box', 'result')]); model.subsystems = [inner, outer];
    const compiled = compileModel(model), diagnostic = getPythonDiagnostics(compiled)[0]!;
    expect(diagnostic).toMatchObject({ code: 'PYTHON_UNSUPPORTED_BLOCK', nodeId: 'box' });
    expect(diagnostic.message).toContain('box / nested / inverse'); expect(() => exportPython(compiled)).toThrow(ModelError);
  });
});
