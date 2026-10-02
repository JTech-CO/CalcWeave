import { readFile, writeFile } from 'node:fs/promises';
import { getBlockDefinition } from '../packages/block-library/src';

// Promote only the named, verified subset. Shared capabilities do not imply every preset is supported.
const nativeNames: Record<string, string> = {
  'source.constant': 'Constant', 'io.input': 'Inport', 'math.sum': 'Sum', 'math.gain': 'Gain',
  'math.multiply': 'Product', 'math.abs': 'Abs', 'math.function': 'Math Function',
  'math.trigonometric': 'Trigonometric Function', 'math.round': 'Rounding Function',
  'math.minmax': 'MinMax', 'math.sqrt': 'Sqrt', 'logic.compare': 'Relational Operator',
  'logic.boolean': 'Logical Operator', 'route.switch': 'Switch', 'nonlinear.saturation': 'Saturation',
  'route.mux': 'Mux', 'route.demux': 'Demux', 'math.concatenate': 'Vector Concatenate',
  'matrix.reshape': 'Reshape', 'io.output': 'Outport', 'sink.display': 'Display', 'io.terminator': 'Terminator',
};
const path = 'docs/block-coverage.md';
const content = await readFile(path, 'utf8');
if (content.includes('M2 승인 subset')) throw new Error('M2 coverage exists: use update-m2-coverage.ts; M1 promotion must not downgrade newer evidence.');
const counts: Record<string, number> = {};
const updated = content.split(/\r?\n/).map(line => {
  if (!/^\| \[\d{2}-\d{3}\]/.test(line)) return line;
  const cells = line.slice(1, -1).split('|').map(cell => cell.trim());
  const capability = cells[4]!.replaceAll('`', '');
  const name = cells[1]!;
  const definition = getBlockDefinition(capability);
  let status = '미구현';
  let boundary = '';
  if (definition && nativeNames[capability] === name) {
    status = 'M1 정적 subset';
    boundary = 'M1 계약의 finite float64/boolean·scalar/vector/2D subset과 정적 실행 한정';
  } else if ((capability === 'math.sum' && ['Add', 'Subtract'].includes(name))
    || (capability === 'source.constant' && ['Pi', 'Zero'].includes(name))) {
    status = 'M1 preset subset';
    boundary = 'M1 고정 사전 설정만 제공; 원본 전체 옵션 동등성 제외';
  } else if (capability === 'discrete.unit-delay' && name === 'Unit Delay') {
    status = 'M0 이산 scalar 실험';
  } else if (capability === 'continuous.integrator' && name === 'Integrator') {
    status = 'M0 연속 scalar 실험';
  } else if (['expression.ast', 'math.expression'].includes(capability) && name === 'Fcn') {
    if (!getBlockDefinition('math.expression')) throw new Error('Expression registry missing');
    cells[4] = '`math.expression`';
    status = 'M1 AST 독립 대체 subset';
    boundary = 'M1 x/pi/e·허용 함수 AST, 512자/128노드/32깊이; MATLAB 문법·코드 실행 제외';
  }
  cells[8] = status;
  if (boundary) cells[7] = cells[7]!.replace(/; 실제 지원:.*$/, '') + `; 실제 지원: ${boundary}`;
  counts[status] = (counts[status] ?? 0) + 1;
  return `| ${cells.join(' | ')} |`;
}).join('\n');
const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
if (total !== 385) throw new Error(`Coverage count changed: ${total}`);
const summary = `- 상태: M1 구현 기록. 원본 385행 중 정적 subset ${counts['M1 정적 subset'] ?? 0}행, preset ${counts['M1 preset subset'] ?? 0}행, 제한 AST 독립 대체 ${counts['M1 AST 독립 대체 subset'] ?? 0}행, 기존 이산/연속 scalar 실험 ${(counts['M0 이산 scalar 실험'] ?? 0) + (counts['M0 연속 scalar 실험'] ?? 0)}행, 미구현 ${counts['미구현'] ?? 0}행이다. 전체 옵션·Simulink 동등성을 뜻하지 않는다. 실제 경계는 [M1 구현 계약](m1-contract.md)과 [검증 기록](m1-validation.md)에 기록한다.`;
await writeFile(path, updated.replace(/^- 상태: .+$/m, summary) + (updated.endsWith('\n') ? '' : '\n'));
process.stdout.write(JSON.stringify(counts, null, 2) + '\n');
