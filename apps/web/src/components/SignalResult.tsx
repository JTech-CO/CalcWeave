import { useEffect, useMemo, useState } from 'react';
import { describeAnySignal, validateAnySignal, validateDataType, validateTypedSignal, type BusSignal, type MessageSignal, type SignalDescriptor, type SignalValue, type TypedCell, type TypedDataType, type TypedSignal } from '../../../../packages/model/src';
import { formatNumber } from './ResultPlot';

export function signalSummary(value: SignalValue | undefined): string {
  if (value === undefined) return '—';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return String(value);
  if (!Array.isArray(value)) {
    const signal = validateAnySignal(value);
    if (typeof signal === 'object' && !Array.isArray(signal)) {
      if (signal.kind === 'bus') return `버스 · ${signal.fields.length}개 필드`;
      if (signal.kind === 'messages') return `메시지 · ${signal.items.length}개`;
      return signal.shape.length ? `${signal.shape.join(' × ')} · ${signal.data.length}개 값` : typedCellText(signal.data[0]!, signal);
    }
  }
  return Array.isArray(value) ? Array.isArray(value[0]) ? `${value.length} × ${value[0].length}` : `${value.length}개 값` : '—';
}

export function descriptorLabel(descriptor?: SignalDescriptor): string {
  if (!descriptor) return '타입은 실행 전 검사합니다';
  if (descriptor.valueType === 'bus') return `이름 있는 버스 · ${descriptor.bus?.fields.length ?? 0}개 필드`;
  if (descriptor.valueType === 'messages') return `메시지 묶음 · 최대 ${descriptor.message?.maxBatch ?? 64}개 · ${descriptor.message ? descriptorLabel(descriptor.message.payload) : 'payload는 실행 전 검사합니다'}`;
  const shape = descriptor.shape.length === 0 ? '스칼라' : descriptor.shape.length === 1 ? `벡터 [${descriptor.shape[0]}]` : `${descriptor.shape.length}D [${descriptor.shape.join(' × ')}]`;
  return `${descriptor.valueType === 'typed' ? typedTypeLabel(descriptor.typed!) : descriptor.valueType} · ${shape} · ${descriptor.unit === '1' ? '단위 없음' : descriptor.unit}${descriptor.fields ? ` · 필드 ${descriptor.fields.join(', ')}` : ''}`;
}

export function typedTypeLabel(input: TypedDataType): string {
  const type = validateDataType({ dtype: input.dtype, ...(input.fixed ? { fixed: input.fixed } : {}), ...(input.enum ? { enum: input.enum } : {}) });
  return type.dtype === 'fixed' ? `fixed · ${type.fixed!.signed ? 'signed' : 'unsigned'} ${type.fixed!.wordLength}비트 · 소수 ${type.fixed!.fractionLength}비트` : type.dtype === 'enum' ? `enum ${type.enum!.name}` : type.dtype;
}
/** Exact binary-point value text; decimal integer codes never pass through Number. */
export function fixedCellText(code: string, fractionLength: number): string {
  if (typeof code !== 'string' || code.length > 21 || !/^-?(0|[1-9][0-9]*)$/.test(code) || !Number.isSafeInteger(fractionLength) || Math.abs(fractionLength) > 64) throw new Error('고정소수점 표시 범위를 확인하세요.');
  let value = BigInt(code);
  if (fractionLength <= 0) return (value << BigInt(-fractionLength)).toString();
  const negative = value < 0n; if (negative) value = -value;
  const digits = (value * 5n ** BigInt(fractionLength)).toString().padStart(fractionLength + 1, '0');
  const whole = digits.slice(0, -fractionLength), fractional = digits.slice(-fractionLength).replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fractional ? '.' + fractional : ''}`;
}
export function typedCellText(cell: TypedCell, type: TypedDataType): string {
  if (type.dtype === 'complex128' && typeof cell === 'object') return `${cell.re} ${String(cell.im).startsWith('-') ? '− ' + String(cell.im).slice(1) : '+ ' + cell.im}i`;
  if (type.dtype === 'fixed') return `${fixedCellText(cell as string, type.fixed!.fractionLength)} (코드 ${cell})`;
  return String(cell);
}
export function typedCoordinates(index: number, shape: readonly number[]): number[] {
  return shape.map((axis, position) => Math.floor(index / shape.slice(position + 1).reduce((size, sizeAxis) => size * sizeAxis, 1)) % axis);
}

const PAGE_SIZE = 100;
export function SignalResult({ value, label, exact = false, descriptor }: { value: SignalValue; label: string; exact?: boolean; descriptor?: SignalDescriptor }) {
  const [page, setPage] = useState(0);
  const validated = useMemo(() => typeof value === 'object' && !Array.isArray(value) ? validateAnySignal(value) : null, [value]);
  useEffect(() => setPage(0), [value]);
  if (!Array.isArray(value)) {
    if (typeof value !== 'object') return null;
    if (validated === null || typeof validated !== 'object' || Array.isArray(validated)) return null;
    return validated.kind === 'bus' ? <BusSignalResult value={validated} label={label} descriptor={descriptor}/> : validated.kind === 'messages' ? <MessageSignalResult value={validated} label={label} descriptor={descriptor}/> : <TypedSignalResult value={validated} label={label}/>;
  }
  const matrix = Array.isArray(value[0]);
  const columns = matrix ? (value[0] as number[] | boolean[]).length : 1;
  const flat = matrix ? (value as (number[] | boolean[])[]).flat() : value as (number | boolean)[];
  const pages = Math.ceil(flat.length / PAGE_SIZE);
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_SIZE;
  return <div className="signal-result">
    <h3>{label} · 전체 원소</h3>
    <nav className="table-pagination" aria-label={`${label} 원소 페이지`}><button className="button" disabled={current === 0} onClick={() => setPage(current - 1)}>이전 100개</button><span role="status" aria-live="polite">{start + 1}–{Math.min(start + PAGE_SIZE, flat.length)} / {flat.length}개</span><button className="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>다음 100개</button></nav>
    <table><caption>{matrix ? '행·열' : '인덱스'}은 0부터 시작합니다. 행렬은 행 순서로 기록합니다.</caption><thead><tr>{matrix ? <><th scope="col">행</th><th scope="col">열</th></> : <th scope="col">인덱스</th>}<th scope="col">값</th></tr></thead><tbody>{flat.slice(start, start + PAGE_SIZE).map((item, index) => <tr key={start + index}>{matrix ? <><th scope="row">{Math.floor((start + index) / columns)}</th><td>{(start + index) % columns}</td></> : <th scope="row">{start + index}</th>}<td title={String(item)}>{exact || typeof item === 'boolean' ? String(item) : formatNumber(item)}</td></tr>)}</tbody></table>
  </div>;
}

function StructuredLeaf({ value, label, descriptor }: { value: SignalValue; label: string; descriptor?: SignalDescriptor }) {
  const summary = typeof value === 'number' ? String(value) : signalSummary(value);
  return <div className="structured-leaf"><strong className="structured-value">{summary}</strong><small className="result-type">{descriptorLabel(descriptor ?? describeAnySignal(value))}</small><SignalResult value={value} label={label} exact descriptor={descriptor}/></div>;
}

function BusSignalResult({ value, label, descriptor }: { value: BusSignal; label: string; descriptor?: SignalDescriptor }) {
  return <section className="structured-result bus-result" aria-label={`${label} 버스 필드`}><h3>{label} · {value.fields.length}개 필드</h3><p className="sample-detail">필드 순서와 자료형을 보존한 원본 값입니다.</p><div className="bus-fields">{value.fields.map(field => <details className="bus-field" key={field.name} open><summary><strong>{field.name}</strong><span>{signalSummary(field.value)}</span></summary><StructuredLeaf value={field.value} label={`${label} / ${field.name}`} descriptor={descriptor?.bus?.fields.find(item => item.name === field.name)?.descriptor}/></details>)}</div></section>;
}

function MessageSignalResult({ value, label, descriptor }: { value: MessageSignal; label: string; descriptor?: SignalDescriptor }) {
  return <section className="structured-result message-result" aria-label={`${label} 메시지 기록`}><h3>{label} · {value.items.length}개 메시지</h3><p className="sample-detail">이 샘플의 발행 순서·시각·우선순위와 payload를 보존합니다.</p>{value.items.length ? <ol className="message-items">{value.items.map((item, index) => <li key={`${item.producer}-${item.sequence}-${index}`}><dl className="message-metadata"><dt>발행자</dt><dd>{item.producer}</dd><dt>순서</dt><dd>{item.sequence}</dd><dt>시각</dt><dd>{String(item.time)} s</dd><dt>우선순위</dt><dd>{item.priority}</dd></dl><details className="message-payload" open><summary>payload · {signalSummary(item.payload)}</summary><StructuredLeaf value={item.payload} label={`${label} / 메시지 ${index + 1}`} descriptor={descriptor?.message?.payload}/></details></li>)}</ol> : <p className="structured-empty">이 샘플에 메시지가 없습니다.</p>}</section>;
}

function TypedSignalResult({ value, label }: { value: TypedSignal; label: string }) {
  const signal = validateTypedSignal(value), [page, setPage] = useState(0);
  useEffect(() => setPage(0), [value]);
  if (!signal.shape.length) return null;
  const pages = Math.ceil(signal.data.length / PAGE_SIZE), current = Math.min(page, pages - 1), start = current * PAGE_SIZE;
  return <div className="signal-result typed-result">
    <h3>{label} · 전체 원소</h3>
    <nav className="table-pagination" aria-label={`${label} 원소 페이지`}><button className="button" disabled={current === 0} onClick={() => setPage(current - 1)}>이전 100개</button><span role="status" aria-live="polite">{start + 1}–{Math.min(start + PAGE_SIZE, signal.data.length)} / {signal.data.length}개</span><button className="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>다음 100개</button></nav>
    <table><caption>{typedTypeLabel(signal)} · {signal.shape.length}D [{signal.shape.join(' × ')}] · 좌표는 0부터, 마지막 축이 가장 빠르게 바뀝니다.</caption><thead><tr><th scope="col">인덱스</th><th scope="col">좌표</th>{signal.dtype === 'complex128' ? <><th scope="col">실수</th><th scope="col">허수</th></> : <th scope="col">값</th>}</tr></thead><tbody>{signal.data.slice(start, start + PAGE_SIZE).map((cell, position) => <tr key={start + position}><th scope="row">{start + position}</th><td>[{typedCoordinates(start + position, signal.shape).join(', ')}]</td>{signal.dtype === 'complex128' && typeof cell === 'object' ? <><td>{String(cell.re)}</td><td>{String(cell.im)}</td></> : <td title={typedCellText(cell, signal)}>{typedCellText(cell, signal)}</td>}</tr>)}</tbody></table>
  </div>;
}
