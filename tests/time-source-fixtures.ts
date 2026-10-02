import type { CalcModel } from '../packages/model/src';

export interface TimeSourceFixture {
  id: string;
  blockId: string;
  parameters: Record<string, number>;
  reference: string;
  expected: (time: number) => number;
}
export const TIME_SOURCE_FIXTURES: readonly TimeSourceFixture[] = [
  { id: 'linear-chirp-phase', blockId: 'source.chirp', parameters: { amplitude: 1, initialFrequency: 0.5, finalFrequency: 1.5, duration: 2, phase: 0, bias: 0 }, reference: 'At half-second ticks t=0..3: [0,sin(5π/8),-1,sin(5π/8),0,-1,0]. Negative seconds hold the initial frequency. Phase and frequency remain continuous at t=0 and t=2.', expected: time => {
    const halfTicks = [0, Math.sin(5 * Math.PI / 8), -1, Math.sin(5 * Math.PI / 8), 0, -1, 0];
    if (time >= 0 && Number.isInteger(time * 2)) return halfTicks[time * 2]!;
    if (time < 0) return Math.sin(Math.PI * time);
    const angle = time < 2 ? Math.PI * time + Math.PI * time * time / 2 : 4 * Math.PI + 3 * Math.PI * (time - 2);
    return Math.sin(angle);
  } },
  { id: 'gaussian-bell', blockId: 'source.gaussian-pulse', parameters: { amplitude: 2, center: 1, width: 0.5, bias: 1 }, reference: 'Bell through t=1→3, t=0/2→1+2exp(-2), t=-1/3→1+2exp(-8).', expected: time => 1 + 2 * Math.exp(-2 * (time - 1) ** 2) },
  { id: 'damped-cosine-identity', blockId: 'source.damped-sine', parameters: { amplitude: 2, frequency: 0.5, decay: 0.5, phase: Math.PI / 2, bias: 1 }, reference: 'Phase π/2 transforms the sine into 1+2exp(-t/2)cos(πt).', expected: time => 1 + 2 * Math.exp(-time / 2) * Math.cos(Math.PI * time) },
  { id: 'exponential-input', blockId: 'source.exponential', parameters: { amplitude: 3, rate: -2, bias: 1 }, reference: '1+3exp(-2t); initial value 4 and positive finite decay for t≥0.', expected: time => 1 + 3 * Math.exp(-2 * time) },
  { id: 'logistic-tanh-identity', blockId: 'source.logistic', parameters: { amplitude: 4, center: 1, slope: 2, bias: -2 }, reference: 'The logistic is independently 2tanh(t−1), with center 0 and asymptotes ±2.', expected: time => 2 * Math.tanh(time - 1) },
  { id: 'sinc-pulse-grid', blockId: 'source.sinc-pulse', parameters: { amplitude: 2, center: 1, width: 0.5, bias: -1 }, reference: 'Quarter ticks t=0..2: [-1,-1−4/(3π),-1,-1+4/π,1,-1+4/π,-1,-1−4/(3π),-1].', expected: time => {
    const quarterTicks = [-1, -1 - 4 / (3 * Math.PI), -1, -1 + 4 / Math.PI, 1, -1 + 4 / Math.PI, -1, -1 - 4 / (3 * Math.PI), -1];
    if (time >= 0 && time <= 2 && Number.isInteger(time * 4)) return quarterTicks[time * 4]!;
    if (Number.isInteger(2 * (time - 1))) return -1;
    return -1 + 2 * Math.sin(2 * Math.PI * (time - 1)) / (2 * Math.PI * (time - 1));
  } },
];

export function timeSourceModel(fixture: TimeSourceFixture, mode: CalcModel['execution']['mode'] = 'discrete'): CalcModel {
  return { schemaVersion: 1, modelId: `wave-${fixture.id}`, name: fixture.id, nodes: [
    { id: 'wave', blockType: fixture.blockId, blockVersion: 1, label: fixture.id, parameters: { ...fixture.parameters } },
    { id: 'result', blockType: 'sink.scope', blockVersion: 1, label: '신호', parameters: {} },
  ], edges: [{ id: 'edge', source: { nodeId: 'wave', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }],
  layout: { wave: { x: 120, y: 180 }, result: { x: 400, y: 180 } },
  execution: { mode, startTime: 0, stopTime: fixture.blockId === 'source.chirp' ? 3 : 2, step: fixture.blockId === 'source.chirp' ? 0.5 : 0.25 },
  };
}
