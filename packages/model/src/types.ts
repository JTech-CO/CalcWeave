export const ENGINE_VERSION = '0.15.0-m14';

export type ExecutionMode = 'static' | 'discrete' | 'continuous';
export type BlockType =
  | 'adapter.wasm-affine' | 'adapter.wasm-accumulator' | 'adapter.entity-transport'
  | 'source.string-constant' | 'string.ascii-to-string' | 'string.compose' | 'string.scan' | 'string.string-compare' | 'string.string-concatenate'
  | 'string.string-contains' | 'string.string-count' | 'string.string-find' | 'string.string-length' | 'string.string-to-ascii' | 'string.parse-number' | 'string.parse-enum' | 'string.substring' | 'string.to-string'
  | 'dashboard.control' | 'dashboard.indicator' | 'dashboard.action' | 'sink.record' | 'sink.xy-graph' | 'sink.floating-scope' | 'sink.stop' | 'signal.probe' | 'math.slider-gain'
  | 'data.output-file' | 'data.output-dataset' | 'data.input-table' | 'data.signal-editor' | 'source.waveform' | 'model.support-catalog'
  | 'continuous.descriptor' | 'continuous.integrator-limited' | 'continuous.second-order-limited' | 'continuous.pid-2dof'
  | 'time.variable-delay' | 'time.variable-transport-delay' | 'nonlinear.backlash' | 'nonlinear.rate-limiter-continuous' | 'nonlinear.rate-limiter-dynamic'
  | 'solver.algebraic-constraint' | 'analysis.linearization'
  | 'source.signal' | 'hierarchy.atomic' | 'hierarchy.enabled' | 'hierarchy.triggered' | 'hierarchy.enabled-triggered' | 'hierarchy.resettable'
  | 'hierarchy.action' | 'hierarchy.function-call' | 'hierarchy.for-iterator' | 'hierarchy.while-iterator' | 'hierarchy.for-each' | 'hierarchy.variant'
  | 'hierarchy.array-processing' | 'hierarchy.neighborhood-processing' | 'hierarchy.pixel-processing'
  | 'functions.call' | 'functions.initialize' | 'functions.reinitialize' | 'functions.reset' | 'functions.terminate' | 'functions.element' | 'functions.typed'
  | 'hierarchy.if' | 'hierarchy.switch-case' | 'route.structured-bus' | 'route.structured-select' | 'route.structured-assign'
  | 'events.send' | 'events.queue' | 'events.receive' | 'events.message-merge' | 'events.function-call-generator' | 'events.function-call-split' | 'events.feedback-latch' | 'events.hit-scheduler'
  | 'route.merge' | 'route.goto' | 'route.from' | 'route.tag-visibility' | 'route.data-store-memory' | 'route.data-store-read' | 'route.data-store-write'
  | 'state.reader' | 'state.writer' | 'state.parameter-writer' | 'sink.sequence-viewer' | 'io.structured-input' | 'io.structured-output'
  | 'source.typed' | 'source.enum'
  | 'signal.cast' | 'signal.cast-inherited' | 'signal.to-legacy' | 'signal.type-duplicate'
  | 'signal.type-propagation' | 'signal.scaling-strip' | 'signal.representation' | 'signal.specification'
  | 'signal.width' | 'signal.bus-to-vector' | 'signal.unit-system'
  | 'logic.bit-mask' | 'logic.extract-bits' | 'logic.float-extract-bits'
  | 'logic.integer-to-bits' | 'logic.bits-to-integer' | 'logic.shift-arithmetic' | 'logic.bitwise-typed'
  | 'fixed.integer-increment' | 'fixed.trigonometric' | 'fixed.state-space'
  | 'complex.from-parts' | 'complex.to-parts' | 'complex.from-polar' | 'complex.to-polar'
  | 'complex.hermitian' | 'complex.is-hermitian' | 'complex.dot' | 'typed.math'
  | 'tensor.reshape' | 'tensor.permute' | 'tensor.squeeze'
  | 'discrete.filter' | 'discrete.filter-time-varying' | 'discrete.pid' | 'discrete.pid-2dof' | 'discrete.zero-pole'
  | 'discrete.delay-configured' | 'discrete.tapped-delay' | 'discrete.propagation-delay' | 'discrete.integrator-configured'
  | 'discrete.state-space-mimo' | 'discrete.difference-configured' | 'logic.numeric-edge' | 'math.running-minmax'
  | 'time.weighted-math' | 'time.decrement-to-zero' | 'signal.initial-condition' | 'source.band-limited-noise'
  | 'source.counter' | 'source.pwm' | 'source.variable-pulse' | 'source.signal-generator' | 'source.sine-configured'
  | 'source.sequence-configured' | 'source.random-configured' | 'verify.gradient' | 'verify.resolution'
  | 'nonlinear.friction' | 'nonlinear.dead-zone-dynamic' | 'nonlinear.saturation-dynamic' | 'nonlinear.wrap-to-zero'
  | 'logic.compare-constant' | 'logic.interval-dynamic' | 'logic.truth-table'
  | 'math.signed-sqrt' | 'math.reciprocal-sqrt' | 'math.negate' | 'math.sine-wave-function' | 'math.increment'
  | 'matrix.assign' | 'matrix.find-nonzero' | 'matrix.permute-dimensions' | 'matrix.squeeze' | 'matrix.expand-scalar'
  | 'matrix.is-symmetric' | 'matrix.is-triangular' | 'matrix.square' | 'matrix.permute-rows-cols'
  | 'route.manual-switch' | 'route.multiport-switch' | 'verify.assert' | 'verify.bounds'
  | 'lookup.direct' | 'lookup.interpolate-prelookup' | 'lookup.dynamic' | 'lookup.nd'
  | 'math.gain-matrix' | 'math.sum-inputs' | 'math.product-inputs' | 'logic.combine' | 'route.switch-threshold'
  | 'vector.select-dynamic' | 'matrix.select-dynamic' | 'route.mux-inputs' | 'route.demux-widths'
  | 'math.concatenate-inputs' | 'matrix.reshape-column-major' | 'reduce.axis'
  | 'math.bias' | 'math.sign' | 'math.cbrt' | 'math.expm1' | 'math.log1p' | 'math.log2' | 'math.exp2'
  | 'math.sinh' | 'math.cosh' | 'math.tanh' | 'math.asinh' | 'math.acosh' | 'math.atanh' | 'math.sinc' | 'math.polynomial'
  | 'math.power' | 'math.hypot' | 'math.atan2' | 'math.mod' | 'math.remainder'
  | 'nonlinear.dead-zone' | 'nonlinear.quantizer' | 'logic.interval' | 'logic.is-integer' | 'logic.approx-equal'
  | 'reduce.sum' | 'reduce.product' | 'reduce.mean' | 'reduce.median' | 'reduce.variance' | 'reduce.std' | 'reduce.rms'
  | 'reduce.norm1' | 'reduce.norm2' | 'reduce.norm-inf' | 'reduce.all' | 'reduce.any'
  | 'vector.dot' | 'vector.cross' | 'vector.normalize' | 'vector.reverse' | 'vector.sort' | 'vector.cumsum' | 'vector.cumprod'
  | 'vector.difference' | 'vector.select' | 'vector.slice' | 'vector.repeat' | 'vector.convolve'
  | 'matrix.trace' | 'matrix.diagonal' | 'matrix.diag-create' | 'matrix.identity' | 'matrix.select' | 'matrix.row' | 'matrix.column'
  | 'matrix.horizontal' | 'matrix.vertical' | 'matrix.triangle' | 'matrix.symmetrize' | 'matrix.kronecker'
  | 'source.linspace' | 'source.logspace' | 'source.zeros'
  | 'math.matrix-multiply' | 'matrix.transpose' | 'matrix.determinant' | 'matrix.inverse' | 'matrix.solve' | 'matrix.cholesky' | 'matrix.lu'
  | 'lookup.2d' | 'lookup.prelookup' | 'fixed.quantize'
  | 'source.constant' | 'io.input' | 'math.gain' | 'math.sum'
  | 'source.chirp' | 'source.gaussian-pulse' | 'source.damped-sine' | 'source.exponential' | 'source.logistic' | 'source.sinc-pulse'
  | 'math.multiply' | 'sink.display' | 'discrete.unit-delay' | 'continuous.integrator'
  | 'math.abs' | 'math.function' | 'math.trigonometric' | 'math.round' | 'math.minmax'
  | 'math.sqrt' | 'logic.compare' | 'logic.boolean' | 'route.switch'
  | 'nonlinear.saturation' | 'route.mux' | 'route.demux' | 'math.concatenate'
  | 'matrix.reshape' | 'io.output' | 'io.terminator' | 'math.expression'
  | 'source.step' | 'source.ramp' | 'source.sine-wave' | 'source.pulse'
  | 'source.clock' | 'source.digital-clock' | 'source.random' | 'source.repeating-sequence'
  | 'discrete.delay' | 'discrete.integrator' | 'discrete.difference' | 'discrete.derivative'
  | 'discrete.fir' | 'discrete.transfer-function' | 'discrete.state-space'
  | 'logic.edge-detect' | 'time.rate-transition' | 'lookup.interpolated' | 'logic.bitwise' | 'sink.scope'
  | 'continuous.second-order-integrator' | 'continuous.state-space' | 'continuous.transfer-function'
  | 'continuous.zero-pole' | 'continuous.pid' | 'continuous.derivative'
  | 'time.memory' | 'time.zero-order-hold' | 'time.first-order-hold' | 'time.transport-delay'
  | 'logic.hit-crossing' | 'nonlinear.relay'
  | 'source.dataset' | 'unit.convert' | 'route.bus-create' | 'route.bus-select'
  | 'hierarchy.subsystem' | 'annotation.note' | 'annotation.model-info';

export type LegacySignalValue = number | boolean | number[] | boolean[] | number[][] | boolean[][];
/** JSON preserves tagged IEEE special values, signed zero, and exact integer codes. */
export type TypedFloat = number | '-0' | 'NaN' | 'Infinity' | '-Infinity';
export interface TypedComplex { re: TypedFloat; im: TypedFloat }
export type TypedDType = 'float64' | 'float32' | 'boolean'
  | 'int8' | 'uint8' | 'int16' | 'uint16' | 'int32' | 'uint32' | 'int64' | 'uint64'
  | 'complex128' | 'fixed' | 'string' | 'enum';
export interface TypedFixedSpec { signed: boolean; wordLength: number; fractionLength: number }
export interface TypedEnumSpec { name: string; labels: string[] }
export interface TypedDataType { dtype: TypedDType; fixed?: TypedFixedSpec; enum?: TypedEnumSpec }
export type TypedRounding = 'floor' | 'ceil' | 'zero' | 'nearest' | 'away' | 'even';
export type TypedOverflow = 'wrap' | 'saturate' | 'error';
export type TypedCell = TypedFloat | boolean | string | TypedComplex;
export interface TypedSignal extends TypedDataType {
  kind: 'typed';
  /** Fixed, row-major rank 0..8; data stores exact decimal integer/fixed codes. */
  shape: number[];
  data: TypedCell[];
}
export interface BusSignal { kind: 'bus'; fields: { name: string; value: SignalValue }[] }
export interface MessageItem { producer: string; sequence: number; time: number; priority: number; payload: SignalValue }
export interface MessageSignal { kind: 'messages'; items: MessageItem[] }
export type SignalValue = LegacySignalValue | TypedSignal | BusSignal | MessageSignal;
export type StateValue = number | boolean | string | null | TypedSignal | BusSignal | MessageSignal | StateValue[] | { [key: string]: StateValue };
export interface SampleTime { period: number; offset: number }
export interface SignalDescriptor {
  valueType: 'float64' | 'boolean' | 'typed' | 'bus' | 'messages';
  /** Scalar [], vector [length], or row-major matrix [rows, columns]. */
  shape: number[];
  unit: string;
  /** Present only when valueType is typed. No implicit conversion to legacy kernels. */
  typed?: TypedDataType;
  bus?: { fields: { name: string; descriptor: SignalDescriptor }[] };
  message?: { payload: SignalDescriptor; maxBatch: number };
  /** A homogeneous scalar bus is represented as a vector with named fields. */
  fields?: string[];
  /** Compiler representation contract for explicitly converted homogeneous buses. */
  representation?: 'copy' | 'virtual' | 'nonvirtual';
}
export type ExpressionNode =
  | { type: 'number'; value: number }
  | { type: 'variable'; name: 'x' | 'pi' | 'e' }
  | { type: 'unary'; operator: '+' | '-'; argument: ExpressionNode }
  | { type: 'binary'; operator: '+' | '-' | '*' | '/' | '^'; left: ExpressionNode; right: ExpressionNode }
  | { type: 'call'; name: string; args: ExpressionNode[] };

export interface CalcNode {
  id: string;
  blockType: string;
  blockVersion: 1;
  label: string;
  parameters: Record<string, unknown>;
  unit?: string;
  sampleTime?: SampleTime;
}

export interface Endpoint { nodeId: string; portId: string }
export interface CalcEdge { id: string; source: Endpoint; target: Endpoint }
export interface ExecutionSettings {
  mode: ExecutionMode;
  startTime: number;
  stopTime: number;
  step: number;
  solver?: Partial<SolverSettings>;
}
export interface SolverSettings {
  method: 'rk4' | 'rk45' | 'implicit-euler';
  newtonTolerance?: number;
  newtonMaxIterations?: number;
  jacobianStep?: number;
  initialStep: number;
  minStep: number;
  maxStep: number;
  atol: number;
  rtol: number;
  maxSteps: number;
  maxRejects: number;
  maxEvaluations: number;
  eventTolerance: number;
  maxEvents: number;
  discreteStep: number;
}
export type DatasetCell = number | boolean | string;
export interface DatasetColumn { name: string; kind: 'number' | 'boolean' | 'string'; unit: string }
export interface DatasetProvenance { format: 'csv' | 'json' | 'xlsx' | 'editor'; filename?: string; sheet?: string; sourceHash: string; transforms: string[] }
export interface Dataset {
  id: string;
  name: string;
  version: number;
  sourceHash: string;
  contentHash: string;
  timeColumn: string;
  columns: DatasetColumn[];
  rows: DatasetCell[][];
  provenance?: DatasetProvenance;
}
export interface SubsystemDefinition {
  id: string;
  version: number;
  name: string;
  nodes: CalcNode[];
  edges: CalcEdge[];
  layout: Record<string, { x: number; y: number }>;
  inputs: { id: string; nodeId: string }[];
  outputs: { id: string; nodeId: string }[];
}
export interface DashboardWidget {
  id: string;
  kind: 'slider' | 'toggle' | 'display' | 'gauge' | 'scope';
  title: string;
  nodeId: string;
  parameter?: string;
  min?: number;
  max?: number;
  step?: number;
}
export interface CalcModel {
  schemaVersion: 1;
  modelId: string;
  name: string;
  nodes: CalcNode[];
  edges: CalcEdge[];
  execution: ExecutionSettings;
  layout: Record<string, { x: number; y: number }>;
  datasets?: Dataset[];
  subsystems?: SubsystemDefinition[];
  dashboard?: DashboardWidget[];
  notes?: string;
}

export interface Diagnostic {
  code: string;
  message: string;
  nodeId?: string;
  portId?: string;
  /** Discrete execution failure location; compiler diagnostics omit these fields. */
  tick?: number;
  time?: number;
  hierarchyPath?: string[];
  childNodeId?: string;
  iteration?: number;
}
export class ModelError extends Error {
  constructor(public readonly diagnostics: Diagnostic[], public readonly partialResult?: RunResult) {
    super(diagnostics[0]?.message ?? '모델을 확인해 주세요.');
    this.name = 'ModelError';
  }
}

export interface IRNode {
  id: string;
  blockType: BlockType;
  parameters: Record<string, unknown>;
  /** Preserve the selected producer port, including Demux outputs. */
  inputs: Record<string, Endpoint>;
  outputs: Record<string, SignalDescriptor>;
  expression?: ExpressionNode;
  /** Fixed rate expressed in integer base ticks. */
  sampleTime: SampleTime;
  /** Continuous compilation annotates the time domain; M0/M2 IR remains unchanged. */
  executionDomain?: 'continuous' | 'discrete' | 'constant';
}
export interface CompiledModel {
  model: CalcModel;
  nodes: IRNode[];
  stateIds: string[];
  outputIds: string[];
  outputTypes: Record<string, SignalDescriptor>;
  /** Canonical semantic JSON, excluding names and layout. SHA-256 computed at run boundary. */
  semanticKey: string;
  /** Persistent discrete state plus held and boundary signal elements. */
  stateElements: number;
  hierarchy?: HierarchyMetadata;
}
export interface HierarchyOrigin { path: string[]; rootNodeId: string; definitionId: string }
export interface HierarchyInstance { nodeId: string; path: string[]; definitionId: string; version: number; definitionHash: string }
export interface HierarchyMetadata { origins: Record<string, HierarchyOrigin>; instances: HierarchyInstance[] }

export interface RunSample { time: number; values: Record<string, SignalValue> }
export interface DashboardLiveEvent { nodeId: string; value: number }
export interface DashboardAppliedEvent extends DashboardLiveEvent { time: number; order: number }
export interface AdapterLifecycle { nodeId: string; profileId: string; initialized: true; terminated: true; reason: 'completed' | 'cancelled' | 'failed' }
export interface RunResult {
  samples: RunSample[];
  finalState: Record<string, SignalValue>;
  stateMemory?: Record<string, StateValue>;
  status: 'completed' | 'cancelled' | 'failed';
  elapsedMs: number;
  /** Continuous finalState endpoint; raw samples use their own output grid. */
  stateTime?: number;
  steps: number;
  solverStatistics?: SolverStatistics;
  events?: SimulationEvent[];
  resources?: { operations: number };
  /** Graceful root Stop Simulation, after a complete validated observation. */
  stopReason?: { nodeId: string; tick: number; time: number };
  adapterLifecycle?: AdapterLifecycle[];
}
export interface SolverStatistics {
  method: 'rk4' | 'rk45' | 'implicit-euler';
  acceptedSteps: number;
  rejectedSteps: number;
  evaluations: number;
  events: number;
  lastStep: number;
  minAcceptedStep: number;
  maxAcceptedStep: number;
}
export interface SimulationEvent { time: number; nodeIds: string[]; kind: 'crossing' | 'reset' | 'relay' }
export interface RunOptions {
  signal?: AbortSignal;
  maxWallMs?: number;
  maxRecordedValues?: number;
  maxOperations?: number;
  trackOperations?: boolean;
  onProgress?: (progress: { steps: number; time: number }) => void;
  control?: { isPaused: () => boolean; waitForResume: () => Promise<void>; takeDashboardEvents?: () => DashboardLiveEvent[] };
  onPauseChange?: (paused: boolean) => void;
  onDashboardEventApplied?: (event: DashboardAppliedEvent) => void;
}
