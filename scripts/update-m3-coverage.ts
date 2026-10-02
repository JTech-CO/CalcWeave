import { readFile, writeFile } from 'node:fs/promises';
import { getBlockDefinition } from '../packages/block-library/src';

// A shared planned capability never promotes unrelated options or duplicate meanings.
const approved: Record<string, { id: string; boundary: string }> = {
  Integrator: { id: 'continuous.integrator', boundary: '단위1 float64 scalar·initial·none/rising reset·RK4/RK45; Hit Crossing 또는 held boolean 제어; 출력 제한 제외' },
  Derivative: { id: 'continuous.derivative', boundary: '단위1 scalar·causal 필터 미분 N(u-F), F′=N(u-F); filterN/initial; ideal derivative·잡음 안정성 보장 제외' },
  'PID Controller': { id: 'continuous.pid', boundary: '단위1 scalar parallel P/I/filtered D·kp/ki/kd/N·초기 적분/필터; anti-windup·clamp·2DOF·자동 튜닝 제외' },
  'Second-Order Integrator': { id: 'continuous.second-order-integrator', boundary: '단위1 scalar 가속도→위치/속도 두 상태·각 initial·별도 포트; limited/reset 옵션 제외' },
  'State-Space': { id: 'continuous.state-space', boundary: '실수 단위1 scalar SISO·N=1..16·A/B/C/D/initial·D feedthrough 판정; MIMO/Descriptor 제외' },
  'Transfer Fcn': { id: 'continuous.transfer-function', boundary: '실수 단위1 scalar proper s 내림차순 계수·차수0..16·a0≠0·제어 정준형 initial; improper/복소 제외' },
  'Zero-Pole': { id: 'continuous.zero-pole', boundary: '실수 roots/gain→proper 제어 정준형·roots0..16·initial; 복소 roots 제외' },
  'Transport Delay': { id: 'time.transport-delay', boundary: '단위1 scalar 양의 고정 delay·initial prehistory·승인 이력 선형 보간·좌우 jump 보존·100k 총메모리; 가변/엔터티 지연 제외' },
  Memory: { id: 'time.memory', boundary: '단위1 scalar 직전 승인 major-step 입력·initial·trial/rejected/minor 불변; 이산 Unit Delay와 별도 의미' },
  'Zero-Order Hold': { id: 'time.zero-order-hold', boundary: '단위1 scalar 연속 입력의 정수 base period/offset 캡처/hold·initial; 연속→M2 이산 경계' },
  'First Order Hold': { id: 'time.first-order-hold', boundary: '단위1 scalar 이전 두 due 샘플의 causal 기울기 외삽·정수 rate/offset·initial; 미래 interpolation/전체 Simulink FOH 의미 제외' },
  'Hit Crossing': { id: 'logic.hit-crossing', boundary: '단위1 scalar threshold·rising/falling/either·boolean event pulse·시간 정밀화·동시 reset/tick 순서·사건 상한' },
  Relay: { id: 'nonlinear.relay', boundary: '단위1 scalar off<on hysteresis·초기 상태·on/off 값·교차 정밀화; equal threshold/typed vector 제외' },
};
const evidence = JSON.parse(await readFile('docs/evidence/m3-verification.json', 'utf8'));
if (evidence.engineVersion !== '0.3.0-m3' || evidence.registry.total !== 57 || evidence.fixtures.length < 20 || !evidence.strictIndependentTypecheck || evidence.convergence.observedOrders.some((order: number) => order < 3.9) || evidence.failures.length < 4) throw new Error('Run complete verify:m3 before M3 coverage promotion');
const path = 'docs/block-coverage.md', source = await readFile(path, 'utf8'), counts: Record<string, number> = {};
if (source.includes('M4 승인 subset')) throw new Error('M4 coverage cannot be downgraded by the historical M3 updater');
const updated = source.split(/\r?\n/).map(line => {
  if (!/^\| \[\d{2}-\d{3}\]/.test(line)) return line;
  const cells = line.slice(1,-1).split('|').map(cell => cell.trim()), subset = approved[cells[1]!];
  // Only raw continuous/hold/event names are eligible, never Dashboard display or similarly named presets.
  if (subset && ['Integrator','Derivative','PID Controller','Second-Order Integrator','State-Space','Transfer Fcn','Zero-Pole','Transport Delay','Memory','Zero-Order Hold','First Order Hold','Hit Crossing','Relay'].includes(cells[1]!)) {
    if (!getBlockDefinition(subset.id)) throw new Error(`Missing registry ${subset.id}`);
    cells[4] = `\`${subset.id}\``; cells[8] = 'M3 승인 subset';
    cells[7] = cells[7]!.replace(/; 실제 지원:.*$/, '') + `; 실제 지원: ${subset.boundary}; 계약·fixture: m3-contract / m3-verification`;
  }
  if (['source.step','source.ramp','source.sine-wave','source.clock','source.repeating-sequence'].includes(cells[4]!.replaceAll('`','')) && cells[8] === 'M2 승인 subset') {
    cells[7] = cells[7]!.replace(/; M3 연속 stage 시각 지원:.*$/, '').replaceAll('·discrete 전용','').replace('구간 내 event는 base grid와 source due에 정렬','M2는 base grid 정렬; M3는 알려진 breakpoint 분할') + '; M3 연속 stage 시각 지원: m3-contract / m3-verification';
  }
  counts[cells[8]!] = (counts[cells[8]!] ?? 0) + 1; return `| ${cells.join(' | ')} |`;
}).join('\n');
if (Object.values(counts).reduce((sum, count) => sum + count, 0) !== 385) throw new Error('Coverage rows changed');
const summary = `- 상태: M3 구현 기록. 원본385행 중 M3 승인 subset ${counts['M3 승인 subset'] ?? 0}행, M2 승인 subset ${counts['M2 승인 subset'] ?? 0}행, M1 정적 subset ${counts['M1 정적 subset'] ?? 0}행, preset ${counts['M1 preset subset'] ?? 0}행, AST 독립 대체 ${counts['M1 AST 독립 대체 subset'] ?? 0}행, 미구현 ${counts['미구현'] ?? 0}행이다. 전체 옵션·Simulink 동등성을 뜻하지 않는다. 실제 경계는 [M3 구현 계약](m3-contract.md)과 [검증 기록](m3-validation.md)에 기록한다. First Order Hold는 과거 두 샘플에 기반한 causal 외삽 subset이며 미래 interpolation과 전체 Simulink 동등성을 뜻하지 않는다.`;
await writeFile(path, updated.replace('- 문서 버전: v0.3','- 문서 버전: v0.4').replace(/^- 상태: .+$/m, summary) + (updated.endsWith('\n') ? '' : '\n'));
process.stdout.write(JSON.stringify(counts, null, 2) + '\n');
