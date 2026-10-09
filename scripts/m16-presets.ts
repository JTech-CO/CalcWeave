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
import { digest, loadHistoricalSupportMatrix } from './m16-support-source';
import { HISTORICAL_SUPPORT_ENGINE_VERSION } from '../packages/support-matrix/src/current-extensions';
export const PRESET_PROOF_PATH = 'docs/evidence/m16-preset-verification.json';
export interface M16PresetProof {
  schemaVersion: number; stage: string; engineVersion: string; purpose: string;
  rawFixtures: number; actualStandalonePrograms: number; checkedSamples: number;
  fixtures: {
    id: string; sourceId: string; canonical: string; parameters: Record<string, unknown>; modes: string[];
    expected: number; actual: unknown; modelHash: string; generatedSourceSha256: string;
    actualStandaloneTypeScript: boolean; nativeLiteralOracle: boolean; manifestParity: boolean;
    fullSamplesFinalStateMemoryParity: boolean; jsonRoundtrip: boolean; insertionOrderIndependent: boolean;
  }[];
  fullSimulinkEquivalenceClaimed: boolean; originalSourceRuntimeExecuted: boolean;
}

/** The immutable old source hashes identify old code, not the current emitter. */
export function verifyM16PresetRegression(current: M16PresetProof, historicalBytes: string, pinnedSha256: string): void {
  assert.equal(digest(historicalBytes), pinnedSha256, 'Frozen M16 preset proof bytes changed');
  const historical = JSON.parse(historicalBytes) as M16PresetProof;
  assert.equal(historical.engineVersion, HISTORICAL_SUPPORT_ENGINE_VERSION, 'M16 preset historical engine identity changed');
  assert.equal(current.engineVersion, ENGINE_VERSION, 'Fresh M16 preset execution must identify the current engine');
  const contract = (proof: M16PresetProof) => {
    const { engineVersion: _engine, fixtures, ...rest } = proof;
    return { ...rest, fixtures: fixtures.map(fixture => {
      const { generatedSourceSha256, ...semantic } = fixture;
      assert(/^[a-f0-9]{64}$/.test(generatedSourceSha256), 'Invalid generated preset source fingerprint');
      return semantic;
    }) };
  };
  // Source identities, selectors, literal outputs, model SHA and every execution
  // gate remain exact. Only separately recorded emitter/version identities differ.
  assert.deepEqual(contract(current), contract(historical), 'Current M16 preset execution drifted from the frozen semantic contract');
}

export async function verifyM16Presets(write = false): Promise<M16PresetProof> {
  if (write) assert.equal(ENGINE_VERSION, HISTORICAL_SUPPORT_ENGINE_VERSION, 'Only the original M16 engine may write its historical preset proof');
  const historical = write ? undefined : await loadHistoricalSupportMatrix();
  const historicalBytes = write ? undefined : await readFile(PRESET_PROOF_PATH, 'utf8');
  const pinnedSha256 = historical?.artifacts[PRESET_PROOF_PATH];
  if (!write) {
    assert(typeof pinnedSha256 === 'string' && /^[a-f0-9]{64}$/.test(pinnedSha256), 'Frozen support matrix must pin the M16 preset proof');
    assert.equal(digest(historicalBytes!), pinnedSha256, 'Frozen M16 preset proof bytes changed');
  }
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
  const proof: M16PresetProof = { schemaVersion: 1, stage: 'M16', engineVersion: ENGINE_VERSION, purpose: 'Four historical M1 fixed presets revalidated with source-specific literal oracles; no original proof rewritten.', rawFixtures: 4, actualStandalonePrograms: 4, checkedSamples: 4, fixtures, fullSimulinkEquivalenceClaimed: false, originalSourceRuntimeExecuted: false };
  const bytes = JSON.stringify(proof, null, 2) + '\n';
  if (write) await writeFile(PRESET_PROOF_PATH, bytes); else verifyM16PresetRegression(proof, historicalBytes!, pinnedSha256!);
  return proof;
}
