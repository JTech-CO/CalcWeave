import { getBlockDefinition } from '../../block-library/src';
import { compileModel } from '../../compiler/src';
import { ModelError, parseModel, type CalcModel, type IRNode, type SignalDescriptor } from '../../model/src';

export interface EquationTerm { text: string; nodeIds: string[] }
export interface DiagramEquation { id: string; title: string; terms: EquationTerm[]; nodeIds: string[]; note?: string; unit?: string }
export interface EquationVariable { symbol: string; nodeId: string; label: string; unit: string }
export interface EquationDiagnostic { code: string; message: string; nodeIds?: string[] }
export interface DiagramEquationReport {
  status: 'supported' | 'partial' | 'invalid';
  equations: DiagramEquation[];
  variables: EquationVariable[];
  diagnostics: EquationDiagnostic[];
}

const MAX_EQUATIONS = 256;
const MAX_EXPANDED_TERMS = 128;
const MAX_EXPANSION_DEPTH = 24;
const states = new Set(['discrete.unit-delay', 'continuous.integrator']);
const sinks = new Set(['sink.display', 'sink.scope', 'io.output']);
const supported = new Set([
  'source.constant', 'io.input', 'math.gain', 'math.sum', 'math.multiply',
  ...sinks, ...states, 'math.abs', 'math.sqrt', 'math.function', 'math.trigonometric', 'unit.convert',
]);
const unique = (ids: string[]): string[] => [...new Set(ids)];
const term = (text: string, ...nodeIds: string[]): EquationTerm => ({ text, nodeIds: unique(nodeIds) });
const numberText = (value: unknown): string => {
  const number = value as number;
  return Object.is(number, -0) ? '(-0)' : number < 0 ? `(${number})` : String(number);
};
interface Fragment { terms: EquationTerm[]; precedence: number }
const atom = (text: string, id: string): Fragment => ({ terms: [term(text, id)], precedence: 4 });
const wrapped = (fragment: Fragment, below: number, owner: string): EquationTerm[] => fragment.precedence < below
  ? [term('(', owner), ...fragment.terms, term(')', owner)] : fragment.terms;

/** Plain text mathematical relations from validated IR; never executes or rewrites a model. */
export function explainDiagram(input: CalcModel): DiagramEquationReport {
  let model: CalcModel;
  let compiled: ReturnType<typeof compileModel>;
  try {
    model = parseModel(input);
    compiled = compileModel(model);
  } catch (error) {
    return { status: 'invalid', equations: [], variables: [], diagnostics: error instanceof ModelError
      ? error.diagnostics.slice(0, 20).map(item => ({ code: item.code, message: item.message, ...(item.nodeId ? { nodeIds: [item.nodeId] } : {}) }))
      : [{ code: 'EQUATION_INVALID_MODEL', message: '현재 도식의 유효성을 확인할 수 없습니다.' }] };
  }

  const report: DiagramEquationReport = { status: 'supported', equations: [], variables: [], diagnostics: [] };
  const all = new Map(compiled.nodes.map(node => [node.id, node]));
  const rootIds = new Set(model.nodes.map(node => node.id));
  const root = new Map(compiled.nodes.filter(node => rootIds.has(node.id)).map(node => [node.id, node]));
  const symbols = new Map<string, string>();
  let signalNumber = 0, stateNumber = 0;
  const descriptor = (node: IRNode): SignalDescriptor | undefined => node.outputs.out
    ?? (() => { const endpoint = node.inputs.in; return endpoint && all.get(endpoint.nodeId)?.outputs[endpoint.portId]; })();
  const scalar = (value: SignalDescriptor | undefined): boolean => !!value && value.valueType === 'float64' && value.shape.length === 0;
  // Symbols depend on root node order, not labels or executable user text.
  for (const original of model.nodes) {
    const node = root.get(original.id), output = node && descriptor(node);
    if (!node || !scalar(output)) continue;
    const symbol = states.has(node.blockType) ? `x${++stateNumber}` : `y${++signalNumber}`;
    symbols.set(node.id, symbol);
    report.variables.push({ symbol, nodeId: node.id, label: original.label, unit: output!.unit });
  }
  const accepted = new Set<string>();
  const reject = (id: string, code: string, message: string): void => {
    report.diagnostics.push({ code, message, nodeIds: [id] });
    report.status = 'partial';
  };
  for (const original of model.nodes) {
    if (original.blockType.startsWith('annotation.')) continue;
    const node = root.get(original.id);
    if (!node || original.blockType.startsWith('hierarchy.')) {
      reject(original.id, 'EQUATION_HIERARCHY', '하위 도식과 조건 실행의 내부 수식은 아직 표시하지 않습니다.');
    } else if (!supported.has(node.blockType)) {
      reject(node.id, 'EQUATION_BLOCK_UNSUPPORTED', `${getBlockDefinition(node.blockType)?.englishName ?? node.blockType}의 수식 표현은 아직 지원하지 않습니다.`);
    } else if (node.parameters.reset !== undefined && node.parameters.reset !== 'none') {
      reject(node.id, 'EQUATION_RESET_UNSUPPORTED', '초기화 조건이 있는 상태의 조각별 수식은 아직 표시하지 않습니다.');
    } else if (!scalar(descriptor(node)) || Object.values(node.inputs).some(endpoint => !scalar(all.get(endpoint.nodeId)?.outputs[endpoint.portId]))) {
      reject(node.id, 'EQUATION_SCALAR_REQUIRED', '현재 수식 보기에는 기존 float64 스칼라 신호가 필요합니다. 배열·typed·boolean·bus·message는 변환하지 않습니다.');
    } else if (Object.values(node.inputs).some(endpoint => !root.has(endpoint.nodeId) || endpoint.portId !== 'out')) {
      reject(node.id, 'EQUATION_HIERARCHY_CONTEXT', '이 블록의 입력은 하위 도식 또는 여러 출력 포트에 연결되어 있어 수식 표현을 생략합니다.');
    } else if (node.sampleTime.period !== 1 || node.sampleTime.offset !== 0) {
      reject(node.id, 'EQUATION_RATE_UNSUPPORTED', '기본 주기 1·offset 0을 벗어난 held 신호와 상태의 수식은 아직 표시하지 않습니다.');
    } else if (model.execution.mode === 'continuous' && node.executionDomain === 'discrete') {
      reject(node.id, 'EQUATION_HYBRID_UNSUPPORTED', '연속·이산 경계의 held 신호와 상태는 현재 수식 보기에서 생략합니다.');
    } else accepted.add(node.id);
  }
  const mode = model.execution.mode;
  const reference = (id: string, argument = mode === 'discrete' ? 'k' : 't'): Fragment => atom(
    `${symbols.get(id)}${mode === 'static' ? '' : mode === 'discrete' ? `[${argument}]` : `(${argument})`}`, id);
  const inputFragment = (node: IRNode, port: string, resolver: (id: string) => Fragment | undefined): Fragment | undefined => resolver(node.inputs[port]!.nodeId);
  const relation = (node: IRNode, resolver: (id: string) => Fragment | undefined): Fragment | undefined => {
    const one = (): Fragment | undefined => inputFragment(node, 'in', resolver);
    const num = (name: string): EquationTerm => term(numberText(node.parameters[name]), node.id);
    switch (node.blockType) {
      case 'source.constant': case 'io.input': return atom(numberText(node.parameters.value), node.id);
      case 'math.gain': {
        const value = one();
        return value && { terms: [num('gain'), term(' × ', node.id), ...wrapped(value, 2, node.id)], precedence: 2 };
      }
      case 'math.sum': case 'math.multiply': {
        const a = inputFragment(node, 'a', resolver), b = inputFragment(node, 'b', resolver);
        if (!a || !b) return undefined;
        if (node.blockType === 'math.multiply') return { terms: [...wrapped(a, 2, node.id), term(node.parameters.operation === 'divide' ? ' / ' : ' × ', node.id), ...wrapped(b, 3, node.id)], precedence: 2 };
        const signs = String(node.parameters.signs);
        return { terms: [...(signs[0] === '-' ? [term('−', node.id), ...wrapped(a, 2, node.id)] : a.terms), term(signs[1] === '-' ? ' − ' : ' + ', node.id), ...wrapped(b, signs[1] === '-' ? 2 : 1, node.id)], precedence: 1 };
      }
      case 'unit.convert': {
        const value = one();
        return value && { terms: [num('unitScale'), term(' × ', node.id), ...wrapped(value, 2, node.id), term(' + ', node.id), num('unitOffset')], precedence: 1 };
      }
      case 'math.abs': case 'math.sqrt': case 'math.function': case 'math.trigonometric': {
        const value = one();
        if (!value) return undefined;
        const operation = node.blockType === 'math.abs' ? 'abs' : node.blockType === 'math.sqrt' ? 'sqrt' : String(node.parameters.operation);
        if (operation === 'square') return { terms: [term('(', node.id), ...value.terms, term(')²', node.id)], precedence: 3 };
        if (operation === 'reciprocal') return { terms: [term('1 / ', node.id), ...wrapped(value, 3, node.id)], precedence: 2 };
        const name = operation === 'log' ? 'ln' : operation === 'sqrt' ? '√' : operation;
        return { terms: [term(`${name}(`, node.id), ...value.terms, term(')', node.id)], precedence: 4 };
      }
      default: return undefined;
    }
  };
  const append = (id: string, title: string, terms: EquationTerm[], nodeIds: string[], note?: string, unit?: string): boolean => {
    if (report.equations.length >= MAX_EQUATIONS) return false;
    report.equations.push({ id, title, terms, nodeIds: unique(nodeIds.concat(terms.flatMap(item => item.nodeIds))), ...(note ? { note } : {}), ...(unit ? { unit } : {}) });
    return true;
  };
  const start = numberText(model.execution.startTime);
  for (const original of model.nodes) {
    if (!accepted.has(original.id)) continue;
    const node = root.get(original.id)!;
    const symbol = symbols.get(node.id)!;
    const output = descriptor(node)!;
    const title = `${getBlockDefinition(node.blockType)!.englishName} 관계`;
    const requiredCount = node.blockType === 'continuous.integrator' ? 3 : node.blockType === 'discrete.unit-delay' ? 2 : 1;
    if (report.equations.length + requiredCount > MAX_EQUATIONS) {
      reject(node.id, 'EQUATION_OUTPUT_LIMIT', '읽기 쉬운 수식 보기의 256개 관계 상한을 초과해 이 블록을 생략합니다.');
      accepted.delete(node.id);
      continue;
    }
    let terms: EquationTerm[];
    let note: string | undefined;
    if (states.has(node.blockType)) {
      const producer = node.inputs.in!.nodeId;
      if (node.blockType === 'discrete.unit-delay') {
        terms = [term(`${symbol}[k+1] = `, node.id), ...reference(producer).terms];
        note = '현재 출력은 이전 상태를 읽습니다. 현재 입력으로 갱신한 상태는 다음 샘플에 표시됩니다.';
      } else {
        terms = [term(`${symbol}′(t) = `, node.id), ...reference(producer).terms];
        note = '현행 연속 적분의 단위 없는 스칼라 관계입니다. 수치 계산에는 선택한 솔버가 적용됩니다.';
      }
    } else if (sinks.has(node.blockType)) {
      terms = [...reference(node.id).terms, term(' = ', node.id), ...reference(node.inputs.in!.nodeId).terms];
      note = '연결한 신호를 관측합니다.';
    } else {
      const rhs = relation(node, id => reference(id))!;
      terms = [...reference(node.id).terms, term(' = ', node.id), ...rhs.terms];
      if (node.blockType === 'math.multiply' && node.parameters.operation === 'divide'
        || node.blockType === 'math.function' && node.parameters.operation === 'reciprocal') note = '제수는 0이 아니어야 합니다.';
      else if (node.blockType === 'math.sqrt') note = '실수 제곱근의 입력은 0 이상이어야 합니다.';
      else if (node.blockType === 'math.function' && ['log', 'log10'].includes(String(node.parameters.operation))) note = '실수 로그의 입력은 0보다 커야 합니다.';
      else if (node.blockType === 'math.trigonometric' && ['asin', 'acos'].includes(String(node.parameters.operation))) note = '실수 역삼각 함수의 입력은 −1 이상, 1 이하여야 합니다.';
    }
    if (!append(`local-${node.id}`, title, terms, [node.id], note, output.unit)) {
      reject(node.id, 'EQUATION_OUTPUT_LIMIT', '읽기 쉬운 수식 보기의 256개 관계 상한을 초과해 이 블록을 생략합니다.');
      continue;
    }
    if (states.has(node.blockType)) {
      append(`initial-${node.id}`, '초기 상태', [term(`${symbol}${mode === 'discrete' ? '[0]' : `(${start})`} = `, node.id), term(numberText(node.parameters.initial), node.id)], [node.id], undefined, output.unit);
      if (node.blockType === 'continuous.integrator') append(`integral-${node.id}`, '시간에 따른 누적', [term(`${symbol}(t) = `, node.id), term(numberText(node.parameters.initial), node.id), term(` + ∫[${start}, t] `, node.id), ...reference(node.inputs.in!.nodeId, 'τ').terms, term(' dτ', node.id)], [node.id], '적분 구간은 실행 시작 시간부터 현재 시간까지입니다.', output.unit);
    }
  }
  if (mode === 'discrete' && model.nodes.some(node => accepted.has(node.id) && states.has(node.blockType))) {
    append('time-grid', '샘플 시간', [term(`t[k] = ${start} + ${numberText(model.execution.step)} × k`)], [], 'k는 실행 시작부터 세는 샘플 번호입니다.');
  }

  // Expand only validated, known scalar relations. Stop at state leaves and bound
  // depth, visits and term count; shared fan-out must not cause exponential text.
  const expand = (id: string): Fragment | undefined => {
    let visits = 0;
    const visit = (next: string, depth: number): Fragment | undefined => {
      if (++visits > MAX_EXPANDED_TERMS || depth > MAX_EXPANSION_DEPTH || !accepted.has(next)) return undefined;
      const node = root.get(next)!;
      if (states.has(node.blockType)) return reference(next);
      const result = relation(node, child => visit(child, depth + 1));
      return result && result.terms.length <= MAX_EXPANDED_TERMS ? result : undefined;
    };
    return visit(id, 0);
  };
  for (const original of model.nodes) {
    if (!accepted.has(original.id)) continue;
    const node = root.get(original.id)!;
    if (mode === 'static' && sinks.has(node.blockType)) {
      const rhs = expand(node.inputs.in!.nodeId);
      if (rhs) append(`summary-${node.id}`, '입력값을 대입한 계산식', [...reference(node.id).terms, term(' = ', node.id), ...rhs.terms], [node.id], '현재 입력값·계수·연결을 대입한 식입니다. 실행 결과를 대신 계산하지 않습니다.', descriptor(node)!.unit);
    } else if (node.blockType === 'discrete.unit-delay') {
      const rhs = expand(node.inputs.in!.nodeId);
      if (rhs) append(`summary-${node.id}`, '상태 점화식', [term(`${symbols.get(node.id)}[k+1] = `, node.id), ...rhs.terms], [node.id], '같은 샘플의 상태를 읽어 다음 샘플의 상태를 함께 갱신합니다.', descriptor(node)!.unit);
    } else if (node.blockType === 'continuous.integrator') {
      const gain = root.get(node.inputs.in!.nodeId);
      if (!gain || !accepted.has(gain.id) || gain.blockType !== 'math.gain' || gain.inputs.in?.nodeId !== node.id) continue;
      const symbol = symbols.get(node.id)!;
      append(`summary-${node.id}`, '피드백 미분방정식', [term(`${symbol}′(t) = `, node.id), term(numberText(gain.parameters.gain), gain.id), term(' × ', gain.id), ...reference(node.id).terms], [node.id, gain.id], undefined, '1');
      append(`solution-${node.id}`, '지수 피드백의 해', [term(`${symbol}(t) = `, node.id), term(numberText(node.parameters.initial), node.id), term(' × exp(', gain.id), term(numberText(gain.parameters.gain), gain.id), term(` × (t − ${start}))`, node.id)], [node.id, gain.id], '이 관계의 해석해입니다. 그래프는 솔버의 수치 근사이므로 오차가 있을 수 있습니다.', '1');
    }
  }
  return report;
}
