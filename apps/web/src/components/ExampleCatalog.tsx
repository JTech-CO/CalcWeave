import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { EXAMPLES, EXAMPLE_CATEGORIES, type ExampleCategoryId } from '../examples';
import { Icon } from './Icon';

/** Search fixed local examples without converting the catalogue into executable input. */
export function ExampleCatalog({ trigger, onSelect, onClose }: { trigger: RefObject<HTMLButtonElement | null>; onSelect: (id: string) => void; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ExampleCategoryId | ''>('');
  const [position, setPosition] = useState({ left: 8, top: 8, maxHeight: 640 });
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase(), eligible = EXAMPLES.filter(example => !category || example.category === category);
    const visible = eligible.filter(example => example.id.toLocaleLowerCase() === term || `${example.title} ${example.description} ${EXAMPLE_CATEGORIES.find(item => item.id === example.category)?.label ?? ''}`.toLocaleLowerCase().includes(term));
    // Prefer readable titles and descriptions: "FIR" must not pick "first-calculation".
    return visible.length || !term ? visible : eligible.filter(example => example.model.nodes.some(node => node.blockType.toLocaleLowerCase().includes(term)));
  }, [query, category]);
  useLayoutEffect(() => {
    const locate = () => {
      const anchor = trigger.current?.getBoundingClientRect(), popup = panel.current;
      if (!anchor || !popup) return;
      const width = popup.getBoundingClientRect().width;
      const top = Math.max(8, Math.min(anchor.bottom + 8, innerHeight - 208));
      setPosition({ left: Math.max(8, Math.min(anchor.left, innerWidth - width - 8)), top, maxHeight: Math.max(200, Math.min(640, innerHeight - top - 8)) });
    };
    locate(); window.addEventListener('resize', locate);
    search.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('resize', locate);
  }, [trigger]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) onClose(); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [onClose, trigger]);
  const select = (id: string) => { onSelect(id); trigger.current?.focus({ preventScroll: true }); };
  return <div ref={panel} id="examples-catalog" className="examples-menu example-catalog" role="region" aria-label="예제 찾기" style={position} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); onClose(); trigger.current?.focus({ preventScroll: true }); }
  }}>
    <div className="example-catalog-heading"><strong>예제로 시작</strong><button className="icon-button" aria-label="예제 목록 닫기" onClick={() => { onClose(); trigger.current?.focus({ preventScroll: true }); }}><Icon name="close" size={16}/></button></div>
    <div className="example-catalog-filters"><label className="example-search"><Icon name="search" size={16}/><input ref={search} aria-label="예제 검색" maxLength={120} placeholder="수식, FIR, 데이터…" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.nativeEvent.isComposing && matches[0]) { event.preventDefault(); select(matches[0].id); } if (event.key === 'ArrowDown') { event.preventDefault(); panel.current?.querySelector<HTMLButtonElement>('[data-example-id]')?.focus(); } }}/></label><label className="visually-hidden" htmlFor="example-category">예제 카테고리</label><select id="example-category" aria-label="예제 카테고리" value={category} onChange={event => setCategory(event.target.value as ExampleCategoryId | '')}><option value="">모든 카테고리</option>{EXAMPLE_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
    <p className="example-catalog-count" aria-live="polite">{matches.length} / {EXAMPLES.length}개 예제</p>
    <div className="example-catalog-results">{EXAMPLE_CATEGORIES.map(item => {
      const examples = matches.filter(example => example.category === item.id);
      return examples.length > 0 && <section className="example-catalog-group" key={item.id} aria-label={item.label}><h3>{item.label}<span>{examples.length}</span></h3><p>{item.description}</p>{examples.map(example => <button className="example-option" key={example.id} data-example-id={example.id} onClick={() => select(example.id)}><strong>{example.title}</strong><span>{example.description}</span><Icon name="arrow" size={16}/></button>)}</section>;
    })}{matches.length === 0 && <div className="example-catalog-empty"><p>일치하는 예제가 없습니다.</p><button className="text-button" onClick={() => { setQuery(''); setCategory(''); search.current?.focus(); }}>검색 초기화</button></div>}</div>
  </div>;
}
