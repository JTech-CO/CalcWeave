import type { BlockType, CalcModel, CalcNode } from '../../model/src/types';
import type { BlockDefinition, ParameterDefinition } from './index';

export const M11_SCOPE_BLOCK_IDS = [
  'hierarchy.atomic', 'hierarchy.enabled', 'hierarchy.triggered', 'hierarchy.enabled-triggered', 'hierarchy.resettable',
  'hierarchy.action', 'hierarchy.function-call', 'hierarchy.for-iterator', 'hierarchy.while-iterator', 'hierarchy.for-each', 'hierarchy.variant',
  'hierarchy.array-processing', 'hierarchy.neighborhood-processing', 'hierarchy.pixel-processing',
  'functions.call', 'functions.initialize', 'functions.reinitialize', 'functions.reset', 'functions.terminate',
] as const;
export const M11_BLOCK_IDS = [
  'source.signal', ...M11_SCOPE_BLOCK_IDS, 'functions.element', 'functions.typed', 'hierarchy.if', 'hierarchy.switch-case',
  'route.structured-bus', 'route.structured-select', 'route.structured-assign',
  'events.send', 'events.queue', 'events.receive', 'events.message-merge', 'events.function-call-generator', 'events.function-call-split', 'events.feedback-latch', 'events.hit-scheduler',
  'route.merge', 'route.goto', 'route.from', 'route.tag-visibility', 'route.data-store-memory', 'route.data-store-read', 'route.data-store-write',
  'state.reader', 'state.writer', 'state.parameter-writer', 'sink.sequence-viewer', 'io.structured-input', 'io.structured-output',
] as const;
export type M11BlockType = typeof M11_BLOCK_IDS[number];
const integer = (label: string, value: number, min: number, max: number): ParameterDefinition => ({ kind: 'integer', label, default: value, min, max });
const text = (label: string, value: string, maxLength = 64): ParameterDefinition => ({ kind: 'text', label, default: value, maxLength });
const choice = (label: string, value: string, options: readonly string[]): ParameterDefinition => ({ kind: 'enum', label, default: value, options });
const signal = (label: string, value: unknown = 0): ParameterDefinition => ({ kind: 'signal-value', label, default: value });
const reference = { definitionId: text('정의 ID', 'subsystem'), version: integer('정의 버전', 1, 1, 1_000_000) };
const initialOutputs = text('출력 초기값 JSON', '{}', 8_192);
const disabledOutput = choice('비활성 출력', 'hold', ['hold', 'reset']);
const stateOnEnable = choice('재활성 상태', 'hold', ['hold', 'reset']);
const trigger = choice('트리거 에지', 'rising', ['rising', 'falling', 'either']);
const iterationPort = text('반복 인덱스 입력', 'iteration');
const statePerIteration = choice('반복 상태', 'carry', ['carry', 'reset']);
const count = integer('입력 수', 2, 2, 8);
const common = { version: 1, inputs: ['in'], outputs: ['out'], parameters: {}, category: '계층', supportedModes: ['static', 'discrete', 'continuous'], directFeedthrough: true, valueType: 'inherited', shape: 'inherited', unit: 'inherited', sampleTime: 'inherited', state: 'none', exportTargets: ['typescript'] } as const;
const define = (id: M11BlockType, label: string, englishName: string, description: string, overrides: Partial<BlockDefinition> = {}): BlockDefinition => ({ ...common, id: id as BlockType, label, englishName, description, ...overrides });
const scope = (id: typeof M11_SCOPE_BLOCK_IDS[number], label: string, englishName: string, description: string, parameters: Record<string, ParameterDefinition> = {}): BlockDefinition => define(id, label, englishName, description, { inputs: [], outputs: [], supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', state: 'discrete-state', parameters: { ...reference, initialOutputs, disabledOutput, ...parameters } });
const named = { name: text('이름', 'shared'), scope: choice('이름 범위', 'local', ['local', 'scoped', 'global']) };
const order = integer('실행 우선순위', 0, -1_000, 1_000);

export const M11_BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  define('source.signal', '구조화 상수', 'Structured Constant', '자료형·버스·메시지를 보존하는 검증된 JSON 신호입니다.', { category: '입력', inputs: [], directFeedthrough: false, sampleTime: 'constant', parameters: { value: signal('신호 값') } }),
  scope('hierarchy.atomic', '원자 실행', 'Atomic Subsystem', '정의를 독립 상태 bank에서 실행하고 호출 전체를 원자적으로 commit합니다.'),
  scope('hierarchy.enabled', '조건 실행', 'Enabled Subsystem', 'enable>0인 due에만 실행합니다. 비활성 상태와 재활성 초기화를 분리합니다.', { stateOnEnable }),
  scope('hierarchy.triggered', '에지 실행', 'Triggered Subsystem', '선택 에지에서만 정의를 실행하고 다른 due에는 상태와 출력을 유지합니다.', { trigger }),
  scope('hierarchy.enabled-triggered', '조건·에지 실행', 'Enabled and Triggered Subsystem', 'enable>0이면서 선택 trigger 에지인 due에 실행합니다.', { trigger, stateOnEnable }),
  scope('hierarchy.resettable', '초기화 실행', 'Resettable Subsystem', '선택 reset 경계에서 자식 상태를 초기화한 뒤 현재 호출을 실행합니다.', { resetMode: choice('초기화 조건', 'rising', ['rising', 'level']) }),
  scope('hierarchy.action', '분기 실행', 'Action Subsystem', 'boolean action이 true인 due에 정의를 실행합니다.', { stateOnEnable }),
  scope('hierarchy.function-call', '호출 실행', 'Function-Call Subsystem', '0~64의 call 횟수만큼 같은 시각에서 출력과 상태를 순차 전진시킵니다.'),
  scope('hierarchy.for-iterator', '횟수 반복', 'For Iterator Subsystem', '0~64회의 제한 반복입니다. 부모 시각을 전진시키지 않고 반복마다 상태를 commit합니다.', { count: integer('반복 횟수', 4, 0, 64), iterationPort, statePerIteration }),
  scope('hierarchy.while-iterator', '조건 반복', 'While Iterator Subsystem', '초기 condition과 자식 continue 출력으로 제한 반복합니다. 상한에서 조건이 true면 진단합니다.', { maxIterations: integer('반복 상한', 16, 1, 64), conditionOutput: text('다음 조건 출력', 'continue'), iterationPort, statePerIteration }),
  scope('hierarchy.for-each', '축별 실행', 'For Each Subsystem', '한 축의 단일 원소 partition마다 독립 persistent 상태 bank를 사용합니다. 최대64 partition입니다.', { axis: integer('분할 축', 0, 0, 7) }),
  scope('hierarchy.variant', '정의 선택', 'Variant Subsystem', '두 정의 중 선택한 정의만 실행합니다. 비활성 정의의 계산·상태·부작용을 실행하지 않습니다.', { alternateDefinitionId: text('두 번째 정의 ID', 'alternative'), alternateVersion: integer('두 번째 정의 버전', 1, 1, 1_000_000), active: choice('선택 정의', 'first', ['first', 'second']) }),
  scope('hierarchy.array-processing', '배열 축 실행', 'Array Processing (Selected)', '선택 축의 slice를 실제 자식 정의로 처리하고 결과를 결합합니다.', { axis: integer('처리 축', 0, 0, 7) }),
  scope('hierarchy.neighborhood-processing', '이웃 창 실행', 'Neighborhood Processing (Selected)', '2D의 각 위치에 실제 이웃 창을 만들고 자식 scalar 결과를 조립합니다.', { window: integer('창 크기', 3, 1, 7), boundary: choice('배열 경계', 'clamp', ['clamp', 'wrap', 'zero']) }),
  scope('hierarchy.pixel-processing', '픽셀별 실행', 'Pixel Processing (Selected)', '2D의 각 scalar 위치를 독립 자식 상태 bank로 처리합니다.'),
  scope('functions.call', '지역 함수 호출', 'Local Function Caller', '정의의 명시 입출력 ABI를 호출합니다. 외부 MATLAB 코드나 재귀를 실행하지 않습니다.'),
  scope('functions.initialize', '초기 실행 함수', 'Initialize Function (Selected)', '첫 due에 한 번 실제 정의를 호출합니다.'),
  scope('functions.reinitialize', '재초기화 함수', 'Reinitialize Function (Selected)', 'reset의 rising에서 독립 상태를 초기화하고 정의를 호출합니다.'),
  scope('functions.reset', '초기화 함수', 'Reset Function (Selected)', 'reset의 rising에서 정의를 호출하고 다른 due에는 유지합니다.'),
  scope('functions.terminate', '종료 경계 함수', 'Terminate Function (Selected)', '선언된 마지막 due 경계에 정의를 호출합니다. 임의 취소·호스트 종료 hook과 구분합니다.'),
  define('functions.element', '지역 함수 정의', 'Function Element (Selected)', '정의 참조와 이름의 지역 선언을 검증합니다.', { inputs: [], outputs: [], directFeedthrough: false, parameters: { ...reference, name: text('함수 이름', 'function') } }),
  define('functions.typed', '안전한 수식 함수', 'Expression Function (Alternative)', '검증된 scalar 수식 AST를 계산합니다. MATLAB 언어 실행과 구분합니다.', { category: '계산', parameters: { expression: { kind: 'expression', label: '수식', default: 'x * x', maxLength: 500 } } }),
  define('hierarchy.if', '조건 분기', 'If (Selected)', 'scalar 입력을 임계값과 비교하여 상호 배타적인 action 출력을 만듭니다.', { outputs: ['then', 'else'], parameters: { comparison: choice('비교', 'gt', ['gt', 'ge', 'lt', 'le', 'eq', 'ne']), threshold: { kind: 'number', label: '임계값', default: 0, min: -Number.MAX_VALUE, max: Number.MAX_VALUE } } }),
  define('hierarchy.switch-case', '값 분기', 'Switch Case (Selected)', '고유한 유한 scalar case 중 하나 또는 default action을 만듭니다.', { outputs: [], parameters: { cases: { kind: 'numeric-vector', label: 'Case 값', default: [0, 1], minLength: 1, maxLength: 8 } } }),
  define('route.structured-bus', '구조화 버스', 'Structured Bus Creator', '최대16개의 이종·중첩 신호를 순서가 있는 고유 필드로 묶습니다.', { category: '신호 처리', inputs: [], parameters: { count: integer('필드 수', 2, 1, 16), fields: text('필드 이름 JSON', '["a","b"]', 2_048) } }),
  define('route.structured-select', '버스 경로 선택', 'Structured Bus Selector', 'dot 경로의 실제 신호를 descriptor와 함께 선택합니다.', { category: '신호 처리', parameters: { field: text('필드 경로', 'a', 512) } }),
  define('route.structured-assign', '버스 필드 대입', 'Structured Bus Assignment', '같은 descriptor의 값을 기존 버스 경로에 방어 복사하여 대입합니다.', { category: '신호 처리', inputs: ['in', 'value'], parameters: { field: text('필드 경로', 'a', 512) } }),
  define('events.send', '메시지 발행', 'Send (Selected)', 'send=true인 due에 payload를 고유 producer/sequence/time/priority 메시지로 발행합니다.', { category: '메시지', inputs: ['payload', 'send'], supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', state: 'discrete-state', parameters: { producer: text('발행자 ID', 'sender'), priority: integer('우선순위', 0, -1_000_000, 1_000_000) } }),
  define('events.queue', '메시지 큐', 'Queue (Selected)', '기존 큐에서 읽고 dequeue한 뒤 새 메시지를 enqueue합니다. 낮은 priority와 안정 arrival 순서를 따릅니다.', { category: '메시지', inputs: ['in', 'receive'], outputs: ['out', 'size'], supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', state: 'discrete-state', parameters: { capacity: integer('저장 개수', 16, 1, 128), maxDequeue: integer('한 번에 꺼내기', 1, 1, 64), overflow: choice('가득 찬 큐', 'error', ['error', 'drop-newest', 'drop-oldest']) } }),
  define('events.receive', '메시지 읽기', 'Receive (Selected)', 'batch의 첫 payload를 읽고 빈 batch에서는 이전 값을 유지합니다.', { category: '메시지', inputs: ['in'], outputs: ['out', 'valid'], supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', state: 'discrete-state', parameters: { initial: signal('초기 payload') } }),
  define('events.message-merge', '메시지 결합', 'Message Merge (Selected)', '동일 payload descriptor의 batch들을 priority·입력 arrival 순서로 결합합니다.', { category: '메시지', inputs: [], parameters: { count } }),
  define('events.function-call-generator', '호출 생성', 'Function-Call Generator (Selected)', 'due마다 지정한 count를 호출 신호로 출력합니다.', { category: '제어', inputs: [], directFeedthrough: false, supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', parameters: { count: integer('호출 횟수', 1, 1, 64) } }),
  define('events.function-call-split', '호출 분배', 'Function-Call Split (Selected)', '검증된 call count를 명시 출력 순서로 분배합니다.', { category: '제어', outputs: [], parameters: { count } }),
  define('events.feedback-latch', '호출 피드백 유지', 'Function-Call Feedback Latch (Selected)', '현재 입력을 commit하고 다음 due에서 이전 값을 읽습니다. 이종 버스 leaf 단위나 빈 메시지 payload schema는 초기 metadata JSON으로 선언합니다.', { category: '제어', directFeedthrough: false, supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', state: 'discrete-state', parameters: { initial: signal('초기 신호'), initialDescriptor: text('초기 metadata JSON', 'null', 8_192) } }),
  define('events.hit-scheduler', '호출 시각 예약', 'Hit Scheduler (Grid Alternative)', '지정 시각의 고정 due-grid에서 call을 발행합니다. arbitrary-time solver 사건과 구분합니다.', { category: '제어', inputs: [], directFeedthrough: false, supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', state: 'discrete-state', parameters: { times: { kind: 'numeric-vector', label: '예약 시각', default: [0, 1], minLength: 0, maxLength: 64 }, count: integer('호출 횟수', 1, 1, 64) } }),
  define('route.merge', '조건 출력 병합', 'Conditional Merge (Selected)', '실제 conditional publication만 병합하고 같은 due의 동시 writer는 진단합니다.', { category: '신호 처리', inputs: [], supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', state: 'discrete-state', parameters: { count, initial: signal('초기 신호') } }),
  define('route.goto', '이름 연결 보내기', 'Goto (Scoped)', 'compiler가 scope와 tag의 유일한 생산자를 연결합니다.', { category: '신호 처리', outputs: [], parameters: named }),
  define('route.from', '이름 연결 받기', 'From (Scoped)', '동일 scope의 Goto descriptor와 실제 값을 읽습니다.', { category: '신호 처리', inputs: [], parameters: named }),
  define('route.tag-visibility', '이름 연결 범위', 'Goto Tag Visibility (Selected)', 'scoped tag의 lexical owner를 선언합니다.', { category: '신호 처리', inputs: [], outputs: [], directFeedthrough: false, parameters: { name: text('이름', 'shared') } }),
  define('route.data-store-memory', '지역 데이터 저장소', 'Data Store Memory (Selected)', '명시 범위와 정확한 초기 신호로 저장소를 선언합니다.', { category: '데이터', inputs: [], outputs: [], directFeedthrough: false, supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', state: 'discrete-state', parameters: { ...named, initial: signal('초기 신호') } }),
  define('route.data-store-read', '지역 데이터 읽기', 'Data Store Read (Selected)', '명시 순서의 frame journal에서 저장소를 읽습니다.', { category: '데이터', inputs: [], supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', parameters: { ...named, order } }),
  define('route.data-store-write', '지역 데이터 쓰기', 'Data Store Write (Selected)', '동일 descriptor의 값을 frame journal에 staged write합니다.', { category: '데이터', outputs: [], supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', parameters: { ...named, order } }),
  define('state.reader', '상태 읽기', 'State Reader (Selected Slots)', '승인된 local state slot을 읽습니다. 임의 runtime 객체를 노출하지 않습니다.', { category: '데이터', inputs: [], supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', parameters: { target: text('대상 블럭 ID', 'delay'), slot: choice('상태 슬롯', 'value', ['value']), order } }),
  define('state.writer', '상태 쓰기', 'State Writer (Selected Slots)', '승인된 shape-invariant state slot에 staged write합니다.', { category: '데이터', outputs: [], supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', parameters: { target: text('대상 블럭 ID', 'delay'), slot: choice('상태 슬롯', 'value', ['value']), order } }),
  define('state.parameter-writer', '실행 값 쓰기', 'Parameter Writer (Selected)', '승인된 shape-invariant value/gain runtime overlay만 갱신합니다.', { category: '데이터', outputs: [], supportedModes: ['discrete', 'continuous'], sampleTime: 'fixed-tick', parameters: { target: text('대상 블럭 ID', 'constant'), parameter: choice('실행 값', 'value', ['value', 'gain']), order } }),
  define('sink.sequence-viewer', '메시지 시퀀스', 'Sequence Viewer (Selected)', 'bounded raw message batch를 시간 표본으로 기록합니다.', { category: '결과', outputs: [] }),
  define('io.structured-input', '구조화 입력', 'Structured Inport', '구조화 정의의 입력 경계와 검증된 독립 입력을 제공합니다.', { category: '입력', inputs: [], directFeedthrough: false, sampleTime: 'constant', parameters: { value: signal('입력 신호') } }),
  define('io.structured-output', '구조화 출력', 'Structured Outport', '구조화 신호를 손실 없이 결과 또는 정의 경계로 기록합니다.', { category: '결과', outputs: [] }),
];

export const isM11ScopeBlock = (id: string): id is typeof M11_SCOPE_BLOCK_IDS[number] => (M11_SCOPE_BLOCK_IDS as readonly string[]).includes(id);
export function isDefinitionReference(node: Pick<CalcNode, 'blockType'>): boolean { return node.blockType === 'hierarchy.subsystem' || isM11ScopeBlock(node.blockType) || node.blockType === 'functions.element'; }
export interface DefinitionReference { definitionId: string; version: number }
export function getDefinitionReferences(node: Pick<CalcNode, 'blockType' | 'parameters'>): DefinitionReference[] {
  if (!isDefinitionReference(node)) return [];
  const { definitionId, version, alternateDefinitionId, alternateVersion } = node.parameters;
  const references: DefinitionReference[] = typeof definitionId === 'string' ? [{ definitionId, version: typeof version === 'number' ? version : 1 }] : [];
  if (node.blockType === 'hierarchy.variant' && typeof alternateDefinitionId === 'string') references.push({ definitionId: alternateDefinitionId, version: typeof alternateVersion === 'number' ? alternateVersion : 1 });
  return references;
}
export function getDefinitionReference(node: Pick<CalcNode, 'blockType' | 'parameters'>): DefinitionReference | undefined {
  return getDefinitionReferences(node)[node.blockType === 'hierarchy.variant' && node.parameters.active === 'second' ? 1 : 0];
}
export function getM11ControlPorts(node: Pick<CalcNode, 'blockType'>): string[] {
  switch (node.blockType) {
    case 'hierarchy.enabled': return ['enable'];
    case 'hierarchy.triggered': return ['trigger'];
    case 'hierarchy.enabled-triggered': return ['enable', 'trigger'];
    case 'hierarchy.resettable': case 'functions.reset': case 'functions.reinitialize': return ['reset'];
    case 'hierarchy.action': return ['action'];
    case 'hierarchy.function-call': return ['call'];
    case 'hierarchy.while-iterator': return ['condition'];
    default: return [];
  }
}
export function getM11Ports(node: Pick<CalcNode, 'blockType' | 'parameters'>, context?: Pick<CalcModel, 'subsystems'>): { inputs: string[]; outputs: string[] } | undefined {
  const bounded = (value: unknown, fallback: number, maximum: number): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= maximum ? value : fallback;
  if (isM11ScopeBlock(node.blockType)) {
    const reference = getDefinitionReference(node), definition = context?.subsystems?.find(item => item.id === reference?.definitionId);
    const automatic = node.blockType === 'hierarchy.for-iterator' || node.blockType === 'hierarchy.while-iterator' ? String(node.parameters.iterationPort ?? 'iteration') : undefined;
    const hiddenOutput = node.blockType === 'hierarchy.while-iterator' ? String(node.parameters.conditionOutput ?? 'continue') : undefined;
    return { inputs: [...(definition?.inputs.filter(port => port.id !== automatic).map(port => port.id) ?? []), ...getM11ControlPorts(node)], outputs: definition?.outputs.filter(port => port.id !== hiddenOutput).map(port => port.id) ?? [] };
  }
  if (['route.structured-bus', 'events.message-merge', 'route.merge'].includes(node.blockType)) return { inputs: Array.from({ length: bounded(node.parameters.count, 2, node.blockType === 'route.structured-bus' ? 16 : 8) }, (_, index) => `in${index + 1}`), outputs: ['out'] };
  if (node.blockType === 'events.function-call-split') return { inputs: ['in'], outputs: Array.from({ length: bounded(node.parameters.count, 2, 8) }, (_, index) => `out${index + 1}`) };
  if (node.blockType === 'hierarchy.switch-case') return { inputs: ['in'], outputs: [...Array.from({ length: Array.isArray(node.parameters.cases) && node.parameters.cases.length >= 1 && node.parameters.cases.length <= 8 ? node.parameters.cases.length : 2 }, (_, index) => `case${index + 1}`), 'default'] };
  return undefined;
}
export function getM11DirectFeedthroughPorts(node: Pick<CalcNode, 'blockType' | 'parameters'>): string[] | undefined {
  if (isM11ScopeBlock(node.blockType)) {
    const program = node.parameters.scopeProgram as { directFeedthroughPorts?: string[] } | undefined;
    return program?.directFeedthroughPorts ? [...program.directFeedthroughPorts] : getM11ControlPorts(node);
  }
  if (node.blockType === 'route.from') return ['in'];
  return undefined;
}
