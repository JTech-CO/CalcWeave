# CalcWeave M14 신뢰된 어댑터 실행 계약

M14는 자체 작성한 고정 WASM 계산·누산 lifecycle과 제한된 이산 메시지 FIFO를 구현한다. 기존334개 정의를 [M13 기준 snapshot](baselines/m13-registry.json)과 동일하게 보존하고3개 정의를 추가한다. 원본8행의 외부 C/MATLAB/SimEvents 실행 환경은 모두 unavailable이며, 실제 증거가 있는3개 독립 대체의 선택 범위만 별도로 승인한다. 전체 원본 실행 동등성과 M15 타깃 확장을 주장하지 않는다. [8행 대응표](m14-implementation-map.json)의 원본 identity/hash와 native 실행 상태를 구분한다.

선택 구현과 실제 standalone·lifecycle·실패 rollback·UI 검증을 완료했다. 실제로 실행한 독립 대체3행만 source에 반영해 선택 subset367/385·미구현18행이다. 원본8행의 native 환경은 모두 unavailable이며 나머지5행은 미구현 상태를 유지한다. 기존382행과22개 보호 원본·이전 증거를 보존했다. [검증 기록](m14-validation.md)·[실제 실행](evidence/m14-verification.json)·[source 승인](evidence/m14-source-approvals.json)을 따른다. 전체 browser 최초172/176 및 다운로드 보안 assertion 갱신 후4/4를 구분하고 성능6개·지원표 회귀를 포함한 선택 engineering 검증을 완료했다. 공개 검증 버전은 M12 앱0.13.0이며 M15 완료 후 통합 배포한다.

## 공개 정의와 ABI

| ID | 입력 → 출력 | 공개 파라미터·선택 범위 |
| --- | --- | --- |
| adapter.wasm-affine | in → out | gain=1,bias=0; 단위1의 유한 legacy float64 scalar; static/discrete/continuous |
| adapter.wasm-accumulator | in,reset → out | initial=0,gain=1,resetMode rising/level; 입력·상태는 단위1의 유한 legacy float64 scalar,reset은 boolean; root discrete only |
| adapter.entity-transport | in,delay → out,count | capacity32(1..64),overflow error/drop-newest/drop-oldest,maxRelease64(1..64); messages와 초 단위 float64 scalar delay; root discrete only |

affine은 `input*gain+bias`를 실제 WebAssembly f64 multiply/add로 계산한다. 외부 C 소스·컴파일러·header·사용자 function name을 받지 않는다. typed 숫자·벡터·복소수·다른 물리 단위는 명시 ABI 진단으로 거부하며 필요한 기존 신호 변환은 모델에서 선언한다. 유한 입력이어도 실제 산술 결과가 overflow이면 실패한다.

숫자 파라미터의 −0은 기존 parseModel의 JSON 복사 단계에서 +0으로 정규화된다. M14가 새 zero 정책을 추가하지 않으며 실제 동적 산술의 IEEE signed zero와 기존 typed wire 계약은 유지한다.

누산기는 `state + input*gain`을 due마다 계산하며 gain은 샘플별 증분 계수이고 Ts를 자동 곱하지 않는다. 실제 WASM 함수는 initialize(initial),read(state),accumulate(state,input,gain),reset(initial),terminate(state)이다. rising/level reset을 현재 상태와 출력 전에 적용하고 reset hit에서도 현재 입력을 다음 표본의 상태에 누산한다. 현재 출력은 저장된 상태를 읽고 다음 상태는 원자적 commit으로 갱신한다. level이 계속 참이면 다음 due에서 다시 초기화하므로 출력은 초기값을 유지하지만 승인된 전이 수는 계속 증가한다. reset만 direct feedthrough이며 입력 피드백은 저장 경계를 통과한다. 상태·이전 reset·읽기/갱신/초기화 기록은 WASM 전역 대신 checkpointed JSON에 둔다. 완료·취소·실패 종료의 실제 terminate 증거는 실행 결과의 adapterLifecycle로 확인한다.

상태 어댑터를 투명 Subsystem이나 조건부·반복 child program에 넣으면 `M14_STATEFUL_ROOT_ONLY`로 거부한다. invocation과 물리 due의 반복·하위 종료 전파는 이 선택 계약에 포함하지 않는다. pure affine은 하위 정의에서도 실행할 수 있다.

## 고정 모듈·신뢰·자원

| 프로필 | byteLength | SHA-256 |
| --- | --- | --- |
| calcweave.wasm-affine-f64-v1 | 48 | `fc7801ff3c8d616c38773a0e26af62181f8281c8f06430193d0ed20fb239cb95` |
| calcweave.wasm-accumulator-f64-v1 | 121 | `e39e9c9c08547876adeb3a521111b47b778fae11ca90a881995428a264376a65` |

각 모듈은 version1/ABI1의 자체 작성 byte literal과 일치해야 한다. compiler는 고정 `adapterIdentity:{id,version,sha256,abiVersion}`를 IR에만 붙이며 portable model의 파라미터로 받지 않는다. runtime은 모듈 byte 일치와 제한된 decoder로 type/function/export/code 구조·전체 함수 서명을 검사한다. 허용 opcode는 local.get,f64.mul,f64.add,end이며 import·memory·table·global·start·loop·call·host function이 없다. 외부 byte/URL/path·사용자 코드·callback·서명된 임의 모듈을 실행하는 API를 제공하지 않는다. 서명은 코드 실행 신뢰의 근거로 삼지 않는다.

WASM 호출 비용은 `8*byteLength+32*exportCount+32`로 선차감한다. affine448,누산기의 함수 호출1160·due 전이2352,초기화와 고정 종료 예비 비용3480을 계상한다. 상태 machine은 최초 고정 모듈·ABI 검사와 instance 준비 후 자신의 순수 함수 binding을 보유하며 매 호출의 identity·서명·유한 입력/출력 검사는 유지한다. 유한 straight-line 모듈이므로 loop에 의한 무기한 실행을 허용하지 않으며 Worker 취소·연산/기록/상태·30초 wall 상한을 유지한다. 종료 예비 비용은 이미 선계상한 고정 terminate 호출에만 쓴다.

## 메시지 FIFO의 실제 의미

독립 `calcweave.entity-fixed-deadline-v1` 프로필은 SimEvents 런타임을 실행하지 않는다. MessageSignal의 payload 계약을 유지하며 수신 시각에 delay를 한 번 읽어 유한 physical deadline=`acceptedTime+delay`를 저장한다. 최소 방출 tick은 다음 노드 due이고, release는 저장된 deadline<=현재 due 시각 및 earliestTick<=현재 tick을 모두 만족해야 한다. 부동소수점 물리 시각 비교를 사용하며 정확한 십진 시간 또는 tolerance에 의한 선방출을 주장하지 않는다.

due 시작에는 이전 FIFO head부터 maxRelease까지 내보낸 뒤 현재 새 메시지를 enqueue한다. delay0도 현재 입력을 즉시 내보내지 않고 다음 due부터 가능하다. 도착 순서와 head-of-line blocking을 유지하므로 뒤 메시지의 delay가 더 짧아도 앞 head를 먼저 처리한다. 우선순위 재정렬·가변 속도 적분·연속 사건 시각은 지원하지 않는다. count는 실제 저장 중인 메시지 수이며 out은 due에서 방출한 실제 메시지 묶음이다.

producer 식별자≤64자와 안전한 정수 sequence를 사용한다. 최대128개 producer의 high-water sequence로 held 입력 중복을 억제하며 producer별 sequence 증가를 전제로 한다. 용량 초과의 error/drop-newest/drop-oldest를 명시적으로 선택하고, 입력·deadline·출력·예산 실패는 같은 due의 queue/seen/publication을 commit하지 않는다. queue 최대64개·한 due 방출64개·중첩 메시지 금지를 기존 구조화 신호 검증과 함께 적용한다.

compiler의 queue 상태 예약은 `capacity*(payloadWorstStorage+83)+128*65+8`이다. 짧은 초기 문자열이 아닌 descriptor 최대값으로 payloadWorstStorage를 계산해 이후 문자열·typed 코드 크기 증가도 제한한다. 출력 maxBatch는 min(capacity,maxRelease)이며 전체100000 상태와 결과/중간 신호 상한을 함께 검사한다. 모듈 storage와 input/output 복사·FIFO/producer scan의 연산량도 실제 budget에 계상한다.

## 원본 환경과 권리

공유 immutable 카탈로그 [m14-adapters.ts](../packages/model/src/m14-adapters.ts)는3개 bundled 프로필과8개 unavailable native 프로필의 ABI·한도·lifecycle·artifact pin·제품/툴체인·출처·권리 상태를 제공한다. native unavailable은 `M14_NATIVE_ENVIRONMENT_UNAVAILABLE`,알 수 없는 프로필은 `M14_UNKNOWN_ADAPTER_PROFILE`로 설명하며 registry 실행 블럭으로 세지 않는다.

| 원본 | 실제 선택 판정 |
| --- | --- |
| 02-016 Entity Transport Delay | 실제 선택 구성의 bounded 메시지 fixed-deadline FIFO 독립 대체 승인; native SimEvents entity·운송 적분 unavailable |
| 19-001 C Caller | 실제 선택 구성의 고정 f64 affine WASM 독립 대체 승인; 사용자 C·ABI·compiler unavailable |
| 19-002 C Function | 실제 선택 구성의 고정 누산 lifecycle WASM 독립 대체 승인; 임의 C start/output/termination unavailable |
| 19-006 Interpreted MATLAB Function | native interpreter unavailable; 사람이 제한 AST로 다시 작성한 예제만 별도 수동 전환 작업으로 제공 |
| 19-007 Level-2 MATLAB S-Function | native MATLAB callback/TLC 환경 unavailable |
| 19-009 MATLAB System | native System object/API 환경 unavailable |
| 19-012 S-Function | native MEX/callback/target integration unavailable |
| 19-013 S-Function Builder | native builder/compiler/MEX 환경 unavailable |

자체 구현 author는 JTech-Co이며 MathWorks 코드를 번들하지 않는다. 프로젝트가 허용한 자체 bundled 실행과 고정 TypeScript export 범위만 기록한다. license와 외부 코드 재배포 권리는 NOASSERTION이며 MIT 등 확인하지 않은 license를 부여하지 않는다. 별도 native 제품·compiler·사용자/제3자 소스·재배포 권리와 타깃 조건은 각 외부 환경에서 확인해야 한다. 미확인 환경을 실행 가능으로 집계하거나 임의 어댑터 로더를 추가하지 않는다.

원본 identity는 동결된 R2024b dataset/roadmap을 따른다. 최신 문서의 R2025a 이후 기능은 원본 선택 사양에 추가하지 않는다. 기능 개념 참고는 MathWorks의 [C Caller](https://www.mathworks.com/help/simulink/slref/ccaller.html),[C Function](https://www.mathworks.com/help/simulink/slref/cfunction.html),[Entity Transport Delay](https://www.mathworks.com/help/simulink/slref/entitytransportdelay.html),[Interpreted MATLAB Function](https://www.mathworks.com/help/simulink/slref/interpretedmatlabfunction.html),[Level-2 MATLAB S-Function](https://www.mathworks.com/help/simulink/slref/level2matlabsfunction.html),[MATLAB System](https://www.mathworks.com/help/simulink/slref/matlabsystem.html),[S-Function](https://www.mathworks.com/help/simulink/slref/sfunction.html),[S-Function Builder](https://www.mathworks.com/help/simulink/slref/sfunctionbuilder.html)다. 별도 native 제품의 실제 실행·전체 옵션·동등성·코드 생성 비교는 열린 후속 검증이다.
