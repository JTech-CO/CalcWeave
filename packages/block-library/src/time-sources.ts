import type { BlockDefinition, ParameterDefinition } from './index';

export const EXPANDED_TIME_SOURCE_IDS = [
  'source.chirp', 'source.gaussian-pulse', 'source.damped-sine',
  'source.exponential', 'source.logistic', 'source.sinc-pulse',
] as const;
export function isExpandedTimeSource(id: string): boolean { return (EXPANDED_TIME_SOURCE_IDS as readonly string[]).includes(id); }

const number = (label: string, initial: number, min = -Number.MAX_VALUE, max = Number.MAX_VALUE): ParameterDefinition => ({ kind: 'number', label, default: initial, min, max });
const amplitude = number('진폭', 1), bias = number('기준값', 0);
const frequency = number('주파수 (Hz)', 1, 0, 1_000_000);
const center = number('중심 시각 (s)', 1, -1_000_000_000, 1_000_000_000);
const width = number('시간 폭 (s)', 0.25, 1e-9, 1_000_000_000);
const common = {
  version: 1, category: '시간 입력', inputs: [], outputs: ['out'],
  supportedModes: ['discrete', 'continuous'], directFeedthrough: false,
  valueType: 'float64', shape: 'scalar', unit: 'inherited',
  sampleTime: 'fixed-tick', state: 'none', exportTargets: ['typescript'],
} as const;

/** Distinct bounded waveform equations; not aliases for existing source cards. */
export const TIME_SOURCE_DEFINITIONS: readonly BlockDefinition[] = [
  { ...common, id: 'source.chirp', label: '주파수 스윕', englishName: 'Chirp', aliases: ['chirp', '스윕', '주파수 변화'], description: '0초부터 지정 시간 동안 주파수를 선형 변경하고 이후 최종 주파수를 유지합니다. 위상은 연속입니다.', parameters: { amplitude, initialFrequency: number('시작 주파수 (Hz)', 0, 0, 1_000_000), finalFrequency: number('마지막 주파수 (Hz)', 1, 0, 1_000_000), duration: number('스윕 시간 (s)', 2, 1e-9, 1_000_000_000), phase: number('위상 (rad)', 0, -1_000_000, 1_000_000), bias } },
  { ...common, id: 'source.gaussian-pulse', label: '가우스 펄스', englishName: 'Gaussian Pulse', aliases: ['gaussian', '가우스', '종 모양'], description: '중심 시각과 표준 시간 폭을 정한 매끄러운 가우스 펄스를 보냅니다.', parameters: { amplitude, center, width, bias } },
  { ...common, id: 'source.damped-sine', label: '감쇠 사인', englishName: 'Damped Sine', aliases: ['감쇠', 'damped', '진동'], description: 'exp(-감쇠율·t)로 진폭이 줄어드는 사인 신호입니다. 시각은 실행의 절대 초 좌표입니다.', parameters: { amplitude, frequency, decay: number('감쇠율 (1/s)', 0.5, 0, 1_000_000), phase: number('위상 (rad)', 0, -1_000_000, 1_000_000), bias } },
  { ...common, id: 'source.exponential', label: '지수 신호', englishName: 'Exponential Signal', aliases: ['exponential', '지수 변화', '감쇠 입력'], description: '진폭·exp(변화율·t)+기준값을 보냅니다. 유한 범위를 넘으면 원본 블럭에서 실패를 보고합니다.', parameters: { amplitude, rate: number('변화율 (1/s)', -1, -1_000_000, 1_000_000), bias } },
  { ...common, id: 'source.logistic', label: '로지스틱 신호', englishName: 'Logistic Signal', aliases: ['logistic', '시그모이드', 's 곡선'], description: '중심 시각을 지나는 로지스틱 곡선입니다. 큰 기울기에서도 안정적으로 계산합니다.', parameters: { amplitude, center, slope: number('기울기 (1/s)', 4, -1_000_000, 1_000_000), bias } },
  { ...common, id: 'source.sinc-pulse', label: 'Sinc 펄스', englishName: 'Sinc Pulse', aliases: ['sinc', '싱크', '대역 펄스'], description: '정규화 sinc((t-중심)/폭)를 보냅니다. 중심의 값은 정확히 진폭+기준값입니다.', parameters: { amplitude, center, width, bias } },
];
