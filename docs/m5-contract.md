# M5 실행 계약 — 선택 기능 묶음

상태: 선택 3묶음의 수치·타입·진단·독립 export·UI 승인. 근거와 미지원 경계는 [검증 기록](m5-validation.md)을 따른다. M5는 실수 행렬, 2D Lookup/Prelookup, 고정소수점 양자화 경계를 독립된 기능 묶음으로 승인한다. 원본 385행 전체의 구현 완료나 Simulink 수치·파일 호환을 뜻하지 않는다. 계약 → 독립 기대값 fixture → prototype → TypeScript/진단 동등성 → 대응표 승인 순서를 따른다.

## 타입·실행·자원

신호는 기존 유한 float64/boolean scalar·vector·2D JSON이며 새 복소수·fixed-point 신호 타입을 추가하지 않는다. 신규 10블럭은 static/discrete/continuous의 대수 연산으로 실행한다. 이산 rate, 연속 domain, 상태·reset·Scope 범위, SHA-256, 데이터·계층 버전 및 기존 예산을 보존한다. 행렬은 숫자 2D, 각 축 1~32, 최대 1,024원소이며 scalar/vector broadcasting을 하지 않는다. 생성 코드는 `typescript-m5-v1`, ES2022 import 없이 실제 모듈로 실행 가능해야 한다. 모델은 사용자 함수·getter·알 수 없는 파라미터를 허용하지 않으며 안전한 JSON만 사용한다.

행렬의 곱/분해/조건 추정, Lookup 검증·검색, BigInt 반올림 비용을 원소 수뿐 아니라 연산 수에 반영한다. 기본 실행과 생성 코드는 50,000,000 operation·30초 active time·1,000,000 기록 원소 한도를 사용한다. 브라우저 runner의 기존 maxWallMs 옵션은 120초까지 별도 지정할 수 있으나 생성 코드는 기본 30초다. 시작 전 예산 검사에서 거부하면 부분 결과가 없고, 실행 중 수치·예산 실패에는 진단과 이미 완성된 표본만 보존한다. 생성 코드에도 기본 비용·진단·부분 결과를 포함한다. 실패한 이산 tick은 마지막 완성 표본의 held/state/rate/random 메모리로 복원하며 부분 결과의 sample/state/memory 배열은 실행과 서로 독립이다.

## 실수 행렬 7블럭

| ID | 입력 → 출력 | 형상·단위 |
| --- | --- | --- |
| math.matrix-multiply | a,b → out | (m×k)(k×n) → m×n, 승인 단위 곱 |
| matrix.transpose | in → out | m×n → n×m, 입력 단위 유지 |
| matrix.determinant | in → out | 정방 n×n → scalar, 단위 1 |
| matrix.inverse | in → out | 정방 n×n → n×n, 단위 1 |
| matrix.solve | a,b → out | 정방 A(n×n), B(n×r) → X(n×r), A는 단위 1, B의 단위 유지 |
| matrix.cholesky | in → out | 실수 대칭 양의 정부호 n×n → 하삼각 L, A=L·Lᵀ, 단위 1 |
| matrix.lu | in → lower,upper,permutation | 정방 n×n → L,U,P의 3개 n×n, P·A=L·U, 단위 1 |

입력을 변경하지 않는다. 최대 절댓값으로 정규화하고 partial pivoting(동률은 첫 행)을 사용한다. 비영 pivot의 상대 임계값은 `32*n*Number.EPSILON*scaledInfinityNorm`이다. inverse/solve/LU/Cholesky는 infinity-norm 조건수 추정 상한 `1/(32*n*EPSILON)`을 둔다. 정확히 특이한 determinant는 0을 반환하며 다른 분해는 특이 진단이다. 거의 특이한 행렬, 정규화에서 비영 성분 손실, 표현 범위를 넘거나 비영 결과가 0으로 손실되는 경우는 진단한다. 스케일 곱의 참값 크기가 최소 비영 float64보다 작으면 MIN_VALUE로 반올림할 수 있는 경우도 보수적으로 underflow로 거부한다. 분해 결과를 반올림해 정답처럼 표시하지 않는다. 동일 척도의 1e±300 입력도 결과가 표현 가능한 경우 검증한다. solve는 우변 열별로 정규화하며 같은 열의 비영 성분 소실 또는 정규화 값이 subnormal(abs<2^−1022)로 내려가는 경우는 유효자리 손실을 막기 위해 underflow 진단이다. LU의 permutation 출력은 인덱스 배열이 아니라 0/1 행렬이다. 복소수·일반 tensor·희소행렬·QR/SVD·일반 최소제곱·조건 불량 문제의 자동 해결은 제외한다.

## Lookup 2블럭

`lookup.2d`: scalar `row`,`column`은 단위 1. `rowBreakpoints`,`columnBreakpoints`는 2~32개 유한 숫자, 엄격히 증가. `table[row][column]`은 기준점 수와 정확히 일치하는 유한 숫자 2D. `interpolation=linear|nearest|previous`, `extrapolation=clip|linear|error`. linear는 구간 안에서 네 모서리 가중합의 bilinear 보간이며 범위 밖에서는 동등한 쌍선형 다항식 전개로 상수·일차 항을 보존한다. linear 외삽은 linear 보간에만 허용한다. nearest midpoint 동률은 낮은 인덱스, previous는 직전 값이며 정확한 기준점은 그 기준점의 값이다. 출력 scalar의 단위는 명시 단위 또는 1이다. 비균일 축·정확한 knot·끝점·범위 밖 두 축·최대 크기를 검증한다. 일반 n-D·spline·Akima·동적 표·Prelookup 출력으로 연결되는 별도 interpolation 블럭은 제외한다.

`lookup.prelookup`: 단위 1 scalar `in`, 2~32개 `breakpoints`, 같은 외삽 3종. 출력 `index`,`fraction`은 단위 1 float64 scalar이다. 마지막 끝점은 index=n−2, fraction=1, 내부 정확한 knot는 오른쪽 구간 index와 fraction=0이다. clip은 범위 끝점으로 제한하고 linear는 첫/마지막 구간에서 fraction의 범위 밖 값을 허용한다. error는 범위 밖 진단이다. 극단적 축·입력에서 계산 결과가 유한하지 않거나 구간을 표현할 수 없으면 진단한다.

## Fixed-point 양자화 1블럭

`fixed.quantize`: float64 scalar/vector/2D `in`, `wordLength=1..32`, `fractionLength=0..32`, `signedness=signed|unsigned`, `rounding=nearest-even|floor|ceil|toward-zero`, `overflow=saturate|wrap|error`. 기본값은 signed Q8.4, nearest-even, saturate이다. IEEE-754의 저장 significand/exponent를 DataView로 해석하고 `x*2^fractionLength`의 정확한 유리수에서 BigInt로 정수 반올림한다. 부호·절반 동률·subnormal·큰 유한 실수에도 float64 곱셈이나 안전 정수 밖 Number를 거쳐 wrap하지 않는다.

signed 정수 범위는 −2^(W−1)..2^(W−1)−1, unsigned는 0..2^W−1. 범위를 벗어나면 끝값으로 saturate, modulo 2^W 후 signed 해석으로 wrap, 또는 진단한다. `out=stored/2^F`는 입력 형상·단위를 유지하는 float64, `stored`는 같은 형상의 정확한 ≤32bit 정수 Number·단위 1이다. 모든 0은 +0으로 정규화한다. 저장 정수 경계의 bit-true 양자화이며 뒤의 Gain/Sum은 float64 연산이다. 일반 fixed-point 타입 전파·모든 중간 연산 양자화·64bit/임의 정밀도 출력·slope/bias scaling을 지원한다고 표시하지 않는다.

## 승인 근거

각 블럭의 성공·실패 fixture, 전체 원시 표본, 독립 해석/유리수 기대값, AX−B·A·inverse−I·LLᵀ−A·PA−LU 잔차, JSON 재개방, 순서 변경, 독립 코드 3형식의 strict ES2022 실행, 동일 진단 code/nodeId/partial result, 방어적 복사와 예산을 확인한다. UI에서는 편집·다중 포트·검색/빠른 추가·예제·ZIP 내보내기·모바일/양 테마·기존 Scope 조작을 확인한다. 확인한 subset만 원본 대응표에 연결한다. 행렬 inverse/solve/LU/Cholesky는 원본에 없는 추가 블럭으로 별도 표기한다.

Lookup의 기준점/보간 개념과 고정소수점 nearest-even·overflow 용어는 [MathWorks 2-D Lookup](https://www.mathworks.com/help/simulink/slref/2dlookuptable.html), [Prelookup](https://www.mathworks.com/help/simulink/slref/prelookup.html), [Rounding Modes](https://www.mathworks.com/help/fixedpoint/ug/rounding.html), [Fixed-point output 설정](https://www.mathworks.com/help/fixedpoint/ug/configuring-blocks-with-fixed-point-output.html)을 참고했다. 위의 크기·단위·정밀도·오류 정책은 CalcWeave 자체 계약이다.
