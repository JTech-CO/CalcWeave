import { z } from 'zod';
import type { SupportMatrix } from './types';

export const SUPPORT_MATRIX_LIMITS = Object.freeze({ maxBytes: 8 * 1024 * 1024, maxValues: 300000, maxDepth: 32, maxString: 20000, maxArray: 4096, maxObjectKeys: 1024, maxQuery: 256, maxRows: 385 });
const text = z.string().max(SUPPORT_MATRIX_LIMITS.maxString);
const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_.-]+$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const path = z.string().max(200).regex(/^(docs|packages|dataset|tests)\/[a-zA-Z0-9_./-]+$/).refine(value => !value.split('/').includes('..'));
const modes = z.array(z.enum(['static', 'discrete', 'continuous'])).max(3);
const target = z.object({ target: z.enum(['typescript', 'python', 'wasm', 'c-cpp']), version: id,
  status: z.enum(['selected-config-eligible', 'ui-only', 'unsupported', 'environment-unavailable']), supportedModes: modes,
  dtypeScope: text, reason: text, requiresActualModelValidation: z.literal(true), allConfigurationsVerified: z.literal(false) }).strict();
const parameter = z.object({ kind: id, label: text, default: z.unknown(), min: z.number().finite().optional(), max: z.number().finite().optional(),
  options: z.array(text).max(256).optional(), minLength: z.number().int().nonnegative().optional(), maxLength: z.number().int().nonnegative().optional(), required: z.boolean().optional(),
  qaStatus: z.literal('declared-local-schema-not-exhaustive-source-inventory') }).strict();
const canonical = z.object({ id, kind: z.enum(['registry-block', 'model-widget', 'unavailable-capability']), label: text, englishName: text, description: text,
  parameters: z.record(id, parameter), declaration: z.object({ valueType: text, shape: text, unit: text, sampleTime: text, state: text,
    inputs: z.array(id).max(16), outputs: z.array(id).max(16) }).strict(),
  dtype: z.object({ status: z.enum(['compiler-validated-per-model', 'selected-widget', 'unavailable']), scope: text, sourceInventoryVerified: z.literal(false) }).strict(),
  supportedModes: modes, bindings: z.array(text).max(16).optional(), targets: z.array(target).length(4), fullEquivalence: z.literal(false) }).strict();
const optionProfile = z.object({ parameters: z.record(id, z.unknown()), modes, evidencePath: path, fixtureIds: z.array(text).max(256), scope: z.literal('selected-config-only'),
  presetId: id.optional(), rawFixtureId: id.optional(), requiredBindingsActuallyConnected: z.array(id).max(16).optional() }).strict();
const evidence = z.object({ path, sha256: hash, kind: z.enum(['reference', 'contract', 'source-approval', 'execution-proof', 'ui-proof', 'target-proof']), scope: text,
  claim: z.enum(['tracking-only', 'selected-subset']), fixtureIds: z.array(text).max(256).optional() }).strict();
const row = z.object({ id: z.string().regex(/^\d{2}-\d{3}$/), name: text, section: z.number().int().min(1).max(21), ordinal: z.number().int().min(1).max(100), subgroup: text,
  condition: text, owner: z.literal('JTech-Co'), source: z.object({ path, line: z.number().int().positive(), identitySha256: hash,
    href: z.string().regex(/^https:\/\/github\.com\/JTech-CO\/CalcWeave\/blob\/main\/dataset\/Simulink_Basic_Blocks_R2024b\.md#L\d+$/) }).strict(),
  verification: z.object({ engineVersion: id, contractVersion: z.literal('source-support-m16-v1'), auditScope: z.literal('tracking-and-declared-selected-contracts') }).strict(),
  decision: z.object({ status: z.enum(['selected-subset', 'unsupported', 'legacy-unavailable']), classification: z.enum(['native-capability', 'shared-configuration', 'preset', 'independent-alternative', 'conditional-adapter', 'legacy']), priorStatus: text, reason: text }).strict(),
  implementations: z.array(z.object({ id, kind: z.enum(['registry-block', 'model-widget', 'unavailable-capability']) }).strict()).min(1).max(16),
  sourceInventory: z.object({ status: z.literal('unverified'), version: z.literal('R2024b'), reason: text, fullOptionInventoryObtained: z.literal(false), requiredDimensions: z.array(text).min(6).max(16) }).strict(),
  capabilities: z.object({ optionsRef: z.array(id).min(1).max(16), optionProfiles: z.array(optionProfile).max(128), dtype: z.object({ status: z.enum(['conditional-model-validation', 'ui-only', 'unavailable']), scopes: z.array(z.object({ canonical: id, description: text }).strict()).min(1).max(16) }).strict(), modes, modeQaStatus: z.literal('declared-canonical-modes-require-model-validation'), targets: z.array(target).length(4) }).strict(),
  externalConditions: z.object({ nativeExecution: z.enum(['unverified', 'unavailable']), sourceCondition: text, profileIds: z.array(id).max(16), requirements: z.array(text).max(32), rights: z.literal('not-inferred-from-implementation'), primarySourceRuntimeExecuted: z.literal(false) }).strict(),
  evidence: z.array(evidence).min(3).max(32), unresolvedReasons: z.array(text).min(1).max(16), trackingDecisionComplete: z.literal(true), fullEquivalence: z.literal(false) }).strict();
const count = z.number().int().nonnegative().max(10000);
const schema = z.object({ schemaVersion: z.literal(1), contractVersion: z.literal('source-support-m16-v1'), owner: z.literal('JTech-Co'), engineVersion: id, sourceVersion: z.literal('R2024b'),
  counts: z.object({ trackedSourceRows: z.literal(385), uniqueSourceNames: z.literal(339), selectedSubsetRows: count, unsupportedRows: count, unverifiedInventoryRows: z.literal(385), fullOptionEquivalentRows: z.literal(0), registryDefinitions: count,
    canonicalContracts: count, widgetContracts: count, unavailableContracts: count, pythonDefinitionMembership: count, wasmDefinitionMembership: count, trackingDecisionCompleteRows: z.literal(385) }).strict(),
  sections: z.array(z.object({ id: z.number().int().min(1).max(21), name: text, rows: count }).strict()).length(21), artifacts: z.record(path, hash), protectedArtifacts: z.record(path, hash),
  canonicalContracts: z.array(canonical).max(512), rows: z.array(row).length(385), fullSimulinkEquivalenceClaimed: z.literal(false), numericalReferenceRuntimeExecuted: z.literal(false), exhaustiveSourceOptionInventoryVerified: z.literal(false), methodology: z.array(text).min(6).max(32) }).strict();

/** Bound unknown input before schema access; never invoke getters, custom serialization or recursion hooks. */
function inspect(value: unknown): void {
  const stack: { value: unknown; depth: number; leave?: boolean }[] = [{ value, depth: 0 }];
  const active = new Set<object>(); let values = 0, bytes = 0;
  while (stack.length) {
    const item = stack.pop()!; if (item.leave) { active.delete(item.value as object); continue; }
    if (++values > SUPPORT_MATRIX_LIMITS.maxValues || item.depth > SUPPORT_MATRIX_LIMITS.maxDepth) throw new Error('Support matrix resource limit');
    const current = item.value;
    if (typeof current === 'string') { if (current.length > SUPPORT_MATRIX_LIMITS.maxString) throw new Error('Support string resource limit'); bytes += jsonStringBytes(current); }
    else if (current !== null && typeof current === 'object') {
      const proto = Object.getPrototypeOf(current); if (proto !== Object.prototype && proto !== null && proto !== Array.prototype) throw new Error('Support values must be plain JSON');
      const keys = Reflect.ownKeys(current);
      if (keys.some(key => typeof key === 'symbol')) throw new Error('Support symbols are not JSON');
      if (Array.isArray(current) ? current.length > SUPPORT_MATRIX_LIMITS.maxArray : keys.length > SUPPORT_MATRIX_LIMITS.maxObjectKeys) throw new Error('Support collection resource limit');
      if (active.has(current)) throw new Error('Support values must be acyclic'); active.add(current); stack.push({ value: current, depth: item.depth, leave: true });
      const descriptors = Object.getOwnPropertyDescriptors(current);
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (key === 'length' && Array.isArray(current)) continue;
        if (!('value' in descriptor) || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Support accessors or unsafe keys are forbidden');
        bytes += jsonStringBytes(key) + 2; stack.push({ value: descriptor.value, depth: item.depth + 1 });
      }
    } else if (typeof current === 'number') { if (!Number.isFinite(current)) throw new Error('Support values must be finite JSON'); bytes += 24; }
    else if (typeof current === 'boolean' || current === null) bytes += 5;
    else throw new Error('Support values must be JSON');
    if (bytes > SUPPORT_MATRIX_LIMITS.maxBytes) throw new Error('Support matrix byte limit');
  }
}
function jsonStringBytes(value: string): number {
  let count = 2;
  for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index);
    if (code < 32) count += code === 8 || code === 9 || code === 10 || code === 12 || code === 13 ? 2 : 6;
    else if (code === 34 || code === 92) count += 2;
    else if (code < 128) count++;
    else if (code < 2048) count += 2;
    else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { count += 4; index++; }
    else count += code >= 0xd800 && code <= 0xdfff ? 6 : 3;
  }
  return count;
}
function require(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function unique(values: readonly string[], name: string): void { require(new Set(values).size === values.length, `${name} must be unique`); }
function checkTargets(targets: SupportMatrix['rows'][number]['capabilities']['targets']): void {
  unique(targets.map(value => value.target), 'Targets');
  for (const value of targets) { unique(value.supportedModes, 'Target modes'); if (value.status !== 'selected-config-eligible') require(value.supportedModes.length === 0, 'Unsupported target cannot declare executable modes'); }
}
export function validateSupportMatrix(input: unknown): SupportMatrix {
  inspect(input); const result = schema.parse(input) as SupportMatrix;
  unique(result.rows.map(value => value.id), 'Source IDs'); unique(result.canonicalContracts.map(value => value.id), 'Canonical IDs');
  const contracts = new Map(result.canonicalContracts.map(value => [value.id, value]));
  require(result.counts.canonicalContracts === contracts.size, 'Canonical count mismatch');
  for (const [kind, field] of [['registry-block', 'registryDefinitions'], ['model-widget', 'widgetContracts'], ['unavailable-capability', 'unavailableContracts']] as const) require(result.canonicalContracts.filter(value => value.kind === kind).length === result.counts[field], `${field} mismatch`);
  require(new Set(result.rows.map(value => value.name)).size === result.counts.uniqueSourceNames, 'Source name count mismatch');
  require(result.rows.filter(value => value.decision.status === 'selected-subset').length === result.counts.selectedSubsetRows, 'Selected subset count mismatch');
  require(result.rows.filter(value => value.decision.status !== 'selected-subset').length === result.counts.unsupportedRows, 'Unsupported count mismatch');
  require(result.counts.selectedSubsetRows + result.counts.unsupportedRows === 385, 'Source decisions do not partition inventory');
  require(Object.keys(result.protectedArtifacts).length === 25, 'Protected history must contain exactly25 artifacts');
  for (const contract of result.canonicalContracts) {
    unique(contract.supportedModes, 'Modes'); checkTargets(contract.targets);
    for (const parameter of Object.values(contract.parameters)) require(Object.hasOwn(parameter, 'default'), 'Parameter default must be explicit');
    if (contract.kind !== 'registry-block') require(contract.targets.every(value => value.status !== 'selected-config-eligible'), 'Non-block cannot advertise executable target');
    if (contract.kind === 'unavailable-capability') require(contract.supportedModes.length === 0, 'Unavailable capability cannot advertise mode');
  }
  const ordinals = new Map<number, number>();
  for (const row of result.rows) {
    const ordinal = (ordinals.get(row.section) ?? 0) + 1; ordinals.set(row.section, ordinal);
    require(row.ordinal === ordinal && row.id === `${String(row.section).padStart(2, '0')}-${String(ordinal).padStart(3, '0')}`, 'Source identity/order mismatch');
    require(row.verification.engineVersion === result.engineVersion, 'Row verification version mismatch');
    unique(row.capabilities.optionsRef, 'Contract refs'); unique(row.capabilities.modes, 'Row modes'); checkTargets(row.capabilities.targets);
    require(row.implementations.map(value => value.id).join('|') === row.capabilities.optionsRef.join('|'), 'Option refs do not match implementations');
    for (const implementation of row.implementations) require(contracts.get(implementation.id)?.kind === implementation.kind, 'Unknown or wrong-kind canonical ref');
    if (row.decision.status !== 'selected-subset') {
      require(row.capabilities.modes.length === 0 && row.capabilities.optionProfiles.length === 0, 'Unsupported source cannot approve configuration');
      require(row.capabilities.targets.every(value => value.status !== 'selected-config-eligible'), 'Unsupported source cannot advertise target');
      require(row.implementations.every(value => value.kind === 'unavailable-capability'), 'Unsupported source must be classified separately');
    }
    for (const profile of row.capabilities.optionProfiles) {
      require(profile.fixtureIds.length > 0 && profile.modes.length > 0, 'Selected configuration must cite actual proof');
      require(row.evidence.some(value => value.path === profile.evidencePath && value.claim === 'selected-subset' && profile.fixtureIds.every(fixture => value.fixtureIds?.includes(fixture))), 'Option profile evidence mismatch');
    }
  }
  for (const [index, section] of result.sections.entries()) require(section.id === index + 1 && section.rows === ordinals.get(section.id), 'Section count/order mismatch');
  for (const [target, field] of [['python', 'pythonDefinitionMembership'], ['wasm', 'wasmDefinitionMembership']] as const) require(result.canonicalContracts.filter(value => value.kind === 'registry-block' && value.targets.some(entry => entry.target === target && entry.status === 'selected-config-eligible')).length === result.counts[field], 'Versioned target membership mismatch');
  return result;
}
