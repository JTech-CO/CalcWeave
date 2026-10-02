import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { MODEL_LIMITS, ModelError, type ExecutionSettings, type RunSample } from '../../../../packages/model/src';

export function ScopeTimeRange({ execution, samples, busy, onApply }: {
  execution: ExecutionSettings; samples?: RunSample[]; busy: boolean;
  onApply: (startTime: number, stopTime: number) => Promise<void>;
}) {
  const id = useId();
  const [start, setStart] = useState(String(execution.startTime));
  const [stop, setStop] = useState(String(execution.stopTime));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const applying = useRef(false);
  useEffect(() => { setStart(String(execution.startTime)); setStop(String(execution.stopTime)); setError(''); }, [execution.startTime, execution.stopTime]);
  if (execution.mode === 'static') return null;
  const apply = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || applying.current) return;
    const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
    const startTime = Number(start), stopTime = Number(stop);
    if (![start, stop].every(text => text.length <= 64 && decimal.test(text.trim())) || ![startTime, stopTime].every(value => Number.isFinite(value) && Math.abs(value) <= MODEL_LIMITS.maxTime)) {
      setError('시작·종료 시간에 -1,000,000,000 ~ 1,000,000,000 범위의 유한한 숫자를 입력하세요.'); return;
    }
    if (stopTime <= startTime) { setError('종료 시간을 시작 시간보다 크게 입력하세요.'); return; }
    setError(''); applying.current = true; setPending(true);
    try { await onApply(startTime, stopTime); }
    catch (caught) { setError(caught instanceof ModelError ? caught.diagnostics[0]?.message ?? caught.message : '시간 범위를 적용하지 못했습니다.'); }
    finally { applying.current = false; setPending(false); }
  };
  return <form className="scope-time-range" aria-label="Scope 시간 범위" onSubmit={event => void apply(event)}>
    <h3>시간 범위</h3>
    <div className="scope-time-fields">
      <label className="field"><span className="field-label">시작 시간</span><span className="number-field"><input type="text" inputMode="decimal" maxLength={64} aria-label="Scope 시작 시간" aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} value={start} disabled={busy || pending} onChange={event => { setStart(event.target.value); setError(''); }}/><span>s</span></span></label>
      <label className="field"><span className="field-label">종료 시간</span><span className="number-field"><input type="text" inputMode="decimal" maxLength={64} aria-label="Scope 종료 시간" aria-invalid={!!error} aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`} value={stop} disabled={busy || pending} onChange={event => { setStop(event.target.value); setError(''); }}/><span>s</span></span></label>
    </div>
    <button type="submit" className="button" disabled={busy || pending}>범위 적용 후 실행</button>
    <p id={`${id}-help`} className="field-help">시간을 늘리면 해당 구간까지 다시 계산합니다. 현재 시간 간격 {execution.step} s{samples?.length ? ` · 기록 ${samples[0]!.time} ~ ${samples.at(-1)!.time} s` : ''}</p>
    {error && <p id={`${id}-error`} className="field-message" role="alert">{error}</p>}
  </form>;
}
