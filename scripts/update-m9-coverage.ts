import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { blockRegistry, getBlockDefinition } from '../packages/block-library/src';
import { M9_BLOCK_IDS, M9_BLOCK_PRESETS } from '../packages/block-library/src/m9';
import { M9_FIXTURES, M9_PRESET_FIXTURES } from '../tests/m9-fixtures';
import { compileModel } from '../packages/compiler/src';

const args = process.argv.slice(2); assert(args.length === 1 && ['--check', '--write', '--verify'].includes(args[0]!), 'Use --check, --write or --verify');
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const sourcePath = 'dataset/Simulink_Basic_Blocks_R2024b.md', coveragePath = 'docs/block-coverage.md';
const datasetHash = 'cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7';
assert.equal(hash(await readFile(sourcePath)), datasetHash);
type Route = { canonical: string; parameters: Record<string, unknown>; presetId: string | null; independentAlternative: boolean; evidenceFixtureIds: string[] };
type Row = { sourceId: string; sourceName: string; sourceLine: number; sourceSubgroup: string; sourceCondition: string; baselineCanonical: string; baselineStatus: string; baselineExistingSubset: boolean; delivery: Route };
type Evidence = { id: string; mode: string; blockIds: string[]; parameters: Record<string, { blockType: string; parameters: Record<string, unknown>; sampleTime: unknown }>; presetId?: string; maximumAbsoluteError: number; maximumScaledError: number; tolerance: number; exactSubnormalOracles: boolean; independentOracle: boolean; actualStandaloneTypeScript: boolean; finalStateAndMemoryParity: boolean; jsonRoundtrip: boolean; insertionOrderIndependent: boolean };
const map = JSON.parse(await readFile('docs/m9-implementation-map.json', 'utf8')) as { rows: Row[] };
const evidencePath = 'docs/evidence/m9-verification.json';
const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as { engineVersion: string; registryCount: number; newDefinitions: number; presets: number; datasetSha256: string; fixtures: Evidence[]; presetEvidence: Evidence[]; strictTypeScriptModes: string[] };
assert.equal(evidence.engineVersion, '0.10.0-m9'); assert.equal(evidence.registryCount, 185 + M9_BLOCK_IDS.length); assert.equal(evidence.newDefinitions, M9_BLOCK_IDS.length); assert.equal(evidence.presets, M9_BLOCK_PRESETS.length); assert.equal(evidence.datasetSha256, datasetHash);
assert.deepEqual(evidence.strictTypeScriptModes.sort(), ['continuous', 'discrete']);
const all = [...evidence.fixtures, ...evidence.presetEvidence]; assert.equal(new Set(all.map(entry => entry.id)).size, all.length, 'Evidence IDs must be unique');
const current = [...M9_FIXTURES, ...M9_PRESET_FIXTURES]; assert.equal(current.length, all.length); assert.equal(new Set(current.map(entry => entry.name)).size, current.length);
for (const entry of all) {
  assert(entry.independentOracle && entry.actualStandaloneTypeScript && entry.finalStateAndMemoryParity && entry.jsonRoundtrip && entry.insertionOrderIndependent && entry.exactSubnormalOracles, entry.id);
  assert(Number.isFinite(entry.maximumAbsoluteError) && entry.maximumAbsoluteError >= 0 && Number.isFinite(entry.maximumScaledError) && entry.maximumScaledError >= 0 && entry.maximumScaledError <= 3e-12 && entry.tolerance === 3e-12, entry.id);
  const fixture = current.find(item => item.name === entry.id); assert(fixture, entry.id); assert.equal(fixture.model.execution.mode, entry.mode);
  const compiled = compileModel(fixture.model), parameters = Object.fromEntries(compiled.nodes.filter(node => (M9_BLOCK_IDS as readonly string[]).includes(node.blockType)).map(node => [node.id, { blockType: node.blockType, parameters: node.parameters, sampleTime: node.sampleTime }]));
  assert.deepEqual(entry.parameters, parameters, `${entry.id}: live fixture contract drift`);
}
for (const id of M9_BLOCK_IDS) {
  const definition = getBlockDefinition(id)!; assert(definition);
  for (const mode of definition.supportedModes) assert(evidence.fixtures.some(entry => entry.blockIds.includes(id) && entry.mode === mode), `${id}/${mode}: missing executed oracle`);
}
const matches = (entry: Evidence, route: Route) => Object.values(entry.parameters).some(node => node.blockType === route.canonical && Object.entries(route.parameters).every(([key, value]) => JSON.stringify(node.parameters[key]) === JSON.stringify(value)));
for (const preset of M9_BLOCK_PRESETS) {
  const definition = getBlockDefinition(preset.blockType)!;
  for (const mode of definition.supportedModes) assert(evidence.presetEvidence.some(entry => entry.presetId === preset.id && entry.mode === mode && matches(entry, { canonical: preset.blockType, parameters: preset.parameters, presetId: preset.id, independentAlternative: false, evidenceFixtureIds: [] })), `${preset.id}/${mode}: missing configured preset oracle`);
}
assert.equal(map.rows.length, 58); assert.equal(new Set(map.rows.map(row => row.sourceId)).size, 58);
const baselineText = await readFile('docs/baselines/catalog-block-coverage.md', 'utf8');
const baselineRows = new Map(baselineText.split(/\r?\n/).flatMap(line => { const match = /^\| \[(\d{2}-\d{3})\]\([^)]*\) \(L(\d+)\) \|/.exec(line); return match ? [[match[1]!, { line: Number(match[2]), cells: line.slice(1, -1).split('|').map(cell => cell.trim()) }] as const] : []; }));
assert.equal(baselineRows.size, 385);
const planned = JSON.parse(await readFile('docs/simulink-coverage-roadmap.json', 'utf8')) as { rows: { id: string; firstWorkMilestone: string }[] };
assert.deepEqual(map.rows.map(row => row.sourceId).sort(), planned.rows.filter(row => row.firstWorkMilestone === 'M9').map(row => row.id).sort());
const sourceLines = (await readFile(sourcePath, 'utf8')).split(/\r?\n/);
for (const row of map.rows) {
  const base = baselineRows.get(row.sourceId); assert(base, row.sourceId); assert.equal(base.line, row.sourceLine);
  assert.deepEqual(base.cells.slice(1, 4), [row.sourceName, row.sourceSubgroup, row.sourceCondition]); assert.equal(base.cells[4]!.replace(/^`|`$/g, ''), row.baselineCanonical); assert.equal(base.cells[8], row.baselineStatus); assert.equal(row.baselineExistingSubset, row.baselineStatus !== '미구현');
  assert.equal(sourceLines[row.sourceLine - 1]!.trim(), `| ${row.sourceName} | ${row.sourceCondition} |`, row.sourceId);
}
const additions = map.rows.filter(row => !row.baselineExistingSubset); assert.equal(additions.length, 31);
const traceCorrection = map.rows.find(row => row.sourceId === '05-009')!; assert(traceCorrection.baselineExistingSubset);
const approvals = [...additions, traceCorrection].map(row => {
  const route = row.delivery, definition = getBlockDefinition(route.canonical); assert(definition, row.sourceId); assert((M9_BLOCK_IDS as readonly string[]).includes(route.canonical));
  const matched = all.filter(entry => matches(entry, route)); assert(matched.length > 0, `${row.sourceId}: missing configured oracle`);
  for (const mode of definition.supportedModes) assert(matched.some(entry => entry.mode === mode), `${row.sourceId}/${mode}: missing configured execution`);
  if (route.evidenceFixtureIds.length) for (const id of route.evidenceFixtureIds) assert(matched.some(entry => entry.id === id), `${row.sourceId}: incorrect selected evidence ${id}`);
  if (route.presetId) { const preset = M9_BLOCK_PRESETS.find(entry => entry.id === route.presetId); assert(preset && preset.blockType === route.canonical); assert(matched.some(entry => entry.presetId === route.presetId)); }
  const status = route.independentAlternative ? 'M9 독립 대체 subset' : route.presetId ? 'M9 preset subset' : 'M9 승인 subset';
  const boundary = `${definition.description} · 선택 설정 ${JSON.stringify(route.parameters)}. 등록된 finite float64/boolean 형상·모드·고정 due grid만; 원본 전체 옵션·R2024b 실행 및 seed 동등 미검증. M9 추가 옵션은 후속 inventory에서 추적한다.`;
  assert(!boundary.includes('|'));
  return { sourceId: row.sourceId, sourceName: row.sourceName, canonical: route.canonical, parameters: route.parameters, presetId: route.presetId, status, boundary, evidenceFixtureIds: matched.map(entry => entry.id), declaredModes: definition.supportedModes, newlyApproved: !row.baselineExistingSubset, priorStatus: row.baselineStatus, nativeFullEquivalent: false };
});
const byId = new Map(approvals.map(entry => [entry.sourceId, entry])), original = await readFile(coveragePath, 'utf8'); let seen = 0;
const lines = original.split(/\r?\n/).map(line => {
  const match = /^\| \[(\d{2}-\d{3})\]\([^)]*\) \(L(\d+)\) \|/.exec(line); if (!match) return line;
  const approved = byId.get(match[1]!); if (!approved) return line;
  const cells = line.slice(1, -1).split('|').map(cell => cell.trim()), row = map.rows.find(entry => entry.sourceId === match[1])!;
  assert.equal(cells.length, 9); assert.equal(cells[1], row.sourceName); assert.equal(Number(match[2]), row.sourceLine); assert(cells[8] === row.baselineStatus || cells[8] === approved.status, `${row.sourceId}: unexpected prior status`);
  cells[4] = `\`${approved.canonical}\``; cells[7] = approved.boundary; cells[8] = approved.status; seen++; return `| ${cells.join(' | ')} |`;
}); assert.equal(seen, 32);
const summary = `- 현재 M9 승인 범위: M9 납품 당시 원본385행 중 제한된 subset211행·미구현174행. 신규31행 승인과 기존 전달함수1행의 계수 순서 추적 교정을 구분한다. registry${evidence.registryCount} 정의·15개 기본 구성·원본행 수는 별도 지표다. [M9 계약](01-technical-whitepaper.md)·[검증](validation.md)·[승인 근거](evidence/m9-source-approvals.json)를 따른다. 원본 전체 옵션·실행 동등 완료를 뜻하지 않는다.`;
// Keep the consolidated current header; historical approvals remain in frozen JSON.
const consolidatedHeader = original.includes('[기계 판독 지원표](support-matrix.json)');
if (!consolidatedHeader) { if (!lines.some(line => line.startsWith('- 현재 M9 승인 범위:'))) lines.splice(4, 0, summary); }
const record = { generatedAt: new Date().toISOString(), stage: 'M9', engineVersion: evidence.engineVersion, datasetSha256: datasetHash, evidencePath, evidenceSha256: hash(await readFile(evidencePath)), registryDefinitions: evidence.registryCount, approvedAdditionalSourceRows: 31, existingTraceCorrections: 1, fullSimulinkEquivalenceClaimed: false, approvals };
if (args[0] === '--write') { await writeFile(coveragePath, lines.join('\n')); await writeFile('docs/evidence/m9-source-approvals.json', JSON.stringify(record, null, 2) + '\n'); }
if (args[0] === '--verify') {
  for (const approved of approvals) { const applied = original.split(/\r?\n/).find(line => line.startsWith(`| [${approved.sourceId}]`)); assert(applied); const cells = applied.slice(1, -1).split('|').map(cell => cell.trim()); assert.equal(cells[4], `\`${approved.canonical}\``); assert.equal(cells[7], approved.boundary); assert.equal(cells[8], approved.status); }
  if (!consolidatedHeader) assert(original.includes(summary)); const { generatedAt: _stored, ...stored } = JSON.parse(await readFile('docs/evidence/m9-source-approvals.json', 'utf8')); const { generatedAt: _current, ...expected } = record; assert.deepEqual(stored, expected, 'Applied approvals drifted from verification');
}
assert.equal(hash(await readFile(sourcePath)), datasetHash);
process.stdout.write(JSON.stringify({ sourceRows: 385, additionalSourceApprovals: 31, traceCorrections: 1, registryDefinitions: blockRegistry.length, mutated: args[0] === '--write' }) + '\n');
