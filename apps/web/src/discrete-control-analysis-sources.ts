import { compileModel } from '../../../packages/compiler/src';
import { ModelError, type CalcModel } from '../../../packages/model/src';
import { sha256 } from '../../../packages/model/src/sha256';
import { CONTROL_LIMITS } from '../../../packages/analysis/src/control-system';
import { readDiscreteStateSpace, type DiscreteControlStateSpace } from '../../../packages/analysis/src/discrete-control-system';

export interface DiscreteControlAnalysisSource {
  id: string; label: string; kind: 'discrete-state-space-block';
  modelName: string; modelId: string; nodeId: string; semanticHash: string;
  system: DiscreteControlStateSpace;
  sampleTime: { period: number; offset: number; baseStep: number };
  assumptions: string[];
}
const sourceLimit = 64, issueLimit = 8;
function message(error: unknown): string {
  return (error instanceof ModelError ? error.diagnostics[0]?.message : error instanceof Error ? error.message : '분석 출처를 확인하세요.')?.slice(0, 300) ?? '분석 출처를 확인하세요.';
}

/** A local root configuration, never an inferred diagram transfer or a run result.
 * Compilation validates bounded plain data and copies it without invoking accessors.
 * Hybrid discreteStep, reset behaviour and rate-transition dynamics are not inferred.
 */
export function discreteControlAnalysisSources(model: CalcModel): { sources: DiscreteControlAnalysisSource[]; issues: string[] } {
  const sources: DiscreteControlAnalysisSource[] = [], issues: string[] = [];
  const issue = (text: string) => { if (issues.length < issueLimit) issues.push(text); };
  try {
    const compiled = compileModel(model), current = compiled.model;
    if (current.execution.mode !== 'discrete') {
      issue('순수 이산 모델의 루트 이산 상태 공간 설정만 분석합니다. 정적·연속·하이브리드 모델은 지원하지 않습니다.');
      return { sources, issues };
    }
    const semanticHash = sha256(compiled.semanticKey);
    for (const node of current.nodes.filter(node => node.blockType === 'discrete.state-space')) {
      try {
        if (node.parameters.reset !== 'none') throw new Error('실행 중 상태를 바꾸는 리셋이 켜진 블록은 LTI 분석 출처로 지원하지 않습니다.');
        const ir = compiled.nodes.find(item => item.id === node.id);
        if (!ir) throw new Error('컴파일한 루트 블록의 샘플 주기를 확인하지 못했습니다.');
        const { period, offset } = ir.sampleTime, baseStep = current.execution.step;
        const { A, B, C, D } = node.parameters;
        // The compiler has already validated these vectors and their full dimensions.
        const system = readDiscreteStateSpace({ A, B: (B as number[]).map(value => [value]), C: [C], D: [[D]], domain: 'discrete', sampleTime: period * baseStep });
        if (Math.PI / system.sampleTime <= CONTROL_LIMITS.minFrequency) throw new Error('Nyquist가 분석의 최소 주파수 10⁻⁶ rad/s 이하여서 지원하는 주파수 구간이 없습니다.');
        if (sources.length >= sourceLimit) { if (!issues.includes('분석 출처는 최대64개까지 표시합니다.')) issue('분석 출처는 최대64개까지 표시합니다.'); continue; }
        sources.push({ id: `discrete-block:${node.id}`, label: `${node.label} · 현재 이산 설정`, kind: 'discrete-state-space-block',
          modelName: current.name, modelId: current.modelId, nodeId: node.id, semanticHash, system, sampleTime: { period, offset, baseStep },
          assumptions: ['y[k]=Cx[k]+Du[k], x[k+1]=Ax[k]+Bu[k]인 선택 블록의 영 초기상태 LTI 응답입니다. 실제 초기조건의 과도 응답은 포함하지 않습니다.',
            'Ts는 period × 기본 실행 간격입니다. offset은 최초 due 격자의 시간원점이며 별도 위상 지연으로 변환하지 않습니다.',
            '블록 자체의 같은 rate 입력·출력을 분석합니다. 주변 연결·Rate Transition의 지연·다중 rate 폐루프를 자동 추론하지 않습니다.'] });
      } catch (error) { issue(`${node.label}: ${message(error)}`); }
    }
  } catch (error) { issue(`현재 모델: ${message(error)}`); }
  return { sources, issues };
}
