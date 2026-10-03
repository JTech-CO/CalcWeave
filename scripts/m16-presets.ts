import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';
import { compileModel } from '../packages/compiler/src';
import { exportTypeScript, createExportManifest } from '../packages/codegen-ts/src';
import { ENGINE_VERSION } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';
import { M16_PRESET_FIXTURES } from '../tests/m16-independent-presets';
import { digest } from './m16-support-source';
export const PRESET_PROOF_PATH = 'docs/evidence/m16-preset-verification.json';
export async function verifyM16Presets(write = false): Promise<unknown> {
  const folder = resolve('.test-generated/m16-source-presets'); await mkdir(folder, { recursive: true });
  const fixtures = [];
  for (const fixture of M16_PRESET_FIXTURES) {
    const compiled = compileModel(fixture.model), native = await runModel(compiled); assert.equal(native.status, 'completed'); assert.equal(native.samples.length, 1); assert.equal(native.samples[0]!.values.Result, fixture.expected);
    const source = exportTypeScript(compiled), ast = ts.createSourceFile(`${fixture.id}.ts`, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    assert(!ast.statements.some(value => ts.isImportDeclaration(value) || ts.isImportEqualsDeclaration(value) || ts.isExportDeclaration(value) && value.moduleSpecifier), 'Generated program must be import-free');
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }, reportDiagnostics: true }); assert.equal(output.diagnostics?.length, 0);
    const filename = resolve(folder, `${fixture.id}.mjs`); await writeFile(filename, output.outputText);
    const actual = await import(pathToFileURL(filename).href + `?${digest(source)}`) as { run(): unknown; getManifest(): unknown };
    const { elapsedMs: _timing, ...expectedResult } = native;
    assert.deepEqual(actual.run(), expectedResult); assert.deepEqual(actual.getManifest(), await createExportManifest(compiled));
    const jsonModel = JSON.parse(JSON.stringify(fixture.model)); assert.equal(compileModel(jsonModel).semanticKey, compiled.semanticKey);
    const reverseModel = structuredClone(fixture.model); reverseModel.nodes.reverse(); reverseModel.edges.reverse(); assert.deepEqual((await runModel(compileModel(reverseModel))).samples, native.samples);
    fixtures.push({ id: fixture.id, sourceId: fixture.sourceId, canonical: fixture.canonical, parameters: fixture.parameters, modes: ['static'], expected: fixture.expected, actual: native.samples[0]!.values.Result,
      modelHash: digest(compiled.semanticKey), generatedSourceSha256: digest(source), actualStandaloneTypeScript: true, nativeLiteralOracle: true, manifestParity: true, fullSamplesFinalStateMemoryParity: true, jsonRoundtrip: true, insertionOrderIndependent: true });
  }
  const proof = { schemaVersion: 1, stage: 'M16', engineVersion: ENGINE_VERSION, purpose: 'Four historical M1 fixed presets revalidated with source-specific literal oracles; no original proof rewritten.', rawFixtures: 4, actualStandalonePrograms: 4, checkedSamples: 4, fixtures, fullSimulinkEquivalenceClaimed: false, originalSourceRuntimeExecuted: false };
  const bytes = JSON.stringify(proof, null, 2) + '\n';
  if (write) await writeFile(PRESET_PROOF_PATH, bytes); else assert.equal(await readFile(PRESET_PROOF_PATH, 'utf8'), bytes, 'M16 preset proof drifted');
  return proof;
}
