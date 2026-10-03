import { useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { getBlockDefinition, getBlockPorts } from '../../../../packages/block-library/src';
import { isDefinitionReference } from '../../../../packages/block-library/src/m11';
import type { CalcNode, SignalValue } from '../../../../packages/model/src';
import { validateTypedSignal } from '../../../../packages/model/src';
import { fixedCellText, signalSummary, typedCellText } from './SignalResult';

// A compact preview; the complete number remains in the inspector/result and tooltip.
function compactNumber(value: number) {
  if (value === 0) return '0';
  const exact = String(value);
  if (exact.length <= 8) return exact;
  const roundedNumber = Number(value.toPrecision(5));
  const rounded = String(roundedNumber);
  if (Number.isFinite(roundedNumber) && rounded.length <= 8) return rounded;
  for (let digits = 3; digits >= 0; digits--) {
    const scientific = value.toExponential(digits).replace('e+', 'e');
    if (scientific.length <= 8) return scientific;
  }
  return value.toExponential(0).replace('e+', 'e');
}

export const BLOCK_SYMBOLS: Record<string, string> = {
  'source.constant': '1', 'io.input': '↗', 'math.gain': '×', 'math.sum': '+',
  'math.multiply': '∏', 'sink.display': '▥', 'discrete.unit-delay': 'z⁻¹', 'continuous.integrator': '∫',
  'math.abs': '|x|', 'math.function': 'f', 'math.trigonometric': 'sin', 'math.round': '≈', 'math.minmax': '↧',
  'math.sqrt': '√', 'logic.compare': '<', 'logic.boolean': '∧', 'route.switch': '?', 'nonlinear.saturation': '↔',
  'route.mux': '⊞', 'route.demux': '⇉', 'math.concatenate': '⊕', 'matrix.reshape': '↔', 'io.output': '↗',
  'io.terminator': '⊣', 'math.expression': 'fx',
  'source.step': '⌐', 'source.ramp': '∕', 'source.sine-wave': '∿', 'source.pulse': '⌜',
  'source.clock': 't', 'source.digital-clock': 'tₖ', 'source.random': '⚄', 'source.repeating-sequence': '↻',
  'discrete.delay': 'z⁻ⁿ', 'discrete.integrator': 'Σ', 'discrete.difference': 'Δ', 'discrete.derivative': 'Δt',
  'discrete.fir': 'FIR', 'discrete.transfer-function': 'H', 'discrete.state-space': 'xₖ',
  'logic.edge-detect': '↑', 'time.rate-transition': 'RT', 'lookup.interpolated': '▱', 'logic.bitwise': '&', 'sink.scope': '▥',
  'continuous.second-order-integrator': '∫²', 'continuous.state-space': 'ẋ', 'continuous.transfer-function': 'H(s)',
  'continuous.zero-pole': 'ZP', 'continuous.pid': 'PID', 'continuous.derivative': 'd/dt',
  'time.memory': 'M', 'time.zero-order-hold': 'ZOH', 'time.first-order-hold': 'FOH', 'time.transport-delay': 'τ',
  'logic.hit-crossing': '↗', 'nonlinear.relay': '⇄',
  'source.dataset': '▤', 'unit.convert': '↔', 'route.bus-create': '⊞', 'route.bus-select': '⇥',
  'hierarchy.subsystem': '▦', 'annotation.note': '¶', 'annotation.model-info': 'i',
  'math.matrix-multiply': 'AB', 'matrix.transpose': 'Aᵀ', 'matrix.determinant': '|A|',
  'matrix.inverse': 'A⁻¹', 'matrix.solve': 'A\\b', 'matrix.cholesky': 'LLᵀ', 'matrix.lu': 'LU',
  'lookup.2d': '▦', 'lookup.prelookup': 'k,f', 'fixed.quantize': 'Q',
  'math.bias': '+b', 'math.sign': '±', 'math.cbrt': '∛', 'math.expm1': 'eˣ−1', 'math.log1p': 'ln1+',
  'math.log2': 'log₂', 'math.exp2': '2ˣ', 'math.sinh': 'sh', 'math.cosh': 'ch', 'math.tanh': 'th',
  'math.asinh': 'ash', 'math.acosh': 'ach', 'math.atanh': 'ath', 'math.sinc': 'sinc', 'math.polynomial': 'P(x)',
  'math.power': 'xʸ', 'math.hypot': '√∑', 'math.atan2': 'θ', 'math.mod': 'mod', 'math.remainder': 'rem',
  'nonlinear.dead-zone': 'DZ', 'nonlinear.quantizer': 'QΔ', 'logic.interval': '[ ]', 'logic.is-integer': 'ℤ', 'logic.approx-equal': '≈',
  'reduce.sum': 'Σ', 'reduce.product': 'Π', 'reduce.mean': 'μ', 'reduce.median': 'Med', 'reduce.variance': 'σ²',
  'reduce.std': 'σ', 'reduce.rms': 'RMS', 'reduce.norm1': 'L₁', 'reduce.norm2': 'L₂', 'reduce.norm-inf': 'L∞',
  'reduce.all': '∀', 'reduce.any': '∃', 'vector.dot': '·', 'vector.cross': '×', 'vector.normalize': 'v̂',
  'vector.reverse': '⇆', 'vector.sort': '↕', 'vector.cumsum': 'Σₖ', 'vector.cumprod': 'Πₖ', 'vector.difference': 'Δv',
  'vector.select': 'vᵢ', 'vector.slice': '[i:j]', 'vector.repeat': '↻', 'vector.convolve': '∗',
  'matrix.trace': 'tr', 'matrix.diagonal': '↘', 'matrix.diag-create': 'D', 'matrix.identity': 'I', 'matrix.select': 'Aᵢⱼ',
  'matrix.row': 'Aᵢ', 'matrix.column': 'Aⱼ', 'matrix.horizontal': 'A|B', 'matrix.vertical': 'A/B',
  'matrix.triangle': '△', 'matrix.symmetrize': 'S', 'matrix.kronecker': '⊗',
  'source.linspace': 'Lin', 'source.logspace': 'Log', 'source.zeros': '0', 'source.chirp': 'f↗',
  'source.gaussian-pulse': 'G', 'source.damped-sine': 'e∿', 'source.exponential': 'eˣ', 'source.logistic': 'S', 'source.sinc-pulse': 'sinc',
  'discrete.filter': 'H', 'discrete.filter-time-varying': 'Hₖ', 'discrete.pid': 'PID', 'discrete.pid-2dof': 'PID',
  'discrete.zero-pole': 'ZP', 'discrete.delay-configured': 'z⁻ⁿ', 'discrete.tapped-delay': '⇉', 'discrete.propagation-delay': 'τ',
  'discrete.integrator-configured': 'Σ', 'discrete.state-space-mimo': 'xₖ', 'discrete.difference-configured': 'Δ',
  'logic.numeric-edge': '↗', 'math.running-minmax': '↧', 'time.weighted-math': 'Tₛ', 'time.decrement-to-zero': 'T−',
  'signal.initial-condition': 'IC', 'source.band-limited-noise': '⚄', 'source.counter': 'k', 'source.pwm': '⌜',
  'source.variable-pulse': '⌜', 'source.signal-generator': '∿', 'source.sine-configured': '∿',
  'source.sequence-configured': '↻', 'source.random-configured': '⚄', 'verify.gradient': 'Δ?', 'verify.resolution': 'Q?',
  'source.typed': 'T', 'source.enum': 'E', 'signal.cast': 'T→', 'signal.cast-inherited': 'T↘', 'signal.to-legacy': '↗',
  'signal.type-duplicate': 'T=', 'signal.type-propagation': 'T←', 'signal.scaling-strip': 'Q→', 'signal.representation': '↔',
  'signal.specification': 'T?', 'signal.width': 'n', 'signal.bus-to-vector': '⇥', 'signal.unit-system': 'SI',
  'logic.bit-mask': 'bit', 'logic.extract-bits': '[b]', 'logic.float-extract-bits': 'IEEE', 'logic.integer-to-bits': '→b',
  'logic.bits-to-integer': 'b→', 'logic.shift-arithmetic': '≫', 'logic.bitwise-typed': '&', 'fixed.integer-increment': '+1',
  'fixed.trigonometric': 'sin', 'fixed.state-space': 'Qx', 'complex.from-parts': '+i', 'complex.to-parts': 'Re',
  'complex.from-polar': '∠', 'complex.to-polar': '|z|', 'complex.hermitian': 'Aᴴ', 'complex.is-hermitian': 'H?',
  'typed.math': 'T+', 'tensor.reshape': '↔', 'tensor.permute': '⇄', 'tensor.squeeze': '⇥',
  'source.signal': '{ }', 'hierarchy.atomic': '▦', 'hierarchy.enabled': 'E', 'hierarchy.triggered': '↗',
  'hierarchy.enabled-triggered': 'E↗', 'hierarchy.resettable': '↺', 'hierarchy.action': '?', 'hierarchy.function-call': 'f()',
  'hierarchy.for-iterator': 'for', 'hierarchy.while-iterator': 'while', 'hierarchy.for-each': 'each', 'hierarchy.variant': '◇',
  'hierarchy.array-processing': '[ ]', 'hierarchy.neighborhood-processing': '▦', 'hierarchy.pixel-processing': '·',
  'functions.call': 'f()', 'functions.initialize': 'f₀', 'functions.reinitialize': '↺f', 'functions.reset': '↺', 'functions.terminate': 'f₁',
  'functions.element': 'f', 'functions.typed': 'f(x)', 'hierarchy.if': 'if', 'hierarchy.switch-case': 'case',
  'route.structured-bus': '{ }', 'route.structured-select': '{}→', 'route.structured-assign': '→{}',
  'events.send': '↑', 'events.queue': 'Q', 'events.receive': '↓', 'events.message-merge': '⇉',
  'events.function-call-generator': 'f↗', 'events.function-call-split': 'f⇉', 'events.feedback-latch': 'z⁻¹', 'events.hit-scheduler': 't↗',
  'route.merge': '⇉', 'route.goto': '→G', 'route.from': 'G→', 'route.tag-visibility': 'G',
  'route.data-store-memory': 'D', 'route.data-store-read': 'D→', 'route.data-store-write': '→D',
  'state.reader': 'x→', 'state.writer': '→x', 'state.parameter-writer': '→p', 'sink.sequence-viewer': '⇅',
  'io.structured-input': '{}→', 'io.structured-output': '→{}',
};

export function blockTone(type: string) {
  if (type.startsWith('sink.') || type === 'io.output' || type === 'io.terminator') return 'output';
  if (type.startsWith('source.') || type === 'io.input') return 'input';
  if (type.startsWith('discrete.') || type.startsWith('continuous.') || type.startsWith('time.')) return 'state';
  return 'math';
}

export type BlockData = { block: CalcNode; boundary?: boolean; error?: boolean; result?: SignalValue; current?: boolean; ports?: { inputs: string[]; outputs: string[] } };
export type FlowBlock = Node<BlockData, 'calcBlock'>;

export function BlockNode({ id, data, selected }: NodeProps<FlowBlock>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const ports = data.ports ?? getBlockPorts(data.block);
  const portKey = `${ports.inputs.join(',')}/${ports.outputs.join(',')}`;
  useEffect(() => { updateNodeInternals(id); }, [id, portKey, updateNodeInternals]);
  const definition = getBlockDefinition(data.block.blockType);
  if (!definition) return <div className="block-node name-only error" role="group" aria-label={`${data.block.label}: 지원되지 않는 블럭 ${data.block.blockType}`} title={data.block.label}><div className="block-name">Unknown</div></div>;
  const firstParameter = Object.entries(definition.parameters)[0];
  const parameter = firstParameter && ['number', 'integer', 'value', 'numeric-vector', 'typed-value', 'signal-value'].includes(firstParameter[1].kind) ? firstParameter : undefined;
  const value = parameter ? Object.hasOwn(data.block.parameters, parameter[0]) ? data.block.parameters[parameter[0]] : parameter[1].default : undefined;
  const hasValue = !data.boundary && (Boolean(parameter) || ['sink.display', 'sink.scope', 'io.output', 'sink.sequence-viewer', 'io.structured-output'].includes(data.block.blockType));
  const preview = parameter ? value : data.current ? data.result : undefined;
  const exactValue = preview === undefined ? '현재 결과 없음' : JSON.stringify(preview);
  let typedPreview: string | undefined;
  if (preview && typeof preview === 'object' && !Array.isArray(preview)) {
    try {
      if ('kind' in preview && (preview.kind === 'bus' || preview.kind === 'messages')) typedPreview = signalSummary(preview as SignalValue);
      else if ('kind' in preview && preview.kind === 'typed') { const typed = validateTypedSignal(preview), dimensions = `[${typed.shape.join('×')}]`; typedPreview = typed.shape.length ? dimensions.length <= 14 ? dimensions : `${typed.shape.length}D · ${typed.data.length}` : typed.dtype === 'fixed' ? fixedCellText(typed.data[0] as string, typed.fixed!.fractionLength) : typedCellText(typed.data[0]!, typed); }
    } catch { /* Imported invalid configuration is diagnosed by the compiler. */ }
  }
  const visibleValue = typedPreview ?? (typeof preview === 'number' && Number.isFinite(preview) ? compactNumber(preview) : typeof preview === 'boolean' ? String(preview) : Array.isArray(preview) ? Array.isArray(preview[0]) ? `[${preview.length}×${preview[0].length}]` : `[${preview.length}]` : '—');
  const height = Math.max(definition.englishName.length > 18 ? 124 : 96, (Math.max(ports.inputs.length, ports.outputs.length) + 1) * 26);
  return <div className={`block-node ${blockTone(data.block.blockType)} ${hasValue ? '' : 'name-only'} ${selected ? 'selected' : ''} ${data.error ? 'error' : ''}`} style={{ minHeight: height }} role="group" aria-label={`${definition.englishName} 블럭: ${data.block.label}`} title={data.block.label}>
    <div className={`block-name${definition.englishName.length > 12 ? ' wrap-name' : ''}`}>{data.boundary || isDefinitionReference(data.block) ? data.block.label : definition.englishName}</div>
    {hasValue && <div className={`block-value${typedPreview !== undefined ? ' typed-preview' : ''}`} title={exactValue} aria-label={exactValue}>{visibleValue}</div>}
    {data.error && <span className="block-error" role="img" aria-label="입력 또는 설정 확인 필요" title="입력 또는 설정 확인 필요">!</span>}
    {ports.inputs.map((port, index) => <div className="port-row input-port" key={port} style={{ top: `${(index + 1) * 100 / (ports.inputs.length + 1)}%` }}><Handle type="target" position={Position.Left} id={port} aria-label={`${data.block.label} 입력 ${port}`} /></div>)}
    {ports.outputs.map((port, index) => <div className="port-row output-port" key={port} style={{ top: `${(index + 1) * 100 / (ports.outputs.length + 1)}%` }}><Handle type="source" position={Position.Right} id={port} aria-label={`${data.block.label} 출력 ${port}`} /></div>)}
  </div>;
}
