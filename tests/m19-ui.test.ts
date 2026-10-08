import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { runMultiParameterSweep, fitModelParameters, type FitSpec } from '../packages/experiments/src/multivariable';
import { EXAMPLES } from '../apps/web/src/examples';
import { M19ExperimentsPanel, experimentTargets, gridDraftSpec, parseMeasurementCsv, type M19ExperimentsProps } from '../apps/web/src/components/M19ExperimentsPanel';

const model = structuredClone(EXAMPLES.find(example => example.id === 'first-calculation')!.model);
const draft = (nodeId: string, values: string) => ({ nodeId, values, lower: '0', upper: '10', initial: '1' });
function props(extra: Partial<M19ExperimentsProps> = {}): M19ExperimentsProps {
  return { model, outputTypes: compileModel(model).outputTypes, busy: false, notice: () => {}, onCancelSweep: () => {}, onFit: async () => {}, onMultiSweep: async () => {}, ...extra };
}
describe('M19 bounded experiment UI', () => {
  it('lists only finite legacy scalar coefficient blocks in the allowed magnitude', () => {
    const changed = structuredClone(model);
    changed.nodes.push({ ...changed.nodes[0], id: 'vector', parameters: { value: [1, 2] } }, { ...changed.nodes[0], id: 'huge', parameters: { value: 1e13 } }, { ...changed.nodes[0], id: 'typed', parameters: { value: { kind: 'typed', dtype: 'uint64', shape: [], data: ['2'] } } });
    expect(experimentTargets(changed).map(node => node.id)).toEqual(['value', 'gain']);
  });
  it('calculates an actual two-axis Cartesian count and coefficient keys', () => {
    expect(gridDraftSpec(model, [draft('value', '1, 2, 3'), draft('gain', '4,5')])).toEqual({ count: 6, error: '', spec: { axes: [{ nodeId: 'value', parameter: 'value', values: [1, 2, 3] }, { nodeId: 'gain', parameter: 'gain', values: [4, 5] }] } });
  });
  it('accepts the 64-combination boundary and rejects 65 before execution', () => {
    expect(gridDraftSpec(model, [draft('value', Array.from({ length: 64 }, (_, index) => String(index)).join(','))]).spec).toBeDefined();
    expect(gridDraftSpec(model, [draft('value', Array.from({ length: 65 }, (_, index) => String(index)).join(','))]).spec).toBeUndefined();
  });
  for (const values of ['', '1,', '1,,2', 'NaN', 'Infinity', '0x10', '1e13', 'alert(1)', '1,1']) it(`rejects unsafe or ambiguous coefficient draft ${JSON.stringify(values)}`, () => {
    expect(gridDraftSpec(model, [draft('value', values)]).spec).toBeUndefined();
  });
  it('rejects duplicate blocks and a multi-axis product exceeding the cap', () => {
    expect(gridDraftSpec(model, [draft('gain', '1,2'), draft('gain', '3,4')]).error).toContain('두 번');
    expect(gridDraftSpec(model, [draft('value', Array.from({ length: 9 }, (_, index) => String(index)).join(',')), draft('gain', Array.from({ length: 8 }, (_, index) => String(index)).join(','))])).toMatchObject({ count: 72, error: expect.stringContaining('최대 64') });
  });
  it('reads mapped measurement columns through the bounded CSV parser without reordering times', () => {
    expect(parseMeasurementCsv('notes,reading,time\n"first, point",3,0\nsecond,2.5,1\n', 'time', 'reading', 'V')).toEqual([{ time: 0, value: 3 }, { time: 1, value: 2.5 }]);
  });
  for (const csv of ['time,value\n0,1\n0,2', 'time,value\n1,1\n0,2', 'time,value\n0,=2+3', 'time,value\n0,Infinity', 'time,value\n0,', 'time,value\n0,0x10']) it(`rejects invalid measurement CSV ${JSON.stringify(csv)}`, () => {
    expect(() => parseMeasurementCsv(csv, 'time', 'value', '1')).toThrow();
  });
  it('requires distinct known time and value columns', () => {
    expect(() => parseMeasurementCsv('time,value\n0,1', 'time', 'time', '1')).toThrow('서로 다르게');
    expect(() => parseMeasurementCsv('time,value\n0,1', 'time', 'missing', '1')).toThrow('서로 다르게');
  });
  it('accepts 1000 measurements and refuses the next row', () => {
    const body = Array.from({ length: 1000 }, (_, index) => `${index},1`).join('\n');
    expect(parseMeasurementCsv('time,value\n' + body, 'time', 'value', '1')).toHaveLength(1000);
    expect(() => parseMeasurementCsv('time,value\n' + body + '\n1000,1', 'time', 'value', '1')).toThrow('1,000');
  });
  it('enforces the UTF-8 byte cap before parsing, including multibyte text', () => {
    expect(() => parseMeasurementCsv('가'.repeat(90_000), 'time', 'value', '1')).toThrow('256 KiB');
    expect(() => parseMeasurementCsv('a'.repeat(256 * 1024 + 1), 'time', 'value', '1')).toThrow('256 KiB');
  });
  it('offers progressive sections and local-data limits without automatically applying candidates', () => {
    let applied = 0;
    const html = renderToStaticMarkup(createElement(M19ExperimentsPanel, props({ onApplyFit: () => { applied++; } })));
    expect(applied).toBe(0);
    expect(html).toContain('data-testid="multi-sweep-section"'); expect(html).toContain('data-testid="fit-section"');
    expect(html).not.toContain('<details class="tool-section m19-section" open');
    expect(html).toContain('256 KiB'); expect(html).toContain('1,000행'); expect(html).toContain('보간 없이');
    expect(html).toContain('전체 조합'); expect(html).toContain('3 / 64');
  });
  it('renders actual completed grid values and keeps stale-model application disabled', async () => {
    const result = await runMultiParameterSweep(model, { axes: [{ nodeId: 'value', parameter: 'value', values: [2, 3] }, { nodeId: 'gain', parameter: 'gain', values: [3, 4] }] });
    const html = renderToStaticMarkup(createElement(M19ExperimentsPanel, props({ multiSweepResult: result, multiSweepModelCurrent: false, onApplyGrid: () => {} })));
    expect(html).toContain('조합별 결과'); expect(html).toContain('4개'); expect(html).toContain('>6</td>'); expect(html).toContain('>12</td>');
    expect(html).toMatch(/disabled=""[^>]*aria-label="조합 1 모델 적용"/);
    expect(html).toContain('실험 이후 도식이 바뀌었습니다');
  });
  it('uses captured result descriptors and labels after current-model output changes', async () => {
    const result = await runMultiParameterSweep(model, { axes: [{ nodeId: 'gain', parameter: 'gain', values: [2] }] });
    const changed = structuredClone(model); changed.nodes.find(node => node.id === 'result')!.label = '현재 도식의 새 이름';
    const html = renderToStaticMarkup(createElement(M19ExperimentsPanel, props({ model: changed, outputTypes: {}, multiSweepResult: result })));
    expect(html).toContain('값 표시 · 1'); expect(html).not.toContain('현재 도식의 새 이름 · 1');
  });
  it('preserves fitted raw values, escaped labels, units and incomplete termination in reports', async () => {
    const fitSpec: FitSpec = { parameters: [{ nodeId: 'gain', parameter: 'gain', lower: 1, upper: 8, initial: 3 }], outputId: 'result', measurements: [{ time: 0, value: 12 }], unit: '1', maxEvaluations: 1 };
    const result = await fitModelParameters(model, fitSpec);
    expect(result.best?.residuals[0]).toMatchObject({ measured: 12, predicted: 6, residual: -6 });
    result.best!.model.nodes.find(node => node.id === 'gain')!.label = '<img src=x onerror=alert(1)>';
    const html = renderToStaticMarkup(createElement(M19ExperimentsPanel, props({ fitSpec, fitResult: result, fitModelCurrent: false, onApplyFit: () => {} })));
    expect(html).toContain('&lt;img'); expect(html).not.toContain('<img src=x');
    expect(html).toContain('RMSE · 1'); expect(html).toContain('측정값'); expect(html).toContain('잔차');
    expect(html).toMatch(/disabled=""[^>]*>최적 후보 모델 적용/);
    expect(html).toContain('평가 횟수 한도');
  });
});
