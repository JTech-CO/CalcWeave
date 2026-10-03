import { blockRegistry } from '../../block-library/src';
import { ENGINE_VERSION, MODEL_LIMITS } from '../../model/src';
import { DATASET_LIMITS } from '../../model/src/dataset';
import { SOLVER_LIMITS } from '../../model/src/continuous';
import { PYTHON_TARGET } from '../../codegen-python/src/capabilities';
import { WASM_TARGET, C_CPP_TARGET } from '../../codegen-wasm/src/capabilities';

export const APP_VERSION = '0.17.1';
export const RELEASE = Object.freeze({
  version: APP_VERSION, engineVersion: ENGINE_VERSION, schemaVersion: 1,
  stage: 'public-beta', domain: 'calcweave.com', deploymentUrl: 'https://jtech-co.github.io/CalcWeave/', operator: 'JTech-Co',
  contact: 'jtech-bryan@proton.me',
  repository: 'https://github.com/JTech-CO/CalcWeave',
  policyLinks: Object.freeze({ terms: '/terms/', privacy: '/privacy/', cookies: '/cookies/', notices: '/notices/' }),
  browserSupport: 'Windows Chromium에서 검증한 베타입니다. Firefox·Safari 검증과 실제 초보자 사용성 평가는 공개 출시 확인 항목입니다.',
});

export const RELEASE_LIMITATIONS = Object.freeze([
  'Typed 블럭은 float32·64비트 정수·복소수·고정소수점·최대8차원 배열을 지원합니다. 기존 실수 블럭과 연결할 때는 명시적 변환이 필요합니다.',
  '실수 밀집 행렬은 행·열 각각32 이하입니다. fixed 타입은 최대64비트 저장 코드와 연산별 반올림을 사용합니다. 기존 Quantize는 float64 경계 양자화입니다.',
  '자료형 역전파는 직접 연결된 Cast의 선언 범위입니다. implicit solver·DAE·대수 루프는 선언한 선택 범위만 지원하며 전체 타입 전파와 희소 해법은 후속 단계입니다.',
  '연속 상태는 단위 없는 실수 scalar 범위입니다. 지원 모드와 포트·매개변수는 각 블럭의 등록 정의를 확인하세요.',
  '한 브라우저에 저장합니다. 계정·클라우드 동기화·서버 공유·브라우저 안의 외부 프로그램 실행은 제공하지 않습니다. 파일로 모델과 서명 패키지를 공유할 수 있습니다.',
  'Python은 승인된69개 블럭의 정적·이산 선택 구성입니다. dtype·형상·문자열 옵션을 개별 검사하며 연속 solver와 미지원 연산은 위치를 포함해 거부합니다. 준비한 Python 환경에서 실행합니다.',
  'WASM은16개 정의의 유한 실수 scalar DAG 선택 타깃입니다. 저장 상태·연속 solver·외부 모듈을 지원하지 않습니다. C/C++는 승인된 빌드·실행 프로필이 없어 미지원입니다.',
  'MAT Level5 데이터표·SLX/MDL root 도식은 선택 parser입니다. 해석·변환·실행·수치 검증·손실을 구분하고 원본은 별도 archive로 보존합니다. MATLAB 코드·callback·외부 reference는 실행하지 않습니다.',
  '재사용 패키지는 승인된 블럭으로 만든 모델·계층만 포함합니다. 공개키 서명 확인과 별도로 출처에서 받은 fingerprint를 확인하며 임의 코드를 설치하지 않습니다.',
  '오프라인 사용은 최초 온라인 설치가 완료된 이후에 가능합니다. 브라우저가 저장소를 지우면 복구할 수 없어 별도 백업이 필요합니다.',
  '여러 탭의 동시 저장 충돌은 자동 병합하지 않습니다. 충돌 시 현재 탭을 백업하고 최신 저장 모델을 불러오세요.',
]);

/** One executable registry feeds the compiler, editor search and public support list. */
export function getReleaseCatalog() {
  return {
    ...RELEASE, blocks: blockRegistry.map(definition => ({ ...definition, exportTargets: ['typescript', ...(PYTHON_TARGET.blockIds.includes(definition.id) ? ['python'] : []), ...(WASM_TARGET.blockIds.includes(definition.id) ? ['wasm'] : [])] })),
    codeTargets: { python: PYTHON_TARGET, wasm: WASM_TARGET, cCpp: C_CPP_TARGET },
    limits: MODEL_LIMITS, datasetLimits: DATASET_LIMITS, solverLimits: SOLVER_LIMITS,
    unsupported: RELEASE_LIMITATIONS,
  };
}
