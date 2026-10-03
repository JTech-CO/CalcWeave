import type { CalcNode } from '../../model/src/types';
import type { BlockDefinition, ParameterDefinition } from './index';

export const M13_STRING_IDS = ['source.string-constant', 'string.ascii-to-string', 'string.compose', 'string.scan', 'string.string-compare', 'string.string-concatenate', 'string.string-contains', 'string.string-count', 'string.string-find', 'string.string-length', 'string.string-to-ascii', 'string.parse-number', 'string.parse-enum', 'string.substring', 'string.to-string'] as const;
export const M13_BLOCK_IDS = [...M13_STRING_IDS, 'dashboard.control', 'dashboard.indicator', 'dashboard.action', 'sink.record', 'sink.xy-graph', 'sink.floating-scope', 'sink.stop', 'signal.probe', 'math.slider-gain', 'data.output-file', 'data.output-dataset', 'data.input-table', 'data.signal-editor', 'source.waveform', 'model.support-catalog'] as const;
export type M13BlockType = typeof M13_BLOCK_IDS[number];
export const M13_RECORDING_IDS = ['sink.record', 'sink.xy-graph', 'sink.floating-scope', 'data.output-file', 'data.output-dataset'] as const;
export const M13_ACTIONS = ['run', 'pause', 'resume', 'stop', 'fit', 'export-model', 'export-results'] as const;
export const M13_CONTROL_KINDS = ['check-box', 'combo-box', 'edit', 'knob', 'push-button', 'radio-button', 'rocker-switch', 'rotary-switch', 'slider', 'slider-switch', 'toggle-switch'] as const;
const number = (label: string, value: number, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): ParameterDefinition => ({ kind: 'number', label, default: value, min, max });
const integer = (label: string, value: number, min: number, max: number): ParameterDefinition => ({ kind: 'integer', label, default: value, min, max });
const choice = (label: string, value: string, options: readonly string[]): ParameterDefinition => ({ kind: 'enum', label, default: value, options });
const text = (label: string, value: string, maximum = 256): ParameterDefinition => ({ kind: 'text', label, default: value, maxLength: maximum });
const json = (label: string, value: string, maximum = 16_384): ParameterDefinition => ({ kind: 'bounded-json', label, default: value, maxLength: maximum });
const vector = (label: string, value: number[], minimum = 0, maximum = 32): ParameterDefinition => ({ kind: 'numeric-vector', label, default: value, minLength: minimum, maxLength: maximum });
const modes = ['static', 'discrete', 'continuous'] as const;
const common = { version: 1, category: '문자열', inputs: ['in'], outputs: ['out'], parameters: {}, supportedModes: modes, directFeedthrough: true, valueType: 'inherited', shape: 'scalar', unit: 'dimensionless', sampleTime: 'inherited', state: 'none', exportTargets: ['typescript'] } as const;
const define = (id: M13BlockType, label: string, englishName: string, description: string, overrides: Partial<BlockDefinition> = {}): BlockDefinition => ({ ...common, id, label, englishName, description, ...overrides });
const sensitive = choice('대소문자', 'yes', ['yes', 'no']);
const appearance = { appearance: choice('외형', 'standard', ['standard', 'custom']), orientation: choice('방향', 'horizontal', ['horizontal', 'vertical']), title: text('표시 이름', '', 100) };
const events = json('시간·순서·값 이벤트 JSON', '[]');
const recording = { name: text('기록 이름', 'record', 64), capacity: integer('저장 샘플 상한', 128, 1, 1_024) };
const playback = { datasetId: text('데이터 ID', 'data', 64), column: text('값 열', 'value', 80), interpolation: choice('보간', 'previous', ['linear', 'previous']), outside: choice('범위 밖', 'hold', ['hold', 'zero', 'error']) };

export const M13_BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  define('source.string-constant', '문자열 상수', 'String Constant', '최대256 UTF-16 단위의 문자열 scalar를 보냅니다.', { inputs: [], directFeedthrough: false, sampleTime: 'constant', parameters: { value: text('문자열', 'CalcWeave') } }),
  define('string.ascii-to-string', 'ASCII를 문자열로', 'ASCII to String', 'uint8 vector의0~127 ASCII를 읽고 첫 NUL에서 종료합니다.'),
  define('string.compose', '문자열 형식 만들기', 'Compose String', '허용된 형식 토큰으로 최대8개 scalar 입력을 문자열로 합칩니다.', { inputs: ['arg1'], parameters: { format: text('형식', '%s') } }),
  define('string.scan', '문자열 형식 읽기', 'Scan String', '제한된 형식으로 문자열을 최대8개 typed scalar로 읽습니다.', { outputs: ['out1'], parameters: { format: text('형식', '%s'), invalid: choice('일치 실패', 'error', ['error', 'zero']) } }),
  define('string.string-compare', '문자열 같음', 'String Compare', '두 문자열의 전체 또는 처음N문자를 비교합니다.', { inputs: ['a', 'b'], parameters: { caseSensitive: sensitive, firstN: integer('처음 N문자 (0: 전체)', 0, 0, 256) } }),
  define('string.string-concatenate', '문자열 연결', 'String Concatenate', '입력 순서대로2~8개 문자열을 연결합니다.', { inputs: ['in1', 'in2'], parameters: { count: integer('입력 개수', 2, 2, 8) } }),
  define('string.string-contains', '문자열 포함', 'String Contains', '문자열에 지정 패턴이 있는지 확인합니다.', { inputs: ['in', 'pattern'], parameters: { caseSensitive: sensitive } }),
  define('string.string-count', '문자열 횟수', 'String Count', '겹치지 않는 패턴 출현 횟수를 셉니다.', { inputs: ['in', 'pattern'], parameters: { caseSensitive: sensitive } }),
  define('string.string-find', '문자열 찾기', 'String Find', '첫 일치 위치를1부터 계산하며 일치가 없으면−1을 보냅니다.', { inputs: ['in', 'pattern'], parameters: { caseSensitive: sensitive } }),
  define('string.string-length', '문자열 길이', 'String Length', 'Unicode code point 개수를 typed uint32 scalar로 보냅니다.'),
  define('string.string-to-ascii', '문자열을 ASCII로', 'String to ASCII', 'ASCII문자만 고정 크기 uint8 vector로 변환하고 NUL로 채웁니다.', { outputs: ['out', 'length'], shape: 'inherited', parameters: { capacity: integer('출력 크기', 128, 1, 256) } }),
  define('string.parse-number', '문자열 숫자 읽기', 'String to Number', '전체 문자열을 엄격하게 읽어 float64 또는 실제 float32로 변환합니다.', { parameters: { dtype: choice('자료형', 'float64', ['float64', 'float32']), invalid: choice('파싱 실패', 'error', ['error', 'zero']), special: choice('특수 IEEE 값', 'error', ['error', 'preserve']) } }),
  define('string.parse-enum', '문자열 Enum 읽기', 'String to Enum', '등록된 label만 정확히 같은 enum으로 변환합니다.', { parameters: { type: { kind: 'data-type', label: 'Enum 자료형', default: { dtype: 'enum', enum: { name: 'State', labels: ['Off', 'On'] } } } } }),
  define('string.substring', '문자열 일부', 'Substring', '1부터 시작하는 정수 위치에서 길이만큼 읽습니다. Unicode surrogate를 분리하지 않습니다.', { inputs: ['in', 'start', 'length'], parameters: { toEnd: choice('끝까지', 'no', ['no', 'yes']) } }),
  define('string.to-string', '값을 문자열로', 'To String', '승인된 scalar 숫자·boolean·enum·문자열을 제한된 형식으로 변환합니다.', { parameters: { format: text('숫자 형식', '%g') } }),
  define('dashboard.control', '대시보드 조작', 'Dashboard Control (Replay)', '유선 scalar 입력원과 시간 이벤트로 조작을 재현합니다. 원본의 포트 없는 변수 연결과 구분합니다.', { category: '대시보드', inputs: [], directFeedthrough: false, sampleTime: 'fixed-tick', parameters: { kind: choice('조작 방식', 'slider', M13_CONTROL_KINDS), initial: number('초기값', 0), min: number('최솟값', 0), max: number('최댓값', 1), step: number('조작 간격', .1, Number.MIN_VALUE), choices: vector('선택 값', [0, 1], 1), events, ...appearance } }),
  define('dashboard.indicator', '대시보드 표시', 'Dashboard Indicator', '값과 구간 index를 표시합니다. 외형은 실행 의미와 별도로 저장합니다.', { category: '대시보드', outputs: ['out', 'band'], parameters: { kind: choice('표시 방식', 'display', ['display', 'gauge', 'lamp', 'multi-state-image', 'scope']), min: number('최솟값', 0), max: number('최댓값', 1), thresholds: vector('구간 경계', [.5]), labels: json('구간 이름 JSON', '["낮음","높음"]', 2_048), gaugeStyle: choice('게이지', 'full', ['full', 'half', 'quarter', 'linear']), ...appearance } }),
  define('dashboard.action', '대시보드 작업', 'Dashboard Action (Allowlist)', '실행·일시정지·맞추기·내보내기만 실행하며 임의 코드 콜백을 받지 않습니다.', { category: '대시보드', inputs: [], directFeedthrough: false, sampleTime: 'fixed-tick', parameters: { action: choice('작업', 'run', M13_ACTIONS), events, ...appearance } }),
  define('sink.record', '신호 기록', 'Record (Bounded)', 'due 신호와 시각을 노드의 제한된 기록에 저장합니다.', { category: '결과', outputs: [], shape: 'inherited', state: 'discrete-state', sampleTime: 'fixed-tick', supportedModes: ['discrete', 'continuous'], parameters: recording }),
  define('sink.xy-graph', 'XY 기록', 'XY Graph', '동일 due 시각의 두 실수 scalar를 실제XY쌍으로 기록합니다.', { category: '결과', inputs: ['x', 'y'], outputs: [], state: 'discrete-state', sampleTime: 'fixed-tick', supportedModes: ['discrete', 'continuous'], parameters: recording }),
  define('sink.floating-scope', '연결 없는 Scope', 'Floating Scope (Selected)', '현재 그래프의 안전한 출력 참조를 compiler가 실제 관측 연결로 해석합니다.', { category: '결과', inputs: [], outputs: [], shape: 'inherited', parameters: { sourceNodeId: text('관측 블럭 ID', 'source', 64), sourcePortId: text('관측 포트', 'out', 64) } }),
  define('sink.stop', '실행 종료', 'Stop Simulation', '참인 입력을 완전하게 검증한 샘플에서 정상 종료하고 종료 원인을 기록합니다.', { category: '결과', outputs: [] }),
  define('signal.probe', '신호 사양', 'Probe', '실제 입력의 폭·rank·차원·복소수 여부·샘플 시간 metadata를 출력합니다.', { category: '신호 처리', shape: 'inherited' }),
  define('math.slider-gain', '조작 배율', 'Slider Gain (Replay)', '정해진 범위의 배율을 시간 이벤트로 갱신하고 숫자 신호에 곱합니다.', { category: '계산', shape: 'inherited', sampleTime: 'fixed-tick', parameters: { gain: number('배율', 1), min: number('최솟값', 0), max: number('최댓값', 10), step: number('조작 간격', .1, Number.MIN_VALUE), events } }),
  define('data.output-file', '파일로 기록', 'To File (Local)', '형상과 유형이 있는 제한된 기록을 명시적인 로컬JSON/CSV 다운로드에 연결합니다.', { category: '데이터', outputs: [], shape: 'inherited', state: 'discrete-state', sampleTime: 'fixed-tick', supportedModes: ['discrete', 'continuous'], parameters: { ...recording, format: choice('파일 형식', 'json', ['json', 'csv']) } }),
  define('data.output-dataset', '데이터셋으로 기록', 'To Dataset (Local)', '제한된 신호 기록을 이름 있는 로컬 프로젝트 데이터셋으로 보냅니다.', { category: '데이터', outputs: [], shape: 'inherited', state: 'discrete-state', sampleTime: 'fixed-tick', supportedModes: ['discrete', 'continuous'], parameters: recording }),
  define('data.input-table', '표 데이터 재생', 'From Table (Local)', '검증된 프로젝트 표의 열을 시각에 따라 재생하며 원본 hash를 보존합니다.', { category: '데이터', inputs: [], directFeedthrough: false, shape: 'inherited', parameters: playback }),
  define('data.signal-editor', '편집한 신호 재생', 'Signal Editor (Local)', '로컬에서 편집·검증한 이름 있는 시계열을 재생합니다.', { category: '데이터', inputs: [], directFeedthrough: false, shape: 'inherited', parameters: playback }),
  define('source.waveform', '파형 생성', 'Waveform Generator (Selected)', 'sine·square·triangle·sawtooth 파형을 유한한 매개변수로 생성합니다.', { category: '시간 입력', inputs: [], directFeedthrough: false, supportedModes: ['discrete', 'continuous'], sampleTime: 'solver-step', parameters: { kind: choice('파형', 'sine', ['sine', 'square', 'triangle', 'sawtooth']), amplitude: number('진폭', 1), frequency: number('주파수 (Hz)', 1, 0, 1e6), phase: number('위상 (rad)', 0), bias: number('오프셋', 0), duty: number('square 듀티', .5, 0, 1) } }),
  define('model.support-catalog', '실행 사양 표', 'Block Support Catalog (Local)', '현재 compiler registry의 정의 수·엔진·실행 모드 지원을 구조화해 보냅니다.', { category: '설명', inputs: [], directFeedthrough: false, shape: 'inherited', sampleTime: 'constant' }),
];

export interface M13FormatToken { literal?: string; kind?: 's' | 'c' | 'd' | 'u' | 'f' | 'e' | 'g'; precision?: number; dtype?: 'float32' | 'float64' | 'int32' | 'uint32' | 'string' }
/** A bounded format scanner. Formats are data; no dynamic regular expression or executable callback is constructed. */
export function parseM13Format(format: string, mode: 'compose' | 'scan'): M13FormatToken[] {
  if (typeof format !== 'string' || !format.length || format.length > 256) throw new Error('format length');
  const tokens: M13FormatToken[] = []; let literal = '', count = 0;
  const flush = (): void => { if (literal) { tokens.push({ literal }); literal = ''; } };
  for (let index = 0; index < format.length; index++) {
    if (format[index] !== '%') { literal += format[index]; continue; }
    if (format[index + 1] === '%') { literal += '%'; index++; continue; }
    flush(); let precision: number | undefined;
    if (mode === 'compose' && format[index + 1] === '.') { let digits = ''; index++; while (/^[0-9]$/.test(format[index + 1] ?? '')) digits += format[++index]; if (!digits.length || digits.length > 2) throw new Error('precision'); precision = Number(digits); }
    let double = false; if (mode === 'scan' && format[index + 1] === 'l') { double = true; index++; }
    const kind = format[++index] as M13FormatToken['kind'];
    if (!kind || !(mode === 'compose' ? ['s', 'd', 'u', 'f', 'e', 'g'] : ['s', 'c', 'd', 'u', 'f']).includes(kind) || double && kind !== 'f' || precision !== undefined && (!['f', 'e', 'g'].includes(kind) || precision > 17 || kind === 'g' && precision < 1) || ++count > 8) throw new Error('unsupported format');
    tokens.push({ kind, ...(precision === undefined ? {} : { precision }), ...(mode === 'scan' ? { dtype: kind === 's' || kind === 'c' ? 'string' : kind === 'd' ? 'int32' : kind === 'u' ? 'uint32' : double ? 'float64' : 'float32' } : {}) });
  }
  flush(); if (!count) throw new Error('at least one conversion'); return tokens;
}
export function getM13Ports(node: Pick<CalcNode, 'blockType' | 'parameters'>): { inputs: string[]; outputs: string[] } | undefined {
  if (node.blockType === 'string.compose' || node.blockType === 'string.scan') { let tokens: M13FormatToken[]; try { tokens = parseM13Format(String(node.parameters.format ?? '%s'), node.blockType === 'string.scan' ? 'scan' : 'compose'); } catch { return node.blockType === 'string.scan' ? { inputs: ['in'], outputs: ['out1'] } : { inputs: ['arg1'], outputs: ['out'] }; } const count = tokens.filter(token => token.kind).length; return node.blockType === 'string.scan' ? { inputs: ['in'], outputs: Array.from({ length: count }, (_, i) => `out${i + 1}`) } : { inputs: Array.from({ length: count }, (_, i) => `arg${i + 1}`), outputs: ['out'] }; }
  if (node.blockType === 'string.string-concatenate') { const value = node.parameters.count, count = typeof value === 'number' && Number.isSafeInteger(value) && value >= 2 && value <= 8 ? value : 2; return { inputs: Array.from({ length: count }, (_, i) => `in${i + 1}`), outputs: ['out'] }; }
  if (node.blockType === 'string.substring') return { inputs: ['in', 'start', ...(node.parameters.toEnd === 'yes' ? [] : ['length'])], outputs: ['out'] };
  return undefined;
}
