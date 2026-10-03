import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { blockRegistry, getBlockDefinition, getBlockPorts, getDirectFeedthroughPorts } from '../packages/block-library/src';
import { M12_BLOCK_IDS } from '../packages/block-library/src/m12';
import { getDefinitionReference, isDefinitionReference } from '../packages/block-library/src/m11';
import { compileModel } from '../packages/compiler/src';
import { ModelError, normalizeSolverSettings, type CalcEdge, type CalcModel, type CalcNode, type SignalValue, type SubsystemDefinition } from '../packages/model/src';
import type { M12AlgebraicProgram, M12AnalysisProgram, M12DescriptorReduced } from '../packages/compiler/src/m12';

const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters });
const edge = (source: string, target: string, port = 'in', output = 'out'): CalcEdge => ({ id: `${source}-${output}-${target}-${port}`, source: { nodeId: source, portId: output }, target: { nodeId: target, portId: port } });
const graph = (nodes: CalcNode[], edges: CalcEdge[], subsystems?: SubsystemDefinition[]): CalcModel => ({ schemaVersion: 1, modelId: 'M12Compiler', name: 'M12Compiler', nodes, edges, layout: {}, ...(subsystems ? { subsystems } : {}), execution: { mode: 'continuous', startTime: 0, stopTime: 1, step: .1 } });
function operation(type: string, parameters: Record<string, unknown> = {}, inputs: Record<string, SignalValue> = { in: 1 }): CalcModel { const nodes = [node('Operation', type, parameters), node('Result', 'sink.scope')], edges = [edge('Operation', 'Result')]; for (const [port, value] of Object.entries(inputs)) { nodes.push(node(`Input_${port}`, 'source.constant', { value })); edges.push(edge(`Input_${port}`, 'Operation', port)); } return graph(nodes, edges); }
const codes = (model: CalcModel): string[] => { try { compileModel(model); return []; } catch (error) { if (!(error instanceof ModelError)) throw error; return error.diagnostics.map(diagnostic => diagnostic.code); } };
function plant(id = 'Plant'): SubsystemDefinition { return { id, version: 1, name: id, nodes: [node('Input', 'io.input'), node('State', 'continuous.state-space', { A: [[-2]], B: [3], C: [4], D: 5, initial: [1] }), node('Output', 'io.output')], edges: [edge('Input', 'State'), edge('State', 'Output')], layout: {}, inputs: [{ id: 'u', nodeId: 'Input' }], outputs: [{ id: 'y', nodeId: 'Output' }] }; }
function analysis(parameters: Record<string, unknown> = {}): CalcModel { const model = operation('analysis.linearization', { definitionId: 'Plant', ...parameters }, {}); model.subsystems = [plant()]; if (parameters.mode === 'triggered') { model.nodes.push(node('Trigger', 'source.constant', { value: true })); model.edges.push(edge('Trigger', 'Operation', 'trigger')); } return model; }
function constraint(): CalcModel { return graph([node('Unknown', 'solver.algebraic-constraint', { initial: 2 }), node('Residual', 'math.expression', { expression: 'x*x-9' }), node('Result', 'sink.scope')], [edge('Unknown', 'Residual'), edge('Residual', 'Unknown'), edge('Unknown', 'Result')]); }
const indexOne = { E: [[2, 0], [0, 0]], A: [[-6, 2], [1, -1]], B: [[2], [0]], C: [[1, 1]], D: [[0]], initial: [1, 1], differentialCount: 1 };

describe('M12 real numerical compiler contracts', () => {
  it('preserves293 definitions exactly, registers11 kernels, and keeps per-block public parameter cap16', () => {
    const baseline = JSON.parse(readFileSync(new URL('../docs/baselines/m11-registry.json', import.meta.url), 'utf8')) as { id: string }[]; expect(baseline).toHaveLength(293);
    for (const definition of baseline) expect(getBlockDefinition(definition.id)).toEqual(definition);
    expect(M12_BLOCK_IDS).toHaveLength(11); expect(blockRegistry).toHaveLength(304); expect(new Set(blockRegistry.map(definition => definition.id)).size).toBe(304);
    for (const id of M12_BLOCK_IDS) expect(Object.keys(getBlockDefinition(id)!.parameters).length).toBeLessThanOrEqual(16);
    expect(Object.keys(getBlockDefinition('continuous.pid-2dof')!.parameters)).toHaveLength(16);
  });
  it.each([
    ['continuous.descriptor', operation('continuous.descriptor')], ['continuous.integrator-limited', operation('continuous.integrator-limited')], ['continuous.second-order-limited', operation('continuous.second-order-limited')],
    ['continuous.pid-2dof', operation('continuous.pid-2dof', {}, { r: 1, y: 0 })], ['time.variable-delay', operation('time.variable-delay', {}, { in: 1, delay: .1 })], ['time.variable-transport-delay', operation('time.variable-transport-delay', {}, { in: 1, delay: .1 })],
    ['nonlinear.backlash', operation('nonlinear.backlash')], ['nonlinear.rate-limiter-continuous', operation('nonlinear.rate-limiter-continuous')], ['nonlinear.rate-limiter-dynamic', operation('nonlinear.rate-limiter-dynamic', {}, { in: 1, rising: 1, falling: -1 })],
    ['solver.algebraic-constraint', constraint()], ['analysis.linearization', analysis()],
  ] as const)('compiles actual %s IR immutably with portable JSON and insertion-order parity', (_id, original) => {
    const model = structuredClone(original), before = JSON.stringify(model), compiled = compileModel(model); expect(JSON.stringify(model)).toBe(before); expect(Object.isFrozen(compiled)).toBe(true);
    expect(compileModel(JSON.parse(JSON.stringify(compiled.model))).semanticKey).toBe(compiled.semanticKey);
    const reverse = structuredClone(compiled.model); reverse.nodes.reverse(); reverse.edges.reverse(); reverse.subsystems?.reverse(); expect(compileModel(reverse).nodes).toEqual(compiled.nodes);
  });
  it('reduces nonsingular E with explicit bounded coefficients and real MIMO descriptors', () => {
    const model = operation('continuous.descriptor', { E: [[2, 0], [0, 4]], A: [[-2, 0], [0, -8]], B: [[2, 0], [0, 4]], C: [[1, 0], [0, 1]], D: [[0, 0], [0, 0]], initial: [1, 2] }, { in: [3, 4] });
    const compiled = compileModel(model), ir = compiled.nodes.find(node => node.id === 'Operation')!, reduced = ir.parameters.descriptorReduced as M12DescriptorReduced;
    expect(reduced.A).toEqual([[-1, 0], [0, -2]]); expect(reduced.B).toEqual([[1, 0], [0, 1]]); expect(reduced.nd).toBe(2); expect(reduced.algebraicA).toEqual([]);
    expect(compiled.outputTypes.Result!.shape).toEqual([2]); expect(ir.outputs.state.shape).toEqual([2]); expect(getDirectFeedthroughPorts(ir)).toEqual([]);
    expect(compiled.model.nodes.find(node => node.id === 'Operation')!.parameters).not.toHaveProperty('descriptorReduced');
  });
  it('derives a genuine index-1 differential/algebraic reduction and preserves original consistency matrices', () => {
    const reduced = compileModel(operation('continuous.descriptor', indexOne)).nodes.find(node => node.id === 'Operation')!.parameters.descriptorReduced as M12DescriptorReduced;
    expect(reduced).toMatchObject({ n: 2, nd: 1, m: 1, p: 1, A: [[-2]], B: [[1]], C: [[2]], D: [[0]], initial: [1], algebraicA: [[1]], algebraicB: [[0]], initialAlgebraic: [1], originalE: [[2, 0], [0, 0]], originalA: [[-6, 2], [1, -1]] });
    const feedthrough = structuredClone(indexOne); feedthrough.B[1]![0] = 1; const ir = compileModel(operation('continuous.descriptor', feedthrough)).nodes.find(node => node.id === 'Operation')!; expect(getDirectFeedthroughPorts(ir)).toEqual(['in']);
  });
  it.each([
    [{ E: [[0]] }, 'M12_DESCRIPTOR_SINGULAR'], [{ E: [[1, 0], [0, 1e-14]], A: [[-1, 0], [0, -1]], B: [[1], [1]], C: [[1, 1]], D: [[0]], initial: [0, 0] }, 'M12_DESCRIPTOR_CONDITION'],
    [{ ...indexOne, E: [[2, 1], [0, 0]] }, 'M12_DESCRIPTOR_PARTITION'], [{ ...indexOne, A: [[1, 0], [0, 0]] }, 'M12_DESCRIPTOR_SINGULAR'], [{ ...indexOne, differentialCount: 2 }, 'M12_DESCRIPTOR_PARTITION'],
    [{ A: [[1, 2]] }, 'M12_DESCRIPTOR_SHAPE'], [{ initial: [] }, 'M12_DESCRIPTOR_SHAPE'],
  ] as const)('rejects unsupported/singular/ill-conditioned Descriptor %#', (parameters, code) => expect(codes(operation('continuous.descriptor', parameters))).toContain(code));
  it('requires scalar or exact M input vectors and explicit legacy real units', () => {
    expect(codes(operation('continuous.descriptor', {}, { in: [1] }))).toContain('M12_DESCRIPTOR_INPUT');
    const unit = operation('continuous.integrator-limited'); unit.nodes.find(node => node.id === 'Input_in')!.unit = 'm'; expect(codes(unit)).toContain('M12_SIGNAL_TYPE');
    const typed = operation('continuous.descriptor', {}, { in: true }); expect(codes(typed)).toContain('M12_DESCRIPTOR_INPUT');
  });
  it('exposes actual boolean boundary outputs, strict initial ranges, dynamic reset ports and16 PID parameters', () => {
    const one = compileModel(operation('continuous.integrator-limited')).nodes.find(node => node.id === 'Operation')!; expect(one.outputs.limited.valueType).toBe('boolean'); expect(one.outputs.out.valueType).toBe('float64');
    const two = compileModel(operation('continuous.second-order-limited')).nodes.find(node => node.id === 'Operation')!; expect(two.outputs.positionLimited.valueType).toBe('boolean'); expect(two.outputs.velocityLimited.valueType).toBe('boolean');
    expect(getBlockPorts(node('Reset', 'continuous.pid-2dof', { reset: 'rising' })).inputs).toEqual(['r', 'y', 'reset']);
    expect(getDirectFeedthroughPorts(node('IdealZero', 'continuous.pid-2dof', { form: 'ideal', kp: 0, kd: 1 }))).toEqual([]);
    expect(codes(operation('continuous.integrator-limited', { lower: 1, upper: 0 }))).toContain('M12_LIMITS_INVALID'); expect(codes(operation('continuous.integrator-limited', { initial: 20 }))).toContain('M12_LIMITS_INVALID');
    expect(codes(operation('continuous.second-order-limited', { velocityLower: 1 }))).toContain('M12_LIMITS_INVALID'); expect(codes(operation('continuous.pid-2dof', { antiWindup: 'clamp' }, { r: 1, y: 0 }))).toContain('M12_PID_ANTIWINDUP');
  });
  it('distinguishes delay control feedthrough, transport ODE memory and bounded accepted histories', () => {
    const time = compileModel(operation('time.variable-delay', {}, { in: 1, delay: .1 })).nodes.find(node => node.id === 'Operation')!, transport = compileModel(operation('time.variable-transport-delay', {}, { in: 1, delay: .1 })).nodes.find(node => node.id === 'Operation')!;
    expect(getDirectFeedthroughPorts(time)).toEqual(['delay']); expect(getDirectFeedthroughPorts(transport)).toEqual(['delay']); expect(time.parameters.m12StateElements).toBe(4096 * 3 + 16); expect(transport.parameters.m12StateElements).toBe(4096 * 4 + 16);
    expect(getDirectFeedthroughPorts(node('Zero', 'time.variable-delay', { handleZero: 'yes' }))).toEqual(['in', 'delay']);
    expect(codes(operation('time.variable-delay', { minDelay: 2, maxDelay: 1 }, { in: 1, delay: .1 }))).toContain('M12_DELAY_RANGE'); expect(codes(operation('time.variable-transport-delay', { historyLimit: 40_000 }, { in: 1, delay: .1 }))).toContain('STATE_BUDGET_EXCEEDED');
  });
  it('keeps dynamic rate discrete held within a continuous model and preserves ordinary continuous major-step domain', () => {
    expect(compileModel(operation('nonlinear.rate-limiter-dynamic', {}, { in: 1, rising: 1, falling: -1 })).nodes.find(node => node.id === 'Operation')!.executionDomain).toBe('discrete');
    expect(compileModel(operation('nonlinear.rate-limiter-continuous')).nodes.find(node => node.id === 'Operation')!.executionDomain).toBe('continuous');
    const wrong = operation('nonlinear.rate-limiter-dynamic', {}, { in: 1, rising: 1, falling: -1 }); wrong.nodes.find(node => node.id === 'Input_in')!.blockType = 'source.ramp'; wrong.nodes.find(node => node.id === 'Input_in')!.parameters = {}; expect(codes(wrong)).toContain('HYBRID_BOUNDARY_REQUIRED');
  });
  it('compiles a real cyclic scalar residual component while preserving ordinary cycle rejection', () => {
    const compiled = compileModel(constraint()), leader = compiled.nodes.find(node => node.id === 'Unknown')!, program = leader.parameters.algebraicProgram as M12AlgebraicProgram;
    expect(program.unknowns).toEqual([{ nodeId: 'Unknown', initial: 2, constraint: 'zero' }]); expect(program.residuals).toEqual([{ nodeId: 'Residual', portId: 'out' }]); expect(program.orderedNodeIds).toEqual(['Residual']); expect(program.nodeIds).toEqual(['Residual', 'Unknown']);
    expect(compiled.nodes.find(node => node.id === 'Residual')!.parameters.algebraicComponentId).toBe('Unknown'); expect(compiled.model.nodes.find(node => node.id === 'Residual')!.parameters).not.toHaveProperty('algebraicComponentId');
    const unsupported = constraint(); unsupported.nodes.find(node => node.id === 'Residual')!.blockType = 'nonlinear.saturation'; unsupported.nodes.find(node => node.id === 'Residual')!.parameters = {}; expect(codes(unsupported)).toContain('M12_ALGEBRAIC_UNSUPPORTED');
    const ordinary = constraint(); ordinary.nodes.find(node => node.id === 'Unknown')!.blockType = 'math.gain'; ordinary.nodes.find(node => node.id === 'Unknown')!.parameters = { gain: 1 }; expect(codes(ordinary)).toContain('CYCLIC_DEPENDENCY');
  });
  it('places every external residual producer before all unknowns and rejects nonsmooth safe AST operations', () => {
    const model = constraint(); model.nodes.find(node => node.id === 'Residual')!.blockType = 'math.sum'; model.nodes.find(node => node.id === 'Residual')!.parameters = {}; model.edges.find(edge => edge.target.nodeId === 'Residual')!.target.portId = 'a'; model.nodes.push(node('ZZExternal', 'source.constant', { value: -9 })); model.edges.push(edge('ZZExternal', 'Residual', 'b'));
    const compiled = compileModel(model); expect(compiled.nodes.findIndex(node => node.id === 'ZZExternal')).toBeLessThan(compiled.nodes.findIndex(node => node.id === 'Unknown'));
    const rounded = constraint(); rounded.nodes.find(node => node.id === 'Residual')!.parameters.expression = 'floor(x)-9'; expect(codes(rounded)).toContain('M12_ALGEBRAIC_UNSUPPORTED');
  });
  it('builds a real bounded continuous analysis plant with actual endpoints, state order and A/B/C/D schema', () => {
    const model = analysis({ operatingState: [2], operatingInputs: [3] }), compiled = compileModel(model), ir = compiled.nodes.find(node => node.id === 'Operation')!, program = ir.parameters.analysisProgram as M12AnalysisProgram;
    expect(program.kind).toBe('m12-continuous-plant'); expect(program.model.execution.mode).toBe('continuous'); expect(program.model).not.toHaveProperty('subsystems'); expect(program.initialState).toEqual([1]);
    expect(program.inputBindings).toEqual([{ port: 'u', nodeId: 'Input' }]); expect(program.outputBindings).toEqual([{ port: 'y', source: { nodeId: 'State', portId: 'out' } }]); expect(program.nodes.find(node => node.id === 'Input')!.parameters.value).toBe(3);
    expect(ir.parameters.operatingState).toEqual([2]); expect(ir.outputs.out.bus!.fields.map(field => [field.name, field.descriptor.shape])).toEqual([['A', [1, 1]], ['B', [1, 1]], ['C', [1, 1]], ['D', [1, 1]]]);
    expect(model.nodes.find(node => node.id === 'Operation')!.parameters).not.toHaveProperty('analysisProgram'); expect(isDefinitionReference(model.nodes.find(node => node.id === 'Operation')!)).toBe(true); expect(getDefinitionReference(model.nodes.find(node => node.id === 'Operation')!)).toEqual({ definitionId: 'Plant', version: 1 });
  });
  it('resolves operating defaults from actual definition and enforces real state/input/output dimensions', () => {
    const ir = compileModel(analysis()).nodes.find(node => node.id === 'Operation')!; expect(ir.parameters.operatingState).toEqual([1]); expect(ir.parameters.operatingInputs).toEqual([1]);
    expect(codes(analysis({ operatingState: [1, 2] }))).toContain('M12_ANALYSIS_STATES'); expect(codes(analysis({ operatingInputs: [1, 2] }))).toContain('M12_ANALYSIS_INPUTS'); expect(codes(analysis({ times: [2] }))).toContain('M12_ANALYSIS_TIME');
    const noState = analysis(); noState.subsystems![0]!.nodes.find(node => node.id === 'State')!.blockType = 'math.gain'; noState.subsystems![0]!.nodes.find(node => node.id === 'State')!.parameters = {}; expect(codes(noState)).toContain('M12_ANALYSIS_STATES');
    const stateful = analysis(); stateful.subsystems![0]!.nodes.find(node => node.id === 'State')!.blockType = 'discrete.unit-delay'; stateful.subsystems![0]!.nodes.find(node => node.id === 'State')!.parameters = { initial: 0 }; expect(codes(stateful)).toContain('M12_ANALYSIS_PLANT_UNSUPPORTED');
  });
  it('requires a boolean trigger and rejects unsmooth plant interiors and unsupported nested analysis', () => {
    expect(compileModel(analysis({ mode: 'triggered' })).nodes.find(node => node.id === 'Operation')!.inputs.trigger).toBeDefined();
    const trigger = analysis({ mode: 'triggered' }); trigger.nodes.find(node => node.id === 'Trigger')!.parameters.value = 1; expect(codes(trigger)).toContain('M12_SIGNAL_TYPE');
    const nonsmooth = analysis(); nonsmooth.subsystems![0]!.nodes.push(node('Round', 'math.expression', { expression: 'floor(x)' })); nonsmooth.subsystems![0]!.edges.push(edge('Input', 'Round')); expect(codes(nonsmooth)).toContain('M12_ANALYSIS_PLANT_UNSUPPORTED');
    const nested = analysis(); nested.subsystems![0]!.nodes.push(node('Nested', 'analysis.linearization', { definitionId: 'Other' })); nested.subsystems!.push(plant('Other')); expect(codes(nested)).toContain('M12_ANALYSIS_PLANT_UNSUPPORTED');
  });
  it('does not silently convert boolean/structured analysis boundaries and keeps triggered scheduling independent of timed requests', () => {
    const booleanInput = analysis({ operatingInputs: [2] }); booleanInput.subsystems![0]!.nodes.find(node => node.id === 'Input')!.parameters.value = true; expect(codes(booleanInput)).toContain('M12_ANALYSIS_INPUTS');
    const unusedBoolean = analysis(); unusedBoolean.subsystems![0]!.nodes.push(node('Boolean', 'source.constant', { value: true })); expect(codes(unusedBoolean)).toContain('M12_ANALYSIS_PLANT_UNSUPPORTED');
    const triggered = analysis({ mode: 'triggered' }); triggered.execution.startTime = 2; triggered.execution.stopTime = 3; expect(codes(triggered)).toEqual([]);
    const unregistered = analysis({ mode: 'triggered' }); unregistered.nodes.find(node => node.id === 'Trigger')!.blockType = 'logic.interval'; unregistered.nodes.find(node => node.id === 'Trigger')!.parameters = { lower: .2, upper: .3 }; unregistered.nodes.push(node('Clock', 'source.clock')); unregistered.edges.push(edge('Clock', 'Trigger')); expect(codes(unregistered)).toContain('M12_ANALYSIS_TRIGGER_BOUNDARY_REQUIRED');
  });
  it('enforces the per-component unknown bound and registered jumps across all new continuous state inputs', () => {
    const nodes: CalcNode[] = [node('Result', 'sink.scope')], edges: CalcEdge[] = [];
    for (let index = 0; index < 9; index++) { nodes.push(node(`Unknown${index}`, 'solver.algebraic-constraint'), node(`Residual${index}`, 'math.expression', { expression: 'x' })); edges.push(edge(`Unknown${index}`, `Residual${index}`), edge(`Residual${index}`, `Unknown${(index + 1) % 9}`)); }
    edges.push(edge('Unknown0', 'Result')); expect(codes(graph(nodes, edges))).toContain('M12_ALGEBRAIC_LIMIT');
    const pid = operation('continuous.pid-2dof', {}, { y: 0 }); pid.nodes.push(node('Ramp', 'source.ramp'), node('Round', 'math.expression', { expression: 'floor(x)' })); pid.edges.push(edge('Ramp', 'Round'), edge('Round', 'Operation', 'r')); expect(codes(pid)).toContain('UNREGISTERED_DISCONTINUITY');
  });
  it.each(['continuous.integrator-limited', 'continuous.second-order-limited', 'continuous.pid-2dof'])('requires registered rising reset controls for %s', id => {
    const inputs: Record<string, SignalValue> = id === 'continuous.pid-2dof' ? { r: 1, y: 0 } : { in: 1 }; const bad = operation(id, { reset: 'rising' }, inputs);
    bad.nodes.push(node('Clock', 'source.ramp'), node('Reset', 'logic.interval', { lower: .2, upper: .3 })); bad.edges.push(edge('Clock', 'Reset'), edge('Reset', 'Operation', 'reset')); expect(codes(bad)).toContain('M12_RESET_BOUNDARY_REQUIRED');
    const registered = structuredClone(bad); registered.nodes.find(node => node.id === 'Reset')!.blockType = 'logic.hit-crossing'; registered.nodes.find(node => node.id === 'Reset')!.parameters = { threshold: .5, direction: 'rising' }; expect(codes(registered)).toEqual([]);
  });
  it('rejects same-frame hold capture feedback through an actual algebraic residual', () => {
    const model = graph([node('Unknown', 'solver.algebraic-constraint'), node('Hold', 'time.zero-order-hold', { initial: 0 }), node('Residual', 'math.sum'), node('Result', 'sink.scope')], [edge('Unknown', 'Hold'), edge('Unknown', 'Residual', 'a'), edge('Hold', 'Residual', 'b'), edge('Residual', 'Unknown'), edge('Unknown', 'Result')]);
    expect(codes(model)).toContain('CYCLIC_CAPTURE_DEPENDENCY');
    const valid = constraint(); valid.nodes.push(node('Constant', 'source.constant'), node('Hold', 'time.zero-order-hold', { initial: 0 }), node('HeldResult', 'sink.scope')); valid.edges.push(edge('Constant', 'Hold'), edge('Hold', 'HeldResult')); expect(codes(valid)).toEqual([]);
  });
  it('preserves old RK defaults and bounds the independently named implicit Euler/Newton contract', () => {
    const execution = { mode: 'continuous' as const, startTime: 0, stopTime: 1, step: .1 }; expect(normalizeSolverSettings(execution)).not.toHaveProperty('newtonTolerance');
    expect(normalizeSolverSettings({ ...execution, solver: { method: 'implicit-euler' } })).toMatchObject({ method: 'implicit-euler', newtonTolerance: 1e-9, newtonMaxIterations: 24, jacobianStep: 1e-6 });
    for (const solver of [{ method: 'implicit-euler' as const, newtonMaxIterations: 33 }, { method: 'implicit-euler' as const, jacobianStep: 0 }, { method: 'implicit-euler' as const, newtonTolerance: 0 }]) expect(() => normalizeSolverSettings({ ...execution, solver })).toThrow(ModelError);
    const arbitrary = operation('continuous.integrator-limited'); arbitrary.nodes[0]!.parameters = Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`p${index}`, 0])); expect(codes(arbitrary)).toContain('INVALID_MODEL');
  });
});
