# CalcWeave 검증 상태

앱 `0.17.0` · 엔진 `0.17.0-m16`. 이 문서는 현행 구현의 검증 범위와 최신 배포 증거를 연결한다. 과거 단계의 수치·실패 기록은 `evidence/`에 보존한다. 공개 CI와 최종 파일 확인은 아래 결과를 확정한 뒤 기록한다.

## 지원 감사

원자료 385행·339개 이름을 원본 ID·행 번호·조건·identity SHA로 대조했다. registry 정의 337개, 모델 widget 계약 5개, 미지원 목적 계약 10개는 별도로 관리한다. 같은 미지원 목적의 여러 접근점을 합치지 않아 미지원 원자료 행은 18개다.

[대응표](support-matrix.md)와 [기계 판독 JSON](support-matrix.json)은 385행의 결정·설정·자료형·실행 방식·타깃·외부 조건·담당자·검증 버전을 기록한다. 선택 범위의 기존 대응은 367행이며 원본 전수 옵션·MathWorks 수치 동등성 완료는 0행이다. 모든 385행의 공식 전수 옵션 inventory는 미검증이다. 251행은 실제 fixture에 연결된 276개 설정 profile을 갖고, 나머지 선택 116행은 원본 항목별 옵션 profile이 아직 직접 연결되지 않았음을 표시한다. 등록 파라미터의 모든 enum 값·조합을 실행 승인으로 계산하지 않는다.

[M16 감사 기록](evidence/m16-verification.json)은 25개 보호 자료·337개 이전 정의·385개 identity·352개 계약·실제 profile selector를 검증한다. 컴파일러 정규화가 있는 48개 profile은 동결 raw fixture SHA와 실제 실행 모델 semantic SHA를 추가 대조했다. Add·Subtract·Pi·Zero의 네 고정 설정은 [독립 기대값·실제 TypeScript 재검증](evidence/m16-preset-verification.json)을 별도로 연결했다. 추적 완료를 전체 실행 동등성으로 표시하지 않는다.

## 실제 실행과 화면

| 검사 | 확인 범위와 근거 |
| --- | --- |
| 단위 검사 | 최종 전체 3,883/3,883 PASS. [최종 원본](evidence/m16-unit-results.json). 추가 감사 검사 전 3,882개 결과는 [초기 원본](evidence/m16-initial-unit-results.json)에 따로 보존한다. |
| 지원 화면 | 최종 8/8 PASS. 검색·분류·타깃·동명 Display·preset·미지원·JSON·모델 불변·모달 단축키·키보드 목록 탐색과 8개 화면/테마/글자 확대 조건을 확인했다. [화면 기록](evidence/m16-support-ui-verification.json)·[실제 브라우저 결과](evidence/m16-support-browser-results.json). 최종 공개 응답은 별도 재검사한다. |
| 생성 Python | 현재 엔진에서 실제 프로그램 142개·정상 256표본. [현재 실행](evidence/m15-python-regression-on-m16.json). Python 69개 정의의 선택 구성만 승인한다. |
| 생성 WASM | 현재 엔진에서 실제 module/runner 128개. [현재 실행](evidence/m15-wasm-regression-on-m16.json). WASM 16개 정의의 유한 실수 scalar DAG 선택 구성만 승인한다. |
| 상호운용·패키지 | [실제 통합 실행](evidence/m15-regression-on-m16.json): MAT/SLX/MDL 3개 선택 분석 경로, 원본 bytes/재분석, native JSON, 서명 검증·명시 검토가 필요한 8개 과거 엔진 프로필. |
| TypeScript 회귀 | 기존 M7/catalog/M8~M15 검증기를 현재 엔진에서 실제 실행했다. [문자열·데이터](evidence/m13-regression-on-m16.json), [어댑터·상태](evidence/m14-regression-on-m16.json), 다른 단계의 현재 실행 증거도 `evidence/`에 보존한다. |
| 원자료·승인 | coverage·원 planning JSON·M10~M14 승인 재검증 PASS. 원 dataset·planning JSON·보호 baseline/원 승인 증거 25개의 SHA를 보존한다. |
| 성능 | 로컬 전용 preview에서 6개 예산 PASS. cold load p95 1,211ms·warm load p95 1,005ms·1,000노드 compile/run p95 118ms·취소 p95 503ms·반복 실행 후 heap 증가 예산 PASS·page error 0. [원본 측정](evidence/m16-performance.json). 공개 네트워크 속도나 실제 초보자 관찰 결과로 해석하지 않는다. |
| 빌드·release | root와 `/CalcWeave/` 경로 각각 91검사 PASS, asset 각각 16개. root 6,760,243bytes, project 6,760,513bytes. [실제 root artifact](evidence/m16-root-release-verification.json)·[실제 project artifact](evidence/m16-project-release-verification.json). |
| 프로젝트 경로 브라우저 | 최종 4/4 PASS, skipped/flaky/error 0. 경로·오프라인 scope·Worker·Python ZIP 로딩을 확인했다. [실제 결과](evidence/m16-project-browser-results.json). 처음 npm 실행이 브라우저 시작 전에 정체된 기록은 [별도 실행 기록](evidence/m16-project-browser-stalled-execution.json)으로 보존했고, 자체 프로세스를 정리한 뒤 직접 Playwright로 재실행했다. 계산 assertion 실패나 통과로 계산하지 않는다. |
| 의존성 | 고정 lockfile. 확인 시 npm audit의 알려진 취약점 0개. 입력·자원 상한·React escaping·허용 목록·임의 코드 실행 차단을 유지한다. |

지원 창에서 뒤쪽 공통 CSS가 의도한 폭을 덮던 문제를 교정했다. 최종 실제 폭은 1440px 화면에서 1040px, 1024px에서 992px, 작은 화면에서 viewport−16px이며 브라우저 assertion과 화면으로 확인했다. 교정 전 8개 기능 검사 결과는 이전 폭의 검사로 구분한다.

[로컬 종합 검증](evidence/m16-engineering-checks.json)은 위 결과와 보호 자료 SHA를 연결한다. 전체 브라우저 197개에 대한 단일 최종 실행 결과는 공개 CI에서 확정하며, 로컬의 집중 8개 검사나 프로젝트 경로 4개 검사로 전체 실행을 대체했다고 표시하지 않는다.

## 재현 명령

Node.js 24와 Python 3.14를 사용하는 CI가 최종 배포 검증 환경이다. 로컬은 Node.js 25.9.0·Python 3.14·Windows Chromium에서 검사했다. Firefox·Safari·실제 초보자 관찰은 이 자동 검사의 범위가 아니다.

```sh
npm ci
npm run typecheck
npm test
npm run verify:coverage
npm run verify:roadmap
npm run verify:docs
npm run verify:m7
npm run verify:catalog
npm run verify:m8
npm run verify:m9
npm run verify:m10
npm run verify:m11
npm run verify:m12
npm run verify:m13
npm run verify:m14
npm run verify:m15
npm run verify:m16
npm run build
npm run verify:release
npm run test:e2e
```

`verify:m16`는 선행 실제 M14/M15 타깃 보고서를 확인한다. 공개 매트릭스는 불변 원 승인/실행 근거를 참조하고, 매번 생성 시각이 달라지는 fresh 보고서의 SHA는 별도 검증 기록에 담는다. 따라서 CI 재실행만으로 공개 데이터가 바뀌지 않는다. 실제 지원 변경은 `scripts/generate-support-matrix.ts --write`로 명시 재생성한 뒤 검토한다.

## 공개 배포와 문서 정리

최종 공개 배포 검사는 대기 상태다. [운영 안내](operations.md)의 기본 브랜치 수동 workflow와 정확한 artifact 검증을 따른다. 공개 주소는 [CalcWeave](https://jtech-co.github.io/CalcWeave/)다. 기술적 앱 배포와 목표 도메인·정식 출시·실제 novice 관찰·원본 옵션 동등성은 별도 판정한다.

M16 구현 검사 후 중복된 M0~M15 계약·진행 기록과 이전 계획·배포 MD 44개를 현행 기술·디자인·운영·검증·지원 문서로 통합했다. M16부터 현행 검증 문서를 사용한다. 원본 dataset, 실제 정책, 보호 baseline MD/JSON, 기계 판독 계획과 실패/수치/배포 증거 JSON은 보존했다. 삭제 파일의 정확한 이전 SHA와 보존 상태는 [정리 기록](evidence/document-consolidation-manifest.json)에 기록했다. 과거 문서가 필요한 경우 [정리 전 Git 기록](https://github.com/JTech-CO/CalcWeave/tree/9f314bbb2c41d4e6b087c90b9da435e61a850996/docs)을 확인한다.

원본의 C/C++·MATLAB·S-function 실행 환경, 원본 전수 옵션 inventory와 수치 대조, 편집한 native 모델 export는 미승인/미검증으로 유지한다. 계정·원격 DB·결제·개인정보 수집을 추가할 때는 현재 로컬 베타의 해당없음 항목을 그대로 재사용하지 않는다.
