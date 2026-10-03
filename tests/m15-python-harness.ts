import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPythonExportManifest, exportPython, type PythonTarget, PYTHON_TARGET } from '../packages/codegen-python/src';
import { ModelError, type CompiledModel, type RunResult } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';

export const M15_PYTHON_EXECUTABLE = process.env.CALCWEAVE_PYTHON_PATH ?? 'python';
export const M15_PYTHON_VERSION = spawnSync(M15_PYTHON_EXECUTABLE, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
export interface M15PythonOutcome { manifest?: ReturnType<typeof createPythonExportManifest>; result?: Omit<RunResult,'elapsedMs'>; error?: { name: string; diagnostics: ModelError['diagnostics']; partialResult?: Omit<RunResult,'elapsedMs'> }; [key: string]: unknown }
export function m15Compare(actual: unknown, expected: unknown, path = 'value'): void {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', path); const value = actual as number;
    if (expected === 0) assert(Object.is(value, expected), `${path} signed zero`);
    else assert(Number.isFinite(value) && Math.abs(value - expected) <= 2e-12 * Math.max(1, Math.abs(expected)), `${path}: ${value} vs ${expected}`);
  } else if (Array.isArray(expected)) {
    assert(Array.isArray(actual), path); assert.equal(actual.length, expected.length, path); expected.forEach((value,index) => m15Compare(actual[index], value, `${path}[${index}]`));
  } else if (expected && typeof expected === 'object') {
    assert(actual && typeof actual === 'object' && !Array.isArray(actual), path); assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), path);
    Object.entries(expected).forEach(([key,value]) => m15Compare((actual as Record<string,unknown>)[key], value, `${path}.${key}`));
  } else assert.equal(actual, expected, path);
}
export function m15Portable(result: RunResult | Omit<RunResult,'elapsedMs'>): Omit<RunResult,'elapsedMs'> { const { elapsedMs: _elapsed, ...portable } = result as RunResult; return portable; }
export async function m15Execute(compiled: CompiledModel, options: { target?: PythonTarget; source?: string; harness?: string } = {}): Promise<M15PythonOutcome> {
  assert.match(M15_PYTHON_VERSION, /^Python 3\.14\./, 'M15 approval requires actual Python 3.14; no mocked fallback.');
  const directory = await mkdtemp(join(tmpdir(), 'calcweave-m15-python-'));
  try {
    const model = join(directory, 'model.py'), runner = join(directory,'check.py');
    await writeFile(model, options.source ?? exportPython(compiled, undefined, options.target ?? PYTHON_TARGET));
    if (options.harness) await writeFile(runner, options.harness);
    const result = spawnSync(M15_PYTHON_EXECUTABLE, ['-I','-B', options.harness ? runner : model], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
    assert(!result.error, String(result.error)); assert([0,1].includes(result.status ?? -1), result.stderr); const outcome = JSON.parse(result.stdout) as M15PythonOutcome;
    assert.equal(result.status, outcome.error ? 1 : 0, result.stderr); return outcome;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export async function m15NativeOutcome(compiled: CompiledModel): Promise<M15PythonOutcome> {
  try { return { result: m15Portable(await runModel(compiled)) }; }
  catch (error) { assert(error instanceof ModelError); return { error: { name: 'ModelError', diagnostics: error.diagnostics, ...(error.partialResult ? { partialResult: m15Portable(error.partialResult) } : {}) } }; }
}
export function m15Diagnostics(error: M15PythonOutcome['error']) { return error?.diagnostics.map(({code,nodeId,tick,time}) => ({ code, ...(nodeId === undefined ? {} : {nodeId}), ...(tick === undefined ? {} : {tick}), ...(time === undefined ? {} : {time}) })); }
