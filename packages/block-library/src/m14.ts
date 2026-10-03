import type { CalcNode } from '../../model/src/types';
import type { BlockDefinition, ParameterDefinition } from './index';

export const M14_BLOCK_IDS = ['adapter.wasm-affine', 'adapter.wasm-accumulator', 'adapter.entity-transport'] as const;
const number = (label: string, value: number): ParameterDefinition => ({ kind: 'number', label, default: value });
const integer = (label: string, value: number, min: number, max: number): ParameterDefinition => ({ kind: 'integer', label, default: value, min, max });
const choice = (label: string, value: string, options: readonly string[]): ParameterDefinition => ({ kind: 'enum', label, default: value, options });
const common = { version: 1, category: '확장 실행', inputs: ['in'], outputs: ['out'], parameters: {}, supportedModes: ['static', 'discrete', 'continuous'], directFeedthrough: true, valueType: 'float64', shape: 'scalar', unit: 'dimensionless', sampleTime: 'inherited', state: 'none', exportTargets: ['typescript'] } as const;
export const M14_BLOCK_DEFINITIONS: readonly BlockDefinition[] = [
  { ...common, id: 'adapter.wasm-affine', label: '고정 WASM 선형식', englishName: 'Trusted WASM Affine', description: '고정 SHA·ABI의 자체 f64 WASM으로 입력×gain+bias를 계산합니다. 임의 C/코드를 실행하지 않습니다.', parameters: { gain: number('배율', 1), bias: number('오프셋', 0) } },
  { ...common, id: 'adapter.wasm-accumulator', label: '고정 WASM 누산기', englishName: 'Trusted WASM Accumulator', description: '순수 WASM lifecycle과 외부 JSON 상태로 샘플별 누산·초기화·종료를 수행합니다. 루트 이산 실행만 지원합니다.', inputs: ['in', 'reset'], supportedModes: ['discrete'], directFeedthrough: true, sampleTime: 'fixed-tick', state: 'discrete-state', parameters: { initial: number('초기 상태', 0), gain: number('샘플별 증분 배율', 1), resetMode: choice('초기화', 'rising', ['rising', 'level']) } },
  { ...common, id: 'adapter.entity-transport', label: '메시지 FIFO 운송', englishName: 'Message FIFO Transport (Alternative)', description: '제한된 메시지 FIFO를 고정 마감 due tick까지 보관합니다. SimEvents 엔터티·운송 적분의 독립 대체입니다.', inputs: ['in', 'delay'], outputs: ['out', 'count'], valueType: 'inherited', supportedModes: ['discrete'], sampleTime: 'fixed-tick', state: 'discrete-state', parameters: { capacity: integer('보관 메시지 상한', 32, 1, 64), overflow: choice('초과 처리', 'error', ['error', 'drop-newest', 'drop-oldest']), maxRelease: integer('한 due 최대 방출', 64, 1, 64) } },
];
export function getM14DirectFeedthroughPorts(node: Pick<CalcNode, 'blockType' | 'parameters'>): string[] | undefined {
  if (node.blockType === 'adapter.wasm-accumulator') return ['reset'];
  if (node.blockType === 'adapter.entity-transport') return ['in', 'delay'];
  if (node.blockType === 'adapter.wasm-affine') return ['in'];
  return undefined;
}
