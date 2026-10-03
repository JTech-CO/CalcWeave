# CalcWeave

블럭을 연결해 수학 계산과 시뮬레이션을 만들고, 데이터와 실행 가능한 코드를 함께 다루는 로컬 우선 웹 앱입니다. 기본 사용에 MATLAB 설치, 회원가입, 계산 서버가 필요하지 않습니다.

[웹 베타 열기](https://jtech-co.github.io/CalcWeave/) · [기술 백서](docs/01-technical-whitepaper.md) · [디자인 백서](docs/02-design-whitepaper.md) · [운영 안내](docs/operations.md) · [검증과 증거](docs/validation.md)

현재 공개 앱은 `0.17.0` / 엔진 `0.17.0-m16`입니다. M16 구현·문서 통합·병합 및 GitHub Pages 배포를 완료했으며, [공개 CI·파일·브라우저 결과](docs/validation.md#m16-공개-결과)를 확인할 수 있습니다. 목표 브랜드 도메인은 **CalcWeave.com**, 운영자는 **JTech-Co**, 문의는 [jtech-bryan@proton.me](mailto:jtech-bryan@proton.me)입니다.

## 현재 범위

| 지표 | 의미 |
| --- | --- |
| 337개 블럭 정의 | 실제 registry에 등록된 포트·파라미터·실행 계약. 모델별 자료형·모드·옵션 검증이 필요합니다. |
| 75개 예제 / 12개 범주 | 계산·시간·자료형·계층·데이터·어댑터의 학습 모델. |
| 원자료 385행 / 339개 이름 | 중복 접근·설정·조건부·레거시가 포함된 R2024b 참고 목록의 추적 단위입니다. |
| 선택 구성 367행 / 미지원 18행 | 증거가 있는 선택 범위와 지원하지 않는 범위를 나누어 기록합니다. |
| 전체 옵션 동등 승인 0행 | 전체 원본 옵션 inventory와 MathWorks reference 실행 동등성은 검증하지 않았습니다. |
| TypeScript / Python / WASM | TypeScript는 승인된 실행 계약, Python은 69개 ID, WASM은 16개 ID의 선택 구성을 내보냅니다. C/C++는 실행 환경·검증이 없어 unavailable입니다. |

[공개 지원표](docs/support-matrix.md)와 [기계 판독 지원표](docs/support-matrix.json)는 원자료 ID, 실제 기능·공유 설정·독립 대체, 파라미터, 자료형, 실행 모드, 타깃과 증거를 분리합니다. 타깃의 ID 목록에 들어 있다는 사실만으로 모든 구성이 실행되는 것은 아닙니다. [상세 원본 대응표](docs/block-coverage.md)는 원본 385행의 식별과 과거 선택 승인을 보존합니다.

## 로컬 실행

Node.js `22.12` 이상이 필요합니다. 잠금 파일의 의존성을 설치하고 개발 서버를 시작합니다.

```sh
npm ci
npm run dev
```

화면의 **예제로 시작**에서 작은 모델을 열고 입력값을 바꾼 뒤 실행하세요. 캔버스는 휠 버튼 드래그로 이동하고, 왼쪽 버튼 드래그로 영역을 선택하며, 캔버스에 초점이 있을 때 Space로 도식을 맞춥니다. 블럭의 상세 설정과 제한은 속성 패널에서 확인합니다.

```sh
npm run typecheck
npm test
npm run verify:coverage
npm run verify:roadmap
npm run verify:m16
npm run build
npm run verify:release
npx playwright install chromium
npm run test:e2e
```

실제 Python 검증은 Python `3.14`를 사용합니다. 필요하면 `CALCWEAVE_PYTHON_PATH`를 지정하세요. `CALCWEAVE_BROWSER_PATH`로 검증용 Chromium 실행 파일을 지정할 수 있습니다. 타깃별 실제 실행, 이전 계약 회귀, frozen 증거 보존 및 명령별 준비 조건은 [검증 안내](docs/validation.md)를 따릅니다.

production preview는 빌드 후 실행합니다.

```sh
npm run preview -- --port 4173 --strictPort
```

GitHub Pages의 `/CalcWeave/` 경로 빌드, 오프라인 검사와 공개 파일 비교는 [운영 안내](docs/operations.md#배포와-업데이트)를 따릅니다. 서로 다른 base 빌드를 같은 `dist`에서 동시에 검증하지 않습니다.

## 저장과 파일

작업 공간과 최근 실행 기록은 해당 브라우저에 저장됩니다. 관리 화면에서 백업·복구·원본 다운로드·로컬 삭제를 할 수 있습니다. 브라우저 저장은 영구 보관이나 암호화를 보장하지 않으므로 중요한 작업은 별도 백업으로 보관하세요.

CSV/JSON/XLSX 표, 선언형 모델 패키지와 선택 MAT v5/SLX/MDL 파일 분석을 제공합니다. 외부 파일은 지원·미지원 항목과 원본 위치를 검토한 뒤 사본으로 적용합니다. 원본 bytes의 보존과 편집한 native 형식 생성은 다른 기능이며, 후자는 지원하지 않습니다. 서명된 패키지도 별도의 출처 확인과 migration 검토가 필요합니다.

[이용 안내](docs/legal/terms.md) · [개인정보와 로컬 데이터](docs/legal/privacy.md) · [쿠키·오프라인 캐시](docs/legal/cookies.md)

## 코드 구조와 유지보수

| 경로 | 역할 |
| --- | --- |
| `apps/web` | React 편집기, Worker, 로컬 저장·복구, 데이터·가져오기·내보내기 UI |
| `packages/model`, `block-library`, `compiler` | bounded 값·모델·포트·파라미터 계약과 immutable IR |
| `packages/runtime`, `expression`, `advanced-math`, `quantization` | 실제 계산·상태·solver·안전한 수식·수치 알고리즘 |
| `packages/data`, `experiments`, `analysis` | 표·시계열, 공유 예산 실험, 해석·비교 |
| `packages/codegen-ts`, `codegen-python`, `codegen-wasm` | 버전 있는 타깃 검사·생성·manifest |
| `packages/model-package`, `interop` | 서명·migration·출처 검토와 bounded 외부 형식 분석 |
| `packages/release`, `support-matrix` | 현행 릴리스·원본별 선택 지원 메타데이터 |
| `tests`, `fixtures`, `scripts` | 독립 oracle, 실제 생성 프로그램 실행, 브라우저·배포·무결성 검증 |

기능 변경은 실제 코드·파라미터 schema·독립 fixture·타깃 검사·지원표를 함께 갱신합니다. 과거 증거를 현재 실행 결과로 덮어쓰지 않습니다. 동결한 [원자료](dataset/Simulink_Basic_Blocks_R2024b.md), [계획 JSON](docs/simulink-coverage-roadmap.json), `docs/baselines`와 `docs/evidence`는 당시 source identity와 검증을 보존하는 자료입니다. 이 보존 자료에 담긴 과거 상대 문서 링크·계약 경로·버전은 그 기록 시점의 참조이며, 현행 설명은 위 통합 문서를 읽습니다.

목표 도메인 소유·DNS·HTTPS 설정, 실제 초보자 관찰, 문의 메일 운영 정책과 전체 원본 실행 동등성은 각각 별도 gate입니다. 기술적 빌드·배포 PASS를 이 항목들의 완료로 해석하지 않습니다.
