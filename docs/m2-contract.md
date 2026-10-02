# CalcWeave M2 구현 계약

> 2026-10-02 · 승인 subset 구현·자동 검증 통과 · 앱0.2.0 / 엔진`0.2.0-m2`

M2는 로컬 정수 tick 이산 실행, 상태·시간 입력·명시적인 정수배 rate, 일시정지·재개·초기화, 독립 TS 실행 묶음을 구현한다. M1의 실제 사용자 조사와 남은 M0 외부 확인을 완료한 것으로 바꾸지 않는다. 이 문서는 실제 승인 옵션의 실행 계약이며 증거는 [검증 기록](m2-validation.md)에 연결한다.

## 타입·샘플시간·자원

- schemaVersion/blockVersion 1을 유지한다. `CalcNode.sampleTime?: { period: number; offset: number }`; period는 1..10000의 정수 base tick 수, offset은 0..period-1 정수다. 기본은 1/0이다. 명시적인 초 단위 주기는 `period × execution.step`이다. fractional/잘못된 offset을 컴파일 전에 거부한다.
- `IRNode.sampleTime: {period, offset}`는 정규화해 항상 제공한다. discrete snapshot에도 기본 rate를 정규화해 의미 hash에 포함한다. static/continuous에서는 비기본 rate를 거부하며 기존 continuous는 M0 scalar 계약을 보존한다.
- tick n의 시각은 startTime+n×step; n≥offset이고 (n-offset)%period=0이면 due다. 모든 출력은 마지막 값을 hold하며 일반 비상태 블럭의 최초 due 전 출력은 descriptor 형상의 0/false다. Constant/Input은 설정한 값을 초기 hold한다. UnitDelay/Delay/Integrator/RT는 initial, Difference/Derivative/Edge는 0/false, FIR/TF는 initial history의 과거 항 기여, State Space는 C×initial을 초기 hold한다. Digital Clock은 startTime을 초기 hold한다. 다른 시간 입력의 초기 hold는 0이며 난수는 최초 due 전 draw하지 않는다.
- 일반 연결은 같은 period/offset만 허용한다. Constant/Input은 timeless이므로 어느 rate에도 연결한다. rate가 다르면 `time.rate-transition`을 명시해야 한다. RT 출력 rate는 그 node.sampleTime이고 입력 rate는 연결된 producer에서 읽는다. 같은 rate의 RT도 한 번의 publication 지연을 유지한다. 임의 rate 추론·비동기 실행은 제공하지 않는다.
- SignalValue/Descriptor는 M1 float64·boolean scalar/vector/2D를 유지한다. M1 정적 23종을 discrete에도 허용한다. continuous는 기존 숫자 scalar·단위 1과 기존 블럭/옵션만 받는다.
- 실행 시간 UI도 schema와 같은 ±1e9 start/stop·1e-9..1e9 step을 허용한다. 일반 scalar 파라미터는 모든 finite float64를 편집하며 개별 정수·상한·64자 draft 제한은 유지한다. 큰 유한값의 overflow는 실행 블럭과 실패tick/time 진단으로 반환한다.
- 신호 1024원소, JSON 5MiB/100000값/32깊이, 모델1000노드/5000연결, tick구간10000, 결과시간축포함1000000원소, 중간 출력100000원소, 연산50000000, active 실행30초 기본 상한을 유지한다. 새 전체 상태 메모리 상한은 100000원소이며 지연·필터·행렬과 held/boundary 값도 예산에 포함한다. compiler preflight와 runtime/export에서 확인한다.
- 연산 preflight는 not-due 블럭도 매 base tick 실행되는 최악 비용으로 보수적으로 계산한다. 저빈도 rate여도 이 상한에 걸릴 수 있다. budget 초과는 browser/export 양쪽에서 구조화한 ModelError 진단으로 반환한다.
- Constant/Input의 timeless 예외는 ordinary 연결에만 적용한다. 설정값은 항상 hold하지만 RT publication은 이 producer의 명시 period/offset due를 따른다. 예: Constant3 P5/O2→RTinitial-1 P1의 n0..5 출력은 -1,-1,-1,3,3,3이다.
- `RunResult.finalState: Record<string, SignalValue>`는 마지막 상태 출력 projection이다. 기존 scalar UnitDelay/Integrator 결과를 보존한다. 새 복합 상태는 optional `stateMemory: Record<string, StateValue>`에 분리해 공개하고 방어복사한다. `StateValue`는 finite JSON-compatible 재귀 값이다. 기존 static/UnitDelay-only/continuous 결과에서는 새 필드를 생략해 기존 result 형태를 보존할 수 있다. 신규 블럭의 내부 메모리까지 parity를 검증한다.

## 정수 tick의 실행 순서

1. 이전 committed 상태와 hold 출력을 고정한다. 입력 독립 상태 출력(UnitDelay/Delay/forwardEulerIntegrator/RT, feedthrough 없는 FIR/TF/state-space)을 먼저 준비한다.
2. due인 시간 source와 direct-feedthrough 블럭을 검증한 DAG 순서로 계산한다. not-due 출력은 hold한다. FIR/TF/state-space 출력은 이전 메모리를 읽는다.
3. 모든 결과를 원본 값으로 기록한다. 각 due 상태의 next-state를 이번 입력과 이전 상태에서 계산하고, reset=true면 초기 메모리 복원이 우선한다. 모든 state를 함께 commit한다. producer가 due인 RT는 이번 입력을 끝에 publication한다.
4. 마지막 기록 tick 뒤에는 일반 상태 전이를 commit하지 않는다. RNG는 자신의 due 출력 생성에 필요한 draw만 소비하며 final memory에 실제 소비한 PRNG state를 남긴다. PRNG는 노드별 독립이라 노드 순서와 다른 source 추가에 영향을 받지 않는다.

`reset` 파라미터는 `none|level`, 기본 none이며 지원 상태에만 둔다. level이면 boolean scalar `reset` 포트가 필수다. 현재 tick 출력은 이전 상태를 사용하며 reset은 **다음 commit**에서 초기 상태 복원을 우선한다. reset 포트는 출력 의존성이 아니므로 algebraic dependency를 추가하지 않는다. 외부 edge reset·동적 delay/taps는 별도 지원하지 않는다.

## 신규 블럭 20종과 승인 옵션

기존 25종에 아래 20종을 더해 registry45종이다. 모든 M2 신규 시간/상태 블럭은 discrete 전용이다. Lookup/Bitwise/Scope는 static·discrete를 지원한다. PID·IIR의 다른 realization·고정소수점·전문 DSP·M3 solver는 포함하지 않는다.

| ID | 파라미터 기본값 / 포트 | 실제 의미·제한 |
| --- | --- | --- |
| `source.step` | stepTime=1,before=0,after=1; out | absolute simulation time. 구간 내 stepTime은 base grid와 해당 source due에 정렬해야 한다. 그 전/후 값 |
| `source.ramp` | startTime=0,slope=1,initial=0; out | t≤startTime이면 initial, 이후 initial+slope×(t-startTime) |
| `source.sine-wave` | amplitude=1,frequency=1,phase=0,bias=0; out | amplitude×sin(2π×frequency×absolute t+phase)+bias. frequency Hz≥0,phase rad |
| `source.pulse` | amplitude=1,period=10,width=5,phase=0; out | period/width/phase는 base tick 정수. period1..10000,width0..period,phase0..period-1. n<phase는0, 이후 (n-phase)%period<width면amplitude |
| `source.clock` | 없음; out | 모든 base tick의 simulation time, 단위 s. rate1/0만 허용 |
| `source.digital-clock` | 없음; out | node due의 simulation time을 갱신하고 사이에는 hold. 단위 s |
| `source.random` | distribution=uniform,seed=1,min=0,max=1,mean=0,variance=1; out | seed0..2³²-1 정수. LCG32: s=(1664525×s+1013904223) mod2³²(Math.imul); U=(s+0.5)/2³². uniform min<max; normal mean+sqrt(variance)×sqrt(-2log(U1))×cos(2πU2),variance≥0. uniform1draw/normal2draw,no cache. 原본 MATLAB 난수열 동등성 제외 |
| `source.repeating-sequence` | times=[0,1],values=[0,1],interpolation=linear; out | times 첫0·엄격증가·2..1024,values 동수finite numeric vector. 마지막 time이 주기. modulo absolute simulation time(음수도 양의나머지),주기 경계는첫값. linear 또는 previous 계단,끝점 discontinuity 명시 |
| `discrete.delay` | steps=2,initial=0,reset=none; in,(reset)→out | steps1..1024,FIFO. typed initial과 같은 shape/type/unit. 모든 slot을 initial로 채움 |
| `discrete.integrator` | initial=0,gain=1,reset=none; in,(reset)→out | forward Euler x[k+1]=x[k]+gain×(period×baseStep)×u[k]. numeric scalar/vector/2D·같은 shape; 이번 subset은 단위1 |
| `discrete.difference` | initial=0; in→out | 현재 numeric 입력−이전 due 입력, 같은 shape/unit |
| `discrete.derivative` | initial=0; in→out | difference/(period×baseStep),numeric·단위1만 |
| `discrete.fir` | coefficients=[1],initial=0,reset=none; in,(reset)→out | 1..128 numeric taps. y=b0u+Σbj×old history. numeric scalar/vector/2D independent channels,initial과같은shape/unit. 첫 계수0이면 output feedthrough없음 |
| `discrete.transfer-function` | numerator=[1],denominator=[1,-0.5],initial=0,reset=none; in,(reset)→out | numeric 단위1 scalar SISO. z⁻¹ coefficient 차분식 y=(Σbiu[k-i]−Σa_j y[k-j])/a0. 배열1..32,num.length≤den.length,a0≠0. initial scalar로 과거 u/y history를 채움. b0=0이면 output feedthrough없음. 원본 z polynomial 기본 설정의 모든 realization 제외 |
| `discrete.state-space` | A=[[0.5]],B=[1],C=[1],D=0,initial=[0],reset=none; in,(reset)→out | numeric scalar 단위1 SISO,N1..16. A NxN,B/C/initial 길이N. y=Cx+D u,xnext=Ax+B u. D=0이면 feedthrough없음 |
| `logic.edge-detect` | mode=rising,initial=false; in→out | boolean scalar,rising/falling/either. 이전 due 입력과 비교. numeric부호경계 Detect preset 제외 |
| `time.rate-transition` | initial=0; in→out | typed initial이 input type/shape/unit과 일치. due 수신자는 tick 시작의 이전 publication을 읽음; 동시 hit도 이전값. producer due이면 tick 끝에 publish. input rate는 producer에서 명시적으로 추적 |
| `lookup.interpolated` | breakpoints=[0,1],values=[0,1],interpolation=linear,extrapolation=clip; in→out | numeric dimensionless input scalar/vector/2D 원소별 1D. bp엄격증가·2..1024,동수numeric values. linear/previous,clip/error 경계. 값 출력 unit은 node annotation 또는1. nD·extrapolate미지원 |
| `logic.bitwise` | operation=and,width=8,shift=1; a,b→out | dimensionless numeric **scalar** unsigned integer만. width1..32,input0..2^width−1; and/or/xor/not/shift-left/shift-right. not/shift는a만. shift0..31,좌shift 결과wrap후widthmask,우shiftlogical; signed/암묵float변환없음 |
| `sink.scope` | 없음; in | 모든typed값 기록,숫자scalar는timeplot·전체표. array는모든샘플과원소에접근 |

기존 `discrete.unit-delay`도 `initial`을 value로 확장하고 reset=none|level을 추가한다. 초기 descriptor를 먼저 정하며 input과 type/shape/unit을 검사한다. Delay/UnitDelay/FIR/Difference/RT의 initial 단위는 node.unit 기본1이며 피드백 추론을 위해 명시한다. source 출력 unit은 node.unit 기본1(Clock류는s),boolean은항상1이다. coefficient·matrix·sequence 입력은 기존 value editor를 사용하되 compiler가 rank·numeric·크기·조합 조건을 재검증한다.

## 일시정지·재개·초기화와 Worker

- `RunOptions.control?: {isPaused:()=>boolean; waitForResume:()=>Promise<void>}`, `onPauseChange?: (paused:boolean)=>void`를 제공한다. safe tick 경계에서만 정지해 half-commit이 없으며 paused 벽시계 시간은 active 실행 예산/elapsedMs에서 제외한다. abort는 wait를 반드시 깨워 종료한다. 계속 Worker에 8ms/64samples 수준으로 yield한다.
- Worker strict protocol run/cancel/pause/resume와 requestId UUID를 검사한다. pause/resume은 해당 active request에만 적용한다. 실제 engine pause callback을 activity 이벤트로 UI에 보내 ack 후만 paused표시/watchdog동결한다. resume ack후남은watchdog재개. static/이미끝난실행을새paused로표시하지않는다.
- client `executeInWorker(model,onProgress?,onPauseChange?)`는 기존2인자호출을 보존하고 pauseActiveRun/resumeActiveRun을 추가한다. UI는 모델·seed·입력 snapshot을 유지한 같은 실행을 이어간다. paused 중편집은다음run설정이고 이어지는결과는stale판정한다. 로고펄스는실제running일때만흐른다.
- 실행 초기화는 active run취소·낡은request무시·기록/진행/진단비우기이며 모델·좌표는보존한다. 다음run은초기값과seed부터새로시작한다. 파일불러오기·reset·unmount시pause wait/timer/Worker누수없어야한다.
- 실행 중 모델 모드를 편집해도 제어 버튼은 현재 실행 snapshot의 mode를 사용한다. 정지 중 mode를 static으로 바꿔도 동일 이산 실행을 재개할 수 있어야 한다.
- `Diagnostic.tick?: number/time?: number`로 이산 수치·next-transition 오류가 발생한 입력 tick/시각을 보존한다. 전이가 다음 iteration 시작에 계산되더라도 원래 입력·출력의 n/t를 표시한다. compiler/preflight 진단에는 아직 실행 sample이 없어 필드를 생략한다.

## 독립 코드와 manifest

`exportTypeScript(compiled,manifest?)`는 기존동기API를보존한다. 새 `createExportManifest(compiled): Promise<ExportManifest>`는 Web Crypto SHA-256 semanticKey hash를계산한다. manifest는schemaVersion1,modelHash/algorithm,engineVersion,targetVersion='typescript-m2-v1',execution정규화설정,perNode sampleTimes/seed,outputTypes,rateTransitionPolicy='read-before-write',dataReferences=[](M4미지원),resourceLimits를담는다. 사용자label은코드문법에삽입하지않는다.

생성 `model.ts`는검증IR/고정kernel만포함한import없는독립run()과manifest접근(getManifest)을제공한다. manifest가주어지지않은API호출도 getManifest가동일hash를계산한다. 기존 M1엄격TS검사의ES2022-only타입환경에서생성코드가통과해야한다. continuous는생성전차단한다.

기존 코드 다운로드는model.ts를유지한다. 추가실행묶음ZIP은추가패키지없이store archive로 `model.ts`,정규화 `model.cw.json`,`manifest.json`,`expected-output.json`,`run-example.ts`,`README.md`를담는다. 기대결과파일은현재스냅샷의완료결과가있을때포함하고없으면README에검증fixture없음을명시한다. 파일명고정·크기상한·Reactescape·Worker재검증을유지하며공개서버/계정/외부API는추가하지않는다.

## 검증

F02 지연피드백과 reset, FIR impulse, 1/2/5 rate(양방향·동시/offset·hold·순서독립),seed반복·분리,typed배열상태,초기값/terminal순서,strictproper filter state-space feedback,1D Lookup경계,unsigned32bit,예산·pause/resume/cancel,모든신규canonical·옵션의독립TS samples/time/shape/stateMemory/diagnostic parity를확인한다. 브라우저에서는새예제·rate편집오류위치·pause중editstale·resume·resetseed재실행·archive/manifest를검증한다. 기존첫로딩맞춤27개회귀를보존한다.
