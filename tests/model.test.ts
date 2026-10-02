import { describe, expect, it } from 'vitest';
import {
  canonicalSemantic, MODEL_LIMITS, ModelError, parseModel, parseModelJson,
  serializeModel, validateSignal, signalElementCount, formatSignalShape, SIGNAL_LIMITS, UNITS, type CalcModel,
} from '../packages/model/src';

function smallModel(): CalcModel {
  return {
    schemaVersion: 1, modelId: 'model_test', name: '테스트 모델',
    nodes: [
      { id: 'input', blockType: 'source.constant', blockVersion: 1, label: '상수', parameters: { value: 2 } },
      { id: 'result', blockType: 'sink.display', blockVersion: 1, label: '결과', parameters: {} },
    ],
    edges: [{ id: 'edge_1', source: { nodeId: 'input', portId: 'out' }, target: { nodeId: 'result', portId: 'in' } }],
    execution: { mode: 'static', startTime: 0, stopTime: 1, step: 0.1 },
    layout: { input: { x: 0, y: 0 }, result: { x: 300, y: 0 } },
  };
}

function expectCode(action: () => unknown, code: string): void {
  try { action(); } catch (error) {
    expect(error).toBeInstanceOf(ModelError);
    expect((error as ModelError).diagnostics.some((diagnostic) => diagnostic.code === code)).toBe(true);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe('versioned model boundary', () => {
  it('round-trips Unicode JSON and creates a defensive copy', () => {
    const original = smallModel();
    const parsed = parseModel(original);
    original.nodes[0]!.parameters.value = 99;
    expect(parsed.nodes[0]!.parameters.value).toBe(2);
    expect(parseModelJson(serializeModel(parsed))).toEqual(parsed);
  });

  it('accepts harmless shared in-memory values but rejects object cycles', () => {
    const original = smallModel();
    const sharedPosition = { x: 0, y: 0 };
    original.layout.input = sharedPosition;
    original.layout.result = sharedPosition;
    expect(parseModel(original).layout.input).toEqual(sharedPosition);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    original.nodes[0]!.parameters = cyclic;
    expectCode(() => parseModel(original), 'INVALID_MODEL');
  });

  it('rejects unknown fields and future model versions instead of discarding data', () => {
    expectCode(() => parseModel({ ...smallModel(), script: 'arbitrary source' }), 'INVALID_MODEL');
    expectCode(() => parseModel({ ...smallModel(), schemaVersion: 2 }), 'INVALID_MODEL');
  });

  it('rejects duplicate node and edge IDs', () => {
    const duplicateNodes = smallModel();
    duplicateNodes.nodes.push({ ...duplicateNodes.nodes[0]! });
    expectCode(() => parseModel(duplicateNodes), 'DUPLICATE_NODE_ID');
    const duplicateEdges = smallModel();
    duplicateEdges.edges.push({ ...duplicateEdges.edges[0]! });
    expectCode(() => parseModel(duplicateEdges), 'DUPLICATE_EDGE_ID');
  });

  it('rejects reserved IDs and unsafe JSON fields without polluting prototypes', () => {
    const unsafeId = smallModel();
    unsafeId.nodes[0]!.id = 'constructor';
    expectCode(() => parseModel(unsafeId), 'INVALID_MODEL');
    const unsafeJson = JSON.stringify(smallModel()).replace('"parameters":{"value":2}', '"parameters":{"__proto__":{"polluted":true}}');
    expectCode(() => parseModelJson(unsafeJson), 'UNSAFE_FIELD');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('never invokes a user-supplied accessor or serialization hook', () => {
    const input = smallModel();
    let invoked = false;
    Object.defineProperty(input.nodes[0]!.parameters, 'value', {
      enumerable: true, get() { invoked = true; throw new Error('should not run'); },
    });
    expectCode(() => parseModel(input), 'UNSAFE_FIELD');
    expect(invoked).toBe(false);
    const withHook = { ...smallModel(), toJSON() { invoked = true; return {}; } };
    expectCode(() => parseModel(withHook), 'INVALID_MODEL');
    expect(invoked).toBe(false);
  });

  it('enforces finite float64, text bytes, nesting, and model size before execution', () => {
    const nonfinite = smallModel();
    nonfinite.nodes[0]!.parameters.value = Infinity;
    expectCode(() => parseModel(nonfinite), 'NONFINITE_INPUT');
    expectCode(() => parseModelJson(' '.repeat(MODEL_LIMITS.maxBytes + 1)), 'MODEL_TOO_LARGE');
    expectCode(() => parseModelJson('한'.repeat(Math.ceil(MODEL_LIMITS.maxBytes / 3))), 'MODEL_TOO_LARGE');
    const nested = smallModel();
    let value: unknown = 0;
    for (let index = 0; index < 40; index++) value = { child: value };
    nested.nodes[0]!.parameters.value = value;
    expectCode(() => parseModel(nested), 'MODEL_DEPTH_EXCEEDED');
    const oversized = smallModel();
    oversized.nodes = Array.from({ length: MODEL_LIMITS.maxNodes + 1 }, (_, index) => ({ id: `node_${index}`, blockType: 'source.constant', blockVersion: 1, label: '', parameters: { value: 1 } }));
    expectCode(() => parseModel(oversized), 'INVALID_MODEL');
  });

  it('rejects invalid JSON and layout references rather than losing them', () => {
    expectCode(() => parseModelJson('{'), 'INVALID_JSON');
    const model = smallModel();
    model.layout.missing = { x: 1, y: 2 };
    expectCode(() => parseModel(model), 'UNKNOWN_LAYOUT_NODE');
  });
});

describe('canonical execution meaning', () => {
  it('ignores presentation and insertion order, while retaining parameters and edges', () => {
    const original = smallModel();
    const changed = parseModel(original);
    changed.name = '새 표시 이름';
    changed.nodes[0]!.label = '다른 표시 이름';
    changed.layout.input = { x: 200, y: 300 };
    changed.nodes.reverse();
    changed.edges.reverse();
    expect(canonicalSemantic(changed)).toBe(canonicalSemantic(original));
    changed.nodes.find((node) => node.id === 'input')!.parameters.value = 3;
    expect(canonicalSemantic(changed)).not.toBe(canonicalSemantic(original));
  });
});

describe('bounded M1 signal values and units', () => {
  it('infers finite scalar, homogeneous vectors and rectangular row-major matrices', () => {
    expect(validateSignal(1)).toEqual({ valueType: 'float64', shape: [], unit: '1' });
    expect(validateSignal(false)).toEqual({ valueType: 'boolean', shape: [], unit: '1' });
    expect(validateSignal([true, false])).toEqual({ valueType: 'boolean', shape: [2], unit: '1' });
    const descriptor = validateSignal([[1, 2, 3], [4, 5, 6]]);
    expect(descriptor).toEqual({ valueType: 'float64', shape: [2, 3], unit: '1' });
    expect(signalElementCount(descriptor)).toBe(6);
    expect(formatSignalShape(descriptor)).toBe('matrix[2×3]');
    expect(validateSignal(Array.from({ length: 32 }, () => Array(32).fill(1))).shape).toEqual([32, 32]);
  });

  it('rejects empty, ragged, mixed, nonfinite, 3D and oversized values without coercion', () => {
    for (const value of [[], [1, true], [[1], [2, 3]], [1, [2]], [[[1]]], [NaN], [Infinity], Array(SIGNAL_LIMITS.maxElements + 1).fill(1), Array.from({ length: 33 }, () => Array(32).fill(1))]) {
      expectCode(() => validateSignal(value), 'INVALID_SIGNAL');
    }
  });

  it('never reads signal accessors or accepts sparse arrays and decorated prototypes', () => {
    let invoked = false;
    const accessor: unknown[] = [1];
    Object.defineProperty(accessor, '0', { enumerable: true, get() { invoked = true; return 2; } });
    expectCode(() => validateSignal(accessor), 'INVALID_SIGNAL');
    expect(invoked).toBe(false);
    expectCode(() => validateSignal(new Array(2)), 'INVALID_SIGNAL');
    const decorated = [1];
    Object.defineProperty(decorated, 'extra', { value: 1 });
    expectCode(() => validateSignal(decorated), 'INVALID_SIGNAL');
    expectCode(() => validateSignal(Object.setPrototypeOf([1], null)), 'INVALID_SIGNAL');
  });

  it('round-trips allowlisted unit metadata and includes it in semantic meaning', () => {
    const original = smallModel(); const withoutUnit = canonicalSemantic(original);
    for (const unit of UNITS) {
      original.nodes[0]!.unit = unit;
      expect(parseModelJson(serializeModel(original)).nodes[0]!.unit).toBe(unit);
    }
    original.nodes[0]!.unit = 'm';
    expect(canonicalSemantic(original)).not.toBe(withoutUnit);
    original.nodes[0]!.unit = 'unsupported-unit';
    expectCode(() => parseModel(original), 'INVALID_MODEL');
  });
});
