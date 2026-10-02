# 수학·신호 확장 검증 기록

2026-10-03 KST · 앱0.8.0 · 엔진0.8.0-catalog · 모델 schema1. [확장 계약](catalog-contract.md)에 따라 실제 신규 연산64종과 시간 신호6종을 추가해 registry144종을 제공한다. 기존74종의 계약은 유지하며 Python 승인51종은 그대로다. 예제32개는6개 카테고리로 탐색·검색한다. 빠른 추가의 K와 dropdown의 문자 v는 제거했다.

## 실제 계산과 원자료

[독립 수치 증거](evidence/catalog-verification.json)는71개 fixture와559개 원시 샘플을 기록한다. 새64종은 정적·이산·연속3모드, 시간 입력6종은 이산·연속과 정적 거부, 기존 Divide는3모드의 추적 교정을 검사했다. 실제 생성한212개 TypeScript 프로그램을 ES2022 ESM으로 실행하고 JS와 manifest·시간축·상태·원시 결과를 비교했다. 지원 모드3종과 시간 입력 모두 strict ES2022-only 환경에서도 컴파일했다. JSON roundtrip과 원본 노드의 정의역/0제수 실패5건을 확인했다. 숫자는2e−12×max(1,|expected|), boolean·형상·키 집합은 정확히 비교하며 source 승격 fixture는 절대오차2e−12도 통과한다.

블럭별149검사와 시간 신호29검사를 추가했다. 비자명 초월함수 항등식, 배열/단위/index 상한, 큰 offset 분산·표준편차, 극단값 평균·정규화, subnormal 상수 보존, 큰 정수 실수 양자화, 계산된 음의 영 atan2, 불연속 ODE 경로 거부와 생성 코드 parity를 포함한다. 음수 절대 시각·실제 RK45 stage·Exponential overflow의 완료 표본과 오류 위치도 확인했다. 검사에서 찾은 통계 정밀도와 시간 전달 문제는 수정 후 재검증했다.

원자료385행/339이름·조건·행 번호·ID와 digest `cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7`를 보존했다. 새 승인20행은 신규19행과 기존 Divide 추적교정1행이며 미구현251행은 후속 범위다. 수평/수직 결합처럼 공유 구현과 동명 문맥은 원본행마다 추적한다. [대응표](block-coverage.md)·[확장 계획](block-expansion-plan.md)·`update-catalog-coverage --check`·`verify:coverage` 모두 일치한다.

## 작업 공간 회귀

| 검사 | 실제 결과 | 근거 |
| --- | --- | --- |
| 단위·통합 전체 | 27파일1,200/1,200 PASS, 기존1,022+신규178 | `npm test`, [전체 증거](evidence/catalog-workspace-verification.json) |
| 독립 블럭/시간 검사 | 149+29 PASS | `tests/block-expansion.test.ts`, `tests/time-sources.test.ts` |
| 신규 브라우저 | 9/9 PASS | 새5예제 실제 Worker/61샘플, 두 TS ZIP, 검색/카테고리/키보드·양테마/4폭 |
| 전체 브라우저 | 전체 실행119/120 PASS, 남은1건의 기대 검색 결과 교정 후1/1 PASS | 아래 설명 및 [전체 증거](evidence/catalog-workspace-verification.json) |
| 기존 독립 회귀 | M1/M2/M3/M4/M5/M7 모두 PASS | 성공4/15/28/18/30/89, 별도 `*-regression-on-catalog.json` |
| 반응형/SANE 관측 | 188관측 PASS, pageErrors0 | [화면 증거](evidence/catalog-design-verification.json) |
| strict typecheck/production build | PASS | 최종0.8.0 빌드 |
| 정적 파일/릴리스 계약 | 69검사 PASS | [릴리스 증거](evidence/catalog-release-verification.json) |

전체 브라우저 실행은6.7분에119건을 통과했다. 남은 기존 “더하기” 검색 검사는 정확히 Sum만 있다고 가정했지만 새 Bias의 표시명이 “값 더하기”여서 두 결과가 정상이었다. 앱을 바꾸지 않고 정확히 Sum과 Bias 두 개를 확인하도록 테스트만 교정해4.4초에1/1 통과했다. 따라서120개 검사 중 미해결 건은0이며 단일 전체 실행을120/120으로 기록하지 않는다. 최종 앱과 빌드는 이 교정 전후 동일하다. 최초 병렬 수치/화면 작업 중 테스트 harness timeout이 있었으며, 최종 전체 단위 검사는 해당 부하가 끝난 뒤47.63초에 통과했다. 파일 worker를4로 제한하고100개의4,000행 입력을 두 번 재검증하는 Python 방어적 export fixture만60초를 허용했다. 제품 실행 예산과 수치 assertion은 유지한다.

과거 M0~M7 증거와 fixture는 덮어쓰지 않는다. 기존74개 등록 계약의 파라미터·포트·모드·타입/형상/단위/주기/상태/export는 M7 기준과 모두 동일했다. 이전 실제 Python89개 oracle/13실패/31미지원 거부 및5개 패키지 검증도 통과했다. 공개 검증 기록의 source snapshot은160개 앱·패키지·스크립트·테스트·설정 파일의 hash를 포함한다.

예제 검색은 표시 제목/설명/카테고리와 정확한 예제 ID를 우선한다. FIR이 first-calculation의 일부와 잘못 일치하던 문제를 수정하고, 표시 일치가 없을 때 블럭 ID fallback을 사용한다. Enter/방향키/Escape/Ctrl+K와 IME, 다크/라이트1440·1024·390·320px, 원시 결과/내려받은 ZIP을 확인했다. [다크1440](evidence/catalog-dark-1440.png)·[다크320](evidence/catalog-dark-320.png)·[라이트1440](evidence/catalog-light-1440.png)·[라이트320](evidence/catalog-light-320.png) 네 화면을 직접 검토했다. 이 결과는 실제 초보자 조사나 접근성 인증을 의미하지 않는다.

## 성능과 보안

최종 releaseId는 `f13657522d41025074069f4e2079d17452c1e11f51eae832c578d8ddf05a8217`이다. 정적 allowlist12파일, 총1,593,689bytes의 바이트/hash를 검증했다. main은약950.62kB(gzip286.52kB), Worker286.44kB이며 main500kB chunk 경고는 남아 있다.

[성능 증거](evidence/catalog-performance.json)는 Windows11/i7-13620H/논리 CPU16·RAM63.7GiB/Node25.9.0/Chromium153.0.8010.12, 로컬 production preview1440×1000에서 다른 검사 종료 후 같은 releaseId로 측정했다. p95는 nearest-rank다. 새 context 로드1,206.0ms≤3,000, warm reload995.1ms≤2,000, Node1,000노드 compile+run292.0ms≤1,000, 실제1,000노드 취소463.7ms≤1,000이다.100노드30회 실행 뒤 최근 기록5개와 강제GC JS heap−1,061,608bytes를 확인했다.6개 계약 예산 모두 PASS이며 pageErrors0이다. UI100/1,000노드 실행→표시 p95는408.4/3,818.1ms로 화면 비용을 포함한 참고 관측이다. 로컬 Chromium 결과를 실제 모바일·공개 네트워크·전체 프로세스 메모리·다시간 안정성 결과로 안내하지 않는다.

[보안 검토](evidence/catalog-security-verification.json)는 엔진 관련26개 파일과 입력/고정 dispatch/생성 경계의 수동 검토에서 확인된 문제0건을 기록한다. [의존성 조회](evidence/catalog-dependency-audit.json)도 조회 시점0건이다. 사용자 값은 React escaped text와 JSON 데이터로 처리하며 임의 코드·함수명·네트워크/파일/OS 접근을 추가하지 않았다. registry 패키지 상한256은 실제 등록144종·정확한local-model 권한·6MiB·hash/서명/독립 지문 검사와 함께 적용한다. 계정·서버·SQL·인증 쿠키·원격 분석/개인정보 수집을 추가하지 않았다. 스캐너와 제한된 경계 검토는 전체 프로젝트·의존성·Git 이력에 알려지지 않은 취약점이 없음을 보장하지 않는다.

[공개 주소 확인](evidence/catalog-deployment-verification.json)은 calcweave.com DNS ENOTFOUND로 종료했고 공개 배포를 수행하지 않았다. 기존 도메인 소유/TXT/Pages/HTTPS·운영 사실·실제 초보자 조사·추가 브라우저/기기 확인 항목은 유지한다. 브랜치 병합은 검증된 코드 정리이며 Pages workflow는 기본 브랜치에서 명시적으로 수동 실행한다.
