import { z } from 'zod';
import { ModelError, type CalcModel, type Diagnostic } from './types';
import { UNITS } from './signal';
import { normalizeSolverSettings, SOLVER_LIMITS } from './continuous';
import { DATASET_LIMITS, validateDataset } from './dataset';

export const MODEL_LIMITS = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  maxDepth: 32,
  maxValues: 100_000,
  maxNodes: 1_000,
  maxEdges: 5_000,
  maxSteps: 10_000,
  maxRecordedValues: 1_000_000,
  maxStateElements: 100_000,
  maxTime: 1_000_000_000,
  minStep: 0.000000001,
});

const unsafeKeys = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype',
]);
export function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) && !unsafeKeys.has(value);
}

const identifier = z.string().refine(isSafeIdentifier, 'ID는 영문자로 시작하는 64자 이하의 안전한 식별자여야 합니다.');
const finiteNumber = z.number().finite();
const endpointSchema = z.object({ nodeId: identifier, portId: identifier }).strict();
const sampleTimeSchema = z.object({
  period: z.number().int().min(1).max(10_000),
  offset: z.number().int().min(0).max(9_999),
}).strict().refine((rate) => rate.offset < rate.period, 'offset은 period보다 작아야 합니다.');
const nodeSchema = z.object({
  id: identifier,
  blockType: z.string().max(80).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/),
  blockVersion: z.literal(1),
  label: z.string().max(100),
  parameters: z.record(z.string(), z.unknown()).refine(
    (parameters) => Object.keys(parameters).length <= 16,
    '한 블럭의 파라미터는 16개를 초과할 수 없습니다.',
  ),
  unit: z.enum(UNITS).optional(),
  sampleTime: sampleTimeSchema.optional(),
}).strict();
const edgeSchema = z.object({ id: identifier, source: endpointSchema, target: endpointSchema }).strict();
const solverSchema = z.object({
  method: z.enum(['rk4', 'rk45', 'implicit-euler']).optional(),
  newtonTolerance: finiteNumber.min(1e-14).max(1e-3).optional(),
  newtonMaxIterations: z.number().int().min(1).max(32).optional(),
  jacobianStep: finiteNumber.min(1e-8).max(1e-2).optional(),
  initialStep: finiteNumber.min(SOLVER_LIMITS.minStep).max(SOLVER_LIMITS.maxStep).optional(),
  minStep: finiteNumber.min(SOLVER_LIMITS.minStep).max(SOLVER_LIMITS.maxStep).optional(),
  maxStep: finiteNumber.min(SOLVER_LIMITS.minStep).max(SOLVER_LIMITS.maxStep).optional(),
  atol: finiteNumber.min(SOLVER_LIMITS.minTolerance).max(SOLVER_LIMITS.maxTolerance).optional(),
  rtol: finiteNumber.min(SOLVER_LIMITS.minTolerance).max(SOLVER_LIMITS.maxTolerance).optional(),
  maxSteps: z.number().int().min(1).max(SOLVER_LIMITS.maxSteps).optional(),
  maxRejects: z.number().int().min(0).max(SOLVER_LIMITS.maxRejects).optional(),
  maxEvaluations: z.number().int().min(1).max(SOLVER_LIMITS.maxEvaluations).optional(),
  eventTolerance: finiteNumber.min(SOLVER_LIMITS.minEventTolerance).max(SOLVER_LIMITS.maxEventTolerance).optional(),
  maxEvents: z.number().int().min(1).max(SOLVER_LIMITS.maxEvents).optional(),
  discreteStep: finiteNumber.min(MODEL_LIMITS.minStep).max(MODEL_LIMITS.maxTime).optional(),
}).strict();
const executionSchema = z.object({
  mode: z.enum(['static', 'discrete', 'continuous']),
  startTime: finiteNumber.min(-MODEL_LIMITS.maxTime).max(MODEL_LIMITS.maxTime),
  stopTime: finiteNumber.min(-MODEL_LIMITS.maxTime).max(MODEL_LIMITS.maxTime),
  step: finiteNumber.min(MODEL_LIMITS.minStep).max(MODEL_LIMITS.maxTime),
  solver: solverSchema.optional(),
}).strict();
const positionSchema = z.object({
  x: finiteNumber.min(-1_000_000).max(1_000_000),
  y: finiteNumber.min(-1_000_000).max(1_000_000),
}).strict();
const subsystemSchema = z.object({
  id: identifier,
  version: z.number().int().min(1).max(1_000_000),
  name: z.string().min(1).max(120),
  nodes: z.array(nodeSchema).max(MODEL_LIMITS.maxNodes),
  edges: z.array(edgeSchema).max(MODEL_LIMITS.maxEdges),
  layout: z.record(identifier, positionSchema),
  inputs: z.array(z.object({ id: identifier, nodeId: identifier }).strict()).max(8),
  outputs: z.array(z.object({ id: identifier, nodeId: identifier }).strict()).max(8),
}).strict();
const dashboardSchema = z.object({
  id: identifier,
  kind: z.enum(['slider', 'toggle', 'display', 'gauge', 'scope']),
  title: z.string().max(120),
  nodeId: identifier,
  parameter: identifier.optional(),
  min: finiteNumber.optional(),
  max: finiteNumber.optional(),
  step: finiteNumber.positive().optional(),
}).strict();

export const modelSchema = z.object({
  schemaVersion: z.literal(1),
  modelId: identifier,
  name: z.string().min(1).max(120),
  nodes: z.array(nodeSchema).max(MODEL_LIMITS.maxNodes),
  edges: z.array(edgeSchema).max(MODEL_LIMITS.maxEdges),
  execution: executionSchema,
  layout: z.record(identifier, positionSchema),
  datasets: z.array(z.unknown()).max(DATASET_LIMITS.maxDatasets).optional(),
  subsystems: z.array(subsystemSchema).max(16).optional(),
  dashboard: z.array(dashboardSchema).max(32).optional(),
  notes: z.string().max(2_000).optional(),
}).strict();

function fail(code: string, message: string): never {
  throw new ModelError([{ code, message }]);
}

/** Bound and inspect untrusted values before recursive schema processing. Never invoke accessors. */
function inspectJsonValue(input: unknown): void {
  const pending: { value: unknown; depth: number; leave?: boolean }[] = [{ value: input, depth: 0 }];
  const active = new WeakSet<object>();
  let values = 0;
  let byteEstimate = 0;
  const encoder = new TextEncoder();
  while (pending.length > 0) {
    const item = pending.pop()!;
    if (item.leave) { active.delete(item.value as object); continue; }
    if (++values > MODEL_LIMITS.maxValues) fail('MODEL_RESOURCE_LIMIT', '모델의 값 개수가 허용 상한을 초과했습니다.');
    if (item.depth > MODEL_LIMITS.maxDepth) fail('MODEL_DEPTH_EXCEEDED', '모델의 중첩 깊이는 32단계 이하여야 합니다.');
    const value = item.value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) fail('NONFINITE_INPUT', '모델 숫자는 유한한 float64 값이어야 합니다.');
      byteEstimate += 24;
    } else if (typeof value === 'string') {
      if (value.length > MODEL_LIMITS.maxBytes) fail('MODEL_TOO_LARGE', '모델 JSON은 5 MiB 이하여야 합니다.');
      byteEstimate += encoder.encode(JSON.stringify(value)).byteLength;
    } else if (value === null || typeof value === 'boolean') {
      byteEstimate += 5;
    } else if (typeof value === 'object') {
      if (active.has(value)) fail('INVALID_MODEL', '모델에는 순환 객체 참조를 사용할 수 없습니다.');
      active.add(value);
      pending.push({ value, depth: item.depth, leave: true });
      byteEstimate += 2;
      const isArray = Array.isArray(value);
      const prototype = Object.getPrototypeOf(value);
      if ((!isArray && prototype !== Object.prototype && prototype !== null)
        || (isArray && prototype !== Array.prototype)) {
        fail('UNSAFE_FIELD', '모델에는 일반 JSON 객체와 배열만 사용할 수 있습니다.');
      }
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.length > MODEL_LIMITS.maxValues || (isArray && value.length > MODEL_LIMITS.maxEdges)) {
        fail('MODEL_RESOURCE_LIMIT', '모델 배열 또는 객체가 허용 상한을 초과했습니다.');
      }
      if (isArray && Object.keys(descriptors).length !== value.length + 1) fail('INVALID_MODEL', '배열은 빈 칸이나 추가 속성을 포함할 수 없습니다.');
      for (const key of keys) {
        if (typeof key !== 'string' || unsafeKeys.has(key)) fail('UNSAFE_FIELD', '모델에 안전하지 않은 필드명이 있습니다.');
        if (isArray && key === 'length') continue;
        if (isArray && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) {
          fail('INVALID_MODEL', '배열은 빈 칸이나 추가 속성을 포함할 수 없습니다.');
        }
        const descriptor = descriptors[key]!;
        if (!('value' in descriptor) || !descriptor.enumerable) fail('UNSAFE_FIELD', '모델에는 접근자나 숨김 속성을 사용할 수 없습니다.');
        byteEstimate += encoder.encode(JSON.stringify(key)).byteLength + 2;
        pending.push({ value: descriptor.value, depth: item.depth + 1 });
      }
    } else {
      fail('INVALID_MODEL', '모델에는 JSON이 표현할 수 있는 값만 사용할 수 있습니다.');
    }
    if (byteEstimate > MODEL_LIMITS.maxBytes) fail('MODEL_TOO_LARGE', '모델 JSON은 5 MiB 이하여야 합니다.');
  }
}

/** Return a defensive JSON clone; unknown versions and fields fail closed. */
export function parseModel(input: unknown): CalcModel {
  inspectJsonValue(input);
  const parsed = modelSchema.safeParse(input);
  if (!parsed.success) {
    const diagnostics: Diagnostic[] = parsed.error.issues.slice(0, 20).map((issue) => ({
      code: 'INVALID_MODEL',
      message: `${issue.path.map(String).join('.') || 'model'}: ${issue.message}`,
      ...(() => {
        if (issue.path[0] !== 'nodes' || typeof issue.path[1] !== 'number' || input === null || typeof input !== 'object') return {};
        const nodes = (input as Record<string, unknown>).nodes;
        const entry = Array.isArray(nodes) ? nodes[issue.path[1]] : undefined;
        const id = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).id : undefined;
        return typeof id === 'string' && isSafeIdentifier(id) ? { nodeId: id } : {};
      })(),
    }));
    throw new ModelError(diagnostics);
  }
  const model = parsed.data as CalcModel;
  if (model.execution.solver !== undefined) {
    if (model.execution.mode !== 'continuous') fail('UNSUPPORTED_SOLVER', '솔버 설정은 연속·혼합 실행에서만 사용할 수 있습니다.');
    model.execution.solver = normalizeSolverSettings(model.execution);
  }
  const diagnostics: Diagnostic[] = [];
  if (model.datasets) {
    model.datasets = model.datasets.map(validateDataset);
    const ids = new Set<string>();
    for (const dataset of model.datasets) {
      if (ids.has(dataset.id)) diagnostics.push({ code: 'DUPLICATE_DATASET_ID', message: `데이터 ID ${dataset.id}가 중복되었습니다.` });
      ids.add(dataset.id);
    }
  }
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const node of model.nodes) {
    if (nodeIds.has(node.id)) diagnostics.push({ code: 'DUPLICATE_NODE_ID', message: `블럭 ID ${node.id}가 중복되었습니다.`, nodeId: node.id });
    nodeIds.add(node.id);
  }
  for (const edge of model.edges) {
    if (edgeIds.has(edge.id)) diagnostics.push({ code: 'DUPLICATE_EDGE_ID', message: `연결 ID ${edge.id}가 중복되었습니다.` });
    edgeIds.add(edge.id);
  }
  for (const id of Object.keys(model.layout)) {
    if (!nodeIds.has(id)) diagnostics.push({ code: 'UNKNOWN_LAYOUT_NODE', message: `배치 정보의 블럭 ${id}가 존재하지 않습니다.`, nodeId: id });
  }
  let totalNodes = model.nodes.length, totalEdges = model.edges.length;
  const subsystemIds = new Set<string>();
  for (const definition of model.subsystems ?? []) {
    if (subsystemIds.has(definition.id)) diagnostics.push({ code: 'DUPLICATE_SUBSYSTEM_ID', message: `서브시스템 ID ${definition.id}가 중복되었습니다.` });
    subsystemIds.add(definition.id); totalNodes += definition.nodes.length; totalEdges += definition.edges.length;
    const localNodes = new Set<string>(), localEdges = new Set<string>();
    for (const node of definition.nodes) {
      if (localNodes.has(node.id)) diagnostics.push({ code: 'DUPLICATE_NODE_ID', message: `${definition.id} 내부 블럭 ID ${node.id}가 중복되었습니다.`, nodeId: node.id });
      localNodes.add(node.id);
    }
    for (const edge of definition.edges) {
      if (localEdges.has(edge.id)) diagnostics.push({ code: 'DUPLICATE_EDGE_ID', message: `${definition.id} 내부 연결 ID ${edge.id}가 중복되었습니다.` });
      localEdges.add(edge.id);
    }
    for (const id of Object.keys(definition.layout)) if (!localNodes.has(id)) diagnostics.push({ code: 'UNKNOWN_LAYOUT_NODE', message: `${definition.id} 배치 정보의 블럭 ${id}가 존재하지 않습니다.`, nodeId: id });
    for (const ports of [definition.inputs, definition.outputs]) {
      const ids = new Set<string>();
      for (const port of ports) {
        if (ids.has(port.id)) diagnostics.push({ code: 'DUPLICATE_SUBSYSTEM_PORT', message: `${definition.id} 인터페이스 ID ${port.id}가 중복되었습니다.` });
        ids.add(port.id);
        if (!localNodes.has(port.nodeId)) diagnostics.push({ code: 'UNKNOWN_SUBSYSTEM_PORT', message: `${definition.id} 인터페이스 블럭 ${port.nodeId}가 존재하지 않습니다.` });
      }
    }
  }
  if (totalNodes > MODEL_LIMITS.maxNodes || totalEdges > MODEL_LIMITS.maxEdges) diagnostics.push({ code: 'MODEL_RESOURCE_LIMIT', message: '서브시스템 정의를 포함한 전체 블럭/연결 개수가 상한을 초과했습니다.' });
  const widgetIds = new Set<string>();
  for (const widget of model.dashboard ?? []) {
    if (widgetIds.has(widget.id)) diagnostics.push({ code: 'DUPLICATE_DASHBOARD_ID', message: `대시보드 ID ${widget.id}가 중복되었습니다.` });
    widgetIds.add(widget.id);
    if (!nodeIds.has(widget.nodeId)) diagnostics.push({ code: 'UNKNOWN_DASHBOARD_NODE', message: `대시보드의 블럭 ${widget.nodeId}가 존재하지 않습니다.`, nodeId: widget.nodeId });
    if (widget.kind === 'slider' || widget.kind === 'gauge') {
      if (widget.min === undefined || widget.max === undefined || widget.min >= widget.max || !Number.isFinite(widget.max - widget.min)) diagnostics.push({ code: 'INVALID_DASHBOARD_RANGE', message: '슬라이더/게이지의 min/max는 유한하고 min < max여야 합니다.' });
    }
    if (widget.kind === 'slider' || widget.kind === 'toggle') {
      if (!widget.parameter) diagnostics.push({ code: 'INVALID_DASHBOARD_PARAMETER', message: '입력 위젯에는 parameter가 필요합니다.' });
    }
  }
  if (diagnostics.length > 0) throw new ModelError(diagnostics.slice(0, 20));
  // The inspection guarantees only JSON values, so the clone cannot invoke user hooks.
  return JSON.parse(JSON.stringify(model)) as CalcModel;
}

export function parseModelJson(text: string): CalcModel {
  if (typeof text !== 'string') fail('INVALID_JSON', '모델 파일은 JSON 텍스트여야 합니다.');
  if (text.length > MODEL_LIMITS.maxBytes || new TextEncoder().encode(text).byteLength > MODEL_LIMITS.maxBytes) {
    fail('MODEL_TOO_LARGE', '모델 JSON은 5 MiB 이하여야 합니다.');
  }
  // Reject pathological nesting before JSON.parse can allocate a deep object tree.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === '{' || character === '[') {
      if (++depth > MODEL_LIMITS.maxDepth + 1) fail('MODEL_DEPTH_EXCEEDED', '모델의 중첩 깊이는 32단계 이하여야 합니다.');
    } else if (character === '}' || character === ']') depth--;
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail('INVALID_JSON', 'JSON 형식을 확인해 주세요.'); }
  return parseModel(value);
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue((value as Record<string, unknown>)[key])]));
  }
  return value;
}

export function serializeModel(input: CalcModel): string {
  return JSON.stringify(canonicalValue(parseModel(input)), null, 2);
}

/** Presentation edits do not alter the execution key; graph insertion order does not matter. */
export function canonicalSemantic(input: CalcModel): string {
  const model = parseModel(input);
  const semantic = {
    schemaVersion: model.schemaVersion,
    modelId: model.modelId,
    execution: model.execution.mode === 'continuous' ? { ...model.execution, solver: normalizeSolverSettings(model.execution) } : model.execution,
    nodes: model.nodes.filter((node) => !['annotation.note', 'annotation.model-info'].includes(node.blockType)).sort((a, b) => compareId(a.id, b.id)).map(({ id, blockType, blockVersion, parameters, unit, sampleTime }) => ({ id, blockType, blockVersion, parameters, unit: unit ?? '1', sampleTime: sampleTime ?? { period: 1, offset: 0 } })),
    edges: [...model.edges].sort((a, b) => compareId(a.id, b.id)),
    ...(model.datasets?.length ? { datasets: [...model.datasets].sort((a, b) => compareId(a.id, b.id)).map(({ id, version, sourceHash, contentHash, timeColumn, columns, rows }) => ({ id, version, sourceHash, contentHash, timeColumn, columns, rows })) } : {}),
    ...(model.subsystems?.length ? { subsystems: [...model.subsystems].sort((a, b) => compareId(a.id, b.id)).map((definition) => ({
      id: definition.id, version: definition.version,
      nodes: definition.nodes.filter((node) => !['annotation.note', 'annotation.model-info'].includes(node.blockType)).sort((a, b) => compareId(a.id, b.id)).map(({ id, blockType, blockVersion, parameters, unit, sampleTime }) => ({ id, blockType, blockVersion, parameters, unit: unit ?? '1', sampleTime: sampleTime ?? { period: 1, offset: 0 } })),
      edges: [...definition.edges].sort((a, b) => compareId(a.id, b.id)),
      inputs: [...definition.inputs].sort((a, b) => compareId(a.id, b.id)), outputs: [...definition.outputs].sort((a, b) => compareId(a.id, b.id)),
    })) } : {}),
  };
  return JSON.stringify(canonicalValue(semantic));
}

function compareId(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
