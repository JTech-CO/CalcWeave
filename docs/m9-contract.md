# CalcWeave M9 구현 계약

작성일: 2026-10-03 · 문서 v0.6 · 상태: 선언 범위 검증 완료(`verified-declared-scope`) · 공개 앱 배포 검증 완료 · 원본 전체 옵션/전체 서비스 출시 별도

M9의 최초 작업 배정은 원본 **58행**이며, 서로 다른 이름 문자열은 55개다. 이 중 baseline의 기존 subset은 27행, 미구현은 31행이다. 분류 family 29개는 작업 묶음이며 engine 수로 합산하지 않는다. 원자료 전체 기준 385행·339이름과 SHA-256 `cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7`를 보존한다.

M8 이후의 제한 DSP·이산 상태·샘플시간 계약을 구현하고 검증했다. 직전 M8 납품은185개 registry·180개 source subset·미구현205행이며 immutable catalog baseline144개·134subset·미구현251행은 과거 기준으로 보존한다. 앱0.10.0·엔진0.10.0-m9는26개 정의·15개 명명 preset을 추가해 registry211개·39예제/6카테고리다. source 승인 기록은 신규31행과 기존05-009 추적 교정1행을 반영해 subset211행·미구현174행이다. 이 수치는 서로 다른 지표이며 원본 전체 옵션이나 공개 Pages 배포 완료가 아니다.

기계판독 정본은 [m9-implementation-map.json](./m9-implementation-map.json)이다. [전체 후속 로드맵](./05-simulink-coverage-roadmap.md)의 baseline 배정과 [기술 계약](./catalog-contract.md)은 이 문서의 snapshot 승인으로 변경하지 않는다. `baselineStatus`는 기존 승인, `delivery`는 검토된 최초 납품 범위, `optionInventory`는 추가 옵션 후보이며 `sourceOptionCompletionStatus=open`은 원본의 전체 옵션 완료가 아직 열린 상태다. 선택한 범위와 source 승격은 [최종 수치 증거](evidence/m9-verification.json)·[source 승인 근거](evidence/m9-source-approvals.json)에 연결했다. 전체58행의 추가 optionInventory는 열린 상태로 보존한다.

## 지원과 분류 규칙

- `new-primitive`: 새 계산·선택·상태 동작이 필요한 source 기능. 공유 수학 helper를 써도 새 표시 정의와 독립 kernel 수를 구분한다.
- `existing-options`: 이미 승인한 기능 또는 공유 primitive의 입력·축·설정·상태 확장. 신규 정의가 필요할 수도 있으나 과거 subset이 완전 지원이었다는 뜻은 아니다.
- `preset`: 상수·함수·선택 설정. 기존 helper의 수식이나 저장된 구성을 재사용하며 독립 engine으로 세지 않는다.
- `shared-new-primitive-config`: 하나의 신규 shared capability를 원본별 설정으로 추적한다.
- `bounded-independent-alternative` / `independent-alternative`: 입출력 또는 언어 계약이 원본과 다른 제한 대체. 원본 native 동등성으로 승격하지 않는다.

현재 finite float64/boolean 및 scalar/vector/2D에서 실현 가능한 추가 옵션은 **M9-followup의 열린 후보**로 보존한다. 검토된 최초 납품에 포함한 선언 mode/shape/options의 구현·검증이 이번 납품 gate이며, 아래 후보 전체를 최초 납품의 필수 blocker로 확대하지 않는다. 구현 난이도, 기존 UI 설정이 적다는 이유만으로 후보를 M10 이후로 옮기지도 않는다. 자료형·복소수·일반 n-D/variable-size 신호 계약(M10), 조건부 실행 문맥(M11), 새로운 ODE 사건면과 solver(M12), 외부 workspace/ABI/라이선스(M14), 타깃 실행 특성(M15)은 구체적인 의존을 남겨 후속으로 분리한다. 원본이 허용하지 않는 타입·형상까지 구현한다는 약속은 하지 않는다.

## 검토된 최초 납품 범위

M9의 firstWork 배정은 P0 미구현 계산과 선택된 기존 옵션을 제한된 API로 구현하기 위한 출발점이다. 58행 전체의 추적 결정은 유지하며, 구현 검토에서 선정한 primitive·설정의 모든 선언 mode/shape/options를 독립 raw oracle·actual TS·JSON·진단·자원 예산·UI/e2e와 직전185개 정의·M8 120fixture+8preset 및71개 catalog fixture 회귀로 판정한다. 31개 baseline 미구현행의 대응 범위를 각각 기록해야 한다. 전체 R2024b 옵션 완료는 별도 source-equivalence 종료조건이다.

미구현31행의 선택 경로는18개 계산/제한 subset·9개 공유 preset·4개 독립 설정 대체로 나뉜다. First Order/Lead or Lag/Real Zero 세 설정 response는 원본의 topology·IC·옵션 reference가 미확정인 대체다. MinMax Running Resettable의 현재 입력 포함 출력·reset 누적 순서도 별도 설정 대체로 분류하며 native 동등성을 주장하지 않는다.

아래 family의 `optionInventoryTaskIds`는 M9-followup 후보 추적 ID다. `minimumFixtures`는 수학 의도를 설명하는 미실행 probe이며 선택 API의 실행 fixture·원본 reference 증거가 아니다. 예를 들어 uniform min=max 후보는 최초 API의 min<max와 구분하여 후속에 남긴다. 아직 확인되지 않은 current-help의 옵션 전체를 최초 납품의 blocker로 자동 추가하지 않는다. 선택 API26개는 `deliveryGate.declaredDefinitionIds`와 최종 실행 증거에 연결했다. actual fixture·configured parameters·지원모드·preset과 원본 identity를 대조해 새31행 및 기존1행 추적 교정을 승인했다. 추가 옵션은 source 전체 동등성 gate를 따른다.

## 공식 사양의 확인 범위

MathWorks의 현재 온라인 도움말을 primary source로 조사했다. R2024b archive에서 Find Nonzero, n-D Lookup, Weighted Sample Time, Wrap To Zero의 대소문자 release URL을 시도했으나 fetch cache-miss로 원문을 확인하지 못했다. 따라서 JSON의 `r2024bExactPageVerified`는 모두 false이고 전체 R2024b 파라미터 inventory 완료를 주장하지 않는다. `current-help-core-semantics-checked`는 핵심 설명을 읽었다는 뜻이며, `reference-link-option-review-pending`은 링크와 추가 검토 후보다. R2025a의 Assume input is within range나 R2026a의 HDL SynthesisAttributes처럼 버전이 명시된 신규 옵션을 R2024b 필수 옵션으로 자동 합산하지 않는다.

수학 oracle는 독립 계산의 정확도를 검증한다. 실제 Simulink reference model, 같은 solver·sample time·dtype·비영 초기상태 비교가 없는 상태에서 MathWorks 실행과 비트 동일성을 주장하지 않는다. 문서가 서로 충돌하는 옵션은 미확정으로 남긴다.

## 먼저 확정한 의미

| 항목 | M9 계산·추가 옵션 검토 계약 | 이후와 미확정 경계 |
| --- | --- | --- |
| Weighted Sample Time / Math | Ts는 초 단위 물리적 주기. baseStep 0.1·period3·weight2이면 weightedTs=0.6, 1/TsOnly=1/0.6 | period3을 주기3초나 rate3으로 해석 금지. periodic rate 추론과 aperiodic elapsed-time(M11)을 구분. − 연산 설명의 피감수 의미는 reference 확인 gate. [공식](https://www.mathworks.com/help/simulink/slref/weightedsampletime.html) |
| Decrement Time To Zero | max(u−Ts,0), state 없는 입력 계산 | resettable timer/counter와 구분. [관련 공식](https://www.mathworks.com/help/simulink/slref/decrementtozero.html) |
| Discrete Filter와 Transfer Fcn | Filter는 ascending z⁻¹ 계수, Transfer Fcn은 descending z 계수 | 길이가 다르면 leading delay가 달라진다. 현재 같은 helper를 무조건 공유하면 안 됨. [Filter](https://www.mathworks.com/help/simulink/slref/discretefilter.html) |
| DF2 Time Varying 20-003 | denominator leading1을 생략한 입력·Num 길이=DenNoLead 길이+1·state 유지 | 계수 변경 뒤 과거 state를 매 틱0으로 reset하지 않음. [공식](https://www.mathworks.com/help/simulink/slref/transferfcndirectformiitimevarying.html) |
| Propagation Delay 05-013 | 각 Uk,Dk를 Tk+Dk에 발행 예약; initial output·strictly increasing arrivals | dt finite positive>128eps, fixed interval에서는 dt>Ts·delay/Ts floor. arbitrary release event scheduler 및 ODE 정렬을 분리. [공식](https://www.mathworks.com/help/simulink/slref/propagationdelay.html) |
| Variable Integer Delay | runtime delay는 truncate 및 bounds cast, dialog noninteger/out-of-range는 오류 | d=0 feedthrough, enable/reset/IC·buffer 순서 모두 검증. strict runtime rejection은 독립 설정. [공식](https://www.mathworks.com/help/simulink/slref/variableintegerdelay.html) |
| PID 2DOF | P는 b·r−y, I는 r−y, D는 c·r−y에 각각 작용 | FE/BE/Trapezoid·Parallel/Ideal·IC·limits·antiwindup·tracking 등 finite-real 설정은 M9-followup 후보. 최초 납품의 선택 API를 별도로 검증한다. 자동 tuning/continuous solver는 후속. [공식](https://www.mathworks.com/help/simulink/slref/discretepidcontroller2dof.html) |
| Check Discrete Gradient 11-002 | abs(u[k]−u[k−1])<abs(maxGradient), strict equality | Ts로 나눈 derivative가 아니다. fixed-step discrete 요구·scalar assertion. [공식](https://www.mathworks.com/help/simulink/slref/checkdiscretegradient.html) |
| Check Input Resolution 11-007 | scalar resolution이면 mod(u,resolution)<0.01; vector는 membership 설명 | 시간변화 검사가 아님. vector membership과 dimension 설명의 조합 reference 미확정. [공식](https://www.mathworks.com/help/simulink/slref/checkinputresolution.html) |
| Band-Limited White Noise | held Gaussian variance=noisePower/Ts, power는 PSD 높이 | own PRNG 재현과 MathWorks seed sequence parity 구분. 채널별 stream 및 draw 소비 검증. [공식](https://www.mathworks.com/help/simulink/slref/bandlimitedwhitenoise.html) |
| PWM / Variable Pulse | duty∈[0,1], 물리적 period·width, fixed sampling floor | cycle-start latch·zero duty·동적 period·edge equality를 fixture로 확정. [PWM](https://www.mathworks.com/help/simulink/slref/pwm.html), [Variable Pulse](https://www.mathworks.com/help/simulink/slref/variablepulsegenerator.html) |
| Sample-based Sine | k0부터 A·sin(2π(k+offset)/p)+bias, due마다 k modulo p | conditional subsystem reset은 M11; A·sin(ωt) time-based와 구분. [공식](https://www.mathworks.com/help/simulink/slref/sinewavefunction.html) |

Read-before-write는 기존 Delay/Unit Delay/Rate Transition 경계의 결정성을 보존한다. Direct-feedthrough인 Difference, filter와 일부 적분 모드는 현재 입력을 읽으며 상태를 commit할 때만 갱신한다. 모든 블럭을 한 틱 늦추는 규약으로 단순화하지 않는다. external reset의 Level은 현재 nonzero 또는 이전 nonzero에서 0으로 떨어지는 경우도 적용하고, Levelhold는 현재 nonzero인 동안 적용한다. [Discrete Filter](https://www.mathworks.com/help/simulink/slref/discretefilter.html)

선택한 필터 reset 계약에서는 reset이 활성인 due의 출력을 초기 슬롯에서 현재 입력으로 다시 계산한다. 그 due 이후의 commit은 초기 슬롯을 유지하며 현재 입력을 새 슬롯에 저장하지 않는다. enable=false와 reset이 겹치면 reset을 우선한다. 예를 들어 b=[1], a=[1,−0.5], 초기 슬롯0, u=[1,1,1,1,1], reset=[0,1,0,0,0]에서 Level 출력은[1,1,1,1,1.5], Levelhold 출력은[1,1,1,1.5,1.75]다. 이 read/commit 위상은 CalcWeave의 명시한 subset이며, MathWorks reference 실행의 입력 캡처 위상까지 확인했다는 뜻은 아니다. 필터 구조별 IC 좌표·reset·enable 조합의 source 전체 동등성은 열린 상태로 남긴다.

## 선택한 선언 API

- `discrete.filter`: ascending z⁻¹ `filter`와 descending z `transfer` representation, DF1/DF1T/DF2/DF2T를 나눈다. 전달함수의 부족한 numerator 차수는 leading padding으로 지연을 유지한다. fixed coefficients 각각1~33개, finite real sample-channel·zero/비영 IC·reset/enable이다. 프레임 처리는 이번 API에서 제외하고 M9-followup으로 남긴다. `stateInitial`은 channel×해당 structure의 state 좌표 순서로 flatten하며 같은 수를 다른 구조의 동일 물리 상태로 간주하지 않는다.
- `discrete.filter-time-varying`: 차수1~32의 DF2, numerator 포트 길이order+1, denominator 포트 길이order로 leading1을 생략한다. 변경된 계수에 기존 state를 적용한다.
- `discrete.delay-configured`/`discrete.tapped-delay`: fixed/variable due-count, zero lag·truncate-clamp/strict·parameter/port IC, 선택 reset/enable. tapped 출력은 scalar channel의 고정 벡터이며 다른 channel/frame 형태는 followup이다.
- `discrete.propagation-delay`: rawArrival=time+delay의 엄격한 증가를 검사한다. 물리적 releaseDue는time+floor(delay/Ts)×Ts이며, 구현은captureTick+floor(delay/Ts)×period의 정수 due index로 발행해 부동소수점 시각 비교로 한 tick 늦어지는 일을 방지한다. delay>Ts·delay>128eps·safe integer due index를 요구하고 마지막 기록 due에도 delay와 raw arrival 순서를 검증한다. 같은 releaseDue의 여러 항목은 capture 순서대로 꺼내 마지막 값을 발행한다. arbitrary-time event solver는 지원하지 않는다.
- `discrete.pid`/`discrete.pid-2dof`: unitless scalar·Parallel, FE/BE/trapezoid의 적분과 미분 필터·고정 clamp·clamping anti-windup이다. Ideal·back-calculation/tracking·coefficient port 등의 후보는 M9-followup open이다.
- `discrete.state-space-mimo`: A N×N/B N×M/C P×N/D P×M·각축1~16·unitless vector 입출력이다. `discrete.integrator-configured`와 `discrete.difference-configured`는 이전 due 이력과 물리적 Ts를 명시한다.
- `time.weighted-math`: TsOnly(s), inverse(Hz), add/subtract/multiply/divide. subtract의 선언은u−weight×Ts이며 원본 문장의 polarity reference는 미확정이다. `time.decrement-to-zero`는max(u−Ts,0), `signal.initial-condition`은첫 due의initial 이후current input이다.
- `logic.numeric-edge`의7개 모드·`math.running-minmax`·`source.counter`의free/limited는 공유 kernel 설정을 원본 ID별로 추적한다. counter의 계산 출력은float64 safe integer이며 원본 integer dtype 동일성을 주장하지 않는다.
- `math.running-minmax`: 현재 입력과 누적 상태의 min/max를 현재 due에 출력한다. reset due에도 IC와 현재 입력의 min/max를 출력한 뒤 commit은 IC를 유지한다. 현재 공식 도움말의 reset 출력=IC 설명 및 DirectFeedthrough=no 특성과 위상 차이가 있으므로 08-017은 독립 설정 대체다. IC=0은 공식 예제와 일치하지만 이것만으로 출력·reset 동등성을 확인하지 않는다. [공식](https://www.mathworks.com/help/simulink/slref/minmaxrunningresettable.html)
- 잡음/난수·PWM/variable pulse·signal generator·sample sine·sample sequence는 선언된 held sample 동작이다. Gaussian variance=noisePower/Ts, seed stream은 자체 규약이며 MathWorks seed bit parity가 아니다. sample sequence는 균등 due 간격의 scalar 확장이며 기존 arbitrary time vector 계약을 바꾸지 않는다.
- `verify.gradient`는 discrete-only strict absΔu<abs(maximumGradient)다. `verify.resolution`은scalar/1D float64 입력과 scalar positive resolution의mod<tolerance이며 검사 실패 시 실행을 중단한다. 원본 vector membership과 optional output/warning/callback 설정은 열린 후속이다.

새26개는 정적 실행을 선언하지 않는다. `verify.gradient`는 이산만, 나머지25개는 이산/연속 모델 안에서 고정 due-grid 동작을 선언한다. 연속 지원 표기는 모든 ODE feedback·사건 solver 지원을 뜻하지 않는다. 선택한 선언 API는 최종 수치·코드 생성·단위 및 영향받은 브라우저 검사로 검증했다. 전체 source 옵션은 후속이며 공개 앱 배포 검증은 별도 증거로 완료했다.

## 독립 review fixture 후보

아래 이름은 독립 수학 oracle다. 31개 미구현행 모두의 선택 fixture를 JSON `rows[].delivery.evidenceFixtureIds`에 연결하고 compiled canonical·필수 설정·preset identity를 대조했다. 이 연결을 actual TS/mode evidence와 대조해 승인했으며, fixture가 존재한다는 이유만으로 source 전체 옵션을 승인하지 않는다. 기존27행 가운데 선택 확장 경로도 가능한 fixture에 연결하고, 기존05-009 전달함수 교정은 신규31행과 따로 센다.

- `m9-filter-zinv-degree-gap`: b=[1], a=[1,−0.5], zero IC, impulse[1,0,0,0]이면 ascending z⁻¹ Filter는[1,0.5,0.25,0.125].
- `m9-transfer-descending-z-degree-gap`: 같은 계수의 descending z Transfer Fcn은[0,1,0.5,0.25]. b=[2], a=[2,−1]을 쓰는 `m9-transfer-leading-normalization`도 같은 지연 응답이다.
- `m9-df2-time-varying-retains-state`: num=[1,0], denNoLead가[−0.5]→[−0.25]→[−0.75], u=[1,0,0], zero IC이면[1,0.25,0.1875].
- `m9-variable-delay-current-zero-lag`: u=[1,2,3], d=[0,1,2]이면[1,1,1]. d=0의 현재 입력과 이전 commit buffer를 구분한다.
- `m9-weighted-period-not-rate`: baseStep0.1·period3·offset2·weight2에서 weightedTs는0.6초다. offset은 물리적 주기 길이를 바꾸지 않는다.
- `m9-reset-level-includes-falling-edge` / `m9-reset-level-hold-current-only`: 위 reset read/commit 구분을 literal5-sample 결과로 검증한다.
- `m9-causal-filter-unused-state-overflow-{df2,df2t,df1t}`: b0=0인 causal 출력의 read가 실제 입력으로 계산할 commit의 사용하지 않는 임시 슬롯을 계산해 실패하지 않아야 한다. 출력과 다음 슬롯이 모두 유한한 cancellation 사례를 별도로 검증한다.
- `m9-sequence-subnormal-constant` / `m9-sequence-subnormal-tie`: 균등 선형 sequence의 상수 MIN_VALUE는 그대로 유지하고, MIN_VALUE와2×MIN_VALUE의 중간값은 round-to-nearest-even으로2×MIN_VALUE다. 일반 절대 오차 허용으로0 결과를 통과시키지 않는다.
- `m9-numeric-change-boolean`: initial=false와 입력[false,true,true]의 change 결과는[false,true,false]다. 숫자 sign 비교와 허용하는 boolean equality를 구분한다.

읽기 전용 독립 검토에서 선택12fixture의40개 raw sample을 정확 비교하고 마지막 기록 tick의 Propagation Delay 진단2건을 원본 node/tick/time으로 재현했다. causal 필터 임시 overflow·sequence subnormal·boolean 변화 검출은 구현 담당이 교정했고 해당 probe가 통과했다. 전체 선언 옵션·actual TS·배포 build·UI 회귀의 단계 승인 결과는 root 검증에 따라 별도로 기록한다.

신규31행의 제한 범위와 기존05-009의 추적 교정1행을 승인해 현재source subset211행·미구현174행이다. 원본08-028 Sine Wave Function의 sample-based 후속도 추적하지만 M9 firstWork58행에는 추가 합산하지 않는다. 최종151raw fixture records·30preset mode records·10실패 parity·693raw samples·191actual TypeScript 프로그램과31파일2,175개 전체 unit이 통과했다. 마지막 수치 수정 전 전체browser129/129와 수정 후 영향받은5/5는 별도 기록이며 최종M9 merge의 GitHub Actions에서 전체unit2,175개·루트browser129/129·project browser4/4가 통과했다. 앱0.10.0·엔진0.10.0-m9의 공개 Pages artifact와 실제 브라우저9개 검증을 완료했다. [검증 기록](m9-validation.md)에 최종 CI·공개 근거와 남은 전체 옵션/서비스 게이트를 기록한다.

## 작업 family와 추가 옵션 inventory

### m9-delay · 지연·탭·가변 지연

원본 ID: 01-005, 05-001, 05-014, 05-015, 05-019, 05-020 · 분류: `existing-options`

- `m9-delay-01`: fixed delay0/1/N 및 dynamic d·maxDelay·초기 buffer·same-shape boolean/f64 signal
- `m9-delay-02`: dynamic d는 공식 truncation+range casting 경로와 strict-error 확장을 구분; d=0 feedthrough/compiler-cycle 정책
- `m9-delay-03`: enable·external IC·level/rising/falling/either/levelhold reset과 output-before/after-reset 규약·ringbuffer commit 원자성
- `m9-delay-04`: tapped scalar→N vector oldest/newest 및 current input 포함 설정·고정/가변 rank≤2 channel histories

핵심 확인: [MathWorks variableintegerdelay](https://www.mathworks.com/help/simulink/slref/variableintegerdelay.html), [MathWorks tappeddelay](https://www.mathworks.com/help/simulink/slref/tappeddelay.html). R2024b exact version은 미확정.
### m9-integrator · 이산 적분 옵션

원본 ID: 01-007, 05-011 · 분류: `existing-options`

- `m9-integrator-01`: integration/accumulation·Forward Euler/Backward Euler/Trapezoidal·physical Δt과 gain
- `m9-integrator-02`: internal/external IC·initial condition setting/output/state ports, saturation limits 및 optional saturation output
- `m9-integrator-03`: level/rising/falling/either reset·enable 및 due commit·real scalar/vector/2D
- `m9-integrator-04`: 현재 FE delayed output 회귀와 BE/trapezoid directfeedthrough 명시
### m9-difference · 이산 차분

원본 ID: 05-002 · 분류: `existing-options`

- `m9-difference-01`: 현재입력−이전 due입력·scalar/vector/2D·initial input 이력
- `m9-difference-02`: input processing sample/channel·frame processing이 선택된 경우 frame 내 순차 state 처리
- `m9-difference-03`: 타입/단위·stateMemory·offset due 및 초기시각
### m9-derivative · 샘플시간 차분

원본 ID: 05-003 · 분류: `existing-options`

- `m9-derivative-01`: difference/physicalTs 및 gain,real scalar/vector/2D·initial 이력
- `m9-derivative-02`: 채널/프레임 입력 처리 가능한 옵션·초기/마지막due tick·부정확rate진단
### m9-fir · FIR 구조·계수·채널

원본 ID: 05-004 · 분류: `existing-options`

- `m9-fir-01`: Direct form/Transposed 등 원본 real 구조·정적 또는 input-port coefficient·비영 initial states
- `m9-fir-02`: sample-based elementchannels 및 frame-based columnchannels·각채널独立state
- `m9-fir-03`: dynamic coefficients와 state retention·reset·leading coefficient/groupdelay·gain scaling
### m9-iir-filter · IIR·DF2·시간변화 계수

원본 ID: 05-005, 20-002, 20-003 · 분류: `new-primitive`

- `m9-iir-filter-01`: z^-1 ascending coefficients; DF1/DF1T/DF2/DF2T의 구조별 state count·initial states 정확대응
- `m9-iir-filter-02`: static 또는 coefficient input ports·sample/frame channels·scalar/vector/2D 가능한 경로
- `m9-iir-filter-03`: DF2 Time Varying은 Num length==DenNoLead length+1, denominator leading1 암묵; coefficient change 시 state 유지
- `m9-iir-filter-04`: 일반filter a0 normalization·zero a0 진단과 DF2 special leading1 계약을 분리
- `m9-iir-filter-05`: reset Level은 current nonzero 또는 previous nonzero→current0 전이도 reset; Levelhold는 current nonzero만 reset. IC/output/commit 순서를 fixture로 고정

핵심 확인: [MathWorks discretefilter](https://www.mathworks.com/help/simulink/slref/discretefilter.html), [MathWorks transferfcndirectformii](https://www.mathworks.com/help/simulink/slref/transferfcndirectformii.html), [MathWorks transferfcndirectformiitimevarying](https://www.mathworks.com/help/simulink/slref/transferfcndirectformiitimevarying.html). R2024b exact version은 미확정.
### m9-pid · 이산 PID·2DOF

원본 ID: 05-006, 05-007 · 분류: `new-primitive`

- `m9-pid-01`: PID/PI/PD/P/I 및 Parallel/Ideal·P,I,D,N static/dynamic params·filtered/unfiltered derivative
- `m9-pid-02`: integral/filter FE/BE/Trapezoid·internal/external IC·reset·output limits·antiwindup clamping/backcalculation·tracking
- `m9-pid-03`: 2DOF reference r/measured y, proportional b*r−y,integral r−y,derivative c*r−y의 setpointweights
- `m9-pid-04`: Use I*Ts 등의 gain convention·scalar/vector가능 경로·각due physicalΔt; 실제 수치 동작 모드조합 fixture

외부 tuning app·automatic tuning은 M12 분석/M14 licensed adapter이며 수동 real PID 구현을 미루는 근거 아님

핵심 확인: [MathWorks discretepidcontroller](https://www.mathworks.com/help/simulink/slref/discretepidcontroller.html), [MathWorks discretepidcontroller2dof](https://www.mathworks.com/help/simulink/slref/discretepidcontroller2dof.html). R2024b exact version은 미확정.
### m9-state-space · MIMO 이산 상태 공간

원본 ID: 05-008, 21-014 · 분류: `existing-options`

- `m9-state-space-01`: x[k+1]=A*x[k]+B*u[k],y[k]=C*x[k]+D*u[k]
- `m9-state-space-02`: scalar/vector MIMO의 A[n,n] B[n,m] C[p,n] D[p,m]와 initial[n], state/reset options
- `m9-state-space-03`: D zero 여부로 feedthrough 의존 정확추론·nested state units·자원예산
### m9-transfer-function · z-domain 전달함수·구성

원본 ID: 05-009, 05-010, 05-016, 05-017, 05-018 · 분류: `existing-options`

- `m9-transfer-function-01`: Discrete Transfer Fcn의 descending z coefficient·분자/분모 unequal length leading padding을 z^-1 filter와 구분
- `m9-transfer-function-02`: real roots+gain Zero-Pole realization·stateIC,scalar/vector 채널; complex conjugate root 표기 M10
- `m9-transfer-function-03`: first-order unity DC gain·lead/lag zero/pole·realzero.previous-input 및 previous-output 초기조건을 독립 구성으로 표현
- `m9-transfer-function-04`: 공식 수식에 이미지로만 남은 topology/순간 gain은 reference fixture 미확정 gate로 표시; 추정만으로 native 승인 금지

핵심 확인: [MathWorks transferfcnfirstorder](https://www.mathworks.com/help/simulink/slref/transferfcnfirstorder.html), [MathWorks transferfcnleadorlag](https://www.mathworks.com/help/simulink/slref/transferfcnleadorlag.html), [MathWorks transferfcnrealzero](https://www.mathworks.com/help/simulink/slref/transferfcnrealzero.html). R2024b exact version은 미확정.
### m9-propagation-delay · 발행 예약 지연

원본 ID: 05-013 · 분류: `new-primitive`

- `m9-propagation-delay-01`: sample input at Tk, publish Uk at Tk+Dk; y0 before first release·bounded schedule queue; dt>128*Number.EPSILON, finite scalar 양수 검사
- `m9-propagation-delay-02`: fixed interval path: positive delay>Ts, delay/Ts floor to integer grid·raw arrival strictly increasing; quantized release ties는 capture 순서의 마지막 값 발행
- `m9-propagation-delay-03`: run-at-fixed=false는 arbitrary release events scheduler 요구; M9 discrete scheduler로 가능한 경로는 구현, ODE event alignment M12와 분리
- `m9-propagation-delay-04`: 동적delay 변경·last release·out-of-order·queue budget·node/tick diagnostics

핵심 확인: [MathWorks propagationdelay](https://www.mathworks.com/help/simulink/slref/propagationdelay.html). R2024b exact version은 미확정.
### m9-zero-order-hold · 샘플 후 유지

원본 ID: 05-021 · 분류: `existing-options`

- `m9-zero-order-hold-01`: physicalTs/offset due에서 입력 샘플·그 사이 값유지
- `m9-zero-order-hold-02`: 동시 hit·reset/inactive hierarchy 경계·unit/vector/matrix
- `m9-zero-order-hold-03`: 연속 출력 grid와 due sample 동일·read-before-write 정책·입력 값 변경 뒤 refresh 시각
### m9-detect · 값·부호 변화 검출

원본 ID: 06-008, 06-009, 06-010, 06-011, 06-012, 06-013, 06-014 · 분류: `existing-options`

- `m9-detect-01`: Detect Change u!=prev,Decrease u<prev,Increase u>prev for numeric/boolean admissible
- `m9-detect-02`: Fall Negative(prev>=0,u<0),Fall Nonpositive(prev>0,u<=0),Rise Nonnegative(prev<0,u>=0),Rise Positive(prev<=0,u>0)
- `m9-detect-03`: scalar/vector/2D·initial previous input·boolean输出·due commit·각 equality sign boundary
- `m9-detect-04`: 동일helper mode preset은 독립 state engine 수로 합산하지 않음
### m9-running-minmax · resettable 누적 극값

원본 ID: 08-017 · 분류: `new-primitive`

최초 대응은 `operation=max`의 현재 입력 포함 누적 계산인 독립 설정 대체다. 원본의 no-direct-feedthrough 특성 및 reset exact-IC 위상은 reference 미확정으로 남긴다.

- `m9-running-minmax-01`: element/channel별 누적 min 또는 max·real shape 및 initial state
- `m9-running-minmax-02`: reset input의 configured predicate·current input 포함/제외 시점·첫 출력
- `m9-running-minmax-03`: 형상/단위·stateMemory·pause/resume·unknown initial 방지
### m9-weighted-time · 물리적 샘플주기 수식

원본 ID: 08-038, 14-013, 20-006 · 분류: `new-primitive`

- `m9-weighted-time-01`: Ts는 seconds,baseStep*node.period(continuous held domain에서는 solver.discreteStep*period), 비율 period 그 자체가 아님
- `m9-weighted-time-02`: TsOnly=w*Ts,1/TsOnly=1/(w*Ts),+,-,*,/ with u와 weightedTs; divide zero 및 units
- `m9-weighted-time-03`: DecrementTimeToZero=max(u−Ts,0) stateless·real scalar/vector/2D
- `m9-weighted-time-04`: periodic input signal rate 추론·boundary RateTransition 후 rate·aperiodic elapsed time은 M11 context 필요; '-' 공식 표현 혼동은 exact reference gate

핵심 확인: [MathWorks weightedsampletime](https://www.mathworks.com/help/simulink/slref/weightedsampletime.html). R2024b exact version은 미확정.
### m9-gradient · 연속 샘플의 절대 차이 검증

원본 ID: 11-002 · 분류: `new-primitive`

- `m9-gradient-01`: 공식 조건은 원소별 abs(u[k]−u[k−1]) < abs(maximumGradient); Ts로 나누지 않음
- `m9-gradient-02`: fixed-step discrete 실행·initial previous value의 reference 검증·scalar/vector/2D aggregate assertion
- `m9-gradient-03`: enable/stop-or-warn/optional scalar assertion output·strict equality·실패 node/tick 진단

핵심 확인: [MathWorks checkdiscretegradient](https://www.mathworks.com/help/simulink/slref/checkdiscretegradient.html). R2024b exact version은 미확정.
### m9-resolution · 값의 양자화 resolution 검증

원본 ID: 11-007 · 분류: `new-primitive`

- `m9-resolution-01`: scalar resolution: MATLAB mod(u,resolution) < 0.01, 시간 차분이나 derivative가 아님
- `m9-resolution-02`: vector resolution: 문서 membership 규칙과 element-wise dimension 설명의 실제 정합을 reference fixture로 확정
- `m9-resolution-03`: 실수 scalar/vector 및 assertion enable/stop-or-warn/optional scalar output·mod 음수값·exact tolerance boundary

vector resolution의 any-membership 문구와 동일차원 element-wise 문구가 공존; 해당 조합의 exact oracle는 미확정

핵심 확인: [MathWorks checkinputresolution](https://www.mathworks.com/help/simulink/slref/checkinputresolution.html). R2024b exact version은 미확정.
### m9-ic · 초기값 신호

원본 ID: 14-007 · 분류: `new-primitive`

- `m9-ic-01`: 첫 실행시 설정 InitialValue·그 뒤 input pass-through·scalar/vector/2D sourceIC shape
- `m9-ic-02`: startTime!=0·첫due/hold·reset/reenable semantics 및 initial solver stage로 노출되는 시점
- `m9-ic-03`: ODE 초기화/solver-specific initialize 후속M12, 일반 periodic discrete 첫값은 M9

핵심 확인: [MathWorks ic](https://www.mathworks.com/help/simulink/slref/ic.html). R2024b exact version은 미확정.
### m9-rate-transition · 샘플시간 경계

원본 ID: 14-009 · 분류: `existing-options`

- `m9-rate-transition-01`: 각input/output rate·offset·fast/slow 및 simultaneous hit·initial buffer; current read-before-write baseline 보존
- `m9-rate-transition-02`: data integrity와 deterministic transfer 옵션을 real single-thread schedule의 선택 정책으로 검증
- `m9-rate-transition-03`: nonharmonic commensurate rates·stateMemory·due edge·hold output·race 없는 export
- `m9-rate-transition-04`: 실제 target task/thread/interrupt guarantees는 M15; browser independent determinism과 구분
### m9-band-noise · PSD→held Gaussian noise

원본 ID: 17-001 · 분류: `new-primitive`

- `m9-band-noise-01`: Gaussian held draws,variance=noisePower/physicalCorrelationTime,noisePower는 분산 그 자체가 아님
- `m9-band-noise-02`: seed scalar/vector/2D·독립channel streams·1D/row/column parameters·값유지
- `m9-band-noise-03`: CalcWeavePRNG exact reproducibility와 MathWorks seed sequence bit parity를 분리; 후자는 알고리즘 미확정
- `m9-band-noise-04`: finitepositive PSD/Ts·noise fixture 통계/정확 draw consumption·pause/resume

핵심 확인: [MathWorks bandlimitedwhitenoise](https://www.mathworks.com/help/simulink/slref/bandlimitedwhitenoise.html). R2024b exact version은 미확정.
### m9-chirp · 주파수 sweep 옵션

원본 ID: 17-002 · 분류: `existing-options`

- `m9-chirp-01`: initial/target frequencies·targetTime 및 source frequency-unit convention·실제 공식linear-sweep 범위
- `m9-chirp-02`: 현재 linear chirp의 timeorigin/phase/amplitude 추가parameter가 own확장인지 구분
- `m9-chirp-03`: scalar/vector parameters 가능한 옵션·initial/final time·physicalHz/radSec mismatch·sample held/continuous oracle
### m9-clock · 실제 시각·due 시각

원본 ID: 17-003, 17-007 · 분류: `existing-options`

- `m9-clock-01`: Clock actual continuous time vs DigitalClock last due time seconds
- `m9-clock-02`: sampleTime/offset·display-decimation only UI option·startTime!=0/lasttick
- `m9-clock-03`: held source와 simulation absolute time의 구분·아주 큰 startTime의 정확시간오류
### m9-counter · 정수값 순환 카운터

원본 ID: 17-005, 17-006 · 분류: `new-primitive`

- `m9-counter-01`: free-running bitwidth wrap(최소 typedwidth의 float64 exact값 subset)·limited upper inclusive후0
- `m9-counter-02`: 초기0·샘플due에 한 번 update·현재output/nextcommit·integer safe range·offset
- `m9-counter-03`: width8/16/32 및 arbitrary limit을 float64integer결과로 구분; 실제 uint dtype는 M10
### m9-pulses · 이산·가변 pulse/PWM

원본 ID: 04-006, 04-013, 17-016 · 분류: `new-primitive`

- `m9-pulses-01`: Pulse Generator time-based amplitude/period(seconds)/width(percent)/phaseDelay 또는 sample-based ticks
- `m9-pulses-02`: PWM scalarD∈[0,1],parameterPeriod·VariablePulse D/P inputs,initial delay·zeroDuty/zeroWidth設定
- `m9-pulses-03`: fixed sampling floors pulseWidth/Ts 및 period/Ts·cycle boundary에서 duty/period latch 규약·δ change fixture
- `m9-pulses-04`: arbitrary physical edge scheduling은 discrete scheduler 가능한 부분 M9, ODE guard/event alignment M12

핵심 확인: [MathWorks pwm](https://www.mathworks.com/help/simulink/slref/pwm.html), [MathWorks variablepulsegenerator](https://www.mathworks.com/help/simulink/slref/variablepulsegenerator.html). R2024b exact version은 미확정.
### m9-ramp · 시각별 ramp

원본 ID: 17-017 · 분류: `existing-options`

- `m9-ramp-01`: slope/startTime/initial scalar/vector parameter expansion·1D/row/column shape
- `m9-ramp-02`: t<start→initial, t>=start→initial+slope*(t−start); exact due start/equality
- `m9-ramp-03`: 현재 continuous piecewise guards 보존 및 parameter update event시각
### m9-random · 분포별 seeded 난수

원본 ID: 17-018, 17-026 · 분류: `existing-options`

- `m9-random-01`: normal mean/variance 및 uniform min/max scalar/vector/2D parameters·seed source shape
- `m9-random-02`: 정확PRNG/draw-order·채널독립·sample due/hold·variance0 등의degeneratecase
- `m9-random-03`: 자체 PRNG 비트재현과 MathWorks sequence matching 미확정 구분·optional reset context M11
### m9-repeating · 주기 수열·보간

원본 ID: 17-019, 17-020, 17-021 · 분류: `existing-options`

- `m9-repeating-01`: time/value vectors·linear/zero-order stair·periodic endpoint 및 uneven time knots
- `m9-repeating-02`: RepeatingSequenceInterpolated lookup-method형 modes/last point/reset reference검증, Stair values/sampletime counter
- `m9-repeating-03`: vector/2Dchannel values 가능한 고정형상·phase/timeorigin·positive/negative time modulo 계약
### m9-signal-generator · 신호 파형 설정

원본 ID: 17-023 · 분류: `new-primitive`

- `m9-signal-generator-01`: sine/square/sawtooth/random 파형·amplitude/frequency·Hz 또는 rad/sec 설정
- `m9-signal-generator-02`: use simulation time/external time·rank≤2 parameter expansion·원본random의 PRNG independent boundary
- `m9-signal-generator-03`: square duty 및 sawtooth reset endpoints·finitephase/zero/negativefrequency·source/channel due
### m9-sine-wave · time/sample 기반 sine

원본 ID: 17-024 · 분류: `existing-options`

- `m9-sine-wave-01`: Timebased A*sin(omega*t+phase)+bias의 rad/sec option; 기존 frequencyHz 모델 migration 없이 보존
- `m9-sine-wave-02`: Samplebased k∈[0,p−1],A*sin(2π(k+offset)/p)+bias·first k0·due에서만증가
- `m9-sine-wave-03`: external time source·scalar/vector parameter broadcasting·step resampling과 state output semantics
- `m9-sine-wave-04`: resettable subsystem k reset은 M11; smooth continuous oscillator 최적화 M12
### m9-step · 계단 source 옵션

원본 ID: 17-025 · 분류: `existing-options`

- `m9-step-01`: stepTime/before/after scalar/vector/2D parameter expansion 및 vector interpretation
- `m9-step-02`: t<stepTime before,t>=stepTime after exact boundary·startTime/grid offset
- `m9-step-03`: M3 registered source event 회귀·같은시각여러 step node 정렬 및 parameter changes

## 모든 원본행의 처리 경로

baseline 상태 열은 immutable catalog 기준이다. 선택 canonical/configuration은 검증한 제한 API이며 현재 source 상태와 evidence는 JSON의approval 및 source 승인 근거에서 확인한다. 이 표는 baseline 상태를 덮어쓰거나 원본 전체 옵션 완료를 뜻하지 않는다.

| ID | 원본 이름 | baseline 상태 | 선택 경로 | canonical / 구성 | 후속 gate |
| --- | --- | --- | --- | --- | --- |
| [01-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Delay | M2 승인 subset | 제한 계산 경로 | `discrete.delay-configured` {"mode":"fixed"} | M10, M12, M15, M16 |
| [01-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-01) | Discrete-Time Integrator | M2 승인 subset | 제한 계산 경로 | `discrete.integrator-configured` 선언 기본값 | M10, M12, M15, M16 |
| [04-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) | PWM | 미구현 | 제한 계산 경로 | `source.pwm` 선언 기본값 | M10, M12, M15, M16 |
| [04-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-04) | Variable Pulse Generator | 미구현 | 제한 계산 경로 | `source.variable-pulse` 선언 기본값 | M10, M12, M15, M16 |
| [05-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Delay | M2 승인 subset | 제한 계산 경로 | `discrete.delay-configured` {"mode":"fixed"} | M10, M12, M15, M16 |
| [05-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Difference | M2 승인 subset | 제한 계산 경로 | `discrete.difference-configured` {"operation":"difference"} | M10, M15, M16 |
| [05-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Discrete Derivative | M2 승인 subset | 제한 계산 경로 | `discrete.difference-configured` {"operation":"derivative"} | M10, M15, M16 |
| [05-004](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Discrete FIR Filter | M2 승인 subset | 공유 preset | `discrete.filter` {"denominator":[1],"representation":"filter"} · preset `fir-configured` | M10, M15, M16 |
| [05-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Discrete Filter | 미구현 | 제한 계산 경로 | `discrete.filter` {"representation":"filter"} | M10, M15, M16 |
| [05-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Discrete PID Controller | 미구현 | 제한 계산 경로 | `discrete.pid` 선언 기본값 | M10, M12, M15, M16 |
| [05-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Discrete PID Controller (2DOF) | 미구현 | 제한 계산 경로 | `discrete.pid-2dof` 선언 기본값 | M10, M12, M15, M16 |
| [05-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Discrete State-Space | M2 승인 subset | 제한 계산 경로 | `discrete.state-space-mimo` 선언 기본값 | M10, M15, M16 |
| [05-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Discrete Transfer Fcn | M2 승인 subset | 공유 preset | `discrete.filter` {"representation":"transfer"} · preset `transfer-configured` | M10, M15, M16 |
| [05-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Discrete Zero-Pole | 미구현 | 제한 계산 경로 | `discrete.zero-pole` 선언 기본값 | M10, M15, M16 |
| [05-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Discrete-Time Integrator | M2 승인 subset | 제한 계산 경로 | `discrete.integrator-configured` 선언 기본값 | M10, M12, M15, M16 |
| [05-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Propagation Delay | 미구현 | fixed-grid subset 후보 | `discrete.propagation-delay` 선언 기본값 | M10, M12, M15, M16 |
| [05-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Resettable Delay | M2 승인 subset | 제한 계산 경로 | `discrete.delay-configured` {"mode":"fixed","reset":"level"} | M10, M12, M15, M16 |
| [05-015](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Tapped Delay | 미구현 | 제한 계산 경로 | `discrete.tapped-delay` 선언 기본값 | M10, M12, M15, M16 |
| [05-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Transfer Fcn First Order | 미구현 | 독립 설정 대체 | `discrete.filter` {"numerator":[0.5,0],"denominator":[1,-0.5],"representation":"transfer"} · preset `first-order-response` | M10, M15, M16 |
| [05-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Transfer Fcn Lead or Lag | 미구현 | 독립 설정 대체 | `discrete.filter` {"numerator":[1,-0.25],"denominator":[1,-0.5],"representation":"transfer"} · preset `lead-lag-response` | M10, M15, M16 |
| [05-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Transfer Fcn Real Zero | 미구현 | 독립 설정 대체 | `discrete.filter` {"numerator":[1,-0.5],"denominator":[1],"representation":"filter"} · preset `real-zero-response` | M10, M15, M16 |
| [05-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Unit Delay | M2 승인 subset | 제한 계산 경로 | `discrete.delay-configured` {"mode":"fixed","steps":1} | M10, M12, M15, M16 |
| [05-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Variable Integer Delay | 미구현 | 제한 계산 경로 | `discrete.delay-configured` {"mode":"variable","allowZero":"yes","casting":"truncate-clamp"} | M10, M12, M15, M16 |
| [05-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-05) | Zero-Order Hold | M3 승인 subset | 기존 subset 보존 | `time.zero-order-hold` 선언 기본값 | M10, M15, M16 |
| [06-008](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Detect Change | M2 승인 subset | 공유 preset | `logic.numeric-edge` {"mode":"change"} · preset `detect-change` | M10, M15, M16 |
| [06-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Detect Decrease | 미구현 | 공유 preset | `logic.numeric-edge` {"mode":"decrease"} · preset `detect-decrease` | M10, M15, M16 |
| [06-010](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Detect Fall Negative | 미구현 | 공유 preset | `logic.numeric-edge` {"mode":"fall-negative"} · preset `detect-fall-negative` | M10, M15, M16 |
| [06-011](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Detect Fall Nonpositive | 미구현 | 공유 preset | `logic.numeric-edge` {"mode":"fall-nonpositive"} · preset `detect-fall-nonpositive` | M10, M15, M16 |
| [06-012](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Detect Increase | 미구현 | 공유 preset | `logic.numeric-edge` {"mode":"increase"} · preset `detect-increase` | M10, M15, M16 |
| [06-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Detect Rise Nonnegative | 미구현 | 공유 preset | `logic.numeric-edge` {"mode":"rise-nonnegative"} · preset `detect-rise-nonnegative` | M10, M15, M16 |
| [06-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-06) | Detect Rise Positive | 미구현 | 공유 preset | `logic.numeric-edge` {"mode":"rise-positive"} · preset `detect-rise-positive` | M10, M15, M16 |
| [08-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | MinMax Running Resettable | 미구현 | 독립 설정 대체 | `math.running-minmax` `operation=max`; 현재 입력 포함·reset IC 누적의 위상 차이 | M9-followup, M10, M15, M16 |
| [08-038](../dataset/Simulink_Basic_Blocks_R2024b.md#library-08) | Weighted Sample Time Math | 미구현 | 제한 계산 경로 | `time.weighted-math` `operation=multiply`; minus polarity 미확정 | M9-followup, M10, M12, M15, M16 |
| [11-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) | Check Discrete Gradient | 미구현 | 제한 계산 경로 | `verify.gradient` 선언 기본값 | M10, M15, M16 |
| [11-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-11) | Check Input Resolution | 미구현 | 제한 계산 경로 | `verify.resolution` 선언 기본값 | M10, M15, M16 |
| [14-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) | IC | 미구현 | 제한 계산 경로 | `signal.initial-condition` 선언 기본값 | M10, M15, M16 |
| [14-009](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) | Rate Transition | M2 승인 subset | 기존 subset 보존 | `time.rate-transition` 선언 기본값 | M10, M15, M16 |
| [14-013](../dataset/Simulink_Basic_Blocks_R2024b.md#library-14) | Weighted Sample Time | 미구현 | 공유 preset | `time.weighted-math` {"operation":"TsOnly"} · preset `weighted-sample-time` | M10, M12, M15, M16 |
| [17-001](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Band-Limited White Noise | 미구현 | 제한 계산 경로 | `source.band-limited-noise` 선언 기본값 | M10, M14, M15, M16 |
| [17-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Chirp Signal | catalog 승인 subset | 기존 subset 보존 | `source.chirp` 선언 기본값 | M10, M12, M15, M16 |
| [17-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Clock | M2 승인 subset | 기존 subset 보존 | `source.clock` 선언 기본값 | M10, M12, M15, M16 |
| [17-005](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Counter Free-Running | 미구현 | 제한 계산 경로 | `source.counter` {"mode":"free"} | M10, M15, M16 |
| [17-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Counter Limited | 미구현 | 공유 preset | `source.counter` {"mode":"limited"} · preset `limited-counter` | M10, M15, M16 |
| [17-007](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Digital Clock | M2 승인 subset | 기존 subset 보존 | `source.digital-clock` 선언 기본값 | M10, M12, M15, M16 |
| [17-016](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Pulse Generator | M2 승인 subset | 기존 subset 보존 | `source.pulse` 선언 기본값 | M10, M15, M16 |
| [17-017](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Ramp | M2 승인 subset | 기존 subset 보존 | `source.ramp` 선언 기본값 | M10, M15, M16 |
| [17-018](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Random Number | M2 승인 subset | 제한 계산 경로 | `source.random-configured` {"distribution":"normal"} | M10, M14, M15, M16 |
| [17-019](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Repeating Sequence | M2 승인 subset | 기존 subset 보존 | `source.repeating-sequence` 선언 기본값 | M10, M15, M16 |
| [17-020](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Repeating Sequence Interpolated | M2 승인 subset | 샘플 확장 후보 | `source.sequence-configured` {"interpolation":"linear"} | M10, M15, M16 |
| [17-021](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Repeating Sequence Stair | M2 승인 subset | 샘플 확장 후보 | `source.sequence-configured` {"interpolation":"previous"} | M10, M15, M16 |
| [17-023](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Signal Generator | 미구현 | 제한 계산 경로 | `source.signal-generator` 선언 기본값 | M10, M15, M16 |
| [17-024](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Sine Wave | M2 승인 subset | 제한 계산 경로 | `source.sine-configured` 선언 기본값 | M10, M12, M15, M16 |
| [17-025](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Step | M2 승인 subset | 기존 subset 보존 | `source.step` 선언 기본값 | M10, M15, M16 |
| [17-026](../dataset/Simulink_Basic_Blocks_R2024b.md#library-17) | Uniform Random Number | M2 승인 subset | 제한 계산 경로 | `source.random-configured` {"distribution":"uniform"} | M10, M14, M15, M16 |
| [20-002](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) | Transfer Fcn Direct Form II | 미구현 | 공유 preset | `discrete.filter` {"structure":"df2","representation":"filter"} · preset `direct-form-ii` | M10, M15, M16 |
| [20-003](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) | Transfer Fcn Direct Form II Time Varying | 미구현 | 제한 계산 경로 | `discrete.filter-time-varying` 선언 기본값 | M10, M15, M16 |
| [20-006](../dataset/Simulink_Basic_Blocks_R2024b.md#library-20) | Decrement Time To Zero | 미구현 | 제한 계산 경로 | `time.decrement-to-zero` 선언 기본값 | M10, M15, M16 |
| [21-014](../dataset/Simulink_Basic_Blocks_R2024b.md#library-21) | Discrete State-Space | M2 승인 subset | 제한 계산 경로 | `discrete.state-space-mimo` 선언 기본값 | M10, M15, M16 |

## 종료 조건과 검증

- 검토된 최초 납품: P0 미구현 계산의 bounded 대응과 이번 구현이 선언한 모든 mode/shape/options를 compiler/runtime/JSON/UI/TS에서 독립 oracle로 검증; 추가 옵션 후보 전체 구현을 요구하는 gate가 아님
- 이전185 registry 정의와M8 120fixture+8preset 및catalog71fixture의 지원모드·수치값·JSON·actualTS 회귀; source row별 승격은 root가 evidence로 별도 결정
- 원본385행/339이름/datasetdigest 및 baseline status 보존; preset/definition/contract-family/kernel/원본행 별도 지표
- 선언한 mode/shape/options·domainfailure·resourcebudget·TS raw samples·JSON roundtrip 검증, Python은 선언된 subset만
- R2024b 미확정·설명 충돌은 승인범위를 subset/독립대체로 명시; 미확정 current-help 옵션을 최초 납품 blocker로 자동 추가하지 않음

engineering 납품과 전체 source 옵션 완료는 서로 다른 승인이다. `delivery`가 승인되어도 모든 `optionInventory` 후보 및 원본의 후속 M10~M16 gate가 자동 완료되지 않는다. 후보는 exact R2024b applicability와 구현 증거를 확인한 뒤 개별적으로 완료한다. 이름별 카드 수를 원본 완전 대응 수나 독립 엔진 수로 환산하지 않는다.

공개 앱의 최신0.10.1 patch는 버전 표시·초기 캔버스 측정 경합·자동 저장 상태의 레이아웃을 수정하며 엔진은0.10.0-m9다. 최초 engineering 앱0.10.0의 수치·상태·source 승인 계약은 유지하며 새 source 승격은 없다. [최신 공개 검증](pages-validation.md)과 [초기0.10.0 공개 근거](evidence/m9-initial-release-deployment-verification.json)를 따로 기록한다.

[자동 저장 상태 레이아웃 교정](evidence/m9-save-status-layout-correction.json)은5개 상태 문구에 필요한 크기를 확보하면서 DOMtext와 접근성 상태는 현재 문구만 유지한다. 원본 수학 옵션·solver·state publication의 변경은 없다.
