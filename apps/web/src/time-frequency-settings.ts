import { ModelError } from '../../../packages/model/src';

export interface TimeFrequencyDraft { startIndex: string; count: string; segmentLength: string; overlap: string }
export interface TimeFrequencySelection { startIndex: number; count: number; segmentLength: number; overlap: number }

function fail(message: string): never { throw new ModelError([{ code: 'TIME_FREQUENCY_DRAFT', message }]); }
function integer(value: unknown, label: string): number {
  if (typeof value !== 'string' || value.length > 100 || !/^(0|[1-9][0-9]*)$/.test(value)) fail(`${label}은 100자 이하의 0 이상 정수로 입력하세요. 수식이나 자동 변환은 사용하지 않습니다.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number)) fail(`${label}의 정수 범위를 확인하세요.`);
  return number;
}

/** Short recordings stay visibly short and disabled; defaults never add or pad samples. */
export function defaultTimeFrequencyDraft(sampleCount: number): TimeFrequencyDraft {
  const count = Number.isSafeInteger(sampleCount) && sampleCount >= 0 ? Math.min(1024, sampleCount) : 0;
  const segmentLength = count >= 8 ? 2 ** Math.floor(Math.log2(Math.min(256, count))) : 8;
  return { startIndex: '0', count: String(count), segmentLength: String(segmentLength), overlap: String(segmentLength / 2) };
}

/** Form ranges only. The numerical core independently checks resource budgets before FFT work. */
export function timeFrequencyDraftSelection(draft: TimeFrequencyDraft, sampleCount: number): TimeFrequencySelection {
  if (!draft || typeof draft !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(draft))) fail('시간·주파수 설정은 일반 데이터 객체여야 합니다.');
  const keys = ['startIndex', 'count', 'segmentLength', 'overlap'], descriptors = Object.getOwnPropertyDescriptors(draft), own = Reflect.ownKeys(descriptors);
  if (own.length !== keys.length || own.some(key => typeof key !== 'string' || !keys.includes(key) || !('value' in descriptors[key]!) || !descriptors[key]!.enumerable)) fail('시간·주파수 설정의 필수 데이터 필드만 사용하세요.');
  if (!Number.isSafeInteger(sampleCount) || sampleCount < 0) fail('전체 기록 표본 수를 확인하세요.');
  const startIndex = integer(descriptors.startIndex!.value, '시작 표본'), count = integer(descriptors.count!.value, '표본 수'), segmentLength = integer(descriptors.segmentLength!.value, '창 길이'), overlap = integer(descriptors.overlap!.value, '겹침');
  if (count < 8 || count > 8192 || startIndex > sampleCount || count > sampleCount - startIndex) fail('선택 구간은 실제 기록 안의 8~8192개 표본이어야 합니다.');
  if (segmentLength < 8 || segmentLength > 2048 || segmentLength > count || (segmentLength & (segmentLength - 1)) !== 0) fail('창 길이는 선택 표본 수 이하의 8~2048 범위 2의 거듭제곱이어야 합니다.');
  if (overlap >= segmentLength) fail('겹침은 0 이상이며 창 길이보다 작아야 합니다.');
  return { startIndex, count, segmentLength, overlap };
}
