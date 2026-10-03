# M13 문자열·대시보드·기록·로컬 데이터 검증

2026-10-03 · 앱0.14.0 · 엔진0.14.0-m13 · schema1. 기존304개 정의를 객체 단위로 정확히 보존하고30개를 추가해334종·69예제/11범주가 됐다. M13의 선택 실행·UI 범위를 로컬에서 검증했으며 병합·공개 배포 게이트는 별도로 기록한다. 현재 검증된 공개 버전은 M12의 앱0.13.0이다. [실행 계약](m13-contract.md)·[75행 대응표](m13-implementation-map.json).

## 독립 실행과 상태

139개 raw 모델(정의30·경계109)의350개 정상 모드 실행과846개 표본을 확인했다.15개 실패는 compiler 거부와 실제 runtime 실패를 구분하며, 정상350개와 runtime 실패11개를 합친361개 생성 TypeScript를 실제 실행했다. 정적·이산·연속 대표 template3개를 strict ES2022로 검사하고 각 프로그램의 import-free 구문·manifest·실행 결과를 검사했다. [실행 증거](evidence/m13-verification.json)·[독립 fixture](../tests/m13-independent-fixtures.ts).

전체 시간축·포트·표본, 최종 held 출력과 내부 memory, JSON 왕복·역순 삽입·실제 TypeScript parity를 비교했다. 문자열·정수 코드·float32·boolean·typed tag·bus field/shape는 정확 비교한다. legacy/float64 수치 oracle는 fixture의 명시 허용오차(기본 scaled1e-12), 실행 경로 parity는 scaled3e-12를 사용한다. 모든 모델이 독립 내부 상태 oracle를 갖는다는 뜻은 아니며 literal 상태가 선언된 fixture와 실패의 유효 publication·rollback을 별도로 검사한다. Catalog는 단계334개 정의의 명시 metadata oracle이며 독립 수학 결과와 구분한다.

Unicode code point·ASCII 경계, strict 형식·부분 scan 실패, float32와 정확한 정수/고정소수점 문자열, 동적 substring, 선택 control 값과 event 시간/순서, live receipt 재생, 기록 capacity rollback·XY 축 단위·실제 출력 참조·정상 stopReason을 포함한다. 새 control 값의 −0은 JSON 이벤트 재생을 위해 +0으로 정규화하며 slider 산술의 signed zero와 기존304개 수치 계약은 유지한다.

## 검증 게이트

| 항목 | 확인한 최종 범위 |
| --- | --- |
| 전체 unit | [최종 원본3515/3515 PASS](evidence/m13-unit-results.json) |
| 실제 standalone TypeScript | 361실행·846표본·대표 strict3개 PASS |
| UI·데이터·Worker unit | 7파일116/116 PASS; M13 자체92개·회귀24개 |
| 전체 browser | 167/167 PASS; M13 필터11/11 |
| 최종 입력 경계 browser | BOM 원본 hash·live replay·Dashboard37설정의 영향 범위3/3 PASS |
| Dashboard 설정 | 원본37행의 정확한 kind/appearance/orientation/gaugeStyle로 실제 compile/run·SSR·browser 확인 |
| 파일·데이터 작업 | bounded XLSX·CSV/JSON·편집 provenance·기록 JSON·기록 Dataset·Signal Editor의6개 작업 흐름 PASS |
| project path·오프라인 | 별도 browser4/4 및 artifact78검사 PASS |
| 성능·의존성 | 6성능 예산 PASS; dependency audit 취약점0 |
| 원본 source 승인 | 신규59행·이전16행 유지,subset364/385·missing21,전체옵션닫힘0 |
| 이전 단계 회귀·engineering 동결 | M7·catalog·M8~M12 실제 생성 실행/원본 승인·roadmap·coverage PASS. M12는 병렬 부하에서 wall 예산 실패 후 단독 재실행 PASS; [통합 기록](evidence/m13-engineering-checks.json) 참조 |
| M13 공개 배포 | 대기; 현재 공개 검증은 M12 앱0.13.0 |
| fullSimulinkEquivalenceClaimed | false |
| 실제 초보자 사용성 조사·서비스 출시 승인 | 수행하지 않음; 도메인·운영·공개 출시 게이트와 구분 |

[UI 작업 흐름](evidence/m13-ui-workflow-verification.json)에는 실제 [unit 원본](evidence/m13-ui-unit-results.json),[M13 browser11개](evidence/m13-browser-workflow-results.json),[전체 browser 원본](evidence/m13-browser-raw.json),[최종 경계3개](evidence/m13-browser-boundary-results.json)와 검토한 화면8개를 연결했다. [project browser](evidence/m13-project-browser-results.json)·[project artifact](evidence/m13-project-release-verification.json)·[root artifact](evidence/m13-root-release-verification.json)·[성능](evidence/m13-performance.json)은 각 실행 범위를 따로 기록한다.

전체167개 browser 기록은 Worker 모드 수정 후이며 BOM 원본 hash·control 숫자 정책의 최종 수정 전이다. 그 두 경계 수정 후 최종 빌드에서 영향 범위3개를 재검사했다. 전체167개를 최종 수정 뒤 다시 실행한 것으로 표시하지 않는다.

## 원본·기준값 보존

[원본 승인](evidence/m13-source-approvals.json)은 동결한 R2024b dataset와 roadmap의75행 identity/hash를 검증한 뒤59행만 승격하고 이전16행의 status/mapping을 보존했다.16개 문자열 원본행을15개 공유 정의로,37개 Dashboard 외형·설정을 공통 control/indicator/action과 기존 UI 흐름으로 대응한다. 실제 정의 수334와 원본 선택 subset364는 별도 지표다. 원본75행 전체 옵션과 MathWorks 실행 동등성은 모두 후속 검증으로 남겼다.

| 보존·검증 파일 | SHA-256 |
| --- | --- |
| [M12 registry304](baselines/m12-registry.json) | `5eb19914ff0643307bb8c5c01b22557ad935558230a217e50ff8de6ee1867a73` |
| [M13 registry334](baselines/m13-registry.json) | `a4f8cadc0e8333cdc029c64de294077d90a98ae6d1f1746753649549f4f6a0d2` |
| [실제 TS 실행](evidence/m13-verification.json) | `aa67d7976bd891f122f8a25eff41deb8b2054bc31ba660082b873e269883b598` |
| [원본행 승인](evidence/m13-source-approvals.json) | `bffe058d20baa23783f5682537787dbb9b6ac7aea06746d738b0972286af72bc` |
| [UI 작업 흐름](evidence/m13-ui-workflow-verification.json) | `b6700692a5aa60e66255b533ddc2daa93134f95213e3290acd1a0a3520312fbb` |

`update-m13-coverage.ts --check → --write → --verify`가 모두 통과했다. 이전18개 protected baseline/proof의 hash, 이전304개 정의, 원본385행과75개 배정 identity를 보존한다. 기준 snapshot은 JSON 저장 후 실제 registry와 deepEqual을 다시 확인했다.

## 보안과 선택 범위

형식·이벤트·입력 참조·자료형·단위·shape를 compiler에서 검사하고 runtime의 실제 값·문자열·기록·연산 상한도 검증했다. JSON은 깊이·개수·unsafe key를 제한하고 문자열·라벨은 React escaping을 유지한다. XLSX는 입력2MiB/해제8MiB·CRC·ZIP/XML 상한과 formula/외부 링크/DTD·entity 차단을 검사했다. CSV 수식 셀을 차단하고 BOM을 포함한 원본 바이트 hash와 파싱 내용을 구분한다. 사용자 코드·정규식·HTML·이미지 URL·임의 callback을 실행하지 않으며 action은 허용 목록만 제공한다.

계정·서버API·DB·결제·추가 개인정보 수집·시크릿·원격 파일 실행은 추가하지 않았다. native portless Dashboard 바인딩 전체, MATLAB Callback·MAT/workspace·`.xls`·macro, full Unicode case folding, C/MATLAB 전체 printf와 경고 parity, observation grid 밖 즉시 종료는 승인하지 않는다. live 조작은 선언한 두 새 정의의 이산 실행만 지원하며 정적·연속은 예약 이벤트 재생을 사용한다. M14·M15는 이 검증에 포함하지 않는다.
