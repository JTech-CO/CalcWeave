# CalcWeave 검증 상태

현행 소스는 앱 `0.18.0` · 엔진 `0.17.0-m16`이다. 이 문서는 구현의 검증 범위와 배포 증거를 연결한다. 과거 단계의 수치·실패 기록은 `evidence/`에 보존한다. M16의 공개 결과와 보조 기능·도움말 정리의 검사는 별도로 기록한다.

## M17 도식 수식과 학습 · 로컬 검증

앱 `0.18.0`에 수식·학습 탭과 기존 예제를 활용한 학습 가이드3개를 추가했다. 계산 엔진·schema·registry337개와 예제75개는 유지한다. [검증 기록](evidence/m17-verification.json)은 수식27개·학습20개의 새 회귀, 전체 단위 검사 **3,956/3,956 PASS · 72개 파일**, 타입 검사와 실제 프로덕션 빌드를 기록한다.

실제 Chromium에서 새 기능 **7/7 PASS**와 기존 기능 **9/9 PASS**를 확인했다. 수식 항→단일 블록 선택·값 변경, 세 실제 Worker 실행, 예상/설명의 값 편집·결과 탭 왕복 유지, invalid draft·배열·잘못된 연결의 처리, 내부 스크롤·테마·키보드·텍스트 확대를 검사했다. 기존 검색·범주·예제·모달 focus·지연 초기 fit·autosave·Space·좌우 배치도 확인했다. 첫 실행의 테스트 가정2개는 숫자 오류의 blur/commit 시점과 실제 테마 버튼 이름에 맞춰 교정했으며 최종 실패는0개다.

[루트 경로 릴리스 검증](evidence/m17-root-release-verification.json)은 실제 빌드의95개 검사·17개 정적 자산의 해시·범위·오프라인 목록·OG metadata를 확인했다. 현행 문서10개와 폐기 문서44개의 재도입 방지도 검사했다. M17의 라이선스·릴리스 보고서는 [별도 경로](evidence/m17-licenses.json)에 두어 과거 M16 기록을 덮어쓰지 않는다. 이 단계에서는 공개 게시를 수행하지 않았다. 실제 초보자 학습성 관찰, Firefox/Safari, 전체 symbolic 식과 Simulink 전수 동등성은 미검증이다.

## 화면 캡처 보관

`evidence/`의 PNG는 화면 검증 도구가 저장한 산출물이며 앱 실행·계산·배포의 입력으로 사용하지 않는다. 2026-10-04에 과거 단계와 이전 버전의 반복 캡처 2,205개를 정리하고, 앱 `0.17.3`의 최종 화면 검증 18개와 공개 화면 1개를 유지했다. 이후에도 현행 버전의 최종 검증 화면을 보관하고 대체된 캡처는 정리한다.

수치 검증·승인·실패 기록과 과거 JSON의 해시 목록은 원문 그대로 유지한다. 그 안의 이미지 경로와 해시는 기록 당시의 캡처를 가리키며, 정리된 이미지가 현재 작업 폴더에 없을 수 있다. Git에 추적된 과거 캡처는 정리 전 commit `ed060448e154636b0d2202dfbcc96ffff8ec0c85`에서 복구할 수 있다. 최신 화면은 [최종 화면 기록](evidence/library-navigation-ui-verification.json)과 [공개 검증](evidence/library-navigation-public-browser-verification.json)에 연결되어 있다.

## 지원 감사

원자료 385행·339개 이름을 원본 ID·행 번호·조건·identity SHA로 대조했다. registry 정의 337개, 모델 widget 계약 5개, 미지원 목적 계약 10개는 별도로 관리한다. 같은 미지원 목적의 여러 접근점을 합치지 않아 미지원 원자료 행은 18개다.

[대응표](support-matrix.md)와 [기계 판독 JSON](support-matrix.json)은 385행의 결정·설정·자료형·실행 방식·타깃·외부 조건·담당자·검증 버전을 기록한다. 선택 범위의 기존 대응은 367행이며 원본 전수 옵션·MathWorks 수치 동등성 완료는 0행이다. 모든 385행의 공식 전수 옵션 inventory는 미검증이다. 251행은 실제 fixture에 연결된 276개 설정 profile을 갖고, 나머지 선택 116행은 원본 항목별 옵션 profile이 아직 직접 연결되지 않았음을 표시한다. 등록 파라미터의 모든 enum 값·조합을 실행 승인으로 계산하지 않는다.

[M16 감사 기록](evidence/m16-verification.json)은 25개 보호 자료·337개 이전 정의·385개 identity·352개 계약·실제 profile selector를 검증한다. 컴파일러 정규화가 있는 48개 profile은 동결 raw fixture SHA와 실제 실행 모델 semantic SHA를 추가 대조했다. Add·Subtract·Pi·Zero의 네 고정 설정은 [독립 기대값·실제 TypeScript 재검증](evidence/m16-preset-verification.json)을 별도로 연결했다. 추적 완료를 전체 실행 동등성으로 표시하지 않는다.

## M16 실제 실행과 화면

| 검사 | 확인 범위와 근거 |
| --- | --- |
| 단위 검사 | 최종 전체 3,883/3,883 PASS. [최종 원본](evidence/m16-unit-results.json). 추가 감사 검사 전 3,882개 결과는 [초기 원본](evidence/m16-initial-unit-results.json)에 따로 보존한다. |
| 지원 화면 | 최종 8/8 PASS. 검색·분류·타깃·동명 Display·preset·미지원·JSON·모델 불변·모달 단축키·키보드 목록 탐색과 8개 화면/테마/글자 확대 조건을 확인했다. [화면 기록](evidence/m16-support-ui-verification.json)·[실제 브라우저 결과](evidence/m16-support-browser-results.json). 최종 공개 대응표도 아래 공개 검사에서 재확인했다. |
| 생성 Python | 현재 엔진에서 실제 프로그램 142개·정상 256표본. [현재 실행](evidence/m15-python-regression-on-m16.json). Python 69개 정의의 선택 구성만 승인한다. |
| 생성 WASM | 현재 엔진에서 실제 module/runner 128개. [현재 실행](evidence/m15-wasm-regression-on-m16.json). WASM 16개 정의의 유한 실수 scalar DAG 선택 구성만 승인한다. |
| 상호운용·패키지 | [실제 통합 실행](evidence/m15-regression-on-m16.json): MAT/SLX/MDL 3개 선택 분석 경로, 원본 bytes/재분석, native JSON, 서명 검증·명시 검토가 필요한 8개 과거 엔진 프로필. |
| TypeScript 회귀 | 기존 M7/catalog/M8~M15 검증기를 현재 엔진에서 실제 실행했다. [문자열·데이터](evidence/m13-regression-on-m16.json), [어댑터·상태](evidence/m14-regression-on-m16.json), 다른 단계의 현재 실행 증거도 `evidence/`에 보존한다. |
| 원자료·승인 | coverage·원 planning JSON·M10~M14 승인 재검증 PASS. 원 dataset·planning JSON·보호 baseline/원 승인 증거 25개의 SHA를 보존한다. |
| 성능 | 로컬 전용 preview에서 6개 예산 PASS. cold load p95 1,211ms·warm load p95 1,005ms·1,000노드 compile/run p95 118ms·취소 p95 503ms·반복 실행 후 heap 증가 예산 PASS·page error 0. [원본 측정](evidence/m16-performance.json). 공개 네트워크 속도나 실제 초보자 관찰 결과로 해석하지 않는다. |
| 빌드·release | root와 `/CalcWeave/` 경로 각각 91검사 PASS, asset 각각 16개. root 6,760,243bytes, project 6,760,513bytes. [실제 root artifact](evidence/m16-root-release-verification.json)·[실제 project artifact](evidence/m16-project-release-verification.json). |
| 프로젝트 경로 브라우저 | 최종 4/4 PASS, skipped/flaky/error 0. 경로·오프라인 scope·Worker·Python ZIP 로딩을 확인했다. [실제 결과](evidence/m16-project-browser-results.json). 처음 npm 실행이 브라우저 시작 전에 정체된 기록은 [별도 실행 기록](evidence/m16-project-browser-stalled-execution.json)으로 보존했고, 자체 프로세스를 정리한 뒤 직접 Playwright로 재실행했다. 계산 assertion 실패나 통과로 계산하지 않는다. |
| 의존성 | 고정 lockfile. 확인 시 npm audit의 알려진 취약점 0개. 입력·자원 상한·React escaping·허용 목록·임의 코드 실행 차단을 유지한다. |

지원 창에서 뒤쪽 공통 CSS가 의도한 폭을 덮던 문제를 교정했다. 최종 실제 폭은 1440px 화면에서 1040px, 1024px에서 992px, 작은 화면에서 viewport−16px이며 브라우저 assertion과 화면으로 확인했다. 교정 전 8개 기능 검사 결과는 이전 폭의 검사로 구분한다.

[로컬 종합 검증](evidence/m16-engineering-checks.json)은 위 결과와 보호 자료 SHA를 연결한다. 전체 브라우저 197개는 최종 공개 CI에서 모두 통과했다. 로컬 집중 8개와 프로젝트 경로 4개 결과는 별도 기록이며, 로컬 단일 197개 실행을 주장하지 않는다.

## 재현 명령

Node.js 24와 Python 3.14를 사용하는 CI가 최종 배포 검증 환경이다. 로컬은 Node.js 25.9.0·Python 3.14·Windows Chromium에서 검사했다. Firefox·Safari·실제 초보자 관찰은 이 자동 검사의 범위가 아니다.

```sh
npm ci
npm run typecheck
npm test
npm run verify:coverage
npm run verify:roadmap
npm run verify:docs
npm run verify:m7
npm run verify:catalog
npm run verify:m8
npm run verify:m9
npm run verify:m10
npm run verify:m11
npm run verify:m12
npm run verify:m13
npm run verify:m14
npm run verify:m15
npm run verify:m16
npm run build
npm run verify:release
npm run test:e2e
```

`verify:m16`는 선행 실제 M14/M15 타깃 보고서를 확인한다. 공개 매트릭스는 불변 원 승인/실행 근거를 참조하고, 매번 생성 시각이 달라지는 fresh 보고서의 SHA는 별도 검증 기록에 담는다. 따라서 CI 재실행만으로 공개 데이터가 바뀌지 않는다. 실제 지원 변경은 `scripts/generate-support-matrix.ts --write`로 명시 재생성한 뒤 검토한다.

## 공개 배포와 문서 정리

M16 앱 `0.17.0` / 엔진 `0.17.0-m16`의 공개 배포 검사를 완료했다. [운영 안내](operations.md)의 기본 브랜치 수동 workflow와 정확한 artifact 검증을 따른다. 공개 주소는 [CalcWeave](https://jtech-co.github.io/CalcWeave/)다. 기술적 앱 배포와 목표 도메인·정식 출시·실제 novice 관찰·원본 옵션 동등성은 별도 판정한다.

M16 구현 검사 후 중복된 M0~M15 계약·진행 기록과 이전 계획·배포 MD 44개를 현행 기술·디자인·운영·검증·지원 문서로 통합했다. M16부터 현행 검증 문서를 사용한다. 원본 dataset, 실제 정책, 보호 baseline MD/JSON, 기계 판독 계획과 실패/수치/배포 증거 JSON은 보존했다. 삭제 파일의 정확한 이전 SHA와 보존 상태는 [정리 기록](evidence/document-consolidation-manifest.json)에 기록했다. 과거 문서가 필요한 경우 [정리 전 Git 기록](https://github.com/JTech-CO/CalcWeave/tree/9f314bbb2c41d4e6b087c90b9da435e61a850996/docs)을 확인한다.

원본의 C/C++·MATLAB·S-function 실행 환경, 원본 전수 옵션 inventory와 수치 대조, 편집한 native 모델 export는 미승인/미검증으로 유지한다. 계정·원격 DB·결제·개인정보 수집을 추가할 때는 현재 로컬 베타의 해당없음 항목을 그대로 재사용하지 않는다.

## M16 공개 결과

[Actions 37128098577](https://github.com/JTech-CO/CalcWeave/actions/runs/37128098577)는 main `736603c7988699e2001cb102d7f1ca64fa1c4a55`에서 단위 3,883/3,883·전체 브라우저 197/197·프로젝트 경로 4/4, 모든 단계 회귀와 release 91검사를 통과한 뒤 게시했다. 공개 asset 16개 및 service worker를 로컬에서 검증한 프로젝트 경로 artifact와 byte/SHA로 대조했다. release ID는 `43f40da7eb7e5cb4bb6c6e890e550868621fb3d7019bf42eb4c6046f1a93bbef`다.

공개 기본 9검사는 초기 fit·Worker·오프라인 편집·정책·Python ZIP을 확인했다. 추가 21케이스는 M16 대응표 8케이스와 다운로드한 Python의 실제 격리 실행, WASM binary/runner의 실제 브라우저 계산, 서명된 migration 검토·undo, MAT/SLX/MDL 선택 분석 경로·원본 보존·변조/코드 거부·반응형 조건을 확인했다. 대응표 SHA는 `e5d706d7fc127081fc8470189b3f580d03ed61ba938a8168a5aa8e3730bb875e`다. 로컬 지원 UI 결과는 문서 헤더 갱신 전 데이터였으며, 이 공개 검사는 최종 데이터에 대한 결과다.

[공개 결과](evidence/m16-public-release.json)·[CI 원본 요약](evidence/m16-actions-verification.json)·[정확한 파일 검사](evidence/m16-deployment-verification.json)·[공개 기본 브라우저](evidence/m16-public-browser-verification.json)·[공개 추가 브라우저](evidence/m16-public-feature-browser-results.json)·[로컬 종합 검증](evidence/m16-engineering-checks.json). 공개 앱의 빌드 커밋은 위 main SHA이며 이후 증거 문서 병합은 동일 artifact를 다시 게시하지 않는다. 기술적 앱 배포는 PASS이고 calcweave.com 소유/DNS·실제 초보자 관찰·정식 출시·원본 전수 옵션/MathWorks reference 동등성은 별도 판정이다.

## 보조 기능 정리

앱 `0.17.1`은 계산과 관계가 먼 기능의 노출을 조사한 뒤 정리한 화면 변경이다. 공개 키 지문은 별도 채널로 받은 키와 서명 파일을 대조하려고 의도적으로 넣은 기능이지만 일반 모델 전달이나 계산 정확성 확인에 필요하지 않다. 서명 형식과 출처·migration 검증은 보존하고 **작업 공간 → 고급 파일**로 옮겼다. 브라우저에만 저장하는 앱의 백업·복구는 필요하므로 기본 경로로 남겼다. 할당량·영구 저장 여부·복구 원본·진단 기록은 접힌 **저장 문제 해결**, SHA는 접힌 **백업 검증 정보**, 삭제는 별도 접힌 영역과 두 단계 확인으로 정리했다. 분석·데이터·실험·코드 내보내기와 지원 범위 조회는 계산 작업과 직접 연결되어 유지했다.

| 검사 | 실제 결과 |
| --- | --- |
| 단위 | [3,883/3,883 PASS](evidence/workspace-simplification-unit-results.json). |
| 파일·복구·UI 집중 회귀 | [34/34 PASS](evidence/workspace-simplification-browser-results.json). 지문 불일치·변조·migration 검토·원본 보존·원자적 복구·탭 충돌·Python/WASM 실제 실행·기본 접힘·고급 진입·초점 복귀를 확인했다. |
| 화면 실측 | [10조건 PASS](evidence/workspace-simplification-ui-verification.json): 1440/1024/390/320px의 다크·라이트 및 1440px 글자200%. 헤더 줄바꿈 시 메뉴가 왼쪽 밖으로 나가던 문제를 viewport 위치 계산으로 교정했다. |
| 경로·배포 후보 | [root](evidence/workspace-simplification-root-release-verification.json)·[project](evidence/workspace-simplification-project-release-verification.json) 각각91검사·16assets PASS. [프로젝트 경로 브라우저4/4 PASS](evidence/workspace-simplification-project-browser-results.json). 공개 배포 검사는 이 로컬 결과와 분리한다. |
| 의존성 | [npm audit](evidence/workspace-simplification-dependency-audit.json) 알려진 취약점0개. |

첫 집중 회귀의 탭 충돌 사례는30초 제한으로 시간 초과였다. [초기33/34](evidence/workspace-simplification-initial-browser-results.json), [독립 재실행1/1](evidence/workspace-simplification-cross-tab-browser-results.json), 최종34/34를 구분해 보존했다. 최종 UI의 page error와 앱 console error는0이다. 첫 브라우저의 자동 favicon.ico 요청404는 기존 정적 리소스 누락으로 별도 기록했다. 사용자 브라우저의 저장 데이터를 삭제하거나 읽지 않았다. 엔진·블럭337개·지원표와 보호 원자료/승인25개는 변경하지 않았으며 M16 문서 정리 기록도 당시 증거로 보존했다.

## 보조 기능 정리 공개 결과

[Actions 37132824930](https://github.com/JTech-CO/CalcWeave/actions/runs/37132824930)는 main `6882c2ae95dfda950652f642e4570670c460e172`에서 단위3,883/3,883·전체 브라우저199/199·프로젝트 경로4/4와 기존 모든 단계 회귀·release91검사를 통과한 뒤 앱0.17.1/엔진0.17.0-m16을 게시했다. 공개16assets와 service worker를 로컬의 프로젝트 artifact와 byte/SHA로 대조했다. release ID는 `eed8ecaa15afd751ae142d9d8f58c935cae13397b944f8ad8cd8db02b4890951`다.

[공개 기본9검사](evidence/workspace-simplification-public-browser-verification.json)와 [실제 공개 기능34케이스](evidence/workspace-simplification-public-feature-browser-results.json)가 통과했다. 새 기본 접힘·고급 파일 진입·초점 복귀뿐 아니라 지문 불일치·변조 거부·migration 검토·원본 보존·백업/복구/삭제·탭 충돌·다운로드 Python/WASM의 실제 실행을 독립 브라우저에서 확인했다. 사용자 브라우저의 저장소는 접근하지 않았다.

[조사·변경·로컬 검증](evidence/workspace-simplification-engineering-checks.json)·[CI 원본 요약](evidence/workspace-simplification-actions-verification.json)·[정확한 공개 파일](evidence/workspace-simplification-deployment-verification.json)·[공개 결과](evidence/workspace-simplification-public-release.json). M16의 모든 과거 수치/승인/문서 정리 증거는 별도로 보존하며 정식 출시·실제 novice 관찰·목표 도메인·원본 전체 동등성의 미검증 상태도 유지한다.

## 제품 도움말 정리

앱 `0.17.2`는 CalcWeave 자체의 계산 흐름을 설명하는 도움말 변경이다. 기본 메뉴를 사용 안내·블록 찾기·파일·코드·앱 정보로 정리하고, 첫 화면에 작은 계산의 작성·연결·실행을 안내한다. Simulink 비교와 확장 상세는 앱 정보의 접힌 호환성 참고로 옮겼다. MATLAB 설치가 필요 없는 독립 웹 계산 도구임을 명시하며, 전체 옵션 동등성이나 미지원 기능의 경계를 변경하지 않았다. ID·엔진 버전·원시 파라미터와 세부 상한은 필요할 때 여는 기술 정보에 보존했다.

| 검사 | 실제 결과 |
| --- | --- |
| 도움말 집중 회귀 | [35/35 PASS](evidence/product-help-browser-results.json). 기존 블록 검색·원자료 385행·어댑터 계약과 새 기본 안내·4개 메뉴·키보드 초점·스크롤 복귀를 확인했다. |
| 화면 실측 | [10조건·18캡처 PASS](evidence/product-help-ui-verification.json): 1440/1024/390/320px의 다크·라이트 및 1440px 글자200%. 캡처를 모두 직접 검토하고 탭 전환 시 제목이 가려지던 문제를 수정했다. |
| 경로·배포 후보 | [root](evidence/product-help-root-release-verification.json)·[project](evidence/product-help-project-release-verification.json) 각각91검사·16assets PASS. [프로젝트 경로 브라우저4/4 PASS](evidence/product-help-project-browser-results.json). |
| 단위 재검사 | [초기 전체](evidence/product-help-initial-unit-results.json)는3,873/3,883 PASS와10개 시간 초과 의심 실패였다. 실패6파일을 단일 워커로 재실행한 [492/492 PASS](evidence/product-help-unit-retry-results.json)에는 최초 실패10개가 모두 포함되었다. 테스트·구현·시간 제한을 변경하지 않았으며 이 합산을 단일 전체 PASS로 표현하지 않는다. 전체 CI 결과는 별도로 기록한다. |
| 의존성 | [npm audit](evidence/product-help-dependency-audit.json) 알려진 취약점0개. |

[변경·보안 기준·보존 검사](evidence/product-help-engineering-checks.json)에 검색 길이·허용 목록·React 출력 이스케이프와 개인정보 흐름 변경 없음, 엔진·지원표·과거 증거 보존 상태를 기록했다. 첫 UI 실행은 중간 빌드 교체를 감지한 [7조건 부분 결과](evidence/product-help-initial-ui-verification.json), 다음 실행은 DOM10조건 통과 후 제목 가림을 발견한 [시각 실패 결과](evidence/product-help-initial2-ui-verification.json)로 보존한다. 최종 검사의 앱 콘솔 오류와 페이지 오류는0이며 자동 favicon.ico 요청404는 별도로 기록했다. 사용자 브라우저의 저장 데이터는 접근하지 않았다.

## 제품 도움말 공개 결과

[Actions 37140475203](https://github.com/JTech-CO/CalcWeave/actions/runs/37140475203)는 main `9d4e3c375f1b4361990d4a80c68cc14da56967b1`에서 단위3,883/3,883·전체 브라우저204/204·프로젝트 경로4/4와 기존 모든 단계 회귀·release91검사를 통과한 뒤 앱0.17.2/엔진0.17.0-m16을 게시했다. 공개16assets와 service worker는 로컬 프로젝트 artifact와 byte/SHA가 일치했다. release ID는 `8f43d3362987d007748878b63b0505063eb54e199888d961aeb89ecfb7f052d9`다.

[공개 기본9검사](evidence/product-help-public-browser-verification.json)와 [실제 공개 기능35케이스](evidence/product-help-public-feature-browser-results.json)가 통과했다. 제품 중심 첫 안내·블록 검색·4개 메뉴·닫힌 기술/호환성 정보·기존 대응표와 어댑터 상세·탭 전환 스크롤·키보드 초점과 기존 백업·복구 경로를 독립 브라우저에서 확인했다. 사용자 브라우저의 저장 데이터는 접근하지 않았다.

[변경·로컬 검증](evidence/product-help-engineering-checks.json)·[CI 원본 요약](evidence/product-help-actions-verification.json)·[정확한 공개 파일](evidence/product-help-deployment-verification.json)·[공개 결과](evidence/product-help-public-release.json). 과거 실패와 M16 승인·문서 정리 증거는 보존한다. 기술적 앱 배포 PASS와 정식 출시·실제 초보자 관찰·목표 도메인·원본 전체 동등성의 미검증 상태는 구분한다.

## 라이브러리 탐색 개선

앱 `0.17.3`은 누락된 42개 기호를 보완해 337개 블록에 명시적인 기호를 제공한다. 기존 295개 기호는 유지하고 미등록·프로토타입 ID는 안전한 기본 기호를 쓴다. 제목·전체 수·검색을 고정하고 목록만 세로 스크롤한다. 기본으로 자주 쓰는 블록10개만 펼치며 실제29개 카테고리는 접는다. 카테고리 버튼은 마우스·Enter·Space로 동작한다. 검색 결과의 범주는 자동으로 열고 검색을 지우면 이전 펼침을 복원한다.

| 검사 | 실제 결과 |
| --- | --- |
| 기호 단위 | [2/2 PASS](evidence/library-navigation-symbol-unit-results.json). 전체337개 명시 기호·누락 사례·프로토타입 fallback을 검증했다. 전체 단위 CI와 구분한다. |
| 기존 영향 회귀 | [53/53 PASS](evidence/library-navigation-browser-results.json). 기존 계산·편집·블록 검색 회귀를 확인했다. |
| 새 라이브러리 회귀 | [6/6 PASS](evidence/library-navigation-new-browser-results.json). 기본 접힘·키보드·검색 복원·전체337개·기호 경계·상단 고정·빠른 추가를 확인했다. |
| 화면 실측 | [10조건·18캡처 PASS](evidence/library-navigation-ui-verification.json). 1440/1024/390/320px의 다크·라이트와 1440px 글자200%에서 전체기호와 상단 고정을 확인했다. 900px 가로 태블릿 배치도 추가 측정했다. |
| 배포 후보 | [root](evidence/library-navigation-root-release-verification.json)·[project](evidence/library-navigation-project-release-verification.json) 각각91검사·16assets, [프로젝트 경로4/4 PASS](evidence/library-navigation-project-browser-results.json). |
| 의존성 | [npm audit](evidence/library-navigation-dependency-audit.json) 알려진 취약점0개. |

[초기4/6 결과](evidence/library-navigation-initial-new-browser-results.json)는 기호 하나의 폭 넘침과 동시 테스트 출력 경로 충돌을 기록한다. 기호 크기를 조정하고 출력 경로를 분리했다. 내적·픽셀 처리에 의도된 점 기호를 누락으로 판정하던 검사도 교정했다. [변경·보안·보존 검사](evidence/library-navigation-engineering-checks.json)에 검색100자 제한·React 이스케이프·사용자 브라우저 데이터 미접근·엔진/지원표/과거 증거 보존을 기록했다. 공개 결과는 별도로 기록한다.

[초기 화면 프로브](evidence/library-navigation-initial-ui-verification.json)는 좁은 화면에서 의도적으로 숨긴 저장 표시의 가시성을 기다려6조건이 시간 초과했고, service worker 차단 정책이 안내 배너를 유발했다. 준비 조건을 저장 완료 텍스트로 바꾸고 별도 프로필의 service worker를 허용해 최종10조건을 다시 측정했다. 이 프로브 설정 문제를 제품 결함으로 판정하지 않는다.

## 라이브러리 탐색 공개 결과

[Actions 37165531788](https://github.com/JTech-CO/CalcWeave/actions/runs/37165531788)는 main `f1df5c724da1ccf67b861ad535f89cdb4957a976`에서 단위3,885/3,885·전체 브라우저210/210·프로젝트 경로4/4와 기존 모든 단계 회귀·release91검사를 통과한 뒤 앱0.17.3/엔진0.17.0-m16을 게시했다. 공개16assets와 service worker는 로컬 프로젝트 artifact와 byte/SHA가 일치했다. release ID는 `21d9c36d4d2f80dad06d52baa7d5f4ad70b0334ea59941fde5dab2a2f5167f73`다.

[공개 기본9검사](evidence/library-navigation-public-browser-verification.json)와 [실제 공개 라이브러리6케이스](evidence/library-navigation-public-feature-browser-results.json)가 통과했다. 처음 추천만 펼침·카테고리 키보드·검색 복원·337개 기호·상단 고정·추가·다크/라이트·화면 크기와 글자200%를 독립 브라우저에서 확인했다. 사용자 브라우저의 저장 데이터는 접근하지 않았다.

[변경·로컬 검증](evidence/library-navigation-engineering-checks.json)·[CI 원본 요약](evidence/library-navigation-actions-verification.json)·[정확한 공개 파일](evidence/library-navigation-deployment-verification.json)·[공개 결과](evidence/library-navigation-public-release.json). 기존 원자료·승인·과거 검증과 M16 문서 정리 결과를 보존했다.

[초기 공개 기본 검사](evidence/library-navigation-initial-public-browser-verification.json)는 이전의 모든337개 초기 펼침 조건을 기다리다가60초 제한에 도달했다. 공개 검사 스크립트를 전체 수337·추천 범주 펼침·초기10개 표시로 교정하고 타입 검사를 통과했다. 이후9개 기본 검사를 모두 통과했으며 실제 앱의 배포 파일은 변경하지 않았다.

## 학술·수학 소개와 공유 미리보기

README를 수학 도구의 목적·활용·모델 예제·기술 구조 중심으로 구성하고, Simulink의 블록선도 모델링과 SANE의 정보 우선 설계에서 받은 영향을 명시했다. 배지의337개 블록·75개 예제는 실제 정의와 예제 목록을 기준으로 한다. Python·WASM 지원 범위와 원본 전체 동등성의 미검증 상태를 함께 안내한다.

사이트와 저장소의 소개 이미지는 초기값 문제 `x′ = −x`, `x(0) = 1`을 Gain(−1)·Integrator·Scope와 피드백 연결로 표현한다. 이는 소개용 도식이며 그래프 픽셀을 수치 검증 자료로 사용하지 않는다. 사이트 PNG는1730×909·997,348bytes, 저장소 PNG는1774×887·971,681bytes이다. 원본 생성 이미지의 픽셀을 유지한 무손실 PNG 압축을 적용했다.

| 검사 | 결과 |
| --- | --- |
| 관련 단위 검사 | social metadata·오프라인 파일·검증 출력 경로63/63 PASS |
| TypeScript | `tsc --noEmit` PASS |
| 문서 링크 | 현재10문서·로컬690링크·4앵커 PASS·퇴역44문서 재생성 없음 |
| 배포 후보 | [root](evidence/og-readme-root-release-verification.json)·[project](evidence/og-readme-project-release-verification.json) 각각95검사·17자산 PASS |
| OG 메타와 이미지 | canonical·OG·Twitter 메타의 실제 HTTPS 주소와 PNG 크기 일치. 원본·양쪽 빌드·manifest의 사이트 이미지 SHA-256 일치 |

사이트 이미지 [원본 파일](../apps/web/public/assets/social/calcweave-og.png)과 [저장소 이미지](../assets/branding/calcweave-github-og.png)는 실제 소개에 사용되는 자산이며 과거 QA 캡처와 구분하여 보관한다. 기존 preview 산출물·정책 HTML·M16 라이선스·과거 JSON331개는 바이트를 보존했다. 공개 반영 결과는 아래 검증으로 확인했다.

### 공개 OG 반영 결과

2026-10-04, [Pages CI37177565334](https://github.com/JTech-CO/CalcWeave/actions/runs/37177565334)에서 단위3909개·브라우저210개·프로젝트 경로4개가 통과했고 verify·deploy가 모두 성공했다. 배포 소스는 `fe2931091da17de64be0991a314eb857c4ad0169`이다. [공개 파일 검증](evidence/og-readme-public-release.json)에서 OG·Twitter·canonical 메타, PNG 형식·크기·SHA-256, manifest17자산과 서비스 워커가 격리 project 빌드와 모두 일치했다. 사용자 브라우저 저장 데이터는 접근하지 않았다.

저장소용 이미지는 README에 적용되어 표시된다. GitHub Settings의 별도 Social preview 등록은 브라우저 확장의 로컬 파일 접근 권한이 꺼져 있어 미완료이며, 이미지 제작·사이트 OG 적용·README 반영과 구분해 기록한다.
