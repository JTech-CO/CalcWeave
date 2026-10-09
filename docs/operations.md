# CalcWeave 운영 안내

대상은 앱 `0.24.0` / 엔진 `0.17.0-m16`의 무료·계정 없는 정적 호스팅·브라우저 로컬 계산 웹 베타다. 운영자는 **JTech-Co**, 문의는 [jtech-bryan@proton.me](mailto:jtech-bryan@proton.me)이다. 실제 빌드·게시·공개 파일·브라우저 관측 결과는 [검증 문서](validation.md)에 연결하고 과거 배포 횟수를 현재 상태로 누적하지 않는다.

## 정책과 데이터 처리

[이용 안내](legal/terms.md)·[개인정보와 로컬 데이터](legal/privacy.md)·[쿠키·오프라인 캐시](legal/cookies.md)가 실제 build의 정책 원문이다. [정책 생성기](../scripts/build-policies.ts)가 escape·link scheme 제한을 적용해 정적 HTML을 만든다. 이 문서는 정책을 대신하거나 확인되지 않은 보유기간·외부 서비스 조건을 확정하지 않는다.

앱에는 계정·결제·원격 모델 저장·사용자 분석·광고 추적·자동 오류 전송 기능이 없다. 모델·데이터·결과·signing private key를 운영자 서버로 보내는 기능도 없다. 사용자가 선택한 파일은 브라우저에서 처리하고 파일 전달·외부 링크·메일 앱 사용은 별도 사용자 행동이다. 접속/업데이트에는 정적 호스팅 제공자와 통신하므로 GitHub의 IP·접속 시각 등 처리와 앱의 모델 전송을 구분해 안내한다.

모델·표·주석·파일명·결과에 개인 자료가 포함되면 로컬 저장과 다운로드 파일에 남는다. 로컬 저장은 앱 자체 암호화가 아니며 공용 기기·시크릿 창·origin 변경·브라우저 저장소 정리는 사용자의 보관 조건에 영향을 준다. 새 계정/개인정보 수집/서버 API/결제를 추가하면 실제 데이터 흐름·동의·권리·보안·법률·운영 gate를 재검토한다. 현재 구조에 없는 서버 인증/DB/RLS/rate-limit을 시험했다고 주장하지 않는다.

M22 이산 제어계 분석도 브라우저 안에서만 실행한다. 현재 설정의 사본·모델 지문·물리 샘플 주기를 보고서로 보존하며 모델이나 실행 기록을 변경하지 않는다. 신규 의존성·서버 API·계정·개인정보 수집이 없으며, 하이브리드·리셋·다중 rate의 전체 폐루프는 지원 범위 밖으로 표시한다.

M23 불확실성 앙상블은 실제 Worker 실행을 순차 호출하며 공유 예산·취소를 적용한다. 전체 보고서는 현재 세션에 보관하므로 새로고침 전에 JSON으로 내려받는다. 완료한 표본 중 최근5개까지만 기존 실행 이력 정책에 연결한다. 결과만 계산해 모델을 바꾸지 않고 명시적인 표본 적용을 사용한다. 신규 서버·외부 계산 서비스·계정·개인정보 수집·의존성을 추가하지 않는다.

## 저장·백업·복구·삭제

일상적인 도식과 포함 데이터 전달은 header의 **모델 다운로드·가져오기**로 `.cw.json`을 사용한다. **작업 공간 → 백업·복구**는 현재 작업에 선택한 실행 기록을 포함해 보관하고 복구하는 기본 관리 경로다. 첫 화면에서는 백업과 복구에 집중하고, 저장 상태·복구 원본·로컬 진단은 닫힌 **저장 문제 해결**, 버전·SHA-256은 미리보기의 닫힌 **백업 검증 정보**, 삭제는 닫힌 **이 브라우저의 저장 데이터 삭제**에서 제공한다. 상세 표시를 접어도 원본 보존·복구 검증·revision 충돌 검사와 대상 검토/명시 확인의 2단계 삭제는 유지한다.

[IndexedDB](../apps/web/src/persistence.ts)에 현재 모델·이전 정상 checkpoint·읽지 못한 원본·실행 이력과 revision을 관리한다. 최근 실행은 최대5개·20MiB/200000기록이며 작업 공간 백업은26MiB다. 포함 Dataset·subsystems·dashboard·notes·모델 snapshot·결과가 파일에 들어갈 수 있다. checksum은 손상 검출이며 출처 인증·암호화가 아니다. 중요한 백업은 사용자가 접근을 관리하는 별도 위치에 보관한다.

| 상황 | 운영/사용자에게 안내할 동작 |
| --- | --- |
| quota·blocked·write failure | 자동 저장 완료로 표시하지 않는다. 현재 메모리 작업을 파일로 백업하고 기존 정상 저장본을 보존한다. |
| 다른 탭 revision 변경 | compare-and-swap 충돌을 알리고 자동 덮어쓰기·자동 병합하지 않는다. 필요한 양쪽 작업을 각각 내려받는다. |
| 손상/지원하지 않는 원본 | 원본 다운로드와 이전 유효 checkpoint 복구를 제공한다. 미확인 모델을 자동 적용하지 않는다. |
| workspace 복구 | 크기/schema/hash·모델/이력 의미를 미리 확인하고 사용자 선택 뒤 하나의 IndexedDB transaction으로 적용한다. 실패하면 이전 저장을 유지한다. |
| 로컬 삭제 | 현재 모델·checkpoint·복구 원본·이력·local diagnostics·preferences의 대상을 검토한다. IndexedDB/localStorage는 공동 transaction이 아니므로 일부 설정 삭제 실패를 알리고 재시도한다. |
| 범위 밖 자료 | 내려받은 파일·다른 기기/브라우저·정적 offline cache는 작업 공간 삭제와 별도 관리한다. |

실제 [복구/삭제 browser](../tests/e2e/m6-recovery.spec.ts)와 [persistence unit](../tests/m6-persistence.test.ts)을 유지한다. 업데이트·rollback 전에 백업/복구를 다시 확인한다. 운영자는 사용자의 로컬 자료를 원격으로 조회하거나 대신 복원할 수 없다.

## 고급 파일과 서명 확인

**작업 공간 → 고급 파일 → 서명된 모델 패키지**는 별도 채널에서 받은 공개 키 지문으로 전달 파일의 출처를 확인할 필요가 있을 때 사용하는 경로다. 일회용 서명 키·공개 키 지문은 의도된 확인 절차였으나 독립 공유 버튼과 상세 관리 정보의 기본 노출은 첫 계산에 과했다. 일반 `.cw.json` 전달에 서명이나 지문 확인을 요구하지 않고 고급 기능으로 접근을 분리한다.

새 패키지마다 메모리에 임시 키를 생성하며 개인 키는 저장·다운로드·서버 전송하지 않는다. 새로 생성하면 지문도 바뀐다. 파일의 서명이 맞아도 그 파일에 들어 있는 공개 키만으로 작성자를 신뢰하지 않는다. 별도로 확인한 지문과 대조해야 하며 작성자의 실명이나 계정을 인증하는 기능으로 안내하지 않는다. 서명 패키지의 원본 검증·버전/registry 확인·migration 검토·사본 적용은 [기술 백서](01-technical-whitepaper.md#파일서명migration-경계)의 절차를 유지한다. 과거 파일의 원본 보관과 현재 엔진 검증을 구분하며 이전 엔진과의 수치 동등성을 자동 보증하지 않는다.

## 로컬 진단과 보안 유지

[local operations](../apps/web/src/local-operations.ts)는 최대50개/16KiB의 고정 code·context·time·engineVersion만 남긴다. 모델명·값·파일명·메시지·stack·URL·메일 주소를 로그로 넣지 않고 자동 전송하지 않는다. 사용자가 내려받거나 지울 수 있다. 문의에 기본적으로 모델 파일·개인 자료를 첨부하도록 요구하지 않는다.

입력 경계는 [기술 백서의 한도](01-technical-whitepaper.md#자원-예산)와 실제 schema/typed/structured/AST/parser를 따른다. HTML 출력은 React 텍스트·정책 escape를 사용하고 모델이 eval/Function·사용자 callback·native code·모듈 URL을 실행하지 못하게 한다. 고정 WASM은 자체 byte/ABI·SHA 검사를 통과한 제한 모듈뿐이며 서명된 패키지로 임의 코드를 신뢰하지 않는다. 외부 ZIP/XML/MAT도 크기/압축해제/CRC/경로·깊이·노드 상한과 unsupported 보고를 유지한다.

의존성은 lockfile을 사용하고 실제 검증 시 `npm audit --audit-level=moderate`와 secret/license 검사 결과를 기록한다. 과거 취약점0·검사 수치를 현재 감사 결과로 반복하지 않는다. 알려진 secret pattern 검사는 모든 시크릿 부재의 증명이 아니다. 프로젝트에 확인되지 않은 license를 부여하거나 제3자 native 재배포 권리를 추정하지 않는다. 운영 계정·저장소·Pages/도메인 접근은 최소 인원·2FA·복구 수단을 별도로 관리한다.

## 배포와 업데이트

공개 웹 베타는 [GitHub Pages](https://jtech-co.github.io/CalcWeave/)이며 목표 브랜드 주소 calcweave.com은 소유·DNS·HTTPS gate가 남아 있다. [Pages workflow](../.github/workflows/pages.yml)는 기본 브랜치의 명시 `workflow_dispatch`만 게시한다. PR에는 Pages/OIDC 권한을 주지 않는다. 기본 job `contents:read`, 최종 deploy job `pages:write`/`id-token:write`를 분리하고 공식 action은 SHA로 고정한다.

커밋·push와 공개 게시를 별도로 확인한다. 공개 UI가 이전 모습이면 먼저 새 브라우저와 직접 HTTP 요청으로 `offline-manifest.json`의 앱 버전·releaseId를 확인하고, 마지막 성공 Pages 실행의 소스 commit과 대조한다.

| 구버전 UI 원인 | 확인 후 조치 |
| --- | --- |
| 공개 서버의 manifest도 구버전 | 최신 기본 브랜치로 Pages workflow를 실행한다. verify·deploy 성공 뒤 실제 CI artifact와 공개 파일의 byte/SHA를 비교한다. |
| 공개 서버는 최신이고 기존 탭만 구버전 | 앱의 **업데이트 확인 → 업데이트 적용**을 선택한다. 저장 성공 후 새 service worker를 활성화하고 상단 버전을 확인한다. |

새로고침이나 HTTP 캐시 삭제는 공개 서버에 없는 릴리스를 게시하거나 대기 중인 service worker를 적용하지 않는다. UI 갱신을 위해 모델이 보관된 IndexedDB나 사이트 데이터를 삭제하도록 안내하지 않는다.

workflow는 의존성·audit·unit·source tracking·frozen approvals·실제 TypeScript/Python/WASM·최신 지원표·빌드·release·루트browser를 검사한 뒤 configure-pages에서 실제 origin/base를 확인한다. 승인 조합은 jtech-co.github.io와 `/CalcWeave/`, calcweave.com과 `/`이다. 실제 configured base로 다시 빌드하고 해당 `dist`의 release integrity·project browser를 검사해 정적 artifact만 upload/deploy한다.

HTML/JS/Worker·정책·service worker·manifest·정적 cache는 같은 base를 사용한다. 설정되지 않은 base는 `/`이며 project base는 `/CalcWeave/`다. 여러 경로·대소문자 변형·query/fragment·percent-encoded 우회 경로를 임의 허용하지 않는다. 사용자 모델·데이터·외부 URL을 service-worker cache 대상에 추가하지 않는다.

| 로컬 검증 | 명령/준비 |
| --- | --- |
| 루트 | `npm run build`, `npm run verify:release`, 루트 production preview4173에서 `npm run test:e2e` |
| project path | PowerShell `$env:CALCWEAVE_BASE_PATH='/CalcWeave/'; npm run build`, 해당 결과에 `npm run verify:release`와 `npm run test:e2e:pages` |
| 실제 공개 파일 | `npm run verify:deployment`: HTTPS·redirect·파일 allowlist·바이트와SHA를 승인한 정확 artifact와 비교 |
| 격리 공개 browser | `npm run verify:pages:browser`: 실제 Worker·정책·scoped cache·offline·내보내기를 검증 |

base가 다른 빌드는 마지막 build가 `dist`를 덮어쓴다. 루트/프로젝트를 동시에 검사할 때 별도 source copy/workdir와 별도 port를 사용하고 환경 변수를 정리한다. repo의 열려 있는 사용자4173 서버·현재 artifact를 다른 base로 덮어쓰지 않는다. Windows/Linux의 byte 차이가 있을 수 있으므로 공개 비교 기준은 실제 게시한 CI Pages artifact이며 로컬 다른 build의 SHA로 공개 실패를 판정하지 않는다.

release manifest는 최종 static allowlist·각 byteLength/SHA·releaseId를 고정한다. service worker는 hash를 확인한 승인 static 파일만 준비하고 실패 hash·missing file이면 기존 버전을 유지한다. 사용자 저장 성공 후 업데이트를 선택하며 자동 skipWaiting으로 현재 작업을 교체하지 않는다. 이전 탭을 위한 cache 보존과 영구/무제한 cache 저장 보장은 다르다. offline 상태의 편집·계산·정책 탐색을 검사하며 첫 방문부터 offline 가능하다고 안내하지 않는다.

custom domain은 origin을 바꾸므로 이전 origin의 로컬 저장이 자동 이동하지 않는다. 전환 전에 백업을 받고 새 origin에서 복구를 확인한다. CNAME/DNS/TXT·Pages 설정을 바꾸는 작업과 코드 build를 분리한다. 목표 도메인 소유권을 검증하지 않은 상태에서 link/branding만으로 연결 완료를 주장하지 않는다.

## rollback과 장애 대응

이전 **검증된 commit**을 대상으로 앱·Worker·타깃 runtime·manifest를 통째로 재빌드해 같은 workflow로 게시한다. 서로 다른 release의 파일을 섞거나 사용자 모델/데이터를 rollback하지 않는다. 이전 엔진이 신규 모델을 읽지 못하면 원본을 보관하고 지원되지 않는 옵션을 삭제해 복구한 것처럼 처리하지 않는다.

release마다 commit·workflow run·origin/base·artifact/release identity·각 gate 결과·공개 관측을 기록한다. rollback 후 HTTPS·allowlist 전체 byte·release manifest·Worker·offline·백업/복구·새 browser를 다시 확인한다. 완료/취소/실패 어댑터 termination과 실행 partial은 이미 승인한 상태를 바꾸지 않아야 한다.

문제 보고는 고정 diagnostic·앱/engine·브라우저·재현 단계와 비개인 최소 예제를 우선 받는다. secret 유출은 접근 차단·폐기/교체·공개 기록 검토를, 개인정보 사건은 실제 영향 조사와 해당 통지/신고 판단을 수행한다. 원격 로그·모니터링·백업이 없는 것을 자동화된 운영 체계가 있다고 설명하지 않는다. 자동 재배포·예약 모니터링·메일 발송은 별도 사용자/운영 설정과 권한이 필요하다.

## 완료와 구분하는 외부 gate

| gate | 필요한 실제 확인 |
| --- | --- |
| 목표 도메인 | calcweave.com 소유/TXT·DNS·Pages custom domain·HTTPS·origin 전환/복구. |
| 문의 메일 | 운영자의 보유기간·처리 근거·메일 제공자 조건. 정책의 확인 필요 값을 운영자가 확정해야 한다. |
| novice F06 | 동의한 실제 참가자의 예제실행·값수정·오류찾기·검색/연결·백업복구·export 관찰. 자동 browser PASS로 대체하지 않는다. |
| HTTP 보안 headers | 공개 응답에서 CSP/frame-ancestors/nosniff/referrer/permissions/HSTS를 각각 관측한다. HTML meta CSP/no-referrer가 HTTP header를 설정한 것으로 간주되지 않는다. Pages에서 임의 header를 관리할 별도 hosting 구성이 필요할 수 있다. |
| 공개 운영 | 정책 접근·외부 호스트 조건·모니터링·장애/복구·계정/도메인 소유자와 권한의 실제 운영 확인. |
| 원본 동등성/권리 | R2024b 전수 옵션 inventory·원본 환경/툴박스/ABI·actual reference runtime·native toolchain·소스/재배포 권리. |

현재 무료·계정 없음·로컬 자료 구조의 해당없음 항목과 위 미확인 gate를 구분한다. `verifiedApplicationDeployment`의 PASS가 `verifiedPublicLaunch`, 실제 사용자 검증 또는 전체 Simulink 동등성 PASS를 의미하지 않는다. 실제 공개 응답 header·최신 배포 버전은 [검증 문서](validation.md)의 해당 증거를 기준으로 확인한다.
