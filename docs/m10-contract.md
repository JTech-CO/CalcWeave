# CalcWeave M10 구현 계약

작성일: 2026-10-03 · 문서 v0.2 · 상태: 선택 API 독립 runtime 검증 통과, 독립 standalone 검증 통과, UI/단계 승인 대기

M10은 자료형·복소수·고정소수점·n-D 신호 기반을 확장한다. 최초 작업 배정은 원본 **38행·37개 이름 문자열**이며, immutable catalog baseline의 기존 subset은4행·미구현은34행이다. 작업 family23개와 등록 정의·preset·독립 수치 kernel·원본행은 각각 별도로 센다. 직전 M9 납품은 registry211개·source subset211행·미구현174행·39예제/6카테고리다. 선택 runtime/standalone 실행은 검증했고, UI·단계 종료·공개 배포는 별도 gate로 남긴다.

정본은 [m10-implementation-map.json](m10-implementation-map.json)이며, [원본385행 로드맵](simulink-coverage-roadmap.json)의 배정과 [catalog 보존 기준](baselines/catalog-block-coverage.md)은 변경하지 않는다. 원자료385행·339개 이름 및 SHA-256 `cfa9bc90f5fc50c64f85aabc3a3f74cc0329954289ff570618e94798524813d7`을 보존한다. 전체38행의 `sourceOptionCompletionStatus`는 `open`이다. 선택 API를 모두 검증하더라도 R2024b 전체 옵션·MathWorks 실행 동등성을 완료한 것으로 계산하지 않는다.

## 선택 자료형과 저장 계약

기존 finite float64/boolean scalar·vector·2D 신호는 유지한다. 새 신호는 `{kind:'typed',dtype,shape,data,fixed?,enum?}` 태그와 flat row-major 데이터를 사용한다. dtype은 `float64`, `float32`, `boolean`, `int8`, `uint8`, `int16`, `uint16`, `int32`, `uint32`, `int64`, `uint64`, `complex128`, `fixed`, `string`, `enum`의15개다. tagged dtype을 기존 계산 블럭이 지원한다고 자동 추론하지 않는다. 선언하지 않은 연결은 원본 node/port 진단으로 중단하고 명시 변환을 요청한다.

- 형상은 scalar rank0부터 rank8, 축1~1,024, 전체 원소1,024 이하로 고정한다. variable-size와 빈 배열은 이번 선택 계약에 포함하지 않는다.
- 모든 integer/fixed stored code는 canonical decimal 문자열이다. uint64 최대값처럼2^53을 넘는 값도 JSON·IR·Worker·TS에서 정밀도를 유지한다. 숫자 경계는 별도의 정확성/양자화 규약을 적용한다.
- 실수는 finite JSON number와 문자열 `'-0'`, `'NaN'`, `'Infinity'`, `'-Infinity'`로 저장한다. complex128 원소는 같은 규약의 `{re,im}`이다. NaN payload 보존이나 모든 기존 수치 kernel의 nonfinite 실행을 약속하지 않는다.
- fixed는 signed·wordLength1~64·fractionLength−64~64, binary-point scaling·bias0이다. 값은 SI×2^(−fractionLength)이며 slope-bias 전체 설정은 추가 옵션으로 남긴다.
- enum은 이름64자 이하·고유 label1~64개·label64자 이하인 닫힌 집합이다. MATLAB enum class 실행·underlying integer code·default-value casting은 이번 label 표현과 구분한다. string 원소는256자 이하이며 M13 문자열 연산의 기반이다.

입력은 일반 plain JSON 데이터로만 받아 접근자·추가 속성·희소 배열·알 수 없는 dtype·범위를 벗어난 code와 allocation을 검증한다. 사용자 문자열을 HTML이나 실행 코드로 해석하지 않는다. import의 미지원 데이터를 조용히 number로 바꾸거나 손실 상태로 다시 저장하지 않는다.

## 먼저 확정한 의미

| family | 선택 계약과 검증점 | 원본 전체 옵션 경계 |
| --- | --- | --- |
| 자료형 변환 | RWV와 SI, 선택 rounding·wrap/saturate/error를 명시한다. SI 변환은 float IEEE reinterpret가 아니다. [R2024b 공식](https://www.mathworks.com/help/releases/R2024b/simulink/slref/datatypeconversion.html) | half·slope-bias·모든 inherited/enum cast 설정 open |
| bit mask/pack/extract/shift | LSB0, stored-code 연산, MSB/LSB와 부호를 나눈다. IEEE bits는 DataView 기반 별도 동작이다. arithmetic shift와 binary-point shift를 분리한다. 양의 binary-point shift는 FL을 줄이고 SI를 유지하므로 실수 값이2^shift배가 된다. [Float Extract Bits](https://www.mathworks.com/help/simulink/slref/floatextractbits.html), [Shift Arithmetic](https://www.mathworks.com/help/simulink/slref/shiftarithmetic.html) | R2024b 정확 archive·target별 out-of-range 정책·NaN payload open |
| 복소수/Hermitian | rectangular/polar의 각도는 radian, 켤레 전치와 선택 Hermitian 검사, ±0 branch cut을 따로 검증한다. Dot Product는 첫 입력의 켤레가 기본이며, 켤레 없는 독립 선택을 분리한다. [R2024b Dot Product](https://www.mathworks.com/help/releases/R2024b/simulink/slref/dotproduct.html) [공식](https://www.mathworks.com/help/simulink/slref/complextomagnitudeangle.html) | CORDIC·complex fixed/single·전체 reference bit parity open |
| type constraint/propagation/specification | dtype/shape/unit 계약은 compiler에서 검사한다. 선택 Propagation은 Ref1/Ref2 metadata를 직접 연결된 propagated cast에 역전파한다. runtime identity만으로 구현했다고 승인하지 않는다. [공식](https://www.mathworks.com/help/simulink/slref/datatypepropagation.html) | 전체 upstream graph·precedence·자동 best precision·symbolic/variable-size 조합 open |
| scaling strip | SI를 유지하고 signedness/wordLength를 담는 최소 built-in integer dtype을 선택한다. [공식](https://www.mathworks.com/help/simulink/slref/datatypescalingstrip.html) | 공식 output 표의64bit 누락과 선택64bit 확장 구분 |
| bus/representation | 순서가 있는 homogeneous scalar/vector bus와 copy·virtual/nonvirtual metadata를 다룬다. 표현 변환은 값을 바꾸지 않는다. [R2024b 공식](https://www.mathworks.com/help/releases/R2024b/simulink/slref/signalconversion.html) | nested heterogeneous bus·주소/ABI·target storage 의미 open |
| unit policy/conversion | 허용 단위 정책은 compiler 제약, affine/inverse 변환은 계산 동작으로 분리한다. [R2024b 공식](https://www.mathworks.com/help/releases/R2024b/simulink/slref/unitconversion.html) | 원본 전체 unit dictionary·target dtype 규칙 open |
| stored integer/state space | SI±1은 wrap하고 scale을 유지한다. 상태 공간은 현재 x의 출력을 계산하고 다음 x를 원자 commit한다. [Stored Integer](https://www.mathworks.com/help/simulink/slref/incrementstoredinteger.html), [R2024b State-Space](https://www.mathworks.com/help/releases/R2024b/simulink/slref/fixedpointstatespace.html) | 선택 internal accumulator/scale 규약과 원본 bit parity를 구분 |

Core rounding `floor`, `ceil`, `zero`, `nearest`, `away`, `even`은 각각 floor·ceiling·toward-zero·nearest tie→+∞·nearest tie→away-from-zero·nearest tie→even을 뜻한다. block API의 선택지는 `nearest-even`, `floor`, `ceil`, `toward-zero`, `nearest`, `away` 여섯 가지이며 core의 이름과 대응한다. 결과만 float64에서 양자화하는 경로와 매 연산마다 dtype을 적용하는 bit-true 경로를 구분한다. float32 파이프라인은 선언한 연산별 rounding이 있어야 한다. 후속 typed 신호가 legacy kernel로 들어갈 때 암묵 `Number()` 변환을 금지한다.

## fixed Sine/Cosine 선택 대체

07-003/07-008은 normalized turns의 quarter-wave LUT를 구현하는 **독립 선택 대체**다. 선택 wordLength2~53·fractionLength=wordLength−2·tablePoints2~min(1,024,2^(wordLength−2)+1), periodic phase·table stored-code 생성·quadrant reflection/sign·code 선형 보간·선택 rounding·wrap를 선언한다. cosine은 phase를1/4 turn 옮긴다. 원본의 Speed/Precision 내부 규칙과 out-of-range input cast까지 같다는 주장은 하지 않는다. [R2024b 공식](https://www.mathworks.com/help/releases/R2024b/simulink/slref/sine.html)

독립 literal oracle는 WL4/FL2/N2에서1/8 turn sineSI=2다. 일반 sine를 마지막에 quantize하면3이므로 LUT 구현 여부를 구별한다. N3 tableSI=[0,3,4]에서1/16과3/16 turn의 tie-even 출력은2와4,9/16과11/16에서는−2와−4다. 이 원시 code·periodic boundary·모든 선택 rounding을 검사하고 MathWorks 실행 reference와 혼동하지 않는다.

## 상태와 연속 입력 경계

고정소수점 상태 공간은 A/B/C/D·초기 상태·입력이 같은 fixed metadata를 사용하며 상태/입력/출력 축은 각1~8이다. 모든 product와 누적 add를 선택 dtype에서 반올림·overflow 처리한다. mixed scale, reset, 별도 accumulator scale은 후속 옵션으로 남긴다. 출력은 현재 x를 읽고 transition 전체를 원자 commit한다. 실행 결과의 `finalState`는 마지막 held 출력이며 `stateMemory.value`가 내부 x다. 독립 fixture의 출력 SI=[2,5,7,8], 내부 마지막 xSI=7, 두 번째 상태 row의 overflow에서는 첫 row도 commit하지 않는다.

시간에 따라 변하는 연속 입력을 quantizing cast·float64 이외 typed 산술·bit 연산·fixed LUT에 연결할 때는 명시적인 held 경계가 필요하다. constant와 이미 held된 입력은 허용한다. smooth float64 복소수 경로는 명시적인 legacy 경계를 거쳐 기존 연속 solver에 연결한다. 기존 schemaVersion1을 유지하고 새 tagged wire를 검증하므로 불필요한 schema 번호 변경이나 손실 migration은 하지 않는다.

## 실행과 단계 종료 gate

34개 신규 정의와10개 preset을 확인하고 canonical/API를 JSON에 연결했다. 독립 literal 기반59 raw fixture와10 preset fixture를206개의 mode 실행에서 검증했고, 실패/원자 rollback3건과 집계 검사를 포함한210개 단위 테스트가 통과했다. 실제 parse/compile/run·JSON roundtrip·역순 node/edge 삽입·fresh run을 검사했다. [독립 수치/TS 증거](evidence/m10-verification.json)에서209개 실제 standalone 프로그램·484 samples·exact typed cell4,011개를 검증했다. 각 mode template1개씩 총3개를 strict typecheck하고 모든209개 생성물을 각각 import-free AST·syntax/transpile 검사 후 실행했다. 유한 float64/complex는 scaled tolerance3e-12, metadata·code·tag·binary32·zero는 exact이다. [source 승인 근거](evidence/m10-source-approvals.json)와 재현 가능한 `scripts/update-m10-coverage.ts --check/--write/--verify`는 신규34행·기존 mapping 확장3행을 실제 configured 실행에 연결하고 기존 Unit Conversion1행을 원형 보존한다. 선택 subset245행·미구현140행이며 원본38행·34등록 정의·10preset은 별도 집계다. UI와 단계 종료는 root의 별도 검증으로 승인한다. 복소수 내적 `complex.dot`은 기존08-009의 후속 확장이므로38개 M10 최초 배정 행에 추가하지 않는다. 기존14-012 Unit Conversion은 직전 finite legacy subset을 보존하고 추가 typed/inverse 옵션은 followup으로 남긴다. 이번 선언 API의 모든 지원 mode·dtype·shape·옵션을 독립 raw/bit oracle·실제 생성된 strict standalone TS·JSON roundtrip·원본 node 진단·state/failure atomicity·입력/메모리/연산 예산·UI로 검증해야 한다. 모델 schema가 달라지는 경우 원본 보존 migration과 미지원 schema 진단도 필요하다. 기존211개 정의와 M9/M8/catalog fixture를 회귀 검증한다. 숫자 fixture의 존재나 문서 작업만으로 실행 승격하지 않는다.

원본38행마다 선택 mapping·최소 설정·actual evidence·지원 mode와 target을 기록하고, 독립 대체와 native bounded subset을 구분한다. 전체 source 옵션·reference 실행·C/HDL/Python target parity는 남은 작업으로 보존한다. 선택 source 승인37행과 원형 보존1행을 기록했고, 전체 source 옵션38행은 open이다. 단계 완료·공개 배포는 root의 실제 검증 이후 갱신한다.

## M11·M12 연결 경계

M11의73행은 typed/bus metadata 위에서 conditional hierarchy·loop·message·variant·lifecycle을 구현한다. positive Enable과 nonzero를 구분하고, Merge의 최근 conditional output·동시 writer 제약 및 queue의 full/order 정책을 명시한다. 이 inventory 작업에서 M11 코드를 시작하지 않는다.

M12의26행은 M9 timing·M10 dtype·M11 conditional event를 바탕으로 ODE 사건·DAE·분석을 확장한다. singular descriptor mass matrix를 단순 E 역행렬로 처리하지 않고 실제 DAE 계약과 분리한다. Algebraic Constraint는 loop의 unknown을 풀어 출력하므로 단순 assertion과 다르다. 전체 solver/reference gate는 해당 단계에서 확정한다.

## 공식 조사 범위

[독립 source 검토 기록](evidence/m10-reference-review.json)에32개 primary page와 확인 범위를 남겼다. Data Type Conversion·Sine·Fixed-Point State-Space·Signal Conversion·Unit Conversion·Width·Dot Product의 R2024b archive7페이지를 읽었다. 나머지는 current-help 핵심 의미 또는 아직 검토하지 않은 정확 archive 경계다. 일부 최신 페이지에 표시된 R2026+ 항목을 R2024b에 자동 합산하지 않는다. 실제 MATLAB/Simulink reference 모델은 실행하지 않았으며 전체 옵션 inventory도 미완료다.
