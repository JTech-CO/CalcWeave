# CalcWeave 개발 안내

CalcWeave의 기술 구성, 로컬 실행 방법과 지원 범위를 설명합니다. 프로그램 소개는 [README](../README.md), 실제 조작 방법은 [사용 안내](user-guide.md), 분석 설정과 결과 해석은 [분석·실험 안내](analysis-guide.md)를 참고하세요.

## 기술 구성

화면은 **React·TypeScript·React Flow·Vite**, 계산은 별도의 TypeScript 패키지로 구성합니다. 블록선도와 실행 엔진 사이에 모델 검증과 중간 표현을 두어, 연결·자료형·설정에 맞지 않는 모델은 실행 전에 진단합니다.

```text
블록선도와 입력 데이터
  → 모델·포트·자료형·설정 검사
  → 컴파일된 중간 표현(IR)
  → Web Worker 계산 엔진과 솔버
  → 시간 응답·수치 표·진단·실행 기록
  → 지원 범위에 따른 모델 보관과 코드 내보내기
```

| 구성 | 역할 | 소스 |
| --- | --- | --- |
| 웹 작업 공간 | 캔버스, 블록 라이브러리, 속성·결과 패널 | [apps/web/src](../apps/web/src) |
| 모델과 컴파일러 | 모델 구조, 블록 정의, 연결 검증, 실행 계획 | [model](../packages/model/src) · [block-library](../packages/block-library/src) · [compiler](../packages/compiler/src) |
| 계산 엔진 | 신호 실행, 상태 갱신, 솔버, 확장 수학 연산 | [runtime](../packages/runtime/src) · [advanced-math](../packages/advanced-math/src) |
| 데이터와 분석 | 데이터 입력, 파라미터 실험, 결과 분석 | [data](../packages/data/src) · [experiments](../packages/experiments/src) · [analysis](../packages/analysis/src) |
| 코드 생성 | 타깃별 지원 검사와 독립 실행 코드 생성 | [TypeScript](../packages/codegen-ts/src) · [Python](../packages/codegen-python/src) · [WASM](../packages/codegen-wasm/src) |
| 검증 | 단위·브라우저 검사, 독립 수치 비교와 검증 스크립트 | [tests](../tests) · [독립 수치 검증](../tests/numerical-oracle-regression.test.ts) · [scripts](../scripts) |

모델과 실행 기록은 브라우저의 IndexedDB에 보관합니다. 정적 앱은 Service Worker로 캐시하고 배포 파일의 해시를 확인합니다. 모델·설정·실행 정보의 보관은 계산을 다시 확인하는 데 도움을 주며, 정확도 판단은 사용한 모델과 솔버, 지원 계약 및 비교 기준을 함께 살펴야 합니다.

계산 구조와 자원 한도는 [기술 백서](01-technical-whitepaper.md), 화면 구성과 상호작용은 [디자인 백서](02-design-whitepaper.md)에서 설명합니다.

## 로컬 실행과 검증

Node.js **22.12 이상**이 필요합니다. 잠금 파일의 의존성을 설치하고 개발 서버를 실행합니다.

```sh
npm ci
npm run dev
```

기본 검증과 정적 빌드는 다음과 같습니다.

```sh
npm run typecheck
npm test -- --maxWorkers=2
npm run verify:docs
npm run build
npm run verify:release
```

브라우저 검사를 실행하려면 `npx playwright install chromium`으로 Chromium을 설치한 뒤 `npm run test:e2e`를 사용합니다. Python 코드의 실행 비교에는 별도의 Python 환경이 필요합니다. 전체 단위 검사와 브라우저·빌드는 실행을 분리합니다. 추가 검증 명령, 환경별 조건과 결과는 [검증 안내](validation.md), [운영 안내](operations.md)를 참고하세요.

## 배포와 버전 확인

README의 검증·배포 배지는 GitHub Actions의 결과를 나타냅니다. `main`에 변경을 push하면 검증을 통과한 산출물을 자동으로 게시합니다. 워크플로를 직접 실행하여 검증·게시를 다시 진행할 수도 있습니다.

현행 소스의 앱 버전은 **0.27.0**, 계산 엔진 버전은 **0.17.1-m16**입니다. 공개 사이트 반영 여부는 [배포 실행](https://github.com/JTech-CO/CalcWeave/actions/workflows/pages.yml)과 [공개 릴리스 정보](https://jtech-co.github.io/CalcWeave/offline-manifest.json)로 확인합니다. 게시·업데이트·롤백 절차는 [운영 안내](operations.md#배포와-업데이트)를 따릅니다.

## 지원 범위와 결과 해석

현재 **337개 블록 정의, 75개 예제, 12개 예제 범주**를 제공합니다. 블록 수는 등록된 정의의 수이며 모든 자료형·모드·옵션에서 동작한다는 의미는 아닙니다. 라이브러리 검색과 실제 모델별 컴파일 검사로 사용할 구성을 확인합니다.

기존 [공개 지원표](support-matrix.md)와 [기계 판독 지원표](support-matrix.json)는 **0.17.0-m16** 엔진의 역사 검증 자료입니다. 이후의 [다중 입력 확장 계약](../packages/support-matrix/src/current-extensions.ts)은 별도로 관리하며 실제 모델별 컴파일 검사를 함께 적용합니다.

- TypeScript 내보내기는 승인된 실행 계약을 따릅니다. Python은 **69개 블록 ID의 정적·이산 구성**, WASM은 **16개 블록 ID의 실수 스칼라 비순환 구성**으로 제한됩니다. C/C++ 내보내기는 제공하지 않습니다.
- Simulink R2024b 참고 목록 **385행**을 [원자료 대응표](block-coverage.md)로 추적합니다. 원본의 모든 옵션이나 MathWorks 실행 결과와의 수치적 동등성을 검증한 것은 아닙니다. MAT·SLX·MDL 처리는 선택 범위의 데이터·구조 분석이며 원본 실행 환경을 대체하지 않습니다.
- Windows Chromium과 Linux CI의 Chromium에서 동작을 확인했습니다. Firefox·Safari는 아직 검증하지 않았으며, 실제 초보 사용자 검증의 상태는 [검증 기록](validation.md)에 명시합니다.

저장소의 `docs/evidence`에는 검증 로그와 수치 결과가 포함됩니다. 이미지 캡처는 현재 화면 검증에 필요한 최종본만 보관하며, 과거 캡처를 다시 확인하는 방법은 [증거 보관 안내](validation.md#화면-캡처-보관)에 있습니다.

## 영향을 받은 도구와 설계 원칙

[MATLAB Simulink](https://www.mathworks.com/products/simulink.html)의 블록선도 모델링 방식에서 출발했습니다. 수학적 관계를 시각적으로 연결하는 경험을 브라우저에서 바로 제공하고, 처음에는 작은 계산부터 시작해 필요한 연산과 설정을 점진적으로 찾아가도록 구성했습니다. CalcWeave는 독립적으로 실행되는 도구이며 MathWorks의 공식 제품이나 전체 호환 구현을 뜻하지 않습니다.

화면 구성에는 [SANE — Signal Above Needless Embellishment](https://github.com/JTech-CO/SANE/blob/main/SKILL-KR.md)의 정보 우선 설계 원칙을 반영했습니다. 읽기 쉬운 글자, 캔버스 중심의 배치, 절제된 카테고리 색상과 간결한 블록을 사용하고, 상세 정보는 필요할 때 속성 패널에서 확인하도록 했습니다.
