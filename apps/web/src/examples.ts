import type { CalcModel, CalcNode } from '../../../packages/model/src/types';
import { getBlockDefinition } from '../../../packages/block-library/src';
import { importDataset } from '../../../packages/data/src';
import { createSubsystemFromSelection } from '../../../packages/compiler/src/hierarchy';
import { createM11Examples } from './m11-examples';
import { createM12Examples } from './m12-examples';

function node(id: string, blockType: string, label: string, parameters: Record<string, unknown>, unit?: string): CalcNode {
  return { id, blockType, blockVersion: 1, label, parameters, ...(unit ? { unit } : {}) };
}
function edge(id: string, source: string, target: string, portId: string) {
  return { id, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId } };
}
function rated(block: CalcNode, period: number, offset = 0): CalcNode { return { ...block, sampleTime: { period, offset } }; }
export const EXAMPLE_CATEGORIES = [
  { id: 'basics', label: '기초 계산', description: '값·수식·배열·단위부터 시작합니다.' },
  { id: 'signals', label: '신호 입력', description: '난수·주파수 스윕과 시간에 따른 곡선을 관찰합니다.' },
  { id: 'discrete', label: '이산 신호와 상태', description: '지연·필터·샘플시간과 반복 신호를 확인합니다.' },
  { id: 'continuous', label: '연속·혼합 시뮬레이션', description: '적분·제어·이벤트와 solver 설정을 살펴봅니다.' },
  { id: 'workspace', label: '데이터와 도식 관리', description: '데이터 재생·이름 있는 신호·하위 도식을 다룹니다.' },
  { id: 'advanced', label: '행렬·표·양자화', description: '행렬 풀이·표 보간·저장 정수의 규칙을 비교합니다.' },
  { id: 'typed', label: '자료형·복소수·n-D', description: '정확한 정수·고정소수점·복소수와 다차원 배열을 다룹니다.' },
  { id: 'hierarchy', label: '조건·반복·메시지', description: '독립 상태·실행 조건·반복·구조화 버스와 메시지를 확인합니다.' },
  { id: 'solver', label: '솔버·제약·분석', description: '강성 감쇠·대수 제약·연속 사건·국소 선형화를 실제 계산합니다.' },
] as const;
export type ExampleCategoryId = typeof EXAMPLE_CATEGORIES[number]['id'];
export interface CalcExample { id: string; title: string; description: string; category: ExampleCategoryId; model: CalcModel }
export const EXAMPLES: CalcExample[] = [
  {
    id: 'first-calculation', category: 'basics', title: '첫 배율 계산', description: '값 2에 배율 3을 연결하면 결과는 6입니다.',
    model: {
      schemaVersion: 1, modelId: 'first-calculation', name: '첫 배율 계산',
      nodes: [node('value', 'source.constant', '값', { value: 2 }), node('gain', 'math.gain', '배율', { gain: 3 }), node('result', 'sink.display', '값 표시', {})],
      edges: [edge('value-gain', 'value', 'gain', 'in'), edge('gain-result', 'gain', 'result', 'in')],
      execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 },
      layout: { value: { x: 40, y: 140 }, gain: { x: 290, y: 140 }, result: { x: 540, y: 140 } },
    },
  },
  {
    id: 'discrete-feedback', category: 'discrete', title: '이전 값을 기억하기', description: 'x[k+1] = 0.9 x[k] + 1 · 한 단계 지연으로 피드백을 만듭니다.',
    model: {
      schemaVersion: 1, modelId: 'discrete-feedback', name: '이전 값을 기억하기',
      nodes: [node('input', 'source.constant', '입력', { value: 1 }), node('delay', 'discrete.unit-delay', '이전 값', { initial: 0 }), node('gain', 'math.gain', '배율', { gain: 0.9 }), node('sum', 'math.sum', '더하기', {}), node('result', 'sink.display', '값 표시', {})],
      edges: [edge('input-sum', 'input', 'sum', 'a'), edge('delay-gain', 'delay', 'gain', 'in'), edge('gain-sum', 'gain', 'sum', 'b'), edge('sum-delay', 'sum', 'delay', 'in'), edge('delay-result', 'delay', 'result', 'in')],
      execution: { mode: 'discrete', startTime: 0, stopTime: 20, step: 1 },
      layout: { input: { x: 20, y: 10 }, sum: { x: 260, y: 10 }, delay: { x: 500, y: 10 }, gain: { x: 260, y: 200 }, result: { x: 740, y: 10 } },
    },
  },
  {
    id: 'continuous-decay', category: 'continuous', title: '시간에 따른 감쇠', description: 'x′ = −x, x(0) = 1 · 시간에 따라 줄어드는 값을 관찰합니다.',
    model: {
      schemaVersion: 1, modelId: 'continuous-decay', name: '시간에 따른 감쇠',
      nodes: [node('state', 'continuous.integrator', '현재 값', { initial: 1 }), node('gain', 'math.gain', '변화율', { gain: -1 }), node('result', 'sink.display', '값 표시', {})],
      edges: [edge('state-gain', 'state', 'gain', 'in'), edge('gain-state', 'gain', 'state', 'in'), edge('state-result', 'state', 'result', 'in')],
      execution: { mode: 'continuous', startTime: 0, stopTime: 5, step: 0.05 },
      layout: { state: { x: 40, y: 120 }, gain: { x: 300, y: 240 }, result: { x: 560, y: 120 } },
    },
  },
  {
    id: 'budget-calculator', category: 'basics', title: '구매 예산 계산', description: '가격 × 수량 − 할인 · 합계 35,000을 직접 계산합니다.',
    model: {
      schemaVersion: 1, modelId: 'budget-calculator', name: '구매 예산 계산',
      nodes: [node('price', 'source.constant', '가격', { value: 12500 }), node('quantity', 'source.constant', '수량', { value: 3 }), node('subtotal', 'math.multiply', '소계', { operation: 'multiply' }), node('discount', 'source.constant', '할인', { value: 2500 }), node('total', 'math.sum', '할인 적용', { signs: '+-' }), node('result', 'sink.display', '예산 합계', {})],
      edges: [edge('price-subtotal', 'price', 'subtotal', 'a'), edge('quantity-subtotal', 'quantity', 'subtotal', 'b'), edge('subtotal-total', 'subtotal', 'total', 'a'), edge('discount-total', 'discount', 'total', 'b'), edge('total-result', 'total', 'result', 'in')],
      execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 },
      layout: { price: { x: 20, y: 40 }, quantity: { x: 20, y: 240 }, subtotal: { x: 260, y: 40 }, discount: { x: 260, y: 240 }, total: { x: 500, y: 40 }, result: { x: 740, y: 40 } },
    },
  },
  {
    id: 'vector-shape', category: 'basics', title: '벡터와 2D 배열', description: '벡터를 3배로 바꾸고 최솟값 −6과 2×2 배열을 함께 확인합니다.',
    model: {
      schemaVersion: 1, modelId: 'vector-shape', name: '벡터와 2D 배열',
      nodes: [node('vector', 'source.constant', '벡터', { value: [1, -2, 3, 4] }), node('gain', 'math.gain', '배율', { gain: 3 }), node('reshape', 'matrix.reshape', '2D 배열', { form: 'matrix', rows: 2, columns: 2 }), node('minimum', 'math.minmax', '최솟값', { operation: 'min', strategy: 'reduce' }), node('matrix-result', 'sink.display', '2D 결과', {}), node('min-result', 'sink.display', '최솟값 결과', {})],
      edges: [edge('vector-gain', 'vector', 'gain', 'in'), edge('gain-reshape', 'gain', 'reshape', 'in'), edge('gain-minimum', 'gain', 'minimum', 'in'), edge('reshape-result', 'reshape', 'matrix-result', 'in'), edge('minimum-result', 'minimum', 'min-result', 'in')],
      execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 },
      layout: { vector: { x: 20, y: 130 }, gain: { x: 260, y: 130 }, reshape: { x: 500, y: 40 }, minimum: { x: 500, y: 260 }, 'matrix-result': { x: 740, y: 40 }, 'min-result': { x: 740, y: 260 } },
    },
  },
  {
    id: 'formula-calculator', category: 'basics', title: '한 줄 수식 계산', description: 'sqrt(x^2 + 7) · 입력 3을 넣으면 결과는 4입니다.',
    model: {
      schemaVersion: 1, modelId: 'formula-calculator', name: '한 줄 수식 계산',
      nodes: [node('value', 'source.constant', '입력값', { value: 3 }), node('formula', 'math.expression', '수식', { expression: 'sqrt(x^2 + 7)' }), node('result', 'sink.display', '수식 결과', {})],
      edges: [edge('value-formula', 'value', 'formula', 'in'), edge('formula-result', 'formula', 'result', 'in')],
      execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 },
      layout: { value: { x: 40, y: 140 }, formula: { x: 290, y: 140 }, result: { x: 540, y: 140 } },
    },
  },
  {
    id: 'unit-scale', category: 'basics', title: '단위와 배율 확인', description: '1.5m × 2 + 0.5m = 3.5m · 단위를 보존하는 계산입니다.',
    model: {
      schemaVersion: 1, modelId: 'unit-scale', name: '단위와 배율 확인',
      nodes: [node('length', 'source.constant', '길이', { value: 1.5 }, 'm'), node('gain', 'math.gain', '배율', { gain: 2 }), node('extra', 'source.constant', '추가 길이', { value: 0.5 }, 'm'), node('sum', 'math.sum', '길이 합계', { signs: '++' }), node('result', 'sink.display', '총 길이', {})],
      edges: [edge('length-gain', 'length', 'gain', 'in'), edge('gain-sum', 'gain', 'sum', 'a'), edge('extra-sum', 'extra', 'sum', 'b'), edge('sum-result', 'sum', 'result', 'in')],
      execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 },
      layout: { length: { x: 20, y: 40 }, gain: { x: 260, y: 40 }, extra: { x: 260, y: 240 }, sum: { x: 500, y: 40 }, result: { x: 740, y: 40 } },
    },
  },
  {
    id: 'reset-feedback', category: 'discrete', title: '배열 상태와 reset', description: '배열의 이전 값을 기억하고 true reset 후 초기값부터 다시 쌓습니다.',
    model: {
      schemaVersion: 1, modelId: 'reset-feedback', name: '배열 상태와 reset',
      nodes: [node('input', 'source.constant', '입력 배열', { value: [1, 2] }), node('delay', 'discrete.unit-delay', '배열 이전 값', { initial: [0, 0], reset: 'level' }), node('gain', 'math.gain', '이전 값 배율', { gain: 0.9 }), node('sum', 'math.sum', '배열 누적', {}), node('pulse', 'source.pulse', 'reset 신호', { amplitude: 1, period: 8, width: 1, phase: 3 }), node('zero', 'source.constant', '비교 기준', { value: 0 }), node('reset', 'logic.compare', 'reset 조건', { operation: 'gt' }), node('result', 'sink.scope', '배열 상태 기록', {})],
      edges: [edge('input-sum', 'input', 'sum', 'a'), edge('delay-gain', 'delay', 'gain', 'in'), edge('gain-sum', 'gain', 'sum', 'b'), edge('sum-delay', 'sum', 'delay', 'in'), edge('pulse-reset', 'pulse', 'reset', 'a'), edge('zero-reset', 'zero', 'reset', 'b'), edge('reset-delay', 'reset', 'delay', 'reset'), edge('delay-result', 'delay', 'result', 'in')],
      execution: { mode: 'discrete', startTime: 0, stopTime: 8, step: 1 },
      layout: { input: { x: 20, y: 40 }, sum: { x: 260, y: 40 }, delay: { x: 500, y: 40 }, gain: { x: 260, y: 220 }, pulse: { x: 20, y: 400 }, zero: { x: 20, y: 560 }, reset: { x: 260, y: 400 }, result: { x: 740, y: 40 } },
    },
  },
  {
    id: 'fir-impulse', category: 'discrete', title: 'FIR impulse 응답', description: '한 번의 입력 1이 계수 [0.25, 0.5, 0.25]로 퍼지는 과정을 확인합니다.',
    model: {
      schemaVersion: 1, modelId: 'fir-impulse', name: 'FIR impulse 응답',
      nodes: [node('impulse', 'source.pulse', '한 번의 입력', { amplitude: 1, period: 100, width: 1, phase: 0 }), node('filter', 'discrete.fir', 'FIR 필터', { coefficients: [0.25, 0.5, 0.25], initial: 0 }), node('result', 'sink.scope', '필터 응답', {})],
      edges: [edge('impulse-filter', 'impulse', 'filter', 'in'), edge('filter-result', 'filter', 'result', 'in')],
      execution: { mode: 'discrete', startTime: 0, stopTime: 8, step: 1 },
      layout: { impulse: { x: 40, y: 140 }, filter: { x: 290, y: 140 }, result: { x: 540, y: 140 } },
    },
  },
  {
    id: 'multirate-clock', category: 'discrete', title: '1·2·5배 샘플시간', description: 'Rate Transition의 이전 발행값과 서로 다른 정수배 주기를 비교합니다.',
    model: {
      schemaVersion: 1, modelId: 'multirate-clock', name: '1·2·5배 샘플시간',
      nodes: [node('clock', 'source.clock', 'base 시간', {}), rated(node('rate-two', 'time.rate-transition', '2배 수신', { initial: 0 }, 's'), 2), rated(node('rate-five', 'time.rate-transition', '5배 수신', { initial: 0 }, 's'), 5), node('rate-back', 'time.rate-transition', '1배 재수신', { initial: 0 }, 's'), rated(node('result-two', 'sink.scope', '2배 기록', {}), 2), rated(node('result-five', 'sink.scope', '5배 기록', {}), 5), node('result-back', 'sink.scope', '1배 재수신 기록', {})],
      edges: [edge('clock-two', 'clock', 'rate-two', 'in'), edge('clock-five', 'clock', 'rate-five', 'in'), edge('two-back', 'rate-two', 'rate-back', 'in'), edge('two-result', 'rate-two', 'result-two', 'in'), edge('five-result', 'rate-five', 'result-five', 'in'), edge('back-result', 'rate-back', 'result-back', 'in')],
      execution: { mode: 'discrete', startTime: 0, stopTime: 10, step: 1 },
      layout: { clock: { x: 20, y: 120 }, 'rate-two': { x: 260, y: 40 }, 'rate-five': { x: 260, y: 240 }, 'rate-back': { x: 500, y: 440 }, 'result-two': { x: 500, y: 40 }, 'result-five': { x: 500, y: 240 }, 'result-back': { x: 740, y: 440 } },
    },
  },
  {
    id: 'seeded-wave', category: 'signals', title: '같은 seed의 파형', description: 'seed 42의 난수는 다시 실행해도 같은 수열입니다. 사인 파형과 함께 관찰합니다.',
    model: {
      schemaVersion: 1, modelId: 'seeded-wave', name: '같은 seed의 파형',
      nodes: [node('noise', 'source.random', 'seed 난수', { distribution: 'uniform', seed: 42, min: -1, max: 1 }), node('noise-result', 'sink.scope', '난수 기록', {}), node('sine', 'source.sine-wave', '사인 파형', { amplitude: 1, frequency: 0.5, phase: 0, bias: 0 }), node('sine-result', 'sink.scope', '사인 기록', {})],
      edges: [edge('noise-result', 'noise', 'noise-result', 'in'), edge('sine-result', 'sine', 'sine-result', 'in')],
      execution: { mode: 'discrete', startTime: 0, stopTime: 4, step: 0.1 },
      layout: { noise: { x: 40, y: 40 }, 'noise-result': { x: 340, y: 40 }, sine: { x: 40, y: 240 }, 'sine-result': { x: 340, y: 240 } },
    },
  },
  {
    id: 'bit-lookup', category: 'discrete', title: 'Lookup과 비트 계산', description: '1D 선형 보간과 unsigned 8bit AND를 각각 직접 계산합니다.',
    model: {
      schemaVersion: 1, modelId: 'bit-lookup', name: 'Lookup과 비트 계산',
      nodes: [node('points', 'source.constant', '보간 입력', { value: [0, 0.25, 0.75, 1] }), node('lookup', 'lookup.interpolated', 'Lookup 표', { breakpoints: [0, 0.5, 1], values: [0, 5, 10], interpolation: 'linear', extrapolation: 'clip' }), node('lookup-result', 'sink.scope', '보간 결과', {}), node('bits-a', 'source.constant', '170', { value: 170 }), node('bits-b', 'source.constant', '15', { value: 15 }), node('bitwise', 'logic.bitwise', '8bit AND', { operation: 'and', width: 8, shift: 1 }), node('bit-result', 'sink.scope', '비트 결과', {})],
      edges: [edge('points-lookup', 'points', 'lookup', 'in'), edge('lookup-result', 'lookup', 'lookup-result', 'in'), edge('a-bitwise', 'bits-a', 'bitwise', 'a'), edge('b-bitwise', 'bits-b', 'bitwise', 'b'), edge('bit-result', 'bitwise', 'bit-result', 'in')],
      execution: { mode: 'static', startTime: 0, stopTime: 0, step: 1 },
      layout: { points: { x: 20, y: 40 }, lookup: { x: 260, y: 40 }, 'lookup-result': { x: 500, y: 40 }, 'bits-a': { x: 20, y: 280 }, 'bits-b': { x: 20, y: 460 }, bitwise: { x: 260, y: 280 }, 'bit-result': { x: 500, y: 280 } },
    },
  },
  {
    id: 'discrete-state-space', category: 'discrete', title: '이산 상태공간', description: 'x[k+1] = 0.5x[k] + 1, y[k] = x[k]의 고정 이산 상태를 확인합니다.',
    model: {
      schemaVersion: 1, modelId: 'discrete-state-space', name: '이산 상태공간',
      nodes: [node('step', 'source.step', '입력 1', { stepTime: 0, before: 0, after: 1 }), node('state', 'discrete.state-space', '이산 상태', { A: [[0.5]], B: [1], C: [1], D: 0, initial: [0] }), node('result', 'sink.scope', '상태 응답', {})],
      edges: [edge('step-state', 'step', 'state', 'in'), edge('state-result', 'state', 'result', 'in')],
      execution: { mode: 'discrete', startTime: 0, stopTime: 5, step: 1 },
      layout: { step: { x: 40, y: 140 }, state: { x: 290, y: 140 }, result: { x: 540, y: 140 } },
    },
  },
  {
    id: 'rk45-decay', category: 'continuous', title: 'RK45 감쇠와 오차 제어', description: 'x′ = −x의 해 exp(−t)와 적응 내부 간격의 수락·거절 기록을 확인합니다.',
    model: {
      schemaVersion: 1, modelId: 'rk45-decay', name: 'RK45 감쇠와 오차 제어',
      nodes: [node('state', 'continuous.integrator', '감쇠 상태', { initial: 1 }), node('gain', 'math.gain', '변화율', { gain: -1 }), node('result', 'sink.scope', '감쇠 기록', {})],
      edges: [edge('state-gain', 'state', 'gain', 'in'), edge('gain-state', 'gain', 'state', 'in'), edge('state-result', 'state', 'result', 'in')],
      execution: { mode: 'continuous', startTime: 0, stopTime: 5, step: 0.1, solver: { method: 'rk45', initialStep: 0.5, minStep: 1e-8, maxStep: 0.5, atol: 1e-10, rtol: 1e-8 } },
      layout: { state: { x: 40, y: 100 }, gain: { x: 300, y: 280 }, result: { x: 560, y: 100 } },
    },
  },
  {
    id: 'continuous-oscillator', category: 'continuous', title: '2차 적분의 진동', description: 'x″ = −x, x(0) = 1의 위치와 속도를 함께 기록합니다.',
    model: {
      schemaVersion: 1, modelId: 'continuous-oscillator', name: '2차 적분의 진동',
      nodes: [node('state', 'continuous.second-order-integrator', '진동 상태', { initialPosition: 1, initialVelocity: 0 }), node('gain', 'math.gain', '가속도', { gain: -1 }), node('position', 'sink.scope', '위치 기록', {}), node('velocity', 'sink.scope', '속도 기록', {})],
      edges: [edge('state-gain', 'state', 'gain', 'in'), edge('gain-state', 'gain', 'state', 'in'), edge('position-result', 'state', 'position', 'in'), { id: 'velocity-result', source: { nodeId: 'state', portId: 'velocity' }, target: { nodeId: 'velocity', portId: 'in' } }],
      execution: { mode: 'continuous', startTime: 0, stopTime: 6.3, step: 0.1, solver: { method: 'rk45', initialStep: 0.1, maxStep: 0.2, atol: 1e-9, rtol: 1e-7 } },
      layout: { state: { x: 40, y: 140 }, gain: { x: 300, y: 360 }, position: { x: 560, y: 40 }, velocity: { x: 560, y: 240 } },
    },
  },
  {
    id: 'continuous-step-response', category: 'continuous', title: '연속 전달 함수의 계단 응답', description: 'H(s) = 1/(s+1)에 t = 0.5 s의 계단을 입력합니다. solver는 변화 시각을 경계로 나눕니다.',
    model: {
      schemaVersion: 1, modelId: 'continuous-step-response', name: '연속 전달 함수의 계단 응답',
      nodes: [node('step', 'source.step', '계단 입력', { stepTime: 0.5, before: 0, after: 1 }), node('plant', 'continuous.transfer-function', '1차 시스템', { numerator: [1], denominator: [1, 1], initial: [0] }), node('result', 'sink.scope', '계단 응답', {})],
      edges: [edge('step-plant', 'step', 'plant', 'in'), edge('plant-result', 'plant', 'result', 'in')],
      execution: { mode: 'continuous', startTime: 0, stopTime: 5, step: 0.1, solver: { method: 'rk45', initialStep: 0.2, maxStep: 0.5 } },
      layout: { step: { x: 40, y: 140 }, plant: { x: 290, y: 140 }, result: { x: 540, y: 140 } },
    },
  },
  {
    id: 'continuous-pid', category: 'continuous', title: '필터 PID 피드백', description: '목표값 1과 실제값의 차이를 parallel PID와 미분 필터로 줄입니다.',
    model: {
      schemaVersion: 1, modelId: 'continuous-pid', name: '필터 PID 피드백',
      nodes: [node('reference', 'source.constant', '목표값', { value: 1 }), node('error', 'math.sum', '목표와의 차이', { signs: '+-' }), node('pid', 'continuous.pid', 'PID 제어', { kp: 2, ki: 1, kd: 0.1, filterN: 10, initialIntegral: 0, initialFilter: 0 }), node('plant', 'continuous.transfer-function', '1차 시스템', { numerator: [1], denominator: [1, 1], initial: [0] }), node('result', 'sink.scope', '제어 응답', {})],
      edges: [edge('reference-error', 'reference', 'error', 'a'), edge('plant-error', 'plant', 'error', 'b'), edge('error-pid', 'error', 'pid', 'in'), edge('pid-plant', 'pid', 'plant', 'in'), edge('plant-result', 'plant', 'result', 'in')],
      execution: { mode: 'continuous', startTime: 0, stopTime: 8, step: 0.1, solver: { method: 'rk45', initialStep: 0.02, maxStep: 0.1 } },
      layout: { reference: { x: 20, y: 60 }, error: { x: 260, y: 60 }, pid: { x: 500, y: 60 }, plant: { x: 740, y: 60 }, result: { x: 740, y: 280 } },
    },
  },
  {
    id: 'continuous-crossing-reset', category: 'continuous', title: '교차 reset과 같은 이산 tick', description: 't = 1 s의 교차에서 적분 상태를 초기화하고 같은 시점의 hold·지연 경계를 관찰합니다.',
    model: {
      schemaVersion: 1, modelId: 'continuous-crossing-reset', name: '교차 reset과 같은 이산 tick',
      nodes: [node('ramp', 'source.ramp', '시간 증가', { startTime: 0, slope: 1, initial: 0 }), node('crossing', 'logic.hit-crossing', '1에서 교차', { threshold: 1, direction: 'rising' }), node('input', 'source.constant', '변화율 1', { value: 1 }), node('state', 'continuous.integrator', '초기화되는 상태', { initial: 0, reset: 'rising' }), node('hold', 'time.zero-order-hold', '이산 관측', { initial: 0 }), node('delay', 'discrete.unit-delay', '직전 이산 관측', { initial: 0 }), node('state-result', 'sink.scope', '연속 상태', {}), node('delay-result', 'sink.scope', '이산 이전 값', {})],
      edges: [edge('ramp-crossing', 'ramp', 'crossing', 'in'), edge('crossing-reset', 'crossing', 'state', 'reset'), edge('input-state', 'input', 'state', 'in'), edge('state-hold', 'state', 'hold', 'in'), edge('hold-delay', 'hold', 'delay', 'in'), edge('state-result', 'state', 'state-result', 'in'), edge('delay-result', 'delay', 'delay-result', 'in')],
      execution: { mode: 'continuous', startTime: 0, stopTime: 2, step: 0.25, solver: { method: 'rk4', initialStep: 0.1, maxStep: 0.1, discreteStep: 0.5 } },
      layout: { ramp: { x: 20, y: 30 }, crossing: { x: 260, y: 30 }, input: { x: 20, y: 230 }, state: { x: 500, y: 130 }, hold: { x: 740, y: 30 }, delay: { x: 740, y: 230 }, 'state-result': { x: 500, y: 430 }, 'delay-result': { x: 740, y: 430 } },
    },
  },
  {
    id: 'memory-and-delay', category: 'continuous', title: 'Memory와 Unit Delay', description: '직전 수락 solver 단계의 Memory와 고정 이산 주기의 Unit Delay를 비교합니다.',
    model: {
      schemaVersion: 1, modelId: 'memory-and-delay', name: 'Memory와 Unit Delay',
      nodes: [node('ramp', 'source.ramp', '선형 입력', { startTime: 0, slope: 1, initial: 0 }), node('memory', 'time.memory', '직전 수락 단계', { initial: 0 }), node('hold', 'time.zero-order-hold', '고정 샘플', { initial: 0 }), node('delay', 'discrete.unit-delay', '직전 이산 tick', { initial: 0 }), node('memory-result', 'sink.scope', 'Memory 기록', {}), node('delay-result', 'sink.scope', 'Unit Delay 기록', {})],
      edges: [edge('ramp-memory', 'ramp', 'memory', 'in'), edge('ramp-hold', 'ramp', 'hold', 'in'), edge('hold-delay', 'hold', 'delay', 'in'), edge('memory-result', 'memory', 'memory-result', 'in'), edge('delay-result', 'delay', 'delay-result', 'in')],
      execution: { mode: 'continuous', startTime: 0, stopTime: 2, step: 0.1, solver: { method: 'rk4', initialStep: 0.1, maxStep: 0.1, discreteStep: 0.5 } },
      layout: { ramp: { x: 20, y: 140 }, memory: { x: 260, y: 40 }, hold: { x: 260, y: 300 }, delay: { x: 500, y: 300 }, 'memory-result': { x: 500, y: 40 }, 'delay-result': { x: 740, y: 300 } },
    },
  },
  {
    id: 'continuous-sample-hold', category: 'continuous', title: '사인파의 샘플과 hold', description: '연속 사인파와 0차 hold, 이전 두 샘플을 사용하는 causal 1차 hold를 비교합니다.',
    model: {
      schemaVersion: 1, modelId: 'continuous-sample-hold', name: '사인파의 샘플과 hold',
      nodes: [node('sine', 'source.sine-wave', '연속 사인파', { amplitude: 1, frequency: 0.5, phase: 0, bias: 0 }), node('zero', 'time.zero-order-hold', '0차 샘플', { initial: 0 }), node('first', 'time.first-order-hold', '1차 외삽', { initial: 0 }), node('sine-result', 'sink.scope', '원래 사인파', {}), node('zero-result', 'sink.scope', '0차 hold', {}), node('first-result', 'sink.scope', '1차 hold', {})],
      edges: [edge('sine-zero', 'sine', 'zero', 'in'), edge('sine-first', 'sine', 'first', 'in'), edge('sine-result', 'sine', 'sine-result', 'in'), edge('zero-result', 'zero', 'zero-result', 'in'), edge('first-result', 'first', 'first-result', 'in')],
      execution: { mode: 'continuous', startTime: 0, stopTime: 2, step: 0.05, solver: { method: 'rk4', initialStep: 0.05, maxStep: 0.05, discreteStep: 0.25 } },
      layout: { sine: { x: 20, y: 180 }, zero: { x: 260, y: 220 }, first: { x: 260, y: 420 }, 'sine-result': { x: 500, y: 20 }, 'zero-result': { x: 500, y: 220 }, 'first-result': { x: 500, y: 420 } },
    },
  },
  {
    id: 'rk45-controlled-failure', category: 'continuous', title: 'RK45 실행 상한 확인', description: '매우 빠른 감쇠에 좁은 오차 허용값과 큰 최소 간격을 설정해 진단과 마지막 유효 기록을 확인합니다.',
    model: {
      schemaVersion: 1, modelId: 'rk45-controlled-failure', name: 'RK45 실행 상한 확인',
      nodes: [node('state', 'continuous.integrator', '빠른 감쇠 상태', { initial: 1 }), node('gain', 'math.gain', '빠른 변화율', { gain: -10000 }), node('result', 'sink.scope', '마지막 유효 값', {})],
      edges: [edge('state-gain', 'state', 'gain', 'in'), edge('gain-state', 'gain', 'state', 'in'), edge('state-result', 'state', 'result', 'in')],
      execution: { mode: 'continuous', startTime: 0, stopTime: 1, step: 0.1, solver: { method: 'rk45', initialStep: 1, minStep: 0.1, maxStep: 1, atol: 1e-12, rtol: 1e-12, maxRejects: 1 } },
      layout: { state: { x: 40, y: 100 }, gain: { x: 300, y: 280 }, result: { x: 560, y: 100 } },
    },
  },
];

const playbackData = importDataset('time,value,enabled\n0,0,true\n1,2,false\n2,0,true', {
  id: 'example-data', name: '삼각형 입력', version: 1, format: 'csv', timeColumn: 'time',
  columns: [{ name: 'time', kind: 'number', unit: 's' }, { name: 'value', kind: 'number', unit: '1' }, { name: 'enabled', kind: 'boolean', unit: '1' }],
});
EXAMPLES.push({ id: 'data-playback', category: 'workspace', title: '데이터를 재생하고 조절하기', description: '저장한 시간열을 재생하고 대시보드의 배율을 바꾸며 결과를 비교합니다.', model: {
  schemaVersion: 1, modelId: 'data-playback', name: '데이터를 재생하고 조절하기', datasets: [playbackData],
  nodes: [node('data', 'source.dataset', '삼각형 입력', { datasetId: playbackData.id, column: 'value', interpolation: 'linear', outside: 'hold' }), node('gain', 'math.gain', '입력 배율', { gain: 1 }), node('result', 'sink.scope', '재생 결과', {})],
  edges: [edge('data-gain', 'data', 'gain', 'in'), edge('gain-result', 'gain', 'result', 'in')], execution: { mode: 'discrete', startTime: 0, stopTime: 2, step: 0.1 },
  layout: { data: { x: 40, y: 140 }, gain: { x: 290, y: 140 }, result: { x: 540, y: 140 } },
  dashboard: [{ id: 'gain-slider', kind: 'slider', title: '입력 배율', nodeId: 'gain', parameter: 'gain', min: 0, max: 4, step: 0.1 }, { id: 'result-chart', kind: 'scope', title: '재생 결과', nodeId: 'result' }], notes: '데이터 탭에서 원본과 정리 데이터의 SHA-256을 확인하세요. 대시보드의 배율 변경은 다음 실행부터 반영됩니다.',
} });
const hierarchyExample = createSubsystemFromSelection(EXAMPLES[0]!.model, ['gain'], '배율 모듈');
hierarchyExample.modelId = 'hierarchy-edit'; hierarchyExample.name = '하위 도식 안에서 계산하기'; hierarchyExample.notes = '하위 도식을 더블 클릭해 내부를 편집합니다. 의미가 바뀌면 정의 버전이 올라가며 다른 인스턴스는 명시적으로 갱신해야 합니다.';
EXAMPLES.push({ id: 'hierarchy-edit', category: 'workspace', title: hierarchyExample.name, description: '같은 계산을 하위 도식으로 묶고 경로를 따라 내부를 편집합니다.', model: hierarchyExample });
EXAMPLES.push({ id: 'units-and-bus', category: 'workspace', title: '단위와 이름 있는 신호', description: '100 cm를 1 m로 변환하고 같은 단위의 두 값을 이름으로 묶어 선택합니다.', model: {
  schemaVersion: 1, modelId: 'units-and-bus', name: '단위와 이름 있는 신호',
  nodes: [node('length', 'source.constant', '100 cm', { value: 100 }, 'cm'), node('convert', 'unit.convert', 'm로 변환', { from: 'cm', to: 'm' }), node('other', 'source.constant', '2 m', { value: 2 }, 'm'), node('bus', 'route.bus-create', '길이 묶음', { first: 'measured', second: 'reference' }), node('select', 'route.bus-select', '측정 길이', { field: 'measured' }), node('result', 'sink.display', '측정 결과', {})],
  edges: [edge('length-convert', 'length', 'convert', 'in'), edge('convert-bus', 'convert', 'bus', 'a'), edge('other-bus', 'other', 'bus', 'b'), edge('bus-select', 'bus', 'select', 'in'), edge('select-result', 'select', 'result', 'in')], execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 },
  layout: { length: { x: 20, y: 60 }, convert: { x: 250, y: 60 }, other: { x: 250, y: 240 }, bus: { x: 480, y: 140 }, select: { x: 710, y: 140 }, result: { x: 940, y: 140 } },
} });

EXAMPLES.push({ id: 'matrix-solve-lu', category: 'advanced', title: '행렬 풀이와 피벗 LU', description: 'A x = b의 해와 P A = L U를 만족하는 세 행렬을 같은 입력에서 확인합니다.', model: {
  schemaVersion: 1, modelId: 'matrix-solve-lu', name: '행렬 풀이와 피벗 LU',
  nodes: [node('matrix-a', 'source.constant', '계수 행렬 A', { value: [[0, 2], [1, 3]] }), node('vector-b', 'source.constant', '우변 b', { value: [[4], [7]] }), node('solve', 'matrix.solve', '선형 시스템 풀이', {}), node('lu', 'matrix.lu', '행 피벗 LU', {}), node('solution', 'sink.display', '해 x', {}), node('lower', 'sink.display', '하삼각 L', {}), node('upper', 'sink.display', '상삼각 U', {}), node('permutation', 'sink.display', '행 순서 P', {})],
  edges: [edge('a-solve', 'matrix-a', 'solve', 'a'), edge('b-solve', 'vector-b', 'solve', 'b'), edge('a-lu', 'matrix-a', 'lu', 'in'), edge('solve-result', 'solve', 'solution', 'in'), { id: 'lu-lower', source: { nodeId: 'lu', portId: 'lower' }, target: { nodeId: 'lower', portId: 'in' } }, { id: 'lu-upper', source: { nodeId: 'lu', portId: 'upper' }, target: { nodeId: 'upper', portId: 'in' } }, { id: 'lu-permutation', source: { nodeId: 'lu', portId: 'permutation' }, target: { nodeId: 'permutation', portId: 'in' } }],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 },
  layout: { 'matrix-a': { x: 30, y: 30 }, 'vector-b': { x: 30, y: 180 }, solve: { x: 250, y: 30 }, lu: { x: 250, y: 210 }, solution: { x: 480, y: 30 }, lower: { x: 480, y: 190 }, upper: { x: 480, y: 330 }, permutation: { x: 480, y: 470 } },
  notes: '행렬은 행 순서의 JSON 2D 배열입니다. 이 예제의 해는 [[1],[2]]이며 첫 행의 0 때문에 LU가 행을 교환합니다. permutation 출력은 인덱스 벡터가 아닌 P 행렬이며 P A = L U를 만족합니다.',
} });
EXAMPLES.push({ id: 'lookup-2d-nonuniform', category: 'advanced', title: '비균일 2D 표의 보간', description: '서로 다른 간격의 두 축에서 bilinear 값을 계산하고 Prelookup의 구간과 비율을 확인합니다.', model: {
  schemaVersion: 1, modelId: 'lookup-2d-nonuniform', name: '비균일 2D 표의 보간',
  nodes: [node('row', 'source.constant', '행 축 입력', { value: 1 }), node('column', 'source.constant', '열 축 입력', { value: 2 }), node('table', 'lookup.2d', '2D 표', { rowBreakpoints: [0, 2, 5], columnBreakpoints: [0, 1, 4], table: [[0, 0, 0], [0, 2, 8], [0, 5, 20]], interpolation: 'linear', extrapolation: 'clip' }), node('prelookup', 'lookup.prelookup', '행 축 구간 찾기', { breakpoints: [0, 2, 5], extrapolation: 'clip' }), node('table-result', 'sink.display', '보간 결과', {}), node('interval-result', 'sink.display', '구간 인덱스', {}), node('fraction-result', 'sink.display', '구간 비율', {})],
  edges: [edge('row-table', 'row', 'table', 'row'), edge('column-table', 'column', 'table', 'column'), edge('row-prelookup', 'row', 'prelookup', 'in'), edge('table-result', 'table', 'table-result', 'in'), { id: 'prelookup-index', source: { nodeId: 'prelookup', portId: 'index' }, target: { nodeId: 'interval-result', portId: 'in' } }, { id: 'prelookup-fraction', source: { nodeId: 'prelookup', portId: 'fraction' }, target: { nodeId: 'fraction-result', portId: 'in' } }],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 },
  layout: { row: { x: 30, y: 40 }, column: { x: 30, y: 220 }, table: { x: 250, y: 40 }, prelookup: { x: 250, y: 240 }, 'table-result': { x: 480, y: 40 }, 'interval-result': { x: 480, y: 220 }, 'fraction-result': { x: 480, y: 390 } },
  notes: 'table의 각 행은 rowBreakpoints, 각 열은 columnBreakpoints와 대응합니다. x*y 표를 행 입력 1과 열 입력 2에서 보간하면 2입니다. 행 구간은 0부터 시작하는 index=0, fraction=0.5입니다. 밖의 값은 clip으로 경계에 유지하며 linear 외삽과 error도 선택할 수 있습니다.',
} });
EXAMPLES.push({ id: 'quantizer-rounding-overflow', category: 'advanced', title: '양자화의 반올림과 범위', description: '부호 있는 4-bit·소수 2-bit에서 nearest-even, saturate와 wrap의 decoded·stored 출력을 비교합니다.', model: {
  schemaVersion: 1, modelId: 'quantizer-rounding-overflow', name: '양자화의 반올림과 범위',
  nodes: [node('values', 'source.constant', '양자화할 값', { value: [-2.25, -0.375, 0.375, 2.25] }), node('saturate', 'fixed.quantize', '범위 안에 제한', { wordLength: 4, fractionLength: 2, signedness: 'signed', rounding: 'nearest-even', overflow: 'saturate' }), node('wrap', 'fixed.quantize', '저장 정수 wrap', { wordLength: 4, fractionLength: 2, signedness: 'signed', rounding: 'nearest-even', overflow: 'wrap' }), node('decoded-saturate', 'sink.display', 'Saturate decoded', {}), node('stored-saturate', 'sink.display', 'Saturate stored', {}), node('decoded-wrap', 'sink.display', 'Wrap decoded', {}), node('stored-wrap', 'sink.display', 'Wrap stored', {})],
  edges: [edge('values-saturate', 'values', 'saturate', 'in'), edge('values-wrap', 'values', 'wrap', 'in'), edge('saturate-decoded', 'saturate', 'decoded-saturate', 'in'), { id: 'saturate-stored', source: { nodeId: 'saturate', portId: 'stored' }, target: { nodeId: 'stored-saturate', portId: 'in' } }, edge('wrap-decoded', 'wrap', 'decoded-wrap', 'in'), { id: 'wrap-stored', source: { nodeId: 'wrap', portId: 'stored' }, target: { nodeId: 'stored-wrap', portId: 'in' } }],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 },
  layout: { values: { x: 30, y: 210 }, saturate: { x: 250, y: 80 }, wrap: { x: 250, y: 350 }, 'decoded-saturate': { x: 480, y: 20 }, 'stored-saturate': { x: 480, y: 170 }, 'decoded-wrap': { x: 480, y: 310 }, 'stored-wrap': { x: 480, y: 460 } },
  notes: '1단계는 0.25이고 저장 정수 범위는 -8..7, decoded 범위는 -2..1.75입니다. ±0.375는 정수 ±1.5에서 짝수 쪽으로 반올림됩니다. stored 포트는 정확한 저장 정수, out 포트는 그 정수에 0.25를 곱한 값입니다. 이 블록은 최대 32-bit 양자화 계산이며 다른 블록의 자료형을 고정소수점으로 바꾸지 않습니다.',
} });

EXAMPLES.push({ id: 'vector-statistics', category: 'basics', title: '벡터의 합·평균·분산', description: '[1, 2, 3]의 합 6, 평균 2와 모집단 분산 2/3을 함께 계산합니다.', model: {
  schemaVersion: 1, modelId: 'vector-statistics', name: '벡터의 합·평균·분산',
  nodes: [node('values', 'source.constant', '입력 벡터', { value: [1, 2, 3] }), node('sum', 'reduce.sum', '원소의 합', {}), node('mean', 'reduce.mean', '평균', {}), node('variance', 'reduce.variance', '모집단 분산', {}), node('sum-result', 'sink.display', '합', {}), node('mean-result', 'sink.display', '평균', {}), node('variance-result', 'sink.display', '모집단 분산', {})],
  edges: [edge('values-sum', 'values', 'sum', 'in'), edge('values-mean', 'values', 'mean', 'in'), edge('values-variance', 'values', 'variance', 'in'), edge('sum-result', 'sum', 'sum-result', 'in'), edge('mean-result', 'mean', 'mean-result', 'in'), edge('variance-result', 'variance', 'variance-result', 'in')],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 },
  layout: { values: { x: 40, y: 210 }, sum: { x: 290, y: 40 }, mean: { x: 290, y: 210 }, variance: { x: 290, y: 380 }, 'sum-result': { x: 540, y: 40 }, 'mean-result': { x: 540, y: 210 }, 'variance-result': { x: 540, y: 380 } },
  notes: '분산은 각 값과 평균의 차이를 제곱한 합을 원소 수 N으로 나눈 모집단 분산입니다. [1,2,3]에서는 (1+0+1)/3 = 2/3이며 표본 분산의 N−1 규칙과 구별됩니다.',
} });
EXAMPLES.push({ id: 'matrix-diagonal-selection', category: 'advanced', title: '행렬의 대각과 구간 선택', description: '3×3 행렬의 대각 [1, 5, 9], 대각합 15와 원하는 행·열을 선택합니다.', model: {
  schemaVersion: 1, modelId: 'matrix-diagonal-selection', name: '행렬의 대각과 구간 선택',
  nodes: [node('values', 'source.constant', '입력 행렬', { value: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] }), node('diagonal', 'matrix.diagonal', '대각 원소', {}), node('select', 'matrix.select', '행·열 선택', { rows: [0, 2], columns: [1, 2] }), node('trace', 'matrix.trace', '대각합', {}), node('diagonal-result', 'sink.display', '대각', {}), node('select-result', 'sink.display', '선택한 행렬', {}), node('trace-result', 'sink.display', '대각합', {})],
  edges: [edge('values-diagonal', 'values', 'diagonal', 'in'), edge('values-select', 'values', 'select', 'in'), edge('values-trace', 'values', 'trace', 'in'), edge('diagonal-result', 'diagonal', 'diagonal-result', 'in'), edge('select-result', 'select', 'select-result', 'in'), edge('trace-result', 'trace', 'trace-result', 'in')],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 },
  layout: { values: { x: 40, y: 210 }, diagonal: { x: 290, y: 40 }, select: { x: 290, y: 210 }, trace: { x: 290, y: 380 }, 'diagonal-result': { x: 540, y: 40 }, 'select-result': { x: 540, y: 210 }, 'trace-result': { x: 540, y: 380 } },
  notes: '행·열 인덱스는 0부터 시작합니다. rows=[0,2], columns=[1,2]는 첫째·셋째 행과 둘째·셋째 열을 골라 [[2,3],[8,9]]를 만듭니다. diagonal은 대각 벡터, trace는 그 합입니다.',
} });
EXAMPLES.push({ id: 'dead-zone-quantizer-sinc', category: 'basics', title: '불감대와 간격 양자화', description: '같은 벡터에서 −1~1 불감대, 간격 1의 양자화와 정규화 sinc를 비교합니다.', model: {
  schemaVersion: 1, modelId: 'dead-zone-quantizer-sinc', name: '불감대와 간격 양자화',
  nodes: [node('values', 'source.constant', '입력 벡터', { value: [-2, -0.5, 0, 0.5, 2] }), node('dead-zone', 'nonlinear.dead-zone', '불감대', { lower: -1, upper: 1 }), node('quantizer', 'nonlinear.quantizer', '간격 양자화', { step: 1 }), node('sinc', 'math.sinc', '정규화 sinc', {}), node('dead-zone-result', 'sink.display', '불감대 결과', {}), node('quantizer-result', 'sink.display', '양자화 결과', {}), node('sinc-result', 'sink.display', 'sinc 결과', {})],
  edges: [edge('values-dead-zone', 'values', 'dead-zone', 'in'), edge('values-quantizer', 'values', 'quantizer', 'in'), edge('values-sinc', 'values', 'sinc', 'in'), edge('dead-zone-result', 'dead-zone', 'dead-zone-result', 'in'), edge('quantizer-result', 'quantizer', 'quantizer-result', 'in'), edge('sinc-result', 'sinc', 'sinc-result', 'in')],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 },
  layout: { values: { x: 40, y: 210 }, 'dead-zone': { x: 290, y: 40 }, quantizer: { x: 290, y: 210 }, sinc: { x: 290, y: 380 }, 'dead-zone-result': { x: 540, y: 40 }, 'quantizer-result': { x: 540, y: 210 }, 'sinc-result': { x: 540, y: 380 } },
  notes: '불감대 안의 값은 0이며 밖에서는 가까운 경계와의 차이를 출력합니다. 간격 양자화는 정확한 절반을 0에서 먼 쪽으로 반올림하므로 −0.5→−1, 0.5→1입니다. sinc(x)=sin(πx)/(πx)는 x=0에서 1입니다.',
} });
EXAMPLES.push({ id: 'chirp-sweep', category: 'signals', title: '주파수 스윕 관찰', description: '0.5 Hz에서 1.5 Hz까지 2초 동안 바뀌는 chirp 파형과 이후 고정 주파수를 봅니다.', model: {
  schemaVersion: 1, modelId: 'chirp-sweep', name: '주파수 스윕 관찰',
  nodes: [node('chirp', 'source.chirp', '주파수 스윕', { initialFrequency: 0.5, finalFrequency: 1.5, duration: 2, amplitude: 1, phase: 0, bias: 0 }), node('result', 'sink.scope', '스윕 기록', {})],
  edges: [edge('chirp-result', 'chirp', 'result', 'in')], execution: { mode: 'discrete', startTime: 0, stopTime: 3, step: 0.05 },
  layout: { chirp: { x: 40, y: 140 }, result: { x: 340, y: 140 } },
  notes: '주파수는 처음 2초 동안 0.5 Hz에서 1.5 Hz까지 선형으로 증가합니다. 위상은 주파수의 적분으로 이어지고 스윕 종료 후에는 마지막 주파수를 유지합니다.',
} });
EXAMPLES.push({ id: 'signal-curves', category: 'signals', title: '신호 곡선 비교', description: '중심 1초의 Gaussian 펄스, 감쇠 사인과 Logistic 곡선을 같은 시간축에서 비교합니다.', model: {
  schemaVersion: 1, modelId: 'signal-curves', name: '신호 곡선 비교',
  nodes: [node('gaussian', 'source.gaussian-pulse', 'Gaussian 펄스', { amplitude: 1, center: 1, width: 0.25, bias: 0 }), node('damped', 'source.damped-sine', '감쇠 사인', { amplitude: 1, frequency: 1, decay: 0.5, phase: 0, bias: 0 }), node('logistic', 'source.logistic', 'Logistic 곡선', { amplitude: 1, center: 1, slope: 4, bias: 0 }), node('gaussian-result', 'sink.scope', 'Gaussian 기록', {}), node('damped-result', 'sink.scope', '감쇠 사인 기록', {}), node('logistic-result', 'sink.scope', 'Logistic 기록', {})],
  edges: [edge('gaussian-result', 'gaussian', 'gaussian-result', 'in'), edge('damped-result', 'damped', 'damped-result', 'in'), edge('logistic-result', 'logistic', 'logistic-result', 'in')],
  execution: { mode: 'discrete', startTime: 0, stopTime: 3, step: 0.05 },
  layout: { gaussian: { x: 40, y: 40 }, damped: { x: 40, y: 230 }, logistic: { x: 40, y: 420 }, 'gaussian-result': { x: 340, y: 40 }, 'damped-result': { x: 340, y: 230 }, 'logistic-result': { x: 340, y: 420 } },
  notes: 'Gaussian 펄스는 중심 1초에서 1이고, Logistic 곡선은 같은 시각에 0.5입니다. 감쇠 사인은 1 Hz 진동의 크기가 exp(−0.5t)로 줄어듭니다. 모든 입력을 0.05초 간격으로 3초까지 기록합니다.',
} });

EXAMPLES.push({ id: 'dynamic-limits', category: 'signals', title: '입력 신호로 범위 제한하기', description: '사인파를 동적 아래·위 경계 사이로 제한하고 원래 파형과 비교합니다.', model: {
  schemaVersion: 1, modelId: 'dynamic-limits', name: '입력 신호로 범위 제한하기',
  nodes: [node('wave', 'source.sine-wave', '원래 파형', { amplitude: 3, frequency: 1, phase: 0, bias: 0 }), node('lower', 'source.constant', '아래 경계', { value: -1 }), node('upper', 'source.constant', '위 경계', { value: 1 }), node('limit', 'nonlinear.saturation-dynamic', '동적 포화', {}), node('original', 'sink.scope', '원래 파형', {}), node('limited', 'sink.scope', '제한한 파형', {})],
  edges: [edge('wave-limit', 'wave', 'limit', 'in'), edge('lower-limit', 'lower', 'limit', 'lower'), edge('upper-limit', 'upper', 'limit', 'upper'), edge('wave-original', 'wave', 'original', 'in'), edge('limit-limited', 'limit', 'limited', 'in')],
  execution: { mode: 'discrete', startTime: 0, stopTime: 2, step: .05 },
  layout: { wave: { x: 40, y: 20 }, lower: { x: 40, y: 170 }, upper: { x: 40, y: 320 }, limit: { x: 340, y: 150 }, original: { x: 650, y: 20 }, limited: { x: 650, y: 220 } },
  notes: '출력은 max(-1,min(1,3sin(2πt)))입니다. 경계도 입력 신호로 연결하므로 값을 바꾸어 다시 계산할 수 있습니다. 시간에 따라 변하는 불연속 신호를 연속 ODE 미분 입력에 연결하는 기능은 후속 사건 검증 단계입니다.',
} });
EXAMPLES.push({ id: 'nd-lookup', category: 'advanced', title: '3차원 표에서 값 찾기', description: 'x+2y+3z를 기록한 표를 세 좌표로 보간하면 3.25가 됩니다.', model: {
  schemaVersion: 1, modelId: 'nd-lookup', name: '3차원 표에서 값 찾기',
  nodes: [node('query', 'source.constant', '조회 좌표', { value: [.5, .25, .75] }), node('table', 'lookup.nd', '3차원 조회 표', { rank: 3, axis1: [0, 1], axis2: [0, 1], axis3: [0, 1], table: [0, 3, 2, 5, 1, 4, 3, 6], interpolation: 'linear', outside: 'error' }), node('result', 'sink.display', '보간 결과', {})],
  edges: [edge('query-table', 'query', 'table', 'in'), edge('table-result', 'table', 'result', 'in')],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: .1 }, layout: { query: { x: 40, y: 120 }, table: { x: 320, y: 120 }, result: { x: 620, y: 120 } },
  notes: '표 값의 마지막 축 z가 가장 빠르게 변합니다. 조회 좌표는 벡터이고 출력은 scalar입니다. 3차원 신호 자체를 만드는 기능과 구분하며 표 크기는 1,024개 값 이하입니다.',
} });
EXAMPLES.push({ id: 'matrix-inspection', category: 'advanced', title: '행렬 구조와 영이 아닌 값', description: 'AᵀA와 영이 아닌 원소의 인덱스·개수를 함께 확인합니다.', model: {
  schemaVersion: 1, modelId: 'matrix-inspection', name: '행렬 구조와 영이 아닌 값',
  nodes: [node('matrix', 'source.constant', '행렬 A', { value: [[0, 5], [4, 0]] }), node('square', 'matrix.square', 'AᵀA', {}), node('find', 'matrix.find-nonzero', '영이 아닌 값', { indexBase: 0 }), node('gram', 'sink.display', '행렬 곱', {}), node('indices', 'sink.display', '인덱스', {}), node('count', 'sink.display', '개수', {})],
  edges: [edge('matrix-square', 'matrix', 'square', 'in'), edge('matrix-find', 'matrix', 'find', 'in'), edge('square-gram', 'square', 'gram', 'in'), { id: 'find-indices', source: { nodeId: 'find', portId: 'indices' }, target: { nodeId: 'indices', portId: 'in' } }, { id: 'find-count', source: { nodeId: 'find', portId: 'count' }, target: { nodeId: 'count', portId: 'in' } }],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: .1 }, layout: { matrix: { x: 40, y: 160 }, square: { x: 320, y: 10 }, find: { x: 320, y: 220 }, gram: { x: 620, y: 10 }, indices: { x: 620, y: 200 }, count: { x: 620, y: 360 } },
  notes: 'AᵀA=[[16,0],[0,25]]입니다. column-major 인덱스는 [1,2,-1,-1], 유효 개수는 2입니다. CalcWeave의 Find Nonzero는 고정 폭과 개수로 결과를 표시하며 남는 자리는 -1입니다. 원본의 가변 길이 출력과 구분합니다.',
} });

EXAMPLES.push({ id: 'filter-realizations', category: 'discrete', title: '이산 필터의 계단 응답', description: 'y[k]=0.5u[k]+0.5u[k−1]+0.5y[k−1]의 입력과 응답을 비교합니다.', model: {
  schemaVersion: 1, modelId: 'filter-realizations', name: '이산 필터의 계단 응답',
  nodes: [node('step', 'source.step', '단위 계단', { stepTime: 0, before: 0, after: 1 }), node('filter', 'discrete.filter', '이산 필터', { numerator: [.5, .5], denominator: [1, -.5], structure: 'df2t', representation: 'filter', initial: 0 }), node('input', 'sink.scope', '입력 기록', {}), node('result', 'sink.scope', '응답 기록', {})],
  edges: [edge('step-filter', 'step', 'filter', 'in'), edge('step-input', 'step', 'input', 'in'), edge('filter-result', 'filter', 'result', 'in')],
  execution: { mode: 'discrete', startTime: 0, stopTime: 2, step: .1 }, layout: { step: { x: 40, y: 180 }, filter: { x: 330, y: 180 }, input: { x: 640, y: 30 }, result: { x: 640, y: 260 } },
  notes: '계수는 z⁻¹의 오름차순입니다. 첫 출력은 0.5, 다음 출력은 1.25, 1.625이며 2에 가까워집니다. 필터를 선택해 DF1·DF1T·DF2·DF2T를 바꾸어 같은 영 초기 상태 응답을 비교하세요. 채널 처리와 전달함수의 계수 순서는 설정에서 구분합니다.',
} });
EXAMPLES.push({ id: 'tapped-history', category: 'discrete', title: '이전 세 샘플 보기', description: '현재 입력과 이전 세 샘플을 함께 기록해 지연의 순서를 확인합니다.', model: {
  schemaVersion: 1, modelId: 'tapped-history', name: '이전 세 샘플 보기',
  nodes: [node('ramp', 'source.ramp', '현재 샘플', { startTime: 0, slope: 1, initial: 0 }), node('taps', 'discrete.tapped-delay', '이전 세 샘플', { taps: 3, order: 'oldest', includeCurrent: 'no', initial: 0 }), node('input', 'sink.scope', '현재 값', {}), node('result', 'sink.scope', '이력 기록', {})],
  edges: [edge('ramp-taps', 'ramp', 'taps', 'in'), edge('ramp-input', 'ramp', 'input', 'in'), edge('taps-result', 'taps', 'result', 'in')],
  execution: { mode: 'discrete', startTime: 0, stopTime: 6, step: 1 }, layout: { ramp: { x: 40, y: 180 }, taps: { x: 330, y: 180 }, input: { x: 640, y: 30 }, result: { x: 640, y: 260 } },
  notes: '1초마다 입력 0,1,2,…를 받습니다. 3초에는 이전 값 [0,1,2], 6초에는 [3,4,5]가 나옵니다. 오래된 값부터 표시하며 현재 입력은 포함하지 않습니다. 탭 지연의 등록 범위는 scalar 입력과 고정 길이 벡터 출력입니다.',
} });
EXAMPLES.push({ id: 'weighted-sample-counter', category: 'discrete', title: '샘플 주기와 순환 카운터', description: '0.1초 기본 간격에서 3 tick 주기·1 tick offset과 가중 시간 0.6초를 확인합니다.', model: {
  schemaVersion: 1, modelId: 'weighted-sample-counter', name: '샘플 주기와 순환 카운터',
  nodes: [{ ...node('counter', 'source.counter', '0~2 카운터', { mode: 'limited', upper: 2, initial: 0 }), sampleTime: { period: 3, offset: 1 } }, { ...node('period', 'time.weighted-math', '가중 샘플 시간', { operation: 'TsOnly', weight: 2 }), sampleTime: { period: 3, offset: 1 } }, { ...node('count', 'sink.scope', '카운터 기록', {}), sampleTime: { period: 3, offset: 1 } }, { ...node('seconds', 'sink.display', '주기 초', {}), sampleTime: { period: 3, offset: 1 } }],
  edges: [edge('counter-count', 'counter', 'count', 'in'), edge('period-seconds', 'period', 'seconds', 'in')],
  execution: { mode: 'discrete', startTime: 0, stopTime: 1.3, step: .1 }, layout: { counter: { x: 40, y: 40 }, period: { x: 40, y: 270 }, count: { x: 400, y: 40 }, seconds: { x: 400, y: 270 } },
  notes: '주기는 3초가 아니라 기본 간격 0.1초×3=0.3초입니다. 최초 due는 0.1초이며, 카운터는 0.1/0.4/0.7/1.0초에 0/1/2/0을 출력합니다. Ts×2=0.6초를 별도 결과에서 확인합니다. 첫 due 이전에는 초기 held 출력이 표시됩니다.',
} });
EXAMPLES.push({ id: 'pid-setpoint-weights', category: 'discrete', title: '2DOF PI의 목표 가중치', description: 'P 가중치 0.5와 I=2의 backward 적분으로 목표 입력에 대한 출력을 계산합니다.', model: {
  schemaVersion: 1, modelId: 'pid-setpoint-weights', name: '2DOF PI의 목표 가중치',
  nodes: [node('reference', 'source.constant', '목표 값', { value: 1 }), node('measurement', 'source.constant', '측정 값', { value: 0 }), node('pid', 'discrete.pid-2dof', '2DOF PI', { kp: 1, ki: 2, kd: 0, b: .5, c: 0, integralMethod: 'backward', integralInitial: 0 }), node('result', 'sink.scope', '제어 출력', {})],
  edges: [edge('reference-pid', 'reference', 'pid', 'reference'), edge('measurement-pid', 'measurement', 'pid', 'measurement'), edge('pid-result', 'pid', 'result', 'in')],
  execution: { mode: 'discrete', startTime: 0, stopTime: 1, step: .1 }, layout: { reference: { x: 40, y: 30 }, measurement: { x: 40, y: 260 }, pid: { x: 350, y: 160 }, result: { x: 670, y: 160 } },
  notes: 'P에는 0.5×목표−측정=0.5, I에는 목표−측정=1이 들어갑니다. 0.1초 간격 backward 적분의 첫 출력은 0.7, 이후 0.9,1.1,…입니다. 측정 값을 고정한 계산 예제이며 실제 장치의 폐루프 응답을 표현하지 않습니다. 적분 방식과 포화는 블록 설정에서 바꿀 수 있습니다.',
} });

EXAMPLES.push({ id: 'typed-integer64', category: 'typed', title: '64비트 정수와 비트', description: 'uint64 최댓값의 마지막 비트를 해제해 정확한 20자리 정수를 확인합니다.', model: {
  schemaVersion: 1, modelId: 'typed-integer64', name: '64비트 정수와 비트',
  nodes: [node('integer', 'source.typed', '정확한 정수', { value: { kind: 'typed', dtype: 'uint64', shape: [], data: ['18446744073709551615'] } }), node('clear', 'logic.bit-mask', '마지막 비트 해제', { operation: 'clear', bits: [0] }), node('original', 'sink.display', '원래 정수', {}), node('result', 'sink.display', '비트 해제 결과', {})],
  edges: [edge('integer-clear', 'integer', 'clear', 'in'), edge('integer-original', 'integer', 'original', 'in'), edge('clear-result', 'clear', 'result', 'in')],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: .1 }, layout: { integer: { x: 40, y: 180 }, clear: { x: 330, y: 180 }, original: { x: 640, y: 30 }, result: { x: 640, y: 260 } },
  notes: '18446744073709551615와 18446744073709551614는 십진 문자열로 저장되어 Number 정밀도 손실이 없습니다. 입력 블럭을 선택하면 자료형과 정확한 정수를 바꿀 수 있습니다. typed CSV는 dtype:payload 텍스트로 기록하며 모델 복구에는 모델 JSON을 사용하세요.',
} });
EXAMPLES.push({ id: 'typed-fixed-overflow', category: 'typed', title: '고정소수점 저장 코드의 경계', description: 'signed 4비트·소수 2비트에서 코드 7에 1을 더하고 wrap과 saturate를 비교합니다.', model: {
  schemaVersion: 1, modelId: 'typed-fixed-overflow', name: '고정소수점 저장 코드의 경계',
  nodes: [node('value', 'source.typed', '고정소수점 입력', { value: { kind: 'typed', dtype: 'fixed', fixed: { signed: true, wordLength: 4, fractionLength: 2 }, shape: [], data: ['7'] } }), node('wrap', 'fixed.integer-increment', '순환 증가', { delta: 1, overflow: 'wrap' }), node('saturate', 'fixed.integer-increment', '경계 증가', { delta: 1, overflow: 'saturate' }), node('wrap-result', 'sink.display', '순환 결과', {}), node('saturate-result', 'sink.display', '경계 결과', {})],
  edges: [edge('value-wrap', 'value', 'wrap', 'in'), edge('value-saturate', 'value', 'saturate', 'in'), edge('wrap-result', 'wrap', 'wrap-result', 'in'), edge('saturate-result', 'saturate', 'saturate-result', 'in')],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: .1 }, layout: { value: { x: 40, y: 180 }, wrap: { x: 330, y: 30 }, saturate: { x: 330, y: 280 }, 'wrap-result': { x: 650, y: 30 }, 'saturate-result': { x: 650, y: 280 } },
  notes: '입력 코드 7의 실세계 값은 7×2⁻²=1.75입니다. 저장 코드에 1을 더하면 wrap은 코드 −8·실세계 값 −2, saturate는 코드 7·실세계 값 1.75입니다. 저장 코드 증가와 실세계 값 1 증가를 구분하세요.',
} });
EXAMPLES.push({ id: 'typed-complex-hermitian', category: 'typed', title: '복소수와 켤레 전치', description: '2+3i와 2−3i를 가진 2×2 행렬의 켤레 전치와 에르미트 조건을 확인합니다.', model: {
  schemaVersion: 1, modelId: 'typed-complex-hermitian', name: '복소수와 켤레 전치',
  nodes: [node('complex', 'source.typed', '복소수 행렬', { value: { kind: 'typed', dtype: 'complex128', shape: [2, 2], data: [{ re: 1, im: 0 }, { re: 2, im: 3 }, { re: 2, im: -3 }, { re: 4, im: 0 }] } }), node('hermitian', 'complex.hermitian', '켤레 전치', {}), node('check', 'complex.is-hermitian', '에르미트 확인', { tolerance: 0 }), node('result', 'sink.display', '켤레 전치 결과', {}), node('verified', 'sink.display', '에르미트 여부', {})],
  edges: [edge('complex-hermitian', 'complex', 'hermitian', 'in'), edge('complex-check', 'complex', 'check', 'in'), edge('hermitian-result', 'hermitian', 'result', 'in'), edge('check-verified', 'check', 'verified', 'in')],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: .1 }, layout: { complex: { x: 40, y: 180 }, hermitian: { x: 350, y: 30 }, check: { x: 350, y: 290 }, result: { x: 650, y: 30 }, verified: { x: 650, y: 290 } },
  notes: '입력의 행 순서는 [1, 2+3i, 2−3i, 4]입니다. 켤레 전치 후 같은 행렬이므로 에르미트 조건이 true입니다. 결과 표는 실수와 허수를 별도 열로 표시합니다.',
} });
EXAMPLES.push({ id: 'typed-tensor-permute', category: 'typed', title: '3차원 배열의 축 바꾸기', description: '2×2×2의 정수 배열을 [2,0,1] 축 순서로 바꾸고 실제 원소 좌표를 확인합니다.', model: {
  schemaVersion: 1, modelId: 'typed-tensor-permute', name: '3차원 배열의 축 바꾸기',
  nodes: [node('tensor', 'source.typed', '3차원 정수', { value: { kind: 'typed', dtype: 'int16', shape: [2, 2, 2], data: ['1', '2', '3', '4', '5', '6', '7', '8'] } }), node('permute', 'tensor.permute', '축 순열', { order: [2, 0, 1] }), node('result', 'sink.display', '3차원 결과', {})],
  edges: [edge('tensor-permute', 'tensor', 'permute', 'in'), edge('permute-result', 'permute', 'result', 'in')],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: .1 }, layout: { tensor: { x: 40, y: 140 }, permute: { x: 350, y: 140 }, result: { x: 660, y: 140 } },
  notes: '좌표는 0부터 시작하고 마지막 축이 가장 빠르게 바뀝니다. 출력은 행 순서 [1,3,5,7,2,4,6,8]입니다. 일반 n-D는 typed 신호이며 기존 2D 블럭에 자동 연결하지 않습니다.',
} });
EXAMPLES.push({ id: 'typed-string-enum', category: 'typed', title: '문자열과 열거 값 보관', description: '문자열 배열과 Mode 열거 값을 별도 자료형으로 기록하고 안전한 CSV를 확인합니다.', model: {
  schemaVersion: 1, modelId: 'typed-string-enum', name: '문자열과 열거 값 보관',
  nodes: [node('text', 'source.typed', '문자열 입력', { value: { kind: 'typed', dtype: 'string', shape: [3], data: ['CalcWeave', '=1+1', '한글'] } }), node('mode', 'source.enum', '현재 모드', { value: { kind: 'typed', dtype: 'enum', enum: { name: 'Mode', labels: ['Off', 'On'] }, shape: [], data: ['On'] } }), node('text-result', 'sink.display', '문자열 결과', {}), node('mode-result', 'sink.display', '열거 결과', {})],
  edges: [edge('text-result', 'text', 'text-result', 'in'), edge('mode-result', 'mode', 'mode-result', 'in')],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: .1 }, layout: { text: { x: 40, y: 40 }, mode: { x: 40, y: 290 }, 'text-result': { x: 400, y: 40 }, 'mode-result': { x: 400, y: 290 } },
  notes: '문자열과 enum은 숫자로 자동 변환하지 않습니다. Mode는 Off와 On만 허용합니다. CSV의 string:·enum: 접두사는 값을 텍스트로 보존하고 수식 실행을 막습니다. 모델 복구에는 모델 JSON을 사용하세요.',
} });
EXAMPLES.push({ id: 'typed-ieee-cast', category: 'typed', title: '자료형 변환과 IEEE 특수값', description: 'float64 0.1을 float32로 바꾸고 NaN·무한대·부호 있는 0의 명시 태그를 확인합니다.', model: {
  schemaVersion: 1, modelId: 'typed-ieee-cast', name: '자료형 변환과 IEEE 특수값',
  nodes: [node('value', 'source.typed', '실수 입력', { value: { kind: 'typed', dtype: 'float64', shape: [], data: [.1] } }), node('cast', 'signal.cast', 'float32 변환', { source: 'explicit', target: { dtype: 'float32' }, special: 'preserve' }), node('special', 'source.typed', 'IEEE 태그', { value: { kind: 'typed', dtype: 'float64', shape: [4], data: ['NaN', 'Infinity', '-Infinity', '-0'] } }), node('result', 'sink.display', 'float32 결과', {}), node('special-result', 'sink.display', '특수값 결과', {})],
  edges: [edge('value-cast', 'value', 'cast', 'in'), edge('cast-result', 'cast', 'result', 'in'), edge('special-result', 'special', 'special-result', 'in')],
  execution: { mode: 'static', startTime: 0, stopTime: 0, step: .1 }, layout: { value: { x: 40, y: 30 }, cast: { x: 340, y: 30 }, special: { x: 40, y: 290 }, result: { x: 650, y: 30 }, 'special-result': { x: 650, y: 290 } },
  notes: 'float32로 반올림한 0.1은 0.10000000149011612입니다. IEEE 특수값은 JSON 숫자가 아닌 NaN·Infinity·-Infinity·-0 태그로 저장합니다. 기존 유한 실수 블럭으로 연결할 때에는 명시 경계와 자료형 범위를 확인하세요.',
} });

EXAMPLES.push(...createM11Examples());
EXAMPLES.push(...createM12Examples());

export function createExample(id: string): CalcModel {
  return structuredClone((EXAMPLES.find(example => example.id === id) ?? EXAMPLES[0]).model);
}
export function createBlockNode(blockType: string, _index?: number): CalcNode {
  const definition = getBlockDefinition(blockType);
  if (!definition) throw new Error('지원하지 않는 블럭입니다.');
  return {
    id: `block-${crypto.randomUUID()}`, blockType, blockVersion: 1, label: definition.label,
    parameters: structuredClone(Object.fromEntries(Object.entries(definition.parameters).map(([key, parameter]) => [key, parameter.default]))),
  };
}

export function createEmptyModel(): CalcModel {
  return { schemaVersion: 1, modelId: `model-${crypto.randomUUID()}`, name: '새 계산 모델', nodes: [], edges: [], execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 }, layout: {} };
}
