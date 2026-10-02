export const ENGINE_VERSION = '0.6.0-m6';

export type ExecutionMode = 'static' | 'discrete' | 'continuous';
export type BlockType =
  | 'math.matrix-multiply' | 'matrix.transpose' | 'matrix.determinant' | 'matrix.inverse' | 'matrix.solve' | 'matrix.cholesky' | 'matrix.lu'
  | 'lookup.2d' | 'lookup.prelookup' | 'fixed.quantize'
  | 'source.constant' | 'io.input' | 'math.gain' | 'math.sum'
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

export type SignalValue = number | boolean | number[] | boolean[] | number[][] | boolean[][];
export type StateValue = number | boolean | string | null | StateValue[] | { [key: string]: StateValue };
export interface SampleTime { period: number; offset: number }
export interface SignalDescriptor {
  valueType: 'float64' | 'boolean';
  /** Scalar [], vector [length], or row-major matrix [rows, columns]. */
  shape: number[];
  unit: string;
  /** A homogeneous scalar bus is represented as a vector with named fields. */
  fields?: string[];
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
  method: 'rk4' | 'rk45';
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
export interface Dataset {
  id: string;
  name: string;
  version: number;
  sourceHash: string;
  contentHash: string;
  timeColumn: string;
  columns: DatasetColumn[];
  rows: DatasetCell[][];
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
}
export interface SolverStatistics {
  method: 'rk4' | 'rk45';
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
  control?: { isPaused: () => boolean; waitForResume: () => Promise<void> };
  onPauseChange?: (paused: boolean) => void;
}
