import type { CalcNode } from '../../../../packages/model/src';
import { formatNumber } from './ResultPlot';

export function M5ParameterGuide({ node }: { node: CalcNode }) {
  if (node.blockType === 'lookup.2d') return <p className="field-help">표의 행은 행 기준점, 열은 열 기준점 순서입니다. 두 축은 각각 2 ~ 32개의 증가하는 숫자여야 합니다. linear는 두 축의 bilinear 보간, nearest는 가장 가까운 값, previous는 각 축의 이전 값을 선택합니다. 선형 외삽은 linear 보간에서 사용할 수 있습니다.</p>;
  if (node.blockType === 'lookup.prelookup') return <p className="field-help">index는 0부터 시작하는 구간 인덱스, fraction은 그 구간 안의 위치입니다. clip은 경계에 유지하고 linear는 첫·마지막 구간을 외삽하며 error는 범위 밖 입력을 진단합니다.</p>;
  if (node.blockType === 'matrix.lu') return <p className="field-help">lower·upper·permutation은 각각 L·U·P 행렬입니다. 행을 교환하는 피벗을 적용하며 P A = L U를 만족합니다.</p>;
  if (node.blockType === 'matrix.solve') return <p className="field-help">a에는 정사각 계수 행렬 A, b에는 같은 행 수의 2D 우변을 넣습니다. 한 우변도 [[4],[7]]처럼 한 열로 입력하세요. A x = b를 풀며 A는 단위 없음, 결과는 b의 단위를 따릅니다.</p>;
  if (node.blockType === 'matrix.cholesky') return <p className="field-help">대칭 양의 정부호 행렬을 A = L Lᵀ인 하삼각 L로 분해합니다. 조건을 만족하지 않는 입력은 계산 위치와 함께 진단합니다.</p>;
  if (node.blockType !== 'fixed.quantize') return null;
  const { wordLength = 8, fractionLength = 4, signedness = 'signed' } = node.parameters;
  if (typeof wordLength !== 'number' || !Number.isInteger(wordLength) || wordLength < 1 || wordLength > 32 || typeof fractionLength !== 'number' || !Number.isInteger(fractionLength) || fractionLength < 0 || fractionLength > 32) return <p className="field-help">out은 decoded 값, stored는 반올림·overflow 처리 후의 저장 정수입니다. 최대 32-bit 양자화 계산이며 연결한 블록의 자료형은 바꾸지 않습니다.</p>;
  const quantum = 2 ** -fractionLength;
  const lower = signedness === 'signed' ? -(2 ** (wordLength - 1)) : 0;
  const upper = 2 ** (wordLength - (signedness === 'signed' ? 1 : 0)) - 1;
  return <p className="field-help">1단계 {formatNumber(quantum)} · 저장 정수 {lower} ~ {upper} · decoded {formatNumber(lower * quantum)} ~ {formatNumber(upper * quantum)}. out은 decoded 값, stored는 반올림·overflow 처리 후의 저장 정수입니다. 연결한 블록의 자료형은 바꾸지 않습니다.</p>;
}
