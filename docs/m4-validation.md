# M4 구축·검증 기록

2026-10-02 · 앱 0.4.0 · 엔진 `0.4.0-m4`. 로컬 데이터·투명한 재사용 계층·승인 단위·이름이 있는 신호·실행 기록과 반복 비교를 구현했다. [M4 계약](m4-contract.md)은 파일 정리, 재생 경계, 확장·hash, 대시보드와 공유 예산의 실제 subset을 정의한다.

## 구현 결과

Registry에 Playback, Unit Conversion, Bus Creator/Selector, Subsystem, DocBlock, Model Info 7종을 추가하여 총 64종이 됐다. 기존 M1 정적·M2 이산·M3 연속/혼합 실행의 solver·rate·state·난수·사건 계약을 유지한다. schemaVersion은 1이며 기존 모델에 선택적으로 dataset/subsystems/dashboard/notes를 더한다.

작업 공간에 데이터·실험·대시보드·노트를 추가했다. CSV/JSON의 원본과 정리 결과 미리보기, typed column과 단위·시간·결측/중복 처리, 자산 버전 갱신·재생 블럭 추가·다운로드를 제공한다. 서브시스템 선택 그룹화·내부 편집·breadcrumb·재사용·명시적인 버전 참조 갱신을 제공한다. slider/toggle 입력은 다음 실행에 적용하고 display/gauge/scope는 마지막 실행의 원시 결과를 보여 준다. 실행 기록은 snapshot/hash/manifest와 함께 보관하고 scalar 파라미터 Sweep과 최대 3개 실행 비교를 제공한다.

기존 검정 다크·밝은 회색 라이트, 최소 정보 블럭, 좌우 캔버스/결과, 큰 글자, 중간 버튼 pan·왼쪽 푸른 marquee·Space fit·최초 자동 fit 조작은 유지한다. 새 학습 예제 3개를 포함해 예제는 24개다. 최종 브라우저·디자인 검증은 아래에 기록한다.

## 독립 수치·파일·내보내기 근거

[M4 실행 증거](evidence/m4-verification.json)와 [portable 모델·기대결과](../fixtures/m4)는 `npm run verify:m4`로 생성한다. 기준은 runtime kernel이나 생성 TS를 재사용하지 않는 선형·구간별 수식, 손계산 단위와 Bus 값, 수동 작성한 평면 상태 그래프다. 각 모델의 **모든 출력·모든 raw 샘플**을 검사하며 출력 목록과 시간 격자 길이도 확인한다. 절대 허용오차는 1e-11 또는 solver/지연을 포함한 경우 2e-9다.

| 기준 모델 | 개수 | 독립 기준 |
| --- | ---: | --- |
| 정적 재생과 설명 블럭 | 1 | startTime 값 3, annotation 두 종류의 수치 출력 없음 |
| 선형 재생과 stage 적분 | 2 | `y=2t+1`, `x=t²+t`; 실제 RK stage 시각에서 읽기 |
| previous의 off-grid jump | 1 | t=.37에서 1→3, 적분 `t+2*max(0,t-.37)` |
| outside hold/zero | 2 | 구간별 상수·선형 신호의 직접 계산과 면적, 마지막 knot 오른쪽 극한 |
| zero 범위와 Transport Delay | 1 | raw `.75→7.5` 유지, delay .2로 jump .45/.95, 누적 면적 2.5 |
| boolean previous publication | 2 | 이산/혼합 P2 격자의 `[false,false,true,true,false,false,true]` |
| ms 시간 정규화 | 1 | 1000ms=1초, `y=2t+1`, 원래 단위·출처 보존 |
| cm→m / C→K | 2 | `[125,250]→[1.25,2.5]`, 온도 `+273.15`, 벡터 shape 보존 |
| 승인 파생 차원 | 2 | 2m*3m=6m², (2N*3m)/2s=3W |
| numeric/boolean named Bus | 2 | 두 scalar 필드의 배열·타입·단위와 이름 선택 |
| 반복 상태 서브시스템 | 1 | P2/O1 UnitDelay 두 독립 상태; 직접 만든 평면 그래프의 전 샘플·최종 상태와 비교 |
| 서브시스템 내부 Playback | 1 | 내부 Gain2의 `4t+2`, 계층과 데이터 참조 동시 보존 |
| 합계 | **18** | 모든 raw 출력에 독립 기대값 적용 |

각 모델은 정규화 JSON roundtrip 후 실행·manifest를 다시 비교한다. root/정의 내부 node·edge·port 및 자산·정의 삽입 순서를 뒤집어도 hash와 수치 결과가 같아야 한다. SHA-256은 Node의 독립 crypto digest와 비교하며 데이터·hierarchy manifest reference가 실제 보관 내용·버전·정의 hash와 같은지도 검사한다. 반환된 결과·manifest를 변경한 후 다시 실행하여 별도 복사본이 유지되는지 확인한다.

static/discrete/continuous **세 형태**의 생성 코드를 별도의 strict ES2022 환경에서 typecheck한다. DOM·Node typings·CalcWeave import 없이 actual ESM 모듈로 실행한다. import·eval·Function 기반 사용자 코드 평가가 없어야 한다. elapsedMs를 제외한 결과 전체를 웹 runner와 정확히 비교하며 numerical tolerance를 parity 기준에 다시 완화해서 쓰지 않는다. failure의 진단과 부분 결과도 같은 정책이다.

## 실패·무결성·경계 수정

공식 verifier의 controlled failure는 6종이다. outside error의 `DATASET_TIME_RANGE`는 runner와 독립 TS의 진단·마지막 유효 부분 결과를 비교한다. CSV quote 오류, UTF-8 2 MiB 초과, 비유한 숫자, 시간 중복, 모델에서 변경한 데이터의 내용 hash 불일치 5종은 해당 진단을 확인하고 기존 모델이 그대로 남았는지 검사한다. import failure에 독립 TS parity를 주장하지 않으며 실행 전 경계 검증으로 기록한다.

단위 검사에는 source/정규화 hash 분리, BOM·CRLF·quoted comma/newline·escaped quote, JSON 열 합집합·누락값, 명시적 정리·시간 정렬·중복 정책, 숫자·boolean·string 구분, 행·열·셀·문자열/모델 합계 상한, 위험 필드·접근자, CSV 공식 중화와 UTF-8 SHA-256이 포함된다. 계층 검사는 직접·간접 재귀, 중첩·확장 한도, 버전 불일치, 인터페이스·alias 순환, 상태 독립과 source map을 다룬다. 이는 프로젝트에 추가한 전용 회귀이며 외부 보안 감사나 Simulink 전체 호환 검증을 뜻하지 않는다.

독립 수식 검증에서 outside zero의 마지막 데이터 시각을 다음 RK 구간의 RHS에 다시 포함하여 면적이 커지는 문제를 발견했다. 마지막 원시 값은 유지하고 다음 구간에서는 정확한 오른쪽 극한을 사용하도록 수정했다. 이력에도 jump 양쪽을 보존하여 `.75`의 마지막 값 7.5가 `.95` 이후 delayed 면적으로 들어가지 않는 회귀를 추가했다. fixture의 마지막 누적 면적은 2.5다.

또한 계층 정의 hash를 계산한 뒤 portable 파라미터의 기본값을 정규화하면 reopen의 정의 hash가 달라지는 문제를 검증에서 발견했다. compiler는 root/정의 파라미터와 이산 rate를 먼저 정규화한 뒤 flatten하고 metadata를 만든다. 현재 evidence는 JSON reopen의 전체 manifest와 정의 content hash를 직접 비교한다. 메모·label·layout·dashboard·notes 편집과 annotation 추가/삭제는 실행 의미 hash를 바꾸지 않는 회귀도 포함한다.

## 반복 실험의 독립 기준

별도 Sweep 기준 모델은 Dataset `y=2t+1` → Gain `k=1,2,3` → 초기값 0의 Integrator다. 기대값 `x=k(t²+t)`를 각 11개 raw 샘플과 비교한다. t=1의 마지막 값은 2/4/6, k1을 기준으로 마지막 차이는 0/2/4다. 전 샘플의 독립 식에서 직접 계산한 RMSE는 각각 0, 약 1.06315568, 2.12631136이다. 이 3개 portable variant와 기대결과를 [fixtures/m4](../fixtures/m4)에 저장했다.

각 variant는 정규화 JSON·semantic SHA-256·dataset references·manifest·실제 독립 ESM의 수치 결과를 확인한다. 반복 Sweep의 같은 값은 같은 model hash를 만들고 원본 모델은 바꾸지 않는다. solver 통계·상태·메모리도 수치 parity에 포함한다. Sweep이 요청한 `resources.operations`는 runner 측정값이므로 기본 독립 TS 결과와의 비교에서 그 선택적 측정 필드만 제외한다.

공유 기록 예산 4와 연산 예산 6의 작은 정적 모델에서는 각각 두 run을 완료한 뒤 `SWEEP_RECORD_BUDGET`/`SWEEP_OPERATION_BUDGET`으로 이후 실행이 중단되는 것을 확인했다. progress 뒤 취소는 completed 한 run을 보존한다. 최대 16개 variant 검증·원본/진행 snapshot 독립성·잘못된 executor resource 보고·전체 wall 한도·자료형/시간축/단위가 다른 비교 거부는 전용 실험 단위 검사에서 확인한다. 전체 30초·기록 100만·연산 5천만을 run마다 새로 부여하지 않는다.

## 회귀·UI·데이터 출처

M1 정적, M2 이산, M3 ODE의 기존 기록은 보존하고 M4 엔진에서 별도 회귀를 수행했다. M3의 28개 수치 기준·4개 solver 실패·RK4 차수·독립 Taylor 기준은 M4 데이터 verifier의 18개와 구분한다. [M1 회귀](evidence/m1-regression-on-m4.json)·[M2 회귀](evidence/m2-regression-on-m4.json)·[M3 회귀](evidence/m3-regression-on-m4.json)가 통과했다. 이전 단계 fixture와 당시 증거를 현 버전으로 덮어쓰지 않는다.

UI 검증은 데이터 preview/import/update와 오류 시 원본 유지, hierarchy 내부 편집·재사용·버전 갱신, 다음 실행에 적용되는 dashboard, 실행 기록 복원·다운로드·최근 보관·손상 복구, Sweep/비교·취소 및 기존 캔버스 조작을 대상으로 한다. 브라우저 검사는 사용자의 열린 탭·IndexedDB를 바꾸지 않는 격리 context에서 수행했다.

기본 파라미터를 생략한 모델의 이력은 compiler의 정규화된 portable snapshot으로 저장하여 manifest hash와 일치시켰다. Slider 초기 범위는 음수나 12,500 같은 현재 값을 포함하고 표시 위젯은 numeric scalar 출력만 선택할 수 있다. Dashboard 연결이 있는 root 노드를 묶으려면 위젯 연결을 먼저 삭제하도록 안내하며 원본 모델은 보존한다. 내부 sink의 namespaced 원시 ID는 유지하고 결과·CSV·이력 비교의 표시 이름은 실행 당시 계층 경로와 블럭 label에서 복원한다. 이 네 경계는 실제 브라우저 회귀에 포함했다.

[M4 디자인 측정](evidence/m4-design-verification.json)은 기존 20개 시나리오에 새 작업 화면 40개를 더한 **60개 관찰**이다. 다크·라이트 각각 1440/1024/390/320px의 데이터·실험·대시보드·노트·계층 화면을 검사했다. 보조/control 14px 이상, 본문 16px 이상, 검사한 텍스트 대비 4.5:1 이상, 페이지 가로 넘침 없음, 큰 화면 좌우·작은 화면 세로 배치와 pageErrors 0을 확인했다. [데이터 화면](evidence/m4-sane-dark-1440-data.png)·[대시보드](evidence/m4-sane-dark-1440-dashboard.png)·[320px 대시보드](evidence/m4-sane-dark-320-dashboard.png)에 렌더링 근거를 남겼다. 과거 SANE 스크린샷은 유지했다.

원자료 `dataset/Simulink_Basic_Blocks_R2024b.md`의 SHA-256은 `cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7`이며 문서 385행을 그대로 유지한다. 구현 진행은 별도 [블럭 대응표](block-coverage.md)로 추적한다. canonical registry 개수와 원본 문서 행 수는 같은 단위가 아니다. 개별 원본 행을 이번 subset으로 승격할 때 unsupported 옵션까지 구현했다고 표시하지 않는다.

## 재현 명령과 의도적인 제한

```powershell
npx tsx packages/codegen-ts/sync-runtime-templates.ts
npm test
npm run build
npm run test:e2e
npm run verify:m1
npm run verify:m2
npm run verify:m3
npm run verify:m4
npm run verify:coverage
npm run verify:design:m4
```

numerical source가 바뀌면 고정 template를 먼저 갱신한다. `verify:design:m4`와 E2E의 로컬 preview는 127.0.0.1:4173을 사용하며 최종 빌드를 대상으로 실행한다. M4 화면 증거는 기존 SANE 기록과 별도 파일로 저장한다. 환경은 Windows 11 / i7-13620H / Node 25.9.0이며 수치 정확도 검증의 통과가 실시간성이나 모든 장비의 성능을 보장하지 않는다.

데이터는 제한된 CSV/JSON 로컬 표이며 XLSX·MAT·원격/스트리밍 입력·외부 자산 resolver를 추가하지 않았다. 단위는 승인 목록과 명시적 변환이며 임의 차원식·자동 scaling은 없다. Bus는 같은 타입·단위의 scalar 두 필드만, 계층은 투명 재사용 definition만 지원한다. typed heterogeneous/nested Bus, enabled/triggered/atomic/iteration subsystem, 모든 Simulink 파라미터와 `.slx` 왕복을 선언하지 않는다. Dashboard live tuning, 다중 파라미터 탐색·최적화·병렬/클라우드 실행도 포함하지 않는다. M3의 scalar 무차원 ODE·비강성 solver 및 사건 검출 한계는 유지한다.

입력 상한·typed policy·hash·scope/version·고정 template·React 텍스트 이스케이프·CSV 공식 방지·제한된 ZIP 경로를 유지한다. API·DB·인가·쿠키·개인정보 수집 경로를 새로 추가하지 않았으며 서버 쿼리·RLS 등 보안 기본 항목은 해당 경로가 없는 범위다. 로컬 자료에 별도 외부 전송을 추가하지 않는다. M0/M1의 초보 사용자 조사, 도메인·상표 확인, 공개 배포·운영 게이트는 별도다.

## 최종 확인

최종 numerical source와 고정 template, UI 소스를 동결한 뒤 아래 검사를 통과했다. [검사 요약](evidence/m4-final-checks.json)에 실행 환경·명령·빌드 hash와 증거 경로를 기록했다.

| 검사 | 실제 결과 |
| --- | --- |
| `npm test` | 16개 파일, **680개 통과** ([로그](evidence/m4-unit-run.log)) |
| `npm run build` | strict TypeScript와 production build 통과 |
| `npm run test:e2e` | 기존 42개 + M4 신규 13개, **55개 전체 통과** |
| `verify:m1` / `verify:m2` / `verify:m3` | 기존 수치·JSON·manifest·독립 export 회귀 통과 |
| `verify:m4` | **18개 기준 모델·6개 오류·3개 Sweep**, strict ES2022 세 형식과 actual ESM 통과 |
| `verify:coverage` | 원자료/추적 **385행**, 중복·누락 0, 원자료 SHA-256 유지 |
| `verify:design:m4` | **60개 관찰**, pageErrors 0, 폰트·대비·overflow·배치 검사 통과 |

대응표는 M4 신규 subset 18행과 기존 M3 First Order Hold 대응 누락 1행의 교정을 구분한다. 원자료 385행 중 미구현은 278행이다. 단계별 승인 subset을 전체 원본 블럭 옵션의 구현으로 해석하지 않는다.

빌드의 메인 JS는 813.28 kB, gzip 246.30 kB이며 코드 내보내기 모듈은 약 120 kB의 별도 비동기 chunk다. 기존 Vite 큰 chunk 경고는 남으며 오류가 아니다. 초기 다운로드·브라우저 메모리와 실제 초보 사용성은 별도 측정 과제다. 이번 자동 검증으로 외부 엔진 전체 동등성·사용자 조사·공개 배포 게이트를 완료 처리하지 않는다.

## 후속 수정 — Scope 시간 범위

2026-10-02, Scope에 시작·종료 시간과 **범위 적용 후 실행**을 추가했다. 기존 예제의 종료 시간 2초를 그래프에서 바로 늘리고 지연 응답까지 새로 계산한다. 결과 그래프와 Dashboard Scope가 같은 root 실행 설정을 사용하며 시간 간격·solver·실행 한도는 유지한다. 입력·격자·구간 수를 적용 전에 검증하고 중복 제출과 실행 중 재실행을 차단한다. 이력의 과거 모델과 결과는 수정하지 않는다.

Clock(s) → Delay 6 tick, step 0.5s → Scope에서 종료 시간을 2초에서 6초로 바꿨다. 실제 3초 지연 이후의 `[0,0,0,0,0,0,0,0.5,1,1.5,2,2.5,3]`과 13개 시간 샘플, 6초 축을 검증했다. 원본 2초 실행 기록 전체와 hash는 보존하고 새 실행 hash는 달라진다. 모델 파일·로컬 저장·새로고침에도 6초 설정이 유지된다. Dashboard에서 시작 1초·종료 5초로 변경하면 해당 시각의 초기 상태부터 9개 샘플을 새로 계산한다.

신규 E2E **11개**는 빈 값·Infinity·역전·격자 불일치·10,000 구간 상한 위반의 원자적 거부와 320/390px 두 테마의 가독성·넘침·실제 축/선 색도 검사한다. 기존 55개와 합친 **66개 전체 E2E**, 단위 **680개**, strict TypeScript와 production build가 통과했다. 검증 중 앱 소스와 빌드 hash가 유지됐다. [후속 검사 증거](evidence/scope-time-range-verification.json)·[6초 지연 응답 화면](evidence/scope-time-range.png)·[320px 화면](evidence/scope-time-range-320-dark.png)에 기록했다. 앞 절의 M4 최초 55개 검사와 빌드 수치는 당시 이력으로 보존한다.
