import { getBlockDefinition } from '../../../packages/block-library/src';
import { getDefinitionReference } from '../../../packages/block-library/src/m11';
import type { CalcNode } from '../../../packages/model/src';

export const HIERARCHY_MODES = [
  ['hierarchy.subsystem', '항상 실행 · 연결된 도식'], ['hierarchy.atomic', 'Atomic · 독립 실행 경계'],
  ['hierarchy.enabled', 'Enabled · enable 조건'], ['hierarchy.triggered', 'Triggered · trigger 변화'],
  ['hierarchy.enabled-triggered', 'Enabled + Triggered'], ['hierarchy.resettable', 'Resettable · reset 신호'],
  ['hierarchy.action', 'Action · action 조건'], ['hierarchy.function-call', 'Function Call · 호출 횟수'],
  ['hierarchy.for-iterator', 'For · 지정 횟수 반복'], ['hierarchy.while-iterator', 'While · 조건 반복'],
  ['hierarchy.for-each', 'For Each · 배열 요소별 실행'], ['hierarchy.variant', 'Variant · 정의 선택'],
  ['hierarchy.array-processing', 'Array · 배열 축 실행'], ['hierarchy.neighborhood-processing', 'Neighborhood · 이웃 창 실행'], ['hierarchy.pixel-processing', 'Pixel · 위치별 실행'],
  ['functions.call', 'Local Function · 지역 정의 호출'], ['functions.initialize', 'Initialize · 첫 경계 호출'], ['functions.reinitialize', 'Reinitialize · 상태 초기화 호출'], ['functions.reset', 'Reset Function · reset 경계 호출'], ['functions.terminate', 'Terminate · 마지막 경계 호출'], ['functions.element', 'Function Element · 지역 정의 선언'],
] as const;

export const HIERARCHY_MODE_HELP: Readonly<Record<string, string>> = {
  'hierarchy.subsystem': '연결한 외부 신호를 내부 도식에 전달합니다. 더블클릭하거나 하위 도식 열기로 내부를 편집하세요.',
  'hierarchy.atomic': '하나의 실행 경계에서 내부 도식을 계산합니다. 같은 정의를 여러 번 배치해도 각 인스턴스의 상태를 따로 보존합니다.',
  'hierarchy.enabled': 'enable이 양수일 때 실행합니다. 다시 활성화될 때의 상태와 비활성 출력 동작은 아래 설정에서 선택합니다.',
  'hierarchy.triggered': 'trigger 신호의 양수 여부가 지정한 방향으로 바뀔 때 한 번 실행합니다. 초기 이전 trigger는 0이므로 첫 양수 입력도 rising 호출합니다. 다른 tick에는 마지막 출력을 유지합니다.',
  'hierarchy.enabled-triggered': 'enable이 양수이며 trigger에 지정한 변화가 있을 때 실행합니다. 활성화 상태와 trigger 조건을 함께 확인하세요.',
  'hierarchy.resettable': 'boolean reset 조건에서 내부 상태를 초기화한 뒤 현재 호출을 실행합니다. rising은 false → true, level은 true인 각 tick에 적용합니다. 수치 신호는 비교 블록으로 boolean 조건을 만들어 연결하세요.',
  'hierarchy.action': 'action이 true일 때 실행하고 나머지 tick에는 출력을 유지합니다.',
  'hierarchy.function-call': 'call 입력의 정수 횟수만큼 같은 tick에서 실행합니다. 0은 호출하지 않으며 한 tick의 호출 횟수는 최대 64입니다.',
  'hierarchy.for-iterator': '한 tick에서 지정 횟수만큼 반복합니다. 내부 iteration 입력은 0부터 시작하는 반복 번호를 받고 외부 연결에서 제외됩니다.',
  'hierarchy.while-iterator': '외부 condition이 true일 때 반복을 시작하고, 내부 continue boolean 출력으로 다음 반복을 결정합니다. 반복 상한에서 계속 요청하면 진단합니다.',
  'hierarchy.for-each': '선택한 축의 배열 요소를 각각 실행합니다. 내부 정의는 입력과 출력이 하나씩 필요하며 분할 수는 최대 64입니다.',
  'hierarchy.variant': '실행 전에 첫 번째 또는 두 번째 정의를 선택합니다. 두 정의의 외부 포트 계약이 같아야 하며 선택하지 않은 정의는 실행하지 않습니다. 한 실행 안에서의 동적 전환은 후속 지원 범위입니다.',
  'hierarchy.array-processing': '선택한 축의 slice를 내부 정의로 처리한 뒤 같은 축으로 결과를 결합합니다.',
  'hierarchy.neighborhood-processing': '2D의 각 위치에 이웃 창을 만들고 내부 정의의 스칼라 결과를 결합합니다. 창 크기와 경계 처리 방식을 아래에서 지정하세요.',
  'hierarchy.pixel-processing': '2D의 각 스칼라 위치를 따로 실행합니다. 각 위치의 내부 상태는 독립적으로 유지합니다.',
  'functions.call': '명시한 입출력 계약으로 지역 정의를 호출합니다. 각 인스턴스는 내부 상태를 독립적으로 유지합니다.',
  'functions.initialize': '첫 due 경계에서 한 번 호출한 뒤 마지막 출력을 유지합니다.',
  'functions.reinitialize': 'reset의 상승 변화에서 내부 상태를 초기화한 뒤 지역 정의를 호출합니다.',
  'functions.reset': 'reset의 상승 변화에서 지역 정의를 호출하고 다른 due에는 마지막 출력을 유지합니다.',
  'functions.terminate': '모델에 선언한 마지막 due 경계에서 호출합니다. 계산 취소나 브라우저 종료 때 실행하는 hook은 아닙니다.',
  'functions.element': '지역 정의 ID·버전·이름을 선언합니다. 이 선언에는 데이터 입출력 연결이 없습니다.',
};

/** Switch only registered modes, preserving matching settings and the currently edited definition. */
export function changeHierarchyMode(node: CalcNode, blockType: string): CalcNode {
  if (!HIERARCHY_MODES.some(([id]) => id === blockType)) throw new Error('하위 도식 실행 방식을 선택하세요.');
  const definition = getBlockDefinition(blockType), reference = getDefinitionReference(node);
  if (!definition || !reference) throw new Error('하위 도식 정의를 먼저 선택하세요.');
  const parameters = Object.fromEntries(Object.entries(definition.parameters).map(([key, parameter]) => [key, Object.hasOwn(node.parameters, key) ? node.parameters[key] : structuredClone(parameter.default)]));
  parameters.definitionId = reference.definitionId; parameters.version = reference.version;
  if (blockType === 'hierarchy.variant' && node.blockType !== blockType) {
    parameters.alternateDefinitionId = reference.definitionId; parameters.alternateVersion = reference.version; parameters.active = 'first';
  }
  return { ...node, blockType, parameters };
}
