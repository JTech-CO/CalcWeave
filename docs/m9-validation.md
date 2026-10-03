# M9 DSP·이산 상태 구축 및 검증 기록

2026-10-03 KST · 문서 v0.2 · 초기 engineering 앱0.10.0 · 현재 공개 앱0.10.1 · 엔진0.10.0-m9 · 모델schema1 · 상태: **로컬 선언 범위 검증 완료(`verified-declared-scope`)**. 공개 앱 배포·실제 주소 검증도 완료했다. 전체 서비스 출시 게이트는 별도다.

[M9 계약](m9-contract.md)의 최초 납품은26개 정의와15개 명명 preset이다. 직전185개 정의를 보존해 registry211개이며 학습 예제는39개·6개 카테고리다. 선언 모드별 정의 수는 정적148·이산198·연속210이다. 새26개는 정적 모드를 선언하지 않으며 `verify.gradient`는 이산만, 나머지25개는 이산 및 연속 모델의 고정 due-grid 영역을 선언한다. 이 숫자는 모든 ODE 연결·solver 사건·원본 전체 옵션의 지원 수가 아니다. Python은 기존 승인51개를 유지하고 M9 정의는 TypeScript만 선언한다.

최종 actual TypeScript 보고서는 [m9-verification.json](evidence/m9-verification.json)에 있다. 마지막 수치 경계 수정 후151raw fixture records·30preset mode records(명명15개×이산/연속)·10실패 parity·693raw samples·191실제 생성 TypeScript 프로그램이strict 이산/연속 실행에서 통과했다. 전체unit은31파일2,175/2,175 PASS(33.29초)다. 마지막 수정 전 전체browser129/129 PASS(331.46초)와 수정 후 영향받은M9 5/5 PASS(14.3초)는 다른 실행이며 최종M9 merge의 GitHub Actions에서 전체unit2,175개·루트browser129/129·project browser4/4가 통과했다. 앱0.10.0·엔진0.10.0-m9의 공개 Pages artifact와 실제 브라우저9개 검증을 완료했다.

## 원본행 승인과 추적

M9 firstWork 배정은58행이며 catalog baseline의 기존subset27행·미구현31행이다. [구현 맵](m9-implementation-map.json)은 각 원본 ID·이름·subgroup·조건·ordinal·행 번호·baseline 상태를 보존하고 선택한 `delivery`와 추가 옵션 후보를 구분한다. 원자료 전체385행·339이름과 SHA-256 `cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7`는 그대로다. immutable catalog baseline과 M8 승인 근거도 보존한다.

[M9 source 승인 근거](evidence/m9-source-approvals.json)의 적용·검사는 통과했다. 새31행은18개 제한 계산 subset·9개 공유 preset·4개 독립 설정 대체이며 기존05-009 전달함수의 추적 교정1행은 신규 승격과 별도로 센다. 현재 [대응표](block-coverage.md)는 subset211행·미구현174행이다. 이 source 상태는 registry211개와 서로 다른 지표이고 engineering 최종 검증 완료를 대신하지 않는다. 원본 전체 옵션을 승인한 행은 없으며 `nativeFullEquivalent=false`와 열린 후속 옵션을 유지한다.

## 초기0.10.0 engineering 검증

| 항목 | 확인할 계약 | 현재 상태 |
| --- | --- | --- |
| 기존 계약 회귀 | 직전185개 definition 객체·M8 수치/preset·catalog 및 M0~M7 계약 보존 | 전체unit2,175 PASS; [M7](evidence/m7-regression-on-m9.json)·[catalog](evidence/catalog-regression-on-m9-verification.json)·[M8](evidence/m8-regression-on-m9.json) 회귀 증거 보존 |
| 독립 수치 oracle | literal sample-series와 선택한 final-memory의 계산값·형상·boolean·단위 | 151raw records+30preset mode records, 693raw samples PASS |
| 실제 생성 TypeScript | 선언 모드·strict compiler 설정·독립 ESM 실행·원시 표본·전체 finalState/stateMemory parity | 191actual programs·strict 이산/연속 PASS, [최종 수치 기록](evidence/m9-verification.json) |
| preset 실행 | 명명15개의 정확한 canonical/설정·이산/held-hybrid 실행·고유 fixture identity | 15개×2mode=30preset records PASS; 위693/191 합계에 포함 |
| JSON·순서·manifest | roundtrip·역순 노드/연결·설정 identity·hash와 export 결과 일치 | 최종 actual TS 및 unit PASS |
| 상태 수명·publication | 구조별 IC·reset/enable·seed 소비·repeat/checkpoint rollback·due/offset·최종 memory | 선택 독립 memory oracle·전체 finalState/stateMemory parity 및 unit PASS |
| 진단·실패 rollback | 원본 node/port/tick/time·마지막 due·부분 결과·동일 생성 코드의 실패 | 10failure parity와 전체unit PASS |
| 자원 상한 | 상태/queue metadata·연산 비용·계수/shape/period·unsafe due index·기록량 | compiler/runtime 경계 unit 및 최종actual TS PASS |
| UI·브라우저 | 새4예제·preset·동적 포트/설정·저장·계산·TS export·기존 작업 흐름 | 수정 전129/129 PASS(331.46초), 마지막 수정 후M9 5/5 PASS(14.3초); 최종 CI 전체129/129 PASS; project4/4 PASS |
| build·릴리스 | strict typecheck·정적 파일/manifest·오프라인·정책·바이트/hash | 최종root release70checks·12files·1,873,014bytes PASS |
| 디자인 | 대표 너비·테마·폰트·확대·새 예제 및 설정 화면 | [188관측/pageErrors0 PASS](evidence/m9-design-verification.json); 접근성 인증·실제 사용자 조사 아님 |
| 성능 | cold/warm load·1,000node·취소·retained heap·page errors | [로컬6개 예산 PASS](evidence/m9-performance.json); 공개 네트워크 성능 미주장 |
| project 경로 | `/CalcWeave/` 자산·Worker·계산·오프라인/경로 회귀 | 4/4 PASS(183.03초), project release70checks·12files·1,873,264bytes |
| source 대응 |58개 identity·원자료digest·31신규/1교정·이전 승인 보존 | source 재승인·적용/검사 PASS, 현재211subset/174미구현 |
| 공개 배포 | 실제 Pages artifact 버전·파일/hash·Worker/계산·오프라인 | 공개 artifact parity·실제 브라우저9개 PASS; 전체 서비스 출시 미승인 |

초기0.10.0 [root 릴리스 증거](evidence/m9-initial-release-root-release-verification.json)의 releaseId는 `91846e548f4ed5f6d998549ab72969e9dccf2f73e46d4401524b1d6db1c5bb60`이다. [디자인 기록](evidence/m9-design-verification.json)의188관측/pageErrors0와 [성능 기록](evidence/m9-performance.json)의6개 로컬 측정 예산은 모두 통과했다. `/CalcWeave/` 경로 검증4/4(183.03초)와 [project release](evidence/m9-initial-release-project-release-verification.json)의70checks·12files·1,873,264bytes도 통과했으며 project releaseId는 `f3a4ddb31b92e27b6a5a429b1522b86cf5d0bbc9786c5a26b4139a737f670d4d`다. root/project artifact는 경로가 달라 별도로 기록한다. [최종 작업 공간 증거](evidence/m9-initial-release-workspace-verification.json)에 이 결과를 모았다. 실제 공개 Pages artifact·브라우저9개 검증도 통과했으며 로컬 측정을 공개 네트워크 성능으로 해석하지 않는다. `npm run verify:m9`는 실제 TS 수치 보고서를 생성하고 source 승격은 원본 identity·선택 canonical/필수 설정·preset·fixture·지원 mode의 근거를 별도로 검사한다.

## 독립 검토에서 고정한 경계

- Filter는 ascending z⁻¹와 descending z를 구분하고 차수가 다른 numerator의 leading delay를 검증한다. DF1/DF1T/DF2/DF2T는 같은 `stateInitial` 숫자가 같은 물리 상태라는 가정을 하지 않는다. DF2 동적 계수 변경은 기존 state를 유지한다.
- b0=0의 causal 필터 read에서 사용하지 않는 next-state 계산이 overflow하는 경우를 교정했다. 실제 입력이 큰 상태를 상쇄하여 출력과 commit이 모두 유한한2-sample 회귀를 별도로 검사한다.
- 균등 선형 sequence의 상수MIN_VALUE·MIN_VALUE와2×MIN_VALUE의 중간값은 정확 비교한다. 일반 절대 오차로0 결과가 통과하지 않게 한다. boolean `change`는 숫자 sign 비교와 분리한다.
- 필터 reset due는 IC 슬롯으로 현재 출력을 다시 계산하고 commit은 초기 슬롯을 유지한다. Level은 falling 전이도 reset하고 Levelhold는 현재 nonzero만 reset한다. 이 캡처 위상을 MathWorks reference와 같다고 승인하지 않는다.
- Propagation Delay의 raw arrival는 엄격히 증가한다. quantized 발행은 정수 due index를 사용해 소수 시각의 반올림으로 한 tick 늦게 나오는 일을 막는다. 같은 발행 grid에서는 capture 순서의 마지막 값을 출력하며 마지막 기록 due에도 delay/order/capacity를 진단한다.
- Weighted Sample Time은baseStep×period의 물리적 초이며 offset은 주기를 늘리지 않는다. gradient는strict absΔu<abs(maximumGradient)이고 Ts로 나눈 derivative가 아니다.
- PID의 비활성 D 경로를 계산하지 않고 활성 backward/trapezoid 미분 필터의 중간 overflow를 피했다. `m9-pid-zero-D-skips-unused-overflow`, `m9-pid-backward-filter-scaled-finite-state`, `m9-pid-trapezoid-filter-finite-sum`은 큰 유한 입력의 literal 출력과 상태를 검사한다.
- 최종3개 경계는 `m9-derivative-large-gain-small-difference-finite`의 큰 gain/작은 차분에서 `gain/Ts`가 먼저 overflow하지 않도록 계산한 경우, `m9-difference-zero-gain-unused-extreme-gap`의 gain=0에서 사용하지 않는 큰 차분을 생략한 경우, `m9-pid-2dof-unused-extreme-P-weight`의 kp=0에서 사용하지 않는 큰 reference weight 곱을 생략한 경우다. 유한한 최종 출력의 literal oracle와 실제 생성 TS를 모두 확인했다.
- Trapezoid 평균은 두 유한 입력의 합이 overflow해도 평균은 유한한 경계를 다룬다. integrator와 PID 적분은 `(a+b)/2` 중간 overflow를 피하는 평균을 사용하며, ki=0은 사용하지 않는 적분 평균을 계산하지 않는다. `m9-integrator-trapezoid-finite-average`, `m9-pid-trapezoid-integral-finite-average`, `m9-pid-zero-I-trapezoid-skips-unused-overflow`에 독립 raw 값을 고정했다.

## 승인 범위와 열린 후속

First Order/Lead-Lag/Real Zero의3개 configured response와 MinMax Running Resettable의 현재 입력 포함/reset 누적 위상은 독립 설정 대체다. MinMax의 공식 설명상 reset 출력=IC·DirectFeedthrough=no와 선택한 위상 차이를 남긴다. Weighted minus의 원본 polarity, 필터 reset 입력 캡처 위상, R2024b exact parameter inventory는 reference 미확정이다.

자체 PRNG stream·seed 재현은 MathWorks 난수 sequence bit parity가 아니다. sample-channel 처리·unitless scalar Parallel PID·각축1~16 MIMO·고정 형상 boolean/float64·정수 due delay·fixed-interval 발행 queue만 선언한다. 일반 frame·추가 제어 옵션은 M9-followup, complex/typed fixed-point/일반n-D/variable-size는 M10, 조건부 실행은 M11, arbitrary-time event/DAE·새 solver는 M12, 외부 workspace/ABI·라이선스와 추가 타깃은 후속 gate를 따른다.

engineering 종료는 마지막 수정 이후 수치·생성 TS·전체unit·영향받은browser·디자인·로컬 성능·root/project build/release·project-path·source identity를 확인한 선언 범위로 판정했다. 공개 Pages 배포와 최종 전체browser CI도 완료했다. 원본 전체 옵션 동등성·실제 초보자 조사·목표 도메인·문의 운영 정책은 남은 확인 항목이다.

## 초기0.10.0 CI와 실제 공개 주소 증거

앱0.10.0·엔진0.10.0-m9의 공개 Pages artifact와 실제 브라우저9개 검증을 완료했다. 최종M9 merge의 GitHub Actions에서 전체unit2,175개·루트browser129/129·project browser4/4가 통과했다.

[Actions 기록](evidence/m9-initial-release-actions-verification.json) · [공개 artifact 검증](evidence/m9-initial-release-deployment-verification.json) · [공개 브라우저 검증](evidence/m9-initial-release-public-browser-verification.json). 마지막 수치 수정 전 로컬129개 실행은 역사로 보존하며 최종 CI의 전체129개 실행과 구분한다. 공개 기술 배포 성공으로 실제 F06 조사·목표 도메인 소유·문의 이메일 보유/처리 정책·전체 서비스 출시를 승인하지 않는다.

## 최신0.10.1 표시·캔버스·저장 상태 patch 공개 검증

버전 표시를 APP_VERSION에 연결하고, 실제 캔버스 크기를 구독해 DOM 측정과 맞춘 뒤 취소 가능한2프레임 안정화 후 최초 fit을 적용했다. 수치 engine0.10.0-m9·211개 정의·39예제/6범주·151raw/693samples/191actual TS·source subset211행/미구현174행과58행의 열린 전체 옵션을 유지한다. 최종 CI와 공개 artifact parity·브라우저9개 검증은 최신 증거를 따른다. [Actions](evidence/m9-actions-verification.json) · [공개 artifact](evidence/m9-deployment-verification.json) · [공개 브라우저](evidence/m9-public-browser-verification.json). 최초0.10.1 시도는128/129개 검사 통과 후 초기 fit1개 실패로 배포가 생략됐고 [실패 기록](evidence/m9-presentation-patch-failed-attempt.json)을 보존한다. [캔버스 교정 근거](evidence/m9-initial-fit-correction.json)는 기존 artifact에서 결정적 회귀가 실패하고 교정 후 focused7/7(25.668717초, flaky0)이 통과한 기록이다. 별도 경합 재현을 원래 CI의 정확한 timing/geometry 원인 확정으로 해석하지 않는다. 새로운 수치 기능/source 승인이나 full Simulink/전체 서비스 출시 완료를 선언하지 않는다.

두 번째 run37087756063도129/130개 통과 후 초기 fit 검사에서 실패해 deploy가 생략됐다. [후속 실패 기록](evidence/m9-late-layout-failed-attempt.json)의 canvas y248/height670·y중심 오차11px은 최초 fit 당시 y226/height692 이후22px 높이 변화다. [저장 상태 교정](evidence/m9-save-status-layout-correction.json)은 이 기하와 일치하는 첫 자동 저장 문구의 헤더 줄바꿈을 재현하고5개 문구의 크기를 예약했다. 앞선 측정 경합은 실제로 교정했으나 이것만으로 원래 CI 증상을 모두 해결했다고 기록하지 않는다.

저장 상태 교정 후 focused8/8(28.534076초, flaky0)이 통과했다. dark/light·1440px/100%와200%·390px/100%·320px/200%의8개 관측은 헤더/캔버스 불변·예약span5개의 빈DOMtext/aria-hidden·문서overflow0을 확인한다. 390/320px에서 기존 CSS가 상태를 숨기는 조건은 표시된 문구 검사로 합산하지 않는다. 초기7/7 측정 교정 기록과 이 최종8/8 저장 상태 교정은 다른 실행이다.
