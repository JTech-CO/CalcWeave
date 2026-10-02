# CalcWeave 수학·신호 블록 확장 조사와 구현 기록

- 작성일: 2026-10-03
- 버전: v0.3
- 성격: 확장 전 조사·후보65개와 실제 구현한 신규 수학64/시간파형6 카드의 별도 기록. 아래 명시 subset은 catalog 수치·독립 TS·JSON 증거를 통과했으며 원자료20행을 승격했다.
- 조사 기준: M7 baseline의 registry **74항목**, 원자료 **385행 / 영어 이름 문자열 339개**, 당시 coverage의 **미구현 271행**.
- 현재 정의: registry **144항목 = 기존74 + 신규 수학64 + 신규 시간파형6**. 독립 수치 엔진 수나 Simulink 완전 대응 수가 아니다.
- 검증: [catalog 수치 증거](evidence/catalog-verification.json)의 **71fixture / 원시559샘플 / 실제 생성 TS212개**, static·discrete·continuous 독립 strict typecheck, 원본 노드 위치를 보존하는 정의역 진단5개. 현재 원자료 **catalog 승인20행 / 미구현251행**.
- 구현 및 최종 승격 기록은 [block-coverage.md](block-coverage.md)와 실제 검증 evidence를 기준으로 갱신한다. 이 파일의 후보 숫자를 구현 완료 숫자로 옮겨 적지 않는다.

## 확장 방향과 숫자의 의미

사용자가 선택한 우선 범위는 **수학·신호 블록**이다. 현재 74항목에는 IO·결과·메타데이터·계층도 들어 있으므로 74를 독립 수치 solver 개수로 해석할 수 없다. 원자료의 385행에는 같은 블록의 바로가기·preset·일반/Customizable UI가 섞여 있어 두 숫자의 직접 비교도 완전한 지원률을 나타내지 않는다.

그럼에도 현재 Math Function은 exp/log/log10/square/reciprocal 5개, Trigonometric은 sin/cos/tan/asin/acos/atan 6개만 제공한다. 실수 함수·집계·벡터·행렬 구성·형상·범위 변환·기초 비트 변환을 보완할 여지가 크다. 설치형 프로그램·외부 서버·MATLAB 없이 현재 finite float64/boolean/vector/2D 데이터 계약으로 계산할 수 있는 후보를 먼저 선정했다.

아래에는 최초 조사에서 **계산 목적과 수식/shape가 분명한 신규 registry 후보 65개**를 기록했다. 당시 가정한 표시 registry 목표는74+65=139항목, P0 56개/P1 9개였다. 이후 구현 선택은 후보의 일부를 보류하고 정규화·컨볼루션·새 시간파형 등을 포함한 **수학64+시간파형6=70카드**로 확정되어 현재 정의 수가144다. 따라서 최초 후보65개 전부가 구현됐다고 표시하지 않는다. exp2·log2·hyperbolic 등은 서로 다른 수학 함수 카드지만 공유 unary dispatch를 재사용한다. 이 표의 '구현 묶음'은 수치 능력의 재사용 분류이며 독립 solver/엔진의 검증된 개수가 아니다.

별도로 Unary Minus→Gain(-1), Increment/Decrement→Bias(±1), Square Root 별칭→Sqrt, Matrix Square→Matrix Multiply(A,A), Ground/One/Pi→Constant 등의 빠른 삽입 구성은 검색성과 학습을 위해 제공할 수 있다. 이런 preset 추가는 **새 독립 계산 엔진 수에 합산하지 않는다**. 기존 exp/sin 같은 이미 구현된 함수를 별도 검색 카드로 노출해도 같은 원칙을 적용한다.

## 실제 선택된 70개 계산 카드

식별자는 [수학 정의64개](../packages/block-library/src/expansion.ts)와 [시간파형 정의6개](../packages/block-library/src/time-sources.ts)에 명시되어 있다. 표의 모든 ID는 이번 확장의 서로 다른 표시 계산 카드다. 공통 scalar/vector/2D map·binary broadcasting·집계·형상 복원·dispatch를 공유하며 별칭이나 기존 파라미터 preset을 신규70개에 넣지 않는다. 구현 단계의 registry 노출과 수치 승인 단계는 구분했다. [수학 fixture](../tests/block-expansion-fixtures.ts)·[시간파형 fixture](../tests/time-source-fixtures.ts)·[독립 검증 스크립트](../scripts/verify-catalog.ts)가 실제 평가와 export를 실행해 명시 subset의 증거를 만들었다.

| 실제 묶음 | 신규 카드 수 | 선택된 registry ID | 지원 경계 |
| --- | ---: | --- | --- |
| 실수 수학 | 20 | `math.bias`, `math.sign`, `math.cbrt`, `math.expm1`, `math.log1p`, `math.log2`, `math.exp2`, `math.sinh`, `math.cosh`, `math.tanh`, `math.asinh`, `math.acosh`, `math.atanh`, `math.sinc`, `math.polynomial`, `math.power`, `math.hypot`, `math.atan2`, `math.mod`, `math.remainder` | finite 실수 scalar/vector/2D; 초월함수/다항식/power는 단위1, atan2는 같은 입력 단위→rad; 각 함수의 정의역·비유한·0제수 검사 |
| 비선형·predicate | 5 | `nonlinear.dead-zone`, `nonlinear.quantizer`, `logic.interval`, `logic.is-integer`, `logic.approx-equal` | 고정 경계·q≥1e-12·ties-away-from-zero·닫힌 구간·절대오차 비교; boolean 출력·불연속 event 탐지 제외 |
| 전체 원소 집계 | 12 | `reduce.sum`, `reduce.product`, `reduce.mean`, `reduce.median`, `reduce.variance`, `reduce.std`, `reduce.rms`, `reduce.norm1`, `reduce.norm2`, `reduce.norm-inf`, `reduce.all`, `reduce.any` | scalar/vector/2D 전체 row-major 집계→scalar; variance/std는 population만; all/any는 boolean만; product 단위1; axis/ddof 옵션 제외 |
| 벡터 | 12 | `vector.dot`, `vector.cross`, `vector.normalize`, `vector.reverse`, `vector.sort`, `vector.cumsum`, `vector.cumprod`, `vector.difference`, `vector.select`, `vector.slice`, `vector.repeat`, `vector.convolve` | 1D·최대1,024원소; cross는길이3·normalize 영벡터 거부·difference는공간차분/길이≥2·고정0-based index·full convolution·출력크기 예산 |
| 행렬 | 12 | `matrix.trace`, `matrix.diagonal`, `matrix.diag-create`, `matrix.identity`, `matrix.select`, `matrix.row`, `matrix.column`, `matrix.horizontal`, `matrix.vertical`, `matrix.triangle`, `matrix.symmetrize`, `matrix.kronecker` | 2D·각축≤32; trace/symmetrize 정방 실수·대각/선택/concat/triangle은 동종boolean도 가능; 고정 index·입출력 축 검사·복사 |
| 배열 생성 | 3 | `source.linspace`, `source.logspace`, `source.zeros` | 고정 형상·vector≤1,024/2D각축≤32; count1은start(로그는10^start); declared unit·logspace exponent[-323,308]·overflow 검사 |
| 시간파형 | 6 | `source.chirp`, `source.gaussian-pulse`, `source.damped-sine`, `source.exponential`, `source.logistic`, `source.sinc-pulse` | 절대 실행 seconds·Hz/rad·유한 scalar·discrete due tick/continuous RK stage; host clock 없음·static 명시 거부 |
| 합계 | **70** | 수학64 + 시간파형6 | registry 총144와 원자료 승인행 수는 별도 |

수학64카드는 정적·이산·연속 값 평가와 독립 TypeScript 생성 대상으로 선택했다. 시간파형6카드는 이산·연속에 한정하며 정적 실행의 명시 거부를 검증한다. 신규70개는 Python 타깃 allowlist에 추가하지 않는다. Python 지원 표시가 있는 기존 카드와 새 TypeScript 전용 카드를 UI·manifest·export 진단에서 구분한다. 새 비선형과 구간 predicate의 연속 지원은 RK stage의 값 평가이며 해당 경계의 zero-crossing event 탐지와 경계 시각 정지 승인으로 확대하지 않는다. 시간에 따라 바뀌는 Sign/mod/remainder/Quantizer/predicate/boolean 집계가 직접 ODE 상태 입력으로 이어지면 compiler가 `UNREGISTERED_DISCONTINUITY`로 거부한다. 승인된 Zero Order Hold 이산 경계 또는 등록된 Step/Relay/Hit Crossing 사건이 필요하다. Dead Zone의 연속 piecewise 식과 Quantizer/Sign의 출력 불연속도 구분한다.

최초 후보 중 `math.exp10`, percentile/ddof, outer product, scalar expansion, assignment, permutation 전용 카드, symmetric/triangular predicate, matrix norm 옵션, squeeze, dynamic bounds, wrap-to-zero, friction, truth table, bit packing/extraction, width, prelookup interpolation, 외부 시간 입력 Sine Wave Function은 이번 신규70개에 포함하지 않았다. 아래 후보표의 가칭ID/옵션은 계획 기록이며 실제 API로 사용할 수 있는 ID는 위 표다. 공간/시간 sinc 두 카드는 수학식의 일부를 재사용하지만 외부 배열 입력과 실행 시각 바인딩의 입력 계약을 각각 유지한다.

## 원자료 승격과 수치 증거의 gate

[coverage 업데이트 스크립트](../scripts/update-catalog-coverage.ts)는 원자료 digest·385행·339개 이름 문자열·절별 행 수·원본 ID/이름/하위 문맥/조건/L번호를 검사한다. `--preflight`는 증거 없이 이 정합성과144 registry/신규64+6을 읽기 전용으로 확인한다. 실제 문서 변경은 고정 경로의 catalog-verification evidence에 있는 지원 모드별 oracle·독립 TS parity·JSON 왕복·finite error≤tolerance와 오류 진단이 통과한 뒤에만 수행한다. TypeScript/JSON parity 자체를 독립 수학 oracle로 오인하지 않는다.

승격한 원본은 **20행**이다: Dead Zone·Quantizer·Interval Test·Bias·Dot Product·Polynomial·Sign·원소 곱/합·대각 생성/추출·Cross Product·Identity·Matrix Concatenate 2개 분류 행·Submatrix·Index Vector·Selector·Chirp의 **19행**과 기존 Divide의 추적 누락 교정 **1행**이다. Divide는 이미 있던 `math.multiply(operation=divide)` 구성이므로 신규 registry 증분0이다. 행렬 가로/세로와 selector1D/2D는 각각의 증거를 확인했으며 같은 원본명의 분류 중복도 보존했다. source 대응은 float64 subset에 한정하고 별도 fixture가 있는 diag-create만 boolean으로 넓혔다. 승격 후 미구현은251행이다. 업데이트 dry-run·적용·check와385행 보존 검사를 모두 통과했다.

Math Function/Trigonometric Function은 기존 승인 상태를 유지하고 별도 신규 함수 ID를 추가 설명한다. 신규 표시카드70개와 source 승인20행, 원본 이름 문자열339개, 공유 kernel의 수는 모두 다른 수치다. 최초 후보65개에 들었던 source 항목도 검증된 실제 subset이 없으면 미구현을 유지한다.

수치 review에서 Quantizer의 큰 정수/절반 근접값, variance/std의 큰 공통 offset, mean/median/symmetrize의 최소 subnormal 상수 보존을 실제 oracle로 점검하고 회귀 검증을 추가했다. 초월함수는0/1 특수값뿐 아니라 LN2를 이용한 sinh=.75/cosh=1.25/tanh=.6 및 역함수 identity를 포함한다. 이런 확인은 명시 입력/자료형/예산 subset의 증거이며 arbitrary precision·모든 ill-conditioned 입력의 상대오차 보장을 뜻하지 않는다.

## 현재 코드에서 확인한 재사용 기반

| 기반 | 확인한 코드 | 확장에 주는 이점 |
| --- | --- | --- |
| registry 기반 라이브러리/설정 UI | [block-library](../packages/block-library/src/index.ts), [App](../apps/web/src/App.tsx) | 입력/출력/범위/enum/벡터 파라미터·검색·지원 모드가 이미 선언형이다. 새 계산 ID를 추가하면 목록과 설정창이 따라오도록 연결할 수 있음 |
| 공유 unary/binary evaluator | [kernels](../packages/runtime/src/kernels.ts) | finite validation, shape 복구, 요소별 계산·오류 위치를 재사용; 수식만 추가한 카드와 새 shape/상태 primitive를 구분하기 쉬움 |
| 행렬·보간 수치 함수 | [advanced-math](../packages/advanced-math/src/index.ts) | matrix multiply/transpose/LU/solve/Cholesky/2D lookup/prelookup 기반 존재. `selectMatrix`는 함수가 있으나 baseline registry에 노출되지 않았음 |
| compiler 경계 검증 | [compiler](../packages/compiler/src/index.ts), [advanced parameter 검사](../packages/compiler/src/advanced.ts) | 파라미터·shape·단위·direct feedthrough·portable model 경계 검사를 확장 대상으로 삼을 수 있음 |
| 이산/연속 실행과 export | [runtime](../packages/runtime/src/index.ts), [TS codegen](../packages/codegen-ts/src/index.ts), [Python capabilities](../packages/codegen-python/src/capabilities.ts) | stateless primitive를 static/discrete/continuous 공통으로 계산 가능. export는 각 target에서 구현한 ID만 허용해야 함 |
| 현재 값 계약 | [types](../packages/model/src/types.ts) | finite float64/boolean, vector/2D만 사용. 새 문자열/complex/n-D를 암묵 추가하지 않아도 아래 실수 후보를 구현 가능 |

행렬 축은 현재 고급 수치 함수의 상한(각 축 32, 1024원소)을 우선 재사용한다. vector 길이·정렬·truth table·출력 shape 역시 모델의 원소/작업량 상한을 넘지 않아야 한다. UI에 나타난다는 이유만으로 static·discrete·continuous·TS·Python 지원을 자동 선언하지 않는다.

## 원자료에서 바로 확장 가능한 묶음

| 원자료 분류 | 이번 수학·신호 확장에서 의미 있는 미구현 능력 | 다음 계약이 필요한 항목 |
| --- | --- | --- |
| 04 Discontinuities | Dead Zone·Dynamic bounds·Quantizer·Wrap To Zero·실수 마찰 식 | Backlash/Rate Limiter의 상태·event·초기화는 후속 단계 |
| 06 Logic/Bit | Interval Test, truth table, bit extraction/packing | signed/unsigned·폭·MSB/LSB 명시. Float Extract Bits·64bit는 별도 타입 계약 |
| 07 Lookup | Prelookup index/fraction을 입력받는 interpolation | n-D/동적 table은 rank·갱신 시점 계약; fixed-point Sine/Cosine은 float sin/cos와 구분 |
| 08 Math | Bias·Dot·Polynomial·reduce·Sign·수식 함수 옵션 | complex 변환/연산은 실제 complex 타입 도입 후. Algebraic Constraint는 solver gate |
| 09 Matrix | diagonal·identity·scalar expand·cross·select·permute·구조 검사·matrix concat | array/neighborhood/pixel subsystem은 반복과 경계 실행 계약 |
| 11 Verification | 범위/분해능 predicate와 Assertion을 이후 연결 가능 | '값 검사'와 Simulink Design Verifier의 형식 검증·시험 생성은 구분 |
| 14 Signal Attributes | Width, shape contract·Probe 등 계산 메타데이터 | cast·type propagation·scaling strip은 전체 numeric 타입 의미를 별도 검증 |
| 15 Routing | Selector/Submatrix·Index Vector·Multiport Switch | Goto/From은 compiler 바인딩, Data Store/State Writer는 state ordering 계약 |
| 17 Sources | 외부 시간 기반 파형 함수, chirp/waveform 확장 | Counter·noise는 sample state/seed/통계 계약. 외부 spreadsheet parsing은 파일 gate |
| 20 Additional | 실제값 증감 preset·direct-form filter 표현 | stored integer 증감은 scaled integer 의미가 있으므로 일반 +/-1 alias와 구분 |

원자료의 같은 이름과 분류별 중복은 coverage ID를 통해 추적한다. 특히 Source Sine Wave는 simulation time/sample 기반이고 Math Sine Wave Function은 외부 t 입력 구성이다. 수학 kernel은 공유할 수 있지만 시간 바인딩을 숨기지 않는다.

## 신규 계산 후보와 독립 기준값

P0는 현재 타입/shape를 유지하는 우선 계산군이다. P1은 동적 bounds·대입·가변 파라미터·table 검증 등 추가 연결 계약이 필요한 계산군이다. 후보 ID는 최종 registry API가 아니다. 'CalcWeave 추가'와 원자료의 옵션 확장은 원자료 385행에 새 행으로 더하지 않는다.

| 번호 | 후보 ID | 표시 기능 | 원자료 대응 | 구현 묶음 | 계산 로직/계약 | 독립 기준값 | 우선순위 |
| ---: | --- | --- | --- | --- | --- | --- | --- |
| 1 | `math.bias` | Bias | 08-005 | elementwise offset | x+b | 3,b=2 → 5 | P0 |
| 2 | `math.sign` | Sign | 08-026 | real unary | sign(x) | [-3,0,4] → [-1,0,1] | P0 |
| 3 | `math.polynomial` | Polynomial | 08-019 | Horner polynomial | a0*x^n+…+an | coeff [2,-3,1],x=2 → 3 | P0 |
| 4 | `math.power` | Power | 08 Math Function pow 옵션 | real binary | a^b | 2,3 → 8; -2,3 → -8; -2,.5 거부 | P0 |
| 5 | `math.hypot` | Hypotenuse | 08 Math Function hypot 옵션 | real binary | sqrt(a²+b²), scaling 사용 | 3,4 → 5 | P0 |
| 6 | `math.atan2` | Atan2 | 08 Trigonometric atan2 옵션 | real binary | atan2(y,x) | y=1,x=1 → π/4 | P0 |
| 7 | `math.mod` | Modulo | 08 Math Function mod 옵션 | division remainder | a-b*floor(a/b) | a=-5,b=3 → 1 | P0 |
| 8 | `math.remainder` | Remainder | 08 Math Function rem 옵션 | division remainder | a-b*trunc(a/b) | a=-5,b=3 → -2 | P0 |
| 9 | `math.cbrt` | Cube Root | CalcWeave 추가 | real unary | 실수 세제곱근 | -8 → -2 | P0 |
| 10 | `math.log2` | Log Base 2 | CalcWeave 추가 | real unary | log₂(x), x>0 | 8 → 3 | P0 |
| 11 | `math.log1p` | Log1p | CalcWeave 추가 | stable real unary | log(1+x), x>-1 | 0 → 0; x≤-1 거부 | P0 |
| 12 | `math.expm1` | Expm1 | CalcWeave 추가 | stable real unary | exp(x)-1 | 0 → 0 | P0 |
| 13 | `math.exp2` | Exp Base 2 | 08 Math Function 2^u 옵션 | real unary | 2^x | 3 → 8 | P0 |
| 14 | `math.exp10` | Exp Base 10 | 08 Math Function 10^u 옵션 | real unary | 10^x | 2 → 100 | P0 |
| 15 | `math.sinc` | Normalized Sinc | CalcWeave 추가 | real unary | sin(πx)/(πx), x=0→1 | 0 → 1; 1 → 0(오차 허용) | P0 |
| 16 | `math.sinh` | Sinh | 08 Trigonometric sinh 옵션 | hyperbolic unary | sinh(x) | 0 → 0 | P0 |
| 17 | `math.cosh` | Cosh | 08 Trigonometric cosh 옵션 | hyperbolic unary | cosh(x) | 0 → 1 | P0 |
| 18 | `math.tanh` | Tanh | 08 Trigonometric tanh 옵션 | hyperbolic unary | tanh(x) | 0 → 0 | P0 |
| 19 | `math.asinh` | Asinh | 08 Trigonometric asinh 옵션 | hyperbolic unary | asinh(x) | 0 → 0 | P0 |
| 20 | `math.acosh` | Acosh | 08 Trigonometric acosh 옵션 | hyperbolic unary | acosh(x),x≥1 | 1 → 0; .5 거부 | P0 |
| 21 | `math.atanh` | Atanh | 08 Trigonometric atanh 옵션 | hyperbolic unary | atanh(x),-1<x<1 | 0 → 0; ±1 거부 | P0 |
| 22 | `math.reduce-sum` | Sum of Elements | 08-034 | array reducer | Σx_i | [1,2,3] → 6 | P0 |
| 23 | `math.reduce-product` | Product of Elements | 08-021 | array reducer | Πx_i | [1,2,3] → 6 | P0 |
| 24 | `stats.mean` | Mean | CalcWeave 추가 | moments reducer | Σx_i/n | [1,2,3] → 2 | P0 |
| 25 | `stats.variance` | Variance | CalcWeave 추가 | moments reducer | Σ(x_i-mean)²/(n-ddof) | [1,2,3],ddof0 → 2/3; ddof1 → 1 | P0 |
| 26 | `stats.std` | Standard Deviation | CalcWeave 추가 | moments reducer | sqrt(variance) | [1,2,3],ddof1 → 1 | P0 |
| 27 | `stats.rms` | RMS | CalcWeave 추가 | norm reducer | sqrt(Σx_i²/n),scaling 사용 | [3,4] → sqrt(25/2) | P0 |
| 28 | `stats.median` | Median | CalcWeave 추가 | order statistics | 정렬 후 중앙값 | [4,1,3,2] → 2.5 | P0 |
| 29 | `stats.percentile` | Percentile | CalcWeave 추가 | order statistics | 정렬된 위치 (n-1)*p 선형 보간 | [0,10,20],p=.25 → 5 | P1 |
| 30 | `vector.norm` | Vector Norm | CalcWeave 추가 | norm reducer | L1/L2/L∞ | [3,4] → 7/5/4 | P0 |
| 31 | `math.dot` | Dot Product | 08-009 | vector binary | Σa_i*b_i | [1,2,3]·[4,5,6] → 32 | P0 |
| 32 | `matrix.cross` | Cross Product | 09-003 | vector binary | 3D cross | [1,0,0]×[0,1,0] → [0,0,1] | P0 |
| 33 | `matrix.outer-product` | Outer Product | CalcWeave 추가 | vector binary | a_i*b_j | [1,2],[3,4] → [[3,4],[6,8]] | P0 |
| 34 | `vector.cumulative-sum` | Cumulative Sum | CalcWeave 추가 | prefix scan | prefix Σ | [1,2,3] → [1,3,6] | P0 |
| 35 | `vector.cumulative-product` | Cumulative Product | CalcWeave 추가 | prefix scan | prefix Π | [1,2,3] → [1,2,6] | P0 |
| 36 | `vector.difference` | Vector Difference | CalcWeave 추가 | spatial vector transform | x[i+1]-x[i], 시간 차분과 구분 | [1,4,9] → [3,5] | P0 |
| 37 | `vector.reverse` | Reverse | CalcWeave 추가 | vector permutation | 역순 | [1,2,3] → [3,2,1] | P0 |
| 38 | `vector.sort` | Sort | CalcWeave 추가 | vector order | 수치 오름/내림차순 | [3,1,2] → [1,2,3] | P0 |
| 39 | `matrix.diagonal-create` | Create Diagonal Matrix | 09-002 | matrix constructor | vector→diagonal matrix | [2,3] → [[2,0],[0,3]] | P0 |
| 40 | `matrix.diagonal-extract` | Extract Diagonal | 09-005 | matrix extraction | diag(A) | [[1,2],[3,4]] → [1,4] | P0 |
| 41 | `matrix.identity` | Identity Matrix | 09-007 | matrix constructor | I_n | n2 → [[1,0],[0,1]] | P0 |
| 42 | `matrix.expand-scalar` | Expand Scalar | 09-004 | matrix constructor | scalar→explicit shape | 2,shape[2,2] → [[2,2],[2,2]] | P0 |
| 43 | `matrix.trace` | Trace | CalcWeave 추가 | matrix reducer | ΣA_ii | [[1,2],[3,4]] → 5 | P0 |
| 44 | `matrix.select` | Submatrix / Selector | 09-018,15-019 | matrix extraction | 명시 0-based row/column 선택 | [[1,2,3],[4,5,6]],r[0],c[0,2] → [[1,3]] | P0 |
| 45 | `matrix.assign` | Assignment | 08-004 | matrix update | 명시 index 위치의 불변 대입 | [[1,2],[3,4]],(0,1)=9 → [[1,9],[3,4]] | P1 |
| 46 | `matrix.permute` | Permute Matrix | 09-015 | matrix permutation | 행/열 permutation | [[1,2],[3,4]],r[1,0],c[0,1] → [[3,4],[1,2]] | P0 |
| 47 | `matrix.is-symmetric` | IsSymmetric | 09-009 | matrix predicate | abs(A-Aᵀ)≤tol | [[1,2],[2,3]] → true | P0 |
| 48 | `matrix.is-triangular` | IsTriangular | 09-010 | matrix predicate | upper/lower 외부 값≤tol | [[1,2],[0,3]],upper → true | P0 |
| 49 | `matrix.concatenate` | Matrix Concatenate | 08-014,09-011 | matrix concatenation | 같은 비결합축의 row/column concat | [[1,2]],[[3,4]],row → [[1,2],[3,4]] | P0 |
| 50 | `matrix.kronecker` | Kronecker Product | CalcWeave 추가 | matrix binary | a_ij*B 블럭 | [[1,2]],[[3],[4]] → [[3,6],[4,8]] | P1 |
| 51 | `matrix.norm` | Matrix Norm | CalcWeave 추가 | norm reducer | Frobenius/1/∞ | [[1,2],[3,4]] → sqrt30/6/7 | P0 |
| 52 | `matrix.squeeze` | Squeeze | 08-031 | shape transform | 길이 1 축 제거, 승인 vector/2D만 | [[1,2,3]] → [1,2,3] | P0 |
| 53 | `nonlinear.dead-zone` | Dead Zone | 04-003 | piecewise real | u<lo→u-lo,u>hi→u-hi,그 외0 | lo-1 hi1,[-2,0,3] → [-1,0,2] | P0 |
| 54 | `nonlinear.dead-zone-dynamic` | Dead Zone Dynamic | 04-004 | piecewise dynamic bounds | lo/hi 입력 포트 | u3,lo-1,hi1 → 2 | P1 |
| 55 | `nonlinear.saturation-dynamic` | Saturation Dynamic | 04-012 | piecewise dynamic bounds | min(upper,max(lower,u)) | u3,lo-1,hi1 → 1 | P1 |
| 56 | `nonlinear.quantizer` | Quantizer | 04-007 | quantization real | q*roundAway(u/q),q>0 | q.5,[-.75,-.25,.25,.75] → [-1,-.5,.5,1] | P0 |
| 57 | `nonlinear.wrap-to-zero` | Wrap To Zero | 04-014 | piecewise threshold | CalcWeave x>threshold→0; 그외x | threshold2,[1,2,3] → [1,2,0] | P0 |
| 58 | `nonlinear.friction` | Coulomb and Viscous Friction | 04-002 | piecewise real | sign(x)*(g*abs(x)+offset) | g2,offset1,[-2,0,3] → [-5,0,7] | P1 |
| 59 | `logic.interval-test` | Interval Test | 06-018 | numeric predicate | lo≤x≤hi/open 경계 선택 | bounds[0,1],[-1,0,2] → [false,true,false] | P0 |
| 60 | `logic.truth-table` | Combinatorial Logic | 06-005 | finite boolean table | MSB-first bits→table[index] | XOR table[F,T,T,F],input[T,F] → T | P1 |
| 61 | `logic.extract-bits` | Extract Bits | 06-015 | 32bit integer transform | (value >>> low)&widthMask | 0b110110,low1,width3 → 3 | P0 |
| 62 | `logic.bit-conversion` | Bit↔Integer | 06-003,06-017 | 32bit integer conversion | 선언 MSB/LSB bit vector 변환 | MSB [1,0,1,1] ↔ 11 | P1 |
| 63 | `signal.width` | Width | 14-014 | shape metadata calculation | input element count | [[1,2],[3,4]] → 4 | P0 |
| 64 | `lookup.interpolate-prelookup` | Interpolation Using Prelookup | 07-005 | piecewise table interpolation | v[i]+fraction*(v[i+1]-v[i]) | index0,fraction.25,values[10,30] → 15 | P1 |
| 65 | `math.sine-wave-function` | Sine Wave Function | 08-028 | external-time wave function | A*sin(2π*fHz*t+phase)+bias | A2,f.25,t1,phase0,bias1 → 3 | P0 |

위 기준값은 간단한 해석식·정수 연산·직접 행렬 계산으로 얻는 hand oracle이다. unary 초월함수의 0/1 특수값만 확인하고 완료 처리하지 않으며 일반값의 독립 reference·domain·overflow fixture를 더한다. 예를 들어 sinh(1)은 (e-e⁻¹)/2로, rms는 직접 제곱합으로, 표준편차는 ddof 정의로, matrix selection은 입력 표의 지정 위치로 독립 확인한다.

## 정확한 수식·경계에서 확인한 주의점

- JS의 Math는 log1p/expm1/cbrt/hypot와 hyperbolic 함수를 제공하므로 외부 수학 프로그램 없이 기본 실수 평가를 구현할 수 있다. 반환된 NaN/Infinity를 현재 finite 계약에서 승인하지 않으며 domain·overflow 진단을 남긴다. [MDN Math 참고](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math)
- Quantizer는 q·round(u/q) 수식이며 CalcWeave 후보는 q>0 실수로 제한한다. JavaScript Math.round의 음수 halfway 동작과 MATLAB의 rounding 계약을 혼동하지 않고, 후보는 ties-away-from-zero를 명시했다. 기존 fixed.quantize의 nearest-even/저장정수/overflow 처리와도 별도 기능이다. [MathWorks Quantizer](https://www.mathworks.com/help/simulink/slref/quantizer.html)
- Coulomb/Viscous Friction은 sign(x)·(gain·abs(x)+offset) 식으로 실수 stateless 평가할 수 있다. 상태 마찰·stiction이나 일반 물리 엔터티를 구현했다고 확대하지 않는다. [MathWorks Friction](https://www.mathworks.com/help/simulink/slref/coulombandviscousfriction.html)
- Wrap To Zero는 modulo가 아니다. 현행 공식 페이지의 본문은 x>threshold를, Ports 설명은 x≥threshold를 적어 경계 표현이 상충한다. CalcWeave 후보는 **x>threshold에서 0**으로 계약을 고정하고 x=threshold fixture를 둔다. 이에 관한 Simulink 완전 호환을 주장하지 않는다. [MathWorks Wrap To Zero](https://www.mathworks.com/help/simulink/slref/wraptozero.html)
- 분산의 ddof, quantile interpolation, norm 종류, 각도 단위, modulo와 remainder의 음수 처리, sinc의 normalized 정의, 0-based index, empty array, shape rank와 output size를 파라미터/계약에 드러낸다. sort/assignment는 입력 데이터를 mutate하지 않는다.
- variance/std는 overflow·catastrophic cancellation을 고려한 안정적 방법을 선택한다. norm/hypot/rms는 scaling이나 Math.hypot 계열을 사용해 중간 제곱 overflow를 줄인다. finite 결과 검사는 중간 overflow가 만든 잘못된 값을 정상으로 오인하는 면책이 아니다.
- piecewise 함수의 정적/이산 계산 검증과 연속 ODE의 crossing 탐지는 다른 증거다. static/discrete만 확인한 새 불연속 블록을 event 검증 없이 continuous에 동일하게 승인하지 않는다.

현행 MathWorks 페이지에는 R2026b가 표시될 수 있다. R2024b 원자료에 없는 최신 옵션을 이번 source coverage에 소급 추가하지 않는다.

## 확장 후 검증해야 할 연결

1. registry 정의·model schema allowlist·compiler shape/type/unit·작업량 산정·runtime dispatch를 같은 ID 기준으로 연결한다. arbitrary eval/new Function, 사용자 코드 실행, 외부 프로그램 호출을 추가하지 않는다.
2. scalar/vector/2D에서 지원되는 함수는 최소 scalar·array·shape 오류·domain·overflow를 확인한다. index·폭·크기·table 길이·입출력 원소 수에는 상한을 둔다. 일반 숫자 함수를 boolean 입력에 암묵 적용하지 않는다. 초기 초월함수·norm/statistics는 dimensionless subset으로 승인할 수 있으나 dot·분산·power 등의 물리 단위를 상속한다고 무조건 가정하지 않고 각 수식의 차원 대수나 명시 미지원 경계를 둔다.
3. static 값뿐 아니라 due tick에서 실행되는 stateless block과 RK stage에서 재평가되는 연속 조합을 확인한다. 상태를 가진 새 primitive는 output/read와 commit/write를 분리한다. vector difference는 초기 subset에서 입력 길이 2 이상으로 제한해 현재 shape 계약의 빈 vector 출력을 만들지 않는다. sort/percentile는 명시 numeric comparator와 복사본을 쓰고, 새 matrix constructor는 runtime 입력으로 차원을 몰래 바꾸지 않는다.
4. TS runtime template과 Python target implementation이 지원한 카드만 exportTargets에 올린다. 두 target이 같은 결과를 내더라도 독립 hand/reference oracle을 함께 검증한다.
5. UI 검색·파라미터 편집·작은 화면·generic symbol fallback·snapshot/stale 결과·undo/redo·복구/import 경로에서 실제 신규 ID를 사용한다.
6. coverage의 원본385행은 이름/조건/ID를 보존하며 검증한 subset만 승격한다. 예를 들어 dynamic saturation을 추가해도 scalar clipping만 확인했다면 전체 Simulink 자료형/solver 모드 지원으로 적지 않는다.
7. registry 항목 수, 새 표시 함수 수, preset 수, 공유 kernel 묶음 수, 실제 구현된 원본행 수를 각각 보고한다. 사용자는 '블록이 많다'와 '기능을 검증했다'를 함께 확인할 수 있어야 한다.

## 이번 확장과 분리할 범위

| 범위 | 현재의 정확한 경계 |
| --- | --- |
| MATLAB/C/C++/S-function/System object | JS/TS로 수학 목적을 직접 옮길 수는 있으나 원본 interpreter·compiler·ABI·툴박스 코드를 자동 실행하는 브라우저 런타임은 포함하지 않음 |
| 하드웨어/HDL·hard realtime | browser wall clock·thread scheduling으로 hardware deadline을 보장하지 않음. 권한·driver·adapter와 대상별 export가 별도 필요 |
| 메시지·조건부/반복 그래프 | bounded queue·If/For/While 자체 구현은 JS/TS에서 가능하지만 payload type·동시 event·state scope·iteration budget을 정의해야 함. 이번 '수학·신호부터' 범위와 분리하며 기술적으로 불가능하다고 표현하지 않음 |
| DAE/algebraic loop | 직접 피드백은 반복 수렴·잔차·초기값·불연속 제약이 필요. 일반 RK ODE로 임의 DAE를 실행하지 않음 |
| complex/float32/int64/fixed-point pipeline/n-D | 현재 SignalValue가 실수/boolean vector/2D인 사실과 구분. shape/type 계약과 export를 함께 확장하기 전 '전체 지원'으로 올리지 않음 |
| 문자열·외부 spreadsheet·MAT/SLX | parse 및 format·size·escape·권리 경계가 별도 필요. 이 조사에서 numeric block count를 채우는 재료로 사용하지 않음 |
| Dashboard/custom UI·서식·메타데이터 | 중요하지만 수학 engine 증분과 분리. 기존 generic viewer의 모양 variant를 추가해 독립 수치 기능 수로 세지 않음 |
