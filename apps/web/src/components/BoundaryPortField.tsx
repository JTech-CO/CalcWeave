import { useEffect, useId, useState } from 'react';
import { validateBoundaryPortId } from '../hierarchy-editor';

export function BoundaryPortField({ value, onChange, setValidity }: { value: string; onChange: (value: string) => void; setValidity: (id: string, invalid: boolean) => void }) {
  const id = useId(), [draft, setDraft] = useState(value), [error, setError] = useState('');
  useEffect(() => { setDraft(value); setError(''); }, [value]);
  useEffect(() => { let invalid = !!error; try { validateBoundaryPortId(draft); } catch { invalid = true; } setValidity(id, invalid); return () => setValidity(id, false); }, [draft, error, id, setValidity]);
  const apply = () => { try { onChange(validateBoundaryPortId(draft)); setError(''); } catch (failure) { setError(failure instanceof Error ? failure.message : '포트 ID를 확인하세요.'); } };
  return <label className={`field${error ? ' field-error' : ''}`}><span className="field-label">경계 포트 ID</span><input aria-label="경계 포트 ID" value={draft} maxLength={64} aria-invalid={!!error} onChange={event => { setDraft(event.target.value.slice(0, 64)); setError(''); }} onBlur={apply} onKeyDown={event => { if (event.key === 'Enter') { apply(); event.currentTarget.blur(); } if (event.key === 'Escape') { setDraft(value); setError(''); } }}/><span className="field-help">공유 정의를 사용하는 연결과 참조 버전을 함께 갱신합니다. 배열 실행의 단일 경계는 in/out으로 지정하세요.</span>{error && <span className="field-message" role="alert">{error}</span>}</label>;
}
