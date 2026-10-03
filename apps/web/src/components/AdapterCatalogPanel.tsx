import { useMemo, useState } from 'react';
import { ADAPTER_PROFILES, BUILTIN_ADAPTER_PROFILES, UNAVAILABLE_ADAPTER_PROFILES } from '../../../../packages/model/src';
import { getBlockDefinition } from '../../../../packages/block-library/src';
import { AdapterProfileDetails, adapterReason } from './AdapterNodeDetails';

export function AdapterCatalogPanel() {
  const [query, setQuery] = useState(''), [availability, setAvailability] = useState('all'), [selectedId, setSelectedId] = useState(BUILTIN_ADAPTER_PROFILES[0]!.id);
  const profiles = useMemo(() => ADAPTER_PROFILES.filter(profile => (availability === 'all' || profile.availability === availability) && `${profile.label} ${profile.id} ${profile.blockType ?? ''} ${profile.sourceRowIds.join(' ')} ${adapterReason(profile)} ${profile.products.join(' ')} ${profile.toolchain.join(' ')} ${profile.artifact?.exports.map(entry => entry.name).join(' ') ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [query, availability]);
  const selected = profiles.find(profile => profile.id === selectedId) ?? profiles[0];
  return <section className="adapter-catalog" aria-label="확장 실행 프로파일">
    <div className="adapter-catalog-intro"><h3>확장 실행의 범위를 확인하세요</h3><p>내장 {BUILTIN_ADAPTER_PROFILES.length}개는 CalcWeave의 독립 구현입니다. 원본 환경 {UNAVAILABLE_ADAPTER_PROFILES.length}개는 별도 제품·컴파일러·사용권 확인이 필요하며 현재 실행을 제공하지 않습니다.</p><p>파일이나 코드를 업로드해 실행하는 기능은 제공하지 않습니다.</p></div>
    <div className="support-filters"><label className="field"><span className="field-label">프로파일·원자료 검색</span><input aria-label="확장 프로파일 검색" maxLength={120} value={query} onChange={event => setQuery(event.target.value)} placeholder="WASM, C Caller, TLC…"/></label><label className="field"><span className="field-label">제공 상태</span><select aria-label="확장 제공 상태" value={availability} onChange={event => setAvailability(event.target.value)}><option value="all">전체</option><option value="bundled">내장 독립 구현</option><option value="unavailable">원본 환경 미지원</option></select></label></div>
    <p className="support-result-count" role="status">{profiles.length} / {ADAPTER_PROFILES.length}개 프로파일 · 실행 블록과 원본 환경 항목은 별도 집계</p>
    <div className="support-layout adapter-layout"><div className="support-block-list adapter-profile-list" aria-label="확장 프로파일 목록">{profiles.map(profile => <button key={profile.id} data-adapter-id={profile.id} data-adapter-status={profile.availability} aria-pressed={selected?.id === profile.id} onClick={() => setSelectedId(profile.id)}><strong>{profile.blockType ? getBlockDefinition(profile.blockType)?.label ?? profile.label : profile.label}</strong><span>{profile.availability === 'bundled' ? '내장 · 독립 구현' : '원본 환경 미지원'} · {profile.sourceRowIds.join(', ')}</span></button>)}{profiles.length === 0 && <p className="muted-copy">일치하는 프로파일이 없습니다.</p>}</div>{selected && <AdapterProfileDetails profile={selected}/>}</div>
  </section>;
}
