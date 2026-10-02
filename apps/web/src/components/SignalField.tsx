import { useEffect, useId, useMemo, useState } from 'react';
import { validateSignal, type SignalValue } from '../../../../packages/model/src';
import { parseExpression } from '../../../../packages/expression/src';

type ValueForm = 'number' | 'boolean' | 'vector' | 'matrix';
const MAX_DRAFT = 32768;

function valueForm(value: unknown): ValueForm {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return Array.isArray(value[0]) ? 'matrix' : 'vector';
  return 'number';
}

/** UX validation only; model/compiler and Worker independently validate every value. */
function parseDraft(draft: string, form: ValueForm): SignalValue {
  if (draft.length > MAX_DRAFT || !draft.trim()) throw new Error('값을 입력하세요.');
  if (form === 'number') {
    const number = Number(draft);
    if (!Number.isFinite(number)) throw new Error('유한한 숫자를 입력하세요.');
    return number;
  }
  if (form === 'boolean') {
    if (draft !== 'true' && draft !== 'false') throw new Error('true 또는 false를 선택하세요.');
    return draft === 'true';
  }
  let value: unknown;
  try { value = JSON.parse(draft); } catch { throw new Error('대괄호와 쉼표를 사용한 JSON 배열을 입력하세요.'); }
  if (!Array.isArray(value) || value.length === 0) throw new Error('빈 배열은 사용할 수 없습니다.');
  const descriptor = validateSignal(value);
  if (descriptor.shape.length !== (form === 'matrix' ? 2 : 1)) throw new Error(form === 'matrix' ? '2D 배열을 입력하세요.' : '한 줄 벡터를 입력하세요.');
  return value as SignalValue;
}

export function SignalField({ label, value, onChange, setValidity }: { label: string; value: unknown; onChange: (value: SignalValue) => void; setValidity: (id: string, invalid: boolean) => void }) {
  const id = useId();
  const [form, setForm] = useState<ValueForm>(() => valueForm(value));
  const [draft, setDraft] = useState(() => JSON.stringify(value) ?? '');
  const [touched, setTouched] = useState(false);
  useEffect(() => { setForm(valueForm(value)); setDraft(JSON.stringify(value) ?? ''); setTouched(false); }, [value]);
  const validation = useMemo(() => {
    try { return { value: parseDraft(draft, form), error: '' }; }
    catch (error) { return { value: undefined, error: error instanceof Error ? error.message : '값을 확인하세요.' }; }
  }, [draft, form]);
  useEffect(() => { setValidity(id, !!validation.error); return () => setValidity(id, false); }, [id, setValidity, validation.error]);
  const apply = () => { setTouched(true); if (validation.value !== undefined) onChange(validation.value); };
  const changeForm = (next: ValueForm) => {
    const nextValue: SignalValue = next === 'number' ? 1 : next === 'boolean' ? true : next === 'vector' ? [1, 2] : [[1, 2], [3, 4]];
    setForm(next); setDraft(JSON.stringify(nextValue)); setTouched(false); onChange(nextValue);
  };
  const errorId = `${id}-message`;
  return <div className={`field signal-field${touched && validation.error ? ' field-error' : ''}`}>
    <div className="field-label"><label htmlFor={id}>{label}</label><select className="value-form" aria-label={`${label} 유형`} value={form} onChange={event => changeForm(event.target.value as ValueForm)}><option value="number">숫자</option><option value="boolean">boolean</option><option value="vector">벡터</option><option value="matrix">2D 행렬</option></select></div>
    {form === 'boolean' ? <select id={id} aria-label={label} value={draft} onChange={event => { const next = event.target.value; setDraft(next); onChange(next === 'true'); }}><option value="true">true · 참</option><option value="false">false · 거짓</option></select>
      : form === 'number' ? <input id={id} type="text" inputMode="decimal" aria-label={label} value={draft} maxLength={64} aria-invalid={touched && !!validation.error} aria-describedby={validation.error ? errorId : undefined} onChange={event => setDraft(event.target.value.slice(0, 64))} onBlur={apply} onKeyDown={event => { if (event.key === 'Enter') { apply(); event.currentTarget.blur(); } if (event.key === 'Escape') { setDraft(JSON.stringify(value)); setTouched(false); } }}/>
        : <textarea id={id} aria-label={label} value={draft} maxLength={MAX_DRAFT} rows={form === 'matrix' ? 4 : 3} spellCheck={false} aria-invalid={touched && !!validation.error} aria-describedby={errorId} onChange={event => setDraft(event.target.value.slice(0, MAX_DRAFT))} onBlur={apply} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { apply(); event.currentTarget.blur(); event.stopPropagation(); } if (event.key === 'Escape') { setDraft(JSON.stringify(value)); setTouched(false); } }}/>} 
    <span className={touched && validation.error ? 'field-message' : 'field-help'} id={errorId}>{touched && validation.error ? validation.error : form === 'vector' ? '[1, 2, 3] 또는 [true, false] · 최대 1,024개' : form === 'matrix' ? '[[1, 2], [3, 4]] · 같은 길이의 행 · 최대 1,024개' : '숫자와 boolean은 자동 변환되지 않습니다.'}</span>
  </div>;
}

export function ExpressionField({ label, value, maxLength = 512, onChange, setValidity }: { label: string; value: string; maxLength?: number; onChange: (value: string) => void; setValidity: (id: string, invalid: boolean) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [touched, setTouched] = useState(false);
  useEffect(() => setDraft(value), [value]);
  const error = useMemo(() => { try { parseExpression(draft); return ''; } catch (failure) { return failure instanceof Error ? failure.message : '수식을 확인하세요.'; } }, [draft]);
  useEffect(() => { setValidity(id, !!error); return () => setValidity(id, false); }, [error, id, setValidity]);
  return <label className={`field${touched && error ? ' field-error' : ''}`}><span className="field-label">{label}</span><textarea aria-label={label} rows={3} value={draft} maxLength={maxLength} spellCheck={false} aria-invalid={touched && !!error} onChange={event => setDraft(event.target.value.slice(0, maxLength))} onBlur={() => { setTouched(true); if (!error) onChange(draft); }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.currentTarget.blur(); event.stopPropagation(); } if (event.key === 'Escape') { setDraft(value); setTouched(false); } }}/><span className={touched && error ? 'field-message' : 'field-help'}>{touched && error ? error : `x는 입력의 각 값입니다. + − * / ^, pi, e, abs·sqrt·sin·cos·log 등의 허용 함수만 사용합니다. 최대 ${maxLength}자.`}</span></label>;
}

/** Coefficients and roots use numeric JSON vectors, including explicitly permitted empty vectors. */
export function NumericVectorField({ label, value, minLength = 0, maxLength = 16, onChange, setValidity }: { label: string; value: unknown; minLength?: number; maxLength?: number; onChange: (value: number[]) => void; setValidity: (id: string, invalid: boolean) => void }) {
  const id = useId();
  const [draft, setDraft] = useState(() => JSON.stringify(value) ?? '');
  const [touched, setTouched] = useState(false);
  useEffect(() => { setDraft(JSON.stringify(value) ?? ''); setTouched(false); }, [value]);
  const validation = useMemo(() => {
    try {
      if (draft.length > MAX_DRAFT) throw new Error('벡터 입력이 너무 깁니다.');
      const parsed: unknown = JSON.parse(draft);
      if (!Array.isArray(parsed) || parsed.length < minLength || parsed.length > maxLength || parsed.some(entry => typeof entry !== 'number' || !Number.isFinite(entry))) throw new Error(`${minLength} ~ ${maxLength}개의 유한한 숫자로 구성된 한 줄 JSON 벡터를 입력하세요.`);
      return { value: parsed as number[], error: '' };
    } catch (error) { return { value: undefined, error: error instanceof Error ? error.message : '벡터를 확인하세요.' }; }
  }, [draft, minLength, maxLength]);
  useEffect(() => { setValidity(id, !!validation.error); return () => setValidity(id, false); }, [id, setValidity, validation.error]);
  const apply = () => { setTouched(true); if (validation.value !== undefined) onChange(validation.value); };
  return <label className={`field${touched && validation.error ? ' field-error' : ''}`}><span className="field-label">{label}</span><textarea aria-label={label} value={draft} maxLength={MAX_DRAFT} rows={3} spellCheck={false} aria-invalid={touched && !!validation.error} onChange={event => setDraft(event.target.value.slice(0, MAX_DRAFT))} onBlur={apply} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { apply(); event.currentTarget.blur(); event.stopPropagation(); } if (event.key === 'Escape') { setDraft(JSON.stringify(value)); setTouched(false); } }}/><span className={touched && validation.error ? 'field-message' : 'field-help'}>{touched && validation.error ? validation.error : `한 줄 JSON 벡터 · ${minLength} ~ ${maxLength}개${minLength === 0 ? ' · 빈 벡터 [] 허용' : ''}`}</span></label>;
}
