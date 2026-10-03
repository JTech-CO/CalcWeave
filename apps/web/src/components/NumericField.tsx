import { createContext, useContext, useEffect, useId, useState } from 'react';

export const NumericValidityContext = createContext<(id: string, invalid: boolean) => void>(() => {});

export function NumericField({ label, value, onChange, min = -Number.MAX_VALUE, max = Number.MAX_VALUE, suffix, integer = false }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; suffix?: string; integer?: boolean }) {
  const fieldId = useId();
  const setValidity = useContext(NumericValidityContext);
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  useEffect(() => { setDraft(String(value)); setError(''); }, [value]);
  useEffect(() => {
    const number = Number(draft);
    setValidity(fieldId, !draft.trim() || !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number)));
    return () => setValidity(fieldId, false);
  }, [draft, fieldId, setValidity, min, max, integer]);
  const apply = () => {
    const number = Number(draft);
    if (!draft.trim() || !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) { setError(`${min} ~ ${max} 범위의 ${integer ? '정수' : '유한한 수'}를 입력하세요.`); return; }
    setError(''); onChange(number);
  };
  return <label className={`field ${error ? 'field-error' : ''}`}><span className="field-label">{label}</span><span className="number-field"><input type="text" inputMode="decimal" aria-label={label} value={draft} aria-invalid={!!error} onChange={(event) => setDraft(event.target.value.slice(0, 64))} onBlur={apply} onKeyDown={(event) => { if (event.key === 'Enter') { apply(); event.currentTarget.blur(); } if (event.key === 'Escape') { setDraft(String(value)); setError(''); } }} />{suffix && <span>{suffix}</span>}</span>{error && <span className="field-message">{error}</span>}</label>;
}

