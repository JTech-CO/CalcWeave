import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { blockRegistry } from '../packages/block-library/src';
import { PYTHON_TARGET } from '../packages/codegen-python/src/capabilities';
import { WASM_TARGET } from '../packages/codegen-wasm/src/capabilities';
import { ENGINE_VERSION } from '../packages/model/src';
import { SUPPORT_MATRIX, getSourceSupport, getCanonicalSupport, getSupportSummary, listSourceSupport, serializeSupportMatrix, validateSupportMatrix, type SupportFilter } from '../packages/support-matrix/src';
import { parseSourceInventory } from '../scripts/m16-support-source';

describe('M16 source support matrix decisions and bounded public metadata API', () => {
  it('tracks every original source identity/line/condition without collecting ancillary sections22..25', () => {
    const original = parseSourceInventory(readFileSync('dataset/Simulink_Basic_Blocks_R2024b.md','utf8'));
    expect(original.rows).toHaveLength(385); expect(original.sections).toHaveLength(21);
    expect(SUPPORT_MATRIX.rows.map(row => ({ id: row.id, name: row.name, section: row.section, ordinal: row.ordinal, line: row.source.line, subgroup: row.subgroup, condition: row.condition }))).toEqual(original.rows);
    for (const row of original.rows) expect(getSourceSupport(row.id)!.source.identitySha256).toBe(createHash('sha256').update(JSON.stringify(row)).digest('hex'));
  });
  it('separates385 tracked/367 selected/18 unavailable and declares every official inventory unverified', () => {
    expect(getSupportSummary()).toEqual({ trackedSourceRows:385,uniqueSourceNames:339,selectedSubsetRows:367,unsupportedRows:18,unverifiedInventoryRows:385,fullOptionEquivalentRows:0,registryDefinitions:337,canonicalContracts:352,widgetContracts:5,unavailableContracts:10,pythonDefinitionMembership:69,wasmDefinitionMembership:16,trackingDecisionCompleteRows:385 });
    expect(SUPPORT_MATRIX.engineVersion).toBe(ENGINE_VERSION);
    for (const row of SUPPORT_MATRIX.rows) { expect(row.owner).toBe('JTech-Co'); expect(row.fullEquivalence).toBe(false); expect(row.trackingDecisionComplete).toBe(true); expect(row.sourceInventory.fullOptionInventoryObtained).toBe(false); expect(row.sourceInventory.status).toBe('unverified'); expect(row.verification.engineVersion).toBe(ENGINE_VERSION); }
  });
  it('preserves337 historical definitions and labels every parameter declaration rather than approving all enum choices', () => {
    const baseline = JSON.parse(readFileSync('docs/baselines/m15-registry.json','utf8')); expect(blockRegistry).toEqual(baseline);
    for (const definition of blockRegistry) {
      const contract = getCanonicalSupport(definition.id)!; expect(contract.kind).toBe('registry-block');
      for (const [name,parameter] of Object.entries(definition.parameters)) { const local = contract.parameters[name]!; expect(local.default).toEqual(parameter.default); expect(local.options).toEqual(parameter.options); expect(local.min).toBe(parameter.min); expect(local.max).toBe(parameter.max); expect(local.qaStatus).toBe('declared-local-schema-not-exhaustive-source-inventory'); }
    }
  });
  it('keeps three Display source purposes and binding/port metadata distinct', () => {
    const existing = getSourceSupport('03-005')!, custom = getSourceSupport('03-024')!, sink = getSourceSupport('16-001')!;
    expect(existing.implementations).toEqual([{id:'dashboard.readout',kind:'model-widget'}]); expect(existing.capabilities.targets.every(target=>target.status!=='selected-config-eligible')).toBe(true);
    expect(getCanonicalSupport('dashboard.readout')!.bindings).toContain('최종 root scalar float64 outputId');
    expect(custom.implementations[0]!.id).toBe('dashboard.indicator'); expect(custom.capabilities.optionProfiles[0]!.parameters.appearance).toBe('custom');
    expect(sink.implementations[0]!.id).toBe('sink.display'); expect(getCanonicalSupport('sink.display')!.declaration.inputs).toEqual(['in']);
  });
  it('links Bit Clear to its exact selector and actual preserved preset fixtures', () => {
    const row = getSourceSupport('06-001')!; expect(row.decision.classification).toBe('preset'); const profile = row.capabilities.optionProfiles[0]!;
    expect(profile.parameters).toEqual({operation:'clear'}); expect(profile.presetId).toBe('m10-bit-clear'); expect(profile.fixtureIds).toHaveLength(3); expect(profile.evidencePath).toBe('docs/evidence/m10-verification.json');
  });
  it('links four early fixed M1 presets to separate literal/native/actual TS revalidation while preserving prior status', () => {
    const proof = JSON.parse(readFileSync('docs/evidence/m16-preset-verification.json','utf8')); expect(proof.actualStandalonePrograms).toBe(4);
    for (const id of ['08-002','08-032','21-006','21-007']) { const row=getSourceSupport(id)!; expect(row.decision.priorStatus).toBe('M1 preset subset'); expect(row.capabilities.optionProfiles[0]!.evidencePath).toBe('docs/evidence/m16-preset-verification.json'); expect(row.capabilities.optionProfiles[0]!.modes).toEqual(['static']); }
  });
  it('separates bundled C Caller alternative from unavailable native C environment', () => {
    const row=getSourceSupport('19-001')!; expect(row.decision.classification).toBe('independent-alternative'); expect(row.capabilities.optionProfiles[0]!.parameters).toEqual({gain:3,bias:-1});
    expect(row.externalConditions.profileIds).toEqual(['calcweave.wasm-affine-f64-v1','native.c-caller']); expect(row.externalConditions.nativeExecution).toBe('unavailable'); expect(row.externalConditions.primarySourceRuntimeExecuted).toBe(false);
  });
  it('records meaningful individual unavailable purposes including MATLAB System and legacy interpreter', () => {
    const rows=SUPPORT_MATRIX.rows.filter(row=>row.decision.status!=='selected-subset'); expect(rows).toHaveLength(18);
    for (const row of rows) { expect(row.decision.reason).toContain(row.name); expect(row.implementations[0]!.kind).toBe('unavailable-capability'); expect(row.capabilities.optionProfiles).toEqual([]); expect(row.capabilities.modes).toEqual([]); expect(row.capabilities.targets.every(target=>target.status!=='selected-config-eligible')).toBe(true); }
    expect(getSourceSupport('19-009')!.externalConditions.profileIds).toContain('native.matlab-system'); expect(getSourceSupport('19-009')!.decision.reason).toContain('System object'); expect(getSourceSupport('19-006')!.decision.status).toBe('legacy-unavailable');
    expect(getSourceSupport('10-004')!.decision.reason).toContain('message'); expect(getSourceSupport('13-015')!.decision.reason).toContain('필드 경로'); expect(getSourceSupport('15-013')!.decision.reason).toContain('inactive');
  });
  it('uses current Python69/WASM16 capabilities without mutating old51 registry Python metadata', () => {
    const ids = (target:string) => SUPPORT_MATRIX.canonicalContracts.filter(row=>row.kind==='registry-block'&&row.targets.some(value=>value.target===target&&value.status==='selected-config-eligible')).map(row=>row.id).sort();
    expect(ids('python')).toEqual([...PYTHON_TARGET.blockIds].sort()); expect(ids('wasm')).toEqual([...WASM_TARGET.blockIds].sort()); expect(blockRegistry.filter(value=>value.exportTargets.includes('python'))).toHaveLength(51);
    expect(getSourceSupport('18-006')!.capabilities.targets.find(value=>value.target==='python')!.status).toBe('selected-config-eligible'); expect(getSourceSupport('18-006')!.capabilities.targets.find(value=>value.target==='wasm')!.status).toBe('unsupported');
    expect(listSourceSupport({target:'c-cpp'})).toEqual([]);
  });
  it('keeps modeled modes and target eligibility conditional rather than all-configuration verified', () => {
    for (const row of SUPPORT_MATRIX.rows) { expect(row.capabilities.modeQaStatus).toBe('declared-canonical-modes-require-model-validation'); for (const target of row.capabilities.targets) { expect(target.requiresActualModelValidation).toBe(true); expect(target.allConfigurationsVerified).toBe(false); if (target.target==='python'||target.target==='wasm') expect(target.supportedModes).not.toContain('continuous'); } }
  });
  it('retains all25 protected historical hashes and source/profile evidence file identity', () => {
    expect(Object.keys(SUPPORT_MATRIX.protectedArtifacts)).toHaveLength(25);
    for (const [path,sha] of Object.entries(SUPPORT_MATRIX.protectedArtifacts)) expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(sha);
    const paths=new Map(SUPPORT_MATRIX.rows.flatMap(row=>row.evidence.map(value=>[value.path,value.sha256] as const)));
    for (const [path,sha] of paths) expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(sha);
  });
  it('provides stable query/section/decision filters and canonical exact lookup', () => {
    expect(listSourceSupport({query:'18-006'}).map(row=>row.id)).toEqual(['18-006']); expect(listSourceSupport({section:18})).toHaveLength(16);
    expect(listSourceSupport({decision:'unsupported'})).toHaveLength(17); expect(listSourceSupport({decision:'legacy-unavailable'})).toHaveLength(1);
    expect(getSourceSupport('unknown')).toBeUndefined(); expect(getCanonicalSupport('unknown')).toBeUndefined();
    expect(listSourceSupport({query:'Display'}).map(row=>row.id)).toEqual(expect.arrayContaining(['03-005','03-024','16-001']));
  });
  it.each([{query:'x'.repeat(257)},{section:0},{section:22},{classification:'invented'},{decision:'invented'},{target:'javascript'},{target:{}},{query:()=>''},{unknown:true}])('rejects invalid external filters %j', input=>{
    expect(()=>listSourceSupport(input as SupportFilter)).toThrow();
  });
  it('rejects filter getters without invoking them or accepting custom prototypes', () => {
    let calls=0; const filter=Object.defineProperty({},'query',{enumerable:true,get(){calls++; return 'x';}}); expect(()=>listSourceSupport(filter)).toThrow(); expect(calls).toBe(0); expect(()=>listSourceSupport(Object.create({query:'x'}))).toThrow();
  });
  it('returns immutable metadata and a separate deterministic JSON serialization', () => {
    const row=getSourceSupport('06-001')!; expect(Object.isFrozen(row)).toBe(true); expect(Object.isFrozen(row.capabilities.optionProfiles[0]!.parameters)).toBe(true);
    expect(()=>{ row.capabilities.optionProfiles[0]!.parameters.operation='set'; }).toThrow(); const clone=JSON.parse(serializeSupportMatrix()); clone.rows[0].name='changed'; expect(getSourceSupport('01-001')!.name).toBe('Bus Creator'); expect(serializeSupportMatrix()).toBe(readFileSync('docs/support-matrix.json','utf8'));
  });
  it('rejects a fabricated equivalence/complete-inventory claim', () => {
    const clone=JSON.parse(serializeSupportMatrix()); clone.rows[0].fullEquivalence=true; clone.exhaustiveSourceOptionInventoryVerified=true; expect(()=>validateSupportMatrix(clone)).toThrow();
  });
  it('rejects an unsupported row advertised as an executable block', () => {
    const clone=JSON.parse(serializeSupportMatrix()); const row=clone.rows.find((value:{id:string})=>value.id==='19-009'); row.capabilities.targets[0].status='selected-config-eligible'; row.capabilities.targets[0].supportedModes=['static']; expect(()=>validateSupportMatrix(clone)).toThrow();
  });
  it('rejects invented preset proof references and missing canonical option refs', () => {
    const clone=JSON.parse(serializeSupportMatrix()); const row=clone.rows.find((value:{id:string})=>value.id==='06-001'); row.capabilities.optionProfiles[0].fixtureIds=['invented-fixture']; expect(()=>validateSupportMatrix(clone)).toThrow();
  });
  it('bounds JSON input before schema access and rejects accessors/cycles/unsafe keys', () => {
    let invoked=0; expect(()=>validateSupportMatrix(Object.defineProperty({},'rows',{get(){invoked++; return [];}}))).toThrow(); expect(invoked).toBe(0);
    const cycle:{self?:unknown}={}; cycle.self=cycle; expect(()=>validateSupportMatrix(cycle)).toThrow(); expect(()=>validateSupportMatrix(JSON.parse('{"__proto__":{}}'))).toThrow(); expect(()=>validateSupportMatrix({text:'x'.repeat(20001)})).toThrow(); expect(()=>validateSupportMatrix({fn:()=>1})).toThrow();
  });
  it('rejects sparse oversized arrays and invisible symbol fields before schema iteration', () => {
    expect(()=>validateSupportMatrix({rows:new Array(10_000_000)})).toThrow(); expect(()=>validateSupportMatrix({[Symbol('hidden')]:1})).toThrow(); expect(()=>listSourceSupport({[Symbol('hidden')]:1})).toThrow();
  });
});
