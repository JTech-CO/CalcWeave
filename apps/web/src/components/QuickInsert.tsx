import { M9_BLOCK_PRESETS } from '../../../../packages/block-library/src/m9';
import { M8_BLOCK_PRESETS } from '../../../../packages/block-library/src/m8';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BLOCK_REGISTRY } from '../../../../packages/block-library/src';
import { BLOCK_SYMBOLS, blockTone } from './BlockNode';
import { Icon } from './Icon';
import { useModalDialog } from './ModalDialog';

export interface InsertItem { id: string; blockType: string; title: string; description: string; parameters?: Record<string, unknown> }
const PRESETS: InsertItem[] = [
  ...M9_BLOCK_PRESETS.map(preset => ({ id: `preset-m9-${preset.id}`, blockType: preset.blockType, title: preset.label, description: '승인된 기본 설정', parameters: { ...preset.parameters } })),
  ...M8_BLOCK_PRESETS.map(preset => ({ id: `preset-m8-${preset.id}`, blockType: preset.blockType, title: preset.label, description: '승인된 기본 설정', parameters: { ...preset.parameters } })),
  { id: 'preset-pi', blockType: 'source.constant', title: 'Pi · 원주율 π', description: 'Constant의 값 π', parameters: { value: Math.PI } },
  { id: 'preset-zero', blockType: 'source.constant', title: 'Zero · 0', description: 'Constant의 값 0', parameters: { value: 0 } },
  { id: 'preset-true', blockType: 'source.constant', title: 'True · 참', description: 'Constant의 boolean 값 true', parameters: { value: true } },
  { id: 'preset-false', blockType: 'source.constant', title: 'False · 거짓', description: 'Constant의 boolean 값 false', parameters: { value: false } },
  { id: 'preset-add', blockType: 'math.sum', title: 'Add · 더하기', description: 'Sum의 입력 부호 ++', parameters: { signs: '++' } },
  { id: 'preset-subtract', blockType: 'math.sum', title: 'Subtract · 빼기', description: 'Sum의 입력 부호 +−', parameters: { signs: '+-' } },
];

export function QuickInsert({ onInsert, onClose }: { onInsert: (item: InsertItem) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const items = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    const canonical: InsertItem[] = BLOCK_REGISTRY.filter(definition => `${definition.label} ${definition.englishName} ${definition.id} ${definition.aliases?.join(' ') ?? ''}`.toLocaleLowerCase().includes(search)).map(definition => ({ id: definition.id, blockType: definition.id, title: `${definition.label} · ${definition.englishName}`, description: definition.description }));
    return [...PRESETS.filter(item => `${item.title} ${item.description}`.toLocaleLowerCase().includes(search)), ...canonical];
  }, [query]);
  useModalDialog(dialog, true, 'input');
  useEffect(() => setActive(0), [query]);
  useEffect(() => { list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const choose = (item: InsertItem) => { onInsert(item); onClose(); };
  return <dialog ref={dialog} tabIndex={-1} className="workspace-dialog quick-insert-dialog" aria-modal="true" aria-labelledby="quick-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><div><h2 id="quick-title">블록 빠르게 추가</h2><p>이름 또는 사전 설정을 검색하고 Enter로 추가하세요.</p></div><button className="icon-button" aria-label="빠른 추가 닫기" onClick={onClose}><Icon name="close"/></button></div>
    <label className="quick-search"><Icon name="search"/><input ref={input} aria-label="빠른 추가 검색" role="combobox" aria-controls="quick-options" aria-expanded="true" aria-activedescendant={items[active] ? `quick-${items[active].id}` : undefined} maxLength={100} value={query} placeholder="Pi, 빼기, compare…" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(index + 1, items.length - 1)); } if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); } if (event.key === 'Enter' && items[active]) { event.preventDefault(); choose(items[active]); } }}/></label>
    <div ref={list} id="quick-options" className="quick-options" role="listbox" aria-label="추가할 블록">{items.map((item, index) => <button id={`quick-${item.id}`} key={item.id} role="option" aria-selected={index === active} data-index={index} className={index === active ? 'active' : ''} tabIndex={-1} onMouseEnter={() => setActive(index)} onClick={() => choose(item)}><span className={`library-symbol ${blockTone(item.blockType)}`} aria-hidden="true">{BLOCK_SYMBOLS[item.blockType] ?? '·'}</span><span><strong>{item.title}</strong><small>{item.description}</small></span>{item.parameters && <span className="tag">사전 설정</span>}</button>)}{!items.length && <p className="muted-copy">일치하는 블록이 없습니다. 다른 이름으로 검색하세요.</p>}</div>
    <div className="dialog-footnote">↑ ↓ 선택 · Enter 추가 · Esc 닫기 <span>사전 설정은 기존 블록의 값을 채웁니다.</span></div>
  </dialog>;
}
