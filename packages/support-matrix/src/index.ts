import artifact from '../../../docs/support-matrix.json';
import type { CanonicalSupport, SourceSupportRow, SupportFilter, SupportMatrix } from './types';
import { SUPPORT_MATRIX_LIMITS, validateSupportMatrix } from './validate';
export type * from './types';
export { SUPPORT_MATRIX_LIMITS, validateSupportMatrix } from './validate';
export * from './current-extensions';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) freeze(entry);
    Object.freeze(value);
  }
  return value;
}
/** Frozen 0.17.0-m16 source audit. Current extensions are exported separately. */
export const SUPPORT_MATRIX: Readonly<SupportMatrix> = freeze(validateSupportMatrix(artifact));
const bySource = new Map(SUPPORT_MATRIX.rows.map(row => [row.id, row]));
const byCanonical = new Map(SUPPORT_MATRIX.canonicalContracts.map(contract => [contract.id, contract]));

export function getSourceSupport(id: string): Readonly<SourceSupportRow> | undefined {
  return typeof id === 'string' && /^\d{2}-\d{3}$/.test(id) ? bySource.get(id) : undefined;
}
export function getCanonicalSupport(id: string): Readonly<CanonicalSupport> | undefined {
  return typeof id === 'string' && id.length <= 100 ? byCanonical.get(id) : undefined;
}
export function getSupportSummary(): Readonly<SupportMatrix['counts']> { return SUPPORT_MATRIX.counts; }
export function listSourceSupport(filter: SupportFilter = {}): readonly Readonly<SourceSupportRow>[] {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) throw new Error('Invalid support filter');
  if (![Object.prototype, null].includes(Object.getPrototypeOf(filter))) throw new Error('Invalid support filter prototype');
  if (Reflect.ownKeys(filter).some(key => typeof key !== 'string')) throw new Error('Support filter must be plain JSON');
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(filter))) if (!('value' in descriptor)) throw new Error('Support filter accessors are not allowed');
  for (const key of Object.keys(filter)) if (!['query', 'section', 'classification', 'decision', 'target'].includes(key)) throw new Error('Unknown support filter');
  if (filter.query !== undefined && (typeof filter.query !== 'string' || filter.query.length > 256)) throw new Error('Support query must have at most 256 characters');
  if (filter.section !== undefined && (!Number.isInteger(filter.section) || filter.section < 1 || filter.section > 21)) throw new Error('Invalid source section');
  if (filter.classification !== undefined && !['native-capability', 'shared-configuration', 'preset', 'independent-alternative', 'conditional-adapter', 'legacy'].includes(filter.classification)) throw new Error('Invalid support classification');
  if (filter.decision !== undefined && !['selected-subset', 'unsupported', 'legacy-unavailable'].includes(filter.decision)) throw new Error('Invalid support decision');
  if (filter.target !== undefined && !['typescript', 'python', 'wasm', 'c-cpp'].includes(filter.target)) throw new Error('Invalid support target');
  const query = (filter.query ?? '').trim().toLocaleLowerCase('en-US');
  return SUPPORT_MATRIX.rows.filter(row => {
    if (filter.section !== undefined && row.section !== filter.section) return false;
    if (filter.classification !== undefined && row.decision.classification !== filter.classification) return false;
    if (filter.decision !== undefined && row.decision.status !== filter.decision) return false;
    if (filter.target !== undefined && !row.capabilities.targets.some(target => target.target === filter.target && target.status === 'selected-config-eligible')) return false;
    if (!query) return true;
    return [row.id, row.name, row.subgroup, row.condition, ...row.implementations.map(item => item.id)].join('\n').toLocaleLowerCase('en-US').includes(query);
  });
}
export function serializeSupportMatrix(): string {
  const text = JSON.stringify(SUPPORT_MATRIX, null, 2) + '\n';
  if (new TextEncoder().encode(text).length > SUPPORT_MATRIX_LIMITS.maxBytes) throw new Error('Support report byte limit');
  return text;
}
