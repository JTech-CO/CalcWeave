# M8 수학·배열 옵션 구축 및 검증 기록

2026-10-03 KST · 문서 v0.3 · 앱0.9.0 · 엔진0.9.0-m8 · 모델 schema1 · 상태: **검토된 선언 범위 검증 완료(`verified-declared-scope`)**.

[M8 계약](m8-contract.md)의 검토된 최초 납품은 41개 정의(신규 기능용29개와 기존 옵션용12개)와8개 명명 preset이다. 기존144개와 합한 registry는185개이며, mode 선언별로 정적148·이산172·연속185개다. 이 선언 수는 모든 연속 solver 경로나 원본 전체 옵션 지원 수가 아니다. 불연속 값 선택을 ODE 상태 앞에 놓는 경로처럼 compiler가 명시적으로 거부하는 조합은 유지한다. Python 승인51개 범위도 유지하며 새 M8 정의는 TypeScript를 제공한다. 예제는 신규3개를 포함해35개·6개 카테고리다.

현재 문서는 최초 통과 기록, 독립 검토에서 발견해 수정한 오류, 수정 이후 확인 범위를 구분한다. 수정 후 실제 TypeScript·전체 단위 검사·영향받은 브라우저·빌드·source 승인 검사가 모두 통과했다. 완료 범위는 검토된 M8 engineering 납품이며 원본 전체 옵션 완료와 별개다.

## 원본행과 납품 범위

M8 firstWork 배정은107행이며 baseline의 기존 subset61행과 미구현46행이다. 107행은 이번 최초 납품에서 원본의 모든 옵션을 동시에 끝내야 한다는 뜻이 아니다. [구현 맵](m8-implementation-map.json)은 각 행의 이름·subgroup·조건·행 번호·canonical·baseline 상태를 보존하며, 검토된 `deliveryGate`와167개 추가 `optionInventory` 후보를 나누어 기록한다. 선택되지 않은 실현 가능한 실수·2D 옵션은 M8-followup으로 열린 상태를 유지한다. 자료형·복소수·일반 n-D/variable-size 신호 등은 명시한 후속 계약을 따른다.

원자료 전체385행·339이름과 SHA-256 `cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7`는 그대로다. immutable [catalog baseline](baselines/catalog-block-coverage.md)은134개 subset·미구현251행이다. [source 승인 근거](evidence/m8-source-approvals.json)에 따라 신규46행을35개 계산 subset·9개 preset subset·2개 독립 대체로 승인했으며, 현재 [대응표](block-coverage.md)는 subset180행·미구현205행이다. 같은 이름의 다른 문맥도 원본 ID별로 보존했고 원본 전체 옵션을 승인한 행은 없다.

Find Nonzero의 입력 원소수 폭 padded 출력은 native variable-size 출력과 다른 독립 대체다. Wrap To Zero는 공식 문서의 threshold equality 충돌을 해소했다고 주장하지 않고 gt/ge 선택을 명시한다. rank≤10의 parameter lookup table을 scalar query로 조회하는 동작은 일반 n-D 신호를 지원했다는 뜻이 아니다. row-major direct lookup, 고정 완전 순열, scalar 마찰 계수 등도 선언한 제한 범위를 따른다. R2024b exact parameter inventory와 실제 Simulink 실행 동등성은 확인하지 않았다.

Gap의 선언 API는 설정한 내부 구간의 여집합이다. 내부 `closed`이면 끝점이 gap에서 유효하지 않고, 내부 `open`이면 끝점이 gap에서 유효하다. 원본 Inclusive lower/upper는 유효한 외부 집합의 끝점 포함을 뜻하므로 `on`→CalcWeave gap `open`, `off`→`closed`로 각각 반전해야 한다. 현재의 strict outside fixture를 R2024b reference equality 또는 옵션 값 동일성의 증거로 쓰지 않는다. [공식 설명](https://www.mathworks.com/help/simulink/slref/checkstaticgap.html)과 [M8 변환 계약](m8-contract.md)을 따르며 native 전체 동등성은 false다.

## 검증 상태

| 검사 | 최초/기존 확인 결과 | 수정 후 최종 상태 |
| --- | --- | --- |
| 전체 단위·통합 | 최초1,728 PASS | 수정 후29파일1,746/1,746 PASS, 40.21초 |
| M8 raw oracle·실제 독립 TypeScript | 116fixture·812raw samples·352actual programs PASS | 120fixture+8preset·896raw samples·388actual programs PASS, 3strict modes·4failure parity |
| 명명 preset | 8preset×3mode, 24actual programs·56raw samples PASS | 최종 M8 통합 실행에24preset mode 기록 포함, 위896/388에 합산되어 있음 |
| 기존 catalog 회귀 | 71fixture·559raw samples·212actual TS programs PASS, registry185 | 해당 독립 회귀 기록 및 최종 전체 단위 회귀 PASS |
| 수정된 경계 수치의 독립 재검증 | 아래4probe×3mode의 모든 표본 정확 비교 PASS | 12경로의 JS compile/run 및 최종 standalone TS oracle 모두 PASS |
| 전체 브라우저 | 122/124 PASS, 5.6분; Constant selector 모호성2건 실패 | exact 영어 selector 교정 후 영향받은2/2 PASS, 9.1초; 미해결0 |
| strict typecheck·production build | 최초 PASS | runtime/TS template 수정 이후 최종 build PASS |
| 정적 파일·릴리스 계약 | 최초70checks·12files·1,718,756bytes PASS | 최종70checks·12files·1,720,775bytes PASS |
| 자동 패턴 검사 | packages50·apps35·scripts30, medium 이상0건 | 조회/검사 당시 결과; 전체 보안 부재 보장 아님 |
| source inventory 보존 | M8 107(61/46)·M9 58(27/31), 누락·중복0, digest 불변 PASS | `update-m8-coverage --verify`·`verify:coverage`·`verify:roadmap` PASS |

수정 후 수치 근거는 [M8 검증](evidence/m8-verification.json)에 있으며, 독립 [preset 실행](evidence/m8-presets-verification.json)과 [catalog 회귀](evidence/catalog-regression-on-m8-verification.json)도 보존한다. 최종 M8 보고서의120fixture와24preset mode 기록을 현재 코드·preset 설정과 정확히 일치시킨 `update-m8-coverage --check`가 통과했다. 각 파일의 `generatedAt`, fixture 목록과 결과 수는 해당 실행 시점의 기록이다. 이전 catalog와 M0~M7 증거는 별도로 보존한다.

최종 [릴리스 증거](evidence/m8-root-release-verification.json)의 releaseId는 `31ca5076723d3e6299812ed32369c2160e85f5fe5420277b1cdea7fc7a303bac`이다. `/` 정적 파일12개의 바이트/hash와70개 검사를 통과했다. 이는 로컬 build 검증이며 공개 사이트 배포를 수행했다는 뜻은 아니다.

M8 검증은 literal 수학 oracle로 모든 선언 모드의 raw sample을 비교하고 actual standalone ES2022 ESM을 실행한다. JSON roundtrip·삽입 순서 독립성·manifest·원본 노드의 오류 위치도 확인한다. 숫자는3e−12×max(1,|expected|)의 기준을 적용하며, 비영 subnormal oracle는 정확히 비교한다. boolean·형상·키 집합은 정확 비교다. 이 수치 기준은 실제 MATLAB seed sequence나 모든 연산의 비트 동일성을 보장하지 않는다.

## 독립 검토에서 수정한 경계

| 재현 | 수정 전 | 수정 및 독립 재검증 |
| --- | --- | --- |
| `lookup.interpolate-prelookup`, 표[MIN_VALUE,2×MIN_VALUE], index0, fraction0.5 | 두 가중 항의 개별 underflow 때문에 MIN_VALUE | subnormal scaling 후 최종 반올림; 정확한2×MIN_VALUE |
| `lookup.nd`, 두 축[0,1], row-major 표[0,MAX_VALUE,1,1], query[1,2], linear/extrapolate | 첫 축의 weight0 가지를 계산하다 overflow 오류 | exact upper knot에서는 필요한 upper 가지를 평가; 정확히1 |
| `matrix.square`, 33개/1024개1 벡터 | compiler 통과 후 행렬 helper의32행 제한 오류 | 벡터 Gram 내적 경로로 정확히[[33]]/[[1024]] |

이 세 문제에 대해 구현 담당자는 신규4fixture와3모드의 exact assertion을 추가했다. 독립 검토자는 같은 네 입력을 실제 `compileModel`→`runModel`로 실행해 정적1표본·이산3표본·연속3표본에서 각각 정확한 값을 확인했다. 구현 담당자의 M8+catalog targeted527tests와 typecheck도 통과 보고를 받았다. 수정 후120fixture+8preset의 생성 템플릿·actual standalone TS parity와 최종 전체 단위1,746개 검사는 모두 통과했다.

## coverage 승인과 최종 종료 조건

`scripts/update-m8-coverage.ts`는 원본 identity와 실행 증거를 결합해 **선언된 subset만** 승인해야 한다. preset의 설정·연산 variant·실행 모드가 일치하는 fixture를 확인하며, 일반 card가 하나 존재한다는 이유로 source의 모든 옵션을 승인하지 않는다. 승인된 행에도 `nativeFullEquivalent=false`와 열린 후속 옵션을 남긴다.

수정 후120fixture의 모든 모드·8preset의 실제 TS 실행, 전체 단위 검사, 영향받은 브라우저 및 최종 production build/release 검사는 통과했다. source46행의 승인 근거·대응표 일치, 385개 원본행·조건·digest 보존도 확인했다. 최초 브라우저 전체 실행122/124와 영향받은 재실행2/2는 서로 다른 기록이며 단일 전체 실행124/124 PASS로 합쳐 쓰지 않는다.

납품 범위의 engineering 검증이 통과해도 원본 전체 옵션과 후속 M10~M16는 자동 완료되지 않는다. 공개 배포·도메인 소유·실사용자 조사·모든 브라우저/기기 검증을 수행했다는 주장도 이 기록에 포함하지 않는다.
