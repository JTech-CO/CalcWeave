# M10 자료형·복소수·고정소수점·n-D 구축 및 검증 기록

2026-10-03 KST · 문서 v1.0 · 로컬 앱0.11.0 · 엔진0.11.0-m10 · 모델schema1 · 상태: **선택한 범위의 로컬 engineering 완료**.

[M10 계약](m10-contract.md)에 따라 신규34개 정의와 명명10개 preset을 구현했다. 직전211개 definition 객체를 그대로 보존해 registry는245개다. 원본 firstWork38행·37개 이름 문자열, 등록 정의, preset 및 실행 fixture 수는 서로 다른 지표다. `complex.dot`은 기존08-009의 후속 확장이므로 M10 firstWork38행에 추가하지 않는다. 원본 전체 옵션과 MATLAB/Simulink reference 실행 동등성은 이번 결과로 승인하지 않는다.

최종 실제 TypeScript 보고서는 [m10-verification.json](evidence/m10-verification.json)에 있다. 독립 literal 기반59 raw fixture의176개 선언 모드 실행, 10 preset의30개 모드 실행 및 실패3개를 합쳐 **209개 생성 프로그램을 실제 실행**했다. 성공206개 실행의 전체484개 sample과 정적·이산·연속 fixed template3개의 strict TypeScript 검사를 통과했다. 정확 typed-cell 비교는4,011회다. 이 숫자는 반복 parity 비교를 포함한 비교 횟수이며 서로 다른 원소4,011개나 추가 registry 정의 수를 뜻하지 않는다.

compiler 단위83개, typed 값·runtime 단위154개 및 독립 수치 단위210개가 통과했다. 마지막 전체unit은 **38파일2,669/2,669 PASS(35.96초)**이며 이 부분집합들을 포함한다. 부분집합 수를 전체unit 수에 다시 더하지 않는다. 최종 `npx tsc --noEmit`도 통과했다. UI·browser·성능·배포 artifact 및 source 승인은 아래 증거로 확인했다. M10 구현은 공개0.13.0 통합 릴리스에 포함됐고 [공개 검증](pages-validation.md)을 통과했다. 이전0.11.0 artifact의 별도 공개 배포를 주장하지 않는다.

## 수치 검증 방법과 실제 생성 코드

[독립 fixture](../tests/m10-independent-fixtures.ts)는 기대 code·bit pattern·복소수 성분·표본·선택 상태를 production 계산 helper를 호출하지 않고 literal로 작성한다. [검증기](../scripts/verify-m10.ts)는 parse/compile/run을 수행한 뒤 import가 없는 TypeScript를 파일로 생성하고 ES2022 모듈로 실행한다. 정적·이산·연속 각 모드의 첫 실제 프로그램은 `strict:true`, ES2022, `lib.es2022.d.ts`, `types:[]`, `noEmit:true`로 검사한다. 따라서 **strict 개별 검사 프로그램 수는3개**다. 나머지206개가 별도로 strict semantic typecheck를 받았다고 기록하지 않는다. 모든209개 프로그램은 각각 import-free AST·syntax/transpilation 검사와 실제 실행을 거친다. 각 성공 entry의 `strictProgramIndividuallyChecked`에 개별 strict 실행 여부를 남긴다.

dtype·shape·fixed scaling·enum metadata, integer/fixed decimal code, IEEE special tag, 문자열 및 boolean은 정확 비교한다. binary32 결과는 `Object.is`로 비교하며 binary64/complex의 유한 성분만 `abs(actual−expected)/max(1,abs(expected))≤3e−12` 규약을 사용한다. 0과 binary64 subnormal은 이 tolerance로 통과시키지 않고 정확 비교한다. `'-0'`, `'NaN'`, `'Infinity'`, `'-Infinity'` 태그도 정확 보존한다. 임의 NaN payload의 보존을 이 검사로 승인하지 않는다.

성공 실행의 전체 sample-series와 출력 시간 grid·steps를 검사하고, 생성 코드와 브라우저 runtime의 전체 `samples`, held `finalState`, 내부 `stateMemory` 및 나머지 실행 계약을 비교한다. 실행 시간과 자원 관측값은 엔진·생성 코드 parity 계약에서 제외한다. literal finalState/stateMemory가 있는 fixture는 전체 상태 객체를 독립 기대값과 비교하며, 모든 fixture가 독립 내부 상태 oracle를 갖는다고 주장하지 않는다. JSON roundtrip과 역순 node/edge 삽입도 semantic key 및 전체 실행 계약을 유지한다. export manifest는 정확 비교하며 TypeScript target은 `typescript-m10-v1`이다. M10 신규 node의 미지원 Python export는 원본 node를 식별하는 진단으로 확인한다.

## 실제 확인한 선택 경계

- 15개 dtype을 tagged flat row-major wire로 다룬다. 모든 integer/fixed 폭의 저장 code는 canonical decimal 문자열이며 int64 최솟값과 uint64 최댓값, 2^53을 넘는 값도 유지한다. 기존 finite float64/boolean 계산 블럭으로 들어가는 typed 신호는 명시 `signal.to-legacy` 경계를 요구한다. 손실 변환은 진단으로 중단한다.
- scalar rank0부터 rank8, 축 및 원소 최대1,024의 고정 형상을 선언한다. reshape의 원소 수는 논리 shape의 곱이며 저장 예산 가중치와 구분한다. rank8 reshape·permute·squeeze와 전체 singleton의 scalar 변환을 독립 값으로 검사했다. variable-size, 빈 배열 및 일반 heterogeneous nested bus는 후속이다.
- cast의 real-world-value와 stored-integer 모드를 구분한다. rounding 여섯 가지의 음수 tie와 wrap/saturate/error 경계, fixed stored product의 연산별 양자화, binary32 두 연산의 단계별 반올림을 검사한다. stored-integer 변환을 IEEE reinterpret로 처리하지 않는다.
- IEEE32/64 sign·exponent·fraction·raw bit 추출은 별도 DataView 경로다. integer↔bits의 MSB/LSB·선택 폭과 입력 폭 기준 signed 해석을 구분한다. arithmetic shift의 양수는 오른쪽 bit shift이며 binary-point shift의 양수는 SI를 유지하고 FL을 줄인다. SI±1 preset은 `overflow:'wrap'`을 명시한다.
- Data Type Duplicate는 실제 dtype·fixed·enum metadata 제약이다. Propagation은 Ref1/Ref2 metadata에서 직접 연결된 propagated cast로 실제 backward constraint를 적용한다. 지원되지 않는 전파 경로·충돌·순환·미해결은 진단하며 일반 upstream graph 전파를 승인하지 않는다. Unit System은 허용 단위의 실제 compiler scope 제약이다.
- 복소수 rectangular/polar 변환의 signed-zero branch, 켤레 전치, 실수 대각선을 요구하는 Hermitian 검사 및 내적의 기본 first-input conjugation을 확인했다. Hermitian tolerance0의 정확 검사와 별도 tolerance 옵션을 구분한다. complex fixed/single 및 모든 원본 알고리즘 bit parity는 후속이다.
- fixed Sine/Cosine은 normalized turns의 quarter-wave LUT 독립 선택 대체다. WL2~53·FL=WL−2·N2~min(1,024,2^(WL−2)+1), stored-code table·선형 보간·선택 rounding을 선언한다. WL4/FL2/N2의1/8 turn sineSI=2와 N3 tie-even·periodic code를 검사해 단순 `sin` 결과의 마지막 양자화와 구별한다. 원본 Speed/Precision의 내부 bit pattern과 동일하다고 승인하지 않는다.
- fixed State-Space는 동일 fixed metadata의 A/B/C/D·IC·입력, 상태/입력/출력 축 각각1~8 및 매 product/add의 선택 양자화로 범위를 정한다. 독립 표본 SI=[2,5,7,8], 마지막 held `finalState` SI=8과 내부 `stateMemory.value` SI=7을 구분한다. changing continuous 입력의 quantizing cast·bit/fixed 경로는 `TYPED_CONTINUOUS_BOUNDARY_REQUIRED` 진단으로 held 경계를 요구한다. constant와 이미 held된 입력 및 명시 legacy 경계를 통과한 smooth 경로를 별도로 검증한다.

## 실패 진단과 원자적 rollback

실패3개는 성공206개 mode 실행과 별도로 센다. uint64 `'9007199254740993'`의 legacy 변환은 `TYPED_LEGACY_PRECISION_LOSS`, uint64 최댓값의 uint8 error cast는 `TYPED_OVERFLOW`를 원본 `operation` node에서 진단한다. fixed state의 두 번째 row가 overflow하는 fixture도 `TYPED_OVERFLOW`로 중단한다. 이미 계산한 첫 row를 commit하지 않으며, 부분 결과1개 sample·held output SI=[1]·내부 상태 SI=[1,100]을 전체 literal 객체와 비교한다.

실제 생성 TypeScript가 같은 원본 node 진단과 전체 partial result·finalState·stateMemory를 제공하는지 검사했다. 실패 모델의 JSON roundtrip과 역순 삽입도 같은 진단 및 partial 계약을 유지한다. 이3개 fixture가 모든 예외 조합·매 tick 및 모든 rollback 구조를 포괄한다고 해석하지 않는다.

## 증거와 보존 digest

원자료385행·339개 이름 및 immutable catalog baseline을 유지한다. 기존211개 definition 객체는 [M9 registry baseline](baselines/m9-registry.json)과 `deepEqual`로 확인했다. digest는 이 초안 작성 시점의 파일 정본이며 이후 검증 재실행이나 승인 갱신 시 해당 기록과 함께 갱신한다.

| 파일·검증 | 결과 또는 SHA-256 |
| --- | --- |
| 원자료 `Simulink_Basic_Blocks_R2024b.md` | `cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7` |
| `docs/baselines/m9-registry.json` | 211개 unchanged; `a16262a3f9ebb74156f2896d3b11019ec5dafbbd65b0ea0deab9470f6eeda6b4` |
| `docs/evidence/m10-verification.json` | 생성 시각 `2026-10-03T03:39:59.002Z`; `659a11814e1420f217068f4cab4c6726cd3070154f69fd1064afd3a4aee52e6d` |
| `.test-generated/m10-verification-run.log` | actual TS209·strict3·samples484·exact typed-cell comparisons4,011 PASS |
| `.test-generated/m10-compiler-tests.log` | compiler83/83 PASS(1.83초) |
| `.test-generated/m10-independent-test.log` | independent210/210 PASS(5.23초) |
| `.test-generated/m10-final-unit.log` | 전체37파일2,658/2,658 PASS(47.38초) |
| `.test-generated/m10-final-typecheck.log` | 최종 `npx tsc --noEmit` exit0 |

## engineering 종료와 공개 배포 상태

아래 상태는 수치 검증과 별도의 단계 gate다. ROOT가 실제 결과를 보완할 때 각 항목의 마지막 수정 이후 증거·대상 앱/엔진 버전·관측 범위를 연결한다. source 행별 승인에는 [구현 맵](m10-implementation-map.json)의 원본 identity, canonical/필수 설정, 지원 모드·target 및 위 actual fixture를 사용한다. source 승격은 실행 검증이나 registry 개수만으로 대신하지 않는다.

| 필드 | 최종 로컬 상태 | 증거·범위 |
| --- | --- | --- |
| sourceRowApprovals | PASS | 38 firstWork 행의 선택 범위 승인; coverage 245/385, missing140; 전체 옵션38행 모두 open |
| uiBrowser | PASS | M10 실제 UI7개; 전체 루트 실행에서도 동일7개 통과 |
| fullBrowser | resolved | 첫 루트138개 실행135 PASS. 출력 폴더 충돌2개와 확장된 검색 기대값1개 수정 후 관련21개 모두 PASS. 단일 전체 실행138 PASS로 기록하지 않음 |
| designObservations | PASS | 188관측, pageErrors0; m10-design-verification.json |
| localPerformance | PASS | 6예산 통과; cold p95 1101.9864ms, warm955.8478ms, 1000node116.4304ms, cancel256.9781ms, retained heap−1112572B |
| rootProjectRelease | PASS | 각70검사/12파일; root2093388B SHA b1855e111a91d32dfb4abef30f9713384d8c0e0ca565590fe6cb5bc654c8d6ab; project2093638B SHA129b1d65e51195bf726213bed478434151928e18d1cd64002066336a08d29ac6 |
| projectBrowser | PASS | /CalcWeave/ 실제4개 모두 assertion 통과. Windows webServer 종료 대기 후 root build 복원 및 동일 hash 재확인 |
| publicDeployment | included in verified0.13.0 combined release | M12 Actions·정확한 project artifact parity·공개9검사 PASS; 이전0.11.0 artifact 별도 배포를 주장하지 않음 |
| engineeringMilestoneStatus | complete selected scope | 독립 수치/actualTS/단위/UI/성능/artifact/행별 선택 승인 증거를 동결 |
| fullServiceLaunch | false | 기존 초보자 관찰·도메인·운영 확인 사항 별도 |
| fullSimulinkEquivalenceClaimed | false | 원본 전체 옵션·MathWorks reference·추가 target 후속 |

저장/가져오기의 typed history는 dtype·shape·fixed/enum metadata 일치를 검증하고 문자열 포함 가중 저장 예산을 적용한다. 사용자 입력을 eval하거나 HTML로 렌더링하지 않으며 계정·API·DB·결제·추가 개인정보 처리는 없다. 보안8항목 중 적용되는 입력·출력·시크릿·저장 경계를 재확인했다.

M10 소스와 증거를 동결한 다음 M11 구현을 시작한다. M11·M12는 동일하게 선택한 실행 범위와 열린 원본 전체 옵션을 구분한다.
