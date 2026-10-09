import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createSupportMatrix, digest, SUPPORT_PATH, SUPPORT_MD_PATH, supportMarkdown, verifyHistoricalSupportArtifacts } from './m16-support-source';
import { verifyM16Presets, PRESET_PROOF_PATH } from './m16-presets';
import { PYTHON_TARGET } from '../packages/codegen-python/src/capabilities';
import { WASM_TARGET } from '../packages/codegen-wasm/src/capabilities';
import { ENGINE_VERSION, type CalcModel } from '../packages/model/src';
import { compileModel } from '../packages/compiler/src';
import { getBlockDefinition } from '../packages/block-library/src';
import { M10_INDEPENDENT_FIXTURES, M10_INDEPENDENT_PRESET_FIXTURES, m10IndependentMode } from '../tests/m10-independent-fixtures';
import { M11_INDEPENDENT_DEFINITION_FIXTURES, M11_INDEPENDENT_BOUNDARY_FIXTURES } from '../tests/m11-independent-fixtures';
import { M12_INDEPENDENT_DEFINITION_FIXTURES, M12_INDEPENDENT_BOUNDARY_FIXTURES } from '../tests/m12-independent-fixtures';
import { M13_INDEPENDENT_DEFINITION_FIXTURES, M13_INDEPENDENT_BOUNDARY_FIXTURES } from '../tests/m13-independent-fixtures';
import { M14_INDEPENDENT_DEFINITION_FIXTURES, M14_INDEPENDENT_BOUNDARY_FIXTURES } from '../tests/m14-independent-fixtures';
import { validateSupportMatrix } from '../packages/support-matrix/src/validate';
import { m16UnitEvidenceInput, validateM16UnitResults, UNIT_RESULTS_MAX_BYTES } from './m16-unit-evidence';

interface ProofFixture { id: string; mode?: string; modelHash?: string; parameters?: Record<string, unknown>; blockIds?: string[]; actualStandaloneTypeScript?: boolean; independentOracle?: boolean; independentLiteralOracle?: boolean; metadataOracleFromDeclaredRegistry?: boolean; modes?: Record<string, { actualStandaloneTypeScript?: boolean }> }
const stage = /-(m\d+)$/.exec(ENGINE_VERSION)?.[1] ?? 'unknown';
const currentPresetProof = await verifyM16Presets(false);
const expected = await createSupportMatrix(), actual = validateSupportMatrix(JSON.parse(await readFile(SUPPORT_PATH,'utf8')));
const bytes = JSON.stringify(expected,null,2)+'\n'; assert.equal(await readFile(SUPPORT_PATH,'utf8'),bytes,'Matrix generation drift'); assert.equal(await readFile(SUPPORT_MD_PATH,'utf8'),supportMarkdown(expected),'Markdown generation drift');
assert.deepEqual(actual,expected); const second = await createSupportMatrix(); assert.equal(JSON.stringify(second),JSON.stringify(expected),'Generation must be deterministic');
// Two changed source files use exact historical blob bytes in the portable
// bounded snapshot; the other source files, inventory, baseline, approvals and
// execution proofs retain exact live-byte SHA checks. Fresh engine proof is below.
await verifyHistoricalSupportArtifacts(actual);

const cache = new Map<string, { fixtures: ProofFixture[]; presetEvidence?: ProofFixture[] }>();
const rawModels = [
  ...[...M10_INDEPENDENT_FIXTURES,...M10_INDEPENDENT_PRESET_FIXTURES].flatMap(value=>value.declaredModes.map(mode=>m10IndependentMode(value,mode))),
  ...M11_INDEPENDENT_DEFINITION_FIXTURES,...M11_INDEPENDENT_BOUNDARY_FIXTURES,...M12_INDEPENDENT_DEFINITION_FIXTURES,...M12_INDEPENDENT_BOUNDARY_FIXTURES,...M13_INDEPENDENT_DEFINITION_FIXTURES,...M13_INDEPENDENT_BOUNDARY_FIXTURES,...M14_INDEPENDENT_DEFINITION_FIXTURES,...M14_INDEPENDENT_BOUNDARY_FIXTURES,
];
const verifiedRawFixtureFiles: Record<string,string> = {};
for (const stage of ['m10','m11','m12','m13','m14']) {
  const approval=JSON.parse(await readFile(`docs/evidence/${stage}-source-approvals.json`,'utf8')) as {fixturePath:string;fixtureSha256:string};
  const sha=digest(await readFile(approval.fixturePath)); assert.equal(sha,approval.fixtureSha256,'Original independently authored fixture file changed'); verifiedRawFixtureFiles[approval.fixturePath]=sha;
}
let compilerNormalizedProfileChecks=0;
const profileAudits: { sourceId: string; evidencePath: string; fixtures: number; modes: string[]; declaredMetadataOnly: boolean }[] = [];
for (const row of actual.rows) for (const profile of row.capabilities.optionProfiles) {
  if (profile.evidencePath === PRESET_PROOF_PATH) { profileAudits.push({sourceId:row.id,evidencePath:profile.evidencePath,fixtures:profile.fixtureIds.length,modes:profile.modes,declaredMetadataOnly:false}); continue; }
  if (!cache.has(profile.evidencePath)) cache.set(profile.evidencePath,JSON.parse(await readFile(profile.evidencePath,'utf8')));
  const proof = cache.get(profile.evidencePath)!, records = [...proof.fixtures,...(proof.presetEvidence??[])];
  let metadataOnly = false;
  for (const fixtureId of profile.fixtureIds) {
    const fixture = records.find(value=>value.id===fixtureId || `${value.id}/${value.mode}`===fixtureId || Object.keys(value.modes??{}).some(mode=>`${value.id}/${mode}`===fixtureId));
    assert(fixture,`${row.id}: linked actual fixture ${fixtureId} absent`);
    assert(fixture.blockIds?.includes(row.implementations[0]!.id),`${row.id}: proof does not execute selected canonical`);
    if (fixture.modes) assert(Object.values(fixture.modes).every(value=>value.actualStandaloneTypeScript),`${fixtureId}: actual standalone mode execution missing`);
    else assert(fixture.actualStandaloneTypeScript,`${fixtureId}: actual standalone execution missing`);
    assert(fixture.independentOracle || fixture.independentLiteralOracle || fixture.metadataOracleFromDeclaredRegistry,`${fixtureId}: independent selected oracle/declaration missing`);
    metadataOnly ||= !!fixture.metadataOracleFromDeclaredRegistry;
    const nested = Object.values(fixture.parameters??{}).filter(value=>value&&typeof value==='object'&&'blockType' in value&& (value as {blockType:unknown}).blockType===row.implementations[0]!.id) as {parameters:Record<string,unknown>}[];
    const choices = nested.length ? nested.map(value=>value.parameters) : [fixture.parameters??{}];
    // Approved profiles can be partial selectors. Do not invent or claim unexecuted defaults.
    const directMatch=choices.some(parameters=>Object.entries(profile.parameters).every(([key,value])=>JSON.stringify(parameters[key])===JSON.stringify(value)));
    if (!directMatch) {
      // Compiler-owned JSON/shape/initial-output normalization is not the public parameter wire.
      // Bind the unchanged raw fixture to the original execution semantic SHA before comparing public selectors.
      const raw=rawModels.find(value=>value.name===fixture.id); assert(raw,`${row.id}: source fixture required for compiler-normalized profile`);
      const definition=getBlockDefinition(row.implementations[0]!.id)!;
      const parameterMatch=raw.model.nodes.filter(node=>node.blockType===definition.id).some(node=>Object.entries(profile.parameters).every(([key,value])=>JSON.stringify(node.parameters[key]??definition.parameters[key]?.default)===JSON.stringify(value)));
      assert(parameterMatch,`${row.id}: approved selector differs from raw actual fixture`);
      const changed=structuredClone(raw.model); changed.execution.mode=fixture.mode as CalcModel['execution']['mode']; if (fixture.mode==='static') changed.execution.stopTime=changed.execution.startTime;
      const candidates=[raw.model,changed];
      if (fixture.mode==='continuous') { const m11=structuredClone(changed); m11.execution.solver={method:'rk4',discreteStep:m11.execution.step,initialStep:m11.execution.step,maxStep:m11.execution.step}; candidates.push(m11); }
      assert(candidates.some(model=>digest(compileModel(model).semanticKey)===fixture.modelHash),`${row.id}: compiler-normalized fixture raw model not bound to executed semantic SHA`);
      compilerNormalizedProfileChecks++;
    }
  }
  profileAudits.push({sourceId:row.id,evidencePath:profile.evidencePath,fixtures:profile.fixtureIds.length,modes:profile.modes,declaredMetadataOnly:metadataOnly});
}

// These reports are actual fresh target execution gates, not deterministic public-data inputs.
const freshPaths = {
  integration: `docs/evidence/m15-regression-on-${stage}.json`, python: `docs/evidence/m15-python-regression-on-${stage}.json`, wasm: `docs/evidence/m15-wasm-regression-on-${stage}.json`, adapters: `docs/evidence/m14-regression-on-${stage}.json`,
};
const fresh = await Promise.all(Object.values(freshPaths).map(async path=>({path,bytes:await readFile(path)})));
const integration = JSON.parse(fresh[0]!.bytes.toString()), python=JSON.parse(fresh[1]!.bytes.toString()), wasm=JSON.parse(fresh[2]!.bytes.toString()), adapters=JSON.parse(fresh[3]!.bytes.toString());
for (const proof of [integration,python,wasm,adapters]) assert.equal(proof.engineVersion,ENGINE_VERSION,'Fresh actual target evidence must identify current engine');
assert.deepEqual(python.target.blockIds,PYTHON_TARGET.blockIds); assert.deepEqual(wasm.target.blockIds,WASM_TARGET.blockIds);
assert.equal(integration.python.actualPrograms,142); assert.equal(integration.wasm.counts.actualIncludingJsonReversePrograms,128);
assert.equal(integration.python.evidencePath,freshPaths.python); assert.equal(integration.python.evidenceSha256,digest(fresh[1]!.bytes));
assert.equal(integration.wasm.evidencePath,freshPaths.wasm); assert.equal(integration.wasm.evidenceSha256,digest(fresh[2]!.bytes));
assert.equal(adapters.counts.actualTypeScript,32); assert.equal(adapters.counts.checkedSamples,85);
assert.equal(adapters.fullSimulinkEquivalenceClaimed,false);
for (const row of actual.rows) for (const target of row.capabilities.targets) assert.equal(target.allConfigurationsVerified,false);

const sources = ['packages/support-matrix/src/types.ts','packages/support-matrix/src/validate.ts','packages/support-matrix/src/index.ts','scripts/m16-support-source.ts','scripts/generate-support-matrix.ts','scripts/m16-presets.ts','scripts/verify-m16.ts','scripts/m16-unit-evidence.ts','tests/m16-independent-presets.ts','tests/m16-support-matrix.test.ts'];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async path=>[path,digest(await readFile(path))])));
const unitInput=m16UnitEvidenceInput(process.env.CALCWEAVE_UNIT_RESULTS),unitBytes=await readFile(unitInput.path);
assert(unitBytes.length<=UNIT_RESULTS_MAX_BYTES,'Unit evidence exceeds bounded JSON size');
const unitEvidence=validateM16UnitResults(JSON.parse(unitBytes.toString('utf8')),unitInput.mode);
const report = { schemaVersion:1,stage:'M16',engineVersion:ENGINE_VERSION,generatedAt:new Date().toISOString(),status:'passed-selected-tracking-contract',counts:actual.counts,
  matrix:{path:SUPPORT_PATH,sha256:digest(bytes),utf8Bytes:Buffer.byteLength(bytes)},markdown:{path:SUPPORT_MD_PATH,sha256:digest(await readFile(SUPPORT_MD_PATH))},sourceArtifactHashes:sourceHashes,protectedArtifacts:actual.protectedArtifacts,
  qa:{sourceIdentityRowsChecked:385,sourceDecisionRowsChecked:385,canonicalParameterContractsChecked:352,registryDefinitionsObjectExact:337,officialSourceOptionInventoriesVerified:0,unverifiedSourceInventoryRows:385,
    sourceRowsWithActualLinkedProfiles:new Set(profileAudits.map(value=>value.sourceId)).size,linkedProfiles:profileAudits.length,selectedRowsWithoutLinkedOptionProfile:actual.rows.filter(row=>row.decision.status==='selected-subset'&&!row.capabilities.optionProfiles.length).length,
    declaredMetadataOracleProfiles:profileAudits.filter(value=>value.declaredMetadataOnly).length,profileParameterSelectorsMatchedActualExecutedFixtures:true,compilerNormalizedProfileChecks,generationByteIdentical:true,sourceSpecificPresetActualPrograms:4},
  verifiedRawFixtureFiles,
  supportUnitEvidence:{path:unitInput.path,sha256:digest(unitBytes),...unitEvidence},
  profileAudits,presetEvidence:{path:PRESET_PROOF_PATH,sha256:digest(await readFile(PRESET_PROOF_PATH)),actualStandalonePrograms:4,checkedSamples:4,frozenBytesPreserved:true,
    currentExecution:{engineVersion:currentPresetProof.engineVersion,actualStandalonePrograms:currentPresetProof.actualStandalonePrograms,checkedSamples:currentPresetProof.checkedSamples,fixtures:currentPresetProof.fixtures}},
  freshActualTargets:{reports:fresh.map(value=>({path:value.path,sha256:digest(value.bytes)})),pythonPrograms:142,pythonDefinitions:69,wasmActualPrograms:128,wasmDefinitions:16,adapterActualTypeScript:32,adapterSamples:85},
  fullSimulinkEquivalenceClaimed:false,nativeSourceReferenceRuntimeExecuted:false,exhaustiveR2024bOptionInventoryComplete:false,
  limitations:['Tracking and declared capability QA does not close any original full options. All385 official inventories remain unverified.','367 existing selected-subset rows and18 unsupported purposes remain unchanged. Missing source-specific early-stage profiles remain explicitly unverified.','Source option selectors are matched against preserved actual fixture parameters; partial selectors do not imply every parameter default or every combination was executed.','Declared-metadata oracle profiles such as Block Support Table verify the public catalog declaration, not independent MathWorks numerical parity.','Fresh target execution reports are verified separately; their nondeterministic timestamps/logs never enter deterministic public matrix generation.','No native C/C++ executable target or MATLAB/Simulink reference runtime is claimed.'] };
await mkdir('docs/evidence',{recursive:true});
const evidenceName=stage==='m16'&&!existsSync('docs/evidence/m16-engineering-checks.json')?'m16-verification':`m16-regression-on-${stage}`;
await writeFile(`docs/evidence/${evidenceName}.json`,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({evidenceName,counts:actual.counts,qa:report.qa,matrixSha256:report.matrix.sha256})+'\n');
