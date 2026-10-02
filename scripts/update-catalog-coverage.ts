import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { blockRegistry, getBlockDefinition } from '../packages/block-library/src';
import { EXPANSION_BLOCK_IDS } from '../packages/block-library/src/expansion';
import { EXPANDED_TIME_SOURCE_IDS } from '../packages/block-library/src/time-sources';
import { ENGINE_VERSION } from '../packages/model/src';

const SOURCE_PATH = 'dataset/Simulink_Basic_Blocks_R2024b.md';
const COVERAGE_PATH = 'docs/block-coverage.md';
const EVIDENCE_PATH = 'docs/evidence/catalog-verification.json';
const DATASET_SHA256 = 'cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7';
const APPROVED_STATUS = 'catalog 승인 subset';
const expectedSectionCounts = [23, 16, 37, 14, 21, 22, 9, 38, 19, 8, 11, 5, 29, 14, 27, 11, 27, 16, 15, 9, 14];
interface SourceRow { id: string; name: string; subgroup: string; condition: string; line: number }
interface CoverageRow { id: string; cells: string[]; line: number }
interface Approval { name: string; blockIds: readonly string[]; boundary: string; fixtureId?: string }
interface FixtureEvidence {
  id: string; blockIds: string[]; maximumAbsoluteError: number; tolerance: number;
  staticVerified: boolean; discreteVerified: boolean; continuousVerified: boolean;
  independentTSParity: boolean; jsonRoundtrip: boolean; unsupportedStaticVerified?: boolean;
}
interface Evidence { engineVersion: string; datasetSha256: string; registryCount: number; strictTypeScriptModes: string[]; fixtures: FixtureEvidence[]; failures: { id: string; diagnosticVerified: boolean }[] }

// Source rows count independently from registry cards; aliases and presets do not increase either approval count.
const approved: Readonly<Record<string, Approval>> = {
  '04-003': { name: 'Dead Zone', blockIds: ['nonlinear.dead-zone'], boundary: '유한 float64 scalar/vector/2D·고정 lower≤upper·경계 포함 출력0·단위 유지·static/discrete/continuous 값 평가; dynamic bounds·자료형 확장·새 zero-crossing event 탐지 제외' },
  '04-007': { name: 'Quantizer', blockIds: ['nonlinear.quantizer'], boundary: '유한 실수·step≥1e-12·ties-away-from-zero·같은 형상/단위·quotient 및 출력 finite 검사; fixed.quantize 저장정수/nearest-even·fixed-point 타입 전파·새 zero-crossing event 탐지와 구분' },
  '06-018': { name: 'Interval Test', blockIds: ['logic.interval'], boundary: '유한 실수 scalar/vector/2D·고정 닫힌 lower≤x≤upper 구간·boolean 결과·static/discrete/continuous 값 평가; 열린 구간·동적 경계·형식 검증 제외' },
  '08-005': { name: 'Bias', blockIds: ['math.bias'], boundary: '유한 float64 scalar/vector/2D 각 원소에 입력과 같은 단위의 고정 bias 합산·출력 finite 검사; fixed/complex 제외' },
  '08-008': { name: 'Divide', blockIds: ['math.multiply'], fixtureId: 'CAT-existing-divide', boundary: '기존 math.multiply의 operation=divide 원소별 구성·동일 형상 또는 명시 scalar broadcasting·단위 나눗셈·0 제수/비유한 진단·세 모드와 독립 TS oracle 확인 후 추적 누락 교정; 신규 registry/독립 kernel 증가0' },
  '08-009': { name: 'Dot Product', blockIds: ['vector.dot'], boundary: '동일 길이의 유한 실수 1D 두 벡터·scalar 내적·승인 단위 곱·중간 곱/합 finite 검사; complex conjugate·일반 tensor 제외' },
  '08-014': { name: 'Matrix Concatenate', blockIds: ['matrix.horizontal', 'matrix.vertical'], boundary: 'float64 2D 두 입력·동일 단위·수평 또는 수직 결합·비결합축 일치·입출력 각축≤32·방어적 복사; boolean 별도 fixture·일반 n-D/가변 포트 수 제외' },
  '08-019': { name: 'Polynomial', blockIds: ['math.polynomial'], boundary: '단위1 유한 실수 scalar/vector/2D·내림차순 계수1~32·Horner·중간값/출력 finite 검사; complex·계수별 물리 단위·다변수 다항식 제외' },
  '08-021': { name: 'Product of Elements', blockIds: ['reduce.product'], boundary: '단위1 유한 float64 scalar/vector/2D 전체를 row-major 곱으로 집계·scalar 출력·중간 곱 finite 검사; axis별 집계·복소수·일반 fixed-point 제외' },
  '08-026': { name: 'Sign', blockIds: ['math.sign'], boundary: '유한 float64 scalar/vector/2D의 음수-1/영0/양수1·단위1 출력·Math.sign의 계산된 signed zero 보존; NaN/complex 및 새 crossing event 탐지 제외' },
  '08-034': { name: 'Sum of Elements', blockIds: ['reduce.sum'], boundary: '유한 float64 scalar/vector/2D 전체를 row-major 합으로 집계·같은 단위 scalar·중간 합 finite 검사; axis별 집계·일반 n-D/복소수 제외' },
  '09-002': { name: 'Create Diagonal Matrix', blockIds: ['matrix.diag-create'], boundary: '동종 float64/boolean 1D 길이1~32→정방 대각 행렬·비대각0/false·단위 유지·방어적 복사; 일반 tensor·동적 형상 제외' },
  '09-003': { name: 'Cross Product', blockIds: ['vector.cross'], boundary: '길이3 유한 실수 두 벡터의 오른손 외적·승인 단위 곱·중간값 finite 검사; complex·축별 일반 배열 외적 제외' },
  '09-005': { name: 'Extract Diagonal', blockIds: ['matrix.diagonal'], boundary: 'float64 2D·각축1~32·주대각 min(rows,columns) 1D 추출·단위 유지·복사; boolean 별도 fixture·offset 대각·일반 n-D 제외' },
  '09-007': { name: 'Identity Matrix', blockIds: ['matrix.identity'], boundary: '명시 size1~32·단위1 float64 정방 항등행렬·고정 형상·새 배열; complex/typed identity·런타임 크기 입력 제외' },
  '09-011': { name: 'Matrix Concatenate', blockIds: ['matrix.horizontal', 'matrix.vertical'], boundary: '08-014와 같은 검증된 수평/수직 2D 결합 subset 및 공유 계산 구현; 원본행은 별도 추적하며 엔진 두 번 합산하지 않음' },
  '09-018': { name: 'Submatrix', blockIds: ['matrix.select'], boundary: 'float64 2D·각축≤32·고정 0-based rows/columns 각각1~32개·범위 검사·중복 index 허용·단위 유지·불변 복사; boolean 별도 fixture·입력 포트 index/일반 n-D 제외' },
  '15-011': { name: 'Index Vector', blockIds: ['vector.select'], boundary: 'float64 1D·고정 0-based indices1~32개·범위 검사·중복 허용·단위 유지·복사; boolean 별도 fixture·동적 scalar index 포트 및 일반 n-D 구성 제외' },
  '15-019': { name: 'Selector', blockIds: ['vector.select', 'matrix.select'], boundary: '1D 또는 2D의 고정 0-based index 목록·float64·범위 검사·단위 유지·불변 복사; boolean 별도 fixture·axis마다 동적 index 포트·일반 n-D·one-based 원본 옵션 제외' },
  '17-002': { name: 'Chirp Signal', blockIds: ['source.chirp'], boundary: '절대 실행 시각 seconds·Hz 선형 sweep·0~duration에서 위상 적분·이후 최종 Hz 유지·음수 시각은 초기 Hz·유한 scalar·discrete due grid/continuous RK stage·독립 TS; static 명시 거부·log sweep/외부 wall clock 제외' },
};

function fail(message: string): never { throw new Error(message); }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`Invalid ${label} object`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) fail(`Invalid ${label} string`);
  return value;
}
function flag(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`Invalid ${label} flag`);
  return value;
}
function nonnegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(`Invalid ${label} number`);
  return value;
}
function readSource(bytes: Buffer): Map<string, SourceRow> {
  if (createHash('sha256').update(bytes).digest('hex') !== DATASET_SHA256) fail('Reference dataset changed');
  const rows = new Map<string, SourceRow>(), sectionCounts = Array(21).fill(0) as number[];
  let section = 0, ordinal = 0, subgroup = '일반 표';
  for (const [lineIndex, line] of bytes.toString('utf8').split(/\r?\n/).entries()) {
    const heading = /^## (\d{2})\. /.exec(line);
    if (heading) { section = Number(heading[1]); ordinal = 0; subgroup = '일반 표'; }
    if (section < 1 || section > 21) continue;
    const subheading = /^### (.+)$/.exec(line);
    if (subheading) subgroup = subheading[1]!;
    const cells = /^\| ([^|]+) \| ([^|]+) \|\s*$/.exec(line);
    if (!cells || cells[1] === '블록명' || /^[-: ]+$/.test(cells[1]!)) continue;
    const id = `${String(section).padStart(2, '0')}-${String(++ordinal).padStart(3, '0')}`;
    rows.set(id, { id, name: cells[1]!.trim(), condition: cells[2]!.trim(), subgroup, line: lineIndex + 1 });
    sectionCounts[section - 1]!++;
  }
  if (rows.size !== 385 || new Set([...rows.values()].map(row => row.name)).size !== 339
    || !expectedSectionCounts.every((count, index) => sectionCounts[index] === count)) fail('Invalid 385-row source inventory');
  return rows;
}
function readCoverage(document: string, source: Map<string, SourceRow>): CoverageRow[] {
  const seen = new Set<string>(), rows: CoverageRow[] = [];
  for (const [lineIndex, line] of document.split(/\r?\n/).entries()) {
    const match = /^\| \[(\d{2}-\d{3})\]\(\.\.\/dataset\/Simulink_Basic_Blocks_R2024b\.md#library-(\d{2})\) \(L(\d+)\) \|/.exec(line);
    if (!match) { if (/^\| \[\d{2}-\d{3}\]/.test(line)) fail('Malformed source link'); continue; }
    const id = match[1]!, original = source.get(id), cells = line.slice(1, -1).split('|').map(cell => cell.trim());
    if (!original || seen.has(id) || cells.length !== 9 || match[2] !== id.slice(0, 2)
      || Number(match[3]) !== original.line || cells[1] !== original.name || cells[2] !== original.subgroup || cells[3] !== original.condition) fail(`Source identity mismatch: ${id}`);
    seen.add(id); rows.push({ id, cells, line: lineIndex });
  }
  if (rows.length !== 385 || seen.size !== source.size) fail('Incomplete 385-row coverage');
  return rows;
}
function readEvidence(value: unknown): Evidence {
  const evidence = record(value, 'evidence');
  const fixtures = evidence.fixtures, failures = evidence.failures, strictModes = evidence.strictTypeScriptModes;
  if (!Array.isArray(fixtures) || fixtures.length < 71 || fixtures.length > 2048
    || !Array.isArray(failures) || failures.length < 1 || failures.length > 2048
    || !Array.isArray(strictModes) || strictModes.length > 3 || !['static', 'discrete', 'continuous'].every(mode => strictModes.includes(mode))) fail('Incomplete fixture/diagnostic/strict TypeScript evidence');
  const fixtureIds = new Set<string>();
  return {
    engineVersion: text(evidence.engineVersion, 'engineVersion'), datasetSha256: text(evidence.datasetSha256, 'datasetSha256'),
    registryCount: nonnegative(evidence.registryCount, 'registryCount'),
    strictTypeScriptModes: strictModes.map(value => text(value, 'strict TypeScript mode')),
    fixtures: fixtures.map((value, index) => {
      const fixture = record(value, `fixture${index}`), id = text(fixture.id, 'fixture id'), blockIds = fixture.blockIds;
      if (fixtureIds.has(id)) fail(`Duplicate fixture id: ${id}`); fixtureIds.add(id);
      if (!Array.isArray(blockIds) || blockIds.length === 0 || blockIds.length > 144) fail(`Invalid fixture blockIds: ${id}`);
      return {
        id, blockIds: blockIds.map(value => text(value, 'block id')),
        maximumAbsoluteError: nonnegative(fixture.maximumAbsoluteError, 'maximumAbsoluteError'), tolerance: nonnegative(fixture.tolerance, 'tolerance'),
        staticVerified: flag(fixture.staticVerified, 'staticVerified'), discreteVerified: flag(fixture.discreteVerified, 'discreteVerified'),
        continuousVerified: flag(fixture.continuousVerified, 'continuousVerified'), independentTSParity: flag(fixture.independentTSParity, 'independentTSParity'),
        jsonRoundtrip: flag(fixture.jsonRoundtrip, 'jsonRoundtrip'),
        ...(fixture.unsupportedStaticVerified === undefined ? {} : { unsupportedStaticVerified: flag(fixture.unsupportedStaticVerified, 'unsupportedStaticVerified') }),
      };
    }),
    failures: failures.map((value, index) => { const item = record(value, `failure${index}`); return { id: text(item.id, 'failure id'), diagnosticVerified: flag(item.diagnosticVerified, 'diagnosticVerified') }; }),
  };
}
function proofValid(fixture: FixtureEvidence, blockId: string): boolean {
  const definition = getBlockDefinition(blockId);
  if (!definition || !fixture.blockIds.includes(blockId) || !fixture.independentTSParity || !fixture.jsonRoundtrip
    || fixture.maximumAbsoluteError > fixture.tolerance) return false;
  const verified = { static: fixture.staticVerified, discrete: fixture.discreteVerified, continuous: fixture.continuousVerified };
  return definition.supportedModes.every(mode => verified[mode])
    && (definition.supportedModes.includes('static') || (!fixture.staticVerified && fixture.unsupportedStaticVerified === true));
}

const args = process.argv.slice(2);
if (args.some(arg => !['--preflight', '--dry-run', '--check'].includes(arg)) || args.length > 1) fail('Use no arguments, --preflight, --dry-run, or --check');
const source = readSource(await readFile(SOURCE_PATH)), original = await readFile(COVERAGE_PATH, 'utf8');
const rows = readCoverage(original, source), baselineIdentity = new Map(rows.map(row => [row.id, row.cells.slice(0, 4).join('|')]));
const newIds: readonly string[] = [...EXPANSION_BLOCK_IDS, ...EXPANDED_TIME_SOURCE_IDS];
if (String(ENGINE_VERSION) !== '0.8.0-catalog' || EXPANSION_BLOCK_IDS.length !== 64 || EXPANDED_TIME_SOURCE_IDS.length !== 6
  || new Set(newIds).size !== 70 || blockRegistry.length !== 144 || new Set(blockRegistry.map(block => block.id)).size !== 144
  || newIds.some(id => !getBlockDefinition(id) || !getBlockDefinition(id)!.exportTargets.includes('typescript'))) fail('Expected 144 registry cards and 64+6 new calculation cards');
for (const [id, approval] of Object.entries(approved)) {
  const row = rows.find(row => row.id === id);
  if (!row || row.cells[1] !== approval.name || !['미구현', APPROVED_STATUS].includes(row.cells[8]!) || approval.blockIds.some(id => !getBlockDefinition(id))) fail(`Refusing source mismatch or status downgrade: ${id}`);
}
if (args.includes('--preflight')) {
  process.stdout.write(JSON.stringify({ sourceRows: 385, uniqueSourceNameStrings: 339, registryCards: 144, newMathCards: 64, newTimeCards: 6, proposedSourceApprovals: Object.keys(approved).length, datasetSha256: DATASET_SHA256, mutated: false }, null, 2) + '\n');
} else {
  if ((await stat(EVIDENCE_PATH)).size > 2 * 1024 * 1024) fail('Evidence exceeds 2MiB limit');
  const evidence = readEvidence(JSON.parse(await readFile(EVIDENCE_PATH, 'utf8')) as unknown);
  if (evidence.engineVersion !== ENGINE_VERSION || evidence.datasetSha256.toLowerCase() !== DATASET_SHA256 || evidence.registryCount !== blockRegistry.length
    || evidence.failures.some(item => !item.diagnosticVerified)) fail('Invalid catalog evidence provenance or diagnostics');
  if (evidence.fixtures.some(fixture => fixture.blockIds.some(id => !getBlockDefinition(id)) || fixture.maximumAbsoluteError > fixture.tolerance
    || !fixture.independentTSParity || !fixture.jsonRoundtrip)) fail('Unverified catalog fixture');
  for (const id of newIds) if (!evidence.fixtures.some(fixture => proofValid(fixture, id))) fail(`Missing all-supported-modes numerical/TS/JSON proof: ${id}`);
  const updatedLines = original.split(/\r?\n/), statuses: Record<string, number> = {};
  for (const row of rows) {
    const approval = approved[row.id], cells = [...row.cells];
    if (approval) {
      for (const id of approval.blockIds) if (!evidence.fixtures.some(fixture => (!approval.fixtureId || fixture.id === approval.fixtureId) && proofValid(fixture, id))) fail(`Missing source-specific proof: ${row.id} / ${id}`);
      cells[4] = `\`${approval.blockIds[0]}\``; cells[8] = APPROVED_STATUS;
      cells[7] = cells[7]!.replace(/; 실제 지원:.*$/, '') + `; 실제 지원: ${approval.boundary}; fixture: catalog-verification`;
    }
    if (row.id === '08-013') cells[7] = cells[7]!.replace(/; catalog 추가:.*$/, '') + '; catalog 추가: 별도 신규 ID의 cbrt/expm1/log1p/log2/exp2/sign/power/mod/remainder/hypot/sinc 검증; 기존 Math Function 5옵션 계약은 유지·새 카드와 공유 unary/binary dispatch 수 구분·원본행 추가 승인0';
    if (row.id === '08-035') cells[7] = cells[7]!.replace(/; catalog 추가:.*$/, '') + '; catalog 추가: 별도 신규 ID sinh/cosh/tanh/asinh/acosh/atanh 및 atan2의 실수 정의역/단위 검증; 기존 Trigonometric 6옵션 계약 유지·원본행 추가 승인0';
    if (cells.slice(0, 4).join('|') !== baselineIdentity.get(row.id)) fail(`Source cells changed: ${row.id}`);
    statuses[cells[8]!] = (statuses[cells[8]!] ?? 0) + 1;
    updatedLines[row.line] = '| ' + cells.join(' | ') + ' |';
  }
  const summary = `- 상태: catalog 수학·신호 확장 구현 기록. 원본385행 중 catalog 승인 subset ${statuses[APPROVED_STATUS]}행, M5 승인 subset ${statuses['M5 승인 subset']}행, M5 독립 대체 subset ${statuses['M5 독립 대체 subset']}행, M4 승인 subset ${statuses['M4 승인 subset']}행, M3 승인 subset ${statuses['M3 승인 subset']}행, M2 승인 subset ${statuses['M2 승인 subset']}행, M1 정적 subset ${statuses['M1 정적 subset']}행, preset ${statuses['M1 preset subset']}행, AST 독립 대체 ${statuses['M1 AST 독립 대체 subset']}행, 미구현 ${statuses['미구현']}행이다. registry 144항목(기존74+수학64+시간파형6)과 원본행 승인 수는 다르며 alias/preset·공유 수치 kernel을 독립 엔진으로 합산하지 않는다. 실제 경계는 아래 행별 설명과 [수치 증거](evidence/catalog-verification.json)를 따른다. 전체 옵션·Simulink 동등성을 뜻하지 않는다.`;
  const note = '### 수학·신호 catalog에서 확인한 범위\n\n기존74 registry에 서로 다른 수식·집계·벡터/행렬 변환의 수학64카드와 시간파형6카드를 추가해144항목이다. 공유 unary/binary/집계/행렬 dispatch를 재사용하므로144개 독립 수치 엔진을 구현했다는 뜻은 아니다. 신규 표시카드70개·원자료 신규 승인19행·기존 Divide 대응 누락 교정1행은 각각 다른 수치다. 원자료385행·339개 이름 문자열·R2024b 조건·원본 digest는 보존한다. 후보65개를 모두 구현 완료로 바꾸지 않으며 실제 선택 목록은 [확장 조사와 구현 기록](block-expansion-plan.md)을 따른다.\n\n승인20행은 source별 수학/형상/단위 subset과 지원 모드의 해석식 oracle·JSON 왕복·독립 TS parity 증거가 있는 경우에 한한다. Math Function과 Trigonometric의 기존 승인 상태는 유지하며 별도 신규 함수 ID를 추가 설명한다. Divide는 기존 math.multiply(operation=divide)의 세 모드 독립 oracle을 확인한 추적 교정으로 신규 계산카드 수를 늘리지 않는다. Chirp는 seconds/Hz 선형 sweep와 위상 연속성을 확인하며 static을 거부한다. 나머지 시간파형5종은 CalcWeave 추가 기능이며 원자료 승인행 수에 합산하지 않는다.\n\n실수/boolean scalar·1D·2D의 명시 subset이며 complex/f32/일반fixed/n-D·동적 index/경계·일반DAE·외부 MATLAB/C/ABI·hardware·message/조건부 그래프는 이번 승인에 포함하지 않는다. 신규70카드 exportTargets는 TypeScript만 승인한다. 새 비선형/구간 연산의 continuous 지원은 RK stage에서 값 평가하는 범위다. 시간에 따라 바뀌는 Sign/mod/remainder/Quantizer/predicate/boolean 집계가 직접 ODE 상태 입력으로 이어지는 경로는 UNREGISTERED_DISCONTINUITY로 거부한다. Zero Order Hold의 승인 이산 경계 또는 등록된 Step/Relay/Hit Crossing 사건을 사용해야 한다. Dead Zone의 꺾임을 포함한 새 경계의 zero-crossing event 탐지·경계 시각 정지와 solver 오차 보장은 별도 검증 전까지 승인하지 않는다.\n\n';
  let document = updatedLines.join('\n').replace(/^- 문서 버전: .+$/m, '- 문서 버전: v0.9').replace(/^- 상태: .+$/m, summary);
  document = document.replace('따라서 아래 원자료 385행의 M5 수학 구현 상태·미구현 271행은 그대로 유지한다.', '이 M7 export 작업 자체는 원자료 수학 구현 상태를 변경하지 않았다. 이후 수학·신호 catalog 승격은 별도의 아래 기록과 증거를 따른다.');
  if (document.includes('### 수학·신호 catalog에서 확인한 범위')) document = document.replace(/### 수학·신호 catalog에서 확인한 범위\n[\s\S]*?(?=## 3\. 수록 행 수와 계획 결정 집계)/, note);
  else document = document.replace('## 3. 수록 행 수와 계획 결정 집계', note + '## 3. 수록 행 수와 계획 결정 집계');
  const updatedRows = readCoverage(document, source);
  if (updatedRows.some(row => row.cells.slice(0, 4).join('|') !== baselineIdentity.get(row.id)) || statuses[APPROVED_STATUS] !== 20 || statuses['미구현'] !== 251
    || Object.values(statuses).reduce((sum, count) => sum + count, 0) !== 385) fail('Unexpected source status/identity conservation');
  if (args.includes('--check') && original !== document) fail('Coverage document differs from verified catalog update');
  if (!args.length) await writeFile(COVERAGE_PATH, document);
  process.stdout.write(JSON.stringify({ sourceRows: 385, uniqueSourceNameStrings: 339, registryCards: 144, newMathCards: 64, newTimeCards: 6,
    catalogSourceRows: 20, newSourceApprovals: 19, existingDivideTraceCorrection: 1, statuses, datasetSha256: DATASET_SHA256, mutated: args.length === 0 }, null, 2) + '\n');
}
