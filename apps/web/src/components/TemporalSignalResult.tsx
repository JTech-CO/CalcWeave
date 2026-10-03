import { useEffect, useState } from 'react';
import type { RunSample } from '../../../../packages/model/src';
import { formatNumber } from './ResultPlot';
import { SignalResult } from './SignalResult';

/** Every original array sample remains available; the view never replaces raw records. */
export function TemporalSignalResult({ samples, outputId, label }: { samples: RunSample[]; outputId: string; label: string }) {
  const [index, setIndex] = useState(Math.max(0, samples.length - 1));
  const [draft, setDraft] = useState(String(samples.length));
  const [error, setError] = useState('');
  useEffect(() => { setIndex(Math.max(0, samples.length - 1)); setDraft(String(samples.length)); setError(''); }, [samples, outputId]);
  const select = (next: number) => { setIndex(next); setDraft(String(next + 1)); setError(''); };
  const apply = () => {
    const value = Number(draft);
    if (!draft.trim() || !Number.isInteger(value) || value < 1 || value > samples.length) { setError(`1 ~ ${samples.length} 사이의 샘플 번호를 입력하세요.`); return; }
    select(value - 1);
  };
  const sample = samples[Math.min(index, samples.length - 1)], value = sample?.values[outputId];
  if (!sample || value === undefined || !Array.isArray(value) && (typeof value !== 'object' || !value.shape.length)) return null;
  return <section className="temporal-signal" aria-label={`${label} 배열 샘플`}>
    {samples.length > 1 && <><div className="sample-navigation"><button className="button" disabled={index === 0} onClick={() => select(index - 1)}>이전 샘플</button><label className="field"><span className="field-label">배열 샘플 번호</span><input aria-label="배열 샘플 번호" type="text" inputMode="numeric" value={draft} maxLength={5} aria-invalid={!!error} onChange={event => setDraft(event.target.value.slice(0, 5))} onBlur={apply} onKeyDown={event => { if (event.key === 'Enter') { apply(); event.currentTarget.blur(); } if (event.key === 'Escape') { setDraft(String(index + 1)); setError(''); } }}/></label><button className="button" disabled={index >= samples.length - 1} onClick={() => select(index + 1)}>다음 샘플</button></div>{error && <p className="field-message" role="alert">{error}</p>}<p className="sample-detail">{index + 1} / {samples.length} 샘플 · t = {formatNumber(sample.time)} s · 원본 기록</p></>}
    <SignalResult value={value} label={label}/>
  </section>;
}
