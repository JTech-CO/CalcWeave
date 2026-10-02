import { useEffect, useState } from 'react';
import type { RunSample } from '../../../../packages/model/src';
import { formatNumber } from './ResultPlot';
import { signalSummary } from './SignalResult';

const PAGE_SIZE = 100;

export function ResultTable({ samples, outputId, label }: { samples: RunSample[]; outputId: string; label: string }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [samples, outputId]);

  const pageCount = Math.ceil(samples.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(pageCount - 1, 0));
  const start = currentPage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, samples.length);
  const visibleSamples = samples.slice(start, end);
  const totalLabel = samples.length.toLocaleString('ko-KR');

  return <details className="result-table">
    <summary>수치 표 보기 <span>전체 {totalLabel}개 샘플 · 100행씩</span></summary>
    <nav className="table-pagination" aria-label={`${label} 수치 표 페이지`}>
      <button className="button" disabled={currentPage === 0} onClick={() => setPage(Math.max(currentPage - 1, 0))}>이전 100개</button>
      <span className="table-page-status" role="status" aria-live="polite">{samples.length ? `${(start + 1).toLocaleString('ko-KR')}–${end.toLocaleString('ko-KR')} / ${totalLabel}개 샘플 · ${currentPage + 1}/${pageCount} 페이지` : '기록된 샘플 없음'}</span>
      <button className="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(Math.min(currentPage + 1, pageCount - 1))}>다음 100개</button>
    </nav>
    <table>
      <caption>{label} · 실행에 기록된 수치</caption>
      <thead><tr><th scope="col">샘플</th><th scope="col">시간 (s)</th><th scope="col">값</th></tr></thead>
      <tbody>{visibleSamples.length ? visibleSamples.map((sample, index) => {
        const value = sample.values[outputId];
        return <tr key={start + index}>
          <th scope="row">{(start + index + 1).toLocaleString('ko-KR')}</th>
          <td title={String(sample.time)}>{formatNumber(sample.time)}</td>
          <td title={value === undefined ? undefined : JSON.stringify(value)}>{value === undefined ? '기록 없음' : signalSummary(value)}</td>
        </tr>;
      }) : <tr><td colSpan={3}>기록된 샘플이 없습니다.</td></tr>}</tbody>
    </table>
  </details>;
}
