import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { blockRegistry } from '../packages/block-library/src';
import { ENGINE_VERSION, serializeModel, parseModelJson, type CalcModel, type SignalValue } from '../packages/model/src';
import { createExample } from '../apps/web/src/examples';

const oracles: Record<string, SignalValue[]> = {
  'budget-calculator': [35_000],
  'vector-shape': [[[3, -6], [9, 12]], -6],
  'formula-calculator': [4],
  'unit-scale': [3.5],
};

await mkdir('fixtures/m1', { recursive: true });
await mkdir('docs/evidence', { recursive: true });
const m1Static = ['source.constant', 'io.input', 'math.gain', 'math.sum', 'math.multiply', 'sink.display',
  'math.abs', 'math.function', 'math.trigonometric', 'math.round', 'math.minmax', 'math.sqrt',
  'logic.compare', 'logic.boolean', 'route.switch', 'nonlinear.saturation', 'route.mux', 'route.demux',
  'math.concatenate', 'matrix.reshape', 'io.output', 'io.terminator', 'math.expression'];
assert.equal(m1Static.length, 23);
for (const id of m1Static) assert(blockRegistry.some(block => block.id === id && block.supportedModes.includes('static')), `M1 regression: ${id}`);
const fixtures = [];
for (const [id, expected] of Object.entries(oracles)) {
  const model = createExample(id);
  const compiled = compileModel(model);
  const reopened = compileModel(parseModelJson(serializeModel(model)));
  assert.equal(reopened.semanticKey, compiled.semanticKey, `${id}: portable JSON roundtrip`);
  const result = await runModel(compiled);
  const values = compiled.outputIds.map(output => result.samples[0]!.values[output]);
  assert.deepEqual(values.map(value => JSON.stringify(value)).sort(), expected.map(value => JSON.stringify(value)).sort(), `${id}: hand-calculated oracle`);
  assert.equal(result.status, 'completed');
  if (id === 'unit-scale') assert.equal(compiled.outputTypes[compiled.outputIds[0]!]!.unit, 'm');
  if (ENGINE_VERSION.endsWith('-m1')) await writeFile(`fixtures/m1/${id}.cw.json`, serializeModel(model) + '\n');
  fixtures.push({ id, nodes: model.nodes.length, edges: model.edges.length, expected, values, outputTypes: compiled.outputTypes, roundtrip: true });
}

function vectorChain(count: number): CalcModel {
  const nodes: CalcModel['nodes'] = [{ id: 'input', blockType: 'source.constant', blockVersion: 1, label: '64개 벡터', parameters: { value: Array.from({ length: 64 }, (_, i) => i) } }];
  const edges: CalcModel['edges'] = [];
  let previous = 'input';
  for (let index = 0; index < count - 2; index++) {
    const id = `gain-${index}`;
    nodes.push({ id, blockType: 'math.gain', blockVersion: 1, label: '배율', parameters: { gain: 1.0001 } });
    edges.push({ id: `edge-${index}`, source: { nodeId: previous, portId: 'out' }, target: { nodeId: id, portId: 'in' } });
    previous = id;
  }
  nodes.push({ id: 'result', blockType: 'sink.display', blockVersion: 1, label: '결과', parameters: {} });
  edges.push({ id: 'edge-result', source: { nodeId: previous, portId: 'out' }, target: { nodeId: 'result', portId: 'in' } });
  return { schemaVersion: 1, modelId: `m1-vector-chain-${count}`, name: `${count}노드 × 64원소`, nodes, edges, layout: {}, execution: { mode: 'static', startTime: 0, stopTime: 0, step: 1 } };
}
function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { medianMs: +sorted[Math.floor(sorted.length / 2)]!.toFixed(3), p95Ms: +sorted[Math.ceil(sorted.length * 0.95) - 1]!.toFixed(3), repetitions: samples.length };
}
const graphMeasurements = [];
for (const count of [100, 1000]) {
  const model = vectorChain(count);
  for (let warmup = 0; warmup < 2; warmup++) await runModel(compileModel(model));
  const compilation: number[] = [], execution: number[] = [];
  let maximumAbsoluteError = 0;
  for (let repetition = 0; repetition < 10; repetition++) {
    const started = performance.now();
    const compiled = compileModel(model);
    compilation.push(performance.now() - started);
    const result = await runModel(compiled);
    execution.push(result.elapsedMs);
    const actual = result.samples[0]!.values.result;
    assert(Array.isArray(actual) && actual.length === 64 && typeof actual[0] === 'number');
    maximumAbsoluteError = Math.max(maximumAbsoluteError, ...actual.map((item, index) => {
      assert.equal(typeof item, 'number');
      return Math.abs((item as number) - index * Math.pow(1.0001, count - 2));
    }));
  }
  assert(maximumAbsoluteError < 1e-8, 'Vector Gain chain exceeds oracle tolerance');
  graphMeasurements.push({ nodes: count, elementsPerSignal: 64, compilation: stats(compilation), execution: stats(execution), maximumAbsoluteError });
}
const report = {
  generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION,
  environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length },
  registry: { total: blockRegistry.length, static: blockRegistry.filter(block => block.supportedModes.includes('static')).length, m1StaticBaseline: 23 },
  methodology: 'Hand-calculated learning fixture oracles and portable JSON roundtrip. Node vector Gain chains: 2 warmups, 10 repetitions; compile and runtime measured separately. Browser loading, memory and novice usability are separate gates.',
  fixtures, graphMeasurements,
};
const reportPath = ENGINE_VERSION.startsWith('0.1.0-m1') ? 'docs/evidence/m1-verification.json' : `docs/evidence/m1-regression-on-${ENGINE_VERSION.split('-').at(-1)}.json`;
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
