import { ModelError, parseModel, serializeModel } from '../../../packages/model/src';
import type { CalcModel } from '../../../packages/model/src/types';
import { sha256 } from '../../../packages/model/src/sha256';
import { validateRunHistory, type HistoryRecord } from './run-history';
import { clearCalcWeavePreferences, noteWorkspaceChanged, parseWorkspaceBackup, recordLocalOperation, WORKSPACE_BACKUP_LIMITS, type LocalOperationCode, type LocalOperationContext } from './local-operations';
export { createWorkspaceBackup, parseWorkspaceBackup, WORKSPACE_BACKUP_LIMITS, type WorkspaceBackup } from './local-operations';

export const LOCAL_DATABASE = 'calcweave-m0';
export const LOCAL_STORE = 'models';
const CURRENT = 'current', RECOVERY = 'recovery', CHECKPOINT = 'previous-valid', RUN_HISTORY = 'run-history-v1', HISTORY_RECOVERY = 'run-history-recovery-v1', REVISION = 'workspace-revision-v1';
const EMPTY_REVISION = 'empty';
export type RecoverySlot = typeof CURRENT | typeof RECOVERY | typeof CHECKPOINT | typeof RUN_HISTORY | typeof HISTORY_RECOVERY;
const RECOVERY_SLOTS: RecoverySlot[] = [CURRENT, CHECKPOINT, RECOVERY, RUN_HISTORY, HISTORY_RECOVERY];
export interface RecoverySnapshot { checkpoint: { model: CalcModel; savedAt: string } | null; original: unknown | null }
export interface RecoverySlotDetail { slot: RecoverySlot; kind: 'model' | 'history'; status: 'empty' | 'valid' | 'invalid' | 'unsupported'; bytes: number | null; downloadable: boolean }
export interface RecoveryDetails extends RecoverySnapshot { revision: string; slots: RecoverySlotDetail[] }
export interface PersistenceOptions { expectedRevision?: string }
export type LocalWorkspaceEvent = 'saved' | 'restored' | 'reset';
let observedRevision: string | undefined;
let writes: Promise<void> = Promise.resolve();
const listeners = new Set<(event: LocalWorkspaceEvent) => void>();
let channel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
  try {
    channel = new BroadcastChannel('calcweave-local-workspace-v1');
    channel.onmessage = (event: MessageEvent<unknown>) => {
      if (!['saved', 'restored', 'reset'].includes(event.data as string)) return;
      observedRevision = 'stale'; listeners.forEach((listener) => listener(event.data as LocalWorkspaceEvent));
    };
    window.addEventListener('pagehide', () => { channel?.close(); channel = null; }, { once: true });
  } catch { /* IndexedDB revision checks remain available without cross-tab notifications. */ }
}
export function subscribeLocalWorkspace(listener: (event: LocalWorkspaceEvent) => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(event: LocalWorkspaceEvent): void { try { channel?.postMessage(event); } catch { /* The transaction revision is authoritative. */ } }
function failure(code: string, message: string, log: LocalOperationCode, context: LocalOperationContext): ModelError { recordLocalOperation(log, context); return new ModelError([{ code, message }]); }
function transactionFailure(transaction: IDBTransaction, context: LocalOperationContext): ModelError {
  return transaction.error?.name === 'QuotaExceededError'
    ? failure('LOCAL_STORAGE_QUOTA', '브라우저 저장 공간이 부족합니다. 작업 공간 백업을 다운로드해 보관하세요.', 'STORAGE_QUOTA_EXCEEDED', context)
    : failure('LOCAL_STORAGE_TRANSACTION', '브라우저 저장을 완료하지 못했습니다. 기존 저장본은 유지됩니다.', 'STORAGE_ABORTED', context);
}
function revisionValue(raw: unknown): string {
  if (raw === undefined) return EMPTY_REVISION;
  if (typeof raw !== 'string' || !/^[a-f0-9-]{36}$/.test(raw)) throw failure('INVALID_LOCAL_METADATA', '저장 revision을 읽지 못했습니다. 복구본을 확인하거나 로컬 초기화를 사용하세요.', 'STORAGE_READ_FAILED', 'storage');
  return raw;
}
function revisionFingerprint(raw: unknown): string { try { return revisionValue(raw); } catch { return 'invalid-' + sha256(rawText(raw)); } }
function newRevision(): string { return crypto.randomUUID(); }
function expectRevision(actual: string, options: PersistenceOptions): void {
  const expected = options.expectedRevision ?? observedRevision;
  if (expected !== undefined && expected !== actual) throw failure('LOCAL_SAVE_CONFLICT', '다른 탭에서 저장 공간을 변경했습니다. 현재 모델을 백업하고 새로고침한 뒤 다시 시도하세요.', 'STORAGE_CONFLICT', 'storage');
}
function enqueue<T>(operation: () => Promise<T>): Promise<T> { const pending = writes.then(operation, operation); writes = pending.then(() => undefined, () => undefined); return pending; }
export async function waitForLocalWrites(): Promise<void> { await writes; }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const rejectOnce = (error: ModelError): void => { if (!settled) { settled = true; reject(error); } };
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(LOCAL_DATABASE, 1); }
    catch { rejectOnce(failure('LOCAL_STORAGE_OPEN', '브라우저 저장 공간에 접근하지 못했습니다. 백업 파일을 별도로 보관하세요.', 'STORAGE_OPEN_FAILED', 'storage')); return; }
    request.onupgradeneeded = () => { if (settled) { request.transaction?.abort(); return; } if (!request.result.objectStoreNames.contains(LOCAL_STORE)) request.result.createObjectStore(LOCAL_STORE); };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) { database.close(); return; }
      settled = true;
      database.onversionchange = () => { database.close(); observedRevision = 'stale'; recordLocalOperation('STORAGE_VERSION_CHANGED', 'storage'); listeners.forEach((listener) => listener('reset')); };
      resolve(database);
    };
    request.onerror = () => rejectOnce(failure('LOCAL_STORAGE_OPEN', '브라우저 저장 공간을 열지 못했습니다. 다른 버전의 탭을 닫고 백업·복구를 확인하세요.', 'STORAGE_OPEN_FAILED', 'storage'));
    request.onblocked = () => rejectOnce(failure('LOCAL_STORAGE_BLOCKED', '다른 탭이 저장 공간 변경을 막고 있습니다. 그 탭을 닫은 뒤 다시 시도하세요.', 'STORAGE_BLOCKED', 'storage'));
  });
}
async function readEntries(keys: string[]): Promise<Record<string, unknown>> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(LOCAL_STORE, 'readonly'), store = transaction.objectStore(LOCAL_STORE), result: Record<string, unknown> = Object.create(null);
      keys.forEach((key) => { const request = store.get(key); request.onsuccess = () => { result[key] = request.result; }; });
      transaction.oncomplete = () => resolve(result); transaction.onerror = () => reject(transactionFailure(transaction, 'storage')); transaction.onabort = () => reject(transactionFailure(transaction, 'storage'));
    });
  } finally { database.close(); }
}
async function writeTransaction<T>(context: LocalOperationContext, options: PersistenceOptions, action: (store: IDBObjectStore, nextRevision: string) => T): Promise<T> {
    const database = await openDatabase();
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(LOCAL_STORE, 'readwrite'), store = transaction.objectStore(LOCAL_STORE), nextRevision = newRevision(); let result: T; let actionError: unknown;
        const previousRevision = store.get(REVISION);
        previousRevision.onsuccess = () => {
          try { expectRevision(context === 'backup' ? revisionFingerprint(previousRevision.result) : revisionValue(previousRevision.result), options); result = action(store, nextRevision); store.put(nextRevision, REVISION); }
          catch (error) { actionError = error instanceof ModelError ? error : error instanceof DOMException && error.name === 'QuotaExceededError' ? failure('LOCAL_STORAGE_QUOTA', '브라우저 저장 공간이 부족합니다. 백업 파일을 별도로 보관하세요.', 'STORAGE_QUOTA_EXCEEDED', context) : transactionFailure(transaction, context); transaction.abort(); }
        };
        transaction.oncomplete = () => { observedRevision = nextRevision; noteWorkspaceChanged(); publish('saved'); resolve(result!); };
        transaction.onerror = () => reject(actionError ?? transactionFailure(transaction, context)); transaction.onabort = () => reject(actionError ?? transactionFailure(transaction, context));
      });
    } finally { database.close(); }
}
function writable<T>(context: LocalOperationContext, options: PersistenceOptions, action: (store: IDBObjectStore, nextRevision: string) => T): Promise<T> { return enqueue(() => writeTransaction(context, options, action)); }
function preservePreviousModel(store: IDBObjectStore, next: CalcModel): void {
  const previous = store.get(CURRENT);
  previous.onsuccess = () => {
    if (previous.result === undefined) return;
    try { const model = parseModel(previous.result); if (serializeModel(model) !== serializeModel(next)) store.put({ model, savedAt: new Date().toISOString() }, CHECKPOINT); }
    catch { store.put(previous.result, RECOVERY); }
  };
}

export async function loadLocalModel(): Promise<CalcModel | null> {
  const entries = await readEntries([CURRENT, REVISION]); observedRevision = revisionFingerprint(entries[REVISION]); revisionValue(entries[REVISION]);
  try { return entries[CURRENT] === undefined ? null : parseModel(entries[CURRENT]); }
  catch (error) { recordLocalOperation('INVALID_LOCAL_MODEL', 'storage'); throw error; }
}
export async function saveLocalModel(model: CalcModel, options: PersistenceOptions = {}): Promise<void> {
  const snapshot: CalcModel = JSON.parse(serializeModel(model));
  await enqueue(async () => {
    const entries = await readEntries([CURRENT, REVISION]), revision = revisionValue(entries[REVISION]); expectRevision(revision, options);
    try { if (entries[CURRENT] !== undefined && serializeModel(parseModel(entries[CURRENT])) === serializeModel(snapshot)) return; } catch { /* An unreadable original is preserved during the write below. */ }
    await writeTransaction('storage', options, (store) => { preservePreviousModel(store, snapshot); store.put(snapshot, CURRENT); });
  });
}
export async function loadRunHistory(): Promise<HistoryRecord[]> {
  const entries = await readEntries([RUN_HISTORY]);
  try { return validateRunHistory(entries[RUN_HISTORY] ?? []); } catch (error) { recordLocalOperation('INVALID_LOCAL_HISTORY', 'history'); throw error; }
}
export async function saveRunHistory(records: HistoryRecord[], options: PersistenceOptions = {}): Promise<void> {
  const snapshot = validateRunHistory(records);
  await writable('history', options, (store) => {
    const previous = store.get(RUN_HISTORY);
    previous.onsuccess = () => { try { if (previous.result !== undefined) validateRunHistory(previous.result); store.put(snapshot, RUN_HISTORY); } catch { recordLocalOperation('INVALID_LOCAL_HISTORY', 'history'); store.transaction.abort(); } };
  });
}
export async function loadRawRunHistory(): Promise<unknown> { return (await readEntries([RUN_HISTORY]))[RUN_HISTORY] ?? []; }

function recoverySnapshot(entries: Record<string, unknown>): RecoverySnapshot {
  let checkpoint: RecoverySnapshot['checkpoint'] = null;
  const entry = entries[CHECKPOINT];
  if (entry && typeof entry === 'object' && 'model' in entry && 'savedAt' in entry) { try { checkpoint = { model: parseModel(entry.model), savedAt: typeof entry.savedAt === 'string' ? entry.savedAt.slice(0, 64) : '' }; } catch { /* A damaged checkpoint never becomes an active model. */ } }
  let original: unknown | null = entries[RECOVERY] ?? null;
  if (entries[CURRENT] !== undefined) { try { parseModel(entries[CURRENT]); } catch { original = entries[CURRENT]; } }
  return { checkpoint, original };
}
export async function loadRecoverySnapshot(): Promise<RecoverySnapshot> { return recoverySnapshot(await readEntries(RECOVERY_SLOTS)); }
/** Raw recovery data is serialized only as bounded plain JSON text, never rendered as HTML or executed. */
function rawText(raw: unknown): string {
  let count = 0, bytes = 0; const active = new Set<object>();
  const charge = (text: string): void => { if (text.length > WORKSPACE_BACKUP_LIMITS.bytes) throw new Error('size'); bytes += new TextEncoder().encode(text).length; if (bytes > WORKSPACE_BACKUP_LIMITS.bytes) throw new Error('size'); };
  const walk = (value: unknown, depth: number): void => {
    if (++count > 3_000_000 || depth > 40) throw new Error('structure');
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) { charge(JSON.stringify(value)); return; }
    if (typeof value === 'string') { charge(value); return; }
    if (!value || typeof value !== 'object' || active.has(value) || Object.getOwnPropertySymbols(value).length) throw new Error('JSON');
    const prototype = Object.getPrototypeOf(value); if (![Object.prototype, Array.prototype, null].includes(prototype)) throw new Error('prototype'); active.add(value);
    charge('{}');
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) { if (Array.isArray(value) && key === 'length') continue; if (!('value' in descriptor) || !descriptor.enumerable) throw new Error('descriptor'); if (!Array.isArray(value)) charge(key); walk(descriptor.value, depth + 1); } active.delete(value);
  };
  try { walk(raw, 0); const text = JSON.stringify(raw); if (text.length + 1 > WORKSPACE_BACKUP_LIMITS.bytes || new TextEncoder().encode(text).length + 1 > WORKSPACE_BACKUP_LIMITS.bytes) throw new Error('size'); return text + '\n'; }
  catch { throw failure('RECOVERY_TEXT_UNAVAILABLE', '원본은 브라우저에 유지됩니다. 안전한 JSON 텍스트로 내려받을 수 없는 형식·크기입니다.', 'STORAGE_READ_FAILED', 'recovery'); }
}
export async function recoverySlotText(slot: RecoverySlot): Promise<string> {
  if (!RECOVERY_SLOTS.includes(slot)) throw failure('INVALID_RECOVERY_SLOT', '지원하는 복구 슬롯을 선택하세요.', 'STORAGE_READ_FAILED', 'recovery');
  const entries = await readEntries([slot]); if (entries[slot] === undefined) throw failure('EMPTY_RECOVERY_SLOT', '이 복구 슬롯은 비어 있습니다.', 'STORAGE_READ_FAILED', 'recovery'); return rawText(entries[slot]);
}
export async function loadRecoveryDetails(): Promise<RecoveryDetails> {
  const entries = await readEntries([...RECOVERY_SLOTS, REVISION]);
  const slots: RecoverySlotDetail[] = RECOVERY_SLOTS.map((slot) => {
    const raw = entries[slot], kind = slot.startsWith('run-history') ? 'history' : 'model'; let status: RecoverySlotDetail['status'] = raw === undefined ? 'empty' : 'valid', bytes: number | null = null, downloadable = false;
    if (raw !== undefined) {
      try { const text = rawText(raw); bytes = new TextEncoder().encode(text).length; downloadable = true; } catch { /* Preserve data which cannot be safely serialized. */ }
      try { if (kind === 'history') validateRunHistory(raw); else parseModel(slot === CHECKPOINT && raw && typeof raw === 'object' && 'model' in raw ? raw.model : raw); }
      catch { status = raw && typeof raw === 'object' && 'schemaVersion' in raw && raw.schemaVersion !== 1 ? 'unsupported' : 'invalid'; }
    }
    return { slot, kind, status, bytes, downloadable };
  });
  return { ...recoverySnapshot(entries), revision: revisionFingerprint(entries[REVISION]), slots };
}

export async function restoreWorkspaceBackup(text: string, options: PersistenceOptions = {}): Promise<{ model: CalcModel; history: HistoryRecord[] }> {
  let backup: ReturnType<typeof parseWorkspaceBackup>;
  try { backup = parseWorkspaceBackup(text); } catch (error) { recordLocalOperation('WORKSPACE_BACKUP_INVALID', 'backup'); throw error; }
  await writable('backup', options, (store) => {
    preservePreviousModel(store, backup.model);
    const previousHistory = store.get(RUN_HISTORY); previousHistory.onsuccess = () => { if (previousHistory.result !== undefined) { try { validateRunHistory(previousHistory.result); } catch { store.put(previousHistory.result, HISTORY_RECOVERY); } } };
    store.put(backup.model, CURRENT); store.put(backup.history, RUN_HISTORY);
  });
  publish('restored'); return { model: backup.model, history: backup.history };
}
/** Must only be called by the UI's explicit two-step reset. Browser transactions cannot atomically clear local/sessionStorage too. */
export async function resetLocalWorkspace(options: PersistenceOptions = {}): Promise<void> {
  await enqueue(async () => {
    const database = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const names = Array.from(database.objectStoreNames), transaction = database.transaction(names, 'readwrite'); let actionError: unknown;
        const revision = transaction.objectStore(LOCAL_STORE).get(REVISION);
        revision.onsuccess = () => { try { expectRevision(revisionFingerprint(revision.result), options); names.forEach((name) => transaction.objectStore(name).clear()); } catch (error) { actionError = error; transaction.abort(); } };
        transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(actionError ?? transactionFailure(transaction, 'reset')); transaction.onabort = () => reject(actionError ?? transactionFailure(transaction, 'reset'));
      });
      observedRevision = EMPTY_REVISION; publish('reset'); clearCalcWeavePreferences();
    } catch (error) { recordLocalOperation('LOCAL_RESET_FAILED', 'reset'); throw error; }
    finally { database.close(); }
  });
}
