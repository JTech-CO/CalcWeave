# M11 조건부 계층·반복·구조화 메시지 검증

2026-10-03 · 앱0.12.0 · 엔진0.12.0-m11 · schema1. 선택한 범위의 로컬 engineering 검증을 마무리했다. [선택 계약](m11-contract.md)과 [73행 대응표](m11-implementation-map.json)를 기준으로 신규48개 정의를 구현했고, 직전245개 정의 객체를 정확히 보존해293종이다. 예제는53개·8범주다. 원본 전체 옵션과 MathWorks 실행 parity는 이번 단계의 승인 범위가 아니다.

## 실행 증거

[독립 fixture](../tests/m11-independent-fixtures.ts)의60개 raw 모델(정의48·경계12)을 실제 parse/compile/run하고, 성공135개 모드 실행의419개 시간 표본을 literal 기대값과 비교했다. 실제 생성 TypeScript138개는 성공135개와 runtime 실패3개를 포함하며, compile 실패1개는 생성 전에 거부했다. 정적·이산·연속 각 template의 첫 프로그램3개만 개별 strict typecheck를 수행했고 모든 프로그램은 import-free AST·syntax 검사와 실제 실행을 수행했다. [최종 보고서](evidence/m11-verification.json).

출력 전체 시간축·값·manifest, 최종 held 출력과 내부 상태 memory, JSON roundtrip 및 역순 삽입을 비교한다. 유한 float64는 scaled3e-12 허용오차, typed metadata·integer code·IEEE tag·boolean·문자열은 정확 비교한다. typed-cell 비교202회는 반복 parity를 포함한 비교 횟수다. 모든 모델에 독립 내부 상태 oracle가 있다고 주장하지 않는다. 명시 literal 상태가 있는 실패 fixture는 부분 결과의 상태·memory rollback도 비교했다.

마지막 UI 오류 경로·pagination 수정 후 전체 unit은2896/2896 PASS다. 독립 fixture 이름 두 개의 충돌을 발견해 정책 키가 포함된 고유 ID로 교정했으며, 새 이름으로 runtime/compiler183개 및 실제 TypeScript 검증을 재실행했다. 첫 전체 unit의29실패는 확장된 registry 기대 개수·signed-package registry256 상한·기존 static fixture 집계 경계였고, bounded512 registry 및 실제 신규 fixture를 연결한 뒤 전체 재검사에서 해결했다.

## 실제 의미와 한계

조건부 wrapper마다 독립 상태 bank를 실행하며, 반복의 carry/reset과 매 호출 commit을 검증한다. For Each/Pixel은 위치별 bank를 보존한다. Variant는 실행 전 고정한 정의만 실행하며 inactive 계산 오류를 제외한다. 부모 wrapper 입력은 feedthrough로 계획하므로 자식 delay를 근거로 부모 feedback을 승인하지 않는다.

메시지 큐는 이전 queue의 read/dequeue 뒤 현재 batch enqueue를 수행한다. priority·arrival tie·producer sequence·overflow·bounded dedup을 보존한다. store/state/parameter writer는 lexical graph의 승인 slot과 명시 순서로만 동작한다. 부작용과 반복 호출은 accepted due에서만 발행하며 오류 시 실행 checkpoint를 되돌린다. continuous parameter-write 경계와 exact signed-zero runtime 복사도 검사했다. 기존 legacy JSON의 -0 정규화 계약을 wire bit preservation으로 확대하지 않는다.

Bus/message의 nested metadata·exact uint64·payload·빈 batch를 UI, history와 CSV에 보존한다. imported descriptor의 nested 단위도 허용 목록을 검사한다. 접근자·prototype·숨긴 속성·메시지 재중첩과 깊이/원소/저장 예산 초과를 거부한다. CSV는 JSON 데이터 열로 내보내며 spreadsheet 식 접두사를 이스케이프한다.

## 릴리스 게이트

| 항목 | 현재 기록 |
| --- | --- |
| 전체 unit/typecheck | 2896/2896 PASS · tsc PASS |
| 실제 생성 TypeScript | 138실행·419표본·3strict template PASS |
| UI unit | 27/27 PASS; 실제 자식 오류 위치 이동·선택·화면 맞추기 포함 |
| UI browser | 최초4/8 PASS 뒤8/8 PASS; 최종 진단·pagination 수정 후 M11 9/M10 7을 합쳐16/16 PASS |
| 전체 browser | 최초146개 중145 PASS; pagination 수정 후 관련16/16 PASS. 단일 전체147 PASS로 기록하지 않음 |
| source 행별 승인 | 73행 중58선택 승인(신규48·기존확장10), 이전2유지·미지원13; 현재subset293/385,missing92 |
| 디자인·성능 | 188관측/pageErrors0·6성능 예산 PASS |
| root/project artifact | 각각70검사/12파일 PASS; root2335169B,project2335419B; project browser4/4 최종 exit0 |
| 공개 배포 | M12 최종 통합 릴리스에서 확인 |
| fullSimulinkEquivalenceClaimed | false |
| verifiedPublicLaunch | false; 기존 도메인·운영 확인·초보자 관찰 게이트 별도 |

코드 내보내기 전 보안8항목을 확인했다. 계정·서버 API·DB·결제·추가 개인정보 처리는 없으며, 입력은 bounded JSON 검증을 거치고 React escaping을 유지한다. 새 nested descriptor 단위 검증과 package512 상한을 적용했고, 동적 eval·외부 코드 설치·시크릿 배포를 추가하지 않았다.

[최종 작업 공간 검증](evidence/m11-engineering-checks.json)과 [UI 마지막 검증](evidence/m11-ui-final-navigation-verification.json)에 시도별 범위와 hash를 보존했다. 관리형 preview 종료 대기를 중단한 첫 project 시도는 성공으로 합산하지 않고, 별도 서버의 마지막4/4 실행만 승인했다.
