import { useEffect, useId, useState } from 'react';
import { validateAnySignal, type SignalValue } from '../../../../packages/model/src';

export const STRUCTURED_DRAFT_LIMIT = 300_000;
/** Bound JSON text and lexical depth before parsing; quoted exact integer codes stay strings. */
export function parseBoundedJsonDraft(draft: string, maximum = STRUCTURED_DRAFT_LIMIT): unknown {
  if (!draft.trim() || draft.length > maximum) throw new Error(`JSON은 1~${maximum.toLocaleString('en-US')}자 범위로 입력하세요.`);
  let depth = 0, quoted = false, escaped = false;
  for (const character of draft) {
    if (quoted) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quoted = false; }
    else if (character === '"') quoted = true;
    else if (character === '[' || character === '{') { if (++depth > 40) throw new Error('신호 JSON의 중첩 범위를 확인하세요.'); }
    else if (character === ']' || character === '}') depth -= 1;
  }
  return JSON.parse(draft);
}
export function parseSignalValueDraft(draft: string): SignalValue { return validateAnySignal(parseBoundedJsonDraft(draft)); }

export function JsonTextField({ label, value, maximum = 8_192, onChange, setValidity }: { label: string; value: string; maximum?: number; onChange: (value: string) => void; setValidity: (id: string, invalid: boolean) => void }) {
  const id = useId(), [draft, setDraft] = useState(value), [error, setError] = useState('');
  useEffect(() => { setDraft(value); setError(''); }, [value]);
  useEffect(() => { let invalid = false; try { parseBoundedJsonDraft(draft, maximum); } catch { invalid = true; } setValidity(id, invalid); return () => setValidity(id, false); }, [draft, maximum, id, setValidity]);
  const apply = () => { try { parseBoundedJsonDraft(draft, maximum); setError(''); onChange(draft); } catch (failure) { setError(failure instanceof Error ? failure.message : 'JSON 형식을 확인하세요.'); } };
  return <label className={`field structured-signal-field${error ? ' field-error' : ''}`}><span className="field-label">{label}</span><textarea aria-label={label} maxLength={maximum} value={draft} spellCheck={false} aria-invalid={!!error} onChange={event => setDraft(event.target.value.slice(0, maximum))} onBlur={apply} onKeyDown={event => { if (event.key === 'Escape') { setDraft(value); setError(''); } }}/>{error && <span className="field-message" role="alert">{error}</span>}<span className="field-help">JSON 형식을 확인한 뒤 연결된 포트·자료형 계약을 실행 전에 검사합니다.</span></label>;
}

export function StructuredSignalField({ label, value, onChange, setValidity }: { label: string; value: unknown; onChange: (value: SignalValue) => void; setValidity: (id: string, invalid: boolean) => void }) {
  const id = useId(), [draft, setDraft] = useState(JSON.stringify(value, null, 2)), [error, setError] = useState('');
  useEffect(() => { setDraft(JSON.stringify(value, null, 2)); setError(''); }, [value]);
  useEffect(() => {
    let invalid = false; try { parseSignalValueDraft(draft); } catch { invalid = true; }
    setValidity(id, invalid); return () => setValidity(id, false);
  }, [draft, id, setValidity]);
  const apply = () => { try { const next = parseSignalValueDraft(draft); setError(''); onChange(next); } catch (failure) { setError(failure instanceof Error ? failure.message : '신호 JSON을 확인하세요.'); } };
  return <div className={`field structured-signal-field${error ? ' field-error' : ''}`}>
    <label className="field-label" htmlFor={id}>{label}</label>
    <textarea id={id} aria-label={`${label} 신호 JSON`} value={draft} maxLength={STRUCTURED_DRAFT_LIMIT} spellCheck={false} aria-invalid={!!error} onChange={event => setDraft(event.target.value.slice(0, STRUCTURED_DRAFT_LIMIT))} onBlur={apply} onKeyDown={event => { if (event.key === 'Escape') { setDraft(JSON.stringify(value, null, 2)); setError(''); } }}/>
    <p className="field-help">수치·배열, 자료형 신호, 이름 있는 버스 또는 메시지 묶음을 JSON으로 입력합니다. int64·uint64·고정소수점의 저장 코드는 따옴표로 감싼 정수 문자열로 보존하세요.</p>
    <details><summary>입력 형식 보기</summary><pre>{'{ "kind": "bus", "fields": [\n  { "name": "value", "value": 1 },\n  { "name": "ready", "value": true }\n] }'}</pre><p className="field-help">버스는 단계마다 최대 16개 필드·깊이 8, 메시지 묶음은 최대 64개입니다. 메시지 안에 메시지를 넣을 수 없습니다.</p></details>
    {error && <p className="field-message" role="alert">{error}</p>}
  </div>;
}
