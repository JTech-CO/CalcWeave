import { useEffect, useRef, type ReactNode, type RefObject } from 'react';

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

/** Keep native modal semantics, with explicit background isolation and focus restoration. */
export function useModalDialog(ref: RefObject<HTMLDialogElement | null>, open: boolean, initialFocus?: string) {
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const siblings = [...(dialog.closest('.app-shell')?.children ?? [])].filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(dialog));
    const saved = siblings.map(element => ({ element, inert: element.inert, hidden: element.getAttribute('aria-hidden') }));
    saved.forEach(({ element }) => { element.inert = true; element.setAttribute('aria-hidden', 'true'); });
    if (!dialog.open) dialog.showModal();
    const focusables = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(element => element.tabIndex >= 0 && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0);
    const preferred = initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) : null;
    (preferred ?? focusables()[0] ?? dialog).focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = focusables(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', keydown);
    return () => {
      dialog.removeEventListener('keydown', keydown);
      if (dialog.open) dialog.close();
      saved.forEach(({ element, inert, hidden }) => { element.inert = inert; if (hidden === null) element.removeAttribute('aria-hidden'); else element.setAttribute('aria-hidden', hidden); });
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
      else document.querySelector<HTMLElement>('.react-flow')?.focus({ preventScroll: true });
    };
  }, [ref, open, initialFocus]);
}

export function ModalDialog({ labelId, className = '', initialFocus, onClose, children }: { labelId: string; className?: string; initialFocus?: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(ref, true, initialFocus);
  return <dialog ref={ref} tabIndex={-1} className={`workspace-dialog ${className}`} aria-modal="true" aria-labelledby={labelId} onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>;
}
