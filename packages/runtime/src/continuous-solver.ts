import { m12Newton, type M12NewtonOptions } from './numerics';

/** Pure Runge–Kutta stages: trial evaluation cannot commit model memory. */
export function rkTrial(method: 'rk4' | 'rk45', t: number, x: number[], h: number,
  derivative: (time: number, state: number[]) => number[]): { state: number[]; error: number[] } {
  const stage = (weights: number[], slopes: number[][]): number[] => x.map((value, index) =>
    value + h * weights.reduce((sum, weight, j) => sum + weight * slopes[j]![index]!, 0));
  const k1 = derivative(t, x);
  if (method === 'rk4') {
    const k2 = derivative(t + h / 2, stage([1 / 2], [k1]));
    const k3 = derivative(t + h / 2, stage([0, 1 / 2], [k1, k2]));
    const k4 = derivative(t + h, stage([0, 0, 1], [k1, k2, k3]));
    return { state: stage([1 / 6, 1 / 3, 1 / 3, 1 / 6], [k1, k2, k3, k4]), error: x.map(() => 0) };
  }
  const k2 = derivative(t + h / 5, stage([1 / 5], [k1]));
  const k3 = derivative(t + 3 * h / 10, stage([3 / 40, 9 / 40], [k1, k2]));
  const k4 = derivative(t + 4 * h / 5, stage([44 / 45, -56 / 15, 32 / 9], [k1, k2, k3]));
  const k5 = derivative(t + 8 * h / 9, stage([19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729], [k1, k2, k3, k4]));
  const k6 = derivative(t + h, stage([9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [k1, k2, k3, k4, k5]));
  const state = stage([35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84], [k1, k2, k3, k4, k5, k6]);
  const k7 = derivative(t + h, state);
  const fourth = stage([5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40], [k1, k2, k3, k4, k5, k6, k7]);
  return { state, error: state.map((value, index) => value - fourth[index]!) };
}

/** Weighted infinity norm: each state must meet its own absolute/relative bound. */
export function rkErrorNorm(before: number[], after: number[], error: number[], atol: number, rtol: number): number {
  return error.reduce((maximum, value, index) => Math.max(maximum,
    Math.abs(value) / (atol + rtol * Math.max(Math.abs(before[index]!), Math.abs(after[index]!)))), 0);
}

export function rkNextStep(h: number, error: number, accepted: boolean, minimum: number, maximum: number): number {
  const factor = error === 0 ? 5 : Math.min(accepted ? 5 : 1, Math.max(0.1, 0.9 * error ** -0.2));
  return Math.min(maximum, Math.max(minimum, h * factor));
}

/** Backward Euler is genuinely implicit; step doubling estimates its order-one error. */
export function implicitEulerTrial(t: number, x: number[], h: number, derivative: (time: number, state: number[]) => number[], options: M12NewtonOptions): { state: number[]; error: number[] } {
  if (!x.length) { derivative(t + h, []); return { state: [], error: [] }; }
  const step = (at: number, before: number[], interval: number): number[] => m12Newton(candidate => {
    const slope = derivative(at + interval, candidate);
    return candidate.map((value, index) => value - before[index]! - interval * slope[index]!);
  }, before, options).state;
  const full = step(t, x, h), half = step(t, x, h / 2), state = step(t + h / 2, half, h / 2);
  return { state, error: state.map((value, index) => value - full[index]!) };
}

export function implicitNextStep(h: number, error: number, accepted: boolean, minimum: number, maximum: number): number {
  const factor = error === 0 ? 4 : Math.min(accepted ? 4 : 1, Math.max(0.1, 0.9 * error ** -0.5));
  return Math.min(maximum, Math.max(minimum, h * factor));
}
