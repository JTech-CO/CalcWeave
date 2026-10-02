# M7 코드 타깃·재사용 패키지·가져오기 계약

2026-10-03 · 앱 0.7.0 · 엔진 0.7.0-m7 · 모델 schema 1

M7의 첫 추가 언어는 Python이다. M1~M6의 실행 의미와 기존 TypeScript export를 유지하고, 검증한 정적·이산 subset의 독립 Python 실행, 서명된 선언형 모델 패키지, 가져오기 단계 보고를 추가한다. C/C++·MATLAB·S-function·WASM·일반 사용자 커널은 승인하지 않는다. M6의 도메인·공개 출시·실제 사용자 관찰 확인 항목은 별도 유지한다.

## Python 타깃

`python-m7-v1`은 Python 3.10 이상에서 표준 라이브러리만 사용한다. 별도 CalcWeave·Node.js·NumPy·서버·네트워크는 실행 의존성이 아니다. 실제 시험에 사용한 Python 버전은 검증 기록에 남기며 모든 Python 버전/플랫폼 시험으로 해석하지 않는다.

정적·이산의 float64/boolean scalar·vector·2D, M1 산술·논리·라우팅·제한 수식, M2 시간 입력·seed 난수·typed 상태·rate, M4 승인 데이터 재생·단위 변환·동질 bus와 투명한 계층을 지원한다. 정확한 블럭 목록은 코드 생성기와 registry가 함께 사용하는 `capabilities.ts`의 승인 목록이다. 계층은 확장된 모든 하위 노드가 해당 타깃에 지원돼야 한다. 연속·혼합 solver 및 M5 행렬 분해/풀이·2D Lookup·Prelookup·고정소수점 양자화는 Python 생성 전에 원본 위치·하위 경로와 이유로 거부하고 TypeScript 타깃을 안내한다.

생성 경계에서 원본 모델을 다시 컴파일해 IR 위조·오래된 스냅샷을 거부한다. 모든 사용자 문자열·ID·데이터는 JSON의 UTF-8 hex 데이터로 내장하며 Python 소스 식별자나 구문으로 사용하지 않는다. 제한된 수식은 검증된 AST를 고정 interpreter로 계산한다. `eval`·`exec`·pickle·외부 module 로드·사용자 파일 경로·URL 실행은 사용하지 않는다. `model.py`의 `run()`과 `get_manifest()`는 방어적 복사를 제공한다. 직접 실행은 성공 시 `{manifest,result}`를 JSON으로 출력하고, 계산 실패 시 진단·부분 결과를 JSON으로 출력한 뒤 종료 코드 1을 반환한다.

독립 실행은 정수 tick·due 간격/offset·read-before-write rate transition·동시 상태 commit·마지막 tick 미commit·reset·seed 계약을 따른다. 타입·형상·단위는 compiler 출력 계약을 유지하며 유한값·숫자 정의역·계산/시간/기록/상태 예산을 검사한다. Python bool과 int를 혼동하지 않고 float64 산술에 임의 정수 정밀도를 끼워 넣지 않는다. JS와 Python의 초월 함수는 적절한 수치 허용오차로 비교하며 boolean·seed·정수 비트·시간축·출력 형상과 실패 code/node/tick은 정확하게 비교한다. 서로 다른 실행 환경의 벽시계 만료 시각 자체는 수치 parity에 포함하지 않는다.

manifest는 기존 canonical semantic SHA-256·엔진·출력 타입·rate·seed·데이터/계층 출처·자원 상한을 유지하고 Python 타깃·최소 환경·내장 IR 데이터 hash를 추가한다. 실행 묶음은 고정 파일 이름의 ZIP으로 `model.py`, `run-example.py`, `model.cw.json`, `manifest.json`, `README.md`와 현재 유효한 완료 결과가 있을 때 `expected-output.json`을 담는다. 한 파일 16 MiB·전체 32 MiB·최대 6파일 상한을 유지한다. 타깃 선택은 원래 모델·실행 결과·기존 TS 다운로드 버튼을 바꾸지 않는다.

Python의 내장 IR 데이터는 8 MiB, 최종 소스는 16 MiB 이하다. 여러 Playback 노드가 같은 데이터 열을 내장하는 경우의 합산 크기도 확인하며 큰 JSON/hex 할당 전에 거부한다. 모델 자체의 5 MiB 상한을 통과했더라도 특정 코드 타깃의 생성 상한을 넘을 수 있다.

## 재사용 패키지

`calcweave-model-package` version 1은 승인된 registry의 모델·데이터·하위 정의·대시보드·노트를 공유하는 선언형 파일이다. 임의 라이브러리·실행 코드·URL·웹 권한·파일 시스템·OS 권한을 설치하는 plugin이 아니다. 권한은 정확히 `local-model`만 허용하며 모델·엔진·schema·registry 버전과 입출력/파라미터 지원 계약을 서명된 payload에 바인딩한다. 패키지 전체·모델 크기/깊이/키/형상 상한을 cryptographic 연산 전에 검사한다.

파일 생성마다 추출 불가능한 일회용 ECDSA P-256 키로 SHA-256 서명을 만든다. 개인키는 저장·파일 출력·소스 포함·서버 전달하지 않는다. 공개키 fingerprint를 발신자에게 보여 별도 경로로 출처를 확인할 수 있게 한다. 서명은 파일의 일관성을 확인하지만 파일 안에 들어 있는 공개키만으로 발신자의 신원을 신뢰하지 않는다. 수신자는 출처에서 별도로 확인한 fingerprint를 입력해야 수락할 수 있다. 발신자를 모르는 파일은 미리보기만으로 승격하지 않는다. 지속적인 발신자 identity·인증서·공개 키 디렉토리·자동 trust store·폐기 목록은 제공하지 않는다.

미승인 fingerprint·손상 hash/서명·추가 권한·버전/registry 불일치·미지원 실행 계약은 실제 모델 변경 전에 거부한다. UI는 검증된 내용·출처 fingerprint·모델 크기·실행 여부를 보여주고 명시적 수락으로 모델을 연다. 수락 이후의 모델 변경은 기존 undo와 저장 충돌 정책을 유지한다. 서브시스템 편집/참조는 기존 정의 버전 계약을 따르며 패키지 수락이 전체 registry를 변경하지 않는다.

## 가져오기 단계

구문 파싱, 외부 형식 변환, 실행 가능성을 따로 보고한다. CalcWeave native JSON은 구조 검증 후 원래 모델로 열므로 외부 형식 변환을 수행했다고 표시하지 않는다. 구조가 유효하지만 컴파일이 실패한 모델은 편집 가능하게 열고 원본 블럭별 진단을 유지한다. JSON이나 모델 schema 자체가 무효이면 기존 작업을 변경하지 않는다.

Simulink `.slx`/`.mdl`, MATLAB/C/S-function과 일반 외부 모델은 변환 어댑터가 없다. 식별되지 않은 형식을 native 모델로 성공 변환했다고 표시하지 않는다. 텍스트·CSV 데이터 import와 실행 모델 import는 구분한다. 새로운 어댑터는 파일 parser뿐 아니라 rate·event·solver·타입·형상·단위·권한·실패 의미의 별도 검증을 통과해야 한다.

## 종료 증거

`F07-target-parity`는 승인 fixture의 JS runtime·독립 TS·실제 Python의 시간축·출력·상태·부분 실패를 비교한다. 대표 브라우저 Worker와 실제 다운로드 파일도 별도 확인한다. `F07-target-reject`는 미지원 모드/블럭 위치·manifest/IR 위조를 생성 전에 거부한다. `F07-package-contract`는 실제 서명 검증·출처 신뢰·버전·권한·손상 거부와 무변경을 확인한다. `F07-import-boundary`는 파싱·변환·실행의 상태와 모델 보존을 확인한다. 로컬 시험을 M6 공개 출시나 모든 외부 runtime 호환의 완료로 기록하지 않는다.

Python [`json`](https://docs.python.org/3.14/library/json.html)·[`math`](https://docs.python.org/3.14/library/math.html), Web Crypto [`sign`](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/sign) 계약을 참조한다. 입력 크기는 parser의 기본 동작에 맡기지 않고 CalcWeave 한도를 먼저 검사한다.
