import { describe, expect, it } from 'vitest';
import { importDataset } from '../packages/data/src';
import { compileModel } from '../packages/compiler/src';
import { runModel } from '../packages/runtime/src';
import { createExportManifest } from '../packages/codegen-ts/src';
import { ModelError, type CalcModel, type CalcNode } from '../packages/model/src';

const n = (id:string, blockType:string, parameters:Record<string,unknown> = {}, unit?:string):CalcNode => ({id,blockType,blockVersion:1,label:id,parameters,...(unit?{unit}:{})});
const graph = (nodes:CalcNode[], connections:[string,string,string?][], mode:CalcModel['execution']['mode']='static'):CalcModel => ({schemaVersion:1,modelId:'m4integration',name:'M4 검증',nodes,edges:connections.map(([source,target,port='in'],i)=>({id:`e${i}`,source:{nodeId:source,portId:'out'},target:{nodeId:target,portId:port}})),execution:{mode,startTime:0,stopTime:1,step:.1},layout:{}});
const numericData = () => importDataset('time,value\n0,10\n2,30', {id:'data',name:'원본',format:'csv',timeColumn:'time',columns:[{name:'time',kind:'number',unit:'s'},{name:'value',kind:'number',unit:'1'}]});
const playback = (outside='hold') => n('dataNode','source.dataset',{datasetId:'data',column:'value',interpolation:'linear',outside});
const code = (operation:()=>unknown) => { try {operation();} catch(error) {expect(error).toBeInstanceOf(ModelError);return (error as ModelError).diagnostics[0]!.code;} throw new Error('Expected diagnostic'); };

describe('M4 project execution boundaries',()=>{
  it('evaluates a static playback at execution.startTime and preserves only portable references',async()=>{
    const model=graph([playback(),n('out','sink.display')],[['dataNode','out']]);model.datasets=[numericData()];model.execution.startTime=1;model.execution.stopTime=1;
    const compiled=compileModel(model);
    expect((await runModel(compiled)).samples[0]!.values.out).toBe(20);
    expect(compiled.model.nodes[0]!.parameters).toEqual({datasetId:'data',column:'value',interpolation:'linear',outside:'hold'});
    expect(compiled.nodes.find(node=>node.id==='dataNode')!.parameters.times).toEqual([0,2]);
    const manifest=await createExportManifest(compiled);expect(manifest.targetVersion).toBe('typescript-m4-v1');expect(manifest.dataReferences[0]!.contentHash).toBe(model.datasets[0]!.contentHash);
  });
  it('rejects absent dataset references, boolean linear interpolation and changed contents',()=>{
    const model=graph([playback(),n('out','sink.display')],[['dataNode','out']]);expect(code(()=>compileModel(model))).toBe('DATASET_REFERENCE_MISSING');
    model.datasets=[importDataset('time,value\n0,true\n1,false',{id:'data',name:'논리',format:'csv',timeColumn:'time',columns:[{name:'time',kind:'number',unit:'s'},{name:'value',kind:'boolean',unit:'1'}]})];
    expect(code(()=>compileModel(model))).toBe('DATASET_INTERPOLATION');
    model.nodes[0]!.parameters.interpolation='previous';model.datasets[0]!.rows[0]![1]=false;
    expect(code(()=>compileModel(model))).toBe('DATASET_HASH_MISMATCH');
  });
  it('converts vector scale and scalar temperature offset without changing shapes',async()=>{
    const model=graph([n('value','source.constant',{value:[50,100]},'cm'),n('convert','unit.convert',{from:'cm',to:'m'}),n('out','sink.display')],[['value','convert'],['convert','out']]);
    let compiled=compileModel(model);expect(compiled.outputTypes.out).toMatchObject({unit:'m',shape:[2]});expect((await runModel(compiled)).samples[0]!.values.out).toEqual([.5,1]);
    model.nodes[0]!.unit='C';model.nodes[0]!.parameters.value=0;model.nodes[1]!.parameters={from:'C',to:'K'};
    compiled=compileModel(model);expect((await runModel(compiled)).samples[0]!.values.out).toBe(273.15);
  });
  it('validates Bus names and type while selecting by compiled field name',async()=>{
    const model=graph([n('a','source.constant',{value:3}),n('b','source.constant',{value:7}),n('bus','route.bus-create',{first:'position',second:'velocity'}),n('select','route.bus-select',{field:'velocity'}),n('out','sink.display')],[['a','bus','a'],['b','bus','b'],['bus','select'],['select','out']]);
    expect((await runModel(compileModel(model))).samples[0]!.values.out).toBe(7);
    model.nodes[3]!.parameters.field='missing';expect(code(()=>compileModel(model))).toBe('UNKNOWN_BUS_FIELD');
    model.nodes[3]!.parameters.field='position';model.nodes[1]!.parameters.value=true;expect(code(()=>compileModel(model))).toBe('TYPE_MISMATCH');
    model.nodes[1]!.parameters.value=7;model.nodes[2]!.parameters.second='position';expect(code(()=>compileModel(model))).toBe('INVALID_BUS_FIELDS');
  });
  it('preserves a semantic result for notes/dashboard presentation and rejects invalid bindings',()=>{
    const model=graph([n('value','source.constant',{value:2}),n('out','sink.display')],[['value','out']]);
    const initial=compileModel(model).semanticKey;
    model.notes='<script>plain text</script>';model.dashboard=[{id:'slider',kind:'slider',title:'값',nodeId:'value',parameter:'value',min:0,max:5,step:1},{id:'readout',kind:'display',title:'결과',nodeId:'out'}];
    model.nodes.push(n('note','annotation.note',{text:'실행과 무관한 설명'}),n('info','annotation.model-info'));
    expect(compileModel(model).semanticKey).toBe(initial);
    model.dashboard[0]!.nodeId='out';expect(code(()=>compileModel(model))).toBe('INVALID_DASHBOARD_BINDING');
  });
  it.each(['static','discrete','continuous'] as const)('tracks bounded work only on request in %s mode',async mode=>{
    const model=graph([n('value','source.constant',{value:2}),n('out','sink.display')],[['value','out']],mode);
    const compiled=compileModel(model), ordinary=await runModel(compiled), tracked=await runModel(compiled,{trackOperations:true});
    expect(ordinary.resources).toBeUndefined();expect(tracked.resources!.operations).toBeGreaterThan(0);
    expect(tracked.samples).toEqual(ordinary.samples);
    await expect(runModel(compiled,{maxOperations:1,trackOperations:true})).rejects.toMatchObject({diagnostics:[{code:'RUNTIME_OPERATION_BUDGET'}]});
    await expect(runModel(compiled,{maxOperations:Infinity})).rejects.toMatchObject({diagnostics:[{code:'RUNTIME_OPTIONS'}]});
  });
});
