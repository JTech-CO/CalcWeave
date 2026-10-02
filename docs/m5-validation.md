# M5 구축·검증 기록

2026-10-02~03 KST · 앱 0.5.0 · 엔진 `0.5.0-m5`. [M5 계약](m5-contract.md)에 따라 실수 행렬, 2D Lookup·Prelookup, 1~32bit 고정소수점 양자화 경계를 구현했다. 선택한 세 묶음의 승인 기록이며 전체 고급 기능 구현이나 Simulink 동등성·공개 출시를 선언하지 않는다.

## 구현 결과

신규 10종으로 registry는 **74종**, 정적 capability는 **43종**이다. 행렬 곱·전치·행렬식·역행렬·선형 방정식·Cholesky·LU, 2D Lookup·Prelookup, Fixed Quantize를 라이브러리·검색·빠른 추가·속성·Worker 실행·결과·JSON·TypeScript/manifest ZIP에 연결했다. schemaVersion 1과 유한 float64/boolean scalar/vector/2D 신호를 유지한다.

행렬은 각 축 1~32의 실수 2D이며 행렬 곱은 원소별 Product와 구분한다. LU는 `lower`,`upper`,`permutation` 행렬을 출력하고 `P·A=L·U`를 만족한다. 선형 방정식은 여러 우변 열을 지원한다. 단위·형상·특이·조건 불량·SPD·표현 범위를 검증하며 RHS 정규화의 subnormal 정밀도 손실을 진단한다. 표는 비균일 기준점과 행/열 대응, bilinear·nearest·previous, clip·linear·error의 명시 정책을 사용한다.

양자화는 입력 IEEE-754 저장 비트를 해석해 BigInt 유리수 반올림·포화·modulo wrap을 수행한다. 큰 유한 실수·음수·절반 동률·subnormal에서도 정수 코드를 정확히 보존한다. out은 복원 float64, stored는 정확한 ≤32bit 정수 Number이다. 뒤의 일반 블럭은 float64 산술이며 일반 fixed-point 타입 전파를 추가하지 않았다.

예제는 **27개**다. 새 예제는 선형 방정식·피벗 LU, 비균일 2D 표·Prelookup, 양자화의 반올림·범위 처리다. Inspector에 행렬·표 축·다중 포트·양자화 간격과 stored 범위를 설명하며 캔버스는 영어 이름·핵심 값만 표시한다. 검정/차콜 다크·밝은 회색 라이트, 본문16px/보조14px, 좌우 캔버스/결과, 최초 fit·중간 버튼 pan·왼쪽 marquee·Space fit·Scope 시간 범위를 유지한다.

## 독립 수치·내보내기 근거

[수치 증거](evidence/m5-verification.json)와 [portable fixture](../fixtures/m5)는 `npm run verify:m5`로 생성했다. 성공 30모델의 모든 원시 출력·시간 표본과 실패 12모델의 code/nodeId/time/partial result를 비교했다. runtime 자체를 기대값으로 재사용하지 않고 손계산 식·정수/유리수·지표 합산 잔차를 사용한다.

| 성공 모델 | 수 | 독립 기준 |
| --- | ---: | --- |
| 행렬 | 10 | 직사각 dot product, cofactor determinant, 수작업 inverse·해·L/U/P, `AX−B`, `A·inverse−I`, `LLᵀ−A`, `PA−LU` 잔차, 1e±300 척도 |
| Lookup·Prelookup | 8 | 비균일 쌍선형 함수, 두 축 범위 밖 값, nearest 동률, previous 내부/마지막 knot, 직접 index/fraction |
| 이산·연속 Lookup | 2 | `f(t,2.5)=12t−.5`, 연속 적분 `6t²−.5t`, 실제 .25 knot·마지막 끝점·전체 표본 |
| 양자화 | 9 | 독립 half-integer 반올림 표, signed/unsigned modulo2³², fraction32, 포화, MAX_VALUE·MAX_SAFE_INTEGER·MIN_VALUE |
| 이산 행렬 상태 | 1 | 3×2 행렬 Unit Delay의 전체 표본·마지막 상태 |

일반 행렬/보간 fixture의 절대 허용오차는 2e−11, 연속 시간 모델은 2e−9, 정수 코드와 반올림 표는 오차 0이다. 척도 1e±300은 상대 허용오차 2e−12이며 측정 오차는 0이다. 모든 fixture에서 기대값과 잔차가 허용 범위 안에 있었다. 일반 fixture에서 측정한 최대 절대 오차는 약 4.0e−14였다.

모델 JSON 재개방·노드/연결 삽입 순서 변경·전체 raw grid·출력 형상/단위·SHA-256/manifest·결과와 manifest의 방어적 복사를 확인했다. 생성 코드 3형식을 `lib.es2022`만 사용한 strict TypeScript로 검사하고 실제 import 없는 ESM으로 실행했다. M5 기능이 포함된 모델은 `typescript-m5-v1`, 과거 기능만 있는 모델은 기존 feature별 M2/M3/M4 타깃을 유지한다. 다른 입력값을 executable source로 삽입하지 않는다.

실패 12모델은 특이/조건 불량 inverse, 비대칭/비양의 정부호 Cholesky, determinant overflow/underflow, 범위 밖 Lookup/Prelookup, 정적·이산 양자화 overflow, 연속 step 이후 특이 행렬, 이산 Lookup 범위 초과다. 뒤에서 실패한 세 모델의 완료 표본 개수·시각·값을 별도 수작업 기준으로 확인했다. 실패한 이산 tick은 마지막 완성 표본의 상태·held/rate/random 메모리로 복원한다. [부분 상태 회귀](../tests/m5-partial-state.test.ts)는 scalar·행렬 지연의 sample/finalState/stateMemory와 실제 standalone ESM 실패 재실행·방어적 복사까지 확인한다.

가중 예산은 별도 3건이다. 직사각 행렬 모델 128 operation에 한도127, 양자화 모델19,827에 한도19,826을 요청하면 시작 전에 거부한다. 연속 Lookup의 전체9,860에 한도4,930을 요청하면 t=.375까지 완료한 표본4개·operation4,900을 보존한다. 이 낮은 사용자 지정 한도는 runner 옵션 검사이며 optional standalone argument parity를 주장하지 않는다. 생성 코드는 기본50,000,000 operation·30초·1,000,000 기록 원소 한도를 사용한다.

## 검사와 화면 근거

- `npm test`: **20파일·822검사 통과**. 기존680개와 신규142개(행렬52·양자화36·통합52·부분 상태2)다. 양자화에서는 독립 유리수 oracle과184,320조합도 비교했다.
- `npm run build`: strict TypeScript와 프로덕션 번들 통과. 최종 main `index-FHqa3cNu.js`, Worker `engine.worker-BK9-VQlu.js`, 지연 로드 export `src-B3CZV70y.js`.
- `npm run verify:m1`~`verify:m5`: 통과. 이전 M1~M4 증거/fixture는 보존하고 새 엔진의 [M1](evidence/m1-regression-on-m5.json)·[M2](evidence/m2-regression-on-m5.json)·[M3](evidence/m3-regression-on-m5.json)·[M4](evidence/m4-regression-on-m5.json) 회귀는 별도 저장했다.
- `npm run verify:coverage`: 원본385행·중복0·원본 SHA-256 불변.

`npm run test:e2e`의 최종 전체 **80/80 통과**(기존66·신규14), `npm run verify:design:m5`의 **84관측 통과**(기존60·신규24), pageErrors·문서/블럭 글자 overflow0을 확인했다. M5 화면은 다크/라이트×1440/1024/390/320px×새예제3종이다. 실제 Worker 계산·다중 포트와 전체 원소 표·JSON 재개방·ZIP의 M5 타깃/기대결과·32bit stored·잘못된 형상/축/overflow·이전 이력 보존을 검사했다. 기존 Scope 시간 범위·최초fit·키보드/마우스·이산/연속·데이터/계층 회귀를 포함한다. 계산 수치에는 허용오차를 적용하고 정수 stored·저장 이력·ZIP/manifest 일치는 정확히 비교한다.

[전체 검증 요약](evidence/m5-workspace-verification.json)·[화면 측정](evidence/m5-design-verification.json)에 결과와 빌드 SHA-256을 남겼다. 최종 소스/테스트/빌드68파일 fingerprint가 검사 전후 동일했다. 사용자 브라우저의 저장 공간을 변경하지 않고 격리된 context에서 검사했다. [다크 행렬](evidence/m5-sane-dark-1440-matrix-solve-lu.png), [라이트 양자화](evidence/m5-sane-light-1440-quantizer-rounding-overflow.png), [모바일 Lookup](evidence/m5-sane-light-320-lookup-2d-nonuniform.png)을 직접 확인했다. 최소 읽기 크기와 내부 스크롤을 보존하며 이 화면 검사를 접근성 인증·실제 사용자 조사로 해석하지 않는다.

## 대응표와 승인 경계

[대응표](block-coverage.md)는 증거를 확인한 후 `scripts/update-m5-coverage.ts`로 갱신했다. 원본5행(행렬 곱2·전치1·2D Lookup1·Prelookup1)을 승인 subset으로, Data Type Conversion2행을 양자화 목적의 독립 대체로 반영했다. 기존 Product의 원소별 상태는 유지하며 행렬 구성을 별도 설명한다. 원자료에 없는 determinant/inverse/solve/Cholesky/LU5종은 원본 수에 합산하지 않는다.

원본385행 상태는 M5subset5·M5독립대체2·M4subset18·M3subset15·M2subset29·M1정적40·preset4·AST대체1·미구현271이다. 원본의 이름·분류·사용 조건·줄번호와 digest를 보존했다.

복소수/Hermitian·일반 n-D/동적 Lookup·Interpolation Using Prelookup·64bit·typed fixed-point 산술·메시지·조건/반복·가변 지연·DAE·수치 선형화·외부 MATLAB/C runtime은 이번 승인 밖이다. 실제 사용자 조사·외부 엔진 수치 비교·M0~M4의 미완료 종료 게이트·M6 공개 배포도 소급 완료하지 않았다. 번들 main약845KB(gzip256KB)의 기존 Vite size warning과 통제된 부하의 성능/메모리 측정은 출시 전 별도 확인할 항목이다.

보안 기본값 검토에서는 새 입력의 필드 허용 목록·숫자/배열/축 크기 상한·getter/숨김 속성 거부·Worker/가져오기/export 재검증·React escaping·유한 결과와 가중 예산을 확인했다. 신규 서버/API/DB/인증/개인정보 수집을 추가하지 않았다.
