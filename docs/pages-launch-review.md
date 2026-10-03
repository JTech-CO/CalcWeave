# Pages 웹 베타 배포 점검 범위

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
