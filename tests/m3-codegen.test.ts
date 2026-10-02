import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { exportTypeScript, createExportManifest } from '../packages/codegen-ts/src';
import { boundaryOracles, continuousOracles, decay } from '../scripts/m3-oracles';
import { ModelError, type RunResult } from '../packages/model/src';

function stable(result: RunResult) { const { elapsedMs: _elapsed, ...rest } = result; return rest; }
async function loadStandalone(code: string, strict = false) {
  const folder = await mkdtemp(join(tmpdir(), 'calcweave-continuous-export-'));
  const sourcePath = join(folder, 'model.ts'), modulePath = join(folder, 'model.mjs');
  try {
    if (strict) {
      await writeFile(sourcePath, code);
      const program = ts.createProgram([sourcePath], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: true, noEmit: true, types: [], lib: ['lib.es2022.d.ts'], skipLibCheck: true });
      expect(ts.getPreEmitDiagnostics(program).filter(d => d.category === ts.DiagnosticCategory.Error).map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
    }
    await writeFile(modulePath, ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText);
    return await import(/* @vite-ignore */ pathToFileURL(modulePath).href);
  } finally {
    await unlink(sourcePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await unlink(modulePath).catch(error => { if (error.code !== 'ENOENT') throw error; }); await rmdir(folder);
  }
}
describe('M3 standalone continuous and hybrid export', () => {
  it('strictly typechecks without DOM, Node types, imports or dynamic evaluation', async () => {
    const model = decay('rk45', 0.2, 20); model.name = '<script>globalThis.compromised=true</script>';
    const compiled = compileModel(model);
    const code = exportTypeScript(compiled); expect(code).not.toMatch(/\beval\s*\(|new\s+Function|\bimport\s/); expect(code).not.toContain('compromised');
    const generated = await loadStandalone(code, true); expect(generated.run()).toEqual(stable(await runModel(compiled)));
  });
  it.each([...continuousOracles(), ...boundaryOracles()])('$id matches every sample, state, event and statistic', async oracle => {
    const compiled = compileModel(oracle.model), manifest = await createExportManifest(compiled);
    const generated = await loadStandalone(exportTypeScript(compiled, manifest)), expected = stable(await runModel(compiled));
    expect(generated.run()).toEqual(expected); expect(generated.getManifest()).toEqual(manifest);
    const changed = generated.getManifest(); changed.execution.solver.atol = 1; expect(generated.getManifest()).toEqual(manifest);
    const result = generated.run(); result.samples[0].values[Object.keys(result.samples[0].values)[0]!] = 999;
    result.events.push({ time: 999, kind: 'reset', nodeIds: ['invented'] }); result.solverStatistics.acceptedSteps = -1;
    expect(generated.run()).toEqual(expected);
  });
  it.each(['steps', 'evaluations', 'rejects', 'minimum'] as const)('%s failure preserves matching last valid result', async kind => {
    const model = decay('rk45', 0.2, 20);
    model.execution.solver = { ...model.execution.solver, ...({ steps: { maxSteps: 1 }, evaluations: { maxEvaluations: 1 }, rejects: { maxRejects: 0 }, minimum: { minStep: 0.2 } }[kind]) };
    const compiled = compileModel(model), generated = await loadStandalone(exportTypeScript(compiled));
    let runtimeError: ModelError | undefined; try { await runModel(compiled); } catch (error) { expect(error).toBeInstanceOf(ModelError); runtimeError = error as ModelError; }
    expect(runtimeError?.partialResult?.status).toBe('failed');
    try { generated.run(); expect.fail('Standalone solver must fail'); } catch (error) {
      const actual = error as ModelError; expect(actual.diagnostics).toEqual(runtimeError!.diagnostics); expect(stable(actual.partialResult!)).toEqual(stable(runtimeError!.partialResult!));
    }
  });
});
