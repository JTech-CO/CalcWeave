# M3 구축·검증 기록

2026-10-02 · 앱 0.3.0 · 엔진 `0.3.0-m3`. M3a의 고정 RK4와 M3b의 적응 RK45, 승인한 연속·혼합 실행을 구현했다. [실행 계약](m3-contract.md)은 실제 지원 파라미터·시간 순서·실패 및 export 경계를 정의한다.

## 구현 결과

Registry는 45종에서 57종으로 확장했다. 추가한 12종은 2차 적분, 연속 상태공간·전달함수·영점/극점, 필터 PID·미분, Memory·ZOH·FOH·고정 Transport Delay, Hit Crossing·Relay다. 기존 Integrator에 rising reset을 더하고 Step·Ramp·Sine·Clock·Repeating Sequence를 RK stage 시각에서 계산한다. 정적 26종과 M2 이산 블럭·타입·rate·난수 계약은 보존한다.

편집기에는 출력 격자와 별도 내부/이산 간격, RK4/RK45·절대/상대 허용오차·자원 상한 설정, 승인/거절/평가 통계, 사건 시각 목록을 제공한다. 일시정지·재개는 같은 snapshot을 이어가고 실패한 계산은 마지막 유효 원시 기록과 승인 상태를 보존한다. finalState의 시각은 결과 데이터의 `stateTime`에 기록한다. 연속·혼합 TypeScript와 ZIP도 같은 실행 계약으로 생성한다. 학습 예제 8개를 추가해 총 21개다.

휠 버튼 드래그 이동, 푸른 사각형의 왼쪽 드래그 선택, 캔버스 Space 맞추기, 측정한 최초 한 번의 자동 맞추기, 검정 다크·회색 라이트와 좌우 결과 패널을 유지한다. 입력 필드·버튼·대화상자·IME·modifier·키 반복을 구분하여 Space의 원래 동작을 보존한다.

## 독립 수치·내보내기 검증

[실행 증거](evidence/m3-verification.json)와 [모델/기대결과](../fixtures/m3)는 `npm run verify:m3`으로 재생성한다. 기대 수식은 runtime kernel이나 생성 코드를 재사용하지 않고 분석해·행렬 지수·손으로 정한 캡처 시각·독립 Taylor 적분으로 작성했다. 모든 raw 출력 샘플에 모델별 absolute tolerance를 적용한다. 웹/생성 코드 parity는 오차를 완화하지 않고 elapsedMs를 제외한 결과 전체를 동일하게 비교한다.

| 모델 묶음 | 독립 기준과 확인 사항 |
| --- | --- |
| RK4/RK45 감쇠 | `exp(-t)` / `exp(-20t)`, 실제 RK45 거절, 오차 허용 범위 |
| Clock·Ramp·Sine stage | `t²/2`, `t²`, `(1-cos(πt/2))/(π/2)`; 중간 stage 시간 재평가 |
| 2차 적분·상태공간 진동 | `cos(t)`, `-sin(t)`; 별도 20항 Taylor 회전 적분과 직접 교차 비교 |
| off-grid 전달함수·Zero-Pole | t=.37에서 시작하는 1차 step 응답, `1-exp(-2t)` |
| PID·필터 미분 | `2+t+2exp(-4t)`, `4exp(-4t)` |
| Memory·고정 지연 | 이전 승인 .05초 입력, clock의 .15초 지연, prehistory 및 jump 좌우 보존 |
| ZOH·FOH | 연속 입력 및 Digital Clock의 현재 due 캡처, 두 과거 샘플의 causal 외삽 |
| 혼합 Unit Delay·Rate Transition | held 입력의 ODE 적분, Constant/ZOH 외부 producer, 기존 read-before-write |
| Hit Crossing·Relay·Saturation | reset과 tick이 동시 발생한 결과, relay 1/12·7/12초 사건, saturation 두 경계의 정확한 구간 적분 |
| 타입·사건 격리 | 벡터 대수 결과, 이산 jump의 중복 없는 사건, 무관한 crossing이 다른 reset 제어에 영향 없음 |

RK4 감쇠의 내부 간격 .2/.1/.05/.025에서 t=1 오차는 각각 `5.79695e-6`, `3.33241e-7`, `1.99761e-8`, `1.22274e-9`였다. 관측 수렴 차수는 4.121·4.060·4.030으로 4차 기준을 통과했다. 순수 ODE에 쓰지 않는 discreteStep이 적분 간격을 줄이지 않는 것도 확인한다. RK45 감쇠에서는 초기 trial 2회 거절과 허용오차 내 출력이 확인됐다.

각 모델은 normalized JSON roundtrip, node/edge 삽입 순서 반전, SHA-256 manifest, 독립 결과 복사와 반복 실행을 검사한다. TypeScript는 DOM·Node 타입이나 CalcWeave import가 없는 strict ES2022 대상으로 별도 typecheck하고 실제 독립 ESM 모듈로 실행한다. 사용자 입력을 코드로 평가하지 않는다. 수식은 bounded AST만 포함하며 생성 template가 원본 numerical source와 동일한지도 검사한다.

거절 상한 0, 최소 step, 승인 step 한도, 평가 횟수 한도 등 네 실패 모델에서 코드·시각·마지막 유효 부분 기록의 독립 TS parity를 확인한다. 단위 검사는 비유한 중간값, history/operation/record/state/event 한도, 사건 반복, trial rollback, RNG 한 번 공개, pause/cancel의 경계도 다룬다. 실패한 trial에서 바뀐 history·hold·seed·event를 남기지 않는다.

현재 due producer를 먼저 계산하는 캡처 순서를 별도 모델로 확인했다. Digital Clock의 현재 값이 1인 시작 시각에서 초기값 0인 ZOH를 거쳐 reciprocal을 계산해도 placeholder의 0 나눗셈이 발생하지 않는다. 같은 시각에 서로 현재 입력을 요구하는 홀드 순환은 실행 전에 진단하고, alternating offset·Unit Delay·Rate Transition·Memory·strict proper 상태로 인과적 경계를 만든 경로는 보존한다. compiler의 due-aware 회귀 검사와 실제 실행을 함께 확인했다.

## 회귀와 화면 근거

[M1 회귀 증거](evidence/m1-regression-on-m3.json)는 정적 학습 예제 4개와 100/1,000노드·64원소 Gain chain을 검사한다. [M2 회귀 증거](evidence/m2-regression-on-m3.json)는 독립 손계산 15개 모델의 전 tick·최종 상태·메모리·seed·Rate Transition·TS parity를 확인한다. 이전 단계의 증거 파일은 보존한다. 측정 장비는 Windows 11 / i7-13620H / Node 25.9.0이며 측정 시 부하가 결과에 영향을 줄 수 있다. 이번 수치 모델 시간은 단일 관측으로 성능 보장이 아니다.

[SANE 화면 측정](evidence/sane-design-verification.json)은 320~1920px, 양쪽 테마, browser zoom에 해당하는 viewport와 별도의 200% 글자 확대를 검사한다. 페이지 가로 넘침·블럭 글자 잘림·왼쪽 마킹이 없고, 측정한 텍스트 대비는 4.5:1 이상, 자동 맞춤 후 블럭 이름은 16px 이상이다. M3의 solver 설정·통계·사건 목록과 긴 2차 적분 이름, 모바일 설정도 포함한다. 실제 한국어 렌더링 폰트를 CDP로 확인하며 사용자 브라우저와 저장소를 바꾸지 않는 격리 컨텍스트에서 실행한다.

- [RK45 설정과 결과](evidence/sane-m3-rk45-result.png)
- [교차 초기화와 혼합 모델](evidence/sane-m3-crossing-reset.png)
- [2차 적분과 별도 속도 출력](evidence/sane-m3-oscillator-long-name.png)
- [모바일 설정](evidence/sane-m3-mobile-settings.png)
- [다크 범위 선택](evidence/canvas-selection-dark.png) · [라이트 범위 선택](evidence/canvas-selection-light.png)

원자료 385행과 SHA-256을 보존했다. [대응표](block-coverage.md)는 실제 14개 원본 행만 M3 승인 subset으로 승격했다. M2 29행, M1 정적 40행, preset 4행, AST 1행과 미구현 297행을 구분한다. First Order Hold가 원자료에 없다는 이유로 추적 행을 추가하지 않았다. Limited Integrator와 2DOF PID 같은 공유 capability의 미지원 옵션도 승격하지 않는다.

## 재현 명령과 한계

```powershell
npm test
npm run build
npm run test:e2e
npm run verify:m1
npm run verify:m2
npm run verify:m3
npm run verify:coverage
npm run verify:design
```

`verify:design`은 127.0.0.1:4173 로컬 preview가 실행 중일 때 사용한다. numerical source를 바꾸면 `npx tsx packages/codegen-ts/sync-runtime-templates.ts`로 고정 template를 먼저 갱신한다. 단위·브라우저 검사 최종 결과와 빌드 크기는 아래 최종 확인에 기록한다.

M3a/M3b의 승인 subset에 대한 수치·사건·실패·export 검증을 제공한다. 강성 solver, implicit/DAE, MIMO·복소 root, 가변 지연, 적분기 출력 제한, PID anti-windup·2DOF·자동 튜닝은 포함하지 않는다. 구간 내부에서 교차 후 되돌아오는 모든 사건을 검출하는 보장은 없으며 maxStep 선택과 수렴 검사가 필요하다. 노이즈가 있는 미분, 실제 장비의 실시간성, Simulink 전체 결과의 동일성을 보장하지 않는다.

입력 JSON·벡터·계수·solver·resource 범위를 검증하며 React 텍스트 이스케이프와 고정 파일명의 제한된 ZIP을 유지한다. 사용자 코드 실행·시크릿·API·DB·인증·개인정보 수집 경로는 추가하지 않았다. 보안 기본 8항목 중 서버 쿼리·인가·쿠키·RLS는 해당 경로가 없는 범위이며 이번 검증을 외부 보안 감사로 표현하지 않는다.

M0/M1의 실제 초보 사용자 조사, 도메인 소유권·상표 확인, 공개 배포·운영 검증은 별도 미완료 게이트다. 자동 화면 검사는 접근성 인증·사용성 조사로 대체하지 않는다.

## 최종 확인

2026-10-02에 numerical source와 export template를 동결한 뒤 최종 빌드에서 확인했다.

| 검사 | 최종 결과 |
| --- | --- |
| `npm test` | 11개 파일, 549개 검사 통과 |
| `npm run build` | 전체 TypeScript 검사 및 production 빌드 통과 |
| `npm run test:e2e` | 42개 모두 통과, 3.6분; 조작 개선·최초 맞춤·저장 복구·기존 기능·M3 신규 7개 포함 |
| `npm run verify:m3` | 독립 기준 모델 28개, 실패 4종, RK4 4차 수렴, 독립 Taylor 기준, strict ES2022·TS parity 통과 |
| M1/M2 수치 회귀 | M1 예제 4개·규모 검사, M2 손계산 모델 15개 통과; 과거 증거 보존 |
| `npm run verify:coverage` | 385개 원본 행 추적, 중복 0, 원자료 SHA-256 일치 |
| `npm run verify:design` | 20개 관측 통과, page error 0, 격리 Chromium 153 |

최종 빌드는 `index-BbnX6uie.js` 781.97kB(gzip 230.07kB), Worker `engine.worker-CA3XYYP8.js` 204.78kB, CSS 69.19kB(gzip 12.36kB)다. Vite의 500kB chunk 경고는 남아 있으며 초기 로딩의 코드 분할·성능 최적화 대상으로 기록한다. 경고 기준을 높여 숨기지 않았다. 수치 정확도와 기능 검사의 통과는 초기 로딩 성능 보장을 뜻하지 않는다.

브라우저 검사는 사용자의 열린 탭·IndexedDB를 변경하지 않는 새 컨텍스트에서 수행했다. 로컬 preview를 새로고침하면 최종 M3 빌드를 확인할 수 있다.
