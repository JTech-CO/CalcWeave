# CalcWeave 검증 상태

현행 소스는 앱 `0.27.0` · 엔진 `0.17.1-m16`이며 마지막으로 확인한 공개 앱은 `0.24.0`이다. 아래 수치는 해당 검증 기록의 결과이며 새 공개 배포를 뜻하지 않는다. 기능·입력 범위는 [기술 백서](01-technical-whitepaper.md), 화면·접근성 계약은 [디자인 백서](02-design-whitepaper.md), 게시·업데이트 절차는 [운영 안내](operations.md)를 따른다.

## 현행 소스 검증

2026-10-09(Asia/Seoul)의 [편집 확장 검증](evidence/editor-verification.json)은 Display·Scope 입력1~16개, 중첩/개별 그래프, 라이브러리 드래그 배치와 **Space를 누른 상태에서 Z** 자동 정렬을 확인했다.

| 검사 | 기록된 결과와 확인 범위 |
| --- | --- |
| 전체 단위·타입 | 개발 자료 정리 후 **5,160/5,160 PASS · 100개 파일**. 초기 단계 러너의 독립 수치 검사98개를 공통 회귀 테스트로 통합했다. 타입·문서 링크·coverage·roadmap·지원표 해시 검사도 통과했다. |
| 신규 Chromium | **9/9 PASS**. 새 입력/사용한 입력/몸체 연결, 최대16개, 입력 축소·Undo, 확대·이동 후 드래그 위치, 잘못된 드롭, 키 조합·초점·하위 도식·정렬 후 계산 지문을 확인했다. |
| 기존 화면 회귀 | 도움말·시간/주파수 분석·작업 공간 **21/21 PASS**와 추가 그래프 화면 검사1개. [다중 입력 화면](evidence/editor-multi-input.png)을 보관한다. |
| 정적 release | [루트](evidence/editor-root-release-verification.json)와 [/CalcWeave/](evidence/editor-project-release-verification.json) 각각 **107개 검사·20자산**. 정책·Worker·manifest·service worker의 경로와 실제 bytes/SHA를 확인했다. |
| 호환·보안 경계 | 생략된 기본 입력 수와 기존 semantic SHA 유지, 과거 서명 패키지 검증, 역사 선언에 없는 파라미터 거부, 입력별 자료형·형상·단위 보존, 허용 목록·자원 상한·React 이스케이프를 확인했다. |

다중 입력은 브라우저와 TypeScript에서 지원하며 Python·WASM은 입력1개만 지원한다. 자동 정렬은 현재 도식의 위치만 바꾸고 연결·파라미터를 유지한다. [현재 확장 계약](../packages/support-matrix/src/current-extensions.ts)은 역사 지원표와 별도로 관리한다. 원래 엔진과의 수치 동등성을 승인한 의미는 아니다.

직전 분석 기능의 [구간 통계·상관 검증](evidence/m24-verification.json)과 [Welch·STFT 검증](evidence/m25-verification.json)은 독립 해석식·원시 시각·IEEE 값·예산·취소/오류·JSON 출처와320/390px·글자200% 화면을 확인했다. [통계 독립 관측](evidence/m24-independent-numeric-review.json)은 상관2,000개와 분산1,000개, [시간/주파수 독립 관측](evidence/m25-independent-numeric-review.json)은160개 신호·1,075구간·22,555빈을 비교했다.

## 지원·타깃 검증

[지원표](support-matrix.md)와 [기계 판독 JSON](support-matrix.json)은 엔진 `0.17.0-m16`의 역사 승인 자료다. 원자료385행·339개 이름, registry337개, 모델 widget5개와 미지원 목적10개를 구분한다. 선택 구성 대응367행·미지원18행이며 원본 전수 옵션 inventory와 MathWorks 실행 동등성은 미검증이다.

[M16 감사](evidence/m16-verification.json)는25개 보호 자료·337개 이전 정의·385개 identity·352개 계약·실제 profile selector를 대조했다. 251행에276개 설정 profile이 연결되고 나머지 선택116행은 source별 profile이 직접 연결되지 않았음을 표시한다. [고정 설정 재검증](evidence/m16-preset-verification.json)은 Add·Subtract·Pi·Zero의 실제 TypeScript 결과와 독립 기대값을 비교한다.

[Python 실제 실행](evidence/m15-python-regression-on-m16.json)은142개 프로그램·256표본, [WASM 실제 실행](evidence/m15-wasm-regression-on-m16.json)은128개 module/runner를 기록한다. Python69개·WASM16개 블록 ID의 allowlist는 모델별 자료형·모드·파라미터 검사를 통과해야 하는 후보 목록이다. C/C++ native 실행은 제공하지 않는다. 검증기가 읽는 baseline·서명 호환 자료·SHA로 연결된 승인 증거는 원본 bytes를 유지한다.

## 재현 명령

잠금 파일로 의존성을 설치하고 기본 검증을 실행한다. Python 생성 코드 비교에는 Python 환경이 필요하다. 전체 단위 검사를 브라우저·빌드와 동시에 실행하면 기존 코드 생성의 시간 상한에 영향을 줄 수 있으므로 검증 실행을 분리한다.

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=2
npm run verify:docs
npm run verify:coverage
npm run verify:support
npm run build
npm run verify:release
```

브라우저 검사는 `npx playwright install chromium` 후 `npm run test:e2e`로 실행한다. 루트 production preview와 검증용 저장소를 사용하며 사용자의 열린 작업 저장소와 분리한다. 프로젝트 경로 검증은 `CALCWEAVE_BASE_PATH=/CalcWeave/`로 빌드한 결과에서 `verify:release`와 `test:e2e:pages`를 실행한다. 명령과 준비 조건은 [운영 안내](operations.md#배포와-업데이트)에 있다.

지원표의 결정적 재생성은 `verify:support`로 확인한다. 승인 자료를 실제로 변경할 때만 `npx tsx scripts/generate-support-matrix.ts --write`로 재생성하고 변경된 계약과 증거를 함께 검토한다. 초기 단계의 독립 수치·잔차·생성 코드 검사는 전체 단위 검사에 포함되어 별도 보고서 생성 명령이 필요하지 않다.

## 마지막으로 확인한 공개 배포

2026-10-09의 [공개 전후 기록](evidence/m23-public-layout-release.json)은 캐시 MISS에서도 공개 서버가 앱0.17.3을 제공하던 원인을 이전 게시 artifact로 확인했다. 새로고침·HTTP 캐시 삭제는 새 릴리스를 게시하지 않는다. 현재 source와 공개 서버의 manifest·releaseId·Pages 소스 commit을 따로 확인한다.

[Actions 37896847510](https://github.com/JTech-CO/CalcWeave/actions/runs/37896847510)은 소스 `db718b30341fa92f526bc22b837b82f94c64b4c5`에서 앱 **0.24.0**을 게시했다. [CI 원본 요약](evidence/m23-actions-verification.json)은 단위4,573/4,573·브라우저272/272·프로젝트 경로4/4·루트/프로젝트 release 각각103검사 PASS를 기록한다.

[공개 파일 대조](evidence/m23-deployment-verification.json)는 실제 Linux CI Pages artifact 기준으로 `/CalcWeave/`와 `/CalcWeave/index.html`,19개 정적 자산, manifest와 service worker의 bytes/SHA 일치를 확인했다. [게시 manifest](evidence/m23-published-manifest.json)의 releaseId는 `9b0718b018d6f90dc12c1a4882dbdb2a360ef39f1fd89171de038dd85f1e13e5`다.

| 1440px 공개 화면 | 이전 게시 | 확인한0.24.0 게시 |
| --- | --- | --- |
| 중앙 캔버스 | 558px | 823px |
| 좌측 / 우측 컬럼 | 250px / 312px | 175px / 218px |
| 상단 / 도구 모음 | 119px / 65px | 약73px / 약42px |

[이전 화면](evidence/m23-public-layout-before.png)과 [적용 후 화면](evidence/m23-public-layout-after.png)은 같은 격리 프로필과 모델을 사용한다. [공개 기능9검사](evidence/m23-public-browser-verification.json)는 실제 Worker·오프라인·도움말·정책·scoped cache·Python 다운로드를 확인했다. 사용자의 브라우저나 저장 자료에 접근하지 않았다. 이후 로컬 소스의 추가 기능이 공개 서버에 게시되었다고 해석하지 않는다.

## 화면 캡처 보관

현재 문서와 검증에서 읽는 최종 화면·실행 증거를 보관한다. 종료된 기획·반복 캡처·임시 실행 산출물은 정리하며 이전 추적 파일은 Git 기록에서 확인할 수 있다. 역사 JSON에 기록된 이미지 경로와 해시는 당시의 관측을 가리키므로 현재 작업 폴더에 모든 과거 이미지가 존재한다는 뜻은 아니다. 지원 승인과 서명 호환 검증이 실제로 읽는 증거는 보존한다.

## 검증 범위와 열린 항목

주 자동 검증은 Chromium과 TypeScript/Python/WASM의 승인된 선택 구성에 한정한다. Firefox·Safari·실제 초보자 관찰·원본 전수 옵션·MathWorks 실행 동등성·목표 도메인과 정식 출시 검토는 별도 확인이 필요하다. [운영의 열린 항목](operations.md#완료와-구분하는-외부-gate)을 따른다. 소스 테스트 PASS, 특정 artifact 게시 PASS와 정식 공개 운영 승인은 각각의 근거로 판단한다.
