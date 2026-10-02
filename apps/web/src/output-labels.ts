import type { CalcModel } from '../../../packages/model/src';
import { flattenHierarchy } from '../../../packages/compiler/src/hierarchy';

const cache = new WeakMap<CalcModel, Record<string, string>>();
/** Resolve names from the immutable execution snapshot, including internal sinks. */
export function outputLabels(model: CalcModel): Record<string, string> {
  const previous = cache.get(model); if (previous) return previous;
  const labels = Object.fromEntries(model.nodes.map(node => [node.id, node.label]));
  try {
    const flattened = flattenHierarchy(model);
    for (const node of flattened.model.nodes) {
      const origin = flattened.origins[node.id];
      if (!origin) { labels[node.id] = node.label; continue; }
      let nodes = model.nodes;
      const path: string[] = [];
      for (const id of origin.path.slice(0, -1)) {
        const instance = nodes.find(item => item.id === id);
        if (!instance) break;
        path.push(instance.label); nodes = model.subsystems?.find(definition => definition.id === instance.parameters.definitionId)?.nodes ?? [];
      }
      labels[node.id] = [...path, node.label].join(' / ');
    }
  } catch { /* Root names remain available for unsupported historical snapshots. */ }
  cache.set(model, labels); return labels;
}
