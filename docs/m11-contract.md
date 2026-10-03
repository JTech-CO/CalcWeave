# CalcWeave M11 실행·편집 계약

작성일: 2026-10-03. 엔진 `0.12.0-m11`, 앱 `0.12.0`의 선택 구현을 다룬다. 전체 Simulink 동등성이나 R2024b의 모든 옵션 완료를 주장하지 않는다. M10의 자료형·정확한 저장 코드·복소수·n-D 계약과 기존 증거는 보존한다.

## 원본 대응과 승인 경계

[구현 대응표](m11-implementation-map.json)는 변경하지 않은 [전체 로드맵](simulink-coverage-roadmap.json)의 M11 최초 배정 73행을 순서대로 보존한다. 각 행에 원래 ID·이름·분류·조건·줄 번호·canonical·상태·최초 단계·후속 단계와 전체 원본 행의 SHA-256을 둔다. baseline에는 12개 기존 subset과 61개 미구현 행이 있다.

현재 대응표는 60행의 **구성된 구현 후보**와 13행의 **명시적 미지원**을 분리한다. 신규 registry 정의 48개, 기존 정의 245개, 전체 정의 293개는 원본행 수와 별도 집계다. Enable/Trigger는 wrapper의 실제 제어 포트로 표현하여 별도 primitive 개수를 더하지 않는다. 후보 행은 canonical·최소 parameter·필수 binding·실행 경계를 갖지만, 독립 fixture·실제 standalone TS·저장·UI 증거에 연결되기 전에는 승인하지 않는다. 원본의 전체 옵션은 73행 모두 open이다.

현재 직접 구현하지 않은 원본 메커니즘은 Message Triggered Subsystem, 외부 Model/Subsystem Reference, In/Out Bus Element의 고유한 element 경계·그룹화 shell, Manual Variant Source/Sink 및 Variant Start/End/Source/Sink다. 지역 정의·Structured Inport/Outport·필드 selector·Variant Subsystem이 존재한다는 이유로 이 행들을 승인하지 않는다. Hit Scheduler의 due-grid, MATLAB Function의 제한 수식 AST, Simulink Function의 지역 명시 ABI는 원본 전체를 실행하는 기능과 구분한 선택 대체다.

## 조건·호출과 상태

정의 참조는 `definitionId/version`을 사용한다. 같은 정의의 여러 인스턴스는 독립 상태 bank를 소유한다. 외부 입출력 binding과 제어 포트를 구분하고, 하나의 호출에서 상태·출력·부작용을 원자적으로 발행한다. 내부 상태를 가진 피드백 도식은 가능하지만, 현재 부모의 wrapper 데이터 포트는 모두 feedthrough로 계획하므로 child delay를 근거로 부모의 닫힌 피드백을 허용하는 기능은 후속 범위다.

| 실행 종류 | CalcWeave 선택 계약 |
| --- | --- |
| Atomic | 내부 정의를 독립 실행 경계와 상태 bank로 실행 |
| Enabled | `enable > 0`인 due에만 호출; 재활성 `stateOnEnable=hold/reset`과 비활성 `disabledOutput=hold/reset` 분리 |
| Triggered | 이전·현재 trigger의 양수 여부가 rising/falling/either로 바뀔 때 호출 |
| Enabled + Triggered | enable 조건과 실제 trigger 변화 모두 필요; 비활성 중 관측한 변화를 재활성 시 다시 호출하지 않음 |
| Resettable | rising reset 또는 `reset > 0`인 level에서 상태를 초기화한 뒤 현재 호출 실행 |
| Action | boolean action이 true인 due에 호출 |
| Function Call | 검증한 0~64회 호출을 같은 시각에 순차 실행; 호출 생산자의 due와 held count를 구분 |

Trigger의 초기 이전 값은 **0**이다. 따라서 처음부터 양수인 신호도 rising 호출한다. Resettable의 level은 **양수** 조건이며 nonzero·return-to-zero 등 원본의 다른 선택 옵션을 지원한다고 해석하지 않는다. 이러한 초기 trigger·reset 옵션의 원본 parity는 별도 미완료 작업이다. UI에도 현재 의미를 표시한다.

공개 compiler의 `reset/action/condition` 제어 포트는 단위 없는 boolean scalar로 제한한다. `enable/trigger`는 단위 없는 유한 legacy float64 또는 boolean scalar를 받는다. 수치 펄스를 reset에 쓰는 예제는 Compare To Constant의 `>0` 결과를 명시 연결한다. 내부 runtime 함수에 직접 넣은 numeric control fixture가 통과했다는 이유로 공개 모델의 boolean restriction을 확대하지 않는다.

지역 Function Call은 명시된 정의 ABI를 사용한다. Initialize는 첫 due 한 번, Reinitialize는 reset rising에서 내부 상태 초기화 후 호출, Reset Function은 reset rising 호출, Terminate는 모델에 선언된 마지막 due 호출이다. 취소·브라우저 종료·호스트 종료 hook, 외부 MATLAB 언어 실행과 재귀 호출은 이 선택 계약에 포함하지 않는다.

## 반복·배열·variant

For는 0~64회를 같은 부모 시각에서 실행한다. `iterationPort`에 0부터 시작하는 반복 번호를 자동 전달하고 이 포트는 부모의 데이터 입력 목록에서 제외한다. `statePerIteration=carry/reset`을 구분하며 0회에는 호출하지 않는다. While은 외부 boolean condition으로 시작하고 내부 boolean `conditionOutput`으로 계속할지 결정한다. 이 출력도 부모 데이터 포트에서 제외한다. 반복 상한에서 계속 요청하면 실패하며 반복 중간의 bank·출력을 발행하지 않는다.

For Each는 선택 축의 최대 64개 partition을 독립 persistent bank로 실행한다. Array Processing은 실제 축 slice, Pixel Processing은 2D의 각 스칼라 위치, Neighborhood Processing은 실제 2D 이웃 창을 내부 정의로 처리한다. 창 크기 1~7과 clamp/wrap/zero 경계를 선언하고 shape·축·partition·메모리·연산 예산을 검증한다. 모든 원본 partition/연산 옵션을 제공하는 것으로 집계하지 않는다.

Variant는 실행 전 고정한 `active=first/second`에 따라 첫 정의 또는 두 번째 정의를 선택한다. 외부 인터페이스 계약은 둘 다 검사하고 비활성 정의의 계산·상태·부작용은 실행하지 않는다. 한 실행 안에서 A→B→A를 동적으로 바꾸며 상태를 복구하는 동작은 구현하지 않았다. UI에서 선택을 바꾸면 모델이 바뀌므로 새 실행 결과가 필요하다.

## 구조화 신호와 메시지

`BusSignal={kind:'bus',fields:[{name,value}]}`는 필드 순서를 보존한다. 단계마다 최대 16개 고유 필드, 깊이 8, 전체 leaf 원소 1,024와 저장 가중치 100,000 상한을 검사한다. 이름·형상·typed/fixed/enum metadata를 보존하며 읽기와 대입에서 조용한 cast를 하지 않는다. 기존 동종 scalar named-vector bus는 기존 경로로 유지한다.

`MessageSignal={kind:'messages',items:[{producer,sequence,time,priority,payload}]}`는 한 batch에 최대 64개를 보존한다. 빈 batch는 실제 값이며 payload 안에 메시지를 다시 중첩하지 않는다. Send는 발행자·순서·발행 시각·우선순위를 기록한다. Queue는 **기존 큐에서 읽고 dequeue한 뒤 현재 batch를 enqueue**한다. capacity 1~128, maxDequeue 1~64, overflow error/drop-newest/drop-oldest를 구분한다. 우선순위와 안정 arrival 순서를 보존하며 entity·임의 시간 event scheduler를 구현했다고 주장하지 않는다.

Receive는 첫 payload와 valid를 제공하고 빈 batch에는 초기 또는 이전 payload를 유지한다. Sequence Viewer는 batch 자체를 시간 샘플로 기록한다. Merge는 실제 conditional publication만 참여하며 같은 due의 동시 writer를 진단한다. Goto/From/Visibility, Data Store, State/Parameter Writer는 승인된 lexical owner·descriptor·slot과 명시 journal 순서를 사용한다. 임의 runtime 객체·상태·매개변수에 접근하는 범용 쓰기 기능으로 확장하지 않는다.

`validateAnySignal`, `describeAnySignal`, `copyAnySignal`, `sameSignalDescriptor`, `structuredStorageElements`가 검증·소유 복사·metadata 일치·저장 예산 경계다. 접근자·추가 키·prototype·빈 배열 슬롯 등을 검증 전에 실행하거나 신뢰하지 않는다. 모델·history·CSV·runtime은 같은 계약을 소비한다.

## 편집과 결과 표시

기존 하위 도식으로 묶기 뒤 inspector의 **하위 도식 실행**에서 방식을 선택한다. 기존 데이터 연결은 유지하며 새 enable/trigger/reset/action/call/condition 포트에 실제 신호를 연결한다. 부적합 연결은 compiler에서 진단한다. 더블클릭과 breadcrumb는 controlled reference도 열고, Variant는 현재 선택한 정의를 편집한다. 실제 정의 수정만 버전을 전진시키며 선택한 참조와 조상 참조를 갱신한다. 다른 인스턴스는 전체 인스턴스 버전 갱신으로 명시 갱신한다. 최대 편집 경로 깊이는 8이다. 화면 전환 때 정의 뷰를 안정적으로 유지하고 새 노드의 측정이 완료된 뒤 캔버스에 맞춘다. 계층 진단 클릭은 hierarchyPath의 실제 인스턴스 경로와 childNodeId의 실제 노드를 검증한 뒤 내부로 진입하고 오류 블록을 선택·표시한다. 측정 완료 뒤 해당 블록에 화면을 맞춘다. 없는 경로·블록·8단계를 넘는 경로는 루트의 같은 이름 블록으로 대체하지 않고 다시 계산하라는 안내를 표시한다.

내부 경계 블록의 **경계 포트 ID**에서 생성한 in1/out1을 in/out 등으로 명시 변경할 수 있다. 영문자로 시작하는 최대 64자 ID를 검사하고 중복·prototype 이름을 거부한다. 이 인터페이스 변경은 공유 정의를 사용하는 실제 연결·참조 버전을 함께 갱신한다. Variant 반대 정의의 인터페이스를 자동으로 바꾸지 않으며 다른 계약이 되면 compiler 진단을 보존한다. 신규 그룹을 in/out으로 바꾼 뒤 ForEach로 실행해 [6,9]를 계산하는 경로도 실제 단위 테스트로 검증했다.

`signal-value`는 최대 300,000자의 JSON draft로 편집하고 parse 전 문자 수와 중첩 상한을 검사한다. typed int64/uint64/fixed 저장 코드는 정수 문자열로 보존한다. 잘못된 draft는 남겨 수정할 수 있으며 commit하지 않고 계산·코드 다운로드를 막는다. `initialOutputs`와 필드 이름 JSON에도 별도 bounded syntax draft를 적용한다. 원본 저장 값과 draft를 혼동하지 않는다.

블록은 이름과 짧은 값 하나만 표시한다. structured 객체를 typed로 간주하지 않고 `kind`로 분기한다. 버스 결과는 순서 있는 필드 tree와 정확한 typed leaf와 실제 compiled field descriptor의 단위·metadata를 표시한다. 메시지는 발행자·순서·정확한 시각·우선순위·payload를 표시하고, 샘플 번호로 이전의 빈 batch도 확인할 수 있다. typed/legacy 배열은 100행씩 표시한다. structured 내부 legacy 수치는 원본 Number 문자열로, fixed 값은 정확한 값과 저장 코드로 표시한다. 모든 텍스트는 React escaping을 거친다.

버스·메시지는 원본 기록 안내를 표시한다. finite real typed scalar만 기존 float64 시각화 경계로 연결하며 정확한 값은 표·저장 코드에 보존한다. 구조화 CSV는 전체 JSON metadata·payload를 표시용으로 보존하고 모델 복원 형식으로 주장하지 않는다. 이전 legacy/typed CSV 형식은 유지한다. 검정 다크·밝은 회색 라이트·큰 글자·블록 왼쪽 마킹 없음·320px/200% 조건을 유지한다.

## 예제와 검증 상태

기존 45개 예제와 ID·7개 카테고리를 보존하고 조건·반복·메시지 카테고리에 8개를 추가했다. 현재 총 53개 예제·8개 카테고리다. 새 예제는 독립 인스턴스, enable hold/reset, trigger/reset, For, While, Variant, 중첩 bus, 메시지 queue를 실제 registry 정의로 구성한다.

구조화 UI 8개와 계층 편집 11개, 총 **19개 단위 테스트가 실제 통과**했다. bounded draft·정확한 uint64·escaping·100행 paging·빈 message·원본 temporal sample·동적 control port·활성 Variant 버전·공유 정의 갱신·신규 경계 alias 편집·실제 while 자식 오류 위치·중첩 경로·stale 경로 거부를 검사했다. 이어 새 예제 8개를 실제 parse/compile/run하여 독립 literal 출력·JSON roundtrip·역순 node/edge 삽입·원본 불변성을 검증했다. 합계 **27개·3파일이 통과**했으며 최종 원본은 `.test-generated/m11-ui-diagnostic-navigation-unit-final.json`이다. `tsc --noEmit`도 통과했다.

전용 브라우저 **M11 9/9, M10 회귀 7/7, 합계 16/16이 실제 통과**했다. 계층 진입·실제 노드 편집·버전 저장과 가져오기·제어 포트·새 ForEach·독립 상태·반복·중첩 버스·이전 메시지 batch·CSV/TS 다운로드·320px/200% 두 테마·while 자식 오류 진입과 수정 후 결과 4를 검사했다. 첫 M11 실행의 숨겨진 하위 캔버스 결함과 저장 assertion 경합을 수정했고 첫 실패 원본을 보존했다. root 전체 브라우저 첫 실행은 **145/146**이며 M10 배열 결과가 부모 상태 갱신 때 새 clone으로 페이지를 초기화하는 회귀 1개를 발견했다. 검증된 value를 원본 immutable value로 memoize한 뒤 이번 M10 7개에서 실제 100/100/56 paging을 다시 검증했다. 이 첫 전체 보고서를 146/146으로 바꾸지 않는다.

최초 M11 8개 통과 증거는 `docs/evidence/m11-ui-browser-verification.json`에 당시 source SHA와 함께 보존한다. 필수 진단 탐색을 추가한 최종 16개 원본은 `.test-generated/m11-ui-navigation-and-m10-regression.json`, 최종 UI 증거는 `docs/evidence/m11-ui-final-navigation-verification.json`이다. 전체 API 독립 literal oracle, 실제 생성 TS, source 승인과 전체 회귀는 root 단계 gate의 별도 검증이다. fixture나 문서의 존재만으로 stage나 source 행을 완료 처리하지 않는다.

M12는 M9의 시간·M10의 자료형·M11의 상태/조건/메시지 경계를 이어받는다. DAE·algebraic constraint·연속 사건·분석의 본래 계약을 독립적으로 확정하며, M11의 due-grid 호출을 arbitrary solver-time event 기능으로 확대 해석하지 않는다.
