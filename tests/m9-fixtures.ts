import type { CalcEdge, CalcModel, CalcNode, SignalValue, StateValue } from '../packages/model/src';

export interface M9Fixture { name: string; model: CalcModel; expected: Record<string, SignalValue[]>; expectedMemory?: Record<string, StateValue> }
export interface M9FailureFixture { name: string; model: CalcModel; code: string; nodeId?: string; tick?: number; time?: number }
export const m9Node = (id: string, blockType: string, parameters: Record<string, unknown> = {}, period = 1, offset = 0, unit?: string): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters, sampleTime: { period, offset }, ...(unit ? { unit } : {}) });
export const m9Edge = (source: string, target: string, port = 'in', output = 'out'): CalcEdge => ({ id: `${source}-${output}-${target}-${port}`, source: { nodeId: source, portId: output }, target: { nodeId: target, portId: port } });

/** Creates literal sample sequences using previous-value sources, not an engine-generated oracle. */
export function m9Model(type: string, parameters: Record<string, unknown> = {}, inputs: Record<string, SignalValue[]> = {}, options: { steps?: number; step?: number; period?: number; offset?: number; units?: Record<string, string>; unit?: string } = {}): CalcModel {
  const steps = options.steps ?? Math.max(3, ...Object.values(inputs).map((series) => series.length));
  const step = options.step ?? 1, nodes: CalcNode[] = [], edges: CalcEdge[] = [];
  for (const [port, series] of Object.entries(inputs)) {
    const first = series[0]!;
    const flat = (value: SignalValue): (number | boolean)[] => !Array.isArray(value) ? [value] : Array.isArray(value[0]) ? (value as number[][] | boolean[][]).flat() : value as number[] | boolean[];
    const width = flat(first).length;
    const channelIds: string[] = [];
    for (let channel = 0; channel < width; channel++) {
      const id = `${port}_${channel}`, values = Array.from({ length: steps + 1 }, (_, index) => Number(flat(series[Math.min(index, series.length - 1)]!)[channel]));
      nodes.push(m9Node(id, 'source.repeating-sequence', { times: values.map((_, index) => index * step), values, interpolation: 'previous' }, 1, 0, options.units?.[port]));
      if (typeof flat(first)[channel] === 'boolean') {
        nodes.push(m9Node(`${id}_bool`, 'logic.compare-constant', { operator: 'neq', constant: 0 }));
        edges.push(m9Edge(id, `${id}_bool`)); channelIds.push(`${id}_bool`);
      } else channelIds.push(id);
    }
    let producer = channelIds[0]!;
    if (Array.isArray(first)) {
      producer = `${port}_vector`; nodes.push(m9Node(producer, 'route.mux-inputs', { count: width }));
      channelIds.forEach((id, index) => edges.push(m9Edge(id, producer, `in${index + 1}`)));
      if (Array.isArray(first[0])) {
        const vectorId = producer; producer = `${port}_matrix`;
        nodes.push(m9Node(producer, 'matrix.reshape', { form: 'matrix', rows: first.length, columns: first[0].length }));
        edges.push(m9Edge(vectorId, producer));
      }
    }
    edges.push(m9Edge(producer, 'operation', port));
  }
  nodes.push(m9Node('operation', type, parameters, options.period ?? 1, options.offset ?? 0, options.unit), m9Node('result', 'sink.scope'));
  edges.push(m9Edge('operation', 'result'));
  for (const node of nodes) node.sampleTime = { period: options.period ?? 1, offset: options.offset ?? 0 };
  return { schemaVersion: 1, modelId: 'm9-independent-fixture', name: 'M9 independent fixture', nodes, edges, layout: {}, execution: { mode: 'discrete', startTime: 0, stopTime: (steps - 1) * step, step } };
}
export function m9Hybrid(entry: M9Fixture): M9Fixture {
  const model = structuredClone(entry.model), step = model.execution.step;
  model.execution.mode = 'continuous'; model.execution.solver = { discreteStep: step, initialStep: step / 4, maxStep: step / 4, method: 'rk4' };
  for (const node of [...model.nodes]) if (node.blockType === 'source.repeating-sequence') {
    if (node.unit && node.unit !== '1') {
      node.blockType = 'source.sequence-configured'; node.parameters = { values: (node.parameters.values as number[]).slice(0, -1), interpolation: 'previous', samplesPerSegment: 1 };
      continue;
    }
    const id = `${node.id}_hold`, rate = node.sampleTime!;
    for (const edge of model.edges) if (edge.source.nodeId === node.id) edge.source.nodeId = id;
    node.sampleTime = { period: 1, offset: 0 };
    model.nodes.push(m9Node(id, 'time.zero-order-hold', { initial: 0 }, rate.period, rate.offset));
    model.edges.push(m9Edge(node.id, id));
  }
  return { ...structuredClone(entry), name: `${entry.name}-hybrid`, model };
}
const fixture = (name: string, type: string, parameters: Record<string, unknown>, inputs: Record<string, SignalValue[]>, expected: SignalValue[], options: Parameters<typeof m9Model>[3] = {}): M9Fixture => ({ name, model: m9Model(type, parameters, inputs, { ...options, steps: expected.length }), expected: { result: expected } });

/** Expected outputs are literal recurrence calculations independent of runtime kernels. */
export const M9_FIXTURES: M9Fixture[] = [
  ...['df1', 'df1t', 'df2', 'df2t'].map((structure) => fixture(`m9-filter-${structure}-impulse`, 'discrete.filter', { numerator: [1], denominator: [1, -.5], structure }, { in: [1, 0, 0, 0] }, [1, .5, .25, .125])),
  fixture('m9-filter-zinv-degree-gap', 'discrete.filter', { numerator: [1], denominator: [1, -.5], representation: 'filter' }, { in: [1, 0, 0, 0] }, [1, .5, .25, .125]),
  fixture('m9-transfer-descending-z-degree-gap', 'discrete.filter', { numerator: [1], denominator: [1, -.5], representation: 'transfer' }, { in: [1, 0, 0, 0] }, [0, 1, .5, .25]),
  fixture('m9-transfer-leading-normalization', 'discrete.filter', { numerator: [2], denominator: [2, -1], representation: 'transfer' }, { in: [1, 0, 0, 0] }, [0, 1, .5, .25]),
  fixture('m9-df2-initial-state-coordinate', 'discrete.filter', { numerator: [1], denominator: [1, -.5], structure: 'df2', stateInitial: [2] }, { in: [0, 0, 0] }, [1, .5, .25]),
  fixture('m9-df2t-initial-state-coordinate', 'discrete.filter', { numerator: [1], denominator: [1, -.5], structure: 'df2t', stateInitial: [2] }, { in: [0, 0, 0] }, [2, 1, .5]),
  fixture('m9-df2-time-varying-retains-state', 'discrete.filter-time-varying', { order: 1 }, { in: [1, 0, 0], numerator: [[1, 0], [1, 0], [1, 0]], denominator: [[-.5], [-.25], [-.75]] }, [1, .25, .1875]),
  fixture('m9-reset-level-includes-falling-edge', 'discrete.filter', { numerator: [1], denominator: [1, -.5], reset: 'level' }, { in: [1, 1, 1, 1, 1], reset: [false, true, false, false, false] }, [1, 1, 1, 1, 1.5]),
  fixture('m9-reset-level-hold-current-only', 'discrete.filter', { numerator: [1], denominator: [1, -.5], reset: 'level-hold' }, { in: [1, 1, 1, 1, 1], reset: [false, true, false, false, false] }, [1, 1, 1, 1.5, 1.75]),
  fixture('m9-filter-enable-holds-output-and-state', 'discrete.filter', { numerator: [1], denominator: [1, -.5], enable: 'port' }, { in: [1, 2, 3, 4], enable: [true, false, false, true] }, [1, 1, 1, 4.5]),
  fixture('m9-df1-nonzero-combined-state', 'discrete.filter', { numerator: [1, 1], denominator: [1, -.5], structure: 'df1', stateInitial: [2, 3] }, { in: [0, 0, 0] }, [3.5, 1.75, .875]),
  fixture('m9-df1t-nonzero-combined-state', 'discrete.filter', { numerator: [1, 1], denominator: [1, -.5], structure: 'df1t', stateInitial: [2, 3] }, { in: [0, 0, 0] }, [5, 3, 1.5]),
  fixture('m9-filter-vector-independent-channels', 'discrete.filter', { numerator: [1], denominator: [1, -.5], initial: [0, 0] }, { in: [[1, 2], [0, 0], [0, 0]] }, [[1, 2], [.5, 1], [.25, .5]]),
  fixture('m9-filter-matrix-independent-channels', 'discrete.filter', { numerator: [1], denominator: [1, -.5], initial: [[0, 0], [0, 0]] }, { in: [[[1, 2], [3, 4]], [[0, 0], [0, 0]], [[0, 0], [0, 0]]] }, [[[1, 2], [3, 4]], [[.5, 1], [1.5, 2]], [[.25, .5], [.75, 1]]]),
  fixture('m9-pid-integral-forward', 'discrete.pid', { kp: 2, ki: 1, integralMethod: 'forward' }, { in: [1, 1, 1] }, [2, 3, 4]),
  fixture('m9-pid-integral-backward', 'discrete.pid', { kp: 2, ki: 1, integralMethod: 'backward' }, { in: [1, 1, 1] }, [3, 4, 5]),
  fixture('m9-pid-integral-trapezoid', 'discrete.pid', { kp: 2, ki: 1, integralMethod: 'trapezoid' }, { in: [1, 1, 1] }, [2.5, 3.5, 4.5]),
  fixture('m9-pid-filter-forward', 'discrete.pid', { kp: 0, kd: 1, filterN: 1, filterMethod: 'forward' }, { in: [1, 1, 1] }, [1, 0, 0]),
  fixture('m9-pid-filter-backward', 'discrete.pid', { kp: 0, kd: 1, filterN: 1, filterMethod: 'backward' }, { in: [1, 1, 1] }, [.5, .25, .125]),
  fixture('m9-pid-filter-trapezoid', 'discrete.pid', { kp: 0, kd: 1, filterN: 1, filterMethod: 'trapezoid' }, { in: [1, 1, 1] }, [2 / 3, 2 / 9, 2 / 27]),
  fixture('m9-pid-2dof-separate-errors', 'discrete.pid-2dof', { kp: 2, ki: 1, kd: 1, filterN: 1, b: .5, c: 0 }, { reference: [1, 1, 1], measurement: [.25, .25, .25] }, [1.125, 1.9375, 2.71875]),
  fixture('m9-pid-clamping-antiwindup', 'discrete.pid', { kp: 0, ki: 1, limit: 'clamp', lower: -1, upper: 1, antiWindup: 'clamping' }, { in: [1, 1, -1, -1] }, [1, 1, 0, -1]),
  fixture('m9-pid-clamp-without-antiwindup', 'discrete.pid', { kp: 0, ki: 1, limit: 'clamp', lower: -1, upper: 1 }, { in: [1, 1, -1, -1] }, [1, 1, 1, 0]),
  fixture('m9-real-zero-pole-descending-z', 'discrete.zero-pole', { zeros: [], poles: [.5], gain: 1 }, { in: [1, 0, 0, 0] }, [0, 1, .5, .25]),
  fixture('m9-zero-pole-cancelled-real-root', 'discrete.zero-pole', { zeros: [.5], poles: [.5], gain: 2 }, { in: [1, 2, 3] }, [2, 4, 6]),
  fixture('m9-fixed-delay-two-hits', 'discrete.delay-configured', { steps: 2, initial: -1 }, { in: [1, 2, 3, 4] }, [-1, -1, 1, 2]),
  fixture('m9-variable-delay-current-zero-lag', 'discrete.delay-configured', { mode: 'variable', maxDelay: 3, allowZero: 'yes' }, { in: [1, 2, 3], delay: [0, 1, 2] }, [1, 1, 1]),
  fixture('m9-variable-delay-truncate-clamp', 'discrete.delay-configured', { mode: 'variable', maxDelay: 2, allowZero: 'yes', casting: 'truncate-clamp' }, { in: [1, 2, 3], delay: [.9, -4, 99] }, [1, 2, 1]),
  fixture('m9-variable-delay-no-zero-clamp', 'discrete.delay-configured', { mode: 'variable', maxDelay: 2, casting: 'truncate-clamp', initial: -1 }, { in: [1, 2, 3], delay: [0, -4, 99] }, [-1, 1, 1]),
  fixture('m9-delay-external-IC-first-hit-capture', 'discrete.delay-configured', { steps: 2, initialSource: 'port' }, { in: [1, 2, 3, 4], initial: [10, 20, 30, 40] }, [10, 10, 1, 2]),
  fixture('m9-delay-boolean-disabled-initial', 'discrete.delay-configured', { steps: 1, initial: true, enable: 'port' }, { in: [false, false, false], enable: [false, false, true] }, [true, true, true]),
  fixture('m9-tapped-delay-newest', 'discrete.tapped-delay', { taps: 3, initial: -1 }, { in: [1, 2, 3, 4] }, [[-1, -1, -1], [1, -1, -1], [2, 1, -1], [3, 2, 1]]),
  fixture('m9-tapped-delay-oldest-current', 'discrete.tapped-delay', { taps: 3, initial: -1, order: 'oldest', includeCurrent: 'yes' }, { in: [1, 2, 3] }, [[-1, -1, 1], [-1, 1, 2], [1, 2, 3]]),
  fixture('m9-tapped-delay-boolean', 'discrete.tapped-delay', { taps: 2, initial: true }, { in: [false, true, false] }, [[true, true], [false, true], [true, false]]),
  fixture('m9-propagation-floor-publish', 'discrete.propagation-delay', { initial: -1, capacity: 8 }, { in: [1, 2, 3, 4, 5], delay: [2.5, 2.5, 2.5, 2.5, 2.5] }, [-1, -1, 1, 2, 3], { units: { delay: 's' } }),
  fixture('m9-integrator-forward', 'discrete.integrator-configured', { method: 'forward' }, { in: [1, 2, 3] }, [0, 1, 3]),
  fixture('m9-integrator-backward', 'discrete.integrator-configured', { method: 'backward' }, { in: [1, 2, 3] }, [1, 3, 6]),
  fixture('m9-integrator-trapezoid-first-half-input', 'discrete.integrator-configured', { method: 'trapezoid' }, { in: [1, 2, 3] }, [.5, 2, 4.5]),
  fixture('m9-integrator-accumulation-clamp', 'discrete.integrator-configured', { mode: 'accumulation', method: 'backward', limit: 'clamp', lower: -2, upper: 2 }, { in: [1, 2, -5] }, [1, 2, -2], { step: .25 }),
  fixture('m9-mimo-two-inputs-two-outputs', 'discrete.state-space-mimo', { A: [[.5, 0], [0, .5]], B: [[1, 0], [0, 2]], C: [[1, 0], [0, 1]], D: [[1, 0], [0, 0]], initial: [0, 0] }, { in: [[1, 2], [1, 2], [1, 2]] }, [[1, 0], [2, 4], [2.5, 6]]),
  fixture('m9-configured-difference-gain', 'discrete.difference-configured', { gain: 2 }, { in: [1, 3, 2] }, [2, 4, -2]),
  fixture('m9-configured-derivative-physical-Ts', 'discrete.difference-configured', { operation: 'derivative', gain: 2 }, { in: [1, 3, 2] }, [8, 16, -8], { step: .25 }),
  fixture('m9-running-min', 'math.running-minmax', { initial: 10, operation: 'min' }, { in: [4, 6, 2] }, [4, 4, 2]),
  fixture('m9-running-max-vector', 'math.running-minmax', { initial: [0, 0], operation: 'max' }, { in: [[1, 5], [4, 3], [2, 8]] }, [[1, 5], [4, 5], [4, 8]]),
  fixture('m9-weighted-time-only', 'time.weighted-math', { operation: 'TsOnly', weight: 3 }, {}, [.75, .75, .75], { step: .25 }),
  fixture('m9-weighted-time-inverse', 'time.weighted-math', { operation: 'inverse', weight: 2 }, {}, [2, 2, 2], { step: .25 }),
  fixture('m9-time-decrement-zero', 'time.decrement-to-zero', {}, { in: [2, 1, .5] }, [1, 0, 0], { units: { in: 's' } }),
  fixture('m9-first-due-initial-condition', 'signal.initial-condition', { initial: -1 }, { in: [1, 2, 3] }, [-1, 2, 3]),
  fixture('m9-first-due-boolean-matrix-initial', 'signal.initial-condition', { initial: [[true, false]] }, { in: [[[false, true]], [[false, true]], [[true, true]]] }, [[[true, false]], [[false, true]], [[true, true]]]),
  fixture('m9-band-limited-noise-PSD-and-consumed-seed', 'source.band-limited-noise', { noisePower: 1, seed: 1 }, {}, [-1.1568343541568942, -.3273030939168647, -1.667173256882052]),
  fixture('m9-counter-free-wrap', 'source.counter', { mode: 'free', bits: 2, initial: 2 }, {}, [2, 3, 0, 1, 2]),
  fixture('m9-counter-limited-wrap', 'source.counter', { mode: 'limited', upper: 2 }, {}, [0, 1, 2, 0, 1]),
  fixture('m9-pwm-cycle-start-duty-latch', 'source.pwm', { period: 4 }, { duty: [.5, 1, 1, 1, 1, 0, 0, 0] }, [1, 1, 0, 0, 1, 1, 1, 1]),
  fixture('m9-variable-pulse-cycle-period-latch', 'source.variable-pulse', {}, { duty: [.5, 1, 1, 1, 1, 0], period: [4, 2, 2, 2, 2, 2] }, [1, 1, 0, 0, 1, 1], { units: { period: 's' } }),
  fixture('m9-signal-generator-Hz-square', 'source.signal-generator', { waveform: 'square', frequency: .25 }, {}, [1, 1, -1, -1, 1]),
  fixture('m9-signal-generator-radians-sine', 'source.signal-generator', { waveform: 'sine', frequencyUnit: 'rad/s', frequency: Math.PI / 2 }, {}, [0, 1, 0, -1]),
  fixture('m9-signal-generator-sawtooth', 'source.signal-generator', { waveform: 'sawtooth', frequency: .25 }, {}, [-1, -.5, 0, .5, -1]),
  fixture('m9-sine-configured-sample-count', 'source.sine-configured', { samplesPerPeriod: 4 }, {}, [0, 1, 0, -1, 0]),
  fixture('m9-sine-configured-time-radians-vector', 'source.sine-configured', { mode: 'time', frequency: Math.PI / 2, amplitude: [1, 2], bias: [0, 1] }, {}, [[0, 1], [1, 3], [0, 1], [-1, -1]]),
  fixture('m9-sequence-configured-stair', 'source.sequence-configured', { values: [1, 3], samplesPerSegment: 2 }, {}, [1, 1, 3, 3, 1]),
  fixture('m9-sequence-configured-linear-wrap', 'source.sequence-configured', { values: [1, 3], samplesPerSegment: 2, interpolation: 'linear' }, {}, [1, 2, 3, 2, 1]),
  fixture('m9-random-configured-normal-vector', 'source.random-configured', { mean: [0, 1], variance: [1, 4], seed: 1 }, {}, [[-1.1568343541568942, .3453938121662706], [-1.667173256882052, -.3407165698343482], [-1.8368117529730532, -1.94002126266391]]),
  fixture('m9-gradient-strict-absolute-difference', 'verify.gradient', { maximumGradient: 2, initial: 0 }, { in: [1, 2, 3] }, [true, true, true], { step: .01 }),
  fixture('m9-resolution-modulus-positive-and-negative', 'verify.resolution', { resolution: .25 }, { in: [[-.5, .75], [0, 1], [1.5, -1]] }, [true, true, true]),
  ...([
    ['change', [true, true, true, true, true]], ['increase', [false, true, true, false, false]], ['decrease', [true, false, false, true, true]],
    ['fall-negative', [true, false, false, false, true]], ['fall-nonpositive', [false, false, false, true, false]], ['rise-nonnegative', [false, true, false, false, false]], ['rise-positive', [false, false, true, false, false]],
  ] as [string, boolean[]][]).map(([mode, expected]) => fixture(`m9-detect-${mode}`, 'logic.numeric-edge', { mode, initial: 0 }, { in: [-1, 0, 1, 0, -1] }, expected)),
  ...(['add', 'subtract', 'multiply', 'divide'] as const).map(operation => fixture(`m9-weighted-time-${operation}`, 'time.weighted-math', { operation, weight: 2 }, { in: [2, 2, 2] }, Array(3).fill(operation === 'add' ? 2.5 : operation === 'subtract' ? 1.5 : operation === 'multiply' ? 1 : 4), { step: .25, units: { in: operation === 'add' || operation === 'subtract' ? 's' : '1' } })),
  fixture('m9-counter-reset-rising', 'source.counter', { mode: 'limited', upper: 3, reset: 'rising' }, { reset: [false, true, true, false, false] }, [0, 0, 0, 1, 2]),
  fixture('m9-counter-reset-falling', 'source.counter', { mode: 'limited', upper: 3, reset: 'falling' }, { reset: [true, true, false, false, false] }, [0, 1, 0, 0, 1]),
  fixture('m9-counter-reset-either', 'source.counter', { mode: 'limited', upper: 3, reset: 'either' }, { reset: [false, true, true, false, false] }, [0, 0, 0, 0, 0]),
  fixture('m9-reset-priority-over-disabled-enable', 'discrete.delay-configured', { steps: 1, initial: 10, reset: 'rising', enable: 'port' }, { in: [1, 2, 3, 4], reset: [false, true, false, false], enable: [true, false, false, true] }, [10, 10, 10, 10]),
  fixture('m9-delay-external-IC-reset-capture', 'discrete.delay-configured', { steps: 1, initialSource: 'port', reset: 'rising' }, { in: [1, 2, 3, 4], initial: [10, 20, 30, 40], reset: [false, true, false, false] }, [10, 20, 20, 3]),
  fixture('m9-zero-delay-direct-fixed', 'discrete.delay-configured', { steps: 0, allowZero: 'yes' }, { in: [1, 2, 3] }, [1, 2, 3]),
  fixture('m9-mimo-no-feedthrough-nonzero-state', 'discrete.state-space-mimo', { A: [[.5]], B: [[1]], C: [[2]], D: [[0]], initial: [1] }, { in: [[1], [1], [1]] }, [[2], [3], [3.5]]),
  fixture('m9-integrator-vector-initial', 'discrete.integrator-configured', { method: 'backward', initial: [1, 2], gain: 2 }, { in: [[1, 2], [1, 2], [1, 2]] }, [[2, 4], [3, 6], [4, 8]], { step: .5 }),
  fixture('m9-difference-matrix-initial', 'discrete.difference-configured', { initial: [[1, 2]] }, { in: [[[2, 4]], [[3, 7]], [[3, 7]]] }, [[[1, 2]], [[1, 3]], [[0, 0]]]),
  fixture('m9-sine-configured-offset-phase', 'source.sine-configured', { samplesPerPeriod: 4, offset: 1, amplitude: 2, bias: 1 }, {}, [3, 1, -1, 1]),
  fixture('m9-source-offset-first-due-count', 'source.counter', { mode: 'limited', upper: 3 }, {}, [0, 0, 0, 1, 1, 2], { period: 2, offset: 1 }),
  fixture('m9-weighted-Ts-uses-node-period', 'time.weighted-math', { operation: 'TsOnly', weight: 2 }, {}, [1, 1, 1, 1, 1], { period: 2, step: .25 }),
  fixture('m9-pwm-delayed-first-cycle', 'source.pwm', { period: 2, delay: 1 }, { duty: [.5, .5, .5, .5, .5] }, [0, 1, 0, 1, 0]),
  fixture('m9-sequence-single-value', 'source.sequence-configured', { values: [7], interpolation: 'linear', samplesPerSegment: 2 }, {}, [7, 7, 7]),
  fixture('m9-random-configured-uniform-vector', 'source.random-configured', { distribution: 'uniform', min: [0, 10], max: [1, 20], seed: 1 }, {}, [[.23645552538800985, 13.692706738365814], [.5042420324170962, 17.048832637956366], [.05054362874943763, 13.695183544186875]]),
  fixture('m9-signal-generator-random-midpoint', 'source.signal-generator', { waveform: 'random', seed: 1 }, {}, [-.5270889492239803, -.2614586523268372, .008484064834192395]),
  fixture('m9-bandlimited-noise-channel-PSD', 'source.band-limited-noise', { noisePower: [1, 4], seed: 1 }, {}, [[-1.1568343541568942, -.6546061878337294], [-1.667173256882052, -1.3407165698343482], [-1.8368117529730532, -2.94002126266391]]),
  fixture('m9-random-normal-zero-variance-still-consumes-draw', 'source.random-configured', { mean: 7, variance: 0 }, {}, [7, 7, 7]),
  fixture('m9-causal-filter-unused-state-overflow-df2', 'discrete.filter', { numerator: [0, 1], denominator: [1, -1, -1], structure: 'df2', stateInitial: [.75 * Number.MAX_VALUE, .75 * Number.MAX_VALUE] }, { in: [-Number.MAX_VALUE, -Number.MAX_VALUE] }, [.75 * Number.MAX_VALUE, 8.988465674311578e307]),
  fixture('m9-causal-filter-unused-state-overflow-df2t', 'discrete.filter', { numerator: [0, 1, 0], denominator: [1, -1, 0], structure: 'df2t', stateInitial: [.75 * Number.MAX_VALUE, .75 * Number.MAX_VALUE] }, { in: [-Number.MAX_VALUE, 0] }, [.75 * Number.MAX_VALUE, 8.988465674311578e307]),
  fixture('m9-causal-filter-unused-state-overflow-df1t', 'discrete.filter', { numerator: [0, 1], denominator: [1, -1, -1], structure: 'df1t', stateInitial: [.75 * Number.MAX_VALUE, .75 * Number.MAX_VALUE, 0] }, { in: [-Number.MAX_VALUE, 0] }, [0, -4.49423283715579e307]),
  fixture('m9-sequence-subnormal-constant', 'source.sequence-configured', { values: [Number.MIN_VALUE, Number.MIN_VALUE], interpolation: 'linear', samplesPerSegment: 2 }, {}, [Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE]),
  fixture('m9-sequence-subnormal-tie', 'source.sequence-configured', { values: [Number.MIN_VALUE, 2 * Number.MIN_VALUE], interpolation: 'linear', samplesPerSegment: 2 }, {}, [Number.MIN_VALUE, 2 * Number.MIN_VALUE, 2 * Number.MIN_VALUE]),
  fixture('m9-numeric-change-boolean', 'logic.numeric-edge', { mode: 'change', initial: false }, { in: [false, true, true] }, [false, true, false]),
  fixture('m9-propagation-decimal-grid-due-ticks', 'discrete.propagation-delay', { initial: -1, capacity: 32 }, { in: Array.from({ length: 31 }, (_, i) => i + 1), delay: [2.05] }, [...Array(20).fill(-1), ...Array.from({ length: 11 }, (_, i) => i + 1)], { step: .1, units: { delay: 's' } }),
  fixture('m9-pid-nonzero-integral-state', 'discrete.pid', { kp: 0, ki: 1, integralInitial: 7 }, { in: [1, 1, 1] }, [8, 9, 10]),
  fixture('m9-pid-nonzero-filter-state', 'discrete.pid', { kp: 0, kd: 1, filterN: 1, filterInitial: .5 }, { in: [1, 1, 1] }, [.25, .125, .0625]),
  fixture('m9-integrator-matrix-channels', 'discrete.integrator-configured', { method: 'forward', initial: [[1, 2]], gain: 2 }, { in: [[[1, 2]], [[1, 2]], [[1, 2]]] }, [[[1, 2]], [[2, 4]], [[3, 6]]], { step: .5 }),
  fixture('m9-gradient-vector-negative-limit-absolute', 'verify.gradient', { maximumGradient: -2, initial: [0, 0] }, { in: [[1, -1], [2, -2], [1, -1]] }, [true, true, true]),
  fixture('m9-pwm-zero-duty', 'source.pwm', { period: 2 }, { duty: [0, 0, 0] }, [0, 0, 0]),
  fixture('m9-pwm-fractional-period-floor', 'source.pwm', { period: 3.5 }, { duty: [.5, .5, .5, .5] }, [1, 0, 0, 1]),
  fixture('m9-counter-53-bit-safe-wrap', 'source.counter', { mode: 'free', bits: 53, initial: Number.MAX_SAFE_INTEGER }, {}, [Number.MAX_SAFE_INTEGER, 0, 1]),
  fixture('m9-counter-limited-upper-zero', 'source.counter', { mode: 'limited', upper: 0 }, {}, [0, 0, 0]),
  fixture('m9-random-normal-matrix-channels', 'source.random-configured', { mean: [[0, 1]], variance: [[0, 4]] }, {}, [[[0, .3453938121662706]], [[0, -.3407165698343482]], [[0, -1.94002126266391]]]),
  fixture('m9-band-limited-noise-Ts-quarter', 'source.band-limited-noise', { noisePower: 1 }, {}, [-2.3136687083137884, -.6546061878337294, -3.334346513764104], { step: .25 }),
  fixture('m9-pid-zero-D-skips-unused-overflow', 'discrete.pid', { kp: 1, ki: 0, kd: 0 }, { in: [Number.MAX_VALUE, Number.MAX_VALUE] }, [Number.MAX_VALUE, Number.MAX_VALUE]),
  fixture('m9-pid-backward-filter-scaled-finite-state', 'discrete.pid', { kp: 0, kd: 1, filterN: 1 }, { in: [Number.MAX_VALUE, Number.MAX_VALUE] }, [.5 * Number.MAX_VALUE, .25 * Number.MAX_VALUE]),
  fixture('m9-pid-trapezoid-filter-finite-sum', 'discrete.pid', { kp: 0, kd: 1, filterN: 1, filterMethod: 'trapezoid' }, { in: [Number.MAX_VALUE, Number.MAX_VALUE] }, [2 / 3 * Number.MAX_VALUE, 2 / 9 * Number.MAX_VALUE]),
  fixture('m9-pid-zero-I-trapezoid-skips-unused-overflow', 'discrete.pid', { kp: 1, ki: 0, kd: 0, integralMethod: 'trapezoid' }, { in: [Number.MAX_VALUE, Number.MAX_VALUE] }, [Number.MAX_VALUE, Number.MAX_VALUE]),
  fixture('m9-pid-trapezoid-integral-finite-average', 'discrete.pid', { kp: 0, ki: 1, kd: 0, integralInitial: -Number.MAX_VALUE, integralMethod: 'trapezoid' }, { in: [Number.MAX_VALUE, Number.MAX_VALUE] }, [-.875 * Number.MAX_VALUE, -.625 * Number.MAX_VALUE], { step: .25 }),
  fixture('m9-integrator-trapezoid-finite-average', 'discrete.integrator-configured', { initial: -Number.MAX_VALUE, method: 'trapezoid' }, { in: [Number.MAX_VALUE, Number.MAX_VALUE] }, [-.875 * Number.MAX_VALUE, -.625 * Number.MAX_VALUE], { step: .25 }),
  fixture('m9-derivative-large-gain-small-difference-finite', 'discrete.difference-configured', { operation: 'derivative', gain: Number.MAX_VALUE }, { in: [1e-308, 1e-308, 1e-308] }, [17.976931348623154, 0, 0], { step: .1 }),
  fixture('m9-difference-zero-gain-unused-extreme-gap', 'discrete.difference-configured', { gain: 0, initial: -1e308 }, { in: [1e308, 1e308, 1e308] }, [0, 0, 0]),
  fixture('m9-pid-2dof-unused-extreme-P-weight', 'discrete.pid-2dof', { kp: 0, ki: 0, kd: 0, b: 1e308 }, { reference: [1e308, 1e308, 1e308], measurement: [0, 0, 0] }, [0, 0, 0]),
];
M9_FIXTURES.find(entry => entry.name === 'm9-band-limited-noise-PSD-and-consumed-seed')!.expectedMemory = { operation: { previousReset: false, previousOutput: -1.667173256882052, seed: 1587069247 } };
M9_FIXTURES.find(entry => entry.name === 'm9-pid-filter-backward')!.expectedMemory = { operation: { previousReset: false, previousOutput: .25, integral: [0], derivative: [.75], previousError: [1, 1] } };
M9_FIXTURES.find(entry => entry.name === 'm9-integrator-trapezoid-first-half-input')!.expectedMemory = { operation: { previousReset: false, previousOutput: 2, value: 2, previousInput: 2 } };
M9_FIXTURES.find(entry => entry.name === 'm9-propagation-floor-publish')!.expectedMemory = { operation: { previousReset: false, previousOutput: 2, value: 3, queue: [{ arrival: 5, tick: 5, value: 4 }], lastArrival: 5.5 } };
M9_FIXTURES.find(entry => entry.name === 'm9-filter-df2t-impulse')!.expectedMemory = { operation: { previousReset: false, previousOutput: .25, slots: [[.125]] } };
M9_FIXTURES.find(entry => entry.name === 'm9-counter-free-wrap')!.expectedMemory = { operation: { previousReset: false, previousOutput: 1, count: 2 } };
M9_FIXTURES.find(entry => entry.name === 'm9-delay-external-IC-first-hit-capture')!.expectedMemory = { operation: { previousReset: false, previousOutput: 1, count: 2, value: 10, initialized: true, history: [3, 2] } };
const hybridIds = new Set<string>();
for (const entry of [...M9_FIXTURES]) {
  const id = entry.model.nodes.find(node => node.id === 'operation')!.blockType;
  if (id === 'verify.gradient' || hybridIds.has(id)) continue;
  hybridIds.add(id); M9_FIXTURES.push(m9Hybrid(entry));
}
const physicalNoise = m9Hybrid(M9_FIXTURES.find(entry => entry.name === 'm9-band-limited-noise-Ts-quarter')!);
physicalNoise.name = 'm9-hybrid-noise-physical-Ts-not-output-grid'; physicalNoise.model.execution.step = .125;
physicalNoise.expected.result = [-2.3136687083137884, -2.3136687083137884, -.6546061878337294, -.6546061878337294, -3.334346513764104];
M9_FIXTURES.push(physicalNoise);
M9_FIXTURES.push(m9Hybrid(M9_FIXTURES.find(entry => entry.name === 'm9-variable-delay-truncate-clamp')!));
M9_FIXTURES.push(m9Hybrid(M9_FIXTURES.find(entry => entry.name === 'm9-running-max-vector')!));
M9_FIXTURES.push(m9Hybrid(M9_FIXTURES.find(entry => entry.name === 'm9-weighted-time-multiply')!));
export const M9_FAILURE_FIXTURES: M9FailureFixture[] = [
  { name: 'm9-gradient-strict-equality-rejected', model: m9Model('verify.gradient', { maximumGradient: 1 }, { in: [0, 1, 1] }), code: 'VERIFY_VIOLATION', nodeId: 'operation', tick: 1, time: 1 },
  { name: 'm9-resolution-tolerance-equality-rejected', model: m9Model('verify.resolution', { resolution: 1, tolerance: .125 }, { in: [0, .125, 0] }), code: 'VERIFY_VIOLATION', nodeId: 'operation', tick: 1, time: 1 },
  { name: 'm9-variable-delay-strict-fraction-rejected', model: m9Model('discrete.delay-configured', { mode: 'variable', maxDelay: 2 }, { in: [1, 2, 3], delay: [1, 1.5, 1] }), code: 'DELAY_RANGE', nodeId: 'operation', tick: 1, time: 1 },
  { name: 'm9-propagation-last-sample-delay-invalid', model: m9Model('discrete.propagation-delay', { capacity: 8 }, { in: [1, 2, 3], delay: [2, 2, 1] }, { units: { delay: 's' } }), code: 'PROPAGATION_DELAY_RANGE', nodeId: 'operation', tick: 2, time: 2 },
  { name: 'm9-propagation-last-sample-arrival-equality', model: m9Model('discrete.propagation-delay', { capacity: 8 }, { in: [1, 2, 3], delay: [4, 4, 3] }, { units: { delay: 's' } }), code: 'PROPAGATION_DELAY_ORDER', nodeId: 'operation', tick: 2, time: 2 },
  { name: 'm9-propagation-capacity-exhausted', model: m9Model('discrete.propagation-delay', { capacity: 1 }, { in: [1, 2, 3], delay: [10, 10, 10] }, { units: { delay: 's' } }), code: 'PROPAGATION_DELAY_CAPACITY', nodeId: 'operation', tick: 1, time: 1 },
  { name: 'm9-variable-pulse-last-duty-invalid', model: m9Model('source.variable-pulse', {}, { duty: [1, 1, 2], period: [1, 1, 1] }, { units: { period: 's' } }), code: 'PULSE_DUTY_RANGE', nodeId: 'operation', tick: 2, time: 2 },
  { name: 'm9-dynamic-filter-finite-coefficients-overflow', model: m9Model('discrete.filter-time-varying', { order: 1 }, { in: [2, 2, 2], numerator: [[Number.MAX_VALUE, 0]], denominator: [[0]] }), code: 'NUMERIC_NONFINITE', nodeId: 'operation', tick: 0, time: 0 },
  { name: 'm9-pid-finite-gains-overflow', model: m9Model('discrete.pid', { kp: Number.MAX_VALUE }, { in: [2, 2, 2] }), code: 'NUMERIC_NONFINITE', nodeId: 'operation', tick: 0, time: 0 },
];
export function m9RollbackModel(): CalcModel {
  const model = m9Model('source.band-limited-noise', { noisePower: 1, seed: 1 }, {}, { steps: 3 });
  model.nodes.push(m9Node('violation_source', 'source.sequence-configured', { values: [0, 0, 1] }), m9Node('z_check', 'verify.gradient', { maximumGradient: 1 }), m9Node('assertion', 'sink.scope'));
  model.edges.push(m9Edge('violation_source', 'z_check'), m9Edge('z_check', 'assertion'));
  return model;
}
M9_FAILURE_FIXTURES.push({ name: 'm9-noise-publication-rollback-after-last-assertion', model: m9RollbackModel(), code: 'VERIFY_VIOLATION', nodeId: 'z_check', tick: 2, time: 2 });
export const M9_PRESET_FIXTURES: (M9Fixture & { presetId: string })[] = [
  { ...fixture('m9-preset-fir', 'discrete.filter', { numerator: [1, 2], denominator: [1] }, { in: [1, 0, 0] }, [1, 2, 0]), presetId: 'fir-configured' },
  { ...fixture('m9-preset-transfer', 'discrete.filter', { representation: 'transfer', numerator: [1], denominator: [1, -.5] }, { in: [1, 0, 0] }, [0, 1, .5]), presetId: 'transfer-configured' },
  { ...fixture('m9-preset-df2', 'discrete.filter', { structure: 'df2', numerator: [1], denominator: [1, -.5] }, { in: [1, 0, 0] }, [1, .5, .25]), presetId: 'direct-form-ii' },
  { ...fixture('m9-preset-first-order', 'discrete.filter', { numerator: [.5, 0], denominator: [1, -.5], representation: 'transfer' }, { in: [1, 1, 1] }, [.5, .75, .875]), presetId: 'first-order-response' },
  { ...fixture('m9-preset-lead-lag', 'discrete.filter', { numerator: [1, -.25], denominator: [1, -.5], representation: 'transfer' }, { in: [1, 1, 1] }, [1, 1.25, 1.375]), presetId: 'lead-lag-response' },
  { ...fixture('m9-preset-real-zero', 'discrete.filter', { numerator: [1, -.5], denominator: [1] }, { in: [1, 1, 1] }, [1, .5, .5]), presetId: 'real-zero-response' },
  { ...fixture('m9-preset-weighted-sample-time', 'time.weighted-math', { operation: 'TsOnly' }, {}, [.25, .25, .25], { step: .25 }), presetId: 'weighted-sample-time' },
  { ...fixture('m9-preset-limited-counter', 'source.counter', { mode: 'limited', upper: 2 }, {}, [0, 1, 2, 0]), presetId: 'limited-counter' },
  ...M9_FIXTURES.filter(entry => entry.name.startsWith('m9-detect-') && !entry.name.endsWith('-hybrid')).map(entry => ({ ...entry, name: entry.name.replace('m9-detect-', 'm9-preset-detect-'), presetId: entry.name.replace('m9-', '') })),
];
for (const entry of [...M9_PRESET_FIXTURES]) M9_PRESET_FIXTURES.push({ ...m9Hybrid(entry), presetId: entry.presetId });
