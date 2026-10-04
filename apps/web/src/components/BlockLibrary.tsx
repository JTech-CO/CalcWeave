import { useEffect, useId, useState, type RefObject } from 'react';
import { BLOCK_REGISTRY, type BlockDefinition } from '../../../../packages/block-library/src';
import { APP_VERSION } from '../../../../packages/release/src';
import { getBlockSymbol } from '../block-symbols';
import { blockTone } from './BlockNode';
import { Icon } from './Icon';
import './BlockLibrary.css';

const FREQUENT_BLOCK_IDS = ['source.constant', 'io.input', 'math.gain', 'math.sum', 'math.multiply', 'sink.display', 'sink.scope', 'continuous.integrator', 'discrete.unit-delay', 'route.switch'] as const;
const frequentBlocks = FREQUENT_BLOCK_IDS.flatMap(id => {
  const definition = BLOCK_REGISTRY.find(block => block.id === id);
  return definition ? [definition] : [];
});
const libraryCategories = [...new Set(BLOCK_REGISTRY.map(block => block.category))];

interface BlockLibraryProps {
  search: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onSearch: (query: string) => void;
  expandedCategories: ReadonlySet<string>;
  onToggleCategory: (category: string) => void;
  onAdd: (type: string) => void;
}

export function BlockLibrary({ search, searchRef, onSearch, expandedCategories, onToggleCategory, onAdd }: BlockLibraryProps) {
  const instanceId = useId();
  const [searchCollapsedCategories, setSearchCollapsedCategories] = useState<ReadonlySet<string>>(new Set());
  const query = search.trim().toLocaleLowerCase();
  const searching = query.length > 0;
  const filteredBlocks = searching ? BLOCK_REGISTRY.filter(definition => `${definition.label} ${definition.englishName} ${definition.description} ${definition.id} ${definition.aliases?.join(' ') ?? ''} ${getBlockSymbol(definition.id)}`.toLocaleLowerCase().includes(query)) : BLOCK_REGISTRY;
  const categories = libraryCategories.flatMap(category => {
    const items = filteredBlocks.filter(definition => definition.category === category);
    return items.length ? [{ key: category, label: category, items }] : [];
  });
  const sections = searching ? categories : [{ key: 'frequent', label: '자주 쓰는 블록', items: frequentBlocks }, ...categories];

  useEffect(() => { setSearchCollapsedCategories(new Set()); }, [query]);

  const toggleCategory = (key: string) => {
    if (!searching) { onToggleCategory(key); return; }
    setSearchCollapsedCategories(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const blockItem = (definition: BlockDefinition) => {
    const symbol = getBlockSymbol(definition.id);
    const symbolClass = symbol.length > 4 ? 'symbol-length-long' : symbol.length > 2 || symbol === '▱↕' ? 'symbol-length-medium' : '';
    return <button className="library-item" key={definition.id} data-block-id={definition.id} onClick={() => onAdd(definition.id)} title={`${definition.description} · 클릭하여 추가`}>
      <span className={`library-symbol ${blockTone(definition.id)} ${symbolClass}`} aria-hidden="true">{symbol}</span>
      <span className="library-copy"><strong>{definition.label}</strong><small>{definition.englishName}</small></span>
      <span className="library-add"><Icon name="plus" size={15}/></span>
    </button>;
  };

  return <aside className="library-panel block-library" aria-label="블록 라이브러리">
    <header className="block-library-header">
      <div className="panel-heading"><h2>블록 라이브러리 <span className="count-badge" aria-label={`전체 ${BLOCK_REGISTRY.length}개 블록`}>{BLOCK_REGISTRY.length}</span></h2></div>
      <label className="search-field"><Icon name="search" size={16}/><input ref={searchRef} value={search} maxLength={100} placeholder="블록 검색…" aria-label="한국어 또는 영어로 블록 검색" onChange={event => onSearch(event.target.value.slice(0, 100))}/><kbd>/</kbd></label>
      {searching && <p className="library-search-count" role="status">{filteredBlocks.length}개 검색 결과</p>}
    </header>
    <div className="library-list">
      {sections.map((section, index) => {
        const expanded = searching ? !searchCollapsedCategories.has(section.key) : expandedCategories.has(section.key);
        const panelId = `${instanceId}-category-${index}`;
        return <section key={section.key} className="library-category" data-library-category={section.key}>
          <h3><button className="library-category-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => toggleCategory(section.key)}><span>{section.label}</span><span className="library-category-count" aria-label={`${section.items.length}개 블록`}>{section.items.length}</span><Icon name="chevron-down" size={16}/></button></h3>
          <div id={panelId} className="library-category-items" hidden={!expanded}>{expanded && section.items.map(blockItem)}</div>
        </section>;
      })}
      {filteredBlocks.length === 0 && <div className="search-empty"><Icon name="search" size={24}/><strong>블록을 찾지 못했습니다.</strong><span>‘값’, ‘gain’, ‘적분’으로 검색해 보세요.</span><button className="text-button" onClick={() => onSearch('')}>전체 블록 보기</button></div>}
    </div>
    <div className="library-footnote"><span className="small-square">{APP_VERSION}</span><p>수학·신호를 연결하고<br/>예제에서 계산을 시작합니다.</p></div>
  </aside>;
}
