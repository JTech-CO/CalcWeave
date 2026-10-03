import { M14_BLOCK_IDS } from '../../block-library/src/m14';
import { getNodeAdapterProfile, ModelError, structuredStorageElements, type CalcModel, type IRNode, type SignalDescriptor } from '../../model/src';
import type { M11CompileContext } from './m11';

const ids = new Set<string>(M14_BLOCK_IDS);
export const isM14Block = (id: string): boolean => ids.has(id);
const scalar = (): SignalDescriptor => ({ valueType: 'float64', shape: [], unit: '1' });
function fail(node: IRNode, code: string, message: string, portId?: string): never { throw new ModelError([{ code, nodeId: node.id, message, ...(portId ? { portId } : {}) }]); }
function realScalar(node: IRNode, descriptor: SignalDescriptor, portId: string, unit = '1'): void {
  if (descriptor.valueType !== 'float64' || descriptor.shape.length || descriptor.unit !== unit) fail(node, 'M14_ABI_SCALAR_REQUIRED', `고정 ABI의 ${portId}에는 단위 ${unit}인 유한 legacy float64 scalar를 연결하세요.`, portId);
}
export function validateM14Parameters(node: IRNode, model: CalcModel, context: M11CompileContext): void {
  if (!isM14Block(node.blockType)) return;
  const profile = getNodeAdapterProfile(node.blockType)!;
  if (!profile.supportedModes.includes(model.execution.mode)) fail(node, 'M14_EXECUTION_MODE_UNSUPPORTED', '이 어댑터는 선언된 실행 모드만 지원합니다.');
  const origin = context.origins?.[node.id];
  if (node.blockType !== 'adapter.wasm-affine' && (context.depth > 0 || (origin?.path.length ?? 0) > 1)) fail(node, 'M14_STATEFUL_ROOT_ONLY', '상태를 가진 M14 어댑터는 루트 그래프에서만 실행합니다. 하위 도식의 반복 호출·종료 lifecycle은 지원하지 않습니다.');
  node.parameters.adapterIdentity = { id: profile.id, version: profile.version, ...(profile.artifact ? { sha256: profile.artifact.sha256, abiVersion: profile.artifact.abiVersion } : { abiVersion: 1 }) };
  if (node.blockType === 'adapter.wasm-accumulator') node.parameters.m14StateElements = 16;
}
export function initialM14Outputs(node: IRNode): Record<string, SignalDescriptor> | undefined {
  return node.blockType === 'adapter.wasm-accumulator' ? { out: scalar() } : undefined;
}
export function inferM14Outputs(node: IRNode, input: (port: string) => SignalDescriptor): Record<string, SignalDescriptor> | undefined {
  if (!isM14Block(node.blockType)) return undefined;
  if (node.blockType === 'adapter.wasm-affine') { realScalar(node, input('in'), 'in'); return { out: scalar() }; }
  if (node.blockType === 'adapter.wasm-accumulator') return { out: scalar() };
  const descriptor = input('in');
  if (descriptor.valueType !== 'messages' || !descriptor.message) fail(node, 'M14_MESSAGE_REQUIRED', '운송 입력은 payload 계약이 있는 MessageSignal이어야 합니다.', 'in');
  realScalar(node, input('delay'), 'delay', 's');
  const output = structuredClone(descriptor);
  output.message!.maxBatch = Math.min(Number(node.parameters.capacity), Number(node.parameters.maxRelease));
  node.parameters.entityPayloadDescriptor = structuredClone(descriptor.message!.payload);
  node.parameters.entityInitial = { kind: 'messages', items: [] };
  node.parameters.m14StateElements = Number(node.parameters.capacity) * (structuredStorageElements(descriptor.message!.payload) + 83) + 128 * 65 + 8;
  return { out: output, count: scalar() };
}
export function validateM14StateInputs(node: IRNode, input: (port: string) => SignalDescriptor): boolean {
  if (!isM14Block(node.blockType)) return false;
  if (node.blockType === 'adapter.wasm-accumulator') {
    realScalar(node, input('in'), 'in'); const reset = input('reset');
    if (reset.valueType !== 'boolean' || reset.shape.length || reset.unit !== '1') fail(node, 'M14_RESET_BOOLEAN_REQUIRED', '초기화에는 단위 없는 boolean scalar를 연결하세요.', 'reset');
  }
  return true;
}
