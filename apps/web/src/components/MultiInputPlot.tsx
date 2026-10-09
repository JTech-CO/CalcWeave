import { useCallback, useEffect, useMemo, useState } from 'react';
import type { RunResult, RunSample, SignalDescriptor } from '../../../../packages/model/src';
import type { ScopeTimeWindow } from '../../../../packages/analysis/src/scope-observation';
import { inputComponentChoices, prepareInputOverlay, projectInputObservations } from '../multi-input-observation';
import { ScopePlot } from './ScopePlot';
import './MultiInputPlot.css';

export function MultiInputPlot({ samples, outputId, label, descriptor, status }: { samples: RunSample[]; outputId: string; label: string; descriptor?: SignalDescriptor; status?: RunResult['status'] }) {
  const projection = useMemo(() => projectInputObservations(samples, outputId, descriptor, status), [samples, outputId, descriptor, status]);
  const [mode, setMode] = useState<'overlay' | 'separate'>('overlay');
  const [components, setComponents] = useState<number[]>([]);
  useEffect(() => { setComponents([]); }, [projection]);
  const prepare = useCallback((_series: unknown, _output: string, _component: number, window?: ScopeTimeWindow) => prepareInputOverlay(projection.channels, components, window), [projection, components]);
  return <section className="multi-input-plot" aria-label={`${label} 다중 입력 그래프`} data-testid="multi-input-plot">
    {projection.diagnostics.length ? <p className="plot-empty" role="status">{projection.diagnostics.join(' ')}</p> : <>
      <div className="multi-input-view-options" role="group" aria-label="다중 입력 그래프 보기"><button className="button" aria-pressed={mode === 'overlay'} onClick={() => setMode('overlay')}>그래프 중첩</button><button className="button" aria-pressed={mode === 'separate'} onClick={() => setMode('separate')}>그래프 각각 보기</button></div>
      {mode === 'overlay' ? <>
        <div className="multi-input-components">{projection.channels.map(channel => {
          const choices = inputComponentChoices(channel.descriptor);
          return choices.length > 1 ? <label className="scope-component" key={channel.id}><span>{channel.label} 성분</span><select aria-label={`${channel.label} 그래프 성분`} value={components[channel.inputIndex] ?? 0} onChange={event => setComponents(current => { const next = [...current]; next[channel.inputIndex] = Number(event.target.value); return next; })}>{choices.map(choice => <option key={choice.index} value={choice.index}>{choice.label}</option>)}</select></label> : null;
        })}</div>
        <ScopePlot series={projection.channels} outputId="input" label={`${label} 입력 중첩`} prepareObservation={prepare}/>
      </> : <div className="multi-input-separate">{projection.channels.map(channel => <section className="multi-input-channel" key={channel.id} aria-label={`${channel.label} 그래프`}><h4>{channel.label}</h4><ScopePlot series={[channel]} outputId="input" label={`${label} / ${channel.label}`}/></section>)}</div>}
      <p className="multi-input-preservation-note">각 입력의 원래 자료형·성분·단위를 유지합니다. 그래프 보기 방식은 원시 기록과 실행 설정에 영향을 주지 않습니다.</p>
    </>}
  </section>;
}
