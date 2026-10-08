import { compileModel } from '../../../packages/compiler/src';
import type { CalcModel, CompiledModel, RunResult } from '../../../packages/model/src';

export interface GuidedLesson {
  id: string;
  exampleId: string;
  title: string;
  description: string;
  prediction: string;
  edit: string;
  editNodeIds: string[];
  reflection: string;
}

/** Lessons load existing, runnable examples; they do not introduce another model format. */
export const GUIDED_LESSONS: readonly GuidedLesson[] = [
  {
    id: 'first-calculation', exampleId: 'first-calculation', title: '배율과 곱셈',
    description: '입력값과 배율이 결과를 어떻게 바꾸는지 확인합니다.',
    prediction: '현재 입력값에 배율을 곱하면 얼마일까요? 배율을 바꾸면 어떻게 될까요?',
    edit: '배율 블록을 선택하고 오른쪽 설정에서 배율을 바꿔 보세요.',
    editNodeIds: ['gain'], reflection: '배율을 바꾼 전후의 결과를 곱셈식으로 설명해 보세요.',
  },
  {
    id: 'discrete-feedback', exampleId: 'discrete-feedback', title: '이전 값과 반복 계산',
    description: '한 틱 지연이 만드는 점화식을 살펴봅니다.',
    prediction: '현재 초기값에서 이전 값에 배율을 곱하고 입력과 조합합니다. 처음 세 값은 무엇일까요?',
    edit: '배율을 0.5로 바꾸고, 처음 세 값과 오래 지난 뒤의 값을 비교해 보세요.',
    editNodeIds: ['gain', 'delay'], reflection: '현재 결과에 이전 값이 쓰이는 이유와 배율의 영향을 설명해 보세요.',
  },
  {
    id: 'continuous-decay', exampleId: 'continuous-decay', title: '변화율과 연속 감쇠',
    description: '적분 블록과 피드백으로 미분방정식을 만듭니다.',
    prediction: '현재 초기값과 변화율에서 시작하면 1초 뒤의 값은 얼마나 될까요?',
    edit: '변화율 블록의 배율을 −2로 바꾸고 감소 속도를 비교해 보세요.',
    editNodeIds: ['gain', 'state'], reflection: '배율의 부호와 크기가 시간에 따른 값에 어떤 영향을 주나요?',
  },
];

export function getGuidedLesson(id: string | null): GuidedLesson | undefined {
  return GUIDED_LESSONS.find(lesson => lesson.id === id);
}

export type LessonAssessmentStatus = 'mismatch' | 'awaiting-run' | 'stale' | 'incomplete' | 'verified' | 'difference';
export interface LessonObservation {
  time: number;
  expected: number;
  actual: number | null;
  tolerance: number;
}
export interface LessonAssessment {
  status: LessonAssessmentStatus;
  message: string;
  formula?: string;
  expectedSummary?: string;
  observations: LessonObservation[];
}

const finiteScalar = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const lessonNumber = (value: number): string => Number.isFinite(value) ? Number(value.toPrecision(8)).toString() : '범위 밖';
const edgeKey = (edge: CalcModel['edges'][number]): string => `${edge.source.nodeId}:${edge.source.portId}>${edge.target.nodeId}:${edge.target.portId}`;
const LESSON_GRAPHS: Record<string, { mode: CalcModel['execution']['mode']; types: Record<string, string>; edges: string[] }> = {
  'first-calculation': {
    mode: 'static', types: { value: 'source.constant', gain: 'math.gain', result: 'sink.display' },
    edges: ['value:out>gain:in', 'gain:out>result:in'],
  },
  'discrete-feedback': {
    mode: 'discrete', types: { input: 'source.constant', delay: 'discrete.unit-delay', gain: 'math.gain', sum: 'math.sum', result: 'sink.display' },
    edges: ['input:out>sum:a', 'delay:out>gain:in', 'gain:out>sum:b', 'sum:out>delay:in', 'delay:out>result:in'],
  },
  'continuous-decay': {
    mode: 'continuous', types: { state: 'continuous.integrator', gain: 'math.gain', result: 'sink.display' },
    edges: ['state:out>gain:in', 'gain:out>state:in', 'state:out>result:in'],
  },
};

function lessonModel(model: CalcModel, id: string): CompiledModel | undefined {
  const graph = LESSON_GRAPHS[id];
  if (!graph || model.execution.mode !== graph.mode) return;
  // A familiar modelId does not certify its graph. Match every producer and input port.
  const nodes = model.nodes.filter(node => !node.blockType.startsWith('annotation.'));
  if (nodes.length !== Object.keys(graph.types).length || nodes.some(node => graph.types[node.id] !== node.blockType)) return;
  const edges = model.edges.map(edgeKey).sort();
  if (edges.length !== graph.edges.length || edges.some((edge, index) => edge !== [...graph.edges].sort()[index])) return;
  try {
    const compiled = compileModel(model);
    if (compiled.nodes.some(node => node.sampleTime.period !== 1 || node.sampleTime.offset !== 0)) return;
    if (compiled.nodes.some(node => node.outputs.out && (node.outputs.out.valueType !== 'float64' || node.outputs.out.shape.length !== 0))) return;
    if (compiled.nodes.some(node => ['delay', 'state'].includes(node.id) && node.parameters.reset !== 'none')) return;
    return compiled;
  } catch { return; }
}

export function evaluateGuidedLesson(model: CalcModel, lessonId: string, result: RunResult | null, resultCurrent: boolean): LessonAssessment {
  const compiled = lessonModel(model, lessonId);
  if (!compiled) return {
    status: 'mismatch', message: '도식의 연결·실행 방식·신호 형식이 이 학습 예제와 달라졌습니다. 일반 수식 보기를 이용하거나 학습 예제를 다시 여세요.', observations: [],
  };
  const settings = compiled.model.execution;
  const node = (id: string) => compiled.nodes.find(item => item.id === id)!;
  const gain = node('gain').parameters.gain;
  const initial = lessonId === 'first-calculation' ? node('value').parameters.value : node(lessonId === 'discrete-feedback' ? 'delay' : 'state').parameters.initial;
  const input = lessonId === 'discrete-feedback' ? node('input').parameters.value : 0;
  if (!finiteScalar(gain) || !finiteScalar(initial) || !finiteScalar(input)) return {
    status: 'mismatch', message: '이 학습은 유한한 실수 하나를 사용하는 예제입니다. 배열·다른 신호 형식은 일반 수식 보기에서 확인하세요.', observations: [],
  };
  const count = settings.mode === 'static' ? 1 : Math.round((settings.stopTime - settings.startTime) / settings.step) + 1;
  const expected: number[] = [];
  let formula: string;
  let expectedSummary: string;
  if (lessonId === 'first-calculation') {
    expected.push(initial * gain);
    formula = `y = ${lessonNumber(gain)} × ${lessonNumber(initial)}`;
    expectedSummary = `현재 입력과 배율의 곱은 ${lessonNumber(expected[0])}입니다.`;
  } else if (lessonId === 'discrete-feedback') {
    const signs = node('sum').parameters.signs as string;
    const coefficient = (signs[1] === '-' ? -1 : 1) * gain;
    const addition = (signs[0] === '-' ? -1 : 1) * input;
    let value = initial;
    for (let index = 0; index < count; index += 1) { expected.push(value); value = coefficient * value + addition; }
    formula = `x[k + 1] = ${lessonNumber(coefficient)} × x[k] ${addition < 0 ? '−' : '+'} ${lessonNumber(Math.abs(addition))}, x[0] = ${lessonNumber(initial)}`;
    const limit = Math.abs(coefficient) < 1 ? addition / (1 - coefficient) : undefined;
    expectedSummary = `처음 ${Math.min(3, count)}개 값은 ${expected.slice(0, 3).map(lessonNumber).join(', ')}입니다.${limit !== undefined ? ` 충분히 반복하면 ${lessonNumber(limit)}에 가까워집니다.` : ' 현재 배율에서는 일반적인 수렴 조건 |배율| < 1이 성립하지 않습니다.'}`;
  } else {
    for (let index = 0; index < count; index += 1) expected.push(initial * Math.exp(gain * (index * settings.step)));
    formula = `x′(t) = ${lessonNumber(gain)} × x(t), x(${lessonNumber(settings.startTime)}) = ${lessonNumber(initial)}`;
    expectedSummary = `현재 계수의 해는 x(t) = ${lessonNumber(initial)} × exp(${lessonNumber(gain)} × (t − ${lessonNumber(settings.startTime)}))입니다. 종료 시각의 해석값은 ${lessonNumber(expected.at(-1)!)}입니다.`;
  }
  const explanation = { formula, expectedSummary };
  if (expected.some(value => !Number.isFinite(value))) return {
    ...explanation, status: 'incomplete', message: '현재 계수와 시간 범위에서 해석값이 유한한 실수 범위를 벗어나 비교할 수 없습니다.', observations: [],
  };
  const observationIndexes = [...new Set([0, Math.min(1, count - 1), Math.min(2, count - 1), count - 1])];
  const observations = observationIndexes.map(index => ({
    time: settings.mode === 'static' ? settings.startTime : settings.startTime + index * settings.step,
    expected: expected[index], actual: resultCurrent && result?.status === 'completed' && finiteScalar(result.samples[index]?.values.result) ? result.samples[index].values.result as number : null,
    // A documented comparison tolerance, rather than claiming exact integration.
    tolerance: settings.mode === 'continuous' ? 1e-5 + Math.abs(expected[index]) * 1e-4 : 1e-9 * Math.max(1, Math.abs(expected[index])),
  }));
  if (!result) return { ...explanation, status: 'awaiting-run', message: '현재 도식을 실행한 뒤 수식의 예상값과 결과를 비교합니다.', observations };
  if (!resultCurrent) return { ...explanation, status: 'stale', message: '현재 도식의 정상 완료 실행이 필요합니다. 이전 결과를 비교에서 제외했습니다. 현재 도식을 다시 실행하세요.', observations };
  if (result.status !== 'completed' || result.stopReason || result.samples.length !== count || (settings.mode !== 'static' && count < 2)) return {
    ...explanation, status: 'incomplete', message: '전체 시간 범위의 정상 완료 결과가 필요합니다. 실패·취소·부분 기록으로 학습 결과를 판정하지 않습니다.', observations: observations.map(item => ({ ...item, actual: null })),
  };
  const agrees = result.samples.every((sample, index) => {
    const value = sample.values.result, time = settings.mode === 'static' ? settings.startTime : settings.startTime + index * settings.step;
    const tolerance = settings.mode === 'continuous' ? 1e-5 + Math.abs(expected[index]) * 1e-4 : 1e-9 * Math.max(1, Math.abs(expected[index]));
    return finiteScalar(value) && Math.abs(sample.time - time) <= 1e-9 * Math.max(1, Math.abs(time)) && Math.abs(value - expected[index]) <= tolerance;
  });
  return {
    ...explanation, status: agrees ? 'verified' : 'difference', observations,
    message: agrees ? '현재 실행의 모든 기록 값이 수식의 예상값과 비교 허용오차 안에서 일치합니다. 관찰한 이유를 직접 설명해 보세요.' : '현재 결과와 수식의 예상값에 차이가 있습니다. 시간 간격과 솔버 설정을 살펴보고 다시 비교하세요.',
  };
}
