import { getAdapterAvailability, getNodeAdapterProfile, type AdapterProfile, type CalcNode, type RunResult } from '../../../../packages/model/src';

const MODE_LABELS = { static: '정적 계산', discrete: '이산 시뮬레이션', continuous: '연속·혼합 시뮬레이션' };
const nativeReasons: Record<string, string> = {
  'native.entity-transport-delay': 'SimEvents 엔터티 런타임과 운송 거리 적분을 포함하지 않습니다. 메시지 FIFO는 별도의 제한된 대체입니다.',
  'native.c-caller': '외부 C 소스·헤더와 네이티브 ABI·컴파일러 연결을 제공하지 않습니다.',
  'native.c-function': '외부 C 콜백·수명주기와 네이티브 컴파일 환경을 제공하지 않습니다.',
  'native.interpreted-matlab-function': 'MATLAB 해석기를 포함하지 않습니다. 필요한 수학식을 제한 수식으로 직접 옮겨야 합니다.',
  'native.level-2-matlab-s-function': 'MATLAB Level-2 콜백 API와 해당 타깃의 TLC 코드 생성을 제공하지 않습니다.',
  'native.matlab-system': 'MATLAB System object 실행 환경과 사용자 객체·관련 제품을 포함하지 않습니다.',
  'native.s-function': '컴파일된 MEX/S-function ABI와 콜백·타깃 연결을 제공하지 않습니다.',
  'native.s-function-builder': '외부 C/MEX 컴파일러와 S-function Builder 래퍼 실행을 제공하지 않습니다.',
};
export function adapterReason(profile: AdapterProfile): string { return nativeReasons[profile.id] ?? profile.reason ?? ''; }
export function AdapterProfileDetails({ profile }: { profile: AdapterProfile }) {
  const availability = getAdapterAvailability(profile.id);
  return <section className="adapter-profile-detail" data-adapter-profile={profile.id} data-adapter-available={String(availability.available)} aria-label={`${profile.label} 실행 정보`}>
    <div className="adapter-detail-heading"><h3>{profile.label}</h3><span className={`tag adapter-status ${availability.available ? 'bundled' : 'unavailable'}`}>{availability.available ? '내장 · 독립 구현' : '원본 환경 미지원'}</span></div>
    {availability.available ? <p className="adapter-contract-copy">CalcWeave의 고정 구현입니다. 원본 제품의 전체 옵션이나 실행 동등성을 의미하지 않습니다.</p> : <p className="adapter-unavailable-reason" role="status">{adapterReason(profile)}</p>}
    <dl className="support-metadata adapter-metadata">
      <div><dt>프로파일</dt><dd><code>{profile.id}</code> · v{profile.version}<small>원자료 {profile.sourceRowIds.join(', ')}</small></dd></div>
      <div><dt>실행 환경</dt><dd>{profile.environment.join(' · ')}{profile.availability === 'bundled' && profile.artifact && <small>실제 WASM 환경은 실행할 때 엔진에서 확인합니다.</small>}</dd></div>
      <div><dt>실행 방식</dt><dd>{profile.supportedModes.length ? profile.supportedModes.map(mode => MODE_LABELS[mode]).join(' · ') : '실행하지 않습니다.'}{profile.limits.rootGraphOnly && <small>루트 도식에서만 사용합니다.</small>}</dd></div>
      <div><dt>코드 타깃</dt><dd>{profile.exportTargets.join(' · ') || '제공하지 않습니다.'}</dd></div>
      {profile.diagnosticCode && <div><dt>진단</dt><dd><code>{profile.diagnosticCode}</code></dd></div>}
      {profile.artifact && <><div><dt>고정 SHA-256</dt><dd className="adapter-hash"><code>{profile.artifact.sha256}</code></dd></div><div><dt>WASM ABI</dt><dd>v{profile.artifact.abiVersion} · {profile.artifact.byteLength} bytes<ul className="adapter-export-list">{profile.artifact.exports.map(entry => <li key={entry.name}><code>{entry.name}({entry.parameters.join(', ')}) → {entry.result}</code></li>)}</ul></dd></div></>}
    </dl>
    {profile.ports.length > 0 && <details className="adapter-section"><summary>입력·출력과 단위</summary><ul>{profile.ports.map(port => <li key={`${port.direction}-${port.id}`}><strong>{port.direction === 'input' ? '입력' : '출력'} {port.id}</strong> · {port.dtype} · {port.shape} · {port.unit}</li>)}</ul></details>}
    <details className="adapter-section"><summary>상태·호출 순서와 상한</summary><ol>{profile.lifecycle.map(step => <li key={step}>{step}</li>)}</ol><dl className="support-metadata">{Object.entries(profile.limits).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></details>
    <details className="adapter-section"><summary>출처·제품·권리</summary><dl className="support-metadata"><div><dt>작성 주체</dt><dd>{profile.provenance.author}</dd></div><div><dt>구현 출처</dt><dd>{profile.provenance.implementation}</dd></div><div><dt>필요 제품</dt><dd>{profile.products.join(' · ') || '별도 제품 없음'}</dd></div><div><dt>도구 환경</dt><dd>{profile.toolchain.join(' · ')}</dd></div><div><dt>라이선스 선언</dt><dd><code>{profile.rights.license}</code><small>프로젝트에서 허용한 자체 내장 구현만 제공합니다. 외부 코드·원본 제품의 사용권이나 재배포 권리는 별도로 확인해야 합니다.</small></dd></div><div><dt>내장 실행</dt><dd>{profile.rights.bundledExecution}</dd></div><div><dt>소스 내보내기</dt><dd>{profile.rights.sourceExport}</dd></div><div><dt>외부 코드 재배포</dt><dd><code>{profile.rights.externalCodeRedistribution}</code></dd></div></dl><ul className="adapter-references">{profile.provenance.primaryReferences.map(url => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer">원본 동작 참고 문서</a></li>)}</ul></details>
    <details className="adapter-section"><summary>허용 기능</summary><p>사용자 코드·모듈·바이트·URL을 받지 않습니다. 고정 구현의 실행에는 네트워크·파일시스템·외부 콜백을 사용하지 않습니다.</p><dl className="support-metadata">{Object.entries(profile.capabilities).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value ? '허용' : '허용하지 않음'}</dd></div>)}</dl></details>
  </section>;
}
export function AdapterNodeDetails({ node }: { node: CalcNode }) {
  const profile = getNodeAdapterProfile(node.blockType);
  if (!profile) return null;
  return <section className="inspector-section adapter-node-details" aria-label="확장 실행 계약"><h3>확장 실행 계약</h3><p>{profile.artifact ? `고정 WASM ABI v${profile.artifact.abiVersion}` : '제한된 메시지 FIFO'} · {profile.supportedModes.map(mode => MODE_LABELS[mode]).join(' · ')}</p><p className="field-help">{profile.limits.rootGraphOnly ? '루트 도식에서 실행합니다. ' : ''}자체 구현의 선택 계약입니다. 원본 환경 지원과 별도로 확인하세요.</p><details><summary>ABI·출처·상한 보기</summary><AdapterProfileDetails profile={profile}/></details></section>;
}
export function AdapterLifecycleSummary({ result }: { result: RunResult }) {
  if (!result.adapterLifecycle?.length) return null;
  const reasons = { completed: '정상 완료', cancelled: '취소', failed: '실패' };
  return <details className="adapter-lifecycle-summary"><summary>확장 상태 종료 기록 · {result.adapterLifecycle.length}개</summary><ul>{result.adapterLifecycle.map(item => <li key={item.nodeId}><strong>{item.nodeId}</strong> · 초기화·종료 완료 · {reasons[item.reason]}<small>{item.profileId}</small></li>)}</ul></details>;
}
