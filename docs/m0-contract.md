# CalcWeave M0 구현 계약과 지원 경계

> 버전: v0.1 · 작성일: 2026-10-02 · 상태: 실행 가능한 핵심 실험, M0 종료 게이트 일부 미완료
>
> 연결 문서: [기술 백서](01-technical-whitepaper.md) · [디자인 백서](02-design-whitepaper.md) · [마일스톤](03-milestone-roadmap.md) · [블럭 대응표](block-coverage.md) · [M0 검증 기록](m0-validation.md)

## 1. 이번 구현이 확인하는 범위

이 문서는 M0 단계의 이력이다. 현재 앱의 확장된 타입·블럭·export 경계는 [M1 구현 계약](m1-contract.md)을 따른다.

M0는 블럭 연결을 검증된 실행 계획으로 바꾸고, 브라우저 Worker에서 계산하며, 같은 계획에서 독립 TypeScript 코드를 생성하는 작은 구현이다. 현재 registry에는 **finite float64 scalar 블럭 8개**가 있다. 정적 계산 6개와 단일 틱 Unit Delay, 자율 ODE의 Integrator가 구현되었다. 이산·연속 블럭은 후속 단계의 실행 위험을 확인하는 실험이며 M2·M3 제품이 완성되었다는 뜻이 아니다.

기술 백서의 boolean, vector, 2D matrix, 단위 검사, 제한 수식 AST, 데이터셋, 계층 모델은 후속 지원 계약이다. 현재 엔진은 이 자료형·기능을 지원하지 않는다. 배열을 scalar로 자동 축소하거나 지원하지 않는 블럭을 무시하지 않고 컴파일 오류로 반환한다. 모델 편집·저장과 실행 가능 판정도 구분한다.

실제 책임 경계는 다음 파일에 있다.

| 경계 | 구현 |
| --- | --- |
| JSON v1, 안전한 가져오기, canonical 직렬화 | [model](../packages/model/src/schema.ts) |
| 블럭의 포트·파라미터·상태·지원 모드 | [block-library](../packages/block-library/src/index.ts) |
| 연결·의존성·모드·시간 예산 검사와 immutable IR | [compiler](../packages/compiler/src/index.ts) |
| 정적·동시 상태 commit·고정 간격 RK4 | [runtime](../packages/runtime/src/index.ts) |
| 정적·이산 scalar TypeScript export | [codegen-ts](../packages/codegen-ts/src/index.ts) |
| Worker 검증과 실행 추적 | [engine.worker](../apps/web/src/engine.worker.ts), [worker-client](../apps/web/src/worker-client.ts) |

## 2. 현재 registry 8개

모든 입력·출력은 단위 없는 finite float64 scalar다. 출력 포트는 `out`이며 Display에는 외부로 연결하는 출력 포트가 없다. 모든 나열된 입력은 필수이고 입력 하나에 writer 하나만 허용한다. 숫자 파라미터는 유한한 JavaScript Number 범위에서 허용하며 연산 후 overflow도 별도로 검사한다.

| canonical ID | 표시명 / 참조 이름 | 필수 입력 | 파라미터와 기본값 | 현재 입력 직접 의존 | 실행 모드 | 상태 / TS export |
| --- | --- | --- | --- | --- | --- | --- |
| `source.constant` | 상수 / Constant | 없음 | `value=1` | 없음 | 정적·이산·연속 | 상태 없음 / 정적·이산 |
| `io.input` | 입력 / Inport | 없음 | `value=1` | 없음 | 정적·이산·연속 | 상태 없음 / 정적·이산 |
| `math.gain` | 배율 / Gain | `in` | `gain=2` | 있음 | 정적·이산·연속 | 상태 없음 / 정적·이산 |
| `math.sum` | 덧셈 / Sum | `a`, `b` | 없음 | 있음 | 정적·이산·연속 | 상태 없음 / 정적·이산 |
| `math.multiply` | 곱셈 / Product | `a`, `b` | 없음 | 있음 | 정적·이산·연속 | 상태 없음 / 정적·이산 |
| `sink.display` | 결과 / Display | `in` | 없음 | 있음 | 정적·이산·연속 | 상태 없음 / 정적·이산 |
| `discrete.unit-delay` | 한 틱 지연 / Unit Delay | `in` | `initial=0` | 없음 | 이산 | 이전 틱 값 / 이산 |
| `continuous.integrator` | 적분 / Integrator | `in` | `initial=0` | 없음 | 연속 | 연속 상태 / 미지원 |

`io.input`은 현재 실행 스냅샷의 숫자 파라미터를 사용하는 입력이다. 외부 데이터 스트림·실행 중 입력 조작·계층 Inport 연결은 구현하지 않았다. Sum은 두 숫자의 덧셈, Product는 두 숫자의 곱셈만 지원한다. 입력별 부호, reduce, 배열 broadcasting, Matrix Multiply, Slider Gain, 상수 Quick Insert preset을 같은 구현 완료 상태로 세지 않는다.

블럭 버전은 모두 `1`이다. `blockRegistry`와 `getBlockDefinition`은 변경 불가능한 계약만 노출하며 알 수 없는 ID를 일반 객체의 prototype에서 조회하지 않는다. 연속 모델 전체의 TS export를 차단하고 Integrator의 export 타깃도 비워 두었다.

registry의 읽기 전용 `aliases`는 검색용 표시 metadata다. `값`으로 상수·입력·결과를, `더하기`로 덧셈을, `곱하기`로 곱셈을, `곱배율`로 배율을, `이전 값`으로 지연을 찾을 수 있다. 이름·영문명·설명·ID·검색 별칭을 함께 검색하며 별칭은 freeze한다. 별칭은 새로운 블럭이나 preset을 추가하지 않고 모델·IR·semanticKey의 실행 의미에도 들어가지 않는다.

## 3. 모델 JSON v1과 입력 경계

모델은 `schemaVersion`, `modelId`, `name`, `nodes`, `edges`, `execution`, `layout`만 가진다. 노드는 `id`, `blockType`, `blockVersion`, `label`, `parameters`, 연결은 `id`, `source`, `target`이며 각 끝점은 `nodeId`, `portId`다. `layout`은 노드 ID별 `{x,y}` 위치다. 모델 schema와 블럭 버전은 `1`이고 모델 ID·블럭 ID·연결 ID는 별도 식별자다.

| 입력 계약 | 현재 한도 / 처리 |
| --- | --- |
| JSON 파일 | UTF-8 5 MiB 이하. 파싱 전에 바이트와 중첩을 검사 |
| 중첩·값 개수 | 중첩 32단계, 검사 값 100,000개 이하 |
| 모델 규모 | 노드 1,000개, 연결 5,000개 이하 |
| 식별자 | 영문자로 시작, 영문·숫자·`_`·`-`, 최대 64자. prototype 관련 예약 이름 거부 |
| 이름·표시 문자열 | 모델 이름 1~120자, 노드 label 최대 100자, blockType 최대 80자 |
| 파라미터 | 블럭당 필드 최대 16개. 컴파일 시 블럭별 허용 이름과 scalar 숫자만 수용 |
| 위치 | finite `x`,`y`, 각각 ±1,000,000. 존재하는 노드의 위치만 저장 |
| 객체 | 일반 JSON 객체·배열만 수용. 위험한 키·접근자·숨김 속성·순환 참조·sparse 배열 거부 |
| 중복 | 노드 ID 중복, 연결 ID 중복 모두 거부 |
| 미지 필드·버전 | 알려진 구조의 추가 필드 및 미래 schema/블럭 버전은 거부 |

`parseModel`은 입력을 검증하고 방어적 복사본을 반환한다. `parseModelJson`은 파일 경계를 검사하며 `serializeModel`도 저장 전에 검증한다. 이름 규칙을 충족하지만 registry에 없는 블럭 종류는 JSON으로 보관할 수 있으나 `compileModel`이 실행과 export를 차단한다. 미래 버전 데이터를 임의로 다운그레이드하는 migration은 없다. migration을 도입할 때 버전별 명시적인 변환과 재검증을 추가한다.

문자열은 화면에서 텍스트로 출력한다. 수식이나 사용자 코드 문자열을 `eval`, `new Function`, HTML로 실행하는 경로는 없다. 계정·서버·DB·개인정보 수집은 이 실험에 포함되지 않는다.

## 4. 컴파일과 실행 스냅샷

컴파일러는 JSON 검증 이후 블럭·버전·허용 파라미터·실행 모드, 끝점과 포트 존재, 필수 입력, single writer, 결과 블럭 존재, 시간·기록 예산을 검사한다. 사용하지 않는 경로도 동일하게 검사하며 자동으로 연결이나 지연을 삽입하지 않는다.

출력 의존 그래프에서 현재 입력을 직접 사용하는 노드의 연결을 위상 정렬한다. Unit Delay와 Integrator로 들어가는 연결은 현재 출력의 의존성에서만 제외한다. 원래 입력 연결은 IR에 남아 다음 상태 또는 미분 계산에 사용된다. 순수 direct-feedthrough 순환은 실제 순환 경로와 해당 노드 ID로 진단한다. 오류 응답 증폭을 막기 위해 진단은 최대 20개, 표시하는 순환 경로는 처음 12개 ID로 제한하고 나머지 개수를 알려준다. 같은 producer가 Sum의 두 입력을 공급해도 의존성은 중복 집계하지 않는다.

IR은 `model`, 위상 순서의 `nodes`, `stateIds`, `outputIds`, `semanticKey`다. 각 IR 노드는 블럭 ID·종류·검증한 숫자 파라미터·입력 포트에서 producer ID로의 매핑을 갖는다. 컴파일러가 누락된 파라미터 기본값을 스냅샷에 명시하며 모델과 IR 전체를 재귀적으로 freeze한다. 실행 중 편집한 원본이 이미 시작한 계산에 영향을 주지 않는다.

`semanticKey`는 schema·modelId·블럭 ID와 버전·파라미터·연결·실행 설정을 canonical JSON으로 만든 값이다. 노드·연결은 ID로, 객체 키는 문자열 순서로 정렬한다. 모델 이름·노드 label·layout은 제외한다. 화면 이동이나 표시 이름 변경은 이전 결과를 stale로 만들지 않는다. 기본값을 생략한 원본과 실행 스냅샷을 비교할 때는 같은 기본값 정규화 규칙을 적용해야 한다. 예제와 편집기의 블럭 생성은 기본값을 명시한다.

## 5. 시간·상태·수치 계약

### 5.1 고정 시간 격자

시간 설정은 `mode`, `startTime`, `stopTime`, `step`이다. 시작·종료 시간은 각각 ±1,000,000,000 범위, step은 10⁻⁹~1,000,000,000 범위다. 종료 시간은 시작 시간보다 작을 수 없다. 이산·연속 모드에서는 `(stopTime-startTime)/step`이 정수여야 하며 부동소수점 표현 오차로 `1e-9 × max(1,|구간 수|)`까지 허용한다. 시작·종료 시점에서 step을 표현할 수 없으면 거부한다.

시간은 반복 덧셈 대신 `startTime + tickIndex × step`으로 계산한다. 최대 10,000개 구간이며 **초기 샘플을 포함해 최대 10,001개 샘플**이다. 정적 모드는 시작 시점에서 한 번 평가하고 시간 구간을 진행하지 않는다.

### 5.2 실행 모드

| 모드 | 현재 의미와 제한 |
| --- | --- |
| 정적 | 상태 없는 DAG를 한 번 평가. Unit Delay·Integrator 사용 거부 |
| 이산 | 모델 전체의 동일 step으로 실행. Unit Delay만 상태 블럭으로 허용, Integrator 거부 |
| 연속 | Integrator만 상태 블럭으로 허용. Unit Delay와 연속·이산 혼합 거부. 고정 간격 RK4 사용 |

이산 실행의 첫 출력은 초기 상태다. 매 틱에는 모든 현재 상태 출력을 준비하고 조합 그래프를 평가한 뒤 결과를 기록한다. 다음 상태는 동일한 이전 상태와 현재 입력으로 모두 계산한 후 한 번에 commit한다. 마지막 샘플 뒤에는 가상의 다음 상태를 commit하지 않는다. 따라서 `finalState`는 마지막 기록 시점의 상태이고 `steps`는 초기 샘플을 포함한 실제 기록 샘플 수다.

연속 실행은 각 RK4 stage에서 시험 상태를 사용해 전체 조합 DAG를 다시 평가한다. 현재 source는 상수 입력뿐이므로 **`dx/dt=f(x,u_constant)` 형태의 자율 ODE**만 표현할 수 있다. Clock·Ramp·Sine 등 시간 의존 source, stage 시각에 변하는 입력, 외부 sampled 데이터는 미구현이다. 적응 간격, 오차 기반 step rejection, 이벤트·zero crossing·reset, DAE, stiff solver, 혼합 실행을 지원한다고 표시하지 않는다.

모든 입력·중간 출력·상태·미분 결과는 finite인지 검사한다. overflow·NaN을 0이나 null로 바꾸거나 실패한 구간을 정상 완료로 기록하지 않는다. 숫자 표시 자릿수와 실제 저장되는 Number 값을 구분한다. M1의 vector/2D는 row-major, 0 기반 인덱스를 채택할 예정이지만 해당 kernel과 shape 검사는 아직 구현하지 않았다.

### 5.3 자원·중단

| 자원 | 현재 계약 |
| --- | --- |
| 구간 수 | 최대 10,000 |
| 결과 기록 | `(샘플 수) × (Display 수 + 시간축 1)` ≤ 1,000,000 scalar 값 |
| kernel 평가 | 실행당 최대 50,000,000개. 연속 모드는 RK4 stage 평가도 포함 |
| 실행 시간 | runtime 기본 30초, 직접 호출 옵션의 절대 상한 120초. 웹 UI는 기본값 사용 |
| 브라우저 watchdog | 31초에 Worker 종료. 실행 시간 기준과 브라우저 타이머 지연은 구분 |
| 협력적 양보 | 64샘플 또는 처리 약 8ms 단위로 event loop에 양보 |
| 중단 | requestId별 AbortSignal을 전달하고 미응답 시 800ms 타이머로 Worker 종료 |

컴파일러의 기록량 사전 검사와 runtime 검사를 함께 둔다. 결과량은 시간축도 포함하지만 JS 객체·문자열·복사본 등 실제 heap 비용은 추가된다. 취소 시 이미 기록한 결과는 `status='cancelled'`이고 완료 결과와 구분한다. Worker가 강제 종료되면 아직 전달하지 않은 내부 partial 결과는 반환되지 않는다. 취소 반응 시간과 메모리 사용은 기준 브라우저에서 별도 측정하는 게이트이며 타이머 설정만으로 실측을 대신하지 않는다.

## 6. Worker 메시지와 재현성

UI는 모델을 구조적으로 복사하고 UUID `requestId`로 `run` 요청을 보낸다. Worker는 요청의 허용 필드·종류·UUID를 검사하고 **Worker 안에서 모델을 다시 compile**한다. 실행 중에는 동일 Worker의 중복 run을 `RUN_BUSY`로 거부한다.

| 메시지 | 필드 / 의미 |
| --- | --- |
| UI → Worker `run` | `requestId`, `model` |
| UI → Worker `cancel` | `requestId`; 같은 실행에만 적용 |
| Worker → UI `progress` | `requestId`, `{steps,time}` |
| Worker → UI `result` | `requestId`, `result`, `semanticHash`, `engineVersion` |
| Worker → UI `error` | `requestId`, 안정적인 코드·사용자 설명·노드/포트 위치의 `diagnostics` |

`semanticHash`는 정규화한 IR 의미의 SHA-256이고 현재 `engineVersion`은 `0.0.1-m0`다. 결과는 samples, finalState, status, elapsedMs, steps를 가진다. UI는 활성 requestId가 아닌 메시지를 적용하지 않는다. 실행 기록에는 해당 모델 스냅샷·semanticKey·출력 ID와 추적 필드를 연결해 편집 이후 결과와 구분한다. 데이터셋 버전·난수 seed·외부 자산 checksum은 아직 대상이 없으며 후속 manifest에서 명시한다. 전체 실행 이력 저장·데이터 관리 기능이 구현되었다는 의미는 아니다.

TS 생성기는 허용한 정적·이산 scalar IR에서만 독립 실행 가능한 소스를 만든다. 사용자 이름·label·코드 조각을 실행 문법에 삽입하지 않고 검증한 데이터 literal과 고정 kernel을 사용한다. 생성 코드에도 숫자·구간·기록량·연산·실행 시간 상한을 둔다. 연속 모델은 생성 전에 명시적으로 실패한다.

## 7. Rate Transition 계약 결정 — M2 구현 기준

M0에서 초기 제안인 **read-before-write**를 다중 rate 경계의 기본 계약으로 채택한다. 현재 registry·IR·runtime에는 Rate Transition과 다중 rate 스케줄러가 없으며 아래는 M2에서 구현·검증할 명세다.

각 rate의 period `P`는 양의 정수 base tick 수, offset `O`는 `0 ≤ O < P`인 정수다. 블럭은 `n ≥ O`이고 `(n-O) mod P = 0`인 틱에서 due다. producer와 consumer 사이에 경계 버퍼를 명시하고 유한한 초기값을 저장한다.

수신자가 due인 틱의 시작에는 **현재 틱보다 앞서 발행된 최신 값**을 읽는다. 이번 틱에 계산한 producer 값은 틱 끝에 발행한다. 두 rate가 동시에 due여도 수신자는 이전 발행값을 사용하며 첫 발행 전에는 초기값을 사용한다. 수신자가 due가 아니면 이전 수신 출력을 유지한다. fast→slow와 slow→fast 모두 이 계약을 적용하고 전달 지연을 UI와 향후 manifest에 표시한다.

아래 표는 초기값을 `I`, producer가 틱 n에 발행하는 값을 `u[n]`이라 할 때의 **명세상 기대값**이며 현재 executable fixture 결과가 아니다. 모든 offset은 0이다.

| 틱 | fast→slow: producer P=1, consumer P=2 | slow→fast: producer P=2, consumer P=1 |
| ---: | --- | --- |
| 0 | `I` | `I` |
| 1 | `I` 유지 | `u[0]` |
| 2 | `u[1]` | `u[0]` |
| 3 | `u[1]` 유지 | `u[2]` |
| 4 | `u[3]` | `u[2]` |

offset이 있는 경우, producer P=2/O=1과 consumer P=1/O=0의 첫 수신 값은 틱 0~1에서 `I`, 틱 2~3에서 `u[1]`이다. 동시 hit, 최초 발행, 비동시 offset, hold, 노드 삽입 순서 독립성을 실행 fixture로 검증한 뒤 공개한다. 임의 비율·비동기 task·실시간 하드웨어 deadline은 이 계약에 포함하지 않는다.

## 8. M1 canonical 시작 후보 22개

기술 백서의 시작 목록을 아래 **22개 canonical capability 후보**로 고정한다. 분류 간 중복과 별칭은 새 엔진으로 세지 않는다. 옵션·shape·단위·수식 범위는 M1 착수 시 세부 계약과 fixture로 확정하며 현재 구현이 없는 후보는 실행할 수 없다. 제한 수식 AST는 `math.function`의 함수 허용 목록과 별도로 명세해야 할 기능이므로 목록 개수만으로 구현 완료를 판단하지 않는다.

| 참조 이름 | canonical ID | 대응표 대표 원본 ID | 현재 상태 |
| --- | --- | --- | --- |
| Constant | `source.constant` | 01-003, 17-004 | M0 scalar 실험 |
| Inport | `io.input` | 01-010, 13-016, 17-014 | M0 scalar 실험 |
| Sum | `math.sum` | 01-020, 08-033 | M0 두 입력 덧셈 실험 |
| Gain | `math.gain` | 01-008, 08-011 | M0 scalar 실험 |
| Product | `math.multiply` | 01-015, 08-020, 09-017 | M0 두 입력 곱셈 실험 |
| Abs | `math.abs` | 08-001 | 미구현 후보 |
| Math Function | `math.function` | 08-013 | 미구현 후보 |
| Trigonometric Function | `math.trigonometric` | 08-035 | 미구현 후보 |
| Rounding Function | `math.round` | 08-025 | 미구현 후보 |
| MinMax | `math.minmax` | 08-016 | 미구현 후보 |
| Sqrt | `math.sqrt` | 08-030 | 미구현 후보 |
| Relational Operator | `logic.compare` | 01-016, 06-021 | 미구현 후보 |
| Logical Operator | `logic.boolean` | 01-012, 06-020 | 미구현 후보 |
| Switch | `route.switch` | 01-021, 15-022 | 미구현 후보 |
| Saturation | `nonlinear.saturation` | 01-017, 04-011 | 미구현 후보 |
| Mux | `route.mux` | 01-013, 15-017 | 미구현 후보 |
| Demux | `route.demux` | 01-006, 15-007 | 미구현 후보 |
| Vector Concatenate | `math.concatenate` | 01-023, 08-037, 15-027 | 미구현 후보 |
| Reshape | `matrix.reshape` | 08-024 | 미구현 후보 |
| Outport | `io.output` | 01-014, 13-019, 16-004 | 미구현 후보 |
| Display | `sink.display` | 16-001 | M0 scalar 실험 |
| Terminator | `io.terminator` | 01-022, 16-008 | 미구현 후보 |

위 목록의 M0 실험 6개와 별도의 Unit Delay(M2), Integrator(M3)를 합쳐 현재 registry 8개가 된다. Display는 Dashboard의 `dashboard.readout`이 아닌 신호 경로의 결과 sink다. 추적표의 실제 상태 승격은 native 이름과 registry ID가 일치하는 **16개 원본행**에 한정하며 8개 canonical 실험의 중복 분류를 포함한다. 나머지 369행, Quick Insert 상수 preset, Add/Subtract/Sum of Elements, Matrix Multiply 등은 미구현 상태를 유지한다.

## 9. 검증 증거와 남은 M0 게이트

모델/컴파일러 테스트는 JSON 재열기, immutable snapshot, 악성 키·접근자·깊이·크기, 파라미터 shape, 끝점·포트·single writer, 실제 순환 경로, 상태 순환, 시간 격자·기록량을 검사한다. 수치 실행은 정적 손계산, 지연 피드백의 상태 순서, decay ODE의 해석해와 간격 축소, 취소·예산, TS export 결과의 동일 fixture로 검증한다. 테스트·빌드·브라우저·성능 측정의 최종 결과와 기준 장비는 별도 M0 검증 기록으로 남긴다. 이 문서에는 아직 측정하지 않은 성능 숫자를 넣지 않는다.

M0를 완료로 선언하기 전 남은 항목은 다음과 같다.

- 실제 초보 사용자에게 블럭 선택·연결·설정·실행·오류 수정 과제를 수행하게 하고 관찰 기록을 남긴다.
- Rate Transition 명세의 실행 fixture와 구현 시점에 관한 종료 조건을 확인한다. 현재 다중 rate 실행 검증은 없다.
- 기준 브라우저·장비의 Worker 취소 지연·예산 경계·메모리·화면 조작을 측정하고 지원 한도를 재검토한다.
- M1의 boolean/vector/2D, 수식 AST, 단위 검사와 세부 블럭 옵션의 계약을 확정한다.
- CalcWeave.com 등록 가능성·소유권·브랜드/상표 검토를 실제로 수행한다. 사용자 제공 도메인 상태를 확인 완료로 바꾸지 않는다.
- 사양·지원 범위·측정 결과·다음 단계 추정에 대한 M0 종료 승인을 기록한다.

실행 가능한 프로토타입은 확보했지만 사용자 조사·외부 확인·종료 승인은 수행되지 않았다. 따라서 M0 상태는 **부분 구현·검증 진행**으로 유지한다.
