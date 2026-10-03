import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { blockRegistry, getBlockDefinition } from '../packages/block-library/src';
import { M8_BLOCK_IDS, M8_BLOCK_PRESETS } from '../packages/block-library/src/m8';
import { M8_FIXTURES } from '../tests/m8-fixtures';

// Approval binds original source identities to executed declared subsets, never full options.
const args = process.argv.slice(2); assert(args.length === 1 && ['--check', '--write', '--verify'].includes(args[0]!), 'Use --check (proposal), --write or --verify (applied evidence)');
const sourcePath = 'dataset/Simulink_Basic_Blocks_R2024b.md', coveragePath = 'docs/block-coverage.md';
const datasetHash = 'cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7';
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await readFile(sourcePath)), datasetHash);
interface Row { sourceId: string; sourceName: string; sourceLine: number; sourceSubgroup: string; sourceCondition: string; baselineCanonical: string; baselineStatus: string; baselineExistingSubset: boolean; plannedRoutes: string[]; configurationPreset: { id: string; parameters: Record<string, unknown> } | null }
interface Fixture { id: string; blockIds: string[]; parameters: Record<string, unknown>; independentOracle: boolean; maximumAbsoluteError: number; maximumScaledError: number; tolerance: number; exactSubnormalOracles: boolean; modes: Record<string, { actualStandaloneTypeScript: boolean; jsonRoundtrip: boolean; insertionOrderIndependent: boolean }> }
interface Preset { id: string; blockIds: string[]; parameters: Record<string, unknown>; mode: string; actualStandaloneTypeScript: boolean; independentOracle: boolean }
const map = JSON.parse(await readFile('docs/m8-implementation-map.json', 'utf8')) as { rows: Row[] };
const evidencePath = 'docs/evidence/m8-verification.json';
const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as { engineVersion: string; registryCount: number; datasetSha256: string; newDefinitions: number; fixtures: Fixture[]; presetEvidence?: Preset[]; strictTypeScriptModes: string[] };
const presetEvidencePath = 'docs/evidence/m8-presets-verification.json';
const presets = JSON.parse(await readFile(presetEvidencePath, 'utf8')) as { engineVersion: string; datasetSha256: string; presetEvidence: Preset[] };
assert.equal(evidence.engineVersion, '0.9.0-m8'); assert.equal(evidence.datasetSha256, datasetHash); assert.equal(evidence.newDefinitions, M8_BLOCK_IDS.length);
assert.equal(evidence.registryCount, 144 + M8_BLOCK_IDS.length);
assert.equal(presets.engineVersion, evidence.engineVersion); assert.equal(presets.datasetSha256, datasetHash);
assert.deepEqual([...evidence.strictTypeScriptModes].sort(), ['continuous', 'discrete', 'static']);
assert.deepEqual([...new Set(evidence.fixtures.flatMap(entry => entry.blockIds))].sort(), [...M8_BLOCK_IDS].sort());
assert.deepEqual(evidence.fixtures.map(entry => ({ id: entry.id, blockIds: entry.blockIds, parameters: entry.parameters })), M8_FIXTURES.map(entry => ({ id: entry.name, blockIds: [entry.id], parameters: entry.parameters })), 'Evidence must cover the exact current independent fixture set');
const modes = ['static', 'discrete', 'continuous'];
assert.equal(presets.presetEvidence.length, M8_BLOCK_PRESETS.length * modes.length);
for (const preset of M8_BLOCK_PRESETS) for (const mode of modes) {
  const matching = presets.presetEvidence.filter(entry => entry.id === preset.id && entry.mode === mode);
  assert.equal(matching.length, 1); assert.deepEqual(matching[0]!.blockIds, [preset.blockType]); assert.deepEqual(matching[0]!.parameters, preset.parameters); assert(matching[0]!.independentOracle && matching[0]!.actualStandaloneTypeScript);
}
for (const entry of evidence.fixtures) {
  assert(entry.independentOracle && Number.isFinite(entry.maximumAbsoluteError) && entry.maximumAbsoluteError >= 0 && Number.isFinite(entry.maximumScaledError) && entry.maximumScaledError >= 0 && entry.maximumScaledError <= 3e-12 && entry.tolerance === 3e-12 && entry.exactSubnormalOracles, entry.id);
  assert(modes.every(mode => entry.modes[mode]?.actualStandaloneTypeScript && entry.modes[mode]?.jsonRoundtrip && entry.modes[mode]?.insertionOrderIndependent), entry.id);
}
const additions = map.rows.filter(row => !row.baselineExistingSubset); assert.equal(additions.length, 46);
assert.equal(map.rows.length, 107); assert.equal(new Set(map.rows.map(row => row.sourceId)).size, 107);
const baselineText = await readFile('docs/baselines/catalog-block-coverage.md', 'utf8');
const baselineRows = new Map(baselineText.split(/\r?\n/).flatMap(line => { const match = /^\| \[(\d{2}-\d{3})\]\([^)]*\) \(L(\d+)\) \|/.exec(line); return match ? [[match[1]!, { line: Number(match[2]), cells: line.slice(1, -1).split('|').map(cell => cell.trim()) }] as const] : []; }));
assert.equal(baselineRows.size, 385);
const planned = JSON.parse(await readFile('docs/simulink-coverage-roadmap.json', 'utf8')) as { rows: { id: string; firstWorkMilestone: string }[] };
assert.deepEqual(map.rows.map(row => row.sourceId).sort(), planned.rows.filter(row => row.firstWorkMilestone === 'M8').map(row => row.id).sort());
const sourceLines = (await readFile(sourcePath, 'utf8')).split(/\r?\n/);
for (const row of map.rows) {
  const base = baselineRows.get(row.sourceId); assert(base, row.sourceId);
  assert.equal(base.line, row.sourceLine); assert.deepEqual(base.cells.slice(1, 4), [row.sourceName, row.sourceSubgroup, row.sourceCondition]);
  assert.equal(base.cells[4]!.replace(/^`|`$/g, ''), row.baselineCanonical); assert.equal(base.cells[8], row.baselineStatus); assert.equal(row.baselineExistingSubset, row.baselineStatus !== '미구현');
  assert.equal(sourceLines[row.sourceLine - 1]!.trim(), `| ${row.sourceName} | ${row.sourceCondition} |`, row.sourceId);
}
const newIds: ReadonlySet<string> = new Set(M8_BLOCK_IDS);
const presetRows: Record<string, string> = { '01-009': 'ground', '17-012': 'ground', '20-004': 'decrement', '20-007': 'decrement-to-zero', '20-008': 'increment', '21-001': 'eulers-number', '21-005': 'one', '21-008': 'square-root', '06-007': 'compare-zero' };
const approval = additions.map(row => {
  let canonical = row.plannedRoutes.find(id => newIds.has(id)) ?? row.plannedRoutes[0]!;
  if (/Signed (?:Sqrt|Square Root)/.test(row.sourceName)) canonical = 'math.signed-sqrt';
  if (/Reciprocal (?:Sqrt|Square Root)/.test(row.sourceName)) canonical = 'math.reciprocal-sqrt';
  if (row.sourceId === '21-008') canonical = 'math.sqrt';
  const definition = getBlockDefinition(canonical); assert(definition, `${row.sourceId}: missing canonical`);
  const parameters: Record<string, unknown> = { ...(row.configurationPreset?.parameters ?? {}) };
  if (canonical === 'verify.bounds') { parameters.source = row.sourceName.includes('Dynamic') ? 'dynamic' : 'static'; parameters.kind = row.sourceName.includes('Gap') ? 'gap' : row.sourceName.includes('Lower') ? 'lower' : row.sourceName.includes('Upper') ? 'upper' : 'range'; }
  const presetId = presetRows[row.sourceId];
  const matched = evidence.fixtures.filter(entry => {
    if (!entry.blockIds.includes(canonical)) return false;
    const actual = { ...Object.fromEntries(Object.entries(definition.parameters).map(([key, value]) => [key, value.default])), ...entry.parameters };
    return Object.entries(parameters).every(([key, value]) => JSON.stringify(actual[key]) === JSON.stringify(value));
  });
  const presetMatches = presets.presetEvidence.filter(entry => entry.id === presetId && entry.blockIds.includes(canonical));
  assert(matched.length > 0 || modes.every(mode => presetMatches.some(entry => entry.mode === mode && entry.actualStandaloneTypeScript && entry.independentOracle)), `${row.sourceId}: missing configured oracle ${canonical}/${JSON.stringify(parameters)}`);
  const alternative = ['08-010', '04-014'].includes(row.sourceId);
  const gapNote = parameters.kind === 'gap' ? ' gap은 설정한 내부 구간의 여집합이다. closed는 경계를 제외하고 open은 경계를 포함하므로 원본 InclusiveUpper/Lower 설정은 반전하여 대응해야 한다.' : '';
  return { sourceId: row.sourceId, sourceName: row.sourceName, canonical, parameters, status: alternative ? 'M8 독립 대체 subset' : presetId ? 'M8 preset subset' : 'M8 승인 subset', boundary: `${definition.description}${gapNote} · finite float64/boolean 및 등록 형상·단위·모드만; 원본 전체 옵션/R2024b 실행 동등 미검증. M8 후속 옵션 inventory는 열린 상태다.`, evidenceFixtureIds: matched.map(entry => entry.id), presetEvidenceIds: presetMatches.map(entry => `${entry.id}/${entry.mode}`), nativeFullEquivalent: false };
});
const byId = new Map(approval.map(entry => [entry.sourceId, entry]));
let seen = 0;
const original = await readFile(coveragePath, 'utf8');
const lines = original.split(/\r?\n/).map(line => {
  const match = /^\| \[(\d{2}-\d{3})\]\([^)]*\) \(L(\d+)\) \|/.exec(line); if (!match) return line;
  const approved = byId.get(match[1]!); if (!approved) return line;
  const cells = line.slice(1, -1).split('|').map(cell => cell.trim()); const row = additions.find(entry => entry.sourceId === match[1])!;
  assert.equal(cells.length, 9); assert.equal(cells[1], row.sourceName); assert.equal(Number(match[2]), row.sourceLine);
  assert(cells[8] === '미구현' || cells[8] === approved.status, `Unexpected prior approval: ${row.sourceId}`);
  cells[4] = `\`${approved.canonical}\``; cells[7] = approved.boundary; cells[8] = approved.status; seen++; return `| ${cells.join(' | ')} |`;
});
assert.equal(seen, 46);
const summary = `- 현재 M8 승인 범위: M8 납품 당시 원본385행 중 검증된 subset180행·미구현205행. 신규46행은 등록 옵션의 제한 범위이며 Find Nonzero padded 출력과 Wrap To Zero 경계 선택은 독립 대체로 분리한다. registry${evidence.registryCount} 정의와 원본행·preset·독립 kernel 수는 별도다. [M8 계약](m8-contract.md)·[검증](m8-validation.md)·[승인 근거](evidence/m8-source-approvals.json)를 따른다. 모든 원본 옵션의 완료를 뜻하지 않는다.`;
if (!lines.some(line => line.startsWith('- 현재 M8 승인 범위:'))) lines.splice(4, 0, summary);
const record = { generatedAt: new Date().toISOString(), stage: 'M8', engineVersion: evidence.engineVersion, datasetSha256: datasetHash, evidencePath, evidenceSha256: hash(await readFile(evidencePath)), presetEvidencePath, presetEvidenceSha256: hash(await readFile(presetEvidencePath)), registryDefinitions: evidence.registryCount, approvedAdditionalSourceRows: 46, fullSimulinkEquivalenceClaimed: false, approvals: approval };
if (args[0] === '--write') { await writeFile(coveragePath, lines.join('\n')); await writeFile('docs/evidence/m8-source-approvals.json', JSON.stringify(record, null, 2) + '\n'); }
if (args[0] === '--verify') {
  for (const approved of approval) { const applied = original.split(/\r?\n/).find(line => line.startsWith(`| [${approved.sourceId}]`)); assert(applied, approved.sourceId); const cells = applied.slice(1, -1).split('|').map(cell => cell.trim()); assert.equal(cells[4], `\`${approved.canonical}\``); assert.equal(cells[7], approved.boundary); assert.equal(cells[8], approved.status); }
  assert(original.includes(summary), 'M8 historical summary changed');
  const { generatedAt: _storedTime, ...stored } = JSON.parse(await readFile('docs/evidence/m8-source-approvals.json', 'utf8')); const { generatedAt: _currentTime, ...expected } = record; assert.deepEqual(stored, expected, 'Applied source approvals drifted from verified evidence');
}
assert.equal(hash(await readFile(sourcePath)), datasetHash, 'Original dataset must remain unchanged');
process.stdout.write(JSON.stringify({ sourceRows: 385, proposedAdditionalApprovals: 46, definitions: blockRegistry.length, mutated: args[0] === '--write' }) + '\n');
