import type { CalcModel } from '../../../packages/model/src';
import { flattenHierarchy } from '../../../packages/compiler/src/hierarchy';
import { isMultiInputObserver, observerInputCount } from './observer-connections';

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

const multiInputCache = new WeakMap<CalcModel, ReadonlySet<string>>();
/** Identify observation inputs from the run snapshot, never from bus field names. */
export function multiInputOutputIds(model: CalcModel): ReadonlySet<string> {
  const previous = multiInputCache.get(model); if (previous) return previous;
  let nodes = model.nodes;
  try { nodes = flattenHierarchy(model).model.nodes; } catch { /* Preserve usable root history. */ }
  const ids = new Set(nodes.filter(node => isMultiInputObserver(node) && observerInputCount(node) > 1).map(node => node.id));
  multiInputCache.set(model, ids); return ids;
}
