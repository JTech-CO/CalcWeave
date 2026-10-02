import { useEffect, useMemo, useState } from 'react';
import { BLOCK_REGISTRY } from '../../../../packages/block-library/src';
import { compileModel } from '../../../../packages/compiler/src';
import { ModelError, type CalcModel, type Diagnostic } from '../../../../packages/model/src';
import { Icon } from './Icon';
import { ModalDialog } from './ModalDialog';

export type CodeTarget = 'typescript' | 'python';
export function CodeExportDialog({ model, invalidDraft, hasExpected, onClose, onDownload }: { model: CalcModel; invalidDraft: boolean; hasExpected: boolean; onClose: () => void; onDownload: (target: CodeTarget, archive: boolean) => Promise<void> }) {
  const [target, setTarget] = useState<CodeTarget>('typescript');
  const [python, setPython] = useState<{ diagnostics: Diagnostic[]; blockIds: readonly string[]; minimumVersion: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const compiled = useMemo(() => { try { return { model: compileModel(model), diagnostics: [] as Diagnostic[] }; } catch (error) { return { model: null, diagnostics: error instanceof ModelError ? error.diagnostics : [{ code: 'EXPORT_VALIDATION', message: '모델을 확인하지 못했습니다.' }] }; } }, [model]);
  useEffect(() => {
    let alive = true;
    import('../../../../packages/codegen-python/src').then(api => {
      if (alive) setPython({ diagnostics: compiled.model ? api.getPythonDiagnostics(compiled.model) : [], blockIds: api.PYTHON_TARGET.blockIds, minimumVersion: api.PYTHON_TARGET.minimumVersion });
    }).catch(() => { if (alive) setError('Python 타깃을 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 여세요.'); });
    return () => { alive = false; };
  }, [compiled]);
  const diagnostics = [...compiled.diagnostics, ...(target === 'python' ? python?.diagnostics ?? [] : []), ...(invalidDraft ? [{ code: 'INVALID_NUMBER_DRAFT', message: '편집 중인 입력값을 먼저 확인하세요.' }] : [])];
  const ready = !!compiled.model && !diagnostics.length && (target === 'typescript' || !!python) && !pending;
  const supportedIds = target === 'typescript' ? BLOCK_REGISTRY.map(block => block.id) : python?.blockIds ?? [];
  const supportedNodes = compiled.model?.nodes.filter(node => supportedIds.includes(node.blockType)).length ?? 0;
  const download = async (archive: boolean) => {
    setPending(true); setError('');
    try { await onDownload(target, archive); } catch (error) { setError(error instanceof Error ? error.message : '다운로드를 준비하지 못했습니다.'); }
    finally { setPending(false); }
  };
  return <ModalDialog labelId="code-export-title" className="code-export-dialog" onClose={onClose} initialFocus="[aria-label='코드 타깃']">
    <div className="dialog-heading"><div><h2 id="code-export-title">코드 내보내기</h2><p>현재 모델의 실행 계획을 독립 코드로 보관합니다.</p></div><button className="icon-button" aria-label="코드 내보내기 닫기" onClick={onClose}><Icon name="close"/></button></div>
    <div className="dialog-content export-content"><label className="field"><span className="field-label">실행 환경</span><select aria-label="코드 타깃" value={target} onChange={event => { setTarget(event.target.value as CodeTarget); setError(''); }}><option value="typescript">TypeScript · ES2022</option><option value="python">Python · 3.10 이상</option></select></label>
      <section className="export-summary"><h3>{target === 'python' ? `Python ${python?.minimumVersion ?? '3.10'} 이상` : 'TypeScript · ES2022'}</h3><p>{target === 'python' ? '정적·이산 계산을 Python 표준 라이브러리로 실행합니다. 추가 패키지는 필요하지 않습니다. 연속·혼합 solver와 일부 고급 연산은 지원하지 않습니다.' : '현재 엔진의 정적·이산·연속 실행 계획을 외부 import 없는 TypeScript로 생성합니다. TypeScript 도구와 Node.js 실행 환경을 준비하세요.'}</p><dl className="support-metadata"><div><dt>지원 블록</dt><dd>{supportedIds.length} / {BLOCK_REGISTRY.length}개 등록 블록</dd></div><div><dt>현재 도식</dt><dd>{supportedNodes} / {compiled.model?.nodes.length ?? model.nodes.length}개 계산 블록 · 하위 도식은 펼친 실행 계획으로 확인합니다.</dd></div><div><dt>기준 결과</dt><dd>{hasExpected ? '현재 모델의 완료 결과를 실행 묶음에 포함합니다.' : '현재 모델의 완료 결과가 없습니다. 실행하면 기준 결과도 함께 보관할 수 있습니다.'}</dd></div></dl></section>
      <div className={`export-validation ${diagnostics.length ? 'has-errors' : ''}`} role="status">{target === 'python' && !python ? 'Python 지원 범위를 확인하고 있습니다.' : diagnostics.length ? '이 타깃으로 내보낼 수 없습니다. 아래 항목을 확인하세요.' : '현재 모델을 이 타깃으로 내보낼 수 있습니다.'}</div>
      {!!diagnostics.length && <ul className="export-diagnostics">{diagnostics.map((item, index) => <li key={`${item.code}-${index}`}><strong>{item.code}{item.nodeId ? ` · ${item.nodeId}` : ''}</strong><p>{item.message}</p></li>)}</ul>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button className="button primary" disabled={!ready} onClick={() => void download(false)}>{pending ? '파일 준비 중' : target === 'python' ? 'Python 코드 다운로드' : 'TypeScript 코드 다운로드'}</button><button className="button" disabled={!ready} onClick={() => void download(true)}>{target === 'python' ? 'Python 실행 묶음' : 'TypeScript 실행 묶음'}</button></div>
    </div><div className="dialog-footnote">실행 묶음: 모델·manifest·코드·실행 예제와 유효한 기준 결과<button className="text-button" onClick={onClose}>닫기</button></div>
  </ModalDialog>;
}
