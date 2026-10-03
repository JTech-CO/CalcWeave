import { readFile, writeFile } from 'node:fs/promises';
import { getBlockDefinition } from '../packages/block-library/src';

// Only exact documented names/options can be promoted. Sharing an ID is insufficient.
const approved: Record<string, { names: string[]; boundary: string }> = {
  'discrete.unit-delay': { names: ['Unit Delay'], boundary: 'typed scalar/vector/2D 이전 due 입력; 정수 tick·level reset; terminal commit 없음' },
  'discrete.delay': { names: ['Delay', 'Resettable Delay'], boundary: '고정 1..1024 slot FIFO·typed initial·다음 commit level reset; variable delay/taps·edge reset 제외' },
  'discrete.integrator': { names: ['Discrete-Time Integrator'], boundary: 'forward Euler·numeric scalar/vector/2D·단위1·gain·level reset; 다른 적분법/출력 제한 제외' },
  'discrete.difference': { names: ['Difference'], boundary: 'numeric scalar/vector/2D의 이전 due 입력 차분·typed initial' },
  'discrete.derivative': { names: ['Discrete Derivative'], boundary: 'numeric scalar/vector/2D 차분/(period×baseStep)·단위1' },
  'discrete.fir': { names: ['Discrete FIR Filter'], boundary: '1..128 real taps·numeric scalar/vector/2D 독립 channel·level reset; 전문 DSP 제외' },
  'discrete.transfer-function': { names: ['Discrete Transfer Fcn'], boundary: '단위1 scalar SISO z^-1 real coefficient 차분식·1..32 coefficients·num길이≤den길이·a0≠0; 다른 realization 제외' },
  'discrete.state-space': { names: ['Discrete State-Space'], boundary: '단위1 numeric scalar SISO·1..16 상태·A/B/C/D·initial·level reset; MIMO 제외' },
  'source.step': { names: ['Step'], boundary: 'absolute time·구간 내 event는 base grid와 source due에 정렬; discrete 전용' },
  'source.ramp': { names: ['Ramp'], boundary: 'absolute time start/slope/initial·discrete 전용' },
  'source.sine-wave': { names: ['Sine Wave'], boundary: 'absolute time·frequency Hz·phase rad·amplitude/bias·discrete 전용' },
  'source.pulse': { names: ['Pulse Generator'], boundary: 'base tick 정수 period/width/phase만; time/event mode 제외' },
  'source.clock': { names: ['Clock'], boundary: '모든 base tick의 simulation time·단위s·rate1/0; wall clock 제외' },
  'source.digital-clock': { names: ['Digital Clock'], boundary: 'node due의 simulation time·단위s·사이 hold' },
  'source.random': { names: ['Random Number', 'Uniform Random Number'], boundary: '노드별 LCG32 seed0..2^32-1·uniform 또는 two-draw normal; MATLAB 난수열 동등성 제외' },
  'source.repeating-sequence': { names: ['Repeating Sequence', 'Repeating Sequence Interpolated', 'Repeating Sequence Stair'], boundary: '2..1024 strictly increasing times·finite values·linear/previous·positive absolute-time modulo·종점 discontinuity' },
  'time.rate-transition': { names: ['Rate Transition'], boundary: '명시 base tick 정수 period/offset·read-before-write 이전 publication·양방향/동시/offset·typed initial; 비정수/비동기 제외' },
  'lookup.interpolated': { names: ['1-D Lookup Table'], boundary: 'dimensionless numeric scalar/vector/2D pointwise 1-D·linear/previous·clip/error·2..1024 breakpoints; nD/extrapolate 제외' },
  'logic.bitwise': { names: ['Bitwise Operator'], boundary: 'dimensionless numeric scalar unsigned1..32bit·and/or/xor/not/logical shifts·좌shift wrap; signed/암묵float coercion 제외' },
  'logic.edge-detect': { names: ['Detect Change'], boundary: 'boolean scalar의 either/rising/falling previous-due 비교; numeric boundary/sign preset 제외' },
  'sink.scope': { names: ['Scope'], boundary: 'typed time 기록·numeric scalar plot·전체 배열 샘플/원소 표; signal viewer 전체 옵션 제외' },
};
const evidence = JSON.parse(await readFile('docs/evidence/m2-verification.json', 'utf8')) as { registry: { total: number }; fixtures: unknown[] };
if (evidence.registry.total !== 45 || evidence.fixtures.length < 15) throw new Error('Run verify:m2 before coverage promotion');
const path = 'docs/block-coverage.md'; const source = await readFile(path, 'utf8'); const counts: Record<string, number> = {};
if (source.includes('M3 승인 subset') || source.includes('M4 승인 subset')) throw new Error('M3/M4 coverage cannot be downgraded by the historical M2 updater');
const updated = source.split(/\r?\n/).map(line => {
  if (!/^\| \[\d{2}-\d{3}\]/.test(line)) return line;
  const cells = line.slice(1, -1).split('|').map(cell => cell.trim()); const id = cells[4]!.replaceAll('`', '');
  const subset = approved[id];
  if (subset?.names.includes(cells[1]!)) {
    if (!getBlockDefinition(id)) throw new Error(`Missing registry: ${id}`);
    cells[8] = 'M2 승인 subset'; cells[7] = cells[7]!.replace(/; 실제 지원:.*$/, '') + `; 실제 지원: ${subset.boundary}; 계약·fixture: m2-contract / m2-verification`;
  } else if (['M1 정적 subset', 'M1 preset subset', 'M1 AST 독립 대체 subset'].includes(cells[8]!)) {
    cells[7] = cells[7]!.replace('subset과 정적 실행 한정', 'subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원');
  }
  counts[cells[8]!] = (counts[cells[8]!] ?? 0) + 1; return `| ${cells.join(' | ')} |`;
}).join('\n');
if (Object.values(counts).reduce((sum, value) => sum + value, 0) !== 385) throw new Error('Coverage rows changed');
const summary = `- 상태: M2 구현 기록. 원본385행 중 M2 승인 subset ${counts['M2 승인 subset'] ?? 0}행, M1 정적 subset ${counts['M1 정적 subset'] ?? 0}행(정수 tick 이산에도 확장), preset ${counts['M1 preset subset'] ?? 0}행, AST 독립 대체 ${counts['M1 AST 독립 대체 subset'] ?? 0}행, M0 연속 scalar 실험 ${counts['M0 연속 scalar 실험'] ?? 0}행, 미구현 ${counts['미구현'] ?? 0}행이다. 전체 옵션·Simulink 동등성을 뜻하지 않는다. 실제 경계는 [M2 구현 계약](01-technical-whitepaper.md)과 [검증 기록](validation.md)에 기록한다.`;
await writeFile(path, updated.replace('- 문서 버전: v0.2', '- 문서 버전: v0.3').replace(/^- 상태: .+$/m, summary) + (updated.endsWith('\n') ? '' : '\n'));
process.stdout.write(JSON.stringify(counts, null, 2) + '\n');
