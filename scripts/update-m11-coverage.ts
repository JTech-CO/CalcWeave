import assert from 'node:assert/strict';
import { registryWithoutApprovedObserverInputs } from './m16-support-source';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { blockRegistry, getBlockDefinition } from '../packages/block-library/src';
import { M11_BLOCK_IDS } from '../packages/block-library/src/m11';
import { compileModel } from '../packages/compiler/src';
import { ENGINE_VERSION, type CalcModel, type ExecutionMode, type SignalValue } from '../packages/model/src';
import { M11_INDEPENDENT_BOUNDARY_FIXTURES, M11_INDEPENDENT_DEFINITION_FIXTURES, M11_INDEPENDENT_FAILURE_FIXTURES, type M11IndependentFixture } from '../tests/m11-independent-fixtures';

const args = process.argv.slice(2);
assert(args.length === 1 && ['--check', '--write', '--verify'].includes(args[0]!), 'Use --check, --write or --verify');
const digest = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])])) : value;
const sourcePath = 'dataset/Simulink_Basic_Blocks_R2024b.md', coveragePath = 'docs/block-coverage.md', mapPath = 'docs/m11-implementation-map.json';
const evidencePath = 'docs/evidence/m11-verification.json', approvalPath = 'docs/evidence/m11-source-approvals.json';
const fixturePath = 'tests/m11-independent-fixtures.ts', datasetSha256 = 'cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7';
const protectedArtifacts: Record<string, string> = {
  [sourcePath]: datasetSha256,
  'docs/baselines/catalog-block-coverage.md': 'bfad433de22c3302b53369be3465ec1d4bb3e072dd8f3ce310bc4af1ea967774',
  'docs/simulink-coverage-roadmap.json': '86ec3c3f75939dc72a00b39d6760d86d9ef21f2a63922daf110c5db2fe7932cd',
  'docs/baselines/m10-registry.json': 'd23bc34bdbd450b1ea2be671b419f8ccfb74fa97238d541c3f9ffd97230cf8dc',
  'docs/evidence/m10-source-approvals.json': 'd8c938fb999555aaf61f24b68b7b631e158611dc2760542bd08d0f94d3221f4b',
  'docs/evidence/m10-verification.json': '659a11814e1420f217068f4cab4c6726cd3070154f69fd1064afd3a4aee52e6d',
  'docs/evidence/m10-reference-review.json': 'fb9572178cc5c5caf19658e9010709a67d0d6611f83b9f3ce8993dffee493325',
  'docs/evidence/m8-source-approvals.json': '4f558f5040f9dda1a9c2b5bbd2b848b825b4961489a03228dd3c12370b2c4d60',
  'docs/evidence/m9-source-approvals.json': '7d49f1b15a6b325050a55295bca4d29411fe123dd0752e2ac98766641ccc18ca',
  'docs/evidence/m8-verification.json': '351b5ba6031dff1a2f4dfb8b51e4e63e2747998277ee93e56decc4b908ff75d6',
  'docs/evidence/m8-presets-verification.json': '55cef48ebe57a97ca02922225330f36b1f1d0866d2ad92d69f74fcceb7771f01',
  'docs/evidence/m9-verification.json': '1d3fee9b56017db6c12b8f7f778d4c064efd4fa7f7d0014a2a38b6ffdd13a23f',
};
async function verifyProtected(): Promise<void> { for (const [path, hash] of Object.entries(protectedArtifacts)) assert.equal(digest(await readFile(path)), hash, `${path}: historical source/evidence changed`); }
await verifyProtected();

interface Route { status: string; canonical: string | null; parameters: Record<string, unknown>; requiredBindings: string[]; independentAlternative: boolean; controlPortAdapter: boolean; boundary: string; sourceFullEquivalent: false; evidenceFixtureIds: string[]; runtimeLiteralFixtureIds: string[] }
interface SourceRow { sourceId: string; sourceName: string; sourceLine: number; sourceSubgroup: string; sourceCondition: string; baselineCanonical: string; baselineStatus: string; baselineExistingSubset: boolean; baselineRoadmapRow: unknown; baselineRoadmapRowSha256: string; planningDeliveryKind: string; sourceOptionCompletionStatus: string; delivery: Route; approval: Record<string, unknown> }
interface Proof { id: string; mode: ExecutionMode; blockIds: string[]; parameters: Record<string, { blockType: string; parameters: Record<string, unknown>; sampleTime: unknown }>; samples: number; maximumAbsoluteError: number; maximumScaledError: number; float64Tolerance: number; independentLiteralOracle: boolean; independentFullFinalStateOracle: boolean; independentFullStateMemoryOracle: boolean; strictStandaloneTemplateModeVerified: boolean; strictProgramIndividuallyChecked: boolean; importFreeStandalone: boolean; actualStandaloneTypeScript: boolean; fullSamplesFinalStateMemoryParity: boolean; exactManifest: boolean; jsonRoundtrip: boolean; insertionOrderIndependent: boolean; pythonUnsupportedNodeDiagnostics: boolean; targetVersion: string }
interface FailureProof { name: string; phase: string; diagnosticCode: string; actualTypeScriptExecuted: boolean; fullPartialParity?: boolean }
const implementation = JSON.parse(await readFile(mapPath, 'utf8')) as { baseline: { sourceRows: number; uniqueSourceNameStrings: number; datasetSha256: string; coverageSha256: string }; counts: Record<string, number | string>; rows: SourceRow[] };
const evidenceBytes = await readFile(evidencePath), evidence = JSON.parse(evidenceBytes.toString('utf8')) as { engineVersion: string; registryDefinitions: number; addedDefinitions: number; predecessorDefinitionsUnchanged: number; fullSimulinkEquivalenceClaimed: boolean; counts: Record<string, number>; tolerance: number; fixtures: Proof[]; failures: FailureProof[] };
assert.equal(implementation.baseline.sourceRows, 385); assert.equal(implementation.baseline.uniqueSourceNameStrings, 339); assert.equal(implementation.baseline.datasetSha256, datasetSha256);
assert.equal(evidence.engineVersion, '0.12.0-m11'); if (args[0] === '--write') assert.equal(ENGINE_VERSION, evidence.engineVersion, 'Write only from the final M11 implementation');
assert.equal(evidence.registryDefinitions, 293); assert.equal(evidence.addedDefinitions, 48); assert.equal(evidence.predecessorDefinitionsUnchanged, 245); assert.equal(evidence.fullSimulinkEquivalenceClaimed, false);
assert.equal(evidence.tolerance, 3e-12); assert(evidence.counts.strictTypeScriptPrograms! >= 3);
assert.equal(evidence.counts.modeExecutions, evidence.fixtures.length); assert.equal(evidence.counts.failures, evidence.failures.length);
assert.equal(evidence.counts.actualTypeScript, evidence.fixtures.length + evidence.failures.filter(entry => entry.phase === 'runtime').length);
const predecessor = JSON.parse(await readFile('docs/baselines/m10-registry.json', 'utf8')) as typeof blockRegistry;
const historicalRegistry = registryWithoutApprovedObserverInputs(blockRegistry);
assert.equal(predecessor.length, 245); for (const definition of predecessor) assert.deepEqual(historicalRegistry.find(block => block.id === definition.id), definition, `${definition.id}: historical predecessor changed beyond two approved observer inputCount declarations`);
assert(blockRegistry.length >= evidence.registryDefinitions);
const rawFixtures = [...M11_INDEPENDENT_DEFINITION_FIXTURES, ...M11_INDEPENDENT_BOUNDARY_FIXTURES];
assert.equal(evidence.counts.rawFixtures, rawFixtures.length); assert.equal(evidence.counts.definitionFixtures, 48); assert.equal(evidence.counts.boundaryFixtures, M11_INDEPENDENT_BOUNDARY_FIXTURES.length);
function configuredModel(fixture: M11IndependentFixture, mode: ExecutionMode): CalcModel { const model = structuredClone(fixture.model); model.execution.mode = mode; if (mode === 'static') model.execution.stopTime = model.execution.startTime; if (mode === 'continuous') model.execution.solver = { method: 'rk4', discreteStep: model.execution.step, initialStep: model.execution.step, maxStep: model.execution.step }; return model; }
const proofKey = (proof: Proof): string => `${proof.id}/${proof.mode}`;
assert.equal(new Set(evidence.fixtures.map(proofKey)).size, evidence.fixtures.length);
for (const proof of evidence.fixtures) {
  assert(proof.independentLiteralOracle && proof.strictStandaloneTemplateModeVerified && proof.importFreeStandalone && proof.actualStandaloneTypeScript && proof.fullSamplesFinalStateMemoryParity && proof.exactManifest && proof.jsonRoundtrip && proof.insertionOrderIndependent && proof.pythonUnsupportedNodeDiagnostics, `${proofKey(proof)}: required execution gate missing`);
  assert.equal(proof.targetVersion, 'typescript-m11-v1'); assert.equal(proof.float64Tolerance, 3e-12);
  assert(Number.isFinite(proof.maximumAbsoluteError) && proof.maximumAbsoluteError >= 0 && Number.isFinite(proof.maximumScaledError) && proof.maximumScaledError >= 0 && proof.maximumScaledError <= proof.float64Tolerance);
  const raw = rawFixtures.find(entry => entry.name === proof.id) ?? rawFixtures.find(entry => `${entry.name}-static` === proof.id && proof.mode === 'static'); assert(raw, `${proofKey(proof)}: source fixture absent`);
  const compiled = compileModel(configuredModel(raw, proof.mode));
  assert.deepEqual(proof.parameters, Object.fromEntries(compiled.nodes.filter(node => (M11_BLOCK_IDS as readonly string[]).includes(node.blockType)).map(node => [node.id, { blockType: node.blockType, parameters: node.parameters, sampleTime: node.sampleTime }])), `${proofKey(proof)}: actual configured IR drifted`);
  assert.equal(proof.samples, proof.mode === 'static' ? 1 : Object.values(raw.expected)[0]!.length);
  if (raw.expectedStateMemory && proof.mode !== 'static') assert(proof.independentFullStateMemoryOracle, `${proofKey(proof)}: literal state memory gate missing`);
}
for (const fixture of rawFixtures) for (const mode of fixture.declaredModes) assert(evidence.fixtures.some(entry => entry.id === fixture.name && entry.mode === mode), `${fixture.name}/${mode}: final proof absent`);
for (const mode of ['static', 'discrete', 'continuous']) assert(evidence.fixtures.some(entry => entry.mode === mode && entry.strictProgramIndividuallyChecked), `${mode}: actual strict template absent`);
for (const id of M11_BLOCK_IDS) for (const mode of getBlockDefinition(id)!.supportedModes) assert(evidence.fixtures.some(entry => entry.blockIds.includes(id) && entry.mode === mode), `${id}/${mode}: declared mode proof absent`);
assert.equal(evidence.failures.length, M11_INDEPENDENT_FAILURE_FIXTURES.length);
for (const failure of evidence.failures) { const fixture = M11_INDEPENDENT_FAILURE_FIXTURES.find(entry => entry.name === failure.name); assert(fixture); assert.equal(failure.diagnosticCode, fixture.code); assert.equal(failure.phase, fixture.phase); if (failure.phase === 'runtime') assert(failure.actualTypeScriptExecuted && failure.fullPartialParity); }

const sourceLines = (await readFile(sourcePath, 'utf8')).split(/\r?\n/), baselineText = await readFile('docs/baselines/catalog-block-coverage.md', 'utf8');
const sourceRows = new Map(baselineText.split(/\r?\n/).flatMap(line => { const match = /^\| \[(\d{2}-\d{3})\]\([^)]*\) \(L(\d+)\) \|/.exec(line); return match ? [[match[1]!, { line: Number(match[2]), cells: line.slice(1, -1).split('|').map(cell => cell.trim()) }] as const] : []; }));
const roadmap = JSON.parse(await readFile('docs/simulink-coverage-roadmap.json', 'utf8')) as { rows: { id: string; firstWorkMilestone: string }[] };
assert.equal(sourceRows.size, 385); assert.equal(new Set([...sourceRows.values()].map(row => row.cells[1])).size, 339);
assert.equal(implementation.rows.length, 73); assert.equal(new Set(implementation.rows.map(row => row.sourceId)).size, 73);
assert.deepEqual(implementation.rows.map(row => row.sourceId), roadmap.rows.filter(row => row.firstWorkMilestone === 'M11').map(row => row.id));
for (const row of implementation.rows) { const base = sourceRows.get(row.sourceId); assert(base); assert.equal(base.line, row.sourceLine); assert.deepEqual(base.cells.slice(1, 4), [row.sourceName, row.sourceSubgroup, row.sourceCondition]); assert.equal(base.cells[4]!.replace(/^`|`$/g, ''), row.baselineCanonical); assert.equal(base.cells[8], row.baselineStatus); assert.equal(row.baselineExistingSubset, row.baselineStatus !== '미구현'); assert.deepEqual(row.baselineRoadmapRow, roadmap.rows.find(source => source.id === row.sourceId), `${row.sourceId}: frozen original roadmap row differs`); assert.equal(row.baselineRoadmapRowSha256, digest(JSON.stringify(canonical(row.baselineRoadmapRow)))); assert.equal(sourceLines[row.sourceLine - 1]!.trim(), `| ${row.sourceName} | ${row.sourceCondition} |`); assert.equal(row.sourceOptionCompletionStatus, 'open'); assert.equal(row.delivery.sourceFullEquivalent, false); }
assert.equal(implementation.rows.filter(row => row.delivery.status === 'explicitly-unsupported').length, 13);

const pending: { sourceId: string; reason: string }[] = [], preserved: { sourceId: string; reason: string; rowSha256: string }[] = [], unsupported: { sourceId: string; reason: string }[] = [];
const currentCoverage = await readFile(coveragePath, 'utf8'), currentLines = currentCoverage.split(/\r?\n/);
const entryForCanonical = (canonical: string): M11IndependentFixture | undefined => M11_INDEPENDENT_DEFINITION_FIXTURES.find(entry => entry.name === `m11-independent-${canonical.replaceAll('.', '-')}`);
const approvals = implementation.rows.flatMap(row => {
  const route = row.delivery;
  if (route.status === 'explicitly-unsupported') { unsupported.push({ sourceId: row.sourceId, reason: route.boundary }); return []; }
  if (route.canonical === 'hierarchy.subsystem') { const line = currentLines.find(value => value.startsWith(`| [${row.sourceId}]`)); assert(line); preserved.push({ sourceId: row.sourceId, reason: 'Frozen M4 transparent definition expansion retained; no new M11 source approval inferred from controlled wrappers.', rowSha256: digest(line) }); return []; }
  assert(route.canonical && (M11_BLOCK_IDS as readonly string[]).includes(route.canonical), row.sourceId);
  const definition = getBlockDefinition(route.canonical)!;
  const raw = entryForCanonical(route.canonical); assert(raw, `${row.sourceId}: genuine canonical fixture absent`);
  const configured = raw.model.nodes.find(node => node.blockType === route.canonical); assert(configured, row.sourceId);
  if (route.canonical === 'functions.element') { const caller = raw.model.nodes.find(node => node.blockType === 'functions.call' && node.parameters.definitionId === configured.parameters.definitionId && (node.parameters.version ?? 1) === (configured.parameters.version ?? 1)); assert(caller, 'Function Element approval requires a real same-definition versioned caller, not declaration presence'); assert(raw.expected.Result!.every((value, index) => value === index + 1), 'Callable component state must actually advance in the independent literal workflow'); }
  const selectedParameters = Object.fromEntries(Object.entries(definition.parameters).map(([key, parameter]) => [key, Object.hasOwn(configured.parameters, key) ? structuredClone(configured.parameters[key]) : structuredClone(parameter.default)]));
  const matched = evidence.fixtures.filter(proof => proof.id === raw.name && Object.values(proof.parameters).some(node => node.blockType === route.canonical));
  const selectedModes = route.canonical === 'functions.element' ? raw.declaredModes : definition.supportedModes;
  assert(selectedModes.every(mode => matched.some(proof => proof.mode === mode)), `${row.sourceId}: actual configured selected modes absent`);
  const bindings = Object.keys(compileModel(raw.model).nodes.find(node => node.id === configured.id)!.inputs);
  for (const port of route.requiredBindings) if (!port.includes(' ')) assert(bindings.includes(port), `${row.sourceId}: real binding ${port} absent`);
  const kind = route.controlPortAdapter ? 'verified-conditional-adapter' : route.independentAlternative || row.planningDeliveryKind === 'independent-workflow' ? 'verified-independent-alternative' : row.planningDeliveryKind === 'shared-configuration' ? 'verified-shared-configuration' : 'verified-native-scope';
  const status = kind === 'verified-independent-alternative' ? 'M11 독립 대체 subset' : route.controlPortAdapter ? 'M11 제어 포트 subset' : 'M11 승인 subset';
  const boundary = `${route.boundary} · 실제 선택 구성 ${JSON.stringify(selectedParameters)}; 같은 fixture의 입출력·상태·실패·TS/JSON 원자 경계만 승인. 지역 lexical graph·4096 호출/outer due·bounded형상/메모리; wrapper 부모 닫힌 feedback·외부언어/호스트hook·원본 전체옵션/실행 parity는 미승인(open).`;
  assert(!boundary.includes('|'));
  return [{ sourceId: row.sourceId, sourceName: row.sourceName, sourceLine: row.sourceLine, sourceSubgroup: row.sourceSubgroup, sourceCondition: row.sourceCondition, canonical: route.canonical, candidateParameters: route.parameters, selectedParameters, configuredNodeId: configured.id, rawFixtureId: raw.name, selectionKind: kind, status, boundary, evidenceFixtureIds: matched.map(proofKey), declaredModes: [...selectedModes], requiredBindingsActuallyConnected: bindings, newlyApproved: !row.baselineExistingSubset, priorStatus: row.baselineStatus, nativeFullEquivalent: false, sourceOptionCompletionStatus: 'open' }];
});
const additional = approvals.filter(entry => entry.newlyApproved).length, extensions = approvals.length - additional;
const approvedById = new Map(approvals.map(entry => [entry.sourceId, entry])), newLines = currentLines.map(line => { const match = /^\| \[(\d{2}-\d{3})\]\([^)]*\) \(L(\d+)\) \|/.exec(line); const approved = match && approvedById.get(match[1]!); if (!approved) return line; const cells = line.slice(1, -1).split('|').map(cell => cell.trim()); assert.equal(cells.length, 9); assert.equal(cells[1], approved.sourceName); assert.equal(Number(match![2]), approved.sourceLine); assert(cells[8] === approved.priorStatus || cells[8] === approved.status, `${approved.sourceId}: prior source status changed`); cells[4] = `\`${approved.canonical}\``; cells[7] = approved.boundary; cells[8] = approved.status; return `| ${cells.join(' | ')} |`; });
const summary = `- 현재 M11 승인 범위: 원본385행 중 선택 subset${245 + additional}행·미구현${140 - additional}행. 최초 배정73행의 신규${additional}행·기존mapping확장${extensions}행을 승인하며 기존Subsystem2행·선언workflow대기${pending.length}행·명시미지원13행을 구분한다. registry293 정의와 source행·adapter·목적대체는 별도 집계다. [M11 계약](01-technical-whitepaper.md)·[실제 TS 증거](evidence/m11-verification.json)·[source 승인](evidence/m11-source-approvals.json)를 따른다. 전체옵션73행 모두open·원본실행동등성 미승인이다.`;
// Keep the consolidated current header; historical approvals remain in frozen JSON.
const consolidatedHeader = currentCoverage.includes('[기계 판독 지원표](support-matrix.json)');
if (!consolidatedHeader) { const summaryIndex = newLines.findIndex(line => line.startsWith('- 현재 M11 승인 범위:')); if (summaryIndex >= 0) newLines[summaryIndex] = summary; else newLines.splice(4, 0, summary); }
for (const item of preserved) assert.equal(digest(newLines.find(line => line.startsWith(`| [${item.sourceId}]`))!), item.rowSha256);
const selectionCounts = Object.fromEntries(['verified-native-scope', 'verified-shared-configuration', 'verified-independent-alternative', 'verified-conditional-adapter'].map(kind => [kind, approvals.filter(entry => entry.selectionKind === kind).length]));
const record = { generatedAt: new Date().toISOString(), stage: 'M11', engineVersion: evidence.engineVersion, datasetSha256, sourceRows: 385, uniqueSourceNameStrings: 339, firstWorkSourceRows: 73, registryDefinitions: 293, approvedAdditionalSourceRows: additional, existingMappingExtensions: extensions, approvedSourceRows: approvals.length, selectionCounts, evidencePath, evidenceSha256: digest(evidenceBytes), fixturePath, fixtureSha256: digest(await readFile(fixturePath)), protectedArtifacts, sourceAudit: 'Every approval names one executed configured raw model and the matching original row identity. Pure declarations, aliases, inactive code, examples and untested default selectors do not independently approve a source. Actual tested parameter values may differ from candidate defaults and are retained separately.', primarySourceRuntimeExecuted: false, fullSimulinkEquivalenceClaimed: false, fullSourceOptionsClosed: 0, pending, preservedSourceRows: preserved, explicitlyUnsupported: unsupported, approvals };
const updatedMap = structuredClone(implementation);
updatedMap.counts.approvedSourceRows = approvals.length; updatedMap.counts.approvedAdditionalSourceRows = additional; updatedMap.counts.existingMappingExtensions = extensions; updatedMap.counts.pendingSourceWorkflowRows = pending.length; updatedMap.counts.preservedPredecessorSourceRows = preserved.length; updatedMap.counts.fullSourceOptionsClosed = 0;
for (const row of updatedMap.rows) { const approved = approvedById.get(row.sourceId); row.approval = approved ? { stageStatus: approved.selectionKind, selectedParameters: approved.selectedParameters, rawFixtureId: approved.rawFixtureId, evidenceFixtureIds: approved.evidenceFixtureIds, sourceApprovalPath: approvalPath, nativeFullEquivalent: false } : { stageStatus: unsupported.some(item => item.sourceId === row.sourceId) ? 'documented-unsupported' : preserved.some(item => item.sourceId === row.sourceId) ? 'preserved-predecessor-subset' : 'pending-source-workflow', reason: [...pending, ...unsupported, ...preserved].find(item => item.sourceId === row.sourceId)?.reason, evidenceFixtureIds: [], sourceApprovalPath: approvalPath, nativeFullEquivalent: false }; if (approved) { row.delivery.evidenceFixtureIds = approved.evidenceFixtureIds; row.delivery.runtimeLiteralFixtureIds = [approved.rawFixtureId]; } }
if (args[0] === '--write') { await writeFile(coveragePath, newLines.join('\n')); await writeFile(approvalPath, JSON.stringify(record, null, 2) + '\n'); await writeFile(mapPath, JSON.stringify(updatedMap, null, 2) + '\n'); }
if (args[0] === '--verify') { assert.equal(currentCoverage, newLines.join('\n'), 'Current coverage differs from approved selected evidence'); const stored = JSON.parse(await readFile(approvalPath, 'utf8')) as typeof record; const { generatedAt: _stored, ...previous } = stored, { generatedAt: _new, ...current } = record; assert.deepEqual(previous, current, 'Source approvals differ from final configured proof'); assert.deepEqual(implementation, updatedMap, 'Implementation approval links differ'); }
await verifyProtected();
process.stdout.write(JSON.stringify({ sourceRows: 385, uniqueSourceNameStrings: 339, firstWorkSourceRows: 73, approvedSourceRows: approvals.length, additionalSourceApprovals: additional, existingMappingExtensions: extensions, preservedPredecessorRows: preserved.length, pendingSourceWorkflowRows: pending.length, explicitlyUnsupportedRows: unsupported.length, selectionCounts, fullSourceOptionsClosed: 0, mutated: args[0] === '--write' }) + '\n');
