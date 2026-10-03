# M14 고정 WASM·lifecycle·메시지 전달 검증

2026-10-03 · 앱0.15.0 · 엔진0.15.0-m14 · schema1. 기존334개 정의를 객체 단위로 정확히 보존하고3개 실행 정의를 추가해337종·75예제/12범주가 됐다. 선택 수치·상태·UI·성능·지원표 회귀를 포함한 engineering 검증과 source 승인을 완료했다. 전체 browser 최초172/176 및 다운로드 보안 assertion 갱신 후4/4를 구분하며, 공개 검증 버전은 M12 앱0.13.0이다. M15까지 순서대로 검증한 뒤 통합 공개 배포를 진행한다. [실행 계약](m14-contract.md)·[8행 대응표](m14-implementation-map.json).

## 실제 실행과 lifecycle

20개 raw 모델(정의3·경계17)의28개 정상 모드 실행과85개 표본을 검증했다.18개 실패 중 실제 runtime 실패4개와 정상28개를 합친32개 생성 TypeScript를 실행했다. 나머지14개 실패는 compiler 거부이며 실행 성공 수에 합산하지 않았다. 대표 정적·이산·연속 template3개를 strict ES2022로 검사하고 각 생성 프로그램의 import-free 구문·정확한 manifest·실행 parity를 확인했다. [실행 증거](evidence/m14-verification.json)·[독립 fixture](../tests/m14-independent-fixtures.ts).

전체 표본·포트·held 최종 상태·선언된 내부 memory와 lifecycle oracle를 비교했다. JSON 왕복과 모델 삽입 역순도 같은 실행 결과를 냈다. 메시지 identity·정확한 typed uint64 코드·문자열·형상·태그·lifecycle 정수는 정확 비교하며, 유한 float64 수치 oracle는 fixture의 scaled1e-12, 실행 경로 parity는 scaled3e-12를 사용한다. 저장된 `modelHash`는 실제 다시 compile한 portable 모델의 semanticKey SHA-256과 일치한다.

고정 affine의 실제 WASM 산술, 독립 누산기와 입력 피드백, rising/level reset 전후 출력·전이 수, multirate, 정상 stop·실패·취소 종료를 확인했다. 누산 reset은 현재 출력 전에 상태를 초기화하며 현재 입력은 reset hit에서도 다음 표본에 누산한다. FIFO는 held 메시지 중복 제거·실제 typed payload·zero delay 다음 due·FIFO head blocking·maxRelease·overflow 세 정책·수신 시 delay 고정·오류 rollback을 검사했다. 외부 native 환경8개는 실제 compile 진단으로 unavailable을 확인했으며 실행 성공이나 source 승인으로 세지 않았다.

## 검증 게이트

| 항목 | 확인한 최종 범위 |
| --- | --- |
| 전체 unit | [3632/3632 PASS](evidence/m14-unit-results.json) |
| 독립 runtime·compiler | runtime61/61·compiler20/20 PASS; 전체 unit과 중복되는 범위 |
| 실제 standalone TypeScript | 32실행·85표본·대표 strict3개 PASS |
| UI·history unit | [35/35 PASS](evidence/m14-ui-unit-results.json); [기존 UI 회귀73/73](evidence/m14-ui-regression-unit-results.json) 별도 |
| M14 browser 작업 흐름 | [최종9/9 PASS](evidence/m14-browser-workflow-results.json); 실제 native browser Worker·모듈 pin·lifecycle·실패/취소·재실행 |
| 전체 browser | [최초176개 중172개 PASS](evidence/m14-browser-raw.json); 다운로드 보안 assertion 갱신 후 [영향 범위4/4 PASS](evidence/m14-browser-download-boundary-results.json), 제품 소스 변경 없음 |
| 디자인·반응형 | [188관측·pageErrors0](evidence/m14-design-verification.json); 어댑터 dark/light·1440/1024/390·320px 2배 화면8개 직접 검토 |
| project path·오프라인 | [browser4/4](evidence/m14-project-browser-results.json)·[root81검사](evidence/m14-root-release-verification.json)·[project81검사](evidence/m14-project-release-verification.json) PASS |
| 성능·의존성 | [최종 단독 실행6/6예산 PASS](evidence/m14-performance.json); dependency audit 취약점0 |
| 이전 M13 실제 생성 실행 | [fresh361실행 PASS](evidence/m13-regression-on-m14.json) |
| source 승인 | 독립 대체 신규3행·subset367/385·미구현18행; native8행 unavailable·나머지5행 미승격·전체옵션닫힘0 |
| 이전 단계 지원표 회귀·engineering | M10~M14 source 승인 updater --verify·roadmap·coverage·최종 typecheck PASS; [선택 engineering 검증 완료](evidence/m14-engineering-checks.json), 최종 snapshot/PR은 별도 릴리스 기록 |
| 공개 배포 | 대기; 현재 공개 검증은 M12 앱0.13.0이며 M15 완료 후 통합 배포 |
| fullSimulinkEquivalenceClaimed | false |
| 실제 초보자 사용성 조사·서비스 출시 승인 | 수행하지 않음 |

[UI 작업 흐름](evidence/m14-ui-workflow-verification.json)은 실제 unit·browser 원본과11개 프로필을 연결한다. bundled3개는 실제 실행하고 native8개는 unavailable metadata만 확인했다. 최초 browser8/9 기록의 실패는 취소 snapshot을 앱이 의도대로 저장하지 않는 데 대한 테스트의 잘못된 기대값이었다. 제품 취소 동작은 변경하지 않고 실제 Worker cancellation의 terminate 기록과 UI 취소/재실행을 검증해 최종9/9를 얻었다. 최초 실패 원본은 별도로 보존했다.

전체 browser의 최초4개 실패는 출처 URL 문자열 데이터까지 외부 실행으로 판단하던 과거 assertion 때문이었다. 실제 import·eval/Function·fetch/XHR/WebSocket/Worker 등 실행 AST 호출을 검사하도록 테스트를 강화한 뒤4개를 재검증했다. 최초176개를 한 번에 모두 PASS한 것으로 표시하지 않는다. 성능의 첫 병렬 실행은 자동 저장5초 timeout으로 중단했으며 전체 browser 종료 후 단독 재실행에서6개 예산을 통과했다. 최종 cold P95 1279ms·warm P95 1027ms·1000노드741ms·취소383ms·retained −1095000B를 각각 실제 성능 기록과 연결한다.

## 원본·기준값 보존

[source 승인](evidence/m14-source-approvals.json)은 동결된 R2024b dataset/roadmap의8행 identity/hash를 검증하고 실제 configured fixture가 있는02-016·19-001·19-002만 독립 대체로 반영했다. 다른382행의 원본 identity·mapping·status는 M13 coverage와 동일하다.8행 전체 native 실행은 unavailable이며 전체 source 옵션과 MathWorks runtime 등가는 모두 열린 상태다. 사람의 `3*x+1` 제한 AST 수동 작성은 실제7을 얻는 별도 작업 흐름이며19-006 native interpreter 실행이나 source 승격을 뜻하지 않는다.

| 보존·검증 파일 | SHA-256 |
| --- | --- |
| [M13 registry334](baselines/m13-registry.json) | `a4f8cadc0e8333cdc029c64de294077d90a98ae6d1f1746753649549f4f6a0d2` |
| [M14 registry337](baselines/m14-registry.json) | `711fcb2062a90dcebdc4b2265f3a8660aadb3d8f2c4ede0de436a4f768ce0b40` |
| [실제 TS 실행](evidence/m14-verification.json) | `6886130299827a0d52e99533c0b0cf0ea827e27b5bceb56ca687e18fa4954f65` |
| [source 승인](evidence/m14-source-approvals.json) | `f7bf8f2a18377afd4d151b1b5bbea6e6eb72396e5c66b97c9a1a5b138c40448a` |
| [UI 작업 흐름](evidence/m14-ui-workflow-verification.json) | `2a8a78ebd197a611bacb38fa5c0de0aced7012265e7091c0e5083f144d32d8d0` |

`update-m14-coverage.ts --check → --write → --verify`가 모두 통과했다.22개 보호 원본·이전 proof/baseline의 SHA와 이전334개 정의를 보존했다. 기준 snapshot은 실제 registry와 JSON 저장 후 deepEqual을 확인했으며 현재 선언 모드는 static223·discrete315·continuous334종이다. 선언 수는 모든 연결이나 외부 native ABI 지원 수를 뜻하지 않는다.

## 신뢰·자원·권리 경계

실제 고정 WASM 두 모듈의48/121 byte literal SHA와 전체 ABI·export 순서를 검사했다. 허용된 type/function/export/code와 straight-line f64 opcode만 실행하며 import·memory·table·global·start·loop·call·host function·network·filesystem은 없다. 초기화 비용을 모듈 준비 전에 차감하고 호출·전이·고정 종료 비용, queue payload descriptor의 최대 저장량·producer 추적·상태/연산/기록 상한을 적용한다. malformed model·typed/벡터/단위 ABI·nested 상태 어댑터·임의 module byte/URL/callback은 명시 진단으로 거부한다. 모델 파라미터의 −0→+0은 기존 parseModel JSON 복사의 계약이며 동적 산술 IEEE signed zero와 기존 typed wire는 유지한다.

어댑터 카탈로그와 화면은 사용자 소스·모듈 업로드·임의 함수 실행을 제공하지 않는다. React escaping과 기존 CSP/Worker 경계를 유지하며 WebAssembly에 필요한 `wasm-unsafe-eval` 토큰과 JavaScript의 `unsafe-eval` 허용은 구분한다. 계정·서버API·DB·결제·추가 개인정보·시크릿을 도입하지 않았다. 자체 구현 author는 JTech-Co이며 프로젝트가 허용한 bundled 실행과 고정 TypeScript export 범위만 기록했다. license·외부 코드 재배포 권리는 NOASSERTION이고 확인하지 않은 MIT·MathWorks 제품 권리·native toolchain parity를 부여하지 않는다.
