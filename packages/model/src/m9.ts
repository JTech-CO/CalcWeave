import { signalElementCount, validateSignal } from './signal';
import type { IRNode } from './types';

/** Conservatively counts every persistent signal/state cache and scalar lifecycle marker. */
export function m9StateElementCount(node: IRNode): number | undefined {
  const p = node.parameters;
  const width = node.outputs.out ? signalElementCount(node.outputs.out) : 1;
  const initialWidth = (): number => signalElementCount(validateSignal(p.initial ?? 0));
  const base = width + 2; // previousOutput, reset flag, publication/due marker
  switch (node.blockType) {
    case 'discrete.filter': {
      const a = (p.denominator as number[]).length, b = p.representation === 'transfer' ? a : (p.numerator as number[]).length;
      const slots = p.structure === 'df1' || p.structure === 'df1t' ? a + b - 2 : Math.max(a, b) - 1;
      return base + (slots + 1) * initialWidth();
    }
    case 'discrete.filter-time-varying': return base + ((p.order as number) + 1) * initialWidth();
    case 'discrete.zero-pole': return base + ((p.poles as number[]).length + 1) * initialWidth();
    case 'discrete.pid': case 'discrete.pid-2dof': return base + 8;
    case 'discrete.delay-configured': return base + ((p.mode === 'variable' ? p.maxDelay : p.steps) as number) * initialWidth() + 2 * initialWidth() + 2;
    case 'discrete.tapped-delay': return base + (p.taps as number) + 3;
    case 'discrete.propagation-delay': return base + (p.capacity as number) * (initialWidth() + 2) + initialWidth() + 2; // value, physical arrival, integer due tick
    case 'discrete.integrator-configured': return base + 3 * initialWidth();
    case 'discrete.state-space-mimo': return base + (p.initial as number[]).length + width;
    case 'discrete.difference-configured': case 'logic.numeric-edge': case 'math.running-minmax': case 'verify.gradient': return base + 2 * initialWidth();
    case 'signal.initial-condition': return base + initialWidth() + 1;
    case 'source.band-limited-noise': case 'source.random-configured': return base + width + 3;
    case 'source.counter': case 'source.signal-generator': case 'source.sine-configured': case 'source.sequence-configured': return base + width + 3;
    case 'source.pwm': case 'source.variable-pulse': return base + 8;
    case 'time.weighted-math': case 'time.decrement-to-zero': case 'verify.resolution': return base + width; // bounded runtime publication cache
    default: return undefined;
  }
}
