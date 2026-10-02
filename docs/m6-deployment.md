# GitHub Pages 배포와 공개 확인

> 이 문서는 앱0.6.0 당시 기록입니다. 앱0.8.1의 프로젝트 경로 지원과 현재 배포 절차는 [Pages 배포 구성](pages-deployment.md), 실제 공개 결과는 [배포 검증](pages-validation.md)을 따릅니다.

앱 0.6.0 · 예정 주소 calcweave.com · 운영자 JTech-Co · 문의 jtech-bryan@proton.me

## 준비된 구성

`.github/workflows/pages.yml`은 기본 브랜치에서 수동 실행하며 잠금 의존성 설치, 취약점 조회, 단위 검사, 대응표, production build, 릴리스 무결성, 브라우저 회귀를 통과한 dist만 Pages artifact로 게시한다. 모든 GitHub 공식 Actions는 2026-10-03에 공개 태그에서 확인한 커밋 SHA로 고정한다. build에는 contents 읽기만, deploy job에만 pages 쓰기와 OIDC 권한을 준다. 저장소·DNS를 이 workflow가 자동 생성하지 않는다.

이 버전은 custom domain의 루트 `/` 전용이다. `username.github.io/CalcWeave/` 형태의 저장소 하위 경로는 지원하지 않으며 base를 변경하면 오프라인 빌드가 실패한다. 공개 루트 앱을 준비한 뒤 배포해야 한다.

## 실제 저장소·도메인 설정

대상 저장소는 https://github.com/JTech-CO/CalcWeave 이다. GitHub CLI에서 admin·push 권한은 확인했으며 connector 연결은 읽기 전용이었다. Settings → Pages → Source를 GitHub Actions로 선택한다. 소유자의 GitHub 설정에서 calcweave.com을 TXT로 검증하고 저장소 Pages의 Custom domain을 먼저 등록한 후 DNS를 연결한다. A·AAAA·www CNAME 값은 아래 GitHub 공식 안내의 현재 값을 따른다. wildcard DNS는 사용하지 않는다. 발급된 인증서가 정상일 때 Enforce HTTPS를 설정한다. 사용자 지정 workflow는 CNAME 파일만으로 Custom domain이 설정되지 않는다.

[GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [custom domain 관리](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site), [도메인 소유 검증](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages)

## 보안 정책의 실제 적용 범위

production HTML 및 정책 페이지는 script-src self, worker-src self, connect-src self, object-src none 등의 CSP meta와 no-referrer를 포함한다. React Flow의 위치·크기 표시 때문에 style-src unsafe-inline은 필요하며 script에는 허용하지 않는다. Vite 로컬 preview는 CSP HTTP header·frame-ancestors none·X-Frame-Options DENY·nosniff·Permissions-Policy를 추가한다.

GitHub Pages에서는 호스트별 `_headers` 설정 파일을 만들어도 실제 header 적용을 확인한 것으로 볼 수 없다. meta는 frame-ancestors·HSTS·nosniff·Permissions-Policy를 대신하지 않으며 Worker 자체의 응답 정책도 따로 확인한다. 공개 후 실제 response header를 기록한다. 누락을 해결해야 하는 배포 요구가 있다면 HTTP header를 관리할 수 있는 호스팅/프록시 구성을 별도로 선택해야 한다. [CSP와 Worker 정책](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy)

## 공개 전·후 체크

로컬 `npm run verify:release`는 build 최종 파일과 SHA-256 allowlist, CSP 순서, 정책·오픈소스 고지, Worker·lazy chunks, 비밀키 패턴·source map 미배포와 workflow 권한을 검사한다. `npm run verify:deployment`는 실제 공개 HTTPS·DNS·필수 경로·헤더를 읽고 로컬 최종 manifest, 모든 정적 파일과 `sw.js`의 바이트 길이·SHA-256 일치를 확인해 증거를 저장한다. 리다이렉트를 허용하지 않고 파일별 예상 크기를 넘는 응답은 읽기를 중단한다. 아직 게시되지 않았거나 이전 Service Worker가 섞인 배포는 실패한다. 이 검사는 도메인 소유 증명이나 실제 초보자 학습 결과를 대신하지 않는다.

2026-10-03 초기 조회에서 calcweave.com A/AAAA는 DNS 이름 없음으로 응답했고 대상 저장소 원격은 작업 폴더에 없다. 저장소 접근은 확인했고 현재 Pages는 legacy/main 루트 소스, custom domain 없음, https://jtech-co.github.io/CalcWeave/ 주소로 설정되어 있다. workflow는 configure-pages의 origin=https://calcweave.com 및 빈 base_path를 확인하지 못하면 artifact 게시를 차단한다. 도메인 DNS·소유 TXT·공개 주소·HTTPS가 확인되기 전에는 배포 완료로 표시하지 않는다. 문의 보유기간·호스팅 트래픽 처리 관련 정책 초안 사실 확인과 실제 F06 평가도 공개 출시 기록에 남긴다.
