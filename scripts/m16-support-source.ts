import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { blockRegistry, type BlockDefinition } from '../packages/block-library/src';
import { PYTHON_TARGET } from '../packages/codegen-python/src/capabilities';
import { WASM_TARGET, C_CPP_TARGET } from '../packages/codegen-wasm/src/capabilities';
import { ADAPTER_PROFILES } from '../packages/model/src';
import { HISTORICAL_SUPPORT_ENGINE_VERSION } from '../packages/support-matrix/src/current-extensions';
import type { CanonicalSupport, SourceSupportRow, SupportEvidence, SupportMatrix, SupportMode, SupportOptionProfile, SupportTargetCapability } from '../packages/support-matrix/src/types';
import { validateSupportMatrix } from '../packages/support-matrix/src/validate';

export const SUPPORT_PATH = 'docs/support-matrix.json';
export const SUPPORT_MD_PATH = 'docs/support-matrix.md';
export const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const HISTORICAL_SUPPORT_REVISION = '736603c7988699e2001cb102d7f1ca64fa1c4a55';
export const HISTORICAL_SUPPORT_SHA256 = 'e5d706d7fc127081fc8470189b3f580d03ed61ba938a8168a5aa8e3730bb875e';
/** Source artifact identities of the frozen audit; every byte still has a SHA gate. */
export const HISTORICAL_SUPPORT_CODE_PATHS: readonly string[] = Object.freeze([
  'packages/block-library/src/index.ts', 'packages/block-library/src/expansion.ts', 'packages/block-library/src/time-sources.ts',
  ...['m8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14'].map(stage => `packages/block-library/src/${stage}.ts`),
  'packages/model/src/types.ts', 'packages/model/src/schema.ts', 'packages/model/src/m14-adapters.ts',
  'packages/codegen-python/src/capabilities.ts', 'packages/codegen-wasm/src/capabilities.ts',
]);
const historicalCodePaths = new Set(HISTORICAL_SUPPORT_CODE_PATHS);
export const HISTORICAL_OBSERVER_SOURCE_SNAPSHOT_PATH = 'docs/baselines/m16-observer-source.json';
const observerSourcePaths = new Set(['packages/block-library/src/index.ts', 'packages/model/src/types.ts']);
const MAX_OBSERVER_SNAPSHOT_BYTES = 128 * 1024;
const MAX_OBSERVER_SOURCE_BYTES = 64 * 1024;

/**
 * The two changed files are exact Git blob bytes copied once from the pinned
 * revision, in a bounded base64 snapshot. Their SHA comes independently from
 * the immutable support manifest. No Git, history fetch, or network is needed
 * at generation time, including source ZIPs and shallow Actions checkouts.
 */
export function decodeHistoricalObserverSourceSnapshot(text: string, artifacts: Readonly<Record<string, string>>): ReadonlyMap<string, Buffer> {
  assert(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= MAX_OBSERVER_SNAPSHOT_BYTES, 'Historical observer snapshot byte limit');
  const input: unknown = JSON.parse(text);
  function fields(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
    assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Historical observer snapshot object required');
    assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'Historical observer snapshot fields changed');
  }
  fields(input, ['schemaVersion', 'revision', 'files']);
  assert.equal(input.schemaVersion, 1); assert.equal(input.revision, HISTORICAL_SUPPORT_REVISION);
  assert(Array.isArray(input.files) && input.files.length === 2, 'Exactly two historical observer source files are required');
  const result = new Map<string, Buffer>();
  for (const file of input.files) {
    fields(file, ['path', 'sha256', 'encoding', 'byteLength', 'data']);
    assert(typeof file.path === 'string' && observerSourcePaths.has(file.path) && !result.has(file.path), 'Unapproved or duplicate historical observer source path');
    assert.equal(file.encoding, 'base64');
    assert(typeof file.byteLength === 'number' && Number.isSafeInteger(file.byteLength) && file.byteLength > 0 && file.byteLength <= MAX_OBSERVER_SOURCE_BYTES, 'Historical observer source byte limit');
    assert(typeof file.data === 'string' && file.data.length <= 4 * Math.ceil(MAX_OBSERVER_SOURCE_BYTES / 3) && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data), 'Historical observer source base64 required');
    const bytes = Buffer.from(file.data, 'base64');
    assert.equal(bytes.length, file.byteLength, 'Historical observer source byte length changed');
    assert.equal(bytes.toString('base64'), file.data, 'Historical observer source base64 must be canonical');
    assert(typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256), 'Historical observer source SHA required');
    assert.equal(file.sha256, artifacts[file.path], 'Historical observer source SHA differs from frozen manifest');
    assert.equal(digest(bytes), artifacts[file.path], 'Historical observer source bytes differ from frozen manifest');
    result.set(file.path, bytes);
  }
  return result;
}
async function historicalCodeBytes(path: string, artifacts: Readonly<Record<string, string>>): Promise<Buffer> {
  assert(historicalCodePaths.has(path), 'Unapproved historical source path');
  // The other 13 unchanged source files must still match their exact live
  // bytes; this snapshot cannot waive an unrelated source-artifact change.
  if (!observerSourcePaths.has(path)) return readFile(path);
  const snapshot = decodeHistoricalObserverSourceSnapshot(await readFile(HISTORICAL_OBSERVER_SOURCE_SNAPSHOT_PATH, 'utf8'), artifacts);
  return snapshot.get(path)!;
}
export async function loadHistoricalSupportMatrix(): Promise<SupportMatrix> {
  const bytes = await readFile(SUPPORT_PATH);
  assert.equal(digest(bytes), HISTORICAL_SUPPORT_SHA256, 'Frozen historical support artifact changed');
  const matrix = validateSupportMatrix(JSON.parse(bytes.toString('utf8')));
  assert.equal(matrix.engineVersion, HISTORICAL_SUPPORT_ENGINE_VERSION);
  return matrix;
}
export async function verifyHistoricalSupportArtifact(path: string, sha256: string): Promise<void> {
  const pinned = await loadHistoricalSupportMatrix();
  const bytes = historicalCodePaths.has(path) ? await historicalCodeBytes(path, pinned.artifacts) : await readFile(path);
  assert.equal(digest(bytes), sha256, `${path}: historical support input digest mismatch`);
}
export async function verifyHistoricalSupportArtifacts(matrix: SupportMatrix): Promise<void> {
  const pinned = await loadHistoricalSupportMatrix();
  await Promise.all(Object.entries(matrix.artifacts).map(async ([path, sha]) => {
    const bytes = historicalCodePaths.has(path) ? await historicalCodeBytes(path, pinned.artifacts) : await readFile(path);
    assert.equal(digest(bytes), sha, `${path}: historical support input digest mismatch`);
  }));
}
/** Remove exactly the two approved declarations, after checking their full wire. */
export function registryWithoutApprovedObserverInputs(registry: readonly BlockDefinition[]): BlockDefinition[] {
  let approved = 0;
  const result = registry.map(definition => {
    if (!['sink.display', 'sink.scope'].includes(definition.id)) return structuredClone(definition);
    assert.deepEqual(definition.parameters.inputCount, { kind: 'integer', label: '입력 개수', default: 1, min: 1, max: 16 }, `${definition.id}: unapproved inputCount declaration`);
    const copy = structuredClone(definition);
    delete (copy.parameters as Record<string, unknown>).inputCount;
    approved++;
    return copy;
  });
  assert.equal(approved, 2, 'Exactly two observer inputCount extensions are approved');
  return result;
}
export interface SourceIdentity { id: string; name: string; section: number; ordinal: number; line: number; subgroup: string; condition: string }
interface CoverageRow { id: string; name: string; subgroup: string; condition: string; canonical: string; planning: string; boundary: string; status: string; line: number }
interface Approval {
  sourceId: string; sourceName: string; canonical: string; status: string; parameters?: Record<string, unknown>; selectedParameters?: Record<string, unknown>;
  evidenceFixtureIds: string[]; presetEvidenceIds?: string[]; declaredModes?: SupportMode[]; presetId?: string | null; rawFixtureId?: string;
  requiredBindingsActuallyConnected?: string[]; configuredProfiles?: { selectedParameters: Record<string, unknown>; declaredModes: SupportMode[]; evidenceFixtureIds: string[]; rawFixtureId: string; requiredBindingsActuallyConnected?: string[] }[];
  uiWorkflowEvidencePath?: string; selectionKind?: string;
}
interface ExecutionProof { id: string; mode?: SupportMode; presetId?: string; blockIds?: string[]; modes?: Record<SupportMode, unknown>; parameters?: Record<string, unknown>; actualStandaloneTypeScript?: boolean; independentOracle?: boolean; independentLiteralOracle?: boolean }
interface ApprovalBundle { stage: string; path: string; proofPath: string; approvals: Approval[]; proofs: ExecutionProof[]; presets: ExecutionProof[]; presetPath?: string }
const SOURCE_PATH = 'dataset/Simulink_Basic_Blocks_R2024b.md', ROADMAP_PATH = 'docs/simulink-coverage-roadmap.json', COVERAGE_PATH = 'docs/block-coverage.md';
const allModes: SupportMode[] = ['static', 'discrete', 'continuous'];
const inventoryReason = '원 dataset은 블럭명·분류·조건 목록이며 R2024b의 모든 공식 parameter/option/default/bounds/dtype/shape/sample-time/target 조합 inventory가 아니다. 현재 공식 문서 개념 확인과 로컬 schema 선언으로 이를 대체하지 않는다.';
const dtypeLegacy = 'Legacy finite float64/boolean scalar, 1D vector, 2D matrix의 선택 계약; inherited는 모든 자료형 허용을 뜻하지 않으며 compiler가 각 input/output/dtype/shape/unit 경계를 검사한다.';
const dtypeTyped = 'Typed envelope: float64,float32,boolean,int8,uint8,int16,uint16,int32,uint32,int64,uint64,complex128,fixed,string,enum. rank<=8/elements<=1024의 wire 상한이며 모든 consumer가 모든 dtype을 지원하는 것은 아니다; 각 block/compiler의 명시 boundary를 따른다.';
const dtypePython = '기존51 정의의 legacy finite numeric/boolean scalar/vector/2D 및 고정 틱 상태 계약. 새 typed 선택은 scalar string/int8..uint64/float32/float64/boolean/enum/fixed, ASCII용 uint8 1D<=256; complex/bus/messages/다른 nD/연속 solver는 미지원.';
const dtypeWasm = 'Legacy finite float64 scalar DAG만; validated unit descriptor는 보존. typed/boolean/vector/matrix/state/continuous/dataset/hierarchy는 미지원. math.function은 square/reciprocal만.';

export function parseSourceInventory(text: string): { rows: SourceIdentity[]; sections: { id: number; name: string; rows: number }[] } {
  const rows: SourceIdentity[] = [], sections: { id: number; name: string; rows: number }[] = [];
  let section = 0, ordinal = 0, subgroup = '일반 표';
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const heading = /^## (\d{2})\. (.+)$/.exec(line); if (heading) { section = Number(heading[1]); if (section > 21) { section = 0; continue; } ordinal = 0; subgroup = '일반 표'; sections.push({ id: section, name: heading[2]!, rows: 0 }); continue; }
    const subheading = /^### (.+)$/.exec(line); if (subheading) { subgroup = subheading[1]!; continue; }
    const table = /^\| ([^|]+) \| ([^|]+) \|\s*$/.exec(line);
    if (!section || !table || table[1]!.trim() === '블록명' || /^[ :-]+$/.test(table[1]!)) continue;
    ordinal++; const id = `${String(section).padStart(2, '0')}-${String(ordinal).padStart(3, '0')}`;
    rows.push({ id, name: table[1]!.trim(), section, ordinal, line: index + 1, subgroup, condition: table[2]!.trim() }); sections.at(-1)!.rows++;
  }
  assert.equal(rows.length, 385); assert.equal(sections.length, 21); assert.equal(new Set(rows.map(value => value.name)).size, 339);
  return { rows, sections };
}
function parseCoverage(text: string): CoverageRow[] {
  return text.split(/\r?\n/).filter(line => /^\| \[\d{2}-\d{3}\]/.test(line)).map(line => {
    const cells = line.slice(1, -1).split('|').map(value => value.trim()); assert.equal(cells.length, 9);
    const identity = /^\[(\d{2}-\d{3})\].+\(L(\d+)\)$/.exec(cells[0]!); assert(identity);
    return { id: identity[1]!, line: Number(identity[2]), name: cells[1]!, subgroup: cells[2]!, condition: cells[3]!, canonical: cells[4]!.replace(/^`|`$/g, ''), planning: cells[5]!, boundary: cells[7]!, status: cells[8]! };
  });
}
function eligibleTarget(target: SupportTargetCapability['target'], version: string, eligible: boolean, modes: SupportMode[], dtypeScope: string, reason: string): SupportTargetCapability {
  return { target, version, status: eligible ? 'selected-config-eligible' : target === 'c-cpp' ? 'environment-unavailable' : 'unsupported', supportedModes: eligible ? [...modes] : [], dtypeScope, reason, requiresActualModelValidation: true, allConfigurationsVerified: false };
}
function targetsFor(definition: BlockDefinition): SupportTargetCapability[] {
  const modes = [...definition.supportedModes];
  return [
    eligibleTarget('typescript', 'typescript-current-selected-v1', definition.exportTargets.includes('typescript'), modes, `${dtypeLegacy} ${dtypeTyped}`, '검증된 compiled IR·모드·dtype·샘플링·상태·작업량 조건에서만 실행한다. 등록 membership는 모든 configuration 수치 승인과 다르다.'),
    eligibleTarget('python', PYTHON_TARGET.id, PYTHON_TARGET.blockIds.includes(definition.id), modes.filter(value => PYTHON_TARGET.supportedModes.includes(value as 'static' | 'discrete')), dtypePython, PYTHON_TARGET.blockIds.includes(definition.id) ? '현재 versioned Python69 allowlist의 구성 후보. 실제 모델은 getPythonDiagnostics/compileModel 경계를 모두 통과해야 한다.' : '현재 versioned Python69 allowlist 밖의 정의이다.'),
    eligibleTarget('wasm', WASM_TARGET.id, WASM_TARGET.blockIds.includes(definition.id), modes.filter(value => WASM_TARGET.supportedModes.includes(value as 'static' | 'discrete')), dtypeWasm, WASM_TARGET.blockIds.includes(definition.id) ? '현재 versioned WASM16 allowlist의 구성 후보. baseperiod1/offset0·64노드·16출력·64KiB·10000interval·실제 명령50m 및 모델별 진단을 검사한다.' : '현재 versioned WASM16 scalar DAG allowlist 밖의 정의이다.'),
    eligibleTarget('c-cpp', C_CPP_TARGET.id, false, [], '실제 C/C++ toolchain/ABI 실행 미검증', C_CPP_TARGET.reason),
  ];
}
function definitionContract(definition: BlockDefinition): CanonicalSupport {
  return { id: definition.id, kind: 'registry-block', label: definition.label, englishName: definition.englishName, description: definition.description,
    parameters: Object.fromEntries(Object.entries(definition.parameters).map(([name, value]) => { const { options, ...fields } = value; return [name, { ...structuredClone(fields), ...(options ? { options: [...options] } : {}), qaStatus: 'declared-local-schema-not-exhaustive-source-inventory' as const }]; })),
    declaration: { valueType: definition.valueType, shape: definition.shape, unit: definition.unit, sampleTime: definition.sampleTime, state: definition.state, inputs: [...definition.inputs], outputs: [...definition.outputs] },
    dtype: { status: 'compiler-validated-per-model', scope: `${definition.description} ${definition.id.startsWith('string.') || definition.id === 'source.string-constant' ? '문자열 scalar/ASCII uint8 변환·format별 명시 dtype만; string256 UTF16 저장 상한/Unicode codepoint 선택 계약.' : definition.id.startsWith('complex.') || definition.id.startsWith('typed.') || definition.id.startsWith('tensor.') || definition.id.startsWith('fixed.') || ['source.typed', 'source.enum', 'source.signal', 'signal.cast'].includes(definition.id) ? dtypeTyped : dtypeLegacy}`, sourceInventoryVerified: false },
    supportedModes: [...definition.supportedModes], targets: targetsFor(definition), fullEquivalence: false };
}
function nonBlockTargets(kind: CanonicalSupport['kind']): SupportTargetCapability[] {
  return (['typescript', 'python', 'wasm', 'c-cpp'] as const).map(target => ({ target, version: target === 'python' ? PYTHON_TARGET.id : target === 'wasm' ? WASM_TARGET.id : target === 'c-cpp' ? C_CPP_TARGET.id : 'typescript-current-selected-v1', status: kind === 'model-widget' && target !== 'c-cpp' ? 'ui-only' : kind === 'unavailable-capability' || target === 'c-cpp' ? 'environment-unavailable' : 'unsupported', supportedModes: [], dtypeScope: kind === 'model-widget' ? '선택된 root scalar float64 결과 또는 명시된 parameter binding UI' : '실행 dtype 계약 없음', reason: kind === 'model-widget' ? '모델 dashboard의 UI widget이며 계산 registry block 또는 executable export node가 아니다.' : '이 source 목적은 실행 구현되지 않았다. 다른 유사한 canonical의 성공으로 승격하지 않는다.', requiresActualModelValidation: true, allConfigurationsVerified: false }));
}
const widgetKinds = { 'dashboard.scope': 'scope', 'dashboard.readout': 'display', 'dashboard.gauge': 'gauge', 'dashboard.slider': 'slider', 'dashboard.toggle-switch': 'toggle' } as const;
function widgetContract(id: keyof typeof widgetKinds): CanonicalSupport {
  const kind = widgetKinds[id], control = kind === 'slider' || kind === 'toggle';
  const parameter = (label: string, datatype: string, value: unknown, required: boolean, bounds: { maxLength?: number; min?: number } = {}) => ({ kind: datatype, label, default: value, required, ...bounds, qaStatus: 'declared-local-schema-not-exhaustive-source-inventory' as const });
  return { id, kind: 'model-widget', label: kind, englishName: kind, description: '기존 model.dashboard widget의 선택 바인딩 계약. 독립 node/ports 또는 live 실행 중 parameter write로 취급하지 않는다.',
    parameters: { id: parameter('widget ID', 'text', null, true, { maxLength: 64 }), kind: { ...parameter('widget kind', 'enum', kind, true), options: [kind] }, title: parameter('제목', 'text', null, true, { maxLength: 120 }), nodeId: parameter('대상 root node ID', 'text', null, true, { maxLength: 64 }), parameter: parameter('대상 parameter', 'text', null, control, { maxLength: 64 }), min: parameter('하한', 'number', null, kind === 'slider' || kind === 'gauge'), max: parameter('상한', 'number', null, kind === 'slider' || kind === 'gauge'), step: parameter('step (양수)', 'number', null, false, { min: 0 }) },
    declaration: { valueType: 'bound-root-scalar-float64', shape: 'scalar', unit: 'binding-preserves-descriptor', sampleTime: 'pre-run-edit-or-recorded-result', state: 'ui-only', inputs: [], outputs: [] },
    dtype: { status: 'selected-widget', scope: control ? 'root scalar source.constant.value/io.input.value/math.gain.gain에 저장하고 다음 실행에서 반영; toggle은 선택 boolean parameter binding만.' : '최종 기록 root scalar float64 출력/원시 표본 바인딩. 내부 임의 신호·live streaming 제외.', sourceInventoryVerified: false },
    supportedModes: [], bindings: control ? ['source.constant.value', 'io.input.value', 'math.gain.gain', '모델에 저장 후 다음 실행 반영'] : ['최종 root scalar float64 outputId', '실행 결과 raw samples/stale 표시'], targets: nonBlockTargets('model-widget'), fullEquivalence: false };
}
function unavailableContract(id: string, rows: CoverageRow[]): CanonicalSupport {
  return { id, kind: 'unavailable-capability', label: rows[0]!.name, englishName: rows[0]!.name, description: rows.map(value => `${value.id} ${value.name}: ${value.boundary}`).join('\n'), parameters: {},
    declaration: { valueType: 'unavailable', shape: 'unavailable', unit: 'unavailable', sampleTime: 'unavailable', state: 'unavailable', inputs: [], outputs: [] }, dtype: { status: 'unavailable', scope: 'Source 목적의 executable compiler/runtime 계약 없음; 유사 구조의 대체 블럭과 합산하지 않는다.', sourceInventoryVerified: false }, supportedModes: [], targets: nonBlockTargets('unavailable-capability'), fullEquivalence: false };
}
function proofIndex(bundle: ApprovalBundle): Map<string, ExecutionProof> {
  const index = new Map<string, ExecutionProof>();
  for (const value of [...bundle.proofs, ...bundle.presets]) { index.set(value.id, value); if (value.mode) index.set(`${value.id}/${value.mode}`, value); for (const mode of Object.keys(value.modes ?? {})) index.set(`${value.id}/${mode}`, value); }
  return index;
}
function proofModes(fixtureIds: string[], index: Map<string, ExecutionProof>): SupportMode[] {
  return allModes.filter(mode => fixtureIds.some(id => { const value = index.get(id); return value?.mode === mode || Object.hasOwn(value?.modes ?? {}, mode) || id.endsWith(`-${mode}`) || id.endsWith(`/${mode}`); }));
}
function approvalProfiles(approval: Approval, bundle: ApprovalBundle): SupportOptionProfile[] {
  const index = proofIndex(bundle);
  if (approval.configuredProfiles) return approval.configuredProfiles.map(value => ({ parameters: structuredClone(value.selectedParameters), modes: [...value.declaredModes], evidencePath: bundle.proofPath, fixtureIds: [...value.evidenceFixtureIds], scope: 'selected-config-only', rawFixtureId: value.rawFixtureId, ...(approval.presetId ? { presetId: approval.presetId } : {}), ...(value.requiredBindingsActuallyConnected ? { requiredBindingsActuallyConnected: [...value.requiredBindingsActuallyConnected] } : {}) }));
  const presetIds = approval.presetEvidenceIds ?? [];
  if (presetIds.length) return [{ parameters: structuredClone(approval.parameters ?? {}), modes: proofModes(presetIds, index), evidencePath: bundle.presetPath ?? bundle.proofPath, fixtureIds: [...presetIds], presetId: presetIds[0]!.split('/')[0]!, scope: 'selected-config-only' }];
  const ids = approval.evidenceFixtureIds; if (!ids.length) return [];
  const parameters = structuredClone(approval.selectedParameters ?? approval.parameters ?? {});
  // Empty/partial selection parameters are selectors, not a claim that every default or runtime configuration was executed.
  return [{ parameters, modes: [...(approval.declaredModes ?? proofModes(ids, index))], evidencePath: bundle.proofPath, fixtureIds: [...ids], scope: 'selected-config-only', ...(approval.presetId ? { presetId: approval.presetId } : {}), ...(approval.rawFixtureId ? { rawFixtureId: approval.rawFixtureId } : {}), ...(approval.requiredBindingsActuallyConnected ? { requiredBindingsActuallyConnected: [...approval.requiredBindingsActuallyConnected] } : {}) }];
}

export async function createSupportMatrix(): Promise<SupportMatrix> {
  const pinned = await loadHistoricalSupportMatrix();
  const artifacts: Record<string, string> = {};
  async function read(path: string): Promise<string> {
    const bytes = historicalCodePaths.has(path) ? await historicalCodeBytes(path, pinned.artifacts) : await readFile(path);
    const sha = digest(bytes);
    assert.equal(sha, pinned.artifacts[path], `${path}: pinned historical support input changed`);
    artifacts[path] = sha;
    return bytes.toString('utf8');
  }
  async function json<T>(path: string): Promise<T> { return JSON.parse(await read(path)) as T; }
  const historical = await json<{ protectedArtifacts: Record<string, string> }>('docs/evidence/m15-verification.json');
  assert.equal(Object.keys(historical.protectedArtifacts).length, 25);
  for (const [path, expected] of Object.entries(historical.protectedArtifacts)) assert.equal(digest(await readFile(path)), expected, `${path}: protected history changed`);
  const source = parseSourceInventory(await read(SOURCE_PATH));
  const roadmap = await json<{ rows: SourceIdentity[] }>(ROADMAP_PATH);
  assert.deepEqual(source.rows, roadmap.rows.map(({ id, name, section, ordinal, line, subgroup, condition }) => ({ id, name, section, ordinal, line, subgroup, condition })), 'Original source/roadmap identity drift');
  const coverage = parseCoverage(await read(COVERAGE_PATH)); assert.equal(coverage.length, 385);
  const baseline = await json<BlockDefinition[]>('docs/baselines/m15-registry.json'); assert.equal(baseline.length, 337);
  assert.deepEqual(registryWithoutApprovedObserverInputs(blockRegistry), baseline, 'Historical337 definitions changed outside the two approved inputCount declarations');
  for (const path of ['packages/block-library/src/index.ts', 'packages/block-library/src/expansion.ts', 'packages/block-library/src/time-sources.ts', ...['m8','m9','m10','m11','m12','m13','m14'].map(stage => `packages/block-library/src/${stage}.ts`), 'packages/model/src/types.ts', 'packages/model/src/schema.ts', 'packages/model/src/m14-adapters.ts', 'packages/codegen-python/src/capabilities.ts', 'packages/codegen-wasm/src/capabilities.ts']) await read(path);
  const bundles: ApprovalBundle[] = [];
  for (const stage of ['m8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14']) {
    const path = `docs/evidence/${stage}-source-approvals.json`, approval = await json<{ approvals: Approval[]; evidencePath: string; evidenceSha256: string; presetEvidencePath?: string; presetEvidenceSha256?: string }>(path);
    const proof = await json<{ fixtures: ExecutionProof[]; presetEvidence?: ExecutionProof[] }>(approval.evidencePath); assert.equal(artifacts[approval.evidencePath], approval.evidenceSha256);
    let presets = proof.presetEvidence ?? [];
    if (approval.presetEvidencePath) { const extra = await json<{ presetEvidence: ExecutionProof[] }>(approval.presetEvidencePath); assert.equal(artifacts[approval.presetEvidencePath], approval.presetEvidenceSha256); presets = extra.presetEvidence; }
    const bundle: ApprovalBundle = { stage, path, proofPath: approval.evidencePath, approvals: approval.approvals, proofs: proof.fixtures, presets, ...(approval.presetEvidencePath ? { presetPath: approval.presetEvidencePath } : {}) }; const index = proofIndex(bundle);
    for (const selection of approval.approvals) for (const id of [...selection.evidenceFixtureIds, ...(selection.presetEvidenceIds ?? [])]) assert(index.has(id), `${selection.sourceId}: missing actual fixture ${id}`);
    for (const uiPath of [...new Set(approval.approvals.flatMap(value => value.uiWorkflowEvidencePath ? [value.uiWorkflowEvidencePath] : []))]) await read(uiPath);
    bundles.push(bundle);
  }
  // Historical early-stage JSON is preserved as stage-level evidence, never retroactively relabelled full option QA.
  for (const stage of ['m1','m2','m3','m4','m5','catalog']) await read(`docs/evidence/${stage}-verification.json`);
  const pythonProofPath = 'docs/evidence/m15-python-verification.json', wasmProofPath = 'docs/evidence/m15-wasm-verification.json';
  const pythonProof = await json<{ target: { blockIds: string[] } }>(pythonProofPath), wasmProof = await json<{ target: { blockIds: string[] } }>(wasmProofPath);
  assert.deepEqual(pythonProof.target.blockIds, PYTHON_TARGET.blockIds, 'Versioned Python target drifted from immutable execution proof');
  assert.deepEqual(wasmProof.target.blockIds, WASM_TARGET.blockIds, 'Versioned WASM target drifted from immutable execution proof');
  const presetProof = await json<{ fixtures: { sourceId: string; canonical: string; parameters: Record<string, unknown>; modes: SupportMode[]; id: string }[] }>('docs/evidence/m16-preset-verification.json');
  // Contracts describe the frozen historical declarations, not today's extension.
  const registryContracts = baseline.map(definitionContract), widgets = Object.keys(widgetKinds).map(id => widgetContract(id as keyof typeof widgetKinds));
  const unavailableIds = [...new Set(coverage.filter(value => value.status === '미구현').map(value => value.canonical))].sort();
  const contracts = [...registryContracts, ...widgets, ...unavailableIds.map(id => unavailableContract(id, coverage.filter(value => value.canonical === id)))].sort((a,b) => a.id.localeCompare(b.id, 'en-US'));
  const byId = new Map(contracts.map(value => [value.id, value]));
  const evidence = (path: string, kind: SupportEvidence['kind'], scope: string, claim: SupportEvidence['claim'] = 'tracking-only', fixtureIds?: string[]): SupportEvidence => ({ path, sha256: artifacts[path]!, kind, scope, claim, ...(fixtureIds ? { fixtureIds: [...fixtureIds] } : {}) });
  const rows: SourceSupportRow[] = source.rows.map((identity, index) => {
    const mapping = coverage[index]!;
    assert.equal(mapping.id, identity.id); assert.equal(mapping.name, identity.name); assert.equal(mapping.line, identity.line); assert.equal(mapping.subgroup, identity.subgroup); assert.equal(mapping.condition, identity.condition);
    const contract = byId.get(mapping.canonical); assert(contract, `${identity.id}: unclassified canonical ${mapping.canonical}`);
    const unavailable = mapping.status === '미구현', legacy = identity.condition.includes('레거시') || identity.name === 'Interpreted MATLAB Function';
    const matched = [...bundles].reverse().map(bundle => ({ bundle, approval: bundle.approvals.find(value => value.sourceId === identity.id && value.canonical === mapping.canonical && value.status === mapping.status) })).find(value => value.approval);
    const approval = matched?.approval;
    const classification = legacy ? 'legacy' : mapping.status.includes('독립 대체') ? 'independent-alternative' : mapping.status.includes('preset') ? 'preset' : approval?.selectionKind?.includes('control-port') || mapping.planning === 'adapter' || mapping.canonical.startsWith('adapter.') ? 'conditional-adapter' : mapping.planning === '구성' ? 'shared-configuration' : 'native-capability';
    const profiles: SupportOptionProfile[] = matched && approval ? approvalProfiles(approval, matched.bundle) : [];
    const rowEvidence: SupportEvidence[] = [evidence(SOURCE_PATH, 'reference', '원본 행 identity/name/subgroup/condition/line'), evidence(ROADMAP_PATH, 'reference', '동결된 원본385 ID 및 계획 분류'), evidence(COVERAGE_PATH, 'reference', '현재 행별 subset/미구현 결정과 목적별 경계')];
    if (matched && approval) {
      rowEvidence.push(evidence(matched.bundle.path, 'source-approval', '원 source 행에 연결된 선택 구성만 승인; full original option inventory 아님', 'selected-subset'));
      for (const proofPath of [...new Set(profiles.map(value => value.evidencePath))]) rowEvidence.push(evidence(proofPath, 'execution-proof', '실제 standalone TypeScript/독립 oracle/상태 경계의 행별 선택 fixture', 'selected-subset', profiles.filter(value => value.evidencePath === proofPath).flatMap(value => value.fixtureIds)));
      if (approval.uiWorkflowEvidencePath) { assert(artifacts[approval.uiWorkflowEvidencePath], 'UI evidence must be loaded before constructing rows'); rowEvidence.push(evidence(approval.uiWorkflowEvidencePath, 'ui-proof', '선택 source-profile의 화면/파일/binding workflow, 전체 native UI 등가 아님', 'selected-subset')); }
    } else if (!unavailable) {
      const stage = mapping.status.startsWith('catalog') ? 'catalog' : /^M\d+/.exec(mapping.status)?.[0].toLowerCase(); assert(stage);
      rowEvidence.push(evidence(`docs/evidence/${stage}-verification.json`, 'execution-proof', '기존 단계 전체 증거. 이 JSON에 source/profile별 연결이 없는 옵션은 재승인하지 않는다.', 'tracking-only'));
    }
    const m1 = presetProof.fixtures.find(value => value.sourceId === identity.id);
    if (m1) { assert.equal(m1.canonical, mapping.canonical); profiles.push({ parameters: structuredClone(m1.parameters), modes: [...m1.modes], evidencePath: 'docs/evidence/m16-preset-verification.json', fixtureIds: [m1.id], presetId: `m1-${identity.id}`, rawFixtureId: m1.id, scope: 'selected-config-only' }); rowEvidence.push(evidence('docs/evidence/m16-preset-verification.json', 'execution-proof', 'M1 고정 preset 네 구성의 별도 literal/native/실제 standalone TS 재확인; M1 역사 증거 불변', 'selected-subset', [m1.id])); }
    const ownAdapterProfiles = ADAPTER_PROFILES.filter(profile => profile.sourceRowIds.includes(identity.id));
    const requirements = ownAdapterProfiles.flatMap(profile => [...profile.environment, ...profile.products, ...profile.toolchain, ...(profile.reason ? [profile.reason] : [])]);
    if (!requirements.length) requirements.push(unavailable ? `원본 ${identity.name}의 ${mapping.boundary} 목적은 현재 실행되지 않는다.` : 'CalcWeave browser JS/TS 선택 구현; MATLAB/Simulink 원본 실행 및 전체 옵션 참조 oracle는 수행하지 않음.');
    if (identity.condition !== '기본') requirements.push(`원본 조건: ${identity.condition}`);
    let targets = structuredClone(contract.targets); if (unavailable) targets = nonBlockTargets('unavailable-capability');
    for (const target of targets.filter(value => value.status === 'selected-config-eligible' && ['python','wasm'].includes(value.target))) rowEvidence.push(evidence(target.target === 'python' ? pythonProofPath : wasmProofPath, 'target-proof', '현재 versioned target allowlist의 실제 선택 fixture 검증. 이 source 행의 모든 모델 구성을 실행했다는 뜻이 아님.', 'tracking-only'));
    const reason = unavailable ? `${identity.id} ${identity.name}: ${mapping.boundary}. 이 목적의 실행 계약은 미구현이며 유사 canonical 또는 format parser만으로 승인하지 않는다.` : mapping.boundary;
    return { id: identity.id, name: identity.name, section: identity.section, ordinal: identity.ordinal, subgroup: identity.subgroup, condition: identity.condition, owner: 'JTech-Co',
      source: { path: SOURCE_PATH, line: identity.line, identitySha256: digest(JSON.stringify(identity)), href: `https://github.com/JTech-CO/CalcWeave/blob/main/${SOURCE_PATH}#L${identity.line}` },
      verification: { engineVersion: HISTORICAL_SUPPORT_ENGINE_VERSION, contractVersion: 'source-support-m16-v1', auditScope: 'tracking-and-declared-selected-contracts' },
      decision: { status: unavailable ? legacy ? 'legacy-unavailable' : 'unsupported' : 'selected-subset', classification, priorStatus: mapping.status, reason }, implementations: [{ id: contract.id, kind: contract.kind }],
      sourceInventory: { status: 'unverified', version: 'R2024b', reason: inventoryReason, fullOptionInventoryObtained: false, requiredDimensions: ['official parameter names/defaults/enums/bounds', 'dependent/hidden options', 'dtype', 'shape/rank', 'unit', 'sampleTime/mode', 'code-generation targets', 'toolbox/runtime/rights conditions'] },
      capabilities: { optionsRef: [contract.id], optionProfiles: profiles, dtype: { status: unavailable ? 'unavailable' : contract.kind === 'model-widget' ? 'ui-only' : 'conditional-model-validation', scopes: [{ canonical: contract.id, description: contract.dtype.scope }] }, modes: unavailable ? [] : [...contract.supportedModes], modeQaStatus: 'declared-canonical-modes-require-model-validation', targets },
      externalConditions: { nativeExecution: unavailable || ownAdapterProfiles.some(value => value.availability === 'unavailable') ? 'unavailable' : 'unverified', sourceCondition: identity.condition, profileIds: ownAdapterProfiles.map(value => value.id), requirements: [...new Set(requirements)], rights: 'not-inferred-from-implementation', primarySourceRuntimeExecuted: false },
      evidence: rowEvidence, unresolvedReasons: [inventoryReason, 'MathWorks R2024b runtime/reference numerical execution 미수행; full source equivalence false.', ...(profiles.length ? ['선택 fixture 이외 parameter 조합·자료형·mode·target은 실제 모델 validation 및 별도 numerical QA 필요.'] : ['기존 단계의 source-specific option profile이 machine-readable 수치 증거로 연결되지 않았다. 선언 schema/default를 verified로 승격하지 않는다.']), ...(unavailable ? [reason] : [])], trackingDecisionComplete: true, fullEquivalence: false };
  });
  const result: SupportMatrix = { schemaVersion: 1, contractVersion: 'source-support-m16-v1', owner: 'JTech-Co', engineVersion: HISTORICAL_SUPPORT_ENGINE_VERSION, sourceVersion: 'R2024b',
    counts: { trackedSourceRows: rows.length, uniqueSourceNames: new Set(rows.map(value => value.name)).size, selectedSubsetRows: rows.filter(value => value.decision.status === 'selected-subset').length, unsupportedRows: rows.filter(value => value.decision.status !== 'selected-subset').length, unverifiedInventoryRows: 385, fullOptionEquivalentRows: 0, registryDefinitions: registryContracts.length, canonicalContracts: contracts.length, widgetContracts: widgets.length, unavailableContracts: unavailableIds.length, pythonDefinitionMembership: PYTHON_TARGET.blockIds.length, wasmDefinitionMembership: WASM_TARGET.blockIds.length, trackingDecisionCompleteRows: rows.length },
    sections: source.sections, artifacts: Object.fromEntries(Object.entries(artifacts).sort(([a],[b]) => a.localeCompare(b, 'en-US'))), protectedArtifacts: historical.protectedArtifacts, canonicalContracts: contracts, rows,
    fullSimulinkEquivalenceClaimed: false, numericalReferenceRuntimeExecuted: false, exhaustiveSourceOptionInventoryVerified: false,
    methodology: ['385 source identities/339 names/21sections are preserved; selected367/unsupported18 do not mean full-option completion.', '337 immutable registry definitions,5 model widgets and10 unavailable canonical purposes are separate normalized contracts.', 'Local parameter schema(default/enums/bounds) is declared-only; no complete R2024b option inventory is asserted.', 'Source option profiles cite existing actual configured fixtures and exact approved selectors; missing early-stage row-specific profiles remain unverified.', 'TypeScript metadata/typed15, versioned Python69 and WASM16 allowlists are eligibility, not blanket dtype/mode/parameter verification.', 'No native C/C++ executable generator or MATLAB/Simulink/SimEvents reference runtime is available/claimed.', 'Current MathWorks Block Support Table documents dtype table UI and ignores code-generation support; it cannot substitute target validation: https://www.mathworks.com/help/simulink/slref/blocksupporttable.html', 'Dashboard Display binding and Sinks Display signal ports remain separate source identities: https://www.mathworks.com/help/simulink/slref/dashboarddisplay.html ; https://www.mathworks.com/help/simulink/slref/display.html', 'Generation is deterministic from pinned source/roadmap, preserved approvals/proofs, current registry/schema and versioned target metadata; no timestamps/random IDs/network calls.', 'Tracking decisions/QA gaps/owner/version are complete for every row; full native equivalence remains false for all385.'] };
  assert.equal(result.counts.selectedSubsetRows, 367); assert.equal(result.counts.unsupportedRows, 18);
  return validateSupportMatrix(result);
}

export function supportMarkdown(matrix: SupportMatrix): string {
  const count = matrix.counts;
  return `# CalcWeave 현행 지원 매트릭스\n\n엔진 ${matrix.engineVersion} · 운영자 JTech-Co · [기계 판독 JSON](support-matrix.json). 이 문서는 생성기로 결정적으로 작성한다.\n\n원본 R2024b ${count.trackedSourceRows}행(${count.uniqueSourceNames}개 이름)의 결정·근거·미확정 이유를 전수 추적한다. 선택 subset ${count.selectedSubsetRows}행과 미지원 ${count.unsupportedRows}행을 분리한다. 공식 원본의 전체 옵션 inventory는 ${count.unverifiedInventoryRows}행 모두 미검증이며 전체 동등성 승인 행은 0개다.\n\n계산 registry ${count.registryDefinitions}개, UI model-widget ${count.widgetContracts}개, 미지원 목적 canonical ${count.unavailableContracts}개(${count.unsupportedRows}행)은 서로 다른 계약이다. 로컬 parameter default/enum/bounds는 선언 schema이며 해당 값 또는 모든 조합의 수치 QA 완료를 뜻하지 않는다.\n\nPython ${count.pythonDefinitionMembership}개와 WASM ${count.wasmDefinitionMembership}개의 versioned allowlist는 실제 모델의 dtype·mode·parameter·샘플링·resource 진단을 통과해야 하는 후보 목록이다. TypeScript typed15 wire를 모든 consumer가 지원한다고 해석하지 않는다. C/C++ native 실행 generator는 환경 미지원이다.\n\n[공식 Block Support Table](https://www.mathworks.com/help/simulink/slref/blocksupporttable.html)은 dtype 조회 UI이며 코드 생성 지원을 대신 확인하지 않는다. [Dashboard Display](https://www.mathworks.com/help/simulink/slref/dashboarddisplay.html)의 연결형 UI와 [Sinks Display](https://www.mathworks.com/help/simulink/slref/display.html)의 신호 포트 목적을 원본 ID로 구분한다. 현재 웹 문서의 개념 확인은 R2024b 전수 옵션 inventory 승인 근거가 아니다.\n\n| 원본 ID | 블럭명 | 결정 | 분류 | 구현 계약 | 옵션 inventory |\n| --- | --- | --- | --- | --- | --- |\n${matrix.rows.map(row => `| ${row.id} | ${row.name.replaceAll('|','\\|')} | ${row.decision.status} | ${row.decision.classification} | ${row.implementations.map(value => value.id).join(', ')} | unverified |`).join('\n')}\n\n모든 행의 exact 선택 parameter/fixture/증거 SHA, dtype·mode·target 경계, 외부 조건과 개별 미지원 이유는 JSON에 있다. 일부 과거 단계에 source-specific profile JSON이 없으면 수치 승인을 새로 만들지 않고 미확정으로 기록한다. ` + '`tsx scripts/generate-support-matrix.ts --check`' + '로 byte-identical 생성과 역사25개 hash·registry337개 객체를 검증한다.\n';
}
