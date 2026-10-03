import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { blockRegistry, getBlockDefinition } from '../packages/block-library/src';
import { M10_BLOCK_IDS, M10_BLOCK_PRESETS } from '../packages/block-library/src/m10';
import { compileModel } from '../packages/compiler/src';
import { ENGINE_VERSION, type ExecutionMode } from '../packages/model/src';
import { M10_INDEPENDENT_DEFINITION_FIXTURES, M10_INDEPENDENT_FIXTURES, M10_INDEPENDENT_FAILURE_FIXTURES, M10_INDEPENDENT_PRESET_FIXTURES, m10IndependentMode } from '../tests/m10-independent-fixtures';

const args = process.argv.slice(2);
assert(args.length === 1 && ['--check', '--write', '--verify'].includes(args[0]!), 'Use --check, --write or --verify');
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const sourcePath = 'dataset/Simulink_Basic_Blocks_R2024b.md', coveragePath = 'docs/block-coverage.md', mapPath = 'docs/m10-implementation-map.json';
const evidencePath = 'docs/evidence/m10-verification.json', approvalPath = 'docs/evidence/m10-source-approvals.json';
const datasetSha256 = 'cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7';
const protectedArtifacts = {
  [sourcePath]: datasetSha256,
  'docs/baselines/catalog-block-coverage.md': 'bfad433de22c3302b53369be3465ec1d4bb3e072dd8f3ce310bc4af1ea967774',
  'docs/baselines/m9-registry.json': 'a16262a3f9ebb74156f2896d3b11019ec5dafbbd65b0ea0deab9470f6eeda6b4',
  'docs/evidence/m8-source-approvals.json': '4f558f5040f9dda1a9c2b5bbd2b848b825b4961489a03228dd3c12370b2c4d60',
  'docs/evidence/m9-source-approvals.json': '7d49f1b15a6b325050a55295bca4d29411fe123dd0752e2ac98766641ccc18ca',
  'docs/evidence/m8-verification.json': '351b5ba6031dff1a2f4dfb8b51e4e63e2747998277ee93e56decc4b908ff75d6',
  'docs/evidence/m8-presets-verification.json': '55cef48ebe57a97ca02922225330f36b1f1d0866d2ad92d69f74fcceb7771f01',
  'docs/evidence/m9-verification.json': '1d3fee9b56017db6c12b8f7f778d4c064efd4fa7f7d0014a2a38b6ffdd13a23f',
};
async function verifyProtected(): Promise<void> { for (const [path, digest] of Object.entries(protectedArtifacts)) assert.equal(hash(await readFile(path)), digest, `${path}: immutable predecessor/source digest changed`); }
await verifyProtected();

type Route = { canonical: string; parameters: Record<string, unknown>; presetId: string | null; independentAlternative: boolean; evidenceFixtureIds: string[]; candidateStrictEvidenceFixtureIds?: string[]; sourceFullEquivalent: false };
type Row = { sourceId: string; sourceName: string; sourceLine: number; sourceSubgroup: string; sourceCondition: string; baselineCanonical: string; baselineStatus: string; baselineExistingSubset: boolean; sourceOptionCompletionStatus: string; delivery: Route };
type Evidence = { id: string; mode: ExecutionMode; blockIds: string[]; parameters: Record<string, { blockType: string; parameters: Record<string, unknown>; sampleTime: unknown }>; presetId?: string; samples: number; maximumAbsoluteError: number; maximumScaledError: number; float64Tolerance: number; typedMetadataTagsAndStringsExact: boolean; float32BitTrueExact: boolean; exactZerosAndSubnormals: boolean; independentLiteralOracle: boolean; independentFullFinalStateOracle: boolean; independentFullStateMemoryOracle: boolean; targetVersion: string; strictStandaloneTemplateModeVerified: boolean; strictProgramIndividuallyChecked: boolean; importFreeStandalone: boolean; actualStandaloneTypeScript: boolean; fullSamplesFinalStateMemoryParity: boolean; exactManifest: boolean; jsonRoundtrip: boolean; insertionOrderIndependent: boolean; pythonUnsupportedNodeDiagnostics: boolean };
type Failure = { id: string; mode: ExecutionMode; diagnostics: { code: string; nodeId?: string }[]; partialSamples: number; strictStandaloneTemplateModeVerified: boolean; importFreeStandalone: boolean; actualStandaloneFailureParity: boolean; fullPartialStateAndMemoryParity: boolean; literalAtomicRollbackOracle: boolean; jsonFailureParity: boolean; insertionOrderFailureParity: boolean };
const map = JSON.parse(await readFile(mapPath, 'utf8')) as { baseline: { existingSubsetRows: number; sourceRows: number; datasetSha256: string }; rows: Row[] };
assert.equal(map.baseline.existingSubsetRows, 134); assert.equal(map.baseline.sourceRows, 385); assert.equal(map.baseline.datasetSha256, datasetSha256);
const evidenceBytes = await readFile(evidencePath);
const evidence = JSON.parse(evidenceBytes.toString('utf8')) as { engineVersion: string; registryCount: number; predecessorDefinitions: number; newDefinitions: number; presets: number; rawFixtures: number; rawPresetFixtures: number; datasetSha256: string; strictTypeScriptModes: string[]; strictTypeScriptPrograms: number; actualGeneratedPrograms: number; fixtures: Evidence[]; presetEvidence: Evidence[]; failures: Failure[]; fullSimulinkEquivalenceClaimed: boolean };
assert.equal(evidence.engineVersion, '0.11.0-m10'); if (args[0] === '--write') assert.equal(evidence.engineVersion, ENGINE_VERSION, 'Only the original M10 engine may rewrite frozen M10 approvals');
assert(blockRegistry.length >= evidence.registryCount, 'Current registry omitted frozen M10 definitions'); assert.equal(evidence.registryCount, 211 + M10_BLOCK_IDS.length); assert.equal(evidence.predecessorDefinitions, 211);
assert.equal(evidence.newDefinitions, 34); assert.equal(evidence.newDefinitions, M10_BLOCK_IDS.length); assert.equal(evidence.presets, 10); assert.equal(evidence.presets, M10_BLOCK_PRESETS.length);
assert.equal(evidence.rawFixtures, M10_INDEPENDENT_FIXTURES.length); assert.equal(evidence.rawPresetFixtures, M10_INDEPENDENT_PRESET_FIXTURES.length); assert.equal(evidence.datasetSha256, datasetSha256); assert.equal(evidence.fullSimulinkEquivalenceClaimed, false);
assert.deepEqual([...evidence.strictTypeScriptModes].sort(), ['continuous', 'discrete', 'static']); assert.equal(evidence.strictTypeScriptPrograms, 3);
const predecessor = JSON.parse(await readFile('docs/baselines/m9-registry.json', 'utf8')) as typeof blockRegistry;
assert.equal(predecessor.length, 211); for (const definition of predecessor) assert.deepEqual(getBlockDefinition(definition.id), definition, `${definition.id}: predecessor definition drift`);
assert.deepEqual([...new Set(M10_INDEPENDENT_DEFINITION_FIXTURES.flatMap(entry => entry.model.nodes.map(node => node.blockType)).filter(id => (M10_BLOCK_IDS as readonly string[]).includes(id)))].sort(), [...M10_BLOCK_IDS].sort());
const actualFixtures = [...M10_INDEPENDENT_FIXTURES, ...M10_INDEPENDENT_PRESET_FIXTURES].flatMap(entry => entry.declaredModes.map(mode => m10IndependentMode(entry, mode)));
const all = [...evidence.fixtures, ...evidence.presetEvidence];
assert.equal(all.length, actualFixtures.length); assert.equal(new Set(all.map(entry => entry.id)).size, all.length);
assert.equal(evidence.actualGeneratedPrograms, all.length + evidence.failures.length);
for (const entry of all) {
  assert(entry.independentLiteralOracle && entry.typedMetadataTagsAndStringsExact && entry.float32BitTrueExact && entry.exactZerosAndSubnormals && entry.strictStandaloneTemplateModeVerified && entry.importFreeStandalone && entry.actualStandaloneTypeScript && entry.fullSamplesFinalStateMemoryParity && entry.exactManifest && entry.jsonRoundtrip && entry.insertionOrderIndependent && entry.pythonUnsupportedNodeDiagnostics, `${entry.id}: missing selected execution gate`);
  assert.equal(entry.targetVersion, 'typescript-m10-v1'); assert.equal(entry.float64Tolerance, 3e-12);
  assert(Number.isFinite(entry.maximumAbsoluteError) && entry.maximumAbsoluteError >= 0 && Number.isFinite(entry.maximumScaledError) && entry.maximumScaledError >= 0 && entry.maximumScaledError <= entry.float64Tolerance, `${entry.id}: numerical evidence is not bounded`);
  const fixture = actualFixtures.find(candidate => candidate.name === entry.id); assert(fixture, `${entry.id}: stale fixture evidence`); assert.equal(entry.mode, fixture.model.execution.mode);
  const compiled = compileModel(fixture.model);
  const parameters = Object.fromEntries(compiled.nodes.filter(node => (M10_BLOCK_IDS as readonly string[]).includes(node.blockType)).map(node => [node.id, { blockType: node.blockType, parameters: node.parameters, sampleTime: node.sampleTime }]));
  assert.deepEqual(entry.parameters, parameters, `${entry.id}: configured contract drift`);
  assert.deepEqual([...entry.blockIds].sort(), [...new Set(Object.values(parameters).map(node => node.blockType))].sort());
  const series = Object.values(fixture.expected); assert(series.length > 0); assert(series.every(values => values.length === entry.samples));
  if (fixture.expectedFinalState) assert(entry.independentFullFinalStateOracle, `${entry.id}: literal final state missing`);
  if (fixture.expectedStateMemory) assert(entry.independentFullStateMemoryOracle, `${entry.id}: literal internal state missing`);
}
for (const mode of evidence.strictTypeScriptModes) assert(all.some(entry => entry.mode === mode && entry.strictProgramIndividuallyChecked), `${mode}: missing actual strict template check`);
for (const id of M10_BLOCK_IDS) for (const mode of getBlockDefinition(id)!.supportedModes) assert(evidence.fixtures.some(entry => entry.blockIds.includes(id) && entry.mode === mode), `${id}/${mode}: missing declared-mode literal execution`);
assert.equal(evidence.failures.length, M10_INDEPENDENT_FAILURE_FIXTURES.length);
for (const failure of evidence.failures) {
  const fixture = M10_INDEPENDENT_FAILURE_FIXTURES.find(entry => entry.name === failure.id); assert(fixture, failure.id);
  assert(failure.strictStandaloneTemplateModeVerified && failure.importFreeStandalone && failure.actualStandaloneFailureParity && failure.jsonFailureParity && failure.insertionOrderFailureParity, `${failure.id}: incomplete failure execution evidence`);
  assert.equal(failure.mode, fixture.model.execution.mode); assert.equal(failure.diagnostics[0]?.code, fixture.diagnosticCode); assert.equal(failure.diagnostics[0]?.nodeId, fixture.nodeId);
  if (fixture.expectedPartial) { assert(failure.literalAtomicRollbackOracle && failure.fullPartialStateAndMemoryParity, failure.id); assert.equal(failure.partialSamples, fixture.expectedPartial.samples); }
}
const matches = (entry: Evidence, route: Route) => Object.values(entry.parameters).some(node => node.blockType === route.canonical && Object.entries(route.parameters).every(([key, value]) => JSON.stringify(node.parameters[key]) === JSON.stringify(value)));
for (const preset of M10_BLOCK_PRESETS) for (const mode of getBlockDefinition(preset.blockType)!.supportedModes) assert(evidence.presetEvidence.some(entry => entry.presetId === preset.id && entry.mode === mode && matches(entry, { canonical: preset.blockType, parameters: preset.parameters, presetId: preset.id, independentAlternative: false, evidenceFixtureIds: [], sourceFullEquivalent: false })), `${preset.id}/${mode}: missing configured preset execution`);

const baselineText = await readFile('docs/baselines/catalog-block-coverage.md', 'utf8');
const baselineRows = new Map(baselineText.split(/\r?\n/).flatMap(line => { const match = /^\| \[(\d{2}-\d{3})\]\([^)]*\) \(L(\d+)\) \|/.exec(line); return match ? [[match[1]!, { line: Number(match[2]), cells: line.slice(1, -1).split('|').map(cell => cell.trim()) }] as const] : []; }));
assert.equal(baselineRows.size, 385); assert.equal([...baselineRows.values()].filter(row => row.cells[8] !== '미구현').length, 134);
const planned = JSON.parse(await readFile('docs/simulink-coverage-roadmap.json', 'utf8')) as { rows: { id: string; firstWorkMilestone: string }[] };
assert.equal(map.rows.length, 38); assert.equal(new Set(map.rows.map(row => row.sourceId)).size, 38);
assert.deepEqual(map.rows.map(row => row.sourceId).sort(), planned.rows.filter(row => row.firstWorkMilestone === 'M10').map(row => row.id).sort());
const sourceLines = (await readFile(sourcePath, 'utf8')).split(/\r?\n/);
for (const row of map.rows) {
  const base = baselineRows.get(row.sourceId); assert(base, row.sourceId); assert.equal(base.line, row.sourceLine);
  assert.deepEqual(base.cells.slice(1, 4), [row.sourceName, row.sourceSubgroup, row.sourceCondition]); assert.equal(base.cells[4]!.replace(/^`|`$/g, ''), row.baselineCanonical); assert.equal(base.cells[8], row.baselineStatus); assert.equal(row.baselineExistingSubset, row.baselineStatus !== '미구현');
  assert.equal(sourceLines[row.sourceLine - 1]!.trim(), `| ${row.sourceName} | ${row.sourceCondition} |`, row.sourceId); assert.equal(row.sourceOptionCompletionStatus, 'open'); assert.equal(row.delivery.sourceFullEquivalent, false);
}
assert.equal(map.rows.filter(row => !row.baselineExistingSubset).length, 34);
const referenceReviewPath = 'docs/evidence/m10-reference-review.json';
const sourceReview = JSON.parse(await readFile(referenceReviewPath, 'utf8')) as { datasetSha256: string; sourceRows: number; mathWorksReferenceExecuted: boolean; sourceFullOptionCompletionStatus: string; meaningDecisions: { sourceIds?: string[] }[] };
assert.equal(sourceReview.datasetSha256, datasetSha256); assert.equal(sourceReview.sourceRows, 38); assert.equal(sourceReview.mathWorksReferenceExecuted, false); assert.equal(sourceReview.sourceFullOptionCompletionStatus, 'open');
const reviewedIds = new Set(sourceReview.meaningDecisions.flatMap(entry => entry.sourceIds ?? []));
const pending: { sourceId: string; reason: string }[] = [];
const approvals = map.rows.filter(row => row.sourceId !== '14-012').flatMap(row => {
  const route = row.delivery, definition = getBlockDefinition(route.canonical);
  assert(definition && (M10_BLOCK_IDS as readonly string[]).includes(route.canonical), `${row.sourceId}: selected canonical is not an M10 definition`);
  const matched = all.filter(entry => matches(entry, route) && (!route.presetId || entry.presetId === route.presetId));
  const reason = !reviewedIds.has(row.sourceId) ? 'Primary source core meaning has not been reviewed' : !definition.supportedModes.every(mode => matched.some(entry => entry.mode === mode)) ? 'Configured independent oracle plus actual standalone execution missing in one or more declared modes' : null;
  if (reason) { pending.push({ sourceId: row.sourceId, reason }); return []; }
  if (route.evidenceFixtureIds.length) for (const id of route.evidenceFixtureIds) assert(matched.some(entry => entry.id === id), `${row.sourceId}: incorrect selected evidence ${id}`);
  if (route.presetId) { const preset = M10_BLOCK_PRESETS.find(entry => entry.id === route.presetId); assert(preset && preset.blockType === route.canonical); assert(matched.every(entry => entry.presetId === route.presetId)); }
  if (route.canonical === 'fixed.state-space') assert(matched.some(entry => entry.independentFullFinalStateOracle && entry.independentFullStateMemoryOracle) && evidence.failures.some(entry => entry.literalAtomicRollbackOracle), `${row.sourceId}: missing independent internal state/atomic rollback oracle`);
  const status = route.independentAlternative ? 'M10 독립 대체 subset' : route.presetId ? 'M10 preset subset' : 'M10 승인 subset';
  const boundary = `${definition.description} · 선택 설정 ${JSON.stringify(route.parameters)}. 등록된 tagged dtype·bounded 형상·mode 및 명시 rounding/overflow만; changing continuous quantization은 held 경계 필수. 실제 TS/JSON/original node/state 검증은 선택 oracle 범위이며 전체 옵션·R2024b 실행 및 MathWorks bit parity 미승인. 후속 source 옵션은 open이다.`;
  assert(!boundary.includes('|'));
  return [{ sourceId: row.sourceId, sourceName: row.sourceName, sourceLine: row.sourceLine, sourceSubgroup: row.sourceSubgroup, sourceCondition: row.sourceCondition, canonical: route.canonical, parameters: route.parameters, presetId: route.presetId, status, boundary, evidenceFixtureIds: matched.map(entry => entry.id), declaredModes: definition.supportedModes, newlyApproved: !row.baselineExistingSubset, priorStatus: row.baselineStatus, nativeFullEquivalent: false, sourceOptionCompletionStatus: 'open' }];
});
const original = await readFile(coveragePath, 'utf8');
const preservedUnitLine = original.split(/\r?\n/).find(line => line.startsWith('| [14-012]')); assert(preservedUnitLine);
const preservedUnitCells = preservedUnitLine.slice(1, -1).split('|').map(cell => cell.trim()); assert.equal(preservedUnitCells[4], '`unit.convert`'); assert.equal(preservedUnitCells[8], 'M4 승인 subset');
const byId = new Map(approvals.map(entry => [entry.sourceId, entry])); let seen = 0;
const lines = original.split(/\r?\n/).map(line => {
  const match = /^\| \[(\d{2}-\d{3})\]\([^)]*\) \(L(\d+)\) \|/.exec(line); if (!match) return line;
  const approved = byId.get(match[1]!); if (!approved) return line;
  const cells = line.slice(1, -1).split('|').map(cell => cell.trim()); assert.equal(cells.length, 9); assert.equal(cells[1], approved.sourceName); assert.equal(Number(match[2]), approved.sourceLine); assert(cells[8] === approved.priorStatus || cells[8] === approved.status, `${approved.sourceId}: unrecognized prior approval`);
  cells[4] = `\`${approved.canonical}\``; cells[7] = approved.boundary; cells[8] = approved.status; seen++; return `| ${cells.join(' | ')} |`;
});
assert.equal(seen, approvals.length); assert.equal(lines.find(line => line.startsWith('| [14-012]')), preservedUnitLine);
const additional = approvals.filter(entry => entry.newlyApproved).length, existing = approvals.length - additional;
const summary = `- 현재 M10 승인 범위: 원본385행 중 선택 subset${211 + additional}행·미구현${174 - additional}행. M10 최초 배정38행에서 신규${additional}행·기존 mapping 확장${existing}행을 검증하고 기존14-012 Unit Conversion1행은 원형을 보존한다. registry${evidence.registryCount} 정의·10 preset·원본행 수를 구분한다. [M10 계약](m10-contract.md)·[독립 수치/TS 증거](evidence/m10-verification.json)·[source 승인](evidence/m10-source-approvals.json)를 따른다. 원본 전체 옵션·Simulink 실행/bit parity는 open이다.`;
const summaryIndex = lines.findIndex(line => line.startsWith('- 현재 M10 승인 범위:')); if (summaryIndex >= 0) lines[summaryIndex] = summary; else lines.splice(4, 0, summary);
const record = { generatedAt: new Date().toISOString(), stage: 'M10', engineVersion: evidence.engineVersion, datasetSha256, evidencePath, evidenceSha256: hash(evidenceBytes), fixturePath: 'tests/m10-independent-fixtures.ts', fixtureSha256: hash(await readFile('tests/m10-independent-fixtures.ts')), sourceReviewPath: referenceReviewPath, registryDefinitions: evidence.registryCount, firstWorkSourceRows: 38, approvedAdditionalSourceRows: additional, existingMappingExtensions: existing, preservedSourceRows: [{ sourceId: '14-012', canonical: 'unit.convert', priorStatus: 'M4 승인 subset', rowSha256: hash(preservedUnitLine), followup: 'Typed and inverse-unit conversion remain open; original finite affine subset and row are preserved.', nativeFullEquivalent: false }], pending, strictTypeScriptScope: 'One actual program per execution-mode template is strictly type checked; every configured generated program is import-free syntax checked and actually executed. Exact selected typed metadata/codes/tags/binary32 and full runtime contract parity are distinct from finite binary64/complex tolerance.', protectedArtifacts, fullSimulinkEquivalenceClaimed: false, approvals };
if (args[0] === '--write') { await writeFile(coveragePath, lines.join('\n')); await writeFile(approvalPath, JSON.stringify(record, null, 2) + '\n'); }
if (args[0] === '--verify') {
  for (const approved of approvals) { const applied = original.split(/\r?\n/).find(line => line.startsWith(`| [${approved.sourceId}]`)); assert(applied); const cells = applied.slice(1, -1).split('|').map(cell => cell.trim()); assert.equal(cells[4], `\`${approved.canonical}\``); assert.equal(cells[7], approved.boundary); assert.equal(cells[8], approved.status); }
  assert(original.includes(summary)); const { generatedAt: _stored, ...stored } = JSON.parse(await readFile(approvalPath, 'utf8')); const { generatedAt: _current, ...expected } = record; assert.deepEqual(stored, expected, 'Applied approvals drifted from actual selected execution evidence');
}
await verifyProtected();
process.stdout.write(JSON.stringify({ sourceRows: 385, firstWorkSourceRows: 38, additionalSourceApprovals: additional, existingMappingExtensions: existing, preservedUnitRows: 1, pendingRows: pending.length, registryDefinitions: blockRegistry.length, mutated: args[0] === '--write' }) + '\n');
