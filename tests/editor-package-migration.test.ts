import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { getBlockDefinition } from '../packages/block-library/src';
import { ENGINE_VERSION, type CalcModel } from '../packages/model/src';
import { acceptModelPackage, createModelPackage, inspectModelPackage, MODEL_PACKAGE_REGISTRY, PACKAGE_MIGRATION_BASELINES } from '../packages/model-package/src';
import { currentEntryForLegacyPackage } from '../packages/model-package/src/migrations';
import { runModel } from '../packages/runtime/src';
import { canonical, migrationFixture, signedLegacyPackage } from './m15-package-fixtures';

const legacyEngine = '0.17.0-m16';
const fail = async (text: string, code: string) => expect(inspectModelPackage(text)).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code })] });
function multiModel(): CalcModel {
  const source = migrationFixture();
  source.nodes.push({ id: 'other', blockType: 'source.constant', blockVersion: 1, label: 'Other', parameters: { value: 8 } });
  source.nodes.find(node => node.id === 'result')!.parameters = { inputCount: 2 };
  source.edges.push({ id: 'second', source: { nodeId: 'other', portId: 'out' }, target: { nodeId: 'result', portId: 'in2' } });
  return source;
}

describe('Editor engine exact signed package migration', () => {
  it('pins the original M16 registry hash instead of accepting a semver range', () => {
    expect(PACKAGE_MIGRATION_BASELINES.find(entry => entry.engineVersion === legacyEngine)).toEqual({ stage: 'M16', engineVersion: legacyEngine, entries: 337, registrySha256: '19aa84816ba8be1d3ea10536efb6f65caab0922f67b02ce8783f15b11e52165b' });
    expect(PACKAGE_MIGRATION_BASELINES.map(entry => entry.engineVersion)).not.toContain('0.17.2-m16');
  });
  it.each(['sink.display', 'sink.scope'])('loads an original %s with its untouched parameter payload and portable identity', async type => {
    const source = migrationFixture(); source.nodes[2]!.blockType = type;
    const bytes = canonical(source), signed = await signedLegacyPackage(source, legacyEngine, 'M16');
    const inspection = await inspectModelPackage(signed.text);
    expect(inspection.executable).toBe(true); expect(inspection.diagnostics).toEqual([]);
    expect(canonical(inspection.model)).toBe(bytes); expect(inspection.model.nodes[2]!.parameters).toEqual({});
    expect(inspection.model.modelId).toBe(source.modelId); expect(inspection.model.layout).toEqual(source.layout);
    expect(inspection.migration).toMatchObject({ fromEngineVersion: legacyEngine, toEngineVersion: ENGINE_VERSION, originalIntegrityVerified: true, normalizedModelChanged: false, optionCoercionPerformed: false, currentCompilationPassed: true, signatureAppliesTo: 'original-payload', originalBytesMustBeRetained: true, numericalParityWithOriginalEngineVerified: false });
    await expect(acceptModelPackage(signed.text, signed.fingerprint)).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'PACKAGE_MIGRATION_REVIEW_REQUIRED' })] });
    const accepted = await acceptModelPackage(signed.text, signed.fingerprint, { reviewedMigration: true });
    expect((await runModel(compileModel(accepted))).samples[0]!.values.result).toBe(6);
    const current = await createModelPackage(accepted), checked = await inspectModelPackage(current.text);
    expect(JSON.parse(current.text).engineVersion).toBe(ENGINE_VERSION);
    expect(checked.migration).toBeUndefined(); expect(canonical(checked.model)).toBe(bytes);
    expect(JSON.parse(signed.text).registry.find((entry: { blockId: string }) => entry.blockId === type).parameters).toEqual([]);
  });
  it.each([1, 2, 16])('rejects a newly signed legacy payload that smuggles inputCount=%s absent from its historical declaration', async count => {
    const source = migrationFixture(); source.nodes[2]!.parameters.inputCount = count;
    const signed = await signedLegacyPackage(source, legacyEngine, 'M16');
    await fail(signed.text, 'PACKAGE_MIGRATION_UNDECLARED_PARAMETER');
  });
  it('rejects a newly signed legacy envelope carrying the current registry addition', async () => {
    const signed = await signedLegacyPackage(migrationFixture(), legacyEngine, 'M16', { registry: MODEL_PACKAGE_REGISTRY });
    await fail(signed.text, 'PACKAGE_REGISTRY_MISMATCH');
  });
  it('keeps signature and model hash checks ahead of migration', async () => {
    const signed = await signedLegacyPackage(migrationFixture(), legacyEngine, 'M16'), tampered = JSON.parse(signed.text);
    tampered.model.name = 'Different'; await fail(JSON.stringify(tampered), 'PACKAGE_HASH_MISMATCH');
    const changed = JSON.parse(signed.text); changed.registry.find((entry: { blockId: string }) => entry.blockId === 'math.gain').parameters[0].kind = 'text';
    await fail(JSON.stringify(changed), 'INVALID_PACKAGE_SIGNATURE');
  });
  it.each(['blockVersion', 'inputs', 'parameters'])('rejects a signed historical %s contract alteration', async field => {
    const fixture = await signedLegacyPackage(migrationFixture(), legacyEngine, 'M16'), altered = structuredClone(fixture.registry);
    const sink = altered.find(entry => entry.blockId === 'sink.display')!;
    if (field === 'blockVersion') sink.blockVersion = 2;
    else if (field === 'inputs') sink.inputs.push('in2');
    else sink.parameters.push({ name: 'inputCount', kind: 'integer' });
    const signed = await signedLegacyPackage(migrationFixture(), legacyEngine, 'M16', { registry: altered });
    await fail(signed.text, 'PACKAGE_REGISTRY_MISMATCH');
  });
  it('inspects all subsystem definitions for undeclared historical parameters', async () => {
    const source = migrationFixture(); source.subsystems = [{ id: 'unused', version: 1, name: 'Unused', inputs: [], outputs: [], nodes: [{ id: 'view', blockType: 'sink.scope', blockVersion: 1, label: 'Scope', parameters: { inputCount: 2 } }], edges: [], layout: {} }];
    const signed = await signedLegacyPackage(source, legacyEngine, 'M16');
    await fail(signed.text, 'PACKAGE_MIGRATION_UNDECLARED_PARAMETER');
  });
  it('round-trips current multiple-input packages without converting them to a single input', async () => {
    const source = multiModel(), original = canonical(source), current = await createModelPackage(source), inspected = await inspectModelPackage(current.text);
    expect(inspected.migration).toBeUndefined(); expect(inspected.executable).toBe(true); expect(canonical(inspected.model)).toBe(original);
    expect((await runModel(compileModel(inspected.model))).samples[0]!.values.result).toEqual({ kind: 'bus', fields: [{ name: 'in', value: 6 }, { name: 'in2', value: 8 }] });
    const forgedLegacy = await signedLegacyPackage(source, legacyEngine, 'M16');
    await fail(forgedLegacy.text, 'PACKAGE_MIGRATION_UNDECLARED_PARAMETER');
  });
  it('projects only the two observer integer additions and retains every other current schema field', () => {
    for (const entry of MODEL_PACKAGE_REGISTRY) {
      const approved = getBlockDefinition(entry.blockId)?.parameters.inputCount;
      const projected = currentEntryForLegacyPackage(entry, approved);
      if (['sink.display', 'sink.scope'].includes(entry.blockId)) {
        expect(projected.parameters).toEqual([]); expect({ ...projected, parameters: entry.parameters }).toEqual(entry);
        expect(currentEntryForLegacyPackage({ ...entry, parameters: [{ name: 'inputCount', kind: 'text' }] }, approved).parameters).toEqual([{ name: 'inputCount', kind: 'text' }]);
        for (const schema of [undefined, { ...approved!, default: 2 }, { ...approved!, min: 0 }, { ...approved!, max: 32 }, { ...approved!, kind: 'number' }]) expect(currentEntryForLegacyPackage(entry, schema)).toBe(entry);
      } else expect(projected).toBe(entry);
    }
  });
});
