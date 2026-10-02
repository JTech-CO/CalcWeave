# CalcWeave 블록 구현 범위 및 원자료 추적표

- 문서 버전: v0.6
- 작성일: 2026-10-03
- 상태: M5 선택 기능 구현 기록. 원본385행 중 M5 승인 subset 5행, M5 독립 대체 subset 2행, M4 승인 subset 18행, M3 승인 subset 15행, M2 승인 subset 29행, M1 정적 subset 40행, preset 4행, AST 독립 대체 1행, 미구현 271행이다. 추가 행렬 분해5종은 원자료 행 수에 합산하지 않는다. 실제 경계는 [M5 계약](m5-contract.md)·[검증 기록](m5-validation.md)·[수치 증거](evidence/m5-verification.json)에 기록한다. 전체 옵션·Simulink 동등성을 뜻하지 않는다.
- 기준 원자료: [Simulink 기본 라이브러리 블록 목록](../dataset/Simulink_Basic_Blocks_R2024b.md), R2024b 기준, 원자료 작성일 2026-10-01.
- 관련 문서: [기술 백서](01-technical-whitepaper.md), [디자인 백서](02-design-whitepaper.md), [마일스톤 로드맵](03-milestone-roadmap.md).

## 1. 이 표가 약속하는 범위

CalcWeave는 설치 없이 수학 도식을 작성·계산·시뮬레이션하는 독립 제품이다. 원자료의 수학적 기능과 작업 흐름을 빠짐없이 검토하되, MATLAB/Simulink 실행 환경이나 라이선스가 필요한 외부 코드를 브라우저에서 그대로 재현한다고 약속하지 않는다. 원본명은 검색·추적을 위한 참조 이름이며 CalcWeave의 사용자 표시명·엔진 식별자는 별도로 확정한다.

**01~21절의 수록 행은 385행**이다. 아래는 이 385행을 하나도 생략하지 않은 결정 기록이다. 원자료에서 동일한 영어 이름 문자열을 중복 제거하면 339개지만, Dashboard/Sinks 같은 동명 이의 항목이 있으므로 339 역시 독립 기능이나 엔진 수가 아니다. `canonical capability`는 후보 재사용 단위다. 구현 시 registry·수치 계약·preset 분리를 확정하기 전까지 독립 canonical 엔진의 최종 개수는 미확정으로 둔다.

한 엔진의 설정 변형, 검색 별칭, 다른 분류의 바로가기는 공유 capability로 연결한다. 대표적으로 Sum/Add/Subtract/Sum of Elements, Sqrt 계열, Quick Insert 상수, 일반/사용자화 gauge 등은 원본행을 보존하면서 구현을 재사용한다. Dashboard Display와 Sinks Display, Memory와 Unit Delay, Mux와 Bus Creator, Merge와 Switch, 시간 Source Sine Wave와 Math Sine Wave Function은 시간 바인딩의 차이를 보존한다. Sine Wave Function은 외부 입력을 시간 t로 사용하는 A·sin(ωt+φ)+bias 설정이고 Trigonometric Function의 sin(u)와 구분한다. 두 waveform 구성은 수학 kernel을 재사용할 수 있다. [MathWorks Sine Wave Function](https://www.mathworks.com/help/simulink/slref/sinewavefunction.html)

각 ID는 **원자료 절 번호-그 절 안 블록 표의 순번**이다. 예를 들어 `03-024`는 03절의 24번째 원본행이다. ID 링크는 원자료 절로 연결하며, 괄호의 L번호는 현재 원자료의 1-based 행 번호다. 원자료가 수정되면 ID·행 번호·원본명·조건의 대조 검사를 다시 수행한다. 21절의 마지막 파라미터 옵션 표와 22~25절 보조 항목은 385에 합산하지 않는다.

### 계획 지원 구분

| 구분 | 의미 | 지원 완료의 조건 |
| --- | --- | --- |
| 직접 | CalcWeave 자체 엔진/UI/컴파일러에서 해당 능력을 구현할 계획 | 수치·형상·시간·오류 계약에 기재한 subset과 fixture를 통과해야 함 |
| 구성 | 공유 capability의 파라미터, 사전 구성, 조합 또는 중복 접근 | 다른 원본행과 엔진을 공유해도 원본행별 설정 의미를 검증함 |
| 독립 대체 | 비슷한 목적을 CalcWeave 자체 작업 흐름으로 제공 | 원본 언어·UI·파일 형식·ABI와의 차이를 사용자에게 드러냄 |
| 미지원·adapter 연구 | 초기 제품 범위에서 실행하지 않고 경계와 확장 가능성을 조사 | adapter·실행 격리·라이선스·검증 gate가 별도로 승인되기 전 실행 차단 |

'직접'은 해당 Simulink 블록의 모든 파라미터·자료형·릴리스·가속 모드와 동일함을 뜻하지 않는다. '예정'은 첫 CalcWeave subset 후보 또는 연구를 수행할 시점이며 해당 단계의 모든 행을 동시에 완료한다는 약속이 아니다. M0에서 핵심 capability를 선택한 뒤 나머지 행의 배치를 재조정한다. 지원 완료 날짜나 완전 호환 출시 약속이 아니며 각 행의 검증/경계가 지원 계약에 우선한다.

### 공통 마일스톤

| 단계 | 범위 |
| --- | --- |
| M0 | 제품/IR/수치 계약·reference fixture·solver spike·지원표 |
| M1 | 정적 실수·배열 계산 MVP·기본 연결·제한 수식 |
| M2 | 이산시간 상태·sample scheduler·TS export |
| M3 | 비강성 연속 ODE·RK4/RK45·event/zero crossing |
| M4 | 데이터·계층·단위·Dashboard·결과 관리 |
| M5 | 복소수·고정소수점·메시지·고급 제어·호환 경계 |
| M6 | 공개 베타/출시 검증·접근성·보안·운영; 클라우드는 선택 확장 |
| M7 | 확장 export·plugin·외부 환경 adapter/생태계 |

## 2. JS/TS 구현 가능성의 검증 경계

JS/TS에서 산술 함수와 상태 기계를 구현하는 것은 가능하다. 그러나 기본 라이브러리의 이름 수만으로 작업량을 판단하면 수치 solver, 시간 모델, 자료형 전파, 조건부 실행, 데이터형과 외부 런타임의 복잡도가 사라진다. 아래는 CalcWeave의 설계 결정이며 공개 설명을 근거로 한 독립 구현 계획이다.

- **시간과 상태:** M2는 정수 tick 기반 고정 sample time과 검증한 harmonic multi-rate를 시작점으로 삼는다. 추론 sample time, 상태 읽기/갱신의 두 단계, 동시 event 순서를 IR 계약에 저장한다. Memory는 직전 major integration step이고 Unit Delay는 지정한 discrete sample 지연이다. 두 블록을 이름만 바꾸어 같은 동작으로 처리하지 않는다. [MathWorks Memory 설명](https://www.mathworks.com/help/simulink/slref/memory.html)
- **연속·불연속:** M3의 ODE 지원은 비강성 실수 시스템에 우선 한정한다. step/relay/saturation/reset 등에서 event 시각, 허용오차, 최대 반복, chattering 정책을 함께 검증한다. 단순히 매 프레임 적분하거나 sample 끝의 부호만 비교하면 경계 통과를 놓칠 수 있다. [MathWorks Zero-Crossing Detection](https://www.mathworks.com/help/simulink/ug/zero-crossing-detection.html)
- **대수 루프/DAE:** direct feedthrough를 가진 cycle은 위상 정렬만으로 계산할 수 없다. M1~M4에서 direct-feedthrough cycle을 명시적으로 거부하고, M5에서 매끄러운 실수 index-1 사례의 수렴을 연구한다. 실패하면 근거 없는 값을 계속 내보내지 않는다. Descriptor State-Space의 비특이 E는 선형 solve를 통해 명시적 상태공간으로 바꿀 수 있으나 특이 E는 일반 ODE로 간주할 수 없다. [MathWorks Algebraic Loop Concepts](https://www.mathworks.com/help/simulink/ug/algebraic-loops.html), [Descriptor State-Space](https://www.mathworks.com/help/simulink/slref/descriptorstatespace.html)
- **자료형:** M1은 finite float64/boolean과 vector/2D subset, M2는 승인한 32비트 이하 정수·비트, M5는 float32·64bit/BigInt·complex·fixed-point와 일반 n-D를 구분해 확장한다. 고정소수점은 word length·signedness·scale·overflow·rounding을 별도로 모델링하며 float 치환으로 bit 수준 동일성을 주장하지 않는다. MathWorks의 제품 사용 조건과 CalcWeave의 자체 numeric backend 구현은 별개다. [MathWorks 고정소수점 조건](https://www.mathworks.com/help/simulink/ug/specify-fixed-point-data-types.html)
- **메시지와 엔터티:** 기본 메시지는 bounded typed queue/event를 자체 구현할 수 있다. SimEvents의 엔터티/미들웨어 의미와 일반 신호 지연은 별도 계약이며 Entity Transport Delay를 Transport Delay의 별칭으로 제공하지 않는다. [MathWorks Simulink Messages Overview](https://www.mathworks.com/help/simulink/ug/simulink-messages-overview.html)
- **사용자 코드와 export:** Fcn/MATLAB Function은 제한 수식 AST나 typed CalcWeave function으로 목적을 대체한다. MATLAB interpreter/System object, C compiler/ABI, S-function callback를 JS 함수 하나로 자동 변환하지 않는다. TS export에는 source map·동일 runtime 계약·IR 버전이 필요하며 지원 밖 블록이 있으면 원인과 블록 ID를 포함해 export를 거부한다. C/C++/Python/WASM 등은 M7의 별도 target으로 검토한다. [MathWorks MATLAB Function](https://www.mathworks.com/help/simulink/slref/matlabfunction.html)
- **지식재산과 호환성:** 공개 수식·표준 알고리즘·CalcWeave 자체 사양을 근거로 구현한다. MathWorks 실행 바이너리, 아이콘, 도움말 문구, 독점 파일/ABI 동작을 권리 검토 없이 가져오지 않는다. SLX/MDL import, 툴박스 실행, 원본 MAT 파일 자동 호환, 자동 PID tuning, Coder/HDL 코드 생성은 기본 약속 범위에서 제외하고 adapter·권리·fixture 검증을 별도 gate로 둔다.

이 검증 시점에 열람한 현행 MathWorks 문서에는 R2026b가 표시될 수 있다. 이 문서의 원자료 행과 버전 조건은 R2024b 목록을 그대로 보존하며, 현행 문서의 새 옵션을 R2024b 목록에 추가하거나 소급하지 않는다.

### M4에서 확인한 범위

M4 신규 승격은 원본 18행이다. CSV/JSON 데이터 재생·명시 단위 변환·동종 scalar 두 필드 bus·내장 서브시스템·일반 텍스트 문서·대시보드 5종 및 Slider Gain 바인딩에 한정한다. 동일 이름의 Customizable Blocks, 여러 gauge 모양, Atomic Subsystem, 외부 Model/Subsystem Reference, From Spreadsheet, 문자열 신호 실행은 승격하지 않았다. 실행 기록·파라미터 스윕·결과 CSV/JSON·export ZIP은 별도 CalcWeave 작업 흐름으로 제공하며 새로운 원본행으로 합산하지 않는다.

기존 M3의 First Order Hold 원본명은 하이픈 없는 `02-003`이다. `F03-first-order-hold`의 모든 원시 표본·JSON·독립 TS·manifest 검증이 이미 통과했으므로 `time.first-order-hold` causal 외삽 subset으로 대응 누락 1행을 교정했다. 미래 샘플 interpolation과 전체 Simulink 동등성을 뜻하지 않으며 M4 신규 18행에 포함하지 않는다.

### M5에서 확인한 범위

원본 5행을 실수 행렬 곱·전치, 2D Lookup·Prelookup의 승인 subset으로 승격했다. Data Type Conversion 2행은 정확한 1~32bit 양자화 목적의 독립 대체다. 일반 cast·fixed-point 타입 전파를 구현했다고 표시하지 않는다. 동일 Product의 기존 원소별 구현 상태는 유지하며 별도 행렬 구성만 추가 설명한다. Hermitian Transpose, n-D/Dynamic/Interpolation Using Prelookup, Stored Integer 증감은 승격하지 않았다.

Determinant·Inverse·Linear Solve·Cholesky·LU는 원자료에 없는 CalcWeave 추가 기능5종이다. 실수 정방·각축≤32·단위/수치 안정성 경계와 잔차를 검증하지만 복소수·일반 최소제곱·희소/고차 tensor로 확대하지 않는다. quantizer 이후 산술은 float64이다. 신규10 registry와 원본7행 승격은 서로 다른 수치다. 메시지·조건/반복·DAE·수치 선형화·외부 runtime·실제 사용자 조사·배포는 이번 구현 승인에서 제외한다.

## 3. 수록 행 수와 계획 결정 집계

| 원자료 절 | 분류 | 원본 수록 행 |
| --- | --- | ---: |
| 01 | Commonly Used Blocks | 23 |
| 02 | Continuous | 16 |
| 03 | Dashboard | 37 |
| 04 | Discontinuities | 14 |
| 05 | Discrete | 21 |
| 06 | Logic and Bit Operations | 22 |
| 07 | Lookup Tables | 9 |
| 08 | Math Operations | 38 |
| 09 | Matrix Operations | 19 |
| 10 | Messages & Events | 8 |
| 11 | Model Verification | 11 |
| 12 | Model-Wide Utilities | 5 |
| 13 | Ports & Subsystems | 29 |
| 14 | Signal Attributes | 14 |
| 15 | Signal Routing | 27 |
| 16 | Sinks | 11 |
| 17 | Sources | 27 |
| 18 | String | 16 |
| 19 | User-Defined Functions | 15 |
| 20 | Additional Math & Discrete | 9 |
| 21 | Quick Insert | 14 |
| 합계 | 01~21 원본행 | **385** |

| 계획 지원 구분 | 원본행 수 |
| --- | ---: |
| 직접 | 202 |
| 구성 | 149 |
| 독립 대체 | 25 |
| 미지원·adapter 연구 | 9 |
| 합계 | **385** |

| 첫 예정 단계/연구 단계 | 원본행 수 |
| --- | ---: |
| M0 | 1 |
| M1 | 108 |
| M2 | 74 |
| M3 | 19 |
| M4 | 78 |
| M5 | 97 |
| M6 | 0 |
| M7 | 8 |
| 합계 | **385** |

M6의 0행은 새 capability 도입을 집계하지 않는다는 뜻이다. 앞 단계에서 구현한 범위를 출시 gate로 검증하는 작업은 M6에서 반드시 수행한다. 위 숫자는 완료율이나 독립 엔진 수가 아니며 동일 capability를 참조하는 여러 원본행을 포함한다.

## 4. 385행 전체 추적표

모든 원본 블록명과 '구버전·사용 조건'을 유지했다. 원본 하위 문맥은 일반 항목과 사용자화/조건부/별칭을 구분한다. canonical ID는 제품 사양을 위한 후보 이름이며 registry의 최종 공개 API로 아직 확정하지 않았다.

### 01. Commonly Used Blocks

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [01-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L78) | Bus Creator | 일반 표 | 기본 | `route.bus-create` | 직접 | M4 | 이종 필드의 구조화 버스; 숫자 Mux와 구분; 실제 지원: 동일 float64 또는 boolean·동일 단위의 scalar 두 개를 이름 있는 vector로 묶음; 최대 64자 고유 필드·IR fields 메타데이터; 이종/중첩/객체/generic bus 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [01-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L79) | Bus Selector | 일반 표 | 기본 | `route.bus-select` | 직접 | M4 | 이름 있는 버스 필드 선택; 실제 지원: 이름 있는 동종 scalar 두 필드 중 한 필드를 이름으로 선택·타입/단위 보존; Mux/Demux만으로 bus를 추정하지 않음; 이종/중첩/generic bus 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [01-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L80) | Constant | 일반 표 | 기본 | `source.constant` | 직접 | M1 | 실수·배열 상수; 자료형 범위는 단계별 확대; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [01-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L81) | Data Type Conversion | 일반 표 | 기본 | `fixed.quantize` | 직접 | M1 | M1 finite float64/boolean subset; M2 승인한 32비트 이하 정수; M5 float32/int64/fixed-point 계약; 실제 지원: 명시 1~32bit signed/unsigned·fraction0~32·nearest-even/floor/ceil/toward-zero·saturate/wrap/error의 정확한 IEEE→BigInt 양자화; out 복원 float64·stored 정확한 정수 코드; 일반 Data Type Conversion/fixed-point 신호 전파/64bit/f32/slope-bias 제외; 계약·fixture: m5-contract / m5-verification | M5 독립 대체 subset |
| [01-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L82) | Delay | 일반 표 | 기본 | `discrete.delay` | 직접 | M2 | 명시 샘플 주기의 N-step 지연·초기 상태·버퍼 상한; 실제 지원: 고정 1..1024 slot FIFO·typed initial·다음 commit level reset; variable delay/taps·edge reset 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [01-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L83) | Demux | 일반 표 | 기본 | `route.demux` | 직접 | M1 | 동종 벡터 분할; 필드 기반 Bus Selector와 구분; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [01-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L84) | Discrete-Time Integrator | 일반 표 | 기본 | `discrete.integrator` | 직접 | M2 | 적분 방식/초깃값; 제한·리셋은 검증한 파라미터만; 실제 지원: forward Euler·numeric scalar/vector/2D·단위1·gain·level reset; 다른 적분법/출력 제한 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [01-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L85) | Gain | 일반 표 | 기본 | `math.gain` | 직접 | M1 | M1 실수 스칼라/배열; 곱셈 방식 명시, 복소수 M5; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [01-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L86) | Ground | 일반 표 | 기본 | `source.constant` | 구성 | M1 | 값 0; 연결 포트의 형상·자료형 추론 | 미구현 |
| [01-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L87) | Inport | 일반 표 | 기본 · 화면의 초기 이름은 보통 `In1` | `io.input` | 직접 | M1 | 모델 외부 입력 계약; 계층 포트 연결 M4; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [01-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L88) | Integrator | 일반 표 | 기본 | `continuous.integrator` | 직접 | M3 | 연속 상태·초깃값; reset/limited는 zero crossing 계약 필요; 실제 지원: 단위1 float64 scalar·initial·none/rising reset·RK4/RK45; Hit Crossing 또는 held boolean 제어; 출력 제한 제외; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [01-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L89) | Logical Operator | 일반 표 | 기본 | `logic.boolean` | 직접 | M1 | 논리 연산·포트 수·boolean 변환 규칙; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [01-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L90) | Mux | 일반 표 | 기본 | `route.mux` | 직접 | M1 | 동종 숫자 벡터 합치기; 이종 Bus Creator와 구분; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [01-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L91) | Outport | 일반 표 | 기본 · 화면의 초기 이름은 보통 `Out1` | `io.output` | 직접 | M1 | 모델 외부 출력 계약; 계층 포트 연결 M4; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [01-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L92) | Product | 일반 표 | 기본 · Matrix Multiply와 같은 블록 계열이나 곱셈 설정은 다름 | `math.multiply` | 직접 | M1 | 원소 곱/행렬 곱 모드를 명시; broadcasting은 계약으로 고정; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원; M5 추가: 행렬 구성은 별도 math.matrix-multiply의 검증된 실수2D subset; 원소별 math.multiply 계약 유지; 일반 complex/fixed 타입 제외 | M1 정적 subset |
| [01-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L93) | Relational Operator | 일반 표 | 기본 | `logic.compare` | 직접 | M1 | 단항 유한성 검사·이항 비교; NaN 규칙 명세; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [01-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L94) | Saturation | 일반 표 | 기본 | `nonlinear.saturation` | 직접 | M1 | 상·하한 clipping; 연속 경계 event 처리는 M3; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [01-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L95) | Scope | 일반 표 | 기본 | `sink.scope` | 직접 | M2 | 시간축 신호 표시; 렌더링 속도와 계산 시간을 분리; 실제 지원: typed time 기록·numeric scalar plot·전체 배열 샘플/원소 표; signal viewer 전체 옵션 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [01-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L96) | Subsystem | 일반 표 | 기본 | `hierarchy.subsystem` | 직접 | M4 | 포트 계약·스코프·하위 그래프 컴파일; 실제 지원: 프로젝트 내 버전 정의·투명 IO 포트 각 8개·깊이 8·독립 인스턴스 상태/rate/reset·경로/정의 SHA-256·명시 버전 갱신·선택 묶기/하위 편집; 조건부/atomic 실행·외부 파일 reference 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [01-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L97) | Sum | 일반 표 | 기본 | `math.sum` | 직접 | M1 | 입력별 부호·축·배열 형상 명세; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [01-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L98) | Switch | 일반 표 | 기본 | `route.switch` | 직접 | M1 | 조건에 따라 현재 입력 선택; Merge와 구분; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [01-022](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L99) | Terminator | 일반 표 | 기본 | `io.terminator` | 직접 | M1 | 의도적 미사용 출력을 표시하고 연결 경고 제어; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [01-023](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) (L100) | Vector Concatenate | 일반 표 | 기본 | `math.concatenate` | 구성 | M1 | 동종 배열 concat의 벡터 축 설정; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |

### 02. Continuous

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [02-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L116) | Derivative | 일반 표 | 기본 | `continuous.derivative` | 직접 | M3 | 비매끄러운 입력은 경고; 수치 미분/필터 계약과 오차 검증; 실제 지원: 단위1 scalar·causal 필터 미분 N(u-F), F′=N(u-F); filterN/initial; ideal derivative·잡음 안정성 보장 제외; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [02-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L117) | Descriptor State-Space | 일반 표 | 기본 | `continuous.descriptor` | 구성 | M5 | 비특이 E를 선형 solve로 State-Space 변환; 특이 E의 DAE는 M5 연구 통과 전 미지원 | 미구현 |
| [02-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L118) | First Order Hold | 일반 표 | 기본 | `time.first-order-hold` | 직접 | M3 | 샘플 시점·보간 구간·초기 동작 명세; 실제 지원: 단위1 scalar 이전 두 due 샘플의 causal 기울기 외삽·정수 rate/offset·initial·현재 due 입력 캡처; 첫 두 샘플 전 기울기 0·미래 interpolation/전체 Simulink FOH 의미 제외; 계약·fixture: m3-contract / F03-first-order-hold; M3 대응 누락 교정 | M3 승인 subset |
| [02-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L119) | Integrator | 일반 표 | 기본 | `continuous.integrator` | 직접 | M3 | 연속 상태·초깃값; reset/limited는 zero crossing 계약 필요; 실제 지원: 단위1 float64 scalar·initial·none/rising reset·RK4/RK45; Hit Crossing 또는 held boolean 제어; 출력 제한 제외; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [02-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L120) | Integrator Limited | 일반 표 | 구성 · Integrator의 출력 제한 설정 | `continuous.integrator` | 구성 | M3 | 출력 제한 preset; 경계 도달·이탈 event | 미구현 |
| [02-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L121) | PID Controller | 일반 표 | 기본 · 계수 직접 입력과 시뮬레이션 기준. 자동 튜닝 기능은 별도 제품 조건 | `continuous.pid` | 직접 | M3 | 계수 직접 입력·anti-windup·미분 필터의 명시 subset; 자동 튜닝 제외; 실제 지원: 단위1 scalar parallel P/I/filtered D·kp/ki/kd/N·초기 적분/필터; anti-windup·clamp·2DOF·자동 튜닝 제외; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [02-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L122) | PID Controller (2DOF) | 일반 표 | 기본 · 자동 튜닝 기능은 별도 제품 조건 | `continuous.pid` | 구성 | M5 | 2DOF setpoint weighting 확장; 자동 튜닝 제외 | 미구현 |
| [02-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L123) | Second-Order Integrator | 일반 표 | 기본 | `continuous.second-order-integrator` | 직접 | M3 | 위치/속도 상태·초깃값을 별도로 보존; 실제 지원: 단위1 scalar 가속도→위치/속도 두 상태·각 initial·별도 포트; limited/reset 옵션 제외; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [02-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L124) | Second-Order Integrator Limited | 일반 표 | 구성 · Second-Order Integrator의 제한 설정 | `continuous.integrator-2` | 구성 | M3 | 두 상태 제한과 경계 event preset | 미구현 |
| [02-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L125) | State-Space | 일반 표 | 기본 | `continuous.state-space` | 직접 | M3 | 실수 LTI A/B/C/D; D에 따른 direct feedthrough; 실제 지원: 실수 단위1 scalar SISO·N=1..16·A/B/C/D/initial·D feedthrough 판정; MIMO/Descriptor 제외; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [02-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L126) | Transfer Fcn | 일반 표 | 기본 | `continuous.transfer-function` | 구성 | M3 | proper 실수 전달함수→검증된 상태공간 realization; 부적절 차수는 거부; 실제 지원: 실수 단위1 scalar proper s 내림차순 계수·차수0..16·a0≠0·제어 정준형 initial; improper/복소 제외; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [02-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L127) | Transport Delay | 일반 표 | 기본 | `time.transport-delay` | 직접 | M3 | 시뮬레이션 시간 기반 이력 보간·최대 지연/버퍼 상한; 실제 지원: 단위1 scalar 양의 고정 delay·initial prehistory·승인 이력 선형 보간·좌우 jump 보존·100k 총메모리; 가변/엔터티 지연 제외; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [02-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L128) | Variable Time Delay | 일반 표 | 기본 | `continuous.variable-time-delay` | 직접 | M5 | 가변 지연의 시간 해석·보간·이력 범위 검증 | 미구현 |
| [02-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L129) | Variable Transport Delay | 일반 표 | 기본 | `continuous.variable-transport-delay` | 직접 | M5 | 가변 운송 지연의 별도 상태/시간 의미; 위 행과 합치지 않음 | 미구현 |
| [02-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L130) | Zero-Pole | 일반 표 | 기본 | `continuous.zero-pole` | 구성 | M3 | zeros/poles/gain→실수 계수 realization; 복소수 확장 M5; 실제 지원: 실수 roots/gain→proper 제어 정준형·roots0..16·initial; 복소 roots 제외; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [02-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-02) (L140) | Entity Transport Delay | 문서에 함께 나타나지만 무조건적인 기본 사용 목록에서 분리한 항목 | 조건 · R2019b 도입. 엔터티/메시지 지연과 SimEvents 연계 항목. 일반 신호용 Transport Delay의 동의어가 아님 | `adapter.entity-transport` | 미지원·adapter 연구 | M7 | SimEvents 엔터티 계약은 일반 신호 지연과 구분; 외부 엔터티 런타임 연구 | 미구현 |

### 03. Dashboard

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [03-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L156) | Callback Button | 일반 표 | 기본 | `dashboard.action` | 독립 대체 | M4 | 승인된 모델 액션 목록 호출; MATLAB callback 또는 임의 JS 실행 제외 | 미구현 |
| [03-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L157) | Check Box | 일반 표 | 기본 | `dashboard.check-box` | 직접 | M4 | 파라미터/신호 바인딩 UI; 신호 그래프 출력 sink와 구분 | 미구현 |
| [03-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L158) | Combo Box | 일반 표 | 기본 | `dashboard.combo-box` | 직접 | M4 | 파라미터/신호 바인딩 UI; 신호 그래프 출력 sink와 구분 | 미구현 |
| [03-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L159) | Dashboard Scope | 일반 표 | 기본 | `dashboard.scope` | 직접 | M4 | 신호 바인딩 대시보드 차트; sink.scope 로그 재사용; 실제 지원: 최종 실행에 기록된 root scalar float64 출력의 시간 그래프 바인딩·같은 원시 표본 재사용·이전 실행 표시; live streaming/임의 내부 신호 viewer 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [03-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L160) | Display | 일반 표 | 기본 · Sinks의 Display와 다른 Dashboard 블록 | `dashboard.readout` | 직접 | M4 | Dashboard 신호 바인딩 표시; Sinks Display는 sink.display; 실제 지원: 최종 실행의 root scalar float64 출력 값에 바인딩·stale 표시; 별도 sink.display와 구분; 사용자화 appearance 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [03-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L161) | Edit | 일반 표 | 기본 | `dashboard.edit` | 직접 | M4 | 파라미터/신호 바인딩 UI; 신호 그래프 출력 sink와 구분 | 미구현 |
| [03-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L162) | Gauge | 일반 표 | 기본 | `dashboard.gauge` | 구성 | M4 | 값 바인딩 gauge의 원형/각도/방향 appearance preset; 실제 지원: root scalar float64 최종 출력의 min/max meter 표시·stale 상태; 원형/각도/반원/사용자화 appearance preset 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [03-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L163) | Half Gauge | 일반 표 | 기본 | `dashboard.gauge` | 구성 | M4 | 값 바인딩 gauge의 원형/각도/방향 appearance preset | 미구현 |
| [03-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L164) | Knob | 일반 표 | 기본 | `dashboard.knob` | 직접 | M4 | 파라미터/신호 바인딩 UI; 신호 그래프 출력 sink와 구분 | 미구현 |
| [03-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L165) | Lamp | 일반 표 | 기본 | `dashboard.lamp` | 직접 | M4 | 파라미터/신호 바인딩 UI; 신호 그래프 출력 sink와 구분 | 미구현 |
| [03-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L166) | Linear Gauge | 일반 표 | 기본 | `dashboard.gauge` | 구성 | M4 | 값 바인딩 gauge의 원형/각도/방향 appearance preset | 미구현 |
| [03-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L167) | MultiStateImage | 일반 표 | 기본 | `dashboard.multi-state-image` | 직접 | M4 | 허용 이미지/상태 mapping; 파일 크기·형식 제한 | 미구현 |
| [03-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L168) | Push Button | 일반 표 | 기본 | `dashboard.push-button` | 직접 | M4 | 파라미터/신호 바인딩 UI; 신호 그래프 출력 sink와 구분 | 미구현 |
| [03-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L169) | Quarter Gauge | 일반 표 | 기본 | `dashboard.gauge` | 구성 | M4 | 값 바인딩 gauge의 원형/각도/방향 appearance preset | 미구현 |
| [03-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L170) | Radio Button | 일반 표 | 기본 | `dashboard.radio-button` | 직접 | M4 | 파라미터/신호 바인딩 UI; 신호 그래프 출력 sink와 구분 | 미구현 |
| [03-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L171) | Rocker Switch | 일반 표 | 기본 | `dashboard.rocker-switch` | 직접 | M4 | 파라미터/신호 바인딩 UI; 신호 그래프 출력 sink와 구분 | 미구현 |
| [03-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L172) | Rotary Switch | 일반 표 | 기본 | `dashboard.rotary-switch` | 직접 | M4 | 파라미터/신호 바인딩 UI; 신호 그래프 출력 sink와 구분 | 미구현 |
| [03-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L173) | Slider | 일반 표 | 기본 | `dashboard.slider` | 구성 | M4 | 범위/step·방향 preset; 실행 중 변경은 안전한 scheduler 경계에 반영; 실제 지원: root scalar Constant/Input.value 또는 Gain.gain의 유한 범위·양의 step 슬라이더·모델에 저장 후 다음 실행부터 반영; 실행 중 scheduler 값 변경/사용자화 appearance 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [03-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L174) | Slider Switch | 일반 표 | 기본 | `dashboard.slider-switch` | 직접 | M4 | 파라미터/신호 바인딩 UI; 신호 그래프 출력 sink와 구분 | 미구현 |
| [03-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L175) | Toggle Switch | 일반 표 | 기본 | `dashboard.toggle-switch` | 직접 | M4 | 파라미터/신호 바인딩 UI; 신호 그래프 출력 sink와 구분; 실제 지원: root boolean Constant/Input.value 토글·모델에 저장 후 다음 실행부터 반영; 임의 신호 강제 변경/사용자화 appearance 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [03-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L185) | Callback Button | Customizable Blocks | R2021b+ | `dashboard.action` | 독립 대체 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-022](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L186) | Check Box | Customizable Blocks | R2024b+ | `dashboard.check-box` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-023](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L187) | Circular Gauge | Customizable Blocks | R2020b+ | `dashboard.gauge` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-024](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L188) | Display | Customizable Blocks | R2023b+ | `dashboard.readout` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-025](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L189) | Half Gauge | Customizable Blocks | R2024a+ | `dashboard.gauge` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-026](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L190) | Horizontal Gauge | Customizable Blocks | R2020a+ | `dashboard.gauge` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-027](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L191) | Horizontal Slider | Customizable Blocks | R2021a+ | `dashboard.slider` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-028](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L192) | Knob | Customizable Blocks | R2021a+ | `dashboard.knob` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-029](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L193) | Lamp | Customizable Blocks | R2021b+ | `dashboard.lamp` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-030](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L194) | Push Button | Customizable Blocks | R2021b+ | `dashboard.push-button` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-031](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L195) | Quarter Gauge | Customizable Blocks | R2024a+ | `dashboard.gauge` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-032](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L196) | Rocker Switch | Customizable Blocks | R2021b+ | `dashboard.rocker-switch` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-033](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L197) | Rotary Switch | Customizable Blocks | R2021b+ | `dashboard.rotary-switch` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-034](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L198) | Slider Switch | Customizable Blocks | R2021b+ | `dashboard.slider-switch` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-035](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L199) | Toggle Switch | Customizable Blocks | R2021b+ | `dashboard.toggle-switch` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-036](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L200) | Vertical Gauge | Customizable Blocks | R2020a+ | `dashboard.gauge` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |
| [03-037](../dataset/Simulink_Basic_Blocks_R2024b.md#library-03) (L201) | Vertical Slider | Customizable Blocks | R2021a+ | `dashboard.slider` | 구성 | M5 | M4 일반 UI primitive 재사용; M5 appearance 사용자화 preset·원본 일반 항목과 별도 추적 | 미구현 |

### 04. Discontinuities

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [04-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L215) | Backlash | 일반 표 | 기본 | `nonlinear.backlash` | 직접 | M3 | hysteresis 상태와 연속 경계 event 검증 | 미구현 |
| [04-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L216) | Coulomb and Viscous Friction | 일반 표 | 기본 | `nonlinear.friction` | 직접 | M3 | 영점 근처 불연속·마찰 모델 계약 | 미구현 |
| [04-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L217) | Dead Zone | 일반 표 | 기본 | `nonlinear.dead-zone` | 직접 | M1 | 정적 데드존; 연속 경계 처리 M3 | 미구현 |
| [04-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L218) | Dead Zone Dynamic | 일반 표 | 기본 | `nonlinear.dead-zone` | 구성 | M2 | 입력 포트 기반 동적 상·하한 | 미구현 |
| [04-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L219) | Hit Crossing | 일반 표 | 기본 | `logic.hit-crossing` | 직접 | M3 | 방향·허용오차·동시 crossing 순서·chattering 상한; 실제 지원: 단위1 scalar threshold·rising/falling/either·boolean event pulse·시간 정밀화·동시 reset/tick 순서·사건 상한; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [04-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L220) | PWM | 일반 표 | R2020b+ | `source.pwm` | 직접 | M2 | 샘플 기반 PWM; 연속 edge scheduling M3 | 미구현 |
| [04-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L221) | Quantizer | 일반 표 | 기본 | `nonlinear.quantizer` | 직접 | M1 | 간격/반올림·경계·NaN 처리 명세 | 미구현 |
| [04-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L222) | Rate Limiter | 일반 표 | 기본 | `nonlinear.rate-limit` | 직접 | M2 | 이산 delta/time 제한; 연속 solver 결합 M3 | 미구현 |
| [04-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L223) | Rate Limiter Dynamic | 일반 표 | 기본 | `nonlinear.rate-limit` | 구성 | M3 | 동적 상승/하강 제한과 연속 상태 계약 | 미구현 |
| [04-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L224) | Relay | 일반 표 | 기본 | `nonlinear.relay` | 직접 | M3 | on/off hysteresis 상태와 crossing event; 실제 지원: 단위1 scalar off<on hysteresis·초기 상태·on/off 값·교차 정밀화; equal threshold/typed vector 제외; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [04-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L225) | Saturation | 일반 표 | 기본 | `nonlinear.saturation` | 직접 | M1 | 상·하한 clipping; 연속 경계 event 처리는 M3; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [04-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L226) | Saturation Dynamic | 일반 표 | 기본 | `nonlinear.saturation` | 구성 | M2 | 입력 포트 기반 동적 상·하한; 연속 event M3 | 미구현 |
| [04-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L227) | Variable Pulse Generator | 일반 표 | R2020b+ | `source.pulse` | 구성 | M2 | 동적 주기·duty/phase 설정; 불가능 범위 검증 | 미구현 |
| [04-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) (L228) | Wrap To Zero | 일반 표 | 기본 | `nonlinear.wrap-to-zero` | 직접 | M1 | 한계 밖 값을 0으로 치환하는 계약; modulo와 구분 | 미구현 |

### 05. Discrete

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [05-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L244) | Delay | 일반 표 | 기본 | `discrete.delay` | 직접 | M2 | 명시 샘플 주기의 N-step 지연·초기 상태·버퍼 상한; 실제 지원: 고정 1..1024 slot FIFO·typed initial·다음 commit level reset; variable delay/taps·edge reset 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [05-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L245) | Difference | 일반 표 | 기본 | `discrete.difference` | 구성 | M2 | u[k]-u[k-1]; state 초기화 명세; 실제 지원: numeric scalar/vector/2D의 이전 due 입력 차분·typed initial; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [05-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L246) | Discrete Derivative | 일반 표 | 기본 | `discrete.derivative` | 구성 | M2 | 차분/Ts; Ts>0 검증; 실제 지원: numeric scalar/vector/2D 차분/(period×baseStep)·단위1; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [05-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L247) | Discrete FIR Filter | 일반 표 | 기본 · Simulink에 포함된 블록. DSP System Toolbox 전용 FIR 블록과 구분 | `discrete.fir` | 직접 | M2 | 계수·탭 이력·축·초기 상태; 실제 지원: 1..128 real taps·numeric scalar/vector/2D 독립 channel·level reset; 전문 DSP 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [05-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L248) | Discrete Filter | 일반 표 | 기본 | `discrete.filter` | 직접 | M2 | 차분식/realization·정규화·state 초기화 | 미구현 |
| [05-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L249) | Discrete PID Controller | 일반 표 | 기본 · 자동 튜닝은 별도 제품 조건 | `discrete.pid` | 직접 | M2 | 계수 직접 입력·시간 방식·필터/anti-windup 명시 subset; 자동 튜닝 제외 | 미구현 |
| [05-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L250) | Discrete PID Controller (2DOF) | 일반 표 | 기본 · 자동 튜닝은 별도 제품 조건 | `discrete.pid` | 구성 | M5 | 2DOF weighting 확장; 자동 튜닝 제외 | 미구현 |
| [05-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L251) | Discrete State-Space | 일반 표 | 기본 | `discrete.state-space` | 직접 | M2 | x[k+1]=Ax[k]+Bu[k], y[k]=Cx[k]+Du[k]; 실제 지원: 단위1 numeric scalar SISO·1..16 상태·A/B/C/D·initial·level reset; MIMO 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [05-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L252) | Discrete Transfer Fcn | 일반 표 | 기본 | `discrete.transfer-function` | 구성 | M2 | proper 실수 차분식 realization; zero leading denominator 거부; 실제 지원: 단위1 scalar SISO z^-1 real coefficient 차분식·1..32 coefficients·num길이≤den길이·a0≠0; 다른 realization 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [05-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L253) | Discrete Zero-Pole | 일반 표 | 기본 | `discrete.transfer-function` | 구성 | M2 | z-plane zero/pole/gain→차분식 | 미구현 |
| [05-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L254) | Discrete-Time Integrator | 일반 표 | 기본 | `discrete.integrator` | 직접 | M2 | 적분 방식/초깃값; 제한·리셋은 검증한 파라미터만; 실제 지원: forward Euler·numeric scalar/vector/2D·단위1·gain·level reset; 다른 적분법/출력 제한 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [05-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L255) | Memory | 일반 표 | 기본 | `time.memory` | 직접 | M3 | 직전 major integration step 값; Unit Delay와 별도 수명·minor step 계약; 실제 지원: 단위1 scalar 직전 승인 major-step 입력·initial·trial/rejected/minor 불변; 이산 Unit Delay와 별도 의미; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [05-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L256) | Propagation Delay | 일반 표 | R2022b+ | `discrete.propagation-delay` | 직접 | M5 | 시간/event 기반 디지털 전파 지연·초기화·scheduler 의미 검증 | 미구현 |
| [05-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L257) | Resettable Delay | 일반 표 | 기본 | `discrete.delay` | 구성 | M2 | 외부 reset·출력/상태 갱신 순서 preset; 실제 지원: 고정 1..1024 slot FIFO·typed initial·다음 commit level reset; variable delay/taps·edge reset 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [05-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L258) | Tapped Delay | 일반 표 | 기본 | `discrete.delay` | 구성 | M2 | N개 delay tap 출력 preset; 지연 배열 축 명세 | 미구현 |
| [05-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L259) | Transfer Fcn First Order | 일반 표 | 기본 | `discrete.transfer-function` | 구성 | M2 | 사전 계수/차수 구성; sample time과 realization을 기록 | 미구현 |
| [05-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L260) | Transfer Fcn Lead or Lag | 일반 표 | 기본 | `discrete.transfer-function` | 구성 | M2 | 사전 계수/차수 구성; sample time과 realization을 기록 | 미구현 |
| [05-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L261) | Transfer Fcn Real Zero | 일반 표 | 기본 | `discrete.transfer-function` | 구성 | M2 | 사전 계수/차수 구성; sample time과 realization을 기록 | 미구현 |
| [05-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L262) | Unit Delay | 일반 표 | 기본 | `discrete.unit-delay` | 직접 | M2 | 명시 Ts 한 sample 지연; N-step Delay와 초기화/갱신 계약 구분; 실제 지원: typed scalar/vector/2D 이전 due 입력; 정수 tick·level reset; terminal commit 없음; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [05-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L263) | Variable Integer Delay | 일반 표 | 기본 | `discrete.delay` | 구성 | M2 | 정수 N 동적 선택·최대 지연 상한 | 미구현 |
| [05-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) (L264) | Zero-Order Hold | 일반 표 | 기본 | `time.zero-order-hold` | 직접 | M2 | Ts 시점에 샘플링하여 hold; 연속 입력 결합 M3; 실제 지원: 단위1 scalar 연속 입력의 정수 base period/offset 캡처/hold·initial; 연속→M2 이산 경계; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |

### 06. Logic and Bit Operations

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [06-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L280) | Bit Clear | 일반 표 | 기본 | `logic.bit-mask` | 구성 | M2 | M2 승인한 32비트 이하 bit mask clear; 명시 width/signedness·overflow; 64bit M5 | 미구현 |
| [06-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L281) | Bit Set | 일반 표 | 기본 | `logic.bit-mask` | 구성 | M2 | M2 승인한 32비트 이하 bit mask set; 명시 width/signedness·overflow; 64bit M5 | 미구현 |
| [06-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L282) | Bit to Integer Converter | 일반 표 | 편입 R2022a+ · 그 이전 Communications Toolbox 소속 | `logic.bit-conversion` | 직접 | M2 | M2 승인한 32비트 이하 signedness/endianness/overflow; 64bit BigInt 표현·변환 M5 | 미구현 |
| [06-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L283) | Bitwise Operator | 일반 표 | 기본 | `logic.bitwise` | 직접 | M2 | M2 승인한 32비트 이하 width/signedness; 암묵 coercion 제외; 확장 폭 M5; 실제 지원: dimensionless numeric scalar unsigned1..32bit·and/or/xor/not/logical shifts·좌shift wrap; signed/암묵float coercion 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [06-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L284) | Combinatorial Logic | 일반 표 | 기본 | `logic.truth-table` | 직접 | M1 | 진리표 입력 폭·최대 행 수·미정의 조합 검증 | 미구현 |
| [06-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L285) | Compare To Constant | 일반 표 | 기본 | `logic.compare` | 구성 | M1 | 상수/0 상대 비교 preset | 미구현 |
| [06-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L286) | Compare To Zero | 일반 표 | 기본 | `logic.compare` | 구성 | M1 | 상수/0 상대 비교 preset | 미구현 |
| [06-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L287) | Detect Change | 일반 표 | 기본 | `logic.edge-detect` | 구성 | M2 | 직전 sample state와 상승/하강·경계 부호 preset; 실제 지원: boolean scalar의 either/rising/falling previous-due 비교; numeric boundary/sign preset 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [06-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L288) | Detect Decrease | 일반 표 | 기본 | `logic.edge-detect` | 구성 | M2 | 직전 sample state와 상승/하강·경계 부호 preset | 미구현 |
| [06-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L289) | Detect Fall Negative | 일반 표 | 기본 | `logic.edge-detect` | 구성 | M2 | 직전 sample state와 상승/하강·경계 부호 preset | 미구현 |
| [06-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L290) | Detect Fall Nonpositive | 일반 표 | 기본 | `logic.edge-detect` | 구성 | M2 | 직전 sample state와 상승/하강·경계 부호 preset | 미구현 |
| [06-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L291) | Detect Increase | 일반 표 | 기본 | `logic.edge-detect` | 구성 | M2 | 직전 sample state와 상승/하강·경계 부호 preset | 미구현 |
| [06-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L292) | Detect Rise Nonnegative | 일반 표 | 기본 | `logic.edge-detect` | 구성 | M2 | 직전 sample state와 상승/하강·경계 부호 preset | 미구현 |
| [06-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L293) | Detect Rise Positive | 일반 표 | 기본 | `logic.edge-detect` | 구성 | M2 | 직전 sample state와 상승/하강·경계 부호 preset | 미구현 |
| [06-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L294) | Extract Bits | 일반 표 | 기본 | `logic.extract-bits` | 직접 | M2 | M2 승인한 32비트 이하 bit 범위/폭 검증; 확장 폭 M5 | 미구현 |
| [06-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L295) | Float Extract Bits | 일반 표 | R2023a+ | `logic.float-extract-bits` | 직접 | M5 | IEEE754 float32/64 raw bit reinterpretation·endianness 명세 | 미구현 |
| [06-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L296) | Integer to Bit Converter | 일반 표 | 편입 R2022a+ · 그 이전 Communications Toolbox 소속 | `logic.bit-conversion` | 직접 | M2 | M2 승인한 32비트 이하 signedness/endianness/overflow; 64bit BigInt 표현·변환 M5 | 미구현 |
| [06-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L297) | Interval Test | 일반 표 | 기본 | `logic.interval-test` | 구성 | M1 | 정적/동적 경계와 open/closed 구간 비교 | 미구현 |
| [06-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L298) | Interval Test Dynamic | 일반 표 | 기본 | `logic.interval-test` | 구성 | M1 | 정적/동적 경계와 open/closed 구간 비교 | 미구현 |
| [06-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L299) | Logical Operator | 일반 표 | 기본 | `logic.boolean` | 직접 | M1 | 논리 연산·포트 수·boolean 변환 규칙; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [06-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L300) | Relational Operator | 일반 표 | 기본 | `logic.compare` | 직접 | M1 | 단항 유한성 검사·이항 비교; NaN 규칙 명세; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [06-022](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) (L301) | Shift Arithmetic | 일반 표 | 기본 | `logic.shift` | 직접 | M2 | M2 승인한 32비트 이하 width/signedness·시프트 범위·부호 확장; 확장 폭 M5 | 미구현 |

### 07. Lookup Tables

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [07-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) (L317) | 1-D Lookup Table | 일반 표 | 기본 | `lookup.interpolated` | 구성 | M2 | M1 선형 1-D candidate; M2 승인된 breakpoints·경계/보간·extrapolation 계약; 실제 지원: dimensionless numeric scalar/vector/2D pointwise 1-D·linear/previous·clip/error·2..1024 breakpoints; nD/extrapolate 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [07-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) (L318) | 2-D Lookup Table | 일반 표 | 기본 | `lookup.2d` | 구성 | M5 | 2-D breakpoints·축 layout·보간/extrapolation 계약과 메모리 상한; 실제 지원: 단위1 row/column scalar·유한 비균일 축 각각2~32·table[row][column] 일치·bilinear/nearest/previous·clip/linear/error(선형 외삽은linear보간만)·nearest 동률 낮은index·명시 출력 단위·독립 TS; n-D/spline/Akima/동적표 제외; 계약·fixture: m5-contract / m5-verification | M5 승인 subset |
| [07-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) (L319) | Cosine | 일반 표 | 구성/조건 · Sine의 코사인 출력 설정. 고정소수점 실행 조건 확인 | `math.trigonometric` | 독립 대체 | M5 | float cos 계산은 M1; 원본 fixed-point preset의 bit-exact 동작은 M5 별도 검증 | 미구현 |
| [07-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) (L320) | Direct Lookup Table (n-D) | 일반 표 | 기본 | `lookup.direct` | 직접 | M5 | 정수 인덱스·범위 밖 처리·axis layout 명세 | 미구현 |
| [07-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) (L321) | Interpolation Using Prelookup | 일반 표 | 기본 | `lookup.interpolate-prelookup` | 직접 | M5 | prelookup index/fraction와 축별 보간 | 미구현 |
| [07-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) (L322) | Lookup Table Dynamic | 일반 표 | 기본 | `lookup.dynamic` | 직접 | M5 | 실행 중 데이터 갱신 버전·shape·safe boundary | 미구현 |
| [07-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) (L323) | Prelookup | 일반 표 | 기본 | `lookup.prelookup` | 직접 | M5 | 구간 index+fraction 출력 계약; 캐시 일관성; 실제 지원: 단위1 scalar·엄격히증가2~32기준점·0-based index/fraction 두 scalar·정확한 knot/끝점/clip/linear/error·독립 TS; 별도 Interpolation Using Prelookup/일반 n-D/typed index 제외; 계약·fixture: m5-contract / m5-verification | M5 승인 subset |
| [07-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) (L324) | Sine | 일반 표 | 조건 · 고정소수점 출력용 조회표 블록. 무추가제품 일반 사용에는 Trigonometric Function 등을 우선 | `math.trigonometric` | 독립 대체 | M5 | float sin 계산은 M1; 원본 fixed-point 조회표의 bit-exact 동작은 M5 별도 검증 | 미구현 |
| [07-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) (L325) | n-D Lookup Table | 일반 표 | 기본 | `lookup.interpolated` | 구성 | M5 | 승인 rank의 n-D breakpoints·축 layout·보간/extrapolation과 메모리 상한 | 미구현 |

### 08. Math Operations

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [08-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L341) | Abs | 일반 표 | 기본 | `math.abs` | 직접 | M1 | M1 실수; 복소수 magnitude M5; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [08-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L342) | Add | 일반 표 | 구성 · Sum의 직사각형 덧셈 구성 | `math.sum` | 구성 | M1 | 입력 부호/축소 축/출력 형상의 사전 구성; 실제 지원: M1 고정 사전 설정만 제공; 원본 전체 옵션 동등성 제외 | M1 preset subset |
| [08-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L343) | Algebraic Constraint | 일반 표 | 기본 | `solver.algebraic-constraint` | 미지원·adapter 연구 | M5 | smooth real index-1 subset의 수렴 spike 이후 별도 승인 범위; 미수렴·비매끄러운 loop 거부 | 미구현 |
| [08-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L344) | Assignment | 일반 표 | 기본 | `matrix.assign` | 직접 | M1 | 배열 선택 위치 대입·불변 데이터 계약·shape/bounds 검증 | 미구현 |
| [08-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L345) | Bias | 일반 표 | 기본 | `math.bias` | 직접 | M1 | 스칼라/배열 bias 합산 | 미구현 |
| [08-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L346) | Complex to Magnitude-Angle | 일반 표 | 기본 | `math.complex-conversion` | 구성 | M5 | 실수부/허수부 또는 크기/각도 변환 preset; radian 기준 | 미구현 |
| [08-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L347) | Complex to Real-Imag | 일반 표 | 기본 | `math.complex-conversion` | 구성 | M5 | 실수부/허수부 또는 크기/각도 변환 preset; radian 기준 | 미구현 |
| [08-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L348) | Divide | 일반 표 | 기본 | `math.divide` | 직접 | M1 | 원소 나눗셈·0/NaN/Inf·shape 계약 | 미구현 |
| [08-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L349) | Dot Product | 일반 표 | 기본 | `math.dot` | 직접 | M1 | 축·벡터 길이 검증; 복소수 켤레 규칙 M5 | 미구현 |
| [08-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L350) | Find Nonzero Elements | 일반 표 | 기본 | `matrix.find-nonzero` | 직접 | M1 | CalcWeave 0-based 결과·행/열 index layout·가변 길이 상한 | 미구현 |
| [08-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L351) | Gain | 일반 표 | 기본 | `math.gain` | 직접 | M1 | M1 실수 스칼라/배열; 곱셈 방식 명시, 복소수 M5; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [08-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L352) | Magnitude-Angle to Complex | 일반 표 | 기본 | `math.complex-conversion` | 구성 | M5 | 실수부/허수부 또는 크기/각도 변환 preset; radian 기준 | 미구현 |
| [08-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L353) | Math Function | 일반 표 | 기본 | `math.function` | 직접 | M1 | 실수 allowlist 함수; complex와 transpose 계열 M5/M1로 명시, eval 금지; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [08-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L354) | Matrix Concatenate | 일반 표 | 기본 | `math.concatenate` | 구성 | M1 | concat 축의 행렬 설정; Vector Concatenate와 shape 구분 | 미구현 |
| [08-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L355) | Matrix Multiply | 일반 표 | 구성 · Product의 행렬 곱셈 구성 | `math.matrix-multiply` | 구성 | M1 | 행렬 곱 mode·inner dimension 검증; 원소 곱과 구분; 실제 지원: 실수 2D A(m×k)·B(k×n)의 행렬 곱; 각 축 1~32·≤1,024원소·승인 단위 곱·스케일/보상 합산·형상/비유한/underflow 진단·가중 예산·독립 TS; complex/일반 tensor/자동 broadcasting 제외; 계약·fixture: m5-contract / m5-verification | M5 승인 subset |
| [08-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L356) | MinMax | 일반 표 | 기본 | `math.minmax` | 직접 | M1 | 다중 입력/축소 축·NaN 계약; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [08-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L357) | MinMax Running Resettable | 일반 표 | 기본 | `math.running-minmax` | 직접 | M2 | 누적 극값 state·reset 순서 | 미구현 |
| [08-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L358) | Permute Dimensions | 일반 표 | 기본 | `matrix.permute-dimensions` | 직접 | M1 | M1 vector/2D axis permutation·중복/누락 축 거부; 일반 n-D rank 확장 M5 | 미구현 |
| [08-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L359) | Polynomial | 일반 표 | 기본 | `math.polynomial` | 직접 | M1 | Horner 평가·계수 순서·overflow diagnostics | 미구현 |
| [08-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L360) | Product | 일반 표 | 기본 | `math.multiply` | 직접 | M1 | 원소 곱/행렬 곱 모드를 명시; broadcasting은 계약으로 고정; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원; M5 추가: 행렬 구성은 별도 math.matrix-multiply의 검증된 실수2D subset; 원소별 math.multiply 계약 유지; 일반 complex/fixed 타입 제외 | M1 정적 subset |
| [08-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L361) | Product of Elements | 일반 표 | 기본 | `math.reduce-product` | 구성 | M1 | 축별 요소 곱 reduce·빈 축 계약 | 미구현 |
| [08-022](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L362) | Real-Imag to Complex | 일반 표 | 기본 | `math.complex-conversion` | 구성 | M5 | 실수부/허수부 또는 크기/각도 변환 preset; radian 기준 | 미구현 |
| [08-023](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L363) | Reciprocal Sqrt | 일반 표 | 구성 · Sqrt의 역제곱근 구성 | `math.sqrt` | 구성 | M1 | reciprocal/signed preset; 음수 입력 의미를 기본 sqrt와 구분 | 미구현 |
| [08-024](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L364) | Reshape | 일반 표 | 기본 | `matrix.reshape` | 직접 | M1 | M1 vector/2D 원소 수 유지·row-major 계약; 일반 n-D rank 확장 M5; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [08-025](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L365) | Rounding Function | 일반 표 | 기본 | `math.round` | 직접 | M1 | floor/ceil/round/fix; halfway·음수 처리 명세; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [08-026](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L366) | Sign | 일반 표 | 기본 | `math.sign` | 직접 | M1 | 0/-0/NaN 처리와 연속 crossing M3 | 미구현 |
| [08-027](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L367) | Signed Sqrt | 일반 표 | 구성 · Sqrt의 부호 있는 제곱근 구성 | `math.sqrt` | 구성 | M1 | reciprocal/signed preset; 음수 입력 의미를 기본 sqrt와 구분 | 미구현 |
| [08-028](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L368) | Sine Wave Function | 일반 표 | 기본 | `math.sine-wave-function` | 직접 | M1 | 외부 입력 t의 A·sin(ωt+φ)+bias 정적 함수; sin(u)와 simulation-time source를 구분, waveform 수학 kernel 공유 | 미구현 |
| [08-029](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L369) | Slider Gain | 일반 표 | 기본 · Commonly Used Blocks가 아닌 이 분류에 있음 | `math.gain` | 구성 | M4 | dashboard slider에 gain parameter 바인딩; source 분류는 보존; 실제 지원: scalar Gain.gain을 대시보드 slider에 바인딩·범위/step 검증·다음 실행 적용; 기존 typed Gain kernel 재사용·실행 중 배율 변경 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [08-030](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L370) | Sqrt | 일반 표 | 기본 | `math.sqrt` | 직접 | M1 | M1 real sqrt·domain 오류; complex M5; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [08-031](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L371) | Squeeze | 일반 표 | 기본 | `matrix.squeeze` | 직접 | M1 | M1 승인 vector/2D의 길이 1 축 제거·최소 rank 계약; 일반 n-D M5 | 미구현 |
| [08-032](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L372) | Subtract | 일반 표 | 구성 · Sum의 뺄셈 구성 | `math.sum` | 구성 | M1 | 입력 부호/축소 축/출력 형상의 사전 구성; 실제 지원: M1 고정 사전 설정만 제공; 원본 전체 옵션 동등성 제외 | M1 preset subset |
| [08-033](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L373) | Sum | 일반 표 | 기본 | `math.sum` | 직접 | M1 | 입력별 부호·축·배열 형상 명세; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [08-034](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L374) | Sum of Elements | 일반 표 | 구성 · Sum의 입력 요소 합산 구성 | `math.sum` | 구성 | M1 | 입력 부호/축소 축/출력 형상의 사전 구성 | 미구현 |
| [08-035](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L375) | Trigonometric Function | 일반 표 | 기본 | `math.trigonometric` | 직접 | M1 | radian 함수 allowlist·domain 검사; complex M5; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [08-036](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L376) | Unary Minus | 일반 표 | 기본 | `math.negate` | 직접 | M1 | 원소별 부호 반전 | 미구현 |
| [08-037](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L377) | Vector Concatenate | 일반 표 | 기본 | `math.concatenate` | 구성 | M1 | 동종 배열 concat의 벡터 축 설정; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [08-038](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) (L378) | Weighted Sample Time Math | 일반 표 | 기본 | `time.weighted-math` | 직접 | M2 | scheduler의 Ts·weight 기반 math; 추론된 sample time 명세 | 미구현 |

### 09. Matrix Operations

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [09-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L394) | Array Processing Subsystem | 일반 표 | R2024a+ | `hierarchy.array-processing` | 독립 대체 | M5 | 배열 map/neighborhood kernel로 재설계; 분할·경계·픽셀 실행 순서별 명세와 상한 | 미구현 |
| [09-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L395) | Create Diagonal Matrix | 일반 표 | 편입 R2021b+ · 그 이전 DSP System Toolbox 소속 | `matrix.diagonal-create` | 직접 | M1 | 대각 offset·출력 shape | 미구현 |
| [09-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L396) | Cross Product | 일반 표 | R2021b+ | `matrix.cross` | 직접 | M1 | 3D 축/벡터 검증 | 미구현 |
| [09-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L397) | Expand Scalar | 일반 표 | R2024a+ | `matrix.expand-scalar` | 직접 | M1 | 명시 shape로 확장; 메모리 상한 | 미구현 |
| [09-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L398) | Extract Diagonal | 일반 표 | 편입 R2021b+ · 그 이전 DSP System Toolbox 소속 | `matrix.diagonal-extract` | 직접 | M1 | 대각 offset·출력 vector | 미구현 |
| [09-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L399) | Hermitian Transpose | 일반 표 | R2021b+ | `matrix.transpose` | 구성 | M5 | conjugate=true; 일반 Transpose와 complex 켤레 구분 | 미구현 |
| [09-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L400) | Identity Matrix | 일반 표 | R2021b+ | `matrix.identity` | 직접 | M1 | 정방/출력 shape·최대 차원 | 미구현 |
| [09-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L401) | IsHermitian | 일반 표 | R2022a+ | `matrix.is-hermitian` | 직접 | M5 | complex 켤레 전치 equality와 허용오차 | 미구현 |
| [09-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L402) | IsSymmetric | 일반 표 | R2021b+ | `matrix.is-symmetric` | 직접 | M1 | transpose equality와 허용오차 | 미구현 |
| [09-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L403) | IsTriangular | 일반 표 | R2021b+ | `matrix.is-triangular` | 직접 | M1 | upper/lower와 허용오차 | 미구현 |
| [09-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L404) | Matrix Concatenate | 일반 표 | 기본 · Math Operations에도 있음. 이 분류 자체의 구버전 존재 여부와 구분 | `math.concatenate` | 구성 | M1 | concat 축의 행렬 설정; Vector Concatenate와 shape 구분 | 미구현 |
| [09-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L405) | Matrix Multiply | 일반 표 | 구성 · Product 계열. 구버전에서는 Math Operations에서 확인 | `math.matrix-multiply` | 구성 | M1 | 행렬 곱 mode·inner dimension 검증; 원소 곱과 구분; 실제 지원: 실수 2D A(m×k)·B(k×n)의 행렬 곱; 각 축 1~32·≤1,024원소·승인 단위 곱·스케일/보상 합산·형상/비유한/underflow 진단·가중 예산·독립 TS; complex/일반 tensor/자동 broadcasting 제외; 계약·fixture: m5-contract / m5-verification | M5 승인 subset |
| [09-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L406) | Matrix Square | 일반 표 | 편입 R2021b+ · 그 이전 DSP System Toolbox 소속 | `math.multiply` | 구성 | M1 | A×A; 원소별 square와 구분 | 미구현 |
| [09-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L407) | Neighborhood Processing Subsystem | 일반 표 | R2022b+ | `hierarchy.array-processing` | 독립 대체 | M5 | 배열 map/neighborhood kernel로 재설계; 분할·경계·픽셀 실행 순서별 명세와 상한 | 미구현 |
| [09-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L408) | Permute Matrix | 일반 표 | 편입 R2021b+ · 그 이전 DSP System Toolbox 소속 | `matrix.permute-rows-cols` | 직접 | M1 | row/column index permutation; N-D axis permutation과 구분 | 미구현 |
| [09-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L409) | Pixel Processing Subsystem | 일반 표 | R2024a+ | `hierarchy.array-processing` | 독립 대체 | M5 | 배열 map/neighborhood kernel로 재설계; 분할·경계·픽셀 실행 순서별 명세와 상한 | 미구현 |
| [09-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L410) | Product | 일반 표 | 기본 · Math Operations에도 있음 | `math.multiply` | 직접 | M1 | 원소 곱/행렬 곱 모드를 명시; broadcasting은 계약으로 고정; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원; M5 추가: 행렬 구성은 별도 math.matrix-multiply의 검증된 실수2D subset; 원소별 math.multiply 계약 유지; 일반 complex/fixed 타입 제외 | M1 정적 subset |
| [09-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L411) | Submatrix | 일반 표 | 편입 R2021b+ · 그 이전 DSP System Toolbox 소속 | `matrix.select` | 구성 | M1 | 행/열 범위 selector; 0-based 계약 | 미구현 |
| [09-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) (L412) | Transpose | 일반 표 | R2021b+ | `matrix.transpose` | 직접 | M1 | conjugate=false; storage layout와 view/copy 명세; 실제 지원: 실수2D 행/열 전치·각축1~32·단위유지·방어적복사·독립 TS; complex/켤레/Hermitian Transpose 제외; 계약·fixture: m5-contract / m5-verification | M5 승인 subset |

### 10. Messages & Events

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [10-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-10) (L428) | Hit Crossing | 일반 표 | 기본 | `logic.hit-crossing` | 직접 | M3 | 방향·허용오차·동시 crossing 순서·chattering 상한; 실제 지원: 단위1 scalar threshold·rising/falling/either·boolean event pulse·시간 정밀화·동시 reset/tick 순서·사건 상한; 계약·fixture: m3-contract / m3-verification | M3 승인 subset |
| [10-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-10) (L429) | Hit Scheduler | 일반 표 | R2022b+ | `events.hit-scheduler` | 직접 | M5 | bounded event schedule·동시 시점 결정론·재진입 금지 | 미구현 |
| [10-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-10) (L430) | Message Merge | 일반 표 | R2021a+ | `events.message-merge` | 직접 | M5 | bounded typed message stream 병합·동시 도착 순서 | 미구현 |
| [10-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-10) (L431) | Message Triggered Subsystem | 일반 표 | R2022a+ | `hierarchy.message-triggered` | 직접 | M5 | message 소비·동일 시각 event 순서·작업량 상한 | 미구현 |
| [10-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-10) (L432) | Queue | 일반 표 | 기본 메시지 사용 / 조건 · 엔터티 및 고급 라우팅은 SimEvents 조건 확인. 제품 편입의 정확한 최초 버전은 별도 확인 필요 | `events.queue` | 직접 | M5 | 기본 bounded FIFO·overflow 정책; SimEvents 엔터티/고급 라우팅 제외 | 미구현 |
| [10-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-10) (L433) | Receive | 일반 표 | 기본 메시지 사용 · 구버전 제품 구성 및 메시지 기능 확인 | `events.receive` | 직접 | M5 | typed message dequeue·empty 처리·time ordering | 미구현 |
| [10-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-10) (L434) | Send | 일반 표 | 기본 메시지 사용 · 구버전 제품 구성 및 메시지 기능 확인 | `events.send` | 직접 | M5 | typed message enqueue; 네트워크/미들웨어는 별도 adapter | 미구현 |
| [10-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-10) (L435) | Sequence Viewer | 일반 표 | 기본 · 메시지/이벤트 시퀀스 표시 | `events.sequence-viewer` | 직접 | M5 | 메시지·event trace; 로그 길이 상한 | 미구현 |

### 11. Model Verification

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [11-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) (L451) | Assertion | 일반 표 | 기본 | `verify.assert` | 직접 | M1 | 조건 위반 위치·입력·stop/warn 정책; 형식 검증 제외 | 미구현 |
| [11-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) (L452) | Check Discrete Gradient | 일반 표 | 기본 | `verify.gradient` | 직접 | M2 | sample delta/Ts·초기 sample 동작 | 미구현 |
| [11-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) (L453) | Check Dynamic Gap | 일반 표 | 기본 | `verify.bounds` | 구성 | M2 | 입력 기반 lower/upper/gap/range 검사 preset | 미구현 |
| [11-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) (L454) | Check Dynamic Lower Bound | 일반 표 | 기본 | `verify.bounds` | 구성 | M2 | 입력 기반 lower/upper/gap/range 검사 preset | 미구현 |
| [11-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) (L455) | Check Dynamic Range | 일반 표 | 기본 | `verify.bounds` | 구성 | M2 | 입력 기반 lower/upper/gap/range 검사 preset | 미구현 |
| [11-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) (L456) | Check Dynamic Upper Bound | 일반 표 | 기본 | `verify.bounds` | 구성 | M2 | 입력 기반 lower/upper/gap/range 검사 preset | 미구현 |
| [11-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) (L457) | Check Input Resolution | 일반 표 | 기본 | `verify.resolution` | 직접 | M2 | 격자/분해능 허용오차·시간/자료형 계약 | 미구현 |
| [11-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) (L458) | Check Static Gap | 일반 표 | 기본 | `verify.bounds` | 구성 | M1 | 상수 lower/upper/gap/range 검사 preset | 미구현 |
| [11-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) (L459) | Check Static Lower Bound | 일반 표 | 기본 | `verify.bounds` | 구성 | M1 | 상수 lower/upper/gap/range 검사 preset | 미구현 |
| [11-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) (L460) | Check Static Range | 일반 표 | 기본 | `verify.bounds` | 구성 | M1 | 상수 lower/upper/gap/range 검사 preset | 미구현 |
| [11-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) (L461) | Check Static Upper Bound | 일반 표 | 기본 | `verify.bounds` | 구성 | M1 | 상수 lower/upper/gap/range 검사 preset | 미구현 |

### 12. Model-Wide Utilities

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [12-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-12) (L477) | Block Support Table | 일반 표 | 유틸리티 · 데이터형 지원표를 여는 라이브러리 항목 | `model.support-catalog` | 독립 대체 | M0 | CalcWeave numeric/solver/export 지원 계약표; MathWorks 테이블 호출 제외 | 미구현 |
| [12-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-12) (L478) | DocBlock | 일반 표 | 유틸리티 · 모델에 문서 저장 | `annotation.note` | 독립 대체 | M4 | 모델 내 안전한 Markdown 문서·검색; 원본 외부 편집기 동작 제외; 실제 지원: 모델 notes와 도식 메모의 일반 텍스트 최대 2,000자·React escaping·JSON 보관·수치/상태/실행 hash 불변; HTML/Markdown 실행·문서 검색·외부 편집기 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [12-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-12) (L479) | Model Info | 일반 표 | 유틸리티 · 모델 속성 및 설명 표시 | `annotation.model-info` | 직접 | M4 | 이름·버전·설명·단위/solver 정보 표시; 실제 지원: 작업 공간에서 모델 이름/ID·블럭/연결/데이터/하위 정의 수·실행 방식 표시·annotation에 계산 포트 없음·실행 hash 불변; 원본 외부 도구/전체 metadata 템플릿 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [12-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-12) (L480) | Timed-Based Linearization | 일반 표 | 기본 선형화 · 공식 문서의 표기를 유지함 | `analysis.linearization` | 독립 대체 | M5 | 검증된 국소 Jacobian·명시 operating point; linmod 호환/고급 튜닝 보장 제외 | 미구현 |
| [12-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-12) (L481) | Trigger-Based Linearization | 일반 표 | 기본 선형화 · 고급 선형화 도구와 구분 | `analysis.linearization` | 독립 대체 | M5 | 검증된 국소 Jacobian·명시 operating point; linmod 호환/고급 튜닝 보장 제외 | 미구현 |

### 13. Ports & Subsystems

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [13-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L497) | Atomic Subsystem | 일반 표 | 구성 · Subsystem의 atomic 실행 구성 | `hierarchy.subsystem` | 구성 | M4 | 원자 실행 boundary preset; IR에서 direct feedthrough를 정확히 분석 | 미구현 |
| [13-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L498) | Enable | 일반 표 | 기본 | `hierarchy.enable-port` | 직접 | M5 | enabled scope control; 상태 hold/reset 정책 | 미구현 |
| [13-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L499) | Enabled Subsystem | 일반 표 | 기본 | `hierarchy.enabled` | 직접 | M5 | boolean enable·inactive 출력/상태 계약 | 미구현 |
| [13-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L500) | Enabled and Triggered Subsystem | 일반 표 | 기본 | `hierarchy.enabled-triggered` | 구성 | M5 | enable+trigger 조합의 우선순위/동시 event 계약 | 미구현 |
| [13-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L501) | For Each Subsystem | 일반 표 | 기본 | `hierarchy.iteration` | 구성 | M5 | 분할/for/while preset; 최대 반복·시간·메모리 상한과 state scoping | 미구현 |
| [13-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L502) | For Iterator Subsystem | 일반 표 | 기본 | `hierarchy.iteration` | 구성 | M5 | 분할/for/while preset; 최대 반복·시간·메모리 상한과 state scoping | 미구현 |
| [13-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L503) | Function Element | 일반 표 | R2022a+ | `functions.element` | 독립 대체 | M5 | typed callable component/호출 계약; 원본 무제한 MATLAB 실행 제외 | 미구현 |
| [13-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L504) | Function Element Call | 일반 표 | R2022a+ | `functions.element` | 독립 대체 | M5 | typed callable component/호출 계약; 원본 무제한 MATLAB 실행 제외 | 미구현 |
| [13-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L505) | Function-Call Feedback Latch | 일반 표 | 기본 | `events.feedback-latch` | 직접 | M5 | function-call event 피드백의 latch 수명·재진입 제어 | 미구현 |
| [13-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L506) | Function-Call Generator | 일반 표 | 기본 | `events.function-call-generator` | 직접 | M5 | sample/event 기반 호출 생성·작업량 상한 | 미구현 |
| [13-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L507) | Function-Call Split | 일반 표 | 기본 | `events.function-call-split` | 직접 | M5 | 명시 event 순서로 분기·동시 호출 trace | 미구현 |
| [13-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L508) | Function-Call Subsystem | 일반 표 | 기본 | `hierarchy.function-call` | 직접 | M5 | 정의된 호출 token·출력 상태·재진입 정책 | 미구현 |
| [13-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L509) | If | 일반 표 | 기본 | `hierarchy.if` | 직접 | M5 | 조건 분기 control token; 수식은 allowlist AST | 미구현 |
| [13-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L510) | If Action Subsystem | 일반 표 | 기본 | `hierarchy.action` | 구성 | M5 | if action의 exclusive 실행·inactive state 계약 | 미구현 |
| [13-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L511) | In Bus Element | 일반 표 | 기본 | `io.bus-input` | 직접 | M4 | 이름 있는 필드 경로의 입력 계약 | 미구현 |
| [13-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L512) | Inport | 일반 표 | 기본 · 배치 후 초기 이름은 보통 In1 | `io.input` | 직접 | M1 | 모델 외부 입력 계약; 계층 포트 연결 M4; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [13-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L513) | Model | 일반 표 | 기본 | `hierarchy.model-reference` | 독립 대체 | M4 | versioned CalcWeave graph 참조; SLX model reference 실행 제외 | 미구현 |
| [13-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L514) | Out Bus Element | 일반 표 | 기본 | `io.bus-output` | 직접 | M4 | 이름 있는 필드 경로의 출력 계약 | 미구현 |
| [13-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L515) | Outport | 일반 표 | 기본 · 배치 후 초기 이름은 보통 Out1 | `io.output` | 직접 | M1 | 모델 외부 출력 계약; 계층 포트 연결 M4; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [13-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L516) | Resettable Subsystem | 일반 표 | 기본 | `hierarchy.resettable` | 직접 | M5 | reset event·초깃값·동시 실행 순서 | 미구현 |
| [13-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L517) | Subsystem | 일반 표 | 기본 | `hierarchy.subsystem` | 직접 | M4 | 포트 계약·스코프·하위 그래프 컴파일; 실제 지원: 프로젝트 내 버전 정의·투명 IO 포트 각 8개·깊이 8·독립 인스턴스 상태/rate/reset·경로/정의 SHA-256·명시 버전 갱신·선택 묶기/하위 편집; 조건부/atomic 실행·외부 파일 reference 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [13-022](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L518) | Subsystem Reference | 일반 표 | 구성 · 별도 subsystem 파일을 참조. 도입 버전 미확정; 매우 오래된 버전에서 존재를 가정하지 않음 | `hierarchy.model-reference` | 구성 | M4 | 별도 CalcWeave graph asset 참조 preset; 소스 경로/권한 검증 | 미구현 |
| [13-023](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L519) | Switch Case | 일반 표 | 기본 | `hierarchy.switch-case` | 직접 | M5 | enum/int cases·중복/default 계약 | 미구현 |
| [13-024](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L520) | Switch Case Action Subsystem | 일반 표 | 기본 | `hierarchy.action` | 구성 | M5 | switch-case action preset; Merge 입력 실행 계약 | 미구현 |
| [13-025](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L521) | Trigger | 일반 표 | 기본 | `hierarchy.trigger-port` | 직접 | M5 | M5 discrete rising/falling trigger; 연속 crossing은 별도 검증 | 미구현 |
| [13-026](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L522) | Triggered Subsystem | 일반 표 | 기본 | `hierarchy.triggered` | 직접 | M5 | M5 discrete event 실행; 연속 crossing·동시 trigger는 검증 subset | 미구현 |
| [13-027](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L523) | Unit System Configuration | 일반 표 | 기본 | `signal.unit-system` | 독립 대체 | M4 | CalcWeave 단위 registry·차원 검사 설정; MathWorks units 객체 실행 제외 | 미구현 |
| [13-028](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L524) | Variant Subsystem | 일반 표 | 기본 | `hierarchy.variant` | 직접 | M5 | compile-time variant·검증된 선택자; dynamic variant 별도 범위 | 미구현 |
| [13-029](../dataset/Simulink_Basic_Blocks_R2024b.md#library-13) (L525) | While Iterator Subsystem | 일반 표 | 기본 | `hierarchy.iteration` | 구성 | M5 | 분할/for/while preset; 최대 반복·시간·메모리 상한과 state scoping | 미구현 |

### 14. Signal Attributes

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [14-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L541) | Bus to Vector | 일반 표 | 기본 | `signal.bus-to-vector` | 직접 | M4 | 동종 numeric fields만 변환; field order/shape 명시 | 미구현 |
| [14-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L542) | Data Type Conversion | 일반 표 | 기본 | `fixed.quantize` | 직접 | M1 | M1 finite float64/boolean subset; M2 승인한 32비트 이하 정수; M5 float32/int64/fixed-point 계약; 실제 지원: 명시 1~32bit signed/unsigned·fraction0~32·nearest-even/floor/ceil/toward-zero·saturate/wrap/error의 정확한 IEEE→BigInt 양자화; out 복원 float64·stored 정확한 정수 코드; 일반 Data Type Conversion/fixed-point 신호 전파/64bit/f32/slope-bias 제외; 계약·fixture: m5-contract / m5-verification | M5 독립 대체 subset |
| [14-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L543) | Data Type Conversion Inherited | 일반 표 | 기본 | `signal.cast` | 구성 | M4 | 지원된 type의 inference 후 cast; M4 finite f64/bool/≤32bit 정수, f32/int64/fixed는 M5 | 미구현 |
| [14-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L544) | Data Type Duplicate | 일반 표 | 기본 | `signal.type-constraint` | 구성 | M4 | 자료형 동일성 constraint; 값 변환과 구분 | 미구현 |
| [14-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L545) | Data Type Propagation | 일반 표 | 기본 | `signal.type-propagation` | 직접 | M4 | 입출력 자료형 constraint solver·미정/순환 진단 | 미구현 |
| [14-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L546) | Data Type Scaling Strip | 일반 표 | 조건 · 고정소수점 관련 사용 시 제품 및 데이터형 조건 확인 | `signal.scaling-strip` | 직접 | M5 | fixed-point 저장 정수/scale 분리 계약; float cast 대체 금지 | 미구현 |
| [14-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L547) | IC | 일반 표 | 기본 | `signal.initial-condition` | 직접 | M2 | 첫 simulation time과 이후 output 계약; reset과 구분 | 미구현 |
| [14-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L548) | Probe | 일반 표 | 기본 | `signal.probe` | 직접 | M2 | shape·type·sample-time 메타데이터 출력 | 미구현 |
| [14-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L549) | Rate Transition | 일반 표 | 기본 | `time.rate-transition` | 직접 | M2 | M2 정수배 rate: 이전 published boundary 값을 read-before-write; 최종 M0 규약·fixture, 비정수/advanced M5; 실제 지원: 명시 base tick 정수 period/offset·read-before-write 이전 publication·양방향/동시/offset·typed initial; 비정수/비동기 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [14-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L550) | Signal Conversion | 일반 표 | 기본 | `signal.representation` | 직접 | M4 | 값 유지 copy/virtual/nonvirtual 구조 표현; cast와 구분 | 미구현 |
| [14-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L551) | Signal Specification | 일반 표 | 기본 | `signal.contract` | 직접 | M1 | type/shape/range 계약·연결 전 검증; 단위/시간 확대 M4 | 미구현 |
| [14-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L552) | Unit Conversion | 일반 표 | 기본 | `unit.convert` | 직접 | M4 | 차원 호환·scale/offset 단위 변환; 단위 오류 차단; 실제 지원: 승인 27개 단위의 명시 차원 호환·scale/offset 변환·numeric scalar/vector/2D·cm/mm/km, ms/min, g, mV, C/K, deg/rad 포함; 제한 차원 곱/나눗셈·면적만·자동/사용자 정의 단위 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [14-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L553) | Weighted Sample Time | 일반 표 | 기본 | `time.weighted-sample-time` | 직접 | M2 | 추론된 Ts의 weight 결과·continuous/unresolved 상태 진단 | 미구현 |
| [14-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) (L554) | Width | 일반 표 | 기본 | `signal.width` | 직접 | M1 | 원소 수/rank 계약; bus width는 field 규칙 M4 | 미구현 |

### 15. Signal Routing

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [15-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L570) | Bus Assignment | 일반 표 | 기본 | `route.bus-assign` | 직접 | M4 | 이름 있는 field 경로 대입·버스 계약 유지 | 미구현 |
| [15-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L571) | Bus Creator | 일반 표 | 기본 | `route.bus-create` | 직접 | M4 | 이종 필드의 구조화 버스; 숫자 Mux와 구분; 실제 지원: 동일 float64 또는 boolean·동일 단위의 scalar 두 개를 이름 있는 vector로 묶음; 최대 64자 고유 필드·IR fields 메타데이터; 이종/중첩/객체/generic bus 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [15-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L572) | Bus Selector | 일반 표 | 기본 | `route.bus-select` | 직접 | M4 | 이름 있는 버스 필드 선택; 실제 지원: 이름 있는 동종 scalar 두 필드 중 한 필드를 이름으로 선택·타입/단위 보존; Mux/Demux만으로 bus를 추정하지 않음; 이종/중첩/generic bus 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [15-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L573) | Data Store Memory | 일반 표 | 기본 | `route.data-store` | 구성 | M5 | scope·read/write 순서·초기화·단일 writer/충돌 진단; 전역 암묵 상태 최소화 | 미구현 |
| [15-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L574) | Data Store Read | 일반 표 | 기본 | `route.data-store` | 구성 | M5 | scope·read/write 순서·초기화·단일 writer/충돌 진단; 전역 암묵 상태 최소화 | 미구현 |
| [15-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L575) | Data Store Write | 일반 표 | 기본 | `route.data-store` | 구성 | M5 | scope·read/write 순서·초기화·단일 writer/충돌 진단; 전역 암묵 상태 최소화 | 미구현 |
| [15-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L576) | Demux | 일반 표 | 기본 | `route.demux` | 직접 | M1 | 동종 벡터 분할; 필드 기반 Bus Selector와 구분; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [15-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L577) | From | 일반 표 | 기본 | `route.tag-link` | 구성 | M4 | 시각적 tag binding·지역/계층 scope·중복 tag 검사 | 미구현 |
| [15-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L578) | Goto | 일반 표 | 기본 | `route.tag-link` | 구성 | M4 | 시각적 tag binding·지역/계층 scope·중복 tag 검사 | 미구현 |
| [15-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L579) | Goto Tag Visibility | 일반 표 | 기본 | `route.tag-link` | 구성 | M4 | 시각적 tag binding·지역/계층 scope·중복 tag 검사 | 미구현 |
| [15-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L580) | Index Vector | 일반 표 | 기본 | `matrix.select` | 구성 | M1 | vector index preset; 0-based·bounds 검증 | 미구현 |
| [15-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L581) | Manual Switch | 일반 표 | 기본 | `route.switch` | 구성 | M4 | 사용자 parameter binding으로 수동 선택 | 미구현 |
| [15-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L582) | Manual Variant Sink | 일반 표 | 기본 | `route.variant` | 구성 | M5 | compile-time variant selection/구간 preset; inactive branch 검증 정책 | 미구현 |
| [15-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L583) | Manual Variant Source | 일반 표 | 기본 | `route.variant` | 구성 | M5 | compile-time variant selection/구간 preset; inactive branch 검증 정책 | 미구현 |
| [15-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L584) | Merge | 일반 표 | 기본 | `route.merge` | 직접 | M5 | M5 조건부 실행 출력 결합·동시 writer 거부; Switch와 구분 | 미구현 |
| [15-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L585) | Multiport Switch | 일반 표 | 기본 | `route.multiport-switch` | 직접 | M1 | index/enum 기반 다중 입력 선택·범위 밖 처리 | 미구현 |
| [15-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L586) | Mux | 일반 표 | 기본 | `route.mux` | 직접 | M1 | 동종 숫자 벡터 합치기; 이종 Bus Creator와 구분; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [15-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L587) | Parameter Writer | 일반 표 | 기본 · 구버전 최초 도입 미확정 | `state.parameter-writer` | 직접 | M5 | 허용 parameter만 safe event boundary 업데이트·shape 불변 | 미구현 |
| [15-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L588) | Selector | 일반 표 | 기본 | `matrix.select` | 직접 | M1 | 축별 selection·index source·0-based bounds | 미구현 |
| [15-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L589) | State Reader | 일반 표 | 기본 · 구버전 최초 도입 미확정 | `state.reader` | 직접 | M5 | 명시 state handle·scope·수명 계약; 내부 state 노출 최소화 | 미구현 |
| [15-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L590) | State Writer | 일반 표 | 기본 · 구버전 최초 도입 미확정 | `state.writer` | 직접 | M5 | 허용 state handle·safe boundary·리셋/solver 재초기화 | 미구현 |
| [15-022](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L591) | Switch | 일반 표 | 기본 | `route.switch` | 직접 | M1 | 조건에 따라 현재 입력 선택; Merge와 구분; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [15-023](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L592) | Variant End | 일반 표 | R2024a+ | `route.variant` | 구성 | M5 | compile-time variant selection/구간 preset; inactive branch 검증 정책 | 미구현 |
| [15-024](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L593) | Variant Sink | 일반 표 | 기본 | `route.variant` | 구성 | M5 | compile-time variant selection/구간 preset; inactive branch 검증 정책 | 미구현 |
| [15-025](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L594) | Variant Source | 일반 표 | 기본 | `route.variant` | 구성 | M5 | compile-time variant selection/구간 preset; inactive branch 검증 정책 | 미구현 |
| [15-026](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L595) | Variant Start | 일반 표 | R2024a+ | `route.variant` | 구성 | M5 | compile-time variant selection/구간 preset; inactive branch 검증 정책 | 미구현 |
| [15-027](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) (L596) | Vector Concatenate | 일반 표 | 기본 | `math.concatenate` | 구성 | M1 | 동종 배열 concat의 벡터 축 설정; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |

### 16. Sinks

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [16-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-16) (L612) | Display | 일반 표 | 기본 · Dashboard의 Display와 구분 | `sink.display` | 직접 | M1 | 신호 그래프의 현재 결과 표시; Dashboard readout과 구분; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [16-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-16) (L613) | Floating Scope | 일반 표 | 기본 · Scope Viewer 관련 설명은 같은 공식 문서에서 제공 | `sink.scope` | 구성 | M4 | canvas wire 없는 선택 신호 viewer; 기존 scope 로그 재사용 | 미구현 |
| [16-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-16) (L614) | Out Bus Element | 일반 표 | 기본 | `io.bus-output` | 직접 | M4 | 이름 있는 필드 경로의 출력 계약 | 미구현 |
| [16-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-16) (L615) | Outport | 일반 표 | 기본 | `io.output` | 직접 | M1 | 모델 외부 출력 계약; 계층 포트 연결 M4; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [16-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-16) (L616) | Record | 일반 표 | R2021a+ | `sink.record` | 직접 | M4 | versioned trace dataset 저장·축/선택 신호·메모리 상한 | 미구현 |
| [16-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-16) (L617) | Scope | 일반 표 | 기본 | `sink.scope` | 직접 | M2 | 시간축 신호 표시; 렌더링 속도와 계산 시간을 분리; 실제 지원: typed time 기록·numeric scalar plot·전체 배열 샘플/원소 표; signal viewer 전체 옵션 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [16-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-16) (L618) | Stop Simulation | 일반 표 | 기본 | `sink.stop` | 직접 | M2 | 조건·사용자 취소에 의한 정상 stop과 종료 trace | 미구현 |
| [16-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-16) (L619) | Terminator | 일반 표 | 기본 | `io.terminator` | 직접 | M1 | 의도적 미사용 출력을 표시하고 연결 경고 제어; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [16-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-16) (L620) | To File | 일반 표 | 기본 | `data.output-file` | 독립 대체 | M4 | 브라우저의 명시 CSV/JSON download; MAT 자동 호환·임의 OS 경로 쓰기 제외 | 미구현 |
| [16-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-16) (L621) | To Workspace | 일반 표 | 기본 | `data.output-dataset` | 독립 대체 | M4 | CalcWeave named dataset으로 기록; MATLAB workspace 실행 제외 | 미구현 |
| [16-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-16) (L622) | XY Graph | 일반 표 | 기본 이름은 구버전에도 존재. R2021b부터 Record의 XY 표시 구성으로 대체 | `sink.record` | 구성 | M4 | XY chart preset; 원본 R2021b 이후 Record 대응, 구형 UI 호환 보장 제외 | 미구현 |

### 17. Sources

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [17-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L638) | Band-Limited White Noise | 일반 표 | 기본 | `source.band-limited-noise` | 직접 | M2 | seeded PRNG·noise power·Ts·sample generation 계약; MATLAB 난수열 동일성 제외 | 미구현 |
| [17-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L639) | Chirp Signal | 일반 표 | 기본 | `source.chirp` | 직접 | M2 | 주파수 sweep law·time units·phase continuity | 미구현 |
| [17-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L640) | Clock | 일반 표 | 기본 | `source.clock` | 직접 | M2 | simulation time; browser wall clock과 분리; 실제 지원: 모든 base tick의 simulation time·단위s·rate1/0; wall clock 제외; 계약·fixture: m2-contract / m2-verification; M3 연속 stage 시각 지원: m3-contract / m3-verification | M2 승인 subset |
| [17-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L641) | Constant | 일반 표 | 기본 | `source.constant` | 직접 | M1 | 실수·배열 상수; 자료형 범위는 단계별 확대; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [17-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L642) | Counter Free-Running | 일반 표 | 기본 | `source.counter` | 구성 | M2 | sample-driven count·범위/overflow/reset preset | 미구현 |
| [17-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L643) | Counter Limited | 일반 표 | 기본 | `source.counter` | 구성 | M2 | sample-driven count·범위/overflow/reset preset | 미구현 |
| [17-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L644) | Digital Clock | 일반 표 | 기본 | `source.digital-clock` | 직접 | M2 | sample hit 시각으로 갱신된 simulation time; 실제 지원: node due의 simulation time·단위s·사이 hold; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [17-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L645) | Enumerated Constant | 일반 표 | 기본 | `source.enum` | 직접 | M4 | M4 typed enum schema의 선언 variant; 문자열/정수 표상과 변환 계약 | 미구현 |
| [17-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L646) | From File | 일반 표 | 기본 | `source.dataset` | 독립 대체 | M4 | 사용자 선택 CSV/JSON dataset; MAT 포맷은 별도 adapter 연구; 실제 지원: 사용자 선택 CSV/행 객체 JSON을 검증·정리 후 프로젝트에 보관; 명시 시간/열/단위·숫자 linear/previous 및 boolean previous 재생·범위 밖 hold/zero/error·원본/내용 SHA-256; 2 MiB·4,000행·16열·20,000셀·8 dataset·문자열 보관만; MAT/XLSX/MATLAB 변수·문자열 실행·반복 재생 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [17-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L647) | From Spreadsheet | 일반 표 | 기본 · 외부 파일/파일 형식 지원 조건 확인 | `data.input-table` | 독립 대체 | M4 | CSV/table import 우선; XLSX는 검증된 parser·limits 검토, 임의 외부 앱 호출 제외 | 미구현 |
| [17-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L648) | From Workspace | 일반 표 | 기본 | `source.dataset` | 독립 대체 | M4 | CalcWeave named dataset/time-series 입력; MATLAB 변수 해석 제외; 실제 지원: 사용자 선택 CSV/행 객체 JSON을 검증·정리 후 프로젝트에 보관; 명시 시간/열/단위·숫자 linear/previous 및 boolean previous 재생·범위 밖 hold/zero/error·원본/내용 SHA-256; 2 MiB·4,000행·16열·20,000셀·8 dataset·문자열 보관만; MAT/XLSX/MATLAB 변수·문자열 실행·반복 재생 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [17-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L649) | Ground | 일반 표 | 기본 | `source.constant` | 구성 | M1 | 값 0; 연결 포트의 형상·자료형 추론 | 미구현 |
| [17-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L650) | In Bus Element | 일반 표 | 기본 | `io.bus-input` | 직접 | M4 | 이름 있는 필드 경로의 입력 계약 | 미구현 |
| [17-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L651) | Inport | 일반 표 | 기본 | `io.input` | 직접 | M1 | 모델 외부 입력 계약; 계층 포트 연결 M4; 실제 지원: M1 계약의 finite float64/boolean·scalar/vector/2D subset; M2에서는 동일 타입의 정수 tick 이산 실행에도 지원 | M1 정적 subset |
| [17-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L652) | Playback | 일반 표 | R2022b+ | `source.dataset` | 직접 | M4 | trace 재생·보간/범위 밖/반복 계약; 실제 지원: 사용자 선택 CSV/행 객체 JSON을 검증·정리 후 프로젝트에 보관; 명시 시간/열/단위·숫자 linear/previous 및 boolean previous 재생·범위 밖 hold/zero/error·원본/내용 SHA-256; 2 MiB·4,000행·16열·20,000셀·8 dataset·문자열 보관만; MAT/XLSX/MATLAB 변수·문자열 실행·반복 재생 제외; 계약·fixture: m4-contract / m4-verification | M4 승인 subset |
| [17-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L653) | Pulse Generator | 일반 표 | 기본 | `source.pulse` | 직접 | M2 | time/sample mode·duty/phase·event scheduling; 실제 지원: base tick 정수 period/width/phase만; time/event mode 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [17-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L654) | Ramp | 일반 표 | 기본 | `source.ramp` | 직접 | M2 | start/slope·simulation time; 실제 지원: absolute time start/slope/initial; 계약·fixture: m2-contract / m2-verification; M3 연속 stage 시각 지원: m3-contract / m3-verification | M2 승인 subset |
| [17-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L655) | Random Number | 일반 표 | 기본 | `source.random` | 구성 | M2 | 명시 seeded PRNG의 normal distribution; 원본 난수열 재현 제외; 실제 지원: 노드별 LCG32 seed0..2^32-1·uniform 또는 two-draw normal; MATLAB 난수열 동등성 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [17-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L656) | Repeating Sequence | 일반 표 | 기본 | `source.repeating-sequence` | 구성 | M2 | 주기·선형/계단 보간·종점 discontinuity preset; 실제 지원: 2..1024 strictly increasing times·finite values·linear/previous·positive absolute-time modulo·종점 discontinuity; 계약·fixture: m2-contract / m2-verification; M3 연속 stage 시각 지원: m3-contract / m3-verification | M2 승인 subset |
| [17-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L657) | Repeating Sequence Interpolated | 일반 표 | 기본 | `source.repeating-sequence` | 구성 | M2 | 주기·선형/계단 보간·종점 discontinuity preset; 실제 지원: 2..1024 strictly increasing times·finite values·linear/previous·positive absolute-time modulo·종점 discontinuity; 계약·fixture: m2-contract / m2-verification; M3 연속 stage 시각 지원: m3-contract / m3-verification | M2 승인 subset |
| [17-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L658) | Repeating Sequence Stair | 일반 표 | 기본 | `source.repeating-sequence` | 구성 | M2 | 주기·선형/계단 보간·종점 discontinuity preset; 실제 지원: 2..1024 strictly increasing times·finite values·linear/previous·positive absolute-time modulo·종점 discontinuity; 계약·fixture: m2-contract / m2-verification; M3 연속 stage 시각 지원: m3-contract / m3-verification | M2 승인 subset |
| [17-022](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L659) | Signal Editor | 일반 표 | R2017b+ | `data.signal-editor` | 독립 대체 | M4 | 웹 time-series scenario 편집·보간/검증; MATLAB 편집기 연결 제외 | 미구현 |
| [17-023](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L660) | Signal Generator | 일반 표 | 기본 | `source.signal-generator` | 직접 | M2 | 명시 파형 allowlist·진폭/주파수/위상 | 미구현 |
| [17-024](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L661) | Sine Wave | 일반 표 | 기본 | `source.sine-wave` | 직접 | M2 | simulation time/sample 기반 waveform source; 외부 t 입력 Sine Wave Function과 시간 바인딩 구분, 수학 kernel 공유; 실제 지원: absolute time·frequency Hz·phase rad·amplitude/bias; 계약·fixture: m2-contract / m2-verification; M3 연속 stage 시각 지원: m3-contract / m3-verification | M2 승인 subset |
| [17-025](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L662) | Step | 일반 표 | 기본 | `source.step` | 직접 | M2 | step time의 정확한 event hit·전/후값; 실제 지원: absolute time·M2는 base grid 정렬; M3는 알려진 breakpoint 분할; discrete 전용; 계약·fixture: m2-contract / m2-verification; M3 연속 stage 시각 지원: m3-contract / m3-verification | M2 승인 subset |
| [17-026](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L663) | Uniform Random Number | 일반 표 | 기본 | `source.random` | 구성 | M2 | seeded uniform distribution preset; 범위/seed 명세; 실제 지원: 노드별 LCG32 seed0..2^32-1·uniform 또는 two-draw normal; MATLAB 난수열 동등성 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |
| [17-027](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) (L664) | Waveform Generator | 일반 표 | 기본 · 최초 도입 버전 미확정 | `source.waveform` | 독립 대체 | M4 | web waveform/scenario 합성; 원본 지원 언어 전체/툴 연동 보장 제외 | 미구현 |

### 18. String

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [18-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L680) | ASCII to String | 일반 표 | 기본 | `string.ascii-to-string` | 직접 | M4 | 길이/출력 상한·CalcWeave UTF-8/Unicode 계약; 원본 ASCII/char indexing 차이 명시 | 미구현 |
| [18-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L681) | Compose String | 일반 표 | 기본 | `string.compose` | 직접 | M4 | 허용 formatter·field 수/폭/출력 길이 상한 | 미구현 |
| [18-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L682) | Scan String | 일반 표 | 기본 | `string.scan` | 직접 | M4 | 허용 parser format·출력 schema·작업량 상한; 무제한 regex 제외 | 미구현 |
| [18-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L683) | String Compare | 일반 표 | 기본 | `string.string-compare` | 직접 | M4 | 길이/출력 상한·CalcWeave UTF-8/Unicode 계약; 원본 ASCII/char indexing 차이 명시 | 미구현 |
| [18-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L684) | String Concatenate | 일반 표 | 기본 | `string.string-concatenate` | 직접 | M4 | 길이/출력 상한·CalcWeave UTF-8/Unicode 계약; 원본 ASCII/char indexing 차이 명시 | 미구현 |
| [18-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L685) | String Constant | 일반 표 | 기본 | `source.string-constant` | 직접 | M4 | 문자열 상수와 길이 상한; HTML 렌더링 없음 | 미구현 |
| [18-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L686) | String Contains | 일반 표 | R2020a+ | `string.string-contains` | 직접 | M4 | 길이/출력 상한·CalcWeave UTF-8/Unicode 계약; 원본 ASCII/char indexing 차이 명시 | 미구현 |
| [18-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L687) | String Count | 일반 표 | R2020a+ | `string.string-count` | 직접 | M4 | 길이/출력 상한·CalcWeave UTF-8/Unicode 계약; 원본 ASCII/char indexing 차이 명시 | 미구현 |
| [18-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L688) | String Find | 일반 표 | 기본 | `string.string-find` | 직접 | M4 | 길이/출력 상한·CalcWeave UTF-8/Unicode 계약; 원본 ASCII/char indexing 차이 명시 | 미구현 |
| [18-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L689) | String Length | 일반 표 | 기본 | `string.string-length` | 직접 | M4 | 길이/출력 상한·CalcWeave UTF-8/Unicode 계약; 원본 ASCII/char indexing 차이 명시 | 미구현 |
| [18-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L690) | String to ASCII | 일반 표 | 기본 | `string.string-to-ascii` | 직접 | M4 | 길이/출력 상한·CalcWeave UTF-8/Unicode 계약; 원본 ASCII/char indexing 차이 명시 | 미구현 |
| [18-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L691) | String to Double | 일반 표 | 기본 | `string.parse-number` | 구성 | M4 | allowlist numeric parser·유효 입력 전체 소비·오류 규칙 | 미구현 |
| [18-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L692) | String to Enum | 일반 표 | 기본 | `string.parse-enum` | 직접 | M4 | 선언한 enum allowlist만 허용 | 미구현 |
| [18-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L693) | String to Single | 일반 표 | 기본 | `string.parse-number` | 구성 | M5 | allowlist numeric parser + float32 저장/rounding 시점 계약; 전체 single 연산 의미와 구분 | 미구현 |
| [18-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L694) | Substring | 일반 표 | 기본 | `string.substring` | 직접 | M4 | 0-based Unicode indexing 단위를 명시; bounds/길이 검사 | 미구현 |
| [18-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-18) (L695) | To String | 일반 표 | 기본 | `string.to-string` | 직접 | M4 | 길이/출력 상한·CalcWeave UTF-8/Unicode 계약; 원본 ASCII/char indexing 차이 명시 | 미구현 |

### 19. User-Defined Functions

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [19-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L711) | C Caller | 일반 표 | 기본 · 호출할 C 코드 및 지원 컴파일러가 별도로 필요할 수 있음 | `adapter.native-code` | 미지원·adapter 연구 | M7 | C/C++ 컴파일러/ABI·WASM plugin 연구; 임의 native 코드나 MathWorks builder 실행 제외 | 미구현 |
| [19-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L712) | C Function | 일반 표 | R2020a+ · 사용자 C 코드/컴파일러 조건 | `adapter.native-code` | 미지원·adapter 연구 | M7 | C/C++ 컴파일러/ABI·WASM plugin 연구; 임의 native 코드나 MathWorks builder 실행 제외 | 미구현 |
| [19-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L713) | Fcn | 일반 표 | 기본 | `math.expression` | 독립 대체 | M1 | 순수 수식 allowlist AST·resource budget; MATLAB 문법 전체나 eval/new Function 제외; 실제 지원: M1 x/pi/e·허용 함수 AST, 512자/128노드/32깊이; MATLAB 문법·코드 실행 제외 | M1 AST 독립 대체 subset |
| [19-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L714) | Function Caller | 일반 표 | 기본 | `functions.call` | 직접 | M5 | typed CalcWeave function 호출·bounded recursion 또는 금지 | 미구현 |
| [19-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L715) | Initialize Function | 일반 표 | 기본 | `functions.lifecycle` | 구성 | M5 | 승인된 모델 액션 init/reinit/reset/terminate hook; arbitrary host code 제외 | 미구현 |
| [19-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L716) | Interpreted MATLAB Function | 일반 표 | 레거시 · R2024b 문서에 제거 예정으로 표시. 신규 모델의 기본 선택에서 제외 | `adapter.matlab-legacy` | 미지원·adapter 연구 | M7 | legacy 해석 기록; MATLAB interpreter 미포함, AST/typed function으로 수동 변환 | 미구현 |
| [19-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L717) | Level-2 MATLAB S-Function | 일반 표 | 기본 | `adapter.matlab-s-function` | 미지원·adapter 연구 | M7 | MATLAB callback lifecycle를 브라우저에서 자동 재현하지 않음; 수동 porting 조사 | 미구현 |
| [19-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L718) | MATLAB Function | 일반 표 | 기본 · 이 블록 자체를 Stateflow Chart와 혼동하지 않음 | `functions.typed` | 독립 대체 | M5 | typed CalcWeave expression/function 구성; MATLAB language/runtime·Stateflow 호환 제외 | 미구현 |
| [19-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L719) | MATLAB System | 일반 표 | 조건 · 사용하는 System object 자체가 별도 툴박스에 속하면 해당 제품 필요 | `adapter.system-object` | 미지원·adapter 연구 | M7 | 외부 System object/툴박스 dependency는 명시 adapter 연구·별도 라이선스 확인 | 미구현 |
| [19-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L720) | Reinitialize Function | 일반 표 | R2022a+ | `functions.lifecycle` | 구성 | M5 | 승인된 모델 액션 init/reinit/reset/terminate hook; arbitrary host code 제외 | 미구현 |
| [19-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L721) | Reset Function | 일반 표 | 기본 | `functions.lifecycle` | 구성 | M5 | 승인된 모델 액션 init/reinit/reset/terminate hook; arbitrary host code 제외 | 미구현 |
| [19-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L722) | S-Function | 일반 표 | 기본 | `adapter.s-function` | 미지원·adapter 연구 | M7 | native/MATLAB S-function callback/ABI 계약과 라이선스 검토; 자동 실행 제외 | 미구현 |
| [19-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L723) | S-Function Builder | 일반 표 | 기본 · 외부 컴파일러 및 사용자 코드 조건 | `adapter.native-code` | 미지원·adapter 연구 | M7 | C/C++ 컴파일러/ABI·WASM plugin 연구; 임의 native 코드나 MathWorks builder 실행 제외 | 미구현 |
| [19-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L724) | Simulink Function | 일반 표 | 기본 | `functions.typed` | 독립 대체 | M5 | CalcWeave typed reusable callable graph; Simulink 함수 식별/실행 ABI 호환 제외 | 미구현 |
| [19-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) (L725) | Terminate Function | 일반 표 | 기본 | `functions.lifecycle` | 구성 | M5 | 승인된 모델 액션 init/reinit/reset/terminate hook; arbitrary host code 제외 | 미구현 |

### 20. Additional Math & Discrete

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [20-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) (L745) | Fixed-Point State-Space | Additional Discrete | 기본/조건 · 기본 double 설정 가능. 고정소수점 실행은 별도 제품 조건 | `discrete.state-space` | 구성 | M5 | double state-space subset M2; word length/scale/overflow/rounding은 fixed-point M5 gate | 미구현 |
| [20-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) (L746) | Transfer Fcn Direct Form II | Additional Discrete | 기본 | `discrete.filter` | 구성 | M2 | Direct Form II realization preset·state 초기화 | 미구현 |
| [20-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) (L747) | Transfer Fcn Direct Form II Time Varying | Additional Discrete | 기본 | `discrete.filter-time-varying` | 직접 | M5 | 시점별 coefficient update·shape 불변·state 동작 명세 | 미구현 |
| [20-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) (L755) | Decrement Real World | Additional Math / Increment - Decrement | 기본 | `math.increment` | 구성 | M1 | 실제 수치 +1/-1 preset; scaled fixed-point 의미는 M5 | 미구현 |
| [20-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) (L756) | Decrement Stored Integer | Additional Math / Increment - Decrement | 조건 · 저장 정수값/스케일링 의미 및 고정소수점 조건 확인 | `fixed.integer-increment` | 구성 | M5 | stored integer ±1·scale·overflow·word length 계약 | 미구현 |
| [20-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) (L757) | Decrement Time To Zero | Additional Math / Increment - Decrement | 기본 | `time.decrement-to-zero` | 직접 | M2 | sample time 기반 감소·0 clipping 계약 | 미구현 |
| [20-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) (L758) | Decrement To Zero | Additional Math / Increment - Decrement | 기본 | `math.increment` | 구성 | M1 | -1 후 0 clipping preset | 미구현 |
| [20-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) (L759) | Increment Real World | Additional Math / Increment - Decrement | 기본 | `math.increment` | 구성 | M1 | 실제 수치 +1/-1 preset; scaled fixed-point 의미는 M5 | 미구현 |
| [20-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) (L760) | Increment Stored Integer | Additional Math / Increment - Decrement | 조건 · 저장 정수값/스케일링 의미 및 고정소수점 조건 확인 | `fixed.integer-increment` | 구성 | M5 | stored integer ±1·scale·overflow·word length 계약 | 미구현 |

### 21. Quick Insert

| ID·원문 위치 | 원본 블록명 | 원본 하위 문맥 | 원본 구버전·사용 조건 | canonical capability 후보 | 계획 지원 | 예정 | 검증/경계 | 구현 상태 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [21-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L778) | Eulers Number | Sources — Constant의 사전 구성 | 구성 · Constant 값 `exp(1)` | `source.constant` | 구성 | M1 | 상수 preset e; JSON은 nonfinite 값을 tagged value로 직렬화 | 미구현 |
| [21-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L779) | Inf | Sources — Constant의 사전 구성 | 구성 · Constant 값 `inf` | `source.constant` | 구성 | M1 | 상수 preset +Infinity; JSON은 nonfinite 값을 tagged value로 직렬화 | 미구현 |
| [21-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L780) | NaN | Sources — Constant의 사전 구성 | 구성 · Constant 값 `NaN` | `source.constant` | 구성 | M1 | 상수 preset NaN; JSON은 nonfinite 값을 tagged value로 직렬화 | 미구현 |
| [21-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L781) | Negative Inf | Sources — Constant의 사전 구성 | 구성 · Constant 값 `-inf` | `source.constant` | 구성 | M1 | 상수 preset -Infinity; JSON은 nonfinite 값을 tagged value로 직렬화 | 미구현 |
| [21-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L782) | One | Sources — Constant의 사전 구성 | 구성 · Constant 값 `1` | `source.constant` | 구성 | M1 | 상수 preset 1; JSON은 nonfinite 값을 tagged value로 직렬화 | 미구현 |
| [21-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L783) | Pi | Sources — Constant의 사전 구성 | 구성 · Constant 값 `pi` | `source.constant` | 구성 | M1 | 상수 preset π; JSON은 nonfinite 값을 tagged value로 직렬화; 실제 지원: M1 고정 사전 설정만 제공; 원본 전체 옵션 동등성 제외 | M1 preset subset |
| [21-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L784) | Zero | Sources — Constant의 사전 구성 | 구성 · Constant 값 `0` | `source.constant` | 구성 | M1 | 상수 preset 0; JSON은 nonfinite 값을 tagged value로 직렬화; 실제 지원: M1 고정 사전 설정만 제공; 원본 전체 옵션 동등성 제외 | M1 preset subset |
| [21-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L792) | Square Root | Math Operations — Sqrt의 사전 구성 | 구성 · Sqrt와 이름만 다른 구성 | `math.sqrt` | 구성 | M1 | sqrt preset; 08절 Sqrt와 동일 capability | 미구현 |
| [21-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L793) | Signed Square Root | Math Operations — Sqrt의 사전 구성 | 구성 · Sqrt의 `signedSqrt`, Math Operations의 Signed Sqrt에 대응 | `math.sqrt` | 구성 | M1 | signed sqrt preset; 08절 Signed Sqrt 대응 | 미구현 |
| [21-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L794) | Reciprocal Square Root | Math Operations — Sqrt의 사전 구성 | 구성 · Sqrt의 `rSqrt`, Math Operations의 Reciprocal Sqrt에 대응 | `math.sqrt` | 구성 | M1 | reciprocal sqrt preset; 08절 Reciprocal Sqrt 대응 | 미구현 |
| [21-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L802) | Signal Copy | Signal Attributes — Signal Conversion의 사전 구성 | 구성 · Signal Conversion의 `Signal copy` | `signal.representation` | 구성 | M4 | signal copy preset; 14절 Signal Conversion 대응 | 미구현 |
| [21-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L803) | To Virtual Bus | Signal Attributes — Signal Conversion의 사전 구성 | 구성 · Signal Conversion의 `Virtual bus` | `signal.representation` | 구성 | M4 | virtual bus preset; 구조 표현/값 유지 계약 | 미구현 |
| [21-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L804) | To Nonvirtual Bus | Signal Attributes — Signal Conversion의 사전 구성 | 구성 · Signal Conversion의 `Nonvirtual bus` | `signal.representation` | 구성 | M4 | nonvirtual bus preset; 구조 표현/값 유지 계약 | 미구현 |
| [21-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) (L812) | Discrete State-Space | Discrete — 중복 접근 항목 | 중복 · 공식 문서에 Discrete와 Quick Insert / Discrete가 함께 기재됨 | `discrete.state-space` | 구성 | M2 | 05절 Discrete State-Space의 중복 검색/접근 항목; 실제 지원: 단위1 numeric scalar SISO·1..16 상태·A/B/C/D·initial·level reset; MIMO 제외; 계약·fixture: m2-contract / m2-verification | M2 승인 subset |

## 5. 385행 밖의 보조 항목

다음 항목은 원자료 22~25절을 놓치지 않기 위한 보조 결정이다. 이 표를 385행 또는 canonical 엔진 수에 더하지 않는다. 21절 파라미터 옵션 표 역시 새 독립 Quick Insert 항목으로 세지 않으며, 각 원본 capability의 allowlist/preset 계약에 기록한다.

| 원자료 | 보조 항목 | CalcWeave 처리 | 단계 |
| --- | --- | --- | --- |
| 22 | Action Port | hierarchy.action의 control token/내부 포트 계약 | M5 |
| 22 | Enable | 13절 Enable의 내부 사용 문맥; 별도 중복 엔진으로 세지 않음 | M5 |
| 22 | Trigger | 13절 Trigger의 내부 사용 문맥; discrete/continuous trigger 차이를 기록 | M5 |
| 22 | For Each | hierarchy.iteration의 분할 반복 계약 | M5 |
| 22 | For Iterator | hierarchy.iteration의 bounded for 계약 | M5 |
| 22 | While Iterator | hierarchy.iteration의 최대 반복/시간 예산 계약 | M5 |
| 22 | Reset | hierarchy.resettable의 reset control 계약 | M5 |
| 23 | Signal Builder | legacy 설명만 수용; web Signal Editor/dataset 수동 migration | M4 |
| 23 | Interpreted MATLAB Function | 19-006에 이미 포함; 중복 합산 금지 | M7 연구 |
| 23 | Environment Controller | Removed 항목은 신규 블록으로 구현하지 않음; variant 목적을 독립 재설계 | M5 |
| 23 | 구형 XY Graph 구현 | 16-011의 XY chart 목적만 수용; 구형 인터페이스 동일성 제외 | M4 |
| 24 | 구버전 규칙·설정 차이 | reference release·원본 링크·조건 보존; '기본'을 모든 구버전 보장으로 해석하지 않음 | M0 |
| 25 | 로컬 MATLAB inventory 추출 | 현재 MATLAB 설치/실행 검증은 미수행; 추출 결과가 있어도 라이선스/수치 동작 검증과 구분 | M0 |

## 6. 완료 판정과 유지 규칙

각 행을 실제 '지원'으로 전환하려면 원본행의 목표 기능, CalcWeave 파라미터 schema, 입력 type/shape, 단위, sample time, direct feedthrough, state/reset, 이벤트, 오류·오버플로, 실행 비용 상한, export target을 계약에 기록한다. 그다음 수학 해석해·독립 reference 결과·경계 fixture로 확인한다. 비교 환경이 없으면 'Simulink와 동일'로 표시하지 않는다.

수치 fixture는 정적 산술/행렬의 해석값, delay 초기화·multi-rate sample 순서, LTI step response, relay/limit/reset 경계, seeded randomness의 CalcWeave 재현성, 정수/fixed-point 오버플로, queue 순서·overflow, 계층 reset·실행 순서를 포함한다. 허용오차를 변경하거나 solver/registry/IR 버전을 올리면 관련 fixture와 TS export 결과를 다시 검증한다.

M4의 이동 가능한 모델 형식은 `*.cw.json`이며 데이터와 서브시스템 정의도 함께 보관한다. 실행 묶음 ZIP은 모델·독립 TS·manifest·README를 담고 데이터/계층 reference와 실행 hash를 검증한다. 전용 `*.cwpack`, MAT/XLSX/SLX와 외부 환경 자동 import는 구현하지 않았으며 원본 To File/From File의 전체 파일 형식 동등성으로 표시하지 않는다.

진행 중에는 원본행 별 상태를 미구현→사양 확정→구현→검증→지원으로 갱신한다. '구성' 행은 공유 엔진이 완성되었다는 이유만으로 자동 완료 처리하지 않고 preset/alias 설정 검증을 수행한다. 미지원 행은 검증된 adapter나 제품 범위 변경이 없으면 미지원 경계를 유지한다.

이 v0.1의 파일 대조 결과는 **원본 385행·추적표 385행·ID 중복 0·누락 0·원본명/조건 불일치 0**이다. 이 기록은 문서 계획의 완전성 검사이며 실제 엔진을 구현하거나 시뮬레이션한 결과가 아니다.

