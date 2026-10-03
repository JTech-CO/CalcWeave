import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { ENGINE_VERSION, parseModelJson, serializeModel, sha256 } from '../packages/model/src';
import { acceptModelPackage, createModelPackage, inspectModelPackage, PACKAGE_MIGRATION_BASELINES } from '../packages/model-package/src';
import { runModel } from '../packages/runtime/src';
import { canonical, migrationFixture, signedLegacyPackage } from './m15-package-fixtures';

describe('M15 exact legacy registry migrations', () => {
  it.each(PACKAGE_MIGRATION_BASELINES)('$engineVersion verifies original signature then revalidates without option changes', async baseline => {
    const model = migrationFixture(), original = canonical(model);
    const signed = await signedLegacyPackage(model, baseline.engineVersion, baseline.stage);
    const inspected = await inspectModelPackage(signed.text);
    expect(inspected.migration).toMatchObject({ fromEngineVersion: baseline.engineVersion, toEngineVersion: ENGINE_VERSION, originalRegistrySha256: baseline.registrySha256, schemaVersion: 1, signatureAppliesTo: 'original-payload', originalIntegrityVerified: true, originalBytesMustBeRetained: true, normalizedModelChanged: false, currentCompilationPassed: true, numericalParityWithOriginalEngineVerified: false, optionCoercionPerformed: false });
    expect(inspected.migration!.currentSemanticHash).toBe(sha256(compileModel(model).semanticKey));
    expect(canonical(inspected.model)).toBe(original);
    await expect(acceptModelPackage(signed.text, signed.fingerprint)).rejects.toMatchObject({ diagnostics: [{ code: 'PACKAGE_MIGRATION_REVIEW_REQUIRED', message: expect.any(String) }] });
    const accepted = await acceptModelPackage(signed.text, signed.fingerprint, { reviewedMigration: true });
    expect((await runModel(compileModel(accepted))).samples.map(sample => sample.values.result)).toEqual([6]);
    const current = await createModelPackage(accepted), currentInspection = await inspectModelPackage(current.text);
    expect(currentInspection.migration).toBeUndefined();
    expect(canonical(currentInspection.model)).toBe(original);
    expect(JSON.parse(signed.text).engineVersion).toBe(baseline.engineVersion);
  });

  it('requires independently supplied trust even after reviewing migration', async () => {
    const signed = await signedLegacyPackage(migrationFixture(), '0.14.0-m13', 'M13');
    await expect(acceptModelPackage(signed.text, '0'.repeat(64), { reviewedMigration: true })).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'PACKAGE_TRUST_MISMATCH' })] });
  });
  it('rejects original model tamper and rehashed original with stale signature before migration', async () => {
    const signed = await signedLegacyPackage(migrationFixture(), '0.14.0-m13', 'M13'), envelope = JSON.parse(signed.text);
    envelope.model.nodes[0].parameters.value = 4;
    await expect(inspectModelPackage(JSON.stringify(envelope))).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'PACKAGE_HASH_MISMATCH' })] });
    envelope.modelHash = sha256(canonical(envelope.model));
    await expect(inspectModelPackage(JSON.stringify(envelope))).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'INVALID_PACKAGE_SIGNATURE' })] });
  });
  it('does not accept a newly signed foreign registry under a known legacy version', async () => {
    const first = await signedLegacyPackage(migrationFixture(), '0.14.0-m13', 'M13');
    first.registry[0]!.blockVersion = 2;
    const changed = await signedLegacyPackage(migrationFixture(), '0.14.0-m13', 'M13', { registry: first.registry });
    await expect(inspectModelPackage(changed.text)).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'PACKAGE_REGISTRY_MISMATCH' })] });
  });
  it('rejects unknown engine and elevated permissions without loading any new implementation', async () => {
    for (const override of [{ engineVersion: '0.14.1-untrusted' }, { permissions: ['local-model', 'network'] }]) {
      const signed = await signedLegacyPackage(migrationFixture(), '0.14.0-m13', 'M13', override);
      await expect(inspectModelPackage(signed.text)).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'engineVersion' in override ? 'PACKAGE_VERSION_UNSUPPORTED' : 'PACKAGE_PERMISSION_DENIED' })] });
    }
  });
  it('rejects a model block absent from the signed historical registry', async () => {
    const model = migrationFixture(); model.nodes[1]!.blockType = 'adapter.wasm-affine'; model.nodes[1]!.parameters = { gain: 3, bias: 0 };
    const signed = await signedLegacyPackage(model, '0.14.0-m13', 'M13');
    await expect(inspectModelPackage(signed.text)).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'PACKAGE_MIGRATION_UNDECLARED_BLOCK' })] });
  });
  it('reports signed semantic failures without accepting or claiming parity', async () => {
    const model = migrationFixture(); model.edges.pop();
    const signed = await signedLegacyPackage(model, '0.14.0-m13', 'M13'), inspection = await inspectModelPackage(signed.text);
    expect(inspection.executable).toBe(false); expect(inspection.migration!.currentCompilationPassed).toBe(false); expect(inspection.migration!.currentSemanticHash).toBe('');
    await expect(acceptModelPackage(signed.text, signed.fingerprint, { reviewedMigration: true })).rejects.toMatchObject({ diagnostics: [expect.objectContaining({ code: 'REQUIRED_INPUT_MISSING' })] });
  });
  it('native schema1 JSON retains parameters, units, layout and current semantic hash without foreign conversion', async () => {
    const model = migrationFixture(), restored = parseModelJson(serializeModel(model));
    expect(restored).toEqual(model); expect(compileModel(restored).semanticKey).toBe(compileModel(model).semanticKey);
    expect((await runModel(compileModel(restored))).samples.map(sample => sample.values.result)).toEqual([6]);
  });
});
