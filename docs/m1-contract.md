# CalcWeave M1 구현 계약

> 2026-10-02 · 앱 0.1.0 / 엔진 `0.1.0-m1` · 구현·자동 검증 통과, 실제 사용자 조사 미완료

M1은 [마일스톤](03-milestone-roadmap.md)의 로컬 정적 계산 범위를 구현한다. M0 시작 후보 22종과 제한 수식 `math.expression`을 더하고 기존 scalar Unit Delay·Integrator 실험은 보존한다. M1 종료에는 실제 초보 사용자 조사도 필요하므로 구현과 자동 검증만으로 종료를 선언하지 않는다.

## 공통 타입과 실행 경계

- `SignalValue = number | boolean | number[] | boolean[] | number[][] | boolean[][]`. 숫자는 finite float64이며 boolean을 숫자로 자동 변환하지 않는다. 빈 배열·ragged·혼합 타입·3D 배열을 거부한다.
- `SignalDescriptor = { valueType: 'float64' | 'boolean'; shape: number[]; unit: string }`. scalar `[]`, vector `[n]`, matrix `[rows, columns]`, matrix는 row-major다. 배열 한 신호는 최대 1,024개 원소, 각 축은 최대 1,024이며 2D 곱도 1,024 이하다.
- JSON schemaVersion와 기존 블럭 버전은 1을 유지한다. `CalcNode.unit?`는 길이가 제한된 허용 단위 토큰이다. 기존 모델의 생략값은 단위 없는 `1`이다. 엔진 버전은 `0.1.0-m1`로 올린다.
- 허용 단위: `1`, `m`, `s`, `kg`, `A`, `K`, `mol`, `cd`, `rad`, `deg`, `V`, `Hz`, `N`, `Pa`, `J`, `W`, `m/s`, `m/s^2`. 자동 변환하지 않는다. source의 단위를 전파하고 다른 블럭에 지정한 unit은 추론값과 일치해야 한다.
- Sum·MinMax·Compare·Switch·Mux·Concatenate는 같은 단위가 필요하다. Product는 한 인자가 단위 없을 때의 곱, 단위 없는 제수로의 나눗셈, 같은 단위끼리 나눈 결과 `1`만 지원한다. 일반 차원 대수·단위 변환은 M4다. boolean 신호는 단위 `1`만 허용한다. Math Function의 모든 옵션(`square`·`reciprocal` 포함), Trigonometric·Sqrt·Expression은 단위 없는 입력만 받는다.
- 정적 계산에서 숫자 unary는 shape를 보존한다. 두 숫자 입력의 Sum·Product·MinMax·Compare는 같은 shape 또는 scalar broadcasting만 지원한다. 두 비scalar shape가 다르면 포트별 컴파일 오류다. boolean에는 산술을 적용하지 않는다.
- 새 블럭은 static 전용이다. 기존 source/input/gain/sum/product/display의 확장은 static에서만 허용하며 discrete/continuous는 기존 float64 scalar·단위 없는 계약을 유지한다.
- IRNode는 `parameters: Record<string, unknown>`, `inputs: Record<string, Endpoint>`, `outputs: Record<string, SignalDescriptor>`, `expression?: ExpressionNode`를 가진다. sink는 외부 출력 포트가 없지만 기록용 descriptor를 `outputs.out`에 가진다. `CompiledModel.outputTypes`는 기록 노드 ID별 descriptor다. 실행 입력의 producer 출력 port를 보존하여 Demux의 여러 출력을 정확히 연결한다.
- Display와 Outport는 결과를 기록한다. Terminator는 입력을 검증하고 기록하지 않는다. 최소 하나의 기록 sink가 필요하다. `RunSample.values`는 SignalValue이며 기존 상태 블럭의 `finalState`는 scalar number를 유지한다.
- JSON의 5MiB·32depth·100k values·1,000노드·5,000연결 상한과 위험 키·prototype·accessor·sparse 검사, immutable IR, Worker 재컴파일을 유지한다. 기록 예산은 모든 sink 원소 수와 시간축을 합산한다. 연산 예산은 원소별 평가와 AST 비용도 포함한다.
- 중간 신호 예산은 모든 IR 출력 포트(기록 sink의 내부 출력 포함)의 원소 수 합계 100,000개다. Demux의 각 출력도 개별 descriptor로 합산한다. 결과 배열을 수정해도 다음 실행의 IR·원본 입력이 바뀌지 않도록 기록 값은 분리한다.

## Registry와 파라미터

`ParameterDefinition`은 `kind: 'number' | 'integer' | 'value' | 'enum' | 'expression'`, `label`, `default: unknown`, optional `min/max/options/maxLength`를 가진다. `getBlockPorts(node)`는 검증 전 UI에도 안전한 기본값으로 동작하고 `{ inputs: string[]; outputs: string[] }`를 반환한다. compiler는 registry의 kind·allowlist로 값을 검증한다. 동적 포트 변경으로 없어진 연결은 UI에서 명시적 한 편집으로 정리하며 그 밖의 잘못된 연결은 compiler가 거부한다.

| 블럭 | 파라미터 / 포트 | 의미 |
| --- | --- | --- |
| Constant / Input | `value=1`(SignalValue), out | 타입·shape는 값에서 추론 |
| Gain | `gain=2`(scalar), in→out | 숫자 신호의 원소별 배율 |
| Sum | `signs='++'`, 옵션 `++,+-,-+,--`, a,b→out | 두 숫자 입력의 부호 합 |
| Product | `operation='multiply'`, `multiply,divide`, a,b→out | 원소별 곱·나눗셈, 0 제수 오류 |
| Abs | in→out | 원소별 절댓값 |
| Math Function | `operation='exp'`, `exp,log,log10,square,reciprocal`, in→out | 실수 정의역만 허용 |
| Trigonometric Function | `operation='sin'`, `sin,cos,tan,asin,acos,atan`, in→out | radian 숫자, 정의역 검사 |
| Rounding Function | `operation='round'`, `round,floor,ceil,trunc`, in→out | JS round의 half toward +Infinity |
| MinMax | `operation='min'`(`min,max`), `strategy='pairwise'`(`pairwise,reduce`) | pairwise a,b→같은 shape, reduce in→전체 원소의 scalar min/max |
| Sqrt | in→out | 음수 정의역 오류 |
| Compare | `operation='gt'`, `eq,ne,lt,le,gt,ge`, a,b→out | float64 비교→같은 shape boolean |
| Boolean | `operation='and'`, `and,or,xor,not` | not은 a, 나머지는 a,b; boolean scalar 또는 같은 shape/scalar broadcast |
| Switch | a,condition,b→out | condition은 boolean scalar, a/b 타입·shape·단위 일치 |
| Saturation | `lower=0, upper=1`, in→out | lower≤upper, 원소별 clamp |
| Mux | a,b→out | 같은 타입·단위의 scalar/vector 두 입력을 하나의 vector로 묶음 |
| Demux | `count=2` 정수 1~16, in→out1…outN | 길이 count vector의 각 성분을 scalar 출력 |
| Vector Concatenate | a,b→out | 같은 타입·단위의 scalar/vector 두 입력 연결 |
| Reshape | `form='vector'`(`vector,matrix`), `rows=1, columns=2`, in→out | row-major, matrix 원소 수 일치, vector는 전체 평탄화 |
| Display / Outport | in, 기록 | 타입·shape·단위 보존 |
| Terminator | in | 입력 종료, 기록 없음 |
| Expression | `expression='x'`, in→out | 아래 제한 AST 계약 |

UI preset은 Pi·Zero·True·False·Add·Subtract이며 새 canonical kernel로 세지 않는다. 지원 블럭/파라미터의 모든 제한은 속성·진단·문서에서 확인할 수 있어야 한다.

## 제한 수식 AST

`ExpressionNode` union은 `number{value}`, `variable{name:'x'|'pi'|'e'}`, `unary{operator:'+'|'-',argument}`, `binary{operator:'+'|'-'|'*'|'/'|'^',left,right}`, `call{name:string,args:ExpressionNode[]}`다. 함수 allowlist는 `abs,sqrt,sin,cos,tan,asin,acos,atan,exp,log,log10,floor,ceil,round,trunc,min,max`이다. min/max는 정확히 두 인자, 나머지는 한 인자다. x는 현재 입력의 한 원소다.

문자열 길이는 512자, AST 128노드, 중첩 32단계, 숫자 literal은 finite다. 거듭제곱은 오른쪽 결합이며 `-2^2=-4`, `2^-2=0.25`다. 프로퍼티 접근·인덱스·문자열·할당·문장·임의 식별자·사용자 코드 실행을 거부한다. AST는 compiler에서 생성·freeze하고 runtime은 해당 AST만 해석한다. division by zero, 음수 sqrt, log≤0, asin/acos 범위 오류, 비유한 출력은 nodeId와 함께 실패한다. bool 수식은 지원하지 않는다.

독립 TS 생성은 사용자 수식 원문을 실행 문법에 삽입하지 않고 검증한 AST와 고정 kernel을 사용한다. static 23종·typed 값·모든 승인 enum 옵션·다중 출력의 독립 실행 parity와 생성 코드의 엄격한 TypeScript 검사를 통과했다. 연속 export는 계속 차단한다.

## 검증과 다음 게이트

F01 budget·vector/2D shape·정의역·프로젝트 roundtrip과 기존 M0 회귀, typed/multi-output/수식 독립 TS parity, 배열·AST·결과 자원 상한, Worker 중단, 실제 브라우저 편집·복구·오류 위치를 검증한다. 실제 예비 사용자 5명 중 4명의 15분 과제 목표는 별도 관찰로 기록한다. 도메인·브랜드 외부 확인과 미완료 M0 게이트도 보존한다.
