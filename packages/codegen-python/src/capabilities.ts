/** Lightweight, frozen target metadata shared with the block registry. No runtime imports. */
export const PYTHON_TARGET = Object.freeze({
  id: 'python-m7-v1' as const, label: 'Python' as const, minimumVersion: '3.10' as const,
  supportedModes: Object.freeze(['static', 'discrete'] as const),
  blockIds: Object.freeze([
    'source.constant', 'io.input', 'math.gain', 'math.sum', 'math.multiply', 'math.abs', 'math.function',
    'math.trigonometric', 'math.round', 'math.minmax', 'math.sqrt', 'logic.compare', 'logic.boolean',
    'route.switch', 'nonlinear.saturation', 'route.mux', 'route.demux', 'math.concatenate', 'matrix.reshape',
    'io.output', 'io.terminator', 'sink.display', 'sink.scope', 'math.expression',
    'source.step', 'source.ramp', 'source.sine-wave', 'source.pulse', 'source.clock', 'source.digital-clock',
    'source.random', 'source.repeating-sequence', 'discrete.unit-delay', 'discrete.delay', 'discrete.integrator',
    'discrete.difference', 'discrete.derivative', 'discrete.fir', 'discrete.transfer-function', 'discrete.state-space',
    'logic.edge-detect', 'time.rate-transition', 'lookup.interpolated', 'logic.bitwise',
    'source.dataset', 'unit.convert', 'route.bus-create', 'route.bus-select', 'annotation.note', 'annotation.model-info',
    // The compiler expands a subsystem; every resulting primitive must pass the same allowlist.
    'hierarchy.subsystem',
  ] as readonly string[]),
});
