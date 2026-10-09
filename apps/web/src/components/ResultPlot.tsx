import { useMemo } from 'react';
import { decodeTypedFloat, isIntegerDataType, validateTypedSignal, type RunSample, type RunResult, type SignalDescriptor, type SignalValue, type TypedFloat } from '../../../../packages/model/src';
import { ScopePlot } from './ScopePlot';
import { MultiInputPlot } from './MultiInputPlot';

export function formatNumber(value: number) {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  if (Math.abs(value) >= 1e9 || Math.abs(value) < 1e-5) return value.toExponential(5);
  return Number(value.toPrecision(7)).toLocaleString('en-US', { maximumSignificantDigits: 7 });
}

/** Approximate float64 plotting only. Original typed values stay in result/history/exports. */
export function plotSignalNumber(value: SignalValue | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.kind !== 'typed') return undefined;
  const typed = validateTypedSignal(value);
  if (typed.shape.length) return undefined;
  const cell = typed.data[0]!;
  const number = typed.dtype === 'float32' || typed.dtype === 'float64' ? decodeTypedFloat(cell as TypedFloat) : typed.dtype === 'fixed' ? Number(cell) * 2 ** -typed.fixed!.fractionLength : isIntegerDataType(typed) ? Number(cell) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

export function ResultPlot({ samples, outputId, label, descriptor, status, multiInput = false }: { samples: RunSample[]; outputId: string; label: string; descriptor?: SignalDescriptor; status?: RunResult['status']; multiInput?: boolean }) {
  const series = useMemo(() => [{ id: 'current', label, samples, descriptor, status }], [samples, label, descriptor, status]);
  if (multiInput) return <MultiInputPlot samples={samples} outputId={outputId} label={label} descriptor={descriptor} status={status}/>;
  return <ScopePlot series={series} outputId={outputId} label={label}/>;
}
