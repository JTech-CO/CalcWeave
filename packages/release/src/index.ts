import { blockRegistry } from '../../block-library/src';
import { ENGINE_VERSION, MODEL_LIMITS } from '../../model/src';
import { DATASET_LIMITS } from '../../model/src/dataset';
import { SOLVER_LIMITS } from '../../model/src/continuous';

export const APP_VERSION = '0.10.1';
export const RELEASE = Object.freeze({
  version: APP_VERSION, engineVersion: ENGINE_VERSION, schemaVersion: 1,
  stage: 'public-beta', domain: 'calcweave.com', deploymentUrl: 'https://jtech-co.github.io/CalcWeave/', operator: 'JTech-Co',
  contact: 'jtech-bryan@proton.me',
  repository: 'https://github.com/JTech-CO/CalcWeave',
  policyLinks: Object.freeze({ terms: '/terms/', privacy: '/privacy/', cookies: '/cookies/', notices: '/notices/' }),
  browserSupport: 'Windows Chromium에서 검증한 베타입니다. Firefox·Safari 검증과 실제 초보자 사용성 평가는 공개 출시 확인 항목입니다.',
});

export const RELEASE_LIMITATIONS = Object.freeze([
  '복소수·희소 행렬·3차원 이상 배열·DAE·대수 루프 자동 해법은 지원하지 않습니다.',
  '실수 밀집 행렬 계산은 행·열 각각 32 이하입니다. 고정소수점은 32비트 이하 경계 양자화이며 후속 계산은 float64입니다.',
  '64-bit 정수·고정소수점 타입의 전체 그래프 전파는 지원하지 않습니다.',
  '연속 상태는 단위 없는 실수 scalar 범위입니다. 지원 모드와 포트·매개변수는 각 블럭의 등록 정의를 확인하세요.',
  '한 브라우저에 저장합니다. 계정·클라우드 동기화·서버 공유·브라우저 안의 외부 프로그램 실행은 제공하지 않습니다. 파일로 모델과 서명 패키지를 공유할 수 있습니다.',
  'Python은 승인된 51개 블럭의 정적·이산 모델 subset입니다. 연속 solver·고급 계산·추가 수학·신호 및 M8·M9 블럭은 TypeScript 타깃을 사용합니다. Python은 사용자가 준비한 환경에서 실행합니다.',
  '재사용 패키지는 승인된 블럭으로 만든 모델·계층만 포함합니다. 공개키 서명 확인과 별도로 출처에서 받은 fingerprint를 확인하며 임의 코드를 설치하지 않습니다.',
  '오프라인 사용은 최초 온라인 설치가 완료된 이후에 가능합니다. 브라우저가 저장소를 지우면 복구할 수 없어 별도 백업이 필요합니다.',
  '여러 탭의 동시 저장 충돌은 자동 병합하지 않습니다. 충돌 시 현재 탭을 백업하고 최신 저장 모델을 불러오세요.',
]);

/** One executable registry feeds the compiler, editor search and public support list. */
export function getReleaseCatalog() {
  return {
    ...RELEASE, blocks: blockRegistry,
    limits: MODEL_LIMITS, datasetLimits: DATASET_LIMITS, solverLimits: SOLVER_LIMITS,
    unsupported: RELEASE_LIMITATIONS,
  };
}
