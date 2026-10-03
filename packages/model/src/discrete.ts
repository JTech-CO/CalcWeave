import { signalElementCount, validateSignal } from './signal';
import type { IRNode } from './types';
import { m9StateElementCount } from './m9';
import { typedStorageElements, validateTypedSignal } from './typed';

/** Logical persistent memory, excluding temporary atomic-commit copies. Input is validated IR. */
export function discreteStateElementCount(node: IRNode): number {
  if (typeof node.parameters.m13StateElements === 'number') return node.parameters.m13StateElements;
  if (typeof node.parameters.m12DiscreteStateElements === 'number') return node.parameters.m12DiscreteStateElements;
  if (typeof node.parameters.scopeStateElements === 'number') return node.parameters.scopeStateElements;
  if (typeof node.parameters.m11StateElements === 'number') return node.parameters.m11StateElements;
  const m9Count = m9StateElementCount(node);
  if (m9Count !== undefined) return m9Count;
  const initialCount = (): number => signalElementCount(validateSignal(node.parameters.initial));
  switch (node.blockType) {
    case 'fixed.state-space': return typedStorageElements(validateTypedSignal(node.parameters.initial));
    case 'discrete.unit-delay': case 'discrete.integrator': case 'discrete.difference': case 'discrete.derivative':
    case 'time.rate-transition': return initialCount();
    case 'discrete.delay': return (node.parameters.steps as number) * initialCount();
    case 'discrete.fir': return Math.max(0, (node.parameters.coefficients as number[]).length - 1) * initialCount();
    case 'discrete.transfer-function': return (node.parameters.numerator as number[]).length + (node.parameters.denominator as number[]).length - 2;
    case 'discrete.state-space': return (node.parameters.initial as number[]).length;
    case 'logic.edge-detect': case 'source.random': return 1;
    default: return 0;
  }
}

export function discreteMemoryElementCount(nodes: readonly IRNode[]): number {
  return nodes.reduce((count, node) => count + discreteStateElementCount(node)
    + Object.values(node.outputs).reduce((held, descriptor) => held + signalElementCount(descriptor), 0), 0);
}
