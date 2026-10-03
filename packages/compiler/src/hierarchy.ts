import {
  MODEL_LIMITS, ModelError, parseModel,
  type CalcEdge, type CalcModel, type CalcNode, type Endpoint, type HierarchyMetadata,
  type SubsystemDefinition,
} from '../../model/src';
import { sha256 } from '../../model/src/sha256';

export const HIERARCHY_LIMITS = Object.freeze({
  maxDefinitions: 16, maxPorts: 8, maxDepth: 8,
  maxInstances: 1_000, maxExpandedVisits: 10_000,
});

export interface FlattenHierarchyResult extends HierarchyMetadata { model: CalcModel }
type Graph = Pick<CalcModel, 'nodes' | 'edges' | 'layout'>;
interface ScopedEndpoint extends Endpoint { path: string[] }
const compareId = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const scopedNode = (path: string[], id: string): string => JSON.stringify([path, id]);
const scopedPort = (endpoint: ScopedEndpoint): string => JSON.stringify([endpoint.path, endpoint.nodeId, endpoint.portId]);

function fail(code: string, message: string, nodeId?: string, portId?: string): never {
  throw new ModelError([{ code, message, ...(nodeId ? { nodeId } : {}), ...(portId ? { portId } : {}) }]);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  }
  return value;
}

/** Identity, revision and presentation are separate from a definition's executable body. */
export function subsystemSemanticKey(definition: SubsystemDefinition): string {
  return JSON.stringify(canonical({
    nodes: definition.nodes.filter((node) => node.blockType !== 'annotation.note' && node.blockType !== 'annotation.model-info').sort((a, b) => compareId(a.id, b.id)).map(({ id, blockType, blockVersion, parameters, unit, sampleTime }) => ({
      id, blockType, blockVersion, parameters, unit: unit ?? '1', sampleTime: sampleTime ?? { period: 1, offset: 0 },
    })),
    edges: [...definition.edges].sort((a, b) => compareId(a.id, b.id)),
    inputs: [...definition.inputs].sort((a, b) => compareId(a.id, b.id)),
    outputs: [...definition.outputs].sort((a, b) => compareId(a.id, b.id)),
  }));
}

export function subsystemDefinitionHash(definition: SubsystemDefinition): string {
  return sha256(JSON.stringify([definition.id, definition.version, subsystemSemanticKey(definition)]));
}

/** Hashed paths keep deeply nested IDs inside the model's 64-character identifier contract. */
export function hierarchyNodeId(path: readonly string[], nodeId: string): string {
  return path.length === 0 ? nodeId : `hf_${sha256(JSON.stringify(['node', path, nodeId])).slice(0, 40)}`;
}

function hierarchyEdgeId(path: readonly string[], edgeId: string): string {
  return path.length === 0 ? edgeId : `he_${sha256(JSON.stringify(['edge', path, edgeId])).slice(0, 40)}`;
}

function boundaryAnnotation(node: CalcNode): void {
  if ((node.unit !== undefined && node.unit !== '1') || (node.sampleTime !== undefined && (node.sampleTime.period !== 1 || node.sampleTime.offset !== 0))) {
    fail('HIERARCHY_BOUNDARY_ANNOTATION', `${node.id}의 계층 경계는 투명한 연결입니다. 단위와 실행 주기는 내부 계산 블럭에 설정해 주세요.`, node.id);
  }
}

function referencedDefinition(node: CalcNode, definitions: Map<string, SubsystemDefinition>): SubsystemDefinition {
  boundaryAnnotation(node);
  if (Object.keys(node.parameters).some((key) => key !== 'definitionId' && key !== 'version')
    || typeof node.parameters.definitionId !== 'string'
    || !Number.isSafeInteger(node.parameters.version) || (node.parameters.version as number) < 1) {
    fail('INVALID_SUBSYSTEM_PARAMETERS', `${node.id}에는 정의 ID와 양의 정수 버전만 지정할 수 있습니다.`, node.id);
  }
  const definition = definitions.get(node.parameters.definitionId as string);
  if (!definition) fail('UNKNOWN_SUBSYSTEM_DEFINITION', `${node.id}이 참조하는 서브시스템 정의가 없습니다.`, node.id);
  if (definition.version !== node.parameters.version) {
    fail('STALE_SUBSYSTEM_VERSION', `${node.id}의 참조 버전 ${node.parameters.version}은 현재 정의 버전 ${definition.version}과 다릅니다. 참조를 명시적으로 갱신해 주세요.`, node.id);
  }
  return definition;
}

function validateGraph(graph: Graph, definition: SubsystemDefinition | undefined, definitions: Map<string, SubsystemDefinition>): void {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  if (nodes.size !== graph.nodes.length) fail('DUPLICATE_NODE_ID', '서브시스템의 블럭 ID가 중복되었습니다.');
  if (new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length) fail('DUPLICATE_EDGE_ID', '서브시스템의 연결 ID가 중복되었습니다.');
  for (const id of Object.keys(graph.layout)) if (!nodes.has(id)) fail('UNKNOWN_LAYOUT_NODE', `배치 정보의 블럭 ${id}가 존재하지 않습니다.`, id);
  const inputMarkers = new Set(definition?.inputs.map((port) => port.nodeId));
  const outputMarkers = new Set(definition?.outputs.map((port) => port.nodeId));
  for (const [ports, blockType] of [[definition?.inputs ?? [], 'io.input'], [definition?.outputs ?? [], 'io.output']] as const) {
    if (ports.length > HIERARCHY_LIMITS.maxPorts) fail('HIERARCHY_PORT_LIMIT', '서브시스템의 입력과 출력은 각각 8개 이하여야 합니다.');
    if (new Set(ports.map((port) => port.id)).size !== ports.length || new Set(ports.map((port) => port.nodeId)).size !== ports.length) {
      fail('DUPLICATE_SUBSYSTEM_PORT', '서브시스템 포트 ID와 경계 블럭은 같은 방향에서 중복될 수 없습니다.');
    }
    for (const port of ports) {
      const marker = nodes.get(port.nodeId);
      if (!marker || (marker.blockType !== blockType && marker.blockType !== (blockType === 'io.input' ? 'io.structured-input' : 'io.structured-output'))) fail('INVALID_SUBSYSTEM_PORT', `${port.id}의 경계 블럭은 ${blockType}이어야 합니다.`, port.nodeId, port.id);
      boundaryAnnotation(marker);
    }
  }
  for (const node of graph.nodes) {
    if (node.blockType !== 'hierarchy.subsystem') continue;
    const nested = referencedDefinition(node, definitions);
    const inputs = new Set(nested.inputs.map((port) => port.id));
    const outputs = new Set(nested.outputs.map((port) => port.id));
    for (const edge of graph.edges) {
      if (edge.target.nodeId === node.id && !inputs.has(edge.target.portId)) fail('UNKNOWN_SUBSYSTEM_PORT', `${node.id}의 입력 포트 ${edge.target.portId}가 없습니다.`, node.id, edge.target.portId);
      if (edge.source.nodeId === node.id && !outputs.has(edge.source.portId)) fail('UNKNOWN_SUBSYSTEM_PORT', `${node.id}의 출력 포트 ${edge.source.portId}가 없습니다.`, node.id, edge.source.portId);
    }
    for (const port of nested.inputs) {
      const incoming = graph.edges.filter((edge) => edge.target.nodeId === node.id && edge.target.portId === port.id);
      if (incoming.length === 0) fail('MISSING_SUBSYSTEM_INPUT', `${node.id}의 입력 ${port.id}를 연결해 주세요.`, node.id, port.id);
      if (incoming.length > 1) fail('DUPLICATE_INPUT', `${node.id}의 입력 ${port.id}에는 한 연결만 허용됩니다.`, node.id, port.id);
    }
  }
  for (const edge of graph.edges) {
    if (!nodes.has(edge.source.nodeId)) fail(definition ? 'DANGLING_SUBSYSTEM_EDGE' : 'UNKNOWN_ENDPOINT', `연결 ${edge.id}의 출력 블럭이 없습니다.`, edge.source.nodeId, edge.source.portId);
    if (!nodes.has(edge.target.nodeId)) fail(definition ? 'DANGLING_SUBSYSTEM_EDGE' : 'UNKNOWN_ENDPOINT', `연결 ${edge.id}의 입력 블럭이 없습니다.`, edge.target.nodeId, edge.target.portId);
    if (inputMarkers.has(edge.target.nodeId) || (inputMarkers.has(edge.source.nodeId) && edge.source.portId !== 'out')) {
      fail('INVALID_SUBSYSTEM_PORT_EDGE', '입력 경계에는 out 출력만 연결할 수 있습니다.', edge.source.nodeId);
    }
    if (outputMarkers.has(edge.source.nodeId) || (outputMarkers.has(edge.target.nodeId) && edge.target.portId !== 'in')) {
      fail('INVALID_SUBSYSTEM_PORT_EDGE', '출력 경계에는 in 입력만 연결할 수 있습니다.', edge.target.nodeId);
    }
  }
  for (const port of definition?.outputs ?? []) {
    const incoming = graph.edges.filter((edge) => edge.target.nodeId === port.nodeId);
    if (incoming.length !== 1) fail('DANGLING_SUBSYSTEM_OUTPUT', `출력 ${port.id}의 경계에는 한 입력 연결이 필요합니다.`, port.nodeId, port.id);
  }
}

/** Expand reusable definitions into independent primitive instances before normal compilation. */
export function flattenHierarchy(input: CalcModel): FlattenHierarchyResult {
  const original = parseModel(input);
  const definitions = new Map((original.subsystems ?? []).map((definition) => [definition.id, definition]));
  if (definitions.size !== (original.subsystems ?? []).length) fail('DUPLICATE_SUBSYSTEM_DEFINITION', '서브시스템 정의 ID가 중복되었습니다.');
  if (definitions.size > HIERARCHY_LIMITS.maxDefinitions) fail('HIERARCHY_DEFINITION_LIMIT', '서브시스템 정의는 16개 이하여야 합니다.');
  validateGraph(original, undefined, definitions);
  for (const definition of definitions.values()) validateGraph(definition, definition, definitions);
  const depths = new Map<string, number>();
  const visitDefinition = (definition: SubsystemDefinition, ancestors: string[]): number => {
    if (ancestors.includes(definition.id)) fail('RECURSIVE_SUBSYSTEM', `서브시스템은 자신을 직접 또는 간접 참조할 수 없습니다: ${[...ancestors, definition.id].join(' → ')}.`);
    if (depths.has(definition.id)) return depths.get(definition.id)!;
    let depth = 1;
    for (const node of definition.nodes) if (node.blockType === 'hierarchy.subsystem') depth = Math.max(depth, 1 + visitDefinition(referencedDefinition(node, definitions), [...ancestors, definition.id]));
    if (depth > HIERARCHY_LIMITS.maxDepth) fail('HIERARCHY_DEPTH_EXCEEDED', '서브시스템 중첩은 8단계 이하여야 합니다.');
    depths.set(definition.id, depth);
    return depth;
  };
  for (const definition of definitions.values()) visitDefinition(definition, []);

  const model = structuredClone(original);
  delete model.subsystems;
  model.nodes = []; model.edges = []; model.layout = {};
  const origins: HierarchyMetadata['origins'] = {};
  const instances: HierarchyMetadata['instances'] = [];
  const actualNodes = new Map<string, string>();
  const aliases = new Map<string, ScopedEndpoint>();
  const unresolvedEdges: { id: string; source: ScopedEndpoint; target: Endpoint }[] = [];
  const nodeIds = new Set(original.nodes.map((node) => node.id));
  const edgeIds = new Set(original.edges.map((edge) => edge.id));
  const definitionHashes = new Map([...definitions.values()].map((definition) => [definition.id, subsystemDefinitionHash(definition)]));
  let visits = 0;
  const expand = (graph: Graph, path: string[], definition?: SubsystemDefinition, incoming?: Map<string, ScopedEndpoint>): void => {
    const inputMarkers = new Set(definition?.inputs.map((port) => port.nodeId));
    const outputMarkers = new Set(definition?.outputs.map((port) => port.nodeId));
    for (const port of definition?.inputs ?? []) aliases.set(scopedPort({ path, nodeId: port.nodeId, portId: 'out' }), incoming!.get(port.id)!);
    for (const node of [...graph.nodes].sort((a, b) => compareId(a.id, b.id))) {
      if (++visits > HIERARCHY_LIMITS.maxExpandedVisits) fail('HIERARCHY_EXPANSION_BUDGET', '서브시스템 확장 방문은 10,000개 이하여야 합니다.');
      if (inputMarkers.has(node.id) || outputMarkers.has(node.id)) continue;
      const id = hierarchyNodeId(path, node.id);
      if (path.length !== 0) {
        if (nodeIds.has(id)) fail('HIERARCHY_ID_COLLISION', '서브시스템 확장 ID가 기존 블럭 ID와 충돌했습니다.', path[0]);
        nodeIds.add(id);
      }
      if (node.blockType === 'hierarchy.subsystem') {
        const nested = referencedDefinition(node, definitions);
        const nextPath = [...path, node.id];
        instances.push({ nodeId: id, path: nextPath, definitionId: nested.id, version: nested.version, definitionHash: definitionHashes.get(nested.id)! });
        if (instances.length > HIERARCHY_LIMITS.maxInstances) fail('HIERARCHY_INSTANCE_LIMIT', '서브시스템 인스턴스는 확장 후 1,000개 이하여야 합니다.', nextPath[0]);
        const bindings = new Map(nested.inputs.map((port) => {
          const edge = graph.edges.find((edge) => edge.target.nodeId === node.id && edge.target.portId === port.id)!;
          return [port.id, { ...edge.source, path }] as const;
        }));
        for (const port of nested.outputs) {
          const edge = nested.edges.find((edge) => edge.target.nodeId === port.nodeId)!;
          aliases.set(scopedPort({ path, nodeId: node.id, portId: port.id }), { ...edge.source, path: nextPath });
        }
        expand(nested, nextPath, nested, bindings);
        continue;
      }
      actualNodes.set(scopedNode(path, node.id), id);
      model.nodes.push({ ...structuredClone(node), id });
      if (model.nodes.length > MODEL_LIMITS.maxNodes) fail('HIERARCHY_NODE_LIMIT', '서브시스템 확장 후 계산 블럭은 1,000개 이하여야 합니다.');
      if (graph.layout[node.id]) model.layout[id] = structuredClone(graph.layout[node.id]!);
      if (definition) origins[id] = { path: [...path, node.id], rootNodeId: path[0]!, definitionId: definition.id };
    }
    for (const edge of [...graph.edges].sort((a, b) => compareId(a.id, b.id))) {
      const targetId = actualNodes.get(scopedNode(path, edge.target.nodeId));
      if (!targetId) continue; // Instance inputs and output markers are resolved through aliases.
      const id = hierarchyEdgeId(path, edge.id);
      if (path.length !== 0) {
        if (edgeIds.has(id)) fail('HIERARCHY_ID_COLLISION', '서브시스템 확장 ID가 기존 연결 ID와 충돌했습니다.', path[0]);
        edgeIds.add(id);
      }
      unresolvedEdges.push({ id, source: { ...edge.source, path }, target: { nodeId: targetId, portId: edge.target.portId } });
      if (unresolvedEdges.length > MODEL_LIMITS.maxEdges) fail('HIERARCHY_EDGE_LIMIT', '서브시스템 확장 후 연결은 5,000개 이하여야 합니다.');
    }
  };
  expand(original, []);
  const resolveSource = (source: ScopedEndpoint): Endpoint => {
    const visited = new Set<string>();
    while (aliases.has(scopedPort(source))) {
      const key = scopedPort(source);
      if (visited.has(key)) fail('HIERARCHY_ALIAS_CYCLE', '계산 블럭 없이 계층 입력과 출력만 순환 연결되었습니다.', source.path[0] ?? source.nodeId);
      visited.add(key);
      source = aliases.get(key)!;
    }
    const nodeId = actualNodes.get(scopedNode(source.path, source.nodeId));
    if (!nodeId) fail('DANGLING_SUBSYSTEM_PORT', '서브시스템 포트의 실제 계산 블럭을 찾을 수 없습니다.', source.path[0] ?? source.nodeId, source.portId);
    return { nodeId, portId: source.portId };
  };
  model.edges = unresolvedEdges.map((edge) => ({ id: edge.id, source: resolveSource(edge.source), target: edge.target }));
  return { model, origins, instances };
}

function availableId(base: string, occupied: Set<string>): string {
  if (!occupied.has(base)) { occupied.add(base); return base; }
  for (let suffix = 2; suffix <= 10_000; suffix += 1) {
    const id = `${base}_${suffix}`;
    if (!occupied.has(id)) { occupied.add(id); return id; }
  }
  return fail('HIERARCHY_ID_BUDGET', '새 서브시스템 ID를 만들 수 없습니다.');
}

/** Group selected blocks as a real reusable definition, preserving boundary fan-out and state. */
export function createSubsystemFromSelection(input: CalcModel, selectedNodeIds: readonly string[], name = '서브시스템'): CalcModel {
  const model = parseModel(input);
  const selected = new Set(selectedNodeIds);
  if (selected.size === 0 || [...selected].some((id) => !model.nodes.some((node) => node.id === id))) fail('INVALID_SUBSYSTEM_SELECTION', '모델에 존재하는 블럭을 하나 이상 선택해 주세요.');
  if ((model.subsystems?.length ?? 0) >= HIERARCHY_LIMITS.maxDefinitions) fail('HIERARCHY_DEFINITION_LIMIT', '서브시스템 정의는 16개 이하여야 합니다.');
  const nodes = model.nodes.filter((node) => selected.has(node.id));
  const internal = model.edges.filter((edge) => selected.has(edge.source.nodeId) && selected.has(edge.target.nodeId));
  const incoming = model.edges.filter((edge) => !selected.has(edge.source.nodeId) && selected.has(edge.target.nodeId)).sort((a, b) => compareId(a.id, b.id));
  const outgoing = model.edges.filter((edge) => selected.has(edge.source.nodeId) && !selected.has(edge.target.nodeId)).sort((a, b) => compareId(a.id, b.id));
  const endpointKey = (endpoint: Endpoint): string => JSON.stringify([endpoint.nodeId, endpoint.portId]);
  const inputSources = [...new Set(incoming.map((edge) => endpointKey(edge.source)))].sort(compareId);
  const outputSources = [...new Set(outgoing.map((edge) => endpointKey(edge.source)))].sort(compareId);
  if (inputSources.length > HIERARCHY_LIMITS.maxPorts || outputSources.length > HIERARCHY_LIMITS.maxPorts) fail('HIERARCHY_PORT_LIMIT', '선택 영역의 외부 입력과 출력 신호는 각각 8개 이하여야 합니다.');
  const definitionId = availableId('subsystem', new Set(model.subsystems?.map((definition) => definition.id)));
  const instanceId = availableId('subsystem', new Set(model.nodes.map((node) => node.id)));
  const innerNodeIds = new Set(nodes.map((node) => node.id));
  const innerEdgeIds = new Set(internal.map((edge) => edge.id).concat(incoming.map((edge) => edge.id)));
  const definition: SubsystemDefinition = { id: definitionId, version: 1, name: name.trim().slice(0, 120) || '서브시스템', nodes, edges: internal, layout: {}, inputs: [], outputs: [] };
  const positions = nodes.map((node) => model.layout[node.id] ?? { x: 0, y: 0 });
  const minX = Math.min(...positions.map((point) => point.x)), minY = Math.min(...positions.map((point) => point.y));
  const clamp = (value: number): number => Math.max(-1_000_000, Math.min(1_000_000, value));
  for (const node of nodes) { const point = model.layout[node.id] ?? { x: 0, y: 0 }; definition.layout[node.id] = { x: clamp(point.x - minX), y: clamp(point.y - minY) }; }
  const outside = model.edges.filter((edge) => !selected.has(edge.source.nodeId) && !selected.has(edge.target.nodeId));
  inputSources.forEach((source, index) => {
    const nodeId = availableId(`inport${index + 1}`, innerNodeIds), id = `in${index + 1}`;
    definition.inputs.push({ id, nodeId });
    definition.nodes.push({ id: nodeId, blockType: 'io.input', blockVersion: 1, label: `입력 ${index + 1}`, parameters: { value: 1 } });
    definition.layout[nodeId] = { x: -220, y: index * 140 };
    const edges = incoming.filter((edge) => endpointKey(edge.source) === source);
    definition.edges.push(...edges.map((edge) => ({ ...edge, source: { nodeId, portId: 'out' } })));
    outside.push({ ...edges[0]!, target: { nodeId: instanceId, portId: id } });
  });
  outputSources.forEach((source, index) => {
    const nodeId = availableId(`outport${index + 1}`, innerNodeIds), id = `out${index + 1}`;
    definition.outputs.push({ id, nodeId });
    definition.nodes.push({ id: nodeId, blockType: 'io.output', blockVersion: 1, label: `출력 ${index + 1}`, parameters: {} });
    definition.layout[nodeId] = { x: clamp(Math.max(...positions.map((point) => point.x)) - minX + 240), y: index * 140 };
    const edges = outgoing.filter((edge) => endpointKey(edge.source) === source);
    definition.edges.push({ id: availableId(`outedge${index + 1}`, innerEdgeIds), source: edges[0]!.source, target: { nodeId, portId: 'in' } });
    outside.push(...edges.map((edge) => ({ ...edge, source: { nodeId: instanceId, portId: id } })));
  });
  model.nodes = model.nodes.filter((node) => !selected.has(node.id));
  model.nodes.push({ id: instanceId, blockType: 'hierarchy.subsystem', blockVersion: 1, label: definition.name.slice(0, 100), parameters: { definitionId, version: 1 } });
  model.edges = outside;
  for (const id of selected) delete model.layout[id];
  model.layout[instanceId] = { x: positions.reduce((sum, point) => sum + point.x, 0) / positions.length, y: positions.reduce((sum, point) => sum + point.y, 0) / positions.length };
  model.subsystems = [...model.subsystems ?? [], definition];
  // Validate aliases, recursion and expansion bounds before the editor accepts the mutation.
  flattenHierarchy(model);
  return model;
}
