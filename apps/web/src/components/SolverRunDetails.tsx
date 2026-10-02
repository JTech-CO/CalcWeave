import { useEffect, useState } from 'react';
import type { CalcModel, RunResult } from '../../../../packages/model/src';
import { formatNumber } from './ResultPlot';

const EVENT_PAGE_SIZE = 100;
const EVENT_LABELS = { crossing: '경계 통과', reset: '초기값 reset', relay: 'Relay 전환' };

export function SolverRunDetails({ result, model }: { result: RunResult; model: CalcModel }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [result]);
  const stats = result.solverStatistics;
  if (!stats) return null;
  const events = result.events ?? [];
  const pages = Math.max(1, Math.ceil(events.length / EVENT_PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  return <section className="solver-run-details" aria-label="solver 실행 기록"><h3>{stats.method.toUpperCase()} 실행 기록</h3><dl className="solver-statistics"><div><dt>수락 스텝</dt><dd>{stats.acceptedSteps.toLocaleString()}</dd></div><div><dt>거절 스텝</dt><dd>{stats.rejectedSteps.toLocaleString()}</dd></div><div><dt>미분 평가</dt><dd>{stats.evaluations.toLocaleString()}</dd></div><div><dt>이벤트</dt><dd>{stats.events.toLocaleString()}</dd></div><div><dt>마지막 내부 간격</dt><dd>{formatNumber(stats.lastStep)} s</dd></div><div><dt>수락 간격 범위</dt><dd>{formatNumber(stats.minAcceptedStep)} ~ {formatNumber(stats.maxAcceptedStep)} s</dd></div></dl>{events.length > 0 && <details className="solver-events"><summary>이벤트 시점 {events.length.toLocaleString()}개 보기</summary><ol start={currentPage * EVENT_PAGE_SIZE + 1}>{events.slice(currentPage * EVENT_PAGE_SIZE, (currentPage + 1) * EVENT_PAGE_SIZE).map((event, index) => <li key={`${currentPage}-${index}`}><span title={`t = ${event.time} s`}>t = {formatNumber(event.time)} s · {EVENT_LABELS[event.kind]}</span><small>{event.nodeIds.map(id => model.nodes.find(node => node.id === id)?.label ?? id).join(' · ')}</small></li>)}</ol>{pages > 1 && <div className="event-pagination"><button className="button" disabled={currentPage === 0} onClick={() => setPage(current => current - 1)}>이전 이벤트</button><span>{currentPage + 1} / {pages}</span><button className="button" disabled={currentPage === pages - 1} onClick={() => setPage(current => current + 1)}>다음 이벤트</button></div>}</details>}</section>;
}
