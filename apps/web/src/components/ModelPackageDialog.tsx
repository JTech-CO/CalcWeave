import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ModelError, type CalcModel, type Diagnostic } from '../../../../packages/model/src';
import type { inspectModelPackage } from '../../../../packages/model-package/src';
import { downloadText } from './M4WorkspaceTools';
import { Icon } from './Icon';
import { ModalDialog } from './ModalDialog';

export function ModelPackageDialog({ model, invalidDraft, busy, onClose, onImport }: { model: CalcModel; invalidDraft: boolean; busy: boolean; onClose: () => void; onImport: (model: CalcModel, diagnostics: Diagnostic[]) => void }) {
  const [page, setPage] = useState<'export' | 'import'>('export');
  const [created, setCreated] = useState<{ text: string; fingerprint: string } | null>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof inspectModelPackage>> | null>(null);
  const [trusted, setTrusted] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [migrationReviewed, setMigrationReviewed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inspectionRequest = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const create = async () => {
    setPending(true); setError('');
    try { const api = await import('../../../../packages/model-package/src'); const packageFile = await api.createModelPackage(model); if (alive.current) setCreated(packageFile); }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : '공유 파일을 만들지 못했습니다.'); }
    finally { if (alive.current) setPending(false); }
  };
  const inspect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const requestId = ++inspectionRequest.current;
    setPreview(null); setTrusted(''); setText(''); setError(''); setPending(true); setMigrationReviewed(false);
    try {
      if (file.size > 6 * 1024 * 1024) throw new Error('공유 패키지는 6 MiB 이하여야 합니다.');
      const payload = await file.text(), api = await import('../../../../packages/model-package/src');
      const checked = await api.inspectModelPackage(payload); if (!alive.current || requestId !== inspectionRequest.current) return; setText(payload); setPreview(checked);
    } catch (error) { if (alive.current && requestId === inspectionRequest.current) setError(error instanceof ModelError ? error.diagnostics.map(item => item.message).join(' · ') : error instanceof Error ? error.message : '패키지를 확인하지 못했습니다.'); }
    finally { if (alive.current && requestId === inspectionRequest.current) setPending(false); }
  };
  const accept = async () => {
    if (busy) return;
    setPending(true); setError('');
    try { const api = await import('../../../../packages/model-package/src'); const accepted = await api.acceptModelPackage(text, trusted.trim().toLocaleLowerCase(), { reviewedMigration: migrationReviewed }); if (!alive.current) return; onImport(accepted, preview?.diagnostics ?? []); onClose(); }
    catch (error) { setError(error instanceof Error ? error.message : '패키지를 가져오지 못했습니다.'); }
    finally { setPending(false); }
  };
  const trustedMatches = !!preview && trusted.trim().toLocaleLowerCase() === preview.fingerprint.toLocaleLowerCase();
  return <ModalDialog labelId="model-package-title" className="model-package-dialog" onClose={onClose} initialFocus=".dialog-navigation button">
    <div className="dialog-heading"><div><h2 id="model-package-title">모델 패키지 공유</h2><p>현재 브라우저에서 파일을 생성하고 직접 전달합니다.</p></div><button className="icon-button" aria-label="모델 패키지 공유 닫기" onClick={onClose}><Icon name="close"/></button></div>
    <nav className="dialog-navigation" aria-label="공유 방식"><button aria-pressed={page === 'export'} onClick={() => setPage('export')}>공유 파일 만들기</button><button aria-pressed={page === 'import'} onClick={() => setPage('import')}>공유 파일 확인</button></nav>
    <div className="dialog-content package-content">
      {page === 'export' ? <><h3>{model.name}</h3><p>{model.nodes.length}개 블록 · {model.edges.length}개 연결. 내장 데이터·하위 도식·대시보드·노트를 함께 보관합니다. 실행 기록과 브라우저 설정은 공유 파일에 포함하지 않습니다.</p><p>이번 파일의 서명을 위해 임시 키를 생성합니다. 개인 키는 저장하지 않으며 공개 키의 SHA-256 지문만 표시합니다.</p><div className="dialog-actions"><button className="button primary" disabled={invalidDraft || pending} onClick={() => void create()}>{pending ? '패키지 준비 중' : '서명된 패키지 생성'}</button>{created && <button className="button" onClick={() => downloadText(created.text, 'CalcWeave-model.cwpackage.json', 'application/json')}>공유 패키지 다운로드</button>}</div>{invalidDraft && <p className="dialog-error">편집 중인 입력값을 확인한 뒤 공유 파일을 만드세요.</p>}{created && <section className="package-preview"><h3>이 파일의 공개 키 지문</h3><p className="fingerprint-value" data-testid="created-package-fingerprint">{created.fingerprint}</p><p>받는 사람에게 위 지문을 별도로 신뢰할 수 있는 경로로 전달하세요. 서명은 파일 변조를 확인하며 작성자의 실명이나 계정을 인증하지 않습니다. 새로 생성하면 지문도 바뀝니다.</p></section>}</> : <><p>파일의 서명·모델 해시·버전·지원 블록·권한을 먼저 검사합니다. 확인 과정에서 현재 모델을 변경하지 않습니다.</p><div className="dialog-actions"><button className="button" disabled={pending} onClick={() => input.current?.click()}>공유 패키지 선택</button><input ref={input} disabled={pending} className="visually-hidden" type="file" accept=".json,.cwpackage.json,application/json" aria-label="공유 모델 패키지 파일 선택" onChange={event => void inspect(event)}/></div>{pending && <p role="status">패키지를 확인하고 있습니다.</p>}{preview && <section className="package-preview"><h3>검증된 파일 · {preview.model.name}</h3><dl className="support-metadata"><div><dt>형식 버전</dt><dd>{preview.packageVersion}</dd></div><div><dt>모델 SHA-256</dt><dd className="fingerprint-value">{preview.modelHash}</dd></div><div><dt>공개 키 지문</dt><dd className="fingerprint-value" data-testid="inspected-package-fingerprint">{preview.fingerprint}</dd></div><div><dt>실행 가능성</dt><dd>{preview.executable ? '현재 엔진에서 실행할 수 있습니다.' : '실행 계약을 통과하지 못했습니다. 설정·연결을 수정한 원본 패키지를 다시 받아야 합니다.'}</dd></div></dl>{preview.migration && <section className="migration-report" aria-label="이전 엔진 변환 보고서"><h3>이전 엔진 변환</h3><p>{preview.migration.fromEngineVersion} → {preview.migration.toEngineVersion}</p><p>원본 서명과 승인된 registry를 확인했습니다. 같은 schema1 모델을 현재 엔진에서 다시 검증하며, 옵션을 다른 값으로 바꾸지 않습니다. 이전 엔진과의 수치 동등성은 이 확인만으로 보증하지 않습니다.</p><dl className="support-metadata"><div><dt>원본 무결성</dt><dd>SHA-256·서명 확인 · 서명은 원본에만 적용</dd></div><div><dt>정규화 변경</dt><dd>{preview.migration.normalizedModelChanged ? '스키마 기본값 정규화가 있습니다.' : '선언 모델 변경 없음'}</dd></div><div><dt>현재 실행 해시</dt><dd className="fingerprint-value">{preview.migration.currentSemanticHash || '컴파일 미통과'}</dd></div></dl><div className="dialog-actions"><button className="button" onClick={() => downloadText(text, 'CalcWeave-original.cwpackage.json', 'application/json')}>원본 서명 패키지 보관</button><button className="button" onClick={() => downloadText(JSON.stringify({ migration: preview.migration, diagnostics: preview.diagnostics }, null, 2), 'CalcWeave-migration-report.json', 'application/json')}>변환 보고서 다운로드</button></div><label className="checkbox-field"><input type="checkbox" checked={migrationReviewed} onChange={event => setMigrationReviewed(event.target.checked)} aria-label="이전 엔진 변환 보고서 확인"/>변환 범위와 원본 보존 안내를 확인했습니다.</label></section>}<p>파일에 들어 있는 공개 키만으로 작성자를 신뢰할 수 없습니다. 별도로 전달받아 확인한 지문을 입력하세요.</p><label className="field"><span className="field-label">별도로 확인한 공개 키 지문</span><input aria-label="신뢰할 수 있는 공개 키 지문" spellCheck={false} autoComplete="off" maxLength={64} value={trusted} onChange={event => setTrusted(event.target.value)} placeholder="SHA-256 · 64자리 16진수"/></label>{!!trusted && !trustedMatches && <p className="dialog-error">파일의 공개 키 지문과 일치하지 않습니다.</p>}{preview.diagnostics.length > 0 && <ul className="export-diagnostics">{preview.diagnostics.map((item, index) => <li key={`${item.code}-${index}`}><strong>{item.code}</strong><p>{item.message}</p></li>)}</ul>}<button className="button primary" disabled={!trustedMatches || !preview.executable || !!preview.migration && !migrationReviewed || pending || busy} onClick={() => void accept()}>지문 확인 후 모델 가져오기</button><p>가져온 뒤 실행 취소로 이전 모델을 복원할 수 있습니다. 자동으로 계산하지 않습니다.</p></section>}</>}
      {error && <p className="dialog-error" role="alert">{error}</p>}
    </div><div className="dialog-footnote">파일 공유는 모델에 담긴 데이터도 전달합니다. 공유할 내용을 확인하세요.<button className="text-button" onClick={onClose}>닫기</button></div>
  </ModalDialog>;
}
