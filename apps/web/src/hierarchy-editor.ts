import type { CalcModel, CalcNode, Diagnostic, SubsystemDefinition } from '../../../packages/model/src';
import { subsystemSemanticKey } from '../../../packages/compiler/src/hierarchy';
import { getDefinitionReference, isDefinitionReference } from '../../../packages/block-library/src/m11';

export function hierarchyView(root: CalcModel, path: string[]): { model: CalcModel; definition?: SubsystemDefinition; trail: { nodeId: string; label: string; definitionId: string }[] } {
  let nodes = root.nodes, definition: SubsystemDefinition | undefined;
  const trail: { nodeId: string; label: string; definitionId: string }[] = [];
  for (const nodeId of path.slice(0, 8)) {
    const instance = nodes.find(node => node.id === nodeId && isDefinitionReference(node));
    const reference = instance && getDefinitionReference(instance);
    definition = root.subsystems?.find(candidate => candidate.id === reference?.definitionId);
    if (!instance || !definition) return { model: root, trail: [] };
    trail.push({ nodeId, label: instance.label, definitionId: definition.id }); nodes = definition.nodes;
  }
  return { model: definition ? { ...root, name: definition.name, nodes: definition.nodes, edges: definition.edges, layout: definition.layout } : root, definition, trail };
}
/** Resolve only an exact, existing instance path and leaf. Stale diagnostics never select an unrelated root ID. */
export function diagnosticLocation(root: CalcModel, diagnostic: Diagnostic): { path: string[]; nodeId: string } | undefined {
  const path = diagnostic.hierarchyPath ?? [];
  if (!Array.isArray(path) || path.length > 8 || path.some(id => typeof id !== 'string' || !id.length)) return undefined;
  const view = hierarchyView(root, path);
  if (view.trail.length !== path.length) return undefined;
  const nodeId = path.length ? diagnostic.childNodeId : diagnostic.nodeId;
  if (typeof nodeId !== 'string' || !view.model.nodes.some(node => node.id === nodeId)) return undefined;
  return { path: [...path], nodeId };
}
export function applyHierarchyView(root: CalcModel, path: string[], view: CalcModel): CalcModel {
  const current = hierarchyView(root, path);
  if (!current.definition) return view;
  const definitions = new Map((view.subsystems ?? root.subsystems!).map(definition => [definition.id, definition]));
  const old = current.definition, edited: SubsystemDefinition = { ...old, name: view.name, nodes: view.nodes, edges: view.edges, layout: view.layout };
  const changed = subsystemSemanticKey(old) !== subsystemSemanticKey(edited);
  if (changed) edited.version += 1;
  definitions.set(old.id, edited);
  let rootNodes = root.nodes;
  if (changed) for (let index = current.trail.length - 1; index >= 0; index -= 1) {
    const entry = current.trail[index]!, version = definitions.get(entry.definitionId)!.version;
    const parentId = current.trail[index - 1]?.definitionId, parent = parentId ? definitions.get(parentId)! : undefined;
    const nodes = (parent?.nodes ?? rootNodes).map(node => node.id === entry.nodeId ? { ...node, parameters: { ...node.parameters, [node.blockType === 'hierarchy.variant' && node.parameters.active === 'second' ? 'alternateVersion' : 'version']: version } } : node);
    if (parent) definitions.set(parent.id, { ...parent, nodes, version: parent.version + 1 }); else rootNodes = nodes;
  }
  return { ...root, execution: view.execution, nodes: rootNodes, subsystems: [...definitions.values()] };
}
/** Explicitly refresh every instance after leaf definitions were edited. */
export function updateSubsystemInstances(root: CalcModel): CalcModel {
  const definitions = new Map(root.subsystems?.map(definition => [definition.id, definition]) ?? []);
  const update = (nodes: CalcNode[]): CalcNode[] => nodes.map(node => {
    if (!isDefinitionReference(node)) return node;
    const definition = definitions.get(String(node.parameters.definitionId));
    const alternate = node.blockType === 'hierarchy.variant' ? definitions.get(String(node.parameters.alternateDefinitionId)) : undefined;
    if ((!definition || node.parameters.version === definition.version) && (!alternate || node.parameters.alternateVersion === alternate.version)) return node;
    return { ...node, parameters: { ...node.parameters, ...(definition ? { version: definition.version } : {}), ...(alternate ? { alternateVersion: alternate.version } : {}) } };
  });
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const [id, definition] of definitions) {
      const nodes = update(definition.nodes);
      if (nodes.some((node, index) => node !== definition.nodes[index])) { definitions.set(id, { ...definition, nodes, version: definition.version + 1 }); changed = true; }
    }
    if (!changed) break;
  }
  return { ...root, nodes: update(root.nodes), ...(root.subsystems ? { subsystems: [...definitions.values()] } : {}) };
}

export function validateBoundaryPortId(value: string): string {
  const id = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || Object.getOwnPropertyNames(Object.prototype).includes(id) || id === 'prototype') throw new Error('포트 ID는 영문자로 시작하는 1~64자의 영문·숫자·_·- 조합입니다.');
  return id;
}

/** An explicit interface edit updates every reference edge; unrelated variant interfaces stay intact. */
export function renameDefinitionPort(root: CalcModel, definitionId: string, nodeId: string, input: string): CalcModel {
  const id = validateBoundaryPortId(input), old = root.subsystems?.find(definition => definition.id === definitionId);
  if (!old) throw new Error('하위 도식 정의를 찾을 수 없습니다.');
  const direction = old.inputs.some(port => port.nodeId === nodeId) ? 'inputs' : old.outputs.some(port => port.nodeId === nodeId) ? 'outputs' : undefined;
  if (!direction) throw new Error('정의의 경계 블록을 선택하세요.');
  const previous = old[direction].find(port => port.nodeId === nodeId)!.id;
  if (previous === id) return root;
  if (old[direction].some(port => port.nodeId !== nodeId && port.id === id)) throw new Error('같은 방향에 이미 사용 중인 포트 ID입니다.');
  const edited = { ...old, version: old.version + 1, [direction]: old[direction].map(port => port.nodeId === nodeId ? { ...port, id } : port) };
  const rewrite = (nodes: CalcNode[], edges: CalcModel['edges']): CalcModel['edges'] => {
    const instances = new Set(nodes.filter(node => getDefinitionReference(node)?.definitionId === definitionId).map(node => node.id));
    return edges.map(edge => direction === 'inputs' && instances.has(edge.target.nodeId) && edge.target.portId === previous ? { ...edge, target: { ...edge.target, portId: id } } : direction === 'outputs' && instances.has(edge.source.nodeId) && edge.source.portId === previous ? { ...edge, source: { ...edge.source, portId: id } } : edge);
  };
  const definitions = root.subsystems!.map(definition => {
    const current = definition.id === definitionId ? edited : definition, edges = rewrite(current.nodes, current.edges);
    return edges.some((edge, index) => edge !== current.edges[index]) ? { ...current, edges, version: current.version + 1 } : current;
  });
  return updateSubsystemInstances({ ...root, edges: rewrite(root.nodes, root.edges), subsystems: definitions });
}
