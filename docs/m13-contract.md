# CalcWeave M13 실행 계약

M13은 문자열 처리, 대시보드 조작·표시, 제한된 기록과 로컬 데이터 작업 흐름을 구현한다. 기존304개 정의는 `docs/baselines/m12-registry.json`의 객체와 같게 보존하며30개의 실제 정의를 추가한다. 원본 R2024b75행을30개 정의와 기존 실행·UI 작업 흐름에 연결한다. 외형을 다른 실행 블럭으로 세지 않는다. M14·M15 구현이나 전체 Simulink 실행 등가를 주장하지 않는다.

선택 실행 계약과 UI의 로컬 검증을 완료했다. registry334종·예제69개/11범주이며 원본75행 중 신규59행을 실제 실행·작업 흐름 증거로 승인하고 기존16행은 이전 mapping/status 그대로 보존했다. 현재 선택 subset은364/385행·미구현21행이다. [검증 기록](m13-validation.md)·[실제 standalone 실행](evidence/m13-verification.json)·[UI 작업 흐름](evidence/m13-ui-workflow-verification.json)·[원본행 승인](evidence/m13-source-approvals.json)을 따른다. M13의 병합·공개 배포는 별도 릴리스 게이트이며, 현재 공개 검증 버전은 M12의 앱0.13.0이다. 모든75행의 원본 전체 옵션과 MathWorks 런타임 비교는 열린 상태다.

## 값·형식·경계

문자열은 기존 M10 wire `{kind:'typed',dtype:'string',shape:[],data:[text]}`를 사용한다. 문자열당256 UTF-16 단위 상한을 보존한다. 문자열 위치·길이는 Unicode code point 기준으로 계산해 surrogate 쌍을 분리하지 않는다. ASCII0~127 fixture를 원본 선택 범위로 검증하고, 비ASCII Unicode 처리는 독립 확장으로 공개한다. 대소문자 무시는 ASCII A–Z의 소문자화이며 Unicode 전체 case folding 등가를 주장하지 않는다.

문자열 소비 블럭은 typed 문자열 scalar만 받는다. 기존304개의 legacy 소비 계약은 바꾸지 않으며, 표시·기록에는 `io.structured-output` 또는 새 기록을 사용한다. 파싱 결과 정수·실수는 typed 값을 사용하고, legacy 계산으로 넘어갈 때 `signal.to-legacy`를 명시한다. 변하는 연속 입력을 문자열 변환에 연결하려면 Zero Order Hold로 경계를 선언한다.

Compose 형식은 `%s %d %u %f %e %g %%`, f/e/g의 `.precision`0~17(g는1~17)과 최대8개 변환만 허용한다. 기본 f/e 소수 자리수6을 사용한다. flags·width·길이 수정자·임의정규식·실행 코드는 받지 않는다. Scan은 `%s %c %d %u %f %lf %%`이며 결과는 각각 string/string/int32/uint32/float32/float64다. 형식의 whitespace를 소비하며 `%s`는 whitespace 전까지, `%c`는 code point 하나를 읽는다. 오류 처리 `error`와 명시적인 `zero`만 제공하고 원본 경고 메시지의 등가를 주장하지 않는다.

실수 f/e/g는 유한 IEEE 값에 JS 반올림·표현 알고리즘을 적용한다. g의 기본 유효숫자는6이며 반올림 후 지수가−4 미만 또는 precision 이상이면 지수 표기를 쓴다. 지수는 최소 두 자리로 출력한다. f에서 절댓값이1e21 이상이면 실제 IEEE 정수 값을 BigInt로 십진 출력하고256단위 출력 상한을 유지한다. C printf·MATLAB sprintf 반올림 tie 및 전체 형식 옵션과의 실행 등가는 검증하지 않았다. Scan invalid=zero는 이미 일치한 앞쪽 필드를 보존하고 남은 필드에0·빈 문자열을 채운다. To String은 builtin 정수·boolean·enum·string과 fixed의 정확한 저장 값 기반 십진 문자열을 지원하며 complex는 거부한다.

Probe는 CalcWeave의 구조화된 bus metadata 인터페이스다. dimensions는 rank와 함께 고정8자리로 표현하고 samplePeriod/sampleOffset은 선언된 CalcWeave 샘플 grid의 metadata다. 원본의 선택 가능한 별도 출력 포트·출력 자료형과 같다는 주장은 하지 않는다.

## 정의·포트·파라미터

포트 표의 출력은 공개 연결 포트다. 공개 출력 포트가 없는 기록·관측 sink도 compiler 내부 `out` descriptor를 갖고 결과에 기록한다. 동적 형식과 입력 개수는 compiler가 검증한 뒤 포트를 결정한다.

| ID | 입력 → 출력 | 공개 파라미터·선택 계약 |
|---|---|---|
| source.string-constant | 없음 → out | value 문자열≤256 |
| string.ascii-to-string | in → out | typed uint8 vector1~256, 첫NUL 종료, ASCII 범위 검사 |
| string.compose | arg1..argN → out | format, N1~8 |
| string.scan | in → out1..outN | format, invalid error/zero |
| string.string-compare | a,b → out boolean | caseSensitive yes/no, firstN0~256(0 전체) |
| string.string-concatenate | in1..inN → out | count2~8, 결과≤256 |
| string.string-contains | in,pattern → out boolean | caseSensitive |
| string.string-count | in,pattern → out uint32 | caseSensitive, 겹치지 않는 일치 |
| string.string-find | in,pattern → out int32 | caseSensitive, 첫 위치1부터/없음−1/빈 패턴1 |
| string.string-length | in → out uint32 | code point 개수 |
| string.string-to-ascii | in → out uint8 vector,length uint32 | capacity1~256, NUL padding, 비ASCII·상한 초과 오류 |
| string.parse-number | in → out float64/float32 | dtype, invalid error/zero, special error/preserve |
| string.parse-enum | in → out enum | type의 등록label 정확 일치 |
| string.substring | in,start,length → out | toEnd yes면 length포트 제거, start1부터/끝 초과 길이 clamp |
| string.to-string | in → out | format 단일 변환, 승인된 숫자·boolean·enum·string scalar |
| dashboard.control | 없음 → out 실수 | kind,initial,min,max,step,choices,events,appearance,orientation,title |
| dashboard.indicator | in → out,band uint32 | kind,min,max,thresholds,labels,gaugeStyle,appearance,orientation,title |
| dashboard.action | 없음 → out boolean | action,events,appearance,orientation,title |
| sink.record | in → 공개 출력 없음 | name,capacity1~1024 |
| sink.xy-graph | x,y → 공개 출력 없음 | name,capacity; 두 실수 scalar를 bus{x,y}로 기록, 축별 단위 보존 |
| sink.floating-scope | compiler 출력 참조 → 공개 출력 없음 | sourceNodeId,sourcePortId, 같은 그래프 실제 출력만 |
| sink.stop | in → 없음 | 단위 없는 실수·boolean scalar, 루트만 |
| signal.probe | in → out bus | 실제 width/rank/dimensions[8]/complex/samplePeriod/sampleOffset |
| math.slider-gain | in → out | gain,min,max,step,events; legacy 실수 형상·단위 보존 |
| data.output-file | in → 공개 출력 없음 | name,capacity,format json/csv; 명시 로컬 다운로드 |
| data.output-dataset | in → 공개 출력 없음 | name,capacity; 로컬 데이터셋 저장 작업 |
| data.input-table | 없음 → out | datasetId,column,interpolation linear/previous,outside hold/zero/error |
| data.signal-editor | 없음 → out | 편집한 datasetId,column,interpolation,outside |
| source.waveform | 없음 → out | kind sine/square/triangle/sawtooth,amplitude,frequency,phase,bias,duty; 연속은 sine만 |
| model.support-catalog | 없음 → out bus | 실제 registry 수·엔진·모드 지원 개수 |

숫자 열은 유한 실수로 재생하며 boolean·문자열 열은 previous 보간만 허용한다. 표 문자열의 일반 저장 상한과 신호의256 단위 상한은 구분한다. 파일·Workspace·Spreadsheet 이름은 검증한 로컬 프로젝트 데이터 작업 흐름이며 MATLAB MAT 파일·workspace 접근은 지원하지 않는다.

## 대시보드와 재현

37개 원본 Dashboard 행은 공통 control/indicator/action과 외형 설정으로 대응한다. kind는 실제 조작 방식과 입력 검증을 선택한다. appearance standard/custom, orientation horizontal/vertical 및 gaugeStyle full/half/quarter/linear는 표시 설정이다. 표시 구간은 증가하는 thresholds와 경계 수+1개의 labels를 사용하며, band는 `value>=threshold`의 구간 index다. 사용자 텍스트·label은 일반 텍스트로 렌더링한다. 임의HTML·image URL·사용자 callback은 받지 않는다.

기존 `model.dashboard`의5개 종류와 source.constant/io.input.value 및 math.gain.gain의 사전 실행 파라미터 연결은 유지한다. 새 dashboard.control은 실제 출력 wire를 사용하는 독립 대체다. 원본의 포트 없는 임의 tunable-variable 연결과 같은 것으로 승인하지 않는다.

events는 최대16384자의 JSON 텍스트 `[{time,order,value}]`다. 노드당256개, 시각은 실행 범위 안이며 배열은 time과 동일시각 order 순으로 정렬한다. order는 유일한0~1000000 정수다. control·slider-gain은 유한 숫자이고 범위·step grid를 검증한다. choice 조작은 등록된 선택 값만 사용한다. action은 boolean 이벤트이며 이벤트 일치 시각의 pulse만 보낸다. 버튼의 action은 run/pause/resume/stop/fit/export-model/export-results 허용 목록으로만 UI에서 처리한다. MATLAB·JS 코드 callback을 받지 않는다.

Live 조작은 이산 실행의 dashboard.control/math.slider-gain만 지원한다. Worker는 pending256/회당32 drain 상한을 적용하고 실제 due 시각에 적용한 `{nodeId,time,order,value}` receipt를 회신한다. 모델 최상위에 새 이벤트 필드는 추가하지 않는다. 승인된 receipt를 노드의 events에 저장해 replayModel을 다시 컴파일·hash하고 이력과 내보내기에 사용한다. 정적·연속 실행은 선언된 이벤트의 재생만 사용한다. 변경을 과거 실행에 적용한 것으로 표시하지 않는다.

JSON 재생 값의 일관성을 위해 새 control의 초기값·slider gain·예약 이벤트·live 입력의 −0은 publication과 receipt에서 +0으로 정규화한다. slider의 실제 산술 결과는 IEEE signed zero를 유지하므로 −1×+0은 −0일 수 있다. 이전304개 정의와 typed IEEE 값의 계약은 바꾸지 않는다.

## 기록·종료·상한

indicator의 out은 입력값을 그대로 전달한다. band는 threshold 분류 index이며 연속 값에서 불연속이다. 이 출력을 변환·중간 연산을 거쳐 연속 상태로 연결하려면 Zero Order Hold 경계를 사용해야 하며, 직접 연결은 `M13_INDICATOR_BOUNDARY_REQUIRED`로 거부한다.

Record/XY/To File/To Dataset은 이산 due 입력을 제한된 `stateMemory[nodeId].m13Records:[{time,value}]`에 저장한다. 같은 tick 중복을 막고 마지막 승인 샘플을 포함한다. capacity 초과는 명시 오류이며 해당 tick의 publication은 commit하지 않는다. 연속 모델에서 변하는 신호를 기록하려면 Zero Order Hold 경계를 둔다. 이4개 정의는 discrete/continuous 모드만 선언한다.

compiler는 `recordDescriptor`, `recordInitial`, `m13StateElements=capacity*(weightedPayload+1)+8`을 IR에만 둔다. 기존 portable model에 유도 metadata를 쓰지 않는다. Floating Scope는 같은 lexical graph의 실제 출력 포트를 합성 입력으로 연결하며 topology·cycle·rate 검증을 받는다.

Stop Simulation은 루트의 완전히 검증된 observation sample 뒤에 정상 종료한다. RunResult.status는 completed이며 stopReason `{nodeId,tick,time}`를 붙인다. 같은 시각 요청은 안전한 nodeId 순서로 선택한다. 연속 실행의 종료는 observation grid 기준이며 zero-crossing 즉시 종료를 주장하지 않는다. 하위 호출 종료 전파는 `M13_STOP_ROOT_ONLY`로 거부한다.

기존 모델5MiB·1000노드·16파라미터·signal1024원소·state100000·record1000000·operations50000000·Worker30초 상한을 유지한다. bounded-json은 일반 JSON 데이터만 파싱하며 깊이8·값2048·문자열 길이를 제한한다. 객체 unsafe key·정렬되지 않은 이벤트·형식 토큰·enum·출력 참조·자료형·단위·shape를 compiler에서 검증하고 runtime에서도 실제 숫자·결과 상한을 확인한다.

Dataset의 선택 provenance는 `{format:'csv'|'json'|'xlsx'|'editor',filename?,sheet?,sourceHash,transforms}`다. filename100자/sheet80자/transforms8개·각100자, sourceHash는 SHA-256이다. 기존8필드 객체는 그대로 허용하고 콘텐츠 hash는 이름·provenance와 분리된 기존 열·시간·행 의미를 유지한다. 실제XLSX 선택 읽기는 boundedZIP/XML parser로 수행하며 실행 macro·외부 링크를 읽지 않는다.

파일 sourceHash는 BOM을 포함한 원본 바이트를 기준으로 계산하고 BOM 제거는 내용 파싱에만 적용한다. XLSX는 입력2MiB·ZIP 항목64개·해제8MiB/항목2MiB·XML100000노드/깊이32·8sheet·4000행/16열/20000셀 상한을 검증한다. CRC·local header와 member를 검사하며 DTD·entity·formula·외부 링크·macro·경로 이동을 거부한다. 값 전용 XLSX 선택 계약이며 `.xls`·MAT 파일 호환을 주장하지 않는다.

## 원자료·검증 범위

원본75행은 동결한 R2024b dataset와 roadmap의 행 identity 및SHA-256을 대응표에 보존한다. 최신 온라인 문서의 R2025a 이후 기능은 원본 승인 범위에 추가하지 않는다. R2024b archive 페이지가 공개 조회되지 않는 경우 최신 기본 알고리즘과 버전 이력을 참고한 선택 계약으로만 기록한다.

기본 동작 참고는 MathWorks의 [String 라이브러리](https://www.mathworks.com/help/simulink/string.html), [String Concatenate](https://www.mathworks.com/help/simulink/slref/stringconcatenate.html), [String Compare](https://www.mathworks.com/help/simulink/slref/stringcompare.html), [Substring](https://www.mathworks.com/help/simulink/slref/substring.html), [Scan String](https://www.mathworks.com/help/simulink/slref/scanstring.html), [Dashboard](https://www.mathworks.com/help/simulink/dashboard.html), [Combo Box](https://www.mathworks.com/help/simulink/slref/combobox.html), [Callback Button](https://www.mathworks.com/help/simulink/slref/callbackbutton.html)이다. 원본 Callback Button의 MATLAB 코드 실행과 CalcWeave 허용 작업 목록은 별개의 독립 대체다.

139개 raw fixture의350개 정상 모드,15개 실패,361개 실제 standalone TypeScript 실행과846표본을 검증했다. 전체 unit3515개,전체 browser167개 및 최종 입력 경계3개,UI 관련 unit116개를 확인했다. Dashboard37개 설정은 실제 컴파일·계산·렌더링·브라우저 조작 증거를 갖는다. source 승인은 이 선택 계약의 실행 결과를 기준으로 하며 모든 전체 옵션·원본 runtime parity·추가 target은 후속 작업으로 남긴다.
