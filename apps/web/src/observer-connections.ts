import { getBlockPorts } from '../../../packages/block-library/src';
import type { CalcModel, CalcNode } from '../../../packages/model/src';

export const MAX_OBSERVER_INPUTS = 16;
export const isMultiInputObserver = (node: CalcNode) => node.blockType === 'sink.display' || node.blockType === 'sink.scope';
export function observerInputCount(node: CalcNode): number {
  const count = node.parameters.inputCount ?? 1;
  return Number.isInteger(count) && Number(count) >= 1 && Number(count) <= MAX_OBSERVER_INPUTS ? Number(count) : 1;
}

/** The unconnected spare handle is editor affordance, never a required model input. */
export function editorBlockPorts(node: CalcNode, model: CalcModel) {
  const ports = getBlockPorts(node, model);
  if (!isMultiInputObserver(node) || ports.inputs.length >= MAX_OBSERVER_INPUTS) return ports;
  if (!ports.inputs.every(port => model.edges.some(edge => edge.target.nodeId === node.id && edge.target.portId === port))) return ports;
  return { ...ports, inputs: [...ports.inputs, `in${ports.inputs.length + 1}`] };
}

export interface EditorConnection { source: string | null; sourceHandle?: string | null; target: string | null; targetHandle?: string | null }
export function planEditorConnection(model: CalcModel, connection: EditorConnection): { targetPort: string; targetNode: CalcNode } | undefined {
  if (model.edges.length >= 5000 || !connection.source || !connection.sourceHandle || !connection.target) return;
  const source = model.nodes.find(node => node.id === connection.source), target = model.nodes.find(node => node.id === connection.target);
  if (!source || !target || !getBlockPorts(source, model).outputs.includes(connection.sourceHandle)) return;
  const ports = getBlockPorts(target, model).inputs;
  const occupied = (port: string) => model.edges.some(edge => edge.target.nodeId === target.id && edge.target.portId === port);
  if (!isMultiInputObserver(target)) {
    if (!connection.targetHandle || !ports.includes(connection.targetHandle) || occupied(connection.targetHandle)) return;
    return { targetPort: connection.targetHandle, targetNode: target };
  }
  // Only the next spare handle or a real input can be addressed, never arbitrary port IDs.
  const nextPort = `in${ports.length + 1}`;
  if (connection.targetHandle && !ports.includes(connection.targetHandle) && connection.targetHandle !== nextPort) return;
  const free = connection.targetHandle && ports.includes(connection.targetHandle) && !occupied(connection.targetHandle)
    ? connection.targetHandle : ports.find(port => !occupied(port));
  if (free) return { targetPort: free, targetNode: target };
  if (ports.length >= MAX_OBSERVER_INPUTS) return;
  return { targetPort: nextPort, targetNode: { ...target, parameters: { ...target.parameters, inputCount: ports.length + 1 } } };
}
