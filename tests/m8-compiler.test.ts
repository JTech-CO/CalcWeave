import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockPresets, blockRegistry, getBlockDefinition, getBlockPorts } from '../packages/block-library/src';
import { M8_BLOCK_IDS } from '../packages/block-library/src/m8';
import { M8_BLOCK_PRESETS } from '../packages/block-library/src/m8';
import { M9_BLOCK_IDS } from '../packages/block-library/src/m9';
import { compileModel } from '../packages/compiler/src';
import { ModelError, parseModel, validateSignal, type CalcModel } from '../packages/model/src';
import { M8_FIXTURES, m8Model, type M8Fixture } from './m8-fixtures';

const fixture = (id: string): M8Fixture => structuredClone(M8_FIXTURES.find(entry => entry.id === id)!);
function diagnostics(model: CalcModel): string[] {
  try { compileModel(model); } catch (error) { expect(error).toBeInstanceOf(ModelError); return (error as ModelError).diagnostics.map(item => item.code); }
  throw new Error('Expected compilation failure');
}
function params(id: string, updates: Record<string, unknown>): CalcModel { const model = m8Model(fixture(id)); Object.assign(model.nodes.find(node => node.id === 'operation')!.parameters, updates); return model; }
function unit(model: CalcModel, nodeId: string, value: string): CalcModel { model.nodes.find(node => node.id === nodeId)!.unit = value; return model; }
function ode(entry: M8Fixture, changingPort: string): CalcModel {
  const model = m8Model(entry, 'continuous');
  const producer = model.nodes.find(node => node.id === `input_${changingPort}`)!;
  producer.blockType = 'source.ramp'; producer.parameters = {};
  if (entry.id === 'lookup.direct') Object.assign(model.nodes.find(node => node.id === 'operation')!.parameters, { dimensions: [2], table: [0, 1] });
  model.nodes.push({ id: 'state', blockType: 'continuous.integrator', blockVersion: 1, label: 'state', parameters: { initial: 0 } });
  model.edges.push({ id: 'derivative', source: { nodeId: 'operation', portId: 'out' }, target: { nodeId: 'state', portId: 'in' } });
  return model;
}

describe('M8 bounded stateless compiler contracts', () => {
  it('preserves all 144 previous definitions exactly and counts presets separately', () => {
    const baseline = JSON.parse(readFileSync(new URL('../docs/baselines/catalog-registry.json', import.meta.url), 'utf8')) as { definitions: Record<string, unknown>[] };
    expect(baseline.definitions).toHaveLength(144);
    for (const definition of baseline.definitions) expect(getBlockDefinition(String(definition.id))).toEqual(definition);
    expect(M8_BLOCK_IDS).toHaveLength(41);
    const baselineIds = new Set(baseline.definitions.map(definition => definition.id));
    expect(blockRegistry.filter(definition => baselineIds.has(definition.id) || (M8_BLOCK_IDS as readonly string[]).includes(definition.id))).toHaveLength(185);
    expect(new Set(blockRegistry.map(item => item.id)).size).toBe(blockRegistry.length);
    expect(blockPresets.filter(preset => (M8_BLOCK_PRESETS as readonly { id: string }[]).some(old => old.id === preset.id))).toHaveLength(8);
    for (const preset of blockPresets) expect(getBlockDefinition(preset.blockType)).toBeDefined();
  });

  it.each(M8_FIXTURES)('infers every independent fixture output: $name', entry => {
    for (const mode of ['static', 'discrete', 'continuous'] as const) {
      const model = m8Model(entry, mode), before = JSON.stringify(model), ir = compileModel(model), operation = ir.nodes.find(node => node.id === 'operation')!;
      expect(Object.keys(operation.outputs).sort()).toEqual(Object.keys(entry.expected).sort());
      for (const [port, value] of Object.entries(entry.expected)) expect(operation.outputs[port]).toEqual(validateSignal(value));
      expect(JSON.stringify(model)).toBe(before);
      expect(getBlockDefinition(entry.id)!.supportedModes).toEqual(['static', 'discrete', 'continuous']);
      expect(getBlockDefinition(entry.id)!.exportTargets).toEqual(['typescript']);
    }
  });

  it('covers every new native definition with a fixture', () => expect(new Set(M8_FIXTURES.map(entry => entry.id))).toEqual(new Set(M8_BLOCK_IDS)));
  it('bounds dynamic port generation before compilation', () => {
    expect(getBlockPorts({ blockType: 'route.multiport-switch', parameters: { count: Infinity } }).inputs).toEqual(['index', 'in1', 'in2']);
    expect(getBlockPorts({ blockType: 'math.sum-inputs', parameters: { count: 1e9 } }).inputs).toEqual(['in1', 'in2']);
    expect(getBlockPorts({ blockType: 'route.demux-widths', parameters: { widths: Array(1000).fill(1) } }).outputs).toHaveLength(2);
    expect(getBlockPorts({ blockType: 'verify.bounds', parameters: { source: 'dynamic', kind: 'upper' } }).inputs).toEqual(['in', 'upper']);
  });
  it.each([
    ['lookup.nd', { rank: 11 }], ['lookup.direct', { dimensions: Array(11).fill(1), table: [1] }],
    ['lookup.nd', { rank: 10, table: [1, 2] }], ['lookup.nd', { axis1: [0, 0] }],
    ['lookup.nd', { rank: 3, axis1: [0, 1, 2], table: [1, 2, 3, 4] }],
    ['lookup.direct', { dimensions: [2.5] }], ['lookup.direct', { dimensions: [32, 32, 2], table: [1] }],
    ['logic.truth-table', { table: [0, 1, 0, 1] }], ['logic.truth-table', { table: [true, false] }],
    ['math.sum-inputs', { signs: [1, 0] }], ['math.sum-inputs', { count: 17 }],
    ['math.product-inputs', { operations: '*x' }], ['math.product-inputs', { mode: 'matrix', operations: '*/' }],
    ['logic.combine', { operation: 'not', count: 2 }], ['route.demux-widths', { widths: [1, 0] }],
  ] as const)('rejects invalid bounded parameters %s %j', (id, updates) => expect(diagnostics(params(id, updates)).length).toBeGreaterThan(0));
  it('rejects missing, unknown and mismatched ports without mutating the model', () => {
    const model = m8Model(fixture('nonlinear.saturation-dynamic'));
    model.edges[0]!.target.portId = 'unknown';
    const before = JSON.stringify(model); expect(diagnostics(model)).toContain('UNKNOWN_INPUT_PORT'); expect(JSON.stringify(model)).toBe(before);
  });
  it('rejects duplicate assignment indices and incomplete row permutations', () => {
    expect(diagnostics(params('matrix.assign', { indices: [0, 0] }))).toContain('INVALID_INDEX');
    expect(diagnostics(params('matrix.permute-rows-cols', { rows: [0] }))).toContain('INVALID_INDEX');
    expect(diagnostics(params('matrix.permute-dimensions', { order: [1, 1] }))).toContain('INVALID_INDEX');
  });
  it('checks the first matrix product operand and rejects vector ambiguity', () => {
    const model = params('math.product-inputs', { count: 1, mode: 'matrix', operations: '*' });
    model.nodes = model.nodes.filter(node => !['input_in2', 'input_in3'].includes(node.id));
    model.edges = model.edges.filter(edge => !['input_in2', 'input_in3'].includes(edge.source.nodeId));
    expect(diagnostics(model)).toContain('MATRIX_SHAPE');
  });
  it('keeps numeric, boolean, units and shape strict at dynamic boundaries', () => {
    expect(diagnostics(unit(m8Model(fixture('nonlinear.dead-zone-dynamic')), 'input_upper', 'm'))).toContain('UNIT_MISMATCH');
    const boolean = m8Model(fixture('logic.truth-table')); boolean.nodes[0]!.parameters.value = [1, 0]; expect(diagnostics(boolean)).toContain('TYPE_MISMATCH');
    const shape = m8Model(fixture('nonlinear.saturation-dynamic')); shape.nodes.find(node => node.id === 'input_lower')!.parameters.value = [0, 1]; expect(diagnostics(shape)).toContain('SHAPE_MISMATCH');
    expect(diagnostics(unit(m8Model(fixture('lookup.nd')), 'input_in', 'm'))).toContain('UNIT_MISMATCH');
  });
  it('infers square-root, matrix Gram and dynamic table output units', () => {
    expect(compileModel(unit(m8Model(fixture('math.signed-sqrt')), 'input_in', 'm^2')).outputTypes.result_out!.unit).toBe('m');
    expect(compileModel(unit(m8Model(fixture('matrix.square')), 'input_in', 'm')).outputTypes.result_out!.unit).toBe('m^2');
    const lookup = m8Model(fixture('lookup.dynamic')); unit(lookup, 'input_in', 's'); unit(lookup, 'input_breakpoints', 's'); unit(lookup, 'input_table', 'V'); expect(compileModel(lookup).outputTypes.result_out!.unit).toBe('V');
    const source = unit(m8Model(fixture('matrix.expand-scalar')), 'operation', 'V'); expect(compileModel(source).outputTypes.result_out!.unit).toBe('V');
  });
  it('preserves rank2 Squeeze shape, rectangular Gram shape and fixed padded empty capacity', () => {
    expect(compileModel(params('matrix.squeeze', {})).outputTypes.result_out!.shape).toEqual([3, 1]);
    expect(compileModel(m8Model(M8_FIXTURES.find(entry => entry.name === 'rectangular-matrix-square-is-Gram')!)).outputTypes.result_out!.shape).toEqual([3, 3]);
    const find = compileModel(m8Model(M8_FIXTURES.find(entry => entry.name === 'find-nonzero-empty-padded-independent-alternative')!)); expect(find.outputTypes.result_indices!.shape).toEqual([2]); expect(find.outputTypes.result_count!.shape).toEqual([]);
  });
  it('rejects jumps on ODE derivative paths while leaving sampled sinks and fixed selections usable', () => {
    for (const id of ['nonlinear.friction', 'nonlinear.wrap-to-zero', 'lookup.direct']) expect(diagnostics(ode(fixture(id), 'in'))).toContain('UNREGISTERED_DISCONTINUITY');
    const selection = ode(fixture('route.multiport-switch'), 'index'); expect(diagnostics(selection)).toContain('UNREGISTERED_DISCONTINUITY');
    const smooth = ode(fixture('nonlinear.friction'), 'in'); smooth.nodes.find(node => node.id === 'operation')!.parameters.offset = 0; expect(() => compileModel(smooth)).not.toThrow();
    const fixed = ode(fixture('route.multiport-switch'), 'in1'); expect(() => compileModel(fixed)).not.toThrow();
    const sampled = ode(fixture('nonlinear.wrap-to-zero'), 'in'); sampled.nodes = sampled.nodes.filter(node => node.id !== 'state'); sampled.edges = sampled.edges.filter(edge => edge.id !== 'derivative'); expect(() => compileModel(sampled)).not.toThrow();
  });
  it('keeps unknown schema1 blocks available for repair and rejects execution claims', () => {
    const model = m8Model(fixture('math.negate')); model.nodes.find(node => node.id === 'operation')!.blockType = 'future.vendor-block';
    expect(parseModel(model).nodes.find(node => node.id === 'operation')!.blockType).toBe('future.vendor-block'); expect(diagnostics(model)).toContain('UNKNOWN_BLOCK');
  });
});
