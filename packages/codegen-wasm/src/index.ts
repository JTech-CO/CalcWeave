import { compileModel } from '../../compiler/src';
import { ENGINE_VERSION, ModelError, sha256, type CompiledModel, type Diagnostic, type ExecutionSettings, type SignalDescriptor } from '../../model/src';
import { WASM_TARGET } from './capabilities';
import { emitWasm, type WasmBinaryPlan } from './binary';
import { sha256Bytes } from './sha256';
import { wasmRunner } from './runner';
export { WASM_TARGET, sha256Bytes };
export { C_CPP_TARGET } from './capabilities';

export interface WasmExportManifest {
  schemaVersion: 1; targetVersion: 'wasm-m15-v1'; engineVersion: string;
  modelHash: string; modelHashAlgorithm: 'SHA-256'; artifactHash: string; artifactHashAlgorithm: 'SHA-256'; artifactBytes: number;
  abi: typeof WASM_TARGET.abi; execution: ExecutionSettings;
  nodeIds: string[]; outputIds: string[]; outputTypes: Record<string, SignalDescriptor>;
  nodes: Record<string, { sampleTime: { period: number; offset: number }; outputs: Record<string, SignalDescriptor> }>;
  instructionCount: number; evaluationCallsPerTick: number; maximumOperations: number;
  resourceLimits: typeof WASM_TARGET.limits;
  capabilities: { imports: false; memory: false; table: false; globals: false; start: false; loops: false; calls: false; network: false; filesystem: false; arbitraryModuleInput: false };
  fullSimulinkEquivalenceClaimed: false;
}
const supported = new Set(WASM_TARGET.blockIds);
const stable = (value: unknown): string => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key)+':'+stable((value as Record<string,unknown>)[key])).join(',') + '}' : JSON.stringify(value);
export function getWasmDiagnostics(compiled: CompiledModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, message: string, nodeId?: string, portId?: string) => { const origin = nodeId && compiled.hierarchy?.origins[nodeId]; diagnostics.push({ code, message, ...(nodeId ? { nodeId: origin ? origin.rootNodeId : nodeId } : {}), ...(portId ? { portId } : {}), ...(origin ? { hierarchyPath: origin.path, childNodeId: nodeId } : {}) }); };
  const mode = compiled.model.execution.mode;
  if (mode !== 'static' && mode !== 'discrete') for (const node of compiled.nodes) add('WASM_UNSUPPORTED_MODE', 'WASM은 정적·이산 스칼라 DAG만 지원합니다.',node.id);
  if (compiled.nodes.length > WASM_TARGET.limits.maxNodes) add('WASM_NODE_BUDGET','WASM 도식은64개 이하 노드여야 합니다.');
  if (compiled.outputIds.length > WASM_TARGET.limits.maxOutputs) add('WASM_OUTPUT_BUDGET','WASM 기록 출력은16개 이하여야 합니다.');
  if (compiled.hierarchy?.instances.length || compiled.model.subsystems?.length) for (const node of compiled.nodes) add('WASM_HIERARCHY_UNSUPPORTED','WASM은 root DAG만 지원하며 하위 정의를 실행하지 않습니다.',node.id);
  if (compiled.model.datasets?.length) add('WASM_DATA_UNSUPPORTED','WASM은 Dataset을 포함한 모델을 지원하지 않습니다.');
  if (compiled.model.dashboard?.length) add('WASM_VOLATILE_INPUT_UNSUPPORTED','WASM에는 실행 중 Dashboard 파라미터 조작을 포함할 수 없습니다.');
  if (compiled.stateIds.length) for (const id of compiled.stateIds) add('WASM_STATE_UNSUPPORTED','WASM 선택 타깃은 저장 상태·solver를 지원하지 않습니다.',id);
  for (const node of compiled.nodes) {
    if (!supported.has(node.blockType)) { add('WASM_UNSUPPORTED_BLOCK',`${node.blockType}는 선택 WASM 타깃에 없습니다.`,node.id); continue; }
    if (node.sampleTime.period !== 1 || node.sampleTime.offset !== 0) add('WASM_RATE_UNSUPPORTED','WASM의 모든 노드는 base tick period1/offset0이어야 합니다.',node.id);
    for (const [port,descriptor] of Object.entries(node.outputs)) if (descriptor.valueType !== 'float64' || descriptor.shape.length) add('WASM_SCALAR_REQUIRED','WASM ABI는 legacy float64 scalar만 받습니다. typed·boolean·배열은 별도 타깃을 선택하세요.',node.id,port);
    if (node.blockType === 'math.function' && !['square','reciprocal'].includes(String(node.parameters.operation))) add('WASM_UNSUPPORTED_OPTION','Math Function WASM은 square/reciprocal만 지원합니다.',node.id);
    if ((node.blockType === 'source.constant' || node.blockType === 'io.input') && (typeof node.parameters.value !== 'number' || !Number.isFinite(node.parameters.value))) add('WASM_SCALAR_REQUIRED','WASM 고정 입력은 유한 숫자 scalar여야 합니다.',node.id,'out');
  }
  if (!diagnostics.length) {
    const plan = emitWasm(compiled), intervals = mode === 'static' ? 0 : Math.round((compiled.model.execution.stopTime-compiled.model.execution.startTime)/compiled.model.execution.step);
    if (plan.bytes.length > WASM_TARGET.limits.maxBinaryBytes) add('WASM_BINARY_BUDGET','생성 WASM은64KiB 이하여야 합니다.');
    if (!Number.isSafeInteger(intervals) || intervals < 0 || intervals > WASM_TARGET.limits.maxTickIntervals) add('WASM_STEP_BUDGET','WASM tick interval은10000 이하여야 합니다.');
    if ((intervals+1)*(compiled.outputIds.length+1) > WASM_TARGET.limits.maxRecordedElements) add('WASM_RECORD_BUDGET','WASM 시간축·결과 기록 상한을 초과했습니다.');
    if (plan.instructionCount*compiled.nodes.length*(intervals+1) > WASM_TARGET.limits.maxOperations) add('WASM_OPERATION_BUDGET','중간값 검사에 필요한 실제 전체 WASM 호출 연산이50m 상한을 초과합니다. 시간 범위를 줄여 주세요.');
  }
  return diagnostics.slice(0,100);
}
function verified(compiled: CompiledModel): CompiledModel {
  const checked = compileModel(compiled.model);
  if (stable(checked) !== stable(compiled)) throw new ModelError([{ code:'WASM_INVALID_IR',message:'WASM 실행 스냅샷과 원본 모델이 일치하지 않습니다.' }]);
  const diagnostics = getWasmDiagnostics(checked); if (diagnostics.length) throw new ModelError(diagnostics); return checked;
}
function checkedBytes(compiled: CompiledModel, bytes: Uint8Array): WasmBinaryPlan {
  const plan = emitWasm(compiled);
  if (!(bytes instanceof Uint8Array) || bytes.length !== plan.bytes.length || bytes.some((byte,index)=>byte !== plan.bytes[index])) throw new ModelError([{code:'WASM_ARTIFACT_MISMATCH',message:'WASM bytes는 현재 검증한 모델에서 생성한 고정 artifact와 정확히 같아야 합니다.'}]);
  return plan;
}
export function generateWasm(compiled: CompiledModel): Uint8Array<ArrayBuffer> { return new Uint8Array(emitWasm(verified(compiled)).bytes); }
function manifest(compiled: CompiledModel, plan: WasmBinaryPlan): WasmExportManifest {
  const execution = compiled.model.execution, count = execution.mode === 'static' ? 1 : Math.round((execution.stopTime-execution.startTime)/execution.step)+1;
  return { schemaVersion:1,targetVersion:WASM_TARGET.id,engineVersion:ENGINE_VERSION,modelHash:sha256(compiled.semanticKey),modelHashAlgorithm:'SHA-256',artifactHash:sha256Bytes(plan.bytes),artifactHashAlgorithm:'SHA-256',artifactBytes:plan.bytes.length,abi:structuredClone(WASM_TARGET.abi),execution:structuredClone(execution),nodeIds:plan.nodeIds,outputIds:[...compiled.outputIds],outputTypes:structuredClone(compiled.outputTypes),nodes:Object.fromEntries(compiled.nodes.map(node=>[node.id,{sampleTime:{...node.sampleTime},outputs:structuredClone(node.outputs)}])),instructionCount:plan.instructionCount,evaluationCallsPerTick:compiled.nodes.length,maximumOperations:plan.instructionCount*compiled.nodes.length*count,resourceLimits:structuredClone(WASM_TARGET.limits),capabilities:{imports:false,memory:false,table:false,globals:false,start:false,loops:false,calls:false,network:false,filesystem:false,arbitraryModuleInput:false},fullSimulinkEquivalenceClaimed:false };
}
export function createWasmManifest(compiled: CompiledModel, bytes: Uint8Array): WasmExportManifest { const checked = verified(compiled); return manifest(checked,checkedBytes(checked,bytes)); }
export function generateWasmRunner(compiled: CompiledModel, bytes: Uint8Array, suppliedManifest?: WasmExportManifest): string {
  const checked = verified(compiled), plan = checkedBytes(checked,bytes), metadata = manifest(checked,plan);
  if (suppliedManifest && stable(suppliedManifest) !== stable(metadata)) throw new ModelError([{code:'WASM_MANIFEST_MISMATCH',message:'WASM manifest가 현재 고정 artifact와 다릅니다.'}]);
  return wasmRunner(checked,plan,metadata);
}
