import type { OfflineStatus } from '../offline';

export function OfflineBanner({ status, busy, updating, onCheck, onApply }: { status: OfflineStatus | null; busy: boolean; updating: boolean; onCheck: () => void; onApply: () => void }) {
  if (!status || status.phase === 'disabled') return null;
  const label = status.offlineReady ? status.online ? '오프라인 사용 준비됨' : '오프라인 · 저장된 앱으로 작업 중' : status.phase === 'error' ? '오프라인 준비 확인 필요' : '오프라인 사용 준비 중';
  const available = status.phase === 'update-ready' || status.phase === 'reload-ready';
  const version = status.phase === 'update-ready' ? status.waitingAppVersion : status.activeAppVersion;
  const updateLabel = status.phase === 'reload-ready' ? ` · 현재 ${status.appVersion} · ${version ?? '새 릴리스'} 적용을 위해 새로고침이 필요합니다.` : ` · 현재 ${status.appVersion} · 새 릴리스 ${version ?? ''}가 준비되었습니다.`;
  return <div className={`offline-banner ${status.phase === 'error' ? 'has-error' : ''} ${available ? 'has-update' : ''}`} aria-label="오프라인 상태"><span aria-live="polite"><i className={`status-dot ${status.offlineReady ? '' : 'working'}`}/>{label}{available && updateLabel}</span>{status.message && <span className="offline-message">{status.message}</span>}<div><button className="text-button" disabled={!status.online || updating} onClick={onCheck}>업데이트 확인</button>{available && <button className="button" disabled={busy || updating} onClick={onApply}>{updating ? '저장 후 적용 중…' : status.phase === 'reload-ready' ? '저장 후 새로고침' : '저장 후 업데이트 적용'}</button>}</div></div>;
}
