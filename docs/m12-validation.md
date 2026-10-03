# M12 연속 수치 해석·분석 검증

2026-10-03 · 앱0.13.0 · 엔진0.13.0-m12 · schema1. M10→M11→M12를 순서대로 구현했고 M12의 선택 engineering 범위를 완료했다. 기존293개 정의를 정확히 보존하고11개를 추가해304종·61예제/9범주다. [선택 계약](m12-contract.md)·[26행 대응표](m12-implementation-map.json).

## 독립 실행

29개 raw 모델(정의11·경계18)의30개 정상 모드 실행·155개 시간 표본과5개 runtime 실패를 검사했다. 생성 TypeScript35개는 import-free 구문 검사와 실제 실행을 거쳤으며 이산·연속의 대표2개 template만 개별 strict 검사했다. M12는 정적 모드를 선언하지 않는다. 정적 template은 이전 단계 회귀에서 별도로 검사했다. [실행 증거](evidence/m12-verification.json)·[독립 fixture](../tests/m12-independent-fixtures.ts).

모든 출력의 전체 시간축·값·manifest·최종 상태/memory parity, JSON 왕복과 역순 삽입을 비교했다. 독립 수치 oracle는 fixture별 허용오차(최대2e-7)를 명시하고, 실제 TS/JSON/순서 parity는 scaled3e-12로 검사한다. boolean/tag/field/형상은 정확 비교한다. 모든 모델에 독립 내부 상태 oracle가 있다고 주장하지 않는다. literal 상태가 명시된 fixture와5개 실패는 마지막 유효 상태·이력·수송 위상 rollback도 비교한다.

공동2unknown 제약, 비선형 operating point의 A/B/C/D, 비특이/index-1 Descriptor와 초기 error/project, PID filter·ideal·clamp/back-calculation/reset, 제한에서 이탈·동시 reset/위치/속도 경계, 시간과 운송 지연의 서로 다른 해석값, zero delay·stiff 감쇠·수렴/이력 실패를 포함한다. 암시적 Euler는 실제 full/two-half Newton 풀이이며 일반 DAE나 ode15s 동등성 승인이 아니다. 첫 stiff reference의30초 wall 실패는 생산 시간 상한을 유지한 채 solver 허용오차를5e-10/5e-8로 조정했고 독립2e-7 oracle를 유지해 통과했다. 최초 제한 경계2실패는 투영/부동소수점 경계 처리로 해결했다.

## 릴리스 게이트

| 항목 | 최종 기록 |
| --- | --- |
| 전체 unit·typecheck | 3007/3007 PASS · tsc PASS |
| 실제 standalone TS | 35실행·155표본·2strict PASS |
| UI·학습 모델 unit | 17/17 PASS |
| 전체 browser | 156/156 PASS · flaky0 |
| 첫 집중 browser | 24/25; float64 exact assertion만 교정한 뒤 전체156/156 재검사 |
| project path·오프라인 | 별도 preview4/4 · exit0 |
| 디자인·성능 | 188관측/pageErrors0 · 6성능 예산 PASS |
| root/project artifact | 각각78검사·14파일; root2504659B,project2504919B |
| 원본 source 승인 | 신규12행·기존14유지,subset305/385·missing80,전체옵션닫힘0 |
| 이전 단계 회귀 | M7·catalog·M8·M9·M10·M11 실제 실행 및 M10/11/12 source검사9단계 PASS |
| 공개 배포 | 공개0.13.0 통합 릴리스: Actions verify/deploy·정확한 project artifact parity·격리 브라우저9검사 PASS |
| fullSimulinkEquivalenceClaimed | false |
| verifiedPublicLaunch | false; 도메인·운영 확인·초보자 관찰·호스트 설정 게이트 별도 |

[최종 작업 공간 증거](evidence/m12-engineering-checks.json)·[원본 승인](evidence/m12-source-approvals.json)·[독립 검토](evidence/m12-independent-review.json)·[UI 증거](evidence/m12-ui-browser-verification.json)·[이전 단계 회귀](evidence/m12-predecessor-regressions.json)에 실행 범위와 hash를 보존했다. 원본 dataset·배정 JSON·M8/M9/M10/M11 동결 증거는 변경하지 않았다.

코드 내보내기 전에 보안8항목을 점검했다. 새 입력을 bounded JSON/수식 AST/차원·반복·연산 상한으로 검사하고 React escaping을 유지한다. 계정·서버API·DB·결제·추가 개인정보 처리·동적 eval·시크릿 배포를 추가하지 않았다. dependency audit은 취약점0이며 빌드 CSP·시크릿 부재 검사도 통과했다.

## 공개 통합 릴리스

[Pages 워크플로 37104252395](https://github.com/JTech-CO/CalcWeave/actions/runs/37104252395)는 main `27e01d6fad98ae39c149c8e577ec0eede4922769`에서 verify/deploy가 성공했다. 공개 앱0.13.0·엔진0.13.0-m12·304블록을 확인했고 로컬 project artifact의14파일/2,504,919바이트와 manifest·서비스워커가 정확히 일치했다. releaseId는 `e23ce356d45b9707b06946dcb1982c4db97c8a8ceeb70c32c35ce861087264ed`다. 새 격리 브라우저의9검사에서 최초 fit·Worker 결과6·오프라인 재로딩/편집 결과10·정책 탐색·Python ZIP 데이터 parity·pageErrors0/범위 밖 요청0을 확인했다. 이 공개 검사는 새 M12 수치 예제의 직접 실행이나 Python 코드 실행을 증명하는 검사가 아니다. 각 실제 코드 실행은 앞선 로컬/CI 수치 증거를 따른다. [Actions](evidence/m12-actions-verification.json)·[배포 파일](evidence/m12-deployment-verification.json)·[공개 브라우저](evidence/m12-public-browser-verification.json)·[화면](evidence/m12-public-desktop.png).
