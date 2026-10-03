# CalcWeave M12 실행·솔버·분석 계약

작성일: 2026-10-03 · 앱 0.13.0 · 엔진 `0.13.0-m12`

M12는 암시적 적분, 제한 상태, 실제 대수 도식 풀이, 명시 index-1 Descriptor 모델과 국소 분석을 추가한다. 이번 선언은 제한된 CalcWeave 계산 계약이다. 일반 DAE, MATLAB의 전체 솔버·선형화·자동 튜닝 기능, R2024b 원본 옵션 전수 대응을 완료했다고 주장하지 않는다.

원본 로드맵의 M12 최초 작업 행은 **26행**이다. 기존 승인 subset **14행**은 이전 대응을 보존하고, 미구현 **12행**의 신규 선택 계약을 **11개 정의**로 구성한다. Timed-Based/Trigger-Based Linearization 두 행이 하나의 독립 분석 정의를 공유한다. registry는 293개 기존 정의를 보존한 **304개**, 예제는 기존 53개·8개 카테고리를 보존한 **61개·9개 카테고리**다. registry 수, 문서 행, 원본 이름, 예제와 검증 fixture 수를 동일 지표로 합산하지 않는다. [26행 대응표](m12-implementation-map.json)는 원본 행 전체와 canonical JSON SHA-256을 보존한다. 모든 행의 전체 원본 옵션은 아직 `open`이다.

## 적분과 수렴

기존 RK4/RK45에 `implicit-euler`를 추가한다. 하나의 전체 implicit Euler step과 두 개의 half step을 실제 계산하여 외부 `atol`/`rtol`로 적응 step을 판정한다. 각 implicit step은 실제 상태 잔차·유한차분 Jacobian·bounded Newton·line search로 푼다. `ode15s`와의 동일성은 주장하지 않는다. 암시적 Euler의 결합 Newton 상태 수 상한은 64개다. 이 한계는 기존 RK 방법의 일반 연속 상태 상한을 새로64개로 바꾸는 선언이 아니다.

암시적 Euler에만 다음 설정을 직렬화한다. 다른 방법으로 전환하면 이 세 필드를 제거하여 이전 RK 모델의 정규화 형태를 유지한다.

| 설정 | 기본값 | 허용 범위 |
| --- | ---: | --- |
| `newtonTolerance` | 1e-9 | 1e-14 ~ 1e-3 |
| `newtonMaxIterations` | 24 | 정수 1 ~ 32 |
| `jacobianStep` | 1e-6 | 1e-8 ~ 1e-2 |

Line search는 최대 12회다. 각 잔차의 정규화 분모는 `min(atol × 0.1, newtonTolerance) + rtol × 0.1 × max(abs(stepInitial), abs(trial))`이고, 정규화 잔차가 1 이하일 때 수렴으로 판정한다. 최소/최대 step, reject/evaluation 상한과 실행 비용·취소 경계는 계속 적용된다. 특이 Jacobian, 수렴 실패, step/평가 한계는 실제 진단으로 보고한다.

실행 설정 UI는 큰 글자의 방법 선택, 절대/상대 허용오차, 접힌 수렴 설정과 숫자 입력 검증을 제공한다. 잘못된 draft는 유지하고 저장·실행에 적용하지 않는다. 실제 실행 통계의 accepted/rejected step, evaluation, 마지막·최소·최대 step을 표시한다. 공개 사건 종류 `crossing`/`reset`/`relay`와 100행 paging은 기존 형태를 보존한다. UI가 새로운 사건 종류나 측정하지 않은 통계를 만들어내지 않는다.

## 신규 계산 경계

| 정의 | 선택한 실행 계약 |
| --- | --- |
| `continuous.descriptor` | 유한 실수 legacy scalar/vector 신호, 비특이 E 또는 명시 index-1 분할. 미분·대수 상태를 합한 전체 상태 N은 최대16개, 입력·출력은 최대8개. 실제 전체 상태와 출력을 별도 포트로 제공한다. |
| `continuous.integrator-limited` | scalar 상태의 상·하한 도달에서 투영하고 안쪽 미분에서 이탈한다. `limited`는 boolean이다. |
| `continuous.second-order-limited` | scalar 위치·속도 경계를 처리한다. 위치 경계에서 속도를0으로 초기화한다. 두 경계 여부 포트는 boolean이다. |
| `continuous.pid-2dof` | 기준값/측정값 두 입력, P/D 기준 가중치, parallel/ideal·PID/PI/PD/P/I, 필터 미분, 명시 제한과 none/clamp/back-calculation을 계산한다. |
| `time.variable-delay` | 승인된 bounded history에서 `t − delay`를 조회한다. 양의 지연 또는 명시한 zero-direct 정책을 적용한다. |
| `time.variable-transport-delay` | 실제 `q′ = 1 / delay` 상태를 적분하고 history의 운송 나이 `q − 1`을 조회한다. `t − delay`의 별칭으로 처리하지 않는다. |
| `nonlinear.backlash` | 이전 승인 출력을 중심으로 deadband를 유지하며 입력이 경계를 넘을 때 출력 상태를 이동한다. |
| `nonlinear.rate-limiter-continuous` | 연속 accepted major-step 간격의 scalar 변화율 envelope를 계산한다. 연속 초기 출력은 실제 첫 입력이며, 이산 모드는 명시 초기 출력과 due-grid를 사용한다. |
| `nonlinear.rate-limiter-dynamic` | 외부 상승·하강 한도를 읽고 이산 read-before-write 상태를 갱신한다. 연속 모델에서도 명시 이산 due-grid로 실행한다. |
| `solver.algebraic-constraint` | 실제 smooth scalar 그래프의 residual-zero 또는 fixed-point 방정식을 공동 Newton으로 푼다. component당 unknown 최대8개·노드 최대64개·반복 최대32회다. |
| `analysis.linearization` | 실제 컴파일한 연속 정의의 operating point에서 중심차분으로 A/B/C/D를 구한다. 지정 시각 또는 허용된 rising trigger에서 실행한다. |

Descriptor의 `differentialCount = 0`은 비특이 E를 뜻한다. 특이 E는 E11이 비특이이고 나머지 E 블록이0이며 A22가 비특이인 명시 분할만 허용한다. 실제 초기 입력에서 대수 상태 일관성을 검사하고 `error` 또는 사용자가 선택한 `project` 정책을 적용한다. 일반 implicit DAE·고차 index·임의 descriptor 분해는 거부한다.

제한 상태와 PID의 reset은 `none`/boolean `rising` subset이다. 새 제한 적분·제한2차 적분·2DOF PID의 rising reset producer는 등록된 `logic.hit-crossing` 또는 discrete/constant boolean이어야 한다. 임의 continuous boolean producer는 `M12_RESET_BOUNDARY_REQUIRED`로 거부한다. 원본 전체 reset/외부 상태/자료형 옵션은 후속 항목이다. PID의 자동 튜닝은 제공하지 않는다. 지연 history는 기본4096·설정4~40000 승인 기록으로 제한하며, 지연 범위는 명시한 양의 최소/최대값을 검사한다. 보간·불연속 좌/우 기록·overflow 진단을 별도 검증 대상으로 유지한다. 대수 제약은 실제 도식의 해를 구하며 특정 결과를 하드코딩하지 않는다. 비매끄러운 연산·matrix·typed 도식과 지원하지 않는 잔차 component는 거부한다.

## 실제 분석

국소 선형화 대상은 버전이 명시된 연속 정의다. 선언된 입력·출력은 각각1~8개 unit1 실수 scalar이고 상태는1~16개다. `operatingInputs`/`operatingState`와 `fdStep`을 사용한다. 결과는 순서대로 **A/B/C/D 네 field만 가진 bus**이며 각각 `[N,N]`, `[N,M]`, `[P,N]`, `[P,M]` matrix다. 구조화 결과 tree에서 실제 matrix 값을 확인하고 기존 exact JSON/history/CSV로 보존한다. MATLAB의 `linmod` 또는 파일 연동과 동일하다고 주장하지 않는다.

Timed 방식은 실행 범위 안의 유일한 요청 시각 최대64개에서 step을 나누어 실행한다. Triggered 방식은 boolean rising을 사용한다. 연속 producer는 등록된 `logic.hit-crossing`이어야 하며 constant/discrete boolean도 허용한다. 임의 연속 비교·짧은 pulse는 major-step 사이에서 놓칠 수 있어 `M12_ANALYSIS_TRIGGER_BOUNDARY_REQUIRED`로 거부한다. 분석 결과는 다음 승인 요청까지 유지한다. inspector에서 실제 참조 연속 정의를 열고 편집·버전 갱신할 수 있다.

헤더의 **분석** 버튼은 다음 두 public API를 실제 호출한다.

- 수식 기울기: bounded expression AST를5회 평가하여 h/h2 중심차분과 Richardson derivative, 실제 차이 추정치를 표시한다. 기본 `x² + 3x`의 x=2에서 기울기7을 계산한다. x 범위±1e12, 상대 간격1e-9~0.1이며 `abs`/`min`/`max`/rounding 같은 비매끄러운 수식은 실제 `ANALYSIS_NONSMOOTH` 진단을 낸다. JS 코드를 실행하지 않는다.
- 모델 해상도: 현재 연속 모델의 immutable snapshot을 두 번 실제 실행한다. 동일한 출력 observation grid를 유지하고 fine의 initial/max step만2~8배 세분한다. float64 출력의 절대·scaled 차이와 실제 비교 sample/element 수를 표시하고 typed/bus/message/boolean 제외 출력을 밝힌다. 각 실행은15초·2500만 operations·50만 기록 상한이고 취소 가능하다. 모델과 원래 실행 결과를 변경하지 않는다.

분석 JSON은 실제 값·조건·engineVersion·모델/실행 식별 정보를 내려받는다. 해상도 보고서는 비교 요약과 실제 두 run의 상태·steps·statistics를 저장하며 큰 전체 sample 배열은 포함하지 않는다. 차이 추정은 정확해·안정성·자동 튜닝 보장이 아니다. 모달의 키보드 포커스·닫기 복귀·local invalid draft·React escaping을 유지한다.

## 예제와 검증 상태

새 **솔버·제약·분석** 카테고리는 실제8개 도식을 제공한다: 강성 감쇠, `z² − 9 = 0` 대수 제약, index-1 Descriptor, 시간 지연과 운송 지연 비교, 위치/속도 제한, backlash와 두 rate limiter, 2DOF 가중치, timed/Hit Crossing triggered A/B/C/D. 기존53개 예제 ID와8개 카테고리는 보존한다.

새 UI9개와 학습 모델8개, **총17개 단위 테스트가 실제 통과**했다. 실제 parse/compile/run, 독립 literal/analytic 출력, JSON roundtrip, 역순 node/edge 삽입, 원본 불변성, 설정 전환·정확 결과 escaping·분석 정의 버전 탐색을 검사한다. 최종 원본은 `.test-generated/m12-ui-unit-compact-final.json`이다. 최초 지연 예제에서 Clock의 단위 s를 단위1 지연 입력에 연결한 compile 실패는 unit1 Ramp로 수정했고 최초 실패 원본 `.test-generated/m12-ui-models-first.json`을 보존했다.

`tests/e2e/m12-editor.spec.ts`의9개 브라우저 테스트는 설정 오류 차단·실제 결과/실패·저장·history/TS/분석 JSON·정의 탐색·실제 두 솔버 비교·1440/1024/390/320px와320px/200% 두 테마를 검사한다. 최초 focused 실행은 **M12 8/9, M11 9/9, M10 7/7, 합계24/25**였고 원본 `.test-generated/m12-focused-browser.json`을 보존한다. 실패1개는 운송 지연 history의 실제float64 `0.5000000000000001`을 수학적기대0.5와 exact equality로 비교한 검사였다. 실제 기록을 반올림하지 않고 두 수치의 oracle assertion을12자리 근접 비교로 수정했다. 출력 key와 block type metadata의 정확한 동일성은 계속 검사한다. 첫24/25 보고서를25/25로 바꾸지 않는다. 네 Analysis dark/light desktop/mobile 스크린샷을 실제 확인했고8개 화면조건의 가로 overflow 검사는 통과했다. 최종 전체 브라우저 회귀는 **156/156이 실제 통과**했고 M12 9/9, M11 9/9, M10 7/7을 포함한다. 원본은 `.test-generated/m12-whole-browser.json`이며 외부 project preview도4/4 통과했다. [최종 UI 증거](evidence/m12-ui-browser-verification.json)에 실제 test명·report/source/image SHA와 첫 실패를 기록했다. [다크 desktop](evidence/m12-analysis-dark-1440-1x.png)·[다크320px/200%](evidence/m12-analysis-dark-320-2x.png)·[라이트 desktop](evidence/m12-analysis-light-1440-1x.png)·[라이트320px/200%](evidence/m12-analysis-light-320-2x.png)은 직접 확인한 원본을 그대로 복사했다. 작은 화면 이미지는 세로 scroll 모달의 상단 viewport를 기록한다.

root의 [독립 실행 증거](evidence/m12-verification.json)는29개 raw fixture의30개 정상 mode execution·155개 sample과5개 실패를 검사하고, 총35개 실제 standalone TypeScript를 실행했다. 대표2개 프로그램은 별도 strict TypeScript 검사도 통과했다. [source 승인](evidence/m12-source-approvals.json)은12개 신규 원본 행의 선택 계약을 승인하고14개 기존 subset을 보존한다. 전체 원본 옵션의 승인은0개다. 실행·source 승인과 전체 브라우저/릴리스 gate를 구분하며 fixture·문서·registry의 존재만으로 완료 처리하지 않는다.

M10 exact typed 신호와 M11 bus/message/계층 오류 위치·페이지 유지·마우스 조작 계약을 이어받는다. 검정 다크·밝은 회색 라이트, 큰 글자, 블록 이름+한 값과 얇은 category stroke를 유지한다. M12의12개 신규 선택 계약과 기존14개 subset 모두 R2024b 전체 파라미터·자료형·시간·타깃·reference 실행에 대한 후속 inventory와 증거가 필요하다.

## 1차 자료와 버전 경계

아래 자료는 원본 의미와 남은 옵션을 확인하는 1차 자료이며 CalcWeave 실행 결과의 검증을 대신하지 않는다. 확인일은 2026-10-03이다. 고정된 dataset과 로드맵의 기준은 R2024b이고, 현재 문서의 후속 기능을 기준에 소급하여 완료 처리하지 않는다.

- [R2024b Algebraic Constraint](https://www.mathworks.com/help/releases/R2024b/simulink/slref/algebraicconstraint.html)는 `f(z)=0` 또는 `f(z)=z`, direct feedback 경로, 실수 scalar/vector와 Trust region/Line search 옵션을 명시한다. CalcWeave는 두 방정식의 bounded smooth scalar subset을 실제 Newton으로 구현한다.
- [현재 Algebraic Constraint 문서](https://www.mathworks.com/help/simulink/slref/algebraicconstraint.html)의 Equation format 기반 DAE 선택은 R2026b 추가 기능이다. 이 기능을 R2024b 원본 계약이나 CalcWeave 일반 DAE 지원으로 간주하지 않는다.
- [Descriptor State-Space 공식 문서](https://www.mathworks.com/help/simulink/slref/descriptorstatespace.html)는 `Eẋ=Ax+Bu`, `y=Cx+Du`와 특이/비특이 질량 행렬을 설명한다. CalcWeave의 명시 index-1 분할·dense 실수·전체16상태 상한은 자체 선택 경계이며 전체 native 옵션이 아니다. 현재 페이지의 R2026a 이후 matrix tunability 옵션도 R2024b 기준에 합산하지 않는다.
- [R2024b Variable Transport Delay](https://www.mathworks.com/help/releases/R2024b/simulink/slref/variabletransportdelay.html)는 순간 지연의 역수 적분이1이 되는 운송 지연과 직접 시간 지연을 구분한다. CalcWeave는 이 두 의미를 별도 커널로 계산하며 원본의 전체 buffer·clipping·shape·linearization 옵션은 남겨둔다.
- [R2024b Choose a Solver](https://www.mathworks.com/help/releases/R2024b/simulink/ug/choose-a-solver.html)는 모델에 따른 솔버 선택을 설명한다. CalcWeave의 bounded implicit Euler는 자체 선택 구현이며 native solver 이름이나 전체 방법 집합의 동등성 승인이 아니다.

실제 선택 계약의 정본은 [블록 선언](../packages/block-library/src/m12.ts), [컴파일 검사](../packages/compiler/src/m12.ts), [reset/trigger 경계](../packages/compiler/src/continuous.ts), [솔버 정규화](../packages/model/src/continuous.ts), [public 분석 API](../packages/analysis/src/index.ts)와 root의 실제 독립 실행 증거다.
