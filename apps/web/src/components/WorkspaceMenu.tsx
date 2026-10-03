import { useCallback, useEffect, useRef } from 'react';
import { Icon } from './Icon';
import './WorkspaceMenu.css';

export function WorkspaceMenu({ onManage, onPackage }: { onManage: () => void; onPackage: () => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const advanced = useRef<HTMLDetailsElement>(null);
  const position = useCallback(() => {
    const bounds = trigger.current?.getBoundingClientRect();
    if (bounds) {
      const width = Math.min(304, window.innerWidth - 16);
      const left = Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8));
      menu.current?.style.setProperty('--workspace-menu-top', `${bounds.bottom + 8}px`);
      menu.current?.style.setProperty('--workspace-menu-left', `${left}px`);
    }
  }, []);
  const close = useCallback(() => {
    if (menu.current) menu.current.open = false;
    if (advanced.current) advanced.current.open = false;
  }, []);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [close, position]);

  const act = (action: () => void) => {
    close();
    // The modal captures this visible trigger and restores focus here on close.
    trigger.current?.focus({ preventScroll: true });
    action();
  };

  return <details ref={menu} className="workspace-menu" onToggle={event => {
    if (event.currentTarget.open) position();
    else if (advanced.current) advanced.current.open = false;
  }} onBlur={event => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) close();
  }} onKeyDown={event => {
    if (event.key === 'Escape' && menu.current?.open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.current?.focus({ preventScroll: true });
    }
  }}>
    <summary ref={trigger} className="icon-button workspace-menu-trigger" aria-label="작업 공간" title="백업·복구와 고급 파일" onClick={position}><Icon name="sliders"/></summary>
    <div className="workspace-menu-panel">
      <button type="button" className="workspace-menu-action" onClick={() => act(onManage)}><Icon name="download"/><span>백업·복구</span></button>
      <p>도식과 데이터의 일반 전달은 모델 다운로드·가져오기를 사용하세요.</p>
      <details ref={advanced} className="workspace-menu-advanced">
        <summary>고급 파일<Icon name="chevron-down" size={16}/></summary>
        <button type="button" className="workspace-menu-action" aria-label="모델 패키지 공유" onClick={() => act(onPackage)}><Icon name="link"/><span>서명된 모델 패키지</span></button>
      </details>
    </div>
  </details>;
}
