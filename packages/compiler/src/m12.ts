import { getBlockDefinition, getDirectFeedthroughPorts } from '../../block-library/src';
import { M12_BLOCK_IDS } from '../../block-library/src/m12';
import { ModelError, continuousStateElementCount, isSafeIdentifier, structuredStorageElements, type CalcModel, type CompiledModel, type Endpoint, type ExpressionNode, type IRNode, type SignalDescriptor, type SubsystemDefinition } from '../../model/src';
import type { M11CompileContext } from './m11';

export const M12_LIMITS = Object.freeze({ maxStates: 16, maxPorts: 8, maxUnknowns: 8, maxComponentNodes: 64, maxIterations: 32 });
export interface M12DescriptorReduced { A: number[][]; B: number[][]; C: number[][]; D: number[][]; initial: number[]; algebraicA: number[][]; algebraicB: number[][]; initialAlgebraic: number[]; originalA: number[][]; originalB: number[][]; originalC: number[][]; originalD: number[][]; originalE: number[][]; nd: number; n: number; m: number; p: number }
export interface M12AlgebraicProgram { id: string; unknowns: { nodeId: string; initial: number; constraint: 'zero' | 'fixed-point' }[]; residuals: Endpoint[]; nodeIds: string[]; orderedNodeIds: string[]; tolerance: number; maxIterations: number }
export interface M12AnalysisProgram extends CompiledModel { kind: 'm12-continuous-plant'; inputBindings: { port: string; nodeId: string }[]; outputBindings: { port: string; source: Endpoint }[]; initialState: number[] }
export interface M12CompileContext extends M11CompileContext { compileAnalysis: (definition: SubsystemDefinition, inputs: number[], context: M12CompileContext) => CompiledModel }
const ids = new Set<string>(M12_BLOCK_IDS);
export const isM12Block = (id: string): boolean => ids.has(id);
const copy = <T>(value: T): T => structuredClone(value);
const scalar = (valueType: 'float64' | 'boolean' = 'float64'): SignalDescriptor => ({ valueType, shape: [], unit: '1' });
function fail(node: Pick<IRNode, 'id'>, code: string, message: string, portId?: string): never { throw new ModelError([{ code, nodeId: node.id, message, ...(portId ? { portId } : {}) }]); }
function finite(node: IRNode, value: number): number { if (!Number.isFinite(value)) fail(node, 'M12_NUMERIC_RANGE', '계수 축소의 결과는 유한해야 합니다.'); return value === 0 ? 0 : value; }
function matrix(node: IRNode, value: unknown, key: string, maximum = 16): number[][] { if (!Array.isArray(value) || !value.length || value.length > maximum || !Array.isArray(value[0]) || !value[0].length || value[0].length > maximum || value.some(row => !Array.isArray(row) || row.length !== value[0].length || row.some(item => typeof item !== 'number' || !Number.isFinite(item)))) fail(node, 'M12_MATRIX_SHAPE', `${key}는 각 축1~${maximum}의 유한한 실수 행렬이어야 합니다.`); return copy(value as number[][]); }
const norm = (a: number[][]): number => Math.max(...a.map(row => row.reduce((sum, value) => sum + Math.abs(value), 0)));
function multiply(node: IRNode, a: number[][], b: number[][]): number[][] { return a.map(row => b[0]!.map((_, column) => finite(node, row.reduce((sum, value, index) => finite(node, sum + value * b[index]![column]!), 0)))); }
function add(node: IRNode, a: number[][], b: number[][]): number[][] { return a.map((row, index) => row.map((value, column) => finite(node, value + b[index]![column]!))); }
function inverse(node: IRNode, matrix: number[][], tolerance: number, label: string): number[][] {
  const n = matrix.length, scale = Math.max(...matrix.flat().map(Math.abs));
  if (!(scale > 0)) fail(node, 'M12_DESCRIPTOR_SINGULAR', `${label}가 특이합니다.`);
  const rows = matrix.map((row, index) => [...row.map(value => value / scale), ...Array.from({ length: n }, (_, column) => index === column ? 1 : 0)]);
  for (let column = 0; column < n; column++) {
    let pivot = column; for (let row = column + 1; row < n; row++) if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    if (Math.abs(rows[pivot]![column]!) <= tolerance) fail(node, 'M12_DESCRIPTOR_CONDITION', `${label}의 상대 pivot가 허용오차보다 작습니다.`);
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!]; const divisor = rows[column]![column]!;
    rows[column] = rows[column]!.map(value => finite(node, value / divisor));
    for (let row = 0; row < n; row++) if (row !== column) { const factor = rows[row]![column]!; rows[row] = rows[row]!.map((value, index) => finite(node, value - factor * rows[column]![index]!)); }
  }
  const result = rows.map(row => row.slice(n).map(value => finite(node, value / scale))), condition = norm(matrix) * norm(result);
  if (!Number.isFinite(condition) || condition * tolerance > 1) fail(node, 'M12_DESCRIPTOR_CONDITION', `${label}의 condition 예산을 초과했습니다.`);
  const identity = multiply(node, matrix, result); if (identity.some((row, index) => row.some((value, column) => Math.abs(value - (index === column ? 1 : 0)) > Math.max(1e-12, tolerance * n * Math.max(1, condition))))) fail(node, 'M12_DESCRIPTOR_RESIDUAL', `${label} 역행렬 잔차가 허용오차를 넘습니다.`);
  return result;
}
function descriptor(node: IRNode): void {
  const p = node.parameters, E = matrix(node, p.E, 'E'), A = matrix(node, p.A, 'A'), B = matrix(node, p.B, 'B'), C = matrix(node, p.C, 'C'), D = matrix(node, p.D, 'D');
  const n = E.length, m = B[0]!.length, outputs = C.length, initial = p.initial as number[];
  if (E.some(row => row.length !== n) || A.length !== n || A.some(row => row.length !== n) || B.length !== n || C.some(row => row.length !== n) || D.length !== outputs || D.some(row => row.length !== m) || m > 8 || outputs > 8 || initial.length !== n) fail(node, 'M12_DESCRIPTOR_SHAPE', 'E/A는 N×N, B N×M, C P×N, D P×M, initial 길이N입니다. N≤16/M,P≤8입니다.');
  const nd = Number(p.differentialCount) || n; if (nd > n || Number(p.differentialCount) === n) fail(node, 'M12_DESCRIPTOR_PARTITION', '비특이 E는 differentialCount0, index-1은1~N−1로 지정하세요.');
  let reducedA: number[][], reducedB: number[][], reducedC: number[][], reducedD: number[][], algebraicA: number[][] = [], algebraicB: number[][] = [];
  if (nd === n) { const inv = inverse(node, E, Number(p.pivotTolerance), 'E'); reducedA = multiply(node, inv, A); reducedB = multiply(node, inv, B); reducedC = C; reducedD = D; }
  else {
    if (E.some((row, index) => row.some((value, column) => (index >= nd || column >= nd) && value !== 0))) fail(node, 'M12_DESCRIPTOR_PARTITION', '선택 index-1 계약은 E=[Ed 0;0 0]의 명시 분할입니다. 일반 특이 E는 별도 지원입니다.');
    const invE = inverse(node, E.slice(0, nd).map(row => row.slice(0, nd)), Number(p.pivotTolerance), 'Ed'), invAaa = inverse(node, A.slice(nd).map(row => row.slice(nd)), Number(p.pivotTolerance), 'Aaa');
    algebraicA = multiply(node, invAaa, A.slice(nd).map(row => row.slice(0, nd))).map(row => row.map(value => finite(node, -value))); algebraicB = multiply(node, invAaa, B.slice(nd)).map(row => row.map(value => finite(node, -value)));
    reducedA = multiply(node, invE, add(node, A.slice(0, nd).map(row => row.slice(0, nd)), multiply(node, A.slice(0, nd).map(row => row.slice(nd)), algebraicA)));
    reducedB = multiply(node, invE, add(node, B.slice(0, nd), multiply(node, A.slice(0, nd).map(row => row.slice(nd)), algebraicB)));
    reducedC = add(node, C.map(row => row.slice(0, nd)), multiply(node, C.map(row => row.slice(nd)), algebraicA)); reducedD = add(node, D, multiply(node, C.map(row => row.slice(nd)), algebraicB));
  }
  p.descriptorReduced = { A: reducedA, B: reducedB, C: reducedC, D: reducedD, initial: initial.slice(0, nd), algebraicA, algebraicB, initialAlgebraic: initial.slice(nd), originalA: A, originalB: B, originalC: C, originalD: D, originalE: E, nd, n, m, p: outputs } satisfies M12DescriptorReduced;
  p.m12StateElements = nd + 2;
}
export function validateM12Parameters(node: IRNode, model: CalcModel): void {
  if (!isM12Block(node.blockType)) return;
  const p = node.parameters;
  if (node.blockType === 'continuous.descriptor') descriptor(node);
  if (node.blockType === 'continuous.integrator-limited') { if (!(Number(p.lower) < Number(p.upper)) || Number(p.initial) < Number(p.lower) || Number(p.initial) > Number(p.upper)) fail(node, 'M12_LIMITS_INVALID', '하한<상한이며 초기 상태는 경계 안에 있어야 합니다.'); p.m12StateElements = 1; }
  if (node.blockType === 'continuous.second-order-limited') { if (!(Number(p.positionLower) < Number(p.positionUpper)) || !(Number(p.velocityLower) < 0 && Number(p.velocityUpper) > 0) || Number(p.initialPosition) < Number(p.positionLower) || Number(p.initialPosition) > Number(p.positionUpper) || Number(p.initialVelocity) < Number(p.velocityLower) || Number(p.initialVelocity) > Number(p.velocityUpper)) fail(node, 'M12_LIMITS_INVALID', '위치 하한<상한, 속도 하한<0<상한이며 초기 상태는 경계 안이어야 합니다.'); p.m12StateElements = 2; }
  if (node.blockType === 'continuous.pid-2dof') { if (p.limit === 'on' && !(Number(p.lower) < Number(p.upper))) fail(node, 'M12_LIMITS_INVALID', 'PID 출력 하한은 상한보다 작아야 합니다.'); if (p.antiWindup !== 'none' && p.limit !== 'on') fail(node, 'M12_PID_ANTIWINDUP', 'anti-windup을 사용하려면 출력 제한을 켜세요.'); p.m12StateElements = 2; }
  if (['time.variable-delay', 'time.variable-transport-delay'].includes(node.blockType)) { if (Number(p.minDelay) > Number(p.maxDelay)) fail(node, 'M12_DELAY_RANGE', 'minDelay≤maxDelay여야 합니다.'); p.m12StateElements = Number(p.historyLimit) * (node.blockType === 'time.variable-delay' ? 3 : 4) + 16; }
  if (node.blockType === 'nonlinear.backlash') p.m12StateElements = 2;
  if (node.blockType === 'nonlinear.rate-limiter-continuous') { if (model.execution.mode === 'discrete') p.m12DiscreteStateElements = 2; else p.m12StateElements = 3; }
  if (node.blockType === 'nonlinear.rate-limiter-dynamic') p.m12DiscreteStateElements = 2;
  if (node.blockType === 'solver.algebraic-constraint') p.m12StateElements = 2;
  if (node.blockType === 'analysis.linearization') { if (!isSafeIdentifier(String(p.definitionId))) fail(node, 'INVALID_PARAMETERS', '정의 ID는 안전한 식별자여야 합니다.'); if (p.mode === 'timed' && (new Set(p.times as number[]).size !== (p.times as number[]).length || (p.times as number[]).some(time => time < model.execution.startTime || time > model.execution.stopTime))) fail(node, 'M12_ANALYSIS_TIME', '선형화 요청 시각은 고유하고 실행 범위 안이어야 합니다.'); }
}
export function initialM12Outputs(node: IRNode): Record<string, SignalDescriptor> | undefined {
  if (!isM12Block(node.blockType)) return undefined;
  const p = node.parameters;
  if (node.blockType === 'continuous.descriptor') { const reduced = p.descriptorReduced as M12DescriptorReduced; return { out: { ...scalar(), shape: reduced.p === 1 ? [] : [reduced.p] }, state: { ...scalar(), shape: [reduced.n] } }; }
  if (node.blockType === 'continuous.integrator-limited') return { out: scalar(), limited: scalar('boolean') };
  if (node.blockType === 'continuous.second-order-limited') return { out: scalar(), velocity: scalar(), positionLimited: scalar('boolean'), velocityLimited: scalar('boolean') };
  if (node.blockType !== 'analysis.linearization') return { out: scalar() };
  return undefined;
}
function numericScalar(node: IRNode, descriptor: SignalDescriptor, port: string, boolean = false): void { if (descriptor.valueType !== (boolean ? 'boolean' : 'float64') || descriptor.shape.length || descriptor.unit !== '1') fail(node, 'M12_SIGNAL_TYPE', `${port}에는 단위1의 legacy ${boolean ? 'boolean' : 'float64'} scalar가 필요합니다.`, port); }
function initialState(node: IRNode): number[] { const p = node.parameters; switch (node.blockType) { case 'continuous.integrator': case 'continuous.integrator-limited': case 'continuous.derivative': return [Number(p.initial)]; case 'continuous.second-order-integrator': case 'continuous.second-order-limited': return [Number(p.initialPosition), Number(p.initialVelocity)]; case 'continuous.pid': case 'continuous.pid-2dof': return [Number(p.initialIntegral), Number(p.initialFilter)]; case 'continuous.state-space': case 'continuous.zero-pole': case 'continuous.transfer-function': return [...p.initial as number[]]; case 'continuous.descriptor': return [...(p.descriptorReduced as M12DescriptorReduced).initial]; default: return []; } }
const smoothTypes = new Set(['source.constant', 'io.input', 'source.signal', 'io.structured-input', 'source.clock', 'source.ramp', 'source.sine-wave', 'math.sum', 'math.gain', 'math.product', 'math.divide', 'math.expression', 'functions.typed', 'math.negate', 'math.increment', 'math.concatenate', 'route.mux', 'route.demux', 'vector.select', 'matrix.multiply', 'math.gain-matrix', 'math.sum-inputs', 'math.product-inputs', 'io.output', 'io.structured-output', 'sink.display', 'sink.scope', 'continuous.integrator', 'continuous.second-order-integrator', 'continuous.state-space', 'continuous.transfer-function', 'continuous.zero-pole', 'continuous.pid', 'continuous.derivative', 'continuous.descriptor', 'solver.algebraic-constraint']);
function smoothExpression(ast: ExpressionNode | undefined): boolean { if (!ast) return true; if (ast.type === 'call' && ['abs', 'floor', 'ceil', 'round', 'trunc', 'min', 'max'].includes(ast.name)) return false; if (ast.type === 'call') return ast.args.every(smoothExpression); if (ast.type === 'binary') return smoothExpression(ast.left) && smoothExpression(ast.right); if (ast.type === 'unary') return smoothExpression(ast.argument); return true; }
function analysis(node: IRNode, model: CalcModel, context: M12CompileContext): Record<string, SignalDescriptor> {
  const p = node.parameters, definition = context.definitions.get(String(p.definitionId)); if (!definition) fail(node, 'UNKNOWN_SUBSYSTEM_DEFINITION', '선형화할 연속 정의가 없습니다.'); if (definition!.version !== p.version) fail(node, 'STALE_SUBSYSTEM_VERSION', '선형화 정의 버전을 갱신하세요.');
  if (!definition!.inputs.length || !definition!.outputs.length || definition!.inputs.length > 8 || definition!.outputs.length > 8) fail(node, 'M12_ANALYSIS_PORTS', '연속 정의는1~8개 scalar 입력·출력이 있어야 합니다.');
  for (const port of definition!.inputs) { const marker = definition!.nodes.find(item => item.id === port.nodeId)!; if (typeof marker.parameters.value !== 'number' || !Number.isFinite(marker.parameters.value) || (marker.unit !== undefined && marker.unit !== '1')) fail(node, 'M12_ANALYSIS_INPUTS', '선택 선형화 입력 경계는 단위1 legacy float64 scalar여야 합니다.', port.id); }
  const configured = p.operatingInputs as number[], inputs = configured.length ? configured : definition!.inputs.map(port => Number(definition!.nodes.find(item => item.id === port.nodeId)!.parameters.value));
  if (inputs.length !== definition!.inputs.length || inputs.some(value => !Number.isFinite(value))) fail(node, 'M12_ANALYSIS_INPUTS', 'operatingInputs는 정의 입력 수와 같은 유한 scalar 값이어야 합니다.');
  const childContext = { ...context, depth: context.depth + 1, ancestors: [...context.ancestors, definition!.id], scopePath: [...context.scopePath, node.id] };
  let compiled: CompiledModel; try { compiled = context.compileAnalysis(definition!, inputs, childContext); } catch (error) { if (!(error instanceof ModelError)) throw error; throw new ModelError(error.diagnostics.map(diagnostic => ({ ...diagnostic, nodeId: node.id, childNodeId: diagnostic.childNodeId ?? diagnostic.nodeId, hierarchyPath: [node.id, ...(diagnostic.hierarchyPath ?? [])] }))); }
  for (const member of compiled.nodes) if (!smoothTypes.has(member.blockType) || !smoothExpression(member.expression) || member.executionDomain === 'discrete' || member.parameters.reset === 'rising' || Object.values(member.outputs).some(descriptor => descriptor.valueType !== 'float64')) fail(node, 'M12_ANALYSIS_PLANT_UNSUPPORTED', `선택 국소 선형화는 smooth legacy 실수 continuous 정의입니다. ${member.id}를 지원하지 않습니다.`);
  const state = compiled.nodes.flatMap(initialState), n = state.length, m = inputs.length, outputBindings = definition!.outputs.map(port => { const endpoint = compiled.nodes.find(member => member.id === port.nodeId)?.inputs.in; if (!endpoint) fail(node, 'DANGLING_SUBSYSTEM_OUTPUT', '실제 선형화 출력 생산자 연결이 필요합니다.', port.id); const producer = compiled.nodes.find(member => member.id === endpoint!.nodeId)!; numericScalar(node, producer.outputs[endpoint!.portId]!, port.id); return { port: port.id, source: copy(endpoint!) }; }), outputs = outputBindings.length;
  if (n < 1 || n > 16) fail(node, 'M12_ANALYSIS_STATES', '선택 선형화 정의의 연속 상태는1~16개여야 합니다.');
  const operating = p.operatingState as number[]; if (operating.length && operating.length !== n) fail(node, 'M12_ANALYSIS_STATES', 'operatingState는 실제 연속 상태 순서와 같은 길이여야 합니다.');
  p.operatingInputs = inputs; p.operatingState = operating.length ? [...operating] : state;
  p.analysisProgram = { ...copy(compiled), kind: 'm12-continuous-plant', inputBindings: definition!.inputs.map(port => ({ port: port.id, nodeId: port.nodeId })), outputBindings, initialState: state } satisfies M12AnalysisProgram;
  const descriptor: SignalDescriptor = { valueType: 'bus', shape: [], unit: '1', bus: { fields: [['A', n, n], ['B', n, m], ['C', outputs, n], ['D', outputs, m]].map(([name, rows, columns]) => ({ name: String(name), descriptor: { ...scalar(), shape: [Number(rows), Number(columns)] } })) } };
  p.m12StateElements = structuredStorageElements(descriptor) + 4; return { out: descriptor };
}
export function inferM12Outputs(node: IRNode, input: (port: string) => SignalDescriptor, model: CalcModel, context: M12CompileContext): Record<string, SignalDescriptor> | undefined {
  if (!isM12Block(node.blockType)) return undefined;
  if (node.blockType === 'analysis.linearization') { if (node.parameters.mode === 'triggered') numericScalar(node, input('trigger'), 'trigger', true); return analysis(node, model, context); }
  return initialM12Outputs(node);
}
export function validateM12StateInputs(node: IRNode, input: (port: string) => SignalDescriptor): boolean { if (!isM12Block(node.blockType)) return false; for (const port of Object.keys(node.inputs)) if (!(node.blockType === 'continuous.descriptor' && port === 'in')) numericScalar(node, input(port), port, ['reset', 'trigger'].includes(port)); if (node.blockType === 'continuous.descriptor') { const reduced = node.parameters.descriptorReduced as M12DescriptorReduced, descriptor = input('in'); if (descriptor.valueType !== 'float64' || descriptor.unit !== '1' || JSON.stringify(descriptor.shape) !== JSON.stringify(reduced.m === 1 ? [] : [reduced.m])) fail(node, 'M12_DESCRIPTOR_INPUT', 'Descriptor 입력은 M1 scalar 또는 길이M의 단위1 실수 vector입니다.', 'in'); } return true; }

/** SCCs are found in the genuine residual graph; only constraint inputs are cut in the output DAG. */
export function prepareM12Algebraic(nodes: IRNode[], model: CalcModel): [string, string][] {
  const byId = new Map(nodes.map(node => [node.id, node])), adjacency = new Map(nodes.map(node => [node.id, [] as string[]]));
  for (const target of nodes) for (const [port, endpoint] of Object.entries(target.inputs)) if (target.blockType === 'solver.algebraic-constraint' || getDirectFeedthroughPorts(target).includes(port)) adjacency.get(endpoint.nodeId)!.push(target.id);
  let next = 0; const indices = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], onStack = new Set<string>(), components: string[][] = [];
  const visit = (id: string): void => { indices.set(id, next); low.set(id, next++); stack.push(id); onStack.add(id); for (const target of adjacency.get(id)!) { if (!indices.has(target)) { visit(target); low.set(id, Math.min(low.get(id)!, low.get(target)!)); } else if (onStack.has(target)) low.set(id, Math.min(low.get(id)!, indices.get(target)!)); } if (low.get(id) === indices.get(id)) { const component: string[] = []; let member: string; do { member = stack.pop()!; onStack.delete(member); component.push(member); } while (member !== id); components.push(component.sort()); } };
  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) if (!indices.has(node.id)) visit(node.id);
  const dependencies: [string, string][] = [];
  for (const component of components) {
    const members = component.map(id => byId.get(id)!), unknowns = members.filter(node => node.blockType === 'solver.algebraic-constraint');
    if (!unknowns.length) continue;
    if (model.execution.mode !== 'continuous') fail(unknowns[0]!, 'M12_ALGEBRAIC_MODE', '선택 잔차 solver는 연속 실행에 사용하세요.');
    if (unknowns.length > 8 || members.length > 64) fail(unknowns[0]!, 'M12_ALGEBRAIC_LIMIT', '한 대수 성분의 unknown≤8·smooth member≤64입니다.');
    if (members.some(node => node.blockType !== 'solver.algebraic-constraint' && (!['math.sum', 'math.gain', 'math.product', 'math.divide', 'math.expression', 'functions.typed', 'math.negate', 'math.increment', 'math.sum-inputs', 'math.product-inputs'].includes(node.blockType) || !smoothExpression(node.expression)))) fail(unknowns[0]!, 'M12_ALGEBRAIC_UNSUPPORTED', '대수 성분은 승인 smooth scalar 수식만 포함할 수 있습니다. 불연속·stateful·typed·scope·effect는 거부합니다.');
    const set = new Set(component), internals = members.filter(node => node.blockType !== 'solver.algebraic-constraint'), ordered: string[] = [], pending = new Set(internals.map(node => node.id));
    while (pending.size) { const ready = [...pending].filter(id => Object.values(byId.get(id)!.inputs).every(endpoint => !pending.has(endpoint.nodeId))).sort(); if (!ready.length) fail(unknowns[0]!, 'M12_ALGEBRAIC_UNSUPPORTED', 'constraint unknown을 제외한 내부 그래프가 비순환이어야 합니다.'); ordered.push(...ready); ready.forEach(id => pending.delete(id)); }
    const leader = unknowns[0]!, program: M12AlgebraicProgram = { id: leader.id, unknowns: unknowns.map(node => ({ nodeId: node.id, initial: Number(node.parameters.initial), constraint: node.parameters.constraint as 'zero' | 'fixed-point' })), residuals: unknowns.map(node => { if (!node.inputs.in) fail(node, 'REQUIRED_INPUT_MISSING', '대수 제약의 실제 잔차 입력이 필요합니다.', 'in'); return copy(node.inputs.in!); }), nodeIds: component, orderedNodeIds: ordered, tolerance: Math.min(...unknowns.map(node => Number(node.parameters.tolerance))), maxIterations: Math.min(...unknowns.map(node => Number(node.parameters.maxIterations))) };
    leader.parameters.algebraicProgram = program;
    for (const member of members) { member.parameters.algebraicComponentId = leader.id; for (const endpoint of Object.values(member.inputs)) if (!set.has(endpoint.nodeId)) for (const unknown of unknowns) dependencies.push([endpoint.nodeId, unknown.id]); }
    // An acyclic residual independent of z is solved too; singular Jacobian is an explicit runtime failure.
  }
  return dependencies;
}
export function validateM12AlgebraicSignals(nodes: IRNode[]): void {
  for (const node of nodes) if (node.parameters.algebraicComponentId) { for (const [port, descriptor] of Object.entries(node.outputs)) numericScalar(node, descriptor, port); if (node.blockType === 'solver.algebraic-constraint') node.parameters.m12StateElements = 2; }
}
