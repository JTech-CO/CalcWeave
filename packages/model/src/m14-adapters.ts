import type { Diagnostic, ExecutionMode } from './types';

export interface AdapterProfile {
  readonly id: string;
  readonly version: 1;
  readonly label: string;
  readonly availability: 'bundled' | 'unavailable';
  readonly blockType?: string;
  readonly sourceRowIds: readonly string[];
  readonly classification: 'independent-alternative' | 'external-environment-unavailable';
  readonly artifact?: { readonly sha256: string; readonly byteLength: number; readonly abiVersion: 1; readonly exports: readonly { readonly name: string; readonly parameters: readonly string[]; readonly result: string }[] };
  readonly supportedModes: readonly ExecutionMode[];
  readonly exportTargets: readonly string[];
  readonly ports: readonly { readonly id: string; readonly direction: 'input' | 'output'; readonly dtype: string; readonly shape: string; readonly unit: string }[];
  readonly lifecycle: readonly string[];
  readonly capabilities: { readonly arbitraryCode: false; readonly arbitraryBytes: false; readonly imports: false; readonly memory: false; readonly table: false; readonly global: false; readonly start: false; readonly loops: false; readonly calls: false; readonly hostFunctions: false; readonly network: false; readonly filesystem: false };
  readonly limits: Readonly<Record<string, number | string | boolean>>;
  readonly environment: readonly string[];
  readonly products: readonly string[];
  readonly toolchain: readonly string[];
  readonly reason?: string;
  readonly diagnosticCode?: string;
  readonly provenance: { readonly author: string; readonly implementation: string; readonly primaryReferences: readonly string[]; readonly thirdPartyWasm: false };
  readonly rights: { readonly license: 'NOASSERTION'; readonly bundledExecution: string; readonly sourceExport: string; readonly externalCodeRedistribution: 'NOASSERTION'; readonly nativeProductRights: 'required-separately' };
  readonly nativeRuntimeEquivalenceClaimed: false;
}

function freezeAdapterMetadata<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freezeAdapterMetadata(child); Object.freeze(value); }
  return value;
}
const deniedCapabilities = { arbitraryCode: false, arbitraryBytes: false, imports: false, memory: false, table: false, global: false, start: false, loops: false, calls: false, hostFunctions: false, network: false, filesystem: false } as const;
const selectedRights = { license: 'NOASSERTION', bundledExecution: 'Project-authorized self-authored bundled implementation', sourceExport: 'Project-authorized fixed implementation in declared TypeScript target; independent legal redistribution status is not asserted', externalCodeRedistribution: 'NOASSERTION', nativeProductRights: 'required-separately' } as const;
const scalarPort = (id: string, direction: 'input' | 'output', dtype = 'float64', unit = '1') => ({ id, direction, dtype, shape: 'scalar', unit });
const common = { version: 1, availability: 'bundled', classification: 'independent-alternative', exportTargets: ['typescript'], capabilities: deniedCapabilities, environment: ['Browser/Node WebAssembly f64 support'], products: [], toolchain: ['Pinned self-authored binary; no runtime compiler'], rights: selectedRights, nativeRuntimeEquivalenceClaimed: false } as const;

export const BUILTIN_ADAPTER_PROFILES: readonly AdapterProfile[] = freezeAdapterMetadata<readonly AdapterProfile[]>([
  { ...common, id: 'calcweave.wasm-affine-f64-v1', label: 'Trusted f64 affine', blockType: 'adapter.wasm-affine', sourceRowIds: ['19-001'],
    artifact: { sha256: 'fc7801ff3c8d616c38773a0e26af62181f8281c8f06430193d0ed20fb239cb95', byteLength: 48, abiVersion: 1, exports: [{ name: 'affine', parameters: ['f64', 'f64', 'f64'], result: 'f64' }] },
    supportedModes: ['static', 'discrete', 'continuous'], ports: [scalarPort('in', 'input'), scalarPort('out', 'output')], lifecycle: ['validate pinned binary/ABI', 'instantiate pure module', 'affine(input,gain,bias)', 'check finite output'],
    limits: { inputElements: 1, outputElements: 1, ownedWasmMemoryBytes: 0, wasmInstructionsPerCall: 6, operationChargePerCall: 448, operationChargeFormula: '8*byteLength + 32*exportCount + 32' },
    provenance: { author: 'JTech-Co', implementation: 'Self-authored straight-line f64 multiply/add binary', thirdPartyWasm: false, primaryReferences: ['https://www.mathworks.com/help/simulink/slref/ccaller.html'] } },
  { ...common, id: 'calcweave.wasm-accumulator-f64-v1', label: 'Trusted f64 lifecycle accumulator', blockType: 'adapter.wasm-accumulator', sourceRowIds: ['19-002'],
    artifact: { sha256: 'e39e9c9c08547876adeb3a521111b47b778fae11ca90a881995428a264376a65', byteLength: 121, abiVersion: 1, exports: [{ name: 'initialize', parameters: ['f64'], result: 'f64' }, { name: 'read', parameters: ['f64'], result: 'f64' }, { name: 'accumulate', parameters: ['f64', 'f64', 'f64'], result: 'f64' }, { name: 'reset', parameters: ['f64'], result: 'f64' }, { name: 'terminate', parameters: ['f64'], result: 'f64' }] },
    supportedModes: ['discrete'], ports: [scalarPort('in', 'input'), scalarPort('reset', 'input', 'boolean'), scalarPort('out', 'output')], lifecycle: ['initialize(initial)', 'rising/level reset before read', 'read(state)', 'atomic accumulate(state,input,gain) for next sample including reset hits', 'terminate(state) on completion/cancellation/failure'],
    limits: { rootGraphOnly: true, inputElements: 2, outputElements: 1, stateElements: 16, ownedWasmMemoryBytes: 0, wasmInstructionsPerTransition: 12, operationChargePerCall: 1160, operationChargePerTransition: 2352, prepaidInitializationAndCleanupCost: 3480, operationChargeFormula: '8*byteLength + 32*exportCount + 32; transition=2*calls+32; initialization+cleanup=3*calls' },
    provenance: { author: 'JTech-Co', implementation: 'Self-authored pure f64 lifecycle exports; mutable state is checkpointed JSON outside WASM', thirdPartyWasm: false, primaryReferences: ['https://www.mathworks.com/help/simulink/slref/cfunction.html'] } },
  { ...common, id: 'calcweave.entity-fixed-deadline-v1', label: 'Bounded message FIFO transport', blockType: 'adapter.entity-transport', sourceRowIds: ['02-016'],
    supportedModes: ['discrete'], ports: [scalarPort('in', 'input', 'messages'), scalarPort('delay', 'input', 'float64', 's'), scalarPort('out', 'output', 'messages'), scalarPort('count', 'output')],
    lifecycle: ['empty bounded FIFO/seen tracker', 'release previously queued head entries at due tick', 'deduplicate and enqueue current arrivals atomically', 'preserve FIFO head-of-line ordering', 'dispose on run end'],
    limits: { rootGraphOnly: true, capacity: 64, maxRelease: 64, maxProducerIdentities: 128, minimumDelayDueTicks: 1, maximumPayloadLogicalElements: 1024, ownedWasmMemoryBytes: 0 },
    environment: ['CalcWeave fixed-tick message runtime'], toolchain: ['No external SimEvents/entity runtime'], provenance: { author: 'JTech-Co', implementation: 'Independent discrete message FIFO with fixed deadlines; no SimEvents entity/transport integral execution', thirdPartyWasm: false, primaryReferences: ['https://www.mathworks.com/help/simulink/slref/entitytransportdelay.html'] } },
]);

const nativeRows = [
  ['02-016', 'entity-transport-delay', 'Entity Transport Delay', 'SimEvents entity/transport-distance integral execution is not installed or reproduced.', ['MATLAB', 'Simulink', 'SimEvents'], ['SimEvents runtime'], 'entitytransportdelay'],
  ['19-001', 'c-caller', 'C Caller', 'External C source, native ABI/build integration and required products are unavailable.', ['MATLAB', 'Simulink'], ['Configured C/C++ compiler', 'External C headers/source'], 'ccaller'],
  ['19-002', 'c-function', 'C Function', 'External C lifecycle callbacks and native compilation are unavailable.', ['MATLAB', 'Simulink'], ['Configured C/C++ compiler', 'External callback source'], 'cfunction'],
  ['19-006', 'interpreted-matlab-function', 'Interpreted MATLAB Function', 'The MATLAB interpreter is unavailable; legacy source must be manually ported to the bounded CalcWeave AST.', ['MATLAB', 'Simulink'], ['MATLAB interpreter'], 'interpretedmatlabfunction'],
  ['19-007', 'level-2-matlab-s-function', 'Level-2 MATLAB S-Function', 'MATLAB callback APIs and TLC-dependent code generation are unavailable.', ['MATLAB', 'Simulink'], ['MATLAB Level-2 callback API', 'TLC for applicable native export'], 'level2matlabsfunction'],
  ['19-009', 'matlab-system', 'MATLAB System', 'MATLAB System object interpreter/code generation and external object source are unavailable.', ['MATLAB', 'Simulink'], ['MATLAB System object APIs', 'Applicable code generation products'], 'matlabsystem'],
  ['19-012', 's-function', 'S-Function', 'Compiled MEX/S-function ABI, callbacks and target integration are unavailable.', ['MATLAB', 'Simulink'], ['MEX compiler', 'S-function callback API'], 'sfunction'],
  ['19-013', 's-function-builder', 'S-Function Builder', 'Native builder wrapper/MEX compilation and external source execution are unavailable.', ['MATLAB', 'Simulink'], ['Configured C/C++ compiler', 'MEX/S-function builder'], 'sfunctionbuilder'],
] as const;
export const UNAVAILABLE_ADAPTER_PROFILES: readonly AdapterProfile[] = freezeAdapterMetadata(nativeRows.map(([row, id, label, reason, products, toolchain, reference]) => ({
  ...common, id: `native.${id}`, label, availability: 'unavailable', classification: 'external-environment-unavailable', sourceRowIds: [row], supportedModes: [], exportTargets: [], ports: [], lifecycle: ['Unavailable; no native callbacks execute'], limits: { executable: false }, environment: ['Authorized external environment required; not bundled'], products, toolchain, reason, diagnosticCode: 'M14_NATIVE_ENVIRONMENT_UNAVAILABLE',
  provenance: { author: 'MathWorks/external user code (not bundled)', implementation: 'Requirements metadata only; no third-party executable artifact', primaryReferences: [`https://www.mathworks.com/help/simulink/slref/${reference}.html`], thirdPartyWasm: false },
  rights: { ...selectedRights, bundledExecution: 'No native execution authorization asserted', sourceExport: 'No native code export or redistribution authorization asserted' },
})));
export const ADAPTER_PROFILES: readonly AdapterProfile[] = freezeAdapterMetadata([...BUILTIN_ADAPTER_PROFILES, ...UNAVAILABLE_ADAPTER_PROFILES]);
export function getAdapterProfile(id: string): AdapterProfile | undefined { return ADAPTER_PROFILES.find(profile => profile.id === id); }
export function getNodeAdapterProfile(blockType: string): AdapterProfile | undefined { return BUILTIN_ADAPTER_PROFILES.find(profile => profile.blockType === blockType); }
export function getAdapterAvailability(id: string): { available: boolean; diagnosticCode?: string; reason?: string } {
  const profile = getAdapterProfile(id); return profile ? { available: profile.availability === 'bundled', ...(profile.diagnosticCode ? { diagnosticCode: profile.diagnosticCode, reason: profile.reason } : {}) } : { available: false, diagnosticCode: 'M14_UNKNOWN_ADAPTER_PROFILE', reason: 'No trusted adapter profile is registered.' };
}
export function adapterAvailabilityDiagnostic(id: string, nodeId?: string): Diagnostic | undefined {
  const status = getAdapterAvailability(id); return status.available ? undefined : { code: status.diagnosticCode!, message: status.reason!, ...(nodeId ? { nodeId } : {}) };
}
