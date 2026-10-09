import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { ENGINE_VERSION, type SignalDescriptor } from '../packages/model/src';
import { sha256 } from '../packages/model/src/sha256';
import { runMultiParameterSweep } from '../packages/experiments/src/multivariable';
import type { EnsemblePoint, EnsembleResult } from '../packages/experiments/src/uncertainty';
import { EXAMPLES } from '../apps/web/src/examples';
import { EnsembleAnalysisSummary, EnsembleEnvelopeGraph, UncertaintyEnsemblePanel, ensembleDraftSpec, ensembleOutputIds, ensembleReportExport, ensembleTargets, type EnsembleParameterDraft, type EnsembleSettingsDraft, type UncertaintyEnsembleProps } from '../apps/web/src/components/UncertaintyEnsemblePanel';

const model = structuredClone(EXAMPLES.find(example => example.id === 'first-calculation')!.model), compiled = compileModel(model);
const settings: EnsembleSettingsDraft = { seed: '1', sampleCount: '16', outputId: 'result', unit: '1' };
const draft: EnsembleParameterDraft = { nodeId: 'gain', kind: 'uniform', lower: '1', upper: '4', mode: '2' };
let captured: EnsembleResult;
beforeAll(async () => {
  const grid = await runMultiParameterSweep(model, { axes: [{ nodeId: 'gain', parameter: 'gain', values: [1, 2, 4] }] });
  captured = {
    status: 'completed', baseModel: structuredClone(compiled.model), baseSemanticHash: sha256(compiled.semanticKey),
    spec: { seed: 7, sampleCount: 3, parameters: [{ nodeId: 'gain', parameter: 'gain', distribution: { kind: 'triangular', lower: 1, mode: 2, upper: 4 } }], outputId: 'result', unit: '1' },
    prng: { algorithm: 'lcg32-1664525-1013904223', drawOrder: 'sample-then-parameter', uniform: '(state+0.5)/2^32' },
    records: grid.records.map((run, index) => ({ id: `sample${index + 1}`, parameters: structuredClone(run.parameters), status: 'completed', run, diagnostics: [] })),
    counts: { requested: 3, attempted: 3, completed: 3, failed: 0, cancelled: 0, notStarted: 0 },
    statistics: { status: 'completed', outputId: 'result', unit: '1', recordIds: ['sample1', 'sample2', 'sample3'], standardDeviationConvention: 'sample-n-minus-one', quantileConvention: 'linear-n-minus-one', points: [{ time: 0, count: 3, mean: 14 / 3, standardDeviation: Math.sqrt(28 / 3), minimum: 2, maximum: 8, q05: 2.2, median: 4, q95: 7.6 }], diagnostics: [] },
    resources: { operations: 30, recordedValues: 6, wallMs: 1 }, diagnostics: [],
  };
});
function props(extra: Partial<UncertaintyEnsembleProps> = {}): UncertaintyEnsembleProps { return { model, outputTypes: compiled.outputTypes, busy: false, notice: () => {}, onCancelSweep: () => {}, onEnsemble: async () => {}, ...extra }; }
function parse(parameters = [draft], overrides: Partial<EnsembleSettingsDraft> = {}) { return ensembleDraftSpec(model, compiled.outputTypes, parameters, { ...settings, ...overrides }); }
function record(): EnsembleResult { return structuredClone(captured); }

describe('M23 bounded ensemble drafts and captured uncertainty reports', () => {
  it('admits only supported finite scalar coefficient blocks without shrinking vectors or typed values', () => {
    const changed = structuredClone(model);
    changed.nodes.push({ ...changed.nodes[0], id: 'vector', parameters: { value: [1, 2] } }, { ...changed.nodes[0], id: 'typed', parameters: { value: { kind: 'typed', dtype: 'float64', shape: [], data: ['3ff0000000000000'] } } }, { ...changed.nodes[0], id: 'huge', parameters: { value: 1e13 } }, { ...changed.nodes[0], id: 'nonfinite', parameters: { value: NaN } });
    expect(ensembleTargets(changed).map(node => node.id)).toEqual(['value', 'gain']);
  });
  it('selects only legacy float64 scalar outputs', () => {
    const descriptor = compiled.outputTypes.result;
    const outputTypes: Record<string, SignalDescriptor> = { scalar: descriptor, typed: { ...descriptor, valueType: 'typed' }, represented: { ...descriptor, representation: 'copy' }, vector: { ...descriptor, shape: [2] }, boolean: { ...descriptor, valueType: 'boolean' } };
    expect(ensembleOutputIds(outputTypes)).toEqual(['scalar']);
  });
  it('captures independent distribution bounds and parses finite decimal exponents', () => {
    const parsed = parse([{ ...draft, lower: ' -1e2 ', upper: '+2.5e1', mode: '' }], { seed: ' 0 ', sampleCount: '64' });
    expect(parsed).toEqual({ error: '', spec: { seed: 0, sampleCount: 64, outputId: 'result', unit: '1', parameters: [{ nodeId: 'gain', parameter: 'gain', distribution: { kind: 'uniform', lower: -100, upper: 25 } }] } });
    expect(parse([{ ...draft, kind: 'triangular', mode: '1' }], { seed: '4294967295', sampleCount: '2' }).spec?.parameters[0].distribution).toEqual({ kind: 'triangular', lower: 1, mode: 1, upper: 4 });
    expect(parse([{ ...draft, kind: 'triangular', mode: '4' }]).spec).toBeDefined();
  });
  it('accepts the coefficient magnitude boundary and at most three distinct targets', () => {
    const three = structuredClone(model); three.nodes.push({ ...three.nodes[0], id: 'third' });
    expect(ensembleDraftSpec(three, compiled.outputTypes, [{ ...draft, lower: '-1e12', upper: '1e12' }, { ...draft, nodeId: 'value' }, { ...draft, nodeId: 'third' }], settings).spec?.parameters.map(parameter => parameter.parameter)).toEqual(['gain', 'value', 'value']);
    expect(parse([]).error).toContain('1~3'); expect(parse([draft, draft]).error).toContain('두 번');
    expect(parse([draft, { ...draft, nodeId: 'value' }, { ...draft, nodeId: 'missing' }, { ...draft, nodeId: 'fourth' }]).error).toContain('1~3');
    expect(parse([{ ...draft, nodeId: 'result' }]).spec).toBeUndefined();
  });
  for (const raw of ['', ' ', '0x10', 'Infinity', 'NaN', 'alert(1)', '1e13', '1e309', '1'.repeat(101)]) it(`rejects an invalid numeric bound ${JSON.stringify(raw)}`, () => {
    expect(parse([{ ...draft, lower: raw }]).spec).toBeUndefined(); expect(parse([{ ...draft, upper: raw }]).spec).toBeUndefined();
  });
  for (const raw of ['', '0', '1', '65', '-2', '2.5', '2.0', '2e0', '0x2', 'NaN', '2'.repeat(101)]) it(`rejects an invalid sample-count draft ${JSON.stringify(raw)}`, () => expect(parse([draft], { sampleCount: raw }).spec).toBeUndefined());
  for (const raw of ['', '-1', '4294967296', '1.0', '1e0', '0x10', 'Infinity', '01', '1'.repeat(101)]) it(`rejects an invalid uint32 seed draft ${JSON.stringify(raw)}`, () => expect(parse([draft], { seed: raw }).spec).toBeUndefined());
  it('rejects empty intervals, out-of-range triangular modes, unsupported distributions and mismatched output units', () => {
    for (const patch of [{ lower: '4' }, { lower: '5' }, { kind: 'triangular' as const, mode: '' }, { kind: 'triangular' as const, mode: '.9' }, { kind: 'triangular' as const, mode: '4.1' }, { kind: 'normal' as EnsembleParameterDraft['kind'] }]) expect(parse([{ ...draft, ...patch }]).spec).toBeUndefined();
    expect(parse([draft], { outputId: 'unknown' }).error).toContain('legacy'); expect(parse([draft], { unit: 'V' }).error).toContain('정확히'); expect(parse([draft], { unit: '1'.repeat(161) }).spec).toBeUndefined();
  });
  it('starts folded with reproducible defaults, local resource caps and explicit application', () => {
    let applied = 0; const html = renderToStaticMarkup(createElement(UncertaintyEnsemblePanel, props({ onApplyEnsemble: () => { applied++; } })));
    expect(applied).toBe(0); expect(html).toContain('data-testid="ensemble-section"'); expect(html).not.toContain('ensemble-section" open');
    expect(html).toContain('aria-label="앙상블 seed" value="1"'); expect(html).toContain('aria-label="앙상블 표본 수" value="16"'); expect(html).toContain('<option value="uniform" selected="">');
    expect(html).toContain('aria-label="앙상블 하한 1" value="0"'); expect(html).toContain('aria-label="앙상블 상한 1" value="4"');
    expect(html).toContain('32 MiB'); expect(html).toContain('30초'); expect(html).toContain('100만'); expect(html).toContain('5천만'); expect(html).toContain('모델 안의 난수 블록 seed는 바꾸지 않습니다');
    expect(html).not.toContain('aria-label="불확실성 앙상블 결과"');
  });
  it('disables an unavailable, unsupported or busy form while preserving existing reports', () => {
    for (const extra of [{ outputTypes: {} }, { onEnsemble: undefined }, { busy: true }, { model: { ...model, nodes: [] } }]) {
      const html = renderToStaticMarkup(createElement(UncertaintyEnsemblePanel, props(extra)));
      expect(html).toMatch(/disabled=""[^>]*>앙상블 실행/);
    }
    const html = renderToStaticMarkup(createElement(UncertaintyEnsemblePanel, props({ busy: true, ensembleResult: captured, ensembleProgress: { total: 64, completed: 2, attempted: 3, failed: 1, cancelled: 0 } })));
    expect(html).toContain('앙상블 취소'); expect(html).toContain('2 / 64 완료 · 시도 3 · 실패 1 · 취소 0'); expect(html).toContain('실행에 사용한 seed 7');
  });
  it('exports an independent captured report with exact source, sample values, conventions and units', () => {
    const source = record(), exported = ensembleReportExport(source);
    expect(exported).toMatchObject({ schemaVersion: 1, kind: 'uncertainty-ensemble', engineVersion: ENGINE_VERSION });
    expect(exported.result.spec.seed).toBe(7); expect(exported.result.baseSemanticHash).toBe(sha256(compiled.semanticKey)); expect(exported.result.prng.drawOrder).toBe('sample-then-parameter');
    expect(exported.result.records[2].run?.result.samples[0].values.result).toBe(8); expect(exported.result.statistics.points[0]).toMatchObject({ mean: 14 / 3, standardDeviation: Math.sqrt(28 / 3), q05: 2.2, median: 4, q95: 7.6 });
    exported.result.spec.parameters[0].distribution.lower = 999; exported.result.records[0].parameters[0].value = 999; exported.result.baseModel.name = '수정'; exported.result.statistics.points[0].median = 999;
    expect(source.spec.parameters[0].distribution.lower).toBe(1); expect(source.records[0].parameters[0].value).toBe(1); expect(source.statistics.points[0].median).toBe(4); expect(source.baseModel.name).not.toBe('수정');
  });
  it('renders completed-only statistics and uses captured labels and seed after the form model changes', () => {
    const changed = structuredClone(model); changed.nodes.find(node => node.id === 'result')!.label = '현재 출력 이름'; changed.name = '현재 모델 이름';
    const html = renderToStaticMarkup(createElement(UncertaintyEnsemblePanel, props({ model: changed, outputTypes: {}, ensembleResult: captured, ensembleModelCurrent: false, onApplyEnsemble: () => {} })));
    expect(html).toContain('이전 모델의 앙상블'); expect(html).toContain('실행에 사용한 seed 7'); expect(html).toContain('출력 값 표시 · 1'); expect(html).not.toContain('현재 출력 이름');
    expect(html).toContain('통계에는 완료한 표본 3개만'); expect(html).toContain('통계가 편향될 수 있습니다'); expect(html).toContain('신뢰구간'); expect(html).toContain('표본 표준편차'); expect(html).toContain('선형 보간');
    expect(html).toContain('aria-label="앙상블 표본 1 모델 적용" disabled=""'); expect(html).toContain('앙상블 보고서 JSON');
  });
  it('preserves all failed, cancelled and unstarted entries instead of reducing the requested count', () => {
    const result = record(); result.status = 'cancelled'; result.counts = { requested: 4, attempted: 3, completed: 1, failed: 1, cancelled: 1, notStarted: 1 };
    result.records[1].status = 'failed'; result.records[1].diagnostics = [{ code: 'TRIAL_FAILED', message: '표본 실행 실패' }]; result.records[2].status = 'cancelled'; result.records[2].diagnostics = [{ code: 'TRIAL_CANCELLED', message: '표본 취소' }];
    result.records.push({ id: 'sample4', status: 'not-started', parameters: [{ nodeId: 'gain', parameter: 'gain', value: 3 }], diagnostics: [{ code: 'NOT_STARTED', message: '실행하지 않음' }] });
    result.statistics.recordIds = ['sample1']; result.statistics.points[0].count = 1; result.statistics.points[0].standardDeviation = null;
    const html = renderToStaticMarkup(createElement(EnsembleAnalysisSummary, { result, current: true, onApply: () => {} }));
    expect(html).toContain('모든 표본 · 4개'); expect(html).toContain('>실패<span'); expect(html).toContain('>취소<span'); expect(html).toContain('>미실행<span'); expect(html).toContain('TRIAL_FAILED · 표본 실행 실패'); expect(html).toContain('NOT_STARTED · 실행하지 않음');
    expect(html).not.toContain('aria-label="앙상블 표본 1 모델 적용" disabled=""');
    for (const trial of [2, 3, 4]) expect(html).toContain(`aria-label="앙상블 표본 ${trial} 모델 적용" disabled=""`);
    expect(html).toContain('완료한 표본 1개만'); expect(html).toContain('<td>—</td>'); expect(html).toContain('표준편차는 정의하지 않아');
  });
  it('disables application while busy and with no explicit apply callback', () => {
    for (const extra of [{ busy: true, onApply: () => {} }, {}]) {
      const html = renderToStaticMarkup(createElement(EnsembleAnalysisSummary, { result: captured, current: true, ...extra }));
      expect(html).toContain('aria-label="앙상블 표본 1 모델 적용" disabled=""');
    }
  });
  it('bounds the raw table to 128 rows and the time plot to 512 exact selected points', () => {
    const result = record(); result.statistics.points = Array.from({ length: 1000 }, (_, index) => ({ ...result.statistics.points[0], time: index * index / 1000 }));
    const html = renderToStaticMarkup(createElement(EnsembleAnalysisSummary, { result }));
    expect(html).toContain('원시 통계 표 · 1000개 시각'); expect(html).toContain('1 / 8 페이지 · 1~128'); expect(html.match(/<tr>/g)).toHaveLength(133);
    expect(html).toContain('data-point-count="1000" data-rendered-point-count="512"'); expect(html).toContain('처음·마지막을 포함한 512개 시각을 균등 선택');
    expect(html).toContain('전체 값은 원시 통계 표와 JSON'); expect(result.statistics.points).toHaveLength(1000);
  });
  it('plots actual uneven times with labelled quantile, median and mean values', () => {
    const points: EnsemblePoint[] = [0, 1, 10].map((time, index) => ({ ...captured.statistics.points[0], time, median: index + 2, mean: index + 3 }));
    const html = renderToStaticMarkup(createElement(EnsembleEnvelopeGraph, { points, unit: 'V' }));
    expect(html).toContain('class="ensemble-median" d="M18.000,'); expect(html).toContain('L78.400,'); expect(html).toContain('L622.000,');
    expect(html).toContain('q05~q95 범위·중앙값·평균 · V'); expect(html).toContain('실제 기록 시각의 선형 s 축'); expect(html).not.toContain('NaN'); expect(html).not.toContain('Infinity');
  });
  it('handles absent statistics and a single constant point without drawing invalid coordinates', () => {
    const empty = renderToStaticMarkup(createElement(EnsembleEnvelopeGraph, { points: [], unit: '1' })); expect(empty).toContain('통계가 없어 그래프'); expect(empty).not.toContain('<svg');
    for (const value of [0, Number.MAX_VALUE, -Number.MAX_VALUE]) {
      const point = { ...captured.statistics.points[0], minimum: value, maximum: value, q05: value, median: value, q95: value, mean: value };
      const html = renderToStaticMarkup(createElement(EnsembleEnvelopeGraph, { points: [point], unit: '1' })); expect(html).toContain('class="ensemble-median-point"'); expect(html).not.toContain('NaN'); expect(html).not.toContain('Infinity');
    }
  });
  it('escapes captured model, output, units, parameters and diagnostic text', () => {
    const raw = '<img src=x onerror=alert(1)>', result = record(); result.baseModel.name = raw; result.baseModel.nodes.forEach(node => node.label = raw); result.spec.unit = raw; result.statistics.unit = raw;
    result.diagnostics.push({ code: raw, message: raw }); result.records[0].diagnostics.push({ code: raw, message: raw }); result.statistics.diagnostics.push({ code: raw, message: raw });
    const html = renderToStaticMarkup(createElement(EnsembleAnalysisSummary, { result })); expect(html).toContain('&lt;img'); expect(html).not.toContain('<img src=x'); expect(html).not.toContain('<script');
  });
});
