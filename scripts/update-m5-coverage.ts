import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { blockRegistry, getBlockDefinition } from '../packages/block-library/src';
import { ENGINE_VERSION } from '../packages/model/src';

interface FixtureEvidence { id: string; maximumAbsoluteError: number; tolerance: number; jsonRoundtrip: boolean; nodeOrderIndependent: boolean; independentTSParity: boolean; immutableResults: boolean; manifestParity: boolean }
interface Evidence { engineVersion: string; datasetSha256: string; strictIndependentTypecheck: boolean; strictIndependentModes: string[]; fixtures: FixtureEvidence[]; failures: { diagnosticVerified: boolean }[] }
const evidence = JSON.parse(await readFile('docs/evidence/m5-verification.json', 'utf8')) as Evidence;
const digest = createHash('sha256').update(await readFile('dataset/Simulink_Basic_Blocks_R2024b.md')).digest('hex');
if (String(ENGINE_VERSION) !== '0.5.0-m5' || evidence.engineVersion !== ENGINE_VERSION || blockRegistry.length !== 74
  || digest !== 'cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7' || evidence.datasetSha256 !== digest
  || !evidence.strictIndependentTypecheck || !['static', 'discrete', 'continuous'].every(mode => evidence.strictIndependentModes.includes(mode))
  || evidence.fixtures.length < 20 || evidence.fixtures.some(item => !item.jsonRoundtrip || !item.nodeOrderIndependent || !item.independentTSParity || !item.immutableResults || !item.manifestParity || !Number.isFinite(item.maximumAbsoluteError) || item.maximumAbsoluteError > item.tolerance)
  || evidence.failures.length < 6 || evidence.failures.some(item => !item.diagnosticVerified)) throw new Error('Complete M5 numerical/diagnostic/strict standalone verification before coverage approval');

const multiply = '실수 2D A(m×k)·B(k×n)의 행렬 곱; 각 축 1~32·≤1,024원소·승인 단위 곱·스케일/보상 합산·형상/비유한/underflow 진단·가중 예산·독립 TS; complex/일반 tensor/자동 broadcasting 제외';
const quantizer = '명시 1~32bit signed/unsigned·fraction0~32·nearest-even/floor/ceil/toward-zero·saturate/wrap/error의 정확한 IEEE→BigInt 양자화; out 복원 float64·stored 정확한 정수 코드; 일반 Data Type Conversion/fixed-point 신호 전파/64bit/f32/slope-bias 제외';
const approved: Record<string, { name: string; id: string; status: string; boundary: string }> = {
  '07-002': { name: '2-D Lookup Table', id: 'lookup.2d', status: 'M5 승인 subset', boundary: '단위1 row/column scalar·유한 비균일 축 각각2~32·table[row][column] 일치·bilinear/nearest/previous·clip/linear/error(선형 외삽은linear보간만)·nearest 동률 낮은index·명시 출력 단위·독립 TS; n-D/spline/Akima/동적표 제외' },
  '07-007': { name: 'Prelookup', id: 'lookup.prelookup', status: 'M5 승인 subset', boundary: '단위1 scalar·엄격히증가2~32기준점·0-based index/fraction 두 scalar·정확한 knot/끝점/clip/linear/error·독립 TS; 별도 Interpolation Using Prelookup/일반 n-D/typed index 제외' },
  '08-015': { name: 'Matrix Multiply', id: 'math.matrix-multiply', status: 'M5 승인 subset', boundary: multiply },
  '09-012': { name: 'Matrix Multiply', id: 'math.matrix-multiply', status: 'M5 승인 subset', boundary: multiply },
  '09-019': { name: 'Transpose', id: 'matrix.transpose', status: 'M5 승인 subset', boundary: '실수2D 행/열 전치·각축1~32·단위유지·방어적복사·독립 TS; complex/켤레/Hermitian Transpose 제외' },
  '01-004': { name: 'Data Type Conversion', id: 'fixed.quantize', status: 'M5 독립 대체 subset', boundary: quantizer },
  '14-002': { name: 'Data Type Conversion', id: 'fixed.quantize', status: 'M5 독립 대체 subset', boundary: quantizer },
};
const path = 'docs/block-coverage.md', original = await readFile(path, 'utf8');
const identity = new Map<string, string>(), counts: Record<string, number> = {}, found = new Set<string>();
const updated = original.split(/\r?\n/).map(line => {
  const match = /^\| \[(\d{2}-\d{3})\]/.exec(line); if (!match) return line;
  const id = match[1]!, cells = line.slice(1, -1).split('|').map(cell => cell.trim()); identity.set(id, cells.slice(0, 4).join('|'));
  const row = approved[id];
  if (row) {
    if (cells[1] !== row.name || !getBlockDefinition(row.id) || !['미구현', row.status].includes(cells[8]!)) throw new Error(`Refusing source mismatch/downgrade: ${id}`);
    cells[4] = `\`${row.id}\``; cells[8] = row.status;
    cells[7] = cells[7]!.replace(/; 실제 지원:.*$/, '') + `; 실제 지원: ${row.boundary}; 계약·fixture: m5-contract / m5-verification`;
    found.add(id);
  }
  // Preserve original staged elementwise Product support; explain the separately approved matrix configuration.
  if (cells[1] === 'Product' && ['01-015', '08-020', '09-017'].includes(id)) {
    cells[7] = cells[7]!.replace(/; M5 추가:.*$/, '') + '; M5 추가: 행렬 구성은 별도 math.matrix-multiply의 검증된 실수2D subset; 원소별 math.multiply 계약 유지; 일반 complex/fixed 타입 제외';
  }
  counts[cells[8]!] = (counts[cells[8]!] ?? 0) + 1;
  if (cells.slice(0, 4).join('|') !== identity.get(id)) throw new Error('Source identity changed');
  return '| ' + cells.join(' | ') + ' |';
}).join('\n');
if (identity.size !== 385 || found.size !== 7 || Object.values(counts).reduce((sum, count) => sum + count, 0) !== 385) throw new Error('Incomplete M5 coverage');
const summary = `- 상태: M5 선택 기능 구현 기록. 원본385행 중 M5 승인 subset ${counts['M5 승인 subset']}행, M5 독립 대체 subset ${counts['M5 독립 대체 subset']}행, M4 승인 subset ${counts['M4 승인 subset']}행, M3 승인 subset ${counts['M3 승인 subset']}행, M2 승인 subset ${counts['M2 승인 subset']}행, M1 정적 subset ${counts['M1 정적 subset']}행, preset ${counts['M1 preset subset']}행, AST 독립 대체 ${counts['M1 AST 독립 대체 subset']}행, 미구현 ${counts['미구현']}행이다. 추가 행렬 분해5종은 원자료 행 수에 합산하지 않는다. 실제 경계는 [M5 계약](m5-contract.md)·[검증 기록](m5-validation.md)·[수치 증거](evidence/m5-verification.json)에 기록한다. 전체 옵션·Simulink 동등성을 뜻하지 않는다.`;
const note = '### M5에서 확인한 범위\n\n원본 5행을 실수 행렬 곱·전치, 2D Lookup·Prelookup의 승인 subset으로 승격했다. Data Type Conversion 2행은 정확한 1~32bit 양자화 목적의 독립 대체다. 일반 cast·fixed-point 타입 전파를 구현했다고 표시하지 않는다. 동일 Product의 기존 원소별 구현 상태는 유지하며 별도 행렬 구성만 추가 설명한다. Hermitian Transpose, n-D/Dynamic/Interpolation Using Prelookup, Stored Integer 증감은 승격하지 않았다.\n\nDeterminant·Inverse·Linear Solve·Cholesky·LU는 원자료에 없는 CalcWeave 추가 기능5종이다. 실수 정방·각축≤32·단위/수치 안정성 경계와 잔차를 검증하지만 복소수·일반 최소제곱·희소/고차 tensor로 확대하지 않는다. quantizer 이후 산술은 float64이다. 신규10 registry와 원본7행 승격은 서로 다른 수치다. 메시지·조건/반복·DAE·수치 선형화·외부 runtime·실제 사용자 조사·배포는 이번 구현 승인에서 제외한다.\n\n';
let document = updated.replace(/^- 문서 버전: .+$/m, '- 문서 버전: v0.6').replace(/^- 상태: .+$/m, summary);
if (!document.includes('### M5에서 확인한 범위')) document = document.replace('## 3. 수록 행 수와 계획 결정 집계', note + '## 3. 수록 행 수와 계획 결정 집계');
await writeFile(path, document);
process.stdout.write(JSON.stringify({ sourceRows: identity.size, m5ApprovedRows: 5, m5IndependentAlternatives: 2, additionalMatrixCapabilities: 5, statuses: counts }) + '\n');
