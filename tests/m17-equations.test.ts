import { describe, expect, it } from 'vitest';
import { EXAMPLES, createExample as cloneExample } from '../apps/web/src/examples';
import { explainDiagram, type DiagramEquationReport } from '../packages/analysis/src/diagram-equations';
import { compileModel } from '../packages/compiler/src';
import { createSubsystemFromSelection } from '../packages/compiler/src/hierarchy';
import type { CalcEdge, CalcModel, CalcNode } from '../packages/model/src';
import { runModel } from '../packages/runtime/src';

const text = (report: DiagramEquationReport, id: string): string | undefined => report.equations.find(equation => equation.id === id)?.terms.map(item => item.text).join('');
const node = (id: string, blockType: string, parameters: Record<string, unknown> = {}, unit?: string): CalcNode => ({ id, blockType, blockVersion: 1, label: id, parameters, ...(unit ? { unit } : {}) });
const edge = (source: string, target: string, port = 'in'): CalcEdge => ({ id: `${source}-${target}-${port}`, source: { nodeId: source, portId: 'out' }, target: { nodeId: target, portId: port } });
const model = (nodes: CalcNode[], edges: CalcEdge[]): CalcModel => ({ schemaVersion: 1, modelId: 'm17-test', name: '수식 검사', nodes, edges, layout: {}, execution: { mode: 'static', startTime: 0, stopTime: 0, step: 0.1 } });

describe('M17 validated diagram to equations', () => {
  it('explains the real gain example with clickable constants and coefficients, without mutating the model', async () => {
    const input = cloneExample('first-calculation');
    const before = structuredClone(input);
    const report = explainDiagram(input);
    expect(report.status).toBe('supported');
    expect(report.diagnostics).toEqual([]);
    expect(text(report, 'local-gain')).toBe('y2 = 3 × y1');
    expect(text(report, 'summary-result')).toBe('y3 = 3 × 2');
    expect(report.equations.find(equation => equation.id === 'summary-result')!.nodeIds).toEqual(['result', 'gain', 'value']);
    expect(report.equations.find(equation => equation.id === 'local-gain')!.terms.find(item => item.text === '3')!.nodeIds).toEqual(['gain']);
    expect((await runModel(compileModel(input))).samples[0]!.values.result).toBe(6);
    expect(input).toEqual(before);
  });

  it('uses compiler defaults and updates parameter and connection edits', async () => {
    const input = model([node('input', 'io.input'), node('other', 'source.constant', { value: 7 }), node('gain', 'math.gain'), node('result', 'sink.display')], [edge('input', 'gain'), edge('gain', 'result')]);
    expect(text(explainDiagram(input), 'summary-result')).toBe('y4 = 2 × 1');
    input.nodes.find(item => item.id === 'gain')!.parameters.gain = -3;
    input.edges[0]!.source.nodeId = 'other';
    const report = explainDiagram(input);
    expect(text(report, 'summary-result')).toBe('y4 = (-3) × 7');
    expect(report.equations.find(item => item.id === 'summary-result')!.nodeIds).not.toContain('input');
    expect((await runModel(compileModel(input))).samples[0]!.values.result).toBe(-21);
  });

  it.each([['++', 7, 'y3 = y1 + y2'], ['+-', -1, 'y3 = y1 − y2'], ['-+', 1, 'y3 = −y1 + y2'], ['--', -7, 'y3 = −y1 − y2']] as const)('matches Sum %s signs in the actual runtime', async (signs, expected, equation) => {
    const input = model([node('a', 'source.constant', { value: 3 }), node('b', 'source.constant', { value: 4 }), node('sum', 'math.sum', { signs }), node('result', 'sink.display')], [edge('a', 'sum', 'a'), edge('b', 'sum', 'b'), edge('sum', 'result')]);
    expect(text(explainDiagram(input), 'local-sum')).toBe(equation);
    expect((await runModel(compileModel(input))).samples[0]!.values.result).toBe(expected);
  });

  it('preserves nested operator precedence for subtraction and division', async () => {
    const input = model([
      node('a', 'source.constant', { value: 2 }), node('b', 'source.constant', { value: 3 }), node('c', 'source.constant', { value: 4 }), node('d', 'source.constant', { value: 1 }),
      node('sum', 'math.sum'), node('subtract', 'math.sum', { signs: '+-' }), node('divide', 'math.multiply', { operation: 'divide' }), node('result', 'io.output'),
    ], [edge('a', 'sum', 'a'), edge('b', 'sum', 'b'), edge('c', 'subtract', 'a'), edge('d', 'subtract', 'b'), edge('sum', 'divide', 'a'), edge('subtract', 'divide', 'b'), edge('divide', 'result')]);
    expect(text(explainDiagram(input), 'summary-result')).toBe('y8 = (2 + 3) / (4 − 1)');
    expect((await runModel(compileModel(input))).samples[0]!.values.result).toBeCloseTo(5 / 3);
  });

  it('explains Unit Delay old-state reads and the real feedback recurrence', async () => {
    const input = cloneExample('discrete-feedback');
    input.execution.stopTime = 5;
    const report = explainDiagram(input);
    expect(report.status).toBe('supported');
    expect(text(report, 'local-delay')).toBe('x1[k+1] = y3[k]');
    expect(text(report, 'initial-delay')).toBe('x1[0] = 0');
    expect(text(report, 'summary-delay')).toBe('x1[k+1] = 1 + 0.9 × x1[k]');
    const run = await runModel(compileModel(input));
    expect(run.samples.map(sample => sample.values.result)).toEqual([0, 1, 1.9, 2.71, 3.439, 4.0951]);
    expect(run.finalState.delay).toBe(4.0951);
    expect(run.finalState.delay).not.toBeCloseTo(0.9 * 4.0951 + 1);
  });

  it('retains nonzero start times and sample spacing in discrete state relations', async () => {
    const input = cloneExample('discrete-feedback');
    input.execution = { mode: 'discrete', startTime: 2, stopTime: 3, step: 0.25 };
    input.nodes.find(item => item.id === 'delay')!.parameters.initial = 2;
    input.nodes.find(item => item.id === 'gain')!.parameters.gain = -0.5;
    input.nodes.find(item => item.id === 'sum')!.parameters.signs = '+-';
    const report = explainDiagram(input);
    expect(text(report, 'initial-delay')).toBe('x1[0] = 2');
    expect(text(report, 'time-grid')).toBe('t[k] = 2 + 0.25 × k');
    expect(text(report, 'summary-delay')).toBe('x1[k+1] = 1 − (-0.5) × x1[k]');
    const run = await runModel(compileModel(input));
    expect(run.samples.map(sample => sample.time)).toEqual([2, 2.25, 2.5, 2.75, 3]);
    expect(run.samples.every(sample => sample.values.result === 2)).toBe(true);
  });

  it('matches continuous decay and changed initial conditions, gain, and start time', async () => {
    const input = cloneExample('continuous-decay');
    input.execution = { mode: 'continuous', startTime: 2, stopTime: 3, step: 0.05 };
    input.nodes.find(item => item.id === 'state')!.parameters.initial = 4;
    input.nodes.find(item => item.id === 'gain')!.parameters.gain = -2;
    const report = explainDiagram(input);
    expect(report.status).toBe('supported');
    expect(text(report, 'local-state')).toBe('x1′(t) = y1(t)');
    expect(text(report, 'initial-state')).toBe('x1(2) = 4');
    expect(text(report, 'integral-state')).toBe('x1(t) = 4 + ∫[2, t] y1(τ) dτ');
    expect(text(report, 'summary-state')).toBe('x1′(t) = (-2) × x1(t)');
    expect(text(report, 'solution-state')).toBe('x1(t) = 4 × exp((-2) × (t − 2))');
    const run = await runModel(compileModel(input));
    for (const sample of run.samples) expect(sample.values.result).toBeCloseTo(4 * Math.exp(-2 * (sample.time - 2)), 5);
  });

  it('recognizes mathematical topology instead of model names or labels', () => {
    const input = cloneExample('continuous-decay');
    input.modelId = 'renamed';
    input.name = '다른 이름';
    input.nodes.forEach(item => { item.label = 'arbitrary'; });
    expect(text(explainDiagram(input), 'solution-state')).toBe('x1(t) = 1 × exp((-1) × (t − 0))');
    input.nodes.push(node('constant', 'source.constant', { value: 1 }));
    input.edges.find(item => item.id === 'state-gain')!.source.nodeId = 'constant';
    expect(text(explainDiagram(input), 'solution-state')).toBeUndefined();
    expect(text(explainDiagram(input), 'local-state')).toBe('x1′(t) = y1(t)');
  });

  it('preserves compiler inferred units and unit conversion coefficients', async () => {
    const input = model([node('length', 'source.constant', { value: 100 }, 'cm'), node('convert', 'unit.convert', { from: 'cm', to: 'm' }), node('result', 'sink.scope')], [edge('length', 'convert'), edge('convert', 'result')]);
    const report = explainDiagram(input);
    expect(report.status).toBe('supported');
    expect(report.variables.map(item => item.unit)).toEqual(['cm', 'm', 'm']);
    expect(text(report, 'local-convert')).toBe('y2 = 0.01 × y1 + 0');
    expect(text(report, 'summary-result')).toBe('y3 = 0.01 × 100 + 0');
    expect((await runModel(compileModel(input))).samples[0]!.values.result).toBe(1);
    input.nodes.find(item => item.id === 'result')!.unit = 'cm';
    expect(explainDiagram(input)).toMatchObject({ status: 'invalid', equations: [], diagnostics: [expect.objectContaining({ code: 'UNIT_ANNOTATION_MISMATCH' })] });
  });

  it.each([
    ['math.abs', {}, -2, 'abs((-2))', 2], ['math.sqrt', {}, 4, '√(4)', 2],
    ['math.function', { operation: 'square' }, -2, '((-2))²', 4], ['math.function', { operation: 'reciprocal' }, 2, '1 / 2', 0.5],
    ['math.function', { operation: 'log' }, Math.E, `ln(${Math.E})`, 1],
    ['math.trigonometric', { operation: 'sin' }, 0, 'sin(0)', 0],
  ])('uses the actual %s scalar function and domain semantics', async (blockType, parameters, value, equation, expected) => {
    const input = model([node('source', 'source.constant', { value }), node('function', blockType as string, parameters as Record<string, unknown>), node('result', 'sink.display')], [edge('source', 'function'), edge('function', 'result')]);
    const report = explainDiagram(input);
    expect(report.status).toBe('supported');
    expect(text(report, 'summary-result')).toBe(`y3 = ${equation}`);
    expect((await runModel(compileModel(input))).samples[0]!.values.result).toBeCloseTo(expected as number);
  });

  it('explicitly identifies unsupported shapes and typed signals without inventing scalar equations', () => {
    const input = cloneExample('first-calculation');
    input.nodes.find(item => item.id === 'value')!.parameters.value = [1, 2];
    const report = explainDiagram(input);
    expect(report.status).toBe('partial');
    expect(report.equations).toEqual([]);
    expect(report.diagnostics.flatMap(item => item.nodeIds ?? [])).toEqual(['value', 'gain', 'result']);
    expect(report.diagnostics.every(item => item.code === 'EQUATION_SCALAR_REQUIRED')).toBe(true);
    const typed = explainDiagram(cloneExample('typed-integer64'));
    expect(typed.status).toBe('partial');
    expect(typed.equations).toEqual([]);
  });

  it('keeps supported local relations while explicitly identifying unsupported scalar blocks', () => {
    const input = model([node('source', 'source.constant', { value: 2 }), node('expression', 'math.expression', { expression: 'x^2' }), node('result', 'sink.display')], [edge('source', 'expression'), edge('expression', 'result')]);
    const report = explainDiagram(input);
    expect(report.status).toBe('partial');
    expect(report.diagnostics).toEqual([expect.objectContaining({ code: 'EQUATION_BLOCK_UNSUPPORTED', nodeIds: ['expression'] })]);
    expect(text(report, 'local-result')).toBe('y3 = y2');
    expect(text(report, 'summary-result')).toBeUndefined();
    expect(text(report, 'local-expression')).toBeUndefined();
  });

  it('reports hierarchy boundaries and does not expose flattened child symbols as root equations', () => {
    const input = createSubsystemFromSelection(cloneExample('first-calculation'), ['gain'], 'module');
    const report = explainDiagram(input);
    const hierarchyId = input.nodes.find(item => item.blockType === 'hierarchy.subsystem')!.id;
    expect(report.status).toBe('partial');
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'EQUATION_HIERARCHY', nodeIds: [hierarchyId] }));
    expect(text(report, 'summary-result')).toBeUndefined();
    const ids = new Set(input.nodes.map(item => item.id));
    expect(report.equations.every(equation => equation.nodeIds.every(id => ids.has(id)))).toBe(true);
  });

  it('does not publish a false base-tick recurrence for offset or slow-rate states', async () => {
    const input = cloneExample('discrete-feedback');
    input.execution.stopTime = 5;
    input.nodes.filter(item => item.blockType !== 'source.constant').forEach(item => { item.sampleTime = { period: 2, offset: 1 }; });
    const report = explainDiagram(input);
    expect(report.status).toBe('partial');
    expect(report.diagnostics.filter(item => item.code === 'EQUATION_RATE_UNSUPPORTED').flatMap(item => item.nodeIds!)).toEqual(['delay', 'gain', 'sum', 'result']);
    expect(text(report, 'summary-delay')).toBeUndefined();
    expect(text(report, 'initial-delay')).toBeUndefined();
    expect((await runModel(compileModel(input))).samples.map(sample => sample.values.result)).toEqual([0, 0, 0, 1, 1, 1.9]);
  });

  it('identifies reset conditions and continuous-discrete state boundaries explicitly', () => {
    const input = cloneExample('discrete-feedback');
    input.nodes.find(item => item.id === 'delay')!.parameters.reset = 'level';
    input.nodes.push(node('reset', 'source.constant', { value: false }));
    input.edges.push(edge('reset', 'delay', 'reset'));
    const report = explainDiagram(input);
    expect(report.status).toBe('partial');
    expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: 'EQUATION_RESET_UNSUPPORTED', nodeIds: ['delay'] }));
    expect(text(report, 'summary-delay')).toBeUndefined();
    const hybrid = cloneExample('discrete-feedback');
    hybrid.execution.mode = 'continuous';
    const hybridReport = explainDiagram(hybrid);
    expect(hybridReport.status).toBe('partial');
    expect(hybridReport.diagnostics).toContainEqual(expect.objectContaining({ code: 'EQUATION_HYBRID_UNSUPPORTED', nodeIds: ['delay'] }));
    expect(text(hybridReport, 'summary-delay')).toBeUndefined();
  });

  it('rejects malformed models and stale missing connections through the normal compiler', () => {
    const input = cloneExample('first-calculation');
    input.edges[0]!.source.nodeId = 'missing';
    expect(explainDiagram(input)).toMatchObject({ status: 'invalid', equations: [], diagnostics: expect.arrayContaining([expect.objectContaining({ code: 'UNKNOWN_ENDPOINT' })]) });
    input.nodes[0]!.parameters.value = Infinity;
    expect(explainDiagram(input)).toMatchObject({ status: 'invalid', equations: [], diagnostics: [expect.objectContaining({ code: 'NONFINITE_INPUT' })] });
    expect(explainDiagram(null as unknown as CalcModel).status).toBe('invalid');
  });

  it('keeps injection-like labels as bounded data and never inserts them into formula syntax', () => {
    const input = cloneExample('first-calculation');
    const label = '<img src=x onerror=alert(1)>; globalThis.bad=true';
    input.nodes[0]!.label = label;
    const report = explainDiagram(input);
    expect(report.variables[0]!.label).toBe(label);
    expect(report.equations.flatMap(item => item.terms).every(item => !item.text.includes('<img') && !item.text.includes('globalThis'))).toBe(true);
    expect(text(report, 'summary-result')).toBe('y3 = 3 × 2');
    const unsafe = structuredClone(input) as unknown as Record<string, unknown>;
    let accessed = false;
    Object.defineProperty(unsafe, 'name', { enumerable: true, get() { accessed = true; return 'unsafe'; } });
    expect(explainDiagram(unsafe as unknown as CalcModel).status).toBe('invalid');
    expect(accessed).toBe(false);
  });

  it('bounds text expansion for shared fan-out and explains all skipped root nodes at the output cap', () => {
    const nodes = [node('value', 'source.constant', { value: 1 })];
    const edges: CalcEdge[] = [];
    let last = 'value';
    for (let i = 0; i < 280; i++) { const id = `sum${i}`; nodes.push(node(id, 'math.sum')); edges.push(edge(last, id, 'a'), edge(last, id, 'b')); last = id; }
    nodes.push(node('result', 'sink.display')); edges.push(edge(last, 'result'));
    const report = explainDiagram(model(nodes, edges));
    expect(report.status).toBe('partial');
    expect(report.equations.length).toBeLessThanOrEqual(256);
    expect(report.diagnostics.filter(item => item.code === 'EQUATION_OUTPUT_LIMIT').length).toBe(nodes.length - 256);
    expect(text(report, 'summary-result')).toBeUndefined();
    expect(JSON.stringify(report).length).toBeLessThan(200_000);
  });

  it('covers actual registered examples without returning symbols for absent root nodes', () => {
    for (const example of EXAMPLES) {
      const report = explainDiagram(example.model);
      expect(report.status, example.id).not.toBe('invalid');
      const ids = new Set(example.model.nodes.map(item => item.id));
      expect(report.equations.every(equation => equation.nodeIds.every(id => ids.has(id))), example.id).toBe(true);
      expect(report.equations.flatMap(equation => equation.terms).every(item => !item.text.includes('undefined')), example.id).toBe(true);
    }
  });
});
