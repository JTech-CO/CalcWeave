import { ModelError, type IRNode } from '../../model/src/types';
import { BUILTIN_ADAPTER_PROFILES } from '../../model/src/m14-adapters';

/** Repository-authored straight-line modules. Model input can select no other bytes. */
export const M14_WASM_BYTES: Readonly<Record<string, readonly number[]>> = Object.freeze({
  'calcweave.wasm-affine-f64-v1': Object.freeze([0,97,115,109,1,0,0,0,1,8,1,96,3,124,124,124,1,124,3,2,1,0,7,10,1,6,97,102,102,105,110,101,0,0,10,12,1,10,0,32,0,32,1,162,32,2,160,11]),
  'calcweave.wasm-accumulator-f64-v1': Object.freeze([0,97,115,109,1,0,0,0,1,13,2,96,1,124,1,124,96,3,124,124,124,1,124,3,6,5,0,0,1,0,0,7,54,5,10,105,110,105,116,105,97,108,105,122,101,0,0,4,114,101,97,100,0,1,10,97,99,99,117,109,117,108,97,116,101,0,2,5,114,101,115,101,116,0,3,9,116,101,114,109,105,110,97,116,101,0,4,10,32,5,4,0,32,0,11,4,0,32,0,11,10,0,32,0,32,1,32,2,162,160,11,4,0,32,0,11,4,0,32,0,11]),
});

export interface M14WasmInspection {
  profileId: string; byteLength: number; pinnedSha256: string; abiVersion: number;
  sections: number[]; exports: { name: string; parameters: string[]; result: string }[];
  instructionCount: number; imports: number; memories: number; tables: number; globals: number; start: false; loops: false; calls: false;
}
interface M14WasmHost {
  Module: new (bytes: Uint8Array) => unknown;
  Instance: new (module: unknown, imports?: Record<string, unknown>) => { exports: Record<string, unknown> };
}
export type M14WasmFunctions = Readonly<Record<string, (...values: number[]) => number>>;
function m14WasmFailure(code: string, nodeId: string, message: string): never { throw new ModelError([{ code, nodeId, message }]); }

/** Inspect the exact pinned bytes before host compilation. The SHA itself is independently verified at build/test time. */
export function inspectM14Wasm(bytes: readonly number[], profileId: string): M14WasmInspection {
  const profile = BUILTIN_ADAPTER_PROFILES.find(value => value.id === profileId)?.artifact;
  const expected = M14_WASM_BYTES[profileId];
  const fail = (): never => m14WasmFailure('M14_ADAPTER_ABI', profileId, '고정 WASM 바이트·서명·허용 명령 계약이 다릅니다.');
  if (!profile || !expected || bytes.length !== expected.length || bytes.some((value, index) => !Number.isInteger(value) || value < 0 || value > 255 || value !== expected[index])) fail();
  let offset = 0;
  const byte = (): number => { if (offset >= bytes.length) fail(); return bytes[offset++]!; };
  const unsigned = (): number => { let value = 0, shift = 0, count = 0; while (true) { const next = byte(); if (++count > 5 || shift === 28 && next > 15) fail(); value += (next & 127) * 2 ** shift; if (!(next & 128)) { if (count > 1 && next === 0) fail(); return value; } shift += 7; } };
  const string = (): string => { const count = unsigned(); if (count > 64 || offset + count > bytes.length) fail(); let text = ''; for (let i = 0; i < count; i++) { const value = byte(); if (value < 32 || value > 126) fail(); text += String.fromCharCode(value); } return text; };
  for (const value of [0,97,115,109,1,0,0,0]) if (byte() !== value) fail();
  const types: number[] = [], functions: number[] = [], exports: { name: string; parameters: string[]; result: string }[] = [], sections: number[] = [];
  let instructionCount = 0, functionCount = 0;
  while (offset < bytes.length) {
    const section = byte(), length = unsigned(), end = offset + length;
    if (![1,3,7,10].includes(section) || sections.includes(section) || section <= (sections.at(-1) ?? 0) || end > bytes.length) fail();
    sections.push(section);
    const count = unsigned(); if (count < 1 || count > 8) fail();
    if (section === 1) for (let i = 0; i < count; i++) { if (byte() !== 96) fail(); const arity = unsigned(); if (arity < 1 || arity > 3) fail(); for (let j = 0; j < arity; j++) if (byte() !== 124) fail(); if (unsigned() !== 1 || byte() !== 124) fail(); types.push(arity); }
    if (section === 3) for (let i = 0; i < count; i++) { const type = unsigned(); if (type >= types.length) fail(); functions.push(type); }
    if (section === 7) for (let i = 0; i < count; i++) { const name = string(); if (byte() !== 0) fail(); const index = unsigned(); if (index >= functions.length || exports.some(value => value.name === name)) fail(); exports.push({ name, parameters: Array(types[functions[index]!]!).fill('f64'), result: 'f64' }); }
    if (section === 10) {
      if (count !== functions.length) fail(); functionCount = count;
      for (let i = 0; i < count; i++) {
        const size = unsigned(), bodyEnd = offset + size; if (bodyEnd > end || unsigned() !== 0) fail();
        let stack = 0, ended = false;
        while (offset < bodyEnd) {
          const opcode = byte(); instructionCount++;
          if (opcode === 32) { if (unsigned() >= types[functions[i]!]!) fail(); stack++; }
          else if (opcode === 160 || opcode === 162) { if (stack < 2) fail(); stack--; }
          else if (opcode === 11) { if (stack !== 1 || offset !== bodyEnd) fail(); ended = true; }
          else fail();
        }
        if (!ended || offset !== bodyEnd) fail();
      }
    }
    if (offset !== end) fail();
  }
  if (sections.join(',') !== '1,3,7,10' || !functionCount || JSON.stringify(exports) !== JSON.stringify(profile!.exports)) fail();
  return { profileId, byteLength: bytes.length, pinnedSha256: profile!.sha256, abiVersion: profile!.abiVersion, sections, exports, instructionCount, imports: 0, memories: 0, tables: 0, globals: 0, start: false, loops: false, calls: false };
}

function m14WasmProfile(node: IRNode) {
  const profileId = node.blockType === 'adapter.wasm-affine' ? 'calcweave.wasm-affine-f64-v1' : 'calcweave.wasm-accumulator-f64-v1';
  const metadata = BUILTIN_ADAPTER_PROFILES.find(value => value.id === profileId)!;
  const profile = { id: metadata.id, version: metadata.version, ...metadata.artifact! };
  const identity = node.parameters.adapterIdentity as { id?: unknown; version?: unknown; sha256?: unknown; abiVersion?: unknown } | undefined;
  if (!identity || identity.id !== profile.id || identity.version !== profile.version || identity.sha256 !== profile.sha256 || identity.abiVersion !== profile.abiVersion || Object.keys(identity).sort().join(',') !== 'abiVersion,id,sha256,version') m14WasmFailure('M14_ADAPTER_ABI', node.id, '컴파일한 어댑터 identity가 고정 catalog와 다릅니다.');
  return profile;
}
export function m14WasmCost(profileId: string): number {
  const bytes = M14_WASM_BYTES[profileId]; if (!bytes) return 1;
  const profile = BUILTIN_ADAPTER_PROFILES.find(value => value.id === profileId)!.artifact!;
  return 8 * bytes.length + 32 * profile.exports.length + 32;
}
/** Stateful machines own these immutable pure functions separately from their JSON numerical memory. */
export function prepareM14Wasm(node: IRNode): M14WasmFunctions {
  const profile = m14WasmProfile(node), bytes = M14_WASM_BYTES[profile.id]!;
  inspectM14Wasm(bytes, profile.id);
  const host = (globalThis as unknown as { WebAssembly?: M14WasmHost }).WebAssembly;
  if (!host || typeof host.Module !== 'function' || typeof host.Instance !== 'function') m14WasmFailure('M14_ADAPTER_UNAVAILABLE', node.id, '현재 실행 환경에서 고정 WebAssembly 어댑터를 사용할 수 없습니다.');
  let exports: Record<string, unknown>;
  try { exports = new host.Instance(new host.Module(Uint8Array.from(bytes)), {}).exports; }
  catch { return m14WasmFailure('M14_ADAPTER_UNAVAILABLE', node.id, '고정 WASM 모듈을 준비할 수 없습니다.'); }
  if (!exports || Object.keys(exports).sort().join(',') !== profile.exports.map(value => value.name).sort().join(',') || profile.exports.some(value => typeof exports[value.name] !== 'function')) m14WasmFailure('M14_ADAPTER_ABI', node.id, '호스트가 노출한 WASM 함수 서명이 고정 ABI와 다릅니다.');
  return Object.freeze({ ...exports }) as M14WasmFunctions;
}
export function invokeM14Wasm(node: IRNode, name: string, args: number[], bindings?: M14WasmFunctions): number {
  const profile = m14WasmProfile(node), signature = profile.exports.find(value => value.name === name);
  if (!signature || args.length !== signature.parameters.length || args.some(value => typeof value !== 'number' || !Number.isFinite(value))) m14WasmFailure('M14_ADAPTER_ABI', node.id, 'WASM 호출에는 지정한 수의 유한한 f64 인자가 필요합니다.');
  const exports = bindings ?? prepareM14Wasm(node);
  let result: unknown;
  try { result = (exports[name] as (...values: number[]) => number)(...args); }
  catch { return m14WasmFailure('M14_ADAPTER_TRAP', node.id, '고정 WASM 계산이 trap으로 중단되었습니다.'); }
  if (typeof result !== 'number' || !Number.isFinite(result)) m14WasmFailure('M14_ADAPTER_NONFINITE', node.id, 'WASM 계산 결과가 유한한 f64가 아닙니다.');
  return result;
}
