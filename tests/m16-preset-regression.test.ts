import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../packages/model/src';
import { HISTORICAL_SUPPORT_ENGINE_VERSION } from '../packages/support-matrix/src/current-extensions';
import { PRESET_PROOF_PATH, verifyM16Presets, verifyM16PresetRegression, type M16PresetProof } from '../scripts/m16-presets';
import { digest, HISTORICAL_SUPPORT_SHA256, SUPPORT_PATH } from '../scripts/m16-support-source';

const historicalBytes = readFileSync(PRESET_PROOF_PATH, 'utf8');
const matrixBytes = readFileSync(SUPPORT_PATH, 'utf8');
const pinnedSha256 = JSON.parse(matrixBytes).artifacts[PRESET_PROOF_PATH] as string;
const original = JSON.parse(historicalBytes) as M16PresetProof;
function freshProof(): M16PresetProof {
  const proof = structuredClone(original); proof.engineVersion = ENGINE_VERSION;
  proof.fixtures.forEach((fixture, index) => { fixture.generatedSourceSha256 = digest(`fresh-preset-source-${index}`); });
  return proof;
}

describe('M16 current preset execution against immutable historical proof', () => {
  it('executes all four current native and standalone programs with literal oracles while preserving frozen bytes', async () => {
    expect(original.engineVersion).toBe(HISTORICAL_SUPPORT_ENGINE_VERSION);
    const proof = await verifyM16Presets(false);
    expect(proof.engineVersion).toBe(ENGINE_VERSION);
    expect(proof.actualStandalonePrograms).toBe(4);
    expect(proof.fixtures.map(fixture => fixture.actual)).toEqual([9, 5, Math.PI, 0]);
    expect(proof.fixtures.every(fixture => fixture.actualStandaloneTypeScript && fixture.nativeLiteralOracle && fixture.manifestParity && fixture.fullSamplesFinalStateMemoryParity && fixture.jsonRoundtrip && fixture.insertionOrderIndependent)).toBe(true);
    expect(readFileSync(PRESET_PROOF_PATH, 'utf8')).toBe(historicalBytes);
    expect(digest(readFileSync(SUPPORT_PATH, 'utf8'))).toBe(HISTORICAL_SUPPORT_SHA256);
  });
  it('accepts independently recorded current source hashes and version with exact semantic contract', () => {
    expect(() => verifyM16PresetRegression(freshProof(), historicalBytes, pinnedSha256)).not.toThrow();
  });
  it.each(['sourceId', 'canonical', 'parameters', 'modelHash', 'expected', 'actual', 'nativeLiteralOracle', 'manifestParity', 'actualStandaloneTypeScript', 'fullSamplesFinalStateMemoryParity', 'jsonRoundtrip', 'insertionOrderIndependent'])('rejects changed fixture field %s', field => {
    const proof = freshProof(); Object.assign(proof.fixtures[0]!, { [field]: 'changed' });
    expect(() => verifyM16PresetRegression(proof, historicalBytes, pinnedSha256)).toThrow();
  });
  it('rejects modified historical bytes and missing execution fixture', () => {
    expect(() => verifyM16PresetRegression(freshProof(), historicalBytes + ' ', pinnedSha256)).toThrow('Frozen M16 preset proof bytes changed');
    const truncated = freshProof(); truncated.fixtures.pop();
    expect(() => verifyM16PresetRegression(truncated, historicalBytes, pinnedSha256)).toThrow('semantic contract');
  });
  it('rejects malformed current fingerprints and wrong current engine identity', () => {
    const source = freshProof(); source.fixtures[0]!.generatedSourceSha256 = 'not-a-sha';
    expect(() => verifyM16PresetRegression(source, historicalBytes, pinnedSha256)).toThrow('fingerprint');
    const version = freshProof(); version.engineVersion = '0.0.0-m16';
    expect(() => verifyM16PresetRegression(version, historicalBytes, pinnedSha256)).toThrow('current engine');
  });
  it('refuses to overwrite the historical proof using a later engine', async () => {
    if (String(ENGINE_VERSION) === HISTORICAL_SUPPORT_ENGINE_VERSION) return;
    await expect(verifyM16Presets(true)).rejects.toThrow('Only the original M16 engine');
    expect(readFileSync(PRESET_PROOF_PATH, 'utf8')).toBe(historicalBytes);
  });
});
