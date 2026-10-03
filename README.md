# CalcWeave

> 블럭을 연결해 수학을 계산하고, 시간에 따른 변화를 관찰하며, 모델을 데이터와 실행 코드로 이어가는 웹 도구.  
> 기준일: 2026-10-03 · 앱: 0.10.1 · 엔진: 0.10.0-m9 · 현재 상태: M8·M9의 선언된 제한 범위 로컬검증 완료. registry211종(185+26)·M9 preset15개·예제39개·6개 카테고리. 공개 Pages의 이번 버전 배포·실제 주소 검증도 완료했으며 실제 사용자 조사·목표 도메인 확인은 별도입니다.

CalcWeave는 MATLAB 설치 없이 브라우저에서 사용할 수 있는 블럭 기반 수학 계산·시뮬레이션 도구를 목표로 합니다. Simulink 기본 라이브러리의 기능 개념을 참고하면서, 초보자가 입력·계산·결과를 이해하고 점차 고급 모델로 확장할 수 있는 독립적인 사용 경험을 설계합니다.

웹 베타 주소: [CalcWeave 작업 공간](https://jtech-co.github.io/CalcWeave/). 배포 결과와 실제 공개 파일 검증은 [Pages 배포 기록](docs/pages-validation.md)에 남깁니다.

## M10 자료형·복소수·고정소수점·n-D

앱0.11.0·엔진0.11.0-m10의 선택 범위를 로컬 검증했습니다. 기존211종을 보존하고34종·10preset·6예제를 추가해245종·45예제/7범주입니다. 원본행 승인subset245/385·미구현140이며 전체옵션 동등성은 열린후속입니다. 전체unit2669개,209actual TypeScript와484samples,typed UI7개,design188관측,성능6예산 및root/project release70검사를 확인했습니다. 전체rootbrowser138개 중135PASS 뒤3건을해결해 관련21개재검사PASS로 기록합니다. 공개 배포는 M11·M12 종료후 통합릴리스 예정입니다. [M10계약](docs/m10-contract.md)·[검증](docs/m10-validation.md)

## M9 DSP·이산 상태 확장

M9의 최초 engineering 납품 앱0.10.0·엔진0.10.0-m9는 기존185개 정의를 보존하고 필터 실현 구조·이산 PID/2DOF·MIMO 상태공간·제어 가능한 정수 지연·발행 예약 지연·물리적 샘플시간 계산 등26개 정의를 추가합니다. registry211종과M9 명명 preset15개는 원본행 승인 수·독립 kernel 수와 다른 지표입니다. 학습 예제4개를 더해39개를6범주에서 탐색합니다.

초기 앱0.10.0의 M9 선언 범위는 마지막 수치 수정 후 로컬 수치·독립 TypeScript·상태·진단 검증과 초기 공개 CI의 전체unit2,175개·루트browser129개·project browser4개, 공개 브라우저9개 검증을 완료했습니다. 현재 source 승인 기록은 신규31행과 기존05-009 추적 교정1행을 반영해 subset211행·미구현174행입니다. 151raw fixture records·30preset mode records·693raw samples·191actual TypeScript 프로그램과전체unit2,175개가 통과했으며, 원본 전체 옵션 동등성이나 MathWorks seed/bit parity를 주장하지 않습니다. [M9 계약](docs/m9-contract.md) · [구현 맵](docs/m9-implementation-map.json) · [검증 기록](docs/m9-validation.md)

## M8 수학·조회표 납품 기록

앱0.9.0·엔진0.9.0-m8의 선언된 구현 범위를 검증했습니다. 동적 범위·논리·배열 조작·rank1~10 조회표 등41개 정의를 추가해 총185종이고, 기존144개 계약은 보존합니다. 사전 설정8개와 학습 예제3개를 추가해 예제35개를6범주에서 찾습니다. 원자료46행의 제한 범위를 추가 승인해 검증된 subset180행·미구현205행입니다.

독립 기준값120개·원시샘플896개·실행한TypeScript388개와 전체테스트1,746개를 확인했습니다. 원본의 모든 옵션과의 동등성은 후속 작업입니다. [M8 계약](docs/m8-contract.md) · [검증](docs/m8-validation.md) · [원본행 근거](docs/evidence/m8-source-approvals.json)

## 실행하기

개발에는 Node.js 22.12 이상과 npm이 필요합니다. 이번 검증은 Windows의 Node.js 25.9.0에서 수행했습니다. 웹 사용자가 CalcWeave를 사용하기 위해 Node.js를 설치하는 구조는 아닙니다.

```powershell
npm ci
npm run dev
```

브라우저에서 http://127.0.0.1:5173 을 엽니다. 빌드 결과를 확인하려면 다음 명령을 사용합니다.

```powershell
npm run build
npm run preview
```

미리보기 주소는 http://127.0.0.1:4173 입니다. 개발·미리보기 서버는 로컬 호스트에만 연결됩니다. GitHub Pages의 `/CalcWeave/` 경로와 custom domain의 `/` 빌드를 모두 지원합니다. `calcweave.com` 연결은 별도 단계입니다.

## M7 코드와 모델 공유

**코드 타깃 선택**에서 TypeScript와 Python을 선택합니다. Python은 표준 라이브러리만 쓰는 독립 `model.py`와 실행 묶음으로 내려받으며, 승인된51종의 정적·이산 모델을 지원합니다. 연속 solver·고급 계산·추가 수학/조회표·M9 DSP/이산 상태는 생성 전에 블럭별 이유를 표시하고 TypeScript를 안내합니다. 웹 계산은 Python 설치 없이 사용할 수 있고, 내려받은 Python 코드는 사용자가 준비한 Python 3.10 이상에서 실행합니다.

**모델 패키지**는 현재 모델의 데이터·하위 도식·대시보드·노트를 함께 공유합니다. 일회용 공개키 fingerprint를 출처에서 별도로 확인한 뒤 수락하며, 서명만 확인한 파일을 자동 신뢰하지 않습니다. 패키지는 승인된 기존 블럭의 선언형 모델만 포함하고 임의 코드를 설치하지 않습니다. 원본 JSON 가져오기는 구문·실행 여부를 보고하고, 구조가 유효하지만 계산할 수 없는 모델은 진단과 함께 편집할 수 있습니다. 외부 도식 변환은 수행하지 않습니다. [M7 계약](docs/m7-contract.md) · [검증 기록](docs/m7-validation.md)을 참고하세요.

## 로컬 베타 릴리스 기반

**지원·릴리스**에서 동일 registry의 블럭 계약·한도·사용 방법·정책을 확인합니다. **로컬 데이터 관리**에서 전체 작업 공간 백업·해시 검증 복구, 손상 원본 다운로드, 저장 공간 상태, 제한된 진단 기록과 2단계 초기화를 제공합니다. 여러 탭 저장 충돌은 자동 저장을 중지하고 현재 작업 백업과 최신 저장본 불러오기로 해결합니다.

production preview와 HTTPS에서는 검증된 정적 릴리스를 오프라인으로 설치합니다. 설치 완료 후 모델 재열기·Worker 계산·TS 실행 묶음 export까지 네트워크 없이 사용할 수 있습니다. 새 릴리스는 저장 성공 후 사용자 선택으로 적용합니다. 과거 정적 캐시는 기존 탭을 위해 유지하므로 브라우저 사이트 저장소를 정리하기 전 백업하세요.

웹 베타 호스팅은 [JTech-CO/CalcWeave](https://github.com/JTech-CO/CalcWeave)의 GitHub Pages, 주소는 **https://jtech-co.github.io/CalcWeave/**, 목표 도메인은 **calcweave.com**, 운영자는 **JTech-Co**, 문의는 **jtech-bryan@proton.me**입니다. `.github/workflows/pages.yml`은 기본 브랜치에서 수동 실행하는 검증·배포 workflow입니다. README를 변환하는 legacy 게시 대신 검증된 `dist`를 게시하는 GitHub Actions 구성을 사용합니다. 목표 도메인의 DNS·소유권 확인은 별도입니다. [현재 배포 구성](docs/pages-deployment.md)을 참고하세요. [M6 계약](docs/m6-contract.md) · [검증 기록](docs/m6-validation.md) · [배포 설정](docs/m6-deployment.md) · [운영·복구](docs/m6-operations.md)를 참고하세요.

## 현재 가능한 작업

- registry **211종**을 검색·추가·연결합니다. 선언 모드별 정의 수는 정적148종·이산198종·연속210종이며 이산·연속·혼합 실행은 타입·단위·rate와 블럭별 조건을 검사합니다. 연속 선언은 모든 ODE 연결·event solver의 지원을 뜻하지 않습니다. `Ctrl+K`에서 Pi·Zero·True·False·Add·Subtract와M9의15개 명명 preset도 선택할 수 있습니다. 단축키는 동작하며 버튼의 K·v 문자 표시는 제거했습니다.
- 새 70종은 기본 수학·쌍곡선·다항식·통계·벡터·행렬 변환 64종과 Chirp·Gaussian·감쇠 Sine·Exponential·Logistic·Sinc 시간 입력 6종입니다. 시간 입력은 이산·연속 실행만 지원합니다. 새 불연속 연산을 시간변화 ODE 미분 경로에 연결하면 미승인 사건을 설명하고 거부합니다. [확장 계약](docs/catalog-contract.md)과 [검증](docs/catalog-validation.md)을 참고하세요.
- float64·boolean의 스칼라·벡터·2D 값, 기본 단위 호환성, 제한 수식을 편집하고 Worker에서 계산합니다. 동적 Demux 출력, 배열 전체 원소 표와 포트별 오류 위치를 제공합니다.
- 다중 선택, 내부 연결을 포함한 복사·붙여넣기·복제·삭제, undo/redo, 실행 취소와 결과의 현재/이전 모델 구분을 제공합니다. 기본 테마는 검정·차콜이며 회색 라이트 설정도 브라우저에 기억합니다.
- 캔버스 이동은 휠 버튼 드래그, 영역 선택은 빈 곳에서 왼쪽 버튼 드래그입니다. 푸른 선택 사각형을 표시하며 캔버스에서 `Space`로 도식을 맞춥니다. 입력 필드와 버튼의 Space 동작은 유지합니다.
- IndexedDB 자동 저장, 이전 유효 저장본 확인·복원·다운로드와 `.cw.json` 가져오기·다운로드를 제공합니다. 손상·미래 버전 원본은 자동 저장으로 덮어쓰지 않고 별도 복구 파일로 보존합니다.
- 정적·typed 이산·연속·혼합 모델을 import 없는 독립 `model.ts`로 다운로드합니다. 실행 묶음 ZIP에는 모델 JSON, SHA-256 manifest, 실행 예제와 README, 현재 완료 결과가 있으면 기대결과도 담습니다. 생성 코드는 별도 TypeScript 환경에서 실행하며 웹과 같은 수치·사건 계약을 사용합니다.
- Step·Ramp·Sine·Pulse·시계·seed 난수·반복 입력, typed 지연·이산 적분·차분·FIR·SISO 전달함수/상태공간, boolean 에지, unsigned 비트·1-D Lookup·Scope를 제공합니다. 블럭별 주기/offset은 base tick의 정수배이며 다른 rate의 연결에는 Rate Transition을 명시합니다.
- M9는 z⁻¹ Filter와 descending-z 전달함수·DF1/DF1T/DF2/DF2T를 구분하고 fixed coefficients·DF2 동적 계수·구조별 IC를 제공합니다. 이산 Parallel PID/2DOF·clamping·제한된 MIMO·가변 정수 due-delay·fixed-interval Propagation Delay·물리적 Ts·PWM cycle latch의 정확한 경계는 [M9 계약](docs/m9-contract.md)을 따르며 선언 범위 검증을 완료했습니다.
- RK4·적응 간격 RK45, 2차 적분, SISO 상태공간·전달함수·실수 영점/극점, 필터 PID·미분을 제공합니다. 연속 ODE는 단위 1인 float64 scalar 범위이며 이산 typed subgraph와 연결할 수 있습니다.
- 출력 격자, solver 내부 간격, 혼합 이산 간격을 따로 설정합니다. Hit Crossing·초기화·Relay·Saturation 사건과 Memory·0차/1차 hold·고정 시간 지연을 처리하고 solver 통계·사건 시각을 기록합니다.
- 시간 실행을 일시정지하고 같은 snapshot에서 재개하거나 초기값·seed로 새로 시작할 수 있습니다. 정지 중 편집은 다음 실행에 적용하며 이어진 결과에는 이전 모델 표시가 붙습니다. 솔버 실패 시 이유와 마지막 유효 기록을 보존합니다.
- 결과 그래프와 대시보드 Scope의 **시간 범위**에서 시작·종료 시간을 입력하고 **범위 적용 후 실행**으로 해당 구간까지 다시 계산합니다. 지연 응답을 보려면 종료 시간을 늘리세요. 변경한 범위는 모델에 저장되며 기존 시간 간격·solver·실행 한도를 유지합니다.

- **데이터**에서 CSV·JSON의 열 타입·단위·시간축·결측·중복·정렬을 확인하고 저장해 Playback으로 연결합니다. 원본/정리 내용 hash와 버전을 보관하며 모델 JSON과 실행 묶음에 데이터를 함께 담습니다. 파일 최대 2 MiB, 데이터당 4,000행·16열·20,000셀, 프로젝트당 8개입니다.
- 선택 블럭을 Subsystem으로 묶고 더블클릭으로 내부를 편집합니다. 정의 버전과 인스턴스별 상태를 분리하며 변경 후 다른 참조를 명시적으로 갱신합니다. Bus는 같은 타입·단위의 scalar 두 개를 이름으로 묶고 선택합니다.
- **실험**에서 최대 16개 값의 파라미터 sweep, 최근 5개 실행 snapshot 복원·CSV/JSON 다운로드, 동일 시간 격자·단위의 scalar 출력 최대 3개 비교를 제공합니다. 반복 실행은 전체 시간·기록량·연산량 한도를 공유하고 완료된 결과는 취소 뒤에도 남습니다.
- **대시보드**의 Slider·Toggle은 다음 실행의 파라미터를 바꾸며 Display·Gauge·Scope는 실행 결과를 보여 줍니다. **노트**, DocBlock·Model Info는 일반 텍스트로 설명을 보관합니다.
- Unit Conversion은 cm→m, C→K 등의 scale·offset을 명시적으로 적용합니다. 곱·나눗셈·제곱·역수·제곱근은 승인 목록 안의 차원·배율 결과만 허용합니다. 합산에서 단위를 자동 변환하지 않습니다.

- **행렬**에서 32×32 이하 실수 2D 곱·전치·행렬식·역행렬·선형 방정식·Cholesky·LU를 계산합니다. 분해의 조건·단위가 맞지 않으면 해당 블럭을 진단합니다. LU의 세 출력은 L·U·P 행렬이며 P·A=L·U입니다.
- **2D Lookup**은 행·열의 비균일 기준점과 표를 편집해 bilinear·nearest·previous를 선택합니다. Prelookup은 구간 index·fraction을 출력합니다.
- **Fixed Quantize**는 1~32bit 폭·소수 비트·부호·반올림·saturate/wrap/error를 설정합니다. out은 복원 실수, stored는 정확한 정수 코드입니다. 다음 블럭의 산술은 float64이며 64bit·일반 fixed-point 타입 전파는 제외합니다.

학습 예제는 **39개, 6개 카테고리**입니다. 기초·신호 입력·이산 상태·연속/혼합·데이터/도식·행렬/표/양자화로 탐색하며 제목·설명·블럭 ID를 검색합니다. M9에서는 이산 필터 응답·이전 샘플·물리적 샘플주기와 카운터·2DOF PI 가중치의4개 예제를 추가했습니다. 한 신호는 최대1,024원소이며 ODE 상태는 단위1 float64 scalar입니다. XLSX·MAT·일반 문자열 계산·이질/중첩 Bus·외부 모델 파일 참조·live tuning·일반 차원식, 강성/DAE·연속 MIMO·복소수·연속 가변 지연/임의 시각 발행 사건·계정은 후속 범위입니다. registry 수는 전체 Simulink 기능 지원을 뜻하지 않습니다.

[SANE 화면 수정](docs/04-sane-design-revision.md)에서는 본문 16px·보조 라벨 14px를 기준으로 화면을 재배치하고, 캔버스의 영어 종류 이름·핵심 숫자와 라이브러리/속성의 한영 설명을 구분했습니다. 중앙은 캔버스 왼쪽·결과 오른쪽으로 배치하고 작은 화면이나 글자 확대에서는 세로로 옮깁니다. 실행 시 CalcWeave 로고에 은은한 펄스를 표시하며 취소·오류 시 멈추고 모션 감소 설정을 따릅니다. 시간 그래프는 전체 샘플을 보존하고 수치 표는 100행씩 모든 기록에 접근합니다. 정적 계산은 결과값과 표를 제공합니다.

## 검사하기

```powershell
npm test
npm run build
npm run test:e2e
npm run benchmark
npm run verify:coverage
npm run verify:roadmap
npm run verify:design
npm run verify:design:m4
npm run verify:m1
npm run verify:m2
npm run verify:m3
npm run verify:m4
npm run verify:m5
npm run verify:design:m5
npm run verify:design:m6
npm run verify:release
npm run verify:performance:m6
npm run verify:deployment
npm run verify:pages:browser
npm run verify:m7
npm run verify:design:m7
npm run verify:performance:m7
npm run verify:catalog
npm run verify:m8
npm run verify:m9
npm run verify:design:catalog
npm run verify:performance:catalog
```

브라우저 테스트는 빌드 후 실행합니다. 이 환경의 기존 Playwright Chromium을 재사용하며, 별도 환경에서는 `npx playwright install chromium`으로 브라우저를 준비하거나 `CALCWEAVE_BROWSER_PATH`에 실행 파일을 지정합니다. `benchmark`는 [M0 수치·성능 기록](docs/evidence/m0-benchmark.json)과 [M0 fixture](fixtures/m0)를, `verify:m1`은 [M1 수치·성능 기록](docs/evidence/m1-verification.json)과 [M1 fixture](fixtures/m1)를 생성합니다. 반복 측정은 환경과 부하에 따라 달라집니다.

`verify:design`은 빌드된 로컬 미리보기(`npm run preview`)를 실행한 상태에서 화면·폰트·너비 측정과 스크린샷을 생성합니다. [SANE 디자인 측정 기록](docs/evidence/sane-design-verification.json)에 대표 화면 크기, 테마, 축 글자, 실제 한글 폰트와 확대 조건을 남깁니다. 이 검사를 접근성 인증이나 실제 사용자 조사로 해석하지 않습니다.

`verify:design:m4`는 기존 측정과 데이터·실험·대시보드·노트·계층 화면을 함께 검사하고 [M4 디자인 증거](docs/evidence/m4-design-verification.json)와 별도의 스크린샷을 생성합니다.

현재 수학·신호·DSP 범위는 [M8 계약](docs/m8-contract.md)과 [M9 계약](docs/m9-contract.md)을 따르며, `verify:m9`는 독립 raw oracle과 실제 생성 TypeScript 실행을 검사합니다. 직전 [M7](docs/evidence/m7-regression-on-m9.json)·[catalog](docs/evidence/catalog-regression-on-m9-verification.json)·[M8](docs/evidence/m8-regression-on-m9.json) 회귀 증거를 보존합니다. `verify:m7`은 실제 Python 환경이 필요하며 `CALCWEAVE_PYTHON_PATH`로 실행 파일을 지정합니다. `verify:catalog`는 catalog의 신규70종과 기존 Divide의 계약을 검사합니다. 화면은 `verify:design:catalog`, 최종 빌드는 `verify:release`, production preview 성능은 `verify:performance:catalog`로 확인하며 현재 결과는 [M9 검증 기록](docs/m9-validation.md)과 [작업 공간 증거](docs/evidence/m9-workspace-verification.json)에 연결합니다. `verify:deployment`는 실제 Pages 주소의 artifact 바이트·SHA-256을 비교합니다. `/CalcWeave/` 빌드는 [현재 배포 구성](docs/pages-deployment.md)의 명령을 따르며 로컬 경로 검증과 공개 배포 검증을 구분합니다. 이전 M0~M7·catalog 기록은 당시 단계의 증거입니다.

## 기획 문서

| 문서 | 다루는 내용 |
| --- | --- |
| [01. 기술 백서](docs/01-technical-whitepaper.md) | 모델·타입·실행 엔진·solver·데이터·저장·코드 export·보안·검증 계약 |
| [02. 디자인 백서](docs/02-design-whitepaper.md) | 브랜드·정보 구조·편집기·첫 성공 흐름·시각 토큰·접근성·오류와 결과 UX |
| [03. 마일스톤별 구축 방향](docs/03-milestone-roadmap.md) | M0~M7의 범위·의존성·산출물·완료 조건·검증·출시 gate |
| [05. 전체 Simulink 대응 후속 로드맵](docs/05-simulink-coverage-roadmap.md) | M8~M16의 계약·독립 fixture·종료 gate, 385행/134기존subset/251미구현의 후속 배정 |
| [04. SANE 화면 수정](docs/04-sane-design-revision.md) | 중성 다크·라이트 테마·읽기 크기·간결한 블럭·전체 결과 접근·화면 측정 |
| [M1 구현 계약](docs/m1-contract.md) / [검증 기록](docs/m1-validation.md) | 23종 정적 블럭·typed 신호·AST·단위·편집·복구의 실제 범위와 증거 |
| [M2 구현 계약](docs/m2-contract.md) / [검증 기록](docs/m2-validation.md) | 정수 tick·상태·다중 rate·pause/reset·난수·독립 export의 실제 범위와 증거 |
| [M3 구현 계약](docs/m3-contract.md) / [검증 기록](docs/m3-validation.md) | RK4/RK45·연속 상태·혼합 경계·교차/reset·지연·실패 기록·독립 export |
| [M4 구현 계약](docs/m4-contract.md) / [검증 기록](docs/m4-validation.md) | CSV/JSON·재생·단위·서브시스템·Bus·대시보드·이력·sweep·비교·데이터/계층 export |
| [M5 구현 계약](docs/m5-contract.md) / [검증 기록](docs/m5-validation.md) | 실수 행렬·LU/Cholesky·2D Lookup·Prelookup·정확한 1~32bit 경계 양자화·독립 export |
| [블럭 구현 대응표](docs/block-coverage.md) | dataset 385개 원본 행의 추적 ID·기능/프리셋 대응·지원 경계·예정 단계 |
| [M6 구현 계약](docs/m6-contract.md) / [검증 기록](docs/m6-validation.md) | 지원·오프라인·백업·복구·공개 출시 확인 범위 |
| [M7 구현 계약](docs/m7-contract.md) / [검증 기록](docs/m7-validation.md) | Python subset·실행 parity·서명된 선언형 모델 패키지·가져오기 단계 |
| [0.8.0 수학·신호 확장 계약](docs/catalog-contract.md) / [검증 기록](docs/catalog-validation.md) / [대응 계획](docs/block-expansion-plan.md) | 실제 신규70종·총144종·예제32/6카테고리·독립 수치/TS/회귀 증거 |
| [M8 계약](docs/m8-contract.md) / [검증 기록](docs/m8-validation.md) | 41개 정의·8preset·185 registry의 완료한 제한 범위 |
| [M9 계약](docs/m9-contract.md) / [구현 맵](docs/m9-implementation-map.json) / [검증 기록](docs/m9-validation.md) | 26개 정의·15preset·211 registry·39예제의 선언 범위 검증, 58개 원본행 추적과 후속 옵션 |

제품과 화면부터 이해하려면 **디자인 → 기술 → 마일스톤** 순서로 읽습니다. 실제 구축을 시작할 때는 마일스톤의 **M0**에서 실행 의미와 검증 기준부터 확정합니다. 블럭을 추가할 때는 대응표의 원본 행과 기술 백서의 블럭 계약을 함께 확인합니다.

## 참고 자료와 해석

[dataset/Simulink_Basic_Blocks_R2024b.md](dataset/Simulink_Basic_Blocks_R2024b.md)는 21개 분류에 385개 문서 행을 수록한 참고 자료입니다. 중복·별칭·설정 변형·조건부 항목도 포함하므로 385개 독립 계산 엔진을 의미하지 않습니다. 참고 자료는 보존하고, CalcWeave의 구현 계획과 실제 지원 상태는 별도로 관리합니다.

문서에 쓰인 `계획`, `목표`, 예산·일정 추정은 구현 완료나 측정 결과가 아닙니다. 현재 M9 수치·브라우저·export·자원 상한과 릴리스 검증 결과는 [M9 검증 기록](docs/m9-validation.md)에 모으며 이전 [수학·신호 확장 검증](docs/catalog-validation.md)은 단계 증거로 보존합니다. 웹 베타 배포 검증과 실제 초보 사용자 조사·목표 도메인 소유 검증·전체 Simulink 옵션 동등성은 별도로 기록합니다. DAE·일반 fixed-point 타입 전파·외부 코드 연동은 별도 실행 계약과 검증이 필요합니다.

## 브랜드와 배포 목표

제품명은 **CalcWeave**, 목표 도메인은 **CalcWeave.com**입니다. 도메인 미선점 여부는 사용자 제공 설명이며 등록 가능성·소유권·상표 검증은 이번 문서 작성에서 수행하지 않았습니다. 실제 확보와 배포는 M6의 확인 항목입니다.

## 문서 운영

요구사항·기술 결정·지원 범위를 변경할 때 세 백서와 대응표를 함께 갱신합니다. 단계 완료는 기능 이름의 추가가 아니라 해당 단계의 검증과 종료 조건 통과로 기록합니다. 첫 구현 순서는 로컬 정적 계산 → 이산 실행·TS export → 연속 실행 → 데이터·계층 확장입니다.

## 코드 구조

| 경로 | 역할 |
| --- | --- |
| `apps/web` | React 편집기, 로컬 저장, Worker 경계 |
| `packages/model` | JSON schema, 직렬화, 공통 타입 |
| `packages/block-library` | 버전·포트·파라미터·상태 registry |
| `packages/compiler` | 그래프 검증, 위상 정렬, immutable IR |
| `packages/expression` | 허용 문법 파싱, 제한 AST와 수식 정의역 검사 |
| `packages/data` | 제한 CSV/JSON 가져오기·정리·시계열·보호된 CSV 출력 |
| `packages/experiments` | 공유 예산 sweep·immutable 실행·scalar 수치 비교 |
| `packages/runtime` | 정적·이산·RK4/RK45·혼합 실행과 예산 |
| `packages/codegen-ts` | 데이터·계층을 포함한 독립 코드와 manifest 생성 |
| `packages/codegen-python` | 승인된 정적·이산 모델의 독립 Python 생성·타깃 지원 검사 |
| `packages/model-package`, `packages/interop` | 서명·출처 확인된 선언형 모델과 구문/변환/실행 단계 검사 |
| `packages/release` | 실제 registry를 참조하는 버전·지원·한도·정책 정보 |
| `tests`, `fixtures/m0`~`fixtures/m5` 및 `fixtures/m7`, `scripts` | 검증, 예제 모델, 측정·대응표·릴리스 무결성 검사 |
## 0.10.1 버전 표시 수정

헤더와 라이브러리에 남은 과거 `0.8` 표시를 `APP_VERSION`에 연결하고, 실제 캔버스 크기 변경을 구독해 DOM 측정과 맞춘 뒤 취소 가능한2프레임 안정화 후 최초 fit을 적용했습니다. 앱0.10.1의 버전 표시·초기 캔버스 측정 경합·자동 저장 상태의 레이아웃 안정화 수정이며 엔진0.10.0-m9와211개 정의·39예제·수치 계약은 그대로입니다. 최초0.10.0 공개 증거는 `docs/evidence/m9-initial-release-*`로 보존하며, 새0.10.1의 최종 CI와 공개 artifact·브라우저9개 검증도 완료했습니다.

최초0.10.1 시도는 초기 캔버스 fit 검사에서128/129개가 통과하고1개가 실패해 배포가 생략됐다. [실패 기록](docs/evidence/m9-presentation-patch-failed-attempt.json)을 보존한다. ResizeObserver 알림을 지연한 경합은 별도로 재현했지만 원래 CI의 정확한 timing/geometry 원인은 로그로 확정하지 않는다.

다음 시도도129/130개 통과 후 같은 초기 fit 검사에서 실패해 게시되지 않았다. [두 번째 실패 기록](docs/evidence/m9-late-layout-failed-attempt.json)을 보존한다. 캔버스가22px 작아지며 y중심 오차11px이 된 측정과 일치하는 자동 저장 문구의 헤더 줄바꿈을 별도로 재현했다. [저장 상태 레이아웃 교정](docs/evidence/m9-save-status-layout-correction.json)은5개 상태 문구의 크기를 미리 확보해 헤더 높이를 유지하며 DOMtext는 현재 상태만 포함한다.
