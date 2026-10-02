import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { createExportManifest, exportTypeScript } from '../packages/codegen-ts/src';
import { exportPython } from '../packages/codegen-python/src';
import { ModelError, type RunResult } from '../packages/model/src';
import { TIME_SOURCE_FIXTURES, timeSourceModel } from './time-source-fixtures';

const stable = (result: RunResult) => { const { elapsedMs: _elapsed, ...rest } = result; return rest; };
async function standalone(code: string, strict = false) {
  const directory = await mkdtemp(join(tmpdir(), 'calcweave-time-sources-'));
  const source = join(directory, 'model.ts'), module = join(directory, 'model.mjs');
  try {
    if (strict) {
      await writeFile(source, code);
      const program = ts.createProgram([source], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, noEmit: true, strict: true, types: [], lib: ['lib.es2022.d.ts'], skipLibCheck: true });
      expect(ts.getPreEmitDiagnostics(program).map(item => ts.flattenDiagnosticMessageText(item.messageText, '\n'))).toEqual([]);
    }
    await writeFile(module, ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
    return await import(/* @vite-ignore */ pathToFileURL(module).href);
  } finally {
    for (const path of [source, module]) await unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await rmdir(directory);
  }
}

describe('expanded deterministic simulation waveforms', () => {
  for (const mode of ['discrete', 'continuous'] as const) it.each(TIME_SOURCE_FIXTURES)(`${mode}: $id matches independent raw samples and standalone TypeScript`, async fixture => {
    const compiled = compileModel(timeSourceModel(fixture, mode)), runtime = await runModel(compiled);
    for (const sample of runtime.samples) expect(Math.abs(Number(sample.values.result) - fixture.expected(sample.time))).toBeLessThanOrEqual(2e-12 * Math.max(1, Math.abs(fixture.expected(sample.time))));
    const manifest = await createExportManifest(compiled), generated = await standalone(exportTypeScript(compiled, manifest));
    expect(generated.run()).toEqual(stable(runtime)); expect(generated.getManifest()).toEqual(manifest);
    const roundtrip = compileModel(JSON.parse(JSON.stringify(compiled.model)));
    expect(stable(await runModel(roundtrip))).toEqual(stable(runtime));
    expect(() => exportPython(compiled)).toThrow(ModelError);
  });
  it.each(TIME_SOURCE_FIXTURES)('$id rejects static mode and preserves explicit source units', async fixture => {
    expect(() => compileModel(timeSourceModel(fixture, 'static'))).toThrow(ModelError);
    const model = timeSourceModel(fixture); model.nodes[0]!.unit = 'm';
    const compiled = compileModel(model); expect(compiled.outputTypes.result!.unit).toBe('m');
    expect((await runModel(compiled)).status).toBe('completed');
  });
  it.each([
    ['source.chirp', 'duration', 0], ['source.chirp', 'initialFrequency', -1],
    ['source.gaussian-pulse', 'width', 0], ['source.sinc-pulse', 'width', -1],
    ['source.logistic', 'center', 1_000_000_001], ['source.damped-sine', 'decay', -1],
  ] as const)('%s rejects invalid %s at the original node', (blockId, parameter, value) => {
    const fixture = TIME_SOURCE_FIXTURES.find(item => item.blockId === blockId)!;
    const model = timeSourceModel(fixture); model.nodes[0]!.parameters[parameter] = value;
    try { compileModel(model); expect.fail('invalid waveform must fail'); }
    catch (error) { expect(error).toBeInstanceOf(ModelError); expect((error as ModelError).diagnostics[0]?.nodeId).toBe('wave'); }
  });
  it('evaluates negative absolute seconds without shifting the waveform origin', async () => {
    for (const fixture of TIME_SOURCE_FIXTURES) {
      const model = timeSourceModel(fixture); model.execution.startTime = -1; model.execution.stopTime = 0; model.execution.step = 0.5;
      for (const sample of (await runModel(compileModel(model))).samples) expect(Number(sample.values.result)).toBeCloseTo(fixture.expected(sample.time), 11);
    }
  });
  it('keeps large positive/negative logistic exponents finite and centered', async () => {
    const model = timeSourceModel(TIME_SOURCE_FIXTURES[4]!); model.nodes[0]!.parameters.slope = 1_000_000;
    const result = await runModel(compileModel(model)); expect(result.samples[0]!.values.result).toBe(-2); expect(result.samples[4]!.values.result).toBe(0); expect(result.samples.at(-1)!.values.result).toBe(2);
  });
  it('preserves the last finite samples and exact overflow diagnostic in the generated program', async () => {
    const model = timeSourceModel(TIME_SOURCE_FIXTURES[3]!); model.nodes[0]!.parameters = { amplitude: 1, bias: 0, rate: 1_000 }; model.execution.stopTime = 1; model.execution.step = 0.5;
    const compiled = compileModel(model), generated = await standalone(exportTypeScript(compiled));
    let failure: ModelError | undefined;
    try { await runModel(compiled); expect.fail('overflow'); } catch (error) { failure = error as ModelError; }
    expect(failure?.diagnostics).toEqual([expect.objectContaining({ code: 'NUMERIC_NONFINITE', nodeId: 'wave', tick: 2, time: 1 })]);
    expect(failure?.partialResult?.samples).toHaveLength(2);
    try { generated.run(); expect.fail('generated overflow'); }
    catch (error) { expect((error as ModelError).diagnostics).toEqual(failure!.diagnostics); expect(stable((error as ModelError).partialResult!)).toEqual(stable(failure!.partialResult!)); }
  });
  it('classifies an exponential source as continuous before RK45 stages', async () => {
    const model = timeSourceModel(TIME_SOURCE_FIXTURES[3]!, 'continuous'); model.nodes[0]!.parameters = { amplitude: 1, rate: -1, bias: 0 };
    model.nodes.push({ id: 'integral', blockType: 'continuous.integrator', blockVersion: 1, label: 'Integral', parameters: { initial: 0 } });
    model.edges = [{ id: 'ode', source: { nodeId: 'wave', portId: 'out' }, target: { nodeId: 'integral', portId: 'in' } }, { id: 'output', source: { nodeId: 'integral', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }];
    model.execution.solver = { method: 'rk45', atol: 1e-10, rtol: 1e-9, initialStep: 0.05, maxStep: 0.05 };
    const compiled = compileModel(model), runtime = await runModel(compiled);
    expect(compiled.nodes.find(node => node.id === 'wave')!.executionDomain).toBe('continuous');
    for (const sample of runtime.samples) expect(Number(sample.values.result)).toBeCloseTo(-Math.expm1(-sample.time), 8);
    const generated = await standalone(exportTypeScript(compiled), true); expect(generated.run()).toEqual(stable(runtime));
  });
  it('strictly typechecks the independent discrete source without ambient Node/DOM types', async () => { await standalone(exportTypeScript(compileModel(timeSourceModel(TIME_SOURCE_FIXTURES[0]!))), true); });
});
