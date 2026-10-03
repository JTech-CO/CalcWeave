import { ModelError, type CompiledModel, type IRNode } from '../../model/src';

const u32 = (value: number): number[] => { const result: number[] = []; do { let byte = value & 127; value >>>= 7; if (value) byte |= 128; result.push(byte); } while (value); return result; };
const section = (id: number, payload: number[]) => [id, ...u32(payload.length), ...payload];
const text = (value: string) => { const bytes = Array.from(new TextEncoder().encode(value)); return [...u32(bytes.length), ...bytes]; };
const float = (value: number) => { const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true); return Array.from(bytes); };
export interface WasmBinaryPlan { bytes: Uint8Array<ArrayBuffer>; instructionCount: number; nodeIds: string[]; outputIndices: number[] }

/** One straight-line function; each graph node is emitted once, never recursively expanded. */
export function emitWasm(compiled: CompiledModel): WasmBinaryPlan {
  const code: number[] = [], byId = new Map(compiled.nodes.map((node,index) => [node.id,index])); let instructionCount = 0;
  const op = (opcode: number, ...immediate: number[]) => { code.push(opcode, ...immediate); instructionCount++; };
  const constant = (n: number) => op(0x44, ...float(n));
  const get = (index: number) => op(0x20, ...u32(index));
  const input = (node: IRNode, port: string) => { const endpoint = node.inputs[port], index = endpoint && byId.get(endpoint.nodeId); if (index === undefined || endpoint.portId !== 'out') throw new ModelError([{ code: 'WASM_INVALID_IR', nodeId: node.id, portId: port, message: 'WASM 입력 producer를 확인할 수 없습니다.' }]); get(index + 2); };
  compiled.nodes.forEach((node,index) => {
    const p = (key: string) => Number(node.parameters[key]);
    switch (node.blockType) {
      case 'source.constant': case 'io.input': constant(p('value')); break;
      case 'source.clock': get(1); break;
      case 'source.step': constant(p('before')); constant(p('after')); get(1); constant(p('stepTime')); op(0x63); op(0x1b); break;
      case 'source.ramp': constant(p('initial')); constant(p('slope')); constant(0); get(1); constant(p('startTime')); op(0xa1); op(0xa5); op(0xa2); op(0xa0); break;
      case 'math.gain': input(node,'in'); constant(p('gain')); op(0xa2); break;
      case 'math.sum': input(node,'a'); if (String(node.parameters.signs)[0] === '-') op(0x9a); input(node,'b'); if (String(node.parameters.signs)[1] === '-') op(0x9a); op(0xa0); break;
      case 'math.multiply': input(node,'a'); input(node,'b'); op(node.parameters.operation === 'divide' ? 0xa3 : 0xa2); break;
      case 'math.abs': input(node,'in'); op(0x99); break;
      case 'math.sqrt': input(node,'in'); op(0x9f); break;
      case 'math.function': if (node.parameters.operation === 'reciprocal') { constant(1); input(node,'in'); op(0xa3); } else { input(node,'in'); input(node,'in'); op(0xa2); } break;
      case 'math.minmax': if (node.parameters.strategy === 'reduce') input(node,'in'); else { input(node,'a'); input(node,'b'); op(node.parameters.operation === 'max' ? 0xa5 : 0xa4); } break;
      case 'sink.display': case 'sink.scope': case 'io.output': case 'io.terminator': input(node,'in'); break;
      default: throw new ModelError([{ code: 'WASM_UNSUPPORTED_BLOCK', nodeId: node.id, message: '선택 WASM emit 범위에 없는 블럭입니다.' }]);
    }
    op(0x21,...u32(index+2));
  });
  // Host validates the index; default NaN makes invalid direct ABI requests nonfinite.
  constant(NaN); op(0x21,...u32(compiled.nodes.length+2));
  compiled.nodes.forEach((_node,index) => { get(index+2); get(compiled.nodes.length+2); get(0); op(0x41,...u32(index)); op(0x46); op(0x1b); op(0x21,...u32(compiled.nodes.length+2)); });
  get(compiled.nodes.length+2); op(0x0b);
  const body = [1, ...u32(compiled.nodes.length+1), 0x7c, ...code];
  const bytes = new Uint8Array([0,97,115,109,1,0,0,0, ...section(1,[1,0x60,2,0x7f,0x7c,1,0x7c]), ...section(3,[1,0]), ...section(7,[1,...text('evaluate'),0,0]), ...section(10,[1,...u32(body.length),...body])]);
  return { bytes, instructionCount, nodeIds: compiled.nodes.map(node=>node.id), outputIndices: compiled.outputIds.map(id=>byId.get(id)!) };
}
