import { z } from 'zod';
import { blockRegistry } from '../../block-library/src';
import { compileModel } from '../../compiler/src';
import { ENGINE_VERSION, MODEL_LIMITS, ModelError, parseModel, type CalcModel, type Diagnostic } from '../../model/src';

/** A declarative model container. It cannot extend the executable block registry. */
export const MODEL_PACKAGE_FORMAT = 'calcweave-model-package' as const;
export const MODEL_PACKAGE_VERSION = '1' as const;
export const MODEL_PACKAGE_PERMISSIONS = Object.freeze(['local-model'] as const);
export const MODEL_PACKAGE_LIMITS = Object.freeze({
  maxBytes: 6 * 1024 * 1024,
  maxDepth: MODEL_LIMITS.maxDepth + 4,
  maxValues: MODEL_LIMITS.maxValues + 10_000,
  maxRegistryEntries: 512,
});

export interface ModelPackageInspection {
  model: CalcModel;
  fingerprint: string;
  packageVersion: string;
  modelHash: string;
  diagnostics: Diagnostic[];
  executable: boolean;
}

const identifier = z.string().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_-]*$/);
const registryEntrySchema = z.object({
  blockId: z.string().max(80).regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/),
  blockVersion: z.number().int().min(1).max(1_000_000),
  inputs: z.array(identifier).max(16),
  outputs: z.array(identifier).max(16),
  parameters: z.array(z.object({
    name: identifier,
    kind: z.enum(['number', 'integer', 'value', 'numeric-vector', 'enum', 'expression', 'text', 'typed-value', 'data-type', 'signal-value']),
  }).strict()).max(16),
}).strict();
const packageSchema = z.object({
  format: z.literal(MODEL_PACKAGE_FORMAT),
  packageVersion: z.string().min(1).max(16),
  engineVersion: z.string().min(1).max(64),
  modelSchemaVersion: z.number().int().min(1).max(1_000_000),
  registry: z.array(registryEntrySchema).max(MODEL_PACKAGE_LIMITS.maxRegistryEntries),
  permissions: z.array(z.string().min(1).max(32)).max(8),
  modelHash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.unknown(),
  signature: z.object({
    algorithm: z.literal('ECDSA-P256-SHA256'),
    publicKeyEncoding: z.literal('raw-base64url'),
    publicKey: z.string().length(87).regex(/^[A-Za-z0-9_-]+$/),
    value: z.string().length(86).regex(/^[A-Za-z0-9_-]+$/),
  }).strict(),
}).strict();
type PackageEnvelope = z.infer<typeof packageSchema>;

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/** Exact built-in port/parameter contracts, signed in every package. No imported contracts are installed. */
export const MODEL_PACKAGE_REGISTRY = freezeDeep(blockRegistry.map((definition) => ({
  blockId: definition.id,
  blockVersion: definition.version,
  inputs: [...definition.inputs],
  outputs: [...definition.outputs],
  parameters: Object.entries(definition.parameters).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, descriptor]) => ({ name, kind: descriptor.kind })),
})).sort((a, b) => a.blockId < b.blockId ? -1 : a.blockId > b.blockId ? 1 : 0));

const encoder = new TextEncoder();
const unsafeKeys = new Set([...Object.getOwnPropertyNames(Object.prototype), 'prototype']);
function fail(code: string, message: string): never { throw new ModelError([{ code, message }]); }

function canonicalJson(value: unknown): string {
  const order = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(order);
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, order((item as Record<string, unknown>)[key])]));
    }
    return item;
  };
  return JSON.stringify(order(value));
}

/** Check textual size and nesting before JSON allocation, then bound all parsed fields before crypto. */
function parseEnvelope(text: string): PackageEnvelope {
  if (typeof text !== 'string') fail('INVALID_PACKAGE_JSON', '패키지는 JSON 텍스트여야 합니다.');
  if (text.length > MODEL_PACKAGE_LIMITS.maxBytes || encoder.encode(text).byteLength > MODEL_PACKAGE_LIMITS.maxBytes) {
    fail('PACKAGE_TOO_LARGE', '모델 패키지는 6 MiB 이하여야 합니다.');
  }
  let depth = 0, inString = false, escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === '{' || character === '[') {
      if (++depth > MODEL_PACKAGE_LIMITS.maxDepth + 1) fail('PACKAGE_DEPTH_EXCEEDED', '패키지 중첩 깊이가 허용 상한을 초과했습니다.');
    } else if (character === '}' || character === ']') depth--;
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail('INVALID_PACKAGE_JSON', '패키지 JSON 형식을 확인해 주세요.'); }
  const pending: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let values = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (++values > MODEL_PACKAGE_LIMITS.maxValues) fail('PACKAGE_RESOURCE_LIMIT', '패키지의 값 개수가 허용 상한을 초과했습니다.');
    if (entry.depth > MODEL_PACKAGE_LIMITS.maxDepth) fail('PACKAGE_DEPTH_EXCEEDED', '패키지 중첩 깊이가 허용 상한을 초과했습니다.');
    if (typeof entry.value === 'number' && !Number.isFinite(entry.value)) fail('INVALID_PACKAGE_SCHEMA', '패키지 숫자는 유한해야 합니다.');
    if (entry.value !== null && typeof entry.value === 'object') {
      for (const [key, child] of Object.entries(entry.value)) {
        if (unsafeKeys.has(key)) fail('PACKAGE_UNSAFE_FIELD', '패키지에 안전하지 않은 필드명이 있습니다.');
        pending.push({ value: child, depth: entry.depth + 1 });
      }
    }
  }
  const result = packageSchema.safeParse(value);
  if (!result.success) fail('INVALID_PACKAGE_SCHEMA', '패키지 필드·서명 형식·상한을 확인해 주세요.');
  return result.data;
}

function subtleCrypto(): SubtleCrypto {
  if (!globalThis.crypto?.subtle) fail('PACKAGE_CRYPTO_UNAVAILABLE', '서명 패키지에는 HTTPS 또는 localhost의 WebCrypto가 필요합니다.');
  return globalThis.crypto.subtle;
}
function asBase64Url(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(text: string, length: number): Uint8Array<ArrayBuffer> {
  let binary: string;
  try { binary = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - text.length % 4) % 4)); }
  catch { fail('INVALID_PACKAGE_SIGNATURE', '패키지 공개키 또는 서명 인코딩을 확인해 주세요.'); }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== length || asBase64Url(bytes) !== text) fail('INVALID_PACKAGE_SIGNATURE', '패키지 공개키 또는 서명 인코딩을 확인해 주세요.');
  return bytes;
}
async function hashBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  try {
    const digest = await subtleCrypto().digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    if (error instanceof ModelError) throw error;
    fail('PACKAGE_CRYPTO_FAILED', '이 환경에서 패키지 SHA-256을 검증할 수 없습니다.');
  }
}
function signedBytes(envelope: Omit<PackageEnvelope, 'signature'>): Uint8Array<ArrayBuffer> {
  return encoder.encode(`CALCWEAVE-MODEL-PACKAGE\u0000${canonicalJson(envelope)}`);
}
function checkContract(envelope: PackageEnvelope): void {
  if (envelope.packageVersion !== MODEL_PACKAGE_VERSION || envelope.modelSchemaVersion !== 1 || envelope.engineVersion !== ENGINE_VERSION) {
    fail('PACKAGE_VERSION_UNSUPPORTED', '패키지·모델·엔진 버전이 현재 CalcWeave와 일치해야 합니다.');
  }
  if (canonicalJson(envelope.registry) !== canonicalJson(MODEL_PACKAGE_REGISTRY)) {
    fail('PACKAGE_REGISTRY_MISMATCH', '패키지는 현재 승인된 블럭·포트·파라미터 계약만 사용할 수 있습니다.');
  }
  if (envelope.permissions.length !== 1 || envelope.permissions[0] !== 'local-model') {
    fail('PACKAGE_PERMISSION_DENIED', '패키지 권한은 local-model 하나만 허용합니다.');
  }
}

/** One export gets a fresh nonextractable signing key. Only its public key is included; nothing is persisted. */
export async function createModelPackage(input: CalcModel): Promise<{ text: string; fingerprint: string }> {
  const model = parseModel(input);
  compileModel(model);
  const payload: Omit<PackageEnvelope, 'signature'> = {
    format: MODEL_PACKAGE_FORMAT, packageVersion: MODEL_PACKAGE_VERSION, engineVersion: ENGINE_VERSION,
    modelSchemaVersion: 1, registry: structuredClone(MODEL_PACKAGE_REGISTRY), permissions: ['local-model'], modelHash: '0'.repeat(64), model,
  };
  // Bound the complete container before key creation/signing as well as at the receive boundary.
  const provisionalText = canonicalJson({ ...payload, signature: { algorithm: 'ECDSA-P256-SHA256', publicKeyEncoding: 'raw-base64url', publicKey: 'A'.repeat(87), value: 'A'.repeat(86) } });
  parseEnvelope(provisionalText);
  payload.modelHash = await hashBytes(encoder.encode(canonicalJson(model)));
  const crypto = subtleCrypto();
  try {
    const pair = await crypto.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const publicKey = new Uint8Array(await crypto.exportKey('raw', pair.publicKey));
    const signature = new Uint8Array(await crypto.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, signedBytes(payload)));
    return {
      text: canonicalJson({ ...payload, signature: { algorithm: 'ECDSA-P256-SHA256', publicKeyEncoding: 'raw-base64url', publicKey: asBase64Url(publicKey), value: asBase64Url(signature) } }),
      fingerprint: await hashBytes(publicKey),
    };
  } catch (error) {
    if (error instanceof ModelError) throw error;
    fail('PACKAGE_CRYPTO_FAILED', '이 환경에서 패키지 서명을 만들 수 없습니다.');
  }
}

/** Integrity is verified here; the embedded public key is intentionally not an authorization decision. */
export async function inspectModelPackage(text: string): Promise<ModelPackageInspection> {
  const envelope = parseEnvelope(text);
  checkContract(envelope);
  const model = parseModel(envelope.model);
  const { signature, ...payload } = envelope;
  if (await hashBytes(encoder.encode(canonicalJson(envelope.model))) !== envelope.modelHash) {
    fail('PACKAGE_HASH_MISMATCH', '패키지 모델의 SHA-256 값이 일치하지 않습니다.');
  }
  const publicKey = fromBase64Url(signature.publicKey, 65);
  const signatureBytes = fromBase64Url(signature.value, 64);
  if (publicKey[0] !== 4) fail('INVALID_PACKAGE_SIGNATURE', 'P-256 공개키 형식을 확인해 주세요.');
  const crypto = subtleCrypto();
  let verified: boolean;
  try {
    const key = await crypto.importKey('raw', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    verified = await crypto.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signatureBytes, signedBytes(payload));
  } catch { fail('INVALID_PACKAGE_SIGNATURE', '패키지 공개키 또는 서명이 유효하지 않습니다.'); }
  if (!verified) fail('INVALID_PACKAGE_SIGNATURE', '패키지 서명이 일치하지 않습니다.');
  const fingerprint = await hashBytes(publicKey);
  let diagnostics: Diagnostic[] = [];
  try { compileModel(model); } catch (error) {
    if (!(error instanceof ModelError)) fail('PACKAGE_VALIDATION_FAILED', '패키지 모델을 검증할 수 없습니다.');
    diagnostics = error.diagnostics;
  }
  return { model, fingerprint, packageVersion: envelope.packageVersion, modelHash: envelope.modelHash, diagnostics, executable: diagnostics.length === 0 };
}

/** Call only with a fingerprint independently obtained from the intended sender. No trust is stored. */
export async function acceptModelPackage(text: string, trustedFingerprint: string): Promise<CalcModel> {
  if (typeof trustedFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(trustedFingerprint)) {
    fail('PACKAGE_TRUST_REQUIRED', '발신자에게 별도로 확인한 SHA-256 공개키 지문 64자리를 입력해 주세요.');
  }
  const inspection = await inspectModelPackage(text);
  if (inspection.fingerprint !== trustedFingerprint) fail('PACKAGE_TRUST_MISMATCH', '별도로 확인한 공개키 지문과 패키지 서명 키가 일치하지 않습니다.');
  if (!inspection.executable) throw new ModelError(inspection.diagnostics);
  return inspection.model;
}
