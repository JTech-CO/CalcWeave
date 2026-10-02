import { ModelError, type IRNode, type SignalValue } from '../../model/src/types';

/** Pure functions of absolute simulation seconds. No host time, state, files or random source. */
export function evaluateTimeSourceNode(node: IRNode, time: number): Record<string, SignalValue> | undefined {
  if (!['source.chirp', 'source.gaussian-pulse', 'source.damped-sine', 'source.exponential', 'source.logistic', 'source.sinc-pulse'].includes(node.blockType)) return undefined;
  const fail = (code: string, message: string): never => { throw new ModelError([{ code, nodeId: node.id, message }]); };
  const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : fail('NUMERIC_NONFINITE', '시간 신호의 입력 또는 결과가 유한한 실수가 아닙니다.');
  const p = (key: string): number => finite(node.parameters[key]);
  const positive = (key: string): number => { const value = p(key); if (value <= 0) fail('NUMERIC_DOMAIN', '시간 폭과 스윕 기간은 양수여야 합니다.'); return value; };
  const t = finite(time), amplitude = p('amplitude'), bias = p('bias');
  let waveform: number;
  switch (node.blockType) {
    case 'source.chirp': {
      const initial = p('initialFrequency'), final = p('finalFrequency'), duration = positive('duration');
      // Integrate frequency to retain phase and derivative continuity at 0 and duration.
      const cycles = t <= 0 ? initial * t : t < duration ? initial * t + (final - initial) * t * t / (2 * duration) : (initial + final) * duration / 2 + final * (t - duration);
      waveform = Math.sin(finite(2 * Math.PI * cycles + p('phase'))); break;
    }
    case 'source.gaussian-pulse': {
      const normalized = (t - p('center')) / positive('width');
      waveform = Math.exp(-0.5 * normalized * normalized); break;
    }
    case 'source.damped-sine': waveform = Math.exp(finite(-p('decay') * t)) * Math.sin(finite(2 * Math.PI * p('frequency') * t + p('phase'))); break;
    case 'source.exponential': waveform = Math.exp(finite(p('rate') * t)); break;
    case 'source.logistic': {
      const z = finite(p('slope') * (t - p('center')));
      waveform = z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)); break;
    }
    case 'source.sinc-pulse': {
      const normalized = finite((t - p('center')) / positive('width'));
      const phase = finite(Math.PI * normalized);
      waveform = normalized === 0 ? 1 : Math.sin(phase) / phase; break;
    }
    default: return undefined;
  }
  return { out: finite(amplitude * finite(waveform) + bias) };
}
