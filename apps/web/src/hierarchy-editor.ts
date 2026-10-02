import type { CalcModel, CalcNode, SubsystemDefinition } from '../../../packages/model/src';
import { subsystemSemanticKey } from '../../../packages/compiler/src/hierarchy';

export function hierarchyView(root: CalcModel, path: string[]): { model: CalcModel; definition?: SubsystemDefinition; trail: { nodeId: string; label: string; definitionId: string }[] } {
  let nodes = root.nodes, definition: SubsystemDefinition | undefined;
  const trail: { nodeId: string; label: string; definitionId: string }[] = [];
  for (const nodeId of path.slice(0, 8)) {
    const instance = nodes.find(node => node.id === nodeId && node.blockType === 'hierarchy.subsystem');
    definition = root.subsystems?.find(candidate => candidate.id === instance?.parameters.definitionId);
    if (!instance || !definition) return { model: root, trail: [] };
    trail.push({ nodeId, label: instance.label, definitionId: definition.id }); nodes = definition.nodes;
  }
  return { model: definition ? { ...root, name: definition.name, nodes: definition.nodes, edges: definition.edges, layout: definition.layout } : root, definition, trail };
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
    const nodes = (parent?.nodes ?? rootNodes).map(node => node.id === entry.nodeId ? { ...node, parameters: { ...node.parameters, version } } : node);
    if (parent) definitions.set(parent.id, { ...parent, nodes, version: parent.version + 1 }); else rootNodes = nodes;
  }
  return { ...root, execution: view.execution, nodes: rootNodes, subsystems: [...definitions.values()] };
}
/** Explicitly refresh every instance after leaf definitions were edited. */
export function updateSubsystemInstances(root: CalcModel): CalcModel {
  const definitions = new Map(root.subsystems?.map(definition => [definition.id, definition]) ?? []);
  const update = (nodes: CalcNode[]): CalcNode[] => nodes.map(node => {
    const definition = node.blockType === 'hierarchy.subsystem' ? definitions.get(String(node.parameters.definitionId)) : undefined;
    return definition && node.parameters.version !== definition.version ? { ...node, parameters: { ...node.parameters, version: definition.version } } : node;
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
