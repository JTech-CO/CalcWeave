import { M9_BLOCK_IDS } from '../../block-library/src/m9';
import { M10_BLOCK_IDS } from '../../block-library/src/m10';
import { ENGINE_VERSION, ModelError, normalizeSolverSettings, type CompiledModel, type ExecutionSettings, type SignalDescriptor } from '../../model/src';
import { sha256 } from './sha256';
import { EXPANSION_BLOCK_IDS } from '../../block-library/src/expansion';
import { EXPANDED_TIME_SOURCE_IDS } from '../../block-library/src/time-sources';
import { M8_BLOCK_IDS } from '../../block-library/src/m8';

export interface ExportManifest {
  schemaVersion: 1;
  modelHash: string;
  modelHashAlgorithm: 'SHA-256';
  engineVersion: string;
  targetVersion: 'typescript-m2-v1' | 'typescript-m3-v1' | 'typescript-m4-v1' | 'typescript-m5-v1' | 'typescript-catalog-v1' | 'typescript-m8-v1' | 'typescript-m9-v1' | 'typescript-m10-v1';
  execution: ExecutionSettings;
  nodes: Record<string, { sampleTime: { period: number; offset: number }; executionDomain?: 'continuous'|'discrete'|'constant'; seed?: number; randomAlgorithm?: 'lcg32-boxmuller-v1' | 'lcg32-boxmuller-midpoint-v1' | 'lcg32-uniform-midpoint-v1' }>;
  outputTypes: Record<string, SignalDescriptor>;
  rateTransitionPolicy: 'read-before-write';
  dataReferences: { id: string; version: number; sourceHash: string; contentHash: string; timeColumn: string; columns: { name: string; kind: 'number' | 'boolean' | 'string'; unit: string }[] }[];
  hierarchyReferences?: { nodeId: string; path: string[]; definitionId: string; version: number; definitionHash: string }[];
  resourceLimits: { maxTickIntervals: number; maxRecordedElements: number; maxOperations: number; maxStateElements: number; maxSignalElements: number; maxActiveWallMs: number };
  continuousPolicy?: { outputGrid: 'execution.step'; discreteGrid: 'solver.discreteStep'; eventOrder: 'reset-tick-observe'; acceptedBoundaryMemory: true; limits: { maxSteps: number; maxRejects: number; maxEvaluations: number; maxEvents: number } };
}

export function manifestForHash(compiled: CompiledModel, hash: string): ExportManifest {
  const continuous = compiled.model.execution.mode === 'continuous';
  const solver = continuous ? normalizeSolverSettings(compiled.model.execution) : undefined;
  const dataIds = new Set(compiled.nodes.filter(node => node.blockType === 'source.dataset').map(node => String(node.parameters.datasetId)));
  const legacyUnits = new Set(['1','m','s','kg','A','K','mol','cd','rad','deg','V','Hz','N','Pa','J','W','m/s','m/s^2']);
  const m4 = compiled.nodes.some(node => node.parameters.unitAlgebra === true || ['source.dataset', 'unit.convert', 'route.bus-create', 'route.bus-select', 'annotation.note', 'annotation.model-info'].includes(node.blockType) || Object.values(node.outputs).some(output => !legacyUnits.has(output.unit))) || !!compiled.hierarchy?.instances.length;
  const m5 = compiled.nodes.some(node => ['math.matrix-multiply', 'matrix.transpose', 'matrix.determinant', 'matrix.inverse', 'matrix.solve', 'matrix.cholesky', 'matrix.lu', 'lookup.2d', 'lookup.prelookup', 'fixed.quantize'].includes(node.blockType));
  const catalogIds: ReadonlySet<string> = new Set([...EXPANSION_BLOCK_IDS, ...EXPANDED_TIME_SOURCE_IDS]);
  const catalog = compiled.nodes.some(node => catalogIds.has(node.blockType));
  const m8Ids: ReadonlySet<string> = new Set(M8_BLOCK_IDS);
  const m8 = compiled.nodes.some(node => m8Ids.has(node.blockType));
  const m9Ids: ReadonlySet<string> = new Set(M9_BLOCK_IDS);
  const m9 = compiled.nodes.some(node => m9Ids.has(node.blockType));
  const m10Ids: ReadonlySet<string> = new Set(M10_BLOCK_IDS);
  const m10 = compiled.nodes.some(node => m10Ids.has(node.blockType));
  return {
    schemaVersion: 1, modelHash: hash, modelHashAlgorithm: 'SHA-256', engineVersion: ENGINE_VERSION,
    targetVersion: m10 ? 'typescript-m10-v1' : m9 ? 'typescript-m9-v1' : m8 ? 'typescript-m8-v1' : catalog ? 'typescript-catalog-v1' : m5 ? 'typescript-m5-v1' : m4 ? 'typescript-m4-v1' : continuous ? 'typescript-m3-v1' : 'typescript-m2-v1', execution: structuredClone(compiled.model.execution),
    nodes: Object.fromEntries(compiled.nodes.map((node) => [node.id, { sampleTime: { ...node.sampleTime },
      ...(node.executionDomain ? { executionDomain: node.executionDomain } : {}),
      ...(node.blockType === 'source.random' ? { seed: Number(node.parameters.seed), randomAlgorithm: 'lcg32-boxmuller-v1' as const }
        : node.blockType === 'source.band-limited-noise' || node.blockType === 'source.random-configured' && node.parameters.distribution === 'normal' ? { seed: Number(node.parameters.seed), randomAlgorithm: 'lcg32-boxmuller-midpoint-v1' as const }
        : node.blockType === 'source.random-configured' || node.blockType === 'source.signal-generator' && node.parameters.waveform === 'random' ? { seed: Number(node.parameters.seed), randomAlgorithm: 'lcg32-uniform-midpoint-v1' as const } : {}) }])),
    outputTypes: structuredClone(compiled.outputTypes), rateTransitionPolicy: 'read-before-write',
    dataReferences: [...compiled.model.datasets ?? []].filter(dataset => dataIds.has(dataset.id)).sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(dataset => ({ id: dataset.id, version: dataset.version, sourceHash: dataset.sourceHash, contentHash: dataset.contentHash, timeColumn: dataset.timeColumn, columns: structuredClone(dataset.columns) })),
    ...(compiled.hierarchy ? { hierarchyReferences: structuredClone(compiled.hierarchy.instances) } : {}),
    resourceLimits: { maxTickIntervals: 10000, maxRecordedElements: 1000000, maxOperations: 50000000, maxStateElements: 100000, maxSignalElements: 1024, maxActiveWallMs: 30000 },
    ...(solver ? { continuousPolicy: { outputGrid: 'execution.step' as const, discreteGrid: 'solver.discreteStep' as const, eventOrder: 'reset-tick-observe' as const, acceptedBoundaryMemory: true as const,
      limits: { maxSteps: solver.maxSteps, maxRejects: solver.maxRejects, maxEvaluations: solver.maxEvaluations, maxEvents: solver.maxEvents } } } : {}),
  };
}

/** Manifest construction is asynchronous only because the browser's SHA-256 API is asynchronous. */
export async function createExportManifest(compiled: CompiledModel): Promise<ExportManifest> {
  if (!globalThis.crypto?.subtle) throw new ModelError([{ code: 'EXPORT_HASH_UNAVAILABLE', message: '이 환경에서 SHA-256을 사용할 수 없습니다.' }]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(compiled.semanticKey));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== sha256(compiled.semanticKey)) throw new ModelError([{ code: 'EXPORT_HASH_MISMATCH', message: '실행 의미 hash를 확인할 수 없습니다.' }]);
  return manifestForHash(compiled, hash);
}
