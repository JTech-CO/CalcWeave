import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { blockRegistry, getBlockDefinition, getBlockPorts } from '../packages/block-library/src';
import { ENGINE_VERSION } from '../packages/model/src';
import { CURRENT_SUPPORT_EXTENSIONS, HISTORICAL_SUPPORT_ENGINE_VERSION, SUPPORT_MATRIX, getCurrentObserverExtension, getCurrentObserverExtensions, serializeSupportMatrix } from '../packages/support-matrix/src';
import { createSupportMatrix, decodeHistoricalObserverSourceSnapshot, digest, HISTORICAL_OBSERVER_SOURCE_SNAPSHOT_PATH, HISTORICAL_SUPPORT_CODE_PATHS, HISTORICAL_SUPPORT_REVISION, HISTORICAL_SUPPORT_SHA256, loadHistoricalSupportMatrix, registryWithoutApprovedObserverInputs, supportMarkdown, verifyHistoricalSupportArtifact, verifyHistoricalSupportArtifacts } from '../scripts/m16-support-source';

describe('current observer extensions and frozen historical source support', () => {
  it('lists exactly two bounded observers with explicit per-target input limits', () => {
    expect(getCurrentObserverExtensions().map(extension => extension.blockId)).toEqual(['sink.display', 'sink.scope']);
    for (const extension of getCurrentObserverExtensions()) {
      expect(extension).toEqual({ blockId: extension.blockId, introducedEngineVersion: '0.17.1-m16', parameter: 'inputCount', defaultInputs: 1, minimumInputs: 1, maximumInputs: 16, firstPort: 'in', additionalPortPattern: 'in2..in16', targetInputLimits: { runtime: 16, typescript: 16, python: 1, wasm: 1 }, requiresActualModelValidation: true, fullSourceEquivalence: false });
      expect(getCurrentObserverExtension(extension.blockId)).toBe(extension);
    }
  });

  it('keeps the current engine marker and historical audit engine distinct', () => {
    expect(CURRENT_SUPPORT_EXTENSIONS.engineVersion).toBe(ENGINE_VERSION);
    expect(CURRENT_SUPPORT_EXTENSIONS.historicalSupportEngineVersion).toBe('0.17.0-m16');
    expect(SUPPORT_MATRIX.engineVersion).toBe(HISTORICAL_SUPPORT_ENGINE_VERSION);
    expect(CURRENT_SUPPORT_EXTENSIONS.engineVersion).not.toBe(SUPPORT_MATRIX.engineVersion);
    for (const contract of SUPPORT_MATRIX.canonicalContracts.filter(item => ['sink.display', 'sink.scope'].includes(item.id))) expect(contract.parameters.inputCount).toBeUndefined();
  });

  it('returns immutable nested metadata without allowing callers to alter support claims', () => {
    const extension = getCurrentObserverExtensions()[0]!;
    expect(Object.isFrozen(CURRENT_SUPPORT_EXTENSIONS)).toBe(true); expect(Object.isFrozen(getCurrentObserverExtensions())).toBe(true); expect(Object.isFrozen(extension)).toBe(true); expect(Object.isFrozen(extension.targetInputLimits)).toBe(true);
    expect(() => { (extension as unknown as { maximumInputs: number }).maximumInputs = 100; }).toThrow();
    expect(() => { (extension.targetInputLimits as unknown as { python: number }).python = 16; }).toThrow();
  });

  it('bounds exact observer lookup without treating arbitrary IDs as support', () => {
    for (const id of ['unknown', 'sink.scope.extra', 'sink.display ', 'x'.repeat(81), '__proto__', null, 42]) expect(getCurrentObserverExtension(id as string)).toBeUndefined();
  });

  it('matches current registry declaration and preserved first-port/dynamic additional ports', () => {
    for (const extension of getCurrentObserverExtensions()) {
      expect(getBlockDefinition(extension.blockId)!.parameters.inputCount).toEqual({ kind: 'integer', label: '입력 개수', default: 1, min: 1, max: 16 });
      expect(getBlockPorts({ blockType: extension.blockId, parameters: {} })).toEqual({ inputs: ['in'], outputs: [] });
      expect(getBlockPorts({ blockType: extension.blockId, parameters: { inputCount: 16 } })).toEqual({ inputs: ['in', ...Array.from({ length: 15 }, (_, index) => `in${index + 2}`)], outputs: [] });
    }
  });

  it('allows only the two exact inputCount declarations above the immutable registry baseline', () => {
    const baselineBytes = readFileSync('docs/baselines/m15-registry.json');
    expect(digest(baselineBytes)).toBe(SUPPORT_MATRIX.artifacts['docs/baselines/m15-registry.json']);
    const baseline = JSON.parse(baselineBytes.toString('utf8'));
    expect(registryWithoutApprovedObserverInputs(blockRegistry)).toEqual(baseline);
    const changed = structuredClone(blockRegistry), observer = changed.find(item => item.id === 'sink.display')!;
    (observer.parameters as Record<string, unknown>).inputCount = { kind: 'integer', label: '입력 개수', default: 1, min: 1, max: 17 };
    expect(() => registryWithoutApprovedObserverInputs(changed)).toThrow(/unapproved/);
    const unrelated = blockRegistry.map(item => item.id === 'math.gain' ? { ...item, description: item.description + 'changed' } : item);
    expect(registryWithoutApprovedObserverInputs(unrelated)).not.toEqual(baseline);
    expect(() => registryWithoutApprovedObserverInputs(blockRegistry.filter(item => item.id !== 'sink.scope'))).toThrow(/Exactly two/);
  });

  it('retains every historical support byte, including source engine and original declarations', async () => {
    const matrix = await loadHistoricalSupportMatrix();
    expect(matrix).toEqual(SUPPORT_MATRIX);
    expect(digest(serializeSupportMatrix())).toBe(HISTORICAL_SUPPORT_SHA256);
    expect(HISTORICAL_SUPPORT_REVISION).toBe('736603c7988699e2001cb102d7f1ca64fa1c4a55');
    expect(HISTORICAL_SUPPORT_CODE_PATHS).toHaveLength(15); expect(Object.isFrozen(HISTORICAL_SUPPORT_CODE_PATHS)).toBe(true);
    await verifyHistoricalSupportArtifacts(matrix);
    await expect(verifyHistoricalSupportArtifact('packages/block-library/src/index.ts', '0'.repeat(64))).rejects.toThrow(/digest mismatch/);
    await expect(verifyHistoricalSupportArtifact('docs/baselines/m15-registry.json', '0'.repeat(64))).rejects.toThrow(/digest mismatch/);
  });

  it('rebuilds historical JSON and Markdown byte-identically and deterministically', async () => {
    const matrix = await createSupportMatrix(), second = await createSupportMatrix();
    const json = JSON.stringify(matrix, null, 2) + '\n';
    expect(digest(json)).toBe(HISTORICAL_SUPPORT_SHA256);
    expect(json).toBe(readFileSync('docs/support-matrix.json', 'utf8'));
    expect(JSON.stringify(second)).toBe(JSON.stringify(matrix));
    expect(supportMarkdown(matrix)).toBe(readFileSync('docs/support-matrix.md', 'utf8'));
  });

  it('decodes only the two portable source snapshots against independent frozen SHA', () => {
    const text = readFileSync(HISTORICAL_OBSERVER_SOURCE_SNAPSHOT_PATH, 'utf8');
    const sources = decodeHistoricalObserverSourceSnapshot(text, SUPPORT_MATRIX.artifacts);
    expect([...sources.keys()].sort()).toEqual(['packages/block-library/src/index.ts', 'packages/model/src/types.ts']);
    for (const [path, bytes] of sources) expect(digest(bytes)).toBe(SUPPORT_MATRIX.artifacts[path]);
  });

  it('rejects forged portable source bytes even when their embedded digest is recomputed', () => {
    const snapshot = JSON.parse(readFileSync(HISTORICAL_OBSERVER_SOURCE_SNAPSHOT_PATH, 'utf8'));
    const file = snapshot.files[0], forged = Buffer.concat([Buffer.from(file.data, 'base64'), Buffer.from('\n// changed\n')]);
    file.data = forged.toString('base64'); file.byteLength = forged.length; file.sha256 = digest(forged);
    expect(() => decodeHistoricalObserverSourceSnapshot(JSON.stringify(snapshot), SUPPORT_MATRIX.artifacts)).toThrow(/frozen manifest/);
  });

  it('rejects snapshot revision drift, unapproved paths, duplicate sources and extra fields', () => {
    const original = JSON.parse(readFileSync(HISTORICAL_OBSERVER_SOURCE_SNAPSHOT_PATH, 'utf8'));
    const invalid = [
      { ...original, revision: '0'.repeat(40) },
      { ...original, files: [original.files[0], original.files[0]] },
      { ...original, files: [{ ...original.files[0], path: 'packages/model/src/schema.ts' }, original.files[1]] },
      { ...original, extra: true },
    ];
    for (const snapshot of invalid) expect(() => decodeHistoricalObserverSourceSnapshot(JSON.stringify(snapshot), SUPPORT_MATRIX.artifacts)).toThrow();
  });

  it('bounds snapshot text, decoded size and canonical base64 before accepting source bytes', () => {
    const original = JSON.parse(readFileSync(HISTORICAL_OBSERVER_SOURCE_SNAPSHOT_PATH, 'utf8'));
    expect(() => decodeHistoricalObserverSourceSnapshot(' '.repeat(128 * 1024 + 1), SUPPORT_MATRIX.artifacts)).toThrow(/byte limit/);
    for (const changes of [{ byteLength: 65_537 }, { byteLength: -1 }, { byteLength: original.files[0].byteLength + 1 }, { data: '!' }, { data: original.files[0].data + '=' }]) {
      const snapshot = { ...original, files: [{ ...original.files[0], ...changes }, original.files[1]] };
      expect(() => decodeHistoricalObserverSourceSnapshot(JSON.stringify(snapshot), SUPPORT_MATRIX.artifacts)).toThrow();
    }
  });

  it('rebuilds portable historical support with Git unavailable on PATH', async () => {
    vi.stubEnv('PATH', '');
    try {
      const matrix = await createSupportMatrix();
      expect(digest(JSON.stringify(matrix, null, 2) + '\n')).toBe(HISTORICAL_SUPPORT_SHA256);
    } finally { vi.unstubAllEnvs(); }
  });
});
