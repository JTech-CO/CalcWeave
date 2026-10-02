import { ENGINE_VERSION, MODEL_LIMITS, ModelError, parseModel, type CalcModel } from '../../../packages/model/src';
import { sha256 } from '../../../packages/model/src/sha256';
import { RUN_HISTORY_LIMITS, validateRunHistory, type HistoryRecord } from './run-history';

export const WORKSPACE_BACKUP_LIMITS = Object.freeze({ version: 1, bytes: 26 * 1024 * 1024, modelBytes: MODEL_LIMITS.maxBytes, historyBytes: RUN_HISTORY_LIMITS.bytes, records: RUN_HISTORY_LIMITS.records });
export const LOCAL_OPERATION_CODES = ['STORAGE_OPEN_FAILED', 'STORAGE_BLOCKED', 'STORAGE_VERSION_CHANGED', 'STORAGE_READ_FAILED', 'STORAGE_WRITE_FAILED', 'STORAGE_QUOTA_EXCEEDED', 'STORAGE_ABORTED', 'STORAGE_CONFLICT', 'INVALID_LOCAL_MODEL', 'INVALID_LOCAL_HISTORY', 'WORKSPACE_BACKUP_INVALID', 'WORKSPACE_RESTORE_FAILED', 'LOCAL_RESET_FAILED', 'WORKER_START_FAILED', 'WORKER_RUNTIME_FAILED', 'MODEL_VALIDATION_FAILED', 'MODEL_IMPORT_FAILED', 'EXPORT_FAILED'] as const;
export const LOCAL_OPERATION_CONTEXTS = ['storage', 'history', 'backup', 'recovery', 'reset', 'worker', 'run', 'validation', 'export'] as const;
export type LocalOperationCode = typeof LOCAL_OPERATION_CODES[number];
export type LocalOperationContext = typeof LOCAL_OPERATION_CONTEXTS[number];
export interface LocalOperationRecord { code: LocalOperationCode; context: LocalOperationContext; at: string; engineVersion: string }
export const LOCAL_OPERATION_LIMITS = Object.freeze({ records: 50, bytes: 16 * 1024 });
const LOG_KEY = 'calcweave.local-operations-v1', BACKUP_KEY = 'calcweave.backup-status-v1';
const codeSet = new Set<string>(LOCAL_OPERATION_CODES), contextSet = new Set<string>(LOCAL_OPERATION_CONTEXTS);
const enginePattern = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[A-Za-z0-9.-]{1,32})?$/;
const diagnosticEnginePattern = /^\d{1,2}\.\d{1,2}\.\d{1,2}(?:-m\d{1,2})?$/;
const iso = (value: unknown): value is string => typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function error(code: string, message: string): never { throw new ModelError([{ code, message }]); }
function byteLength(text: string): number { return new TextEncoder().encode(text).length; }
function localStorageSafe(): Storage | null { try { return globalThis.localStorage ?? null; } catch { return null; } }

/** Closed fields and values prevent model text, numerical values, URLs or exception stacks entering the local diagnostic log. */
export function getLocalOperationLog(): LocalOperationRecord[] {
  try {
    const text = localStorageSafe()?.getItem(LOG_KEY); if (!text || text.length > LOCAL_OPERATION_LIMITS.bytes || byteLength(text) > LOCAL_OPERATION_LIMITS.bytes) return [];
    const raw: unknown = JSON.parse(text); if (!Array.isArray(raw)) return [];
    return raw.slice(-LOCAL_OPERATION_LIMITS.records).filter((record): record is LocalOperationRecord => {
      if (!record || typeof record !== 'object' || Object.keys(record).sort().join(',') !== 'at,code,context,engineVersion') return false;
      const entry = record as Record<string, unknown>;
      return typeof entry.code === 'string' && codeSet.has(entry.code) && typeof entry.context === 'string' && contextSet.has(entry.context) && iso(entry.at) && typeof entry.engineVersion === 'string' && diagnosticEnginePattern.test(entry.engineVersion);
    }).map((record) => ({ code: record.code, context: record.context, at: record.at, engineVersion: record.engineVersion }));
  } catch { return []; }
}
export function recordLocalOperation(code: LocalOperationCode, context: LocalOperationContext): boolean {
  if (!codeSet.has(code) || !contextSet.has(context)) return false;
  try {
    const storage = localStorageSafe(); if (!storage) return false;
    const records = [...getLocalOperationLog(), { code, context, at: new Date().toISOString(), engineVersion: ENGINE_VERSION }].slice(-LOCAL_OPERATION_LIMITS.records);
    const text = JSON.stringify(records); if (byteLength(text) > LOCAL_OPERATION_LIMITS.bytes) return false; storage.setItem(LOG_KEY, text); return true;
  } catch { return false; } // Logging failure never recursively logs or interrupts a model save.
}
export function exportLocalOperationLog(): string { return JSON.stringify({ format: 'calcweave-local-diagnostics', version: 1, engineVersion: ENGINE_VERSION, records: getLocalOperationLog() }, null, 2) + '\n'; }
export function clearLocalOperationLog(): void {
  try { const storage = localStorageSafe(); if (!storage) throw new Error('unavailable'); storage.removeItem(LOG_KEY); } catch { error('LOCAL_LOG_CLEAR_FAILED', '로컬 진단 기록을 지우지 못했습니다. 브라우저 저장 설정을 확인하세요.'); }
}
function backupStatus(): { lastCreatedAt: string | null; lastChangedAt: string | null } {
  try {
    const text = localStorageSafe()?.getItem(BACKUP_KEY); if (!text || text.length > 256) return { lastCreatedAt: null, lastChangedAt: null };
    const raw: unknown = JSON.parse(text); if (!raw || typeof raw !== 'object') return { lastCreatedAt: null, lastChangedAt: null };
    const entry = raw as Record<string, unknown>; return { lastCreatedAt: iso(entry.lastCreatedAt) ? entry.lastCreatedAt : null, lastChangedAt: iso(entry.lastChangedAt) ? entry.lastChangedAt : null };
  } catch { return { lastCreatedAt: null, lastChangedAt: null }; }
}
export function noteWorkspaceBackupCreated(): void { try { localStorageSafe()?.setItem(BACKUP_KEY, JSON.stringify({ ...backupStatus(), lastCreatedAt: new Date().toISOString() })); } catch { /* A downloaded backup remains useful without this optional reminder. */ } }
export function noteWorkspaceChanged(): void { try { localStorageSafe()?.setItem(BACKUP_KEY, JSON.stringify({ ...backupStatus(), lastChangedAt: new Date().toISOString() })); } catch { /* Model persistence has its own transaction and errors. */ } }
export async function getLocalStorageStatus() {
  let estimatedUsageBytes: number | null = null, estimatedQuotaBytes: number | null = null, persistent: boolean | null = null;
  try { const storage = globalThis.navigator?.storage; if (storage?.estimate) { const estimate = await storage.estimate(); estimatedUsageBytes = typeof estimate.usage === 'number' && Number.isFinite(estimate.usage) && estimate.usage >= 0 ? estimate.usage : null; estimatedQuotaBytes = typeof estimate.quota === 'number' && Number.isFinite(estimate.quota) && estimate.quota >= 0 ? estimate.quota : null; } if (storage?.persisted) persistent = await storage.persisted(); } catch { /* Browser-wide estimates are optional and no permission is requested. */ }
  let storageAvailable = false; try { const storage = localStorageSafe(); if (storage) { storage.getItem(BACKUP_KEY); storageAvailable = true; } } catch { /* Blocked settings are shown as unavailable. */ }
  const backup = backupStatus(); return { estimatedUsageBytes, estimatedQuotaBytes, persistent, storageAvailable, operationsCount: getLocalOperationLog().length, backup: { ...backup, reminder: backup.lastCreatedAt === null || backup.lastChangedAt !== null && backup.lastChangedAt > backup.lastCreatedAt } };
}

export interface WorkspaceBackup {
  format: 'calcweave-workspace'; version: 1; createdAt: string; engineVersion: string; model: CalcModel; history: HistoryRecord[];
  manifest: { modelSha256: string; historySha256: string; payloadSha256: string };
}
function backupManifest(model: CalcModel, history: HistoryRecord[], header: Pick<WorkspaceBackup, 'createdAt' | 'engineVersion'>): WorkspaceBackup['manifest'] {
  return { modelSha256: sha256(JSON.stringify(model)), historySha256: sha256(JSON.stringify(history)), payloadSha256: sha256(JSON.stringify({ format: 'calcweave-workspace', version: 1, createdAt: header.createdAt, engineVersion: header.engineVersion, model, history })) };
}
/** Backups retain complete portable models and whole history records; no compression, external references, preferences or diagnostics. */
export function createWorkspaceBackup(model: CalcModel, history: HistoryRecord[] = []): string {
  const snapshot = parseModel(model), records = validateRunHistory(history);
  const header = { createdAt: new Date().toISOString(), engineVersion: ENGINE_VERSION };
  const backup: WorkspaceBackup = { format: 'calcweave-workspace', version: 1, ...header, model: snapshot, history: records, manifest: backupManifest(snapshot, records, header) };
  const text = JSON.stringify(backup); if (byteLength(text) + 1 > WORKSPACE_BACKUP_LIMITS.bytes) error('WORKSPACE_BACKUP_TOO_LARGE', '작업 공간 백업은 전체 26 MiB 이하여야 합니다.'); return text + '\n';
}
export function parseWorkspaceBackup(text: string): WorkspaceBackup {
  if (typeof text !== 'string' || text.length > WORKSPACE_BACKUP_LIMITS.bytes || byteLength(text) > WORKSPACE_BACKUP_LIMITS.bytes) error('WORKSPACE_BACKUP_TOO_LARGE', '작업 공간 백업은 전체 26 MiB 이하여야 합니다.');
  let raw: unknown; try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { error('INVALID_WORKSPACE_BACKUP', 'JSON 백업 파일을 읽지 못했습니다. 현재 작업은 유지됩니다.'); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) error('INVALID_WORKSPACE_BACKUP', 'CalcWeave 작업 공간 백업 형식이 아닙니다.');
  const entry = raw as Record<string, unknown>;
  if (entry.format !== 'calcweave-workspace') error('INVALID_WORKSPACE_BACKUP', 'CalcWeave 작업 공간 백업 형식이 아닙니다.');
  if (entry.version !== 1) error('UNSUPPORTED_WORKSPACE_BACKUP', '지원하지 않는 백업 버전입니다. 현재 작업은 유지됩니다.');
  if (Object.keys(entry).sort().join(',') !== 'createdAt,engineVersion,format,history,manifest,model,version' || !iso(entry.createdAt) || typeof entry.engineVersion !== 'string' || !enginePattern.test(entry.engineVersion)) error('INVALID_WORKSPACE_BACKUP', '백업의 버전·생성 정보가 올바르지 않습니다.');
  const manifest = entry.manifest as Record<string, unknown>;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.keys(manifest).sort().join(',') !== 'historySha256,modelSha256,payloadSha256' || Object.values(manifest).some((hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) error('INVALID_WORKSPACE_BACKUP', '백업의 SHA-256 manifest가 올바르지 않습니다.');
  const model = parseModel(entry.model), history = validateRunHistory(entry.history), expected = backupManifest(model, history, { createdAt: entry.createdAt, engineVersion: entry.engineVersion });
  if (manifest.modelSha256 !== expected.modelSha256 || manifest.historySha256 !== expected.historySha256 || manifest.payloadSha256 !== expected.payloadSha256) error('WORKSPACE_BACKUP_HASH_MISMATCH', '백업 내용과 SHA-256 manifest가 다릅니다. 현재 작업은 유지됩니다.');
  return { format: 'calcweave-workspace', version: 1, createdAt: entry.createdAt, engineVersion: entry.engineVersion, model, history, manifest: expected };
}

/** Only CalcWeave-prefixed settings are removed. Browser/site settings and other origins are outside this API. */
export function clearCalcWeavePreferences(): void {
  try {
    for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
      if (!storage) continue; const keys: string[] = []; for (let index = 0; index < storage.length; index++) { const key = storage.key(index); if (key?.startsWith('calcweave.')) keys.push(key); }
      keys.forEach((key) => storage.removeItem(key));
    }
  } catch { error('LOCAL_PREFERENCES_CLEAR_FAILED', '브라우저 설정·로컬 진단 기록을 모두 지우지 못했습니다. 초기화를 다시 시도하세요.'); }
}
