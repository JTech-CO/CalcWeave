import type { BusSignal, CompiledModel, Endpoint, IRNode, SignalValue } from '../../model/src/types';
import { finiteNumber, nodeOperationCost, numericFailure } from './kernels';
import { m12Jacobian, m12Newton, type M12NewtonOptions } from './numerics';
import { createContinuousMachine } from './continuous-machine';

export const M12_DISCRETE_STATE_BLOCKS = new Set(['nonlinear.rate-limiter-continuous', 'nonlinear.rate-limiter-dynamic']);
export interface M12Memory { value?: SignalValue }
export interface M12DescriptorReduced { A: number[][]; B: number[][]; C: number[][]; D: number[][]; initial: number[]; algebraicA: number[][]; algebraicB: number[][]; initialAlgebraic: number[]; originalA: number[][]; originalB: number[][]; originalE: number[][]; originalC: number[][]; originalD: number[][]; nd: number; n: number; m: number; p: number }
export interface M12AnalysisProgram extends CompiledModel { kind: 'm12-continuous-plant'; inputBindings: { port: string; nodeId: string }[]; outputBindings: { port: string; source: Endpoint }[]; initialState: number[] }
export type M12Charge = (node: IRNode, work?: number) => void;
const m12Dot = (a: number[], b: number[], id: string): number => a.reduce((sum, value, index) => finiteNumber(sum + value * b[index]!, id), 0);
export const m12NumericVector = (value: SignalValue, id: string): number[] => Array.isArray(value) ? value.map(item => finiteNumber(item, id)) : [finiteNumber(value, id)];
export const m12MatrixVector = (matrix: number[][], vector: number[], id: string): number[] => matrix.map(row => m12Dot(row, vector, id));
export const m12AddVectors = (a: number[], b: number[], id: string): number[] => a.map((value, index) => finiteNumber(value + b[index]!, id));
export function m12DescriptorState(node: IRNode, differential: number[], input: number[]): number[] {
  const p = node.parameters.descriptorReduced as M12DescriptorReduced;
  return [...differential, ...m12AddVectors(m12MatrixVector(p.algebraicA, differential, node.id), m12MatrixVector(p.algebraicB, input, node.id), node.id)];
}
export function m12DescriptorOutput(node: IRNode, differential: number[], input: number[]): Record<string, SignalValue> {
  const p = node.parameters.descriptorReduced as M12DescriptorReduced;
  const y = m12AddVectors(m12MatrixVector(p.C, differential, node.id), m12MatrixVector(p.D, input, node.id), node.id);
  return { out: p.p === 1 ? y[0]! : y, state: m12DescriptorState(node, differential, input) };
}
export function m12DescriptorDerivative(node: IRNode, differential: number[], input: number[]): number[] {
  const p = node.parameters.descriptorReduced as M12DescriptorReduced;
  return m12AddVectors(m12MatrixVector(p.A, differential, node.id), m12MatrixVector(p.B, input, node.id), node.id);
}
export function m12CheckDescriptorInitial(node: IRNode, input: number[]): void {
  const p = node.parameters.descriptorReduced as M12DescriptorReduced;
  if (node.parameters.initialPolicy !== 'error' || p.n === p.nd) return;
  const reconstructed = m12DescriptorState(node, p.initial, input).slice(p.nd), mismatch = reconstructed.reduce((maximum, value, index) => Math.max(maximum, Math.abs(value - p.initialAlgebraic[index]!)), 0);
  if (mismatch > Number(node.parameters.consistencyTolerance)) numericFailure('M12_DAE_INITIAL_INCONSISTENT', node.id, `실제 초기 입력으로 계산한 대수 상태가 초기값과 다릅니다(residual=${mismatch}).`);
}
export function m12PIDGains(node: IRNode): { p: number; i: number; d: number } {
  const p = node.parameters, kind = String(p.controller), ideal = p.form === 'ideal' ? Number(p.kp) : 1;
  return { p: ['PID', 'PI', 'PD', 'P'].includes(kind) ? Number(p.kp) : 0, i: ['PID', 'PI', 'I'].includes(kind) ? Number(p.ki) * ideal : 0, d: ['PID', 'PD'].includes(kind) ? Number(p.kd) * ideal : 0 };
}
export function m12PID(node: IRNode, x: number[], r: number, y: number): { output: number; derivative: number[]; raw: number } {
  const p = node.parameters, gains = m12PIDGains(node), error = r - y, derivativeInput = Number(p.c) * r - y, n = Number(p.filterN);
  const raw = finiteNumber(gains.p * (Number(p.b) * r - y) + (gains.i === 0 ? 0 : x[0]!) + gains.d * n * (derivativeInput - x[1]!), node.id);
  const output = p.limit === 'on' ? Math.min(Number(p.upper), Math.max(Number(p.lower), raw)) : raw;
  let integral = gains.i * error;
  if (p.limit === 'on' && p.antiWindup === 'clamp' && (raw > output && integral > 0 || raw < output && integral < 0)) integral = 0;
  if (p.limit === 'on' && p.antiWindup === 'back-calculation' && gains.i !== 0) integral += Number(p.kb) * (output - raw);
  return { output, raw, derivative: [finiteNumber(integral, node.id), finiteNumber(gains.d === 0 ? 0 : n * (derivativeInput - x[1]!), node.id)] };
}
export function m12RateClamp(node: IRNode, previous: number, input: number, rising: number, falling: number, dt: number): number {
  if (!Number.isFinite(rising) || !Number.isFinite(falling) || rising < 0 || falling > 0 || !Number.isFinite(dt) || dt < 0) numericFailure('M12_RATE_BOUNDS', node.id, '상승 한도≥0·하강 한도≤0·유한한 승인 시간 간격이 필요합니다.');
  return finiteNumber(Math.min(previous + rising * dt, Math.max(previous + falling * dt, input)), node.id);
}
export function m12InitialMemory(node: IRNode): M12Memory { return { value: finiteNumber(node.parameters.initial, node.id) }; }
export function m12InitialOutput(node: IRNode, memory: M12Memory): Record<string, SignalValue> { return { out: finiteNumber(memory.value, node.id) }; }
export function m12IndependentOutput(node: IRNode): boolean { return node.blockType === 'nonlinear.rate-limiter-dynamic'; }
export function m12ReadState(node: IRNode, memory: M12Memory, input: (port: string) => SignalValue, dt = 1): Record<string, SignalValue> {
  return node.blockType === 'nonlinear.rate-limiter-dynamic' ? m12InitialOutput(node, memory) : { out: m12RateClamp(node, finiteNumber(memory.value, node.id), finiteNumber(input('in'), node.id), Number(node.parameters.rising), Number(node.parameters.falling), dt) };
}
export function m12CommitState(node: IRNode, memory: M12Memory, input: (port: string) => SignalValue, dt = 1): M12Memory {
  const dynamic = node.blockType === 'nonlinear.rate-limiter-dynamic';
  return { value: m12RateClamp(node, finiteNumber(memory.value, node.id), finiteNumber(input('in'), node.id), dynamic ? finiteNumber(input('rising'), node.id) : Number(node.parameters.rising), dynamic ? finiteNumber(input('falling'), node.id) : Number(node.parameters.falling), dt) };
}
export function m12OperationCost(node: IRNode, inputSize: number, outputSize: number): number | undefined {
  switch (node.blockType) {
    case 'continuous.descriptor': { const p = node.parameters.descriptorReduced as M12DescriptorReduced; return Math.max(1, p ? p.n * p.n * 4 + p.n * p.m * 4 + p.p * p.n * 4 : inputSize + outputSize); }
    case 'continuous.integrator-limited': case 'continuous.second-order-limited': case 'continuous.pid-2dof': return Math.max(1, inputSize + outputSize + 32);
    case 'time.variable-delay': case 'time.variable-transport-delay': return Math.max(1, inputSize + outputSize + 24);
    case 'nonlinear.backlash': case 'nonlinear.rate-limiter-continuous': case 'nonlinear.rate-limiter-dynamic': return Math.max(1, inputSize + outputSize + 12);
    case 'solver.algebraic-constraint': return Math.max(1, inputSize + outputSize + 4);
    case 'analysis.linearization': return Math.max(1, outputSize + 8);
    default: return undefined;
  }
}
export interface M12AnalysisResult { A: number[][]; B: number[][]; C: number[][]; D: number[][]; state: number[]; input: number[]; output: number[]; derivative: number[] }
/** A real supplied operating point, with pure state/output evaluations and no native MATLAB claims. */
export function m12AnalyzePlant(node: IRNode, time: number, charge: M12Charge = () => {}): M12AnalysisResult {
  const program = node.parameters.analysisProgram as M12AnalysisProgram, x = [...node.parameters.operatingState as number[]], u = [...node.parameters.operatingInputs as number[]], step = Number(node.parameters.fdStep);
  if (!program || x.length < 1 || x.length > 16 || u.length < 1 || u.length > 8 || program.outputBindings.length < 1 || program.outputBindings.length > 8) numericFailure('M12_ANALYSIS_IR', node.id, '선형화의 bounded 연속 plant와 실제 operating point가 필요합니다.');
  const make = (inputs: number[]) => {
    charge(node, program.nodes.length * 4 + x.length + inputs.length);
    const bound = new Map(program.inputBindings.map((binding, index) => [binding.nodeId, inputs[index]!]));
    // A supplied operating point and its input perturbations reconstruct the
    // algebraic coordinates. They are not new simulation startup conditions.
    const nodes = program.nodes.map(child => bound.has(child.id) ? { ...child, parameters: { ...child.parameters, value: bound.get(child.id)! } } : child.blockType === 'continuous.descriptor' ? { ...child, parameters: { ...child.parameters, initialPolicy: 'project' } } : child);
    const byId = new Map(nodes.map(child => [child.id, child]));
    const childCosts = new Map(nodes.map(child => [child.id, nodeOperationCost(child, byId)]));
    const machine = createContinuousMachine({ ...program, nodes }, (child, work) => charge(node, work ?? childCosts.get(child.id)!));
    if (machine.initial.length !== x.length) numericFailure('M12_ANALYSIS_IR', node.id, 'plant의 실제 미분 상태 수가 operating point와 다릅니다.');
    const output = (state: number[]) => { const values = machine.evaluate(time, state, new Map()); return program.outputBindings.map(binding => finiteNumber(values.get(binding.source.nodeId)?.[binding.source.portId], node.id)); };
    return { derivative: (state: number[]) => machine.derivative(time, state, new Map()), output };
  };
  const base = make(u), A = m12Jacobian(base.derivative, x, node.id, step, work => charge(node, work)), C = m12Jacobian(base.output, x, node.id, step, work => charge(node, work));
  const B = m12Jacobian(inputs => make(inputs).derivative(x), u, node.id, step, work => charge(node, work)), D = m12Jacobian(inputs => make(inputs).output(x), u, node.id, step, work => charge(node, work));
  return { A, B, C, D, state: x, input: u, output: base.output(x), derivative: base.derivative(x) };
}
export function m12AnalysisBus(result: Pick<M12AnalysisResult, 'A' | 'B' | 'C' | 'D'>): BusSignal { return { kind: 'bus', fields: (['A', 'B', 'C', 'D'] as const).map(name => ({ name, value: result[name].map(row => [...row]) })) }; }
export function m12Gradient(fn: (point: number[]) => number, point: number[], options: Pick<M12NewtonOptions, 'nodeId' | 'fdStep' | 'charge'>): number[] { return m12Jacobian(x => [fn(x)], point, options.nodeId, options.fdStep, options.charge)[0]!; }
export function m12OperatingPoint(fn: (state: number[]) => number[], initial: number[], options: M12NewtonOptions): number[] { return m12Newton(fn, initial, options).state; }
