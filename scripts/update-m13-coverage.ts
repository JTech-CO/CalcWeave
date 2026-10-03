import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { blockRegistry, getBlockDefinition } from '../packages/block-library/src';
import { M13_BLOCK_IDS } from '../packages/block-library/src/m13';
import { compileModel } from '../packages/compiler/src';
import { ENGINE_VERSION, type ExecutionMode } from '../packages/model/src';
import { M13_INDEPENDENT_DEFINITION_FIXTURES, M13_INDEPENDENT_BOUNDARY_FIXTURES, M13_INDEPENDENT_FAILURE_FIXTURES } from '../tests/m13-independent-fixtures';

const args = process.argv.slice(2);
assert(args.length === 1 && ['--check', '--write', '--verify'].includes(args[0]!), 'Use --check, --write or --verify');
const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
const sourcePath = 'dataset/Simulink_Basic_Blocks_R2024b.md', coveragePath = 'docs/block-coverage.md', mapPath = 'docs/m13-implementation-map.json';
const evidencePath = 'docs/evidence/m13-verification.json', approvalPath = 'docs/evidence/m13-source-approvals.json', fixturePath = 'tests/m13-independent-fixtures.ts', uiPath = 'docs/evidence/m13-ui-workflow-verification.json';
const previous = JSON.parse(await readFile('docs/evidence/m12-source-approvals.json', 'utf8')) as { protectedArtifacts: Record<string, string>; currentSourceSubset: number };
const protectedArtifacts: Record<string, string> = { ...previous.protectedArtifacts,
  'docs/baselines/m12-registry.json': '5eb19914ff0643307bb8c5c01b22557ad935558230a217e50ff8de6ee1867a73',
  'docs/evidence/m12-source-approvals.json': 'a3e2201b9672a4eac21f90a37b893ee0daf2c2a9b6d912654b46b1e1618a449b',
  'docs/evidence/m12-verification.json': '79253d162a1af3ca5f5bbe2eb9de14d0fbc3e5aaa107795586678ab8f896f0c7' };
async function verifyProtected() { assert.equal(Object.keys(protectedArtifacts).length, 18); for (const [path, hash] of Object.entries(protectedArtifacts)) assert.equal(digest(await readFile(path)), hash, `${path}: frozen predecessor/source artifact changed`); }
await verifyProtected();

interface Selection { canonical: string; parameters: Record<string, unknown>; requiredBindings: string[]; classification: string; boundary: string }
interface Row { id: string; sourceName: string; sourceSection: number; sourceOrdinal: number; sourceLine: number; sourceSubgroup: string; sourceCondition: string; originalIdentitySha256: string; baselineCanonical: string; baselineStatus: string; baselineExistingSubset: boolean; baselineRoadmapRow: unknown; baselineRoadmapRowSha256: string; sourceOptionCompletionStatus: string; nativeFullEquivalent: false; executionEquivalenceClaimed: false; selectedImplementation: Selection; approvalStatus: string; approval?: Record<string, unknown> }
interface Proof { id: string; mode: ExecutionMode; sourceIds: string[]; blockIds: string[]; parameters: Record<string, { blockType: string; parameters: Record<string, unknown>; sampleTime: unknown }>; samples: number; maximumScaledError: number; oracleTolerance: number; parityTolerance: number; independentLiteralOracle: boolean; metadataOracleFromDeclaredRegistry: boolean; strictStandaloneTemplateModeVerified: boolean; strictProgramIndividuallyChecked: boolean; importFreeStandalone: boolean; actualStandaloneTypeScript: boolean; fullSamplesFinalStateMemoryParity: boolean; exactManifest: boolean; jsonRoundtrip: boolean; insertionOrderIndependent: boolean; pythonUnsupportedNodeDiagnostics: boolean; targetVersion: string }
interface UIProfile { sourceRowId: string; blockType: string; parameters: Record<string, unknown>; kind?: string; appearance: string; orientation: string; gaugeStyle?: string; widgetRendered: boolean; controlOrObservationValidated: boolean; evidenceTest: string }
const implementation = JSON.parse(await readFile(mapPath, 'utf8')) as { baseline: { sourceRows: number; uniqueSourceNameStrings: number; datasetSha256: string; roadmapSha256: string }; counts: Record<string, number>; rows: Row[]; selectedDefinitions: { id: string; modes: ExecutionMode[]; approvalStatus: string }[]; implementationStatus: string; deliveryGate: Record<string, unknown>; claimScope: string };
const evidenceBytes = await readFile(evidencePath), evidence = JSON.parse(evidenceBytes.toString('utf8')) as { engineVersion: string; registryDefinitions: number; addedDefinitions: number; predecessorDefinitionsUnchanged: number; fullSimulinkEquivalenceClaimed: boolean; counts: Record<string, number>; parityTolerance: number; fixtures: Proof[]; failures: { name: string; phase: string; diagnosticCode: string; actualTypeScriptExecuted: boolean; fullPartialParity?: boolean }[] };
assert.equal(implementation.baseline.sourceRows, 385); assert.equal(implementation.baseline.uniqueSourceNameStrings, 339);
assert.equal(implementation.baseline.datasetSha256, protectedArtifacts[sourcePath]); assert.equal(implementation.baseline.roadmapSha256, protectedArtifacts['docs/simulink-coverage-roadmap.json']);
assert.equal(evidence.engineVersion, '0.14.0-m13'); if (args[0] === '--write') assert.equal(ENGINE_VERSION, evidence.engineVersion, 'Write only from final M13 implementation');
assert.equal(evidence.registryDefinitions, 334); assert.equal(evidence.addedDefinitions, 30); assert.equal(evidence.predecessorDefinitionsUnchanged, 304); assert.equal(evidence.fullSimulinkEquivalenceClaimed, false); assert.equal(evidence.parityTolerance, 3e-12);
const predecessor = JSON.parse(await readFile('docs/baselines/m12-registry.json', 'utf8')) as typeof blockRegistry;
assert.equal(predecessor.length, 304); for (const definition of predecessor) assert.deepEqual(getBlockDefinition(definition.id), definition, definition.id); assert(blockRegistry.length >= 334);
const stageDefinitions = [...predecessor, ...M13_BLOCK_IDS.map(id => getBlockDefinition(id)!)];
const stageCatalog = { kind: 'bus', fields: [
  { name: 'blockCount', value: 334 }, { name: 'engine', value: { kind: 'typed', dtype: 'string', shape: [], data: [evidence.engineVersion] } },
  ...(['static', 'discrete', 'continuous'] as const).map(mode => ({ name: `${mode}Supported`, value: stageDefinitions.filter(definition => definition.supportedModes.includes(mode)).length })) ] };
const rawFixtures = [...M13_INDEPENDENT_DEFINITION_FIXTURES, ...M13_INDEPENDENT_BOUNDARY_FIXTURES];
assert.equal(evidence.counts.rawFixtures, rawFixtures.length); assert.equal(evidence.counts.definitionFixtures, M13_INDEPENDENT_DEFINITION_FIXTURES.length); assert.equal(evidence.counts.modeExecutions, evidence.fixtures.length); assert.equal(evidence.counts.failures, evidence.failures.length); assert.equal(evidence.counts.actualTypeScript, evidence.fixtures.length + evidence.failures.filter(entry => entry.phase === 'runtime').length);
const proofKey = (proof: Proof) => `${proof.id}/${proof.mode}`;
assert.equal(new Set(evidence.fixtures.map(proofKey)).size, evidence.fixtures.length);
for (const proof of evidence.fixtures) {
  assert(proof.strictStandaloneTemplateModeVerified && proof.importFreeStandalone && proof.actualStandaloneTypeScript && proof.fullSamplesFinalStateMemoryParity && proof.exactManifest && proof.jsonRoundtrip && proof.insertionOrderIndependent && proof.pythonUnsupportedNodeDiagnostics, `${proofKey(proof)}: incomplete actual proof`);
  assert.equal(proof.targetVersion, 'typescript-m13-v1'); assert.equal(proof.parityTolerance, 3e-12); assert(Number.isFinite(proof.maximumScaledError) && proof.maximumScaledError >= 0 && proof.maximumScaledError <= proof.oracleTolerance);
  const raw = rawFixtures.find(entry => entry.name === proof.id); assert(raw, proof.id); assert.equal(proof.oracleTolerance, raw.oracleTolerance); assert.deepEqual(proof.sourceIds, raw.sourceIds);
  assert.equal(proof.metadataOracleFromDeclaredRegistry, raw.metadataOracleFromDeclaredRegistry === true); assert.equal(proof.independentLiteralOracle, !raw.metadataOracleFromDeclaredRegistry);
  const model = structuredClone(raw.model); model.execution.mode = proof.mode; if (proof.mode === 'static') model.execution.stopTime = model.execution.startTime;
  // Static source profiles must be legal as declared; never remove scheduled events or alter their values.
  const compiled = compileModel(model);
  assert.equal((proof as Proof & { modelHash: string }).modelHash, digest(compiled.semanticKey), `${proofKey(proof)}: model execution grid/parameters drift`);
  assert.deepEqual(proof.parameters, Object.fromEntries(compiled.nodes.filter(node => (M13_BLOCK_IDS as readonly string[]).includes(node.blockType)).map(node => [node.id, { blockType: node.blockType, parameters: node.blockType === 'model.support-catalog' ? { ...node.parameters, catalogValue: stageCatalog } : node.parameters, sampleTime: node.sampleTime }])), `${proofKey(proof)}: configured IR drift`);
  assert.equal(proof.samples, proof.mode === 'static' ? 1 : Object.values(raw.expected)[0]!.length);
}
for (const fixture of rawFixtures) for (const mode of fixture.declaredModes) assert(evidence.fixtures.some(entry => entry.id === fixture.name && entry.mode === mode), `${fixture.name}/${mode}: missing declared mode`);
for (const mode of ['static', 'discrete', 'continuous']) assert(evidence.fixtures.some(entry => entry.mode === mode && entry.strictProgramIndividuallyChecked), `${mode}: standalone strict template missing`);
for (const id of M13_BLOCK_IDS) for (const mode of getBlockDefinition(id)!.supportedModes) assert(evidence.fixtures.some(entry => entry.blockIds.includes(id) && entry.mode === mode), `${id}/${mode}: definition mode proof missing`);
assert.equal(evidence.failures.length, M13_INDEPENDENT_FAILURE_FIXTURES.length); for (const failure of evidence.failures) { const raw = M13_INDEPENDENT_FAILURE_FIXTURES.find(entry => entry.name === failure.name); assert(raw); assert.equal(failure.diagnosticCode, raw.code); assert.equal(failure.phase, raw.phase); if (failure.phase === 'runtime') assert(failure.actualTypeScriptExecuted && failure.fullPartialParity); }

const sourceLines = (await readFile(sourcePath, 'utf8')).split(/\r?\n/), baselineText = await readFile('docs/baselines/catalog-block-coverage.md', 'utf8');
const sourceRows = new Map(baselineText.split(/\r?\n/).flatMap(line => { const match = /^\| \[(\d{2}-\d{3})\]\([^)]*\) \(L(\d+)\) \|/.exec(line); return match ? [[match[1]!, { line: Number(match[2]), cells: line.slice(1, -1).split('|').map(cell => cell.trim()) }] as const] : []; }));
const roadmap = JSON.parse(await readFile('docs/simulink-coverage-roadmap.json', 'utf8')) as { rows: { id: string; firstWorkMilestone: string }[] };
assert.equal(sourceRows.size, 385); assert.equal(implementation.rows.length, 75); assert.equal(new Set(implementation.rows.map(row => row.id)).size, 75); assert.deepEqual(implementation.rows.map(row => row.id), roadmap.rows.filter(row => row.firstWorkMilestone === 'M13').map(row => row.id));
for (const row of implementation.rows) {
  const base = sourceRows.get(row.id); assert(base); assert.equal(base.line, row.sourceLine); assert.deepEqual(base.cells.slice(1, 4), [row.sourceName, row.sourceSubgroup, row.sourceCondition]); assert.equal(base.cells[4]!.replace(/^`|`$/g, ''), row.baselineCanonical); assert.equal(base.cells[8], row.baselineStatus); assert.equal(row.baselineExistingSubset, row.baselineStatus !== '미구현'); assert.deepEqual(row.baselineRoadmapRow, roadmap.rows.find(source => source.id === row.id));
  assert.equal(row.baselineRoadmapRowSha256, digest(JSON.stringify(canonical(row.baselineRoadmapRow)))); assert.equal(row.originalIdentitySha256, digest(JSON.stringify({ id: row.id, section: row.sourceSection, ordinal: row.sourceOrdinal, name: row.sourceName, subgroup: row.sourceSubgroup, condition: row.sourceCondition, line: row.sourceLine })));
  assert.equal(sourceLines[row.sourceLine - 1]!.trim(), `| ${row.sourceName} | ${row.sourceCondition} |`); assert.equal(row.sourceOptionCompletionStatus, 'open'); assert.equal(row.nativeFullEquivalent, false); assert.equal(row.executionEquivalenceClaimed, false);
}

const uiBytes = await readFile(uiPath), ui = JSON.parse(uiBytes.toString('utf8')) as { schemaVersion: number; milestone: string; status: string; unit: { passed: number; failed: number; log: string }; browser: { total: number; passed: number; failed: number; report: string; testFilter: string; tests: { name: string; status: string }[] }; dashboardProfiles: { total: number; renderChecks: UIProfile[]; nativeDashboardEquivalenceClaimed: boolean }; files: { checks: { id: string; passed: boolean; evidenceTest: string }[] } };
assert.equal(ui.schemaVersion, 1); assert.equal(ui.milestone, 'M13'); assert.equal(ui.status, 'passed'); assert(ui.unit.passed > 0 && ui.unit.failed === 0); assert(ui.browser.total > 0 && ui.browser.passed === ui.browser.total && ui.browser.failed === 0); assert(ui.browser.tests.length >= ui.browser.total && ui.browser.tests.every(test => test.status === 'passed'));
assert.equal(ui.unit.log, 'docs/evidence/m13-ui-unit-results.json'); assert.equal(ui.browser.report, 'docs/evidence/m13-browser-workflow-results.json'); assert.equal(ui.browser.testFilter, 'tests/e2e/m13-editor.spec.ts');
const unitBytes = await readFile(ui.unit.log), unitResults = JSON.parse(unitBytes.toString('utf8')) as { success: boolean; numPassedTests: number; numFailedTests: number; testResults: { assertionResults: { fullName: string; status: string }[] }[] };
assert(unitResults.success); assert.equal(unitResults.numPassedTests, ui.unit.passed); assert.equal(unitResults.numFailedTests, 0);
const unitAssertions = unitResults.testResults.flatMap(suite => suite.assertionResults);
interface BrowserSpec { title: string; file: string; tests: { status: string; results: { status: string }[] }[] }
interface BrowserSuite { file?: string; specs?: BrowserSpec[]; suites?: BrowserSuite[] }
const browserBytes = await readFile(ui.browser.report), browserResults = JSON.parse(browserBytes.toString('utf8')) as { suites: BrowserSuite[] };
const browserSpecs: BrowserSpec[] = []; const walkBrowser = (suite: BrowserSuite): void => { browserSpecs.push(...(suite.specs ?? [])); for (const child of suite.suites ?? []) walkBrowser(child); }; for (const suite of browserResults.suites) walkBrowser(suite);
const browserTests = browserSpecs.filter(spec => spec.file.replaceAll('\\', '/').endsWith('m13-editor.spec.ts')).flatMap(spec => spec.tests.map(test => ({ title: spec.title, ...test })));
assert.equal(browserTests.length, ui.browser.total); assert(browserTests.every(test => test.status === 'expected' && test.results.length > 0 && test.results.at(-1)!.status === 'passed'));
for (const test of ui.browser.tests) assert(browserTests.some(actual => actual.title === test.name), `${test.name}: actual browser test absent`);
assert.equal(ui.dashboardProfiles.total, 37); assert.equal(ui.dashboardProfiles.nativeDashboardEquivalenceClaimed, false); assert.equal(ui.dashboardProfiles.renderChecks.length, 37); assert.equal(new Set(ui.dashboardProfiles.renderChecks.map(profile => profile.sourceRowId)).size, 37);
for (const row of implementation.rows.filter(row => row.sourceSection === 3)) {
  const profile = ui.dashboardProfiles.renderChecks.find(item => item.sourceRowId === row.id); assert(profile, `${row.id}: actual UI style profile absent`); assert.equal(profile.blockType, row.selectedImplementation.canonical); assert(profile.widgetRendered && profile.controlOrObservationValidated && profile.evidenceTest.length > 0);
  assert(unitAssertions.some(test => test.status === 'passed' && test.fullName.includes(`source-specific dashboard profile ${row.id}`)), `${row.id}: actual SSR/execution unit assertion absent`);
  for (const key of ['kind', 'appearance', 'orientation', 'gaugeStyle']) if (Object.hasOwn(row.selectedImplementation.parameters, key)) assert.equal(profile.parameters[key], row.selectedImplementation.parameters[key], `${row.id}: UI ${key} mismatch`);
}
for (const id of ['xlsx-bounded-import', 'csv-json-import', 'data-editor-provenance', 'recording-json-export', 'recording-dataset-export', 'signal-editor-scenario']) assert(ui.files.checks.some(check => check.id === id && check.passed && check.evidenceTest.length > 0), `${id}: actual bounded data/UI workflow proof absent`);

const currentCoverage = await readFile(coveragePath, 'utf8'), currentLines = currentCoverage.split(/\r?\n/);
const preserved: { sourceId: string; rowSha256: string; reason: string }[] = [];
const approvals = implementation.rows.flatMap(row => {
  if (row.baselineExistingSubset) { const line = currentLines.find(value => value.startsWith(`| [${row.id}]`)); assert(line); preserved.push({ sourceId: row.id, rowSha256: digest(line), reason: 'Previous selected mapping/status retained; M13 source variants do not upgrade prior unverified native/full-option scope.' }); return []; }
  const route = row.selectedImplementation; assert((M13_BLOCK_IDS as readonly string[]).includes(route.canonical), row.id);
  const sourceFixtures = rawFixtures.filter(entry => entry.sourceIds.includes(row.id) && entry.model.nodes.some(node => node.blockType === route.canonical)); assert(sourceFixtures.length > 0, `${row.id}: genuine source-specific configured oracle absent`);
  const definition = getBlockDefinition(route.canonical)!;
  const selected = (parameters: Record<string, unknown>) => Object.fromEntries(Object.entries(definition.parameters).map(([key, param]) => [key, Object.hasOwn(parameters, key) ? structuredClone(parameters[key]) : structuredClone(param.default)]));
  const profiles = sourceFixtures.map(fixture => {
    if (row.sourceSection === 18) {
      const ascii = (value: unknown): boolean => typeof value === 'string' ? [...value].every(character => character.codePointAt(0)! <= 127) : Array.isArray(value) ? value.every(ascii) : value !== null && typeof value === 'object' ? Object.values(value).every(ascii) : true;
      for (const source of fixture.model.nodes.filter(node => ['source.string-constant', 'source.signal', 'source.typed'].includes(node.blockType))) assert(ascii(source.parameters.value), `${row.id}/${fixture.name}: Unicode extension must remain separate from approved ASCII source profile`);
    }
    const node = fixture.model.nodes.find(item => item.blockType === route.canonical)!;
    const selectedParameters = selected(node.parameters), matched = evidence.fixtures.filter(proof => proof.id === fixture.name && proof.sourceIds.includes(row.id) && proof.blockIds.includes(route.canonical));
    for (const mode of fixture.declaredModes) assert(matched.some(proof => proof.mode === mode), `${row.id}/${fixture.name}/${mode}: configured source proof absent`);
    assert(matched.every(proof => proof.independentLiteralOracle || route.canonical === 'model.support-catalog' && proof.metadataOracleFromDeclaredRegistry));
    const compiled = compileModel(fixture.model), compiledNode = compiled.nodes.find(item => item.id === node.id)!; const bindings = Object.keys(compiledNode.inputs);
    for (const port of route.requiredBindings) assert(bindings.includes(port), `${row.id}: actual ${port} binding absent`);
    return { rawFixtureId: fixture.name, configuredNodeId: node.id, selectedParameters, declaredModes: fixture.declaredModes, requiredBindingsActuallyConnected: bindings, evidenceFixtureIds: matched.map(proofKey), metadataOracleFromDeclaredRegistry: fixture.metadataOracleFromDeclaredRegistry === true };
  });
  // String examples may exercise nondefault values; dashboard appearance/type identities must match this row.
  if (row.sourceSection === 3) assert(profiles.some(profile => ['kind', 'appearance', 'orientation', 'gaugeStyle'].every(key => !Object.hasOwn(route.parameters, key) || profile.selectedParameters[key] === route.parameters[key])), `${row.id}: exact dashboard configured profile absent`);
  if (row.id === '18-012' || row.id === '18-014') assert(profiles.some(profile => profile.selectedParameters.dtype === route.parameters.dtype), `${row.id}: exact float dtype profile absent`);
  const independentAlternative = route.classification.startsWith('independent-');
  const selectionKind = independentAlternative ? 'verified-independent-alternative' : 'verified-native-scope', status = independentAlternative ? 'M13 독립 대체 subset' : 'M13 승인 subset';
  const evidenceFixtureIds = profiles.flatMap(profile => profile.evidenceFixtureIds);
  const boundary = `${route.boundary} · 실제 선택 구성 ${JSON.stringify(profiles.map(profile => ({ parameters: profile.selectedParameters, modes: profile.declaredModes })))}; 독립 literal 또는 공개 catalog 선언 metadata oracle·실제 TS/JSON·삽입 역순·화면/로컬 파일 작업만 확인. 원본 전체 옵션·MathWorks 실행 parity는 미승인(open).`;
  assert(!boundary.includes('|'));
  return [{ sourceId: row.id, sourceName: row.sourceName, sourceLine: row.sourceLine, canonical: route.canonical, selectedParameters: profiles[0]!.selectedParameters, configuredProfiles: profiles, evidenceFixtureIds, selectionKind, status, boundary, newlyApproved: true, nativeFullEquivalent: false, sourceOptionCompletionStatus: 'open', uiWorkflowEvidencePath: uiPath, uiProfileSourceId: row.sourceSection === 3 ? row.id : null }];
});
assert.equal(approvals.length, 59); assert.equal(preserved.length, 16); assert.equal(previous.currentSourceSubset, 305);
const approvedById = new Map(approvals.map(entry => [entry.sourceId, entry]));
const newLines = currentLines.map(line => { const match = /^\| \[(\d{2}-\d{3})\]\([^)]*\) \(L(\d+)\) \|/.exec(line), approved = match && approvedById.get(match[1]!); if (!approved) return line; const cells = line.slice(1, -1).split('|').map(cell => cell.trim()); assert.equal(cells.length, 9); assert(cells[8] === '미구현' || cells[8] === approved.status); cells[4] = `\`${approved.canonical}\``; cells[7] = approved.boundary; cells[8] = approved.status; return `| ${cells.join(' | ')} |`; });
const summary = '- 현재 M13 승인 범위: 원본385행 중 선택 subset364행·미구현21행. 최초 배정75행의 신규59행을 승인하고 기존16행은 이전 mapping/status를 유지한다. registry334 정의와 source행은 별도 집계다. [M13 계약](m13-contract.md)·[실제 TS 증거](evidence/m13-verification.json)·[화면/데이터 작업](evidence/m13-ui-workflow-verification.json)·[source 승인](evidence/m13-source-approvals.json)를 따른다. 전체옵션75행 모두open·원본실행동등성 미승인이다.';
const summaryIndex = newLines.findIndex(line => line.startsWith('- 현재 M13 승인 범위:')); if (summaryIndex >= 0) newLines[summaryIndex] = summary; else newLines.splice(4, 0, summary);
for (const row of preserved) assert.equal(digest(newLines.find(line => line.startsWith(`| [${row.sourceId}]`))!), row.rowSha256);
const record = { generatedAt: new Date().toISOString(), stage: 'M13', engineVersion: evidence.engineVersion, datasetSha256: protectedArtifacts[sourcePath], sourceRows: 385, uniqueSourceNameStrings: 339, firstWorkSourceRows: 75, registryDefinitions: 334, approvedAdditionalSourceRows: 59, existingMappingExtensions: 0, approvedSourceRows: 59, currentSourceSubset: 364, missingSourceRows: 21, fullSourceOptionsClosed: 0, evidencePath, evidenceSha256: digest(evidenceBytes), fixturePath, fixtureSha256: digest(await readFile(fixturePath)), uiWorkflowEvidencePath: uiPath, uiWorkflowEvidenceSha256: digest(uiBytes), uiBackingReports: { [ui.unit.log]: digest(unitBytes), [ui.browser.report]: digest(browserBytes) }, protectedArtifacts, preservedSourceRows: preserved, approvals, primarySourceRuntimeExecuted: false, fullSimulinkEquivalenceClaimed: false };
const updatedMap = structuredClone(implementation);
Object.assign(updatedMap.counts, { sourceApprovals: 59, approvedAdditionalSourceRows: 59, existingMappingExtensions: 0, preservedPredecessorSourceRows: 16, pendingSourceWorkflowRows: 0, fullSourceOptionsClosed: 0 });
if (updatedMap.implementationStatus === 'in-progress') updatedMap.implementationStatus = 'verified-selected-scope';
if (updatedMap.deliveryGate.status === 'pending-engineering-validation') updatedMap.deliveryGate.status = 'passed-engineering-selected-scope';
Object.assign(updatedMap.deliveryGate, { actualStandaloneStatus: 'passed', browserStatus: 'passed-ui-workflows', sourceApprovalStatus: '59-selected-source-rows' });
updatedMap.claimScope = 'Real configured source-specific standalone/JSON/insertion-order and UI/local-data workflows verify59 new selected source subsets. Previous304 definitions and16 source mappings/statuses are preserved. All75 full source option sets and MathWorks runtime parity remain open; source count is separate from334 registry definitions.';
for (const definition of updatedMap.selectedDefinitions) definition.approvalStatus = 'verified-selected-scope';
for (const row of updatedMap.rows) { const approved = approvedById.get(row.id); row.approvalStatus = approved ? approved.selectionKind : 'preserved-predecessor-subset'; row.approval = approved ? { stageStatus: approved.selectionKind, configuredProfiles: approved.configuredProfiles, evidenceFixtureIds: approved.evidenceFixtureIds, sourceApprovalPath: approvalPath, uiWorkflowEvidencePath: uiPath, nativeFullEquivalent: false } : { stageStatus: 'preserved-predecessor-subset', reason: preserved.find(item => item.sourceId === row.id)!.reason, sourceApprovalPath: approvalPath, nativeFullEquivalent: false }; }
if (args[0] === '--write') { await writeFile(coveragePath, newLines.join('\n')); await writeFile(approvalPath, JSON.stringify(record, null, 2) + '\n'); await writeFile(mapPath, JSON.stringify(updatedMap, null, 2) + '\n'); }
if (args[0] === '--verify') { assert.equal(currentCoverage, newLines.join('\n')); const stored = JSON.parse(await readFile(approvalPath, 'utf8')) as typeof record; const { generatedAt: _old, ...before } = stored, { generatedAt: _new, ...after } = record; assert.deepEqual(before, after); assert.deepEqual(implementation, updatedMap); }
await verifyProtected();
console.log(JSON.stringify({ sourceRows: 385, registryDefinitions: 334, firstWorkSourceRows: 75, additionalSourceApprovals: 59, preservedPredecessorRows: 16, currentSourceSubset: 364, missingSourceRows: 21, fullSourceOptionsClosed: 0, mutated: args[0] === '--write' }));
