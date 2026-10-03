import { describe, it, expect } from 'vitest';
import { compileModel } from '../packages/compiler/src';
import { blockRegistry } from '../packages/block-library/src';
import { createPythonExportManifest, exportPython, getPythonDiagnostics, PYTHON_TARGET, PYTHON_M7_TARGET } from '../packages/codegen-python/src';
import { ModelError, type CalcModel, type SubsystemDefinition } from '../packages/model/src';
import { block, connect, staticModel } from './m1-engine-fixtures';
import { M15_PYTHON_DEFINITION_FIXTURES, M15_PYTHON_BOUNDARY_FIXTURES, M15_PYTHON_FAILURE_FIXTURES } from './m15-python-fixtures';
import { m15Compare, m15Diagnostics, m15Execute, m15NativeOutcome } from './m15-python-harness';

describe('M15 actual Python 3.14 bounded string target', () => {
  it('keeps the 51 historical capabilities and canonical registry metadata', async () => {
    expect(PYTHON_M7_TARGET.blockIds).toHaveLength(51); expect(PYTHON_M7_TARGET.id).toBe('python-m7-v1');
    expect(PYTHON_TARGET.blockIds).toHaveLength(69); expect(new Set(PYTHON_TARGET.blockIds).size).toBe(69);
    expect(PYTHON_M7_TARGET.blockIds.every(id => PYTHON_TARGET.blockIds.includes(id))).toBe(true);
    expect(blockRegistry).toHaveLength(337); expect(blockRegistry.every(def => def.exportTargets.includes('python') === PYTHON_M7_TARGET.blockIds.includes(def.id))).toBe(true);
    const compiled = compileModel(staticModel([block('source','source.constant',{value:2}),block('result','sink.display')],[connect('source','result')]));
    const old = createPythonExportManifest(compiled,PYTHON_M7_TARGET); expect(old.targetVersion).toBe('python-m7-v1');
    expect((await m15Execute(compiled,{target:PYTHON_M7_TARGET})).manifest).toEqual(old);
    expect(createPythonExportManifest(compiled).targetVersion).toBe('python-m15-v1');
  });
  it.each([...M15_PYTHON_DEFINITION_FIXTURES, ...M15_PYTHON_BOUNDARY_FIXTURES])('literal static oracle: $name', async fixture => {
    const compiled = compileModel(fixture.model), frozen = JSON.stringify(compiled), native = await m15NativeOutcome(compiled), python = await m15Execute(compiled);
    expect(python.error).toBeUndefined(); m15Compare(python.result, native.result); m15Compare(python.result!.samples[0]!.values, fixture.expected);
    expect(python.manifest).toEqual(createPythonExportManifest(compiled)); expect(JSON.stringify(compiled)).toBe(frozen);
  });
  it.each(M15_PYTHON_DEFINITION_FIXTURES)('fixed-tick typed publication: $name', async fixture => {
    const model = structuredClone(fixture.model); model.execution = { mode:'discrete',startTime:0,stopTime:1,step:.5 };
    const compiled = compileModel(model), python = await m15Execute(compiled), native = await m15NativeOutcome(compiled);
    expect(python.error).toBeUndefined(); m15Compare(python.result,native.result); expect(python.result!.samples.map(sample=>sample.time)).toEqual([0,.5,1]);
    for (const sample of python.result!.samples) m15Compare(sample.values,fixture.expected);
  });
  it.each(M15_PYTHON_FAILURE_FIXTURES)('bounded diagnostic and partial result: $name', async fixture => {
    const compiled = compileModel(fixture.model);
    if (fixture.phase === 'target') { expect(getPythonDiagnostics(compiled).some(item=>item.code===fixture.code&&item.nodeId)).toBe(true); expect(()=>exportPython(compiled)).toThrow(ModelError); return; }
    const python = await m15Execute(compiled), native = await m15NativeOutcome(compiled);
    expect(python.error?.diagnostics.some(item=>item.code===fixture.code)).toBe(true); expect(python.error?.partialResult?.samples).toHaveLength(fixture.expectedSamples!);
    expect(m15Diagnostics(python.error)).toEqual(m15Diagnostics(native.error)); m15Compare(python.error?.partialResult,native.error?.partialResult);
  });
  it('rejects unsupported nested typed configuration at its original model location', () => {
    const definition: SubsystemDefinition = { id:'bad',version:1,name:'bad',nodes:[block('source','source.typed',{value:{kind:'typed',dtype:'complex128',shape:[],data:[{re:1,im:0}]}}),block('out','io.output')],edges:[connect('source','out')],layout:{},inputs:[],outputs:[{id:'out',nodeId:'out'}] };
    const model = staticModel([block('box','hierarchy.subsystem',{definitionId:'bad',version:1}),block('result','sink.display')],[connect('box','result')]); model.subsystems=[definition];
    const reasons=getPythonDiagnostics(compileModel(model)); expect(reasons.some(item=>item.nodeId==='box'&&item.code==='PYTHON_UNSUPPORTED_DTYPE'&&item.message.includes('box / source'))).toBe(true);
  });
  it('emits only fixed repository code and inert hex JSON; snapshots and reruns own their values', async () => {
    const fixture = M15_PYTHON_DEFINITION_FIXTURES[0]!, compiled=compileModel(fixture.model), source=exportPython(compiled);
    expect(source).not.toMatch(/\beval\s*\(|\bexec\s*\(|\bimport\s+(numpy|calcweave|urllib|requests|subprocess|os|re)\b/);
    const harness = `import importlib.util,json,pathlib\np=pathlib.Path(__file__).with_name("model.py")\ns=importlib.util.spec_from_file_location("owned",p)\nm=importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\na=m.run()\na["samples"][0]["values"]["result"]["data"][0]="mutated"\nz=m.get_manifest()\nz["execution"]["startTime"]=999\nprint(json.dumps({"manifest":m.get_manifest(),"result":m.run()},allow_nan=False))\n`;
    const repeated=await m15Execute(compiled,{harness}); expect(repeated.manifest).toEqual(createPythonExportManifest(compiled)); m15Compare(repeated.result!.samples[0]!.values,fixture.expected);
    const corrupted=source.replace(/(_DATA_TEXT = bytes.fromhex\(")([a-f0-9]{2})/,'$100'); expect((await m15Execute(compiled,{source:corrupted})).error?.diagnostics[0]?.code).toBe('EXPORT_DATA_HASH_MISMATCH');
  });
  it('keeps structured and continuous target rejection explicit', () => {
    const model:CalcModel=structuredClone(M15_PYTHON_DEFINITION_FIXTURES[0]!.model); model.execution={mode:'continuous',startTime:0,stopTime:1,step:.1};
    expect(getPythonDiagnostics(compileModel(model)).some(reason=>reason.code==='PYTHON_UNSUPPORTED_MODE')).toBe(true);
    expect(getPythonDiagnostics(compileModel(M15_PYTHON_DEFINITION_FIXTURES[0]!.model),PYTHON_M7_TARGET).some(reason=>reason.code==='PYTHON_UNSUPPORTED_BLOCK')).toBe(true);
  });
});
