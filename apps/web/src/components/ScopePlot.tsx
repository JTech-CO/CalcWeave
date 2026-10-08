import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { nearestScopeSamples, normalizeScopeCoordinate, prepareScopeObservation, type ScopeObservationRun } from '../../../../packages/analysis/src/scope-observation';
import { formatNumber } from './ResultPlot';
import './ScopePlot.css';

const STATUS_LABELS = { completed: '완료', cancelled: '취소 · 부분 기록', failed: '실패 · 부분 기록' };
const curveColor = (index: number) => `var(--scope-curve-${index + 1})`;
const atFraction = (start: number, end: number, fraction: number) => start * (1 - fraction) + end * fraction;
const snapshotIds = new WeakMap<object, number>();
let nextSnapshotId = 1;
function snapshotId(samples: ScopeObservationRun['samples']): number {
  let id = snapshotIds.get(samples);
  if (id === undefined) { id = nextSnapshotId++; snapshotIds.set(samples, id); }
  return id;
}

/** A viewing window and cursor over recorded samples; never modifies execution settings. */
export function ScopePlot({ series, outputId, label }: { series: ScopeObservationRun[]; outputId: string; label: string }) {
  const [component, setComponent] = useState(0);
  const [window, setWindow] = useState<{ start: number; end: number } | undefined>();
  const [cursor, setCursor] = useState<number | null>(null);
  const [startDraft, setStartDraft] = useState(''), [endDraft, setEndDraft] = useState(''), [cursorDraft, setCursorDraft] = useState('');
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);
  const pointer = useRef<{ id: number; clientX: number; start: number } | null>(null);
  const identity = `${outputId}|${series.map(run => `${run.id}:${snapshotId(run.samples)}`).join('|')}`;
  useEffect(() => { setComponent(0); setWindow(undefined); setCursor(null); setError(''); setDrag(null); pointer.current = null; }, [identity]);
  const report = useMemo(() => prepareScopeObservation(series, outputId, component, window), [series, outputId, component, window]);
  useEffect(() => { setStartDraft(String(report.window.start)); setEndDraft(String(report.window.end)); }, [report.window.start, report.window.end]);
  useEffect(() => { setCursorDraft(cursor === null ? '' : String(cursor)); }, [cursor]);
  const readings = useMemo(() => cursor === null ? [] : nearestScopeSamples(report, cursor), [report, cursor]);
  const x = (time: number) => 10 + normalizeScopeCoordinate(time, report.window.start, report.window.end) * 680;
  const y = (value: number) => 122 - normalizeScopeCoordinate(value, report.yDomain.minimum, report.yDomain.maximum) * 114;
  const coordinateTime = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, ((event.clientX - bounds.left) / bounds.width * 700 - 10) / 680));
    return atFraction(report.window.start, report.window.end, fraction);
  };
  const down = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 || report.status !== 'ready') return;
    event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
    const time = coordinateTime(event); pointer.current = { id: event.pointerId, clientX: event.clientX, start: time }; setDrag({ start: time, end: time });
  };
  const move = (event: PointerEvent<SVGSVGElement>) => {
    if (pointer.current?.id !== event.pointerId) return;
    setDrag({ start: pointer.current.start, end: coordinateTime(event) });
  };
  const up = (event: PointerEvent<SVGSVGElement>) => {
    const active = pointer.current;
    if (!active || active.id !== event.pointerId) return;
    const time = coordinateTime(event);
    pointer.current = null; setDrag(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (Math.abs(event.clientX - active.clientX) >= 5 && active.start !== time) {
      const start = Math.min(active.start, time), end = Math.max(active.start, time);
      setWindow({ start, end }); setCursor(null); setError('');
    } else { setCursor(time); setError(''); }
  };
  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || report.status !== 'ready') return;
    const reference = report.curves.find(curve => curve.visiblePoints.length > 0);
    const points = reference?.visiblePoints ?? [];
    if (!points.length) return;
    event.preventDefault();
    if (event.key === 'Home') setCursor(points[0].time);
    else if (event.key === 'End') setCursor(points.at(-1)!.time);
    else {
      const nearest = cursor === null ? undefined : nearestScopeSamples(report, cursor).find(sample => sample.runId === reference?.id);
      const index = nearest ? points.findIndex(point => point.sampleIndex === nearest.sampleIndex) : -1;
      const next = cursor === null ? event.key === 'ArrowRight' ? 0 : points.length - 1 : Math.max(0, Math.min(points.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)));
      setCursor(points[next].time);
    }
  };
  const applyWindow = () => {
    const start = Number(startDraft), end = Number(endDraft);
    if (!startDraft.trim() || !endDraft.trim() || !Number.isFinite(start) || !Number.isFinite(end) || start < report.domain.start || end > report.domain.end || start > end || start === end && report.domain.start !== report.domain.end) {
      setError(`보기 구간은 ${formatNumber(report.domain.start)} ~ ${formatNumber(report.domain.end)}초 안에서 시작보다 끝이 커야 합니다.`); return;
    }
    setWindow(report.domain.start === report.domain.end ? undefined : { start, end }); setCursor(null); setError('');
  };
  const applyCursor = () => {
    const time = Number(cursorDraft);
    if (!cursorDraft.trim() || !Number.isFinite(time) || time < report.window.start || time > report.window.end) { setError('시간 커서는 현재 보기 구간 안의 유한한 수를 입력하세요.'); return; }
    setCursor(time); setError('');
  };
  const incomplete = report.curves.some(curve => curve.status && curve.status !== 'completed');
  return <section className="scope-observation" aria-label={`${label} Scope 관측`} data-testid="scope-observation">
    {report.status !== 'ready' ? <p className="plot-empty" role="status">{report.diagnostics.join(' ') || '표시할 수치 결과가 없습니다.'}</p> : <>
      <div className="scope-observation-heading">
        {report.shape.length > 0 && <label className="scope-component"><span>성분</span><select aria-label="그래프 성분" value={component} onChange={event => { setComponent(Number(event.target.value)); setCursor(null); setError(''); }}>{report.components.map(item => <option key={item.index} value={item.index}>{item.label}</option>)}</select></label>}
        <span className="scope-unit">{report.unit === '1' ? '단위 없음' : report.unit}</span>
      </div>
      <ul className="scope-legend" aria-label="곡선 목록">{report.curves.map((curve, index) => <li key={curve.id}><i style={{ background: curveColor(index) }} aria-hidden="true"/><span>{curve.label}</span>{curve.status && <small>{STATUS_LABELS[curve.status]}</small>}</li>)}</ul>
      {incomplete && <p className="scope-note">취소·실패한 실행은 기록된 구간만 표시합니다.</p>}
      {report.diagnostics.length > 0 && <p className="scope-note" role="status">{report.diagnostics.join(' ')}</p>}
      {report.curves.some(curve => curve.visiblePoints.some(point => point.value === null)) && <p className="scope-note">NaN·무한대는 곡선을 끊어 표시합니다. 커서와 원본 표에서 값을 확인하세요.</p>}
      {report.curves.some(curve => curve.approximate) && <p className="typed-plot-note">곡선은 float64 시각화 근삿값입니다. 커서의 원본 값과 저장 코드는 계산 결과 그대로 보존합니다.</p>}
      <div className="plot-frame scope-plot-frame">
        <div className="plot-y-labels" aria-hidden="true"><span>{formatNumber(report.yDomain.maximum)}</span><span>{formatNumber(report.yDomain.minimum)}</span></div>
        <svg className="result-plot scope-interactive-plot" viewBox="0 0 700 140" preserveAspectRatio="none" role="img" tabIndex={0} aria-label={`${label} 시간 그래프. 시작 ${formatNumber(report.window.start)}, 종료 ${formatNumber(report.window.end)}, 최소 ${formatNumber(report.yDomain.minimum)}, 최대 ${formatNumber(report.yDomain.maximum)}. 클릭하면 가장 가까운 원시 샘플을 읽고 드래그하면 구간을 확대합니다. 방향키로 샘플을 이동합니다.`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { pointer.current = null; setDrag(null); }} onKeyDown={key}>
          {[8, 46, 84, 122].map(gridY => <line key={gridY} x1="10" x2="690" y1={gridY} y2={gridY} className="plot-grid"/>)}
          {report.curves.map((curve, index) => {
            let connected = false;
            const path = curve.visiblePoints.map(point => {
              if (point.value === null) { connected = false; return ''; }
              const command = connected ? 'L' : 'M'; connected = true;
              return `${command}${x(point.time).toFixed(2)},${y(point.value).toFixed(2)}`;
            }).join(' ');
            const isolated = curve.visiblePoints.filter((point, pointIndex, points) => point.value !== null && (pointIndex === 0 || points[pointIndex - 1].value === null) && (pointIndex === points.length - 1 || points[pointIndex + 1].value === null));
            return <g key={curve.id}><path d={path} data-sample-count={curve.visiblePoints.length} fill="none" stroke={index === 0 ? 'var(--accent)' : curveColor(index)} strokeDasharray={index === 1 ? '8 4' : index === 2 ? '2 4' : undefined} strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>{isolated.map(point => <circle key={point.sampleIndex} cx={x(point.time)} cy={y(point.value!)} r="4" fill={curveColor(index)}/>)}</g>;
          })}
          {cursor !== null && cursor >= report.window.start && cursor <= report.window.end && <line x1={x(cursor)} x2={x(cursor)} y1="8" y2="122" className="scope-cursor-line"/>}
          {readings.map((reading, index) => reading.value !== null && reading.sampleTime >= report.window.start && reading.sampleTime <= report.window.end && <circle key={reading.runId} cx={x(reading.sampleTime)} cy={y(reading.value)} r="4" fill={curveColor(index)} stroke="var(--surface)" strokeWidth="1.5"/>)}
          {drag && <rect x={Math.min(x(drag.start), x(drag.end))} y="8" width={Math.abs(x(drag.end) - x(drag.start))} height="114" className="scope-selection"/>}
        </svg>
        <div className="plot-x-labels" aria-hidden="true"><span>{formatNumber(report.window.start)} s</span><span>{formatNumber(report.window.end)} s</span></div>
      </div>
      <p className="scope-gesture-help">클릭: 원시 샘플 · 드래그: 구간 확대 · 방향키: 샘플 이동</p>
      {cursor !== null && <div className="scope-cursor-readings" role="status" aria-live="polite"><p>커서 {String(cursor)} s · 보간 없이 가까운 기록값</p><div className="scope-cursor-table-scroll"><table aria-label="커서의 원시 기록"><thead><tr><th>실행</th><th>기록 시각 (초)</th><th>원본 값</th></tr></thead><tbody>{readings.map((reading, index) => <tr key={reading.runId}><th><i style={{ background: curveColor(index) }} aria-hidden="true"/>{reading.label}</th><td>{String(reading.sampleTime)}</td><td><strong className="scope-exact-value">{reading.exact}</strong>{reading.approximate && reading.value !== null && <small>곡선 근삿값 {formatNumber(reading.value)}</small>}</td></tr>)}</tbody></table></div></div>}
      <details className="scope-view-controls"><summary>시간·구간 조절</summary><div className="scope-controls-content">
        <label className="scope-cursor-slider"><span>시간 커서</span><input type="range" aria-label="시간 커서" min={0} max={1000} step={1} value={cursor === null ? 0 : Math.round(normalizeScopeCoordinate(cursor, report.window.start, report.window.end) * 1000)} disabled={report.window.start === report.window.end} onChange={event => { setCursor(atFraction(report.window.start, report.window.end, Number(event.target.value) / 1000)); setError(''); }}/></label>
        <div className="scope-fields"><label className="field"><span className="field-label">커서 시각 (초)</span><input type="text" inputMode="decimal" aria-label="커서 시각" maxLength={64} value={cursorDraft} onChange={event => setCursorDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyCursor(); } }}/></label><button className="button" onClick={applyCursor}>커서 이동</button></div>
        <div className="scope-fields scope-window-fields"><label className="field"><span className="field-label">보기 시작 (초)</span><input type="text" inputMode="decimal" aria-label="보기 시작 시간" maxLength={64} value={startDraft} onChange={event => setStartDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyWindow(); } }}/></label><label className="field"><span className="field-label">보기 끝 (초)</span><input type="text" inputMode="decimal" aria-label="보기 종료 시간" maxLength={64} value={endDraft} onChange={event => setEndDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); applyWindow(); } }}/></label></div>
        <div className="scope-view-actions"><button className="button" onClick={applyWindow}>보기 구간 적용</button><button className="button" onClick={() => { setWindow(undefined); setCursor(null); setError(''); }}>전체 구간</button></div>
        <p className="scope-note">결과의 보기 구간을 조절합니다. 실행 시간과 원시 기록은 유지됩니다.</p>
        {error && <p className="field-message" role="alert">{error}</p>}
      </div></details>
    </>}
  </section>;
}
