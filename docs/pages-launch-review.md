# Pages 웹 베타 배포 점검 범위

앱0.13.0 · 엔진0.13.0-m12 · registry304 · 2026-10-03

대상은 무료·계정 없음·정적 GitHub Pages 호스팅·브라우저 로컬 계산 웹 베타다. 기존 `vsf-launch`·`vsf-legal`의 적용 범위를 보존하고 M12의 실제 배포/공개 기술 검증 결과를 갱신한다. 앱 게시와 서비스 전체 공개 출시 gate는 별도로 판정한다. [M12 Actions](evidence/m12-actions-verification.json)·[배포 파일](evidence/m12-deployment-verification.json)·[공개 브라우저](evidence/m12-public-browser-verification.json)가 최신 증거다. 이 기록은 법률 자문이나 종합 보안 인증이 아니다.

## M12에서 실제 확인한 범위

[workflow 37104252395](https://github.com/JTech-CO/CalcWeave/actions/runs/37104252395)는 main `27e01d6fad98ae39c149c8e577ec0eede4922769`에서 verify/deploy를 통과했다. 실제 CI unit3,007개·루트browser156개·project browser4개가 통과했다. 공개14파일/2,504,919바이트·manifest·SW는 로컬 최종 `/CalcWeave/` artifact와 byte/SHA-256이 일치한다. releaseId는 `e23ce356d45b9707b06946dcb1982c4db97c8a8ceeb70c32c35ce861087264ed`다. 로컬 `/` artifact와 공개 project artifact는 다른 release identity로 기록한다.

새 격리 브라우저의9개 검사에서304개 라이브러리/지원표·0.13.0 badge·최초 fit·기본 Worker 결과6·정책4페이지·scoped cache·오프라인 재로딩/편집 결과10·정책 탐색·Python ZIP 내용 parity·pageErrors0/범위 밖 요청0을 확인했다. 이 공개 검사는 새 M12 수치 예제의 직접 공개 실행이나 Python 코드 실행을 확인하는 검사가 아니다. 실제 새 수치 실행과 타깃별 Python 실행은 [M12 수치 검증](m12-validation.md)·[독립 TypeScript 실행](evidence/m12-verification.json)·[별도 타깃 회귀](evidence/m12-predecessor-regressions.json)에 연결한다.

| 항목 | 적용 범위와 현재 판정 |
| --- | --- |
| 쿼리·인젝션 | 원격 SQL/NoSQL·서버 셸 실행 없음. 수식은 bounded AST, 모델은 승인 registry의 선언형 입력이다. 서버 쿼리 검사는 현재 구조에 해당 없음. |
| 출력·XSS | 사용자 이름/메모/수식은 React 텍스트로 표시한다. 정책 생성기의 HTML escape와 링크 scheme 제한을 유지한다. 로컬/CI 결과 escaping 회귀와 최종 빌드 검사를 통과했다. |
| 시크릿 | M12의 최종 built-secret/CSP 검사와 npm 취약점0 기록은 [작업 공간 증거](evidence/m12-engineering-checks.json)를 따른다. M9와 이전0.8.1의 패턴 검사 수치는 아래 당시 기록으로 보존하며 M12 재검사 수치로 바꾸지 않는다. 알려진 패턴 검사를 모든 시크릿 부재의 증명으로 해석하지 않는다. |
| 인증·인가 | 계정·세션·원격 모델/관리 API가 없어 서버 소유권/RLS 검사는 해당 없음. Pages 쓰기·OIDC는 기본 브랜치 deploy job에만 제공하며 이번 두 job의 성공을 기록했다. |
| 입력·자원 | bounded 모델/데이터/실행/패키지 경계를 유지한다. M12 수치 입력·차원·Newton 반복·history·연산 상한은 선택 계약과 실제 수치 증거를 따른다. 공개 검사는 redirect·본문 크기·정적 자산 digest를 확인했다. |
| 호출 제한 | 로그인·인증코드·유료 API·이메일 자동 발송이 없어 관련 서버 rate-limit은 해당 없음. Worker 취소·실행 예산의 로컬/CI 회귀와6개 성능 예산은 별도 증거로 통과했다. |
| 쿠키·HTTPS·헤더 | 앱 쿠키/추적 SDK 없음. 공개 HTTPS·HTTP→HTTPS·Set-Cookie 없음·private4경로404를 확인했다. HSTS는 `max-age=31556952`다. CSP/nosniff/frame/referrer/permissions HTTP헤더는 관찰되지 않았고 CSP/no-referrer meta와 구분한다. |
| DB 권한 | 원격 DB·Storage가 없어 서버 권한/RLS 검사는 해당 없음. IndexedDB·백업/복구/삭제는 로컬/CI 브라우저 회귀를 따르며 공개 검사는 격리된 저장소만 사용했다. |
| 의존성 | 잠금 파일을 유지하고 실제 CI npm audit에서 알려진 취약점0을 확인했다. 공식 Actions는 SHA로 고정한다. |
| 개인정보·정책 | 모델/데이터/결과/서명용 개인키는 앱 서버로 전송하지 않는다. GitHub 호스팅 통신과 외부 메일 앱은 별도 제공자 범위로 안내한다. 정책4페이지의 실제 HTML200·CSP meta·앱 범위 navigation을 확인했다. 문의 메일 보유/처리 정책의 확정은 아래 미확인 항목이다. |
| 운영 | 고정 필드 로컬 진단·수동 백업/해시 복구/원본 다운로드·충돌 보호를 유지한다. 원격 모델 저장/유료 API가 없어 서버 DB 자동 백업·비용 알림은 해당 없음. 외부 모니터링·호스트 설정 등 후속 운영 확인은 자동 공개 검증의 PASS에 포함하지 않는다. |

## 판정과 열린 출시 항목

기술적 앱 배포는 최종 main CI·공개 artifact parity·격리 브라우저9개 검증을 근거로 PASS다. `verifiedApplicationDeployment=true`와 `verifiedPublicLaunch=false`를 함께 유지한다. 서버 계정·원격DB·유료 API 관련 해당없음 항목을 목표 도메인·사용자 관찰·운영 정책의 미확인 항목과 합치지 않는다.

목표 도메인 calcweave.com의 DNS·소유/custom domain, 실제 F06 초보자 관찰, 문의 이메일 운영자의 보유/처리 정책은 완료되지 않았다. 자동화는 F06 관찰 연구의 증거가 아니며 메일의 미확정 값을 지어내지 않는다. Pages에서 임의 HTTP 보안 헤더를 관리할 수 있는 별도 호스팅 구성, 정책 링크의 직접 상시 노출과 외부 모니터링도 후속이다. 계정·개인정보 수집·원격 저장·결제를 추가하기 전 해당 흐름과 정책을 다시 확인한다.

공개 artifact는304개 정의·61개 예제/9범주를 포함한다. source subset305/385·미구현80행은 별도 지표다. M10/M11/M12의 전체 원본 옵션과 MathWorks 실행 동등성은 열린 후속이며 일반 DAE·ode15s·MATLAB 선형화·자동 튜닝의 전체 대응을 주장하지 않는다. 기술적 배포 PASS를 원본 전체 옵션·MathWorks parity·전체 서비스 출시 승인으로 확대하지 않는다. [공개 배포 기록](pages-validation.md)·[실제 화면](evidence/m12-public-desktop.png).

## 이전 M9 0.10.1 배포 점검 기록

아래는 당시 원문 기록이다. ‘최신’·‘현재’는 M9 확인 시점을 뜻하며 당시 검사 수치와 실패/교정 기록을 보존한다.

앱0.10.1 · 엔진0.10.0-m9 · registry211 · 2026-10-03

`vsf-launch`와 `vsf-legal`의 실제 코드/배포 대조를 적용했다. 대상은 무료·계정 없음·정적 호스팅·브라우저 로컬 계산 웹 베타다. 앱 배포 검증과 서비스 전체 공개 출시 게이트는 각각 기록한다. 현재 실제 공개 검사 결과는 [M9 배포 검증](evidence/m9-deployment-verification.json)과 [M9 공개 브라우저 검증](evidence/m9-public-browser-verification.json)에 남긴다. 이전0.8.1의 [배포 증거](evidence/pages-deployment-verification.json)와 [브라우저 증거](evidence/pages-public-browser-verification.json)는 역사로 보존한다. 이 기록은 법률 자문이나 종합 보안 인증이 아니다.

| 항목 | 확인 및 적용 범위 |
| --- | --- |
| 쿼리·인젝션 | 원격 SQL/NoSQL·서버 셸 실행 없음. 수식은 제한 AST, 모델은 승인 registry의 선언형 입력이다. |
| 출력·XSS | 사용자 이름/메모/수식은 React 텍스트로 표시한다. repository 정책 생성기는 HTML escape와 링크 scheme 제한을 유지한다. |
| 시크릿 | 이전0.8.1의 앱35/스크립트28파일·Git source 이력1,837,165바이트 검사를 보존한다. M9 작업 공간은 packages54/앱35/스크립트33파일에서 medium 이상0 및 npm 알려진 취약점0을 기록했고 최종 artifact parity를 확인했다. 알려진 패턴 검사가 모든 시크릿 부재를 증명하지는 않는다. |
| 인증·인가 | 사용자 계정·세션·원격 모델/관리 API가 없어 서버 소유권/RLS 검사는 해당 없음. Pages 쓰기·OIDC는 기본 브랜치 deploy job에만 제공한다. |
| 입력·자원 | 기존 모델/데이터/실행/패키지 한도를 유지한다. base는 안전한 단일 경로, 배포 주소는 두 승인 조합만 허용한다. 공개 검사는 redirect·본문 크기·정적 자산 digest를 검사한다. |
| 호출 제한 | 로그인·인증코드·유료 API·이메일 자동 발송이 없어 관련 rate-limit은 해당 없음. Worker 취소·실행 예산 회귀는 통과했다. |
| 쿠키·HTTPS·헤더 | 앱 쿠키/추적 SDK 없음. CSP meta/no-referrer 유지. 실제 HTTPS·리다이렉트·호스트 헤더·Set-Cookie와 private path404는 공개 응답으로 별도 기록한다. |
| DB 권한 | 원격 DB·Storage 없음. 로컬 IndexedDB와 백업/복구/삭제는 브라우저 회귀 검사로 확인했다. |
| 의존성 | 잠금 파일 유지, 확인 시 npm 알려진 취약점0. 공식 Actions SHA 고정. |
| 개인정보·정책 | 모델/데이터/결과/서명용 개인키는 앱 서버로 전송하지 않는다. GitHub 호스팅 통신과 외부 메일 앱은 별도 제공자 범위로 안내한다. 정책4페이지·운영자·연락처·버전·적용일·개정 이력은 공개 파일에 포함된다. |
| 운영 | 고정 필드 로컬 진단 최대50개, 수동 백업/해시 복구/원본 다운로드·충돌 보호를 유지한다. 원격 모델 저장/유료 API가 없어 서버 DB 자동 백업·비용 알림은 해당 없음. |

M9 공개 앱의 기술 검사는 최종 CI verify/deploy 성공·공개 artifact parity·격리 브라우저9개 검증을 근거로 PASS다. 목표 도메인 calcweave.com의 DNS·소유 확인, 실제 F06 초보자 조사, 문의 이메일 운영자의 보유/처리 정책은 아직 완료가 아니다. 문의 메일의 미확정 값은 지어내지 않고 기존 정책에 확인 필요로 표시했다. 계정·개인정보 수집·원격 저장·결제를 추가하기 전 해당 흐름과 정책을 다시 검토해야 한다.

Pages에서 임의 HTTP 보안 헤더를 설정할 수 없으며 정책 접근은 상시 지원·릴리스 버튼의 정책 메뉴에 있다. 필수 HTTP 헤더를 관리할 수 있는 호스팅 구성, 정책 링크의 직접 상시 노출, 메일 운영 정책 확정과 외부 모니터링은 후속 운영 작업이다. 이런 미확인을 전 서비스 출시 PASS로 바꾸지 않으며 `verifiedPublicLaunch`는 false를 유지한다.

현재 공개 앱은211개 정의와39개 예제/6범주를 제공하며 M9 preset15개는 공유 설정이다. source subset211행은 registry 수와 다른 지표이며 원본58행의 전체 옵션은 모두 열린 후속이다. 배포 PASS로 원본 전체 옵션/MathWorks bit parity 또는 서비스 전체 출시를 승인하지 않는다.

0.10.1은 버전 표시·초기 캔버스 측정 경합·자동 저장 상태 레이아웃의 patch이며 기존 수치·registry/source 범위를 바꾸지 않는다. 초기0.10.0 [배포](evidence/m9-initial-release-deployment-verification.json)·[공개 브라우저](evidence/m9-initial-release-public-browser-verification.json) 증거와 [최초0.10.1 실패 기록](evidence/m9-presentation-patch-failed-attempt.json)도 보존한다. 최신 공개 artifact와9개 브라우저 검증의 성공을 목표 도메인/F06/문의 정책/전체 서비스 출시 승인으로 확대하지 않는다.

[두 번째 게시 전 실패](evidence/m9-late-layout-failed-attempt.json)와 [저장 상태 레이아웃 교정](evidence/m9-save-status-layout-correction.json)을 별도로 보존한다. 현재 상태만 DOMtext/접근성으로 전달하며 숨은 측정 문구로 저장 readiness가 통과하지 않도록 한다.
