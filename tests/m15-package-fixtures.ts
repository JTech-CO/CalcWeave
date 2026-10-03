import { readFile } from 'node:fs/promises';
import type { CalcModel } from '../packages/model/src';
import { MODEL_PACKAGE_FORMAT, MODEL_PACKAGE_VERSION } from '../packages/model-package/src';

export const canonical = (value: unknown): string => {
  const sort = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(sort) : entry !== null && typeof entry === 'object' ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, sort((entry as Record<string, unknown>)[key])])) : entry;
  return JSON.stringify(sort(value));
};
const hash = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
const base64url = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
export async function signedLegacyPackage(model: CalcModel, engineVersion: string, stage: string, override: Record<string, unknown> = {}) {
  const definitions = JSON.parse(await readFile(`docs/baselines/${stage.toLowerCase()}-registry.json`, 'utf8')) as { id: string; version: number; inputs: string[]; outputs: string[]; parameters: Record<string, { kind: string }> }[];
  const registry = definitions.map(definition => ({ blockId: definition.id, blockVersion: definition.version, inputs: definition.inputs, outputs: definition.outputs, parameters: Object.entries(definition.parameters).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, parameter]) => ({ name, kind: parameter.kind })) })).sort((a, b) => a.blockId < b.blockId ? -1 : a.blockId > b.blockId ? 1 : 0);
  const payload = { format: MODEL_PACKAGE_FORMAT, packageVersion: MODEL_PACKAGE_VERSION, modelSchemaVersion: 1, engineVersion, registry, permissions: ['local-model'], modelHash: await hash(new TextEncoder().encode(canonical(model))), model, ...override };
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`CALCWEAVE-MODEL-PACKAGE\u0000${canonical(payload)}`)));
  return { text: canonical({ ...payload, signature: { algorithm: 'ECDSA-P256-SHA256', publicKeyEncoding: 'raw-base64url', publicKey: base64url(publicKey), value: base64url(signature) } }), fingerprint: await hash(publicKey), registry };
}
export function migrationFixture(): CalcModel {
  return { schemaVersion: 1, modelId: 'm15_migration', name: '이전 모델 변환 검증', nodes: [{ id: 'input', blockType: 'source.constant', blockVersion: 1, label: 'Input', parameters: { value: 2 } }, { id: 'gain', blockType: 'math.gain', blockVersion: 1, label: 'Gain', parameters: { gain: 3 } }, { id: 'result', blockType: 'sink.display', blockVersion: 1, label: 'Result', parameters: {} }], edges: [{ id: 'a', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'gain', portId: 'in' } }, { id: 'b', source: { nodeId: 'gain', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }], layout: { input: { x: 0, y: 0 }, gain: { x: 200, y: 0 }, result: { x: 400, y: 0 } }, execution: { mode: 'static', startTime: 0, stopTime: 1, step: 0.1 }, notes: '원본 설명과 위치를 보존합니다.' };
}
