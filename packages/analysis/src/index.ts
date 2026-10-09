import { parseExpression, evaluateExpression } from '../../expression/src';
import { compileModel } from '../../compiler/src';
export * from './diagram-equations';
export * from './scope-observation';
export * from './control-system';
export * from './discrete-control-system';
export * from './spectrum';
export * from './time-series-statistics';
export * from './time-frequency';
import { ModelError, normalizeSolverSettings, parseModel, type CalcModel, type ExpressionNode, type RunResult, type SignalValue } from '../../model/src';
import { runModel } from '../../runtime/src';

export interface ExpressionGradient {
  method: 'central-difference-h-half'; x: number; value: number; relativeStep: number;
  derivative: number; coarseDerivative: number; fineDerivative: number; differenceEstimate: number; evaluations: 5;
}
const fail = (code: string, message: string): never => { throw new ModelError([{ code, message }]); };
const finite = (value: number): number => Number.isFinite(value) ? value : fail('ANALYSIS_NONFINITE', '분석 값은 유한한 float64여야 합니다.');

/** Bounded mathematical grammar; no JavaScript names, callbacks or evaluation. */
export function analyzeExpressionGradient(source: string, x: number, relativeStep = 1e-4): ExpressionGradient {
  if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 1e12 || typeof relativeStep !== 'number' || !Number.isFinite(relativeStep) || relativeStep < 1e-9 || relativeStep > 0.1) fail('ANALYSIS_INPUT', '운전점은±1e12, 상대 차분 간격은1e-9~0.1이어야 합니다.');
  const ast = parseExpression(source);
  const smooth = (node: ExpressionNode): void => {
    if (node.type === 'call') {
      if (['abs', 'min', 'max', 'floor', 'ceil', 'round', 'trunc'].includes(node.name)) fail('ANALYSIS_NONSMOOTH', '불연속·분기 함수의 gradient는 이 도구에서 승인하지 않습니다.');
      node.args.forEach(smooth);
    } else if (node.type === 'binary') { smooth(node.left); smooth(node.right); }
    else if (node.type === 'unary') smooth(node.argument);
  };
  smooth(ast);
  const h = relativeStep * Math.max(1, Math.abs(x));
  const difference = (step: number): number => {
    const a = x + step, b = x - step, separation = a - b;
    if (!(separation > 0) || !Number.isFinite(separation)) fail('ANALYSIS_RESOLUTION', '운전점에서 차분 간격을 표현할 수 없습니다.');
    return finite((evaluateExpression(ast, a) - evaluateExpression(ast, b)) / separation);
  };
  const value = evaluateExpression(ast, x), coarseDerivative = difference(h), fineDerivative = difference(h / 2);
  return { method: 'central-difference-h-half', x, value, relativeStep, derivative: finite(fineDerivative + (fineDerivative - coarseDerivative) / 3), coarseDerivative, fineDerivative, differenceEstimate: finite(Math.abs(fineDerivative - coarseDerivative) / 3), evaluations: 5 };
}

export interface ResolutionComparison {
  status: 'completed' | 'cancelled'; ratio: number; samplesCompared: number; elementsCompared: number;
  maximumAbsoluteDifference: number; maximumScaledDifference: number; excludedOutputs: string[];
  outputs: { id: string; unit: string; maximumAbsoluteDifference: number; maximumScaledDifference: number }[];
  coarse: RunResult; fine?: RunResult;
}

/** Two actual executions keep the observation grid; only internal solver step bounds change. */
export async function compareModelResolution(input: CalcModel, ratio = 2, signal?: AbortSignal): Promise<ResolutionComparison> {
  if (!Number.isInteger(ratio) || ratio < 2 || ratio > 8) fail('ANALYSIS_RATIO', '해상도 비교 배율은2~8의 정수여야 합니다.');
  const model = parseModel(input);
  if (model.execution.mode !== 'continuous') fail('ANALYSIS_MODE', '내부 solver 해상도 비교에는 연속 시뮬레이션이 필요합니다.');
  const solver = normalizeSolverSettings(model.execution), compiled = compileModel(model);
  const included = compiled.outputIds.filter(id => compiled.outputTypes[id]!.valueType === 'float64');
  const excludedOutputs = compiled.outputIds.filter(id => !included.includes(id));
  if (!included.length) fail('ANALYSIS_OUTPUT_UNSUPPORTED', '비교할 legacy float64 출력이 필요합니다. Typed·bus·message·boolean 출력은 자동 cast하지 않습니다.');
  const refined = structuredClone(model);
  refined.execution.solver = { ...solver, initialStep: solver.initialStep / ratio, minStep: Math.min(solver.minStep, solver.initialStep / ratio), maxStep: solver.maxStep / ratio };
  normalizeSolverSettings(refined.execution);
  const started = performance.now();
  const execute = (model: CalcModel): Promise<RunResult> => runModel(compileModel(model), { signal, trackOperations: true, maxWallMs: Math.max(1, Math.min(15_000, 30_000 - (performance.now() - started))), maxOperations: 25_000_000, maxRecordedValues: 500_000 });
  const coarse = await execute(model);
  const base: ResolutionComparison = { status: 'cancelled', ratio, samplesCompared: 0, elementsCompared: 0, maximumAbsoluteDifference: 0, maximumScaledDifference: 0, excludedOutputs, outputs: [], coarse };
  if (coarse.status !== 'completed') return base;
  const fine = await execute(refined); base.fine = fine;
  if (fine.status !== 'completed') return base;
  if (coarse.samples.length !== fine.samples.length || coarse.samples.some((sample, i) => sample.time !== fine.samples[i]!.time)) fail('ANALYSIS_TIME_GRID', '두 실행의 관측 시간 격자가 다릅니다.');
  const flat = (value: SignalValue): number[] => Array.isArray(value) ? (value as number[] | number[][]).flat() : typeof value === 'number' ? [value] : fail('ANALYSIS_OUTPUT_UNSUPPORTED', 'legacy float64 값을 확인하세요.');
  for (const id of included) {
    let maximumAbsoluteDifference = 0, maximumScaledDifference = 0;
    coarse.samples.forEach((sample, i) => {
      const a = flat(sample.values[id]!), b = flat(fine.samples[i]!.values[id]!);
      if (a.length !== b.length) fail('ANALYSIS_OUTPUT_SHAPE', '출력 형상이 달라졌습니다.');
      a.forEach((value, j) => {
        const difference = finite(Math.abs(finite(value) - finite(b[j]!))), scaled = finite(difference / Math.max(1, Math.abs(value), Math.abs(b[j]!)));
        maximumAbsoluteDifference = Math.max(maximumAbsoluteDifference, difference); maximumScaledDifference = Math.max(maximumScaledDifference, scaled); base.elementsCompared++;
      });
    });
    base.outputs.push({ id, unit: compiled.outputTypes[id]!.unit, maximumAbsoluteDifference, maximumScaledDifference });
    base.maximumAbsoluteDifference = Math.max(base.maximumAbsoluteDifference, maximumAbsoluteDifference); base.maximumScaledDifference = Math.max(base.maximumScaledDifference, maximumScaledDifference);
  }
  base.status = 'completed'; base.samplesCompared = coarse.samples.length;
  return base;
}
