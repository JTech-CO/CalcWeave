# M4 데이터·계층·실험 실행 계약

기준: 2026-10-02 · 앱 0.4.0 · 엔진 `0.4.0-m4` · JSON schema v1 유지. [검증 기록](m4-validation.md)은 독립 기준과 재현 명령을, [M3 실행 계약](m3-contract.md)은 연속·혼합 solver와 사건 순서를 정의한다. M4는 로컬 데이터 자산, 투명한 재사용 서브시스템, 승인 단위 변환, 이름이 있는 신호, 다음 실행의 입력 조절과 실행 비교를 제공한다.

## 모델과 자산

Registry는 57종에서 64종으로 확장했다. 정적 모드는 33종, 연속 모드 표시는 64종이지만 각 항목의 타입·shape·rate·파라미터 제한은 그대로 적용한다. 추가 canonical ID는 아래 7종이다.

| canonical ID | 실제 지원 의미 |
| --- | --- |
| `source.dataset` | 모델 안의 dataset ID와 number/boolean 열을 시간에 따라 재생 |
| `unit.convert` | 승인한 동일 차원의 단위를 scale/offset으로 명시적으로 변환 |
| `route.bus-create` | 같은 타입·단위의 scalar 두 개를 서로 다른 안전한 필드명으로 묶음 |
| `route.bus-select` | 위 신호의 필드명 하나를 선택하여 scalar로 출력 |
| `hierarchy.subsystem` | 정의 ID와 버전이 일치하는 입출력·상태를 독립 인스턴스로 확장 |
| `annotation.note` | 최대 2,000자의 일반 텍스트 도식 메모, 수치 출력 없음 |
| `annotation.model-info` | 모델 이름·블럭·데이터·하위 도식 구성을 안내하는 설명 블럭, 수치 출력 없음 |

`CalcModel`에 선택적인 `datasets`, `subsystems`, `dashboard`, `notes`를 추가했다. 기존 schema v1 파일은 이 필드 없이 열린다. 알 수 없는 필드나 버전은 버리지 않고 거부한다. 전체 모델 5 MiB·100,000개 JSON 값·32단계 깊이·1,000노드·5,000연결 상한은 정의와 데이터를 포함한다. 개별 기능의 한도를 지켜도 이 합계 상한을 넘으면 모델 가져오기가 실패한다.

데이터는 `{id,name,version,sourceHash,contentHash,timeColumn,columns,rows}`이며 열은 `{name,kind,unit}`, kind는 `number|boolean|string`이다. version은 1~1,000,000 정수다. 원본 UTF-8 텍스트의 SHA-256과 정리한 `timeColumn/columns/rows`의 SHA-256을 분리한다. 원본 텍스트 자체는 저장하지 않는다. 따라서 sourceHash는 보관한 출처의 식별값이고 외부 발행자의 서명이나 신뢰 인증은 아니다. 내용 hash는 모델 객체·JSON 가져오기마다 동기적으로 재계산하며 불일치는 `DATASET_HASH_MISMATCH`로 거부한다.

실행 의미 hash에는 정규화한 실행 설정·파라미터·신호 단위·rate·연결, 데이터 ID/버전/원본·내용 hash와 정리한 표, 서브시스템 ID/버전/내부 그래프·인터페이스가 들어간다. 노드·연결·정의·자산의 삽입 순서는 영향을 주지 않는다. 모델·데이터·정의 이름, 블럭 label, layout, dashboard 배치·제목, 모델 notes와 annotation 노드는 실행 의미에서 제외한다. 슬라이더·토글이 바꾸는 실제 블럭 파라미터는 실행 의미에 포함한다. annotation에 계산 포트를 연결하는 시도는 compiler의 포트 검증에서 거부한다.

## 파일 가져오기와 정리

| 상한 | 값 |
| --- | --- |
| 원본 UTF-8 텍스트 / 정규화 데이터 검사 | 각각 2 MiB 이하 |
| 모델의 dataset | 최대 8개 |
| 표 크기 | 1~4,000행, 1~16열, 합계 20,000셀 이하 |
| 열 이름 / 문자열 셀 | 열 이름 1~80자, 셀 최대 1,000자 |
| 시간 | 초 환산 -1e9~1e9, 유한하고 중복 없이 증가 |

CSV는 헤더 행, UTF-8 BOM, CRLF/LF, 따옴표로 감싼 쉼표·줄바꿈·중복 따옴표를 처리한다. 닫히지 않은 quote, quote 뒤의 임의 문자, 다른 열 수, 중복·위험한 열 이름은 거부한다. 헤더 이름의 양끝 공백과 제어 문자는 허용하지 않는다. JSON은 primitive 값을 가진 행 객체 배열이며 모든 행의 열 이름 합집합을 사용한다. 누락한 필드와 null은 결측이다. 중첩 객체·배열이나 실행 코드는 데이터 셀이 될 수 없다.

UI는 원본 앞 5행과 형식 추정값을 보여 주지만 사용자가 전체 열의 kind/unit와 시간 열을 확인한 뒤 정리 결과를 만든다. 모든 행이 같은 규칙을 통과해야 보관한다. 새 데이터는 version 1, 기존 ID 갱신은 version을 하나 올린다. 실패한 가져오기·정리는 현재 모델의 자산을 바꾸지 않는다. 사용 중인 자산 삭제는 해당 재생 블럭 참조를 먼저 제거하거나 바꾸도록 안내한다.

정리 옵션은 `missing=reject/drop-row/zero`, 문자열 양끝 공백 제거·소문자 변환, 시간 정렬, `duplicateTimes=reject/keep-first/keep-last`다. API에서 생략한 missing/duplicate 정책은 reject이며 정렬·문자열 변환도 자동 적용하지 않는다. UI에서 선택된 옵션을 미리보기 후 보관할 때 전달한다. zero는 시간 이외의 number 결측만 0으로 바꾼다. 문자열·boolean·시간 결측을 숫자로 바꾸지 않는다. drop-row는 해당 행을 제외한다. 모두 제외되어 빈 표가 되면 거부한다. 잘못된 숫자와 비유한 값은 zero 처리 대상이 아니다. 숫자는 소수·지수 표기만 파싱하고 boolean 텍스트는 true/false만 받는다. 문자열 타입을 숫자나 boolean으로 자동 변환하지 않는다.

시간 열은 number와 `1/s/ms/min`만 허용한다. ms/min은 재생 IR에서 초로 정규화하고 보관한 원본 표 단위는 유지한다. `1`은 1초 기준의 정규화 시간 좌표다. 시간 정렬과 중복 제거는 명시적으로 선택해야 한다. 시간 이외의 열 단위는 승인 목록이어야 하며 boolean/string은 단위 `1`만 사용한다.

## 재생과 불연속 경계

결과 그래프와 Dashboard Scope의 시간 범위 도구는 모델의 시작·종료 시간을 함께 검증하고 새 실행을 시작한다. 그래프 축은 실제 기록의 첫·마지막 시각을 사용하며 2초 상한을 두지 않는다. 이 도구는 종료 > 시작을 요구하고 유한 ±1e9 범위, 기존 시간 간격의 격자, 최대 10,000 구간 및 기록·연산·solver 한도를 compiler/Worker에서 검사한다. 입력·컴파일 검증에 실패하면 모델·이력을 수정하지 않는다. 유효한 범위로 시작한 실행의 수치 실패는 기존 진단·부분 결과 정책을 따른다. 실행·일시정지 중 범위 재실행은 비활성화하고 이전 실행 이력과 비교 그래프는 당시 snapshot을 보존한다. 시작 시간을 바꾸면 해당 시각의 초기 상태·seed부터 새로 시작한다.

Playback은 `datasetId`, `column`, `interpolation=linear/previous`, `outside=hold/zero/error`를 사용한다. number는 선형·이전값 보간을, boolean은 previous만 지원한다. 문자열은 정리·미리보기·파일 내보내기에 사용할 수 있지만 runtime `SignalValue`에는 넣지 않는다. IR에는 검증한 시간/값 배열과 자료형·단위·버전·hash만 포함하며 portable node에는 자산 참조 파라미터를 보존한다.

정적 실행은 startTime의 값을 읽고 이산 실행은 due 시각에 값을 공개한 뒤 유지한다. 연속 실행의 number 재생은 실제 RK stage 시각에서 계산한다. boolean 재생은 이산 도메인으로 period/offset publication을 따른다. 다른 이산 rate로 연결할 때는 기존 Rate Transition 정책을 지켜야 한다. 연속 number에서 이산 상태로 넘어갈 때는 ZOH를 명시한다.

범위 밖 hold는 처음·마지막 값을 유지하고 zero는 숫자 0 또는 false를 출력한다. error는 `DATASET_TIME_RANGE` 진단으로 실행을 종료한다. 정확한 첫·마지막 시각의 원시 관측값은 표에 저장한 값을 유지한다. 연속 적분은 알려진 knot·범위 경계에서 멈추고 각 구간의 한쪽 극한을 사용한다. 특히 outside zero의 마지막 knot 이후 RHS는 0이며 마지막 원시 관측값을 다음 구간의 면적으로 더하지 않는다. Transport Delay의 승인 이력도 해당 jump의 좌·우 값을 보존한다. 마지막 값 7.5와 그 직후 0이 지연 출력에서 ramp나 불필요한 면적으로 바뀌지 않아야 한다.

ODE와 M3 연속 경계 블럭의 float64 scalar·단위 `1` 제한은 유지한다. 데이터의 물리 단위 열은 허용한 대수·관측 경로에서 쓸 수 있으며 무차원 ODE 입력으로 자동 변환하지 않는다. 파일 스트리밍·외부 URL·실시간 장비 입력·MAT workspace·`.mat`·XLSX 가져오기는 포함하지 않는다.

## 명시적 단위와 이름이 있는 신호

승인 단위는 `1,m,cm,mm,km,s,ms,min,kg,g,A,K,C,mol,cd,rad,deg,V,mV,Hz,N,Pa,J,W,m/s,m/s^2,m^2`다. 여기서 `C`는 섭씨용 CalcWeave 코드이며 전하의 Coulomb 단위를 뜻하지 않는다. 기존 mol/cd/Pa 등 단위 metadata도 보존한다. 길이·시간·질량·전류·온도·물질량·광도·각도를 서로 구분한다.

단위 정의의 base 변환은 `base=value*scale+offset`이다. `Unit Conversion`은 입력 descriptor가 from과 같고 from/to의 차원이 같을 때만 `output=value*(from.scale/to.scale)+(from.offset-to.offset)/to.scale`을 적용한다. cm→m은 .01, C→K는 +273.15, deg→rad는 π/180이다. scalar/vector/2D shape를 유지하고 boolean 변환은 거부한다. 합산·비교의 단위는 정확히 같아야 하며 호환 가능한 단위라도 자동 scaling하지 않는다.

곱·나눗셈, square·sqrt·reciprocal의 차원과 scale을 계산하여 결과가 승인 목록에 정확히 대응할 때만 허용한다. 예를 들어 m*m=m², m/s, (m/s)/s=m/s², N*m=J, J/s=W, 1/s=Hz, sqrt(m²)=m이다. cm*cm을 계수 변경 없이 m²라고 표기하지 않으며 결과 단위가 승인 목록 밖이면 `UNIT_OPERATION_UNSUPPORTED`다. offset이 있는 C의 단위 곱·나눗셈·거듭제곱 등은 K로 명시적으로 변환한 후 사용한다. 임의 사용자 단위식이나 모든 SI 조합을 지원하는 단위 라이브러리는 아니다.

M4 Bus는 같은 타입·단위의 scalar **두 필드**를 vector[2]와 descriptor의 `fields`로 표현한다. number 또는 boolean을 보존하며 서로 다른 안전한 ID를 필드명으로 사용한다. Selector는 이름이 있는 descriptor와 해당 필드를 검사한다. 숫자 배열을 같은 길이라는 이유로 Bus로 간주하지 않는다. Mux의 숫자 인덱스 연결과 구분되며 혼합 타입·다른 단위·중첩 bus·임의 필드 수·array 필드는 이번 subset 밖이다.

## 투명한 재사용 서브시스템

정의는 `{id,version,name,nodes,edges,layout,inputs,outputs}`이며 각 인터페이스는 `{id,nodeId}`다. inputs는 `io.input.out`, outputs는 `io.output.in` marker에 대응한다. boundary는 계산·rate 변경을 추가하지 않는 투명 연결이다. 단위와 실행 주기는 내부 계산 블럭에 설정하며 경계 marker·instance의 비기본 unit/rate annotation은 거부한다. 입력 marker의 value는 연결 전에 쓰는 placeholder이고 실제 instance 계산은 외부 연결값을 읽는다.

선택한 블럭을 그룹화하면 실제 정의와 입출력 marker를 만들고 boundary fan-out을 보존한다. 편집기는 내부 진입·상위 이동·breadcrumb, 정의 재사용·버전 갱신을 제공한다. 같은 정의를 두 번 사용해도 내부 상태·난수·hold는 인스턴스마다 독립이다. 현재 내부 편집에서 바뀐 의미는 정의 version을 올리고 해당 편집 경로의 참조를 갱신한다. 다른 instance의 이전 version은 자동으로 같은 의미라고 가정하지 않으며 명시적인 참조 갱신이 필요하다. compiler는 버전 불일치를 `STALE_SUBSYSTEM_VERSION`으로 진단한다.

컴파일은 원본 파라미터·주기를 먼저 정규화한 뒤 정의를 flatten한다. root ID는 유지하고 내부 leaf는 path에서 정한 안전한 hash ID를 사용한다. `hierarchy.origins`는 원래 경로·root node·definition ID를, instances는 path·version·definitionHash를 보존한다. portable 모델에는 정의가 그대로 남는다. JSON reopen의 의미 hash와 정의 hash도 같아야 한다.

정의 최대 16개, 각 입력·출력 최대 8개, 중첩 최대 8단계, 확장 instance 최대 1,000개, 확장 방문 최대 10,000개다. 저장된 전체 그래프와 확장 후 primitive 그래프 각각 노드 1,000개·연결 5,000개 상한을 지킨다. 직접·간접 재귀, 순수 boundary alias 순환, 누락·중복 입력, dangling 출력·연결, 내부 ID 충돌은 거부한다. flatten 이후에도 기존 타입·shape·단위·feedthrough·rate·대수 루프 검사가 그대로 적용된다. atomic/enabled/triggered/resettable/function-call/iteration subsystem과 `.slx` 호환은 포함하지 않는다.

## 대시보드·실행 기록·반복 실험

Dashboard는 slider/toggle/display/gauge/scope를 제공한다. slider는 루트 scalar Constant/Input 값 또는 Gain의 gain, toggle은 scalar boolean Constant/Input 값에 연결한다. display/gauge/scope는 검증한 루트 scalar 숫자 출력에 연결한다. 입력 변경은 모델 파라미터와 다음 실행에 적용하며 실행 중 snapshot을 변경하거나 live tuning 이벤트로 삽입하지 않는다. 이전 결과는 이전 실행임을 표시한다. min/max/step·대상·자료형을 검증하며 schema widget 상한은 32개, 현재 UI에서 추가하는 상한은 16개다. model notes는 최대 2,000자 일반 텍스트다.

실행 기록은 정규화한 모델 snapshot, semantic SHA-256, engine version, manifest, 원시 결과와 출력 descriptor를 함께 보관한다. 로컬 IndexedDB의 기존 모델 저장소에 별도 기록 key를 사용한다. 최근 최대 5개·전체 20 MiB, 한 기록은 시간축 포함 수치/boolean 원소 200,000개·raw sample 최대 10,001개다. 보관 한도를 맞추기 위해 가장 오래된 기록 전체를 제거하며 한 실행의 raw 배열을 부분 삭제하지 않는다. 한 실행이 기록 한도를 넘으면 계산 결과를 표시하되 기록 저장 실패를 알린다. 기록의 모델 열기·결과 CSV·기록 JSON·삭제를 제공한다. 손상된 기록은 원본을 덮어쓰지 않고 쓰기를 중단하며 원본 다운로드를 안내한다. 현재 실행 초기화와 영구 기록 삭제는 별도 동작이다.

Parameter Sweep은 루트 scalar Constant/Input의 value 또는 Gain의 gain 하나에 **최대 16개 유한한 값**을 순서대로 적용한다. 모든 variant를 먼저 컴파일하므로 중간에 입력 검증 실패를 발견한 후 앞선 실행만 몰래 진행하지 않는다. 전체 Sweep에 30초·1,000,000개 기록 원소·50,000,000 연산 한도를 공유한다. 각 run에는 남은 예산을 전달하고 추적한 `RunResult.resources.operations`를 누적한다. 이 필드는 추적을 요청한 실행에만 있으며 일반 실행·독립 TS 출력에는 없어도 된다. 공유 wall budget에는 Sweep 전체 경과시간과 보고한 실행 시간이 적용되므로 개별 실행의 pause 시간 제외 정책과 동일하다고 가정하지 않는다.

실험은 원본 모델을 바꾸지 않고 각 value의 모델·manifest·hash·결과를 남긴다. 취소·예산 오류·실행 실패는 이후 run을 중단하고 완료 기록과 검증한 부분 결과를 보존한다. UI의 최근 5개 history 상한과 한 기록의 200,000원소 상한은 Sweep 실행 상한과 별도로 적용한다. 16개 계산을 했다고 16개를 영구 보관하는 것은 아니다.

비교는 선택한 최대 3개 기록에서 **동일한 raw 시간 격자·공통 scalar 숫자 출력·같은 단위**를 요구한다. 첫 선택을 기준으로 마지막 값·마지막 값의 차이와 전 샘플 RMSE를 계산한다. 시간축을 자동 정렬·보간하거나 단위를 자동 변환하지 않는다. boolean/벡터/행렬 비교, 다중 파라미터 Cartesian sweep, 최적화·자동 튜닝·병렬 실행·클라우드 실행은 이번 단계에 포함하지 않는다.

## 내보내기와 입력 보호

M4 기능을 사용한 모델의 targetVersion은 `typescript-m4-v1`이다. 기존 기능만 쓰는 정적·이산/연속 모델은 각각 이전 m2/m3 타깃을 유지할 수 있으며 engineVersion은 현재 엔진이다. 독립 TypeScript는 import·DOM·Node 타입 없이 strict ES2022의 synchronous `run()`으로 실행한다. 수식은 bounded AST, 재생은 고정된 검증 데이터 배열, 계층은 확장한 IR이다. repository 소유 numerical template만 코드로 출력하고 사용자 텍스트는 executable source가 되지 않는다.

manifest는 참조한 데이터의 ID/버전/sourceHash/contentHash/timeColumn/columns, hierarchy instance의 path/definition ID/version/hash, 실제 domain/rate, 출력 descriptor·Bus 필드, solver/자원 정책을 담는다. 모델 파일에는 데이터·정의·dashboard·notes를 포함한다. 기존 제한된 ZIP은 같은 재현 snapshot을 사용하며 성공 결과와 모델·manifest·코드를 함께 제공한다. 사용자 이름을 압축 경로로 사용하지 않는다. `.cwpack` 새 형식이나 외부 자산 의존성 resolver는 추가하지 않았다.

데이터 CSV는 RFC quote를 적용하고 spreadsheet의 공식으로 해석될 문자열 prefix를 중화한다. 결과 CSV는 모든 원시 샘플을 포함하며 vector/matrix는 고정된 row-major indexed columns로 출력한다. 음수 숫자의 값은 문자열 공식 방지 처리와 구분한다. 1,000,000개 결과 값 한도를 적용한다. 모델·데이터·정리 옵션은 유한성·형식·길이·상한과 위험 필드·접근자를 검증한다. UI는 일반 텍스트 이스케이프를 유지한다. 서버·계정·업로드 서비스·DB·외부 URL 입력·개인정보 수집 전용 필드는 추가하지 않았다.
