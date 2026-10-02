import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { exportTypeScript } from '../packages/codegen-ts/src';
import { runModel } from '../packages/runtime/src';
import { ModelError, type Diagnostic, type RunResult } from '../packages/model/src';
import { m5Graph, m5Node, m5Scope, m5Wire } from '../scripts/m5-oracles';

type PortableResult = Omit<RunResult, 'elapsedMs'> & { elapsedMs?: number };
type PortableFailure = { name: string; diagnostics: Diagnostic[]; partialResult?: PortableResult };
function stable(result: PortableResult): Omit<RunResult, 'elapsedMs'> { const { elapsedMs: _elapsed, ...rest } = result; return rest; }

// Follow the existing codegen tests: trusted fixed generator output is loaded
// as an actual import-free Node ESM module, without evaluating model text.
async function loadStandalone(source: string): Promise<{ run(): PortableResult }> {
  const folder = await mkdtemp(join(tmpdir(), 'calcweave-m5-partial-'));
  const filename = join(folder, 'model.mjs');
  try {
    const generated = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, reportDiagnostics: true });
    expect(generated.diagnostics?.filter(item => item.category === ts.DiagnosticCategory.Error)).toEqual([]);
    await writeFile(filename, generated.outputText, 'utf8');
    return await import(/* @vite-ignore */ pathToFileURL(filename).href);
  } finally {
    await unlink(filename).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(folder);
  }
}
async function failure(operation: () => PortableResult | Promise<PortableResult>): Promise<PortableFailure> {
  try { await operation(); expect.fail('The tick must fail on fixed-point overflow.'); }
  catch (error) {
    expect(error).toMatchObject({ name: 'ModelError', diagnostics: [{ code: 'FIXED_POINT_OVERFLOW', nodeId: 'bad', tick: 2, time: 0.2 }] });
    const found = error as PortableFailure; expect(found.partialResult).toBeDefined(); return found;
  }
}

function partialStateModel() {
  const model = m5Graph('m5-partial-state', 'discrete', 0.5, 0.1);
  m5Node(model, 'input', 'source.ramp', { slope: 1000 });
  m5Node(model, 'bad', 'fixed.quantize', { wordLength: 8, fractionLength: 0, overflow: 'error' });
  m5Wire(model, 'input', 'bad'); m5Scope(model, 'bad', 'result');
  m5Node(model, 'a-delay', 'discrete.unit-delay', { initial: -1 });
  m5Wire(model, 'input', 'a-delay'); m5Scope(model, 'a-delay', 'delay-result');
  m5Node(model, 'matrix-input', 'source.constant', { value: [[10, 20]] });
  m5Node(model, 'b-matrix-delay', 'discrete.unit-delay', { initial: [[-1, -2]] });
  m5Wire(model, 'matrix-input', 'b-matrix-delay'); m5Scope(model, 'b-matrix-delay', 'matrix-result');
  return model;
}

describe('M5 failed discrete ticks preserve the last complete state', () => {
  it('rolls back transition and held publications, with actual standalone ESM parity', async () => {
    const model = partialStateModel(), original = JSON.stringify(model), compiled = compileModel(model);
    const runtimeFailure = await failure(() => runModel(compiled));
    expect(runtimeFailure).toBeInstanceOf(ModelError);
    const partial = runtimeFailure.partialResult!;
    expect(partial.samples).toEqual([
      { time: 0, values: { 'delay-result': -1, 'matrix-result': [[-1, -2]], result: 0 } },
      { time: 0.1, values: { 'delay-result': 0, 'matrix-result': [[10, 20]], result: 100 } },
    ]);
    expect(partial).toMatchObject({ status: 'failed', steps: 2, finalState: { 'a-delay': 0 }, stateMemory: { 'a-delay': { value: 0 } } });
    const standalone = await loadStandalone(exportTypeScript(compiled)), generatedFailure = await failure(() => standalone.run());
    expect(generatedFailure.diagnostics).toEqual(runtimeFailure.diagnostics);
    expect(stable(generatedFailure.partialResult!)).toEqual(stable(partial));
    expect(JSON.stringify(model)).toBe(original);
  });

  it('owns independent sample, state and memory arrays across failed reruns in both engines', async () => {
    const model = partialStateModel(), original = JSON.stringify(model), compiled = compileModel(model);
    const standalone = await loadStandalone(exportTypeScript(compiled));
    for (const operation of [() => runModel(compiled), () => standalone.run()]) {
      const first = (await failure(operation)).partialResult!, expected = structuredClone(stable(first));
      const sampleMatrix = first.samples[1]!.values['matrix-result'] as number[][];
      const finalMatrix = first.finalState['b-matrix-delay'] as number[][];
      const memoryMatrix = (first.stateMemory!['b-matrix-delay'] as { value: number[][] }).value;
      expect(sampleMatrix).not.toBe(finalMatrix); expect(finalMatrix).not.toBe(memoryMatrix);
      sampleMatrix[0]![0] = 999; expect(finalMatrix).toEqual([[10, 20]]); expect(memoryMatrix).toEqual([[10, 20]]);
      finalMatrix[0]![0] = 888; expect(memoryMatrix).toEqual([[10, 20]]);
      memoryMatrix[0]![0] = 777; first.finalState['a-delay'] = 999;
      expect(stable((await failure(operation)).partialResult!)).toEqual(expected);
      expect(JSON.stringify(model)).toBe(original);
      expect(compiled.nodes.find(node => node.id === 'matrix-input')!.parameters.value).toEqual([[10, 20]]);
    }
  });
});
