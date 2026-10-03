import { useEffect, useId, useMemo, useState } from 'react';
import { encodeTypedFloat, isIntegerDataType, TYPED_LIMITS, validateDataType, validateTypedShape, validateTypedSignal, type TypedCell, type TypedDataType, type TypedDType, type TypedFloat, type TypedSignal } from '../../../../packages/model/src';

export const TYPED_DRAFT_LIMIT = 300_000;
const DTYPES: readonly TypedDType[] = ['float64', 'float32', 'boolean', 'int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'complex128', 'fixed', 'string', 'enum'];
export interface DataTypeDraft { dtype: TypedDType; signed: boolean; wordLength: string; fractionLength: string; enumName: string; enumLabels: string }
export function dataTypeDraft(value: unknown): DataTypeDraft {
  let type: TypedDataType;
  try { type = validateDataType(value); } catch { const signal = validateTypedSignal(value); type = { dtype: signal.dtype, ...(signal.fixed ? { fixed: signal.fixed } : {}), ...(signal.enum ? { enum: signal.enum } : {}) }; }
  return { dtype: type.dtype, signed: type.fixed?.signed ?? true, wordLength: String(type.fixed?.wordLength ?? 16), fractionLength: String(type.fixed?.fractionLength ?? 8), enumName: type.enum?.name ?? 'Mode', enumLabels: JSON.stringify(type.enum?.labels ?? ['Off', 'On']) };
}
export function parseDataTypeDraft(draft: DataTypeDraft): TypedDataType {
  if (!DTYPES.includes(draft.dtype)) throw new Error('자료형을 선택하세요.');
  if (draft.dtype === 'fixed') {
    if (!/^[0-9]{1,2}$/.test(draft.wordLength) || !/^-?[0-9]{1,2}$/.test(draft.fractionLength)) throw new Error('비트 폭은 1~64, 소수 비트 수는 −64~64의 정수입니다.');
    return validateDataType({ dtype: draft.dtype, fixed: { signed: draft.signed, wordLength: Number(draft.wordLength), fractionLength: Number(draft.fractionLength) } });
  }
  if (draft.dtype === 'enum') {
    if (draft.enumLabels.length > 4_500 || draft.enumName.length > TYPED_LIMITS.maxEnumNameLength) throw new Error('열거 선언의 크기 상한을 초과했습니다.');
    return validateDataType({ dtype: draft.dtype, enum: { name: draft.enumName, labels: JSON.parse(draft.enumLabels) } });
  }
  return validateDataType({ dtype: draft.dtype });
}
function floatDraft(text: string, single = false): TypedFloat {
  const value = text.trim();
  if (['-0', 'NaN', 'Infinity', '-Infinity'].includes(value)) return value as TypedFloat;
  if (value.length > 64 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) throw new Error('숫자 또는 -0, NaN, Infinity, -Infinity를 입력하세요.');
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error('범위를 벗어난 숫자는 Infinity 태그로 명시하세요.');
  return encodeTypedFloat(single ? Math.fround(number) : number);
}
function checkedFloat(value: unknown, single: boolean): TypedFloat {
  if (typeof value === 'number' && Number.isFinite(value)) return encodeTypedFloat(single ? Math.fround(value) : value);
  if (typeof value === 'string' && ['-0', 'NaN', 'Infinity', '-Infinity'].includes(value)) return value as TypedFloat;
  throw new Error('IEEE 배열에는 숫자와 명시 특수값 태그만 사용할 수 있습니다.');
}
/** Exact decimal codes are never parsed through Number, including unquoted array input. */
function integerArray(text: string): string[] {
  const value = text.trim();
  if (!value.startsWith('[') || !value.endsWith(']')) throw new Error('저장 코드의 한 줄 배열을 입력하세요.');
  const body = value.slice(1, -1).trim();
  const entries = body ? body.split(',') : [];
  if (entries.length > TYPED_LIMITS.maxElements) throw new Error('원소는 최대 1,024개입니다.');
  return entries.map(entry => {
    const token = entry.trim(), code = token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token;
    if (code.length > 21 || !/^-?(0|[1-9][0-9]*)$/.test(code) || code === '-0') throw new Error('정수 저장 코드는 선행 0 없는 십진 정수입니다.');
    return code;
  });
}
export function parseTypedSignalDraft(typeInput: TypedDataType, shapeDraft: string, valueDraft: string, imaginaryDraft = '0'): TypedSignal {
  const type = validateDataType(typeInput);
  if (shapeDraft.length > 64 || valueDraft.length > TYPED_DRAFT_LIMIT || imaginaryDraft.length > 64) throw new Error('입력 크기 상한을 초과했습니다.');
  const shape = validateTypedShape(JSON.parse(shapeDraft));
  let data: TypedCell[];
  if (shape.length) {
    if (type.dtype === 'fixed' || isIntegerDataType(type)) data = integerArray(valueDraft);
    else {
      // Only a flat array, or flat complex pairs, is useful here. Bound parser nesting first.
      let depth = 0, quoted = false, escaped = false;
      for (const char of valueDraft) {
        if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
        else if (char === '"') quoted = true;
        else if (char === '[' || char === '{') { if (++depth > (type.dtype === 'complex128' ? 2 : 1)) throw new Error('중첩 배열 대신 행 순서의 한 줄 배열을 입력하세요.'); }
        else if (char === ']' || char === '}') depth--;
      }
      const parsed: unknown = JSON.parse(valueDraft);
      if (!Array.isArray(parsed) || parsed.length > TYPED_LIMITS.maxElements) throw new Error('최대 1,024개 원소의 한 줄 배열을 입력하세요.');
      data = type.dtype === 'float64' || type.dtype === 'float32' ? parsed.map(item => checkedFloat(item, type.dtype === 'float32')) : type.dtype === 'complex128' ? parsed.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('복소수는 re와 im을 가진 값입니다.');
        return { ...item, re: checkedFloat(item.re, false), im: checkedFloat(item.im, false) };
      }) : parsed;
    }
  } else if (type.dtype === 'float64' || type.dtype === 'float32') data = [floatDraft(valueDraft, type.dtype === 'float32')];
  else if (type.dtype === 'complex128') data = [{ re: floatDraft(valueDraft), im: floatDraft(imaginaryDraft) }];
  else if (type.dtype === 'boolean') { if (valueDraft !== 'true' && valueDraft !== 'false') throw new Error('true 또는 false를 선택하세요.'); data = [valueDraft === 'true']; }
  else data = [valueDraft];
  return validateTypedSignal({ kind: 'typed', ...type, shape, data });
}
function valueDraft(value: TypedSignal): { real: string; imaginary: string } {
  if (value.shape.length) return { real: JSON.stringify(value.data), imaginary: '0' };
  const cell = value.data[0]!;
  if (value.dtype === 'complex128' && typeof cell === 'object') return { real: String(cell.re), imaginary: String(cell.im) };
  return { real: String(cell), imaginary: '0' };
}
function defaultSignal(type: TypedDataType): TypedSignal {
  const cell: TypedCell = type.dtype === 'boolean' ? false : type.dtype === 'complex128' ? { re: 0, im: 0 } : type.dtype === 'enum' ? type.enum!.labels[0]! : type.dtype === 'string' ? '' : type.dtype === 'fixed' || isIntegerDataType(type) ? '0' : 0;
  return validateTypedSignal({ kind: 'typed', ...type, shape: [], data: [cell] });
}
function TypeControls({ label, id, draft, change, changeType, apply }: { label: string; id: string; draft: DataTypeDraft; change: (draft: DataTypeDraft) => void; changeType: (dtype: TypedDType) => void; apply: () => void }) {
  return <>
    <label className="field-label" htmlFor={`${id}-dtype`}>자료형</label><select id={`${id}-dtype`} aria-label={`${label} 자료형`} value={draft.dtype} onChange={event => changeType(event.target.value as TypedDType)}>{DTYPES.map(dtype => <option key={dtype} value={dtype}>{dtype}</option>)}</select>
    {draft.dtype === 'fixed' && <div className="field-grid">
      <label className="field"><span className="field-label">부호</span><select aria-label={`${label} 부호`} value={draft.signed ? 'signed' : 'unsigned'} onChange={event => change({ ...draft, signed: event.target.value === 'signed' })} onBlur={apply}><option value="signed">부호 있음</option><option value="unsigned">부호 없음</option></select></label>
      <label className="field"><span className="field-label">비트 폭</span><input type="text" inputMode="numeric" aria-label={`${label} 비트 폭`} maxLength={2} value={draft.wordLength} onChange={event => change({ ...draft, wordLength: event.target.value.slice(0, 2) })} onBlur={apply}/></label>
      <label className="field"><span className="field-label">소수 비트 수</span><input type="text" inputMode="numeric" aria-label={`${label} 소수 비트 수`} maxLength={3} value={draft.fractionLength} onChange={event => change({ ...draft, fractionLength: event.target.value.slice(0, 3) })} onBlur={apply}/></label>
    </div>}
    {draft.dtype === 'enum' && <>
      <label className="field"><span className="field-label">열거 이름</span><input aria-label={`${label} 열거 이름`} maxLength={64} value={draft.enumName} onChange={event => change({ ...draft, enumName: event.target.value.slice(0, 64) })} onBlur={apply}/></label>
      <label className="field"><span className="field-label">허용 값 목록</span><textarea aria-label={`${label} 허용 값 목록`} rows={3} maxLength={4_500} spellCheck={false} value={draft.enumLabels} onChange={event => change({ ...draft, enumLabels: event.target.value.slice(0, 4_500) })} onBlur={apply}/></label>
      <span className="field-help">["Off", "On"]처럼 입력하세요. 중복 없는 값 최대 64개 · 값마다 64자.</span>
    </>}
  </>;
}
type Validity = (id: string, invalid: boolean) => void;
export function TypedDataTypeField({ label, value, onChange, setValidity }: { label: string; value: unknown; onChange: (value: TypedDataType) => void; setValidity: Validity }) {
  const id = useId(), [draft, setDraft] = useState(() => dataTypeDraft(value)), [touched, setTouched] = useState(false);
  useEffect(() => { setDraft(dataTypeDraft(value)); setTouched(false); }, [value]);
  const validation = useMemo(() => { try { return { value: parseDataTypeDraft(draft), error: '' }; } catch (error) { return { value: undefined, error: error instanceof Error ? error.message : '자료형 설정을 확인하세요.' }; } }, [draft]);
  useEffect(() => { setValidity(id, !!validation.error); return () => setValidity(id, false); }, [id, setValidity, validation.error]);
  const apply = () => { setTouched(true); if (validation.value) onChange(validation.value); };
  return <div className={`field typed-field${touched && validation.error ? ' field-error' : ''}`}><span className="field-label">{label}</span><TypeControls label={label} id={id} draft={draft} change={setDraft} changeType={dtype => { const next = { ...draft, dtype }; setDraft(next); setTouched(true); try { onChange(parseDataTypeDraft(next)); } catch { /* Keep invalid metadata as a draft. */ } }} apply={apply}/><span className={touched && validation.error ? 'field-message' : 'field-help'} role={touched && validation.error ? 'alert' : undefined}>{touched && validation.error ? validation.error : '자료형은 명시적으로 선택합니다. 고정소수점은 저장 코드 × 2^(−소수 비트 수)입니다.'}</span></div>;
}
export function TypedSignalField({ label, value, onChange, setValidity }: { label: string; value: unknown; onChange: (value: TypedSignal) => void; setValidity: Validity }) {
  const initial = validateTypedSignal(value), id = useId();
  const [type, setType] = useState(() => dataTypeDraft(initial)), [shape, setShape] = useState(() => JSON.stringify(initial.shape)), [real, setReal] = useState(() => valueDraft(initial).real), [imaginary, setImaginary] = useState(() => valueDraft(initial).imaginary), [touched, setTouched] = useState(false);
  useEffect(() => { const next = validateTypedSignal(value), values = valueDraft(next); setType(dataTypeDraft(next)); setShape(JSON.stringify(next.shape)); setReal(values.real); setImaginary(values.imaginary); setTouched(false); }, [value]);
  const validation = useMemo(() => { try { return { value: parseTypedSignalDraft(parseDataTypeDraft(type), shape, real, imaginary), error: '' }; } catch (error) { return { value: undefined, error: error instanceof Error ? error.message : '자료형 값을 확인하세요.' }; } }, [type, shape, real, imaginary]);
  useEffect(() => { setValidity(id, !!validation.error); return () => setValidity(id, false); }, [id, setValidity, validation.error]);
  const apply = () => { setTouched(true); if (validation.value) onChange(validation.value); };
  let scalar = false; try { scalar = validateTypedShape(JSON.parse(shape)).length === 0; } catch { /* Show the array draft while shape is incomplete. */ }
  const errorId = `${id}-message`, invalid = touched && !!validation.error;
  const scalarLimit = type.dtype === 'string' ? 256 : type.dtype === 'enum' ? 64 : type.dtype === 'fixed' || isIntegerDataType({ dtype: type.dtype }) ? 21 : 64;
  const text = (part: 'real' | 'imaginary', partLabel: string) => <label className="field"><span className="field-label">{part === 'imaginary' ? '허수' : type.dtype === 'complex128' ? '실수' : '값'}</span><input type="text" inputMode={type.dtype === 'string' || type.dtype === 'enum' ? 'text' : 'decimal'} aria-label={partLabel} value={part === 'real' ? real : imaginary} maxLength={scalarLimit} aria-invalid={invalid} aria-describedby={errorId} onChange={event => part === 'real' ? setReal(event.target.value.slice(0, scalarLimit)) : setImaginary(event.target.value.slice(0, 64))} onBlur={apply} onKeyDown={event => { if (event.key === 'Enter') { apply(); event.currentTarget.blur(); event.stopPropagation(); } if (event.key === 'Escape') { const values = valueDraft(validateTypedSignal(value)); setReal(values.real); setImaginary(values.imaginary); setTouched(false); } }}/></label>;
  return <div className={`field typed-field${invalid ? ' field-error' : ''}`}>
    <span className="field-label">{label}</span><TypeControls label={label} id={id} draft={type} change={setType} changeType={dtype => { const next = { ...type, dtype }; setType(next); setTouched(true); try { const signal = defaultSignal(parseDataTypeDraft(next)), values = valueDraft(signal); setShape('[]'); setReal(values.real); setImaginary(values.imaginary); onChange(signal); } catch { /* Invalid metadata stays editable and never commits. */ } }} apply={apply}/>
    <span className="field-help">자료형을 바꾸면 값과 형상을 초기화합니다.</span>
    <label className="field"><span className="field-label">형상</span><input aria-label={`${label} 형상`} type="text" maxLength={64} value={shape} aria-invalid={invalid} aria-describedby={errorId} onChange={event => setShape(event.target.value.slice(0, 64))} onBlur={apply}/><span className="field-help">[] 스칼라 · [3] 벡터 · [2, 3] 행렬 · 최대 8개 축, 1,024개 원소</span></label>
    {scalar ? type.dtype === 'boolean' ? <label className="field"><span className="field-label">값</span><select aria-label={`${label} 값`} value={real} onChange={event => { setReal(event.target.value); setTouched(false); try { onChange(parseTypedSignalDraft(parseDataTypeDraft(type), shape, event.target.value)); } catch { setTouched(true); } }}><option value="true">true · 참</option><option value="false">false · 거짓</option></select></label> : type.dtype === 'complex128' ? <div className="field-grid">{text('real', `${label} 실수`)}{text('imaginary', `${label} 허수`)}</div> : text('real', `${label} 값`)
      : <label className="field"><span className="field-label">행 순서의 전체 값</span><textarea aria-label={`${label} 전체 값`} value={real} rows={4} maxLength={TYPED_DRAFT_LIMIT} spellCheck={false} aria-invalid={invalid} aria-describedby={errorId} onChange={event => setReal(event.target.value.slice(0, TYPED_DRAFT_LIMIT))} onBlur={apply} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { apply(); event.currentTarget.blur(); event.stopPropagation(); } if (event.key === 'Escape') { setReal(valueDraft(validateTypedSignal(value)).real); setTouched(false); } }}/></label>}
    <span id={errorId} className={invalid ? 'field-message' : 'field-help'} role={invalid ? 'alert' : undefined}>{invalid ? validation.error : type.dtype === 'fixed' ? '정확한 십진 저장 코드를 입력하세요. 실세계 값 = 코드 × 2^(−소수 비트 수).' : isIntegerDataType({ dtype: type.dtype }) ? '정확한 십진 정수 · 64비트 정수도 자릿수를 보존합니다.' : type.dtype === 'complex128' ? '실수·허수 성분 또는 [{"re":1,"im":2}] · 특수값은 명시 태그로 입력하세요.' : type.dtype === 'float32' ? '입력은 binary32로 반올림해 저장합니다. 배열 특수값은 "NaN", "Infinity", "-Infinity", "-0".' : type.dtype === 'float64' ? '숫자 또는 NaN, Infinity, -Infinity, -0 · 배열의 특수값은 따옴표로 감싸세요.' : type.dtype === 'boolean' ? 'true와 false · 숫자를 자동 변환하지 않습니다.' : '문자열은 원소마다 최대 256자 · 배열 문자열은 따옴표로 감싸세요.'}</span>
  </div>;
}
