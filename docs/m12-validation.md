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
| 공개 배포 | M12 통합 릴리스로 확인 예정 |
| fullSimulinkEquivalenceClaimed | false |
| verifiedPublicLaunch | false; 도메인·운영 확인·초보자 관찰·호스트 설정 게이트 별도 |

[최종 작업 공간 증거](evidence/m12-engineering-checks.json)·[원본 승인](evidence/m12-source-approvals.json)·[독립 검토](evidence/m12-independent-review.json)·[UI 증거](evidence/m12-ui-browser-verification.json)·[이전 단계 회귀](evidence/m12-predecessor-regressions.json)에 실행 범위와 hash를 보존했다. 원본 dataset·배정 JSON·M8/M9/M10/M11 동결 증거는 변경하지 않았다.

코드 내보내기 전에 보안8항목을 점검했다. 새 입력을 bounded JSON/수식 AST/차원·반복·연산 상한으로 검사하고 React escaping을 유지한다. 계정·서버API·DB·결제·추가 개인정보 처리·동적 eval·시크릿 배포를 추가하지 않았다. dependency audit은 취약점0이며 빌드 CSP·시크릿 부재 검사도 통과했다.
