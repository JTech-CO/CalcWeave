import { cpus, platform, release, totalmem } from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { ENGINE_VERSION, type CalcModel, type SignalValue } from '../packages/model/src';
import { EXAMPLES, createExample } from '../apps/web/src/examples';

function chain(count: number): CalcModel {
  const nodes: CalcModel['nodes'] = [{ id: 'input', label: '입력', blockType: 'source.constant', blockVersion: 1, parameters: { value: 1 } }];
  const edges: CalcModel['edges'] = [];
  let previous = 'input';
  for (let i = 0; i < count - 2; i++) {
    const id = `gain-${i}`;
    nodes.push({ id, label: '배율', blockType: 'math.gain', blockVersion: 1, parameters: { gain: 1.0001 } });
    edges.push({ id: `edge-${i}`, source: { nodeId: previous, portId: 'out' }, target: { nodeId: id, portId: 'in' } });
    previous = id;
  }
  nodes.push({ id: 'result', label: '결과', blockType: 'sink.display', blockVersion: 1, parameters: {} });
  edges.push({ id: 'edge-result', source: { nodeId: previous, portId: 'out' }, target: { nodeId: 'result', portId: 'in' } });
  return { schemaVersion: 1, modelId: `chain-${count}`, name: `${count} node chain`, nodes, edges, layout: {}, execution: { mode: 'static', startTime: 0, stopTime: 0, step: 1 } };
}
function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return { medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(3), p95Ms: +sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3), repetitions: values.length };
}

await mkdir('docs/evidence', { recursive: true });
await mkdir('fixtures/m0', { recursive: true });
const m0Examples = new Set(['first-calculation', 'discrete-feedback', 'continuous-decay']);
for (const example of EXAMPLES.filter(example => m0Examples.has(example.id))) await writeFile(`fixtures/m0/${example.id}.cw.json`, JSON.stringify(example.model, null, 2) + '\n');
function scalar(value: SignalValue): number {
  if (typeof value !== 'number') throw new Error('The M0 numerical benchmark requires a scalar number.');
  return value;
}
const graphMeasurements = [];
for (const count of [100, 1000]) {
  const model = chain(count);
  for (let warm = 0; warm < 5; warm++) await runModel(compileModel(model));
  const compilation: number[] = [], execution: number[] = [];
  let output = 0;
  for (let repetition = 0; repetition < 20; repetition++) {
    const before = performance.now();
    const compiled = compileModel(model);
    compilation.push(performance.now() - before);
    const result = await runModel(compiled);
    execution.push(result.elapsedMs);
    output = scalar(result.samples[0].values.result);
  }
  graphMeasurements.push({ nodeCount: count, edgeCount: count - 1, compilation: stats(compilation), execution: stats(execution), output, reference: Math.pow(1.0001, count - 2), absoluteError: Math.abs(output - Math.pow(1.0001, count - 2)) });
}
const convergence = [];
for (const step of [0.2, 0.1, 0.05]) {
  const model = createExample('continuous-decay');
  model.execution.step = step;
  const result = await runModel(compileModel(model));
  const value = scalar(result.samples.at(-1)!.values.result);
  convergence.push({ step, stopTime: 5, value, reference: Math.exp(-5), absoluteError: Math.abs(value - Math.exp(-5)), samples: result.steps });
}
const large = chain(1000);
large.execution = { mode: 'discrete', startTime: 0, stopTime: 10000, step: 1 };
const abort = new AbortController();
let requestedAt = 0;
const cancellationStarted = performance.now();
const cancelled = await runModel(compileModel(large), {
  signal: abort.signal,
  onProgress: () => { if (!abort.signal.aborted) { requestedAt = performance.now(); abort.abort(); } },
});
if (cancelled.status !== 'cancelled') throw new Error('Cancellation fixture did not cancel');
const report = {
  generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION,
  environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryGiB: +(totalmem() / 1024 ** 3).toFixed(2) },
  methodology: 'Node scalar chain, 5 warmups + 20 runs; compile and runtime timings separate. Not a browser/UI performance guarantee.',
  graphMeasurements, convergence,
  cancellation: { status: cancelled.status, recordedSamples: cancelled.steps, requestToReturnMs: +(performance.now() - requestedAt).toFixed(3), overallMs: +(performance.now() - cancellationStarted).toFixed(3), note: 'Cooperative AbortSignal from progress callback; browser cancel and hard watchdog verified separately.' },
};
await writeFile('docs/evidence/m0-benchmark.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
