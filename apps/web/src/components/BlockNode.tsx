import { useEffect } from 'react';
import { Handle, Position, useUpdateNodeInternals, type Node, type NodeProps } from '@xyflow/react';
import { getBlockDefinition, getBlockPorts } from '../../../../packages/block-library/src';
import { isDefinitionReference } from '../../../../packages/block-library/src/m11';
import { M13_BLOCK_IDS } from '../../../../packages/block-library/src/m13';
import { M12_BLOCK_IDS } from '../../../../packages/block-library/src/m12';
import { M14_BLOCK_IDS } from '../../../../packages/block-library/src/m14';
import type { CalcNode, SignalValue } from '../../../../packages/model/src';
import { validateTypedSignal } from '../../../../packages/model/src';
import { fixedCellText, signalSummary, typedCellText } from './SignalResult';

// A compact preview; the complete number remains in the inspector/result and tooltip.
function compactNumber(value: number) {
  if (value === 0) return '0';
  const exact = String(value);
  if (exact.length <= 8) return exact;
  const roundedNumber = Number(value.toPrecision(5));
  const rounded = String(roundedNumber);
  if (Number.isFinite(roundedNumber) && rounded.length <= 8) return rounded;
  for (let digits = 3; digits >= 0; digits--) {
    const scientific = value.toExponential(digits).replace('e+', 'e');
    if (scientific.length <= 8) return scientific;
  }
  return value.toExponential(0).replace('e+', 'e');
}

export { BLOCK_SYMBOLS } from '../block-symbols';

export function blockTone(type: string) {
  if (type.startsWith('sink.') || type === 'io.output' || type === 'io.terminator') return 'output';
  if (type.startsWith('source.') || type === 'io.input') return 'input';
  if (type.startsWith('discrete.') || type.startsWith('continuous.') || type.startsWith('time.')) return 'state';
  return 'math';
}

export type BlockData = { block: CalcNode; boundary?: boolean; error?: boolean; result?: SignalValue; current?: boolean; ports?: { inputs: string[]; outputs: string[] } };
export type FlowBlock = Node<BlockData, 'calcBlock'>;

export function BlockNode({ id, data, selected }: NodeProps<FlowBlock>) {
  const updateNodeInternals = useUpdateNodeInternals();
  const ports = data.ports ?? getBlockPorts(data.block);
  const portKey = `${ports.inputs.join(',')}/${ports.outputs.join(',')}`;
  useEffect(() => { updateNodeInternals(id); }, [id, portKey, updateNodeInternals]);
  const definition = getBlockDefinition(data.block.blockType);
  if (!definition) return <div className="block-node name-only error" role="group" aria-label={`${data.block.label}: 지원되지 않는 블럭 ${data.block.blockType}`} title={data.block.label}><div className="block-name">Unknown</div></div>;
  const firstParameter = data.block.blockType === 'dashboard.control' ? ['initial', definition.parameters.initial] as const : Object.entries(definition.parameters)[0];
  const parameter = firstParameter && ['number', 'integer', 'value', 'numeric-vector', 'typed-value', 'signal-value'].includes(firstParameter[1].kind) || data.block.blockType === 'source.string-constant' && firstParameter ? firstParameter : undefined;
  const value = parameter ? Object.hasOwn(data.block.parameters, parameter[0]) ? data.block.parameters[parameter[0]] : parameter[1].default : undefined;
  const hasValue = !data.boundary && (Boolean(parameter) || ['sink.display', 'sink.scope', 'io.output', 'sink.sequence-viewer', 'io.structured-output'].includes(data.block.blockType));
  const preview = parameter ? value : data.current ? data.result : undefined;
  const exactValue = preview === undefined ? '현재 결과 없음' : JSON.stringify(preview);
  let typedPreview: string | undefined;
  if (preview && typeof preview === 'object' && !Array.isArray(preview)) {
    try {
      if ('kind' in preview && (preview.kind === 'bus' || preview.kind === 'messages')) typedPreview = signalSummary(preview as SignalValue);
      else if ('kind' in preview && preview.kind === 'typed') { const typed = validateTypedSignal(preview), dimensions = `[${typed.shape.join('×')}]`; typedPreview = typed.shape.length ? dimensions.length <= 14 ? dimensions : `${typed.shape.length}D · ${typed.data.length}` : typed.dtype === 'fixed' ? fixedCellText(typed.data[0] as string, typed.fixed!.fractionLength) : typedCellText(typed.data[0]!, typed); }
    } catch { /* Imported invalid configuration is diagnosed by the compiler. */ }
  }
  const visibleValue = typedPreview ?? (typeof preview === 'string' ? preview.length <= 16 ? preview : `${preview.slice(0, 15)}…` : typeof preview === 'number' && Number.isFinite(preview) ? compactNumber(preview) : typeof preview === 'boolean' ? String(preview) : Array.isArray(preview) ? Array.isArray(preview[0]) ? `[${preview.length}×${preview[0].length}]` : `[${preview.length}]` : '—');
  const plainName = ([...M12_BLOCK_IDS, ...M13_BLOCK_IDS, ...M14_BLOCK_IDS] as readonly string[]).includes(data.block.blockType) ? definition.englishName.replace(/^Trusted /, '').replace(/\s*\((?:Selected|Discrete Selected|Independent Alternative|Alternative|Replay|Allowlist|Bounded|Local)\)$/, '') : definition.englishName;
  const canvasName = data.boundary || isDefinitionReference(data.block) ? data.block.label : plainName;
  const height = Math.max(canvasName.length > 18 ? 124 : 96, (Math.max(ports.inputs.length, ports.outputs.length) + 1) * 26);
  return <div className={`block-node ${blockTone(data.block.blockType)} ${hasValue ? '' : 'name-only'} ${selected ? 'selected' : ''} ${data.error ? 'error' : ''}`} style={{ minHeight: height }} role="group" aria-label={`${definition.englishName} 블럭: ${data.block.label}`} title={data.block.label}>
    <div className={`block-name${canvasName.length > 12 ? ' wrap-name' : ''}`}>{canvasName}</div>
    {hasValue && <div className={`block-value${typedPreview !== undefined ? ' typed-preview' : ''}`} title={exactValue} aria-label={exactValue}>{visibleValue}</div>}
    {data.error && <span className="block-error" role="img" aria-label="입력 또는 설정 확인 필요" title="입력 또는 설정 확인 필요">!</span>}
    {ports.inputs.map((port, index) => <div className="port-row input-port" key={port} style={{ top: `${(index + 1) * 100 / (ports.inputs.length + 1)}%` }}><Handle type="target" position={Position.Left} id={port} aria-label={`${data.block.label} 입력 ${port}`} /></div>)}
    {ports.outputs.map((port, index) => <div className="port-row output-port" key={port} style={{ top: `${(index + 1) * 100 / (ports.outputs.length + 1)}%` }}><Handle type="source" position={Position.Right} id={port} aria-label={`${data.block.label} 출력 ${port}`} /></div>)}
  </div>;
}
