import { useMemo, useState } from 'react';
import { explainDiagram } from '../../../../packages/analysis/src/diagram-equations';
import type { CalcModel, RunResult } from '../../../../packages/model/src';
import { evaluateGuidedLesson, getGuidedLesson, GUIDED_LESSONS, lessonNumber, type GuidedLesson, type LessonAssessment } from '../learning';
import './EquationLearningPanel.css';

export interface EquationLearningPanelProps {
  model: CalcModel;
  selectedIds: string[];
  onSelectNodes: (ids: string[]) => void;
  activeLessonId: string | null;
  onStartLesson: (id: string) => void;
  onEndLesson: () => void;
  result: RunResult | null;
  resultCurrent: boolean;
  busy: boolean;
  invalidDraft: boolean;
  onRun: () => void;
}

function GuidedActivity({ lesson, assessment, onSelectNodes, onRun, onEndLesson, onStartLesson, busy, invalidDraft }: {
  lesson: GuidedLesson;
  assessment: LessonAssessment;
  onSelectNodes: EquationLearningPanelProps['onSelectNodes'];
  onRun: () => void;
  onEndLesson: () => void;
  onStartLesson: EquationLearningPanelProps['onStartLesson'];
  busy: boolean;
  invalidDraft: boolean;
}) {
  const [prediction, setPrediction] = useState('');
  const [reflection, setReflection] = useState('');
  const [revealed, setRevealed] = useState(false);
  const currentComparison = !busy && !invalidDraft && ['verified', 'difference'].includes(assessment.status);
  const showExplanation = !invalidDraft && (revealed || currentComparison);
  return <section className="equation-learning-activity" aria-label={`${lesson.title} 학습`}>
    <div className="equation-section-heading"><h3>{lesson.title}</h3><button className="equation-text-button" onClick={onEndLesson}>학습 닫기</button></div>
    <p>{lesson.description}</p>
    <ol className="equation-lesson-steps">
      <li><h4>예측하기</h4><p>{lesson.prediction}</p><label className="equation-writing-field"><span>나의 예상 <span className="equation-optional">선택</span></span><textarea aria-label="학습 예상" maxLength={240} rows={2} value={prediction} onChange={event => setPrediction(event.target.value.slice(0, 240))} placeholder="예상 값이나 변화 방향을 짧게 적어 보세요."/></label></li>
      <li><h4>바꾸기</h4><p>{lesson.edit}</p><div className="equation-edit-actions">{lesson.editNodeIds.map(id => <button key={id} className="button" disabled={busy} onClick={() => onSelectNodes([id])}>{id === 'gain' ? '배율 설정' : '초기값 설정'}</button>)}</div></li>
      <li><h4>실행하고 관찰하기</h4><p>계산 결과 탭에서 곡선과 원시 값을 함께 확인할 수 있습니다.</p><button className="button primary" disabled={busy || invalidDraft || assessment.status === 'mismatch'} onClick={onRun}>{busy ? '실행 중' : '현재 도식 실행'}</button></li>
      <li><h4>설명하기</h4><p>{lesson.reflection}</p><label className="equation-writing-field"><span>나의 설명 <span className="equation-optional">선택</span></span><textarea aria-label="학습 관찰 설명" maxLength={500} rows={3} value={reflection} onChange={event => setReflection(event.target.value.slice(0, 500))} placeholder="예상과 실제 결과를 비교하고 이유를 적어 보세요."/></label></li>
    </ol>
    <p className={`equation-assessment ${currentComparison && assessment.status === 'verified' ? 'is-verified' : ''}`} role="status">{invalidDraft ? '편집 중인 입력값을 먼저 확인하세요. 현재 입력으로 수식과 결과를 비교할 수 없습니다.' : busy ? '현재 실행을 기다리고 있습니다. 이전 결과로 일치 여부를 판정하지 않습니다.' : assessment.message}</p>
    {assessment.status === 'mismatch' && <button className="button" disabled={busy || invalidDraft} onClick={() => { setPrediction(''); setReflection(''); setRevealed(false); onStartLesson(lesson.id); }}>학습 예제 다시 열기</button>}
    {assessment.formula && !showExplanation && <button className="equation-text-button equation-reveal" disabled={invalidDraft} onClick={() => setRevealed(true)}>수식의 예상값 살펴보기</button>}
    {showExplanation && assessment.formula && <div className="equation-lesson-explanation" data-testid="lesson-explanation"><p className="equation-lesson-formula">{assessment.formula}</p><p>{assessment.expectedSummary}</p>{assessment.observations.length > 0 && <div className="equation-table-scroll"><table aria-label="학습 예상값 비교"><thead><tr><th>시간 (s)</th><th>수식 예상</th><th>현재 실행</th></tr></thead><tbody>{assessment.observations.map(observation => <tr key={observation.time}><td>{lessonNumber(observation.time)}</td><td>{lessonNumber(observation.expected)}</td><td>{currentComparison && observation.actual !== null ? lessonNumber(observation.actual) : '실행 필요'}</td></tr>)}</tbody></table></div>}<p className="equation-small-note">수치 비교는 관측값의 일치 여부를 확인합니다. 작성한 예상·설명의 정답을 자동 판정하지 않습니다.{lesson.id === 'continuous-decay' ? ' 연속 해석값 비교 허용오차는 10⁻⁵ + |예상값| × 10⁻⁴입니다.' : ' 비교 허용오차는 10⁻⁹ × max(1, |예상값|)입니다.'}</p></div>}
    <p className="equation-small-note">{lesson.id === 'discrete-feedback' ? '한 틱은 현재 시간 간격입니다. 상태 초기화 없이 모든 블록이 같은 틱에 실행되는 도식을 비교합니다. ' : lesson.id === 'continuous-decay' ? '시작 시각의 초기값과 상태 초기화 없는 적분 피드백을 비교합니다. ' : ''}예상·설명은 이 학습 화면에만 머뭅니다. 값을 바꿔도 글은 유지하며, 학습을 다시 열거나 화면을 닫으면 사라집니다.</p>
  </section>;
}

export function EquationLearningPanel({ model, selectedIds, onSelectNodes, activeLessonId, onStartLesson, onEndLesson, result, resultCurrent, busy, invalidDraft, onRun }: EquationLearningPanelProps) {
  const report = useMemo(() => explainDiagram(model), [model]);
  const lesson = getGuidedLesson(activeLessonId);
  const assessment = useMemo(() => lesson ? evaluateGuidedLesson(model, lesson.id, result, resultCurrent && !busy && !invalidDraft) : null, [model, lesson, result, resultCurrent, busy, invalidDraft]);
  const nodeIds = new Set(model.nodes.map(node => node.id));
  const select = (ids: string[]) => onSelectNodes([...new Set(ids)].filter(id => nodeIds.has(id)));
  return <div className="equation-learning-panel" data-testid="equation-learning-panel">
    <header className="equation-learning-heading"><h2>도식을 수식으로 읽기</h2><p>수식의 항을 누르면 연결된 블록이 선택됩니다. 값은 오른쪽 블록 설정에서 바꿀 수 있습니다.</p></header>
    {lesson && assessment && <GuidedActivity key={lesson.id} lesson={lesson} assessment={assessment} onSelectNodes={select} onRun={onRun} onEndLesson={onEndLesson} onStartLesson={onStartLesson} busy={busy} invalidDraft={invalidDraft}/>}
    {!lesson && <section className="equation-learning-picker" aria-label="수식 학습 예제"><h3>세 가지 학습 예제</h3><p>예측하고, 값을 바꾸고, 실행한 뒤 결과를 설명해 보세요. 예제를 열면 현재 도식이 바뀌며 실행 취소로 복원할 수 있습니다.</p><div className="equation-lesson-options">{GUIDED_LESSONS.map(item => <button key={item.id} className="equation-lesson-option" disabled={busy || invalidDraft} onClick={() => onStartLesson(item.id)}><strong>{item.title}</strong><span>{item.description}</span></button>)}</div></section>}
    <section className="equation-report" aria-label="현재 도식의 수식">
      {lesson && <h3>현재 도식의 수식</h3>}
      {invalidDraft ? <p className="equation-report-notice" role="status">입력값 수정 중입니다. 유효한 값을 입력하면 현재 도식의 수식이 갱신됩니다.</p> : <>
        {report.status !== 'supported' && <p className="equation-report-notice" role="status">{report.status === 'invalid' ? '도식의 연결과 설정을 확인하면 수식을 표시할 수 있습니다.' : '설명 가능한 식을 표시했습니다. 아직 수식으로 읽을 수 없는 블록은 아래 안내에서 확인하세요.'}</p>}
        <div className="equation-rows">{report.equations.map(equation => <article className={`equation-row ${equation.nodeIds.some(id => selectedIds.includes(id)) ? 'is-selected' : ''}`} key={equation.id} data-testid={`equation-${equation.id}`}>
          <div className="equation-row-heading"><h4>{equation.title}</h4>{equation.unit && <span>{equation.unit === '1' ? '단위 없음' : equation.unit}</span>}</div>
          <p className="equation-formula">{equation.terms.map((term, index) => term.nodeIds.some(id => nodeIds.has(id)) ? <button className="equation-term" key={index} aria-label={`${equation.title}: ${term.text}의 블록 선택`} aria-pressed={term.nodeIds.some(id => selectedIds.includes(id))} disabled={busy} onClick={() => select(term.nodeIds)}>{term.text}</button> : <span key={index}>{term.text}</span>)}</p>
          {equation.note && <p className="equation-row-note">{equation.note}</p>}
        </article>)}</div>
        {report.variables.length > 0 && <details className="equation-variable-legend"><summary>기호와 블록 · {report.variables.length}</summary><dl>{report.variables.map(variable => <div key={`${variable.nodeId}-${variable.symbol}`}><dt><button className="equation-text-button" disabled={busy} onClick={() => select([variable.nodeId])}>{variable.symbol}</button></dt><dd>{variable.label}<span>{variable.unit === '1' || !variable.unit ? '단위 없음' : variable.unit}</span></dd></div>)}</dl></details>}
        {report.diagnostics.length > 0 && <ul className="equation-diagnostics" aria-label="수식 표시 안내">{report.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.code}-${index}`}><p>{diagnostic.message}</p>{diagnostic.nodeIds?.some(id => nodeIds.has(id)) && <button className="equation-text-button" disabled={busy} onClick={() => select(diagnostic.nodeIds!)}>관련 블록 선택</button>}</li>)}</ul>}
        {!report.equations.length && report.status === 'supported' && <p className="equation-report-notice">블록을 연결하면 수식이 이곳에 표시됩니다.</p>}
      </>}
    </section>
  </div>;
}
