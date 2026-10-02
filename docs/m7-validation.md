# M7 코드 타깃·패키지 구축 및 검증 기록

2026-10-03 KST · 앱 **0.7.0** · 엔진 **0.7.0-m7** · 모델 schema 1. [M7 계약](m7-contract.md)에 따라 첫 추가 언어 Python, 서명된 선언형 모델 패키지와 가져오기 단계 보고를 구현했다. 기존 TypeScript export와 M1~M6 계산·작업 공간 계약을 유지한다.

## 구현 결과

**Python**은 정적·이산 실행에서 50개 기본 블럭과 조건부 하위 도식, 총 **51/74 registry 항목**을 지원한다. 타입/형상·단위·시간 입력·seed 난수·상태·rate transition·데이터 재생·동질 bus를 포함한다. 하위 도식의 모든 펼친 노드가 지원돼야 한다. 연속·혼합 solver와 M5 고급 수치 블럭은 생성 전에 원본 노드와 하위 경로를 표시하며 TypeScript를 안내한다.

코드 타깃 창에서 지원 범위와 현재 도식의 진단을 확인하고 독립 `model.py` 또는 고정 파일명의 실행 ZIP을 내려받는다. 실행 묶음은 모델·manifest·실행 예제와 유효한 현재 완료 결과만 담는다. Python 3.10 이상 표준 라이브러리를 사용하는 소스이며 실제 시험 환경은 **Python 3.14.0**이다. 모든 Python 버전·운영체제에서 시험했다고 주장하지 않는다. 생성 경계에서 원본 모델을 다시 컴파일해 IR와 manifest를 검증하고, 내장 IR 8 MiB·소스 16 MiB 및 실행 예산을 적용한다.

**모델 패키지**는 승인된 74종 registry와 정확한 `local-model` 권한으로 제한한다. 파일마다 비추출 일회용 ECDSA P-256 개인키로 서명하며 개인키를 저장하거나 출력하지 않는다. 받는 사람은 발신자로부터 별도 경로로 확인한 공개키 SHA-256 지문을 입력해야 수락할 수 있다. 파일에 들어 있는 공개키를 자동으로 신뢰하지 않는다. 모델·데이터·하위 도식·노트·대시보드를 담지만 임의 실행 커널이나 외부 라이브러리를 설치하지 않는다. 패키지 상한은 6 MiB이며 schema·엔진·registry·권한·hash·서명을 모델 변경 전에 검사한다.

**가져오기 보고서**는 JSON 구문, native 구조, 외부 형식 변환, 실행 가능성을 구분한다. CalcWeave native 파일은 원본을 열므로 외부 변환을 수행했다고 표시하지 않는다. 구조가 유효한 컴파일 실패 모델은 편집 가능하게 열고 진단을 남긴다. 불량 파일과 미승인 패키지는 현재 모델을 보존한다. 오래 걸린 파일 읽기나 닫힌 공유 창의 응답이 나중에 모델을 덮지 않도록 보호했다. Simulink·MATLAB·C/C++·S-function·WASM 변환 및 일반 사용자 커널은 미지원이다.

지원 안내·코드 타깃·공유·가져오기 화면은 검정/차콜 다크와 밝은 회색 라이트, 기존 글자 크기·단순 블럭 표현·가운데 도식과 결과의 좌우 배치를 유지한다. 큰 새 코드 생성기와 패키지 모듈은 타깃/공유 사용 시 지연 로드한다. Pages 검사 workflow에는 고정된 공식 setup-python Action과 실제 Python parity 검사를 추가했다. 원격 workflow 실행이나 공개 배포를 수행했다고 기록하지 않는다.

## 검사 결과

| 검사 | 결과 | 근거 |
| --- | --- | --- |
| 단위·통합 | 25파일 **1,022/1,022** 통과, 기존 866 + 신규 156 | `npm test`, [전체 요약](evidence/m7-workspace-verification.json) |
| 실제 독립 Python 검사 | **113/113** 통과 | `tests/m7-python.test.ts`, Python 3.14.0 |
| 패키지·가져오기 검사 | **43/43** 통과 | `tests/m7-package.test.ts`, `tests/m7-import.test.ts` |
| JS·독립 TS·실제 Python 수치 교차 검증 | 성공 **89**, 실패 계약 **13**, 미지원 생성 거부 **31** | [타깃 검증](evidence/m7-verification.json), `npm run verify:m7` |
| 브라우저 전체 | 8파일 **111/111** 통과, 기존 101 + 신규 10, 4.5분 | `npm run test:e2e`, [전체 요약](evidence/m7-workspace-verification.json) |
| 신규 브라우저 | **10/10** 통과, 실제 ZIP의 Python 실행 포함 | `tests/e2e/m7-workspace.spec.ts` |
| 반응형 화면 관측 | **188관측** 통과, pageErrors 0 | [디자인 증거](evidence/m7-design-verification.json) |
| strict TypeScript·production build | 통과 | `npm run build` |
| 최종 정적 파일·보안 설정 | **69검사** 통과 | [릴리스 증거](evidence/m7-release-verification.json) |
| 의존성 취약점 조회 | 조회 시점 총 0 | [npm audit](evidence/m7-dependency-audit.json) |
| 원자료 대응표 보존 | **385행**, 중복 0, 원본 digest 불변 | `npm run verify:coverage`, [대응표](block-coverage.md) |

교차 검증은 M1 독립 typed/math oracle 51건, M2 시간·상태 oracle 27건, 승인된 M4 데이터·단위·bus·계층 oracle 11건이다. 실제 격리 Python 프로세스, strict ES2022-only 독립 TS ESM과 JS runtime의 모든 원시 표본·시간축·형상·상태·manifest를 비교했다. 수치는 기본 상대 스케일 허용오차 2e−12와 fixture별 독립 기준을 적용한다. M1·M2의 최대 절대오차는 0, M4는 **2.842170943040401e−14**다. boolean·문자열·키 집합·시간축과 실패 code/node/tick/time은 정확히 비교하며 부분 실패의 완료 표본과 상태도 확인했다. 벽시계 제한이 서로 다른 프로세스에서 같은 순간에 발생해야 한다고 요구하지 않는다.

미지원 연속·M5 모델 31건과 추가 M4 연속 사례 7건은 생성 전 진단을 확인했다. 패키지 서명/hash·독립 신뢰 지문·잘못된 지문·변조·추가 권한 5개 경로와 native/외부 JSON의 단계 구분을 확인했다. 실제 브라우저 다운로드에서 `model.py`를 꺼내 `-I -B`로 실행하고 manifest와 원시 기준 결과를 비교했다.

기존 [M1](evidence/m1-regression-on-m7.json)·[M2](evidence/m2-regression-on-m7.json)·[M3](evidence/m3-regression-on-m7.json)·[M4](evidence/m4-regression-on-m7.json)·[M5](evidence/m5-regression-on-m7.json) 독립 수치/생성 코드 회귀도 모두 통과했다. 성공 fixture는 각각 4·15·28·18·30건이다. 기존 블럭 지원 상태와 원자료 미구현 271행, digest `cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7`를 유지한다. 전체 111건 실행 뒤 과거 증거 보존을 위해 두 테스트 파일의 캡처/취소 기록 경로만 마일스톤별로 바꾸고 영향받는 9건을 다시 실행해 통과했다. 앱·빌드·검사 assertion은 그대로다.

신규 화면 관측 40건은 다크·라이트 × 1440/1024/390/320px에서 TS/Python 타깃, 공유 생성·확인, native 가져오기 보고서에 대한 검사다. [다크 Python](evidence/m7-sane-dark-1440-code-python.png), [라이트 패키지 확인](evidence/m7-sane-light-1440-package-import.png), [320px 공유](evidence/m7-sane-dark-320-package-export.png), [320px 보고서](evidence/m7-sane-light-320-import-report.png)를 직접 확인했다. 숨긴 파일 입력의 가로 overflow를 고쳐 문서 너비=viewport, dialog client/scrollWidth=838/838 또는 302/302임을 확인했다. 이 결과는 접근성 인증이나 실제 초보자 사용자 조사 결과가 아니다.

## 성능과 빌드 식별

최종 releaseId는 `994a84fc8000c328b2e2368620c5947cf47eed7d9c1247c13c9caba539896f09`이다. 정적 allowlist **12파일, 총 1,498,933 bytes**이며 각 파일의 실제 바이트와 SHA-256은 [릴리스 증거](evidence/m7-release-verification.json)에 있다. main 번들 약 908.37 kB(gzip 273.80 kB), Worker 약 257.95 kB, Python 지연 모듈 약 36.48 kB다. Vite의 500 kB chunk 경고는 남아 있다.

[성능 원자료](evidence/m7-performance.json)는 Windows 11 `10.0.26200`, i7-13620H/논리 CPU 16개, RAM 약 63.7 GiB, Node 25.9.0, Chromium 153.0.8010.12, viewport 1440×1000의 로컬 production preview에서 같은 releaseId로 측정했다. p95는 관측값의 nearest-rank다.

| 측정 | 반복 | p95 | 기준 |
| --- | ---: | ---: | ---: |
| 새 context 초기 로드·저장 준비 | 5 | **1,088.8 ms** | ≤3,000 ms |
| 같은 context 작업 공간 재로드 | 5 | **114.8 ms** | ≤2,000 ms |
| Node 100노드 compile + run | warmup 5 + 측정 20 | **12.2 ms** | 참고 관측 |
| Node 1,000노드 compile + run | warmup 5 + 측정 20 | **257.3 ms** | ≤1,000 ms |
| 실제 1,000노드 시간 실행 취소 | 5 | **246.1 ms** | ≤1,000 ms |
| UI 100노드 클릭→결과 | 8 | **358.7 ms** | 참고 관측 |
| UI 1,000노드 클릭→결과 | 8 | **2,410.1 ms** | 참고 관측, 화면 비용 포함 |

100노드를 30회 실행·저장한 뒤 최근 기록은 5개로 유지됐으며 강제 GC 뒤 JS heap 변화는 **−1,115,884 bytes**로 증가 ≤32 MiB 기준을 통과했다. pageErrors 0, 계약 예산 6개 모두 통과했다. 계산 체인의 원시 출력은 독립 `1.0001^(n−2)`와 상대오차 1e−12로 비교했고 long task 112개를 원자료에 남겼다. Node 계산과 UI 결과 표시 비용을 구분하며, 로컬 Windows Chromium 관측을 실제 모바일·공개 네트워크·전체 프로세스 메모리·다시간 endurance 측정으로 안내하지 않는다.

## 보안과 공개 출시 상태

[보안 증거](evidence/m7-security-verification.json)는 앱 38·패키지 41·스크립트 23, 총 **102파일** 자동 패턴 검사와 실제 경로 검토를 기록한다. 확인된 취약점은 0건이며 조회 시점 의존성 취약점도 0건이다. 사용자 데이터를 Python 구문에 넣지 않고 hex JSON과 제한 AST로 처리한다. 패키지는 일회용 비추출 키·출처 지문·권한/registry 검증을 적용하며 비동기 파일 덮어쓰기와 닫힌 창의 수락을 차단했다. 계정·서버 API·SQL·인증 쿠키·결제·원격 분석/진단을 추가하지 않았다. 패턴 검사와 의존성 조회가 알려지지 않은 취약점 부재 또는 전체 Git 이력 점검을 보장하지 않는다.

M6 공개 출시 확인 항목은 유지한다. [공개 주소 검사](evidence/m7-deployment-verification.json)의 **calcweave.com DNS는 ENOTFOUND**였으며 공개 배포를 수행하지 않았다. 도메인 소유 TXT·Pages custom domain·실제 HTTPS/응답 정책, 문의/호스팅 통신/정책 적용일의 운영 사실, 실제 초보자 F06 관찰과 추가 브라우저·기기는 별도로 확인해야 한다. 구현과 증거는 검토 PR에 반영하며 이 상태를 공개 서비스 출시 완료로 선언하지 않는다.
