import { useEffect, useMemo, useState } from 'react';
import { BLOCK_REGISTRY } from '../../../../packages/block-library/src';
import { compileModel } from '../../../../packages/compiler/src';
import { ModelError, type CalcModel, type Diagnostic } from '../../../../packages/model/src';
import { C_CPP_TARGET } from '../../../../packages/codegen-wasm/src/capabilities';
import { Icon } from './Icon';
import { ModalDialog } from './ModalDialog';

export type CodeTarget = 'typescript' | 'python' | 'wasm';
type Selection = CodeTarget | 'c-cpp';
interface TargetInfo { diagnostics: Diagnostic[]; blockIds: readonly string[]; minimumVersion?: string }
export function CodeExportDialog({ model, invalidDraft, hasExpected, onClose, onDownload }: { model: CalcModel; invalidDraft: boolean; hasExpected: boolean; onClose: () => void; onDownload: (target: CodeTarget, archive: boolean) => Promise<void> }) {
  const [target, setTarget] = useState<Selection>('typescript');
  const [python, setPython] = useState<TargetInfo | null>(null);
  const [wasm, setWasm] = useState<TargetInfo | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const compiled = useMemo(() => { try { return { model: compileModel(model), diagnostics: [] as Diagnostic[] }; } catch (error) { return { model: null, diagnostics: error instanceof ModelError ? error.diagnostics : [{ code: 'EXPORT_VALIDATION', message: '모델을 확인하지 못했습니다.' }] }; } }, [model]);
  useEffect(() => {
    let alive = true;
    import('../../../../packages/codegen-python/src').then(api => { if (alive) setPython({ diagnostics: compiled.model ? api.getPythonDiagnostics(compiled.model) : [], blockIds: api.PYTHON_TARGET.blockIds, minimumVersion: api.PYTHON_TARGET.minimumVersion }); }).catch(() => { if (alive) setError('Python 타깃을 불러오지 못했습니다. 다시 여세요.'); });
    import('../../../../packages/codegen-wasm/src').then(api => { if (alive) setWasm({ diagnostics: compiled.model ? api.getWasmDiagnostics(compiled.model) : [], blockIds: api.WASM_TARGET.blockIds }); }).catch(() => { if (alive) setError('WASM 타깃을 불러오지 못했습니다. 다시 여세요.'); });
    return () => { alive = false; };
  }, [compiled]);
  const info = target === 'python' ? python : target === 'wasm' ? wasm : null;
  const diagnostics = [...compiled.diagnostics, ...(info?.diagnostics ?? []), ...(target === 'c-cpp' ? [{ code: C_CPP_TARGET.diagnosticCode, message: C_CPP_TARGET.reason }] : []), ...(invalidDraft ? [{ code: 'INVALID_NUMBER_DRAFT', message: '편집 중인 입력값을 먼저 확인하세요.' }] : [])];
  const ready = !!compiled.model && !diagnostics.length && (target === 'typescript' || !!info) && target !== 'c-cpp' && !pending;
  const supportedIds = target === 'typescript' ? BLOCK_REGISTRY.map(block => block.id) : info?.blockIds ?? [];
  const supportedNodes = compiled.model?.nodes.filter(node => supportedIds.includes(node.blockType)).length ?? 0;
  const title = target === 'python' ? `Python ${python?.minimumVersion ?? '3.10'} 이상` : target === 'wasm' ? 'WebAssembly · Core 1' : target === 'c-cpp' ? 'C/C++ · 미지원' : 'TypeScript · ES2022';
  const description = target === 'python' ? '정적·이산 계산과 승인된 문자열·태그형 신호를 Python 표준 라이브러리로 실행합니다. dtype·형상·옵션별 지원 조건을 아래에서 확인하세요.' : target === 'wasm' ? '유한 실수 scalar DAG를 자체 WASM 모듈로 생성합니다. 정적·base tick 이산 실행과 검증된 단위를 보존하며 저장 상태·연속 solver·사용자 모듈은 지원하지 않습니다.' : target === 'c-cpp' ? '코드 생성만으로 실행 지원을 승인하지 않습니다. 검증한 컴파일러·ABI·실행 결과가 있는 프로필을 추가하기 전까지 내보내기를 제공하지 않습니다.' : '정적·이산·연속 실행 계획을 외부 import 없는 TypeScript로 생성합니다. TypeScript 도구와 Node.js 실행 환경을 준비하세요.';
  const download = async (archive: boolean) => {
    if (!ready) return;
    setPending(true); setError('');
    try { await onDownload(target, archive); } catch (error) { setError(error instanceof Error ? error.message : '다운로드를 준비하지 못했습니다.'); }
    finally { setPending(false); }
  };
  return <ModalDialog labelId="code-export-title" className="code-export-dialog" onClose={onClose} initialFocus="[aria-label='코드 타깃']">
    <div className="dialog-heading"><div><h2 id="code-export-title">코드 내보내기</h2><p>현재 모델의 실행 계획을 독립 코드로 보관합니다.</p></div><button className="icon-button" aria-label="코드 내보내기 닫기" onClick={onClose}><Icon name="close"/></button></div>
    <div className="dialog-content export-content">
      <label className="field"><span className="field-label">실행 환경</span><select aria-label="코드 타깃" value={target} onChange={event => { setTarget(event.target.value as Selection); setError(''); }}><option value="typescript">TypeScript · ES2022</option><option value="python">Python · 3.10 이상</option><option value="wasm">WebAssembly · Core 1</option><option value="c-cpp">C/C++ · 미지원</option></select></label>
      <section className="export-summary"><h3>{title}</h3><p>{description}</p><dl className="support-metadata"><div><dt>지원 블록</dt><dd>{supportedIds.length} / {BLOCK_REGISTRY.length}개 등록 블록 · 옵션별 조건 적용</dd></div><div><dt>현재 도식</dt><dd>{supportedNodes} / {compiled.model?.nodes.length ?? model.nodes.length}개 계산 블록 · 펼친 실행 계획 기준</dd></div><div><dt>기준 결과</dt><dd>{hasExpected ? '현재 모델의 완료 결과를 실행 묶음에 포함합니다.' : '현재 모델의 완료 결과가 없습니다. 실행하면 기준 결과도 함께 보관할 수 있습니다.'}</dd></div></dl></section>
      <div className={`export-validation ${diagnostics.length ? 'has-errors' : ''}`} role="status">{(target === 'python' || target === 'wasm') && !info ? '타깃 지원 범위를 확인하고 있습니다.' : diagnostics.length ? '이 타깃으로 내보낼 수 없습니다. 아래 항목을 확인하세요.' : '현재 모델을 이 타깃으로 내보낼 수 있습니다.'}</div>
      {!!diagnostics.length && <ul className="export-diagnostics">{diagnostics.map((item, index) => <li key={`${item.code}-${index}`}><strong>{item.code}{item.nodeId ? ` · ${item.nodeId}` : ''}</strong><p>{item.message}</p></li>)}</ul>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="button primary" disabled={!ready} onClick={() => void download(false)}>{pending ? '파일 준비 중' : target === 'python' ? 'Python 코드 다운로드' : target === 'wasm' ? 'WASM 모듈 다운로드' : 'TypeScript 코드 다운로드'}</button><button className="button" disabled={!ready} onClick={() => void download(true)}>{target === 'python' ? 'Python 실행 묶음' : target === 'wasm' ? 'WASM 실행 묶음' : 'TypeScript 실행 묶음'}</button></div>
    </div><div className="dialog-footnote">실행 묶음: 모델·manifest·코드·실행 예제와 유효한 기준 결과<button className="text-button" onClick={onClose}>닫기</button></div>
  </ModalDialog>;
}
