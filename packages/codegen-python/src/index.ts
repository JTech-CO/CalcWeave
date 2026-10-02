import { compileModel } from '../../compiler/src';
import { discreteMemoryElementCount, ModelError, sha256, type CompiledModel, type Diagnostic } from '../../model/src';
import { nodeOperationCost, signalElements } from '../../runtime/src/kernels';
import { manifestForHash, type ExportManifest } from '../../codegen-ts/src/manifest';
import { PYTHON_RUNTIME } from './runtime';
import { PYTHON_TARGET } from './capabilities';
export { PYTHON_TARGET } from './capabilities';

const supported = new Set(PYTHON_TARGET.blockIds);
export const PYTHON_EXPORT_LIMITS = Object.freeze({ maxFileBytes: 16 * 1024 * 1024, maxDataBytes: 8 * 1024 * 1024 });

export interface PythonExportManifest extends Omit<ExportManifest, 'targetVersion'> {
  targetVersion: 'python-m7-v1';
  runtime: 'python-standard-library';
  minimumVersion: '3.10';
  /** Integrity of the exact compiler-owned IR JSON, distinct from the source semantic hash. */
  artifactDataHash: string;
  artifactDataHashAlgorithm: 'SHA-256';
}

export function getPythonDiagnostics(compiled: CompiledModel): Diagnostic[] {
  const modeUnsupported = !PYTHON_TARGET.supportedModes.some(mode => mode === compiled.model.execution.mode);
  const diagnostics: Diagnostic[] = [];
  const location = (nodeId: string, code: string, message: string): Diagnostic => {
    const origin = compiled.hierarchy?.origins[nodeId];
    return { code, nodeId: origin?.rootNodeId ?? nodeId, message: origin ? `${origin.path.join(' / ')}: ${message}` : message };
  };
  if (modeUnsupported) {
    for (const node of compiled.nodes) diagnostics.push(location(node.id, 'PYTHON_UNSUPPORTED_MODE',
      'Python export는 정적·이산 실행만 지원합니다. 연속 실행은 TypeScript를 선택해 주세요.'));
    if (!compiled.nodes.length) diagnostics.push({ code: 'PYTHON_UNSUPPORTED_MODE', message: 'Python export는 정적·이산 실행만 지원합니다.' });
  }
  for (const node of compiled.nodes) if (!supported.has(node.blockType)) diagnostics.push(location(node.id, 'PYTHON_UNSUPPORTED_BLOCK',
    `${node.blockType}는 Python export의 승인 지원 범위에 없습니다. TypeScript를 선택해 주세요.`));
  return diagnostics;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value);
}

/** Recompile the source at the export boundary: forged/stale IR is never executable input. */
function verified(compiled: CompiledModel): CompiledModel {
  const checked = compileModel(compiled.model);
  if (stable(checked) !== stable(compiled)) throw new ModelError([{ code: 'PYTHON_INVALID_IR', message: 'Python export의 실행 스냅샷과 원본 모델이 일치하지 않습니다.' }]);
  const diagnostics = getPythonDiagnostics(checked);
  if (diagnostics.length) throw new ModelError(diagnostics);
  return checked;
}

function executionData(compiled: CompiledModel) {
  const byId = new Map(compiled.nodes.map(node => [node.id, node]));
  return {
    settings: compiled.model.execution,
    nodes: compiled.nodes.map(node => ({
      id: node.id, blockType: node.blockType,
      // The original expression is omitted. Only the bounded compiler-owned AST is interpreted.
      parameters: Object.fromEntries(Object.entries(node.parameters).filter(([key]) => node.blockType !== 'math.expression' || key !== 'expression')),
      inputs: node.inputs, outputs: node.outputs, sampleTime: node.sampleTime,
      ...(node.expression ? { expression: node.expression } : {}),
      cost: nodeOperationCost(node, byId),
    })),
    states: compiled.stateIds, outputs: compiled.outputIds, outputTypes: compiled.outputTypes,
    stateElements: discreteMemoryElementCount(compiled.nodes),
    recordedElements: compiled.outputIds.reduce((sum, id) => sum + signalElements(compiled.outputTypes[id]!), 1),
  };
}

function boundedDataText(compiled: CompiledModel): string {
  const data = executionData(compiled), encoder = new TextEncoder();
  let bytes = encoder.encode(JSON.stringify({ ...data, nodes: [] })).byteLength;
  // Dataset series can be shared by many IR nodes. Count each emitted copy
  // before allocating the combined JSON or its doubled hexadecimal encoding.
  for (const node of data.nodes) {
    bytes += encoder.encode(JSON.stringify(node)).byteLength + 1;
    if (bytes > PYTHON_EXPORT_LIMITS.maxDataBytes) throw new ModelError([{ code: 'EXPORT_RESOURCE_LIMIT', nodeId: node.id,
      message: 'Python 실행 데이터는 8 MiB 이하여야 합니다. 반복된 데이터 재생 블럭을 줄여 주세요.' }]);
  }
  return JSON.stringify(data);
}

function manifest(compiled: CompiledModel, dataText: string): PythonExportManifest {
  return {
    ...manifestForHash(compiled, sha256(compiled.semanticKey)), targetVersion: PYTHON_TARGET.id,
    runtime: 'python-standard-library', minimumVersion: PYTHON_TARGET.minimumVersion,
    artifactDataHash: sha256(dataText), artifactDataHashAlgorithm: 'SHA-256',
  };
}

export function createPythonExportManifest(compiled: CompiledModel): PythonExportManifest {
  const checked = verified(compiled);
  return manifest(checked, boundedDataText(checked));
}

/** Fixed code plus UTF-8 hexadecimal data. User text never becomes Python source syntax. */
export function exportPython(compiled: CompiledModel, suppliedManifest?: PythonExportManifest): string {
  const checked = verified(compiled), dataText = boundedDataText(checked), metadata = manifest(checked, dataText);
  if (suppliedManifest && stable(suppliedManifest) !== stable(metadata)) throw new ModelError([{ code: 'EXPORT_MANIFEST_MISMATCH', message: 'manifest가 Python 실행 스냅샷과 다릅니다.' }]);
  const encoder = new TextEncoder(), manifestText = JSON.stringify(metadata);
  if (2 * encoder.encode(dataText).byteLength + 2 * encoder.encode(manifestText).byteLength + encoder.encode(PYTHON_RUNTIME).byteLength + 1024 > PYTHON_EXPORT_LIMITS.maxFileBytes) {
    throw new ModelError([{ code: 'EXPORT_RESOURCE_LIMIT', message: '생성할 Python 파일은 16 MiB 이하여야 합니다. 모델의 블럭·데이터 크기를 줄여 주세요.' }]);
  }
  const hex = (text: string) => Array.from(new TextEncoder().encode(text), byte => byte.toString(16).padStart(2, '0')).join('');
  return `# Generated by CalcWeave. Python 3.10+; standard library only.\n# Source model SHA-256: ${metadata.modelHash}\n# Model values and IDs are inert JSON data, never executable identifiers.\nimport copy\nimport hashlib\nimport json\nimport math\nimport sys\nimport time\n\n_DATA_TEXT = bytes.fromhex("${hex(dataText)}")\n_MANIFEST_TEXT = bytes.fromhex("${hex(manifestText)}")\n${PYTHON_RUNTIME}\n`;
}
