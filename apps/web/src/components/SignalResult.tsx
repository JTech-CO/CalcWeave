import { useEffect, useState } from 'react';
import type { SignalDescriptor, SignalValue } from '../../../../packages/model/src';
import { formatNumber } from './ResultPlot';

export function signalSummary(value: SignalValue | undefined): string {
  if (value === undefined) return '—';
  if (typeof value === 'number') return formatNumber(value);
  if (typeof value === 'boolean') return String(value);
  return Array.isArray(value[0]) ? `${value.length} × ${value[0].length}` : `${value.length}개 값`;
}

export function descriptorLabel(descriptor?: SignalDescriptor): string {
  if (!descriptor) return '타입은 실행 전 검사합니다';
  const shape = descriptor.shape.length === 0 ? '스칼라' : descriptor.shape.length === 1 ? `벡터 [${descriptor.shape[0]}]` : `2D [${descriptor.shape.join(' × ')}]`;
  return `${descriptor.valueType} · ${shape} · ${descriptor.unit === '1' ? '단위 없음' : descriptor.unit}${descriptor.fields ? ` · 필드 ${descriptor.fields.join(', ')}` : ''}`;
}

const PAGE_SIZE = 100;
export function SignalResult({ value, label }: { value: SignalValue; label: string }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [value]);
  if (!Array.isArray(value)) return null;
  const matrix = Array.isArray(value[0]);
  const columns = matrix ? (value[0] as number[] | boolean[]).length : 1;
  const flat = matrix ? (value as (number[] | boolean[])[]).flat() : value as (number | boolean)[];
  const pages = Math.ceil(flat.length / PAGE_SIZE);
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_SIZE;
  return <div className="signal-result">
    <h3>{label} · 전체 원소</h3>
    <nav className="table-pagination" aria-label={`${label} 원소 페이지`}><button className="button" disabled={current === 0} onClick={() => setPage(current - 1)}>이전 100개</button><span role="status" aria-live="polite">{start + 1}–{Math.min(start + PAGE_SIZE, flat.length)} / {flat.length}개</span><button className="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>다음 100개</button></nav>
    <table><caption>{matrix ? '행·열' : '인덱스'}은 0부터 시작합니다. 행렬은 행 순서로 기록합니다.</caption><thead><tr>{matrix ? <><th scope="col">행</th><th scope="col">열</th></> : <th scope="col">인덱스</th>}<th scope="col">값</th></tr></thead><tbody>{flat.slice(start, start + PAGE_SIZE).map((item, index) => <tr key={start + index}>{matrix ? <><th scope="row">{Math.floor((start + index) / columns)}</th><td>{(start + index) % columns}</td></> : <th scope="row">{start + index}</th>}<td title={String(item)}>{typeof item === 'boolean' ? String(item) : formatNumber(item)}</td></tr>)}</tbody></table>
  </div>;
}
