# M6 보안·개인정보 검증 요약

2026-10-03 · 앱0.6.0·엔진0.6.0-m6 · 범위: 로컬 우선 정적 웹 앱, production artifact와 GitHub Pages 배포 구성

## 실제 검사 결과

공식 npm audit 조회에서 설치 잠금 의존성132개(프로덕션29·개발104, 집계 중복 포함)의 알려진 취약점은 0건이었다. 이 결과는 해당 시각의 advisory 조회이며 모든 취약점 부재를 보장하지 않는다. 배포 앱에 연결되는 프로덕션 패키지28개의 설치본 라이선스 원문을 고지 페이지에 포함했다. 자체 코드의 배포 라이선스를 임의로 부여하지 않았다.

vibe-security-first 패턴 검사를 apps35·packages36·scripts22개 파일에 수행해 각 CRITICAL/HIGH/MEDIUM/LOW 0건을 확인했다. 프로젝트 전체 검사에서는 Playwright trace가 복사한 React 배포 runtime의 `dangerouslySetInnerHTML` 지원 분기·DOM 내부 구현을 5 CRITICAL·5 HIGH로 보고했다. 실제 앱은 이 prop과 DOM HTML 쓰기를 사용하지 않으며 모델/노트는 React text children으로 처리한다. 이 10건은 사용자 입력에서 호출되는 취약 경로로 확인되지 않은 생성 artifact의 중복 패턴으로 분류하고 원시 결과를 로컬 비공개 점검 기록에 보관했다. 검사 범위를 줄였다는 이유로 전체 원시 결과를 0건으로 바꾸지 않았다.

최종 배포 HTML·Worker·lazy export·정책4페이지의 바이트 길이/SHA-256, 외부-only script/CSP 순서와 인식 가능한 비밀키 패턴, source map/환경 파일 미배포, Actions 커밋 allowlist와 custom domain 경로 검증을 `verify:release`에서 확인한다. 브라우저의 실제 데이터·백업 훼손·quota 실패·탭 충돌·오프라인 실패 시험은 검증 기록에 별도로 연결한다.

## 보안 8개 항목의 적용 범위

| 항목 | 적용/검증 |
| --- | --- |
| SQL 주입 | 서버 SQL·ORM·쿼리 API 없음. IndexedDB의 고정 슬롯과 허용 목록만 사용하며 모델/표/백업 크기·깊이·객체 키를 검증 |
| XSS | 프레임워크 escaping 유지. 사용자 HTML·eval·Function 실행 없음. 제한 AST, 안전한 JSON/CSV export, 라이선스/정책 빌드의 HTML escaping 검토 |
| 시크릿 | 앱 환경 키·인증 token 없음. source/dist 패턴과 환경 파일 미배포 검사. 기존 원격 저장소는 README만 존재했으며 전체 과거 git-history 감사는 수행하지 않음 |
| 인증/인가 | 계정·서버 저장·다중 사용자 조회 API 없음. 로컬 기기 접근 통제와 브라우저 origin 경계이며 암호화된 계정 보관소로 표현하지 않음 |
| 입력 검증 | 모델5MiB·데이터2MiB·백업26MiB·history20MiB/5records·log16KiB/50records. strict schema/AST·형상·단위·rate·finite·예산을 compiler/Worker에서 재검증 |
| Rate limiting | 인증/유료 API 없음. 대신 노드1000·연결5000·시간 격자/연산/기록/벽시계·취소 watchdog의 로컬 계산 예산 적용 |
| CSRF·헤더·HTTPS | 서버 mutation·인증 쿠키 없음. production CSP meta/referrer 및 preview HTTP 정책 확인. 실제 공개 domain/HTTP headers/HTTPS는 미확인 |
| 서버 DB 권한/RLS | 서버 DB 없음. IndexedDB 원자적 복구·tab revision CAS·versionchange close와 quota rollback을 실제 브라우저로 확인 |

## M6에서 보완한 경계

서로 다른 탭의 저장·초기화는 같은 transaction 안에서 revision을 비교한다. 무효/미래 모델과 손상 history 원본을 보존하며 합법적인 원본 텍스트만 크기·구조 검사 후 내려받는다. 백업 manifest는 모델·history와 format/version/time/engine metadata까지 해시로 묶고 무효 파일은 기존 저장본을 변경하지 않는다. 네이티브 quota exception은 고정 진단으로 정규화하고 원문을 로그로 보내지 않는다. 손상 로그의 임의 engine suffix·추가 필드는 내보내기에서 제외한다.

새 오프라인 캐시는 모든 최종 파일 검증 전에는 사용하지 않는다. 첫 빌드의 후처리 바이트 불일치가 실제 설치 거부로 드러났고 최종 디스크 기준 manifest 생성으로 수정했다. 대기 업데이트는 저장 성공 후 선택한 탭만 갱신한다. 외부 URL·사용자 자료를 runtime cache에 넣지 않는다. GitHub Pages 게시 workflow는 root custom domain이 없으면 artifact 업로드 전에 거부한다.

## 개인정보 흐름과 남은 확인

| 항목 | 시점·목적 | 위치·보유 | 운영자/외부 전송 |
| --- | --- | --- | --- |
| 모델·포함 표·최근 결과 | 편집·실행·재개·복구 | 같은 브라우저 IndexedDB, 수동 삭제/브라우저 정리까지; 최근 실행5개 | 자동 전송 없음 |
| 테마·백업 안내 시각 | 화면 설정·백업 안내 | localStorage, 삭제/사이트 저장소 정리까지 | 없음 |
| 고정 로컬 진단 | 저장/실행 실패 확인 | localStorage 최대50건·16KiB, 오래된 기록 교체 또는 직접 삭제 | 사용자 직접 다운로드만 가능 |
| 정적 파일 요청의 접속 정보 | 호스팅·파일 설치/갱신 | 예정 GitHub Pages의 처리 범위·보유·운영자 접근은 확인 필요 | 플랫폼의 실제 정책/트래픽 확인 필요 |
| 사용자가 직접 보낸 문의 | 메일 문의 선택 시 | 앱에 수집 코드 없음; 운영자의 문의 처리 보유 정책은 확인 필요 | 사용자가 자신의 메일 앱에서 선택하여 전송 |

정책 페이지는 실제 앱 흐름을 기록한 초안이며 공개 적용일·호스팅 트래픽의 처리위탁/국외이전 해당 여부·메일 처리 운영 사실을 확정해야 한다. 실제 사용자 개인정보나 결제를 처리하기 전 전문가 검토를 권고한다. 계정 동의·아동 가입·결제·회원 탈퇴·원격 RLS는 현재 없는 기능으로 N/A이며, 적용 가능한 기능을 추가하면 별도 검토한다.

이 요약은 공개 domain의 보안과 운영 검증 PASS를 뜻하지 않는다. 원시 감사와 출시 판정의 상세 위치는 공개 저장소에서 제외한 `.vsf/`에 저장한다.
