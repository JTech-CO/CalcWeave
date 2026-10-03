# CalcWeave M8 구현 계약

작성일: 2026-10-03 · 문서 v0.4 · 상태: 계획 및 옵션 검토 · 일정 미확정

M8의 최초 작업 배정은 원본 **107행**이며, 서로 다른 이름 문자열은 91개다. 이 중 baseline의 기존 subset은 61행, 미구현은 46행이다. 분류 family 62개는 작업 묶음이며 engine 수로 합산하지 않는다. 원자료 전체 기준 385행·339이름과 SHA-256 `cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7`를 보존한다.

현재 구현 초안은 41개 정의(신규 기능 정의 29개와 기존 옵션용 정의 12개) 및 8개 명명 preset이다. baseline 144개와 합하면 registry 정의 수는 185개다. 이 값은 독립 수학 kernel 수가 아니며, 107개 원본행을 모두 완전 대응했다는 뜻도 아니다. 수정 후120fixture+8preset·896raw samples·388actual TS programs와 최종1,746개 단위 검사가 통과했다. 신규46개 source행은35개 계산 subset·9개 preset subset·2개 독립 대체로 승인했으며, 전 옵션 완료는 열린 상태다. [최종 검증](m8-validation.md)과 [source 승인 근거](evidence/m8-source-approvals.json)를 따른다.

기계판독 정본은 [m8-implementation-map.json](./m8-implementation-map.json)이다. [전체 후속 로드맵](./05-simulink-coverage-roadmap.md)의 baseline 배정과 [기술 계약](./catalog-contract.md)은 이 문서의 snapshot 승인으로 변경하지 않는다. `baselineStatus`는 기존 승인, `delivery`는 검토된 최초 납품 범위, `optionInventory`는 추가 옵션 후보이며 `sourceOptionCompletionStatus=open`은 원본의 전체 옵션 완료가 아직 열린 상태다. 이번 M8 source 승격46행은 root의 실행 증거와 연결했으며 기존61행의 baseline 추적을 보존했다. deliveryGate는 verified-declared-scope이고, source 전체 옵션 상태는 open이다.

## 지원과 분류 규칙

- `new-primitive`: 새 계산·선택·상태 동작이 필요한 source 기능. 공유 수학 helper를 써도 새 표시 정의와 독립 kernel 수를 구분한다.
- `existing-options`: 이미 승인한 기능 또는 공유 primitive의 입력·축·설정·상태 확장. 신규 정의가 필요할 수도 있으나 과거 subset이 완전 지원이었다는 뜻은 아니다.
- `preset`: 상수·함수·선택 설정. 기존 helper의 수식이나 저장된 구성을 재사용하며 독립 engine으로 세지 않는다.
- `shared-new-primitive-config`: 하나의 신규 shared capability를 원본별 설정으로 추적한다.
- `bounded-independent-alternative` / `independent-alternative`: 입출력 또는 언어 계약이 원본과 다른 제한 대체. 원본 native 동등성으로 승격하지 않는다.

현재 finite float64/boolean 및 scalar/vector/2D에서 실현 가능한 추가 옵션은 **M8-followup의 열린 후보**로 보존한다. 검토된 최초 납품에 포함한 선언 mode/shape/options의 구현·검증이 이번 납품 gate이며, 아래 후보 전체를 최초 납품의 필수 blocker로 확대하지 않는다. 구현 난이도, 기존 UI 설정이 적다는 이유만으로 후보를 M10 이후로 옮기지도 않는다. 자료형·복소수·일반 n-D/variable-size 신호 계약(M10), 조건부 실행 문맥(M11), 새로운 ODE 사건면과 solver(M12), 외부 workspace/ABI/라이선스(M14), 타깃 실행 특성(M15)은 구체적인 의존을 남겨 후속으로 분리한다. 원본이 허용하지 않는 타입·형상까지 구현한다는 약속은 하지 않는다.

## 검토된 최초 납품 범위

이번 engineering 납품은 **41개 M8 정의·8개 명명 preset의 선언된 모든 mode/shape/options**, baseline 미구현 46행의 제한된 기능 대응, 선택된 기존 옵션 확장과 과거 144개 정의·71개 catalog fixture 회귀다. 107행 전체의 추적 결정은 유지하지만, firstWorkMilestone은 모든 원본 옵션 동시 완료를 뜻하지 않는다. 납품 gate는 독립 raw oracle·actual TS·JSON·진단·자원 예산·UI/e2e 증거로 판정한다. 전체 후보가 아직 open이어도 이 선언 범위의 engineering 납품은 통과할 수 있다.

아래 family 목록은 R2024b 확인 및 후속 구현 후보다. `optionInventoryTaskIds`는 후보 추적 ID이며 최초 납품 required ID가 아니다. 실제 source 승격과 evidence 연결은 root의 승인 표가 담당한다. Find Nonzero padded 출력, row-major scalar direct lookup, 허용된 고정 순열 등은 각각 독립 대체/제한 subset으로 기록한다. 원본 전체 동등성은 계속 false다.

## 공식 사양의 확인 범위

MathWorks의 현재 온라인 도움말을 primary source로 조사했다. R2024b archive에서 Find Nonzero, n-D Lookup, Weighted Sample Time, Wrap To Zero의 대소문자 release URL을 시도했으나 fetch cache-miss로 원문을 확인하지 못했다. 따라서 JSON의 `r2024bExactPageVerified`는 모두 false이고 전체 R2024b 파라미터 inventory 완료를 주장하지 않는다. `current-help-core-semantics-checked`는 핵심 설명을 읽었다는 뜻이며, `reference-link-option-review-pending`은 링크와 추가 검토 후보다. R2025a의 Assume input is within range나 R2026a의 HDL SynthesisAttributes처럼 버전이 명시된 신규 옵션을 R2024b 필수 옵션으로 자동 합산하지 않는다.

수학 oracle는 독립 계산의 정확도를 검증한다. 실제 Simulink reference model, 같은 solver·sample time·dtype·비영 초기상태 비교가 없는 상태에서 MathWorks 실행과 비트 동일성을 주장하지 않는다. 문서가 서로 충돌하는 옵션은 미확정으로 남긴다.

## 먼저 확정한 의미

| 항목 | M8 계산/원본 의미 | 실제 초안 및 남은 gate |
| --- | --- | --- |
| Find Nonzero 08-010 | 공식 출력은 가변 길이; 기본 zero-based, first-axis-fastest 선형 index, subscripts/values 옵션 | 입력 원소수 폭의 padded indices/rows/columns와 count는 CalcWeave 독립 대체. sentinel은 zero-base −1, one-base 0. values 포트와 native empty/variable-size는 미완료. [공식](https://www.mathworks.com/help/simulink/slref/findnonzeroelements.html) |
| Real World ±1 / To Zero | state 없는 u+1, u−1, max(u−1,0); stored-integer 연산과 다름 | float64 설정 preset; typed overflow wrap은 M10. [공식](https://www.mathworks.com/help/simulink/slref/decrementrealworld.html), [To Zero](https://www.mathworks.com/help/simulink/slref/decrementtozero.html) |
| Dead Zone / Saturation Dynamic | lower/u/upper를 같은 계산 시점에 읽고 equality를 포함 | lo>up 오류·scalar expansion·배열 bounds fixture 필수. [Dead Zone](https://www.mathworks.com/help/simulink/slref/deadzonedynamic.html), [Saturation](https://www.mathworks.com/help/simulink/slref/saturationdynamic.html) |
| Friction 04-002 | sign(u)·(gain·abs(u)+offset), 0→0; scalar input은 parameter shape로 확장 가능 | 현재 scalar 비음수 계수만. 공식 real 계수·배열 경로는 M8 open. [공식](https://www.mathworks.com/help/simulink/slref/coulombandviscousfriction.html) |
| Wrap To Zero 04-014 | threshold 초과를 0으로 만드는 선택, modulo 아님 | 공식 Description의 strict >와 Ports의 >=가 충돌. comparator gt/ge를 명시하며 reference equality 미확정. [공식](https://www.mathworks.com/help/simulink/slref/wraptozero.html) |
| n-D Lookup 07-009 | rank>2 parameter table도 scalar query→scalar output 가능 | rank≤10·각축≤32·table/corners≤1024의 scalar-query subset. 일반 n-D SignalValue와 별개. spline/query-array/dynamic parameter 옵션은 해당 계산 가능한 부분 M8 open. [공식](https://www.mathworks.com/help/simulink/slref/ndlookuptable.html) |
| Direct n-D Lookup 07-004 | 공식 기본은 zero-based·column-major·element/vector/2D slice | 현재 row-major flat table→scalar. layout/slice 미완료를 일반 n-D signal의 M10로 숨기지 않는다. [공식](https://www.mathworks.com/help/simulink/slref/directlookuptablend.html) |
| Matrix Square 09-013 | real 입력 A에 AᵀA, M×N→N×N | elementwise A² 또는 A·A와 구분. baseline canonical은 보존하고 matrix.square로 추적. [공식](https://www.mathworks.com/help/simulink/slref/matrixsquare.html) |
| Expand Scalar 09-004 | no-input source, ElementValue와 OutputDimensions parameter | input-driven repeat와 구분; bool 값은 현재 open, struct/bus는 M11. [공식](https://www.mathworks.com/help/simulink/slref/expandscalar.html) |
| Squeeze 08-031 | rank>2에서만 singleton 제거; rank≤2 그대로 통과 | 현재 identity subset. [[1,2]]를 [1,2]로 flatten하면 별도 대체. [공식](https://www.mathworks.com/help/simulink/slref/squeeze.html) |
| IsSymmetric / IsTriangular | symmetric/skew, upper/lower를 scalar boolean으로 검사 | skew mode open; tolerance/either는 독립 확장. PSD 검사가 아니다. [Symmetric](https://www.mathworks.com/help/simulink/slref/issymmetric.html), [Triangular](https://www.mathworks.com/help/simulink/slref/istriangular.html) |
| Sine Wave Function 08-028 | 외부 t의 A·sin(ωt+phase)+bias, Frequency rad/sec | 기존 Sources frequency Hz와 구분; sample-based k counter는 M9 연결. [공식](https://www.mathworks.com/help/simulink/slref/sinewavefunction.html) |
| Index Vector 15-011 | 외부 scalar control로 vector 원소 선택, 기본 zero-base, fractional control은 toward-zero truncation | 현재 dynamic selector는 정수만. truncate/default 경로는 M8 open. [공식](https://www.mathworks.com/help/simulink/slref/indexvector.html) |
| Permute Matrix 09-015 | A/P 입력·row 또는 column gather, 반복/생략 가능 | 고정 완전 순열만인 초안은 subset. dynamic P·clip/warn/error는 M8 open. [공식](https://www.mathworks.com/help/simulink/slref/permutematrix.html) |

기존 61행의 우선 확장은 Gain의 행렬 모드, Sum/Product의 N개 입력과 부호·행렬 나눗셈, Logic의 다중 입력 및 numeric truth, Switch threshold/elementwise control, Mux/Demux/Concatenate의 가변 포트·폭·축, 동적 Selector, column-major Reshape, 축별 reduction, lookup extrapolation과 endpoint 규칙이다. 새 12개 옵션 정의는 이 중 구현한 경로이며 전 옵션 완료 표시는 아니다.

## 작업 family와 추가 옵션 inventory

### m8-constant · 상수와 명명된 설정

원본 ID: 01-003, 01-009, 17-004, 17-012, 21-001, 21-005, 21-006, 21-007 · 분류: `existing-options`

- `m8-constant-01`: float64/boolean scalar·vector·2D 값 및 row/column/1D 해석 설정 보존
- `m8-constant-02`: Ground/Zero=0, One=1, Pi=Math.PI, Eulers Number=Math.E의 검증 가능한 구성 preset; 자체 새 수치 kernel로 합산 금지

연결 후보: `source.constant`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-gain · 원소별·행렬 Gain

원본 ID: 01-008, 08-011 · 분류: `existing-options`

- `m8-gain-01`: gain parameter scalar/vector/2D와 element-wise scalar expansion
- `m8-gain-02`: K*u, u*K, K*u with 1D vector 해석; 내적 차원·단위·출력형상 추론, 지원되는 transpose 형태
- `m8-gain-03`: 기존 scalar gain JSON의 의미 보존

연결 후보: `math.gain`, `math.gain-matrix`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-sum · 가변 포트 덧셈·뺄셈

원본 ID: 01-020, 08-002, 08-032, 08-033 · 분류: `existing-options`

- `m8-sum-01`: 가변 입력 개수·포트별 +/− 부호, Add/Subtract 기본 구성
- `m8-sum-02`: single-input 합산 및 rank≤2 all/row/column 축별 reduction; scalar expansion/형상 검사
- `m8-sum-03`: row-major 기존 모델을 변경하지 않는 column-major 관련 shape 설정

연결 후보: `math.sum`, `reduce.sum`, `math.sum-inputs`, `reduce.axis`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-product · 원소별·행렬 곱과 나눗셈

원본 ID: 01-015, 08-008, 08-020, 09-017 · 분류: `existing-options`

- `m8-product-01`: 가변 포트·각 */ 연산 및 single-input product/axis reduction
- `m8-product-02`: element-wise 또는 matrix multiplication/division·벡터 해석; singular matrix·zero divisor 명시 진단
- `m8-product-03`: Divide는 기존 operation=divide 구성 및 행렬 나눗셈을 별도 설정으로 추적

연결 후보: `math.multiply`, `math.product-inputs`, `reduce.axis`, `math.matrix-multiply`. matrix mode는 순서 *만; matrix / open
### m8-demux · 벡터 분할

원본 ID: 01-006, 15-007 · 분류: `existing-options`

- `m8-demux-01`: 출력 개수 또는 각 출력 폭으로 지정; scalar/vector 출력 형상
- `m8-demux-02`: 출력 폭 합=입력 길이, 자동폭 추론 및 부정확한 폭 진단; 각 출력 port TS/JSON 보존

연결 후보: `route.demux`, `route.demux-widths`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-mux · 가변 포트 묶기

원본 ID: 01-013, 15-017 · 분류: `existing-options`

- `m8-mux-01`: 가변 입력 개수·scalar/vector 및 동일 boolean/f64 타입·단위
- `m8-mux-02`: 1D virtual-vector 묶기의 실제 순서, 입력 폭 합·자원 한도 검증; 일반 heterogeneous bus는 M11

연결 후보: `route.mux`, `route.mux-inputs`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-vector-concat · 벡터 연결

원본 ID: 01-023, 08-037, 15-027 · 분류: `existing-options`

- `m8-vector-concat-01`: 가변 포트수·입력순서 보존·scalar/vector 연결
- `m8-vector-concat-02`: 행/열 형상 및 concat dimension 설정을 2D matrix concat과 연결하되 Mux와 UI 의미 구분

연결 후보: `math.concatenate`, `math.concatenate-inputs`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-relational · 비교와 고정값 설정

원본 ID: 01-016, 06-006, 06-007, 06-021 · 분류: `existing-options`

- `m8-relational-01`: eq/ne/lt/le/gt/ge 및 실수 scalar expansion·vector·2D; 지원 boolean 비교
- `m8-relational-02`: Constant/Zero 비교는 두 번째 입력의 검증된 고정 parameter preset 또는 내부 constant 구성
- `m8-relational-03`: 복소수 ordering은 M10에서도 정의되지 않은 연산을 진단

연결 후보: `logic.compare`, `logic.compare-constant`. constant scalar/operator6개,기존compare f64. parameter arrays/boolean policy open
### m8-boolean · 다중 입력 논리

원본 ID: 01-012, 06-020 · 분류: `existing-options`

- `m8-boolean-01`: AND/OR/NAND/NOR/XOR/NXOR/NOT·가변 포트·single-input reduction
- `m8-boolean-02`: boolean 및 실수 zero/nonzero truth 변환, scalar expansion·2D, 출력 boolean 계약
- `m8-boolean-03`: NOT는 단일 입력, XOR/NXOR는 parity; 항등 및 부호 있는 0 검사

연결 후보: `logic.boolean`, `logic.combine`, `reduce.axis`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-switch · 숫자·boolean 제어 선택

원본 ID: 01-021, 15-022 · 분류: `existing-options`

- `m8-switch-01`: u2>=Threshold/u2>Threshold/u2~=0 기준 및 boolean condition
- `m8-switch-02`: scalar/vector/2D control과 data shape·scalar expansion; 조건별 같은 dtype/단위
- `m8-switch-03`: Threshold equality fixture와 NaN/Inf 비지원 진단

연결 후보: `route.switch`, `route.switch-threshold`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-saturation · 정적·동적 포화

원본 ID: 01-017, 04-011, 04-012 · 분류: `existing-options`

- `m8-saturation-01`: 정적 lower/upper scalar·vector·2D parameter 및 scalar expansion
- `m8-saturation-02`: 동적 lo/u/up 입력; lo<=up 검증·equality 포함·입력형상 검사
- `m8-saturation-03`: M8 static/discrete 및 held 경로의 continuous 실행; ODE에 직접 들어가는 새 사건면은 M12 별도

연결 후보: `nonlinear.saturation`, `nonlinear.saturation-dynamic`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요

핵심 확인: [MathWorks saturationdynamic](https://www.mathworks.com/help/simulink/slref/saturationdynamic.html). R2024b exact version은 미확정.
### m8-dead-zone · 정적·동적 불감대

원본 ID: 04-003, 04-004 · 분류: `existing-options`

- `m8-dead-zone-01`: 정적 start/end 및 동적 lo/u/up 입력·scalar expansion
- `m8-dead-zone-02`: u<lo면u−lo, lo<=u<=up면0, u>up면u−up; 역전된 경계는 명시 진단
- `m8-dead-zone-03`: 동적 포트를 추가해도 같은 수치 kernel 공유; 단순 clipping과 구분

연결 후보: `nonlinear.dead-zone`, `nonlinear.dead-zone-dynamic`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요

핵심 확인: [MathWorks deadzonedynamic](https://www.mathworks.com/help/simulink/slref/deadzonedynamic.html). R2024b exact version은 미확정.
### m8-friction · 쿨롱·점성 마찰 수식

원본 ID: 04-002 · 분류: `new-primitive`

- `m8-friction-01`: sign(u)*(gain*abs(u)+offset), 0에서 출력0; memory 없는 순수 수식
- `m8-friction-02`: gain/offset scalar·vector·2D parameter 및 scalar input→parameter shape expansion
- `m8-friction-03`: 실수 finite 정의역, overflow·shape 실패 원본 node 진단

연결 후보: `nonlinear.friction`. gain/offset scalar·nonnegative only; 공식 real parameter arrays/scalar expansion은 open

현재 API의 gain/offset 비음수 scalar 제한은 observed subset; 공식은 real-valued parameter를 허용하므로 음수 및 배열 경로는 M8 open으로 기록

핵심 확인: [MathWorks coulombandviscousfriction](https://www.mathworks.com/help/simulink/slref/coulombandviscousfriction.html). R2024b exact version은 미확정.
### m8-wrap-zero · 임계값을 넘으면 0

원본 ID: 04-014 · 분류: `new-primitive`

- `m8-wrap-zero-01`: modulo wrap이 아닌 threshold 비교 후 원래 값/0 선택
- `m8-wrap-zero-02`: 비교 strict> 및 inclusive>=를 명시 설정하고 equality fixture로 구분
- `m8-wrap-zero-03`: 공식 문서 본문/Ports의 equality 충돌 해소 전 native exact-boundary 승인 금지

연결 후보: `nonlinear.wrap-to-zero`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요

현재 official Description은 >, Ports는 >=로 충돌; R2024b 실제 reference equality oracle 미확정

핵심 확인: [MathWorks wraptozero](https://www.mathworks.com/help/simulink/slref/wraptozero.html). R2024b exact version은 미확정.
### m8-quantizer · 양자화 간격

원본 ID: 04-007 · 분류: `existing-options`

- `m8-quantizer-01`: q>0 설정과 scalar/vector 입력 형상; 공식 quantization-interval parameter 형태 추가검증
- `m8-quantizer-02`: q*round(u/q), tie-away 결과·큰 정수의 변형 없는 nearest 계산·underflow/overflow
- `m8-quantizer-03`: 고정소수점 dtype 변환과 별개인 float64 계산

연결 후보: `nonlinear.quantizer`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요

핵심 확인: [MathWorks quantizer](https://www.mathworks.com/help/simulink/slref/quantizer.html). R2024b exact version은 미확정.
### m8-truth-table · 진리표

원본 ID: 06-005 · 분류: `new-primitive`

- `m8-truth-table-01`: 입력 boolean/zero-nonzero vector→MSB/LSB 규약 명시한 truth-table 행 선택
- `m8-truth-table-02`: 2^inputWidth 행·복수 boolean 출력·2D truth table parameter; table size 예산 검사
- `m8-truth-table-03`: 입력 bit 순서 및 모든 조합 oracle

연결 후보: `logic.truth-table`. width1..8 boolean vector·boolean table·첫bit MSB. numeric truth 변환 open
### m8-interval · 정적·동적 구간 비교

원본 ID: 06-018, 06-019 · 분류: `existing-options`

- `m8-interval-01`: 정적 및 dynamic lower/u/upper·scalar expansion
- `m8-interval-02`: lower/upper 각 inclusive 설정·open/closed/mixed 구간; 동일 bound 허용 여부 명시
- `m8-interval-03`: 기존 closed interval 의미·bool 출력·잘못된 bounds 진단

연결 후보: `logic.interval`, `logic.interval-dynamic`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-lookup-interpolated · 파라미터 n-D 조회표

원본 ID: 07-001, 07-002, 07-009 · 분류: `existing-options`

- `m8-lookup-interpolated-01`: 1/2/nD parameter table: flat cells+shape+axes, scalar/vector/2D query broadcasting; rank>2 parameter table+scalar query도 M8
- `m8-lookup-interpolated-02`: linear point-slope/Lagrange,flat,nearest; cubic spline/Akima는 해당 R2024b 옵션 확인 및 finite-real 알고리즘 구현/검증 gate
- `m8-lookup-interpolated-03`: clip/linear 및 해당 spline extrapolation, exact knots/last breakpoint/tie 규약·strict increasing axes·explicit/even spacing
- `m8-lookup-interpolated-04`: table/breakpoint source=dialog 또는 현재 shape로 가능한 dynamic input; rank는 cell/corner budget으로 제한, 임의 rank4 완료 판정 금지

연결 후보: `lookup.interpolated`, `lookup.2d`, `lookup.nd`. rank≤10/axis≤32/1024cells·corners/linear-nearest-previous/error-clamp-extrapolate/scalar output. array query broadcast/splines/dynamic tables open

Assume input is within range는 현재 도움말에서 Since R2025a; R2024b 필수옵션으로 합산 제외 · 관찰한 M8 초안 lookup.nd rank1~10/각축≤32/table≤1024·corners≤1024/row-major flat표/scalar 또는queryvector입력→scalar출력; 실제 일반 n-D SignalValue는 추가하지 않음

핵심 확인: [MathWorks ndlookuptable](https://www.mathworks.com/help/simulink/slref/ndlookuptable.html). R2024b exact version은 미확정.
### m8-lookup-direct · n-D 직접 조회·슬라이스

원본 ID: 07-004 · 분류: `new-primitive`

- `m8-lookup-direct-01`: zero-based index·element/vector/2D matrix slice·first-axis-fastest parameter table storage
- `m8-lookup-direct-02`: rank>2 parameter table의 scalar 또는 rank≤2 slice 출력; 모든 계산 가능한 rank를 자원예산 내 구현
- `m8-lookup-direct-03`: table input rank≤2, row-major 선택 의미, out-of-range 진단/clip 옵션 및 fractional index 처리 공식 확인

연결 후보: `lookup.direct`. rank≤10/axis≤32/1024cells/row-major parameterflat/query→scalar. column-major/vector·matrix slice open

핵심 확인: [MathWorks directlookuptablend](https://www.mathworks.com/help/simulink/slref/directlookuptablend.html). R2024b exact version은 미확정.
### m8-prelookup · 검색 index/fraction

원본 ID: 07-007 · 분류: `existing-options`

- `m8-prelookup-01`: explicit/even-spacing axes, binary/linear/even search·index/fraction 또는 index-only
- `m8-prelookup-02`: clip/linear 범위 밖 index·fraction, last breakpoint의 endpoint 규약·signed fraction·zero-based
- `m8-prelookup-03`: 선택한 출력 ports·형상/단위·다른 interpolation-node와 grid 연결 검증

연결 후보: `lookup.prelookup`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-interpolate-prelookup · 검색 결과를 쓰는 보간

원본 ID: 07-005 · 분류: `new-primitive`

- `m8-interpolate-prelookup-01`: N개의 index/fraction 입력과 parameter table 또는 허용 table input
- `m8-interpolate-prelookup-02`: 선형/flat 보간·slice selection 및 clip/linear extrapolation; index/fraction boundary는 Prelookup과 같은 계약
- `m8-interpolate-prelookup-03`: index integer bounds·fraction 유효성·Ntable 크기·연산예산

연결 후보: `lookup.interpolate-prelookup`. 1D index/fraction0..1/error-clamp. nD/tableinput/extrapolated fraction open
### m8-lookup-dynamic · 동적 1D 조회표

원본 ID: 07-006 · 분류: `new-primitive`

- `m8-lookup-dynamic-01`: u/xdat/ydat inputs, same fixed length·strict increasing xdat·각 due 시점 모든 table 값검증
- `m8-lookup-dynamic-02`: linear+clip,linear extrap,nearest,below,above 선택 및 exact knot/tie
- `m8-lookup-dynamic-03`: legacy-not-recommended 원본은 지우지 않고 native mathematical scope+modern LUT 대체 관계 공개

연결 후보: `lookup.dynamic`. scalar query·breakpoints/table ports·linear-nearest-previous/error-clamp-extrapolate. above/below/native tie 검증 open

핵심 확인: [MathWorks lookuptabledynamic](https://www.mathworks.com/help/simulink/ref_obsolete_blocks/lookuptabledynamic.html). R2024b exact version은 미확정.
### m8-abs · 절댓값

원본 ID: 08-001 · 분류: `existing-options`

- `m8-abs-01`: 기존 scalar/vector/2D abs 회귀·signed zero 결과·finite-value policy 검증

연결 후보: `math.abs`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-assignment · 배열 원소 배정

원본 ID: 08-004 · 분류: `new-primitive`

- `m8-assignment-01`: rank1/2 Y0 복사 또는 size 지정 zero 초기화·U 배정; 입력 객체 mutation 금지
- `m8-assignment-02`: peraxis all/indexvector/startindex, dialog 또는 port,zero/onebase·fixed output shape
- `m8-assignment-03`: 동적 index값·중복 및 배정순서·부정확한 U 크기·bounds 진단; 일반 variable-size/nD는 M10

연결 후보: `matrix.assign`. indices static row-major zero-base+value port; duplicate rejected. axis/port/onebase/initialize-size는 open

핵심 확인: [MathWorks assignment](https://www.mathworks.com/help/simulink/slref/assignment.html). R2024b exact version은 미확정.
### m8-bias · 배열 Bias

원본 ID: 08-005 · 분류: `existing-options`

- `m8-bias-01`: bias parameter scalar/vector/2D와 scalar expansion·dtype/shape 단위 규약
- `m8-bias-02`: 부동소수점 overflow·tiny constant 보존 및 모든 지원형상 oracle

연결 후보: `math.bias`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-dot · 실수 내적

원본 ID: 08-009 · 분류: `existing-options`

- `m8-dot-01`: 공식 입력 scalar/vector/2D 허용형상 확인 후 같은 길이와 출력축 처리
- `m8-dot-02`: stable sum·scalar expansion 또는 채널별 내적 선택의 정확 shape
- `m8-dot-03`: 복소수 conjugation은 M10; plain f64 dot의 transpose convention 공개

연결 후보: `vector.dot`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-find-nonzero · 고정 폭 대체·가변 길이 원본

원본 ID: 08-010 · 분류: `bounded-independent-alternative`

- `m8-find-nonzero-01`: M8 padded alternative: 입력 원소수 고정폭 indices/rows/columns/values 및 실제 count; zero-base sentinel−1/one-base sentinel0
- `m8-find-nonzero-02`: column-major scan·zero/onebase·subscripts/values port 옵션 및 all-zero/all-nonzero·boolean 검사
- `m8-find-nonzero-03`: fixed/padded를 공식 옵션으로 표시 금지; 원본 variable-size 출력을 M10의 variable-size shape gate로 남김

연결 후보: `matrix.find-nonzero`. indices/rows/columns/count 고정폭 대체; values output 없음; native variable-size 미지원

핵심 확인: [MathWorks findnonzeroelements](https://www.mathworks.com/help/simulink/slref/findnonzeroelements.html). R2024b exact version은 미확정.
### m8-math-function · 수학 함수 옵션

원본 ID: 08-013 · 분류: `existing-options`

- `m8-math-function-01`: exp/log/2^u/10^u/log10/magnitude²/square/pow/conj/reciprocal/hypot/rem/mod/transpose/hermitian의 finite-real 경로
- `m8-math-function-02`: signed-power on/off·binary input·scalar expansion, real conj/hermitian의 identity/transpose 경로
- `m8-math-function-03`: Exact reciprocal; Newton-Raphson의 지원 dtype 의존을 확인하고 dtype-only이면 M10; finite policy의 zero/negative branch 진단

연결 후보: `math.function`, `math.power`, `math.exp2`, `math.hypot`, `math.mod`, `math.remainder`, `matrix.transpose`. 기존card5개+독립functionIds compose mapping; signed-power/10^u/complexity auto 등 누락 open

핵심 확인: [MathWorks mathfunction](https://www.mathworks.com/help/simulink/slref/mathfunction.html). R2024b exact version은 미확정.
### m8-matrix-concat · N개 행렬 연결

원본 ID: 08-014, 09-011 · 분류: `existing-options`

- `m8-matrix-concat-01`: 가변 입력개수·rank≤2 axis1/2 concatenation·row/column vectors
- `m8-matrix-concat-02`: 행/열 정합·scalar handling·boolean/f64/단위·원본 포트순서
- `m8-matrix-concat-03`: nD concat axes는 M10

연결 후보: `matrix.horizontal`, `matrix.vertical`, `math.concatenate-inputs`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-matrix-multiply · 행렬 곱

원본 ID: 08-015, 09-012 · 분류: `existing-options`

- `m8-matrix-multiply-01`: real scalar/vector/2D 공식 입력해석·내적차원 및 row/column shape
- `m8-matrix-multiply-02`: 두 행렬 곱 및 transpose 설정 중 실제 원본옵션 확인·같은dtype/units
- `m8-matrix-multiply-03`: 거대한 곱·overflow·singular division은 Product와 구분

연결 후보: `math.matrix-multiply`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-minmax · 다중 입력/축 최솟값·최댓값

원본 ID: 08-016 · 분류: `existing-options`

- `m8-minmax-01`: N 입력 element-wise 또는 one-input all/row/column reduction
- `m8-minmax-02`: scalar expansion·boolean numeric policy·ties/index output 여부 원본옵션 검토
- `m8-minmax-03`: NaN 옵션은 M10 nonfinite policy 없으면 진단

연결 후보: `math.minmax`, `reduce.axis`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-permute-dim · 축 재배열

원본 ID: 08-018 · 분류: `new-primitive`

- `m8-permute-dim-01`: rank≤2 identity 또는 transpose 순열; 완전 순열 검증·선택된축 의미
- `m8-permute-dim-02`: 비허용 rank/중복축을 조용히 flatten하지 않고 진단; nDsignal 순열 M10

연결 후보: `matrix.permute-dimensions`, `matrix.transpose`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-polynomial · 다항식

원본 ID: 08-019 · 분류: `existing-options`

- `m8-polynomial-01`: descending coefficient parameter·scalar/vector/2D input·Horner evaluation
- `m8-polynomial-02`: 상수/영계수·아주 큰 값·underflow/overflow·빈 coefficient 진단

연결 후보: `math.polynomial`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-reduce-product · 축별 곱 집계

원본 ID: 08-021 · 분류: `existing-options`

- `m8-reduce-product-01`: rank≤2 all/row/column 또는 specified dimension reduction; shape/axis 유지
- `m8-reduce-product-02`: 0·부호·overflow/underflow 및 rank1 기본 축 oracle

연결 후보: `reduce.product`, `reduce.axis`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-sqrt · sqrt 함수와 설정

원본 ID: 08-023, 08-027, 08-030, 21-008, 21-009, 21-010 · 분류: `existing-options`

- `m8-sqrt-01`: sqrt,sign(u)*sqrt(abs(u)),1/sqrt(u)의 finite-real 경로 및 배열형상
- `m8-sqrt-02`: 실수 zero/negative/reciprocal zero 정의역, Exact 및 dtype 관련 approximation 옵션 검토
- `m8-sqrt-03`: 동명21절 card는 alias/config preset, 별도 독립 kernel로 합산 금지

연결 후보: `math.sqrt`, `math.signed-sqrt`, `math.reciprocal-sqrt`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-reshape · row/column/custom reshape

원본 ID: 08-024 · 분류: `existing-options`

- `m8-reshape-01`: 1D,row,column,custom rank≤2 reshape·원소수 보존
- `m8-reshape-02`: 기존 row-major 데이터 의미 유지+명시 column-major 설정·zero-copy 내부라도 입력 mutation 금지
- `m8-reshape-03`: shape4byte한도/overflow 및 unknown shape·nDshape M10

연결 후보: `matrix.reshape`, `matrix.reshape-column-major`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-round · 반올림 설정

원본 ID: 08-025 · 분류: `existing-options`

- `m8-round-01`: floor/ceil/round/fix, round tie semantics의 공식 MATLAB 연계 확인
- `m8-round-02`: negative half tie·signed zero·MAX_SAFE_INTEGER·형상 보존; JS Math.round 음수half 그대로 사용 금지

연결 후보: `math.round`. 기존 negative-half tie의 native MATLAB round oracle 재검증 필요

핵심 확인: [MathWorks roundingfunction](https://www.mathworks.com/help/simulink/slref/roundingfunction.html). R2024b exact version은 미확정.
### m8-sign · 부호

원본 ID: 08-026 · 분류: `existing-options`

- `m8-sign-01`: real scalar/vector/2D sign 회귀 및 0/-0 정책
- `m8-sign-02`: 소스 source-row로 edge/hold 진단, continuous jump는 M12 또는 held 안전경로

연결 후보: `math.sign`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-sine-function · 외부 시각 sine 함수

원본 ID: 08-028 · 분류: `new-primitive`

- `m8-sine-function-01`: external t scalar input에서 A*sin(omega*t+phase)+bias, Frequency unit rad/sec; source Hz와 2π 단위 구분
- `m8-sine-function-02`: Amplitude/Bias/Frequency/Phase parameter shape 및 vector interpretation·external/simulation time 설정
- `m8-sine-function-03`: Sample based k counter·samplesPerPeriod/offset은 M9 동일 sine source family와 연계 구현; M8 순수함수 완료와 분리

연결 후보: `math.sine-wave-function`. scalar parameter4개·external t scalar/vector/2D. 공식 scalar time 외 arrays는 독립 확장; samplebased/parameterbroadcast open

핵심 확인: [MathWorks sinewavefunction](https://www.mathworks.com/help/simulink/slref/sinewavefunction.html). R2024b exact version은 미확정.
### m8-squeeze · rank≤2 identity·nD singleton

원본 ID: 08-031 · 분류: `preset`

- `m8-squeeze-01`: scalar/vector/matrix는 공식과 같이 그대로 통과
- `m8-squeeze-02`: row/column matrix를 vector로 변경하지 않음; flatten이 필요하면 다른 독립 기능으로 제공

연결 후보: `matrix.squeeze`. rank≤2 identity, general rank>2 singleton 미지원

실제 singleton 제거는 rank>2 nDsignal의 M10; M8 no-op subset은 전체 기능 구현 아님

핵심 확인: [MathWorks squeeze](https://www.mathworks.com/help/simulink/slref/squeeze.html). R2024b exact version은 미확정.
### m8-reduce-sum · 축별 합 집계

원본 ID: 08-034 · 분류: `existing-options`

- `m8-reduce-sum-01`: rank≤2 all/row/column·specified dimension reduction; 출력형상 보존
- `m8-reduce-sum-02`: tiny constant·large cancellation·overflow finite 진단 및 stable sum

연결 후보: `reduce.sum`, `reduce.axis`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-trigonometric · 실수 삼각·쌍곡 함수

원본 ID: 08-035 · 분류: `existing-options`

- `m8-trigonometric-01`: sin/cos/tan/asin/acos/atan/atan2/sinh/cosh/tanh/asinh/acosh/atanh 및 sincos 가능한 real 옵션
- `m8-trigonometric-02`: scalar expansion·binary atan2, radians unit·finite-real domain·sign quadrant/±0
- `m8-trigonometric-03`: complex·CORDIC/fixed precision 옵션은 실제 dtype 의존 근거와 M10 추적

연결 후보: `math.trigonometric`, `math.atan2`, `math.sinh`, `math.cosh`, `math.tanh`, `math.asinh`, `math.acosh`, `math.atanh`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-negate · 단항 음수

원본 ID: 08-036 · 분류: `preset`

- `m8-negate-01`: u→−u real scalar/vector/2D 검증·gain−1 구성 공유
- `m8-negate-02`: signed zero 및 finite overflow 정책, typed integer minimum overflow M10

연결 후보: `math.gain`, `math.negate`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-diag-create · 대각 행렬 생성

원본 ID: 09-002 · 분류: `existing-options`

- `m8-diag-create-01`: scalar/vector/row/column 공식허용형상·주대각 default·offset 확장 여부 구분
- `m8-diag-create-02`: boolean과f64 zero fill 및 square size 추론·자원한도
- `m8-diag-create-03`: offset 추가기능이 공식 옵션인지 검토 전 native option으로 주장 금지

연결 후보: `matrix.diag-create`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요

핵심 확인: [MathWorks creatediagonalmatrix](https://www.mathworks.com/help/simulink/slref/creatediagonalmatrix.html). R2024b exact version은 미확정.
### m8-cross · 3D 벡터 외적

원본 ID: 09-003 · 분류: `existing-options`

- `m8-cross-01`: 길이3 vector·row/column 및 2D channels의 공식지원 축 해석
- `m8-cross-02`: dtype/shape/units와 handedness·부호·parallel/zero vectors

연결 후보: `vector.cross`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-expand-scalar · 파라미터 scalar 확장 source

원본 ID: 09-004 · 분류: `new-primitive`

- `m8-expand-scalar-01`: 입력port 없는 ElementValue scalar parameter·OutputDimensions integer 또는 2-elementvector
- `m8-expand-scalar-02`: float64/boolean 출력·1D/row/column/2D 형상·요소수 예산
- `m8-expand-scalar-03`: input-driven repeat는 별도 CalcWeave 확장, 원본구성과 구분

연결 후보: `matrix.expand-scalar`. value float64 parameter+form/length/rows/columns no-inputsource. boolean ElementValue open

R2024b struct expansion 추가는 M11 typed bus 지원까지 후속

핵심 확인: [MathWorks expandscalar](https://www.mathworks.com/help/simulink/slref/expandscalar.html). R2024b exact version은 미확정.
### m8-diagonal · 주대각 추출

원본 ID: 09-005 · 분류: `existing-options`

- `m8-diagonal-01`: rectangular matrix의 main diagonal·출력 1D/row/column 공식형상 확인
- `m8-diagonal-02`: offset 기능은 독립 확장 표시; boolean/f64 보존

연결 후보: `matrix.diagonal`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-identity · 단위 행렬 source

원본 ID: 09-007 · 분류: `existing-options`

- `m8-identity-01`: dimension parameter·f64/boolean 가능한 output type·source sample/shape
- `m8-identity-02`: rectangular 여부 공식검증 전 own 확장표시·resource bound

연결 후보: `matrix.identity`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-is-symmetric · 대칭·반대칭 검사

원본 ID: 09-009 · 분류: `new-primitive`

- `m8-is-symmetric-01`: Symmetric/Skew-Symmetric, square real matrix→scalar boolean
- `m8-is-symmetric-02`: 정확 원소 비교를 기본으로 A==transpose(A) 또는 A==−transpose(A); nonsquare false/진단 정책 공식확인
- `m8-is-symmetric-03`: tolerance는 별도 CalcWeave 옵션임을 표시; PSD/positive-definite 검사와 구분

연결 후보: `matrix.is-symmetric`. symmetry+tolerance만, Skew-Symmetric open; tolerance는 독립 확장

핵심 확인: [MathWorks issymmetric](https://www.mathworks.com/help/simulink/slref/issymmetric.html). R2024b exact version은 미확정.
### m8-is-triangular · 상·하 삼각 검사

원본 ID: 09-010 · 분류: `new-primitive`

- `m8-is-triangular-01`: Upper/Lower, real matrix→scalar boolean
- `m8-is-triangular-02`: 요구 삼각영역 밖 값은 정확0; rectangular input 지원에 맞춘 행/열 루프
- `m8-is-triangular-03`: tolerance는 independent option; matrix.triangle의 값변환과 다른 함수

연결 후보: `matrix.is-triangular`. upper/lower/either+tolerance; either/tolerance는 독립 확장

핵심 확인: [MathWorks istriangular](https://www.mathworks.com/help/simulink/slref/istriangular.html). R2024b exact version은 미확정.
### m8-matrix-square · Gram 행렬

원본 ID: 09-013 · 분류: `new-primitive`

- `m8-matrix-square-01`: 공식 real 경로 y=transpose(u)*u; M×N→N×N, unoriented vector M×1→1×1
- `m8-matrix-square-02`: square 입력만 허용하거나 elementwise-square로 바꾸지 않음; scalar/row/column 사례
- `m8-matrix-square-03`: complex Hermitian conjugation M10; 현재 canonical math.multiply는 baseline 보존, 새 mapped id 명시

연결 후보: `matrix.square`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요

핵심 확인: [MathWorks matrixsquare](https://www.mathworks.com/help/simulink/slref/matrixsquare.html). R2024b exact version은 미확정.
### m8-permute-matrix · 동적 row/column gather

원본 ID: 09-015 · 분류: `new-primitive`

- `m8-permute-matrix-01`: A/P inputs,Rows/Columns,0/1-based·duplicate와 omitted indices 허용
- `m8-permute-matrix-02`: invalid index clip/clip+warn/error·P length equality-check 설정
- `m8-permute-matrix-03`: unoriented vector는 Rows에서 M×1,Columns에서1×N으로 해석

연결 후보: `matrix.permute-rows-cols`, `matrix.select`, `matrix.select-dynamic`. 고정 row/column 완전순열만; official dynamic P/repetition/omission/invalid handling open

핵심 확인: [MathWorks permutematrix](https://www.mathworks.com/help/simulink/slref/permutematrix.html). R2024b exact version은 미확정.
### m8-submatrix · 구간 submatrix

원본 ID: 09-018 · 분류: `existing-options`

- `m8-submatrix-01`: starting/ending row/column 및 시작/끝 상대 방식·정적 parameter subset의 source 의미 확인
- `m8-submatrix-02`: real/boolean 2D, 크기·포함 경계·empty range 정책
- `m8-submatrix-03`: 동적 선택은 Selector/Permute와 공유하되 Submatrix 공식 옵션만 승인

연결 후보: `matrix.select`, `matrix.select-dynamic`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-transpose · 비켤레 전치

원본 ID: 09-019 · 분류: `existing-options`

- `m8-transpose-01`: scalar/row/column/unoriented vector 공식 형상 해석·f64/boolean transpose
- `m8-transpose-02`: 2D shape·입력 mutation 금지·nDsignal은 원본 2D만 해당 여부 확인

연결 후보: `matrix.transpose`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-assertion · 검증 assertion

원본 ID: 11-001 · 분류: `new-primitive`

- `m8-assertion-01`: 현재 값의 모든 원소가 true/nonzero인지 확인; assertion enable·stop/error·diagnostic 정책
- `m8-assertion-02`: 실패에 node/port/시간·마지막 유효 partial 결과·주장 출력 옵션
- `m8-assertion-03`: MATLAB callback 실행은 M14 외부/권한 gate, arbitrary code eval 금지

연결 후보: `verify.assert`. boolean all/any·성공scalar true·실패stop. numeric input/enable/warning/export open
### m8-bounds-check · 경계 assertion 구성

원본 ID: 11-003, 11-004, 11-005, 11-006, 11-008, 11-009, 11-010, 11-011 · 분류: `shared-new-primitive-config`

- `m8-bounds-check-01`: static parameters 또는 dynamic bound ports, lower/upper/range/gap별 predicate·각 inclusive 설정
- `m8-bounds-check-02`: gap은 내부구간을 피하는 조건 OR; range는 구간안의 조건 AND; scalar expansion·rank≤2
- `m8-bounds-check-03`: 모든 원소 aggregate assertion·optional scalar assertion output·enable/stop/failure metadata; 표시 아이콘 UI preset

연결 후보: `verify.bounds`. static/dynamic range·gap·lower·upper/inclusive. out은 입력형상 true; 공식 optional scalar output/enable/stop-warn open

`kind=gap`의 선언 API는 **설정한 내부 구간의 여집합**이다. 기본 `lowerClosed=closed`, `upperClosed=closed`는 내부 구간에 두 끝점을 포함하므로 gap 검사에서는 끝점이 유효하지 않다. 둘 다 `open`이면 내부에서 끝점을 빼므로 gap 검사에서 두 끝점이 유효하다. range의 closed/open 의미는 내부 구간에 그대로 적용한다.

원본 Check Static/Dynamic Gap의 Inclusive 옵션은 **유효한 외부 진폭 집합**의 끝점 포함을 뜻하므로 설정값을 그대로 복사하면 안 된다. 공식 Inclusive lower/upper=`on`은 대응하는 CalcWeave gap `lowerClosed`/`upperClosed`=`open`, `off`는 `closed`로 각각 반전한다. [공식 설명](https://www.mathworks.com/help/simulink/slref/checkstaticgap.html)은 현재 도움말로 확인했으며 R2024b exact archive·실제 reference model의 경계 일치 검증은 미완료다. 이 변환 규약을 옵션 값 동일성이나 native 전체 동등성 승인으로 간주하지 않는다. 끝점0/1·혼합 closure의 source 변환 fixture는 M8-followup 후보로 남긴다.

핵심 확인: [MathWorks checkstaticgap](https://www.mathworks.com/help/simulink/slref/checkstaticgap.html). R2024b exact version은 미확정.
### m8-index-vector · 제어 입력 벡터 선택

원본 ID: 15-011 · 분류: `existing-options`

- `m8-index-vector-01`: external scalar control+one data vector,zero-based default/one-based
- `m8-index-vector-02`: fractional control truncate-to-zero; unknown/invalid bounds의 default/error 정책
- `m8-index-vector-03`: 현재 fixed vector.select는 baseline 승인subset만 유지, 원본dynamiccontrol 구현 필요

연결 후보: `route.multiport-switch`, `vector.select-dynamic`. dynamic selector 정수 index만; native fraction truncation/default handling open

핵심 확인: [MathWorks indexvector](https://www.mathworks.com/help/simulink/slref/indexvector.html). R2024b exact version은 미확정.
### m8-manual-switch · 저장된 수동 선택

원본 ID: 15-012 · 분류: `preset`

- `m8-manual-switch-01`: model parameter 선택한 data input·bool/f64 rank≤2 및 단위·형상
- `m8-manual-switch-02`: 선택 상태 JSON/TS에 재현 가능 저장; runtime live UI toggle event log는 M13

연결 후보: `route.switch`, `route.manual-switch`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요
### m8-multiport · N개 신호 제어 선택

원본 ID: 15-016 · 분류: `new-primitive`

- `m8-multiport-01`: N data ports+scalarcontrol, zero-/one-based contiguous 또는 명시 index groups
- `m8-multiport-02`: fraction truncate-to-zero·default/last/additional default port·out-of-range diagnostic
- `m8-multiport-03`: 동형 data dtype/shape/units·scalar expansion, control enum은 M10

연결 후보: `route.multiport-switch`. count2..16/zero·onebase/integer/error·clamp. one-data-port/explicit groups/default-port/fraction truncate open
### m8-selector · 동적 축별 선택

원본 ID: 15-019 · 분류: `existing-options`

- `m8-selector-01`: rank1/2 peraxis select-all/indexvector/startindex(정적/port)·zero/onebase·fixed outputsize
- `m8-selector-02`: dynamic index값 및 scalar expansion 없이 공식 shape 보존·각axis 길이 추론
- `m8-selector-03`: starting+ending port로 가변 output 크기 필요한 경로는 M10 variable-size; 고정 길이 가능경로는 M8

연결 후보: `vector.select`, `matrix.select`, `vector.select-dynamic`, `matrix.select-dynamic`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요

핵심 확인: [MathWorks selector](https://www.mathworks.com/help/simulink/slref/selector.html). R2024b exact version은 미확정.
### m8-fcn · 제한 수식 독립 대체

원본 ID: 19-003 · 분류: `bounded-independent-alternative`

- `m8-fcn-01`: AST allowlist의 indexing u(i),vector expressions 등 원본 finite-real 표현 가능한 문법 검토
- `m8-fcn-02`: eval/newFunction/MATLAB interpreter 없이 parse/size/operation budget·정확오류 위치
- `m8-fcn-03`: MathWorks workspace/object/function calls는 M14 별도adapter, 이를 이유로 가능한 pure 수식 구현을 밀지 않음

연결 후보: `math.expression`. 기존x/pi/e AST; u(i) indexing/원본문법 미지원; 독립대체 status 유지
### m8-increment · 실제 값 ±1 설정

원본 ID: 20-004, 20-007, 20-008 · 분류: `preset`

- `m8-increment-01`: u−1,u+1,max(u−1,0) stateless scalar/vector/2D; 이름이 counter라는 의미 아님
- `m8-increment-02`: real-world value와 stored-integer 원시code 연산 구분, typed integer/fixed overflow wrap은 M10
- `m8-increment-03`: 새 표시 카드를 추가해도 공유 bias/clip kernel 또는 composition으로 따로 집계

연결 후보: `math.bias`, `math.minmax`, `math.increment`. 정의 존재는 옵션 승인 근거가 아님; task별 fixture/evidence 필요

핵심 확인: [MathWorks decrementrealworld](https://www.mathworks.com/help/simulink/slref/decrementrealworld.html), [MathWorks decrementtozero](https://www.mathworks.com/help/simulink/slref/decrementtozero.html). R2024b exact version은 미확정.

## 모든 원본행의 처리 경로

이 표의 status는 baseline 그대로이며 이번 단계 완료를 뜻하지 않는다. 각 행의 전체 required task와 후속 옵션은 JSON으로 조회한다. 영문명·분류·조건·원본 line은 JSON에 무손실 보존했다.

| 원본 ID | 블럭명 | baseline | 이번 작업 분류 | 계약 family | 후속 |
| --- | --- | --- | --- | --- | --- |
| [01-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Constant | M1 정적 subset | existing-options | m8-constant | M10, M15, M16 |
| [01-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Demux | M1 정적 subset | existing-options | m8-demux | M10, M15, M16 |
| [01-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Gain | M1 정적 subset | existing-options | m8-gain | M10, M15, M16 |
| [01-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Ground | 미구현 | preset | m8-constant | M10, M15, M16 |
| [01-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Logical Operator | M1 정적 subset | existing-options | m8-boolean | M10, M15, M16 |
| [01-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Mux | M1 정적 subset | existing-options | m8-mux | M10, M15, M16 |
| [01-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Product | M1 정적 subset | existing-options | m8-product | M10, M15, M16 |
| [01-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Relational Operator | M1 정적 subset | existing-options | m8-relational | M10, M15, M16 |
| [01-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Saturation | M1 정적 subset | existing-options | m8-saturation | M10, M12, M15, M16 |
| [01-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Sum | M1 정적 subset | existing-options | m8-sum | M10, M15, M16 |
| [01-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Switch | M1 정적 subset | existing-options | m8-switch | M10, M15, M16 |
| [01-023](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Vector Concatenate | M1 정적 subset | existing-options | m8-vector-concat | M10, M15, M16 |
| [04-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) | Coulomb and Viscous Friction | 미구현 | new-primitive | m8-friction | M10, M12, M15, M16 |
| [04-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) | Dead Zone | catalog 승인 subset | existing-options | m8-dead-zone | M10, M12, M15, M16 |
| [04-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) | Dead Zone Dynamic | 미구현 | existing-options | m8-dead-zone | M10, M12, M15, M16 |
| [04-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) | Quantizer | catalog 승인 subset | existing-options | m8-quantizer | M10, M12, M15, M16 |
| [04-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) | Saturation | M1 정적 subset | existing-options | m8-saturation | M10, M12, M15, M16 |
| [04-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) | Saturation Dynamic | 미구현 | existing-options | m8-saturation | M10, M12, M15, M16 |
| [04-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) | Wrap To Zero | 미구현 | new-primitive | m8-wrap-zero | M10, M12, M15, M16 |
| [06-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Combinatorial Logic | 미구현 | new-primitive | m8-truth-table | M10, M15, M16 |
| [06-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Compare To Constant | 미구현 | existing-options | m8-relational | M10, M15, M16 |
| [06-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Compare To Zero | 미구현 | preset | m8-relational | M10, M15, M16 |
| [06-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Interval Test | catalog 승인 subset | existing-options | m8-interval | M10, M12, M15, M16 |
| [06-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Interval Test Dynamic | 미구현 | existing-options | m8-interval | M10, M12, M15, M16 |
| [06-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Logical Operator | M1 정적 subset | existing-options | m8-boolean | M10, M15, M16 |
| [06-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Relational Operator | M1 정적 subset | existing-options | m8-relational | M10, M15, M16 |
| [07-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) | 1-D Lookup Table | M2 승인 subset | existing-options | m8-lookup-interpolated | M10, M15, M16 |
| [07-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) | 2-D Lookup Table | M5 승인 subset | existing-options | m8-lookup-interpolated | M10, M15, M16 |
| [07-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) | Direct Lookup Table (n-D) | 미구현 | new-primitive | m8-lookup-direct | M10, M15, M16 |
| [07-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) | Interpolation Using Prelookup | 미구현 | new-primitive | m8-interpolate-prelookup | M10, M15, M16 |
| [07-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) | Lookup Table Dynamic | 미구현 | new-primitive | m8-lookup-dynamic | M10, M15, M16 |
| [07-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) | Prelookup | M5 승인 subset | existing-options | m8-prelookup | M10, M15, M16 |
| [07-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-07) | n-D Lookup Table | 미구현 | existing-options | m8-lookup-interpolated | M10, M15, M16 |
| [08-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Abs | M1 정적 subset | existing-options | m8-abs | M10, M15, M16 |
| [08-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Add | M1 preset subset | preset | m8-sum | M10, M15, M16 |
| [08-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Assignment | 미구현 | new-primitive | m8-assignment | M10, M15, M16 |
| [08-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Bias | catalog 승인 subset | existing-options | m8-bias | M10, M15, M16 |
| [08-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Divide | catalog 승인 subset | existing-options | m8-product | M10, M15, M16 |
| [08-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Dot Product | catalog 승인 subset | existing-options | m8-dot | M10, M15, M16 |
| [08-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Find Nonzero Elements | 미구현 | bounded-independent-alternative | m8-find-nonzero | M10, M15, M16 |
| [08-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Gain | M1 정적 subset | existing-options | m8-gain | M10, M15, M16 |
| [08-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Math Function | M1 정적 subset | existing-options | m8-math-function | M10, M15, M16 |
| [08-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Matrix Concatenate | catalog 승인 subset | existing-options | m8-matrix-concat | M10, M15, M16 |
| [08-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Matrix Multiply | M5 승인 subset | existing-options | m8-matrix-multiply | M10, M15, M16 |
| [08-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | MinMax | M1 정적 subset | existing-options | m8-minmax | M10, M15, M16 |
| [08-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Permute Dimensions | 미구현 | new-primitive | m8-permute-dim | M10, M15, M16 |
| [08-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Polynomial | catalog 승인 subset | existing-options | m8-polynomial | M10, M15, M16 |
| [08-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Product | M1 정적 subset | existing-options | m8-product | M10, M15, M16 |
| [08-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Product of Elements | catalog 승인 subset | existing-options | m8-reduce-product | M10, M15, M16 |
| [08-023](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Reciprocal Sqrt | 미구현 | existing-options | m8-sqrt | M10, M15, M16 |
| [08-024](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Reshape | M1 정적 subset | existing-options | m8-reshape | M10, M15, M16 |
| [08-025](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Rounding Function | M1 정적 subset | existing-options | m8-round | M10, M15, M16 |
| [08-026](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Sign | catalog 승인 subset | existing-options | m8-sign | M10, M12, M15, M16 |
| [08-027](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Signed Sqrt | 미구현 | existing-options | m8-sqrt | M10, M15, M16 |
| [08-028](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Sine Wave Function | 미구현 | new-primitive | m8-sine-function | M9, M10, M12, M15, M16 |
| [08-030](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Sqrt | M1 정적 subset | existing-options | m8-sqrt | M10, M15, M16 |
| [08-031](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Squeeze | 미구현 | preset | m8-squeeze | M10, M15, M16 |
| [08-032](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Subtract | M1 preset subset | preset | m8-sum | M10, M15, M16 |
| [08-033](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Sum | M1 정적 subset | existing-options | m8-sum | M10, M15, M16 |
| [08-034](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Sum of Elements | catalog 승인 subset | existing-options | m8-reduce-sum | M10, M15, M16 |
| [08-035](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Trigonometric Function | M1 정적 subset | existing-options | m8-trigonometric | M10, M15, M16 |
| [08-036](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Unary Minus | 미구현 | preset | m8-negate | M10, M15, M16 |
| [08-037](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Vector Concatenate | M1 정적 subset | existing-options | m8-vector-concat | M10, M15, M16 |
| [09-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | Create Diagonal Matrix | catalog 승인 subset | existing-options | m8-diag-create | M10, M15, M16 |
| [09-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | Cross Product | catalog 승인 subset | existing-options | m8-cross | M10, M15, M16 |
| [09-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | Expand Scalar | 미구현 | new-primitive | m8-expand-scalar | M10, M15, M16, M11 |
| [09-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | Extract Diagonal | catalog 승인 subset | existing-options | m8-diagonal | M10, M15, M16 |
| [09-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | Identity Matrix | catalog 승인 subset | existing-options | m8-identity | M10, M15, M16 |
| [09-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | IsSymmetric | 미구현 | new-primitive | m8-is-symmetric | M10, M15, M16 |
| [09-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | IsTriangular | 미구현 | new-primitive | m8-is-triangular | M10, M15, M16 |
| [09-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | Matrix Concatenate | catalog 승인 subset | existing-options | m8-matrix-concat | M10, M15, M16 |
| [09-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | Matrix Multiply | M5 승인 subset | existing-options | m8-matrix-multiply | M10, M15, M16 |
| [09-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | Matrix Square | 미구현 | new-primitive | m8-matrix-square | M10, M15, M16 |
| [09-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | Permute Matrix | 미구현 | new-primitive | m8-permute-matrix | M10, M15, M16 |
| [09-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | Product | M1 정적 subset | existing-options | m8-product | M10, M15, M16 |
| [09-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | Submatrix | catalog 승인 subset | existing-options | m8-submatrix | M10, M15, M16 |
| [09-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-09) | Transpose | M5 승인 subset | existing-options | m8-transpose | M10, M15, M16 |
| [11-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) | Assertion | 미구현 | new-primitive | m8-assertion | M10, M15, M16 |
| [11-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) | Check Dynamic Gap | 미구현 | shared-new-primitive-config | m8-bounds-check | M10, M15, M16 |
| [11-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) | Check Dynamic Lower Bound | 미구현 | shared-new-primitive-config | m8-bounds-check | M10, M15, M16 |
| [11-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) | Check Dynamic Range | 미구현 | shared-new-primitive-config | m8-bounds-check | M10, M15, M16 |
| [11-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) | Check Dynamic Upper Bound | 미구현 | shared-new-primitive-config | m8-bounds-check | M10, M15, M16 |
| [11-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) | Check Static Gap | 미구현 | shared-new-primitive-config | m8-bounds-check | M10, M15, M16 |
| [11-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) | Check Static Lower Bound | 미구현 | shared-new-primitive-config | m8-bounds-check | M10, M15, M16 |
| [11-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) | Check Static Range | 미구현 | shared-new-primitive-config | m8-bounds-check | M10, M15, M16 |
| [11-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) | Check Static Upper Bound | 미구현 | shared-new-primitive-config | m8-bounds-check | M10, M15, M16 |
| [15-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) | Demux | M1 정적 subset | existing-options | m8-demux | M10, M15, M16 |
| [15-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) | Index Vector | catalog 승인 subset | existing-options | m8-index-vector | M10, M15, M16 |
| [15-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) | Manual Switch | 미구현 | preset | m8-manual-switch | M10, M15, M16 |
| [15-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) | Multiport Switch | 미구현 | new-primitive | m8-multiport | M10, M15, M16 |
| [15-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) | Mux | M1 정적 subset | existing-options | m8-mux | M10, M15, M16 |
| [15-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) | Selector | catalog 승인 subset | existing-options | m8-selector | M10, M15, M16 |
| [15-022](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) | Switch | M1 정적 subset | existing-options | m8-switch | M10, M15, M16 |
| [15-027](../dataset/Simulink_Basic_Blocks_R2024b.md#library-15) | Vector Concatenate | M1 정적 subset | existing-options | m8-vector-concat | M10, M15, M16 |
| [17-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Constant | M1 정적 subset | existing-options | m8-constant | M10, M15, M16 |
| [17-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Ground | 미구현 | preset | m8-constant | M10, M15, M16 |
| [19-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-19) | Fcn | M1 AST 독립 대체 subset | independent-alternative | m8-fcn | M10, M14, M15, M16 |
| [20-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) | Decrement Real World | 미구현 | preset | m8-increment | M10, M15, M16 |
| [20-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) | Decrement To Zero | 미구현 | preset | m8-increment | M10, M15, M16 |
| [20-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) | Increment Real World | 미구현 | preset | m8-increment | M10, M15, M16 |
| [21-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) | Eulers Number | 미구현 | preset | m8-constant | M10, M15, M16 |
| [21-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) | One | 미구현 | preset | m8-constant | M10, M15, M16 |
| [21-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) | Pi | M1 preset subset | preset | m8-constant | M10, M15, M16 |
| [21-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) | Zero | M1 preset subset | preset | m8-constant | M10, M15, M16 |
| [21-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) | Square Root | 미구현 | preset | m8-sqrt | M10, M15, M16 |
| [21-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) | Signed Square Root | 미구현 | preset | m8-sqrt | M10, M15, M16 |
| [21-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) | Reciprocal Square Root | 미구현 | preset | m8-sqrt | M10, M15, M16 |

## 종료 조건과 검증

- 검토된 최초 납품: P0 미구현 계산의 bounded 대응과 이번 구현이 선언한 모든 mode/shape/options를 compiler/runtime/JSON/UI/TS에서 독립 oracle로 검증; 추가 옵션 후보 전체 구현을 요구하는 gate가 아님
- 기존144 registry와71catalog fixture의 지원모드·수치값·JSON·actualTS 회귀; source row별 승격은 root가 evidence로 별도 결정
- 원본385행/339이름/datasetdigest 및 baseline status 보존; preset/definition/contract-family/kernel/원본행 별도 지표
- 선언한 mode/shape/options·domainfailure·resourcebudget·TS raw samples·JSON roundtrip 검증, Python은 선언된 subset만
- R2024b 미확정·설명 충돌은 승인범위를 subset/독립대체로 명시; 미확정 current-help 옵션을 최초 납품 blocker로 자동 추가하지 않음

engineering 납품과 전체 source 옵션 완료는 서로 다른 승인이다. `delivery`가 승인되어도 모든 `optionInventory` 후보 및 원본의 후속 M10~M16 gate가 자동 완료되지 않는다. 후보는 exact R2024b applicability와 구현 증거를 확인한 뒤 개별적으로 완료한다. 이름별 카드 수를 원본 완전 대응 수나 독립 엔진 수로 환산하지 않는다.
