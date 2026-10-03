# CalcWeave M15 실행 타깃 계약

M15는 기존337개 블럭 정의와 선택 source367/385행을 보존하면서 실제 실행 타깃을 확장한다. 타깃 capability는 버전 있는 별도 목록으로 관리하며 과거 canonical 정의의 exportTargets를 수정하지 않는다. 원본31개 실행·코드 생성 옵션의 전체 동등성이나 검증하지 않은 compiler 환경은 지원 완료로 표시하지 않는다. Python·WASM 실제 host 실행·외부 파일 UI·artifact·디자인·성능을 포함한 선택 engineering 검증과 공개0.16.0 통합 배포를 완료했다. 로컬 browser 최초188/189·영향1/1 재검증과 최종 공개 CI의189/189를 구분한다. 실제 결과는 [검증 기록](m15-validation.md)·[engineering 기록](evidence/m15-engineering-checks.json)·[공개 통합 증거](evidence/m15-public-release.json)에 연결한다.

## 타깃과 외부 의존성

| 타깃 | 실제 선택 범위 | 호스트·의존성 | 불가 범위 |
| --- | --- | --- | --- |
| TypeScript | 현재 승인된337개 정의의 기존 실행 계약 | ES2022 host, 고정 import-free 런타임 | 각 블럭·solver의 기존 미승인 옵션 |
| Python | 기존51개와 문자열15개·source.typed/source.enum/source.signal의 선택 구성; 별도 versioned allowlist | Python 표준 라이브러리와 선택 numeric/typed helper | 연속 solver·bus/messages·complex·일반 n-D·하위 실행·native 어댑터 |
| WASM |16개 ID의 유한 legacy float64 scalar root DAG,정적·base tick 이산 | WebAssembly Core1 Module/Instance·SHA-256 host crypto,별도 C compiler 없음 | 상태·typed/boolean/배열·연속·하위 정의·Dataset·live Dashboard·선택 밖 옵션 |
| C/C++ | 실행 승인 없음,unavailable metadata와 명시 진단 | native compiler/linker·실제 host ABI·build/run parity·별도 소스 권리 필요 | 코드 emit만으로 지원 승인하지 않음 |

C/C++ 조사에서는 PATH의 clang/clang++/gcc/g++/cl/cmake와 명시적인 LLVM/MSYS/MinGW 경로에서 실행 파일을 발견하지 못했다. Visual Studio2022 디렉토리는 비어 있고 VC/Tools/MSVC/cl.exe도 발견되지 않았다. 이 검사는 프로젝트 host의 제한된 읽기 전용 경로 조사이며 전체 기기의 모든 설치나 사용자의 외부 컴퓨터 상태를 판정하지 않는다. 현재 실행 어댑터를 구현·검증하지 않은 C/C++는 `NATIVE_TOOLCHAIN_UNAVAILABLE`로 표시한다. 도구 설치·임의 외부 소스 실행·추정 license 승인으로 범위를 넓히지 않는다.

## Python 선택 자료형과 실행

`python-m15-v1`의69개 ID는 과거51개 타깃 계약에 문자열15개와 `source.typed`·`source.enum`·`source.signal`을 더한 별도 allowlist다. 과거51개 legacy scalar/vector/2D 및 이산 상태 계약은 보존한다. 신규 typed 경로는 scalar string·boolean·float32/float64·int8..64/uint8..64·fixed·enum과 ASCII용 uint8 rank1/길이256이하만 지원한다. typed bus/messages·complex·일반 n-D·연속 solver·하위 실행·native 어댑터는 원래 노드 위치를 가진 명시 진단으로 거부한다. `source.signal`의 legacy 배열 구성은 기존 legacy 경로로 검증하므로 신규 typed scalar 제한과 구분한다.

고정 표준 라이브러리 실행 코드와 bounded hex JSON 데이터만 생성하고 임의 사용자 코드·callback을 실행하지 않는다. Python3.10이상 host가 필요하며 이번 실제 실행 host는 Python3.14.0이다. 표준 dtype metadata·정확한 정수/고정소수점 코드·string·enum label·float special tag와 signed zero를 보존하고 선택 string formatter/parser의 M13 계약을 따른다. MATLAB/C printf의 모든 옵션·반올림·경고 동등성은 주장하지 않는다. 실제 실행 증거는 [Python 보고서](evidence/m15-python-verification.json)에 기록했다.

## 공유 패키지 migration과 신뢰

schema1과 기존337개 canonical 정의를 보존한다. 과거 패키지는 `0.10.0-m9`·`0.10.1-m9`·`0.11.0-m10`·`0.12.0-m11`·`0.13.0-m12`·`0.14.0-m13`·`0.15.0-m14`의7개 명시 엔진 식별자와 동결된 port/parameter registry projection SHA가 일치하는 경우만 migration 후보로 읽는다. 현재 `0.16.0-m15` 모델과 native JSON 읽기도 유지한다. 이 projection hash는 전체 registry JSON snapshot hash와 다른 지표이며 버전 범위를 추정해 승인하지 않는다.

원본 payload integrity·서명 검증이 migration보다 먼저다. 서명은 원본 payload에만 적용하며 원본 bytes를 보관한다. 정규화된 모델 hash·현재 semantic hash·현재 compile 여부를 별도로 보고하고 사용자 migration 검토와 기존 출처 authorization·별도 fingerprint 확인을 거쳐 수락한다. 옵션을 임의 강제 변환하지 않고 미확인 엔진·변조 registry·현재 compile 오류는 진단한다. `numericalParityWithOriginalEngineVerified:false`를 유지하므로 현재 엔진으로 읽혔다는 사실이 과거 엔진과의 수치 동등성 승인은 아니다.

## 외부 MAT v5·SLX·MDL 분석과 원본 archive

profile은 `calcweave-native-scalar-v1`이다. 읽기 전용 bounded parser가 구조·미지원 항목·원본 member/offset/line/path를 보고하고 선택 구성만 CalcWeave 사본으로 변환한다. MATLAB/Simulink를 실행하거나 외부 callback·workspace 표현식·사용자 소스 코드를 실행하지 않는다. 파일명·ZIP 경로는 데이터이며 파일시스템이나 네트워크 경로로 사용하지 않는다.

| 경계 | 선택 계약 |
| --- | --- |
| 입력·확장·archive | 입력2MiB,raw/compressed MAT 포함 aggregate expanded8MiB,`.cwinterop.json`5MiB 이하 |
| ZIP/XML/MDL | 최대64 ZIP entries; ZIP64·encryption·overlap·traversal 거부; depth32·nodes100000·issues2000 이하 |
| MAT v5 | 최대64변수; dense real mxDOUBLE 유한2D 표만;2..4000행·시간 포함2..16열·20000 cells 이하 |
| MAT 시간·단위 | 첫 열은 엄격 증가하는 초 단위 시간·절댓값1e9 이하,신호 열 단위1; column-major→표 변환 |
| SLX/MDL 블럭 | root scalar Constant/Gain/Sum/Product/UnitDelay/Integrator/Scope/Inport/Outport9종의 선택 구성 |
| 실행 설정 | 명시 finite Inport 값,선택 fixed-step ode4 연속; UnitDelay는 base fixed step 또는−1; mixed state·미확인 execution fields 미지원 |
| 의미 손실 방지 | JSON으로 정확히 보존할 수 없는−0 literal/Inport/MAT cell 미지원; SLX Ref stub의 text·children·추가 attrs 거부 |

`.cwinterop.json`은 filename/format·canonical base64 원본·byteLength·SHA·입력 선택·분석 보고서,모든 지원 블럭/파라미터·edge·MAT variable의 원본 위치와 convertedId,선택 converted model/semantic hash 또는 Dataset/hash를 보관한다. 복구는 원본 SHA를 검증한 뒤 다시 parse하고 저장한 모든 derived report/model/hash/location을 비교한다. 원본 bytes의 정확한 복구·다운로드만 native round-trip 승인 범위다. 편집한 모델의 SLX/MDL/MAT 생성은 `editedNativeModel:'not-supported'`이며 `numericalEquivalence:'unverified'`다. 자체 작성 형식 fixture와 해석값의 실제 Worker 실행은 parser/CalcWeave 사본의 증거이며 MathWorks export나 reference execution 증거가 아니다. 이 분석으로 원본385행의 source 상태나367개 선택 승인 수를 승격하지 않는다. [최종 UI 증거](evidence/m15-interop-ui-verification.json)는 실제73unit·9browser와 직접 검토한 반응형8화면을 연결한다.

## WASM 정의와 ABI

공용 API는 `WASM_TARGET`, `getWasmDiagnostics(compiled)`, `generateWasm(compiled):Uint8Array`, `createWasmManifest(compiled,bytes)`, `generateWasmRunner(compiled,bytes,manifest?):string`이다. 생성기는 원본 모델을 다시 compile해 전체 IR snapshot 일치를 확인한다. supplied bytes와 manifest도 그 모델에서 실제 생성한 byte/metadata와 정확히 일치해야 하며 외부 WASM importer가 아니다.

| ABI 항목 | 고정 계약 |
| --- | --- |
| target version | wasm-m15-v1 |
| module export | evaluate(valueIndex:i32,time:f64) → f64 |
| valueIndex | compiler 위상 순서의 nodeIds index; host는0..N−1만 호출 |
| time | startTime+tick×step의 실제 절대 시각 |
| output ports | legacy float64 scalar; compiler descriptor의 물리 단위를 manifest에 정확히 보존 |
| module sections | type/function/export/code만; version1 binary |
| instructions | local.get/local.set,f64.const,선택 f64 비교·abs/neg/sqrt/add/sub/mul/div/min/max,i32.const/eq,select,end |
| capability | imports/memory/table/globals/start/loops/calls/network/filesystem 없음 |
| state·sampling | 저장 상태 없음; 모든 노드 period1/offset0; 최종 표본 이후 추가 갱신 없음 |

WASM 모듈은 각 노드를 로컬에 한 번만 emit한다. 공유 선행 도식을 출력마다 재귀 전개하지 않는다. Core1의 단일 f64 반환으로 모든 중간값을 확인하기 위해 host가 같은 함수에 각 node index를 요청하므로 N번 호출은 전체 DAG를 N번 실제 계산한다. 이 중복을 감추지 않고 `emitted instructionCount × callsPerTick × gridCount`를50m 연산 예산에 선검사하고 실제 호출마다 차감한다.64개 노드와10000 interval이라는 개별 상한을 만족해도 전체 연산 상한을 초과하면 명시 진단으로 거부한다.

## WASM 선택 연산

| ID | 실제 지원한 옵션 |
| --- | --- |
| source.constant / io.input | 모델에 저장한 유한 숫자 scalar 고정 입력 |
| source.clock | 이산 절대 시각·단위s 보존 |
| source.step / source.ramp | 기존 유한 파라미터와 due grid에서의 실제 변화 |
| math.gain / math.sum | scalar gain·Sum 네 가지 부호 |
| math.multiply | multiply와divide; 제수0 명시 실패 |
| math.abs / math.sqrt | IEEE f64 절댓값·비음수 제곱근,부호 있는0 보존 |
| math.minmax | min/max와scalar pairwise/reduce |
| math.function | square/reciprocal만; exp/log/log10 미승인 |
| sink.display / sink.scope / io.output | 전체 관측 grid의scalar 결과 |
| io.terminator | 신호를 평가하되 결과 기록 대상으로 추가하지 않음 |

Clock·Step·Ramp는 원래 블럭의 실행 모드 제한도 적용되므로 정적 모델에 억지로 추가하지 않는다. 물리 단위는 compiler 검증 결과를 보존하고 별도 자동 변환·재해석을 하지 않는다. unit.convert와 일반 수식 AST는 현재 WASM allowlist 밖이다. 실행 중 volatile 입력·사용자 callback·모듈 bytes/URL·임의 소스 파일을 받지 않는다.

최대64노드·16기록 출력·64KiB binary·10000 tick interval·1000000 시간/결과 원소·50000000 실제 instruction work·30000ms active wall 제한을 적용한다. runner는 내부의 고정 bytes만 instantiate하고 SHA-256·imports0·단일 export ABI를 확인한다. runner.mjs에는 네트워크/파일시스템 import가 없으며 사용자 ID/파라미터는 UTF-8 hex data로 저장한다. 실제 intermediate node 값의 정의역·나눗셈0·유한성 실패를 원래 nodeId/tick/time에 표시하고 실패 표본은 append하지 않는다. partialResult는 앞서 완료한 전체 표본·빈 상태를 보존한다. static native 오류가 tick/time을 생략하는 경우 WASM은0/startTime 위치를 명시한다.

## 증거·권리와 미승인 범위

독립 literal fixture,실제 Node WebAssembly.Module/Instance,전체 시간축·intermediate 오류와 native partial parity,deterministic bytes·실제 binary SHA·JSON/삽입 역순·defensive artifact copy·manifest 일치를 검증한다. 실행 원본과 실제 host byte identity를 [WASM 증거](evidence/m15-wasm-verification.json)에 연결하며 전체 target의 source 옵션 수와 registry 블럭 수를 합산하지 않는다. 전체 원본 실행 동등성은 false다.

WASM 실제 검증은21개 raw 모델의41개 정상 모드·43개 정상 표본과5개 runtime 실패·10개 target 거부를 포함한다. 정상41개와 실패5개의 primary46개를 실제 실행했고 정상 모델의 JSON 왕복·역순 삽입을 별도 실행해 실제 module/runner128개를 확인했다. [타깃 unit 원본59/59 PASS](evidence/m15-wasm-unit-results.json)에는64노드·16출력의 실제 경계,숨겨진 terminator 경로의 overflow,부호 있는0,다중 출력·물리 단위,변조 IR/manifest/bytes,연산·rate·형상·state/continuous 거부와 per-run 취소·결과 복사도 포함한다. 시간 입력이 있는 이산 native 결과의 정보용 빈 stateMemory도 일치하며 저장 상태를 추가한 것은 아니다.

기존337개 정의는 [M14 기준 snapshot](baselines/m14-registry.json)의 SHA-256 `711fcb2062a90dcebdc4b2265f3a8660aadb3d8f2c4ede0de436a4f768ce0b40`와 deepEqual을 유지한다. M15 engineering 기록이 만들어진 이후 검증기는 동결한 WASM 보고서를 덮어쓰지 않고 `m15-wasm-regression-on-{stage}.json`으로 실제 fresh 실행을 분리한다.

외부 compiler·C/MATLAB/SimEvents 권리와 native 툴체인 환경은 M14의 unavailable 계약을 보존한다. 자체 코드의 bundled 실행·고정 export 범위와 외부 코드 재배포 권리는 구분하며 확인하지 않은 license를 새로 부여하지 않는다. binary encoding과 수치 primitive의 개념은 공식 [WebAssembly binary instructions](https://webassembly.github.io/spec/core/binary/instructions.html),[module encoding](https://webassembly.github.io/spec/core/binary/modules.html),[numeric semantics](https://webassembly.github.io/spec/core/exec/numerics.html)를 참조한다. 현재 문서의 추가 확장을 지원한다고 주장하지 않으며 실제 emit한 Core1 subset만 승인한다.
