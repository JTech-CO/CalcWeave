import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { blockRegistry } from '../packages/block-library/src';
import { ENGINE_VERSION } from '../packages/model/src';

const sourcePath = 'dataset/Simulink_Basic_Blocks_R2024b.md';
// Freeze the planning baseline; implemented stage progress is recorded separately.
const coveragePath = 'docs/baselines/catalog-block-coverage.md';
const registryBaselinePath = 'docs/baselines/catalog-registry.json';
const jsonPath = 'docs/simulink-coverage-roadmap.json';
const datasetSha256 = 'cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7';
const sectionCounts = [23, 16, 37, 14, 21, 22, 9, 38, 19, 8, 11, 5, 29, 14, 27, 11, 27, 16, 15, 9, 14];
const sectionNames = ['Commonly Used Blocks', 'Continuous', 'Dashboard', 'Discontinuities', 'Discrete', 'Logic and Bit Operations', 'Lookup Tables', 'Math Operations', 'Matrix Operations', 'Messages & Events', 'Model Verification', 'Model-Wide Utilities', 'Ports & Subsystems', 'Signal Attributes', 'Signal Routing', 'Sinks', 'Sources', 'String', 'User-Defined Functions', 'Additional Math & Discrete', 'Quick Insert'];
type StageId = 'M8' | 'M9' | 'M10' | 'M11' | 'M12' | 'M13' | 'M14' | 'M15' | 'M16';
type Priority = 'P0' | 'P1' | 'P2';
interface Milestone { id: StageId; title: string; priority: Priority; dependsOn: StageId[]; contracts: string[]; fixtures: string[]; exitGates: string[] }
const milestones: Milestone[] = [
  { id: 'M8', title: '수학·신호와 배열 조작의 잔여 기능', priority: 'P0', dependsOn: [], contracts: ['R2024b 파라미터/대체 구성 inventory·원본 ID별 옵션 행렬', '동적 경계·index·axis·빈 결과·broadcasting·수치 정의역·오류 계약', 'lookup 차원/축/보간/외삽·정적 수식 AST·순수 함수와 waveform 입력 바인딩'], fixtures: ['Assignment·Find Nonzero·Permute·Squeeze·구조 검사·동적 selector의 독립 배열 oracle', 'dynamic interval/dead-zone/saturation·friction·wrap equality·sine function 입력 시각', 'n-D lookup corners/knots·빈 배열·index 오류·영 제수·overflow·유닛'], exitGates: ['최초 P0 누락 계산을 compiler/runtime/TS/검색·설정 UI로 연결', '모든 선언 지원 mode/shape/옵션에 독립 oracle와 원본 노드 진단', '현재144 정의/71 catalog fixture 회귀·새 schema가 필요하면 원본 보존 migration'] },
  { id: 'M9', title: 'DSP·이산 상태·샘플시간', priority: 'P0', dependsOn: ['M8'], contracts: ['read-before-write·rate 추론·offset·reset/enable·상태 소유권', '시간변화 계수·가변/탭/전파 지연·DF1/DF2·2DOF PID·zero-pole realization', 'noise PSD·seed/stream·counter wrap·sample-time math·초기/마지막 tick'], fixtures: ['impulse/step 및 z-domain 기준·동적 filter 계수 교체·모든 초기화', 'harmonic/nonharmonic rate·동시due·pause/resume/cancel·노드 순서 독립', 'noise 통계와 정확한 draw 소비·가변 지연 bounds·마지막 stateMemory'], exitGates: ['각 상태 primitive의 초기/output/commit/reset 규약 및 rate 제한 공개', '시간 실행·JSON·독립 TS/Python의 승인 subset parity', '메모리·스텝·연산 예산·실패 partial·연속 hold 경계 회귀'] },
  { id: 'M10', title: '자료형·복소수·고정소수점·n-D', priority: 'P0', dependsOn: ['M8', 'M9'], contracts: ['float32 rounding·signed/unsigned 정수·int64/BigInt·cast/propagation/strip', 'complex 표현·켤레/위상/branch cut·다형 신호와 일반 n-D shape/axis', 'fixed-point word/scale/overflow/rounding·stored integer·enum/string 기초·Inf/NaN 명시 정책'], fixtures: ['독립 bit-pattern/BigInt oracle·tie/overflow/underflow·signed zero·NaN 정책', 'complex dot/Hermitian·방위/branch cut·type conversion 모든 조합', 'fixed lookup sin/cos·n-D rank/axis·직렬화/unknown dtype/migration'], exitGates: ['float64 치환과 실제 typed/bit-true 파이프라인을 지원표에서 분리', 'compiler/runtime/저장/TS 및 타깃별 dtype 지원을 함께 변경', '지원하지 않는 차원/자료형/특수값은 무손실 보관·명시 진단, 조용한 cast 금지'] },
  { id: 'M11', title: '조건·반복·메시지·계층 실행', priority: 'P1', dependsOn: ['M10'], contracts: ['Enabled/Triggered/Resettable/Action/Function-Call/Atomic·state scope와 reset', 'For/While/For Each/array-neighborhood-pixel·iteration/경계/break/예산', 'message typed bounded queue·동시 event·Merge·Goto/Data Store/State Writer·variant 선택'], fixtures: ['동등하게 펼친 모델과 계층 실행·다중 인스턴스·비활성 상태 유지', 'nested loop·0회/최대 iteration·overflow queue·동시 writer·함수 lifecycle', '같은 시각 call/trigger/reset/message 순서·recursive reference·variant 오류'], exitGates: ['신호·message·entity 및 UI 그룹·실행 계층의 의미를 각각 명시', 'control-port 내부 계약도 원본 source ID와 함께 fixture로 추적', '독립 target parity·상태/시간/예산·실패 부분 기록이 계층 경로를 보존'] },
  { id: 'M12', title: '연속 solver·사건·DAE와 분석', priority: 'P1', dependsOn: ['M9', 'M10', 'M11'], contracts: ['새 불연속 guard/zero crossing·chattering/hysteresis·지연/history/Memory', '강성 solver·algebraic loop·지원 index-1 DAE·Descriptor E·초기 일관성', '수치 Jacobian/국소 선형화·gradient/resolution 검증·operating point·허용오차'], fixtures: ['해석 ODE/DAE·독립 solver·stiff reference·비특이/특이 E 구분', 'event 시각/동시 reset·missed crossing·adaptive rejection·가변 지연', '잔차·condition·수렴 실패·불연속 loop 거부·Jacobians finite-difference 비교'], exitGates: ['지원 solver/DAE 형태·자료형·차수·event 제한을 목록으로 공개', '무수렴·초기 불일치·강성 실패는 원인/잔차/마지막 유효 상태로 중단', '일반 DAE/모든 Simulink solver/자동 PID tuning 동등성은 별도 증거 전 주장 금지'] },
  { id: 'M13', title: 'IO·Dashboard·문자열·데이터 작업', priority: 'P1', dependsOn: ['M10', 'M11'], contracts: ['Dashboard와 Sinks 동명 항목·Customizable appearance·callback allowlist·live 적용 tick', 'XY/Floating Scope·record/stop·dataset/waveform/scenario 편집·CSV/XLSX 파일 제한', 'Unicode/ASCII·substring/index·parse/format/enum·named dataset·unit/probe/지원표 UI'], fixtures: ['Dashboard 조작 event log 재생·현재/이전 결과·큰 데이터 원시값 보존', '동명 Display·gauge variant·keyboard/IME·320px/확대·theme·실제 초보 과제', '문자열 encoding/정밀도/invalid parse·파일 크기/수식 cell 보호·명시 권한/복구'], exitGates: ['수치 엔진·표시 variant·독립 workflow·MATLAB workspace 의미를 분리', '모든 일반/Customizable source 행의 설정·바인딩 차이를 개별 확인', '실제 사용성·접근성 관찰과 데이터 provenance/보존/복구 증거'] },
  { id: 'M14', title: '외부 어댑터·권리·라이선스 경계', priority: 'P2', dependsOn: ['M10', 'M11', 'M13'], contracts: ['C/C++/MATLAB/System object/S-function·ABI·callback lifecycle·외부 dependency', 'browser WASM 또는 명시 선택 local/remote adapter·격리·자원·권한·취소', '원본/사용자 코드/재배포/타깃별 권리·제품 필요조건·버전·provenance 확인'], fixtures: ['허용 ABI/port/dtype·lifecycle·원본 환경 fixture 비교·adapter unavailable', '서명만으로 코드 신뢰하지 않음·시간/메모리/네트워크 경계·실패 복구', 'Entity Transport Delay의 엔터티와 신호 구분·legacy 수동 전환 사례'], exitGates: ['허용 adapter별 계약/권리/환경/보안/수치 증거가 모두 확보될 때만 실행 승인', '외부 프로그램 없는 native 기본 경로 유지·자동 MATLAB/C 실행 금지', '불가능/미허가/미검증 adapter는 설명된 미지원으로 남기며 지원 완료로 합산 금지'] },
  { id: 'M15', title: '상호운용 형식과 추가 코드 타깃', priority: 'P1', dependsOn: ['M12', 'M13', 'M14'], contracts: ['native JSON/cwpack 확장 migration·MAT/SLX/MDL 적법 parser·기능/옵션 변환 보고', 'Python 확장·C/C++/WASM 선택 타깃·메모리/dtype/solver/ABI·빌드 재현', '미지원 노드/옵션/target의 원본 위치·부분 변환/왕복 손실·dependency manifest'], fixtures: ['모든 승인 row 옵션의 독립 생성 프로그램·실제 target 실행·manifest parity', '원본/변환후/재가져오기 모델의 parameter/state/event/단위 비교', 'unknown node/type·외부 reference·미지원 target·악성/초과 파일·권리 제한'], exitGates: ['파일 파싱 성공·계산 지원·수치 parity·무손실 왕복을 각각 보고', '코드 파일 생성만으로 승인하지 않고 실제 실행/독립 oracle 증거 확보', '하드웨어/HDL 인증과 무제한 Simulink/Coder 동등성을 자동 주장하지 않음'] },
  { id: 'M16', title: '385행 전체 옵션 추적·회귀·공개 지원 QA', priority: 'P0', dependsOn: ['M8', 'M9', 'M10', 'M11', 'M12', 'M13', 'M14', 'M15'], contracts: ['source ID별 R2024b 옵션/자료형/mode/target/조건의 전수 지원 행렬', 'canonical/preset/독립 대체/adapter/legacy의 증거와 별도 집계', '공개 지원표·대표 사용자 과제·성능/접근성/저장·배포 및 원본 대조'], fixtures: ['385행 identity·251 미구현의 누락0·기존134 subset의 미검증 옵션 목록', '분류 간 동명/다른 의미·preset 설정·타깃별 regression·공식/원본 실행 대조', '전체 승인 기능의 예산/취소/실패·browser/OS·업데이트/migration·release hash'], exitGates: ['각 source 행의 결정과 옵션별 증거/미지원 이유·owner·검증 버전이 빠짐없이 있음', '추적 완료/의도적 제외와 검증된 실행·완전 옵션 대응률을 서로 다른 지표로 공개', '필수 옵션에 미지원/미검증이 남으면 전체 실행 동등 완료라고 표시하지 않음; 외부 출시 gate 별도'] },
];
const order = new Map(milestones.map((stage, index) => [stage.id, index]));
interface SourceRow { id: string; section: number; ordinal: number; name: string; subgroup: string; condition: string; line: number }
interface BaselineRow extends SourceRow { canonical: string; planningSupport: string; originalPlannedMilestone: string; boundary: string; currentStatus: string }
interface PlannedRow extends BaselineRow {
  existingSubset: boolean; deliveryKind: 'native-capability' | 'shared-configuration' | 'independent-workflow' | 'native-research' | 'adapter-gated' | 'legacy-reference';
  firstWorkMilestone: StageId; optionCompletionMilestones: StageId[]; priority: Priority; rationale: string;
  remainingScope: string[]; requiredContracts: string[]; minimumFixtures: string[];
  parameterInventoryStatus: string; roadmapStatus: string; executionEquivalenceClaimed: false;
}
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = await readFile(sourcePath), coverageBytes = await readFile(coveragePath);
assert.equal(digest(sourceBytes), datasetSha256, 'Reference dataset changed');
const source = new Map<string, SourceRow>(), perSection = Array(21).fill(0) as number[];
let section = 0, ordinal = 0, subgroup = '일반 표';
for (const [index, line] of sourceBytes.toString('utf8').split(/\r?\n/).entries()) {
  const heading = /^## (\d{2})\. /.exec(line); if (heading) { section = Number(heading[1]); ordinal = 0; subgroup = '일반 표'; }
  if (section < 1 || section > 21) continue;
  const subheading = /^### (.+)$/.exec(line); if (subheading) subgroup = subheading[1]!;
  const cells = /^\| ([^|]+) \| ([^|]+) \|\s*$/.exec(line);
  if (!cells || cells[1] === '블록명' || /^[-: ]+$/.test(cells[1]!)) continue;
  const id = `${String(section).padStart(2, '0')}-${String(++ordinal).padStart(3, '0')}`;
  source.set(id, { id, section, ordinal, name: cells[1]!.trim(), subgroup, condition: cells[2]!.trim(), line: index + 1 }); perSection[section - 1]!++;
}
assert.equal(source.size, 385); assert.equal(new Set([...source.values()].map(row => row.name)).size, 339); assert.deepEqual(perSection, sectionCounts);
const baseline: BaselineRow[] = [], seen = new Set<string>();
for (const line of coverageBytes.toString('utf8').split(/\r?\n/)) {
  const match = /^\| \[(\d{2}-\d{3})\]\([^)]*#library-(\d{2})\) \(L(\d+)\) \|/.exec(line); if (!match) continue;
  const original = source.get(match[1]!), cells = line.slice(1, -1).split('|').map(cell => cell.trim());
  assert(original && !seen.has(original.id) && cells.length === 9, `Coverage identity: ${match[1]}`);
  assert.equal(match[2], original.id.slice(0, 2)); assert.equal(Number(match[3]), original.line);
  assert.deepEqual(cells.slice(1, 4), [original.name, original.subgroup, original.condition]); seen.add(original.id);
  baseline.push({ ...original, canonical: cells[4]!.replace(/^`|`$/g, ''), planningSupport: cells[5]!, originalPlannedMilestone: cells[6]!, boundary: cells[7]!, currentStatus: cells[8]! });
}
assert.equal(baseline.length, 385); assert.equal(baseline.filter(row => row.currentStatus === '미구현').length, 251);
const count = <T>(rows: T[], key: (row: T) => string): Record<string, number> => rows.reduce((counts, row) => { const id = key(row); counts[id] = (counts[id] ?? 0) + 1; return counts; }, {} as Record<string, number>);

function assign(row: BaselineRow): StageId {
  const { section: s, name: n, canonical: c } = row;
  if (/레거시/.test(row.condition) || c.startsWith('adapter.')) return 'M14';
  if (/Algebraic Constraint|Descriptor State-Space/.test(n)) return 'M12';
  if (n === 'Memory' || n === 'Integrator' || /^continuous\./.test(c)) return 'M12';
  if (/Complex|Hermitian|Enumerated|Stored Integer|Fixed-Point|Float Extract Bits/.test(n)
    || /Data Type|Scaling Strip|Signal Conversion|Signal Specification|Bus to Vector|Unit System Configuration|Unit Conversion|Width/.test(n)
    || /^(Bit |Bitwise|Bit to |Integer to |Extract Bits|Shift Arithmetic)/.test(n)
    || (s === 7 && /^(Sine|Cosine)$/.test(n)) || (s === 21 && /^(Inf|NaN|Negative Inf|Signal Copy|To Virtual Bus|To Nonvirtual Bus)$/.test(n))) return 'M10';
  if (c === 'model.support-catalog') return 'M13';
  if (/linearization/.test(c) || s === 2 || /Backlash|Hit Crossing|Rate Limiter|^Relay$/.test(n)) return 'M12';
  if (s === 3 || s === 18 || /^(Slider Gain|Probe|DocBlock|Model Info)$/.test(n)) return 'M13';
  if (/^(Inport|Outport|In Bus Element|Out Bus Element|Subsystem|Atomic Subsystem|Model|Bus Creator|Bus Selector)$/.test(n)) return 'M11';
  if (/^(Scope|Display|Terminator)$/.test(n)) return 'M13';
  if (s === 10 || s === 13 || /Processing Subsystem/.test(n) || /^(functions\.|hierarchy\.|events\.)/.test(c)) return 'M11';
  if (s === 19) return n === 'Fcn' ? 'M8' : 'M11';
  if (s === 5 || /^discrete\./.test(c) || /^(Discrete-Time Integrator|Delay|Unit Delay|Rate Transition|IC|Propagation Delay|MinMax Running Resettable|Weighted Sample Time|Weighted Sample Time Math)$/.test(n)
    || /^Detect /.test(n) || /^(PWM|Variable Pulse Generator)$/.test(n) || (s === 11 && /Gradient|Resolution/.test(n))) return 'M9';
  if (s === 15 && !/^(Demux|Index Vector|Mux|Selector|Vector Concatenate|Switch|Multiport Switch|Manual Switch)$/.test(n)) return 'M11';
  if (s === 16) return 'M13';
  if (s === 17) return /^(Constant|Ground)$/.test(n) ? 'M8' : /File|Spreadsheet|Workspace|Playback|Signal Editor|Waveform Generator/.test(n) ? 'M13' : 'M9';
  if (s === 20) return /Transfer Fcn|Time To Zero/.test(n) ? 'M9' : 'M8';
  return 'M8';
}
function plan(row: BaselineRow): PlannedRow {
  const primary = assign(row), stage = milestones.find(stage => stage.id === primary)!;
  const legacy = /레거시/.test(row.condition), adapter = row.canonical.startsWith('adapter.');
  const deliveryKind = legacy ? 'legacy-reference' : adapter ? 'adapter-gated' : /Algebraic Constraint/.test(row.name) ? 'native-research'
    : row.planningSupport === '독립 대체' ? 'independent-workflow' : row.planningSupport === '구성' ? 'shared-configuration' : 'native-capability';
  const work = new Set<StageId>([primary, 'M16']);
  if (order.get(primary)! < order.get('M10')!) work.add('M10');
  if (row.section === 4 || /^Sign$|Sine Wave|Chirp|Interval|Rate Limiter|Saturation|Delay|Integrator|PID|Clock|Sample Time|^State Reader$|^State Writer$/.test(row.name)) work.add('M12');
  if (/File|Workspace|Spreadsheet|Model$|Subsystem Reference/.test(row.name) || /MATLAB|callback|ABI|linmod/.test(row.boundary)) work.add('M14');
  if (primary !== 'M16' && deliveryKind !== 'legacy-reference') work.add('M15');
  const existingSubset = row.currentStatus !== '미구현';
  return { ...row, existingSubset, deliveryKind, firstWorkMilestone: primary,
    optionCompletionMilestones: [...work].filter(id => order.get(id)! >= order.get(primary)!).sort((a, b) => order.get(a)! - order.get(b)!), priority: stage.priority,
    rationale: `${stage.title}의 실행 의미에 배정; ${row.planningSupport} 계획을 유지하고 ${existingSubset ? '현재 subset 밖의 옵션과 타깃을 재검증' : '미구현 source의 최초 계약/구현부터 착수'}`,
    remainingScope: [`원본 ${row.name}의 R2024b 파라미터·자료형·shape·sample-time·mode·target/버전 조건 inventory`,
      `현재 제한/계획에서 남은 항목을 옵션별로 판정: ${row.boundary}`,
      deliveryKind === 'shared-configuration' ? '공유 canonical의 설정/별칭/preset을 원본행별로 재현·fixture 확인; 새 엔진으로 중복 합산하지 않음'
        : deliveryKind === 'adapter-gated' ? '원본 환경·권리·dependency·ABI·격리·타깃 증거 전 실행 미지원; 독립 구현과 외부 원본 실행을 구분'
        : deliveryKind === 'legacy-reference' ? '신규 기본 추천에서 제외·설명/수동 이전을 우선; legacy 실행 동등성은 별도 adapter 승인 전 미지원'
        : deliveryKind === 'independent-workflow' ? 'CalcWeave 자체 목적 대체와 원본 UI/언어/파일/런타임의 차이를 옵션별로 공개'
        : deliveryKind === 'native-research' ? '수렴/잔차/초기값·불연속/미수렴 진단을 연구; spike 성공을 일반 DAE 지원으로 확대하지 않음'
        : '독립 native 구현·입력/상태/시간/오류·자원 경계의 검증된 옵션만 승인'],
    requiredContracts: [`${primary}-parameter-inventory`, `${primary}-execution-contract`, 'M15-target-support-matrix', 'M16-source-option-evidence'],
    minimumFixtures: [`R-${row.id}-parameter-shape-domain`, `R-${row.id}-state-time-error`, `R-${row.id}-target-roundtrip-or-explicit-rejection`],
    parameterInventoryStatus: 'R2024b 전체 옵션 전수 사양·fixture inventory 미완료; 이름/조건 표를 옵션 사양으로 간주하지 않음',
    roadmapStatus: '후속 계획·구현/완료 지원 주장 아님', executionEquivalenceClaimed: false };
}
const planned = baseline.map(plan);
const stageCounts = (rows: PlannedRow[]): Record<StageId, number> => Object.fromEntries(milestones.map(stage => [stage.id, rows.filter(row => row.firstWorkMilestone === stage.id).length])) as Record<StageId, number>;
const document = {
  schemaVersion: 1, documentVersion: '0.1', date: '2026-10-03', title: 'CalcWeave Simulink 기본 라이브러리 전체 대응 후속 로드맵',
  planOnly: true, fullSimulinkEquivalenceClaimed: false, calendarCommitment: null,
  baseline: { engineVersion: '0.8.0-catalog', registryDefinitions: 144, sourcePath, coveragePath, datasetSha256,
    coverageSha256: digest(coverageBytes), sourceRows: 385, uniqueSourceNameStrings: 339, existingSubsetRows: 134, unimplementedRows: 251,
    statuses: count(baseline, row => row.currentStatus), sectionCounts },
  scope: ['01~21절의385행만 배정; 21절 파라미터 옵션표·22~25 보조 항목은 합산 제외',
    '전체 Simulink 및 별도 toolbox/설치판 전체 목록의 전수성을 주장하지 않음; R2024b curated reference corpus 기준',
    '모든134 기존subset에도 남은 옵션/자료형/실행/타깃 stage 지정; 현재 승인 status는 변경하지 않음',
    '문서행·339이름 문자열·144registry·공유kernel·preset·대체/adapter의 수를 별도 지표로 관리'],
  allowedFinalDecisions: ['verified-native-scope', 'verified-shared-configuration', 'verified-independent-alternative', 'verified-conditional-adapter', 'documented-unsupported', 'documented-legacy'],
  milestones, assignmentCounts: stageCounts(planned), unimplementedAssignmentCounts: stageCounts(planned.filter(row => !row.existingSubset)), rows: planned,
};

// The planning JSON and baseline are immutable historical inputs.
assert.equal(process.argv.slice(2).length, 0, 'This verifier is read-only; no regeneration arguments are accepted');
const actual = JSON.parse(await readFile(jsonPath, 'utf8')) as typeof document;
assert.deepEqual(actual, document, 'Roadmap differs from preserved planning source/coverage or deterministic stage mapping; review then explicitly regenerate');
assert.equal(actual.planOnly, true); assert.equal(actual.fullSimulinkEquivalenceClaimed, false); assert.equal(actual.calendarCommitment, null);
assert.equal(actual.rows.length, 385); assert.equal(new Set(actual.rows.map(row => row.id)).size, 385);
assert.equal(actual.rows.filter(row => !row.existingSubset).length, 251); assert.equal(actual.rows.filter(row => row.existingSubset).length, 134);
assert.equal(Object.values(actual.assignmentCounts).reduce((sum, count) => sum + count, 0), 385);
assert.equal(Object.values(actual.unimplementedAssignmentCounts).reduce((sum, count) => sum + count, 0), 251);
assert(Object.keys(actual.assignmentCounts).every(id => order.has(id as StageId)), 'Unknown assignment summary stage');
assert(Object.keys(actual.unimplementedAssignmentCounts).every(id => order.has(id as StageId)), 'Unknown unimplemented summary stage');
const registryBaseline = JSON.parse(await readFile(registryBaselinePath, 'utf8')) as { engineVersion: string; registryDefinitions: number; definitions: unknown[] };
assert.equal(registryBaseline.engineVersion, '0.8.0-catalog'); assert.equal(registryBaseline.registryDefinitions, 144); assert.equal(registryBaseline.definitions.length, 144);
for (const definition of registryBaseline.definitions) { const original = definition as { id: string }; assert.deepEqual(blockRegistry.find(block => block.id === original.id), definition, `Catalog contract changed: ${original.id}`); }
assert(blockRegistry.length >= 144 && new Set(blockRegistry.map(block => block.id)).size === blockRegistry.length, 'Current registry must retain the unique catalog definitions');
for (const stage of milestones) for (const dependency of stage.dependsOn) assert(order.has(dependency) && order.get(dependency)! < order.get(stage.id)!, `Invalid stage dependency: ${stage.id}/${dependency}`);
for (const row of actual.rows) {
  assert(order.has(row.firstWorkMilestone), `Unknown first stage: ${row.id}`);
  assert.equal(new Set(row.optionCompletionMilestones).size, row.optionCompletionMilestones.length, `Duplicate followup stage: ${row.id}`);
  assert(row.optionCompletionMilestones.every(id => order.has(id) && order.get(id)! >= order.get(row.firstWorkMilestone)!), `Unknown or preceding followup stage: ${row.id}`);
  assert(row.optionCompletionMilestones.includes(row.firstWorkMilestone) && row.optionCompletionMilestones.includes('M16'));
  assert(row.remainingScope.length >= 3 && row.minimumFixtures.length >= 3 && row.requiredContracts.length >= 3 && row.parameterInventoryStatus && !row.executionEquivalenceClaimed);
  if (row.existingSubset) assert(row.optionCompletionMilestones.length >= 2, `Existing subset lacks full-option followup: ${row.id}`);
}
assert.equal(digest(await readFile(sourcePath)), datasetSha256, 'Source mutated');
assert.equal(digest(await readFile(coveragePath)), digest(coverageBytes), 'Coverage mutated');
process.stdout.write(JSON.stringify({ sourceRows: 385, uniqueNameStrings: 339, existingSubsetRows: 134, unimplementedRows: 251,
  trackedRows: actual.rows.length, duplicateIds: 0, missingUnimplementedRows: 0, baselineRegistryDefinitions: 144, currentRegistryDefinitions: blockRegistry.length, currentEngineVersion: ENGINE_VERSION,
  milestones: milestones.map(stage => stage.id), firstWorkAssignments: actual.assignmentCounts, unimplementedAssignments: actual.unimplementedAssignmentCounts,
  deliveryKinds: count(actual.rows, row => row.deliveryKind), datasetSha256, sourceAndCoverageUnchanged: true, planOnly: true }, null, 2) + '\n');
