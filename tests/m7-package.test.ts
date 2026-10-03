import { M8_BLOCK_IDS } from '../packages/block-library/src/m8';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { ENGINE_VERSION, MODEL_LIMITS, ModelError, parseModel, type CalcModel, type SubsystemDefinition } from '../packages/model/src';
import { acceptModelPackage, createModelPackage, inspectModelPackage, MODEL_PACKAGE_FORMAT, MODEL_PACKAGE_LIMITS, MODEL_PACKAGE_REGISTRY, MODEL_PACKAGE_VERSION } from '../packages/model-package/src';
import { runModel } from '../packages/runtime/src';

const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}) => ({ id, blockType, blockVersion: 1 as const, label: id, parameters });
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId: 'in' } });
const model = (): CalcModel => ({
  schemaVersion: 1, modelId: 'package_test', name: '재사용 모델 — 한국어',
  nodes: [node('input', 'source.constant', { value: 2 }), node('gain', 'math.gain', { gain: 3 }), node('result', 'sink.display')],
  edges: [edge('input', 'gain'), edge('gain', 'result')],
  execution: { mode: 'static', startTime: 0, stopTime: 1, step: 0.1 }, layout: { gain: { x: 200, y: 40 } }, notes: '공개 텍스트 설명',
});
function canonical(value: unknown): string {
  const sort = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(sort)
    : entry !== null && typeof entry === 'object' ? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, sort((entry as Record<string, unknown>)[key])])) : entry;
  return JSON.stringify(sort(value));
}
const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const hash = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** Independent sender can validly sign a declarative but semantically broken model. */
async function signedByIndependentSender(input: CalcModel): Promise<{ text: string; fingerprint: string }> {
  const modelHash = await hash(new TextEncoder().encode(canonical(input)));
  const payload = { format: MODEL_PACKAGE_FORMAT, packageVersion: MODEL_PACKAGE_VERSION, engineVersion: ENGINE_VERSION, modelSchemaVersion: 1,
    registry: MODEL_PACKAGE_REGISTRY, permissions: ['local-model'], modelHash, model: input };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`CALCWEAVE-MODEL-PACKAGE\u0000${canonical(payload)}`)));
  return { text: canonical({ ...payload, signature: { algorithm: 'ECDSA-P256-SHA256', publicKeyEncoding: 'raw-base64url', publicKey: base64(publicKey), value: base64(signature) } }), fingerprint: await hash(publicKey) };
}
async function expectCode(action: () => Promise<unknown>, code: string): Promise<ModelError> {
  try { await action(); } catch (error) {
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).diagnostics.some((diagnostic) => diagnostic.code === code)).toBe(true);
    return error as ModelError;
  }
  throw new Error(`Expected ${code}`);
}
afterEach(() => vi.restoreAllMocks());

describe('M7 declarative package integrity and independently supplied trust', () => {
  it('round-trips Unicode, verifies public-key fingerprint independently, and preserves numeric execution', async () => {
    const source = model(); const snapshot = JSON.stringify(source);
    const exported = await createModelPackage(source); const inspected = await inspectModelPackage(exported.text);
    const envelope = JSON.parse(exported.text);
    const raw = Uint8Array.from(atob(envelope.signature.publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='), (character) => character.charCodeAt(0));
    expect(await hash(raw)).toBe(exported.fingerprint);
    expect(inspected).toMatchObject({ model: parseModel(source), fingerprint: exported.fingerprint, packageVersion: '1', executable: true, diagnostics: [] });
    const accepted = await acceptModelPackage(exported.text, exported.fingerprint);
    expect((await runModel(compileModel(accepted))).samples[0]!.values.result).toBe(6);
    accepted.nodes[0]!.parameters.value = 99;
    expect((await inspectModelPackage(exported.text)).model.nodes[0]!.parameters.value).toBe(2);
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('uses a fresh nonextractable private key on every export, with only public raw-key export', async () => {
    const generate = vi.spyOn(crypto.subtle, 'generateKey'); const keyExport = vi.spyOn(crypto.subtle, 'exportKey');
    const first = await createModelPackage(model()), second = await createModelPackage(model());
    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect(generate).toHaveBeenCalledTimes(2);
    for (const call of generate.mock.calls) expect(call).toEqual([{ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']]);
    for (const call of keyExport.mock.calls) { expect(call[0]).toBe('raw'); expect(call[1].type).toBe('public'); }
    expect(JSON.parse(first.text).signature).not.toHaveProperty('privateKey');
    expect(JSON.parse(first.text)).not.toHaveProperty('signer');
  });

  it('verifies integrity without automatically trusting the embedded key', async () => {
    const first = await createModelPackage(model()), other = await createModelPackage(model());
    expect((await inspectModelPackage(first.text)).executable).toBe(true);
    await expectCode(() => acceptModelPackage(first.text, ''), 'PACKAGE_TRUST_REQUIRED');
    await expectCode(() => acceptModelPackage(first.text, first.fingerprint.toUpperCase()), 'PACKAGE_TRUST_REQUIRED');
    await expectCode(() => acceptModelPackage(first.text, other.fingerprint), 'PACKAGE_TRUST_MISMATCH');
    const independentlySigned = await signedByIndependentSender(model());
    await expectCode(() => acceptModelPackage(independentlySigned.text, first.fingerprint), 'PACKAGE_TRUST_MISMATCH');
  });

  it('rejects a modified model hash and a rehashed model with the original signature', async () => {
    const exported = await createModelPackage(model()); const envelope = JSON.parse(exported.text);
    envelope.model.nodes[0].parameters.value = 100;
    await expectCode(() => inspectModelPackage(JSON.stringify(envelope)), 'PACKAGE_HASH_MISMATCH');
    envelope.modelHash = await hash(new TextEncoder().encode(canonical(envelope.model)));
    await expectCode(() => acceptModelPackage(JSON.stringify(envelope), exported.fingerprint), 'INVALID_PACKAGE_SIGNATURE');
  });

  it('binds presentation and dataset/model metadata as well as the numerical graph', async () => {
    const exported = await createModelPackage(model()); const envelope = JSON.parse(exported.text);
    envelope.model.name = '교체된 이름'; envelope.model.layout.gain.x = 999;
    await expectCode(() => inspectModelPackage(JSON.stringify(envelope)), 'PACKAGE_HASH_MISMATCH');
  });

  it('rejects changed signature bytes, invalid curve points, and noncanonical base64url', async () => {
    const exported = await createModelPackage(model()); const envelope = JSON.parse(exported.text);
    envelope.signature.value = (envelope.signature.value[0] === 'A' ? 'B' : 'A') + envelope.signature.value.slice(1);
    await expectCode(() => inspectModelPackage(JSON.stringify(envelope)), 'INVALID_PACKAGE_SIGNATURE');
    const invalidPoint = JSON.parse(exported.text); const point = new Uint8Array(65); point[0] = 4;
    invalidPoint.signature.publicKey = base64(point);
    await expectCode(() => inspectModelPackage(JSON.stringify(invalidPoint)), 'INVALID_PACKAGE_SIGNATURE');
    const noncanonical = JSON.parse(exported.text); noncanonical.signature.publicKey = noncanonical.signature.publicKey.slice(0, -1) + 'B';
    await expectCode(() => inspectModelPackage(JSON.stringify(noncanonical)), 'INVALID_PACKAGE_SIGNATURE');
  });

  it.each(['packageVersion', 'engineVersion', 'modelSchemaVersion'] as const)('rejects unsupported %s', async (field) => {
    const exported = await createModelPackage(model()); const envelope = JSON.parse(exported.text);
    envelope[field] = field === 'modelSchemaVersion' ? 2 : 'future';
    await expectCode(() => inspectModelPackage(JSON.stringify(envelope)), 'PACKAGE_VERSION_UNSUPPORTED');
  });

  it('requires the exact immutable executable registry including parameter kinds and ports', async () => {
    expect(MODEL_PACKAGE_REGISTRY).toHaveLength(144 + M8_BLOCK_IDS.length); expect(Object.isFrozen(MODEL_PACKAGE_REGISTRY[0]!.inputs)).toBe(true);
    const exported = await createModelPackage(model());
    for (const change of ['remove', 'ports', 'parameter', 'version', 'custom']) {
      const envelope = JSON.parse(exported.text);
      if (change === 'remove') envelope.registry.pop();
      if (change === 'ports') envelope.registry[0].inputs.push('secret');
      if (change === 'parameter') envelope.registry.find((item: { blockId: string }) => item.blockId === 'math.gain').parameters[0].kind = 'text';
      if (change === 'version') envelope.registry[0].blockVersion = 2;
      if (change === 'custom') envelope.registry.push({ blockId: 'custom.kernel', blockVersion: 1, inputs: [], outputs: ['out'], parameters: [] });
      await expectCode(() => inspectModelPackage(JSON.stringify(envelope)), 'PACKAGE_REGISTRY_MISMATCH');
    }
  });

  it.each([[], ['network'], ['local-model', 'filesystem'], ['local-model', 'local-model']].map((permissions) => ({ permissions })))('denies permissions $permissions', async ({ permissions }) => {
    const exported = await createModelPackage(model()); const envelope = JSON.parse(exported.text); envelope.permissions = permissions;
    await expectCode(() => inspectModelPackage(JSON.stringify(envelope)), 'PACKAGE_PERMISSION_DENIED');
  });

  it.each(['code', 'sources', 'dependencies', 'url', 'privateKey'])('strictly rejects additional %s fields', async (field) => {
    const exported = await createModelPackage(model()); const envelope = JSON.parse(exported.text); envelope[field] = 'unapproved';
    await expectCode(() => inspectModelPackage(JSON.stringify(envelope)), 'INVALID_PACKAGE_SCHEMA');
  });

  it('rejects unsafe field names, model unknown fields, and extra nested signature metadata', async () => {
    const exported = await createModelPackage(model());
    await expectCode(() => inspectModelPackage(exported.text.replace('{', '{"__proto__":{},')), 'PACKAGE_UNSAFE_FIELD');
    const envelope = JSON.parse(exported.text); envelope.model.script = 'unused';
    await expectCode(() => inspectModelPackage(JSON.stringify(envelope)), 'INVALID_MODEL');
    const nested = JSON.parse(exported.text); nested.signature.source = 'unknown';
    await expectCode(() => inspectModelPackage(JSON.stringify(nested)), 'INVALID_PACKAGE_SCHEMA');
  });

  it('reports validly signed semantic failures for repair but refuses execution acceptance', async () => {
    const source = model(); source.edges.pop(); const snapshot = JSON.stringify(source);
    const exported = await signedByIndependentSender(source); const inspected = await inspectModelPackage(exported.text);
    expect(inspected.executable).toBe(false); expect(inspected.model).toEqual(source);
    expect(inspected.diagnostics).toContainEqual(expect.objectContaining({ code: 'REQUIRED_INPUT_MISSING', nodeId: 'result' }));
    await expectCode(() => acceptModelPackage(exported.text, exported.fingerprint), 'REQUIRED_INPUT_MISSING');
    await expectCode(() => createModelPackage(source), 'REQUIRED_INPUT_MISSING');
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('refuses an unapproved block even when signed by an independently confirmed sender', async () => {
    const source = model(); source.nodes[1]!.blockType = 'custom.kernel';
    const exported = await signedByIndependentSender(source); const inspected = await inspectModelPackage(exported.text);
    expect(inspected.executable).toBe(false); expect(inspected.diagnostics.some((entry) => entry.code === 'UNKNOWN_BLOCK')).toBe(true);
    await expectCode(() => acceptModelPackage(exported.text, exported.fingerprint), 'UNKNOWN_BLOCK');
  });

  it('shares approved declarative hierarchy without flattening away its reusable definition', async () => {
    const definition: SubsystemDefinition = { id: 'gainDef', version: 1, name: '배율 템플릿',
      nodes: [node('marker', 'io.input'), node('gain', 'math.gain', { gain: 3 }), node('output', 'io.output')],
      edges: [edge('marker', 'gain'), edge('gain', 'output')], layout: {}, inputs: [{ id: 'in', nodeId: 'marker' }], outputs: [{ id: 'out', nodeId: 'output' }] };
    const source = model(); source.nodes[1] = node('gain', 'hierarchy.subsystem', { definitionId: 'gainDef', version: 1 }); source.subsystems = [definition];
    const exported = await createModelPackage(source); const accepted = await acceptModelPackage(exported.text, exported.fingerprint);
    expect(accepted.subsystems).toEqual([definition]);
    expect((await runModel(compileModel(accepted))).samples[0]!.values.result).toBe(6);
  });

  it('bounds UTF-8 size, pathological depth, and value counts before any cryptographic work', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest'); const verify = vi.spyOn(crypto.subtle, 'verify');
    await expectCode(() => inspectModelPackage(' '.repeat(MODEL_PACKAGE_LIMITS.maxBytes + 1)), 'PACKAGE_TOO_LARGE');
    await expectCode(() => inspectModelPackage('가'.repeat(Math.ceil(MODEL_PACKAGE_LIMITS.maxBytes / 3) + 1)), 'PACKAGE_TOO_LARGE');
    await expectCode(() => inspectModelPackage('['.repeat(100) + '0' + ']'.repeat(100)), 'PACKAGE_DEPTH_EXCEEDED');
    await expectCode(() => inspectModelPackage(JSON.stringify(Array(MODEL_PACKAGE_LIMITS.maxValues).fill(0))), 'PACKAGE_RESOURCE_LIMIT');
    expect(digest).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled();
  });

  it('fails closed with controlled diagnostics when WebCrypto hashing fails', async () => {
    const exported = await createModelPackage(model());
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('untrusted implementation detail'));
    const error = await expectCode(() => inspectModelPackage(exported.text), 'PACKAGE_CRYPTO_FAILED');
    expect(error.message).not.toContain('untrusted implementation detail');
  });

  it('retains existing total-model resource limits at signing and receiving boundaries', async () => {
    const source = model(); source.nodes = Array.from({ length: MODEL_LIMITS.maxNodes + 1 }, (_, index) => node(`node${index}`, 'annotation.note'));
    await expectCode(() => createModelPackage(source), 'INVALID_MODEL');
    const received = await signedByIndependentSender(source);
    await expectCode(() => inspectModelPackage(received.text), 'INVALID_MODEL');
  });

  it('performs no network, storage write, or model mutation when package inspection fails', async () => {
    const source = model(); const snapshot = JSON.stringify(source); const exported = await createModelPackage(source);
    const fetch = vi.spyOn(globalThis, 'fetch');
    const envelope = JSON.parse(exported.text); envelope.permissions = ['network'];
    await expectCode(() => acceptModelPackage(JSON.stringify(envelope), exported.fingerprint), 'PACKAGE_PERMISSION_DENIED');
    expect(fetch).not.toHaveBeenCalled(); expect(JSON.stringify(source)).toBe(snapshot);
  });
});
