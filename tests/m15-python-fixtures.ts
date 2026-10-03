import type { CalcModel, CalcNode, SignalValue } from '../packages/model/src';
import { block, connect, staticModel } from './m1-engine-fixtures';

export interface M15PythonFixture { name: string; model: CalcModel; expected: Record<string, SignalValue>; sourceIds: string[] }
const text = (value: string): SignalValue => ({ kind: 'typed', dtype: 'string', shape: [], data: [value] });
const typed = (dtype: 'float32'|'float64'|'int32'|'uint32'|'uint8', value: number|string| string[], shape: number[] = []): SignalValue => ({ kind: 'typed', dtype, shape, data: Array.isArray(value) ? value : [value] });
const literal = (id: string, value: SignalValue): CalcNode => block(id, typeof value === 'number' || typeof value === 'boolean' ? 'source.constant' : 'source.signal', { value });
function unary(name: string, type: string, input: SignalValue, expected: SignalValue, parameters: Record<string, unknown> = {}, sourceIds: string[] = []): M15PythonFixture {
  return { name, model: staticModel([literal('input', input), block('operation', type, parameters), block('result', 'sink.display')], [connect('input', 'operation'), connect('operation', 'result')]), expected: { result: expected }, sourceIds };
}
function pair(name: string, type: string, a: string, b: string, expected: SignalValue, parameters: Record<string, unknown> = {}, sourceIds: string[] = []): M15PythonFixture {
  const first = type === 'string.string-compare' ? 'a' : type === 'string.string-concatenate' ? 'in1' : 'in', second = type === 'string.string-compare' ? 'b' : type === 'string.string-concatenate' ? 'in2' : 'pattern';
  return { name, model: staticModel([literal('a', text(a)), literal('b', text(b)), block('operation', type, parameters), block('result', 'sink.display')], [connect('a', 'operation', first), connect('b', 'operation', second), connect('operation', 'result')]), expected: { result: expected }, sourceIds };
}
const constant = (type: string, value: SignalValue, expected: SignalValue = value): M15PythonFixture => ({ name: type, model: staticModel([block('input', type, { value }), block('result', 'sink.display')], [connect('input', 'result')]), expected: { result: expected }, sourceIds: [] });
const enumValue: SignalValue = { kind: 'typed', dtype: 'enum', enum: { name: 'State', labels: ['Off', 'On'] }, shape: [], data: ['On'] };
const compose: M15PythonFixture = { name: 'compose exact int64 and binary64', model: staticModel([literal('word', text('速度')), literal('integer', { kind: 'typed', dtype: 'int64', shape: [], data: ['9007199254740993'] }), literal('number', 1.25), block('operation', 'string.compose', { format: '%s=%d %.2f %%' }), block('result', 'sink.display')], [connect('word', 'operation', 'arg1'), connect('integer', 'operation', 'arg2'), connect('number', 'operation', 'arg3'), connect('operation', 'result')]), expected: { result: text('速度=9007199254740993 1.25 %') }, sourceIds: [] };
const scan: M15PythonFixture = { name: 'scan typed f32 and integers', model: staticModel([literal('input', text('n=7 x=0.1 tag=A')), block('operation', 'string.scan', { format: 'n=%d x=%f tag=%s' }), ...[1,2,3].map(index => block(`result${index}`, 'sink.display'))], [connect('input', 'operation'), ...[1,2,3].map(index => connect('operation', `result${index}`, 'in', `out${index}`))]), expected: { result1: typed('int32', '7'), result2: typed('float32', 0.10000000149011612), result3: text('A') }, sourceIds: ['18-004'] };
const substring = unary('substring Unicode code points', 'string.substring', text('A😀한B'), text('😀한')); substring.model.nodes.push(literal('start', 2), literal('length', 2)); substring.model.edges.push(connect('start', 'operation', 'start'), connect('length', 'operation', 'length'));
const toAscii = unary('ASCII fixed vector and length', 'string.string-to-ascii', text('AB'), typed('uint8', ['65','66','0','0'], [4]), { capacity: 4 }, ['18-011']); toAscii.model.nodes.push(block('length', 'sink.display')); toAscii.model.edges.push(connect('operation', 'length', 'in', 'length')); toAscii.expected.length = typed('uint32', '2');

/** Expected signals are independent literals, not calculations by production helpers. */
export const M15_PYTHON_DEFINITION_FIXTURES: M15PythonFixture[] = [
  { ...constant('source.string-constant', text('수학😀')), model: staticModel([block('input', 'source.string-constant', { value: '수학😀' }), block('result', 'sink.display')], [connect('input', 'result')]) },
  unary('ASCII NUL termination', 'string.ascii-to-string', typed('uint8', ['65','66','0','67'], [4]), text('AB'), {}, ['18-001']),
  compose, scan,
  pair('compare firstN ASCII fold', 'string.string-compare', 'ABCtail', 'abcOTHER', true, { firstN: 3, caseSensitive: 'no' }, ['18-006']),
  pair('concatenate ASCII', 'string.string-concatenate', 'Calc', 'Weave', text('CalcWeave'), {}, ['18-005']),
  pair('contains ASCII', 'string.string-contains', 'CalcWeave', 'Weave', true, {}, ['18-007']),
  pair('nonoverlapping count', 'string.string-count', 'aaaaa', 'aa', typed('uint32', '2'), {}, ['18-008']),
  pair('find one based', 'string.string-find', 'ABCABC', 'B', typed('int32', '2'), {}, ['18-009']),
  unary('length ASCII', 'string.string-length', text('CalcWeave'), typed('uint32', '9'), {}, ['18-010']),
  toAscii, unary('parse f64 strict decimal', 'string.parse-number', text(' -1.25e2 '), typed('float64', -125), {}, ['18-012']),
  unary('parse enum label', 'string.parse-enum', text('On'), enumValue, {}, ['18-013']), substring,
  unary('To String fixed format', 'string.to-string', 1.25, text('1.25'), { format: '%.2f' }, ['18-016']),
  constant('source.typed', { kind: 'typed', dtype: 'fixed', fixed: { signed: true, wordLength: 64, fractionLength: 3 }, shape: [], data: ['9007199254740993'] }),
  constant('source.enum', enumValue), constant('source.signal', text('owned signal')),
];

const format = (name: string, value: SignalValue, pattern: string, expected: string): M15PythonFixture => unary(name, 'string.to-string', value, text(expected), { format: pattern });
const toEnd = unary('substring toEnd', 'string.substring', text('A😀B'), text('😀B'), { toEnd: 'yes' }); toEnd.model.nodes.push(literal('start', typed('uint32', '2'))); toEnd.model.edges.push(connect('start', 'operation', 'start'));
const scanZero = unary('scan retains matched prefix on zero policy', 'string.scan', text('7 junk'), typed('int32', '7'), { format: '%d %f', invalid: 'zero' }); scanZero.model.edges[1]!.source.portId = 'out1'; scanZero.model.nodes.push(block('second', 'sink.display')); scanZero.model.edges.push(connect('operation', 'second', 'in', 'out2')); scanZero.expected.second = typed('float32', 0);
const scanChar = unary('scan code point and LF double', 'string.scan', text('😀 -0'), text('😀'), { format: '%c %lf' }); scanChar.model.edges[1]!.source.portId = 'out1'; scanChar.model.nodes.push(block('second', 'sink.display')); scanChar.model.edges.push(connect('operation', 'second', 'in', 'out2')); scanChar.expected.second = typed('float64', '-0');
const asciiCompose = structuredClone(compose); asciiCompose.name = 'compose selected ASCII'; asciiCompose.model.nodes[0]!.parameters.value = text('speed'); asciiCompose.expected = { result: text('speed=9007199254740993 1.25 %') }; asciiCompose.sourceIds = ['18-003'];
const asciiSubstring = structuredClone(substring); asciiSubstring.name = 'substring selected ASCII'; asciiSubstring.model.nodes[0]!.parameters.value = text('ABCD'); asciiSubstring.expected = { result: text('BC') }; asciiSubstring.sourceIds = ['18-015'];
export const M15_PYTHON_BOUNDARY_FIXTURES: M15PythonFixture[] = [
  unary('parse f32', 'string.parse-number', text('0.1'), typed('float32', 0.10000000149011612), { dtype: 'float32' }, ['18-014']),
  unary('parse signed zero', 'string.parse-number', text('-0'), typed('float32', '-0'), { dtype: 'float32' }),
  ...(['NaN','Infinity','-Infinity'] as const).map(tag => unary(`parse ${tag}`, 'string.parse-number', text(tag), typed('float64', tag), { special: 'preserve' })),
  unary('invalid zero', 'string.parse-number', text('42junk'), typed('float64', 0), { invalid: 'zero' }),
  unary('ECMAScript BOM trim', 'string.parse-number', text('\ufeff 2 \ufeff'), typed('float64', 2)),
  unary('code point length', 'string.string-length', text('한😀é'), typed('uint32', '4')),
  pair('Unicode find code point', 'string.string-find', 'A😀BC', 'B', typed('int32', '3')),
  pair('missing find', 'string.string-find', 'ABC', 'X', typed('int32', '-1')),
  pair('empty count', 'string.string-count', '😀A', '', typed('uint32', '3')),
  pair('ASCII fold excludes nonASCII', 'string.string-compare', 'Ä', 'ä', false, { caseSensitive: 'no' }),
  unary('UTF16 exact bound', 'string.string-length', text('😀'.repeat(128)), typed('uint32', '128')),
  format('fixed exact stored integer conversion', { kind: 'typed', dtype: 'fixed', fixed: { signed: true, wordLength: 64, fractionLength: 3 }, shape: [], data: ['9007199254740993'] }, '%s', '1125899906842624.125'),
  format('fixed negative fraction length', { kind: 'typed', dtype: 'fixed', fixed: { signed: true, wordLength: 8, fractionLength: -3 }, shape: [], data: ['-2'] }, '%s', '-16'),
  format('uint64 exact conversion', { kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] }, '%s', '18446744073709551615'),
  format('enum to string', enumValue, '%s', 'On'), format('boolean to string', false, '%s', 'false'),
  format('decimal tie away positive', 1.25, '%.1f', '1.3'), format('decimal tie away negative', -1.25, '%.1f', '-1.3'),
  format('binary64 near decimal tie', 2.675, '%.2f', '2.67'),
  format('signedzero format', typed('float64', '-0'), '%.2f', '-0.00'),
  format('f represented large integer', 1e21, '%.2f', '1000000000000000000000.00'),
  format('e carry exponent', 9.99, '%.1e', '1.0e+01'),
  format('g small exponent', .000012345, '%.3g', '1.23e-05'),
  format('g carry scientific', 999.9, '%.3g', '1e+03'),
  format('g trailing zero trim', 1.2, '%.6g', '1.2'),
  toEnd, scanZero, scanChar,
  asciiCompose, asciiSubstring,
  ...([
    ['int8','-128'], ['uint8','255'], ['int16','-32768'], ['uint16','65535'],
    ['int32','-2147483648'], ['uint32','4294967295'], ['int64','-9223372036854775808'], ['uint64','18446744073709551615'],
  ] as const).map(([dtype,code]) => { const entry = format(`typed ${dtype} exact boundary`, {kind:'typed',dtype,shape:[],data:[code]}, '%s',code); entry.model.nodes[0]!.blockType='source.typed'; return entry; }),
  format('typed boolean leaf', {kind:'typed',dtype:'boolean',shape:[],data:[true]}, '%s','true'),
  format('typed f32 leaf', typed('float32',0.10000000149011612),'%.6g','0.1'),
  format('typed f64 special leaf', typed('float64','Infinity'),'%.2f','Infinity'),
  unary('ASCII capacity256', 'string.string-to-ascii', text('A'.repeat(256)), typed('uint8',Array(256).fill('65') as string[],[256]),{capacity:256}),
  { ...constant('source.signal',[[1,2],[3,4]]),name:'legacy source.signal matrix',model:{...constant('source.signal',[[1,2],[3,4]]).model,nodes:[{...literal('input',[[1,2],[3,4]]),unit:'m'},block('result','sink.display')]} },
  unary('inert source-looking string', 'string.to-string',text("__import__('os').system('false')\n%f \\\""),text("__import__('os').system('false')\n%f \\\""),{format:'%s'}),
];

export interface M15PythonFailureFixture { name: string; model: CalcModel; code: string; phase: 'runtime'|'target'; expectedSamples?: number }
const invalid = (name: string, input: SignalValue, code: string, parameters: Record<string, unknown> = {}): M15PythonFailureFixture => ({ name, model: unary(name, 'string.parse-number', input, 0, parameters).model, code, phase: 'runtime', expectedSamples: 0 });
const tooLong = pair('UTF16 concat overflow', 'string.string-concatenate', '😀'.repeat(128), 'A', text('')).model;
const delayed = unary('failure rollback after prior samples', 'string.to-string', 1, text(''), { format: '%u' }).model; delayed.nodes[0] = block('input', 'source.step', { before: 1, after: -1, stepTime: 1 }); delayed.execution = { mode: 'discrete', startTime: 0, stopTime: 2, step: .5 };
const rollback = structuredClone(delayed); rollback.nodes.push(block('matrix','source.constant',{value:[[3,4]]}),block('delay','discrete.unit-delay',{initial:[[-1,-2]]}),block('delay-result','sink.display')); rollback.edges.push(connect('matrix','delay'),connect('delay','delay-result'));
export const M15_PYTHON_FAILURE_FIXTURES: M15PythonFailureFixture[] = [
  invalid('decimal trailing junk', text('2x'), 'M13_NUMBER_PARSE'), invalid('reject unicode digits', text('１２'), 'M13_NUMBER_PARSE'),
  invalid('reject nonJS trim', text('\u001c2'), 'M13_NUMBER_PARSE'), invalid('overflow f64', text('1e999'), 'M13_NUMBER_PARSE'),
  invalid('underflow f64', text('1e-999'), 'M13_NUMBER_PARSE'), invalid('overflow f32', text('1e39'), 'M13_NUMBER_PARSE', { dtype: 'float32' }),
  invalid('underflow f32', text('1e-99'), 'M13_NUMBER_PARSE', { dtype: 'float32' }),
  { name: 'UTF16 concat overflow', model: tooLong, code: 'M13_STRING_BUDGET', phase: 'runtime', expectedSamples: 0 },
  { name: 'ASCII validates beyond NUL', model: unary('ASCII bad after NUL', 'string.ascii-to-string', typed('uint8', ['65','0','255'], [3]), text('')).model, code: 'M13_ASCII_RANGE', phase: 'runtime', expectedSamples: 0 },
  { name: 'ASCII short capacity', model: unary('ASCII short', 'string.string-to-ascii', text('AB'), 0, { capacity: 1 }).model, code: 'M13_ASCII_CAPACITY', phase: 'runtime', expectedSamples: 0 },
  { name: 'unpaired surrogate', model: unary('surrogate', 'string.string-length', text('\ud800'), 0).model, code: 'M13_UNICODE', phase: 'runtime', expectedSamples: 0 },
  { name: 'unknown enum', model: unary('enum unknown', 'string.parse-enum', text('Other'), enumValue).model, code: 'M13_ENUM_PARSE', phase: 'runtime', expectedSamples: 0 },
  { name: 'rollback midrun', model: delayed, code: 'M13_FORMAT_TYPE', phase: 'runtime', expectedSamples: 2 },
  { name: 'typed failure retains owned matrix state', model: rollback, code: 'M13_FORMAT_TYPE', phase: 'runtime', expectedSamples: 2 },
  { name: 'complex unsupported', model: constant('source.typed', { kind: 'typed', dtype: 'complex128', shape: [], data: [{ re: 1, im: 2 }] }).model, code: 'PYTHON_UNSUPPORTED_DTYPE', phase: 'target' },
  { name: 'nD typed unsupported', model: constant('source.signal', { kind: 'typed', dtype: 'int8', shape: [2], data: ['1','2'] }).model, code: 'PYTHON_UNSUPPORTED_SHAPE', phase: 'target' },
  { name: 'bus unsupported', model: constant('source.signal', { kind: 'bus', fields: [{ name: 'a', value: 1 }] }).model, code: 'PYTHON_UNSUPPORTED_DTYPE', phase: 'target' },
  { name: 'ASCII vector target limit257', model: constant('source.typed',{kind:'typed',dtype:'uint8',shape:[257],data:Array(257).fill('65') as string[]}).model,code:'PYTHON_UNSUPPORTED_SHAPE',phase:'target' },
];
