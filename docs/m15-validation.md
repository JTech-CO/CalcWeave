# M15 실행 타깃·공유·외부 파일 검증

2026-10-03 · 앱0.16.0 · 엔진0.16.0-m15 · schema1. 기존337개 정의·75예제/12범주·source subset367/385·미구현18행을 유지하고 선택 범위의 로컬 engineering 검증을 완료했다. 실제 타깃 실행·전체unit3854개·외부 파일 UI9개·내보내기4개·root/project artifact·디자인·성능6개 예산·최종typecheck를 통과했다. 전체 browser의 최초188/189와 대기 assertion 조정 뒤 영향 범위1/1 PASS는 분리 기록한다. 공개 CI·배포 파일 parity·격리 공개 browser는 대기 상태이며 현재 검증된 공개 버전은 M12 앱0.13.0이다. [M15 계약](m15-contract.md)의 선택 범위만 검증 대상으로 삼으며 전체 원본 옵션 닫힘은0행이고 `fullSimulinkEquivalenceClaimed:false`다.

## 실제 코드 타깃 실행

| 타깃 | 완료한 선택 검증 |
| --- | --- |
| Python | 기존51개 보존·신규18개로69개 ID; 정의18+경계46의64raw,정상128모드와runtime 실패14를 합친 실제 Python/standalone TS142개씩,정상256표본·실패18건·대표 strict2개 |
| WASM |16개 ID;21raw·정상41모드·43표본·runtime 실패5개·target 거부10개;primary46개와JSON/역순 actual을 포함한 실제 host128개 |
| C/C++ | native toolchain/host ABI 실행 adapter unavailable;generator 실행 승인 없음 |

[Python 실제 보고서](evidence/m15-python-verification.json)는 실제 Python3.14.0의 `-I -B` 실행과 native·standalone TypeScript의 전체 표본/시간·held 상태·memory·실패/partial parity를 연결한다. 독립 literal 기대값을 사용하며 정수 코드·태그·문자열·boolean·signed zero는 정확 비교하고 유한 numeric parity는 scaled2e-12를 사용한다. [신규 unit104/104](evidence/m15-python-unit-results.json)와 [과거 Python 계약113/113 회귀](evidence/m15-m7-python-unit-regression.json)를 별도로 보존한다. 신규 typed 자료형은 scalar 및 ASCII용 uint8 rank1≤256이고 과거 legacy 배열·이산 상태 계약은 유지한다.

[WASM 실제 보고서](evidence/m15-wasm-verification.json)는 실제 `WebAssembly.Module/Instance`와 고정 runner의 전체 grid·intermediate 오류·native partial parity를 검증한다. 독립 literal 기준값·signed zero·물리 단위·공유 DAG·64노드 index63·16출력 경계와 실제 bytes/ABI/SHA·JSON/역순·defensive artifact copy를 확인했다. [unit59/59](evidence/m15-wasm-unit-results.json)는 변조 IR/bytes/manifest,자료형/rate/state/continuous/연산 상한 거부·취소·독립 재실행도 포함한다. 유한 numeric oracle/parity는 scaled1e-12이며 정수·signed zero·구조·진단 위치는 정확 비교한다. 평가 함수가 모든 중간 노드마다 전체 DAG를 실행하는 비용을 `instructionCount×callsPerTick×gridCount`로 실제 연산 예산에 포함한다.

C/C++는 PATH와 명시 compiler 경로의 읽기 전용 조사에서 실행 파일을 발견하지 못했으며 검증한 native generator/host ABI가 없다. 제한된 경로 조사를 전체 기기 설치 현황으로 일반화하지 않는다. 코드 emit만으로 지원이나 source 대응을 승인하지 않았다.

## 공유 패키지와 외부 형식

[root focused unit21/21](evidence/m15-package-export-unit-results.json)은 승인된7개 과거 엔진의 exact registry projection,현재 모델·native JSON,원본 서명/인증,별도 migration 검토를 확인했다. [통합 실제 실행 보고서](evidence/m15-verification.json)는 승인된7개 엔진의 원본 서명 검증·현재 compile,SLX/MDL/MAT3개 해석값 실행·원본 bytes 복구·archive 재분석·공유 semantic parity를 별도로 확인했다. 서명 적용 대상은 원본 payload이며 원본 bytes를 보관한다. 현재 엔진의 정규화/compile과 과거 엔진의 수치 동등성은 구분한다. focused unit은 전체 unit과 중복되는 범위로 별도 합산하지 않는다.

외부 MAT v5·SLX·MDL은 bounded parser와9종 root scalar 블럭 사본 변환을 선택 계약으로 둔다. [최종 focused unit73/73](evidence/m15-interop-unit-results.json)은 interop43개와 M13 data30개이며 의미 손실을 막는 Ref stub 내용·추가 attribute와−0 cell/literal/Inport 거부,모든 지원 블럭/파라미터·edge·MAT variable의 원본 위치와 convertedId 보존을 포함한다. [최종 UI 보고서](evidence/m15-interop-ui-verification.json)와 [실제 browser9/9](evidence/m15-interop-browser-results.json)는 별도 입력 검토·현재 모델 보존·명시 Inport·실제 Worker 실행·archive 복구와 dark/light 반응형 화면8개의 직접 시각 점검을 연결한다. flaky/skipped0이며 제품 소스는 최종 browser 뒤 변경하지 않았다. `.cwinterop.json`은 원본 SHA→재분석→모든 derived claim 비교로 복구하며 편집한 native 파일 생성과 MathWorks 수치 equivalence는 미지원/미검증이다. 자체 형식 fixture·해석값·CalcWeave Worker 실행을 MATLAB export/reference 실행으로 표현하지 않는다.

## 릴리스 게이트 상태

| 게이트 | 현재 상태 |
| --- | --- |
| Python 실제 실행·typed/string literal·원래 위치 진단 | 선택 범위 PASS;실제 보고서와 unit 원본 연결 |
| WASM 실제 실행·binary/ABI·whole grid·실패/partial | 선택 범위 PASS;실제 보고서와 unit 원본 연결 |
| 과거 registry/source/proof 보존 |337개 정의 불변;source subset367/385·missing18·전체옵션닫힘0 유지;[통합 보고서](evidence/m15-verification.json)의25개 protected artifact SHA·M10~M14 updater/roadmap/coverage 회귀 PASS |
| 공유·migration·interop 실제 통합 |21unit·7개 승인 엔진 migration·3개 외부 형식 해석값/원본 복구 PASS |
| interop focused·UI |73/73unit·9/9browser·화면8개 직접 점검 PASS;committed 실제 원본 연결 |
| 전체 unit |[3854/3854 PASS](evidence/m15-unit-results.json);focused 수치는 해당 전체 범위와 중복 |
| 이전 stage 실제 생성 회귀 |[M13 fresh361실행](evidence/m13-regression-on-m15.json)·[M14 fresh32실행](evidence/m14-regression-on-m15.json) PASS |
| 전체 browser |[최초189개 중188PASS/1FAIL](evidence/m15-browser-results.json)·flaky/skipped0;테스트 대기 제한 조정 뒤 [영향 범위1/1 PASS](evidence/m15-continuous-browser-results.json),제품 소스·계산 assertion 변경 없음 |
| 타깃 내보내기 browser |[4/4 PASS](evidence/m15-export-browser-results.json);실제 Python/TS/WASM artifact·미지원 이유·공유 UI |
| root/project artifact·오프라인 |[root83검사/14assets](evidence/m15-root-release-verification.json)·[project83검사/14assets](evidence/m15-project-release-verification.json) PASS |
| project path browser |[4/4 PASS](evidence/m15-project-browser-results.json) |
| 디자인·반응형 |[188관측·pageErrors0](evidence/m15-design-verification.json);실제 초보자 조사와 구분 |
| dependency audit·지원표 회귀 |취약점0·M10~M14 updater --verify·roadmap/coverage PASS |
| 단독 성능 |[최종6/6예산 PASS](evidence/m15-performance.json);실제 host 측정과 적용 범위를 구분 |
| 최종 typecheck·선택 engineering |[complete-selected-scope](evidence/m15-engineering-checks.json);최종 snapshot·PR·공개 CI는 별도 릴리스 기록 |
| 공개 CI·배포 파일 parity·격리 공개 browser | pending;현재 공개 M12 앱0.13.0 |
| 전체 Simulink 옵션·MathWorks 수치 동등성·실제 초보자 조사 | 미수행/미승인 |

전체 browser의 최초 실패는 M3 연속 실행 pause/resume의20000개 내부 step 결과를5초 안에 기다리던 assertion timeout이었다. snapshot은 계속 running 상태였고 제품 소스와 계산 기대값을 바꾸지 않은 별도 재검사에서도 통과했다. 해당 테스트만 전체 timeout60초·결과 metadata 대기30초로 기본 runtime active-wall 예산에 맞춘 뒤 최종1개를9.58초에 재검증했다. 최초189개를 한 번에 모두 PASS한 것으로 표시하지 않는다.

성능은 전체 browser 종료 뒤 단독 실행해6개 예산을 통과했다. cold P95 1334.59ms·warm P95 1042.35ms·1000노드 compile/run P95 468.20ms·취소 P95 696.62ms·retained heap −1076300B·pageErrors0이다. 측정한 Node/Windows/Chromium 환경을 실제 보고서에 기록하며 다른 기기의 보장으로 일반화하지 않는다. retained heap은 Chromium CDP 강제 GC 후 JavaScript heap이며 전체 프로세스 메모리나 장시간 운영 검증은 아니다.

## 원본과 보호 기준

M15는 canonical registry의 기존 exportTargets를 수정하지 않고 버전 있는 별도 target capability 목록으로 승인한 선택 구성만 표시한다. 실행 타깃69/16과 parser9종을337개 블럭·367개 source subset에 합산하지 않는다. 원본385행 배정표·원래 source 승인·과거 증거는 보존하며 전체 engineering 마감 뒤 fresh verifier는 동결한 보고서를 덮어쓰지 않고 현재 stage 회귀 파일로 분리한다.

| 보존 파일 | SHA-256 |
| --- | --- |
| [M14 registry337](baselines/m14-registry.json) | `711fcb2062a90dcebdc4b2265f3a8660aadb3d8f2c4ede0de436a4f768ce0b40` |
| [M14 source 승인](evidence/m14-source-approvals.json) | `f7bf8f2a18377afd4d151b1b5bbea6e6eb72396e5c66b97c9a1a5b138c40448a` |
| [M14 actual TS](evidence/m14-verification.json) | `6886130299827a0d52e99533c0b0cf0ea827e27b5bceb56ca687e18fa4954f65` |

공유 registry projection SHA와 위 full registry JSON SHA는 각각의 승인 대상이 다르다. 서명·migration 보고서·생성 manifest의 model/artifact hash도 구분한다. 생성 코드에는 inert bounded data만 포함하고 임의 callback/code/module upload를 실행하지 않는다. 파일/ZIP/XML/MDL/MAT의 자원·구조·원본 위치를 제한하고 HTML은 escaping하며 서버 API·DB·추가 개인정보·시크릿·외부 권리를 도입하거나 추정하지 않는다.

## 이전 타깃 검사와 배포 CI

첫 공개 CI는 M10의 uint64 source가 Python에서 미지원이라는 과거 부정 검사에서 실패했고 deploy는 수행하지 않았다. M15가 해당 scalar를 실제 지원하므로, catalog와 M8~M12의 역사 검사는 당시 승인한 `python-m7-v1`에 명시적으로 고정했다. 현재69개 지원은 M15의 별도142개 actual Python 검사로 확인한다. 생산 코드와 동결한 과거25개 자료는 바뀌지 않았다. 수정한 M10의 실제 TS209개/484표본과 M11의138개/419표본은 로컬에서 통과했다. 최종 전체 CI·공개 파일 검증은 후속 기록을 따른다. [첫 CI](evidence/m15-actions-initial-failure.json)·[타깃 계약 분리 증거](evidence/m15-ci-target-regression-fix.json).
