import { type IRNode } from '../../model/src';
import { validateBreakpoints, validateLookup2DOptions, type Lookup2DOptions } from '../../advanced-math/src';
import { validateFixedQuantizationOptions } from '../../quantization/src';

/** Recheck every portable model boundary, including imported hierarchy, Worker, and export. */
export function validateAdvancedParameters(node: IRNode): void {
  if (node.blockType === 'fixed.quantize') validateFixedQuantizationOptions(node.parameters);
  if (node.blockType === 'lookup.prelookup') validateBreakpoints(node.parameters.breakpoints);
  if (node.blockType === 'lookup.2d') validateLookup2DOptions(node.parameters as unknown as Lookup2DOptions);
}
