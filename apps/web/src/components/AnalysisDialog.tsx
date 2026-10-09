import { useCallback, useEffect, useRef, useState } from 'react';
import { ModelError, ENGINE_VERSION, type CalcModel } from '../../../../packages/model/src';
import type { ExpressionGradient, ResolutionComparison } from '../../../../packages/analysis/src';
import { ExpressionField } from './SignalField';
import { NumericField, NumericValidityContext } from './NumericField';
import { ModalDialog } from './ModalDialog';
import { Icon } from './Icon';
import { downloadText } from './M4WorkspaceTools';
import { ControlSystemPanel } from './ControlSystemPanel';
import { SpectrumPanel } from './SpectrumPanel';
import { DiscreteControlSystemPanel } from './DiscreteControlSystemPanel';
import type { ControlAnalysisRun } from '../control-analysis-sources';

export function GradientSummary({ result }: { result: ExpressionGradient }) {
  return <section className="analysis-result" aria-label="수식 기울기 결과"><h3>x = {String(result.x)}에서의 기울기</h3><dl className="solver-statistics"><div><dt>함수 값</dt><dd>{String(result.value)}</dd></div><div><dt>기울기</dt><dd>{String(result.derivative)}</dd></div><div><dt>h에서의 차분</dt><dd>{String(result.coarseDerivative)}</dd></div><div><dt>h/2에서의 차분</dt><dd>{String(result.fineDerivative)}</dd></div><div><dt>차분 오차 추정</dt><dd>{String(result.differenceEstimate)}</dd></div><div><dt>실제 함수 평가</dt><dd>{result.evaluations}회</dd></div></dl><p className="field-help">중심차분 두 간격을 비교하고 보정한 국소 수치 기울기입니다. 오차 추정은 두 차분의 차이로 계산합니다.</p></section>;
}

export function ResolutionSummary({ result, model }: { result: ResolutionComparison; model: CalcModel }) {
  return <section className="analysis-result" aria-label="모델 해상도 비교 결과"><h3>{model.name} · {result.status === 'completed' ? '비교 완료' : '비교 중단'}</h3><dl className="solver-statistics"><div><dt>내부 간격 분할</dt><dd>{result.ratio}배</dd></div><div><dt>같은 관측 시각</dt><dd>{result.samplesCompared.toLocaleString()}개</dd></div><div><dt>비교한 수치 원소</dt><dd>{result.elementsCompared.toLocaleString()}개</dd></div><div><dt>최대 절대 차이</dt><dd>{String(result.maximumAbsoluteDifference)}</dd></div><div><dt>최대 스케일 차이</dt><dd>{String(result.maximumScaledDifference)}</dd></div><div><dt>실제 실행 상태</dt><dd>{result.coarse.status} / {result.fine?.status ?? '두 번째 실행 전'}</dd></div></dl>{result.outputs.length > 0 && <div className="analysis-table"><table><caption>출력별 실제 차이</caption><thead><tr><th>출력</th><th>단위</th><th>최대 절대 차이</th><th>최대 스케일 차이</th></tr></thead><tbody>{result.outputs.map(output => <tr key={output.id}><th>{model.nodes.find(node => node.id === output.id)?.label ?? output.id}</th><td>{output.unit}</td><td>{String(output.maximumAbsoluteDifference)}</td><td>{String(output.maximumScaledDifference)}</td></tr>)}</tbody></table></div>}<p className="field-help">두 실제 실행은 동일한 출력 시각을 사용합니다. 스케일 차이는 |a−b| / max(1, |a|, |b|)입니다.</p>{result.excludedOutputs.length > 0 && <p className="field-help">별도 자료형으로 보존한 출력: {result.excludedOutputs.map(id => model.nodes.find(node => node.id === id)?.label ?? id).join(', ')}. 비교에는 실수 float64 출력만 참여합니다.</p>}</section>;
}

export function AnalysisDialog({ model, invalidDraft, busy, onClose, linearizationRun, linearizationCurrent }: { model: CalcModel; invalidDraft: boolean; busy: boolean; onClose: () => void; linearizationRun?: ControlAnalysisRun | null; linearizationCurrent?: boolean }) {
  const [mode, setMode] = useState<'gradient' | 'resolution'>('gradient');
  const [source, setSource] = useState('x^2 + 3*x');
  const [x, setX] = useState(2), [relativeStep, setRelativeStep] = useState(1e-4), [ratio, setRatio] = useState(2);
  const [gradient, setGradient] = useState<ExpressionGradient | null>(null);
  const [resolution, setResolution] = useState<{ result: ResolutionComparison; model: CalcModel } | null>(null);
  const [record, setRecord] = useState<unknown>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [invalidCount, setInvalidCount] = useState(0);
  const invalid = useRef(new Set<string>()), alive = useRef(true), controller = useRef<AbortController | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const setValidity = useCallback((id: string, bad: boolean) => { if (bad) invalid.current.add(id); else invalid.current.delete(id); setInvalidCount(invalid.current.size); }, []);
  const calculate = async () => {
    if (pending || invalid.current.size || mode === 'resolution' && (invalidDraft || busy)) return;
    const request = new AbortController(); controller.current = request;
    setPending(true); setError(''); setRecord(null); setGradient(null); setResolution(null);
    try {
      const api = await import('../../../../packages/analysis/src');
      if (!alive.current || request.signal.aborted) return;
      if (mode === 'gradient') {
        const result = api.analyzeExpressionGradient(source, x, relativeStep);
        if (alive.current) { setGradient(result); setRecord({ engineVersion: ENGINE_VERSION, kind: 'expression-gradient', source, result }); }
      } else {
        const snapshot = structuredClone(model), result = await api.compareModelResolution(snapshot, ratio, request.signal);
        if (alive.current) {
          setResolution({ result, model: snapshot });
          const { coarse, fine, ...summary } = result;
          setRecord({ engineVersion: ENGINE_VERSION, kind: 'model-resolution', modelId: snapshot.modelId, modelName: snapshot.name, execution: snapshot.execution, ...summary, runs: { coarse: { status: coarse.status, steps: coarse.steps, statistics: coarse.solverStatistics }, fine: fine ? { status: fine.status, steps: fine.steps, statistics: fine.solverStatistics } : null } });
        }
      }
    } catch (failure) { if (alive.current) setError(failure instanceof ModelError ? failure.diagnostics.map(item => `${item.code}: ${item.message}`).join(' · ') : failure instanceof Error ? failure.message : '분석을 완료하지 못했습니다.'); }
    finally { if (alive.current) setPending(false); }
  };
  return <NumericValidityContext.Provider value={setValidity}><ModalDialog labelId="analysis-title" className="analysis-dialog" onClose={onClose} initialFocus=".dialog-navigation button">
    <div className="dialog-heading"><div><h2 id="analysis-title">수치 분석</h2><p>수식의 국소 기울기와 실제 solver 해상도 차이를 확인합니다.</p></div><button className="icon-button" aria-label="수치 분석 닫기" onClick={onClose}><Icon name="close"/></button></div>
    <nav className="dialog-navigation" aria-label="분석 방식"><button disabled={pending} aria-pressed={mode === 'gradient'} onClick={() => { setMode('gradient'); setError(''); }}>수식 기울기</button><button disabled={pending} aria-pressed={mode === 'resolution'} onClick={() => { setMode('resolution'); setError(''); }}>모델 해상도</button></nav>
    <div className="dialog-content analysis-content">
      {mode === 'gradient' ? <><ExpressionField label="분석 수식" value={source} onChange={setSource} setValidity={setValidity}/><div className="field-pair"><NumericField label="기울기 운전점 x" value={x} min={-1e12} max={1e12} onChange={setX}/><NumericField label="상대 차분 간격" value={relativeStep} min={1e-9} max={0.1} onChange={setRelativeStep}/></div><p className="field-help">부드러운 허용 수식을 5번 평가합니다. 실제 간격은 상대 간격 × max(1, |x|)입니다.</p></> : <><h3>{model.name}</h3><NumericField label="해상도 비교 배율" value={ratio} min={2} max={8} integer onChange={setRatio}/><p className="field-help">현재 연속 모델의 내부 최대·초기 간격을 나눈 두 실행을 같은 출력 시각에서 비교합니다. 각 실행은 15초와 25,000,000 연산·500,000 기록값의 상한을 검사합니다.</p>{model.execution.mode !== 'continuous' && <p className="dialog-error">연속 시뮬레이션 모델을 선택하세요.</p>}{invalidDraft && <p className="dialog-error">모델의 편집 중인 입력값을 먼저 확인하세요.</p>}</>}
      <div className="dialog-actions"><button className="button primary" disabled={pending || invalidCount > 0 || mode === 'resolution' && (invalidDraft || busy || model.execution.mode !== 'continuous')} onClick={() => void calculate()}>{pending ? '분석 중' : mode === 'gradient' ? '기울기 계산' : '해상도 비교 실행'}</button>{pending && mode === 'resolution' && <button className="button" onClick={() => controller.current?.abort()}>분석 중단</button>}{record !== null && <button className="button" onClick={() => downloadText(JSON.stringify(record, null, 2), 'CalcWeave-analysis.json', 'application/json')}>분석 결과 JSON</button>}</div>
      {pending && <p role="status">{mode === 'resolution' ? '두 실제 solver 실행을 비교하고 있습니다.' : '수식을 평가하고 있습니다.'}</p>}{error && <p className="dialog-error" role="alert">{error}</p>}
      {mode === 'gradient' && gradient && <GradientSummary result={gradient}/>} {mode === 'resolution' && resolution && <ResolutionSummary result={resolution.result} model={resolution.model}/>}
      <details className="control-analysis-section"><summary>제어계 분석</summary><ControlSystemPanel model={model} linearizationRun={linearizationRun} linearizationCurrent={linearizationCurrent} busy={busy || pending} invalidDraft={invalidDraft}/></details>
      <details className="discrete-control-analysis-section"><summary>이산 제어계 분석</summary><DiscreteControlSystemPanel model={model} busy={busy || pending} invalidDraft={invalidDraft}/></details>
      <details className="spectrum-analysis-section"><summary>신호 스펙트럼 분석</summary><SpectrumPanel run={linearizationRun} current={linearizationCurrent} busy={busy || pending} invalidDraft={invalidDraft}/></details>
    </div><div className="dialog-footnote">A/B/C/D는 국소 선형화 블록의 실행 결과에서 확인할 수 있습니다.<button className="text-button" onClick={onClose}>닫기</button></div>
  </ModalDialog></NumericValidityContext.Provider>;
}
