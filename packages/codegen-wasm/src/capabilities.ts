/** Versioned target capabilities; canonical historical registry definitions stay unchanged. */
export const WASM_TARGET = Object.freeze({
  id: 'wasm-m15-v1' as const,
  label: 'WebAssembly (스칼라 도식)',
  supportedModes: Object.freeze(['static', 'discrete'] as const),
  blockIds: Object.freeze(['source.constant', 'io.input', 'source.clock', 'source.step', 'source.ramp', 'math.gain', 'math.sum', 'math.multiply', 'math.abs', 'math.sqrt', 'math.minmax', 'math.function', 'sink.display', 'sink.scope', 'io.output', 'io.terminator']),
  abi: Object.freeze({ version: 1, exportName: 'evaluate', parameters: Object.freeze(['i32', 'f64']), result: 'f64', meaning: 'compiler-ordered node value index and absolute simulation time' }),
  limits: Object.freeze({ maxNodes: 64, maxOutputs: 16, maxBinaryBytes: 65536, maxTickIntervals: 10000, maxRecordedElements: 1000000, maxOperations: 50000000, maxActiveWallMs: 30000 }),
  semantics: 'Stateless scalar DAG; every node must use base tick period1/offset0. Physical units preserve validated descriptors. math.function supports square/reciprocal only.',
  dependencies: Object.freeze(['WebAssembly Core 1 Module/Instance host', 'No external compiler, imports, memory, table, globals, start, loops or calls']),
});

/** Availability metadata only: no unverified native C/C++ generator is advertised. */
export const C_CPP_TARGET = Object.freeze({ id:'c-cpp-native-m15-v1', label:'C/C++ (환경 필요)', available:false, diagnosticCode:'NATIVE_TOOLCHAIN_UNAVAILABLE', reason:'이 릴리스는 검증한 native C/C++ compiler·host ABI 실행 어댑터를 제공하지 않습니다. 코드 emit만으로 실행 지원을 승인하지 않습니다.', dependencies:Object.freeze(['Native C/C++ compiler and linker','Versioned host ABI and runtime','Actual build/run parity fixtures','User and third-party source/redistribution rights']), executableGeneratorApproved:false, fullSimulinkEquivalenceClaimed:false });
