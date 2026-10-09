# CalcWeave

**블록을 연결해 수학 모델을 만들고, 브라우저에서 계산하고 시뮬레이션하는 도구입니다.**

[![CalcWeave — 블록선도로 표현한 감쇠 모델과 시간 응답](assets/branding/calcweave-github-og.png)](https://jtech-co.github.io/CalcWeave/)

[![검증·배포](https://github.com/JTech-CO/CalcWeave/actions/workflows/pages.yml/badge.svg)](https://github.com/JTech-CO/CalcWeave/actions/workflows/pages.yml)
[![버전 0.27.0 beta](https://img.shields.io/badge/version-0.27.0_beta-9ebded?style=flat-square)](package.json)

수학 학습, 신호·동역학 모델 탐색, 수치 계산 실험에 활용할 수 있습니다. MATLAB 설치나 회원가입 없이 시작하며, 모델과 실행 기록은 현재 브라우저에 저장합니다.

**[웹에서 CalcWeave 시작하기](https://jtech-co.github.io/CalcWeave/)**

## 주요 기능

- **블록선도 모델링** — 블록을 끌어 놓고 연결해 계산 흐름을 구성하고 자동 정렬합니다.
- **계산과 시뮬레이션** — 수식·벡터·행렬 계산과 연속·이산·혼합 모델의 시간 응답을 확인합니다.
- **데이터와 그래프** — CSV·JSON·XLSX 데이터를 활용하고 여러 신호와 실행 결과를 비교합니다.
- **신호·제어계 분석** — FFT, 구간 통계·상관, Welch·STFT와 제어계의 주파수 응답을 살펴봅니다.
- **실험과 학습** — 계수 조합·측정 데이터 피팅·불확실성 실험을 실행하고 도식을 수식으로 읽습니다.
- **저장과 코드 내보내기** — 모델·결과를 파일로 보관하고 지원되는 모델을 TypeScript·Python·WASM으로 내보냅니다.

## 자세히 알아보기

| 문서 | 내용 |
| --- | --- |
| [사용 안내](docs/user-guide.md) | 첫 모델, 캔버스 조작, 다중 입력, 수식 학습과 결과 관측 |
| [분석·실험 안내](docs/analysis-guide.md) | 분석 방법, 입력 조건, 수치 한도와 결과 해석 |
| [개발 안내](docs/development.md) | 기술 구성, 로컬 실행, 검증과 지원 범위 |
| [기술 백서](docs/01-technical-whitepaper.md) · [디자인 백서](docs/02-design-whitepaper.md) | 계산 엔진과 화면 설계 |
| [지원 범위](docs/support-matrix.md) · [검증 기록](docs/validation.md) | 블록·내보내기별 지원 조건과 검증 근거 |
| [운영 안내](docs/operations.md) | 배포·업데이트, 백업·복구와 데이터 관리 |

지원 조건은 모델의 블록·자료형·실행 방식에 따라 달라집니다. 상세 범위는 위 문서와 앱 도움말에서 확인할 수 있습니다.

운영: **JTech-Co** · [오류 제보·기능 제안](https://github.com/JTech-CO/CalcWeave/issues) · [문의](mailto:jtech-bryan@proton.me)

[이용약관](docs/legal/terms.md) · [개인정보 처리방침](docs/legal/privacy.md) · [쿠키·로컬 저장 안내](docs/legal/cookies.md)
