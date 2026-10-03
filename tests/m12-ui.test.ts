import { createElement } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { BlockNode } from '../apps/web/src/components/BlockNode';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { analyzeExpressionGradient, compareModelResolution } from '../packages/analysis/src';
import { normalizeSolverSettings } from '../packages/model/src';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { EXAMPLES, EXAMPLE_CATEGORIES, createExample } from '../apps/web/src/examples';
import { solverEventLabel, solverMethodLabel, solverSettingsForMethod } from '../apps/web/src/solver-presentation';
import { AnalysisDialog, GradientSummary, ResolutionSummary } from '../apps/web/src/components/AnalysisDialog';
import { SolverRunDetails } from '../apps/web/src/components/SolverRunDetails';
import { applyHierarchyView, hierarchyView, updateSubsystemInstances } from '../apps/web/src/hierarchy-editor';

describe('M12 solver and analysis presentation', () => {
  it('names the actual independent implicit method and preserves legacy event labels', () => {
    expect(solverMethodLabel('implicit-euler')).toBe('암시적 Euler'); expect(solverMethodLabel('rk45')).toBe('RK45');
    expect(solverEventLabel('crossing')).toBe('경계 통과'); expect(solverEventLabel('reset')).toBe('초기값 reset');
  });
  it('keeps RK settings shapes unchanged and removes IE-only options on method changes', () => {
    const execution = createExample('continuous-decay').execution, before = structuredClone(execution);
    const implicit = solverSettingsForMethod(execution, 'implicit-euler');
    expect(implicit).toMatchObject({ method: 'implicit-euler', newtonTolerance: 1e-9, newtonMaxIterations: 24, jacobianStep: 1e-6 });
    const rk = solverSettingsForMethod({ ...execution, solver: { ...implicit, atol: 1e-7, maxEvents: 23 } }, 'rk4');
    expect(rk).toMatchObject({ method: 'rk4', atol: 1e-7, maxEvents: 23 });
    expect(rk).not.toHaveProperty('newtonTolerance'); expect(rk).not.toHaveProperty('newtonMaxIterations'); expect(rk).not.toHaveProperty('jacobianStep');
    expect(normalizeSolverSettings({ ...execution, solver: rk }).method).toBe('rk4'); expect(execution).toEqual(before);
    expect(normalizeSolverSettings(execution)).not.toHaveProperty('newtonTolerance');
  });
  it('retains explicitly chosen IE convergence values through normalization', () => {
    const model = createExample('stiff-implicit-decay'); model.execution.solver = { ...model.execution.solver, newtonTolerance: 1e-10, newtonMaxIterations: 32, jacobianStep: 1e-5 };
    const settings = normalizeSolverSettings(model.execution); expect(settings).toMatchObject({ newtonTolerance: 1e-10, newtonMaxIterations: 32, jacobianStep: 1e-5 });
    expect(() => normalizeSolverSettings({ ...model.execution, solver: { ...settings, newtonMaxIterations: 33 } })).toThrow();
  });
  it('displays the real polynomial gradient, both difference resolutions and exact error estimate', () => {
    const result = analyzeExpressionGradient('x^2 + 3*x', 2);
    expect(result.derivative).toBeCloseTo(7, 8);
    const html = renderToStaticMarkup(createElement(GradientSummary, { result }));
    for (const value of [result.value, result.derivative, result.differenceEstimate]) expect(html).toContain(String(value));
    expect(html).toContain('h/2에서의 차분'); expect(html).toContain('5회');
  });
  it('renders two actual solver resolutions with escaped labels and original exact difference values', async () => {
    const model = createExample('continuous-decay'); model.name = '<img src=x onerror=alert(1)>';
    const result = await compareModelResolution(model, 2);
    expect(result.status).toBe('completed'); expect(result.coarse.status).toBe('completed'); expect(result.fine?.status).toBe('completed'); expect(result.maximumAbsoluteDifference).toBeGreaterThan(0);
    const html = renderToStaticMarkup(createElement(ResolutionSummary, { result, model }));
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img'); expect(html).toContain(String(result.maximumAbsoluteDifference)); expect(html).toContain('출력별 실제 차이'); expect(html).toContain('completed / completed');
  });
  it('shows actual stiff solver statistics and bounded analysis form affordances', async () => {
    const model = createExample('stiff-implicit-decay'), result = await runModel(compileModel(model));
    const stats = renderToStaticMarkup(createElement(SolverRunDetails, { result, model }));
    expect(stats).toContain('암시적 Euler 실행 기록'); expect(stats).toContain(result.solverStatistics!.acceptedSteps.toLocaleString()); expect(stats).toContain('거절 스텝');
    const form = renderToStaticMarkup(createElement(AnalysisDialog, { model, busy: false, invalidDraft: false, onClose: () => {} }));
    expect(form).toContain('수식 기울기'); expect(form).toContain('모델 해상도'); expect(form.toLowerCase()).toContain('maxlength="512"'); expect(form).toContain('상대 차분 간격');
  });
  it('opens and edits the actual referenced analysis plant and refreshes the second request explicitly', () => {
    const model = createExample('local-linearization-requests'), view = hierarchyView(model, ['timed']); expect(view.definition?.id).toBe('linearPlant');
    const edited = applyHierarchyView(model, ['timed'], { ...view.model, nodes: view.model.nodes.map(node => node.id === 'state' ? { ...node, parameters: { ...node.parameters, A: [[-3]] } } : node) });
    expect(edited.nodes.find(node => node.id === 'timed')!.parameters.version).toBe(2); expect(edited.nodes.find(node => node.id === 'triggered')!.parameters.version).toBe(1);
    expect(updateSubsystemInstances(edited).nodes.find(node => node.id === 'triggered')!.parameters.version).toBe(2);
  });
  it('renders a plain compact M12 name while keeping its support metadata accessible', () => {
    const block = createExample('continuous-state-limits').nodes.find(node => node.blockType === 'continuous.integrator-limited')!;
    const html = renderToStaticMarkup(createElement(ReactFlowProvider, null, createElement(BlockNode, { id: block.id, data: { block }, type: 'calcBlock', dragging: false, zIndex: 0, selectable: true, deletable: true, selected: false, draggable: true, isConnectable: true, positionAbsoluteX: 0, positionAbsoluteY: 0 })));
    expect(html).toContain('>Integrator Limited</div>'); expect(html).toContain('min-height:96px'); expect(html).toContain('Integrator Limited (Selected)');
    expect(html.match(/class="block-name[^"]*"[^>]*>(.*?)<\/div>/)?.[1]).not.toContain('Selected');
  });
  it('preserves every earlier category and adds eight executable solver examples', () => {
    expect(EXAMPLES).toHaveLength(61); expect(new Set(EXAMPLES.map(example => example.id)).size).toBe(61); expect(EXAMPLE_CATEGORIES).toHaveLength(9);
    expect(EXAMPLES.filter(example => example.category === 'solver')).toHaveLength(8); expect(EXAMPLES.filter(example => example.category === 'hierarchy')).toHaveLength(8);
    for (const id of ['first-calculation', 'continuous-decay', 'typed-integer64', 'controlled-variant']) expect(EXAMPLES.some(example => example.id === id)).toBe(true);
  });
});
