# Simulink 기본 라이브러리 블록 목록

> **R2024b 기준 정리 · 구버전 및 추가 제품 조건 표시 · MathWorks 공식 문서 참조**  
> 작성일: 2026-10-01 · 블록 검색명: 영문 유지 · 설명: 한국어

## 읽기 전에

이 문서는 첨부 화면의 **Simulink 아래 21개 라이브러리 분류**에 맞추어, 공식 분류 색인의 블록과 문서에서 확인되는 대체 구성을 정리한 자료다. 여기서 “기본”은 **MATLAB + Simulink**를 뜻한다. MATLAB만 설치하면 Simulink까지 포함된다는 뜻은 아니다.

**기준판은 R2024b로 고정했다.** 최소 지원 릴리스가 지정되지 않았기 때문에, 최신 온라인 문서의 블록을 그대로 모아 모든 구버전에서도 된다고 표현하지 않았다. R2025/R2026에서만 추가된 블록은 기준 목록에 넣지 않는다. R2024b보다 이전 버전에 적용할 때는 각 행의 도입·편입 조건을 확인해야 한다.

**범위와 한계:** 1~20절은 기준판 공식 분류 색인의 항목을 중심으로 정리하고, 누락되기 쉬운 Add, Subtract, Cosine, Atomic Subsystem, XY Graph 등의 공식 대체 구성을 보완했다. 21절 Quick Insert는 공식 문서에서 소속을 확인한 별칭과 원본 블록의 대응표이며, 모든 릴리스의 Quick Insert 별칭 전체를 검증한 목록은 아니다. 각 블록의 최초 도입 버전도 전수 확정하지 않았다. 또한 작성 환경에 MATLAB이 없어 실제 설치판과 1:1 대조하거나 시뮬레이션으로 검증하지 않았다. **해당 PC에 존재하는 항목의 완전한 스냅샷이 필요하면 25절의 추출 코드와 발견 경고를 함께 확인한다.**

### 표기 규칙

| 표기 | 의미 |
| --- | --- |
| 기본 | 기준판 Simulink 분류에 수록된 항목. 일반 사용을 기준으로 하며, 모든 과거 릴리스 또는 모든 자료형·실행 모드 지원을 보장하지 않음 |
| R2022b+ 등의 버전 | 공식 색인의 Since 또는 개별 Version History에서 확인한 도입 하한. 블록의 이후 추가 파라미터까지 그 버전에서 지원한다는 뜻은 아님 |
| 편입 R2021b+ 등의 버전 | 다른 제품에서 **기본 Simulink 라이브러리로 들어온 시점**. 최초 개발 연도와 구분 |
| 구성 / 중복 | 동일 원본 블록의 사전 설정, 별칭 또는 다른 분류에서의 바로가기 |
| 조건 | 데이터형·연결 대상·사용자 코드·추가 기능에 따라 별도 제품이나 환경 조건이 있음 |
| 레거시 | 과거 모델 해석용. 제거 또는 제거 예정 때문에 신규 모델의 보편적 기본 선택에서 제외 |
| 도입 버전 미확정 / 기본만 표기 | 이 문서에서 정확한 구버전 하한을 확인하지 않은 것. “모든 구버전 사용 가능”을 의미하지 않음 |

### 추가 툴박스가 없다는 조건에서 특히 주의할 점

**일반 시뮬레이션과 코드 생성은 다르다.** 기본 블록 문서에 Simulink Coder, HDL Coder, Embedded Coder가 함께 나온다고 블록 자체가 해당 제품 전용인 것은 아니다. 반대로 블록을 사용할 수 있다고 외부 하드웨어용 C/HDL 코드 생성까지 기본 라이선스에 포함되는 것도 아니다.

**자료형에 따라 조건이 달라진다.** `double`, `single`, 내장 정수 등과 임의 스케일의 고정소수점 자료형을 구분한다. MathWorks는 고정소수점 모델을 해당 정밀도로 실행하는 데 Fixed-Point Designer가 필요하다고 설명하며, 내장 정수형으로 해석되는 일부 자료형은 예외로 명시한다. Sine/Cosine 조회표 블록처럼 기본 라이브러리에 있으나 출력이 고정소수점인 항목은 “조건”으로 분리했다. 부동소수점 오버라이드는 고정소수점과 동일한 비트 수준 동작을 보장하는 대체 방법이 아니다. [공식 자료형 및 실행 조건](https://www.mathworks.com/help/simulink/ug/specify-fixed-point-data-types.html)

---

## 분류 바로가기

| 번호 | 라이브러리 | 수록 행 수 |
| ---: | --- | ---: |
| 01 | [Commonly Used Blocks](#library-01) | 23 |
| 02 | [Continuous](#library-02) | 16 |
| 03 | [Dashboard](#library-03) | 37 |
| 04 | [Discontinuities](#library-04) | 14 |
| 05 | [Discrete](#library-05) | 21 |
| 06 | [Logic and Bit Operations](#library-06) | 22 |
| 07 | [Lookup Tables](#library-07) | 9 |
| 08 | [Math Operations](#library-08) | 38 |
| 09 | [Matrix Operations](#library-09) | 19 |
| 10 | [Messages & Events](#library-10) | 8 |
| 11 | [Model Verification](#library-11) | 11 |
| 12 | [Model-Wide Utilities](#library-12) | 5 |
| 13 | [Ports & Subsystems](#library-13) | 29 |
| 14 | [Signal Attributes](#library-14) | 14 |
| 15 | [Signal Routing](#library-15) | 27 |
| 16 | [Sinks](#library-16) | 11 |
| 17 | [Sources](#library-17) | 27 |
| 18 | [String](#library-18) | 16 |
| 19 | [User-Defined Functions](#library-19) | 15 |
| 20 | [Additional Math & Discrete](#library-20) | 9 |
| 21 | [Quick Insert](#library-21) | 14 |

**수록 행 수 합계: 385행.** 조건부·레거시·설정 변형과 분류 간 중복을 포함한 문서 행 수다. 독립 기능 블록 수 또는 모든 설치판의 블록 총수가 아니다. 22~25절의 보조 표와 코드는 이 합계에 포함하지 않았다.

[22. 서브시스템 내부 제어 블록](#internal-blocks) · [23. 레거시 항목](#legacy) · [24. 구버전 적용 원칙](#compatibility) · [25. 실제 설치판 확인 및 MD 추출](#local-inventory) · [출처](#sources)

---

<a id="library-01"></a>

## 01. Commonly Used Blocks

자주 사용하는 블록을 모은 바로가기 분류. 아래 블록들은 원래 기능별 라이브러리에도 나타난다.

공식 색인: [Commonly Used Blocks](https://www.mathworks.com/help/simulink/commonly-used-blocks.html)

`Commonly Used Blocks`는 별도 추가 툴박스가 아니다. `Slider Gain`은 이 분류가 아니라 **Math Operations**, `MATLAB Function`은 **User-Defined Functions**에서 찾는다. 이 절의 바로가기 목록은 공식 Commonly Used Blocks 색인으로 보완했으며, 기준판의 기능별 원본 블록 목록과 구분한다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Bus Creator | 기본 |
| Bus Selector | 기본 |
| Constant | 기본 |
| Data Type Conversion | 기본 |
| Delay | 기본 |
| Demux | 기본 |
| Discrete-Time Integrator | 기본 |
| Gain | 기본 |
| Ground | 기본 |
| Inport | 기본 · 화면의 초기 이름은 보통 `In1` |
| Integrator | 기본 |
| Logical Operator | 기본 |
| Mux | 기본 |
| Outport | 기본 · 화면의 초기 이름은 보통 `Out1` |
| Product | 기본 · Matrix Multiply와 같은 블록 계열이나 곱셈 설정은 다름 |
| Relational Operator | 기본 |
| Saturation | 기본 |
| Scope | 기본 |
| Subsystem | 기본 |
| Sum | 기본 |
| Switch | 기본 |
| Terminator | 기본 |
| Vector Concatenate | 기본 |

---

<a id="library-02"></a>

## 02. Continuous

연속시간 미분·적분, 전달함수, 상태공간 및 시간 지연.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/continuous.html) · [현행 문서](https://www.mathworks.com/help/simulink/continuous.html)

PID 제어 블록의 기본 사용과 PID Tuner/자동 튜닝을 구분한다. 공식 문서의 [PID Controller](https://www.mathworks.com/help/simulink/slref/pidcontroller.html)에서 기능별 제품 조건을 확인한다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Derivative | 기본 |
| Descriptor State-Space | 기본 |
| First Order Hold | 기본 |
| Integrator | 기본 |
| Integrator Limited | 구성 · Integrator의 출력 제한 설정 |
| PID Controller | 기본 · 계수 직접 입력과 시뮬레이션 기준. 자동 튜닝 기능은 별도 제품 조건 |
| PID Controller (2DOF) | 기본 · 자동 튜닝 기능은 별도 제품 조건 |
| Second-Order Integrator | 기본 |
| Second-Order Integrator Limited | 구성 · Second-Order Integrator의 제한 설정 |
| State-Space | 기본 |
| Transfer Fcn | 기본 |
| Transport Delay | 기본 |
| Variable Time Delay | 기본 |
| Variable Transport Delay | 기본 |
| Zero-Pole | 기본 |

### 문서에 함께 나타나지만 무조건적인 기본 사용 목록에서 분리한 항목

Continuous 공식 색인에는 이 항목도 연결된다. 그러나 추가 제품 없이 임의의 엔터티 모델을 작성·실행할 수 있다고 보장하지 않는다. 해당 블록과 연결하는 엔터티 블록의 제품 조건까지 확인한다.

근거: [MathWorks 공식 문서](https://www.mathworks.com/help/simulink/slref/entitytransportdelay.html)

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Entity Transport Delay | 조건 · R2019b 도입. 엔터티/메시지 지연과 SimEvents 연계 항목. 일반 신호용 Transport Delay의 동의어가 아님 |

---

<a id="library-03"></a>

## 03. Dashboard

모델의 파라미터 조작과 신호 표시를 위한 버튼·스위치·계기판.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/dashboard.html) · [현행 문서](https://www.mathworks.com/help/simulink/dashboard.html)

일반 Dashboard와 Customizable Blocks는 이름이 같아도 별개의 라이브러리 항목이다. 아래 도입 버전을 일반 Dashboard의 같은 이름 블록에 적용하면 안 된다. 일반 Dashboard의 각 블록에 대한 최초 도입 버전은 이 문서에서 일괄 확정하지 않았다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Callback Button | 기본 |
| Check Box | 기본 |
| Combo Box | 기본 |
| Dashboard Scope | 기본 |
| Display | 기본 · Sinks의 Display와 다른 Dashboard 블록 |
| Edit | 기본 |
| Gauge | 기본 |
| Half Gauge | 기본 |
| Knob | 기본 |
| Lamp | 기본 |
| Linear Gauge | 기본 |
| MultiStateImage | 기본 |
| Push Button | 기본 |
| Quarter Gauge | 기본 |
| Radio Button | 기본 |
| Rocker Switch | 기본 |
| Rotary Switch | 기본 |
| Slider | 기본 |
| Slider Switch | 기본 |
| Toggle Switch | 기본 |

### Customizable Blocks

라이브러리 경로: `Simulink / Dashboard / Customizable Blocks`. 모양을 사용자화할 수 있는 계기판 항목이다. R2025 이후에 추가된 항목은 넣지 않았다.

근거: [MathWorks 공식 문서](https://www.mathworks.com/help/releases/R2024b/simulink/customizable-blocks.html)

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Callback Button | R2021b+ |
| Check Box | R2024b+ |
| Circular Gauge | R2020b+ |
| Display | R2023b+ |
| Half Gauge | R2024a+ |
| Horizontal Gauge | R2020a+ |
| Horizontal Slider | R2021a+ |
| Knob | R2021a+ |
| Lamp | R2021b+ |
| Push Button | R2021b+ |
| Quarter Gauge | R2024a+ |
| Rocker Switch | R2021b+ |
| Rotary Switch | R2021b+ |
| Slider Switch | R2021b+ |
| Toggle Switch | R2021b+ |
| Vertical Gauge | R2020a+ |
| Vertical Slider | R2021a+ |

---

<a id="library-04"></a>

## 04. Discontinuities

포화, 데드존, 마찰, 양자화, 변화율 제한 및 불연속 신호 처리.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/discontinuities.html) · [현행 문서](https://www.mathworks.com/help/simulink/discontinuities.html)

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Backlash | 기본 |
| Coulomb and Viscous Friction | 기본 |
| Dead Zone | 기본 |
| Dead Zone Dynamic | 기본 |
| Hit Crossing | 기본 |
| PWM | R2020b+ |
| Quantizer | 기본 |
| Rate Limiter | 기본 |
| Rate Limiter Dynamic | 기본 |
| Relay | 기본 |
| Saturation | 기본 |
| Saturation Dynamic | 기본 |
| Variable Pulse Generator | R2020b+ |
| Wrap To Zero | 기본 |

---

<a id="library-05"></a>

## 05. Discrete

샘플 기반 지연·차분·필터·이산시간 동적 시스템.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/discrete.html) · [현행 문서](https://www.mathworks.com/help/simulink/discrete.html)

`Memory`, `Unit Delay`, `Delay`는 이름만 다른 동등한 블록이 아니다. `Discrete-Time Integrator`의 적분 방식·외부 리셋·출력 제한 등은 블록 파라미터이며, 가능한 모든 파라미터 조합을 새 블록으로 세지 않는다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Delay | 기본 |
| Difference | 기본 |
| Discrete Derivative | 기본 |
| Discrete FIR Filter | 기본 · Simulink에 포함된 블록. DSP System Toolbox 전용 FIR 블록과 구분 |
| Discrete Filter | 기본 |
| Discrete PID Controller | 기본 · 자동 튜닝은 별도 제품 조건 |
| Discrete PID Controller (2DOF) | 기본 · 자동 튜닝은 별도 제품 조건 |
| Discrete State-Space | 기본 |
| Discrete Transfer Fcn | 기본 |
| Discrete Zero-Pole | 기본 |
| Discrete-Time Integrator | 기본 |
| Memory | 기본 |
| Propagation Delay | R2022b+ |
| Resettable Delay | 기본 |
| Tapped Delay | 기본 |
| Transfer Fcn First Order | 기본 |
| Transfer Fcn Lead or Lag | 기본 |
| Transfer Fcn Real Zero | 기본 |
| Unit Delay | 기본 |
| Variable Integer Delay | 기본 |
| Zero-Order Hold | 기본 |

---

<a id="library-06"></a>

## 06. Logic and Bit Operations

논리 연산, 비교, 에지 검출, 비트 조작 및 정수/비트 변환.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/logic-and-bit-operations.html) · [현행 문서](https://www.mathworks.com/help/simulink/logic-and-bit-operations.html)

[Bit to Integer Converter](https://www.mathworks.com/help/simulink/slref/bittointegerconverter.html)와 [Integer to Bit Converter](https://www.mathworks.com/help/simulink/slref/integertobitconverter.html)는 오래전에 도입됐지만 **기본 Simulink에 들어온 시점은 R2022a**다. `Introduced before R2006a`만 보고 R2020b 기본 블록이라고 분류하면 안 된다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Bit Clear | 기본 |
| Bit Set | 기본 |
| Bit to Integer Converter | 편입 R2022a+ · 그 이전 Communications Toolbox 소속 |
| Bitwise Operator | 기본 |
| Combinatorial Logic | 기본 |
| Compare To Constant | 기본 |
| Compare To Zero | 기본 |
| Detect Change | 기본 |
| Detect Decrease | 기본 |
| Detect Fall Negative | 기본 |
| Detect Fall Nonpositive | 기본 |
| Detect Increase | 기본 |
| Detect Rise Nonnegative | 기본 |
| Detect Rise Positive | 기본 |
| Extract Bits | 기본 |
| Float Extract Bits | R2023a+ |
| Integer to Bit Converter | 편입 R2022a+ · 그 이전 Communications Toolbox 소속 |
| Interval Test | 기본 |
| Interval Test Dynamic | 기본 |
| Logical Operator | 기본 |
| Relational Operator | 기본 |
| Shift Arithmetic | 기본 |

---

<a id="library-07"></a>

## 07. Lookup Tables

표 기반 함수 근사·보간·전처리 및 표 조회.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/lookup-tables.html) · [현행 문서](https://www.mathworks.com/help/simulink/lookup-tables.html)

[Sine / Cosine 공식 문서](https://www.mathworks.com/help/simulink/slref/sine.html)는 출력이 고정소수점임을 명시한다. 라이브러리에 보인다는 사실과 Fixed-Point Designer 없이 해당 고정소수점 설정으로 실행할 수 있다는 사실은 다르다. 일반 부동소수점 사인·코사인 계산은 `Trigonometric Function`, 시간에 따른 파형 생성은 Sources의 `Sine Wave`를 사용한다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| 1-D Lookup Table | 기본 |
| 2-D Lookup Table | 기본 |
| Cosine | 구성/조건 · Sine의 코사인 출력 설정. 고정소수점 실행 조건 확인 |
| Direct Lookup Table (n-D) | 기본 |
| Interpolation Using Prelookup | 기본 |
| Lookup Table Dynamic | 기본 |
| Prelookup | 기본 |
| Sine | 조건 · 고정소수점 출력용 조회표 블록. 무추가제품 일반 사용에는 Trigonometric Function 등을 우선 |
| n-D Lookup Table | 기본 |

---

<a id="library-08"></a>

## 08. Math Operations

스칼라·벡터·행렬 산술, 복소수 변환 및 수학 함수.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/math-operations.html) · [현행 문서](https://www.mathworks.com/help/simulink/math-operations.html)

공식 분류 색인에서 하나의 문서로 합쳐 보이는 항목도 실제 검색 이름이 다르면 나누어 적었다. [Sum의 대체 구성](https://www.mathworks.com/help/simulink/slref/sum.html), [Sqrt의 대체 구성](https://www.mathworks.com/help/simulink/slref/sqrt.html), [Product / Matrix Multiply](https://www.mathworks.com/help/simulink/slref/product.html)를 함께 참조한다. `Sine Wave Function`은 Sources의 `Sine Wave`와 구분한다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Abs | 기본 |
| Add | 구성 · Sum의 직사각형 덧셈 구성 |
| Algebraic Constraint | 기본 |
| Assignment | 기본 |
| Bias | 기본 |
| Complex to Magnitude-Angle | 기본 |
| Complex to Real-Imag | 기본 |
| Divide | 기본 |
| Dot Product | 기본 |
| Find Nonzero Elements | 기본 |
| Gain | 기본 |
| Magnitude-Angle to Complex | 기본 |
| Math Function | 기본 |
| Matrix Concatenate | 기본 |
| Matrix Multiply | 구성 · Product의 행렬 곱셈 구성 |
| MinMax | 기본 |
| MinMax Running Resettable | 기본 |
| Permute Dimensions | 기본 |
| Polynomial | 기본 |
| Product | 기본 |
| Product of Elements | 기본 |
| Real-Imag to Complex | 기본 |
| Reciprocal Sqrt | 구성 · Sqrt의 역제곱근 구성 |
| Reshape | 기본 |
| Rounding Function | 기본 |
| Sign | 기본 |
| Signed Sqrt | 구성 · Sqrt의 부호 있는 제곱근 구성 |
| Sine Wave Function | 기본 |
| Slider Gain | 기본 · Commonly Used Blocks가 아닌 이 분류에 있음 |
| Sqrt | 기본 |
| Squeeze | 기본 |
| Subtract | 구성 · Sum의 뺄셈 구성 |
| Sum | 기본 |
| Sum of Elements | 구성 · Sum의 입력 요소 합산 구성 |
| Trigonometric Function | 기본 |
| Unary Minus | 기본 |
| Vector Concatenate | 기본 |
| Weighted Sample Time Math | 기본 |

---

<a id="library-09"></a>

## 09. Matrix Operations

행렬 생성·변환·부분 선택과 배열/주변영역 처리.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/matrix-operations.html) · [현행 문서](https://www.mathworks.com/help/simulink/matrix-operations.html)

이 분류를 통째로 모든 구버전의 기본 라이브러리라고 가정하지 않는다. 편입 시점의 근거: [Create Diagonal Matrix](https://www.mathworks.com/help/simulink/slref/creatediagonalmatrix.html), [Extract Diagonal](https://www.mathworks.com/help/simulink/slref/extractdiagonal.html), [Matrix Square](https://www.mathworks.com/help/simulink/slref/matrixsquare.html), [Permute Matrix](https://www.mathworks.com/help/simulink/slref/permutematrix.html), [Submatrix](https://www.mathworks.com/help/simulink/slref/submatrix.html)의 Version History. 구버전에서는 Product, Selector, Reshape, Math Function 등을 조합하는 방안을 검토한다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Array Processing Subsystem | R2024a+ |
| Create Diagonal Matrix | 편입 R2021b+ · 그 이전 DSP System Toolbox 소속 |
| Cross Product | R2021b+ |
| Expand Scalar | R2024a+ |
| Extract Diagonal | 편입 R2021b+ · 그 이전 DSP System Toolbox 소속 |
| Hermitian Transpose | R2021b+ |
| Identity Matrix | R2021b+ |
| IsHermitian | R2022a+ |
| IsSymmetric | R2021b+ |
| IsTriangular | R2021b+ |
| Matrix Concatenate | 기본 · Math Operations에도 있음. 이 분류 자체의 구버전 존재 여부와 구분 |
| Matrix Multiply | 구성 · Product 계열. 구버전에서는 Math Operations에서 확인 |
| Matrix Square | 편입 R2021b+ · 그 이전 DSP System Toolbox 소속 |
| Neighborhood Processing Subsystem | R2022b+ |
| Permute Matrix | 편입 R2021b+ · 그 이전 DSP System Toolbox 소속 |
| Pixel Processing Subsystem | R2024a+ |
| Product | 기본 · Math Operations에도 있음 |
| Submatrix | 편입 R2021b+ · 그 이전 DSP System Toolbox 소속 |
| Transpose | R2021b+ |

---

<a id="library-10"></a>

## 10. Messages & Events

메시지 전송·수신·큐잉과 이벤트 기반 실행.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/messages-and-events.html) · [현행 문서](https://www.mathworks.com/help/simulink/messages-and-events.html)

[Simulink Messages Overview](https://www.mathworks.com/help/simulink/ug/simulink-messages-overview.html)는 Simulink의 Send/Receive/Queue 사용과 SimEvents 기반 네트워크·미들웨어 모델링을 구분한다. 메시지 블록을 전부 SimEvents 전용으로 제외하지도, 모든 엔터티 기능을 기본으로 포함하지도 않는다. Queue/Send 문서의 최초 도입 표기와 **추가 제품 없이 사용 가능해진 시점**을 동일하게 단정하지 않았다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Hit Crossing | 기본 |
| Hit Scheduler | R2022b+ |
| Message Merge | R2021a+ |
| Message Triggered Subsystem | R2022a+ |
| Queue | 기본 메시지 사용 / 조건 · 엔터티 및 고급 라우팅은 SimEvents 조건 확인. 제품 편입의 정확한 최초 버전은 별도 확인 필요 |
| Receive | 기본 메시지 사용 · 구버전 제품 구성 및 메시지 기능 확인 |
| Send | 기본 메시지 사용 · 구버전 제품 구성 및 메시지 기능 확인 |
| Sequence Viewer | 기본 · 메시지/이벤트 시퀀스 표시 |

---

<a id="library-11"></a>

## 11. Model Verification

모델 실행 중 값·범위·변화량 등의 조건을 검사하는 블록.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/model-verification.html) · [현행 문서](https://www.mathworks.com/help/simulink/model-verification.html)

이 목록의 기본 실행 중 검사 블록과 별도 제품인 Simulink Design Verifier의 형식 검증·시험 생성 기능은 구분한다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Assertion | 기본 |
| Check Discrete Gradient | 기본 |
| Check Dynamic Gap | 기본 |
| Check Dynamic Lower Bound | 기본 |
| Check Dynamic Range | 기본 |
| Check Dynamic Upper Bound | 기본 |
| Check Input Resolution | 기본 |
| Check Static Gap | 기본 |
| Check Static Lower Bound | 기본 |
| Check Static Range | 기본 |
| Check Static Upper Bound | 기본 |

---

<a id="library-12"></a>

## 12. Model-Wide Utilities

모델 문서화·정보 표시·자료형 지원 확인·기본 선형화.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/model-wide-utilities.html) · [현행 문서](https://www.mathworks.com/help/simulink/model-wide-utilities.html)

공식 문서의 제목은 [Timed-Based Linearization](https://www.mathworks.com/help/simulink/slref/timedbasedlinearization.html)이다. 일반 문장에서 쓰는 “Time-Based”를 근거로 실행용 소스 경로를 임의로 만들지 않는다. 이 블록과 [Trigger-Based Linearization](https://www.mathworks.com/help/simulink/slref/triggerbasedlinearization.html)은 기본 `linmod`/`dlinmod` 계열 기능이며, 전체 선형화 기능을 제공하는 Simulink Control Design과 구분된다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Block Support Table | 유틸리티 · 데이터형 지원표를 여는 라이브러리 항목 |
| DocBlock | 유틸리티 · 모델에 문서 저장 |
| Model Info | 유틸리티 · 모델 속성 및 설명 표시 |
| Timed-Based Linearization | 기본 선형화 · 공식 문서의 표기를 유지함 |
| Trigger-Based Linearization | 기본 선형화 · 고급 선형화 도구와 구분 |

---

<a id="library-13"></a>

## 13. Ports & Subsystems

입출력 포트, 모델 계층, 조건부·반복·함수 호출 실행 및 변형 구성.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/ports-and-subsystems.html) · [현행 문서](https://www.mathworks.com/help/simulink/ports-and-subsystems.html)

[Subsystem 공식 문서](https://www.mathworks.com/help/simulink/slref/subsystem.html)는 Atomic Subsystem과 Subsystem Reference 등 대체 구성을 별도로 설명한다. 공식 분류 색인에서 Subsystem 한 행으로 묶여 보일 수 있어 이 두 이름을 보완했다. 서브시스템 안의 포트·반복 제어 블록은 22절에서 따로 정리하며, 서브시스템의 모든 구현용 내부 블록까지 새 라이브러리 항목으로 세지는 않는다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Atomic Subsystem | 구성 · Subsystem의 atomic 실행 구성 |
| Enable | 기본 |
| Enabled Subsystem | 기본 |
| Enabled and Triggered Subsystem | 기본 |
| For Each Subsystem | 기본 |
| For Iterator Subsystem | 기본 |
| Function Element | R2022a+ |
| Function Element Call | R2022a+ |
| Function-Call Feedback Latch | 기본 |
| Function-Call Generator | 기본 |
| Function-Call Split | 기본 |
| Function-Call Subsystem | 기본 |
| If | 기본 |
| If Action Subsystem | 기본 |
| In Bus Element | 기본 |
| Inport | 기본 · 배치 후 초기 이름은 보통 In1 |
| Model | 기본 |
| Out Bus Element | 기본 |
| Outport | 기본 · 배치 후 초기 이름은 보통 Out1 |
| Resettable Subsystem | 기본 |
| Subsystem | 기본 |
| Subsystem Reference | 구성 · 별도 subsystem 파일을 참조. 도입 버전 미확정; 매우 오래된 버전에서 존재를 가정하지 않음 |
| Switch Case | 기본 |
| Switch Case Action Subsystem | 기본 |
| Trigger | 기본 |
| Triggered Subsystem | 기본 |
| Unit System Configuration | 기본 |
| Variant Subsystem | 기본 |
| While Iterator Subsystem | 기본 |

---

<a id="library-14"></a>

## 14. Signal Attributes

신호의 자료형·단위·차원·샘플시간·초기값 및 표현 방식.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/signal-attributes.html) · [현행 문서](https://www.mathworks.com/help/simulink/signal-attributes.html)

`Data Type Conversion`은 자료형 변환이고, `Signal Conversion`은 값은 유지하면서 신호/버스의 표현 방식을 바꾸는 블록이다. 임의 정밀도 고정소수점 실행은 Fixed-Point Designer 조건을 따른다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Bus to Vector | 기본 |
| Data Type Conversion | 기본 |
| Data Type Conversion Inherited | 기본 |
| Data Type Duplicate | 기본 |
| Data Type Propagation | 기본 |
| Data Type Scaling Strip | 조건 · 고정소수점 관련 사용 시 제품 및 데이터형 조건 확인 |
| IC | 기본 |
| Probe | 기본 |
| Rate Transition | 기본 |
| Signal Conversion | 기본 |
| Signal Specification | 기본 |
| Unit Conversion | 기본 |
| Weighted Sample Time | 기본 |
| Width | 기본 |

---

<a id="library-15"></a>

## 15. Signal Routing

버스 구성·분해, 신호 선택·분기, 저장소, 태그 연결과 변형 경로.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/signal-routing.html) · [현행 문서](https://www.mathworks.com/help/simulink/signal-routing.html)

공식 색인에 남아 있는 **Environment Controller (Removed)**는 현재 사용 가능한 블록으로 넣지 않았다. 레거시 항목은 23절 참조. `Mux`와 `Bus Creator`, `Merge`와 `Switch`는 각각 동등한 대체 블록이 아니므로 이름만 보고 교체하지 않는다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Bus Assignment | 기본 |
| Bus Creator | 기본 |
| Bus Selector | 기본 |
| Data Store Memory | 기본 |
| Data Store Read | 기본 |
| Data Store Write | 기본 |
| Demux | 기본 |
| From | 기본 |
| Goto | 기본 |
| Goto Tag Visibility | 기본 |
| Index Vector | 기본 |
| Manual Switch | 기본 |
| Manual Variant Sink | 기본 |
| Manual Variant Source | 기본 |
| Merge | 기본 |
| Multiport Switch | 기본 |
| Mux | 기본 |
| Parameter Writer | 기본 · 구버전 최초 도입 미확정 |
| Selector | 기본 |
| State Reader | 기본 · 구버전 최초 도입 미확정 |
| State Writer | 기본 · 구버전 최초 도입 미확정 |
| Switch | 기본 |
| Variant End | R2024a+ |
| Variant Sink | 기본 |
| Variant Source | 기본 |
| Variant Start | R2024a+ |
| Vector Concatenate | 기본 |

---

<a id="library-16"></a>

## 16. Sinks

결과 표시·기록·출력과 시뮬레이션 정지.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/sinks.html) · [현행 문서](https://www.mathworks.com/help/simulink/sinks.html)

공식 색인의 “Floating Scope and Scope Viewer”는 문서 제목이다. **Scope Viewer는 신호에 연결하는 뷰어 기능**이므로 일반 블록과 똑같은 추가 독립 블록으로 합산하지 않는다. [Record 문서](https://www.mathworks.com/help/simulink/slref/record.html)는 XY Graph의 R2021b 구현 변경을 명시한다. Record의 도입 연도를 기존 XY Graph의 최초 도입 연도로 오해하지 않는다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Display | 기본 · Dashboard의 Display와 구분 |
| Floating Scope | 기본 · Scope Viewer 관련 설명은 같은 공식 문서에서 제공 |
| Out Bus Element | 기본 |
| Outport | 기본 |
| Record | R2021a+ |
| Scope | 기본 |
| Stop Simulation | 기본 |
| Terminator | 기본 |
| To File | 기본 |
| To Workspace | 기본 |
| XY Graph | 기본 이름은 구버전에도 존재. R2021b부터 Record의 XY 표시 구성으로 대체 |

---

<a id="library-17"></a>

## 17. Sources

상수·시간·수학 파형·난수 생성 및 외부 데이터 입력.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/sources.html) · [현행 문서](https://www.mathworks.com/help/simulink/sources.html)

과거 교재의 `Signal Builder`는 별도 레거시 절에 남겼다. 새로운 모델에서는 Signal Editor 또는 From Workspace 등으로 구분한다. [Signal Editor](https://www.mathworks.com/help/simulink/slref/signaleditorblock.html) Version History에 도입 버전이 명시된다. “Function Block”이라는 이름의 일반 MATLAB 코드 블록을 Sources에 있다고 가정하지 않는다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Band-Limited White Noise | 기본 |
| Chirp Signal | 기본 |
| Clock | 기본 |
| Constant | 기본 |
| Counter Free-Running | 기본 |
| Counter Limited | 기본 |
| Digital Clock | 기본 |
| Enumerated Constant | 기본 |
| From File | 기본 |
| From Spreadsheet | 기본 · 외부 파일/파일 형식 지원 조건 확인 |
| From Workspace | 기본 |
| Ground | 기본 |
| In Bus Element | 기본 |
| Inport | 기본 |
| Playback | R2022b+ |
| Pulse Generator | 기본 |
| Ramp | 기본 |
| Random Number | 기본 |
| Repeating Sequence | 기본 |
| Repeating Sequence Interpolated | 기본 |
| Repeating Sequence Stair | 기본 |
| Signal Editor | R2017b+ |
| Signal Generator | 기본 |
| Sine Wave | 기본 |
| Step | 기본 |
| Uniform Random Number | 기본 |
| Waveform Generator | 기본 · 최초 도입 버전 미확정 |

---

<a id="library-18"></a>

## 18. String

문자열 생성·변환·조합·검색·비교 및 부분 문자열 처리.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/string.html) · [현행 문서](https://www.mathworks.com/help/simulink/string.html)

이 분류의 존재와 개별 문자열 블록 도입 시점을 모든 과거 버전에 소급하지 않는다. `String Contains`와 `String Count` 외 항목의 최초 도입 버전은 이 문서에서 일괄 확정하지 않았다. 구버전의 문자열 자료형 지원 및 ASCII/문자열 제한은 대상 릴리스 문서를 따른다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| ASCII to String | 기본 |
| Compose String | 기본 |
| Scan String | 기본 |
| String Compare | 기본 |
| String Concatenate | 기본 |
| String Constant | 기본 |
| String Contains | R2020a+ |
| String Count | R2020a+ |
| String Find | 기본 |
| String Length | 기본 |
| String to ASCII | 기본 |
| String to Double | 기본 |
| String to Enum | 기본 |
| String to Single | 기본 |
| Substring | 기본 |
| To String | 기본 |

---

<a id="library-19"></a>

## 19. User-Defined Functions

MATLAB/C/C++ 알고리즘, System object 및 S-function을 모델에 결합.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/user-defined-functions.html) · [현행 문서](https://www.mathworks.com/help/simulink/user-defined-functions.html)

블록 자체의 포함 여부와 **사용자가 그 안에서 호출하는 함수·System object·외부 코드의 의존성**은 다르다. 예를 들어 MATLAB System이 보인다고 모든 DSP/통신 System object를 추가 제품 없이 사용할 수 있는 것은 아니다. 코드 생성 기능의 라이선스 역시 일반 시뮬레이션과 구분한다.

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| C Caller | 기본 · 호출할 C 코드 및 지원 컴파일러가 별도로 필요할 수 있음 |
| C Function | R2020a+ · 사용자 C 코드/컴파일러 조건 |
| Fcn | 기본 |
| Function Caller | 기본 |
| Initialize Function | 기본 |
| Interpreted MATLAB Function | 레거시 · R2024b 문서에 제거 예정으로 표시. 신규 모델의 기본 선택에서 제외 |
| Level-2 MATLAB S-Function | 기본 |
| MATLAB Function | 기본 · 이 블록 자체를 Stateflow Chart와 혼동하지 않음 |
| MATLAB System | 조건 · 사용하는 System object 자체가 별도 툴박스에 속하면 해당 제품 필요 |
| Reinitialize Function | R2022a+ |
| Reset Function | 기본 |
| S-Function | 기본 |
| S-Function Builder | 기본 · 외부 컴파일러 및 사용자 코드 조건 |
| Simulink Function | 기본 |
| Terminate Function | 기본 |

---

<a id="library-20"></a>

## 20. Additional Math & Discrete

보조 이산시간 구현과 증가·감소 연산. 아래 하위 폴더로 구성된다.

공식 색인: [R2024b](https://www.mathworks.com/help/releases/R2024b/simulink/additional-math-and-discrete.html) · [현행 문서](https://www.mathworks.com/help/simulink/additional-math-and-discrete.html)

`Fixed-Point`라는 이름이 들어 있다고 이 분류 전체를 별도 툴박스로 제외하지 않는다. [Fixed-Point State-Space](https://www.mathworks.com/help/simulink/slref/fixedpointstatespace.html)는 부동소수점 설정도 지원한다. 반대로 고정소수점으로 실제 실행할 때 필요한 제품 조건까지 무시해서는 안 된다.

### Additional Discrete

근거: [MathWorks 공식 문서](https://www.mathworks.com/help/releases/R2024b/simulink/additional-math-and-discrete.html)

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Fixed-Point State-Space | 기본/조건 · 기본 double 설정 가능. 고정소수점 실행은 별도 제품 조건 |
| Transfer Fcn Direct Form II | 기본 |
| Transfer Fcn Direct Form II Time Varying | 기본 |

### Additional Math / Increment - Decrement

근거: [MathWorks 공식 문서](https://www.mathworks.com/help/releases/R2024b/simulink/additional-math-and-discrete.html)

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Decrement Real World | 기본 |
| Decrement Stored Integer | 조건 · 저장 정수값/스케일링 의미 및 고정소수점 조건 확인 |
| Decrement Time To Zero | 기본 |
| Decrement To Zero | 기본 |
| Increment Real World | 기본 |
| Increment Stored Integer | 조건 · 저장 정수값/스케일링 의미 및 고정소수점 조건 확인 |

---

<a id="library-21"></a>

## 21. Quick Insert

기존 기본 블록에 이름 또는 파라미터 구성을 붙여 빠르게 삽입하는 하위 라이브러리. 편집 화면의 검색 메뉴와 관련되지만, 단순한 메뉴 설명만으로 대신할 수는 없다.

**검증 범위:** 이 절의 이름은 개별 공식 블록 문서에서 Quick Insert 소속이 명시된 사전 구성이다. Quick Insert의 모든 릴리스별 별칭을 완전 열거한 목록은 아니다. 공개 분류 색인이 각 설치판의 전체 별칭을 제공하지 않으므로, 문서에 확인되지 않은 이름과 경로를 만들어 넣지 않았다. 원본 기능 블록은 앞 절에 수록했고, 추가 사전 구성은 아래 파라미터 대응표로 보완한다. 설치된 버전에서 보이는 **모든 실제 별칭**까지 필요한 경우 25절의 로컬 추출 코드를 함께 사용한다. 이 구분 때문에 문서의 총 행 수를 Simulink의 독립 블록 총수라고 해석해서는 안 된다.

### Sources — Constant의 사전 구성

근거: [MathWorks 공식 문서](https://www.mathworks.com/help/simulink/slref/constant.html)

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Eulers Number | 구성 · Constant 값 `exp(1)` |
| Inf | 구성 · Constant 값 `inf` |
| NaN | 구성 · Constant 값 `NaN` |
| Negative Inf | 구성 · Constant 값 `-inf` |
| One | 구성 · Constant 값 `1` |
| Pi | 구성 · Constant 값 `pi` |
| Zero | 구성 · Constant 값 `0` |

### Math Operations — Sqrt의 사전 구성

근거: [MathWorks 공식 문서](https://www.mathworks.com/help/simulink/slref/sqrt.html)

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Square Root | 구성 · Sqrt와 이름만 다른 구성 |
| Signed Square Root | 구성 · Sqrt의 `signedSqrt`, Math Operations의 Signed Sqrt에 대응 |
| Reciprocal Square Root | 구성 · Sqrt의 `rSqrt`, Math Operations의 Reciprocal Sqrt에 대응 |

### Signal Attributes — Signal Conversion의 사전 구성

근거: [MathWorks 공식 문서](https://www.mathworks.com/help/simulink/slref/signalconversion.html)

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Signal Copy | 구성 · Signal Conversion의 `Signal copy` |
| To Virtual Bus | 구성 · Signal Conversion의 `Virtual bus` |
| To Nonvirtual Bus | 구성 · Signal Conversion의 `Nonvirtual bus` |

### Discrete — 중복 접근 항목

근거: [MathWorks 공식 문서](https://www.mathworks.com/help/simulink/slref/discretestatespace.html)

| 블록명 | 구버전·사용 조건 |
| --- | --- |
| Discrete State-Space | 중복 · 공식 문서에 Discrete와 Quick Insert / Discrete가 함께 기재됨 |

### 원본 블록 파라미터 대응표

아래는 **블록의 설정값 목록**이다. 모든 값이 같은 이름의 독립 Quick Insert 블록으로 존재한다고 주장하는 표가 아니다. 설치판에서 별칭이 보이지 않을 때 원본 블록을 배치해 설정할 수 있도록 수록했다. 개별 함수 옵션도 오래된 릴리스에서는 차이가 있을 수 있다.

| 원본 블록 | 설정값 또는 기능 | 사용 방법 |
| --- | --- | --- |
| [Math Function](https://www.mathworks.com/help/simulink/slref/mathfunction.html) | `exp`, `log`, `2^u`, `10^u`, `log10`, `magnitude^2`, `square`, `pow`, `conj`, `reciprocal`, `hypot`, `rem`, `mod`, `transpose`, `hermitian` | 수학 함수 선택. `pow` 등의 설정을 확인하며 별칭 경로를 추측하지 않음 |
| [Trigonometric Function](https://www.mathworks.com/help/simulink/slref/trigonometricfunction.html) | `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2`, `sinh`, `cosh`, `tanh`, `asinh`, `acosh`, `atanh`, `sincos` | 대상 구버전에서 제공되는 Function 옵션을 확인 |
| [Logical Operator](https://www.mathworks.com/help/simulink/slref/logicaloperator.html) | `AND`, `OR`, `NAND`, `NOR`, `XOR`, `NXOR`, `NOT` | 입력 포트 수와 연산자를 원본 블록에서 설정 |
| [Relational Operator](https://www.mathworks.com/help/simulink/slref/relationaloperator.html) | `==`, `~=`, `<`, `<=`, `>=`, `>`, `isInf`, `isNaN`, `isFinite` | 비교/검사 연산자. 단항 검사와 이항 비교를 구분 |
| [Rounding Function](https://www.mathworks.com/help/simulink/slref/roundingfunction.html) | `floor`, `ceil`, `round`, `fix` | 반올림/절사 함수 선택 |
| [Data Type Conversion](https://www.mathworks.com/help/simulink/slref/datatypeconversion.html) | `double`, `single`, `boolean`, `int8`, `uint8`, `int16`, `uint16`, `int32`, `uint32`, `int64`, `uint64` | 출력 자료형 설정. 아주 오래된 버전의 int64/uint64 지원은 별도 확인 |

---

<a id="internal-blocks"></a>

## 22. 서브시스템 내부에 들어가는 제어 블록

다음은 템플릿을 열었을 때 나타나는 제어용 블록이다. 최상위 Ports & Subsystems 폴더에서 모든 항목이 항상 독립 아이콘으로 나열되는 것은 아니므로, 바깥 템플릿과 내부 제어 블록을 분리한다. 내부 Inport/Outport 등은 앞 절에 이미 수록했다.

| 내부 블록 | 사용하는 문맥 | 공식 문서 |
| --- | --- | --- |
| Action Port | If Action Subsystem / Switch Case Action Subsystem의 action 신호 | [Action Port](https://www.mathworks.com/help/simulink/slref/actionport.html) |
| Enable | Enabled Subsystem 계열의 활성화 제어 | [Enable](https://www.mathworks.com/help/simulink/slref/enable.html) |
| Trigger | Triggered / Function-Call 계열의 실행 제어 | [Trigger](https://www.mathworks.com/help/simulink/slref/trigger.html) |
| For Each | For Each Subsystem의 분할·반복 처리 정의 | [For Each](https://www.mathworks.com/help/simulink/slref/foreach.html) |
| For Iterator | For Iterator Subsystem의 반복 제어 | [For Iterator](https://www.mathworks.com/help/simulink/slref/foriterator.html) |
| While Iterator | While Iterator Subsystem의 반복 제어 | [While Iterator](https://www.mathworks.com/help/simulink/slref/whileiterator.html) |
| Reset | Resettable Subsystem의 상태 리셋 제어 | [Reset](https://www.mathworks.com/help/simulink/slref/reset.html) |

이 표도 임의의 마스크 내부 구현을 모두 나열한 것은 아니다. 예를 들어 PID Controller 내부의 덧셈·곱셈·적분기를 다시 전부 세면 라이브러리의 블록 목록과 다른 “구현 내부 전체” 목록이 된다.

<a id="legacy"></a>

## 23. 구형 모델에서 만날 수 있는 레거시 항목

| 이름 | 이 문서에서의 처리 | 대체 또는 확인 방향 |
| --- | --- | --- |
| Signal Builder | 구형 모델/교재 해석용으로 기록. 기준 신규 작성 목록과 분리 | Signal Editor 또는 From Workspace. [공식 마이그레이션 안내](https://www.mathworks.com/help/simulink/slref/signalbuildertosignaleditor.html) |
| Interpreted MATLAB Function | R2024b 분류 문서의 제거 예정 항목. 19절에서도 명시 | MATLAB Function 또는 적합한 S-function. 입력·출력 자료형 및 지원 함수 차이를 확인하고 교체 |
| Environment Controller | 기준 색인에서 Removed로 표시되어 활성 기본 목록에서 제외 | 대상 릴리스의 제거 안내와 variant/model 구성 방식을 확인 |
| 구형 XY Graph 구현 | 이름 전체를 제거된 블록으로 처리하지 않음 | R2021b 이후 Record 기반 XY Graph와 인터페이스·설정 차이 확인 |

Signal Builder의 정확한 제거 릴리스, Environment Controller의 제거 릴리스, Interpreted MATLAB Function의 향후 제거 시점은 이 문서에서 추정하지 않았다. **현재 문서에 링크가 남아 있는 것과 현재 라이브러리에 신규 배치 가능한 것은 서로 다르다.**

<a id="compatibility"></a>

## 24. 구버전에 적용하는 방법

### 24.1 기준판이 같거나 이후인 경우

R2024b는 **목록의 기준판**이지 모든 설정·실행 환경의 보증판이 아니다. 같은 블록의 파라미터, 기본값, 지원 자료형, 코드 생성 조건은 릴리스별로 달라질 수 있다. 이후 버전에서도 레거시 제거는 별도로 확인한다. 라이브러리 배치만 달라진 경우에는 블록 이름으로 검색한 뒤 제품명이 `Simulink`인지 확인한다.

### 24.2 기준판보다 이전인 경우

먼저 `version('-release')`로 실제 MATLAB 릴리스를 확인한다. 그다음 도입·편입 버전이 대상보다 새로운 행을 제외하거나 기본 블록 조합으로 대체한다. “기본”만 적힌 행은 도입 시점을 확인하지 않은 행이므로, 정확한 하한이 필요한 프로젝트에서는 해당 릴리스의 블록 도움말 또는 25절의 로컬 추출 결과로 확인한다.

예를 들어 R2020b 무추가툴박스 환경에서는 **R2021b에 DSP System Toolbox에서 편입된 행렬 블록**, **R2022a에 편입된 두 비트/정수 변환 블록**, **R2022b 이후 지연·재생 블록**, **R2024a 이후 배열 처리·variant 구간 블록**을 기본이라고 가정하면 안 된다. 관련 기능의 대체 구현은 별도 설계·검증이 필요하다.

| 최신 편의 항목이 없는 경우 | 검토할 기본 구성 | 주의점 |
| --- | --- | --- |
| Record | Scope / To Workspace / To File | UI·파일 형식·로깅 형식까지 동일한 것은 아님 |
| Playback | From Workspace / From File | 데이터 구조, 시간 보간, 반복 재생 동작 확인 |
| Customizable Dashboard | 일반 Dashboard 또는 Scope / Display / 파라미터 직접 설정 | 외형·연결 기능은 동일하지 않음 |
| Transpose / Hermitian Transpose | Math Function의 transpose / hermitian 설정 | 복소수 켤레 전치 여부 확인 |
| Submatrix | Selector로 행·열 선택 | 인덱스 기준과 출력 차원 확인 |
| Matrix Multiply 별칭 | Product의 matrix multiplication 설정 | 원소별 곱과 행렬 곱을 구분 |
| Add / Subtract / Sum of Elements 별칭 | Sum의 부호·입력 수·아이콘 설정 | 포트 수 및 축소 차원 확인 |
| Square Root 계열 별칭 | Sqrt의 Function 설정 | 실수/복소수 및 음수 입력 처리 확인 |
| Quick Insert의 상수 별칭 | Constant에 해당 상수 입력 | 데이터형과 값 표현 확인 |

### 24.3 실행용 라이브러리 경로는 별도로 확인

이 문서의 `Simulink / Math Operations` 같은 표기는 **탐색용 분류 경로**다. 이를 소문자화하거나 블록명을 붙여 무조건 `add_block`의 소스 문자열로 쓰지 않는다. 공백·줄바꿈·원본 라이브러리 이름·링크 경로가 다를 수 있다.

라이브러리 브라우저에서 찾은 블록의 원본 라이브러리를 열고 해당 블록을 선택한 다음 `gcb`를 실행하면 현재 선택한 블록의 실제 경로를 확인할 수 있다. 이미 사용자 모델에 넣은 블록이라면 `gcb`는 **사용자 모델 안의 경로**이므로, `ReferenceBlock`을 추가 확인하되 원본 정보가 항상 채워지는 것은 아니라는 점에 유의한다. [MathWorks: 블록을 프로그래밍 방식으로 추가·복사·교체·삭제](https://www.mathworks.com/help/simulink/ug/add-copy-replace-and-delete-blocks-programmatically.html)

```matlab
version('-release')
ver('simulink')

% 원본 라이브러리에서 블록을 선택한 상태에서 실행
sourcePath = gcb;
disp(sourcePath)

% 사용자 모델에서 선택했을 때에는 링크 원본이 있는지 확인
referencePath = get_param(gcb, 'ReferenceBlock');
disp(referencePath)
```

<a id="local-inventory"></a>

## 25. 설치된 버전에서 실제 목록을 MD로 추출

이 절은 정적 문서의 릴리스 차이, Quick Insert 별칭 차이 및 확인하지 못한 도입 시점을 보완하기 위한 코드다. **코드는 MATLAB 실행 환경에서 시험하지 않았다.** 공개 `load_system`, `find_system`, `get_param` API를 사용하도록 작성했고, 발견하지 못한 폴더·비어 있는 프록시·새로운 루트 항목을 출력 MD의 경고에 남긴다. 경고가 있으면 “블록이 없다” 또는 “전체 추출 완료”라고 해석하면 안 된다.

코드를 `export_simulink_inventory.m`로 저장한 뒤 `export_simulink_inventory`를 실행한다. 기본 출력 이름은 `Simulink_Installed_Blocks_R<설치 릴리스>.md`다. 기존 파일을 자동으로 덮어쓰지 않는다. 이미 같은 이름이 있으면 다른 경로를 지정한다.

```matlab
export_simulink_inventory
% 또는
export_simulink_inventory('my_simulink_inventory.md')
```

이 도구는 실제 설치된 `simulink` 루트 아래를 검사하고 **실제 경로·블록 종류·원본 링크**를 기록한다. 마스크나 PID/Subsystem 구현 내부를 무제한으로 재귀 탐색하지 않는다. 알려진 폴더 이름으로만 하위 분류를 구분하므로, 특수한 릴리스 구조나 사용자 정의 라이브러리 사용자화가 있으면 수동 대조가 필요하다. **출력은 라이브러리 존재 목록이지 추가 제품 라이선스 검사 결과가 아니다.**

근거 API: [load_system](https://www.mathworks.com/help/simulink/slref/load_system.html), [find_system](https://www.mathworks.com/help/simulink/slref/find_system.html), [get_param](https://www.mathworks.com/help/simulink/slref/get_param.html).

```matlab
function outputFile = export_simulink_inventory(outputFile)
% EXPORT_SIMULINK_INVENTORY Export locally installed Simulink library items.
% This is a library-presence snapshot, NOT a product-license audit.
% It does not change or simulate the user's models.
% Save this code as export_simulink_inventory.m, then run:
%   export_simulink_inventory
%
% Recursion is limited to library-folder names. It does NOT recursively
% count implementation blocks inside PID controllers or subsystem templates.

if nargin < 1 || isempty(outputFile)
    outputFile = fullfile(pwd, ...
        ['Simulink_Installed_Blocks_R' version('-release') '.md']);
end
if ~ischar(outputFile) || size(outputFile, 1) ~= 1
    error('SimulinkInventory:BadPath', ...
        'Pass outputFile as a character vector, for example ''inventory.md''.');
end
if exist(outputFile, 'file') == 2
    error('SimulinkInventory:AlreadyExists', ...
        'Output already exists. Choose another filename: %s', outputFile);
end

load_system('simulink');

% These are Library Browser folder labels, not add_block source paths.
expected = { ...
    'Commonly Used Blocks', 'Continuous', 'Dashboard', ...
    'Discontinuities', 'Discrete', 'Logic and Bit Operations', ...
    'Lookup Tables', 'Math Operations', 'Matrix Operations', ...
    'Messages & Events', 'Model Verification', 'Model-Wide Utilities', ...
    'Ports & Subsystems', 'Signal Attributes', 'Signal Routing', ...
    'Sinks', 'Sources', 'String', 'User-Defined Functions', ...
    'Additional Math & Discrete', 'Quick Insert'};

nested = [expected, {'Customizable Blocks', 'Additional Discrete', ...
    'Additional Math', 'Increment - Decrement', 'Increment-Decrement', ...
    'Increment & Decrement'}];

rootItems = directChildren('simulink');
rootNames = cell(size(rootItems));
for k = 1:numel(rootItems)
    rootNames{k} = normalizeName(get_param(rootItems{k}, 'Name'));
end

records = cell(0, 5);  % folder, name, actual path, block type, reference
issues = cell(0, 1);
visited = cell(0, 1);
for k = 1:numel(expected)
    hit = find(strcmp(rootNames, normalizeName(expected{k})));
    if isempty(hit)
        issues{end+1,1} = ['Folder not found at root: ' expected{k}]; %#ok<AGROW>
        continue;
    end
    for j = 1:numel(hit)
        walkFolder(rootItems{hit(j)}, expected{k});
    end
end

% Report new or differently named root entries instead of silently hiding them.
for k = 1:numel(rootItems)
    if ~any(strcmp(rootNames{k}, expected))
        issues{end+1,1} = ['Unclassified root entry (not traversed): ' ...
            rootItems{k}]; %#ok<AGROW>
    end
end

[fid, message] = fopen(outputFile, 'w', 'n', 'UTF-8');
if fid < 0
    error('SimulinkInventory:WriteFailed', '%s', message);
end
closer = onCleanup(@() fclose(fid)); %#ok<NASGU>
fprintf(fid, '# Installed Simulink library inventory\n\n');
fprintf(fid, '- MATLAB release: R%s\n', version('-release'));
v = ver('simulink');
if ~isempty(v)
    fprintf(fid, '- Simulink version: %s\n', v(1).Version);
end
fprintf(fid, '- Generated: %s\n', datestr(now, 31));
fprintf(fid, '- Library entries: %d\n\n', size(records,1));
fprintf(fid, ['Presence is not a license guarantee. Duplicate shortcuts and ' ...
    'configured variants are retained.\n\n']);
fprintf(fid, ['Paths are read from this installation, not guessed from ' ...
    'documentation titles. Literal \\n denotes a newline in a block name.\n\n']);

if isempty(issues)
    fprintf(fid, ['No discovery warnings were recorded. This does not certify ' ...
        'license availability or undocumented folder layouts.\n\n']);
else
    fprintf(fid, '## Discovery warnings\n\n');
    fprintf(fid, ['The inventory may be partial where a folder is absent, ' ...
        'a proxy is empty, or discovery failed.\n\n']);
    for k = 1:numel(issues)
        fprintf(fid, '- %s\n', md(issues{k}));
    end
    fprintf(fid, '\n');
end

folders = unique(records(:,1), 'stable');
for k = 1:numel(folders)
    fprintf(fid, '## %s\n\n', md(folders{k}));
    fprintf(fid, '| Name | Local library path | Block type | Reference block |\n');
    fprintf(fid, '| --- | --- | --- | --- |\n');
    ids = find(strcmp(records(:,1), folders{k}));
    [~, order] = sort(lowerCell(records(ids,2)));
    ids = ids(order);
    for j = 1:numel(ids)
        r = records(ids(j),:);
        fprintf(fid, '| %s | `%s` | `%s` | `%s` |\n', ...
            md(r{2}), md(r{3}), md(r{4}), md(r{5}));
    end
    fprintf(fid, '\n');
end
fprintf('Wrote %d entries to %s\n', size(records,1), outputFile);
if ~isempty(issues)
    fprintf('Read the %d discovery warnings in the output.\n', numel(issues));
end

    function walkFolder(path, label)
        if any(strcmp(visited, path))
            return;
        end
        visited{end+1,1} = path;
        try
            children = directChildren(path);
        catch ex
            issues{end+1,1} = ['Cannot inspect ' path ': ' ex.message];
            return;
        end
        if isempty(children)
            issues{end+1,1} = ['Empty folder or unresolved proxy: ' path];
            return;
        end
        for n = 1:numel(children)
            p = children{n};
            rawName = get_param(p, 'Name');
            name = normalizeName(rawName);
            blockType = safeParam(p, 'BlockType');
            reference = safeParam(p, 'ReferenceBlock');
            if strcmp(blockType, 'SubSystem') && any(strcmp(name, nested))
                walkFolder(p, [label ' / ' name]);
            else
                records(end+1,:) = {label, rawName, p, blockType, reference};
            end
        end
    end
end

function items = directChildren(parent)
items = find_system(parent, 'SearchDepth', 1, ...
    'LookUnderMasks', 'all', 'FollowLinks', 'on', 'Type', 'Block');
if ischar(items)
    items = {items};
end
items(strcmp(items, parent)) = [];
end

function value = safeParam(path, parameter)
try
    value = get_param(path, parameter);
    if ~ischar(value)
        value = '';
    end
catch
    value = '';
end
end

function text = normalizeName(text)
text = strtrim(regexprep(text, '\s+', ' '));
text = strrep(text, char(8211), '-');
text = strrep(text, char(8212), '-');
end

function text = md(text)
text = strrep(text, sprintf('\r\n'), '\n');
text = strrep(text, sprintf('\n'), '\n');
text = strrep(text, sprintf('\r'), '\n');
text = strrep(text, '|', '\|');
text = strrep(text, '`', '&#96;');
end

function out = lowerCell(in)
out = in;
for k = 1:numel(in)
    out{k} = lower(in{k});
end
end
```

<a id="sources"></a>

## 출처와 정리 방법

**분류와 기본 블록명:** MathWorks [R2024b Block Libraries](https://www.mathworks.com/help/releases/R2024b/simulink/block-libraries.html), [R2024b Simulink Blocks 색인](https://www.mathworks.com/help/releases/R2024b/simulink/referencelist.html?type=block), 각 절의 R2024b 분류 페이지. Commonly Used Blocks의 바로가기, 대체 구성, 라이선스 조건 및 버전 이력은 각 절에 연결한 현행 공식 블록 문서로 보완했다.

**도입·변경·편입 시점:** 각 분류 색인의 Since 표시 및 개별 블록 문서의 Version History. [Simulink Release Notes](https://www.mathworks.com/help/simulink/release-notes.html)도 교차 참조했다. 확인되지 않은 하한은 임의로 채우지 않았다.

**표시 이름과 원본 블록의 구분:** 공식 문서의 Libraries 및 Alternative Configurations. 예를 들어 Sum 문서는 Add/Subtract/Sum of Elements를, Sqrt 문서는 Signed Sqrt/Reciprocal Sqrt 및 Quick Insert의 긴 이름 별칭을 함께 다룬다. 문서 한 페이지 수와 라이브러리 표시 항목 수가 서로 다를 수 있다.

**추가 제품 경계:** [고정소수점 자료형 조건](https://www.mathworks.com/help/simulink/ug/specify-fixed-point-data-types.html), [고정소수점 모델 공유](https://www.mathworks.com/help/simulink/ug/sharing-fixed-point-models.html), [Simulink 메시지 개요](https://www.mathworks.com/help/simulink/ug/simulink-messages-overview.html), 개별 블록의 기능별 의존성 및 확장 기능 설명.

문서 접근 시 MathWorks 사이트의 지역 선택, 로그인 또는 릴리스 선택이 필요할 수 있다. 과거 문서 링크가 현행 문서로 이동하면 상단의 릴리스를 다시 확인한다. 현행 도움말의 새로운 옵션을 기준판에서 지원된 것으로 소급하지 않는다.
