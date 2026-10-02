import { describe, expect, it, vi } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { inspectModelImport, MODEL_IMPORT_LIMITS } from '../packages/interop/src';
import { MODEL_LIMITS, type CalcModel } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';

const model = (): CalcModel => ({ schemaVersion: 1, modelId: 'native_import', name: '원본 도식',
  nodes: [{ id: 'source', blockType: 'source.constant', blockVersion: 1, label: '상수', parameters: { value: 3 } }, { id: 'result', blockType: 'sink.display', blockVersion: 1, label: '결과', parameters: {} }],
  edges: [{ id: 'connection', source: { nodeId: 'source', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }],
  execution: { mode: 'static', startTime: 0, stopTime: 1, step: 0.1 }, layout: {},
});

describe('M7 native import inspection with truthful unsupported conversion stages', () => {
  it('parses and compiles native JSON without claiming foreign conversion', async () => {
    const source = model(), text = JSON.stringify(source), inspection = inspectModelImport(text);
    expect(inspection).toEqual({ parsed: true, converted: false, executable: true, model: source, diagnostics: [], format: 'calcweave' });
    expect((await runModel(compileModel(inspection.model))).samples[0]!.values.result).toBe(3);
    inspection.model!.nodes[0]!.parameters.value = 100;
    expect(source.nodes[0]!.parameters.value).toBe(3); expect(inspectModelImport(text).model!.nodes[0]!.parameters.value).toBe(3);
  });

  it('retains structurally valid but incomplete native models for repair', () => {
    const source = model(); source.edges = []; const snapshot = JSON.stringify(source);
    const inspection = inspectModelImport(snapshot);
    expect(inspection).toMatchObject({ parsed: true, converted: false, executable: false, model: source, format: 'calcweave' });
    expect(inspection.diagnostics).toContainEqual(expect.objectContaining({ code: 'REQUIRED_INPUT_MISSING', nodeId: 'result' }));
    expect(JSON.stringify(source)).toBe(snapshot);
  });

  it('rejects unknown native blocks with semantic diagnostics and never registers them', () => {
    const source = model(); source.nodes[0]!.blockType = 'foreign.script';
    const inspected = inspectModelImport(JSON.stringify(source));
    expect(inspected.model).toEqual(source); expect(inspected.executable).toBe(false);
    expect(inspected.diagnostics.some((entry) => entry.code === 'UNKNOWN_BLOCK')).toBe(true);
  });

  it.each(['<Model><Block type="Gain" /></Model>', 'invalid json', '', 'function model() {}'])('does not claim to parse, convert or execute non-JSON input', (text) => {
    expect(inspectModelImport(text)).toMatchObject({ parsed: false, converted: false, executable: false, format: 'unknown' });
    expect(inspectModelImport(text).model).toBeUndefined();
  });

  it.each([{ blocks: [], name: 'Simulink' }, { format: 'foreign', nodes: [] }, [1, 2], null, 'foreign'])('parses JSON syntax but does not convert a foreign value %j', (value) => {
    const inspected = inspectModelImport(JSON.stringify(value));
    expect(inspected).toMatchObject({ parsed: true, converted: false, executable: false, format: 'unknown' });
    expect(inspected.model).toBeUndefined(); expect(inspected.diagnostics[0]!.code).toBe('IMPORT_FORMAT_UNSUPPORTED');
  });

  it('separates native JSON parsing from schema rejection without dropping future/unknown fields', () => {
    const source = model();
    for (const value of [{ ...source, schemaVersion: 2 }, { ...source, code: 'unused' }, { schemaVersion: 1, modelId: 'native' }]) {
      const inspection = inspectModelImport(JSON.stringify(value));
      expect(inspection).toMatchObject({ parsed: true, converted: false, executable: false, format: 'calcweave' });
      expect(inspection.model).toBeUndefined(); expect(inspection.diagnostics.some((entry) => entry.code === 'INVALID_MODEL')).toBe(true);
    }
  });

  it('blocks unsafe fields and model limits while retaining controlled diagnostics', () => {
    const source = model();
    const unsafe = JSON.stringify(source).replace('{', '{"__proto__":{},');
    expect(inspectModelImport(unsafe).diagnostics[0]!.code).toBe('UNSAFE_FIELD');
    source.nodes = Array.from({ length: MODEL_LIMITS.maxNodes + 1 }, (_, index) => ({ id: `node${index}`, blockType: 'annotation.note', blockVersion: 1, label: '메모', parameters: {} }));
    expect(inspectModelImport(JSON.stringify(source)).model).toBeUndefined();
  });

  it('bounds UTF-8 size and nesting before a parse or compile attempt', () => {
    expect(inspectModelImport(' '.repeat(MODEL_IMPORT_LIMITS.maxBytes + 1))).toMatchObject({ parsed: false, executable: false, diagnostics: [{ code: 'MODEL_TOO_LARGE', message: expect.any(String) }] });
    expect(inspectModelImport('가'.repeat(Math.ceil(MODEL_IMPORT_LIMITS.maxBytes / 3) + 1)).diagnostics[0]!.code).toBe('MODEL_TOO_LARGE');
    expect(inspectModelImport('['.repeat(100) + '0' + ']'.repeat(100)).diagnostics[0]!.code).toBe('MODEL_DEPTH_EXCEEDED');
    expect(inspectModelImport(3 as unknown as string).diagnostics[0]!.code).toBe('INVALID_JSON');
  });

  it('keeps expression execution in the existing bounded AST and never fetches external dependencies', () => {
    const source = model(); source.nodes[0]!.parameters.value = 1;
    source.nodes.push({ id: 'expression', blockType: 'math.expression', blockVersion: 1, label: '함수', parameters: { expression: 'fetch(x)' } });
    source.edges[0]!.target = { nodeId: 'expression', portId: 'in' };
    source.edges.push({ id: 'to_result', source: { nodeId: 'expression', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } });
    const fetch = vi.spyOn(globalThis, 'fetch');
    try { const inspection = inspectModelImport(JSON.stringify(source)); expect(inspection.executable).toBe(false); expect(fetch).not.toHaveBeenCalled(); }
    finally { fetch.mockRestore(); }
  });
});
