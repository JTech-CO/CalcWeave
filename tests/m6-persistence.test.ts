import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createExample } from '../apps/web/src/examples';
import { compileModel } from '../packages/compiler/src';
import { createSubsystemFromSelection } from '../packages/compiler/src/hierarchy';
import { createExportManifest } from '../packages/codegen-ts/src';
import { runModel } from '../packages/runtime/src';
import { ENGINE_VERSION, ModelError } from '../packages/model/src';
import { createWorkspaceBackup, parseWorkspaceBackup, WORKSPACE_BACKUP_LIMITS, clearCalcWeavePreferences, clearLocalOperationLog, exportLocalOperationLog, getLocalOperationLog, getLocalStorageStatus, noteWorkspaceBackupCreated, noteWorkspaceChanged, recordLocalOperation } from '../apps/web/src/local-operations';
import type { HistoryRecord } from '../apps/web/src/run-history';

class MemoryStorage {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
/** The browser suite below uses real IndexedDB. This small unit double models ordered requests and transaction rollback for injected failures. */
class MemoryIndexedDB {
  readonly values = new Map<string, unknown>();
  readonly databases: { closed: boolean; onversionchange?: () => void }[] = [];
  failPutKey: string | undefined;
  synchronousPutFailure = false;
  blocked = false;
  blockedRequest?: { onsuccess?: () => void; onblocked?: () => void; result: unknown };
  open(): unknown {
    const connection = { closed: false, onversionchange: undefined as (() => void) | undefined, close() { this.closed = true; }, objectStoreNames: Object.assign(['models'], { contains: (name: string) => name === 'models' }), transaction: (_stores: unknown, mode: string) => this.transaction(mode) };
    this.databases.push(connection);
    const request = { result: connection, onsuccess: undefined as (() => void) | undefined, onblocked: undefined as (() => void) | undefined };
    queueMicrotask(() => { if (this.blocked) { this.blockedRequest = request; request.onblocked?.(); } else request.onsuccess?.(); }); return request;
  }
  transaction(mode: string): unknown {
    const next = new Map(this.values); let pending = 0, stopped = false;
    const transaction = { error: null as DOMException | null, oncomplete: undefined as (() => void) | undefined, onabort: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined,
      abort: () => { if (stopped) return; stopped = true; queueMicrotask(() => transaction.onabort?.()); }, objectStore: (_name: string) => store };
    const request = (operation: () => unknown): unknown => {
      pending++; const result = { result: undefined as unknown, onsuccess: undefined as (() => void) | undefined };
      queueMicrotask(() => {
        if (stopped) return;
        try { result.result = operation(); result.onsuccess?.(); }
        catch (error) { transaction.error = error as DOMException; stopped = true; transaction.onerror?.(); return; }
        pending--;
        if (!pending) queueMicrotask(() => { if (!stopped && !pending) { stopped = true; if (mode === 'readwrite') { this.values.clear(); next.forEach((value, key) => this.values.set(key, value)); } transaction.oncomplete?.(); } });
      }); return result;
    };
    const store = { transaction, get: (key: string) => request(() => structuredClone(next.get(key))), put: (value: unknown, key: string) => { if (this.synchronousPutFailure && this.failPutKey === key) throw new DOMException('Injected quota failure', 'QuotaExceededError'); return request(() => { if (this.failPutKey === key) throw new DOMException('Injected quota failure', 'QuotaExceededError'); next.set(key, structuredClone(value)); return key; }); }, clear: () => request(() => next.clear()) };
    return transaction;
  }
}
let storage: MemoryStorage, session: MemoryStorage, database: MemoryIndexedDB;
beforeEach(() => { storage = new MemoryStorage(); session = new MemoryStorage(); database = new MemoryIndexedDB(); vi.stubGlobal('localStorage', storage); vi.stubGlobal('sessionStorage', session); vi.stubGlobal('indexedDB', database); vi.resetModules(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function history(id = 'run-1'): Promise<HistoryRecord> {
  const compiled = compileModel(createExample('first-calculation')), manifest = await createExportManifest(compiled);
  return { id, label: '기록', createdAt: new Date().toISOString(), model: compiled.model, semanticHash: manifest.modelHash, engineVersion: manifest.engineVersion, manifest, result: await runModel(compiled), outputIds: compiled.outputIds, outputTypes: compiled.outputTypes };
}
const api = () => import('../apps/web/src/persistence');

describe('M6 portable workspace backup boundaries', () => {
  it('backs up all portable model components and whole recent runs with independent SHA-256 checks', async () => {
    const model = createSubsystemFromSelection(createExample('first-calculation'), ['gain'], '배율 모듈'); model.datasets = createExample('data-playback').datasets; model.dashboard = [{ id: 'readout', kind: 'display', title: '결과', nodeId: 'result' }]; model.notes = '<img src=x onerror=alert(1)> scientific notes';
    const records = [await history()], text = createWorkspaceBackup(model, records), backup = parseWorkspaceBackup(text), digest = (text: string) => createHash('sha256').update(text).digest('hex');
    expect(backup.model).toEqual(model); expect(backup.history).toEqual(records); expect(backup.manifest.modelSha256).toBe(digest(JSON.stringify(backup.model))); expect(backup.manifest.historySha256).toBe(digest(JSON.stringify(backup.history)));
    expect(backup.manifest.payloadSha256).toBe(digest(JSON.stringify({ format: backup.format, version: backup.version, createdAt: backup.createdAt, engineVersion: backup.engineVersion, model: backup.model, history: backup.history })));
    backup.model.name = 'edited'; backup.history[0]!.result.samples[0]!.values.result = 999; expect(model.name).not.toBe('edited'); expect(records[0]!.result.samples[0]!.values.result).toBe(6);
    expect(parseWorkspaceBackup('\uFEFF' + text).model.notes).toBe(model.notes); expect(text).not.toContain('calcweave.theme');
  });
  it('roundtrips structurally valid incomplete graphs without executing them', () => {
    const model = createExample('first-calculation'); model.edges = []; expect(parseWorkspaceBackup(createWorkspaceBackup(model)).model.edges).toEqual([]);
  });
  it.each(['model', 'history', 'header'] as const)('rejects altered %s payload content without trusting its manifest', async kind => {
    const raw = JSON.parse(createWorkspaceBackup(createExample('first-calculation'), [await history()]));
    if (kind === 'model') raw.model.name = 'altered'; else if (kind === 'history') raw.history[0].label = 'altered'; else raw.createdAt = '2000-01-01T00:00:00.000Z';
    expect(() => parseWorkspaceBackup(JSON.stringify(raw))).toThrowError(ModelError); try { parseWorkspaceBackup(JSON.stringify(raw)); } catch (error) { expect((error as ModelError).diagnostics[0]!.code).toBe('WORKSPACE_BACKUP_HASH_MISMATCH'); }
  });
  it('rejects unknown versions, extra headers, malformed JSON, excessive UTF8 input and more than five records', async () => {
    const text = createWorkspaceBackup(createExample('first-calculation')), raw = JSON.parse(text); raw.version = 2; expect(() => parseWorkspaceBackup(JSON.stringify(raw))).toThrow(/버전/);
    raw.version = 1; raw.unknown = 'field'; expect(() => parseWorkspaceBackup(JSON.stringify(raw))).toThrow(/생성 정보/); expect(() => parseWorkspaceBackup('{')).toThrow();
    expect(() => parseWorkspaceBackup('한'.repeat(Math.floor(WORKSPACE_BACKUP_LIMITS.bytes / 3) + 1))).toThrow(/26 MiB/);
    const record = await history(); expect(() => createWorkspaceBackup(createExample('first-calculation'), Array.from({ length: 6 }, (_value, index) => ({ ...record, id: `run-${index}` })))).toThrow(/개수/);
  });
  it('does not invoke getters or serialization callbacks in supplied models/history', async () => {
    const model = createExample('first-calculation'); let called = false; Object.defineProperty(model, 'name', { enumerable: true, get: () => { called = true; return 'unsafe'; } }); expect(() => createWorkspaceBackup(model)).toThrow(); expect(called).toBe(false);
    const record = await history(); Object.defineProperty(record, 'label', { enumerable: true, get: () => { called = true; return 'unsafe'; } }); expect(() => createWorkspaceBackup(createExample('first-calculation'), [record])).toThrow(); expect(called).toBe(false);
  });
});

describe('M6 local diagnostics and storage state', () => {
  it('keeps only the latest50 closed records and exports no free-form data', () => {
    for (let index = 0; index < 60; index++) expect(recordLocalOperation('STORAGE_WRITE_FAILED', 'storage')).toBe(true);
    const records = getLocalOperationLog(); expect(records).toHaveLength(50); records.forEach((record) => { expect(Object.keys(record).sort()).toEqual(['at', 'code', 'context', 'engineVersion']); expect(record.engineVersion).toBe(ENGINE_VERSION); });
    expect(recordLocalOperation('private@example.com' as never, 'storage')).toBe(false); expect(recordLocalOperation('STORAGE_READ_FAILED', 'https://private.example' as never)).toBe(false);
    const exported = exportLocalOperationLog(); expect(exported).not.toContain('private'); expect(JSON.parse(exported).records).toHaveLength(50); clearLocalOperationLog(); expect(getLocalOperationLog()).toEqual([]);
  });
  it('filters corrupted or extra-field diagnostic records before any download', () => {
    storage.setItem('calcweave.local-operations-v1', JSON.stringify([{ code: 'STORAGE_READ_FAILED', context: 'storage', at: new Date().toISOString(), engineVersion: ENGINE_VERSION, stack: 'secret-model' }, { code: 'secret-label', context: 'storage', at: new Date().toISOString(), engineVersion: ENGINE_VERSION }, { code: 'STORAGE_READ_FAILED', context: 'storage', at: new Date().toISOString(), engineVersion: '0.6.0-secret-model-name' }]));
    expect(getLocalOperationLog()).toEqual([]); expect(exportLocalOperationLog()).not.toContain('secret'); storage.setItem('calcweave.local-operations-v1', '{broken'); expect(getLocalOperationLog()).toEqual([]);
  });
  it('uses optional read-only browser estimates and manual backup reminders', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 123, quota: 456 }), persisted: async () => false } });
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-03T00:00:00.000Z')); expect((await getLocalStorageStatus()).backup.reminder).toBe(true); noteWorkspaceBackupCreated(); expect((await getLocalStorageStatus()).backup.reminder).toBe(false);
    vi.setSystemTime(new Date('2026-10-03T00:01:00.000Z')); noteWorkspaceChanged(); expect(await getLocalStorageStatus()).toMatchObject({ estimatedUsageBytes: 123, estimatedQuotaBytes: 456, persistent: false, backup: { reminder: true } });
  });
  it('handles unavailable storage without blocking model computations or recursively logging', async () => {
    vi.stubGlobal('localStorage', { getItem() { throw new DOMException('Denied', 'SecurityError'); }, setItem() { throw new DOMException('Denied', 'SecurityError'); } }); expect(recordLocalOperation('STORAGE_READ_FAILED', 'storage')).toBe(false); expect(getLocalOperationLog()).toEqual([]);
    vi.stubGlobal('navigator', { storage: { estimate: async () => { throw new Error('Denied'); } } }); expect(await getLocalStorageStatus()).toMatchObject({ estimatedUsageBytes: null, estimatedQuotaBytes: null });
  });
});

describe('M6 transactional persistence and recovery', () => {
  it('does not revise an unchanged graph during startup or emit an unnecessary backup reminder', async () => {
    const persistence = await api(), model = createExample('first-calculation'); await persistence.loadLocalModel(); await persistence.saveLocalModel(model); const before = structuredClone(database.values), status = await getLocalStorageStatus();
    await persistence.saveLocalModel(structuredClone(model)); expect(database.values).toEqual(before); expect((await getLocalStorageStatus()).backup.lastChangedAt).toBe(status.backup.lastChangedAt);
  });
  it('retains the previous valid graph and preserves a future-version original after a deliberate replacement', async () => {
    const persistence = await api(), initial = createExample('first-calculation'); expect(await persistence.loadLocalModel()).toBeNull(); await persistence.saveLocalModel(initial);
    const changed = { ...initial, name: 'changed' }; await persistence.saveLocalModel(changed); expect((await persistence.loadRecoverySnapshot()).checkpoint?.model).toEqual(initial);
    const future = { schemaVersion: 99, payload: '<script>literal source</script>' }; database.values.set('current', future); await expect(persistence.loadLocalModel()).rejects.toMatchObject({ name: 'ModelError' }); await persistence.saveLocalModel(changed);
    expect((await persistence.loadRecoverySnapshot()).original).toEqual(future); expect(JSON.parse(await persistence.recoverySlotText('recovery'))).toEqual(future);
    const details = await persistence.loadRecoveryDetails(); expect(details.slots.find((slot) => slot.slot === 'recovery')).toMatchObject({ status: 'unsupported', downloadable: true });
  });
  it('restores model and whole history in one transaction and saves unreadable originals in separate recovery slots', async () => {
    const persistence = await api(), original = createExample('first-calculation'); await persistence.loadLocalModel(); await persistence.saveLocalModel(original);
    database.values.set('current', { schemaVersion: 99 }); database.values.set('run-history-v1', { unsupported: true });
    const model = createExample('data-playback'), records = [await history()]; await persistence.restoreWorkspaceBackup(createWorkspaceBackup(model, records));
    expect(await persistence.loadLocalModel()).toEqual(model); expect(await persistence.loadRunHistory()).toEqual(records); expect(database.values.get('recovery')).toEqual({ schemaVersion: 99 }); expect(JSON.parse(await persistence.recoverySlotText('run-history-recovery-v1'))).toEqual({ unsupported: true });
  });
  it('rejects bad backup/hash/shape before touching current model, history or recovery slots', async () => {
    const persistence = await api(); await persistence.loadLocalModel(); await persistence.saveLocalModel(createExample('first-calculation')); await persistence.saveRunHistory([await history()]);
    const before = structuredClone(database.values), raw = JSON.parse(createWorkspaceBackup(createExample('data-playback'))); raw.model.name = 'invalid hash';
    await expect(persistence.restoreWorkspaceBackup(JSON.stringify(raw))).rejects.toMatchObject({ diagnostics: [{ code: 'WORKSPACE_BACKUP_HASH_MISMATCH' }] }); expect(database.values).toEqual(before);
    await expect(persistence.restoreWorkspaceBackup('{')).rejects.toMatchObject({ name: 'ModelError' }); expect(database.values).toEqual(before);
  });
  it('rolls back current/history/checkpoint/meta together when the second backup write hits quota', async () => {
    const persistence = await api(); await persistence.loadLocalModel(); await persistence.saveLocalModel(createExample('first-calculation')); await persistence.saveRunHistory([await history()]); const before = structuredClone(database.values);
    database.failPutKey = 'run-history-v1'; await expect(persistence.restoreWorkspaceBackup(createWorkspaceBackup(createExample('data-playback')))).rejects.toMatchObject({ diagnostics: [{ code: 'LOCAL_STORAGE_QUOTA' }] }); expect(database.values).toEqual(before); expect(getLocalOperationLog().at(-1)?.code).toBe('STORAGE_QUOTA_EXCEEDED');
  });
  it('normalizes synchronous quota failures without leaking native exception text or partially changing the database', async () => {
    const persistence = await api(); await persistence.loadLocalModel(); await persistence.saveLocalModel(createExample('first-calculation')); const before = structuredClone(database.values); database.synchronousPutFailure = true; database.failPutKey = 'run-history-v1';
    await expect(persistence.restoreWorkspaceBackup(createWorkspaceBackup(createExample('data-playback')))).rejects.toMatchObject({ name: 'ModelError', diagnostics: [{ code: 'LOCAL_STORAGE_QUOTA' }] }); expect(database.values).toEqual(before); expect(getLocalOperationLog().at(-1)?.code).toBe('STORAGE_QUOTA_EXCEEDED'); expect(exportLocalOperationLog()).not.toContain('Injected');
  });
  it('detects another-tab revision without overwriting either graph or history', async () => {
    const persistence = await api(); await persistence.loadLocalModel(); await persistence.saveLocalModel(createExample('first-calculation')); database.values.set('workspace-revision-v1', crypto.randomUUID()); const before = structuredClone(database.values);
    await expect(persistence.saveLocalModel(createExample('data-playback'))).rejects.toMatchObject({ diagnostics: [{ code: 'LOCAL_SAVE_CONFLICT' }] }); expect(database.values).toEqual(before);
    await expect(persistence.saveRunHistory([])).rejects.toMatchObject({ diagnostics: [{ code: 'LOCAL_SAVE_CONFLICT' }] }); expect(database.values).toEqual(before);
  });
  it('checks the revision captured during backup preview and serializes same-tab writes without conflicts', async () => {
    const persistence = await api(); await persistence.loadLocalModel(); await persistence.saveLocalModel(createExample('first-calculation')); const details = await persistence.loadRecoveryDetails();
    await Promise.all([persistence.saveLocalModel(createExample('data-playback')), persistence.saveRunHistory([await history()])]); await persistence.waitForLocalWrites();
    const before = structuredClone(database.values); await expect(persistence.restoreWorkspaceBackup(createWorkspaceBackup(createExample('first-calculation')), { expectedRevision: details.revision })).rejects.toMatchObject({ diagnostics: [{ code: 'LOCAL_SAVE_CONFLICT' }] }); expect(database.values).toEqual(before);
  });
  it('does not overwrite unreadable history during ordinary saves', async () => {
    const persistence = await api(); await persistence.loadLocalModel(); database.values.set('run-history-v1', { future: 2 }); const before = structuredClone(database.values); await expect(persistence.saveRunHistory([])).rejects.toMatchObject({ name: 'ModelError' }); expect(database.values).toEqual(before);
  });
  it('rejects absent/unsafe recovery text while preserving the stored raw object', async () => {
    const persistence = await api(); await expect(persistence.recoverySlotText('current')).rejects.toMatchObject({ diagnostics: [{ code: 'EMPTY_RECOVERY_SLOT' }] }); await expect(persistence.recoverySlotText('arbitrary' as never)).rejects.toMatchObject({ diagnostics: [{ code: 'INVALID_RECOVERY_SLOT' }] });
    const cyclic: unknown[] = []; cyclic.push(cyclic); database.values.set('recovery', cyclic); await expect(persistence.recoverySlotText('recovery')).rejects.toMatchObject({ diagnostics: [{ code: 'RECOVERY_TEXT_UNAVAILABLE' }] }); expect(database.values.get('recovery')).toBe(cyclic);
  });
  it('closes a connection which succeeds after blocked rejection and closes on version changes', async () => {
    const persistence = await api(); database.blocked = true; await expect(persistence.loadLocalModel()).rejects.toMatchObject({ diagnostics: [{ code: 'LOCAL_STORAGE_BLOCKED' }] }); database.blockedRequest!.onsuccess?.(); expect(database.databases[0]!.closed).toBe(true);
    database.blocked = false; await persistence.loadLocalModel(); const connection = database.databases.at(-1)!; connection.closed = false; connection.onversionchange?.(); expect(connection.closed).toBe(true); expect(getLocalOperationLog().at(-1)?.code).toBe('STORAGE_VERSION_CHANGED');
  });
  it('clears every CalcWeave store entry and local/session preference while preserving unrelated origin keys', async () => {
    const persistence = await api(); await persistence.loadLocalModel(); await persistence.saveLocalModel(createExample('first-calculation')); database.values.set('unknown-future-meta', { extra: true }); database.values.set('run-history-recovery-v1', { broken: true });
    storage.setItem('calcweave.theme', 'light'); storage.setItem('unrelated', 'keep'); session.setItem('calcweave.pending', 'remove'); session.setItem('another-app', 'keep'); recordLocalOperation('STORAGE_READ_FAILED', 'storage');
    await persistence.resetLocalWorkspace(); expect(database.values.size).toBe(0); expect([...storage.values.entries()]).toEqual([['unrelated', 'keep']]); expect([...session.values.entries()]).toEqual([['another-app', 'keep']]); expect(await persistence.loadLocalModel()).toBeNull();
  });
  it('checks reset revision in the same transaction and preserves both database and preferences on a stale-tab conflict', async () => {
    const persistence = await api(); await persistence.loadLocalModel(); await persistence.saveLocalModel(createExample('first-calculation')); database.values.set('workspace-revision-v1', crypto.randomUUID()); storage.setItem('calcweave.theme', 'light'); const before = structuredClone(database.values);
    await expect(persistence.resetLocalWorkspace()).rejects.toMatchObject({ diagnostics: [{ code: 'LOCAL_SAVE_CONFLICT' }] }); expect(database.values).toEqual(before); expect(storage.getItem('calcweave.theme')).toBe('light');
  });
  it('allows an explicit reset or verified restore of damaged revision metadata while retaining a fingerprint CAS boundary', async () => {
    const persistence = await api(); database.values.set('current', createExample('first-calculation')); database.values.set('workspace-revision-v1', { damaged: true }); await expect(persistence.loadLocalModel()).rejects.toMatchObject({ diagnostics: [{ code: 'INVALID_LOCAL_METADATA' }] });
    const details = await persistence.loadRecoveryDetails(); expect(details.revision).toMatch(/^invalid-[a-f0-9]{64}$/); expect(details.slots.find((slot) => slot.slot === 'current')!.downloadable).toBe(true);
    await persistence.restoreWorkspaceBackup(createWorkspaceBackup(createExample('data-playback')), { expectedRevision: details.revision }); expect((await persistence.loadLocalModel())!.modelId).toBe('data-playback');
    database.values.set('workspace-revision-v1', { damaged: 'again' }); await expect(persistence.loadLocalModel()).rejects.toMatchObject({ diagnostics: [{ code: 'INVALID_LOCAL_METADATA' }] }); await persistence.resetLocalWorkspace(); expect(database.values.size).toBe(0);
  });
  it('reports preference removal failure after database reset without falsely claiming cross-storage atomicity', async () => {
    const persistence = await api(); await persistence.loadLocalModel(); await persistence.saveLocalModel(createExample('first-calculation')); storage.setItem('calcweave.theme', 'dark'); vi.spyOn(storage, 'removeItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    await expect(persistence.resetLocalWorkspace()).rejects.toMatchObject({ diagnostics: [{ code: 'LOCAL_PREFERENCES_CLEAR_FAILED' }] }); expect(database.values.size).toBe(0); expect(storage.getItem('calcweave.theme')).toBe('dark');
  });
  it('clears only CalcWeave preferences when used independently of the database reset', () => { storage.setItem('calcweave.theme', 'dark'); storage.setItem('other', 'keep'); clearCalcWeavePreferences(); expect([...storage.values.entries()]).toEqual([['other', 'keep']]); });
});
