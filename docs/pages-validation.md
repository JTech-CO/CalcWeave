# CalcWeave Pages 경로 검증

앱 0.8.1 · 엔진 0.8.0-catalog · 2026-10-03

이번 변경은 수치 엔진을 유지하면서 프로젝트 경로 배포와 후속 로드맵을 추가한다. 이전 M0~M7 및 catalog 검증 기록은 당시 증거로 보존한다.

## 완료한 사전 검증

- 전체 typecheck PASS, 단위 테스트 27파일/1,222개 PASS.
- 실제 생성 SW를 실행하는 오프라인 테스트 39개 PASS. 루트·프로젝트의 범위·다른 클라이언트·자산 digest·이전 lazy chunk를 검사했다.
- coverage/roadmap PASS: 385행·339개 이름·134개 부분 지원·251개 미구현, 누락/중복0. source와 기존 승인 상태는 변경하지 않았다.
- npm audit 확인 시 알려진 취약점0. 패턴 스캐너 앱35파일·스크립트28파일에서 medium 이상 발견0. 패턴 검사를 종합 안전 인증으로 해석하지 않는다.

루트 브라우저120/120(5.9분), 프로젝트 경로4/4(11.8초) PASS. 프로젝트 첫 시도의 정책 fetch 검사를 실제 오프라인 탐색으로 바로잡고 최종4건을 재검사했다. 실제 GitHub Actions 게시와 공개 HTTPS·정적 파일 및 브라우저 결과는 아래에 기록했다. 앱 게시 성공과 목표 도메인 소유권·실제 초보 사용자 조사·문의 메일 운영 정책 확인은 별도 항목이다.

## 실제 GitHub Pages 게시

[workflow 37067058963](https://github.com/JTech-CO/CalcWeave/actions/runs/37067058963)는 커밋 `05834ff2c762605958e370f1a0464a4a5bb61962`에서 verify/deploy 모두 성공했다. Ubuntu의 Node24.21.0·Python3.14.7에서 단위1,222개, 루트 브라우저120개(5.7분), 프로젝트 브라우저4개(11.3초), Python89fixture/13실패/31미지원 타깃, catalog71fixture/559샘플/212실제TS프로그램을 확인했다.

Pages 설정은 workflow, HTTPS 강제, custom domain 없음이다. https://jtech-co.github.io/CalcWeave/ 는 앱0.8.1을 게시한다. 공개 HTTPS200·HTTP→HTTPS·정책4페이지200·private4경로404·SW digest·manifest 및 모든12정적파일의 바이트/SHA-256이 로컬 최종 프로젝트 빌드와 일치했다. 배포 releaseId는 `582afe7a0813a0b53a76d92adf4287cf6cdc5e6b866a697ff76fb34b264db26a`, 정적파일 총1,595,586바이트다. CI artifact를 별도 다운로드해 검증 대상을 바꿀 필요 없이 동일한 빌드임을 확인했다.

공개 응답의 HSTS는 `max-age=31556952`, Set-Cookie 없음이며 CSP/nosniff/frame/referrer/permissions HTTP헤더는 관찰되지 않았다. CSP meta와 no-referrer meta는 HTML에 포함된다. 임의 헤더 적용을 완료한 것으로 표시하지 않는다. [Actions 증거](evidence/pages-actions-verification.json), [공개 파일 검증](evidence/pages-deployment-verification.json)을 참고한다.

## 실제 공개 브라우저

사용자의 브라우저 저장소를 사용하지 않는 새 Chromium context에서9개 검증(5.68초)을 통과했다. 실제144개 라이브러리·앱0.8.1 지원표·Worker 기본 결과6을 확인하고, 공개 정책4개의 정적 HTML200 및 탐색을 확인했다. scoped SW/cached files가 모두 `/CalcWeave/` 아래였으며 오프라인 재로딩 뒤 gain5로 바꾼 실제 결과10, 정책 탐색, Python lazy module과 완전한 실행ZIP의 모델/manifest/내장IR/hash/전체 기대출력이 일치했다. Python 코드는 이 브라우저 검증에서 실행하지 않았으며 실제 Python 실행 검증은 위CI89fixture로 구분한다. pageerror0·앱 범위 밖 요청0. [공개 브라우저 증거](evidence/pages-public-browser-verification.json)와 [실제 화면](evidence/pages-public-desktop.png)을 보존한다.

기술적 앱 배포 검사는 PASS이며 전 서비스 출시 게이트를 소급 완료하지 않는다. 문의 이메일 정책·목표 도메인·실제 F06 조사는 별도다. [점검 범위](pages-launch-review.md)의 해당없음/미확인 항목과 실제 호스팅 헤더 한계를 구분한다. 이전 M0~M7/catalog 증거는 보존했고 로컬 기본4173 미리보기의 루트 빌드도 복원했다.
