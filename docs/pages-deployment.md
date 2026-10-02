# CalcWeave Pages 배포 구성

앱 0.8.1 · 엔진 0.8.0-catalog · 2026-10-03

공개 베타 주소는 https://jtech-co.github.io/CalcWeave/ 이며 목표 도메인은 calcweave.com이다. 저장소 main 루트를 Jekyll로 변환하면 앱의 진입점 `apps/web/index.html` 대신 README가 게시된다. 이번 구성은 GitHub Pages의 Source를 GitHub Actions로 설정하고, 검증된 `dist`만 Pages artifact로 게시한다. 도메인 DNS나 CNAME은 변경하지 않는다.

## 경로와 범위

`CALCWEAVE_BASE_PATH`가 없으면 `/`, 프로젝트 주소에서는 `/CalcWeave/`를 사용한다. Vite의 HTML·청크·Worker와 정책 문서·Service Worker·manifest·cache scope가 같은 base를 사용한다. URL/상위 경로/다중 경로/인코딩 입력은 거부하며 배포 대상은 `https://jtech-co.github.io`+`/CalcWeave/` 또는 `https://calcweave.com`+`/`만 허용한다.

정적 캐시는 빌드 allowlist만 사용한다. 모델·사용자 데이터·임의 URL은 캐시하거나 서버로 전송하지 않는다. 다른 프로젝트의 Worker 메시지와 범위 밖 응답은 거부한다. 기존 루트 캐시와 기존 탭의 lazy chunk는 유지한다. 목표 도메인으로 이동하면 origin이 달라지므로 작업 공간을 백업한 뒤 새 주소에서 복구한다.

## 로컬 검증

```powershell
npm test
npm run verify:coverage
npm run verify:roadmap
npm run build
npm run verify:release
npm run test:e2e
$env:CALCWEAVE_BASE_PATH = '/CalcWeave/'
npm run build
npm run verify:release
npm run test:e2e:pages
Remove-Item Env:CALCWEAVE_BASE_PATH
```

프로젝트 브라우저 검증은 4174 포트를 사용하며 기본 미리보기 4173과 분리한다. `dist`는 마지막에 빌드한 경로의 산출물이므로 다른 base를 검사하기 전 다시 빌드한다. 각 검증은 `pages-*` 증거에 기록하며 이전 M0~M7/catalog 기록은 보존한다.

## 게시와 실제 확인

기본 브랜치에서 `pages.yml`을 수동 실행한다. 단위·coverage·roadmap·실제 Python/TS 수치 회귀·루트 브라우저 검증을 통과한 뒤 configure-pages의 origin/base_path를 검사한다. 해당 base로 다시 빌드하고 릴리스 및 프로젝트 브라우저 검증을 통과한 파일만 게시한다. 공식 Actions는 SHA로 고정하고 deploy job에만 Pages 쓰기·OIDC 권한을 준다. PR에는 게시 권한을 제공하지 않는다.

[GitHub 공식 custom workflow 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [Pages 설정 API](https://docs.github.com/en/rest/pages/pages#update-information-about-a-github-pages-site).

실제 게시 후 `npm run verify:deployment -- https://jtech-co.github.io/CalcWeave/`로 HTTPS·HTTP 리다이렉트·앱 HTML·정책·manifest·SW·모든 allowlist 파일 SHA-256과 비공개 파일 404를 검사한다. Linux CI artifact와 로컬 빌드 바이트가 다를 경우 게시된 workflow의 `github-pages` artifact를 workspace 아래에서 풀어 세 번째 인자로 전달한다. 검증 대상을 이전 앱으로 바꿔 일치를 만들지 않는다. CI 커밋·run·artifact와 공개 응답을 함께 기록한다.

Pages가 제공하는 실제 응답 헤더는 그대로 기록한다. CSP meta와 no-referrer가 포함되지만 meta가 frame-ancestors·HSTS·nosniff 등을 대체한다고 주장하지 않는다. 호스트에서 설정할 수 없는 헤더가 필수인 배포에는 별도 프록시/호스팅이 필요하다. 앱 게시 성공을 실제 F06 초보자 조사나 전체 옵션 동등성 완료로 해석하지 않는다.

현재 검증 결과는 [Pages 검증 기록](pages-validation.md)에 남긴다.
