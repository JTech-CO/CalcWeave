import { useEffect, useMemo, useState } from 'react';
import { type ParameterDefinition } from '../../../../packages/block-library/src';
import { type ExecutionMode } from '../../../../packages/model/src';
import { getReleaseCatalog } from '../../../../packages/release/src';
import type { CanonicalSupport, SourceSupportRow, SupportClassification, SupportDecision, SupportTarget, SupportTargetStatus } from '../../../../packages/support-matrix/src';
import { Icon } from './Icon';
import { ModalDialog } from './ModalDialog';
import { appResourcePath } from '../app-path';
import { AdapterCatalogPanel } from './AdapterCatalogPanel';
import { downloadText } from './M4WorkspaceTools';

const MODES: Record<ExecutionMode, string> = { static: '정적 계산', discrete: '이산 시뮬레이션', continuous: '연속·혼합 시뮬레이션' };
const RELEASE = getReleaseCatalog();
const BLOCK_REGISTRY = RELEASE.blocks;
function parameterConstraint(parameter: Pick<ParameterDefinition, 'options' | 'min' | 'max' | 'minLength' | 'maxLength'>) {
  return [parameter.options?.join(' · '), parameter.min !== undefined || parameter.max !== undefined ? `${parameter.min ?? '−∞'} ~ ${parameter.max ?? '∞'}` : '', parameter.minLength !== undefined || parameter.maxLength !== undefined ? `길이 ${parameter.minLength ?? 0} ~ ${parameter.maxLength ?? '제한 없음'}` : ''].filter(Boolean).join(' / ') || '신호 형식·유한값을 확인합니다.';
}

export function SupportDialog({ onClose, onManage }: { onClose: () => void; onManage: () => void }) {
  const [page, setPage] = useState<'support' | 'matrix' | 'adapters' | 'keyboard' | 'limits' | 'policy'>('support');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ExecutionMode | ''>('');
  const [selectedId, setSelectedId] = useState('source.constant');
  const blocks = useMemo(() => BLOCK_REGISTRY.filter(block => (!mode || block.supportedModes.includes(mode)) && `${block.id} ${block.label} ${block.englishName} ${block.aliases?.join(' ')} ${block.description} ${block.category} ${Object.entries(block.parameters).map(([key, parameter]) => `${key} ${parameter.label} ${parameter.kind} ${parameter.options?.join(' ')}`).join(' ')} ${block.valueType} ${block.shape} ${block.unit}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [query, mode]);
  const selected = BLOCK_REGISTRY.find(block => block.id === selectedId)!;
  return <ModalDialog labelId="support-title" className="support-dialog" onClose={onClose} initialFocus="[aria-label='지원 블록 검색']">
    <div className="dialog-heading"><div><h2 id="support-title">지원·릴리스</h2><p>CalcWeave {RELEASE.version} · 엔진 {RELEASE.engineVersion} · {BLOCK_REGISTRY.length}개 블록</p><p>웹 베타 · {RELEASE.browserSupport}</p></div><button className="icon-button" aria-label="지원·릴리스 닫기" onClick={onClose}><Icon name="close"/></button></div>
    <nav className="dialog-navigation" aria-label="지원 정보"><button aria-pressed={page === 'support'} onClick={() => setPage('support')}>지원 블록</button><button aria-pressed={page === 'matrix'} onClick={() => setPage('matrix')}>원자료 대응표</button><button aria-pressed={page === 'adapters'} onClick={() => setPage('adapters')}>확장 실행</button><button aria-pressed={page === 'keyboard'} onClick={() => setPage('keyboard')}>사용 방법</button><button aria-pressed={page === 'limits'} onClick={() => setPage('limits')}>범위와 상한</button><button aria-pressed={page === 'policy'} onClick={() => setPage('policy')}>정책·로컬 저장</button></nav>
    <div className="dialog-content">
      {page === 'matrix' && <SourceSupportPanel/>}
      {page === 'adapters' && <AdapterCatalogPanel/>}
      {page === 'support' && <><div className="support-filters"><label className="field"><span className="field-label">블록·파라미터 검색</span><input aria-label="지원 블록 검색" maxLength={120} value={query} onChange={event => setQuery(event.target.value)} placeholder="LU, 적분, wordLength…"/></label><label className="field"><span className="field-label">실행 방식</span><select aria-label="지원 실행 방식" value={mode} onChange={event => setMode(event.target.value as ExecutionMode | '')}><option value="">전체 방식</option>{Object.entries(MODES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><p className="support-result-count" role="status">{blocks.length} / {BLOCK_REGISTRY.length}개 블록</p><div className="support-layout"><div className="support-block-list" aria-label="지원 블록 목록">{blocks.map(block => <button key={block.id} aria-pressed={selectedId === block.id} onClick={() => setSelectedId(block.id)}><strong>{block.label} · {block.englishName}</strong><span>{block.category} · {block.supportedModes.map(item => MODES[item]).join(' / ')}</span></button>)}{!blocks.length && <p className="muted-copy">일치하는 블록이 없습니다.</p>}</div><section className="support-block-detail" aria-label="선택한 블록의 지원 정보"><h3>{selected.label} · {selected.englishName}</h3><p>{selected.description}</p><dl className="support-metadata"><div><dt>ID</dt><dd>{selected.id} · v{selected.version}</dd></div><div><dt>실행 방식</dt><dd>{selected.supportedModes.map(item => MODES[item]).join(' · ')}</dd></div><div><dt>입력 / 출력</dt><dd>{selected.inputs.join(', ') || '없음'} / {selected.outputs.join(', ') || '없음'}<small>동적 포트는 블록의 설정과 하위 도식 정의에 따라 바뀝니다.</small></dd></div><div><dt>코드 타깃</dt><dd>{selected.exportTargets.join(' · ')}<small>Python은 정적·이산 실행의 승인 범위입니다. 하위 도식은 내부 계산 블록이 모두 지원될 때 내보낼 수 있습니다. 실제 모델의 모드·연결·자료형은 코드 타깃 선택 창에서 확인합니다.</small></dd></div><div><dt>타입 · 모양</dt><dd>{selected.valueType} · {selected.shape}</dd></div><div><dt>단위</dt><dd>{selected.unit === 'dimensionless' ? '1 · 단위 없음' : '입력·파라미터에서 추론'}</dd></div><div><dt>시간 · 상태</dt><dd>{selected.sampleTime} · {selected.state}</dd></div></dl><h4>파라미터와 기본값</h4>{Object.keys(selected.parameters).length ? <div className="support-parameter-list">{Object.entries(selected.parameters).map(([key, parameter]) => <div key={key}><strong>{parameter.label} <code>{key}</code></strong><p>{parameter.kind} · 기본값 <code>{JSON.stringify(parameter.default)}</code></p><p>{parameterConstraint(parameter)}</p></div>)}</div> : <p>설정할 파라미터가 없습니다.</p>}<p className="field-help">타입·shape·단위·연결 조건은 현재 모델을 실행하기 전에 검증합니다. 입력값을 추론하는 블록의 최종 모양은 블록 속성에서 확인하세요.</p></section></div></>}
      {page === 'keyboard' && <section className="support-copy"><h3>블록으로 계산을 엮어 보세요.</h3><ol><li>라이브러리에서 블록을 추가합니다.</li><li>출력 → 입력 포트를 연결합니다. 블록 속성의 연결 메뉴는 키보드로도 사용할 수 있습니다.</li><li>블록을 선택하고 값을 바꾼 뒤 실행합니다.</li></ol><dl className="support-metadata"><div><dt>캔버스</dt><dd>휠 버튼 드래그 이동 · 왼쪽 드래그 영역 선택 · Space 도식 맞추기</dd></div><div><dt>키보드 편집</dt><dd>Tab으로 블록 이동 · Enter로 속성 편집 · Tab으로 입력값과 연결 메뉴 이동</dd></div><div><dt>빠른 추가</dt><dd>Ctrl+K · ↑ ↓ 선택 · Enter 추가 · Escape 닫기</dd></div><div><dt>선택</dt><dd>Ctrl+A 전체 선택 · Ctrl+C/V 복사·붙여넣기 · Ctrl+D 복제 · Delete 삭제</dd></div><div><dt>실행</dt><dd>Ctrl+Enter 실행 · Ctrl+Z 실행 취소 · Ctrl+Shift+Z 다시 실행</dd></div></dl><p>데이터는 CSV·JSON을 미리 본 뒤 재생합니다. 선택 블록은 하위 도식으로 묶고 내부를 편집할 수 있습니다. 실험에서는 반복 실행과 비교를, 대시보드에서는 다음 실행의 입력 조절을, 노트에서는 설명을 보관합니다.</p><p>Scope의 시작·종료 시간을 적용하면 그 범위까지 실제 계산을 다시 실행합니다. solver 내부 간격과 결과 기록 간격은 별도로 설정합니다.</p></section>}
      {page === 'limits' && <section className="support-copy"><h3>지원 범위</h3><p>기존 실수 float64·boolean 신호는 scalar·벡터·2D 범위이며, Typed 신호는 명시한 자료형과 최대 8차원 배열을 지원합니다. Bus·메시지는 등록한 구조와 상한을 확인합니다. 연속·혼합 실행은 RK4·RK45와 선택 implicit Euler 계약이며, 블록·자료형·설정에 따른 제한은 대응표와 실행 전 검증에서 확인하세요. 행렬 계산은 실수 밀집 2D 범위이고 기존 Quantize의 최대 32-bit 양자화는 decoded 값과 저장 정수 코드를 출력합니다.</p><ul className="unsupported-list">{RELEASE.unsupported.map(item => <li key={item}>{item}</li>)}</ul><p>단위는 검증하며 unit.convert를 제외한 자동 변환은 수행하지 않습니다.</p><h3>실행 상한</h3><dl className="support-metadata">{Object.entries(RELEASE.limits).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl><details><summary>연속 solver 상한</summary><dl className="support-metadata">{Object.entries(RELEASE.solverLimits).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl></details><p>행렬 각 축 최대 32, lookup 각 축 2~32, 계층 깊이 최대 8, 데이터 파일 최대 2 MiB. 반복 실험은 최대 16회와 총 30초 상한을 공유합니다. 실행 기록은 최대 5개·20 MiB로 유지하며, 기록당 수치 원소는 200,000개를 넘을 수 없습니다.</p></section>}
      {page === 'policy' && <section className="support-copy"><h3>이 브라우저의 로컬 작업 공간</h3><p>모델과 데이터, 실행 기록은 현재 브라우저에 저장됩니다. 백업 파일은 직접 내려받아 보관하고 다른 기기에서 복원할 수 있습니다. 브라우저 저장 공간을 지우면 저장된 작업이 사라질 수 있습니다.</p><button className="button primary" onClick={onManage}>로컬 데이터 관리 열기</button><h3>정책</h3><div className="policy-links"><a href={appResourcePath(RELEASE.policyLinks.privacy)} target="_blank" rel="noopener noreferrer">개인정보 처리방침</a><a href={appResourcePath(RELEASE.policyLinks.terms)} target="_blank" rel="noopener noreferrer">이용약관</a><a href={appResourcePath(RELEASE.policyLinks.cookies)} target="_blank" rel="noopener noreferrer">쿠키·로컬 저장 안내</a></div><p>운영자 {RELEASE.operator} · 문의 <a href={`mailto:${RELEASE.contact}`}>{RELEASE.contact}</a></p><p>현재 웹 베타: <a href={RELEASE.deploymentUrl} target="_blank" rel="noopener noreferrer">GitHub Pages에서 열기</a></p><p>브랜딩 목표 도메인: {RELEASE.domain}. 검증 범위와 남은 확인은 릴리스 체크리스트에 기록합니다.</p><a href={appResourcePath(RELEASE.policyLinks.notices)} target="_blank" rel="noopener noreferrer">릴리스·오픈소스 고지</a></section>}
    </div>
    <div className="dialog-footnote">Escape 닫기 · Tab으로 창 안의 항목 이동<button className="text-button" onClick={onClose}>닫기</button></div>
  </ModalDialog>;
}

type SupportMatrixApi = typeof import('../../../../packages/support-matrix/src');
let matrixModule: Promise<SupportMatrixApi> | undefined;
function loadSupportMatrix(): Promise<SupportMatrixApi> {
  return matrixModule ??= import('../../../../packages/support-matrix/src').catch(error => { matrixModule = undefined; throw error; });
}
const CLASSIFICATIONS: Record<SupportClassification, string> = {
  'native-capability': '계산 기능', 'shared-configuration': '공유 구성', preset: 'preset',
  'independent-alternative': '독립 대체', 'conditional-adapter': '조건부 adapter', legacy: '이전·외부 환경',
};
const DECISIONS: Record<SupportDecision, string> = { 'selected-subset': '선택 범위 지원', unsupported: '미지원', 'legacy-unavailable': '원본 환경 미지원' };
const TARGETS: Record<SupportTarget, string> = { typescript: 'TypeScript', python: 'Python', wasm: 'WASM', 'c-cpp': 'C/C++' };
const TARGET_STATUS: Record<SupportTargetStatus, string> = { 'selected-config-eligible': '선택 구성 승인', 'ui-only': '화면 전용', unsupported: '미지원', 'environment-unavailable': '실행 환경 미지원' };

/** Links point to reviewed repository artifacts; no imported URL becomes executable content. */
function supportArtifactLink(path: string, line?: number): string | undefined {
  if (path.length > 512 || !/^(?:docs|dataset|tests|packages)\//.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || !/^[\w.\-]+$/.test(part))) return undefined;
  return `${RELEASE.repository}/blob/main/${path.split('/').map(part => encodeURIComponent(part)).join('/')}${line !== undefined && Number.isInteger(line) && line > 0 ? `#L${line}` : ''}`;
}
function ArtifactLabel({ path, line }: { path: string; line?: number }) {
  const href = supportArtifactLink(path, line);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{path}{line ? ` · L${line}` : ''}</a> : <span>{path}{line ? ` · L${line}` : ''}</span>;
}

function SourceSupportPanel() {
  const [api, setApi] = useState<SupportMatrixApi>(), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setError(false);
    void loadSupportMatrix().then(module => { if (active) setApi(module); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attempt]);
  if (error) return <section className="source-support-matrix" aria-label="원자료 대응표"><p role="alert">대응표 데이터를 불러오지 못했습니다. 연결 상태를 확인하세요.</p>{attempt < 2 && <button className="button" onClick={() => setAttempt(current => current + 1)}>대응표 다시 불러오기</button>}</section>;
  if (!api) return <p role="status">원자료 대응표를 불러오고 있습니다.</p>;
  return <SourceSupportContent api={api}/>;
}

function SourceSupportContent({ api }: { api: SupportMatrixApi }) {
  const [query, setQuery] = useState(''), [section, setSection] = useState<number | undefined>(), [classification, setClassification] = useState<SupportClassification | undefined>(), [decision, setDecision] = useState<SupportDecision | undefined>(), [target, setTarget] = useState<SupportTarget | undefined>();
  const [selectedId, setSelectedId] = useState('01-001');
  const [reportError, setReportError] = useState(false);
  const rows = useMemo(() => api.listSourceSupport({ query, section, classification, decision, target }).slice(0, 385), [api, query, section, classification, decision, target]);
  const selected = rows.find(row => row.id === selectedId) ?? rows[0], summary = api.getSupportSummary();
  function downloadReport() {
    try { downloadText(api.serializeSupportMatrix(), 'CalcWeave-support-matrix.json', 'application/json'); setReportError(false); }
    catch { setReportError(true); }
  }
  return <section className="source-support-matrix" aria-labelledby="source-matrix-title">
    <h3 id="source-matrix-title">원자료별 지원 범위를 확인하세요</h3>
    <p>R2024b 참고 자료의 원자료 {summary.trackedSourceRows}행을 추적합니다. 같은 이름이나 같은 계산 블록을 사용하는 항목도 원자료 ID로 구분합니다. 전체 Simulink 라이브러리 전수 목록이나 원본 전체 옵션의 동등성을 뜻하지 않습니다.</p>
    <div className="source-support-summary" data-testid="source-support-summary"><span>원자료 {summary.trackedSourceRows}행 · 이름 {summary.uniqueSourceNames}개</span><span>등록 계산 블록 {summary.registryDefinitions}개</span><span>선택 subset {summary.selectedSubsetRows}행 · 미지원 {summary.unsupportedRows}행</span><span>원본 옵션 inventory 미검증 {summary.unverifiedInventoryRows}행 · 전체 동등 승인 {summary.fullOptionEquivalentRows}행</span></div>
    <div className="source-support-filters">
      <label className="field source-support-search"><span className="field-label">원자료 이름·ID·구현 검색</span><input aria-label="원자료 검색" maxLength={120} value={query} onChange={event => setQuery(event.target.value.slice(0, 120))} placeholder="Display, 06-001, string…"/></label>
      <label className="field"><span className="field-label">분류</span><select aria-label="원자료 분류" value={section ?? ''} onChange={event => { const selected = api.SUPPORT_MATRIX.sections.find(item => String(item.id) === event.target.value); setSection(selected?.id); }}><option value="">전체 분류</option>{api.SUPPORT_MATRIX.sections.map(item => <option key={item.id} value={item.id}>{String(item.id).padStart(2, '0')} · {item.name}</option>)}</select></label>
      <label className="field"><span className="field-label">구현 유형</span><select aria-label="원자료 구현 유형" value={classification ?? ''} onChange={event => setClassification(Object.hasOwn(CLASSIFICATIONS, event.target.value) ? event.target.value as SupportClassification : undefined)}><option value="">전체 유형</option>{Object.entries(CLASSIFICATIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="field"><span className="field-label">지원 상태</span><select aria-label="원자료 지원 상태" value={decision ?? ''} onChange={event => setDecision(Object.hasOwn(DECISIONS, event.target.value) ? event.target.value as SupportDecision : undefined)}><option value="">전체 상태</option>{Object.entries(DECISIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="field"><span className="field-label">코드 타깃</span><select aria-label="원자료 코드 타깃" value={target ?? ''} onChange={event => setTarget(Object.hasOwn(TARGETS, event.target.value) ? event.target.value as SupportTarget : undefined)}><option value="">전체 타깃</option>{Object.entries(TARGETS).map(([id, label]) => <option key={id} value={id}>{label} 선택 구성</option>)}</select></label>
    </div>
    <p className="field-help">타깃 필터는 선택 구성의 승인 목록입니다. 실제 모델의 자료형·설정·모드·연결 검증이 필요합니다. 화면 위젯과 원본 환경 미지원 항목에는 실행 타깃을 부여하지 않습니다.</p>
    {target === 'c-cpp' && <p className="field-help">C/C++는 승인된 빌드·실행 프로파일이 없어 현재 선택 구성 목록이 없습니다.</p>}
    <div className="source-support-actions"><p className="support-result-count" role="status">{rows.length} / {summary.trackedSourceRows}행</p><button className="button" onClick={downloadReport}>전체 대응표 JSON 다운로드</button></div>
    {reportError && <p role="alert">대응표 보고서 다운로드를 준비하지 못했습니다. 창을 다시 열고 확인하세요.</p>}
    <p id="source-list-help" className="field-help">목록에서 ↑ ↓로 선택하고 Home·End로 처음·끝 항목에 이동합니다. Tab으로 상세의 링크와 설정을 확인하세요.</p>
    <div className="source-support-layout">
      <div className="source-support-list" role="group" aria-label="원자료 대응 목록" aria-describedby="source-list-help">{rows.map((row, index) => <button key={row.id} data-source-id={row.id} data-source-decision={row.decision.status} data-source-classification={row.decision.classification} aria-pressed={selected?.id === row.id} tabIndex={selected?.id === row.id ? 0 : -1} onClick={() => setSelectedId(row.id)} onKeyDown={event => {
        const next = event.key === 'ArrowDown' ? Math.min(index + 1, rows.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault(); event.stopPropagation(); setSelectedId(rows[next]!.id);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[data-source-id]')[next]?.focus();
      }}><strong>{row.id} · {row.name}</strong><span>{String(row.section).padStart(2, '0')}절 · {row.subgroup}</span><span>{DECISIONS[row.decision.status]} · {CLASSIFICATIONS[row.decision.classification]}</span></button>)}{rows.length === 0 && <p className="muted-copy">일치하는 원자료 항목이 없습니다.</p>}</div>
      {selected && <SourceSupportDetails row={selected} api={api}/>}
    </div>
  </section>;
}

function SourceSupportDetails({ row, api }: { row: Readonly<SourceSupportRow>; api: SupportMatrixApi }) {
  return <section className="source-support-detail" aria-label="원자료 선택 항목 상세" data-source-detail-id={row.id}>
    <h3>{row.id} · {row.name}</h3><p>{row.decision.reason}</p>
    <div className="source-support-boundary"><strong>전체 동등성 미검증</strong><p>이 항목은 선언한 선택 subset 또는 명시한 미지원 상태입니다. 원본 옵션 inventory는 {row.sourceInventory.status}이며, MathWorks 참조 환경 실행과 모든 자료형·설정·타깃의 수치 동등성을 검증하지 않았습니다.</p></div>
    <dl className="support-metadata">
      <div><dt>원자료</dt><dd><ArtifactLabel path={row.source.path} line={row.source.line}/><small>{row.subgroup} · {row.condition}</small><small>원자료 ID SHA-256 <code className="source-support-code">{row.source.identitySha256}</code></small></dd></div>
      <div><dt>결정·책임</dt><dd>{DECISIONS[row.decision.status]} · {CLASSIFICATIONS[row.decision.classification]}<small>원래 상태: {row.decision.priorStatus} · 담당 {row.owner}</small><small>{row.verification.engineVersion} · {row.verification.auditScope}</small></dd></div>
      <div><dt>실행 방식</dt><dd>{row.capabilities.modes.length ? row.capabilities.modes.map(mode => `${mode} · ${MODES[mode]}`).join(' / ') : '실행 방식 미지원 또는 화면 전용'}</dd></div>
      <div><dt>옵션 계약 참조</dt><dd>{row.capabilities.optionsRef.join(' · ') || '등록 옵션 계약 없음'}<small>로컬 선언과 선택 설정만 확인하며 원본 전체 옵션 inventory는 미검증입니다.</small></dd></div>
      <div><dt>자료형</dt><dd>{row.capabilities.dtype.scopes.map(scope => <p key={scope.canonical}><code>{scope.canonical}</code> · {scope.description}</p>)}<small>{row.capabilities.dtype.status} · 실제 모델에서 검증</small></dd></div>
      <div><dt>외부 조건</dt><dd>native 실행: {row.externalConditions.nativeExecution === 'unavailable' ? '미지원 · unavailable' : '미검증 · unverified'}<small>{row.externalConditions.sourceCondition}</small>{row.externalConditions.requirements.map((requirement, index) => <p key={index}>{requirement}</p>)}<small>원본 환경 실행 확인 없음 · 외부 코드 재배포·사용권은 구현 여부로 판단하지 않습니다.</small>{row.externalConditions.profileIds.length > 0 && <small>프로파일: {row.externalConditions.profileIds.join(' · ')}</small>}</dd></div>
    </dl>
    <h4>승인된 선택 설정</h4>
    {row.capabilities.optionProfiles.length ? row.capabilities.optionProfiles.map((profile, index) => <div className="source-support-implementation" key={index}><strong>선택 구성 {index + 1} · {profile.scope}</strong><code className="source-support-code">{JSON.stringify(profile.parameters, null, 2)}</code><p>{profile.modes.join(' · ')}</p>{profile.presetId && <p>preset: <code>{profile.presetId}</code></p>}{profile.rawFixtureId && <p>원본 fixture: <code>{profile.rawFixtureId}</code></p>}{profile.requiredBindingsActuallyConnected && <p>검증 fixture의 실제 연결: {profile.requiredBindingsActuallyConnected.length ? profile.requiredBindingsActuallyConnected.join(' · ') : '추가 동적 바인딩 없음'}</p>}<ArtifactLabel path={profile.evidencePath}/>{profile.fixtureIds.length > 0 && <p>fixture: {profile.fixtureIds.join(' · ')}</p>}</div>) : <p>별도 preset 설정 선언은 없습니다. 아래 구현의 등록 계약과 승인 증거 범위만 적용합니다.</p>}
    <h4>연결된 구현·파라미터 계약</h4>
    {row.implementations.map(implementation => { const contract = api.getCanonicalSupport(implementation.id); return contract ? <CanonicalSupportDetails key={`${implementation.kind}-${implementation.id}`} contract={contract}/> : <p key={`${implementation.kind}-${implementation.id}`}><code>{implementation.id}</code> · {implementation.kind} · 실행 계약 없음</p>; })}
    <h4>코드 타깃별 범위</h4>
    <div className="source-support-targets">{row.capabilities.targets.map(capability => <div key={capability.target} data-support-target={capability.target} data-support-target-status={capability.status}><strong>{TARGETS[capability.target]} · {TARGET_STATUS[capability.status]}</strong><p>{capability.reason}</p><p>{capability.dtypeScope}</p><p>{capability.supportedModes.length ? capability.supportedModes.join(' · ') : '실행 모드 없음'} · {capability.version}</p><p>선택 구성만 해당하며 실제 모델의 설정·자료형·모드·연결 검증이 필요합니다.</p></div>)}</div>
    <h4>미확정·남은 확인</h4><p>{row.sourceInventory.reason}</p><ul>{row.unresolvedReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul><p className="field-help">원본 옵션 확인 대상: {row.sourceInventory.requiredDimensions.join(' · ')}</p>
    <h4>근거·검증 파일</h4><p>추적용 자료와 선택 subset의 실행 증거를 구분합니다. 파일과 hash는 승인된 자료를 찾기 위한 정보이며 원본 환경 동등성의 보증이 아닙니다.</p>
    {row.evidence.map((evidence, index) => <details key={`${evidence.path}-${index}`}><summary>{evidence.kind} · {evidence.path}</summary><p><ArtifactLabel path={evidence.path}/></p><p>{evidence.scope}</p><p>주장 범위: {evidence.claim}</p><code className="source-support-code">SHA-256 {evidence.sha256}</code>{evidence.fixtureIds?.length ? <p>fixture: {evidence.fixtureIds.join(' · ')}</p> : null}</details>)}
  </section>;
}

function CanonicalSupportDetails({ contract }: { contract: Readonly<CanonicalSupport> }) {
  return <section className="source-support-implementation" data-canonical-support-id={contract.id} aria-label={`${contract.id} 구현 계약`}><h4>{contract.label} · {contract.englishName}</h4><p><code>{contract.id}</code> · {contract.kind}{contract.kind === 'model-widget' ? ' · 모델 대시보드 위젯' : contract.kind === 'unavailable-capability' ? ' · 실행 계약 미지원' : ' · 등록 계산 블록'}</p><p>{contract.description}</p>
    <dl className="support-metadata"><div><dt>입력 / 출력</dt><dd>{contract.declaration.inputs.join(' · ') || '없음'} / {contract.declaration.outputs.join(' · ') || '없음'}<small>포트는 실제 설정·하위 도식에 따라 검증합니다.</small></dd></div><div><dt>자료형·모양</dt><dd>{contract.dtype.scope}<small>{contract.declaration.valueType} · {contract.declaration.shape} · {contract.dtype.status}</small></dd></div><div><dt>단위·시간·상태</dt><dd>{contract.declaration.unit} · {contract.declaration.sampleTime} · {contract.declaration.state}</dd></div>{contract.bindings?.length ? <div><dt>바인딩 조건</dt><dd>{contract.bindings.map((binding, index) => <p key={index}>{binding}</p>)}</dd></div> : null}</dl>
    {Object.keys(contract.parameters).length > 0 && <details><summary>설정·기본값 {Object.keys(contract.parameters).length}개</summary><div className="support-parameter-list">{Object.entries(contract.parameters).map(([id, parameter]) => <div key={id}><strong>{parameter.label} <code>{id}</code></strong><p>{parameter.kind}{parameter.required !== undefined ? ` · ${parameter.required ? '필수' : '선택'}` : ''} · {contract.kind === 'model-widget' && parameter.default === null ? '기본값 지정 없음' : <>기본값 <code>{JSON.stringify(parameter.default)}</code></>}</p><p>{parameterConstraint(parameter)}</p><p>로컬 선언 schema 범위 · 원본 전체 옵션 inventory 미검증</p></div>)}</div></details>}
  </section>;
}
