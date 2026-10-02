import { MODEL_LIMITS, ModelError, validateSignal, type CalcModel, type IRNode, type SignalDescriptor } from '../../model/src';

function fail(nodeId: string, code: string, message: string): never {
  throw new ModelError([{ code, nodeId, message }]);
}

/** Parameter combinations are rechecked at every compilation boundary, including Worker and export. */
export function validateDiscreteParameters(node: IRNode, model: CalcModel): void {
  const p = node.parameters;
  const invalid = (message: string): never => fail(node.id, 'INVALID_PARAMETERS', message);
  const vector = (key: string, min: number, max: number): number[] => {
    const descriptor = validateSignal(p[key]);
    if (descriptor.valueType !== 'float64' || descriptor.shape.length !== 1 || descriptor.shape[0]! < min || descriptor.shape[0]! > max) invalid(`${key}는 ${min}~${max}개 원소의 유한한 숫자 vector여야 합니다.`);
    return p[key] as number[];
  };
  const increasing = (values: number[], key: string): void => {
    if (values.some((value, index) => index > 0 && value <= values[index - 1]!)) invalid(`${key}는 엄격하게 증가해야 합니다.`);
  };
  switch (node.blockType) {
    case 'source.step': {
      const time = p.stepTime as number;
      if (Math.abs(time) > MODEL_LIMITS.maxTime) invalid('계단 입력 시각은 지원 시간 범위 안에 있어야 합니다.');
      const { startTime, stopTime, step } = model.execution;
      if (model.execution.mode === 'discrete' && time >= startTime && time <= stopTime) {
        const tick = (time - startTime) / step; const rounded = Math.round(tick);
        if (Math.abs(tick - rounded) > 1e-9 * Math.max(1, Math.abs(tick))
          || rounded < node.sampleTime.offset || (rounded - node.sampleTime.offset) % node.sampleTime.period !== 0) {
          fail(node.id, 'SOURCE_TIME_GRID', '구간 안의 계단 변화 시각은 base tick과 이 블럭의 due tick에 맞아야 합니다.');
        }
      }
      break;
    }
    case 'source.ramp': if (Math.abs(p.startTime as number) > MODEL_LIMITS.maxTime) invalid('Ramp 시작 시각은 지원 시간 범위 안에 있어야 합니다.'); break;
    case 'source.pulse': if ((p.width as number) > (p.period as number) || (p.phase as number) >= (p.period as number)) invalid('펄스 폭은 주기 이하이고 위상은 주기보다 작아야 합니다.'); break;
    case 'source.random': if (p.distribution === 'uniform' && (p.min as number) >= (p.max as number)) invalid('uniform 최솟값은 최댓값보다 작아야 합니다.'); break;
    case 'source.repeating-sequence': {
      const times = vector('times', 2, 1_024); const values = vector('values', 2, 1_024);
      increasing(times, 'times');
      if (times[0] !== 0 || times.at(-1)! > MODEL_LIMITS.maxTime || times.length !== values.length) invalid('반복 시간은 0부터 증가하고 값과 개수가 같아야 합니다. 주기는 지원 시간 범위 이하여야 합니다.');
      break;
    }
    case 'lookup.interpolated': {
      const points = vector('breakpoints', 2, 1_024); const values = vector('values', 2, 1_024);
      increasing(points, 'breakpoints');
      if (points.length !== values.length) invalid('기준점과 출력 값의 개수가 같아야 합니다.');
      break;
    }
    case 'discrete.fir': vector('coefficients', 1, 128); break;
    case 'discrete.transfer-function': {
      const numerator = vector('numerator', 1, 32); const denominator = vector('denominator', 1, 32);
      if (denominator[0] === 0 || numerator.length > denominator.length) invalid('분모 첫 계수는 0이 아니어야 하고 분자 길이는 분모 길이 이하여야 합니다.');
      break;
    }
    case 'discrete.state-space': {
      const initial = vector('initial', 1, 16); const b = vector('B', 1, 16); const c = vector('C', 1, 16);
      const a = validateSignal(p.A); const count = initial.length;
      if (a.valueType !== 'float64' || a.shape.length !== 2 || a.shape[0] !== count || a.shape[1] !== count || b.length !== count || c.length !== count) invalid('상태 공간은 A N×N, B/C/initial 길이 N인 SISO 모델이어야 합니다. N은 1~16입니다.');
      break;
    }
  }
}

/** State output contracts are known before traversing feedback dependencies. */
export function initialDiscreteDescriptor(node: IRNode, unit: string): SignalDescriptor | undefined {
  switch (node.blockType) {
    case 'discrete.unit-delay': case 'discrete.delay': case 'discrete.integrator': case 'discrete.difference':
    case 'discrete.derivative': case 'discrete.fir': case 'time.rate-transition': {
      const descriptor = validateSignal(node.parameters.initial);
      if (descriptor.valueType === 'boolean' && unit !== '1') fail(node.id, 'UNIT_MISMATCH', 'boolean 초기값에는 단위 1만 사용할 수 있습니다.');
      if (!['discrete.unit-delay', 'discrete.delay', 'time.rate-transition'].includes(node.blockType) && descriptor.valueType !== 'float64') fail(node.id, 'TYPE_MISMATCH', '이 상태 블럭의 초기값은 숫자 신호여야 합니다.');
      if (['discrete.integrator', 'discrete.derivative'].includes(node.blockType) && unit !== '1') fail(node.id, 'UNIT_MISMATCH', '이산 적분·미분의 이번 subset은 단위 없는 신호만 지원합니다.');
      return { ...descriptor, unit };
    }
    case 'discrete.transfer-function': case 'discrete.state-space':
      if (unit !== '1') fail(node.id, 'UNIT_MISMATCH', '전달 함수·상태 공간의 이번 SISO subset은 단위 없는 신호만 지원합니다.');
      return { valueType: 'float64', shape: [], unit: '1' };
    case 'logic.edge-detect': {
      const descriptor = validateSignal(node.parameters.initial);
      if (descriptor.valueType !== 'boolean') fail(node.id, 'TYPE_MISMATCH', '논리 에지 검출의 초기값은 boolean scalar여야 합니다.');
      if (descriptor.shape.length !== 0) fail(node.id, 'SHAPE_MISMATCH', '논리 에지 검출의 초기값은 boolean scalar여야 합니다.');
      if (unit !== '1') fail(node.id, 'UNIT_MISMATCH', 'boolean 신호에는 단위 1만 사용할 수 있습니다.');
      return descriptor;
    }
    default: return undefined;
  }
}
