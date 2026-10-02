import { useEffect, useRef, useState } from 'react';
import './RunBrand.css';

export type RunBrandPhase = 'ready' | 'validating' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
export interface RunBrandProps {
  activityKey: number;
  phase: RunBrandPhase;
}

const CYCLE_MS = 1_400;

/** Visual run feedback is independent of the engine's actual activity state. */
export function RunBrand({ activityKey, phase }: RunBrandProps) {
  const busy = phase === 'validating' || phase === 'running';
  const [animationActive, setAnimationActive] = useState(false);
  const cycle = useRef<{ key: number; startedAt: number | null; stopped: boolean }>({ key: activityKey, startedAt: null, stopped: false });

  useEffect(() => {
    const now = performance.now();
    if (cycle.current.key !== activityKey) {
      cycle.current = { key: activityKey, startedAt: now, stopped: false };
    } else if (busy && cycle.current.startedAt === null && !cycle.current.stopped) {
      cycle.current.startedAt = now;
    }

    if (phase === 'paused') { setAnimationActive(false); return; }
    if (phase === 'cancelled' || phase === 'failed' || phase === 'ready') {
      cycle.current.stopped = true;
      setAnimationActive(false);
      return;
    }
    if (cycle.current.stopped || cycle.current.startedAt === null) {
      setAnimationActive(false);
      return;
    }
    if (busy) {
      setAnimationActive(true);
      return;
    }

    const startedAt = cycle.current.startedAt;
    const remaining = Math.max(0, CYCLE_MS - (now - startedAt));
    setAnimationActive(remaining > 0);
    if (remaining === 0) return;
    const timer = window.setTimeout(() => {
      if (cycle.current.key === activityKey && cycle.current.startedAt === startedAt) setAnimationActive(false);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [activityKey, busy, phase]);

  const isPulsing = animationActive && phase !== 'cancelled' && phase !== 'failed' && phase !== 'paused' && phase !== 'ready';
  return <div className={`brand run-brand${isPulsing ? ' is-pulsing' : ''}${phase === 'paused' ? ' is-paused' : ''}`} role="group" aria-label={busy ? 'CalcWeave · 계산 중' : phase === 'paused' ? 'CalcWeave · 일시정지' : 'CalcWeave'} data-activity={phase} data-animating={isPulsing ? 'true' : 'false'}>
    <span key={`mark-${activityKey}`} className="brand-mark" aria-hidden="true"><i/><i/><i/><i/></span>
    <strong key={`wordmark-${activityKey}`} className="brand-wordmark" aria-hidden="true">Calc<span>Weave</span></strong>
    <span className="research-badge">0.8 작업 공간</span>
  </div>;
}
