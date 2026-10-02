# CalcWeave Simulink 기본 라이브러리 전체 대응 후속 로드맵

> v0.1 · 2026-10-03 · M8~M16 계획 · 일정/전체 구현 완료 주장 아님

[기존 M0~M7 로드맵](03-milestone-roadmap.md) · [현재 계약](catalog-contract.md) · [현재 지원표](block-coverage.md) · [385행 기계 판독 배정표](simulink-coverage-roadmap.json)

## 범위와 출발점

현재 엔진은 **0.8.0-catalog, registry144항목**이다. R2024b 원자료01~21절은 **385행 /339개 영어 이름 문자열**이며, 현재 승인·대체·preset을 포함한 subset 기록은 **134행**, 미구현은 **251행**이다. catalog의 신규 승인20행은 이134에 포함된다. 단순 블럭명 수, registry, 독립 수치kernel, 분류 바로가기와 preset의 수를 같은 지표로 합산하지 않는다.

이 로드맵의 '전체 대응' 목표는 원자료385행 각각의 기능/옵션/자료형/실행 모드/코드 타깃/외부 조건을 끝까지 추적하고 지원 결정을 증거로 닫는 것이다. 원자료는 기본 라이브러리의 분류·대체 구성·조건부·레거시를 정리한 목록이며 전체 설치판·모든 Simulink toolbox와 모든 옵션의 전수 사양은 아니다. **R2024b 전체 옵션 inventory도 아직 미완료**다. 각 단계의 첫 계약 작업에서 공식 사양/실제 원본 환경의 옵션 행렬을 확보하고 미확정 항목을 표시해야 한다.

독립 구현, 공유 설정, 목적 대체, 조건부 외부 adapter, 레거시 설명과 검증된 미지원은 서로 다른 결과다. 미지원 이유를 기록하면 추적 결정은 닫을 수 있지만 실행 지원이나 완전 동등성을 달성한 것으로 계산하지 않는다. 필수 옵션·자료형·mode·target에 미검증/미지원이 남으면 '전체 실행 동등 완료'를 선언할 수 없다. 현재134subset도 남은 옵션이 있으므로385행 모두 후속 단계와 M16 검증을 배정했다. source/현재coverage의 승인 상태는 바꾸지 않는다.

21절의 보조 파라미터표와22~25절은385행에 합산하지 않는다.22절 내부 제어 포트는 M11 계층 fixture에 연결하고23절 레거시는 이전 안내와 adapter gate로 관리한다.24~25절의 구버전/실제 설치판 추출은 reference 확보 절차이며 브라우저 계산 블럭으로 구현하는 항목이 아니다.

## 단계와 의존

M8→M9→M10의 순서로 계산·시간·자료형 기반을 늘린다. M11 뒤에는 M12 solver와 M13 데이터/UI 일부를 병행할 수 있다. M14의 권리/외부환경 검증은 필요한 adapter만 선택적으로 진행하며 native 계산 경로에 외부 설치를 요구하지 않는다. M15에서 실제 target/형식 parity를 확인하고 M16에서 전체행 옵션별 지원표를 감사한다. 선행 stage 전체의 장기 완료를 기다리는 대신 필요한 계약과 fixture가 승인된 기능 묶음부터 착수할 수 있다. 기간·인력·출시일은 확정하지 않고 각 묶음의 수치/환경 spike 뒤 재산정한다.

P0는 공통 기반과 실제 수학·신호 과제를 먼저 완결하는 일, P1은 상태/계층/사용 흐름의 확대, P2는 외부 환경·권리와 선택 adapter다. stage의 우선도와 구현 가능 여부는 다르다.

| 단계 | 기능 묶음 | 우선도 | 계약 선행 | 최초 작업 배정385행 | 그중 현재 미구현251행 |
| --- | --- | --- | --- | ---: | ---: |
| M8 | 수학·신호와 배열 조작의 잔여 기능 | P0 | 현 catalog 계약 | 107 | 46 |
| M9 | DSP·이산 상태·샘플시간 | P0 | M8 | 58 | 31 |
| M10 | 자료형·복소수·고정소수점·n-D | P0 | M8, M9 | 38 | 34 |
| M11 | 조건·반복·메시지·계층 실행 | P1 | M10 | 73 | 61 |
| M12 | 연속 solver·사건·DAE와 분석 | P1 | M9, M10, M11 | 26 | 12 |
| M13 | IO·Dashboard·문자열·데이터 작업 | P1 | M10, M11 | 75 | 59 |
| M14 | 외부 어댑터·권리·라이선스 경계 | P2 | M10, M11, M13 | 8 | 8 |
| M15 | 상호운용 형식과 추가 코드 타깃 | P1 | M12, M13, M14 | 0 | 0 |
| M16 | 385행 전체 옵션 추적·회귀·공개 지원 QA | P0 | M8, M9, M10, M11, M12, M13, M14, M15 | 0 | 0 |
| 합계 | 원본행별 최초 작업 한 번 집계 | | | **385** | **251** |

M15와 M16의 최초 작업 행 수0은 작업이 없다는 뜻이 아니다. M15는 앞 단계에서 만든 기능의 실제 target/형식 검증, M16은385행 전체의 최종 지원 감사다. Block Support Table(12-001)은 최초 작업을 M13의 공개 지원표 UI/데이터 계약에 배정하고 전수 옵션 지원표의 종료 감사를 M16으로 분리했다. Weighted Sample Time(14-013)은 Dashboard 표시가 아닌 sample-time 계산 계약이므로 M9에 배정했다.

옵션 완료는 최초 작업 단계와 다르다. JSON의 `firstWorkMilestone`은 첫 계약/확장 stage, `optionCompletionMilestones`는 자료형·solver·adapter·target·QA의 후속 작업이다. M16 완료표시는 각 행의 옵션별 증거/미지원 이유가 갖춰진다는 뜻이며 실행 지원률은 별도로 계산한다.

## 분류별 배정과 현재 상태

| 원자료 분류 | 행 | 현재subset | 미구현 | 최초 작업 stage와 행 수 |
| --- | ---: | ---: | ---: | --- |
| 01 Commonly Used Blocks | 23 | 22 | 1 | M8:12 / M9:2 / M10:1 / M11:5 / M12:1 / M13:2 |
| 02 Continuous | 16 | 9 | 7 | M12:15 / M14:1 |
| 03 Dashboard | 37 | 5 | 32 | M13:37 |
| 04 Discontinuities | 14 | 5 | 9 | M8:7 / M9:2 / M12:5 |
| 05 Discrete | 21 | 11 | 10 | M9:20 / M12:1 |
| 06 Logic and Bit Operations | 22 | 5 | 17 | M8:7 / M9:7 / M10:8 |
| 07 Lookup Tables | 9 | 3 | 6 | M8:7 / M10:2 |
| 08 Math Operations | 38 | 23 | 15 | M8:30 / M9:2 / M10:4 / M12:1 / M13:1 |
| 09 Matrix Operations | 19 | 9 | 10 | M8:14 / M10:2 / M11:3 |
| 10 Messages & Events | 8 | 1 | 7 | M11:7 / M12:1 |
| 11 Model Verification | 11 | 0 | 11 | M8:9 / M9:2 |
| 12 Model-Wide Utilities | 5 | 2 | 3 | M12:2 / M13:3 |
| 13 Ports & Subsystems | 29 | 3 | 26 | M10:1 / M11:28 |
| 14 Signal Attributes | 14 | 3 | 11 | M9:3 / M10:10 / M13:1 |
| 15 Signal Routing | 27 | 8 | 19 | M8:8 / M11:19 |
| 16 Sinks | 11 | 4 | 7 | M11:2 / M13:9 |
| 17 Sources | 27 | 17 | 10 | M8:2 / M9:16 / M10:1 / M11:2 / M13:6 |
| 18 String | 16 | 0 | 16 | M13:16 |
| 19 User-Defined Functions | 15 | 1 | 14 | M8:1 / M11:7 / M14:7 |
| 20 Additional Math & Discrete | 9 | 0 | 9 | M8:3 / M9:3 / M10:3 |
| 21 Quick Insert | 14 | 3 | 11 | M8:7 / M9:1 / M10:6 |
| 합계 | **385** | **134** | **251** | 중복 ID0·행 누락0 |

모든385행은 JSON의 `rows`에 원본ID·이름·하위문맥·조건·L번호·canonical 후보·현재status를 그대로 담는다. 각 행에 deliveryKind·첫stage·후속stage·우선도·남은scope·필수contract·최소fixture를 기록했다. 원본명만 같다고 stage/의미를 합치지 않는다. Dashboard Display와 Sinks Display, Memory와 Unit Delay, Source Sine Wave와 외부 입력 Sine Wave Function, 일반 signal delay와 Entity Transport Delay는 각각의 바인딩·상태·환경을 검증한다.

## 단계별 구축 계약과 종료 gate

### M8. 수학·신호와 배열 조작의 잔여 기능

우선도 **P0**. 선행: 0.8.0 catalog의 현재 계약과 회귀 증거. 이 단계가 최초 작업인 원본행 107개 중 미구현은 46개다. 이 수는 해당 단계에 모든 옵션을 동시에 완료한다는 약속이 아니다.

**필수 구현 계약**

- R2024b 파라미터/대체 구성 inventory·원본 ID별 옵션 행렬
- 동적 경계·index·axis·빈 결과·broadcasting·수치 정의역·오류 계약
- lookup 차원/축/보간/외삽·정적 수식 AST·순수 함수와 waveform 입력 바인딩

**독립 fixture**

- Assignment·Find Nonzero·Permute·Squeeze·구조 검사·동적 selector의 독립 배열 oracle
- dynamic interval/dead-zone/saturation·friction·wrap equality·sine function 입력 시각
- n-D lookup corners/knots·빈 배열·index 오류·영 제수·overflow·유닛

**종료 조건**

- 최초 P0 누락 계산을 compiler/runtime/TS/검색·설정 UI로 연결
- 모든 선언 지원 mode/shape/옵션에 독립 oracle와 원본 노드 진단
- 현재144 정의/71 catalog fixture 회귀·새 schema가 필요하면 원본 보존 migration

### M9. DSP·이산 상태·샘플시간

우선도 **P0**. 선행: M8. 이 단계가 최초 작업인 원본행 58개 중 미구현은 31개다. 이 수는 해당 단계에 모든 옵션을 동시에 완료한다는 약속이 아니다.

**필수 구현 계약**

- read-before-write·rate 추론·offset·reset/enable·상태 소유권
- 시간변화 계수·가변/탭/전파 지연·DF1/DF2·2DOF PID·zero-pole realization
- noise PSD·seed/stream·counter wrap·sample-time math·초기/마지막 tick

**독립 fixture**

- impulse/step 및 z-domain 기준·동적 filter 계수 교체·모든 초기화
- harmonic/nonharmonic rate·동시due·pause/resume/cancel·노드 순서 독립
- noise 통계와 정확한 draw 소비·가변 지연 bounds·마지막 stateMemory

**종료 조건**

- 각 상태 primitive의 초기/output/commit/reset 규약 및 rate 제한 공개
- 시간 실행·JSON·독립 TS/Python의 승인 subset parity
- 메모리·스텝·연산 예산·실패 partial·연속 hold 경계 회귀

### M10. 자료형·복소수·고정소수점·n-D

우선도 **P0**. 선행: M8·M9. 이 단계가 최초 작업인 원본행 38개 중 미구현은 34개다. 이 수는 해당 단계에 모든 옵션을 동시에 완료한다는 약속이 아니다.

**필수 구현 계약**

- float32 rounding·signed/unsigned 정수·int64/BigInt·cast/propagation/strip
- complex 표현·켤레/위상/branch cut·다형 신호와 일반 n-D shape/axis
- fixed-point word/scale/overflow/rounding·stored integer·enum/string 기초·Inf/NaN 명시 정책

**독립 fixture**

- 독립 bit-pattern/BigInt oracle·tie/overflow/underflow·signed zero·NaN 정책
- complex dot/Hermitian·방위/branch cut·type conversion 모든 조합
- fixed lookup sin/cos·n-D rank/axis·직렬화/unknown dtype/migration

**종료 조건**

- float64 치환과 실제 typed/bit-true 파이프라인을 지원표에서 분리
- compiler/runtime/저장/TS 및 타깃별 dtype 지원을 함께 변경
- 지원하지 않는 차원/자료형/특수값은 무손실 보관·명시 진단, 조용한 cast 금지

### M11. 조건·반복·메시지·계층 실행

우선도 **P1**. 선행: M10. 이 단계가 최초 작업인 원본행 73개 중 미구현은 61개다. 이 수는 해당 단계에 모든 옵션을 동시에 완료한다는 약속이 아니다.

**필수 구현 계약**

- Enabled/Triggered/Resettable/Action/Function-Call/Atomic·state scope와 reset
- For/While/For Each/array-neighborhood-pixel·iteration/경계/break/예산
- message typed bounded queue·동시 event·Merge·Goto/Data Store/State Writer·variant 선택

**독립 fixture**

- 동등하게 펼친 모델과 계층 실행·다중 인스턴스·비활성 상태 유지
- nested loop·0회/최대 iteration·overflow queue·동시 writer·함수 lifecycle
- 같은 시각 call/trigger/reset/message 순서·recursive reference·variant 오류

**종료 조건**

- 신호·message·entity 및 UI 그룹·실행 계층의 의미를 각각 명시
- control-port 내부 계약도 원본 source ID와 함께 fixture로 추적
- 독립 target parity·상태/시간/예산·실패 부분 기록이 계층 경로를 보존

### M12. 연속 solver·사건·DAE와 분석

우선도 **P1**. 선행: M9·M10·M11. 이 단계가 최초 작업인 원본행 26개 중 미구현은 12개다. 이 수는 해당 단계에 모든 옵션을 동시에 완료한다는 약속이 아니다.

**필수 구현 계약**

- 새 불연속 guard/zero crossing·chattering/hysteresis·지연/history/Memory
- 강성 solver·algebraic loop·지원 index-1 DAE·Descriptor E·초기 일관성
- 수치 Jacobian/국소 선형화·gradient/resolution 검증·operating point·허용오차

**독립 fixture**

- 해석 ODE/DAE·독립 solver·stiff reference·비특이/특이 E 구분
- event 시각/동시 reset·missed crossing·adaptive rejection·가변 지연
- 잔차·condition·수렴 실패·불연속 loop 거부·Jacobians finite-difference 비교

**종료 조건**

- 지원 solver/DAE 형태·자료형·차수·event 제한을 목록으로 공개
- 무수렴·초기 불일치·강성 실패는 원인/잔차/마지막 유효 상태로 중단
- 일반 DAE/모든 Simulink solver/자동 PID tuning 동등성은 별도 증거 전 주장 금지

### M13. IO·Dashboard·문자열·데이터 작업

우선도 **P1**. 선행: M10·M11. 이 단계가 최초 작업인 원본행 75개 중 미구현은 59개다. 이 수는 해당 단계에 모든 옵션을 동시에 완료한다는 약속이 아니다.

**필수 구현 계약**

- Dashboard와 Sinks 동명 항목·Customizable appearance·callback allowlist·live 적용 tick
- XY/Floating Scope·record/stop·dataset/waveform/scenario 편집·CSV/XLSX 파일 제한
- Unicode/ASCII·substring/index·parse/format/enum·named dataset·unit/probe/지원표 UI

**독립 fixture**

- Dashboard 조작 event log 재생·현재/이전 결과·큰 데이터 원시값 보존
- 동명 Display·gauge variant·keyboard/IME·320px/확대·theme·실제 초보 과제
- 문자열 encoding/정밀도/invalid parse·파일 크기/수식 cell 보호·명시 권한/복구

**종료 조건**

- 수치 엔진·표시 variant·독립 workflow·MATLAB workspace 의미를 분리
- 모든 일반/Customizable source 행의 설정·바인딩 차이를 개별 확인
- 실제 사용성·접근성 관찰과 데이터 provenance/보존/복구 증거

### M14. 외부 어댑터·권리·라이선스 경계

우선도 **P2**. 선행: M10·M11·M13. 이 단계가 최초 작업인 원본행 8개 중 미구현은 8개다. 이 수는 해당 단계에 모든 옵션을 동시에 완료한다는 약속이 아니다.

**필수 구현 계약**

- C/C++/MATLAB/System object/S-function·ABI·callback lifecycle·외부 dependency
- browser WASM 또는 명시 선택 local/remote adapter·격리·자원·권한·취소
- 원본/사용자 코드/재배포/타깃별 권리·제품 필요조건·버전·provenance 확인

**독립 fixture**

- 허용 ABI/port/dtype·lifecycle·원본 환경 fixture 비교·adapter unavailable
- 서명만으로 코드 신뢰하지 않음·시간/메모리/네트워크 경계·실패 복구
- Entity Transport Delay의 엔터티와 신호 구분·legacy 수동 전환 사례

**종료 조건**

- 허용 adapter별 계약/권리/환경/보안/수치 증거가 모두 확보될 때만 실행 승인
- 외부 프로그램 없는 native 기본 경로 유지·자동 MATLAB/C 실행 금지
- 불가능/미허가/미검증 adapter는 설명된 미지원으로 남기며 지원 완료로 합산 금지

### M15. 상호운용 형식과 추가 코드 타깃

우선도 **P1**. 선행: M12·M13·M14. 이 단계가 최초 작업인 원본행 0개 중 미구현은 0개다. 이 수는 해당 단계에 모든 옵션을 동시에 완료한다는 약속이 아니다.

**필수 구현 계약**

- native JSON/cwpack 확장 migration·MAT/SLX/MDL 적법 parser·기능/옵션 변환 보고
- Python 확장·C/C++/WASM 선택 타깃·메모리/dtype/solver/ABI·빌드 재현
- 미지원 노드/옵션/target의 원본 위치·부분 변환/왕복 손실·dependency manifest

**독립 fixture**

- 모든 승인 row 옵션의 독립 생성 프로그램·실제 target 실행·manifest parity
- 원본/변환후/재가져오기 모델의 parameter/state/event/단위 비교
- unknown node/type·외부 reference·미지원 target·악성/초과 파일·권리 제한

**종료 조건**

- 파일 파싱 성공·계산 지원·수치 parity·무손실 왕복을 각각 보고
- 코드 파일 생성만으로 승인하지 않고 실제 실행/독립 oracle 증거 확보
- 하드웨어/HDL 인증과 무제한 Simulink/Coder 동등성을 자동 주장하지 않음

### M16. 385행 전체 옵션 추적·회귀·공개 지원 QA

우선도 **P0**. 선행: M8·M9·M10·M11·M12·M13·M14·M15. 이 단계가 최초 작업인 원본행 0개 중 미구현은 0개다. 이 수는 해당 단계에 모든 옵션을 동시에 완료한다는 약속이 아니다.

**필수 구현 계약**

- source ID별 R2024b 옵션/자료형/mode/target/조건의 전수 지원 행렬
- canonical/preset/독립 대체/adapter/legacy의 증거와 별도 집계
- 공개 지원표·대표 사용자 과제·성능/접근성/저장·배포 및 원본 대조

**독립 fixture**

- 385행 identity·251 미구현의 누락0·기존134 subset의 미검증 옵션 목록
- 분류 간 동명/다른 의미·preset 설정·타깃별 regression·공식/원본 실행 대조
- 전체 승인 기능의 예산/취소/실패·browser/OS·업데이트/migration·release hash

**종료 조건**

- 각 source 행의 결정과 옵션별 증거/미지원 이유·owner·검증 버전이 빠짐없이 있음
- 추적 완료/의도적 제외와 검증된 실행·완전 옵션 대응률을 서로 다른 지표로 공개
- 필수 옵션에 미지원/미검증이 남으면 전체 실행 동등 완료라고 표시하지 않음; 외부 출시 gate 별도

## 기존 subset을 완전 옵션 대응으로 확장하는 방법

- Math Function/Trig와 새64수학 카드: M8의 누락 연산/옵션을 확장하고 M10의 complex/f32/fixed/n-D, 시간변화 불연속은 M12, 추가 target은 M15에서 각각 검증한다.
- 기존 fixed.quantize가 대응한 Data Type Conversion 2행: 저장정수 목적 대체를 일반 cast 지원으로 바꾸지 않는다. M10에서 타입 변환/전파/rounding·overflow 조합을 새 계약으로 추가한다.
- Chirp/난수/파형·Delay/필터/Memory: M9의 sample/초기화/계수 옵션과 M12의 RK stage·major-step·event·delay history를 분리한다. 선형 chirp와 모든 sweep law를 동일시하지 않는다.
- Bus/Subsystem: 동종 scalar2필드/내장 계층 subset 뒤의 이질·중첩bus·조건/반복·variant·function call은 M10/M11, 외부 Model/Subsystem Reference는 M14/M15 조건을 따른다.
- CSV/JSON Playback·To Workspace/File·DocBlock·Dashboard: M13에서 native 작업 흐름을 확장하고 MAT/SLX·MATLAB 변수/외부 편집기/콜백은 M14/M15의 별도 검증 또는 명시 목적 대체로 남긴다.
- Quick Insert/중복 접근: 원본 기능 stage의 설정 fixture를 따르며 별칭 카드가 늘어도 독립 kernel 수는 늘리지 않는다. Inf/NaN·fixed Sine/Cosine·stored integer는 M10의 실제 타입/특수값 계약이 필요하다.

전체 옵션 완료 여부는 이름이 노출됐는지로 판단하지 않는다. 파라미터 행렬의 지원·미지원·조건부·미확정 각 칸에 계약 버전과 fixture를 붙이고, 입력/상태/시간/오류/shape/unit 및 실제 생성 프로그램의 결과를 확인한다. 원본 환경 대조 증거가 없으면 독립 사양의 승인 subset이라고 표시하며 Simulink와의 전체 옵션 동등성을 주장하지 않는다.

## 외부 환경과 의도적 경계

C Caller/C Function/S-function Builder는 C/C++ compiler/ABI와 사용자코드 권리, MATLAB Function/System/Level-2 S-Function은 원본 언어/객체/툴박스·callback lifecycle 조건이 있다. browser native 계산 목적을 독립 구현하는 일과 외부 원본 코드를 실행하는 일은 다르다. adapter별 runtime·라이선스·권리·격리·권한·리소스·provenance를 확인하며 허용되지 않은 외부 코드나 환경 없는 호출을 정상지원으로 올리지 않는다. 법률/라이선스 조건을 이 로드맵 자체로 확정하지 않는다.

Entity Transport Delay는 일반 신호지연의 alias가 아니다. bounded native message와 SimEvents entity 의미를 별도 관리한다. Interpreted MATLAB Function은 레거시 설명·수동 porting을 우선하며 기본 추천에서 제외한다. 공개 수식/알고리즘과 자체 아이콘/문구를 사용하고 MathWorks 실행코드/도움말/독점 자산의 재사용 권한을 가정하지 않는다.

M15의 import는 parse 성공·옵션 변환·실행 지원·왕복 손실을 각각 보고하며 미지원 내용을 조용히 버리지 않는다. hardware real-time/HDL/codegen 인증과 제품별 toolbox 전체 실행은 이385행 계획에 자동 포함되지 않는다. 원본 환경 비교가 필요할 때 재배포 허용 여부를 별도 확인한다.

## 증거와 운영

행별 상태는 현재coverage의 baseline을 보존하고 후속 구현이 실제 계약/oracle/타깃/진단 gate를 통과한 뒤 별도 변경한다. 완료 결정은 `verified-native-scope`, `verified-shared-configuration`, `verified-independent-alternative`, `verified-conditional-adapter`, `documented-unsupported`, `documented-legacy`로 분리한다. 실행 지원률은 앞의 검증된 실행 범위만, 추적 결정률은 설명된 미지원/legacy도 포함해 별도로 계산한다. registry 정의 수와 source행 수로 완전 옵션 지원률을 만들지 않는다.

계약 owner와 review owner를 기능 묶음 착수 때 지정한다. 실패 fixture·버전·환경·허용오차·옵션별 status를 지원표에 남기며 이전 증거를 덮어쓰지 않는다. 신규 stage는 미구현/연구 계획이며 공개 출시 게이트(M6)의 보안·운영·도메인·접근성·초보자 관찰을 완료로 바꾸지 않는다.

검증 명령은 `npm exec -- tsx scripts/verify-roadmap.ts`다. 스크립트는 source digest/385행/339이름·기존coverage·JSON의251미구현과134subset·원본 identity·stage의존 DAG·385행 배정·후속옵션/M16 gate·문서집계를 읽기 전용으로 확인한다. `--write`는 현재coverage로부터 JSON/이 문서를 재생성하는 명시 갱신이며 review 뒤 실행한다. source와coverage는 어떤 모드에서도 수정하지 않는다.
