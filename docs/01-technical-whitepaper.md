# CalcWeave 기술 백서

> 버전: v0.11 · 작성일: 2026-10-03 · 상태: M8 수학·조회표 확장·185 registry·기존144개 계약 보존
> 대상: 제품 설계자, 프런트엔드 개발자, 수치 엔진 개발자  
> 연결 문서: [디자인 백서](02-design-whitepaper.md) · [마일스톤](03-milestone-roadmap.md) · [블럭 대응표](block-coverage.md)

M8의 앱0.9.0·엔진0.9.0-m8은 기존144개 등록 계약을 보존하고 수학·동적 경계·논리·배열·조회표41개 정의와8개 사전 설정을 연결한다. 총185종과35예제를 제공하며120개 독립 기준값·896개 원시 표본·388개 실제 TypeScript 프로그램을 검증했다. [M8 계약](m8-contract.md)·[검증](m8-validation.md)을 현재 확장 범위의 기준으로 사용한다. 이전 단계 기록과 전체 옵션 후속 계획은 보존한다.

## 1. 제품 정의와 현재 상태

앱0.8.1은 [GitHub Pages 웹 베타](https://jtech-co.github.io/CalcWeave/)를 게시하고 프로젝트 경로의 계산·정책·오프라인을 검증했다. 엔진0.8.0-catalog의144종 계약은 유지한다. [현재 배포 검증](pages-validation.md)과 [M8~M16 전체 대응 후속 로드맵](05-simulink-coverage-roadmap.md)을 현재 배포·확장 기준으로 사용한다. 목표 도메인·실제 초보자 조사·전체 옵션 동등성은 별도다.

0.8.0의 수학·신호 확장은 승인된 수학·통계·벡터·행렬 64종과 시간 입력 6종을 추가한다. registry는 144종, 정적 지원은107종이며 Python 승인 51종은 그대로다. 기존74종의 파라미터·포트·모드·타입/형상/단위 계약을 유지한다. 신규 생성 타깃은 `typescript-catalog-v1`이며 import 없는 고정 실행 소스와 데이터만 내보낸다. 독립 oracle·모든 지원 모드·JSON roundtrip·실제 TS 결과를 검증한 범위만 대응표에 승인한다. 원자료385행/339이름과 registry 정의 수는 서로 다른 지표다. [확장 계약](catalog-contract.md)·[검증](catalog-validation.md)·[대응 계획](block-expansion-plan.md)을 현재 추가 범위의 기준으로 사용하고 아래 M0~M7 기록은 각 단계의 계약으로 보존한다.

M7 앱 0.7.0·엔진 0.7.0-m7은 승인된 정적·이산 subset의 표준 라이브러리 Python 독립 실행, 일회용 P-256 서명·별도 공개키 fingerprint 확인이 필요한 선언형 모델 공유, native 모델의 구문/실행과 외부 변환 상태 보고를 추가한다. Python의 지원 상수와 registry의 코드 타깃 표시를 연결하며 연속·M5 고급 계산은 TS로 안내한다. 임의 kernel·네트워크/OS 권한·외부 모델 어댑터는 승인하지 않는다. 실제 계약과 근거는 [M7 계약](m7-contract.md)·[검증](m7-validation.md)을 따른다. M6의 아래 릴리스 기반은 유지한다.

M6 앱 0.6.0·엔진 0.6.0-m6은 74개 실행 정의의 공개 지원표, 최종 정적 파일 SHA-256 오프라인 릴리스, 저장 성공 후 업데이트, 최대5개 실행을 포함한 26MiB 백업·원자적 복구, 탭 revision 충돌과 제한된 로컬 진단을 추가한다. 수학 계약·schema1·기존 수치 fixture는 유지한다. [M6 계약](m6-contract.md)·[검증](m6-validation.md)·[배포](m6-deployment.md)·[운영](m6-operations.md)을 따른다. 실제 초보자 관찰·공개 도메인·HTTPS·호스팅 정책의 확인은 구현 검증과 구분한다.

CalcWeave는 사용자가 입력, 연산, 상태, 결과를 블럭과 연결선으로 표현하여 수치 계산과 시뮬레이션을 수행하고, 그 모델을 데이터 및 실행 가능한 코드로 가져갈 수 있는 웹 도구다. 기본 사용에 MATLAB 설치, 별도 계산 서버, 회원가입을 요구하지 않는 방향으로 설계한다. 수학적 의미와 결과의 재현성을 유지하면서 사용자가 처음부터 툴박스 체계를 학습하지 않아도 첫 결과에 도달하게 하는 것이 핵심이다.

M5 시점의 구현은 registry74종·정적 capability43종이었다. M5에서 각 축32 이하 실수2D 행렬 곱·전치·행렬식·역행렬·선형 방정식·Cholesky·LU, 비균일2D Lookup·Prelookup, 정확한1~32bit fixed-point 경계 양자화를 추가했다. 입력 형상·단위와 수치 조건을 검증하고 가중 연산 예산·실패 부분 기록을 독립 TypeScript 생성 코드에도 적용한다. 양자화의 정수 코드만 bit-true이며 이후 계산은 float64다. 복소수·일반 n-D·64bit·typed fixed-point 전파·메시지/조건부 실행·DAE는 미지원/연구로 남긴다.

M4 데이터·계층·실험·대시보드와 M3 solver/혼합 실행, M2 tick·독립 export, M1 편집·typed 계산·AST 계약을 유지한다. 실제 추가 범위는 [M5 구현 계약](m5-contract.md), 증거와 제한은 [M5 검증 기록](m5-validation.md)을 따른다. 이전 [M4](m4-validation.md)·[M3](m3-validation.md)·[M2](m2-validation.md)·[M1](m1-validation.md) 기록은 보존한다. 전체 Simulink 동등성이나 공개 배포를 뜻하지 않는다.

제품 표기는 **CalcWeave**, 배포 목표 주소는 **CalcWeave.com**이다. 사용자가 지정한 호스팅 저장소는 JTech-CO/CalcWeave, 운영자는 JTech-Co, 문의는 jtech-bryan@proton.me이다. 저장소는 확인했으나 2026-10-03 도메인 DNS가 해석되지 않았고 Pages custom domain은 설정되지 않았다. 소유 TXT·DNS·HTTPS·실제 배포는 별도 확인한다.

### 1.1 제품이 제공할 네 가지 작업

| 작업 | 사용자 관점 | 실행 관점 |
| --- | --- | --- |
| 수치 계산 | 값을 연결해 답을 구한다 | 상태 없는 그래프를 한 번 평가 |
| 시뮬레이션 | 시간이 흐를 때 시스템이 어떻게 바뀌는지 본다 | 이산 스케줄러 또는 연속 solver가 상태를 갱신 |
| 데이터 관리 | 표·시계열을 연결하고 결과를 비교한다 | 버전 있는 데이터 자산과 실행 기록 관리 |
| 코드 export | 만든 모델을 실제 프로그램에서 사용한다 | 검증한 중간 표현에서 실행 코드와 런타임을 생성 |

### 1.2 첫 제품에서 보장할 범위

M1은 정적 계산, M2는 고정 tick 이산 실행과 TypeScript export, M3는 검증한 비강성 ODE 연속 실행을 목표로 한다. 이후 데이터·계층·고급 실행 의미를 넓힌다. 하드웨어 실시간 제어, 안전 인증, MATLAB 언어 전체, `.slx` 무손실 왕복, 임의 네이티브 코드 실행은 초기 보장에 넣지 않는다. 향후 기능은 지원 계약과 검증 fixture를 추가한 뒤 공개한다.

## 2. dataset을 구현 범위로 바꾸는 방법

원자료는 21개 분류, **385개 문서 행**이다. 이 수에는 바로가기, 설정 변형, 조건부 항목, 레거시 항목이 들어 있으므로 385개 독립 엔진이라는 뜻이 아니다. 22~25절의 보조 표와 MATLAB 추출 코드는 합계 밖이다. 원자료는 참고 스냅샷으로 보존하고 CalcWeave 진행 상태는 별도 대응표에서 관리한다.

| 구현 계열 | 예 | 필요한 기반 | 계획 |
| --- | --- | --- | --- |
| 순수 계산 | Sum, Gain, 비교, 행렬 변환 | 타입·차원·수치 규칙, DAG 평가 | M1 이후 |
| 상태·시간 계산 | Delay, 필터, Integrator, PID | 상태 수명, 샘플시간, solver, 이벤트 | M2~M5 |
| 편집·관찰·구성 | Dashboard, DocBlock, Subsystem, Quick Insert | UI 바인딩, 계층, 프리셋, 지원 메타데이터 | M1~M5 |
| 별도 실행 의미 | 메시지, DAE, 고정소수점 | 큐·우선순위, implicit 해석, 비트 수준 산술 | M5의 기능별 검증 |
| 외부 환경 의존 | MATLAB Function, C Caller, S-function | 독립 대체 API 또는 명시적 adapter | 직접 호환 제외, M5~M7 연구 |

JS/TS로 수학 및 실행 엔진을 작성하는 방향은 타당하다. 다만 현재 입력이 즉시 현재 출력에 영향을 주는 경로만으로 순환이 생기면 매 시점 대수 방정식을 풀어야 한다. 따라서 블럭마다 함수를 하나 만드는 방식만으로 시뮬레이터 전체를 완성할 수는 없다. 이 구분은 MathWorks의 [Algebraic Loop Concepts](https://www.mathworks.com/help/simulink/ug/algebraic-loops.html)에 설명된 실행 문제를 참고한 판단이다. CalcWeave의 해법과 지원 범위는 아래에서 별도로 정의한다.

원자료의 기능 개념을 참고하되 아이콘·화면·문서·독점 실행 코드를 그대로 복제하지 않는다. CalcWeave의 블럭 ID, 설명, 예제, 수치 사양은 독립적으로 작성한다. 외부 라이브러리를 채택할 때 배포와 생성 코드에 적용되는 라이선스를 기록한다.

### 2.1 완료를 세는 기준

대응표의 각 원본 행에는 고유 추적 ID, canonical 기능 또는 프리셋, 예정 단계, 지원 판정을 둔다. `계획`, `구현`, `검증`, `공개`는 서로 다른 상태다. 원본 행의 매핑 완료율, 독립 기능의 검증률, 코드 생성 지원률을 별도로 보고한다. 외부 의존 블럭을 설명만 붙여 놓고 지원 완료로 집계하지 않는다.

블럭별 지원 계약에는 입력·출력 타입/차원, 단위, 파라미터 범위, direct-feedthrough 의존성, 상태, 샘플시간, 이벤트, 제한, export 타깃, 테스트 oracle을 반드시 적는다. 모든 Simulink 옵션을 지원한다는 표시 대신 실제 검증한 CalcWeave 옵션만 표시한다.

## 3. 핵심 설계 결정

| ID | 결정 | 이유와 변경 조건 |
| --- | --- | --- |
| ADR-01 | 로컬 계산을 기본으로 한다 | 설치·가입 부담과 서버 계산 비용을 줄임. 기기 한계는 실행 예산으로 드러냄 |
| ADR-02 | UI 그래프와 실행 모델을 분리한다 | 렌더러 교체·headless 실행·export가 같은 의미를 공유해야 함 |
| ADR-03 | TypeScript로 코어를 작성한다 | 브라우저와 Node 검증에서 공유. 타입 검사 외 런타임 검증도 필요 |
| ADR-04 | 표준 중간 표현(IR)을 컴파일한다 | 편집 상태를 즉시 실행하지 않고 오류·의존성·지원 여부를 사전 검사 |
| ADR-05 | 초기 수치는 float64, 제한된 shape를 쓴다 | 임의 정밀도와 자료형 전체를 동시에 구현하지 않음 |
| ADR-06 | 계산은 전용 Worker에서 수행한다 | UI 반응과 실행 취소를 유지. Worker를 보안 샌드박스로 간주하지 않음 |
| ADR-07 | 임의 JS/MATLAB 평가 대신 제한된 수식 AST를 쓴다 | 사용자 수식의 의미·비용·코드 생성 범위를 통제 |
| ADR-08 | export는 지원 집합을 먼저 검사한다 | 실행할 수 없는 코드를 성공 결과로 내보내지 않음 |
| ADR-09 | 클라우드는 선택 기능으로 분리한다 | 로컬 제품의 완료가 계정·DB 도입에 종속되지 않게 함 |
| ADR-10 | 수치 정확도와 UX를 별도 gate로 둔다 | 보기 좋은 그래프와 올바른 결과는 각각 검증해야 함 |

M0에서 가장 큰 불확실성을 확인하고 ADR 변경이 필요하면 변경 이유, 영향을 받는 모델 버전, 재검증 범위를 기록한다.

## 4. 시스템 구조

```text
브라우저 UI
  블럭 검색 · 캔버스 · 속성 · 데이터 · 결과 · export
       │ command / validation feedback
       ▼
모델 저장소 ─────── 로컬 자산 저장소(IndexedDB)
  모델 revision       데이터 버전 · 실행 기록 · 복구 snapshot
       │ immutable run snapshot
       ▼
전용 계산 Worker
  schema 검증 → 타입/차원/단위 추론 → 그래프 컴파일 → IR
       │                           │
       ▼                           ▼
  정적/이산/연속 실행             코드 생성기
       │                           │
       ▼                           ▼
  run 결과·진단                TS 코드·runtime·manifest·fixtures

선택 클라우드(M6 별도 트랙)
  소유자 검증 API → 프로젝트 metadata DB / 비공개 자산 저장소
```

Worker는 별도 스레드에서 계산하고 메시지로 UI와 통신할 수 있다. DOM에 직접 접근하지 않아도 네트워크 등 다른 API에 접근할 수 있으므로, 신뢰하지 않는 사용자 코드를 Worker에 넣는 것만으로 격리가 되지는 않는다. 공식 [Web Workers 문서](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers)를 근거로 계산 분리와 보안 경계를 구별한다.

### 4.1 제안 저장소 구성

```text
apps/web/                 편집기와 사용자 화면
packages/model/           모델 schema, migration, canonical serialization
packages/block-library/   블럭 계약, 프리셋, 한국어/영문 검색 metadata
packages/compiler/        타입 검사, 의존성, IR 생성, 진단
packages/runtime/         정적 평가, 상태, 시간, solver, 이벤트
packages/codegen-ts/      TypeScript 코드 생성과 타깃 검사
packages/data/            표·시계열 schema와 import/export
packages/ui/              토큰과 공통 상호작용 컴포넌트
fixtures/                 예제 모델, analytical oracle, export 비교 자료
docs/                     사양과 결정 기록
dataset/                  변경하지 않는 참고 자료
```

M1에서 모든 패키지를 별도 배포할 필요는 없다. 논리 경계를 먼저 지키고 실제 폴더와 번들 분리는 규모에 맞춘다. 코어는 React, DOM, 브라우저 저장소를 import하지 않도록 한다.

### 4.2 기술 후보와 채택 기준

| 계층 | 우선 후보 | 선정 기준 / 보류 조건 |
| --- | --- | --- |
| 앱·빌드 | React + TypeScript + Vite | 편집기 SPA, Worker 번들, strict 검사. 정확한 버전은 M0 호환 검증 후 lockfile 고정 |
| 그래프 편집 | React Flow (`@xyflow/react`) | 노드/포트/선 상호작용을 활용하되 실행 의미는 자체 코어에 둠 |
| 모델 변경 | command 기반 reducer/store | undo·redo와 원자적 모델 변경. 매 pointer 이동을 전체 모델 복제로 처리하지 않음 |
| 런타임 검증 | Zod | 가져온 파일·Worker 메시지·선택 서버 입력의 schema와 크기 상한 |
| 로컬 저장 | IndexedDB adapter | 트랜잭션과 오류 복구. UI·코어가 저장 API에 직접 종속되지 않음 |
| 결과 그래프 | Apache ECharts 후보 | 시계열/XY/확대 기능, 화면 샘플링 비용 및 표 대안 검증 후 채택 |
| 수학 | 자체 명세의 작은 kernel부터 | 복잡한 선형대수는 검증된 라이브러리 후보와 비교. 임의 문자열 평가 기능은 도입하지 않음 |
| 테스트 | Vitest + Playwright | 코어 oracle·export fixture와 실제 편집/저장/취소 흐름을 분리 검증 |
| 고성능 확장 | WebAssembly 선택 | profiling에서 TS kernel이 병목일 때만 추가. 설치 없는 사용자 경험 유지 |

후보 기능은 [Vite](https://vite.dev/guide/), [TypeScript](https://www.typescriptlang.org/docs/handbook/2/basic-types.html), [React Flow](https://reactflow.dev/learn), [Zod](https://zod.dev/), [ECharts](https://echarts.apache.org/en/index.html), [Vitest](https://vitest.dev/guide/), [Playwright](https://playwright.dev/docs/test-assertions)의 공식 문서를 확인했다. 이는 CalcWeave에 대한 성능 검증이나 모든 후보의 최종 채택을 뜻하지 않는다. 라이선스·보안 업데이트·번들 크기는 M0의 의존성 기록에 별도로 확정한다.

## 5. 모델과 값의 계약

### 5.1 프로젝트 데이터

| 객체 | 핵심 필드 | 규칙 |
| --- | --- | --- |
| Project | ID, 이름, 설명, model refs, asset refs | 로컬 ID는 소유권 증명으로 사용하지 않음 |
| Model | schemaVersion, modelId, nodes, edges, parameters, execution | 모델 의미와 화면 배치를 구분 |
| Node | ID, blockType, blockVersion, parameters, port bindings | blockType은 registry 허용 목록 |
| Edge | ID, source node/port, target node/port | 존재하는 포트만 연결. input 다중 writer는 기본 금지 |
| Layout | 위치, 그룹 표시, viewport, panel state | 계산 hash에서 제외할 수 있으나 저장 대상 |
| Asset | ID, version, checksum, schema, units, provenance | 참조는 특정 버전을 고정. 원본과 변환본 분리 |
| Run | runId, semanticHash, engineVersion, asset versions, settings | 실행 시작 snapshot에 고정 |
| Result | samples, diagnostics, completion, source map | 모델과 별도. 중단 결과는 partial로 표시 |

모델 hash는 노드 ID·연결·파라미터·블럭 버전·실행 설정·데이터 버전의 canonical 직렬화로 계산한다. 해시가 같다고 외부 엔진 버전까지 동일하다는 뜻은 아니므로 Run에는 엔진 및 라이브러리 버전도 저장한다. 화면 위치만 옮긴 변경은 결과를 stale로 만들지 않고, 의미가 바뀌면 기존 결과를 이전 실행으로 남긴다.

### 5.2 값과 shape

M1 기본값은 `float64` scalar, boolean, 실수 vector `[n]`, matrix `[m,n]`이다. 배열은 row-major로 정의한다. vector와 1×n matrix를 자동으로 같은 값으로 처리하지 않는다. 차원 없는 scalar의 원소별 broadcast는 해당 블럭 계약이 허용한 경우에만 한다. 원소별 Product와 Matrix Multiply는 서로 다른 연산이다.

JavaScript `Number`는 IEEE 754 배정밀도 표현이므로 모든 실수의 정확한 표현, 임의 크기 정수, 십진 금액의 정확한 계산을 보장하지 않는다. 이 제약은 [Number 공식 참고 문서](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number)에 근거한다. 표시 자릿수와 저장 정밀도를 분리하며, 작은 오차를 UI에서 숨겨 정확한 값이라고 표기하지 않는다.

| 확장 | 예정 | 먼저 확정할 의미 |
| --- | --- | --- |
| 정수·비트 | M2 제한 subset → M5 확장 | M2는 승인한 32비트 이하 폭·signed 여부·변환·overflow 규칙만 지원. 64비트·고급 변환은 M5 |
| float32 | M5 | 연산 후 rounding 시점과 저장 시점. float64 계산 뒤 cast만으로 전체 single 의미를 주장하지 않음 |
| 복소수 | M5 | real/imag 배열, 켤레, 순서 비교 금지, 단위 |
| 문자열·enum | M4~M5 | Unicode 길이 기준, 파싱 형식, 범위, locale 독립성 |
| typed bus | M4 | 필드명·타입·shape가 있는 record. vector Mux와 구분 |
| fixed point | M5 별도 gate | 저장 정수, scaling, rounding, overflow. 부동소수점 대체를 비트 동등이라 표시하지 않음 |
| 일반 n-D tensor | M5 | rank 제한, reshape·permute·broadcast의 명시적 규칙 |

M1 유효 입력·결과는 finite 값으로 제한하고 0 나눗셈, 정의역 오류, overflow를 노드·포트 진단으로 반환한다. 원자료의 Inf/NaN 프리셋은 M5의 고급 수치 정책에서 따로 다룬다. 이를 지원할 때 JSON에는 승인된 tagged value를 사용하고, 결과 정책은 stop 또는 explicit propagation 중 모델에 고정한다. NaN을 숫자 0이나 null로 조용히 바꾸지 않는다.

### 5.3 단위와 인덱스

M1에는 단위 metadata와 합산·비교의 기본 일치 검사를 제공했다. M4는 cm·mm·km·ms·min·g·mV·C·m² 등을 포함한 승인 목록으로 확장하고 Unit Conversion에서 scale·offset을 명시적으로 적용한다. m×m=m², N×m=J, J/s=W 등 목록에 정확한 차원·배율이 있는 결과만 허용한다. cm×cm처럼 승인된 결과 단위가 없는 식은 기본 단위로 먼저 변환한다. 섭씨는 K로 바꾼 뒤 곱·나눗셈을 계산한다. 합산에는 같은 단위가 필요하며 자동 스케일 변환은 하지 않는다. 현재 미지정 단위는 기본값 1로 정규화한다. 일반 차원식과 차원이 있는 ODE 상태는 제공하지 않는다.

내부 인덱스는 0 기반으로 고정한다. 사용자가 보는 Selector 등에는 `indexBase`를 명시하여 0/1 기반을 선택할 수 있게 한다. 초기 기본값은 0이며, Simulink 참고 프리셋은 필요하면 1 기반을 명시한다. 음수·범위 초과·동적 크기 변경의 처리도 블럭 사양에 기록한다.

## 6. 블럭 registry와 canonical 기능

계산 kernel, 사용자 노출 블럭, 프리셋, 뷰어를 구분한다. 예를 들어 Add/Subtract는 Sum의 부호 설정, Ground/One/Pi는 Constant의 값 설정으로 제공할 수 있다. 그러나 Memory/Unit Delay와 Mux/Bus Creator는 실행 의미가 달라 같은 별칭으로 합치지 않는다. Dashboard Display와 Sinks Display도 UI 바인딩과 신호 경로가 달라 구별한다.

각 registry 항목은 다음 계약을 갖는다.

| 계약 | 내용 |
| --- | --- |
| Identity | 안정적인 ID, 버전, 한국어 이름, 영문명, 검색 alias, 원자료 추적 ID |
| Parameters | 런타임 schema, 기본값, 길이·범위·배열 크기 제한 |
| Ports | 방향, 타입, shape, 단위, 신호/메시지/제어 채널 종류 |
| Dependencies | 출력별 현재 입력 의존성. 파라미터에 따른 direct-feedthrough 변경 |
| Lifecycle | 초기화, 현재 출력, 상태 update, derivative, event, 종료 |
| Capability | static/discrete/continuous, 지원 solver, export target |
| Diagnostics | 안정적인 오류 code, 노드/포트/파라미터 위치, 사용자 해결 안내 |
| Verification | 예제, 경계값, analytical/independent oracle, 타깃 비교 fixture |

M1 후보는 Constant, Inport, Sum, Gain, Product, Abs, Math Function, Trigonometric Function, Rounding Function, MinMax, Sqrt, Relational/Logical Operator, Switch, Saturation, Mux/Demux, Vector Concatenate, Reshape, Outport, Display, Terminator 등이다. 이 목록은 약 20개 수준의 시작 범위를 설명한다. canonical 최종 집합과 옵션은 M0에서 대응표와 함께 확정한다. 검색 이름의 개수를 구현 엔진 개수로 세지 않는다.

## 7. 컴파일과 그래프 실행

### 7.1 공통 컴파일 순서

1. 파일 및 메시지 schema, 버전, 크기, ID 중복, 허용 blockType을 검사한다.
2. edge가 가리키는 포트 존재 여부, 연결 수, 필수 입력, 파라미터를 검사한다.
3. 활성 variant와 계층을 해석하고 소스 노드/포트로 돌아갈 source map을 만든다.
4. 타입·shape·단위·샘플시간을 제약으로 추론한다. 상충 또는 미확정은 오류로 반환한다.
5. 현재 출력 의존 그래프를 구성하고 SCC(강연결 요소)로 순환을 찾는다.
6. 실행 모드·solver·타깃 지원 집합을 검사하고 상태·버퍼·스케줄을 할당한다.
7. immutable IR과 실행 계획을 만든 뒤 preview·실행·코드 생성에 공유한다.

알 수 없는 최신 블럭은 보존 가능한 placeholder로 읽을 수 있으나 실행과 export는 차단한다. 오류가 있는 모델을 파일로 보관하는 것과 실행 가능하다고 승인하는 것은 다르다. 실행되지 않는 경로도 schema·자원 검증에서 제외하지 않는다.

### 7.2 정적 계산(M1)

모든 현재 출력 의존이 비순환일 때 위상 순서로 한 번 평가한다. 수정 시 영향받은 하위 경로만 다시 평가할 수 있지만, 첫 구현은 정확한 전체 평가를 기준으로 두고 incremental 최적화는 결과 동등성 확인 후 추가한다. 포트 값 preview는 최신 revision의 성공 결과 또는 이전 실행임을 표시한다.

### 7.3 상태가 있는 순환(M2 이후)

모델에 연결선 순환이 있어도 실제 현재 출력 의존 순환이 아닐 수 있다. Unit Delay는 현재 출력에 이전 상태를 사용하므로 output 단계와 update 단계를 분리한다. State-Space의 D 행렬 등 설정에 따라 현재 입력 의존성이 생기는 블럭은 계약을 동적으로 계산한다.

현재 입력에 의존하는 SCC는 M1~M4에서 명시적으로 차단한다. 사용자에게 순환 경로를 표시하고, 의도한 지연이 있을 때만 Delay 삽입을 제안한다. 자동으로 지연을 넣어 모델 수학을 바꾸지 않는다. M5의 제한된 algebraic solver는 smooth real scalar/vector 등 검증한 경우에만 별도 capability로 연다.

## 8. 이산시간 실행 계약(M2)

시뮬레이션 시간은 벽시계와 분리한다. 초기 범위는 single-thread, 고정 base tick, 각 sample period가 base tick의 정수배인 모델이다. offset 역시 정수 tick으로 제한한다. time은 `start + tick × baseStep`으로 산출하고 반복적인 부동소수점 덧셈을 스케줄의 기준으로 사용하지 않는다.

각 tick은 **이전 committed state 고정 → due source 및 현재 입력에 의존하지 않는 상태 출력 준비 → due direct-feedthrough 출력과 조합 노드를 현재 의존 DAG 위상순서로 함께 평가 → 결과 기록 및 next-state 계산 → next state 일괄 commit** 순서다. 모든 next-state 계산은 동일한 이전 committed state를 사용한다. 현재 입력을 쓰는 이산 필터·PID도 상류 입력이 계산된 뒤 출력이 평가되며, 별도의 선행 output 목록으로 일괄 실행하지 않는다. due가 아닌 상태 블럭은 출력을 유지한다. 초기 상태는 첫 tick(startTime)의 출력 전에 적용한다. 예를 들어 tick 기준 Unit Delay의 y[0]은 초기값이고 y[1]은 u[0]이다. stop tick 포함 여부, non-grid stop time 거절 규칙, 입력 sample hold를 모델 사양에 고정한다.

M2 구현은 `sampleTime={period,offset}`를 정수 base tick으로 저장한다. period1..10000,offset0..period-1이며 기본1/0이다. 일반 연결은 동일 period/offset을 요구하며 Constant/Input만 timeless 예외다. fast/slow 경계에는 명시적인 Rate Transition을 사용한다. read-before-write 경계 버퍼는 수신 tick 시작에 이전 publication을 읽고 producer의 현재 due 값을 tick 끝에 발행한다. 동시 hit·같은 rate의 RT도 이전값을 사용하고 첫 발행 전에는 typed initial을 사용한다. 1·2·5배 양방향, offset·hold·초기값을 fixture로 확인한다. 임의 비율, 비동기 task, 하드웨어 deadline은 별도 확장이다.

M2 난수는 노드마다 독립적인 LCG32를 사용한다. uniform은 due마다1draw, normal은 Box-Muller cosine2draw이며 cache를 두지 않는다. seed·알고리즘·실제 소비 상태를 Run/manifest에 기록한다. 노드 삽입 순서와 다른 source 추가가 stream에 영향을 주지 않는다. 정확한 수식과 초기 hold는 구현 계약을 따른다. MATLAB 난수열 동등성을 주장하지 않으며 실제 보안 토큰에는 플랫폼의 암호학적 난수를 사용한다.

level reset은 현재 출력 뒤 다음 commit을 초기 메모리로 돌린다. 마지막 기록 tick 뒤에는 일반 상태 전이를 진행하지 않는다. finalState는 마지막 출력 projection이며 FIFO/filter/RT/PRNG 내부 메모리는 별도 stateMemory로 방어복사한다. 최초due 전 출력은 각 블럭의 초기 hold 계약을 따른다. FIR 첫계수0·TF b0=0·State Space D=0이면 output feedthrough를 제거하고 승인 피드백을 허용한다.

Memory는 이산 Unit Delay의 별칭으로 제공하지 않는다. M3의 `time.memory`는 직전 승인 솔버 구간 시작의 입력을 다음 승인 경계에서 commit한다. trial·거절 단계에는 갱신하지 않으며 내부 간격이 의미에 영향을 주는 블럭이다. Delay, reset, filter, PID의 초기화·reset·출력 제한은 각각의 계약으로 구분한다.

## 9. 연속시간과 hybrid 실행(M3 이후)

### 9.1 지원 순서

현재 연속 상태는 `dx/dt = f(t,x,u)` 형태의 단위 1 float64 scalar 비강성 ODE이다. M3a는 고정 내부 간격 RK4, M3b는 embedded Dormand–Prince RK45의 step rejection과 오차 제어를 제공한다. boolean·벡터·2D의 M2 이산 영역은 유지되지만 이를 ODE 상태로 자동 변환하지 않는다. solver 이름만 같다고 Simulink solver와 동일 구현·결과를 보장하지 않는다.

Integrator는 초기값과 직접 Hit Crossing 또는 이산 held boolean의 rising reset을 지원한다. Second Order Integrator는 위치 `out`과 `velocity`를 출력한다. State Space는 상태 1~16개, A N×N·B/C/initial 길이 N·D scalar인 SISO다. Transfer Fcn은 내림차순 s 다항식의 proper 전달함수, Zero Pole은 실수 영점·극점과 gain을 같은 제어 정준형으로 내린다. 차수는 최대 16이며 초기 상태 길이·분모 첫 계수·정규화 overflow를 사전 검사한다. 일반 State Space의 A가 특이하다는 이유로 거절하지 않는다. Descriptor의 E, MIMO·복소 극점·improper 전달함수는 지원하지 않는다.

신규 12종은 Second Order Integrator, State Space, Transfer Fcn, Zero Pole, PID, 필터 Derivative, Memory, Zero Order Hold, First Order Hold, 고정 Transport Delay, Hit Crossing, Relay다. PID는 parallel `kp·u + ki·I + kd·N·(u−F)`, `I'=u`, `F'=N·(u−F)`이며 필터 Derivative는 마지막 미분 항과 필터 상태만 사용한다. 출력 제한·anti-windup·자동 튜닝은 포함하지 않는다.

`execution.step`은 원시 출력 격자다. `execution.solver`는 내부 적분과 이산 기본 간격을 별도로 정한다. 생략한 설정은 method=rk4, initialStep/maxStep=출력 간격, minStep=min(출력 간격,1e-8), atol=1e-8, rtol=1e-6, discreteStep=출력 간격으로 정규화한다. 내부 간격은 1e-12 이상, 이산 기본 간격은 1e-9 이상이며 minStep ≤ initialStep ≤ maxStep이다. 승인 단계·거절 단계·미분 평가·사건에는 각각 100,000·10,000·1,000,000·10,000의 절대 상한이 있다. maxRejects=0은 첫 거절에서 실패한다. schemaVersion 1과 기존 static/discrete 모델 의미는 유지한다.

| 실행 항목 | CalcWeave 계약 |
| --- | --- |
| RHS/stage 평가 | 현재 stage t·trial x를 사용하고 연속 source(Sine/Ramp/Clock)를 그 t에서 재평가. hold는 이산/외부 sampled 입력에만 적용. committed discrete state를 변경하지 않음 |
| Step acceptance | 허용오차와 이벤트 위치·순서를 모두 확정한 구간만 상태·history·로깅 commit |
| Step rejection | trial output, event 후보, 난수·큐 부작용을 폐기 또는 rollback |
| 오차 규칙 | component별 `atol + rtol × max(abs(x_old), abs(x_new))` scale, norm과 safety factor를 버전 명세로 고정 |
| 시간 제한 | min/max step, rejection/step 상한, nonfinite state 검사 |
| 기록 시간 | 출력 격자·사건·이산 경계에서 실제 적분 구간을 끝냄. 화면 기록을 위해 trial 상태를 보간하지 않음 |
| 불연속 시점 | 알려진 Step/Pulse/sample hit에서 step을 분할하고 재초기화 |

### 9.2 이벤트와 zero crossing

Relay, Hit Crossing, reset, Saturation 경계 등은 단순한 화면 변화가 아니라 시간상의 사건이다. guard 함수, crossing direction, bracket/refinement, event tolerance, 같은 시점 우선순위, reset 후 재평가 규칙을 정한다. 수치오차 검사를 통과한 trial step에 crossing이 있어도 event 위치 확정 전에는 step 끝의 history·로그를 commit하지 않는다. 가장 이른 event까지 재적분 또는 step 축소하여 유효 구간만 commit한 뒤 reset·동시 tick을 정해진 우선순위로 처리하고 solver를 재시작한다. 극단적인 chattering에는 이벤트 횟수·최소 시간 간격 제한과 진단을 둔다.

현재 M3는 Step·Ramp 시작·Pulse·반복 수열의 알려진 시각, Hit Crossing·Relay·scalar Saturation guard와 승인 연속-이산 조합을 처리한다. 같은 시각에는 상태 사건·reset → 이산 tick → 관측 순서를 사용하고 M2의 tick 내부 read-before-write는 유지한다. 연속→이산은 Zero Order Hold를 명시하고, 이산→ODE는 causal held 값을 직접 연결할 수 있다. 서로 다른 이산 period/offset 사이에는 Rate Transition이 필요하다. Clock/DigitalClock 기본 단위는 s이며 연속 모델에서만 unit=1을 명시해 1초 기준 무차원 시간좌표를 선택할 수 있다. 자동 단위 변환은 하지 않는다.

변하는 연속 Round·previous Lookup·수식의 floor/ceil/round/trunc·등록하지 않은 Compare 조건의 Switch가 ODE 미분 경로에 있으면 사전에 거절한다. 동일 연산의 원시 출력 표 또는 이산 held 입력 경로는 별도로 허용한다. step 내부에서 여러 번 교차하거나 tangential crossing처럼 부호 변화가 없는 사건은 모두 찾을 수 없으므로 최대 간격과 사건 허용값을 사용자가 설정해야 한다. 이 위험은 [MathWorks Zero-Crossing Detection](https://www.mathworks.com/help/simulink/ug/zero-crossing-detection.html)을 참고하며, CalcWeave의 사건 정밀도는 별도 fixture로 확인한다.

Transport Delay는 양의 고정 지연만 지원한다. 승인 이력의 선형 보간, 시작 전 initial, 지연 이하의 내부 구간과 상태·이력 합계 100,000개 원소 상한을 사용한다. Zero Order Hold는 due 경계에서 scalar 입력을 샘플링하고 유지한다. First Order Hold는 이전 두 샘플의 기울기를 다음 구간에 외삽하는 causal 방식이다. 두 hold의 scalar·단위 1 경계와 Memory의 승인 단계 갱신을 일반 이산 Unit Delay와 구분한다. Derivative를 임의 불연속 입력의 정확한 미분기로 표시하지 않는다. 가변 지연, limited Integrator, PID anti-windup·자동 튜닝은 후속 범위다.

결과에는 원시 출력 샘플과 finalState/stateMemory 외에 `solverStatistics`와 사건 `events`가 있다. 수락·거절·평가·사건 횟수, 마지막 및 최소/최대 승인 간격을 기록한다. 실패는 완료·취소와 구분된 `failed`이며 진단에 시각과 블럭 위치를 보존한다. `ModelError.partialResult`는 마지막 승인 상태와 유효 원시 기록을 제공하며 완료 결과 fixture로 내보내지 않는다.

강성 ODE, 일반 DAE, implicit solver, 비매끄러운 대수 순환은 M5~M7 연구 gate다. 지원하지 않는 경우 solver를 임의로 선택해 성공처럼 실행하지 않는다.

## 10. 계층·라우팅·메시지의 확장

M4 Subsystem은 프로젝트에 내장한 버전 있는 정의를 명시적 Inport/Outport로 연결한다. 선택 블럭 묶기·하위 도식 이동·편집·인스턴스 갱신을 제공한다. 컴파일 시 flatten하며 계층 경로·정의 hash와 독립 상태 ID를 유지한다. 정의 최대 16개, 깊이 8, 각 방향 포트 8개, 펼친 노드 1,000개를 제한하고 재귀·버전 불일치를 거부한다. 인터페이스는 투명하며 단위·rate는 실제 내부 노드에서 검사한다. 외부 모델 파일 참조, atomic·enabled·triggered·resettable·for/while·function-call은 각각 별도 실행 계약이 필요한 후속 범위다.

M4 Bus는 동일 타입·단위의 scalar 두 개를 이름 있는 필드로 묶고 하나를 선택하는 범위다. 내부 값은 vector와 필드 메타정보로 표현하며 이질·중첩 record나 상태 블럭을 통과하는 필드 유지까지 제공하지 않는다. Mux의 위치 기반 vector 조합과 구분한다. Goto/From에는 scope와 충돌 검사, Data Store에는 reader/writer 순서·다중 writer 검사가 필요하며 아직 제공하지 않는다. variant 실행도 후속 범위다.

M5 메시지 엔진은 신호 포트와 다른 메시지 채널을 사용한다. 이벤트 큐의 정렬 키는 `(logical time, priority, sequence)`로 고정한다. queue 용량, overflow의 drop/error, consume/peek, 같은 시점 재진입·이벤트 폭주 상한을 정의한다. 엔터티 네트워크 모델링과 SimEvents 전체 동등성은 선언하지 않는다.

## 11. 데이터와 실행 기록

M4는 CSV와 JSON 레코드 배열을 로컬에서 읽고 number·boolean·string 열의 타입·단위·시간축을 미리 확인한다. 결측 거부/행 제외/숫자 0, 정렬, 중복 시각 거부/첫 행/마지막 행, 문자열 trim·소문자 변환을 명시적으로 선택한다. 파일 최대 2 MiB, 데이터당 4,000행·16열·20,000셀, 프로젝트당 8개를 제한한다. XLSX·MAT·MATLAB workspace 접근·인터넷 수집은 제공하지 않는다.

시간 데이터에는 시간 정렬·중복 시각·결측·범위 밖 처리·보간(`hold`/`linear`)을 명시한다. 보간은 신호 의미에 따라 선택하고 정수/boolean/event에 linear를 무조건 적용하지 않는다. 파일명을 식별자·경로로 신뢰하지 않으며 사용자 파일의 수식·매크로·링크를 실행하지 않는다.

같은 데이터 ID를 갱신할 때 버전을 올리고 원본 텍스트의 sourceHash와 정리된 타입·시간축·행의 contentHash를 구분한다. 현재 프로젝트는 최신 버전을 보관하고 완료 실행 이력은 당시 모델·데이터의 독립 snapshot을 보존한다. 원본 파일 전체와 모든 과거 데이터 버전을 별도로 보관하는 저장소는 아니다. 결과 CSV는 수식 형태의 문자열 셀을 보호하고 JSON은 원시 값을 유지한다. 비교는 동일 단위·시간 격자의 공통 numeric scalar 출력 최대 3개 실행을 대상으로 최종 차이와 RMSE를 계산한다.

M4 sweep은 root Constant/Input.value 또는 Gain.gain의 숫자 값 최대 16개를 실행한다. 전체 30초·1,000,000 기록 원소·50,000,000 가중 연산을 공유하고 각 Worker에 남은 예산을 전달한다. 취소·실패 시 완료된 실행과 진단을 남긴다. 실행 이력은 최대 5개·20 MiB, 한 기록의 수치·boolean·시간 원소는 200,000개로 제한한다. 기록은 모델 hash와 manifest를 검증하며 손상 원본을 자동 덮어쓰지 않는다.

Scope는 관찰용 plot이며 실행 state를 소유하지 않는다. 화면용 decimation은 계산 입력과 원본 기록을 바꾸지 않는다. 그래프에는 축·단위·범례·표 보기·시각별 값 조회를 제공한다. 큰 기록은 chunk 및 retention budget으로 제한하고 축약/부분 기록임을 결과 metadata에 남긴다.

M4 Dashboard는 기본적으로 파라미터 편집과 다음 Run 적용에 사용한다. 실행 중 live tuning은 별도 검증한 capability로만 허용하고, 시작 snapshot 외에 적용 tick·값·순서의 입력 이벤트 로그를 manifest에 추가한다. 재현 실행도 같은 로그를 소비해야 한다. 기존 Run의 snapshot을 직접 수정하지 않는다.

## 12. 저장, 복구, 이동 가능한 파일

M1의 이동 형식은 `*.cw.json` 모델 파일이다. 외부 자산을 참조하면 manifest에 누락 여부를 표시한다. M4에서 `*.cwpack`으로 모델·데이터·manifest를 묶는 독립 bundle을 검토한다. 압축 bundle에는 항목 수·해제 후 총 크기·개별 크기·중첩 깊이 제한을 적용하고 absolute path, `..`, 실행 파일을 거절한다.

schemaVersion과 blockVersion별 migration은 원본을 보존한 복사본에서 수행한다. 미래 schema는 읽기 거절 또는 읽기 전용 placeholder로 처리한다. 파일 가져오기는 기존 모델에 바로 덮어쓰지 않고 validation summary 후 새 프로젝트 또는 명시적 교체 command로 반영한다.

자동 저장은 IndexedDB 트랜잭션 성공 이후에만 `저장됨`으로 표시한다. write 실패·quota 부족·다른 탭 revision 충돌을 처리하고 session 복구 snapshot을 남긴다. 브라우저 저장은 quota·사용자 삭제·eviction의 영향을 받으므로 영구 백업 보장이 아니다. 공식 [Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)를 근거로 파일 다운로드 백업과 persistence 요청을 별도 제공한다.

M1의 로컬 계산과, 오프라인 재접속 가능 여부는 별도다. 오프라인 앱 shell은 M6에서 service worker 캐시·버전 교체·기존 모델 migration을 검증한 뒤 지원한다. 첫 접속부터 인터넷 없이 앱을 얻을 수 있다는 의미로 설명하지 않는다.

## 13. 제한된 사용자 수식

Fcn의 독립 대체는 수식 parser → 제한 AST → interpreter/IR lowering으로 구현한다. 초기 grammar는 숫자 literal, 승인된 입력·파라미터 식별자, 사칙·거듭제곱, 괄호, 승인된 수학 함수다. 연산자 우선순위·거듭제곱 결합 방향·함수 정의역을 문서화한다. UI 수식은 TS 문자열로 그대로 붙이지 않는다.

프로퍼티 접근, 대입, 사용자 함수 정의, loop, dynamic import, 전역 객체 접근, I/O를 허용하지 않는다. `eval`, `new Function`, 사용자 제공 Worker URL을 쓰지 않는다. AST 노드 수·깊이·문자 길이·연산 budget을 제한한다. `__proto__`, `constructor` 등 예약 키와 prototype 오염을 검증하고 registry 조회는 소유 속성/안전한 map으로 처리한다.

MATLAB Function은 이 제한 수식의 검색 안내가 될 수 있으나 MATLAB 소스 호환 블럭이라고 표기하지 않는다. 사용자 확장 함수가 필요하면 M7에 별도 서명된 registry 및 격리 계약을 설계한다. 네이티브 adapter는 사전 컴파일된 WASM 등 제한 ABI를 검토하며, 임의 C/MEX/S-function 업로드의 즉시 실행은 제공하지 않는다.

## 14. 코드 export 계약

### 14.1 M2·M3·M4 TypeScript 타깃

export는 화면 JSON을 다운로드하는 기능과 다르다. 컴파일한 IR에서 읽기 가능한 TypeScript와 최소 런타임을 생성해 지원 모델을 웹 앱 없이 실행할 수 있어야 한다. 생성 코드에 숨겨진 원격 계산 서비스나 CalcWeave 계정을 요구하지 않는다.

| 파일 | 역할 |
| --- | --- |
| `model.ts` | import 없는 고정 runtime·검증 IR·run/getManifest API |
| `model.cw.json` | 기본 파라미터·sampleTime을 정규화한 portable 모델 |
| `manifest.json` | SHA-256 의미 hash, 엔진/타깃 버전, node sampleTime/domain/seed, outputTypes, rate 정책, 자원 제한; solver·reset-tick-observe와 사용 데이터의 버전·hash, 계층 인스턴스 경로·정의 hash |
| `expected-output.json` | 현재 모델 snapshot의 완료 결과가 있을 때만 포함; 없으면 README에 명시 |
| `run-example.ts` | 독립 모델 실행 예제 |
| `README.md` | TypeScript 환경과 실행 방법·지원/허용오차 설명 |

M2 시점의 `typescript-m2-v1`은 정적·고정 tick 이산 블럭에 제한했다. 현재 M3의 `typescript-m3-v1`은 승인 RK4·RK45·혼합 실행도 독립 코드로 생성한다. 출력·최종 상태·내부 메모리·사건·솔버 통계·실패 partial과 manifest의 Node 실행 parity를 별도로 확인한다. 생성한 파일의 존재를 수치 동등성 근거로 삼지 않으며 실제 fixture는 M3 검증 기록에 둔다.

M4 기능을 사용하는 모델은 `typescript-m4-v1`을 선택한다. 데이터 literal·변환 계수·Bus 필드 인덱스와 펼친 계층 IR을 코드에 포함해 추가 파일이나 앱 import 없이 실행한다. JSON에는 참조와 내장 데이터·정의를 보존한다. 18개 독립 수치 기준과 3개 sweep 변형을 모든 원시 샘플로 검증하고 세 실행 형식의 strict ES2022 검사와 실제 ESM 실행을 확인한다. 이전 기능만 사용하는 모델의 M2/M3 타깃 선택은 유지한다.

코드 식별자는 안전한 생성 ID를 사용하며 사용자 label은 escape된 문자열과 source map에만 반영한다. 데이터 literal은 serializer로 출력한다. 수식은 승인된 AST에서 생성한다. 비지원 노드·파라미터·solver가 하나라도 있으면 export를 차단하고 위치와 대안을 표시한다. 일부 모델을 조용히 버린 코드를 성공으로 내려주지 않는다.

### 14.2 실행 동등성

동일 모델 snapshot·입력·seed·설정에 대해 브라우저 IR 실행과 독립 Node 실행을 비교한다. 단순히 codegen이 같은 라이브러리를 호출한다는 사실만으로 검증을 대신하지 않는다. 분석해와 독립 fixture도 함께 사용한다. 정수/boolean 결과는 exact 비교, 실수는 fixture별 absolute/relative tolerance를 적용하고 transcendental 함수의 환경 차이를 고려한다.

### 14.3 M7 언어 확장

M7의 Python 타깃은 정적·이산 subset의 타입·형상·상태·실패·예산 계약을 구현하고 실제 Python 실행으로 검증했다. 연속·고급 수치와 C·WASM 확장은 타깃별 메모리·solver·빌드·지원표와 별도 검증이 필요한 후속 범위다. C export가 Embedded Coder 수준의 하드웨어 인증이나 모든 solver 지원을 의미하지 않는다. `.slx` import/export와 MATLAB 코드 번역은 별도 연구이며 초기 portable 모델 형식의 대체 이름으로 쓰지 않는다.

## 15. 실행 상태, 취소, 재현성

UI는 `idle / validating / ready / running / paused / completed / cancelled / failed`를 표현한다. 저장 상태와 결과 최신성은 별도 축이다. 실행 중 모델을 편집할 수 있어도 현재 Run은 시작 snapshot을 계속 사용하고, 새 revision은 다음 실행에 적용한다. 취소된 기록은 `partial/cancelled`로 남기거나 사용자 설정에 따라 삭제한다.

M2 Worker는 strict run/cancel/pause/resume 명령과 UUID requestId를 검증하고 실행 경계에서 모델을 재컴파일·hash한다. 현재 run과 다른 제어/결과 메시지는 무시한다. engine의 safe-boundary pause ack 이후만 UI와watchdog을 멈추고, resume ack 이후 남은 active 시간 예산을 이어간다. abort는 pause wait를 깨운다. UI reset은 실행/기록을 초기화하며 모델·좌표는 보존한다. 추가 runId/protocolVersion과 transfer 소유권 최적화는 필요 단계에서 별도 검증한다. SharedArrayBuffer·GPU 실행은 사용하지 않는다.

긴 실행은 chunk마다 이벤트 루프에 제어를 반환하여 취소 메시지를 받는다. 무한한 동기 연산이 취소 요청을 처리할 수 있다고 가정하지 않는다. UI watchdog은 제한을 넘긴 Worker를 종료하고 새 Worker에서 복구한다. 기록·자산 write는 commit 확인을 거치며 Worker 강제 종료로 저장이 완료된 것처럼 표시하지 않는다.

정해진 입력과 버전에서 결정적인 실행 순서를 목표로 하되 모든 브라우저·CPU의 실수 결과가 bit-for-bit 같다고 선언하지 않는다. 재현 정보와 fixture 허용오차를 함께 제공한다. 결과 trace에는 값을 전부 로그로 남기기보다 실행 진단과 사용자가 선택한 신호만 기록한다.

## 16. 자원 예산과 성능 검증

다음은 **측정 전 기본 상한 제안**이다. M0에서 장비·브라우저·fixture를 기록해 조정한다. 상한 이하이면 언제나 빠르다는 보장이 아니며, 한도는 클라이언트 검증·Worker 검증·선택 서버 검증에 각각 적용한다.

| 항목 | 초기 제안 | 초과 시 처리 |
| --- | ---: | --- |
| 모델 노드 / edge | 1,000 / 5,000 | 가져오기·실행 전에 설명과 축소 안내 |
| 모델 JSON | 5 MiB | parse 전 byte 검사, schema 상한 검사 |
| 데이터 자산 | 20 MiB / 단일 자산 | 먼저 거절. 스트리밍 확대는 별도 gate |
| 기록량 | 1,000,000 scalar values | float64 원시 값은 8 MB(약 7.63 MiB), timestamp·metadata 비용 추가; decimation/stop 정책 명시 |
| matrix kernel | 입력 요소 수 및 예상 연산 수 | 행렬 곱은 shape만으로 비용 추산, 메모리·연산 예산 선검사 |
| 반복 subsystem | 호출당 10,000 iteration | bounded iteration 초과 진단 |
| 수식 | 길이·AST 깊이·노드 수 | M0에 구체 상한과 악성 fixture 확정 |
| 단일 Run | active 실행30초 기본 budget | paused 벽시계는 제외; progress 후 제한 도달 진단. 설정 확대도 절대 상한 내에서만 |
| M2 상태·held·rate buffer | 합계100,000원소 | compiler preflight와 runtime/export 재검사; 지연·신호 크기 축소 안내 |
| step / event / queue | solver·채널별 제한 | min step stall, chatter, queue 폭주 중단 |

측정 목표는 보통 모델의 편집 반응 p95 100ms 이내, 취소 후 UI 응답 1초 이내다. 100노드 일상 fixture와 1,000노드 스트레스 fixture를 분리한다. solver·데이터 parse·plot을 별도 측정하고 사용량·메모리 증가·취소 응답을 함께 본다. 목표를 달성하지 못하면 블럭 수를 늘리기 전에 실행 예산·chunk·plot decimation을 조정한다.

React Flow는 custom node와 handler memoization, 과도한 node/edge 구독 감소 등 최적화 지침을 제공한다. [공식 성능 문서](https://reactflow.dev/learn/advanced-use/performance)를 참고하되 CalcWeave의 large graph 능력은 자체 fixture로 측정한다. 캔버스 표시 가능한 노드 수와 시뮬레이션 가능한 모델 크기를 동일 숫자로 광고하지 않는다.

## 17. 보안과 데이터 보호 기본값

로컬 앱에서도 사용자가 가져온 모델·데이터·label·수식은 신뢰하지 않는다. 계산 Worker는 신뢰된 kernel과 제한 AST만 실행한다. 모델이나 데이터의 URL을 자동으로 fetch하지 않는다. 외부 코드·원격 plugin은 별도 승인된 제품 기능과 격리 계약이 준비되기 전에는 지원하지 않는다.

| 기준 | 로컬 기본 / 선택 서버 적용 |
| --- | --- |
| 쿼리 | 서버 도입 시 ORM/파라미터 바인딩. 정렬·컬럼은 허용 목록 |
| 출력 | label·주석·데이터를 텍스트로 렌더링. HTML 실행·escape 해제 금지 |
| 시크릿 | 소스·export·모델 파일에 키/토큰 저장 금지. 서버 키의 public env 노출 금지 |
| 인가 | API·자산 조회/수정/삭제 모두 세션 및 소유자/명시적 공유 권한 조건 |
| 입력 | 가져오기와 Worker에서 schema·범위·크기·깊이 검증. 서버가 생기면 서버에서도 재검증 |
| 제한 | 로컬 연산 budget. 서버 인증·업로드·유료 호출은 IP+계정 rate limit·quota |
| 설정 | HTTPS, CSP, origin 허용 목록, 운영 debug off. 쿠키 세션은 httpOnly+secure+sameSite 및 CSRF 방어 |
| DB | 앱 최소 권한, 비공개 자산. Supabase 선택 시 RLS와 동작별 소유자 정책 검증 |

다운로드 CSV를 spreadsheet로 여는 경로는 `=`, `+`, `-`, `@`로 시작하는 문자열의 수식 실행 가능성을 고려한다. 숫자 열과 문자열 열을 구분하고 spreadsheet-safe 문자열 export 옵션을 제공한다. 모델 파일의 원래 값까지 조용히 바꾸지 않는다. 사용자 주석에 Markdown을 지원하면 raw HTML을 금지하고 검증된 렌더러 정책을 추가한다.

M1~M5 기본에는 계정·이메일 수집·광고 추적·서버 모델 업로드를 넣지 않는다. 로컬 처리여도 파일 데이터에는 개인정보가 있을 수 있어 telemetry로 원본 값·수식·label을 전송하지 않는 방향으로 설계한다. 정적 사이트 제공자의 접속 로그 등 서비스 운영 데이터는 별도 확인한다.

선택 클라우드를 도입하면 최소 수집, 보유·파기, 삭제·내보내기, 위탁·국외 이전 현황, 동의, 접근 기록과 복구를 요구사항으로 확정한다. 한국 개인정보 관련 법률 문서는 실제 사업자와 데이터 흐름이 정해진 시점에 당시 법령 및 공식 자료를 확인해 작성한다. 이 백서는 법률 적합성 판정이나 실제 정책 문서를 대신하지 않는다.

## 18. 선택 클라우드(M6 별도 트랙)

첫 클라우드 기능은 프로젝트 비공개 백업과 기기간 동기화 후보로 한정한다. 실시간 공동 편집·공개 gallery·유료 원격 계산을 동시에 도입하지 않는다. cloud revision과 local revision의 충돌은 자동 덮어쓰기 대신 비교·복사 복구를 제공한다.

서버는 소유자 ID를 인증 세션에서 결정한다. 클라이언트가 보낸 ownerId·권한·요금·계산 한도는 신뢰하지 않는다. 프로젝트 삭제 시 metadata·asset·결과·공유 권한을 함께 처리하고, 백업의 파기 일정도 명시한다. 공유 링크를 추가할 경우 범위·만료·취소와 직접 object URL의 권한 검사를 검증한다.

원격 계산이 필요해지면 큐·CPU/메모리/시간 상한·비용 quota·네트워크 제한을 둔 별도 실행 환경을 설계한다. 임의 사용자 코드 실행을 기존 앱 서버 프로세스에 추가하지 않는다. 이 트랙이 준비되지 않아도 검증된 로컬 제품의 공개 베타는 진행할 수 있다.

## 19. 정확도와 검증 전략

| 검증 층 | fixture 예 | 통과 기준의 성격 |
| --- | --- | --- |
| 블럭 kernel | 경계값, shape mismatch, NaN 정책, rounding | 사양·분석값에 대한 fixture별 exact/tolerance |
| 컴파일 | 잘못된 포트, 순환, unit mismatch, 누락 자산 | 안정적인 진단 code와 위치 |
| 정적 계산 | `(3 + 4) × 2 = 14`, 행렬 곱 | 독립 수작업 기준 및 algebraic property |
| 이산 상태 | impulse delay, 누적합, FIR, reset, seeded random | 첫 tick·읽기/commit 순서·재실행 일치 |
| 연속 ODE | `x'=-x`, `x(0)=1`; 조화진동; 1차 step 응답 | 분석해, step-halving 수렴, 독립 solver 비교 |
| hybrid | known Step 시점, relay, reset crossing | 이벤트 시각·상태 불연속·chatter 실패 정책 |
| 데이터 | duplicate time, missing, units, checksum 변경 | 정책대로 변환 또는 거절, 원본 보존 |
| export | 같은 입력의 브라우저 IR / 독립 Node 실행 | 지원 모델 전체 output·state·seed parity |
| 보안·자원 | 깊은 JSON, 큰 matrix, 오염 key, 악성 label, 무한 loop | 실행 전 거절 또는 budget 중단, UI 복구 |
| UX·저장 | keyboard-only 모델, quota 실패, 새로고침, stale Run | 사용자 핵심 흐름 완주와 복구 |

매끄러운 RK4 fixture에서는 h를 절반으로 줄일 때 global error가 4차 수렴 경향을 보이는지 검사한다. discontinuity에 같은 조건을 기계적으로 적용하지 않는다. 현재 기본 atol=1e-8·rtol=1e-6이며 fixture별 실제 분석해 오차와 event 시각 오차를 별도로 판정한다. solver의 local error 설정을 전체 결과의 정확도 보장으로 표현하지 않는다.

기준 정답을 CalcWeave 자신의 구현으로만 생성하지 않는다. 분석해·보존량·독립 solver·검증한 참고 데이터 중 두 경로를 조합한다. MATLAB 설치가 있는 경우의 비교는 선택적 교차 검증이며 제품 구축이나 CI의 필수 의존성으로 두지 않는다.

## 20. 구축 순서와 완료 조건

| 단계 | 기술 성과 | 후속 단계에 넘길 계약 |
| --- | --- | --- |
| M0 | 블럭 대응표, model/IR, solver spike, budget 실측 | 숫자·상태·시간·export의 기준 fixture |
| M1 | 정적 계산 편집기, 저장·복구 | schema와 DAG kernel, 첫 성공 UX |
| M2 | 이산 scheduler, TS standalone export | read/update, sample hit, seed, parity |
| M3 | ODE solver, 제한 event/hybrid | stage 부작용 차단, acceptance, 이벤트 시각 |
| M4 | 데이터 자산, 계층, typed bus, dashboard | 자산 버전, scope·state ID, UI 바인딩 |
| M5 | 고급 의미와 외부 호환 경계 정리 | 기능별 공개 지원표와 차단 정책 |
| M6 | 공개 베타·릴리스 gate, 선택 cloud | UX·수치·보안·오프라인·복구 확인 |
| M7 | 타깃 언어·WASM·확장 생태계 | 타깃별 ABI·라이선스·격리·동등성 |

자세한 산출물과 진입·종료 조건은 [마일스톤 문서](03-milestone-roadmap.md)에 둔다. 공개 제품은 검증된 기능 집합을 정확히 설명하여 출시할 수 있으며, dataset 전체와의 의미 동등성은 별도 장기 검증 목표다.

## 21. 주요 위험과 설계 대응

| 위험 | 조기 신호 | 대응 |
| --- | --- | --- |
| 블럭 이름 구현이 동작 호환으로 오인됨 | 같은 이름인데 초기 상태/시간 결과가 다름 | 기능별 계약·제한·fixture, 미지원 옵션 차단 |
| solver 오류를 그럴듯한 plot이 감춤 | step size에 따라 결론이 바뀜 | 분석해·수렴·event 검사, 진단과 설정 공개 |
| UI와 codegen이 다른 의미 사용 | tick 0·reset·seed에서 parity 실패 | 공통 IR/수치 계약과 독립 export fixture |
| 초기에 전체 옵션을 구현함 | 핵심 흐름 완성 전 registry만 커짐 | canonical 핵심을 먼저 완주, 별칭은 preset |
| 큰 데이터·배열이 브라우저를 멈춤 | parse/shape 비용이 실행 budget보다 큼 | byte/shape/ops 선검사, chunk·watchdog |
| 로컬 저장을 영구 백업으로 오인함 | quota·브라우저 초기화 후 복구 불가 | 다운로드 백업·복구 안내·저장 성공 상태 |
| arbitrary code 확장이 경계를 무너뜨림 | 사용자 import/eval이 필요해짐 | 제한 AST 유지, adapter는 독립 gate |
| cloud가 출시를 과도하게 늦춤 | auth/협업이 코어 개발을 잠식 | 선택 트랙, 로컬 release gate 유지 |

## 22. 사양 관리

새 블럭을 추가할 때 계약 → oracle fixture → kernel → 편집/진단 → export 지원 판정 → 공개 지원표 순서로 완결한다. 오류 수정이 결과 의미를 바꾸면 blockVersion 또는 engineVersion을 올리고 이전 Run을 재현할 수 있는 manifest를 유지한다. 모델 migration과 수치 의미 변경을 함께 기록한다.

v0.1의 설계 기준, v0.2의 M1, v0.3의 M2, v0.4의 M3에 이어 v0.5는 승인 M4 데이터·계층·실험을 반영한다. 단계별 과거 증거는 보존하며 새 옵션·타깃은 실제 검증 기록을 추가한 뒤 지원표에 반영한다. 외부 검증과 초보 사용자 조사 게이트를 기능 구현만으로 완료 처리하지 않는다.

보안 기준 반영: 사용자 수식의 임의 실행을 제외하고, 모델·데이터의 상한 검증과 선택 서버의 소유자 조건·시크릿 분리를 기본 설계에 포함했다.
