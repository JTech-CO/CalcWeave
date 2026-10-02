import type { Diagnostic } from '../../../../packages/model/src';
import { downloadText } from './M4WorkspaceTools';
import { Icon } from './Icon';
import { ModalDialog } from './ModalDialog';

export interface ModelImportReport { parsed: boolean; converted: boolean; executable: boolean; editable: boolean; format: 'calcweave' | 'unknown'; diagnostics: Diagnostic[] }
export function ModelImportReportDialog({ report, onClose }: { report: ModelImportReport; onClose: () => void }) {
  return <ModalDialog labelId="import-report-title" className="import-report-dialog" onClose={onClose}>
    <div className="dialog-heading"><div><h2 id="import-report-title">모델 가져오기 보고서</h2><p>파일 해석과 실행 가능성을 각각 확인합니다.</p></div><button className="icon-button" aria-label="모델 가져오기 보고서 닫기" onClick={onClose}><Icon name="close"/></button></div>
    <div className="dialog-content"><dl className="support-metadata"><div><dt>JSON 구문 검사</dt><dd>{report.parsed ? 'JSON 구문을 확인했습니다.' : '읽지 못했습니다.'}</dd></div><div><dt>모델 구조 검사</dt><dd>{report.editable ? 'CalcWeave 모델 형식을 확인했습니다.' : '읽지 못했습니다. 원래 모델을 유지합니다.'}</dd></div><div><dt>외부 포맷 변환</dt><dd>{report.converted ? '변환했습니다.' : report.format === 'calcweave' ? '원본 형식 · 변환 없음' : '지원하는 외부 변환기가 없습니다.'}</dd></div><div><dt>실행 가능성</dt><dd>{report.executable ? '현재 엔진에서 실행할 수 있습니다.' : report.editable ? '편집할 수 있습니다. 실행 전 아래 설정·연결을 확인하세요.' : '실행할 수 없습니다.'}</dd></div></dl>{report.diagnostics.length ? <ul className="export-diagnostics">{report.diagnostics.map((item, index) => <li key={`${item.code}-${index}`}><strong>{item.code}{item.nodeId ? ` · ${item.nodeId}` : ''}</strong><p>{item.message}</p></li>)}</ul> : <p>구문 검사와 컴파일 검증을 통과했습니다. 자동으로 계산하지 않습니다.</p>}<div className="dialog-actions"><button className="button" onClick={() => downloadText(JSON.stringify(report, null, 2), 'CalcWeave-import-report.json', 'application/json')}>보고서 다운로드</button></div></div>
    <div className="dialog-footnote">외부 파일의 표현식과 HTML을 실행하지 않습니다.<button className="text-button" onClick={onClose}>닫기</button></div>
  </ModalDialog>;
}
