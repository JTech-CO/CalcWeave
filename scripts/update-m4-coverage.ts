import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getBlockDefinition } from '../packages/block-library/src';

interface FixtureEvidence {
  id: string; maximumAbsoluteError: number; tolerance: number;
  jsonRoundtrip: boolean; nodeOrderIndependent: boolean; independentTSParity: boolean;
  immutableResults: boolean; manifestParity: boolean; handBuiltFlatParity: boolean;
}
interface VerificationEvidence {
  engineVersion: string; registry: { total: number }; datasetSha256: string;
  strictIndependentTypecheck: boolean; strictIndependentModes: string[];
  fixtures: FixtureEvidence[]; failures: { diagnosticVerified: boolean }[]; importFailureAtomicity: boolean;
  experiments: { runs: { independentTSParity: boolean }[]; repeatedHashes: boolean; originalModelPreserved: boolean; comparison: { status: string }; sharedRecordBudget: { code: string }; sharedOperationBudget: { code: string }; cancellation: { status: string; preservedRuns: number } };
}
type ApprovedRow = { name: string; id: string; boundary: string; widget?: true };
const busCreate = '동일 float64 또는 boolean·동일 단위의 scalar 두 개를 이름 있는 vector로 묶음; 최대 64자 고유 필드·IR fields 메타데이터; 이종/중첩/객체/generic bus 제외';
const busSelect = '이름 있는 동종 scalar 두 필드 중 한 필드를 이름으로 선택·타입/단위 보존; Mux/Demux만으로 bus를 추정하지 않음; 이종/중첩/generic bus 제외';
const subsystem = '프로젝트 내 버전 정의·투명 IO 포트 각 8개·깊이 8·독립 인스턴스 상태/rate/reset·경로/정의 SHA-256·명시 버전 갱신·선택 묶기/하위 편집; 조건부/atomic 실행·외부 파일 reference 제외';
const playback = '사용자 선택 CSV/행 객체 JSON을 검증·정리 후 프로젝트에 보관; 명시 시간/열/단위·숫자 linear/previous 및 boolean previous 재생·범위 밖 hold/zero/error·원본/내용 SHA-256; 2 MiB·4,000행·16열·20,000셀·8 dataset·문자열 보관만; MAT/XLSX/MATLAB 변수·문자열 실행·반복 재생 제외';
// Exact source row identities prevent a shared capability from promoting unrelated presets.
const approved: Record<string, ApprovedRow> = {
  '01-001': { name: 'Bus Creator', id: 'route.bus-create', boundary: busCreate },
  '01-002': { name: 'Bus Selector', id: 'route.bus-select', boundary: busSelect },
  '01-019': { name: 'Subsystem', id: 'hierarchy.subsystem', boundary: subsystem },
  '03-004': { name: 'Dashboard Scope', id: 'dashboard.scope', widget: true, boundary: '최종 실행에 기록된 root scalar float64 출력의 시간 그래프 바인딩·같은 원시 표본 재사용·이전 실행 표시; live streaming/임의 내부 신호 viewer 제외' },
  '03-005': { name: 'Display', id: 'dashboard.readout', widget: true, boundary: '최종 실행의 root scalar float64 출력 값에 바인딩·stale 표시; 별도 sink.display와 구분; 사용자화 appearance 제외' },
  '03-007': { name: 'Gauge', id: 'dashboard.gauge', widget: true, boundary: 'root scalar float64 최종 출력의 min/max meter 표시·stale 상태; 원형/각도/반원/사용자화 appearance preset 제외' },
  '03-018': { name: 'Slider', id: 'dashboard.slider', widget: true, boundary: 'root scalar Constant/Input.value 또는 Gain.gain의 유한 범위·양의 step 슬라이더·모델에 저장 후 다음 실행부터 반영; 실행 중 scheduler 값 변경/사용자화 appearance 제외' },
  '03-020': { name: 'Toggle Switch', id: 'dashboard.toggle-switch', widget: true, boundary: 'root boolean Constant/Input.value 토글·모델에 저장 후 다음 실행부터 반영; 임의 신호 강제 변경/사용자화 appearance 제외' },
  '08-029': { name: 'Slider Gain', id: 'math.gain', boundary: 'scalar Gain.gain을 대시보드 slider에 바인딩·범위/step 검증·다음 실행 적용; 기존 typed Gain kernel 재사용·실행 중 배율 변경 제외' },
  '12-002': { name: 'DocBlock', id: 'annotation.note', boundary: '모델 notes와 도식 메모의 일반 텍스트 최대 2,000자·React escaping·JSON 보관·수치/상태/실행 hash 불변; HTML/Markdown 실행·문서 검색·외부 편집기 제외' },
  '12-003': { name: 'Model Info', id: 'annotation.model-info', boundary: '작업 공간에서 모델 이름/ID·블럭/연결/데이터/하위 정의 수·실행 방식 표시·annotation에 계산 포트 없음·실행 hash 불변; 원본 외부 도구/전체 metadata 템플릿 제외' },
  '13-021': { name: 'Subsystem', id: 'hierarchy.subsystem', boundary: subsystem },
  '14-012': { name: 'Unit Conversion', id: 'unit.convert', boundary: '승인 27개 단위의 명시 차원 호환·scale/offset 변환·numeric scalar/vector/2D·cm/mm/km, ms/min, g, mV, C/K, deg/rad 포함; 제한 차원 곱/나눗셈·면적만·자동/사용자 정의 단위 제외' },
  '15-002': { name: 'Bus Creator', id: 'route.bus-create', boundary: busCreate },
  '15-003': { name: 'Bus Selector', id: 'route.bus-select', boundary: busSelect },
  '17-009': { name: 'From File', id: 'source.dataset', boundary: playback },
  '17-011': { name: 'From Workspace', id: 'source.dataset', boundary: playback },
  '17-015': { name: 'Playback', id: 'source.dataset', boundary: playback },
};

const evidence = JSON.parse(await readFile('docs/evidence/m4-verification.json', 'utf8')) as VerificationEvidence;
const sourceBytes = await readFile('dataset/Simulink_Basic_Blocks_R2024b.md');
const datasetHash = createHash('sha256').update(sourceBytes).digest('hex');
const required = ['F04-static-playback-notes', 'F04-linear-stage-integral', 'F04-previous-off-grid-integral', 'F04-millisecond-time', 'F04-centimeter-conversion', 'F04-celsius-kelvin', 'F04-named-numeric-bus', 'F04-named-boolean-bus', 'F04-repeated-state-subsystems', 'F04-dataset-inside-subsystem'];
if (evidence.engineVersion !== '0.4.0-m4' || evidence.registry.total !== 64
  || datasetHash !== 'cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7' || evidence.datasetSha256 !== datasetHash
  || !evidence.strictIndependentTypecheck || !['static', 'discrete', 'continuous'].every(mode => evidence.strictIndependentModes.includes(mode))
  || evidence.fixtures.length < 18 || !required.every(id => evidence.fixtures.some(fixture => fixture.id === id))
  || evidence.fixtures.some(fixture => !fixture.jsonRoundtrip || !fixture.nodeOrderIndependent || !fixture.independentTSParity || !fixture.immutableResults || !fixture.manifestParity || !Number.isFinite(fixture.maximumAbsoluteError) || fixture.maximumAbsoluteError > fixture.tolerance)
  || !evidence.fixtures.find(fixture => fixture.id === 'F04-repeated-state-subsystems')?.handBuiltFlatParity
  || evidence.failures.length < 6 || evidence.failures.some(failure => !failure.diagnosticVerified) || !evidence.importFailureAtomicity
  || evidence.experiments.runs.length !== 3 || evidence.experiments.runs.some(run => !run.independentTSParity)
  || !evidence.experiments.repeatedHashes || !evidence.experiments.originalModelPreserved || evidence.experiments.comparison.status !== 'completed'
  || evidence.experiments.sharedRecordBudget.code !== 'SWEEP_RECORD_BUDGET' || evidence.experiments.sharedOperationBudget.code !== 'SWEEP_OPERATION_BUDGET'
  || evidence.experiments.cancellation.status !== 'cancelled' || evidence.experiments.cancellation.preservedRuns !== 1) {
  throw new Error('Run complete verify:m4 before M4 coverage promotion');
}
const m3 = JSON.parse(await readFile('docs/evidence/m3-verification.json', 'utf8')) as { engineVersion: string; strictIndependentTypecheck: boolean; fixtures: FixtureEvidence[] };
const foh = m3.fixtures.find(fixture => fixture.id === 'F03-first-order-hold');
const canCorrectFoh = m3.engineVersion === '0.3.0-m3' && m3.strictIndependentTypecheck && foh?.independentTSParity && foh.jsonRoundtrip && foh.manifestParity && foh.maximumAbsoluteError <= foh.tolerance && getBlockDefinition('time.first-order-hold');
const path = 'docs/block-coverage.md';
const source = await readFile(path, 'utf8');
const counts: Record<string, number> = {};
const identity = new Map<string, string>();
const seenApproved = new Set<string>();
const updated = source.split(/\r?\n/).map(line => {
  const match = /^\| \[(\d{2}-\d{3})\]/.exec(line);
  if (!match) return line;
  const cells = line.slice(1, -1).split('|').map(cell => cell.trim()), id = match[1]!;
  identity.set(id, cells.slice(0, 4).join('|'));
  const subset = approved[id];
  if (subset) {
    if (cells[1] !== subset.name || (!subset.widget && !getBlockDefinition(subset.id))) throw new Error(`Coverage source or registry mismatch: ${id}`);
    if (!['미구현', 'M4 승인 subset'].includes(cells[8]!)) throw new Error(`Refusing to downgrade an existing implementation: ${id}`);
    cells[4] = `\`${subset.id}\``; cells[8] = 'M4 승인 subset';
    cells[7] = cells[7]!.replace(/; 실제 지원:.*$/, '') + `; 실제 지원: ${subset.boundary}; 계약·fixture: m4-contract / m4-verification`;
    seenApproved.add(id);
  }
  // Correct a source-name spelling omission independently from new M4 capabilities.
  if (id === '02-003' && cells[1] === 'First Order Hold' && canCorrectFoh) {
    cells[4] = '`time.first-order-hold`'; cells[8] = 'M3 승인 subset';
    cells[7] = cells[7]!.replace(/; 실제 지원:.*$/, '') + '; 실제 지원: 단위1 scalar 이전 두 due 샘플의 causal 기울기 외삽·정수 rate/offset·initial·현재 due 입력 캡처; 첫 두 샘플 전 기울기 0·미래 interpolation/전체 Simulink FOH 의미 제외; 계약·fixture: m3-contract / F03-first-order-hold; M3 대응 누락 교정';
  }
  counts[cells[8]!] = (counts[cells[8]!] ?? 0) + 1;
  if (identity.get(id) !== cells.slice(0, 4).join('|')) throw new Error(`Source identity changed: ${id}`);
  return `| ${cells.join(' | ')} |`;
}).join('\n');
if (identity.size !== 385 || Object.values(counts).reduce((sum, count) => sum + count, 0) !== 385 || seenApproved.size !== 18) throw new Error('Coverage rows changed or M4 row selection was incomplete');
const summary = `- 상태: M4 구현 기록. 원본385행 중 M4 신규 승인 subset ${counts['M4 승인 subset'] ?? 0}행, M3 승인 subset ${counts['M3 승인 subset'] ?? 0}행(기존 대응 누락 교정 ${canCorrectFoh ? 1 : 0}행 포함), M2 승인 subset ${counts['M2 승인 subset'] ?? 0}행, M1 정적 subset ${counts['M1 정적 subset'] ?? 0}행, preset ${counts['M1 preset subset'] ?? 0}행, AST 독립 대체 ${counts['M1 AST 독립 대체 subset'] ?? 0}행, 미구현 ${counts['미구현'] ?? 0}행이다. 전체 옵션·Simulink 동등성을 뜻하지 않는다. 실제 경계는 [M4 구현 계약](m4-contract.md), [M4 검증 기록](m4-validation.md), [공식 수치 증거](evidence/m4-verification.json)에 기록한다.`;
const subsetNote = `### M4에서 확인한 범위\n\nM4 신규 승격은 원본 18행이다. CSV/JSON 데이터 재생·명시 단위 변환·동종 scalar 두 필드 bus·내장 서브시스템·일반 텍스트 문서·대시보드 5종 및 Slider Gain 바인딩에 한정한다. 동일 이름의 Customizable Blocks, 여러 gauge 모양, Atomic Subsystem, 외부 Model/Subsystem Reference, From Spreadsheet, 문자열 신호 실행은 승격하지 않았다. 실행 기록·파라미터 스윕·결과 CSV/JSON·export ZIP은 별도 CalcWeave 작업 흐름으로 제공하며 새로운 원본행으로 합산하지 않는다.\n\n기존 M3의 First Order Hold 원본명은 하이픈 없는 \`02-003\`이다. \`F03-first-order-hold\`의 모든 원시 표본·JSON·독립 TS·manifest 검증이 이미 통과했으므로 \`time.first-order-hold\` causal 외삽 subset으로 대응 누락 1행을 교정했다. 미래 샘플 interpolation과 전체 Simulink 동등성을 뜻하지 않으며 M4 신규 18행에 포함하지 않는다.\n\n`;
let document = updated.replace(/^- 문서 버전: .+$/m, '- 문서 버전: v0.5').replace(/^- 상태: .+$/m, summary);
if (!document.includes('### M4에서 확인한 범위')) document = document.replace('## 3. 수록 행 수와 계획 결정 집계', subsetNote + '## 3. 수록 행 수와 계획 결정 집계');
document = document.replace('M1의 이동 가능한 모델 형식은 `*.cw.json`이다. M4에서는 모델·데이터·manifest를 묶은 `*.cwpack` portable archive를 검토한다. 이 archive의 검증된 경로·해제 크기·항목 수·중첩 상한을 원본 To File/From File 대응과 별도로 명세한다.', 'M4의 이동 가능한 모델 형식은 `*.cw.json`이며 데이터와 서브시스템 정의도 함께 보관한다. 실행 묶음 ZIP은 모델·독립 TS·manifest·README를 담고 데이터/계층 reference와 실행 hash를 검증한다. 전용 `*.cwpack`, MAT/XLSX/SLX와 외부 환경 자동 import는 구현하지 않았으며 원본 To File/From File의 전체 파일 형식 동등성으로 표시하지 않는다.');
await writeFile(path, document + (document.endsWith('\n') ? '' : '\n'));
process.stdout.write(JSON.stringify({ sourceRows: identity.size, m4NewlyApprovedRows: 18, m3CorrespondenceCorrections: canCorrectFoh ? 1 : 0, statuses: counts }, null, 2) + '\n');
