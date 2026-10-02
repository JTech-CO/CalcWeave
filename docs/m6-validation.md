# M6 로컬 베타 구축·검증 기록

2026-10-03 KST · 앱 **0.6.0** · 엔진 **0.6.0-m6** · 모델 schema 1. [M6 계약](m6-contract.md)의 로컬 릴리스 후보를 구현했다. 공개 주소 배포, 실제 초보자 관찰과 정책 운영 사실은 별도 확인 항목이며 M6 공개 출시 종료 조건을 모두 통과했다고 선언하지 않는다.

## 구현 결과

**지원·릴리스**에 executable registry 기반 74종 블럭의 검색·모드·포트·파라미터·타입/형상·단위·상태·export 계약과 자원 상한을 연결했다. 기존 27개 예제와 M1~M5 수학 계약을 유지한다. 키보드 안내와 캔버스/결과 건너뛰기, 설정 편집·실행 경로, 이름이 있는 native modal의 포커스 제한·Escape·복원, 상태 live region과 모션 감소를 제공한다.

오프라인 설치는 최종 빌드의 정적 파일만 SHA-256·바이트 길이로 검증한다. 완전한 설치 뒤 네트워크 없는 재열기·Worker 계산·첫 TypeScript 실행 묶음 다운로드를 지원한다. 설치 실패는 기존 릴리스를 보존하며 새 버전은 저장 성공 후 명시적으로 적용한다. 요청 탭만 재열고 기존 탭의 늦은 코드 로드용 이전 검증 캐시는 유지한다. 모델·CSV·결과·임의 URL은 서비스 워커 캐시에 넣지 않는다.

**로컬 데이터 관리**는 현재 모델과 최근 최대 5개 실행 기록을 포함한 전체 백업, 버전·해시·크기 검증, 미리보기 후 단일 IndexedDB transaction 복구, 손상 원본 다운로드, 저장 공간 상태, 제한된 진단 기록과 2단계 초기화를 제공한다. 탭 간 revision 비교로 저장 충돌을 검출하고 덮어쓰기를 멈춘다. quota·차단·늦은 연결·복구 실패를 성공으로 표시하지 않는다. 백업은 최대 26 MiB이며 모델 5 MiB·기록 20 MiB 등 내부 한도를 함께 적용한다. 자료와 브라우저 설정의 삭제는 서로 다른 저장 API이므로 전체 원자성을 주장하지 않고 설정 삭제 실패를 보고한다.

운영자 **JTech-Co**, 문의 **jtech-bryan@proton.me**, 예정 주소 **calcweave.com**과 대상 [JTech-CO/CalcWeave](https://github.com/JTech-CO/CalcWeave)를 반영했다. 이용약관·개인정보·쿠키 정책 초안과 production 의존성 고지 28건을 로컬 정책 페이지로 빌드한다. 수동 GitHub Pages workflow는 기본 브랜치·검사 통과·정확한 custom origin과 루트 base를 확인한 뒤 배포한다. [배포](m6-deployment.md)·[운영과 복구](m6-operations.md)·[보안](m6-security.md)에 적용 범위를 기록했다.

## 회귀·화면·무결성

| 검사 | 최종 결과 | 근거 |
| --- | --- | --- |
| 단위·통합 | 22파일 **866/866** 통과, 기존 822 + 신규 44 | [전체 요약](evidence/m6-workspace-verification.json), `npm test` |
| strict TypeScript·production build | 통과 | `npm run build`, [릴리스 증거](evidence/m6-release-verification.json) |
| 브라우저 전체 | 7파일 **101/101** 통과, 기존 80 + 신규 21 | [전체 요약](evidence/m6-workspace-verification.json), `npm run test:e2e` |
| 화면·접근성 관측 | **148관측** 통과, pageErrors 0 | [화면 증거](evidence/m6-design-verification.json) |
| 최종 정적 파일·보안 설정 | **53검사** 통과 | [릴리스 증거](evidence/m6-release-verification.json) |
| 의존성 취약점 조회 | 조회 시점 총 0 | [npm audit](evidence/m6-dependency-audit.json) |
| 원자료 대응표 보존 | 385행 추적, 중복 0, 원본 digest 불변 | `npm run verify:coverage`, [대응표](block-coverage.md) |

새 브라우저 21건은 지원·키보드·modal·백업 관리 12건, 실제 IndexedDB 복구·손상·quota·탭 충돌·초기화 6건, 실제 오프라인·대기 업데이트·불완전 설치 3건이다. 기존 도식 맞춤·마우스/Space·Scope 시간 범위·수학·데이터·계층·export 회귀를 포함한다. 저장 모델의 로딩 지연 시험은 요청 성공과 transaction 완료의 실제 순서를 보존하며 복원·맞춤·이후 사용자 이동 보존을 검사한다. 격리된 브라우저 context를 사용해 사용자 저장 모델을 바꾸지 않았다.

검정/차콜 다크·밝은 회색 라이트, 320/390/1024/1440px의 신규 지원·정책·백업·복구·로그·초기화 화면을 기존 관측에 추가했다. 200% 텍스트 확대·작은 화면에서 내부 스크롤을 유지하고 문서 가로 overflow를 검사했다. [다크 지원표](evidence/m6-sane-dark-1440-support-catalog.png), [라이트 백업 관리](evidence/m6-sane-light-1440-management-backup.png), [320px 정책](evidence/m6-sane-light-320-support-policy.png)을 확인했다. 이 관측은 접근성 인증이나 실제 사용자 조사 결과가 아니다.

현 엔진의 [M1](evidence/m1-regression-on-m6.json)·[M2](evidence/m2-regression-on-m6.json)·[M3](evidence/m3-regression-on-m6.json)·[M4](evidence/m4-regression-on-m6.json)·[M5](evidence/m5-regression-on-m6.json) 회귀를 이전 증거와 분리했다. 성공 fixture는 각각 4·15·28·18·30건이다. 독립 해석값·정수/유리수·행렬 잔차·전체 원시 표본을 비교하고 오류 위치·부분 결과·예산 실패를 확인했다. 정적·이산·연속의 import 없는 생성 코드를 strict ES2022로 검사한 뒤 실제 ESM으로 실행했다. 원자료 digest는 `cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7`이며 미구현 271행을 유지한다.

## 성능과 빌드 식별

[성능 원자료](evidence/m6-performance.json)는 Windows 11 `10.0.26200`, i7-13620H/논리 CPU 16개, RAM 약 63.7 GiB, Node 25.9.0, Chromium 153.0.8010.12, viewport 1440×1000의 로컬 production preview에서 측정했다. p95는 관측값의 nearest-rank이며 각 반복 수를 함께 공개한다.

| 측정 | 반복 | p95 | 계약 기준 |
| --- | ---: | ---: | ---: |
| 새 context 초기 로드·저장 준비 | 5 | **1,134.8 ms** | ≤3,000 ms |
| 같은 context HTTP cache·작업 공간 재로드 | 5 | **143.0 ms** | ≤2,000 ms |
| Node 100노드 compile + run | warmup 5 + 측정 20 | **13.9 ms** | 참고 관측 |
| Node 1,000노드 compile + run | warmup 5 + 측정 20 | **254.9 ms** | ≤1,000 ms |
| 실제 1,000노드 시간 실행 취소 | 5 | **349.0 ms** | ≤1,000 ms |
| UI 100노드 클릭→결과 | 8 | **368.0 ms** | 참고 관측 |
| UI 1,000노드 클릭→결과 | 8 | **3,956.3 ms** | 참고 관측, 화면 비용 포함 |

100노드를 30회 실행·저장한 뒤 최근 기록은 5개로 유지됐으며 강제 GC 뒤 JS heap 변화는 **−1,116,088 bytes**로 증가 ≤32 MiB 기준을 통과했다. pageErrors 0, 계약의 성능 예산 6개 모두 통과했다. 계산 체인의 원시 출력은 독립 `1.0001^(n−2)`와 상대오차 1e−12로 비교했다. long task 140개 관측을 원자료에 남겼다. Node 계산 시간과 UI 결과 표시 시간을 합쳐 같은 수치로 안내하지 않는다. 전체 프로세스 메모리·다시간 endurance·실제 모바일·공개 네트워크 성능은 측정하지 않았다.

최종 releaseId는 `543f87fe6f3f27669b8c564b334bcf52b5c2adb4cf61b5116f00fc701c122c01`이다. 정적 allowlist 9파일은 총 **1,427,854 bytes**, main `index-CenAUk6F.js`는 **886,199 bytes**(gzip 약 268.47 kB), Worker `engine.worker-C1YTkVI7.js`는 **256,885 bytes**, 지연 export `src-B6EAhC6Y.js`는 **154,680 bytes**다. Vite의 500 kB chunk 경고는 남아 있고 큰 도식의 화면 비용은 후속 최적화 항목이다. manifest는 번들링이 끝난 실제 파일을 읽어 생성하며 로컬 검사·성능 증거가 같은 releaseId를 가리킨다.

## 보안과 공개 출시 상태

보안 8개 영역을 검토했다. 새 복구 입력의 크기·키·버전·해시·구조 검증, 저장 CAS·원자적 복구·quota 오류, 최종 캐시 바이트 검증과 폐쇄된 로컬 로그 필드를 강화했다. 사용자 텍스트는 React escaping을 유지하고 수식은 제한 AST로 처리한다. 계정·서버 API·인증 쿠키·SQL·결제·원격 진단을 추가하지 않았다.

[보안 증거](evidence/m6-security-verification.json)의 앱/패키지/스크립트 93파일 패턴 검사와 수동 검토에서 확인된 취약점은 0건이다. 전체 원시 스캐너의 critical/high 10표시는 생성된 Playwright trace에 복사된 React 내부 코드였으며 별도로 분류하고 비공개 원시 기록을 보존했다. 패턴 검사·의존성 조회가 알려지지 않은 취약점 부재나 전체 과거 Git 이력 검사를 보장하지 않는다. 브라우저 결과·모델·개인정보를 자동 전송하지 않는다.

| 공개 출시 확인 항목 | 현재 상태 |
| --- | --- |
| 대상 저장소 접근·정적 배포 설정 | CLI 권한 확인, 검토용 변경 준비 |
| calcweave.com 소유 TXT·DNS·Pages custom domain | DNS ENOTFOUND, 현재 Pages custom domain 없음 |
| 실제 HTTPS·배포 파일·HTTP/Worker 응답 정책 | 미배포, [실제 주소 검사](evidence/m6-deployment-verification.json) 실패를 기록 |
| 문의 보유·호스팅 통신·국외 이전·정책 적용일 | 운영 사실 확인 전 초안 |
| 실제 초보자 F06 전체 과제·추가 브라우저/기기 | 관찰 미실시, Windows Chromium 검증 범위만 안내 |
| 클라우드 M6-C | 미선택 |

[호스팅 사전 조회](evidence/m6-hosting-preflight.json)에서 기존 Pages는 legacy/main 루트 소스였으며 이 버전을 배포하지 않았다. workflow는 정확한 calcweave.com origin과 빈 base를 확인하지 못하면 게시를 막는다. 실제 주소 검사는 모든 필수 경로와 로컬 릴리스 일치 결과가 있어야 성공한다. 공개 출시 판단은 이 남은 사실과 사용자 관찰을 확인한 뒤 갱신한다.
