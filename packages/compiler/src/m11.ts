import { getBlockDefinition, getBlockPorts } from '../../block-library/src';
import { getDefinitionReference, getDefinitionReferences, getM11ControlPorts, isDefinitionReference, isM11ScopeBlock, M11_BLOCK_IDS } from '../../block-library/src/m11';
import { copyAnySignal, describeAnySignal, isSafeIdentifier, MODEL_LIMITS, ModelError, sameSignalDescriptor, structuredStorageElements, validateAnyDescriptor, validateAnySignal, zeroAnySignal,
  type CalcModel, type CompiledModel, type Endpoint, type HierarchyOrigin, type IRNode, type SignalDescriptor, type SignalValue, type SubsystemDefinition } from '../../model/src';
import { subsystemDefinitionHash } from './hierarchy';

export const M11_LIMITS = Object.freeze({ maxDepth: 8, maxLoopDepth: 4, maxIterations: 64, maxInvocations: 4_096, maxPartitions: 64 });
export interface M11ScopeProgram {
  kind: 'm11-child'; definitionId: string; version: number; definitionHash: string; depth: number;
  nodes: IRNode[]; stateIds: string[]; outputIds: string[]; outputTypes: Record<string, SignalDescriptor>; stateElements: number;
  execution: CalcModel['execution']; inputBindings: { port: string; nodeId: string }[];
  outputBindings: { port: string; source: Endpoint }[]; directFeedthroughPorts: string[];
}
export interface M11CompileContext {
  definitions: Map<string, SubsystemDefinition>; depth: number; loopDepth: number; ancestors: string[]; scopePath: string[];
  origins?: Record<string, HierarchyOrigin>; boundSignals?: Record<string, SignalDescriptor>;
  declaredUnits?: Record<string, string>;
  budget?: { nodes: number };
  compileChild: (definition: SubsystemDefinition, bindings: Record<string, SignalDescriptor>, context: M11CompileContext) => CompiledModel;
}
const ids = new Set<string>(M11_BLOCK_IDS);
export const isM11Block = (id: string): boolean => ids.has(id);
const clone = <T>(value: T): T => structuredClone(value);
const scalar = (valueType: 'float64' | 'boolean' = 'float64'): SignalDescriptor => ({ valueType, shape: [], unit: '1' });
function fail(node: Pick<IRNode, 'id'>, code: string, message: string, portId?: string): never { throw new ModelError([{ code, nodeId: node.id, message, ...(portId ? { portId } : {}) }]); }
function name(node: IRNode, value: unknown, description: string): string { if (typeof value !== 'string' || !isSafeIdentifier(value)) fail(node, 'INVALID_PARAMETERS', `${description}는 안전한 식별자여야 합니다.`); return value as string; }
function objectJson(node: IRNode, text: unknown): Record<string, unknown> {
  let value: unknown; try { value = JSON.parse(String(text)); } catch { fail(node, 'INVALID_PARAMETERS', 'JSON 설정을 확인하세요.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 8 || Object.keys(value).some(key => !isSafeIdentifier(key))) fail(node, 'INVALID_PARAMETERS', '초기 출력은 안전한 port 이름의 JSON 객체여야 합니다.');
  return value as Record<string, unknown>;
}
function reference(node: IRNode, context: M11CompileContext, selected = true): SubsystemDefinition {
  const ref = selected ? getDefinitionReference(node) : getDefinitionReferences(node)[node.parameters.active === 'second' ? 0 : 1];
  if (!ref) fail(node, 'UNKNOWN_SUBSYSTEM_DEFINITION', '실행할 정의 참조를 지정하세요.');
  const definition = context.definitions.get(ref!.definitionId);
  if (!definition) fail(node, 'UNKNOWN_SUBSYSTEM_DEFINITION', `정의 ${ref!.definitionId}가 없습니다.`);
  if (definition!.version !== ref!.version) fail(node, 'STALE_SUBSYSTEM_VERSION', '정의 버전 참조를 명시적으로 갱신하세요.');
  return definition!;
}
export function validateM11Hierarchy(model: CalcModel): void {
  const definitions = new Map((model.subsystems ?? []).map(definition => [definition.id, definition]));
  let visits = 0;
  const visit = (nodes: CalcModel['nodes'], ancestors: string[], depth: number, loopDepth: number): void => {
    if (depth > M11_LIMITS.maxDepth) throw new ModelError([{ code: 'HIERARCHY_DEPTH_EXCEEDED', message: '실행 정의 중첩은8단계 이하여야 합니다.' }]);
    for (const node of nodes) {
      if (++visits > 10_000) fail(node, 'M11_PROGRAM_EXPANSION_BUDGET', '계층 참조 검사 방문은10,000개 이하여야 합니다.');
      if (!isDefinitionReference(node)) continue;
      for (const ref of getDefinitionReferences(node)) {
        const definition = definitions.get(ref.definitionId);
        if (!definition) fail(node, 'UNKNOWN_SUBSYSTEM_DEFINITION', `정의 ${ref.definitionId}가 없습니다.`);
        if (definition!.version !== ref.version) fail(node, 'STALE_SUBSYSTEM_VERSION', '정의 버전 참조를 갱신하세요.');
        if (ancestors.includes(ref.definitionId)) fail(node, 'RECURSIVE_SUBSYSTEM', `실행 정의 재귀: ${[...ancestors, ref.definitionId].join(' → ')}`);
        const nextLoop = loopDepth + (['hierarchy.for-iterator', 'hierarchy.while-iterator', 'hierarchy.for-each', 'hierarchy.array-processing', 'hierarchy.neighborhood-processing', 'hierarchy.pixel-processing'].includes(node.blockType) ? 1 : 0);
        if (nextLoop > M11_LIMITS.maxLoopDepth) fail(node, 'M11_ITERATION_DEPTH', '반복 중첩은4단계 이하여야 합니다.');
        if (isM11ScopeBlock(node.blockType)) {
          const reserved = new Set(getM11ControlPorts(node));
          if (definition!.inputs.some(port => reserved.has(port.id))) fail(node, 'M11_CONTROL_PORT_COLLISION', '정의 data 입력과 제어 포트 이름이 충돌합니다.');
        }
        visit(definition!.nodes, [...ancestors, ref.definitionId], depth + 1, nextLoop);
      }
    }
  };
  visit(model.nodes, [], 0, 0);
}
export function validateM11Parameters(node: IRNode, model: CalcModel, context: M11CompileContext): void {
  if (!isM11Block(node.blockType)) return;
  const p = node.parameters;
  if (isDefinitionReference(node)) { for (const ref of getDefinitionReferences(node)) { name(node, ref.definitionId, '정의 ID'); const definition = context.definitions.get(ref.definitionId); if (!definition) fail(node, 'UNKNOWN_SUBSYSTEM_DEFINITION', `정의 ${ref.definitionId}가 없습니다.`); if (definition!.version !== ref.version) fail(node, 'STALE_SUBSYSTEM_VERSION', '정의 참조 버전을 갱신하세요.'); } }
  for (const key of ['name', 'target', 'producer', 'iterationPort', 'conditionOutput']) if (p[key] !== undefined) name(node, p[key], key);
  if (isM11ScopeBlock(node.blockType)) objectJson(node, p.initialOutputs);
  if (node.blockType === 'route.structured-bus') {
    let fields: unknown; try { fields = JSON.parse(String(p.fields)); } catch { fail(node, 'INVALID_PARAMETERS', '필드 JSON 배열을 확인하세요.'); }
    if (!Array.isArray(fields) || fields.length !== p.count || fields.length > 16 || new Set(fields).size !== fields.length) fail(node, 'INVALID_PARAMETERS', 'count와 같은 길이의 고유 필드 이름을 지정하세요.');
    p.fieldNames = (fields as unknown[]).map(field => name(node, field, '필드 이름'));
  }
  if (['route.structured-select', 'route.structured-assign'].includes(node.blockType)) {
    const path = String(p.field).split('.'); if (path.length > 8) fail(node, 'INVALID_PARAMETERS', 'Bus 경로 깊이는8 이하여야 합니다.');
    path.forEach(part => name(node, part, '필드 경로')); p.fieldPath = path;
  }
  if (node.blockType === 'hierarchy.switch-case' && new Set(p.cases as number[]).size !== (p.cases as number[]).length) fail(node, 'INVALID_PARAMETERS', 'Switch Case 값은 고유해야 합니다.');
  if (node.blockType === 'hierarchy.neighborhood-processing' && Number(p.window) % 2 !== 1) fail(node, 'INVALID_PARAMETERS', '이웃 창은1~7의 홀수여야 합니다.');
  if (node.blockType === 'events.hit-scheduler') {
    const Ts = model.execution.mode === 'continuous' ? Number(model.execution.solver?.discreteStep ?? model.execution.step) : model.execution.step;
    const times = p.times as number[]; if (new Set(times).size !== times.length) fail(node, 'INVALID_PARAMETERS', '예약 시각은 고유해야 합니다.');
    p.hitTicks = times.map(time => { const tick = (time - model.execution.startTime) / Ts; if (tick < 0 || !Number.isSafeInteger(Math.round(tick)) || Math.abs(tick - Math.round(tick)) > 1e-9 * Math.max(1, Math.abs(tick))) fail(node, 'M11_SCHEDULE_GRID', '예약 시각은 시작 이후 정수 due-grid에 있어야 합니다.'); return Math.round(tick); }).sort((a, b) => a - b);
  }
  if (node.blockType === 'functions.terminate') { const Ts = model.execution.mode === 'continuous' ? Number(model.execution.solver?.discreteStep ?? model.execution.step) : model.execution.step; const finalGrid = Math.floor((model.execution.stopTime - model.execution.startTime) / Ts + 1e-9); const { period, offset } = node.sampleTime; p.terminalTick = finalGrid < offset ? -1 : offset + Math.floor((finalGrid - offset) / period) * period; if (context.depth) fail(node, 'M11_NESTED_TERMINATE_UNSUPPORTED', '마지막 부모 due 종료 함수는 최상위 실행 graph에서만 사용하세요.'); }
  if (node.blockType === 'events.feedback-latch') {
    let descriptor: unknown; try { descriptor = JSON.parse(String(p.initialDescriptor)); } catch { fail(node, 'INVALID_PARAMETERS', '초기 metadata JSON을 확인하세요.'); }
    if (descriptor !== null) { const schema = validateAnyDescriptor(descriptor), actual = initialDescriptor(p.initial as SignalValue, schema); if (!sameSignalDescriptor(actual, schema) || !messageCapacityFits(actual, schema)) fail(node, 'M11_LATCH_TYPE', '초기 신호와 명시 metadata가 다릅니다.'); p.latchDescriptor = schema; }
  }
  if (['events.feedback-latch', 'events.receive', 'route.merge'].includes(node.blockType)) p.m11StateElements = structuredStorageElements(p.initial as SignalValue) + 8;
  if (node.blockType === 'route.data-store-memory') p.m11StateElements = structuredStorageElements(p.initial as SignalValue) + 8;
  if (node.blockType === 'events.send') p.m11StateElements = 2;
  if (node.blockType === 'events.hit-scheduler') p.m11StateElements = 2;
}
function scopeKey(node: IRNode, context: M11CompileContext): string { return JSON.stringify([...context.scopePath, ...(context.origins?.[node.id]?.path.slice(0, -1) ?? [])]); }
export function prepareM11Bindings(nodes: IRNode[], context: M11CompileContext): [string, string][] {
  const dependencies: [string, string][] = [], byId = new Map(nodes.map(node => [node.id, node]));
  const scoped = (node: IRNode): string => { if (node.parameters.scope !== 'local' && context.scopePath.length) fail(node, 'M11_SCOPE_ACCESS_UNSUPPORTED', '선택 계약은 현재 실행 정의 내부 이름 범위만 지원합니다.'); return JSON.stringify([node.parameters.scope === 'global' ? '[]' : scopeKey(node, context), node.parameters.name]); };
  const stores = new Map<string, IRNode>(), tags = new Map<string, IRNode>(), declarations = new Map<string, IRNode>();
  for (const node of nodes) {
    if (node.blockType === 'route.data-store-memory') { const key = scoped(node); if (stores.has(key)) fail(node, 'M11_DUPLICATE_STORE', '같은 범위의 저장소 선언은 유일해야 합니다.'); stores.set(key, node); node.parameters.storeKey = key; node.parameters.storeInitial = copyAnySignal(node.parameters.initial as SignalValue); node.parameters.storeDescriptor = describeAnySignal(node.parameters.initial as SignalValue); node.parameters.m11StateElements = structuredStorageElements(node.parameters.storeDescriptor as SignalDescriptor) + 8; }
    if (node.blockType === 'route.goto') { const key = scoped(node); if (tags.has(key)) fail(node, 'M11_DUPLICATE_GOTO', '같은 범위의 Goto 생산자는 유일해야 합니다.'); tags.set(key, node); }
    if (node.blockType === 'route.tag-visibility') { const key = JSON.stringify([scopeKey(node, context), node.parameters.name]); if (declarations.has(key)) fail(node, 'M11_DUPLICATE_VISIBILITY', '같은 범위의 visibility는 유일해야 합니다.'); declarations.set(key, node); }
  }
  const accessGroups = new Map<string, IRNode[]>();
  const access = (key: string, node: IRNode): void => { const group = accessGroups.get(key) ?? []; group.push(node); accessGroups.set(key, group); };
  for (const node of nodes) {
    if (node.blockType === 'route.from') {
      const producer = tags.get(scoped(node)); if (!producer || !producer.inputs.in) fail(node, 'M11_GOTO_NOT_FOUND', '현재 범위에서 연결된 Goto를 찾을 수 없습니다.');
      if (node.parameters.scope === 'scoped' && !declarations.has(JSON.stringify([scopeKey(node, context), node.parameters.name]))) fail(node, 'M11_VISIBILITY_REQUIRED', 'scoped Goto에는 같은 실행 범위 visibility 선언이 필요합니다.');
      node.parameters.tagSource = clone(producer!.inputs.in); node.inputs.in = clone(producer!.inputs.in); dependencies.push([producer!.inputs.in.nodeId, node.id]);
    }
    if (['route.data-store-read', 'route.data-store-write'].includes(node.blockType)) {
      const key = scoped(node), owner = stores.get(key); if (!owner) fail(node, 'M11_STORE_NOT_FOUND', '현재 범위에 선언된 Data Store가 없습니다.');
      Object.assign(node.parameters, { storeKey: key, storeOwner: owner!.id, storeInitial: clone(owner!.parameters.initial), storeDescriptor: clone(owner!.parameters.storeDescriptor) }); access(`store:${key}`, node);
    }
    if (['state.reader', 'state.writer', 'state.parameter-writer'].includes(node.blockType)) {
      const target = byId.get(String(node.parameters.target)); if (!target) fail(node, 'M11_TARGET_NOT_FOUND', '현재 실행 graph의 대상 블럭이 없습니다.');
      if (scopeKey(target!, context) !== scopeKey(node, context)) fail(node, 'M11_SCOPE_ACCESS_UNSUPPORTED', '다른 실행 범위의 state/parameter에 접근할 수 없습니다.');
      if (node.blockType !== 'state.parameter-writer') {
        if (!['discrete.unit-delay', 'fixed.state-space'].includes(target!.blockType)) fail(node, 'M11_STATE_TARGET_UNSUPPORTED', '선택 state 슬롯은 Unit Delay 또는 fixed State-Space value입니다.');
        const initial = target!.parameters.initial as SignalValue;
        const stateDescriptor = describeAnySignal(initial); stateDescriptor.unit = context.declaredUnits?.[target!.id] ?? '1';
        Object.assign(node.parameters, { stateTarget: target!.id, stateDescriptor }); access(`state:${target!.id}`, node);
      } else {
        const parameter = String(node.parameters.parameter), allowed = parameter === 'gain' ? target!.blockType === 'math.gain' : ['source.constant', 'io.input', 'source.signal', 'io.structured-input'].includes(target!.blockType);
        if (!allowed) fail(node, 'M11_PARAMETER_TARGET_UNSUPPORTED', 'value/gain의 shape-invariant 승인 실행 값만 변경할 수 있습니다.');
        const parameterDescriptor = literalDescriptor(target!.parameters[parameter] as SignalValue); parameterDescriptor.unit = parameter === 'gain' ? '1' : context.declaredUnits?.[target!.id] ?? '1';
        Object.assign(node.parameters, { parameterTarget: target!.id, parameterDescriptor, m11StateElements: 0 }); dependencies.push([node.id, target!.id]); access(`parameter:${target!.id}:${parameter}`, node);
      }
    }
  }
  for (const group of accessGroups.values()) {
    group.sort((a, b) => Number(a.parameters.order) - Number(b.parameters.order) || a.id.localeCompare(b.id));
    for (let index = 1; index < group.length; index++) {
      const previous = group[index - 1]!, current = group[index]!;
      if (previous.parameters.order === current.parameters.order && (previous.blockType.includes('write') || current.blockType.includes('write'))) fail(current, 'M11_EFFECT_ORDER_CONFLICT', '같은 resource의 writer/access 우선순위는 명시적으로 달라야 합니다.');
      if (previous.parameters.order !== current.parameters.order) dependencies.push([previous.id, current.id]);
    }
    const overlayOwner = group.find(node => node.blockType === 'state.parameter-writer');
    if (overlayOwner) overlayOwner.parameters.m11StateElements = structuredStorageElements(overlayOwner.parameters.parameterDescriptor as SignalDescriptor) + 80;
  }
  // Each direct split output represents an ordered call, independent of node IDs or insertion order.
  for (const split of nodes.filter(node => node.blockType === 'events.function-call-split')) {
    const consumers = nodes.filter(node => node.blockType === 'hierarchy.function-call' && node.inputs.call?.nodeId === split.id);
    const groups = getBlockPorts(split).outputs.map(port => consumers.filter(node => node.inputs.call!.portId === port).sort((a, b) => a.id.localeCompare(b.id)));
    if (groups.some(group => group.length > 1)) fail(split, 'M11_CALL_ORDER_AMBIGUOUS', '분배의 한 출력에는 하나의 직접 실행 수신자만 연결하세요.');
    const ordered = groups.flat(); for (let index = 1; index < ordered.length; index++) dependencies.push([ordered[index - 1]!.id, ordered[index]!.id]);
  }
  return dependencies;
}
export function guardM11LegacyInputs(node: IRNode, input: (port: string) => SignalDescriptor | undefined): void {
  if (isM11Block(node.blockType) || ['sink.display', 'sink.scope', 'io.output', 'io.terminator'].includes(node.blockType)) return;
  for (const port of Object.keys(node.inputs)) if (['bus', 'messages'].includes(input(port)?.valueType ?? '')) fail(node, 'M11_STRUCTURED_BOUNDARY_REQUIRED', '이 블럭은 구조화 bus/message를 소비하지 않습니다. 명시 selector 또는 Receive를 연결하세요.', port);
}
export function initialM11Outputs(node: IRNode): Record<string, SignalDescriptor> | undefined {
  if (['events.feedback-latch', 'events.receive', 'route.merge'].includes(node.blockType)) return { out: clone(node.parameters.latchDescriptor as SignalDescriptor ?? describeAnySignal(node.parameters.initial as SignalValue)), ...(node.blockType === 'events.receive' ? { valid: scalar('boolean') } : {}) };
  if (node.blockType === 'route.data-store-read') return { out: clone(node.parameters.storeDescriptor as SignalDescriptor) };
  if (node.blockType === 'state.reader') return { out: clone(node.parameters.stateDescriptor as SignalDescriptor) };
  return undefined;
}
function containsMessages(descriptor: SignalDescriptor): boolean { return descriptor.valueType === 'messages' || !!descriptor.bus?.fields.some(field => containsMessages(field.descriptor)); }
function literalDescriptor(value: SignalValue): SignalDescriptor {
  const descriptor = describeAnySignal(value);
  if (typeof value === 'object' && !Array.isArray(value) && value.kind === 'messages') descriptor.message!.maxBatch = Math.max(1, value.items.length);
  if (typeof value === 'object' && !Array.isArray(value) && value.kind === 'bus') descriptor.bus!.fields = value.fields.map(field => ({ name: field.name, descriptor: literalDescriptor(field.value) }));
  return descriptor;
}
function valueUnits(actual: SignalDescriptor, expected: SignalDescriptor): SignalDescriptor {
  actual.unit = expected.unit;
  for (const field of actual.bus?.fields ?? []) { const schema = expected.bus?.fields.find(item => item.name === field.name); if (schema) valueUnits(field.descriptor, schema.descriptor); }
  if (actual.message && expected.message) valueUnits(actual.message.payload, expected.message.payload);
  return actual;
}
function initialDescriptor(value: SignalValue, expected: SignalDescriptor): SignalDescriptor {
  const descriptor = literalDescriptor(value);
  if (typeof value === 'object' && !Array.isArray(value) && value.kind === 'messages' && !value.items.length && expected.message) descriptor.message = { payload: clone(expected.message.payload), maxBatch: 1 };
  if (typeof value === 'object' && !Array.isArray(value) && value.kind === 'bus') for (let index = 0; index < value.fields.length; index++) { const field = value.fields[index]!, schema = expected.bus?.fields.find(item => item.name === field.name); if (schema) descriptor.bus!.fields[index]!.descriptor = initialDescriptor(field.value, schema.descriptor); }
  return valueUnits(descriptor, expected);
}
function messageCapacityFits(actual: SignalDescriptor, expected: SignalDescriptor): boolean {
  if (actual.message && expected.message && actual.message.maxBatch > expected.message.maxBatch) return false;
  return !(actual.bus?.fields.some(field => { const schema = expected.bus?.fields.find(item => item.name === field.name); return schema && !messageCapacityFits(field.descriptor, schema.descriptor); }));
}
function atPath(node: IRNode, descriptor: SignalDescriptor): SignalDescriptor { let selected = descriptor; for (const field of node.parameters.fieldPath as string[]) { const found = selected.bus?.fields.find(item => item.name === field); if (selected.valueType !== 'bus' || !found) fail(node, 'M11_BUS_FIELD_NOT_FOUND', '실제 bus field 경로를 확인하세요.', 'in'); selected = found!.descriptor; } return selected; }
function control(node: IRNode, descriptor: SignalDescriptor, port: string, boolean = false): void { if (descriptor.shape.length || descriptor.unit !== '1' || (boolean ? descriptor.valueType !== 'boolean' : !['boolean', 'float64'].includes(descriptor.valueType))) fail(node, 'M11_CONTROL_TYPE', '제어 입력은 단위 없는 legacy scalar여야 합니다.', port); }
function callOrigin(node: IRNode, byId: Map<string, IRNode>, visited = new Set<string>()): IRNode | undefined { if (visited.has(node.id)) return undefined; visited.add(node.id); if (['events.function-call-generator', 'events.hit-scheduler'].includes(node.blockType)) return node; if (node.blockType === 'events.function-call-split' && node.inputs.in) return callOrigin(byId.get(node.inputs.in.nodeId)!, byId, visited); return undefined; }
function publicationOrigins(node: IRNode, byId: Map<string, IRNode>, visited = new Set<string>()): Set<string> { if (visited.has(node.id)) return new Set(); visited.add(node.id); if (isM11ScopeBlock(node.blockType)) return new Set([node.id]); const origins = new Set<string>(); for (const endpoint of Object.values(node.inputs)) for (const id of publicationOrigins(byId.get(endpoint.nodeId)!, byId, visited)) origins.add(id); return origins; }
function inferScope(node: IRNode, input: (port: string) => SignalDescriptor, context: M11CompileContext): Record<string, SignalDescriptor> {
  const definition = reference(node, context), p = node.parameters, type = node.blockType, loop = ['hierarchy.for-iterator', 'hierarchy.while-iterator'].includes(type), partitioned = ['hierarchy.for-each', 'hierarchy.array-processing', 'hierarchy.neighborhood-processing', 'hierarchy.pixel-processing'].includes(type);
  const bindings: Record<string, SignalDescriptor> = {}, controls = getM11ControlPorts(node);
  for (const port of controls) control(node, input(port), port, ['condition', 'action', 'reset'].includes(port));
  for (const port of definition.inputs) bindings[port.id] = loop && port.id === p.iterationPort ? scalar() : clone(input(port.id));
  let partitions = 1;
  if (partitioned) {
    if (definition.inputs.length !== 1 || definition.outputs.length !== 1 || definition.inputs[0]?.id !== 'in' || definition.outputs[0]?.id !== 'out') fail(node, 'M11_PARTITION_SIGNATURE', '선택 partition 정의는 in/out 한 개씩이어야 합니다.');
    const descriptor = bindings.in!; if (['bus', 'messages'].includes(descriptor.valueType) || descriptor.shape.length === 0) fail(node, 'M11_PARTITION_SHAPE', 'partition은 고정 숫자/논리 tensor를 입력합니다.', 'in');
    const axis = Number(p.axis ?? 0);
    if (type === 'hierarchy.for-each' || type === 'hierarchy.array-processing') {
      if (axis >= descriptor.shape.length) fail(node, 'M11_PARTITION_SHAPE', '분할 축이 형상 밖입니다.', 'in');
      partitions = descriptor.shape[axis]!; bindings.in = { ...clone(descriptor), shape: descriptor.shape.filter((_, index) => index !== axis) };
    } else {
      if (descriptor.shape.length !== 2) fail(node, 'M11_PARTITION_SHAPE', 'pixel/neighborhood는2D 입력만 지원합니다.', 'in');
      partitions = descriptor.shape[0]! * descriptor.shape[1]!;
      bindings.in = { ...clone(descriptor), shape: type === 'hierarchy.pixel-processing' ? [] : [Number(p.window), Number(p.window)] };
    }
    if (partitions > M11_LIMITS.maxPartitions) fail(node, 'M11_PARTITION_LIMIT', '독립 상태 partition은64개 이하여야 합니다.', 'in');
    p.partitionCount = partitions; p.partitionInputDescriptor = clone(bindings.in);
  }
  const childContext = { ...context, depth: context.depth + 1, loopDepth: context.loopDepth + (loop || partitioned ? 1 : 0), ancestors: [...context.ancestors, definition.id], scopePath: [...context.scopePath, node.id], origins: undefined, boundSignals: undefined };
  if (childContext.depth > M11_LIMITS.maxDepth || childContext.loopDepth > M11_LIMITS.maxLoopDepth || context.ancestors.includes(definition.id)) fail(node, 'RECURSIVE_SUBSYSTEM', '정의 재귀 또는 실행 중첩 상한을 초과했습니다.');
  const compileDefinition = (definition: SubsystemDefinition, childContext: M11CompileContext): CompiledModel => {
    try { return context.compileChild(definition, bindings, childContext); }
    catch (error) { if (!(error instanceof ModelError)) throw error; throw new ModelError(error.diagnostics.map(diagnostic => ({ ...diagnostic, nodeId: node.id, hierarchyPath: [node.id, ...(diagnostic.hierarchyPath ?? [])], childNodeId: diagnostic.childNodeId ?? diagnostic.nodeId }))); }
  };
  const compiled = compileDefinition(definition, childContext);
  const outputBindings = definition.outputs.map(port => { const marker = compiled.nodes.find(item => item.id === port.nodeId); if (!marker?.inputs.in) fail(node, 'DANGLING_SUBSYSTEM_OUTPUT', '자식 출력 경계가 연결되지 않았습니다.', port.id); return { port: port.id, source: clone(marker!.inputs.in) }; });
  const outputTypes = Object.fromEntries(outputBindings.map(binding => [binding.port, clone(compiled.nodes.find(item => item.id === binding.source.nodeId)!.outputs[binding.source.portId]!)]));
  if (type === 'hierarchy.while-iterator') { const conditionDescriptor = outputTypes[String(p.conditionOutput)]; if (!conditionDescriptor) fail(node, 'M11_WHILE_OUTPUT_REQUIRED', 'while 정의에 continue 조건 출력이 필요합니다.'); control(node, conditionDescriptor!, String(p.conditionOutput), true); }
  if (type === 'hierarchy.variant') {
    const inactive = reference(node, context, false);
    if (JSON.stringify(inactive.inputs.map(port => port.id)) !== JSON.stringify(definition.inputs.map(port => port.id)) || JSON.stringify(inactive.outputs.map(port => port.id)) !== JSON.stringify(definition.outputs.map(port => port.id))) fail(node, 'M11_VARIANT_INTERFACE', '두 variant 정의의 port ID와 순서는 같아야 합니다.');
    const inactiveCompiled = compileDefinition(inactive, { ...childContext, ancestors: [...context.ancestors, inactive.id] });
    for (const port of inactive.outputs) if (!sameSignalDescriptor(outputTypes[port.id]!, inactiveCompiled.nodes.find(item => item.id === port.nodeId)!.outputs.out!)) fail(node, 'M11_VARIANT_INTERFACE', '두 variant 출력 descriptor는 정확히 같아야 합니다.', port.id);
    p.inactiveDefinition = { definitionId: inactive.id, version: inactive.version, definitionHash: subsystemDefinitionHash(inactive) };
  }
  const directFeedthroughPorts = Object.keys(node.inputs);
  const program: M11ScopeProgram = { kind: 'm11-child', definitionId: definition.id, version: definition.version, definitionHash: subsystemDefinitionHash(definition), depth: childContext.depth,
    nodes: clone(compiled.nodes), stateIds: [...compiled.stateIds], outputIds: [...compiled.outputIds], outputTypes: clone(compiled.outputTypes), stateElements: compiled.stateElements,
    execution: clone(compiled.model.execution), inputBindings: definition.inputs.map(port => ({ port: port.id, nodeId: port.nodeId })), outputBindings, directFeedthroughPorts };
  p.scopeProgram = program; p.scopeInvocationLimit = M11_LIMITS.maxInvocations;
  const wrapperOutputs = Object.fromEntries(Object.entries(outputTypes).filter(([port]) => type !== 'hierarchy.while-iterator' || port !== p.conditionOutput));
  if (partitioned) {
    const result = wrapperOutputs.out!;
    if (['bus', 'messages'].includes(result.valueType)) fail(node, 'M11_PARTITION_OUTPUT', 'partition 결과는 고정 숫자/논리 tensor여야 합니다.');
    if (type === 'hierarchy.pixel-processing' || type === 'hierarchy.neighborhood-processing') { if (result.shape.length) fail(node, 'M11_PARTITION_OUTPUT', 'pixel/neighborhood 결과는 scalar여야 합니다.'); result.shape = [...input('in').shape]; }
    else { const axis = Number(p.axis); if (axis > result.shape.length || result.shape.length >= 8) fail(node, 'M11_PARTITION_OUTPUT', '결합 축과 결과 rank를 확인하세요.'); result.shape.splice(axis, 0, partitions); }
  }
  const initial = objectJson(node, p.initialOutputs), unknown = Object.keys(initial).filter(port => !Object.hasOwn(wrapperOutputs, port)); if (unknown.length) fail(node, 'INVALID_PARAMETERS', '초기 출력 JSON의 port를 확인하세요.');
  p.initialOutputs = Object.fromEntries(Object.entries(wrapperOutputs).map(([port, descriptor]) => { const value = Object.hasOwn(initial, port) ? validateAnySignal(initial[port]) : zeroAnySignal(descriptor); const actual = initialDescriptor(value, descriptor); if (!sameSignalDescriptor(actual, descriptor) || !messageCapacityFits(actual, descriptor)) fail(node, 'M11_INITIAL_OUTPUT_TYPE', '초기 출력 descriptor가 실행 출력과 다릅니다.', port); return [port, value]; }));
  const bankElements = compiled.stateElements + 16;
  p.scopeStateElements = partitions * bankElements + Object.values(p.initialOutputs as Record<string, SignalValue>).reduce<number>((total, value) => total + structuredStorageElements(value), 0) + 16;
  if (Number(p.scopeStateElements) > MODEL_LIMITS.maxStateElements) fail(node, 'STATE_BUDGET_EXCEEDED', '자식 상태·partition checkpoint 저장 예산을 초과했습니다.');
  return wrapperOutputs;
}
export function inferM11Outputs(node: IRNode, input: (port: string) => SignalDescriptor, model: CalcModel, byId: Map<string, IRNode>, context: M11CompileContext, unit = '1'): Record<string, SignalDescriptor> | undefined {
  if (!isM11Block(node.blockType)) return undefined;
  const p = node.parameters;
  if (isM11ScopeBlock(node.blockType)) {
    if (node.blockType === 'hierarchy.function-call' && node.inputs.call) { const origin = callOrigin(byId.get(node.inputs.call.nodeId)!, byId); if (origin) p.callEventRate = clone(origin.sampleTime); }
    return inferScope(node, input, context);
  }
  const message = (port: string): SignalDescriptor => { const descriptor = input(port); if (descriptor.valueType !== 'messages' || !descriptor.message) fail(node, 'M11_MESSAGE_REQUIRED', '명시 message batch가 필요합니다.', port); return descriptor; };
  switch (node.blockType) {
    case 'source.signal': case 'io.structured-input': { const descriptor = clone(context.boundSignals?.[node.id] ?? literalDescriptor(p.value as SignalValue)); if (['bus', 'messages'].includes(descriptor.valueType) && unit !== '1') fail(node, 'UNIT_MISMATCH', '구조화 외부 신호 단위는1이고 leaf 단위를 별도로 보존합니다.'); if (!['bus', 'messages'].includes(descriptor.valueType)) descriptor.unit = unit; if (descriptor.valueType === 'boolean' && unit !== '1') fail(node, 'UNIT_MISMATCH', 'boolean 신호의 단위는1이어야 합니다.'); return { out: descriptor }; }
    case 'io.structured-output': return { out: clone(input('in')) };
    case 'sink.sequence-viewer': message('in'); return { out: clone(input('in')) };
    case 'functions.element': return {};
    case 'functions.typed': { const descriptor = input('in'); if (descriptor.valueType !== 'float64' || descriptor.shape.length || descriptor.unit !== '1') fail(node, 'M11_FUNCTION_TYPE', '선택 수식 함수는 단위 없는 legacy float64 scalar입니다.', 'in'); return { out: scalar() }; }
    case 'hierarchy.if': control(node, input('in'), 'in'); if (input('in').valueType !== 'float64') fail(node, 'M11_CONTROL_TYPE', 'If 비교 입력은 float64입니다.', 'in'); return { then: scalar('boolean'), else: scalar('boolean') };
    case 'hierarchy.switch-case': control(node, input('in'), 'in'); if (input('in').valueType !== 'float64') fail(node, 'M11_CONTROL_TYPE', 'Switch Case 입력은 float64입니다.', 'in'); return Object.fromEntries(getBlockPorts(node).outputs.map(port => [port, scalar('boolean')]));
    case 'route.structured-bus': { const fields = (p.fieldNames as string[]).map((name, index) => ({ name, descriptor: clone(input(`in${index + 1}`)) })); return { out: { valueType: 'bus', shape: [], unit: '1', bus: { fields } } }; }
    case 'route.structured-select': return { out: clone(atPath(node, input('in'))) };
    case 'route.structured-assign': if (!sameSignalDescriptor(atPath(node, input('in')), input('value'))) fail(node, 'M11_BUS_ASSIGN_TYPE', '대입 field descriptor는 정확히 같아야 합니다.', 'value'); return { out: clone(input('in')) };
    case 'events.send': { control(node, input('send'), 'send', true); const payload = input('payload'); if (containsMessages(payload)) fail(node, 'M11_MESSAGE_NESTED', 'message payload에 message를 중첩할 수 없습니다.', 'payload'); p.m11StateElements = 2; return { out: { valueType: 'messages', shape: [], unit: '1', message: { payload: clone(payload), maxBatch: 1 } } }; }
    case 'events.queue': { const descriptor = message('in'); control(node, input('receive'), 'receive', true); p.m11StateElements = Number(p.capacity) * (structuredStorageElements(descriptor.message!.payload) + 81) + 128 * 65 + 3; if (Number(p.m11StateElements) > MODEL_LIMITS.maxStateElements) fail(node, 'STATE_BUDGET_EXCEEDED', '큐의 최대 payload와128 producer cursor 저장 예산을 초과했습니다.'); return { out: { ...clone(descriptor), message: { payload: clone(descriptor.message!.payload), maxBatch: Math.min(Number(p.capacity), Number(p.maxDequeue)) } }, size: scalar() }; }
    case 'events.receive': { const payload = message('in').message!.payload; const initial = valueUnits(describeAnySignal(p.initial as SignalValue), payload); if (!sameSignalDescriptor(initial, payload)) fail(node, 'M11_RECEIVE_INITIAL_TYPE', 'Receive 초기 payload와 입력 descriptor가 다릅니다.'); p.m11StateElements = structuredStorageElements(payload) + 128 * 65 + 1; return { out: clone(payload), valid: scalar('boolean') }; }
    case 'events.message-merge': { const incoming = getBlockPorts(node).inputs.map(message); if (incoming.some(descriptor => !sameSignalDescriptor(descriptor.message!.payload, incoming[0]!.message!.payload))) fail(node, 'M11_MESSAGE_PAYLOAD_TYPE', 'Merge payload descriptor는 정확히 같아야 합니다.'); return { out: { ...clone(incoming[0]!), message: { payload: clone(incoming[0]!.message!.payload), maxBatch: Math.min(64, incoming.reduce((total, descriptor) => total + descriptor.message!.maxBatch, 0)) } } }; }
    case 'events.function-call-generator': case 'events.hit-scheduler': return { out: scalar() };
    case 'events.function-call-split': control(node, input('in'), 'in'); if (input('in').valueType !== 'float64') fail(node, 'M11_CONTROL_TYPE', 'call count는 float64 scalar입니다.'); return Object.fromEntries(getBlockPorts(node).outputs.map(port => [port, scalar()]));
    case 'events.feedback-latch': return { out: clone(p.latchDescriptor as SignalDescriptor ?? describeAnySignal(p.initial as SignalValue)) };
    case 'route.merge': { const ports = getBlockPorts(node).inputs, descriptor = clone(input(ports[0]!)); if (ports.some(port => !sameSignalDescriptor(descriptor, input(port)))) fail(node, 'M11_MERGE_TYPE', '모든 conditional 입력 descriptor는 같아야 합니다.'); const initial = initialDescriptor(p.initial as SignalValue, descriptor); if (!sameSignalDescriptor(initial, descriptor)) fail(node, 'M11_MERGE_TYPE', 'Merge 초기값 descriptor를 확인하세요.'); if (descriptor.message) descriptor.message.maxBatch = Math.max(...ports.map(port => input(port).message!.maxBatch)); p.m11StateElements = structuredStorageElements(descriptor) + 8; p.mergeSources = Object.fromEntries(ports.map(port => { const origins = publicationOrigins(byId.get(node.inputs[port]!.nodeId)!, byId); if (origins.size !== 1) fail(node, 'M11_MERGE_SOURCE_REQUIRED', '각 Merge 입력은 유일한 실제 conditional publication origin이 필요합니다.', port); return [port, [...origins][0]!]; })); return { out: descriptor }; }
    case 'route.goto': return {};
    case 'route.from': return { out: clone(input('in')) };
    case 'route.tag-visibility': return {};
    case 'route.data-store-memory': return {};
    case 'route.data-store-read': return { out: clone(p.storeDescriptor as SignalDescriptor) };
    case 'route.data-store-write': if (!sameSignalDescriptor(p.storeDescriptor as SignalDescriptor, input('in'))) fail(node, 'M11_STORE_TYPE', '저장소와 쓰기 신호 descriptor는 정확히 같아야 합니다.', 'in'); return {};
    case 'state.reader': return { out: clone(p.stateDescriptor as SignalDescriptor) };
    case 'state.writer': if (!sameSignalDescriptor(p.stateDescriptor as SignalDescriptor, input('in'))) fail(node, 'M11_STATE_WRITE_TYPE', 'state slot과 입력 descriptor는 정확히 같아야 합니다.', 'in'); return {};
    case 'state.parameter-writer': if (!sameSignalDescriptor(p.parameterDescriptor as SignalDescriptor, input('in')) || !messageCapacityFits(input('in'), p.parameterDescriptor as SignalDescriptor)) fail(node, 'M11_PARAMETER_WRITE_TYPE', '실행 값 descriptor 또는 최대 batch를 바꿀 수 없습니다.', 'in'); return {};
    default: return undefined;
  }
}
export function validateM11StateInputs(node: IRNode, input: (port: string) => SignalDescriptor): boolean {
  if (!isM11Block(node.blockType)) return false;
  if (node.blockType === 'events.feedback-latch') { if (!sameSignalDescriptor(node.outputs.out!, input('in')) || !messageCapacityFits(input('in'), node.outputs.out!)) fail(node, 'M11_LATCH_TYPE', 'Latch 초기 metadata와 입력 descriptor는 같고 batch 상한 내에 있어야 합니다.', 'in'); node.parameters.m11StateElements = structuredStorageElements(node.outputs.out!) + 8; }
  const logicalElements = (descriptor: SignalDescriptor): number => descriptor.valueType === 'bus' ? descriptor.bus!.fields.reduce((total, field) => total + logicalElements(field.descriptor), 0) : descriptor.valueType === 'messages' ? descriptor.message!.maxBatch * logicalElements(descriptor.message!.payload) : descriptor.shape.reduce((total, axis) => total * axis, 1);
  for (const [port, descriptor] of Object.entries(node.outputs)) if (descriptor.shape.length > 8 || descriptor.shape.some(axis => axis < 1 || axis > 1024) || logicalElements(descriptor) > 1024) fail(node, 'SIGNAL_SIZE_EXCEEDED', '한 신호의 논리 원소는1024 이하이고 rank8/축1024 이하여야 합니다.', port);
  return true;
}
