import { useMemo } from 'react';
import type { RunSample } from '../../../../packages/model/src';

export function formatNumber(value: number) {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  if (Math.abs(value) >= 1e9 || Math.abs(value) < 1e-5) return value.toExponential(5);
  return Number(value.toPrecision(7)).toLocaleString('en-US', { maximumSignificantDigits: 7 });
}

export function ResultPlot({ samples, outputId, label }: { samples: RunSample[]; outputId: string; label: string }) {
  const plot = useMemo(() => {
    const filtered = samples.flatMap(sample => { const value = sample.values[outputId]; return typeof value === 'number' && Number.isFinite(value) ? [{ time: sample.time, value }] : []; });
    if (!filtered.length) return null;
    const { low, high } = filtered.reduce((range, sample) => ({ low: Math.min(range.low, sample.value), high: Math.max(range.high, sample.value) }), { low: Infinity, high: -Infinity });
    const scale = Math.max(Math.abs(low), Math.abs(high), 1);
    const normalizedLow = low / scale, normalizedHigh = high / scale;
    const spread = normalizedHigh - normalizedLow || Math.max(Math.abs(normalizedHigh) * 0.25, 1 / scale);
    const yMin = normalizedLow - spread * 0.12, yMax = normalizedHigh + spread * 0.12;
    const timeMin = filtered[0].time, timeMax = filtered.at(-1)!.time;
    const x = (time: number) => 10 + (time - timeMin) / (timeMax - timeMin || 1) * 680;
    const y = (value: number) => 122 - (value / scale - yMin) / (yMax - yMin) * 114;
    // The model budget caps this at 10,001 samples. Keep every point, including brief peaks.
    return { path: filtered.map((sample, index) => `${index ? 'L' : 'M'}${x(sample.time).toFixed(2)},${y(sample.value).toFixed(2)}`).join(' '), high, low, timeMin, timeMax, single: filtered.length === 1, dotX: x(filtered[0].time), dotY: y(filtered[0].value) };
  }, [samples, outputId]);
  if (!plot) return <div className="plot-empty">표시할 수치 결과가 없습니다.</div>;
  return <div className="plot-frame">
    <div className="plot-y-labels" aria-hidden="true"><span>{formatNumber(plot.high)}</span><span>{formatNumber(plot.low)}</span></div>
    <svg className="result-plot" viewBox="0 0 700 140" preserveAspectRatio="none" role="img" aria-label={`${label} 시간 그래프. 시작 ${formatNumber(plot.timeMin)}, 종료 ${formatNumber(plot.timeMax)}, 최소 ${formatNumber(plot.low)}, 최대 ${formatNumber(plot.high)}. 아래 표에서 전체 수치를 확인할 수 있습니다.`}>
    {[8, 46, 84, 122].map((y) => <line key={y} x1="10" x2="690" y1={y} y2={y} className="plot-grid"/>)}
    <path d={plot.path} fill="none" stroke="var(--accent)" strokeWidth="2.5"/>
    {plot.single && <circle cx={plot.dotX} cy={plot.dotY} r="4" fill="var(--accent)"/>}
    </svg>
    <div className="plot-x-labels" aria-hidden="true"><span>{formatNumber(plot.timeMin)} s</span><span>{formatNumber(plot.timeMax)} s</span></div>
  </div>;
}
