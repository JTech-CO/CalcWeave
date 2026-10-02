import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import ts from 'typescript';
import { blockRegistry } from '../packages/block-library/src';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { createExportManifest, exportTypeScript } from '../packages/codegen-ts/src';
import { ENGINE_VERSION, parseModelJson, serializeModel, type CalcModel, type RunResult, type SignalValue } from '../packages/model/src';

type Oracle = { id: string; model: CalcModel; expected: Record<string, SignalValue[]>; expectedFinalState?: Record<string, SignalValue>; reference: string };
const oracles: Oracle[] = [];
function graph(id: string, stop = 4, step = 1, start = 0): CalcModel {
  return { schemaVersion: 1, modelId: id, name: id, nodes: [], edges: [], layout: {}, execution: { mode: 'discrete', startTime: start, stopTime: stop, step } };
}
function node(model: CalcModel, id: string, type: string, parameters: Record<string, unknown> = {}, period = 1) {
  model.nodes.push({ id, blockType: type, blockVersion: 1, label: id, parameters, sampleTime: { period, offset: 0 } });
}
function wire(model: CalcModel, source: string, target: string, port = 'in') {
  model.edges.push({ id: `${source}-${target}-${port}`, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId: port } });
}
function output(model: CalcModel, source: string, id = 'result', period = 1) {
  node(model, id, 'sink.scope', {}, period); wire(model, source, id); return id;
}

{
  const model = graph('F02-delay-feedback', 5);
  node(model, 'one', 'source.constant', { value: 1 }); node(model, 'sum', 'math.sum', { signs: '++' });
  node(model, 'delay', 'discrete.unit-delay', { initial: 0 }); node(model, 'gain', 'math.gain', { gain: 0.9 });
  wire(model, 'one', 'sum', 'a'); wire(model, 'delay', 'gain'); wire(model, 'gain', 'sum', 'b'); wire(model, 'sum', 'delay'); output(model, 'sum');
  oracles.push({ id: model.modelId, model, expected: { result: [1, 1.9, 2.71, 3.439, 4.0951, 4.68559] }, reference: 'Hand recurrence y[n]=1+0.9*y[n-1], y[-1]=0; terminal tick does not commit.' });
}
{
  const model = graph('F02-delay-reset', 8);
  node(model, 'ramp', 'source.ramp', { startTime: 0, slope: 1, initial: 1 });
  node(model, 'pulse', 'source.pulse', { period: 4, width: 1, phase: 2 });
  node(model, 'threshold', 'source.constant', { value: 0.5 }); node(model, 'reset', 'logic.compare', { operation: 'gt' });
  node(model, 'delay', 'discrete.delay', { steps: 2, initial: -1, reset: 'level' });
  wire(model, 'pulse', 'reset', 'a'); wire(model, 'threshold', 'reset', 'b'); wire(model, 'ramp', 'delay'); wire(model, 'reset', 'delay', 'reset'); output(model, 'delay');
  oracles.push({ id: model.modelId, model, expected: { result: [-1, -1, 1, -1, -1, 4, 5, -1, -1] }, reference: 'Two FIFO slots initially -1; reset at n=2,6 restores next committed queue.' });
}
{
  const model = graph('F02-fir-impulse');
  node(model, 'impulse', 'source.pulse', { period: 10, width: 1 }); node(model, 'fir', 'discrete.fir', { coefficients: [1, 0.5, 0.25], initial: 0 });
  wire(model, 'impulse', 'fir'); output(model, 'fir');
  oracles.push({ id: model.modelId, model, expected: { result: [1, 0.5, 0.25, 0, 0] }, reference: 'Impulse response equals the three FIR coefficients followed by zeros.' });
}
{
  const model = graph('F02-transfer-function');
  node(model, 'one', 'source.constant', { value: 1 }); node(model, 'filter', 'discrete.transfer-function', { numerator: [1], denominator: [1, -0.5], initial: 0 });
  wire(model, 'one', 'filter'); output(model, 'filter');
  oracles.push({ id: model.modelId, model, expected: { result: [1, 1.5, 1.75, 1.875, 1.9375] }, reference: 'Hand recurrence y[n]=1+0.5*y[n-1], zero input/output histories.' });
}
{
  const model = graph('F02-state-space');
  node(model, 'one', 'source.constant', { value: 1 }); node(model, 'system', 'discrete.state-space', { A: [[0.5]], B: [1], C: [1], D: 0, initial: [0] });
  wire(model, 'one', 'system'); output(model, 'system');
  oracles.push({ id: model.modelId, model, expected: { result: [0, 1, 1.5, 1.75, 1.875] }, reference: 'x[n+1]=0.5*x[n]+1, y[n]=x[n], x[0]=0.' });
}
{
  const model = graph('F02-integrator-period', 1.5, 0.25);
  node(model, 'two', 'source.constant', { value: 2 }); node(model, 'integral', 'discrete.integrator', { initial: 0, gain: 1 }, 2);
  wire(model, 'two', 'integral'); output(model, 'integral', 'result', 2);
  oracles.push({ id: model.modelId, model, expected: { result: [0, 0, 1, 1, 2, 2, 3] }, reference: 'Due every 2 base ticks: increment 2*0.5=1; intervening samples hold.' });
}
{
  const model = graph('F02-typed-delay', 2);
  node(model, 'vector', 'source.constant', { value: [1, -2] }); node(model, 'delay', 'discrete.unit-delay', { initial: [0, 0] }); wire(model, 'vector', 'delay'); output(model, 'delay');
  oracles.push({ id: model.modelId, model, expected: { result: [[0, 0], [1, -2], [1, -2]] }, reference: 'Each vector channel reads the previous committed input; shape stays [2].' });
}
{
  const model = graph('F02-rate-1-2-5', 10);
  node(model, 'ramp', 'source.ramp'); node(model, 'rate2', 'time.rate-transition', { initial: -1 }, 2); node(model, 'rate5', 'time.rate-transition', { initial: -1 }, 5);
  wire(model, 'ramp', 'rate2'); wire(model, 'rate2', 'rate5'); output(model, 'rate5', 'result', 5);
  oracles.push({ id: model.modelId, model, expected: { result: [-1, -1, -1, -1, -1, 3, 3, 3, 3, 3, 7] }, reference: 'Read-before-write buffers: P2 publishes -1,1,3,5,7 at n=0,2,4,6,8; P5 reads previous publications.' });
}
{
  const model = graph('F02-rate-5-2', 10);
  node(model, 'slow', 'source.ramp', {}, 5); node(model, 'fast', 'time.rate-transition', { initial: -1 }, 2); wire(model, 'slow', 'fast'); output(model, 'fast', 'result', 2);
  oracles.push({ id: model.modelId, model, expected: { result: [-1, -1, 0, 0, 0, 0, 5, 5, 5, 5, 5] }, reference: 'Slow source publishes at n=0,5,10; simultaneous receiver at n=0,10 reads old publication.' });
}
{
  const model = graph('F02-time-sources', 1, 0.25, -1);
  const inputs: Array<[string, string, Record<string, unknown>]> = [
    ['step', 'source.step', { stepTime: 0, before: -1, after: 2 }],
    ['ramp', 'source.ramp', { startTime: -0.5, slope: 2, initial: 1 }],
    ['sine', 'source.sine-wave', { amplitude: 2, frequency: 1, phase: 0, bias: 1 }],
    ['pulse', 'source.pulse', { amplitude: 3, period: 4, width: 2, phase: 1 }],
    ['clock', 'source.clock', {}], ['digital', 'source.digital-clock', {}],
    ['sequence', 'source.repeating-sequence', { times: [0, 0.5, 1], values: [0, 2, 0], interpolation: 'linear' }],
  ];
  for (const [id, type, parameters] of inputs) { node(model, id, type, parameters); output(model, id, `${id}-out`); }
  oracles.push({ id: model.modelId, model, expected: {
    'step-out': [-1, -1, -1, -1, 2, 2, 2, 2, 2], 'ramp-out': [1, 1, 1, 1.5, 2, 2.5, 3, 3.5, 4],
    'sine-out': [1, 3, 1, -1, 1, 3, 1, -1, 1], 'pulse-out': [0, 3, 3, 0, 0, 3, 3, 0, 0],
    'clock-out': [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1], 'digital-out': [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1],
    'sequence-out': [0, 1, 2, 1, 0, 1, 2, 1, 0],
  }, reference: 'Hand piecewise/quarter-wave values at absolute times -1..1; repeating-sequence positive modulo and tick-based pulse.' });
}
{
  const model = graph('F02-seeded-random', 3);
  node(model, 'uniform', 'source.random', { distribution: 'uniform', seed: 0, min: -1, max: 1 });
  node(model, 'normal', 'source.random', { distribution: 'normal', seed: 7, mean: 2, variance: 4 });
  output(model, 'uniform', 'uniform-out'); output(model, 'normal', 'normal-out');
  // Independent reference uses exact BigInt arithmetic, not the implementation's Math.imul kernel.
  function draws(seed: number, count: number) {
    let state = BigInt(seed); const values: number[] = [];
    for (let i = 0; i < count; i++) { state = (1664525n * state + 1013904223n) % 4294967296n; values.push((Number(state) + 0.5) / 4294967296); }
    return values;
  }
  const normal = draws(7, 8);
  oracles.push({ id: model.modelId, model, expected: { 'uniform-out': draws(0, 4).map(value => -1 + 2 * value), 'normal-out': Array.from({ length: 4 }, (_, i) => 2 + 2 * Math.sqrt(-2 * Math.log(normal[i * 2]!)) * Math.cos(2 * Math.PI * normal[i * 2 + 1]!)) }, reference: 'Exact BigInt LCG modulo 2^32 plus specified open-interval uniforms and two-draw Box-Muller cosine; per-node seeds 0 and 7.' });
}
{
  const model = graph('F02-lookup-and-bits', 0); model.execution.mode = 'static';
  node(model, 'values', 'source.constant', { value: [-1, 0.25, 2] }); node(model, 'lookup', 'lookup.interpolated', { breakpoints: [0, 1], values: [0, 10] }); wire(model, 'values', 'lookup'); output(model, 'lookup', 'lookup-out');
  node(model, 'uint', 'source.constant', { value: 2147483649 }); node(model, 'bits', 'logic.bitwise', { operation: 'shift-left', width: 32, shift: 1 }); wire(model, 'uint', 'bits', 'a'); output(model, 'bits', 'bits-out');
  oracles.push({ id: model.modelId, model, expected: { 'lookup-out': [[0, 2.5, 10]], 'bits-out': [2] }, reference: 'Clipped linear 1-D interpolation; unsigned 0x80000001 left shift wraps modulo 2^32 to 2.' });
}

function equal(actual: unknown, expected: unknown, path: string): void {
  if (typeof actual === 'number' && typeof expected === 'number') {
    assert(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-12 + 1e-12 * Math.abs(expected), `${path}: ${actual} != ${expected}`); return;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) { assert.equal(actual.length, expected.length, path); actual.forEach((value, index) => equal(value, expected[index], `${path}[${index}]`)); return; }
  if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
    for (const key of Object.keys(expected)) equal((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${path}.${key}`); return;
  }
  assert.deepEqual(actual, expected, path);
}
{
  const model = graph('F02-offset-terminal', 2);
  node(model, 'input', 'source.constant', { value: [3, 4] }); node(model, 'delay', 'discrete.unit-delay', { initial: [7, 8] }, 2);
  wire(model, 'input', 'delay'); output(model, 'delay', 'result', 2);
  model.nodes.find(block => block.id === 'delay')!.sampleTime!.offset = 1;
  model.nodes.find(block => block.id === 'result')!.sampleTime!.offset = 1;
  oracles.push({ id: model.modelId, model, expected: { result: [[0, 0], [7, 8], [7, 8]] }, expectedFinalState: { delay: [7, 8] }, reference: 'P2/O1: Scope initializes zero before first due; n1 reads initial [7,8], n2 holds it. finalState projects last output while next committed memory can be [3,4].' });
}
{
  const model = graph('F02-difference-derivative-edges', 2, 0.5);
  node(model, 'ramp', 'source.ramp', { slope: 2 }); node(model, 'difference', 'discrete.difference', { initial: 0 }); node(model, 'derivative', 'discrete.derivative', { initial: 0 });
  wire(model, 'ramp', 'difference'); wire(model, 'ramp', 'derivative'); output(model, 'difference', 'difference-out'); output(model, 'derivative', 'derivative-out');
  node(model, 'pulse', 'source.pulse', { period: 4, width: 2 }); node(model, 'threshold', 'source.constant', { value: 0.5 }); node(model, 'boolean', 'logic.compare', { operation: 'gt' });
  wire(model, 'pulse', 'boolean', 'a'); wire(model, 'threshold', 'boolean', 'b');
  for (const mode of ['rising', 'falling', 'either']) { node(model, mode, 'logic.edge-detect', { mode, initial: false }); wire(model, 'boolean', mode); output(model, mode, `${mode}-out`); }
  oracles.push({ id: model.modelId, model, expected: { 'difference-out': [0, 1, 1, 1, 1], 'derivative-out': [0, 2, 2, 2, 2], 'rising-out': [true, false, false, false, true], 'falling-out': [false, false, true, false, false], 'either-out': [true, false, true, false, true] }, reference: 'Ramp du=1 each 0.5s; derivative=2. Boolean pulse [T,T,F,F,T] compared to previous due input initially false for all three edge modes.' });
}
{
  const model = graph('F02-timeless-publication', 5);
  node(model, 'input', 'source.constant', { value: 3 }, 5); model.nodes[0]!.sampleTime!.offset = 2;
  node(model, 'boundary', 'time.rate-transition', { initial: -1 }); wire(model, 'input', 'boundary'); output(model, 'boundary');
  oracles.push({ id: model.modelId, model, expected: { result: [-1, -1, -1, 3, 3, 3] }, reference: 'Constant holds configured value from start, but explicit P5/O2 producer publishes only at end of n2; P1 receiver reads it from n3.' });
}
function stable(result: RunResult) { const { elapsedMs: _elapsed, ...rest } = result; return rest; }
await mkdir('fixtures/m2', { recursive: true }); await mkdir('docs/evidence', { recursive: true });
const m4Additions = new Set(['source.dataset', 'unit.convert', 'route.bus-create', 'route.bus-select', 'hierarchy.subsystem', 'annotation.note', 'annotation.model-info', 'math.matrix-multiply', 'matrix.transpose', 'matrix.determinant', 'matrix.inverse', 'matrix.solve', 'matrix.cholesky', 'matrix.lu', 'lookup.2d', 'lookup.prelookup', 'fixed.quantize']);
assert(blockRegistry.length >= 45); assert.equal(blockRegistry.filter(block => !m4Additions.has(block.id) && block.supportedModes.includes('static')).length, 26);
const evidence = [];
for (const oracle of oracles) {
  const compiled = compileModel(oracle.model); const result = await runModel(compiled);
  assert.equal(result.status, 'completed');
  for (const [id, expected] of Object.entries(oracle.expected)) equal(result.samples.map(sample => sample.values[id]), expected, `${oracle.id}.${id}`);
  if (oracle.expectedFinalState) equal(result.finalState, oracle.expectedFinalState, `${oracle.id}: independent finalState oracle`);
  const reopened = compileModel(parseModelJson(serializeModel(compiled.model))); assert.equal(reopened.semanticKey, compiled.semanticKey);
  const reordered = compileModel({ ...compiled.model, nodes: [...compiled.model.nodes].reverse(), edges: [...compiled.model.edges].reverse() });
  equal(stable(await runModel(reordered)), stable(result), `${oracle.id}: insertion order`);
  const manifest = await createExportManifest(compiled);
  assert.equal(manifest.modelHash, createHash('sha256').update(compiled.semanticKey).digest('hex'));
  const code = exportTypeScript(compiled, manifest);
  const javascript = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  // Test-only import of repository-generated standalone code, never arbitrary model source.
  const exported = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
  const exportedResult: RunResult = exported.run(); equal(stable(exportedResult), stable(result), `${oracle.id}: standalone TS parity`);
  equal(exported.getManifest(), manifest, `${oracle.id}: manifest parity`);
  if (ENGINE_VERSION.endsWith('-m2')) {
    await writeFile(`fixtures/m2/${oracle.id}.cw.json`, serializeModel(compiled.model) + '\n');
    await writeFile(`fixtures/m2/${oracle.id}.expected.json`, JSON.stringify({ reference: oracle.reference, tolerance: { absolute: 1e-12, relative: 1e-12 }, result: stable(result), manifest }, null, 2) + '\n');
  }
  evidence.push({ id: oracle.id, reference: oracle.reference, nodes: compiled.nodes.length, samples: result.samples.length, outputTypes: compiled.outputTypes, stateElements: compiled.stateElements, modelHash: manifest.modelHash, elapsedMs: result.elapsedMs, jsonRoundtrip: true, nodeOrderIndependent: true, independentTSParity: true, manifestParity: true });
}
const report = { generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length }, registry: { total: blockRegistry.length, static: blockRegistry.filter(block => block.supportedModes.includes('static')).length, m2StaticBaseline: 26 }, methodology: 'Independent hand recurrence, impulse, matrix, multirate timelines, piecewise source values and exact BigInt PRNG references. Compare every recorded output with atol=rtol=1e-12, normalized JSON roundtrip, reversed node/edge insertion order, import-free generated TypeScript samples/finalState/stateMemory and SHA-256 manifest. Timing is a single observation, not a performance guarantee.', fixtures: evidence };
await writeFile(ENGINE_VERSION.endsWith('-m2') ? 'docs/evidence/m2-verification.json' : `docs/evidence/m2-regression-on-${ENGINE_VERSION.split('-').at(-1)}.json`, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
