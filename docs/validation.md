# CalcWeave 검증 상태

현행 소스는 앱 `0.26.0` · 엔진 `0.17.0-m16`이며 최신 공개 앱은 `0.24.0`이다. 이 문서는 구현의 검증 범위와 배포 증거를 연결한다. M24~M25는 로컬 구현·검증·커밋 범위다. 과거 단계의 수치·실패 기록은 `evidence/`에 보존하고 M23의 공개 배포와 이후 소스의 상태를 구별한다.

## M25 Welch와 시간·주파수 관측 · 로컬 검증 완료

2026-10-09(Asia/Seoul), 앱 `0.26.0`의 **분석 → 시간·주파수 분석**을 구현했다. 완료된 실수 기록8~8192개를 창 길이8~2048의2의 거듭제곱·명시적 겹침·직사각형/주기형 Hann·구간별 평균 제거로 분석한다. Welch는 완전한 구간의 단측 PSD 산술 평균이며 STFT는 각 구간의 비정규화 순방향 DFT·진폭·위상·PSD와 실제 첫/끝/중점 시각을 보존한다. 불완전한 꼬리는 원시 입력에 보존하면서 평균 PSD에서 제외하고 사용/제외 표본 수를 보고한다.

[M25 검증 기록](evidence/m25-verification.json)은 수치 코어52개·독립 시간 격자/미세 PSD 회귀13개·UI/설정43개, 신규 **108개 검사**, 전체 **4,923/4,923 PASS · 93개 파일**, 타입 검사·프로덕션 빌드·루트 정적 release **111 PASS**를 기록한다. 실제 Chromium의 M25 **10/10**, M21 **7/7**, M24 **10/10**, 초기 fit·자동 저장·Space·Worker/stale/Undo·키보드 연결·반응형 **6/6 PASS**를 확인했다. 마지막 Welch 평균 underflow 진단 추가는 별도 코어 회귀로 검사했고 최종 빌드의 화면 증거를 다시 생성했다. [독립 직접 DFT 관측](evidence/m25-independent-numeric-review.json)은160개 신호의1,075구간·22,555빈을 비교했고 PSD 최대 절대 차이는1.39e−15, 창 제곱합으로 나눈 Parseval 적분 최대 차이는3.56e−15였다. 선택 길이와 창이 같을 때 네 창/평균 제거 조합에서 M21 빈이 정확히 일치한다.

[독립 검토](evidence/m25-independent-review.json)에서 전체 격자를 통과한 시간 오차가 구간 재적합에서 거부되는 경계를 수정했다. 꼬리가 있는 단일 구간에도 공통 fs를 적용하며 원시 시각은 변경하지 않는다. 낮은 fs에서 표현 가능한 미세 PSD가 중간 제곱으로 사라지지 않도록 공통 fs·창 제곱합으로 정규화한 크기를 먼저 제곱한다. 정확히2·MIN_VALUE인 밀도와 소수 미세 값의 해석식을 검사했다. 프레임 PSD/RMS와 Welch 평균의 Float64 underflow는 원시 양수 값과 구분해 진단한다.

실제 Worker의 해석적 사인/DC/Nyquist·chirp 직접 DFT·원시 구간/꼬리/시각·모델/이력 불변·SHA/IEEE 음의 영·폼 편집 스냅샷·잘못된 초안/비유한 입력·이전 실행·지연된 import 후 닫기·128행 페이지·4096셀/예산 거부를 확인했다. 선형/dB 표시는 원시 JSON을 바꾸지 않으며0의 로그는 정의되지 않은 별도 표식으로 남긴다. 화면은 최대512개 실제 Welch 빈·4096개 실제 열 지도 셀이고 전체 빈은 표/JSON에 보존한다. [다크 Welch/STFT](evidence/m25-time-frequency-dark.png), [라이트 설정](evidence/m25-time-frequency-light-settings.png), [320px 글자200%](evidence/m25-time-frequency-mobile-dark-200.png), [390px 라이트](evidence/m25-time-frequency-mobile-light.png), [화면 관측](evidence/m25-design-observations.json)을 보존한다. 양쪽 테마에서 최소 설명/입력 글자16px·200%32px와 페이지/패널 가로 넘침 없음을 검사했다.

사전 계산 상한은128구간·65,536빈·800만 정책 작업량이며 기존 완료 기록 출처16개/투영100만 원소 상한을 사용한다. 평균의 분산 감소·확정 주파수·통계 신뢰도·역 STFT 복원을 보증하지 않는다. 신규 의존성·서버·계정·개인정보 수집·추적 없이 React 이스케이프·descriptor/숫자/시간/자원 검증을 적용했다. 기존385행 coverage·337개 등록 정의·75개 예제·schema1·엔진 의미와 과거 증거를 보존한다. M25의 push·Pages 배포·공개 앱 업데이트를 수행했다고 주장하지 않는다.

## M24 시간 구간 통계와 신호 상관 · 로컬 검증 완료

2026-10-09(Asia/Seoul), 앱 `0.25.0`의 **분석 → 시간 구간 통계와 신호 상관**을 구현했다. 완료한 시간 실행에서 legacy 실수 scalar/vector/matrix와 Typed float32/64 실수 성분의2~8192개 임의 정수 길이 구간을 선택한다. 평균·RMS·최소/최대·N 모집단 분산과 N−1 표본 분산/표준편차·분모·단위를 보고한다. 각 표본의 가중치는 같으며 시간 가중 평균·적분은 제공하지 않는다. 복합 단위의 제곱은 `(m/s)²`처럼 전체 단위를 묶어 표시한다. 당시 M25 Welch·시간-주파수 관측은 후속 계획이었다.

상관은 같은 기록의 정확히 같은 원시 시각·단위를 사용한다. 양의 지연 k는 X[i]와 Y[i+k]를 비교하며 Y가 X 뒤에 오는 방향이다. 평균 제거는 지연별 실제 겹침에서 각각 수행하고, 평균 유지 모드는 원시 코사인 상관이다. 최대 지연512·최소 겹침2 이상, 합산 계산 예산2천만을 사전 검사한다. 영 에너지·겹침 부족은null로 보존한다. 실제 겹침 수·범위·평균·raw/scaled 정규화 수치를128행 표에 남기고 그래프는512개 이내 실제 지연에 양 끝·0 지연·피크를 유지한다. 피크는 인과관계나 확정 지연이 아니다. 원시 입력·설정·모델/구간 SHA를 JSON으로 보존하고 음의 영을 구별하는 해시 규약과 정확한 IEEE Float64 비트 배열도 포함한다. 모델과 저장 기록을 바꾸거나 새 실행을 자동 시작하지 않는다.

[M24 검증 기록](evidence/m24-verification.json)은 코어78개·출처131개·UI33개, 신규 **242개 검사**와 전체 **4,815/4,815 PASS · 89개 파일**, 타입 검사·프로덕션 빌드·루트 정적 release107검사를 기록한다. 해석식·독립 pairwise 분산·직접 겹침 oracle, 상수·반전·DC·양/음 지연·N/N−1·최소 겹침·고오프셋 인접Float64·비정규값·불균일/정밀도 부족·자원 경계·접근자/희소/추가 필드를 검사했다. [독립 수치 관측](evidence/m24-independent-numeric-review.json)은 정수 좌표를 기준으로 상관2,000개·고오프셋 분산1,000개를 비교했으며 최대 상관 절대 오차3.33e−16, 정의 여부 불일치0개다.

실제 Chromium의 **M24 10/10**, M21 **7/7**, M23 **11/11**, 초기 fit·자동 저장·Space/키보드 연결·Worker/stale/Undo·반응형 배치 **6/6 PASS**를 확인했다. 원시 기록의 평균4/모집단 분산4.5/RMS√20.5·13개 선택 구간·실제3표본 지연·독립 겹침 분자/분모·형상/비유한 성분·JSON 스냅샷·이전 실행·음의 영·513행/128행 페이지·예산 거부와 지연된 import 뒤 패널 닫기를 검사했다. 320/390px 두 테마와 전체 패널 글자200%에서 가로 넘침·미이스케이프 HTML이 없고 입력/버튼과 모든 안내 문구의 최소 글자는16px/32px임을 최종 추가 검사로 확인했다. [다크 결과](evidence/m24-statistics-desktop-dark-result.png), [라이트 설정](evidence/m24-statistics-desktop-light-settings.png), [320px 글자 확대](evidence/m24-statistics-320-dark-2x.png), [화면 관측](evidence/m24-design-observations.json)을 보존한다.

[독립 검토](evidence/m24-independent-review.json)에서 JSON 숫자가−0의 부호를 잃는 문제를 재현해 해시의 구별 토큰과 big-endian IEEE hex 배열을 추가했다. 복합 제곱 단위 표기와 공통 대화상자 CSS가 안내 글자를14px로 만드는 상속도 교정했다. 최초 수치 테스트3개는 극대 분산의1ULP보다 작은 절대 허용오차·정확±1 비교를 사용해 실패했으며 독립 oracle를 유지하고 상대 정밀도로 비교하도록 수정했다. 최초 브라우저1개는 삭제한 노드의 layout을 남긴 잘못된 Typed fixture를 교정했다. 브라우저와 동시 실행한 전체 단위 검사에서 기존 코드 생성4개가15초 상한에서 `STACK_TRACE_ERROR`를 기록했다. 해당 코드를 바꾸지 않고 worker2의 단독 실행으로 전체4,815개를 통과했다. 이 관측으로 환경 부하가 유일한 원인이라고 확정하지 않는다.

서버 API·계정·개인정보 수집·추적·신규 의존성은 없다. React 텍스트 이스케이프, 순수 숫자/객체 검증, 합산 자원 상한과 실행 출처를 검사했다. 기존385행 coverage·337개 등록 정의·75개 예제·schema1·엔진 의미는 보존한다. M24에서 Pages 배포·공개 앱 업데이트·공개 사이트 검증을 수행했다고 주장하지 않는다.

## M23 시드를 고정한 불확실성 앙상블 · 로컬 검증 완료

2026-10-09(Asia/Seoul), [제품 확장 계획](product-extension-roadmap.json)의 M23를 앱 `0.24.0`에 구현했다. **실험 → 불확실성 앙상블**은 루트의 legacy 실수 스칼라 Constant/Input 값·Gain 배율을1~3개 선택해 독립 균등·삼각 분포에서2~64개 표본을 만들고 실제 Worker로 순차 실행한다. uint32 seed·LCG32·draw 순서·분포·기준 모델/지문·모든 계수와 원시 결과를 JSON에 보존한다. 완료한 실행의 같은 단위·정확히 같은 원시 시각에서 평균·n−1 표본 표준편차·최소/최대·선형5/50/95% 분위수를 계산한다. 완료1개이면 SD는null이다. 실패 제외 통계의 편향과 분위수 구간이 신뢰구간이 아님을 표시한다. 당시 M24~M25는 후속 계획이었다.

[M23 검증 기록](evidence/m23-verification.json)은 새 코어91개·UI44개의 **135개 검사**, 전체 단위 **4,573/4,573 PASS · 86개 파일**, 최종 표시 수정 후 M19를 포함한 **217/217 PASS**, 타입 검사·프로덕션 빌드를 기록한다. literal seed0/1의 LCG 상태·BigInt oracle·독립 affine 원시 값/통계·삼각 역CDF·seed 재현/변경·최대64개·수치 실패·완료1개/0개·극단 float64·부호·단위·정확 격자·접근자·희소 배열·악의적 자원 보고·늦은 executor를 검사했다. 전체30초·100만 기록 원소(시각 포함)·5천만 실행 연산·32 MiB 모델 스냅샷 한도를 공유하고 검증된 실패 부분 결과도 차감한다. 취소·시간 초과 뒤 집계를 새로 시작하지 않으며 완료 원시 기록은 남긴다. 자원 수치는 검증하여 수신한 결과의 합계로, 결과 없이 중단된 실행의 미보고 사용량을0으로 단정하지 않는다.

실제 Chromium의 M23 **11/11 PASS**, M19 **7/7 PASS**, M22 **12/12 PASS**, M13 대시보드 **3/3 PASS**, 초기 캔버스·자동 저장·키보드 편집 **5/5 PASS**, 합계 **38/38 PASS**를 확인했다. 실제 seed/draw·실패 표본/SDnull·JSON 스냅샷·명시적 적용/Undo·stale 차단·typed/vector/boolean 집계 거부·취소 후 늦은 Worker 결과·128행 통계 페이지·320/390px 두 테마와 전체 패널 글자200%를 검증했다. 그래프는 실제 원시 시각을 사용하며512개 시각을 넘으면 표시용으로 선택하고 전체 원시 값은 표/JSON에 보존한다. [다크 결과](evidence/m23-ensemble-desktop-dark-result.png), [라이트 설정](evidence/m23-ensemble-desktop-light-settings.png), [320px 글자 확대](evidence/m23-ensemble-320-dark-2x.png), [화면 관측](evidence/m23-design-observations.json)을 보존한다.

[독립 검토](evidence/m23-independent-review.json)에서 대시보드의 실시간 입력이 실험 Worker 조건을 바꿔도 원래 모델 지문으로 집계되는 경로를 발견했다. 실험 중 live 입력을 거부하고 Worker의 모델 SHA·엔진 버전·replay 모델을 확인하도록 수정했다. 실제 Worker를 일시정지하고 입력 변경을 시도하는 검사와 실제 결과 패킷의 지문을 바꾸는 검사가 이를 검증하며 일반 단독 실행의 대시보드 입력은 유지된다. 최초 패치가 유사한 M19 래퍼에 들어갔던 위치도 교정해 M23 경로를 재검토했다. 화면 관측에서 공통 CSS의15.52px 입력 글자 상속을 발견해 해당 패널의 우선순위를 높여16px로 고정했다. 처음 보고서 모델을 UI의 생략된 기본값과 비교하던 oracle는 컴파일러의 정규화된 sampleTime·sum.signs를 기준으로 교정하되 UI 모델 전후 불변 검사는 유지했다. 단일 실행 상한에 먼저 걸리던 기록 preflight fixture도 단일 실행은 허용되고 전체 앙상블은 초과하도록 고쳤다. 수치 구현·독립 oracle를 실패 예상값에 맞춰 변경하지 않았다.

[최종 릴리스 검증](evidence/m23-root-release-verification.json)은103개 검사·19개 정적 자산의 실제 bytes/SHA·오프라인 목록·보안 설정을 확인한다. [라이선스 기록](evidence/m23-licenses.json)은 기존28개 프로덕션 의존성을 유지한다. 엔진·schema·registry337개·예제75개를 유지하고 신규 npm 라이브러리·서버 API·외부 계산 서비스·개인정보 수집을 추가하지 않는다. 상관/정규 분포·모델 내부 난수 seed 자동 변경·비legacy 기록 출력·다른 격자의 보간·통계적 신뢰도 인증·전역 최적화·Firefox/Safari는 완료 범위 밖이다. 당시 로컬 검증에는 공개 배포를 포함하지 않았으며 이후 공개 결과는 아래에 기록한다. 기존 큰 chunk·정적/동적 import 중복·Vite 향후 config 권고는 빌드 경고로 남는다.

## M23 공개 배포와 구버전 UI 수정

2026-10-09(Asia/Seoul), 공개 서버는 캐시 MISS·age0 응답에서도 앱0.17.3과10월4일 게시 파일을 제공했다. 저장소의 최신 코드와 공개 게시가 분리되어 있었고 [Pages workflow](../.github/workflows/pages.yml)는 명시적인 `workflow_dispatch`만 게시한다. [공개 전후 기록](evidence/m23-public-layout-release.json)에 서버 응답·releaseId·화면 실측을 보존했다. 운영 안내에 [구버전 UI 확인·조치](operations.md#배포와-업데이트)를 추가했다.

첫 [Actions 37893823331](https://github.com/JTech-CO/CalcWeave/actions/runs/37893823331)은 브라우저268/272 PASS 후 모바일 도움말·백업 대화상자4개 검사에서13.6px 글자 크기로 실패해 게시를 건너뛰었다. 대화상자 내부의 작은 글자만14px로 복원하고 같은 검사 기준을 유지했다. [수정 검증](evidence/m23-public-layout-fix-verification.json)은 별도 production preview의 M6·M20 브라우저22/22 PASS를 기록한다.

최종 [Actions 37896847510](https://github.com/JTech-CO/CalcWeave/actions/runs/37896847510)은 소스 `db718b30341fa92f526bc22b837b82f94c64b4c5`에서 단위4,573/4,573·전체 브라우저272/272·프로젝트 경로4/4·루트/프로젝트 release 각각103검사를 통과한 뒤0.24.0을 게시했다. [CI 원본 요약](evidence/m23-actions-verification.json)과 [정확한 공개 파일 검사](evidence/m23-deployment-verification.json)는 Linux CI의 실제 Pages artifact를 기준으로 한다. `/CalcWeave/`와 `/CalcWeave/index.html` HTML,19개 정적 자산, manifest와 service worker가 일치했다. [게시 manifest](evidence/m23-published-manifest.json)의 releaseId는 `9b0718b018d6f90dc12c1a4882dbdb2a360ef39f1fd89171de038dd85f1e13e5`다. [알려진 credential 형식 검사](evidence/m23-public-artifact-secret-check.json)는 artifact21파일에서 일치0개이며 모든 시크릿 부재를 보증하는 검사는 아니다.

| 1440px 공개 화면 실측 | 구버전 | 새 버전 |
| --- | --- | --- |
| 중앙 캔버스 너비 | 558px | 823px |
| 좌측 라이브러리 너비 | 250px | 175px |
| 우측 설정 너비 | 312px | 218px |
| 상단 높이 | 119px | 약73px |
| 도구 모음 높이 | 65px | 약42px |

[이전 화면](evidence/m23-public-layout-before.png)·[새 화면](evidence/m23-public-layout-after.png)은 같은 격리 프로필과 모델을 사용한다. 최초 실행에서0.17.3의 active worker·새 waiting worker·명시적 업데이트·0.24.0 재열기·전체 IndexedDB 모델 일치까지 통과한 뒤, CSS의 최소 높이50px를 실제 높이로 잘못 가정한 검사에서 실패했다. [최초 관측](evidence/m23-public-layout-initial-probe.json)과 [당시 검사 원문](evidence/m23-public-layout-initial-probe-source.txt)을 보존했다. 이후 이미 업데이트된 프로필에서 실측 축소를 비교했으며, 단축키가 포함된 버튼 accessible name을 exact 일치로 찾던 [두 번째 관측 실패](evidence/m23-public-layout-control-probe.json)도 기록했다. 앱 동작을 바꾸지 않고 관측 조건을 교정했다. 최종 후속 검증은 새로운 구버전 전환을 다시 수행했다고 주장하지 않는다.

최종 후속 검증에서 전체 모델과 실제 모델 다운로드의 SHA가 이전과 같고, 실제 Worker 결과6과 새 브라우저의 두 접속 경로를 확인했다. 적용 직전 미저장 편집은 이 관측의 검증 범위에 포함하지 않았다. 별도의 [공개 기능9검사](evidence/m23-public-browser-verification.json)는 실제 Worker6·오프라인 편집 후10·337개 도움말 목록·정책4페이지·정확한 scoped cache·Python 실행 묶음의 실제 다운로드를 확인했다. 사용자 브라우저·저장 자료에 접근하지 않았고 페이지 오류·범위 밖 요청은0이다.

공개 검증 도구는 디렉터리 HTML의 byte/SHA도 필수 조건에 포함하고, 브라우저 시간 초과가 성공으로 기록되지 않도록 보강했다. 이후 검증 도구·증거 문서 정리는 같은 앱 artifact를 다시 게시하지 않는다. 기술적 앱 배포는 PASS이며 목표 도메인·실제 초보자 관찰·정식 출시의 별도 미확인 gate는 유지한다.

## M22 이산 SISO 제어계 분석 · 로컬 검증 완료

2026-10-09(Asia/Seoul), [제품 확장 계획](product-extension-roadmap.json)의 M22를 앱 `0.23.0`에 구현했다. **분석 → 이산 제어계 분석**은 현재 순수 이산 모델의 루트 State-Space, 리셋이 꺼진 실수 SISO·상태1~4개를 사용한다. Ts=period×기본 실행 간격, z=exp(jωTs)의 Bode·상태 극점·미약분 영점·단위원 판정을 제공하며 단위 음의 피드백을 명시한 경우에만 표본 여유·근궤적을 표시한다. 실제 설정·offset 시간원점·모델 지문·영 초기상태/로컬 rate 가정·원시 결과를 JSON에 보존하고 모델을 실행하거나 변경하지 않는다. 당시 M23~M25는 후속 계획으로 남겼다.

[M22 검증 기록](evidence/m22-verification.json)은 코어77개·출처24개·UI34개의 **135개 새 검사**, 전체 단위 **4,438/4,438 PASS · 84개 파일**, 타입 검사·프로덕션 빌드를 기록한다. 독립 해석식 FIR/IIR·1~4차·직접 D·정확 Nyquist 끝점, 실제 실행기의 impulse `[D,1,.5,.25,.125]`, 단위원 안/위/밖·불안정 숨은 상태·반복근 거부·특이점 null 구간·Nyquist 여유·피드백1+KD=0을 대조했다. 연속/이산 wrapper는 수치 코어를 공유하며 [원본과의 별도 비교](evidence/m22-continuous-regression-review.json)에서33개 연속계 전체 JSON 보고서가 M21 HEAD와 일치했다.

실제 Chromium의 M22 **12/12 PASS**, M20 **9/9 PASS**, M21 **7/7 PASS**를 최종 빌드에서 확인했다. 초기 fit1440/1920px·자동 저장·키보드 편집 회귀도 **4/4 PASS**다. 출처 SHA·모델 비실행/불변·직접 전달항·피드백 선택·단위원 안정성·특이 끝점·잘못된 초안에서 보고서 보존·출처 변경 초기화·수치 불확실성 실패·연속/리셋/5상태 거부를 확인했다. 320/390px의 다크·라이트와 패널 전체 글자200%에서 가로 넘침 없이 입력·버튼16px를 유지했다. [다크 결과](evidence/m22-control-desktop-dark-result.png), [라이트 설정](evidence/m22-control-desktop-light-settings.png), [모바일](evidence/m22-discrete-control-390-dark-1x.png), [320px 글자 확대](evidence/m22-discrete-control-320-light-2x.png)와 [화면 관측](evidence/m22-design-observations.json)을 보존한다.

초회 브라우저27개는 통과했고 모바일 검사1개에서 workbench의13.6px 규칙을 상속한 입력/버튼을 발견했다. M22 패널에16px를 명시하고 다시 빌드한 뒤28개가 모두 통과했다. 초회 출처 fixture의 숫자 리셋·출력 없는 모델은 컴파일러가 올바르게 거부했으므로 boolean 리셋·연결 출력으로 교정했다. 수치근의−0과+0을 객체 bytes로 비교하던 검사도 수치 비교로 바꿨다. 수치 구현·oracle를 실패 예상값에 맞춰 변경하지 않았다.

[최종 릴리스 검증](evidence/m22-root-release-verification.json)은103개 검사·19개 정적 자산의 실제 SHA·오프라인 목록·보안 설정을 확인했다. [라이선스 기록](evidence/m22-licenses.json)은 기존28개 프로덕션 의존성을 보존한다. 엔진·schema·registry337개·예제75개와 보안의 입력 상한·React 출력 이스케이프를 유지하며 신규 npm 라이브러리·외부 계산 서비스·서버 API·개인정보 수집을 추가하지 않는다. 하이브리드 discreteStep·리셋·초기조건 과도 응답·다중 rate/버퍼의 전체 폐루프·MIMO·자동 시간영역 변환·PID 튜닝·안정성 보증, Firefox/Safari·공개 배포는 완료 범위 밖이다. 기존 큰 chunk와 정적/동적 import 중복·Vite 향후 config 권고는 빌드 경고로 남는다.

## M21 기록의 신호 스펙트럼 · 로컬 검증 완료

2026-10-09(Asia/Seoul), 기존 계획에 정의가 없던 M21 이후 범위를 현행 코드의 분석 공백에 맞춰 [제품 확장 계획](product-extension-roadmap.json)에 정했다. 앱 `0.22.0`의 **분석 → 신호 스펙트럼 분석**은 완료한 시간 기록의 출력·성분·연속 표본 구간을 사용한다. radix-2 FFT의 단측 진폭·위상·periodogram PSD, 직사각/주기형 Hann 창·평균 제거, 표본 주파수·해상도·Nyquist·원시 통계와 JSON 보고서를 구현했다. M22~M25는 이산 제어계·불확실성 실험·시간 구간 통계/상관·Welch/시간-주파수의 입력·제외 범위·완료 조건을 정한 계획이다.

[M21 검증 기록](evidence/m21-verification.json)은 수치 코어68개·출처30개·UI30개의 **128개 새 검사**, 전체 단위 **4,303/4,303 PASS · 81개 파일**, 타입 검사와 실제 프로덕션 빌드를 기록한다. 독립 직접 DFT와 DC·Nyquist·위상·정확한 bin의 사인/코사인·직사각/Hann Parseval을 대조했다. 최대8192개·최대 진폭과1ns 경계를 확인했으며 비유한 값·불균일/낮은 정밀도의 격자·접근자·희소 배열·숨김/추가 필드를 거부한다. 선택 표본을 보간·0 채우기하거나 자료형을 조용히 변환하지 않는다.

실제 Chromium의 M21 **7/7 PASS**, 직전 M20 **9/9 PASS**와 초기 fit·자동 저장·키보드 편집 회귀 **4/4 PASS**를 확인했다. 실제 Worker의8Hz/진폭3/−45° 사인 기록과 PSD 적분4.5, 실제 저장 표본의 SHA-256·원본 모델/기록 불변, 잘못된 초안에서 보고서 보존, 비유한 성분의 새 계산 실패 시 이전 보고서 제거, 이전 실행 출처와 폼 편집 이후 JSON 스냅샷,512/1024개 선택 구간과128행 페이지를 검사했다. 320/390px의 다크·라이트, 스펙트럼의 모든 글자200% 확대에서 페이지/패널 가로 넘침과 미이스케이프 HTML이 없음을 확인했다. [데스크톱 다크 결과](evidence/m21-spectrum-desktop-dark-result.png), [데스크톱 라이트 설정](evidence/m21-spectrum-desktop-light-settings.png), [모바일 라이트](evidence/m21-spectrum-390-light-1x.png)와 [320px 글자 확대](evidence/m21-spectrum-320-dark-2x.png)를 보존한다.

초회 브라우저 검사1개는 체크섬의 예상 입력을 사인 해석식으로 다시 계산해 원시 기록과 IEEE 반올림 bytes가 달라 실패했다. 해석식과의 수치 비교는 유지하고, 체크섬은 실제 저장된 Worker 표본과 대조하도록 교정했다. 제품 계산을 예상값에 맞춰 변경하지 않았으며 최종16개 분석 브라우저 검사는 모두 통과했다.

[최종 릴리스 검증](evidence/m21-root-release-verification.json)은103개 검사·19개 정적 자산의 실제 bytes/SHA·오프라인 목록·보안 설정을 확인했다. [라이선스 기록](evidence/m21-licenses.json)은 기존28개 프로덕션 의존성을 보존하며 신규 npm 라이브러리·외부 계산 서비스·서버 API·개인정보 수집을 추가하지 않는다. 엔진·schema·registry337개·예제75개를 유지한다. 주파수 누설/aliasing 보정·bin 사이 피크 추정·Welch/STFT·불균일/부분 기록·정수/fixed/복소수의 FFT, Firefox/Safari와 공개 배포는 이번 완료 범위에 포함하지 않는다.

## M20 제어계 분석과 캔버스 공간 확대 · 로컬 검증 완료

2026-10-09(Asia/Seoul), 강제종료 전에 남아 있던 M20 구현을 복구해 앱 `0.21.0`의 검증과 문서를 마감했다. **분석 → 제어계 분석**은 현재 루트 State-Space 설정이나 실제 실행에서 완료가 확인된 Local Linearization의 A/B/C/D를 사용한다. 연속 실수 SISO·상태1~4개에 대해 Bode 크기·위상, 상태 극점·미약분 전달 영점을 제공하고, 사용자가 단위 음의 피드백의 개루프 가정을 선택한 경우에만 이득·위상 여유와 지정 이득의 근궤적 표본을 표시한다. 출처·행렬·설정을 실제 계산한 보고서에 보존하며 모델을 변경하지 않는다.

[M20 검증 기록](evidence/m20-verification.json)은 새 코어54개·출처15개·UI28개의 **97개 검사**, 전체 단위 **4,175/4,175 PASS · 78개 파일**, 타입 검사와 프로덕션 빌드를 기록한다. 주파수 표본은 최대801개, 근궤적 이득은81개, 분석 출처는64개, 계산 work는2,000,000 이하로 제한한다. 잘못된 행렬·접근자·희소 배열·비유한 값·상한 초과를 거부하고, 요청 전 영 행렬 placeholder와 확인된 실제 영 행렬, 이전 실행·부분 실행, 원시 기록과 완료 행렬의 불일치를 구분한다.

실제 Chromium에서 M20 **9/9 PASS**를 포함한 M17~M20·라이브러리·도움말 회귀 **43/43 PASS**, 기존 편집기 **44/44 PASS**를 확인했다. 마지막 화면 수정 후 초기 fit·autosave·키보드·반응형 캔버스의 추가 **5/5 PASS**도 확인했다. 원시 주파수 응답, 직접 전달항, 극점·영점, 명시적 피드백 가정, 특이 주파수의 빈 구간, 계산 실패 시 이전 결과 제거, 보고서 스냅샷과 모델 불변을 검사했다.

상단 높이·라이브러리·결과·속성 열을 약70%로 압축하고, 글자는 약3%만 줄이며 버튼과 여백을 더 줄였다. 1440×900px에서 실제 캔버스 폭은558→823px(**약48% 증가**), 작업 면적은**약78% 증가**했다. 1920×900px에서는 폭이907→1189px, 작업 면적이약50% 늘었다. [디자인 검증](evidence/m20-compact-design-verification.json)의20개 관측은 다크·라이트, 320~1920px, 글자200%, 배열·solver 설정·긴 이름의 가로 넘침과 노드/결과 정렬을 확인한다. [1440px 다크 화면](evidence/m20-compact-workbench-1440-dark.png)과 [1920px 라이트 화면](evidence/m20-compact-workbench-1920-light.png)을 보존한다.

초회 검사에서는 병행한 Playwright 실행의 결과 폴더 충돌, 기본5초보다 오래 걸린 실제 Worker 피팅, 기존14px 하한과 요청한 글자 축소의 차이를 확인했다. 결과 경로와 피팅 완료 대기를 교정하고, 작은 아이콘 안에서 잘리던 긴 심벌 두 개를 수정한 뒤 위 최종 검사를 통과했다. 전체 단위 초회에서 기존 코드 내보내기·시간 신호 사례5개가 동시 실행 부하로 검사 제한 시간을 넘겼다. 해당 사례는 격리 실행에서 통과했고, 동시 worker를2개로 줄인 최종 전체 실행은4,175개 모두 통과했다. 제품의 실행·자원 한도를 늘리지 않았다.

[최종 릴리스 검증](evidence/m20-root-release-verification.json)은99개 검사·18개 정적 자산의 실제 bytes/SHA·오프라인 목록·보안 설정을 확인했고, [라이선스 기록](evidence/m20-licenses.json)은28개 프로덕션 의존성을 보존한다. 엔진·schema·registry337개·예제75개를 유지하며 새 외부 계산 서비스나 의존성을 추가하지 않는다. MIMO·이산·descriptor 제어계, 자동 pole-zero 상쇄·PID 튜닝·Nyquist 분석, 유한 표본 밖이나 접선인 교차의 전수 검출, 반복·근접 근의 확정, Firefox/Safari와 공개 배포는 이번 완료 범위에 포함하지 않는다.

## M19 다변수 실험과 파라미터 추정 · 로컬 검증

앱 `0.20.0`의 실험 탭에 최대3개 계수·64개 조합의 다변수 실험과 CSV 측정값을 이용한 경계 최소제곱 피팅을 추가했다. 루트 Constant·Input의 실수 스칼라 값과 Gain 배율을 대상으로 하며, 피팅은 같은 단위의 legacy float64 스칼라 출력을 사용한다. 원시 관측 격자에 맞는 최대1,000개 측정값을 지원하고 보간하지 않는다. 최대96회 평가와 공유30초·100만 기록 원소·5천만 연산 한도를 적용한다.

[검증 기록](evidence/m19-verification.json)은 새 코어 **55개**, UI·CSV 검사 **27개**, 전체 단위 검사 **4,078/4,078 PASS · 75개 파일**, 타입 검사와 프로덕션 빌드를 기록한다. 독립적인 직선의 두 계수, 잡음 자료의 닫힌 형태 최소제곱 해, 연속 감쇠 모델의 진폭·감쇠 계수를 복원했다. 상한 밖 최적값의 경계 유지, 국소 감도 의존성, 단위·격자 불일치, 공유 자원 한도, 취소·실패 시 완료 후보만 순위화하는 동작과 원본 불변을 확인했다. 큰 시간 원점의 반 간격은 거부하고 소수 시각의 IEEE 반올림 차이는 허용한다.

실제 Chromium에서 새 기능 **7/7 PASS**와 기존 데이터·단일 실험·대시보드·Scope 회귀 **44/44 PASS**를 확인했다. 실제 Worker의 계수 복원·조합별 결과, 설정을 포함한 보고서, 탭 전환 후 유지, 명시적 적용·undo, 다른 모델을 가져온 뒤 적용 차단, 취소·초기화 후 늦은 결과 방지, 잘못된 CSV와 크기 상한을 검사했다. 320/390/1440px, 다크·라이트, 글자200%에서 페이지·패널의 가로 넘침이 없음을 확인했다. 원시 잔차 표와 큰 숫자는 표 내부에서 스크롤한다.

[최종 빌드 릴리스 검증](evidence/m19-root-release-verification.json)은95개 검사·17개 정적 자산을 확인했고 [라이선스 기록](evidence/m19-licenses.json)은28개 의존성을 보존한다. 엔진 `0.17.0-m16`, schema·registry337개·예제75개와 계산 Worker의 bytes/SHA는 M18과 같다. 측정 CSV는 로컬에서 최대256KiB까지 읽고, 일반 데이터 속성만 허용하며 React escaping과 CSV 셀 이스케이프를 유지한다. 모델은 탐색만으로 바뀌지 않고, 현재 계산 의미가 실험 당시와 같을 때 선택 후보의 계수만 적용한다.

처음 브라우저 검사에서는 모델 가져오기 후 도식 탭으로 이동하는 실제 흐름에 맞춰 검사 위치를 교정했고, 숨겨진 파일 선택기에 넓이 규칙이 적용되던 화면 넘침을 수정했다. 수치 경계 검사 자료의 종료 시각도 기존 컴파일러의 정확한 시간 격자 조건에 맞춰 교정한 뒤 전체 검사를 통과했다. 자체 구현한 유한 차분·감쇠 Gauss–Newton 국소 탐색은 전역 최적값·계수의 유일성을 보장하지 않는다. Typed·벡터·행렬·하위 도식 내부 계수의 추정, 임의 파라미터 확장, Firefox/Safari, 공개 배포와 전체 원본 옵션 동등성은 이번 검증 범위에 포함하지 않는다.

## M18 Scope와 결과 관측 · 로컬 검증

앱 `0.19.0`에서 결과 그래프에 원시 샘플 커서·키보드 이동·시간 구간 확대·성분 선택을 추가했다. 실험에서는 실행 기록 최대3개를 공통 축에 중첩하고, 서로 다른 시간 격자도 각 실행의 실제 기록 시각과 값을 읽는다. 유한 실수 scalar·벡터·행렬과 Typed 수치 scalar·벡터를 지원한다. Typed 정수·고정소수점은 곡선 근삿값과 원본 저장 값을 구분한다. 보기 조작은 실행 시간·모델·원시 기록을 변경하지 않는다.

[검증 기록](evidence/m18-verification.json)은 새 관측 코어 **40개 검사**, 전체 단위 검사 **3,996/3,996 PASS · 73개 파일**, 타입 검사와 프로덕션 빌드를 기록한다. 실제 Chromium의 새 Scope **9/9 PASS**와 기존 시간 범위·실험·대시보드·학습·캔버스·반응형 회귀 **93/93 PASS**를 확인했다. 시간 격자별 커서의 원시 값 일치, 보간 없는 동률 선택, 구간 확대 후 기록 불변, Typed uint64 원본 값, 단위 불일치 거부, 실행 삭제 후 비교 슬롯, 테마·모델 제목 변경 시 관측 상태 유지, 320/390/1440px와 글자200%를 검사했다. NaN·무한대는 곡선을 끊으며 유한한 단독 점과 원시 값은 보존한다.

[루트 경로 릴리스 검증](evidence/m18-root-release-verification.json)은 실제 최종 빌드의95개 검사·17개 정적 자산을 확인했다. 라이선스 결과는 [M18 기록](evidence/m18-licenses.json)에 별도로 보존했다. 엔진 `0.17.0-m16`, schema·registry337개·예제75개를 유지했고 계산 Worker의 bytes/SHA도 M17과 같다. 관측 입력은 실행3개·각10,001샘플·신호1,024원소·합산 검사1,000,000원소로 제한하며, 접근자 실행과 임의 HTML 렌더링을 허용하지 않는다.

처음 실행의 검사2개는 새 NaN 구간 표시와 구조화 출력 안내에 맞게 교정했다. 브라우저에서는 실제 버튼 이름·숨겨진 탭의 DOM에 맞춰 검사 범위를 조정했고, 좁은 패널의 range 입력 여백과 기록형 Scope의 상태 유지 문제를 수정한 뒤 위 최종 검사를 통과했다. Typed 행렬·복소수·boolean·문자열·버스·메시지를 수치 곡선으로 자동 변환하지 않는다. Firefox/Safari, 전체 원본 옵션 동등성과 공개 배포는 이번 검증 범위에 포함하지 않는다.

## M17 도식 수식과 학습 · 로컬 검증

앱 `0.18.0`에 수식·학습 탭과 기존 예제를 활용한 학습 가이드3개를 추가했다. 계산 엔진·schema·registry337개와 예제75개는 유지한다. [검증 기록](evidence/m17-verification.json)은 수식27개·학습20개의 새 회귀, 전체 단위 검사 **3,956/3,956 PASS · 72개 파일**, 타입 검사와 실제 프로덕션 빌드를 기록한다.

실제 Chromium에서 새 기능 **7/7 PASS**와 기존 기능 **9/9 PASS**를 확인했다. 수식 항→단일 블록 선택·값 변경, 세 실제 Worker 실행, 예상/설명의 값 편집·결과 탭 왕복 유지, invalid draft·배열·잘못된 연결의 처리, 내부 스크롤·테마·키보드·텍스트 확대를 검사했다. 기존 검색·범주·예제·모달 focus·지연 초기 fit·autosave·Space·좌우 배치도 확인했다. 첫 실행의 테스트 가정2개는 숫자 오류의 blur/commit 시점과 실제 테마 버튼 이름에 맞춰 교정했으며 최종 실패는0개다.

[루트 경로 릴리스 검증](evidence/m17-root-release-verification.json)은 실제 빌드의95개 검사·17개 정적 자산의 해시·범위·오프라인 목록·OG metadata를 확인했다. 현행 문서10개와 폐기 문서44개의 재도입 방지도 검사했다. M17의 라이선스·릴리스 보고서는 [별도 경로](evidence/m17-licenses.json)에 두어 과거 M16 기록을 덮어쓰지 않는다. 이 단계에서는 공개 게시를 수행하지 않았다. 실제 초보자 학습성 관찰, Firefox/Safari, 전체 symbolic 식과 Simulink 전수 동등성은 미검증이다.

## 화면 캡처 보관

`evidence/`의 PNG는 화면 검증 도구가 저장한 산출물이며 앱 실행·계산·배포의 입력으로 사용하지 않는다. 2026-10-04에 과거 단계와 이전 버전의 반복 캡처 2,205개를 정리하고, 앱 `0.17.3`의 최종 화면 검증 18개와 공개 화면 1개를 유지했다. 이후에도 현행 버전의 최종 검증 화면을 보관하고 대체된 캡처는 정리한다.

수치 검증·승인·실패 기록과 과거 JSON의 해시 목록은 원문 그대로 유지한다. 그 안의 이미지 경로와 해시는 기록 당시의 캡처를 가리키며, 정리된 이미지가 현재 작업 폴더에 없을 수 있다. Git에 추적된 과거 캡처는 정리 전 commit `ed060448e154636b0d2202dfbcc96ffff8ec0c85`에서 복구할 수 있다. 최신 화면은 [최종 화면 기록](evidence/library-navigation-ui-verification.json)과 [공개 검증](evidence/library-navigation-public-browser-verification.json)에 연결되어 있다.

## 지원 감사

원자료 385행·339개 이름을 원본 ID·행 번호·조건·identity SHA로 대조했다. registry 정의 337개, 모델 widget 계약 5개, 미지원 목적 계약 10개는 별도로 관리한다. 같은 미지원 목적의 여러 접근점을 합치지 않아 미지원 원자료 행은 18개다.

[대응표](support-matrix.md)와 [기계 판독 JSON](support-matrix.json)은 385행의 결정·설정·자료형·실행 방식·타깃·외부 조건·담당자·검증 버전을 기록한다. 선택 범위의 기존 대응은 367행이며 원본 전수 옵션·MathWorks 수치 동등성 완료는 0행이다. 모든 385행의 공식 전수 옵션 inventory는 미검증이다. 251행은 실제 fixture에 연결된 276개 설정 profile을 갖고, 나머지 선택 116행은 원본 항목별 옵션 profile이 아직 직접 연결되지 않았음을 표시한다. 등록 파라미터의 모든 enum 값·조합을 실행 승인으로 계산하지 않는다.

[M16 감사 기록](evidence/m16-verification.json)은 25개 보호 자료·337개 이전 정의·385개 identity·352개 계약·실제 profile selector를 검증한다. 컴파일러 정규화가 있는 48개 profile은 동결 raw fixture SHA와 실제 실행 모델 semantic SHA를 추가 대조했다. Add·Subtract·Pi·Zero의 네 고정 설정은 [독립 기대값·실제 TypeScript 재검증](evidence/m16-preset-verification.json)을 별도로 연결했다. 추적 완료를 전체 실행 동등성으로 표시하지 않는다.

## M16 실제 실행과 화면

| 검사 | 확인 범위와 근거 |
| --- | --- |
| 단위 검사 | 최종 전체 3,883/3,883 PASS. [최종 원본](evidence/m16-unit-results.json). 추가 감사 검사 전 3,882개 결과는 [초기 원본](evidence/m16-initial-unit-results.json)에 따로 보존한다. |
| 지원 화면 | 최종 8/8 PASS. 검색·분류·타깃·동명 Display·preset·미지원·JSON·모델 불변·모달 단축키·키보드 목록 탐색과 8개 화면/테마/글자 확대 조건을 확인했다. [화면 기록](evidence/m16-support-ui-verification.json)·[실제 브라우저 결과](evidence/m16-support-browser-results.json). 최종 공개 대응표도 아래 공개 검사에서 재확인했다. |
| 생성 Python | 현재 엔진에서 실제 프로그램 142개·정상 256표본. [현재 실행](evidence/m15-python-regression-on-m16.json). Python 69개 정의의 선택 구성만 승인한다. |
| 생성 WASM | 현재 엔진에서 실제 module/runner 128개. [현재 실행](evidence/m15-wasm-regression-on-m16.json). WASM 16개 정의의 유한 실수 scalar DAG 선택 구성만 승인한다. |
| 상호운용·패키지 | [실제 통합 실행](evidence/m15-regression-on-m16.json): MAT/SLX/MDL 3개 선택 분석 경로, 원본 bytes/재분석, native JSON, 서명 검증·명시 검토가 필요한 8개 과거 엔진 프로필. |
| TypeScript 회귀 | 기존 M7/catalog/M8~M15 검증기를 현재 엔진에서 실제 실행했다. [문자열·데이터](evidence/m13-regression-on-m16.json), [어댑터·상태](evidence/m14-regression-on-m16.json), 다른 단계의 현재 실행 증거도 `evidence/`에 보존한다. |
| 원자료·승인 | coverage·원 planning JSON·M10~M14 승인 재검증 PASS. 원 dataset·planning JSON·보호 baseline/원 승인 증거 25개의 SHA를 보존한다. |
| 성능 | 로컬 전용 preview에서 6개 예산 PASS. cold load p95 1,211ms·warm load p95 1,005ms·1,000노드 compile/run p95 118ms·취소 p95 503ms·반복 실행 후 heap 증가 예산 PASS·page error 0. [원본 측정](evidence/m16-performance.json). 공개 네트워크 속도나 실제 초보자 관찰 결과로 해석하지 않는다. |
| 빌드·release | root와 `/CalcWeave/` 경로 각각 91검사 PASS, asset 각각 16개. root 6,760,243bytes, project 6,760,513bytes. [실제 root artifact](evidence/m16-root-release-verification.json)·[실제 project artifact](evidence/m16-project-release-verification.json). |
| 프로젝트 경로 브라우저 | 최종 4/4 PASS, skipped/flaky/error 0. 경로·오프라인 scope·Worker·Python ZIP 로딩을 확인했다. [실제 결과](evidence/m16-project-browser-results.json). 처음 npm 실행이 브라우저 시작 전에 정체된 기록은 [별도 실행 기록](evidence/m16-project-browser-stalled-execution.json)으로 보존했고, 자체 프로세스를 정리한 뒤 직접 Playwright로 재실행했다. 계산 assertion 실패나 통과로 계산하지 않는다. |
| 의존성 | 고정 lockfile. 확인 시 npm audit의 알려진 취약점 0개. 입력·자원 상한·React escaping·허용 목록·임의 코드 실행 차단을 유지한다. |

지원 창에서 뒤쪽 공통 CSS가 의도한 폭을 덮던 문제를 교정했다. 최종 실제 폭은 1440px 화면에서 1040px, 1024px에서 992px, 작은 화면에서 viewport−16px이며 브라우저 assertion과 화면으로 확인했다. 교정 전 8개 기능 검사 결과는 이전 폭의 검사로 구분한다.

[로컬 종합 검증](evidence/m16-engineering-checks.json)은 위 결과와 보호 자료 SHA를 연결한다. 전체 브라우저 197개는 최종 공개 CI에서 모두 통과했다. 로컬 집중 8개와 프로젝트 경로 4개 결과는 별도 기록이며, 로컬 단일 197개 실행을 주장하지 않는다.

## 재현 명령

Node.js 24와 Python 3.14를 사용하는 CI가 최종 배포 검증 환경이다. 로컬은 Node.js 25.9.0·Python 3.14·Windows Chromium에서 검사했다. Firefox·Safari·실제 초보자 관찰은 이 자동 검사의 범위가 아니다.

```sh
npm ci
npm run typecheck
npm test
npm run verify:coverage
npm run verify:roadmap
npm run verify:docs
npm run verify:m7
npm run verify:catalog
npm run verify:m8
npm run verify:m9
npm run verify:m10
npm run verify:m11
npm run verify:m12
npm run verify:m13
npm run verify:m14
npm run verify:m15
npm run verify:m16
npm run build
npm run verify:release
npm run test:e2e
```

`verify:m16`는 선행 실제 M14/M15 타깃 보고서를 확인한다. 공개 매트릭스는 불변 원 승인/실행 근거를 참조하고, 매번 생성 시각이 달라지는 fresh 보고서의 SHA는 별도 검증 기록에 담는다. 따라서 CI 재실행만으로 공개 데이터가 바뀌지 않는다. 실제 지원 변경은 `scripts/generate-support-matrix.ts --write`로 명시 재생성한 뒤 검토한다.

## 공개 배포와 문서 정리

M16 앱 `0.17.0` / 엔진 `0.17.0-m16`의 공개 배포 검사를 완료했다. [운영 안내](operations.md)의 기본 브랜치 수동 workflow와 정확한 artifact 검증을 따른다. 공개 주소는 [CalcWeave](https://jtech-co.github.io/CalcWeave/)다. 기술적 앱 배포와 목표 도메인·정식 출시·실제 novice 관찰·원본 옵션 동등성은 별도 판정한다.

M16 구현 검사 후 중복된 M0~M15 계약·진행 기록과 이전 계획·배포 MD 44개를 현행 기술·디자인·운영·검증·지원 문서로 통합했다. M16부터 현행 검증 문서를 사용한다. 원본 dataset, 실제 정책, 보호 baseline MD/JSON, 기계 판독 계획과 실패/수치/배포 증거 JSON은 보존했다. 삭제 파일의 정확한 이전 SHA와 보존 상태는 [정리 기록](evidence/document-consolidation-manifest.json)에 기록했다. 과거 문서가 필요한 경우 [정리 전 Git 기록](https://github.com/JTech-CO/CalcWeave/tree/9f314bbb2c41d4e6b087c90b9da435e61a850996/docs)을 확인한다.

원본의 C/C++·MATLAB·S-function 실행 환경, 원본 전수 옵션 inventory와 수치 대조, 편집한 native 모델 export는 미승인/미검증으로 유지한다. 계정·원격 DB·결제·개인정보 수집을 추가할 때는 현재 로컬 베타의 해당없음 항목을 그대로 재사용하지 않는다.

## M16 공개 결과

[Actions 37128098577](https://github.com/JTech-CO/CalcWeave/actions/runs/37128098577)는 main `736603c7988699e2001cb102d7f1ca64fa1c4a55`에서 단위 3,883/3,883·전체 브라우저 197/197·프로젝트 경로 4/4, 모든 단계 회귀와 release 91검사를 통과한 뒤 게시했다. 공개 asset 16개 및 service worker를 로컬에서 검증한 프로젝트 경로 artifact와 byte/SHA로 대조했다. release ID는 `43f40da7eb7e5cb4bb6c6e890e550868621fb3d7019bf42eb4c6046f1a93bbef`다.

공개 기본 9검사는 초기 fit·Worker·오프라인 편집·정책·Python ZIP을 확인했다. 추가 21케이스는 M16 대응표 8케이스와 다운로드한 Python의 실제 격리 실행, WASM binary/runner의 실제 브라우저 계산, 서명된 migration 검토·undo, MAT/SLX/MDL 선택 분석 경로·원본 보존·변조/코드 거부·반응형 조건을 확인했다. 대응표 SHA는 `e5d706d7fc127081fc8470189b3f580d03ed61ba938a8168a5aa8e3730bb875e`다. 로컬 지원 UI 결과는 문서 헤더 갱신 전 데이터였으며, 이 공개 검사는 최종 데이터에 대한 결과다.

[공개 결과](evidence/m16-public-release.json)·[CI 원본 요약](evidence/m16-actions-verification.json)·[정확한 파일 검사](evidence/m16-deployment-verification.json)·[공개 기본 브라우저](evidence/m16-public-browser-verification.json)·[공개 추가 브라우저](evidence/m16-public-feature-browser-results.json)·[로컬 종합 검증](evidence/m16-engineering-checks.json). 공개 앱의 빌드 커밋은 위 main SHA이며 이후 증거 문서 병합은 동일 artifact를 다시 게시하지 않는다. 기술적 앱 배포는 PASS이고 calcweave.com 소유/DNS·실제 초보자 관찰·정식 출시·원본 전수 옵션/MathWorks reference 동등성은 별도 판정이다.

## 보조 기능 정리

앱 `0.17.1`은 계산과 관계가 먼 기능의 노출을 조사한 뒤 정리한 화면 변경이다. 공개 키 지문은 별도 채널로 받은 키와 서명 파일을 대조하려고 의도적으로 넣은 기능이지만 일반 모델 전달이나 계산 정확성 확인에 필요하지 않다. 서명 형식과 출처·migration 검증은 보존하고 **작업 공간 → 고급 파일**로 옮겼다. 브라우저에만 저장하는 앱의 백업·복구는 필요하므로 기본 경로로 남겼다. 할당량·영구 저장 여부·복구 원본·진단 기록은 접힌 **저장 문제 해결**, SHA는 접힌 **백업 검증 정보**, 삭제는 별도 접힌 영역과 두 단계 확인으로 정리했다. 분석·데이터·실험·코드 내보내기와 지원 범위 조회는 계산 작업과 직접 연결되어 유지했다.

| 검사 | 실제 결과 |
| --- | --- |
| 단위 | [3,883/3,883 PASS](evidence/workspace-simplification-unit-results.json). |
| 파일·복구·UI 집중 회귀 | [34/34 PASS](evidence/workspace-simplification-browser-results.json). 지문 불일치·변조·migration 검토·원본 보존·원자적 복구·탭 충돌·Python/WASM 실제 실행·기본 접힘·고급 진입·초점 복귀를 확인했다. |
| 화면 실측 | [10조건 PASS](evidence/workspace-simplification-ui-verification.json): 1440/1024/390/320px의 다크·라이트 및 1440px 글자200%. 헤더 줄바꿈 시 메뉴가 왼쪽 밖으로 나가던 문제를 viewport 위치 계산으로 교정했다. |
| 경로·배포 후보 | [root](evidence/workspace-simplification-root-release-verification.json)·[project](evidence/workspace-simplification-project-release-verification.json) 각각91검사·16assets PASS. [프로젝트 경로 브라우저4/4 PASS](evidence/workspace-simplification-project-browser-results.json). 공개 배포 검사는 이 로컬 결과와 분리한다. |
| 의존성 | [npm audit](evidence/workspace-simplification-dependency-audit.json) 알려진 취약점0개. |

첫 집중 회귀의 탭 충돌 사례는30초 제한으로 시간 초과였다. [초기33/34](evidence/workspace-simplification-initial-browser-results.json), [독립 재실행1/1](evidence/workspace-simplification-cross-tab-browser-results.json), 최종34/34를 구분해 보존했다. 최종 UI의 page error와 앱 console error는0이다. 첫 브라우저의 자동 favicon.ico 요청404는 기존 정적 리소스 누락으로 별도 기록했다. 사용자 브라우저의 저장 데이터를 삭제하거나 읽지 않았다. 엔진·블럭337개·지원표와 보호 원자료/승인25개는 변경하지 않았으며 M16 문서 정리 기록도 당시 증거로 보존했다.

## 보조 기능 정리 공개 결과

[Actions 37132824930](https://github.com/JTech-CO/CalcWeave/actions/runs/37132824930)는 main `6882c2ae95dfda950652f642e4570670c460e172`에서 단위3,883/3,883·전체 브라우저199/199·프로젝트 경로4/4와 기존 모든 단계 회귀·release91검사를 통과한 뒤 앱0.17.1/엔진0.17.0-m16을 게시했다. 공개16assets와 service worker를 로컬의 프로젝트 artifact와 byte/SHA로 대조했다. release ID는 `eed8ecaa15afd751ae142d9d8f58c935cae13397b944f8ad8cd8db02b4890951`다.

[공개 기본9검사](evidence/workspace-simplification-public-browser-verification.json)와 [실제 공개 기능34케이스](evidence/workspace-simplification-public-feature-browser-results.json)가 통과했다. 새 기본 접힘·고급 파일 진입·초점 복귀뿐 아니라 지문 불일치·변조 거부·migration 검토·원본 보존·백업/복구/삭제·탭 충돌·다운로드 Python/WASM의 실제 실행을 독립 브라우저에서 확인했다. 사용자 브라우저의 저장소는 접근하지 않았다.

[조사·변경·로컬 검증](evidence/workspace-simplification-engineering-checks.json)·[CI 원본 요약](evidence/workspace-simplification-actions-verification.json)·[정확한 공개 파일](evidence/workspace-simplification-deployment-verification.json)·[공개 결과](evidence/workspace-simplification-public-release.json). M16의 모든 과거 수치/승인/문서 정리 증거는 별도로 보존하며 정식 출시·실제 novice 관찰·목표 도메인·원본 전체 동등성의 미검증 상태도 유지한다.

## 제품 도움말 정리

앱 `0.17.2`는 CalcWeave 자체의 계산 흐름을 설명하는 도움말 변경이다. 기본 메뉴를 사용 안내·블록 찾기·파일·코드·앱 정보로 정리하고, 첫 화면에 작은 계산의 작성·연결·실행을 안내한다. Simulink 비교와 확장 상세는 앱 정보의 접힌 호환성 참고로 옮겼다. MATLAB 설치가 필요 없는 독립 웹 계산 도구임을 명시하며, 전체 옵션 동등성이나 미지원 기능의 경계를 변경하지 않았다. ID·엔진 버전·원시 파라미터와 세부 상한은 필요할 때 여는 기술 정보에 보존했다.

| 검사 | 실제 결과 |
| --- | --- |
| 도움말 집중 회귀 | [35/35 PASS](evidence/product-help-browser-results.json). 기존 블록 검색·원자료 385행·어댑터 계약과 새 기본 안내·4개 메뉴·키보드 초점·스크롤 복귀를 확인했다. |
| 화면 실측 | [10조건·18캡처 PASS](evidence/product-help-ui-verification.json): 1440/1024/390/320px의 다크·라이트 및 1440px 글자200%. 캡처를 모두 직접 검토하고 탭 전환 시 제목이 가려지던 문제를 수정했다. |
| 경로·배포 후보 | [root](evidence/product-help-root-release-verification.json)·[project](evidence/product-help-project-release-verification.json) 각각91검사·16assets PASS. [프로젝트 경로 브라우저4/4 PASS](evidence/product-help-project-browser-results.json). |
| 단위 재검사 | [초기 전체](evidence/product-help-initial-unit-results.json)는3,873/3,883 PASS와10개 시간 초과 의심 실패였다. 실패6파일을 단일 워커로 재실행한 [492/492 PASS](evidence/product-help-unit-retry-results.json)에는 최초 실패10개가 모두 포함되었다. 테스트·구현·시간 제한을 변경하지 않았으며 이 합산을 단일 전체 PASS로 표현하지 않는다. 전체 CI 결과는 별도로 기록한다. |
| 의존성 | [npm audit](evidence/product-help-dependency-audit.json) 알려진 취약점0개. |

[변경·보안 기준·보존 검사](evidence/product-help-engineering-checks.json)에 검색 길이·허용 목록·React 출력 이스케이프와 개인정보 흐름 변경 없음, 엔진·지원표·과거 증거 보존 상태를 기록했다. 첫 UI 실행은 중간 빌드 교체를 감지한 [7조건 부분 결과](evidence/product-help-initial-ui-verification.json), 다음 실행은 DOM10조건 통과 후 제목 가림을 발견한 [시각 실패 결과](evidence/product-help-initial2-ui-verification.json)로 보존한다. 최종 검사의 앱 콘솔 오류와 페이지 오류는0이며 자동 favicon.ico 요청404는 별도로 기록했다. 사용자 브라우저의 저장 데이터는 접근하지 않았다.

## 제품 도움말 공개 결과

[Actions 37140475203](https://github.com/JTech-CO/CalcWeave/actions/runs/37140475203)는 main `9d4e3c375f1b4361990d4a80c68cc14da56967b1`에서 단위3,883/3,883·전체 브라우저204/204·프로젝트 경로4/4와 기존 모든 단계 회귀·release91검사를 통과한 뒤 앱0.17.2/엔진0.17.0-m16을 게시했다. 공개16assets와 service worker는 로컬 프로젝트 artifact와 byte/SHA가 일치했다. release ID는 `8f43d3362987d007748878b63b0505063eb54e199888d961aeb89ecfb7f052d9`다.

[공개 기본9검사](evidence/product-help-public-browser-verification.json)와 [실제 공개 기능35케이스](evidence/product-help-public-feature-browser-results.json)가 통과했다. 제품 중심 첫 안내·블록 검색·4개 메뉴·닫힌 기술/호환성 정보·기존 대응표와 어댑터 상세·탭 전환 스크롤·키보드 초점과 기존 백업·복구 경로를 독립 브라우저에서 확인했다. 사용자 브라우저의 저장 데이터는 접근하지 않았다.

[변경·로컬 검증](evidence/product-help-engineering-checks.json)·[CI 원본 요약](evidence/product-help-actions-verification.json)·[정확한 공개 파일](evidence/product-help-deployment-verification.json)·[공개 결과](evidence/product-help-public-release.json). 과거 실패와 M16 승인·문서 정리 증거는 보존한다. 기술적 앱 배포 PASS와 정식 출시·실제 초보자 관찰·목표 도메인·원본 전체 동등성의 미검증 상태는 구분한다.

## 라이브러리 탐색 개선

앱 `0.17.3`은 누락된 42개 기호를 보완해 337개 블록에 명시적인 기호를 제공한다. 기존 295개 기호는 유지하고 미등록·프로토타입 ID는 안전한 기본 기호를 쓴다. 제목·전체 수·검색을 고정하고 목록만 세로 스크롤한다. 기본으로 자주 쓰는 블록10개만 펼치며 실제29개 카테고리는 접는다. 카테고리 버튼은 마우스·Enter·Space로 동작한다. 검색 결과의 범주는 자동으로 열고 검색을 지우면 이전 펼침을 복원한다.

| 검사 | 실제 결과 |
| --- | --- |
| 기호 단위 | [2/2 PASS](evidence/library-navigation-symbol-unit-results.json). 전체337개 명시 기호·누락 사례·프로토타입 fallback을 검증했다. 전체 단위 CI와 구분한다. |
| 기존 영향 회귀 | [53/53 PASS](evidence/library-navigation-browser-results.json). 기존 계산·편집·블록 검색 회귀를 확인했다. |
| 새 라이브러리 회귀 | [6/6 PASS](evidence/library-navigation-new-browser-results.json). 기본 접힘·키보드·검색 복원·전체337개·기호 경계·상단 고정·빠른 추가를 확인했다. |
| 화면 실측 | [10조건·18캡처 PASS](evidence/library-navigation-ui-verification.json). 1440/1024/390/320px의 다크·라이트와 1440px 글자200%에서 전체기호와 상단 고정을 확인했다. 900px 가로 태블릿 배치도 추가 측정했다. |
| 배포 후보 | [root](evidence/library-navigation-root-release-verification.json)·[project](evidence/library-navigation-project-release-verification.json) 각각91검사·16assets, [프로젝트 경로4/4 PASS](evidence/library-navigation-project-browser-results.json). |
| 의존성 | [npm audit](evidence/library-navigation-dependency-audit.json) 알려진 취약점0개. |

[초기4/6 결과](evidence/library-navigation-initial-new-browser-results.json)는 기호 하나의 폭 넘침과 동시 테스트 출력 경로 충돌을 기록한다. 기호 크기를 조정하고 출력 경로를 분리했다. 내적·픽셀 처리에 의도된 점 기호를 누락으로 판정하던 검사도 교정했다. [변경·보안·보존 검사](evidence/library-navigation-engineering-checks.json)에 검색100자 제한·React 이스케이프·사용자 브라우저 데이터 미접근·엔진/지원표/과거 증거 보존을 기록했다. 공개 결과는 별도로 기록한다.

[초기 화면 프로브](evidence/library-navigation-initial-ui-verification.json)는 좁은 화면에서 의도적으로 숨긴 저장 표시의 가시성을 기다려6조건이 시간 초과했고, service worker 차단 정책이 안내 배너를 유발했다. 준비 조건을 저장 완료 텍스트로 바꾸고 별도 프로필의 service worker를 허용해 최종10조건을 다시 측정했다. 이 프로브 설정 문제를 제품 결함으로 판정하지 않는다.

## 라이브러리 탐색 공개 결과

[Actions 37165531788](https://github.com/JTech-CO/CalcWeave/actions/runs/37165531788)는 main `f1df5c724da1ccf67b861ad535f89cdb4957a976`에서 단위3,885/3,885·전체 브라우저210/210·프로젝트 경로4/4와 기존 모든 단계 회귀·release91검사를 통과한 뒤 앱0.17.3/엔진0.17.0-m16을 게시했다. 공개16assets와 service worker는 로컬 프로젝트 artifact와 byte/SHA가 일치했다. release ID는 `21d9c36d4d2f80dad06d52baa7d5f4ad70b0334ea59941fde5dab2a2f5167f73`다.

[공개 기본9검사](evidence/library-navigation-public-browser-verification.json)와 [실제 공개 라이브러리6케이스](evidence/library-navigation-public-feature-browser-results.json)가 통과했다. 처음 추천만 펼침·카테고리 키보드·검색 복원·337개 기호·상단 고정·추가·다크/라이트·화면 크기와 글자200%를 독립 브라우저에서 확인했다. 사용자 브라우저의 저장 데이터는 접근하지 않았다.

[변경·로컬 검증](evidence/library-navigation-engineering-checks.json)·[CI 원본 요약](evidence/library-navigation-actions-verification.json)·[정확한 공개 파일](evidence/library-navigation-deployment-verification.json)·[공개 결과](evidence/library-navigation-public-release.json). 기존 원자료·승인·과거 검증과 M16 문서 정리 결과를 보존했다.

[초기 공개 기본 검사](evidence/library-navigation-initial-public-browser-verification.json)는 이전의 모든337개 초기 펼침 조건을 기다리다가60초 제한에 도달했다. 공개 검사 스크립트를 전체 수337·추천 범주 펼침·초기10개 표시로 교정하고 타입 검사를 통과했다. 이후9개 기본 검사를 모두 통과했으며 실제 앱의 배포 파일은 변경하지 않았다.

## 학술·수학 소개와 공유 미리보기

README를 수학 도구의 목적·활용·모델 예제·기술 구조 중심으로 구성하고, Simulink의 블록선도 모델링과 SANE의 정보 우선 설계에서 받은 영향을 명시했다. 배지의337개 블록·75개 예제는 실제 정의와 예제 목록을 기준으로 한다. Python·WASM 지원 범위와 원본 전체 동등성의 미검증 상태를 함께 안내한다.

사이트와 저장소의 소개 이미지는 초기값 문제 `x′ = −x`, `x(0) = 1`을 Gain(−1)·Integrator·Scope와 피드백 연결로 표현한다. 이는 소개용 도식이며 그래프 픽셀을 수치 검증 자료로 사용하지 않는다. 사이트 PNG는1730×909·997,348bytes, 저장소 PNG는1774×887·971,681bytes이다. 원본 생성 이미지의 픽셀을 유지한 무손실 PNG 압축을 적용했다.

| 검사 | 결과 |
| --- | --- |
| 관련 단위 검사 | social metadata·오프라인 파일·검증 출력 경로63/63 PASS |
| TypeScript | `tsc --noEmit` PASS |
| 문서 링크 | 현재10문서·로컬690링크·4앵커 PASS·퇴역44문서 재생성 없음 |
| 배포 후보 | [root](evidence/og-readme-root-release-verification.json)·[project](evidence/og-readme-project-release-verification.json) 각각95검사·17자산 PASS |
| OG 메타와 이미지 | canonical·OG·Twitter 메타의 실제 HTTPS 주소와 PNG 크기 일치. 원본·양쪽 빌드·manifest의 사이트 이미지 SHA-256 일치 |

사이트 이미지 [원본 파일](../apps/web/public/assets/social/calcweave-og.png)과 [저장소 이미지](../assets/branding/calcweave-github-og.png)는 실제 소개에 사용되는 자산이며 과거 QA 캡처와 구분하여 보관한다. 기존 preview 산출물·정책 HTML·M16 라이선스·과거 JSON331개는 바이트를 보존했다. 공개 반영 결과는 아래 검증으로 확인했다.

### 공개 OG 반영 결과

2026-10-04, [Pages CI37177565334](https://github.com/JTech-CO/CalcWeave/actions/runs/37177565334)에서 단위3909개·브라우저210개·프로젝트 경로4개가 통과했고 verify·deploy가 모두 성공했다. 배포 소스는 `fe2931091da17de64be0991a314eb857c4ad0169`이다. [공개 파일 검증](evidence/og-readme-public-release.json)에서 OG·Twitter·canonical 메타, PNG 형식·크기·SHA-256, manifest17자산과 서비스 워커가 격리 project 빌드와 모두 일치했다. 사용자 브라우저 저장 데이터는 접근하지 않았다.

저장소용 이미지는 README에 적용되어 표시된다. GitHub Settings의 별도 Social preview 등록은 브라우저 확장의 로컬 파일 접근 권한이 꺼져 있어 미완료이며, 이미지 제작·사이트 OG 적용·README 반영과 구분해 기록한다.
