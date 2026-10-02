# CalcWeave M2 구현 및 검증 기록

> 2026-10-02 · 앱0.2.0 / 엔진`0.2.0-m2` · 승인 subset 구현·자동 검증 통과, M0/M1 외부 게이트 유지
>
> [구현 계약](m2-contract.md) · [마일스톤](03-milestone-roadmap.md) · [M1 기록](m1-validation.md)

## 구현 범위

기존25종에 신규20종을 추가한 registry45종이다. 정적26종·이산44종을 지원하며 연속은 기존 scalar M0 실험 범위를 유지한다. 시간 입력과 상태 블럭의 default/options, 단위·형상·피드백·reset·샘플시간 경계는 구현 계약에 명시한다. 일반 연결의 rate가 다르면 Rate Transition을 요구한다. 임의 비율·비동기 task·MIMO·signed bitwise·PID·고정소수점은 포함하지 않는다.

정수 tick에서 이전 상태 읽기, 현재 출력, 결과 기록, next-state 동시 commit을 분리한다. 마지막 기록 뒤에는 ordinary state를 추가로 진행하지 않는다. source 난수는 노드마다 독립적인 LCG32를 사용하며 draw 상태를 기록한다. 난수·복합 state의 내부 메모리와 최종 출력 projection을 구분한다.

일시정지는 실제 Worker ack 뒤 표시하며 safe tick 경계에서 진행을 멈춘다. paused 벽시계 시간은 active budget에 포함하지 않는다. 재개는 같은 snapshot으로 이어지고, 초기화는 모델·좌표를 보존하면서 실행 기록을 지워 초기값/seed부터 다시 시작한다. 결과 viewer는 모든 시간 샘플과 배열 원소에 접근한다.

이산 수치 오류는 원본 블럭과 실제 입력tick/time을 표시한다. next-state 오류도 해당 입력 샘플의 시각을 사용하며 생성 TS와 일치한다. 모든 rate를 매 base tick 실행한다고 가정한 보수적인 연산 preflight는 저빈도 모델도 일찍 거부할 수 있다. 상한 초과는 양쪽 runtime에서 같은 구조의 진단으로 반환한다.

생성 model.ts에는 import 없는 고정 runtime과 manifest 접근 함수를 포함한다. ZIP 실행 패키지는 고정 파일명·크기 상한으로 만들며 현재 완료 snapshot의 기대결과만 담는다. `createExportManifest`의 Web Crypto SHA-256과 생성 코드의 해시를 비교한다. 연속 모델 export는 생성 전에 차단한다.

## 독립 수치 fixture

`npm run verify:m2`는 손계산 수열·행렬·임펄스·rate timeline과 BigInt PRNG reference를 사용한다. 모든 output sample을 `atol=rtol=1e-12`로 비교하고 JSON 재열기, node/edge 순서 반전, 독립 생성 TS의 시간축·shape·finalState·stateMemory와 manifest를 검증한다. 실제 기록은 [M2 수치 검증 JSON](evidence/m2-verification.json)과 [portable fixture](../fixtures/m2)에 저장한다.

| fixture | 독립 기대값/근거 |
| --- | --- |
| `F02-delay-feedback` | y[n]=1+0.9y[n-1], 초기0: 1,1.9,2.71,3.439,4.0951,4.68559 |
| `F02-delay-reset` | 두 FIFO slot 초기-1, n=2·6 level reset: -1,-1,1,-1,-1,4,5,-1,-1 |
| `F02-fir-impulse` | taps[1,0.5,0.25]의 impulse: 1,0.5,0.25,0,0 |
| `F02-transfer-function` | y[n]=1+0.5y[n-1]: 1,1.5,1.75,1.875,1.9375 |
| `F02-state-space` | xnext=0.5x+1,y=x,x0=0: 0,1,1.5,1.75,1.875 |
| `F02-integrator-period` | baseStep0.25·period2·u2: 0,0,1,1,2,2,3 |
| `F02-typed-delay` | [0,0] 초기값 후 [1,-2], [1,-2] |
| `F02-rate-1-2-5` | 두 read-before-write 경계: 5tick씩 -1과3을 hold, n10에서7 |
| `F02-rate-5-2` | 동시 hit의 이전값: n0:-1, n2:0, n6:5, n10:5 |
| `F02-time-sources` | 음수 시작을 포함한 Step·Ramp·quarter sine·tick Pulse·Clock·positive-modulo sequence |
| `F02-seeded-random` | exact BigInt LCG32 reference, uniform seed0와 two-draw normal seed7 |
| `F02-lookup-and-bits` | clipped linear [-1,0.25,2]→[0,2.5,10], uint32 0x80000001<<1→2 |
| `F02-offset-terminal` | P2/O1: Scope [0,0] 후 [7,8] hold; 마지막not-due의 finalState도[7,8] |
| `F02-difference-derivative-edges` | du1/dt0.5=2, boolean[T,T,F,F,T]의 rising/falling/either |
| `F02-timeless-publication` | Constant P5/O2의 RT 발행은 n2끝: -1,-1,-1,3,3,3 |

## 자동 검사

기존196개 단위 검사와27개 브라우저 회귀, 최초 캔버스/지연 저장본 맞춤을 유지한다. 신규 계약·수치·옵션·strict TypeScript·Worker 제어·ZIP·UI 흐름을 함께 검사한다. 저장 원자료385행의 byte hash는 바꾸지 않는다.

| 검사 | 실제 결과 |
| --- | --- |
| `npm test` | 8파일381개 통과: 모델/컴파일러92, 수식4, runtime142, TS생성127, Worker13, ZIP3 |
| `npm run build` | strict TypeScript와 production build 통과; main675.41kB(gzip205.32kB), Worker164.04kB |
| `npm run test:e2e` | Chromium153.0.8010.12·35개 통과, 기존27개+M2 6개+캔버스 조작2개; 실제Worker·제어버튼·모드편집snapshot·오류tick/time·ZIP/fixture·수치 입력 범위·마우스/Space 검증 |
| `npm run verify:m2` | 독립15fixture: 모든샘플·노드/연결순서·JSON재열기·standalone TS·finalState/stateMemory·manifest hash 일치 |
| `npm run verify:coverage` | 385행·중복0, 원자료SHA256 보존; M2 subset29행, 미구현309행 |
| `npm run verify:design` | 다크/라이트·320/390/720/900/1024/1440/1920 폭·200%글자·typed/M2화면 측정 통과, pageErrors0·페이지 overflow0·블럭문자최소16px |
| `npm run verify:m1` | 기존 학습4fixture/JSON재열기·100/1000노드×64원소 Gain chain 통과. [M2에서의 회귀 기록](evidence/m1-regression-on-m2.json)에 별도 보존 |

생성 TypeScript는 strict ES2022-only 타입환경에서 검사하고 실제 별도 모듈로 실행한다. 고정 수치template와 runtime source의 동기화 검사는 이후 한쪽만 수정한 drift를 차단한다. budget/preflight의 구조화 오류와 실제 수치/전이 tick/time도 export와 비교한다.

실제 브라우저에서 음수 시작 시간, `1e-9` 기본 간격과 큰 유한 파라미터의 가져오기·편집·실행을 검증했다. 실행 시간 필드는 schema와 같은 ±1e9 범위, 간격은 1e-9 이상을 허용하며 수치 draft의 길이·유한값 검증을 유지한다. 큰 유한 입력에서 계산 결과가 overflow하면 입력 단계에서 임의로 차단하지 않고 실제 블럭과 tick/time의 `NUMERIC_NONFINITE` 진단을 표시한다.

Vite의500kB main chunk 경고는 기존 M1에 이어 남는다. 코어·codegen의 기능 확대가 현재 main bundle에 들어 있으며, 초기 로딩·메모리·장기 성능 목표와 code splitting은 공개 단계 전 별도 확인한다. 경고를 숨기기 위해 한도를 높이지 않았다.

M1 정적 회귀 측정은 2회예열·10회반복으로 compile/run을 분리했다. 100노드 compile median8.301ms/p9510.642ms, runtime1.082/1.923ms; 1000노드 compile66.440/98.622ms, runtime11.478/22.086ms였다. 최대 수치오차는 각각4.97e-14/1.99e-13이다. Node 단독 관측이며 브라우저 편집 반응·전체 heap·다른 장비의 보장이 아니다.

[FIR 결과 화면](evidence/sane-m2-fir-result.png)과 [1·2·5배 주기 화면](evidence/sane-m2-multirate-result.png)에 현재 UI를 보존했다. 자동 도식맞춤·블럭 name/value 간결성·검정/회색·좌우배치를 유지하며 실제 화면 측정은 [SANE 측정 JSON](evidence/sane-design-verification.json)을 따른다.

후속 캔버스 조작 수정은 휠 버튼 이동·왼쪽 영역 선택·Space 맞춤을 적용했다. 다크/라이트의 실제 파란 선택 범위, 선택 블록 위 이동, 모델 좌표 유지, 입력·버튼·모달·한글 조합·키 반복 경계를 검사했다. [조작과 화면 기록](04-sane-design-revision.md#캔버스-마우스와-키보드)에 상세 동작과 선택 화면을 남겼다.

## 대응표와 보안 경계

원본385행 중 M2 승인subset29행, M1 정적40행(이산에도확장)·preset4행·AST독립대체1행, M0연속실험2행, 미구현309행이다. Numeric 부호 경계 Detect·가변Delay·nD Lookup·signed bitwise 등은 공유ID가 있더라도 승격하지 않는다. SourceRandom의 원본 MATLAB 난수열 동등성도 범위 밖이다.

SQL/API/인증/DB/서버키·PII수집은 추가하지 않았다. 사용자 문자열은 React 텍스트로 표시하고 AST/IR만 고정template 데이터로 생성한다. Worker에서 schema/compile/자원 예산을 다시 검증한다. ZIP은 고정6개 파일명 allowlist·파일16MiB/전체32MiB로 제한하며 임의 archive를 해제하지 않는다. 소유권·rate limit·쿠키·RLS는 추가된 서버경로가 없어 해당 변경 사항이 없고 기존 보호 경계를 유지한다.

## 남은 게이트

이번 기록은 로컬 자동 검사와 승인 subset을 다룬다. 실제 초보 사용자5명 조사, 외부 사용 환경/전체 메모리·장기 성능, 도메인·상표·공개 배포 확인은 수행 완료로 바꾸지 않는다. M0/M1의 외부 종료 게이트는 이전 기록대로 남는다. M3의 정식 연속/혼합 실행과 solver export는 다음 범위다.
