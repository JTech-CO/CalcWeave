# M3 연속·혼합 실행 계약

기준: 2026-10-02 · 앱 0.3.0 · 엔진 `0.3.0-m3` · JSON schema v1 유지. 실제 수치 증거는 [M3 검증 기록](m3-validation.md), 원본 행별 경계는 [블럭 대응표](block-coverage.md)에 연결한다. M3는 승인한 비강성 실수 ODE와 명시적인 이산 경계를 제공한다.

## 시간과 솔버

| 설정 | 의미와 기본값 | 검증 범위 |
| --- | --- | --- |
| `execution.step` | 원시 결과의 일정한 기록 간격 | 양수, 전체 출력 구간 최대 10,000 |
| `solver.method` | `rk4` 기본, `rk45` 선택 | 고정 간격 RK4 / Dormand–Prince 5(4) |
| `initialStep`, `maxStep` | 기본 `execution.step` | `minStep ≤ initialStep ≤ maxStep`, 최대 1e9 |
| `minStep` | 기본 `min(execution.step,1e-8)` | 최소 1e-12 |
| `atol`, `rtol` | 기본 1e-8 / 1e-6 | 각 1e-12~1 |
| `discreteStep` | 혼합 모델의 이산 base 간격, 기본 `execution.step` | 1e-9~1e9, 혼합 이산 구간 최대 10,000 |
| `eventTolerance` | 사건 시간 구간의 정밀화 허용오차, 기본 1e-8 | 1e-12~1초 |
| `maxSteps`, `maxRejects` | 승인 내부 스텝 / 거절 시도 한도 | 기본·최대 100,000 / 10,000; 거절은 0도 허용 |
| `maxEvaluations`, `maxEvents` | RHS 평가 / 사건 노드 수 한도 | 기본·최대 1,000,000 / 10,000 |

정적·이산 모델에는 solver 설정을 허용하지 않는다. 누락한 필드는 컴파일 때 기본값으로 정규화한다. 기본값을 명시한 모델과 생략한 모델은 같은 의미 hash를 갖는다. 설정의 알 수 없는 필드, 유한하지 않은 값, 뒤집힌 범위는 거부한다.

RK4는 지정한 내부 간격으로 진행하되 출력 격자, 실제 이산 tick, 알려진 입력 변화, 검출한 사건, 지연 경계에서 구간을 나눈다. 순수 ODE에서는 사용하지 않는 이산 격자를 실행하지 않는다. RK45는 5차 해를 승인하고 내장 4차 해와의 차이로 상태별 오차를 추정한다. 모든 상태에서 `abs(error)/(atol + rtol*max(abs(before),abs(after))) ≤ 1`을 만족해야 승인한다. 간격 배율은 `0.9*error^(-1/5)`에 안전한 상·하한을 둔다. FSAL 재사용과 dense-output 보간은 이번 구현에 포함하지 않는다. 일정한 결과 시각까지 직접 적분하므로 결과 격자는 내부 solver 기록과 다르다. [SciPy RK45 알고리즘 설명](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.RK45.html)

경계에 도착하기 위한 마지막 구간은 `minStep`보다 작을 수 있다. 오차 때문에 간격을 줄여야 하는 상황에서 최소 간격에도 실패하면 `RUNTIME_MIN_STEP`으로 종료한다. RK4에는 자동 오차 추정이 없으므로 간격을 바꾸어 수렴을 확인한다. RK45의 국소 허용오차도 전체 해의 정확도나 강성 문제의 해결을 보장하지 않는다.

## 블럭과 신호

Registry는 57종이며 M3가 추가한 canonical 블럭은 12종이다. 정적 26종과 M2 이산 실행은 보존한다. `continuous`를 지원하는 registry 항목도 모든 파라미터·자료형·연결 조합을 지원한다는 뜻은 아니다. ODE 입력·상태 및 M3 경계 블럭은 단위 `1`인 float64 scalar로 제한한다. SISO 시스템 내부 상태 벡터는 최대 16개다. M2의 typed scalar/vector/2D·boolean subgraph는 검증한 이산 영역 안에서 그대로 사용할 수 있다.

| canonical ID | 실행 의미 / 지원 파라미터 |
| --- | --- |
| `continuous.integrator` | 기존 블럭 확장. `x'=u`, `initial`, `reset=none/rising`과 boolean reset 포트 |
| `continuous.second-order-integrator` | `position'=velocity`, `velocity'=u`; `initialPosition`, `initialVelocity`; `out`, `velocity` 출력 |
| `continuous.state-space` | `x'=Ax+Bu`, `y=Cx+Du`; 실수 A N×N, B/C/initial N, D scalar, N=1..16 |
| `continuous.transfer-function` | s 내림차순 실수 계수의 proper 전달함수; 분자·분모 최대 17개, 분모 첫 계수 0 금지, initial 길이=분모 차수 |
| `continuous.zero-pole` | 유한한 실수 zeros/poles, gain을 동일 제어 정준형으로 변환; 각 최대 16개, zeros 수≤poles 수, initial 길이=poles 수; 빈 roots 허용 |
| `continuous.pid` | parallel `kp*u + ki*I + kd*N*(u-F)`; `I'=u`, `F'=N*(u-F)`; `kp/ki/kd/filterN/initialIntegral/initialFilter` |
| `continuous.derivative` | 필터 상태 `F'=N*(u-F)`, 출력 `N*(u-F)`; `filterN>0`, `initial` |
| `time.memory` | `initial`에서 시작하여 직전 승인 major-step의 입력을 다음 승인 시각에서 표시 |
| `time.zero-order-hold` | due 시각의 연속 scalar 입력을 캡처하고 다음 due까지 유지; `initial` |
| `time.first-order-hold` | 이전 두 due 샘플의 기울기를 다음 구간에 외삽; 미래 샘플을 사용하지 않음; 첫 캡처 이후 두 번째까지 기울기 0 |
| `time.transport-delay` | 양의 `delay`, `initial` prehistory; 승인된 이력의 선형 보간과 불연속 좌·우 값 보존 |
| `logic.hit-crossing` | scalar 임계값 `threshold`, `direction=rising/falling/either`; 사건 시각의 boolean pulse와 별도 event 기록 |
| `nonlinear.relay` | `offThreshold < onThreshold` hysteresis, `onValue/offValue`, 밴드 내부 초기 상태 `initial=off/on` |

Transfer Fcn의 상태는 제어 정준형의 내부 상태이며 입력·출력 초기값과 같다고 가정하지 않는다. D가 0이 아닌 State-Space, proper 전달함수의 feedthrough, PID의 `kp+kd*N`, 필터 미분의 feedthrough를 실제 파라미터로 판정한다. 순수 대수 루프는 경로와 함께 거부한다.

Clock/Digital Clock의 기본 단위는 `s`다. 연속 모델에서 명시적으로 `unit='1'`을 선택하면 1초 기준의 무차원 시간 좌표로 해석한다. 이는 물리 단위의 자동 변환이 아니다. Sine Wave의 frequency는 Hz, phase는 rad이며 모든 RK stage의 실제 시각에서 재평가한다. Ramp, Step, Repeating Sequence도 연속 입력으로 재평가한다. Pulse/Random/Digital Clock은 이산 캡처값을 유지한다.

## 혼합 경계와 사건

연속 IR에는 `executionDomain`을 기록한다. 이산 상태·샘플 source는 discrete, ODE 및 연속 시간 source는 continuous, Constant/Input은 constant다. 일반 대수 연산은 입력 도메인을 상속하고 명시한 비기본 sampleTime은 discrete로 해석한다. 일반 대수 연산·결과 블럭의 기본 1/0은 이산 입력 주기를 상속한다. 편집 모델의 기본값과 실제 추론 주기가 다를 수 있으며 export manifest의 sampleTime은 컴파일한 주기다. 연속 입력을 M2 이산 블럭에 연결할 때는 Zero Order Hold가 필요하다. 이산 출력에서 ODE로 연결하는 방향은 이미 공개된 값을 유지한다. 서로 다른 이산 period/offset은 Rate Transition으로 연결한다.

이산 주기는 `period*solver.discreteStep`, offset은 같은 base의 정수다. due tick n에서 이전 상태로 출력하고 원자적인 다음 상태를 준비한다. 그 다음 상태는 tick n+1에서 공개된다. 사이의 연속 계산도 마지막 공개 출력을 읽는다. Rate Transition은 M2의 read-before-write 정책을 유지한다. 마지막 tick에서 이후의 일반 상태 전이는 commit하지 않는다.

ZOH·FOH가 due인 시각에는 해당 시각의 producer 값을 먼저 계산하고 홀드를 한 번 캡처한 뒤 후속 연산을 계산한다. 초기 placeholder를 후속 연산에 먼저 전달하지 않는다. 같은 시각의 현재 입력을 서로 요구하는 캡처 순환은 컴파일 때 `CYCLIC_CAPTURE_DEPENDENCY`로 경로·tick·시각을 진단한다. 검사에는 실제 파라미터의 direct feedthrough와 실행 구간의 due tick을 사용하므로 서로 다른 offset으로 번갈아 갱신하거나 Unit Delay·Rate Transition·Memory·strict proper 상태로 경계를 만든 피드백은 허용한다. 검사는 최대 50,000,000회 작업으로 제한하며 초과하면 `CAPTURE_GRAPH_BUDGET`으로 종료한다.

같은 시각의 순서는 **연속 사건 적용·reset → 이산 캡처와 tick 공개 → 사건 이후 출력 관측**이다. Hit Crossing에 의한 reset은 원래 initial로 상태를 복구한다. 임의의 연속 Compare 출력은 정밀화 가능한 reset guard로 인정하지 않으며 직접 Hit Crossing 또는 이산·상수 boolean 제어를 사용해야 한다. Hit Crossing pulse는 해당 사건 경계에서만 true이고 사건 목록이 시간·노드·종류를 보존한다.

Hit Crossing, Relay, Saturation의 두 경계는 승인 trial 양끝에서 교차를 조사한다. 후보가 있으면 추가 RK trial로 구간을 정밀화하고 가장 이른 사건으로 진행하며 허용오차 안의 동시 사건을 함께 처리한다. Stage·거절 trial·위치 정밀화는 상태, 난수, 홀드, 지연 이력, 사건 기록을 commit하지 않는다. 사건 수 상한은 반복 전환을 중단시킨다. 이 방식은 한 구간 안에서 발생하고 되돌아오는 모든 교차나 접촉을 자동 검출하지 않는다. 빠른 변화를 모델링할 때 maxStep을 충분히 작게 선택해야 한다. [MathWorks zero-crossing 개념](https://www.mathworks.com/help/simulink/ug/zero-crossing-detection.html)

솔버가 위치를 추적하지 않는 연속 round/floor/ceil/trunc, previous Lookup, 임의 연속 Compare에 의해 전환하는 Switch가 ODE 입력 경로에 있으면 `UNREGISTERED_DISCONTINUITY`로 거부한다. 이산 경계를 명시한 계산과 원시 출력 관측은 별도다. 미분 필터도 불연속·잡음에서 ideal derivative나 자동 안정성을 제공하지 않는다.

Transport Delay는 최소 지연보다 큰 내부 step을 허용하지 않는다. 시작 전 이력은 initial이며, 이후는 승인된 샘플 사이를 보간한다. 알려진 입력 jump의 좌·우 값을 같은 시간에 보존하여 지연 출력에서 jump를 ramp로 퍼뜨리지 않는다. 오래된 이력은 필요한 보간점만 남기고 삭제한다. 가변 지연·외부 시계·엔터티 이동은 포함하지 않는다.

## 실행·실패·내보내기

Worker의 pause/resume/cancel은 승인 경계 사이에서 협력적으로 처리한다. 일시정지 시간은 active wall budget에서 제외한다. 실행 snapshot과 UUID는 실행 중 편집한 모델로 바뀌지 않는다. 초기화는 Worker 실행과 결과를 비우며 모델·좌표를 보존한다.

`RunResult`는 raw `samples`, `finalState`, 별도 내부 `stateMemory`, status, elapsedMs, steps에 solverStatistics와 events를 더한다. 연속 결과의 `stateTime`은 finalState의 마지막 승인 시각이다. 취소·실패 시 raw 출력 격자의 마지막 sample 시각과 다를 수 있으며 두 값을 혼동하지 않는다. 통계는 method, accepted/rejectedSteps, evaluations, events, 마지막·최소·최대 승인 step이다. 성공은 completed, 사용자 취소는 cancelled, 제어된 실패의 `ModelError.partialResult`는 failed다. 실패한 trial과 승인 경계의 부분 변경은 rollback하고 마지막 유효 상태·기록만 제공한다. 이후 성공 결과의 fixture처럼 실패 기록을 ZIP에 넣지 않는다.

실행 상한은 출력 10,000구간, 기록 시간축 포함 1,000,000원소, 연산 50,000,000, 논리 상태·홀드·지연 이력 100,000원소, UI active wall 30초다. solver 상한은 위 설정표에 따른다. 모델 JSON 5MiB, 노드 1,000개, 연결 5,000개와 기존 AST·array 상한도 유지한다. 시간 해상도 소실·비유한 중간값·최소 step·거절·평가·사건·이력 한도는 진단으로 종료한다.

연속 TypeScript는 `typescript-m3-v1`, 기존 정적·이산 코드는 `typescript-m2-v1` 타깃이다. 생성 코드는 import 없이 strict ES2022 환경에서 synchronous `run()`으로 실행하며 DOM이나 CalcWeave 패키지를 요구하지 않는다. 저장한 IR 데이터와 저장소 소유 numerical source의 고정 template만 사용한다. 수식은 문자열 대신 bounded AST로 포함한다. `getManifest()`는 SHA-256 의미 hash·정규화 solver·노드 domain/rate/seed·자료형·사건 정책·자원 상한의 독립 복사본을 반환한다. 웹 비동기 제어와 elapsedMs를 제외한 samples/state/memory/events/statistics 및 실패 진단은 동일해야 한다.

## 지원 경계

M3 승인 subset 밖에는 Integrator Limited·2차 적분 제한, PID anti-windup·출력 clamp·2DOF·자동 튜닝, MIMO·복소 root, 강성/implicit solver, DAE·특이 Descriptor·대수 루프 solve, 가변 transport delay, 임의 이벤트 callback, 물리 단위 차원 대수가 있다. Simulink 전체 파라미터·파일·수치 결과의 동등성을 선언하지 않는다. 공개 배포·계정·서버·클라우드 데이터 관리는 이 단계에 추가하지 않았다.
