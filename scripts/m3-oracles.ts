import type { CalcModel, CalcNode, SignalValue, SolverSettings } from '../packages/model/src';

export type ContinuousOracle = { id: string; model: CalcModel; reference: string; tolerance: number; expected: Record<string, (time: number, index: number) => SignalValue>; expectedEvents?: { time: number; kind: string; nodeId: string }[]; rejectionRequired?: boolean };
export function graph(id: string, stop = 1, outputStep = 0.1, solver: Partial<SolverSettings> = {}): CalcModel {
  return { schemaVersion: 1, modelId: id, name: id, nodes: [], edges: [], layout: {}, execution: { mode: 'continuous', startTime: 0, stopTime: stop, step: outputStep,
    solver: { method: 'rk4', initialStep: 0.01, minStep: 1e-10, maxStep: 0.01, discreteStep: 0.1, ...solver } } };
}
export function node(model: CalcModel, id: string, type: CalcNode['blockType'], parameters: Record<string, unknown> = {}, period = 1): void {
  model.nodes.push({ id, blockType: type, blockVersion: 1, label: id, parameters, unit: '1', sampleTime: { period, offset: 0 } });
}
export function wire(model: CalcModel, source: string, target: string, port = 'in', sourcePort = 'out'): void {
  model.edges.push({ id: `${source}-${sourcePort}-${target}-${port}`, source: { nodeId: source, portId: sourcePort }, target: { nodeId: target, portId: port } });
}
export function output(model: CalcModel, source: string, id = 'result', sourcePort = 'out'): void {
  node(model, id, 'sink.scope'); wire(model, source, id, 'in', sourcePort);
}
export function decay(method: 'rk4'|'rk45', h = 0.1, rate = 1): CalcModel {
  const model = graph(`F03-decay-${method}-${String(h).replace('.', '-')}`, 1, 0.2, { method, initialStep: h, maxStep: h, atol: 1e-10, rtol: 1e-9 });
  node(model, 'state', 'continuous.integrator', { initial: 1 }); node(model, 'negative', 'math.gain', { gain: -rate });
  wire(model, 'state', 'negative'); wire(model, 'negative', 'state'); output(model, 'state'); return model;
}
export function continuousOracles(): ContinuousOracle[] {
  const fixtures: ContinuousOracle[] = [];
  function add(model: CalcModel, reference: string, expected: ContinuousOracle['expected'], tolerance = 2e-7, extra: Partial<ContinuousOracle> = {}): void {
    fixtures.push({ id: model.modelId, model, reference, expected, tolerance, ...extra });
  }
  for (const method of ['rk4', 'rk45'] as const) {
    const model = decay(method, method === 'rk4' ? 0.01 : 0.2, method === 'rk4' ? 1 : 20);
    add(model, `Analytical x(t)=exp(-${method === 'rk4' ? 1 : 20}t), x(0)=1.`, { result: t => Math.exp(-(method === 'rk4' ? 1 : 20) * t) }, 2e-9, { rejectionRequired: method === 'rk45' });
  }
  for (const [type, parameters, expected, name] of [
    ['source.clock', {}, (t: number) => t * t / 2, 'clock'],
    ['source.ramp', { slope: 2 }, (t: number) => t * t, 'ramp'],
    ['source.sine-wave', { frequency: 0.25 }, (t: number) => (1 - Math.cos(Math.PI * t / 2)) / (Math.PI / 2), 'sine'],
  ] as const) {
    const model = graph(`F03-stage-${name}`); node(model, 'input', type, parameters); node(model, 'state', 'continuous.integrator'); wire(model, 'input', 'state'); output(model, 'state');
    add(model, `Analytical integral of ${name}; source is evaluated at every RK stage time.`, { result: expected }, 2e-9);
  }
  {
    const model = graph('F03-second-order-oscillator'); node(model, 'oscillator', 'continuous.second-order-integrator', { initialPosition: 1 }); node(model, 'negative', 'math.gain', { gain: -1 });
    wire(model, 'oscillator', 'negative'); wire(model, 'negative', 'oscillator'); output(model, 'oscillator', 'position'); output(model, 'oscillator', 'velocity', 'velocity');
    add(model, 'Analytical x=cos(t), v=-sin(t) for x\'\'=-x, x(0)=1,v(0)=0.', { position: t => Math.cos(t), velocity: t => -Math.sin(t) }, 2e-9);
  }
  {
    const model = graph('F03-state-space-oscillator'); node(model, 'zero', 'source.constant', { value: 0 });
    node(model, 'state', 'continuous.state-space', { A: [[0, 1], [-1, 0]], B: [0, 0], C: [1, 0], D: 0, initial: [1, 0] }); wire(model, 'zero', 'state'); output(model, 'state');
    add(model, 'Matrix exponential exp(A*t) gives cos(t); independent oscillator reference.', { result: t => Math.cos(t) }, 2e-9);
  }
  {
    const model = graph('F03-off-grid-step-transfer', 1, 0.1, { initialStep: 0.08, maxStep: 0.08 }); node(model, 'input', 'source.step', { stepTime: 0.37 });
    node(model, 'filter', 'continuous.transfer-function', { numerator: [1], denominator: [1, 1] }); wire(model, 'input', 'filter'); output(model, 'filter');
    add(model, 'Analytical step response 0 before 0.37, 1-exp(-(t-0.37)) afterward; one-sided RHS at breakpoint.', { result: t => t < 0.37 ? 0 : 1 - Math.exp(-(t - 0.37)) });
  }
  {
    const model = graph('F03-zero-pole'); node(model, 'one', 'source.constant', { value: 1 }); node(model, 'system', 'continuous.zero-pole', { zeros: [], poles: [-2], gain: 2 }); wire(model, 'one', 'system'); output(model, 'system');
    add(model, 'Real-root G(s)=2/(s+2); step response 1-exp(-2t), empty zero list valid.', { result: t => 1 - Math.exp(-2 * t) }, 3e-9);
  }
  {
    const model = graph('F03-pid-and-filtered-derivative'); node(model, 'one', 'source.constant', { value: 1 });
    node(model, 'pid', 'continuous.pid', { kp: 2, ki: 1, kd: 0.5, filterN: 4 }); node(model, 'derivative', 'continuous.derivative', { filterN: 4 });
    wire(model, 'one', 'pid'); wire(model, 'one', 'derivative'); output(model, 'pid', 'pid-out'); output(model, 'derivative', 'derivative-out');
    add(model, 'Parallel filtered PID: 2+t+2*exp(-4t); filtered derivative 4*exp(-4t), zero filter/integral states.', { 'pid-out': t => 2 + t + 2 * Math.exp(-4 * t), 'derivative-out': t => 4 * Math.exp(-4 * t) }, 4e-8);
  }
  {
    const model = graph('F03-major-step-memory', 0.5, 0.1, { initialStep: 0.05, maxStep: 0.05 }); node(model, 'clock', 'source.clock'); node(model, 'memory', 'time.memory', { initial: -1 }); wire(model, 'clock', 'memory'); output(model, 'memory');
    add(model, 'Previous accepted major-step input with fixed 0.05 steps; not Unit Delay or minor-stage mutation.', { result: (t, index) => index === 0 ? -1 : t - 0.05 }, 1e-12);
  }
  {
    const model = graph('F03-transport-delay'); node(model, 'clock', 'source.clock'); node(model, 'delay', 'time.transport-delay', { delay: 0.15 }); wire(model, 'clock', 'delay'); output(model, 'delay');
    add(model, 'Accepted-history linear interpolation of clock: max(0,t-0.15); zero prehistory.', { result: t => Math.max(0, t - 0.15) }, 1e-12);
  }
  {
    const model = graph('F03-delay-prehistory-and-jump', 1, 0.1, { initialStep: 0.08, maxStep: 0.08 });
    node(model, 'input', 'source.step', { stepTime: 0.37, before: 1, after: 2 }); node(model, 'delay', 'time.transport-delay', { delay: 0.15 }); node(model, 'integral', 'continuous.integrator');
    wire(model, 'input', 'delay'); wire(model, 'delay', 'integral'); output(model, 'delay', 'delayed'); output(model, 'integral', 'integral-out');
    add(model, 'Exact zero prehistory to .15; delayed input 1 on [.15,.52), 2 afterward. Integral max(0,t-.15)+max(0,t-.52). Jump is not interpolated into a ramp.',
      { delayed: t => t < 0.15 ? 0 : t < 0.52 ? 1 : 2, 'integral-out': t => Math.max(0, t - 0.15) + Math.max(0, t - 0.52) }, 1e-9);
  }
  for (const type of ['time.zero-order-hold', 'time.first-order-hold'] as const) {
    const model = graph(`F03-${type.split('.').at(-1)}`, 0.5, 0.05); node(model, 'clock', 'source.clock'); node(model, 'hold', type, {}, 2); wire(model, 'clock', 'hold'); output(model, 'hold');
    add(model, type === 'time.zero-order-hold' ? 'Clock captured on 0.2 grid and held until next due tick.' : 'Causal backward two-sample slope: zero until 0.2, then extrapolates clock.',
      { result: t => type === 'time.zero-order-hold' ? Math.floor((t + 1e-12) / 0.2) * 0.2 : t < 0.2 - 1e-12 ? 0 : t }, 1e-12);
  }
  {
    const model = graph('F03-hybrid-delay-integrator'); node(model, 'one', 'source.constant', { value: 1 }); node(model, 'hold', 'time.zero-order-hold'); node(model, 'delay', 'discrete.unit-delay'); node(model, 'state', 'continuous.integrator');
    wire(model, 'one', 'hold'); wire(model, 'hold', 'delay'); wire(model, 'delay', 'state'); output(model, 'state');
    add(model, 'Causal ZOH -> UnitDelay -> ODE, base=0.1. Delay visible from t=0.1 so integral max(0,t-0.1).', { result: t => Math.max(0, t - 0.1) }, 1e-12);
  }
  {
    const model = graph('F03-simultaneous-reset-tick', 1, 0.25, { discreteStep: 0.25 }); node(model, 'clock', 'source.clock'); node(model, 'hit', 'logic.hit-crossing', { threshold: 0.5, direction: 'rising' });
    node(model, 'one', 'source.constant', { value: 1 }); node(model, 'state', 'continuous.integrator', { reset: 'rising' }); node(model, 'hold', 'time.zero-order-hold'); node(model, 'delay', 'discrete.unit-delay', { initial: -1 });
    wire(model, 'clock', 'hit'); wire(model, 'one', 'state'); wire(model, 'hit', 'state', 'reset'); wire(model, 'state', 'hold'); wire(model, 'hold', 'delay'); output(model, 'state', 'integral'); output(model, 'delay', 'delayed');
    add(model, 'At t=0.5 reset precedes ZOH/tick/observation. Continuous [0,.25,0,.25,.5], delay [-1,0,.25,0,.25].',
      { integral: (_t, i) => [0, 0.25, 0, 0.25, 0.5][i]!, delayed: (_t, i) => [-1, 0, 0.25, 0, 0.25][i]! }, 3e-8,
      { expectedEvents: [{ time: 0.5, kind: 'crossing', nodeId: 'hit' }, { time: 0.5, kind: 'reset', nodeId: 'state' }] });
  }
  {
    const model = graph('F03-relay-hysteresis', 1, 0.1, { initialStep: 0.03, maxStep: 0.03 }); node(model, 'sine', 'source.sine-wave', { frequency: 1 });
    node(model, 'relay', 'nonlinear.relay', { onThreshold: 0.5, offThreshold: -0.5 }); wire(model, 'sine', 'relay'); output(model, 'relay');
    add(model, 'sin(2*pi*t) crosses +0.5 rising at 1/12 and -0.5 falling at 7/12. Hysteresis avoids extra toggles.', { result: t => t > 1 / 12 && t < 7 / 12 ? 1 : 0 }, 1e-12,
      { expectedEvents: [{ time: 1 / 12, kind: 'relay', nodeId: 'relay' }, { time: 7 / 12, kind: 'relay', nodeId: 'relay' }] });
  }
  {
    const model = graph('F03-relay-initial-outside-band'); node(model, 'high', 'source.constant', { value: 2 }); node(model, 'low', 'source.constant', { value: -1 });
    node(model, 'start-on', 'nonlinear.relay', { initial: 'off' }); node(model, 'start-off', 'nonlinear.relay', { initial: 'on' }); wire(model, 'high', 'start-on'); wire(model, 'low', 'start-off'); output(model, 'start-on', 'on-out'); output(model, 'start-off', 'off-out');
    add(model, 'Initial input outside hysteresis band resolves the relay mode before first observation; explicit initial applies inside the band.', { 'on-out': () => 1, 'off-out': () => 0 }, 1e-12,
      { expectedEvents: [{ time: 0, kind: 'relay', nodeId: 'start-on' }, { time: 0, kind: 'relay', nodeId: 'start-off' }] });
  }
  {
    const model = graph('F03-saturation-kinks'); node(model, 'ramp', 'source.ramp', { initial: -1, slope: 4 }); node(model, 'clip', 'nonlinear.saturation', { lower: 0, upper: 1 }); node(model, 'state', 'continuous.integrator');
    wire(model, 'ramp', 'clip'); wire(model, 'clip', 'state'); output(model, 'state');
    add(model, 'Exact integral of clip(4t-1,0,1): 0 to .25, 2(t-.25)^2 to .5, then t-.375.', { result: t => t <= 0.25 ? 0 : t <= 0.5 ? 2 * (t - 0.25) ** 2 : t - 0.375 }, 2e-8);
  }
  return fixtures;
}

export function boundaryOracles(): ContinuousOracle[] {
  const vector = graph('F03-typed-algebraic-side-branch'); node(vector, 'vector', 'source.constant', { value: [-1, 0.5, 2] }); node(vector, 'clip', 'nonlinear.saturation', { lower: 0, upper: 1 }); wire(vector, 'vector', 'clip'); output(vector, 'clip');
  const model = graph('F03-discrete-jump-crossing-reset', 1, 0.25, { discreteStep: 0.25 }); node(model, 'pulse', 'source.pulse', { period: 2, width: 1 }); node(model, 'hit', 'logic.hit-crossing', { threshold: 0.5, direction: 'rising' });
  node(model, 'one', 'source.constant', { value: 1 }); node(model, 'state', 'continuous.integrator', { reset: 'rising' }); wire(model, 'pulse', 'hit'); wire(model, 'one', 'state'); wire(model, 'hit', 'state', 'reset'); output(model, 'state');
  const rateModels = [false, true].map(useHold => {
    const m = graph(`F03-hybrid-rate-${useHold ? 'hold' : 'constant'}`, 0.3, 0.1);
    node(m, 'constant', 'source.constant', { value: 3 }, useHold ? 1 : 2);
    if (useHold) { node(m, 'hold', 'time.zero-order-hold', {}, 2); wire(m, 'constant', 'hold'); }
    node(m, 'rate', 'time.rate-transition', { initial: -1 }); wire(m, useHold ? 'hold' : 'constant', 'rate'); output(m, 'rate'); return m;
  });
  const separate = graph('F03-reset-control-isolation', 1, 0.25); node(separate, 'one', 'source.constant', { value: 1 }); node(separate, 'true', 'source.constant', { value: true }); node(separate, 'state', 'continuous.integrator', { reset: 'rising' });
  node(separate, 'ramp', 'source.ramp'); node(separate, 'unrelated', 'logic.hit-crossing', { threshold: 0.5, direction: 'rising' }); wire(separate, 'one', 'state'); wire(separate, 'true', 'state', 'reset'); wire(separate, 'ramp', 'unrelated'); output(separate, 'state'); output(separate, 'unrelated', 'crossing');
  const sampled = (['time.zero-order-hold','time.first-order-hold'] as const).map(type => {
    const m = graph(`F03-discrete-input-${type.split('.').at(-1)}`, 0.3, 0.05); node(m, 'digital', 'source.digital-clock'); node(m, 'hold', type); wire(m, 'digital', 'hold'); output(m, 'hold');
    return { id: m.modelId, model: m, reference: 'DigitalClock captures the current due tick before explicit hold observation. ZOH quantizes; causal FOH extrapolates after its second sample; no implicit extra tick delay.', tolerance: 1e-12,
      expected: { result: (t: number) => type === 'time.zero-order-hold' ? Math.floor((t+1e-12)/0.1)*0.1 : t < 0.1-1e-12 ? 0 : t } };
  });
  const safeCapture = graph('F03-capture-before-downstream-domain', 1.3, 0.1); safeCapture.execution.startTime = 1;
  node(safeCapture, 'digital', 'source.digital-clock'); node(safeCapture, 'hold', 'time.zero-order-hold', { initial: 0 }); node(safeCapture, 'reciprocal', 'math.function', { operation: 'reciprocal' });
  wire(safeCapture, 'digital', 'hold'); wire(safeCapture, 'hold', 'reciprocal'); output(safeCapture, 'reciprocal');
  return [
    { id: vector.modelId, model: vector, reference: 'Elementwise typed side branch retains [0,.5,1]; scalar ODE crossing guards must not inspect vectors.', tolerance: 1e-12, expected: { result: () => [0, 0.5, 1] } },
    { id: model.modelId, model, reference: 'Held pulse rising at tick times 0,.5,1 triggers one crossing and one reset each, never duplicates; intermediate integral .25.', tolerance: 1e-12, expected: { result: (_t, i) => [0, 0.25, 0, 0.25, 0][i]! },
      expectedEvents: [0, 0.5, 1].flatMap(time => [{ time, kind: 'crossing', nodeId: 'hit' }, { time, kind: 'reset', nodeId: 'state' }]) },
    ...rateModels.map(m => ({ id: m.modelId, model: m, reference: 'P2 external Constant/ZOH producer metadata must survive the mixed scheduler; P1 receiver reads prior publication, [-1,3,3,3].', tolerance: 1e-12, expected: { result: (_t: number, i: number) => i === 0 ? -1 : 3 } })),
    { id: separate.modelId, model: separate, reference: 'A separate Hit Crossing cannot reset an integrator driven by held constant true. Each reset belongs to its connected control endpoint.', tolerance: 1e-12,
      expected: { result: t => t, crossing: t => Math.abs(t - 0.5) < 1e-12 }, expectedEvents: [{ time: 0.5, kind: 'crossing', nodeId: 'unrelated' }] },
    ...sampled,
    { id: safeCapture.modelId, model: safeCapture, reference: 'Start at t=1. A due capture replaces hold initial0 with current clock1 before reciprocal is evaluated; no artificial divide-by-zero.', tolerance: 1e-12, expected: { result: t => 1 / t } },
  ];
}
