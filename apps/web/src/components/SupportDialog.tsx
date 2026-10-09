import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type ParameterDefinition } from '../../../../packages/block-library/src';
import { type ExecutionMode } from '../../../../packages/model/src';
import { getReleaseCatalog } from '../../../../packages/release/src';
import type { CanonicalSupport, SourceSupportRow, SupportClassification, SupportDecision, SupportTarget, SupportTargetStatus } from '../../../../packages/support-matrix/src';
import { getCurrentObserverExtension } from '../../../../packages/support-matrix/src/current-extensions';
import { Icon } from './Icon';
import { ModalDialog } from './ModalDialog';
import { appResourcePath } from '../app-path';
import { AdapterCatalogPanel } from './AdapterCatalogPanel';
import { downloadText } from './M4WorkspaceTools';
import './HelpDialog.css';

const MODES: Record<ExecutionMode, string> = { static: '정적 계산', discrete: '이산 시뮬레이션', continuous: '연속·혼합 시뮬레이션' };
const RELEASE = getReleaseCatalog();
const BLOCK_REGISTRY = RELEASE.blocks;
function parameterConstraint(parameter: Pick<ParameterDefinition, 'options' | 'min' | 'max' | 'minLength' | 'maxLength'>) {
  return [parameter.options?.join(' · '), parameter.min !== undefined || parameter.max !== undefined ? `${parameter.min ?? '−∞'} ~ ${parameter.max ?? '∞'}` : '', parameter.minLength !== undefined || parameter.maxLength !== undefined ? `길이 ${parameter.minLength ?? 0} ~ ${parameter.maxLength ?? '제한 없음'}` : ''].filter(Boolean).join(' / ') || '신호 형식·유한값을 확인합니다.';
}

type HelpPage = 'guide' | 'blocks' | 'files' | 'about';
type HelpDetail = 'matrix' | 'adapters' | null;
const MODEL_LIMIT_LABELS: Record<keyof typeof RELEASE.limits, string> = {
  maxBytes: '모델 파일 크기', maxDepth: '파일 구조의 중첩 깊이', maxValues: '파일 안의 값 수',
  maxNodes: '블록 수', maxEdges: '연결 수', maxSteps: '이산 실행 단계',
  maxRecordedValues: '결과 기록의 수치 원소', maxStateElements: '저장 상태의 수치 원소',
  maxTime: '실행 시간의 최댓값 (초)', minStep: '이산 시간 간격의 최솟값 (초)',
};
const DATASET_LIMIT_LABELS: Record<keyof typeof RELEASE.datasetLimits, string> = {
  maxBytes: '데이터 파일 크기', maxRows: '데이터 행', maxColumns: '데이터 열',
  maxCells: '데이터 셀', maxDatasets: '모델 안의 데이터표', maxStringLength: '셀 안의 문자열 길이',
};
const SOLVER_LIMIT_LABELS: Record<keyof typeof RELEASE.solverLimits, string> = {
  minStep: '내부 시간 간격의 최솟값 (초)', maxStep: '내부 시간 간격의 최댓값 (초)',
  minTolerance: '허용오차의 최솟값', maxTolerance: '허용오차의 최댓값',
  maxSteps: '연속 계산 단계', maxRejects: '허용오차 초과 재시도', maxEvaluations: '함수 평가',
  maxEvents: '이벤트 처리', minEventTolerance: '이벤트 허용오차의 최솟값', maxEventTolerance: '이벤트 허용오차의 최댓값',
};
function displayDefault(value: unknown): string {
  if (typeof value === 'string') return value || '빈 문자열';
  if (typeof value === 'boolean') return value ? '참 (true)' : '거짓 (false)';
  if (value === null) return '지정 없음';
  if (Array.isArray(value)) return '[' + value.map(item => Array.isArray(item) ? '[' + item.map(String).join(', ') + ']' : String(item)).join(', ') + ']';
  if (typeof value === 'object') return '구조화된 값 · 아래 기술 정보에서 확인';
  return String(value);
}
function readableParameterConstraint(parameter: ParameterDefinition): string {
  const min = parameter.min === -Number.MAX_VALUE ? undefined : parameter.min;
  const max = parameter.max === Number.MAX_VALUE ? undefined : parameter.max;
  const range = min !== undefined && max !== undefined ? String(min) + ' ~ ' + String(max) : min !== undefined ? String(min) + ' 이상' : max !== undefined ? String(max) + ' 이하' : '';
  const length = parameter.minLength !== undefined || parameter.maxLength !== undefined ? '길이 ' + String(parameter.minLength ?? 0) + ' ~ ' + String(parameter.maxLength ?? '제한 없음') : '';
  return [parameter.options?.join(' · '), range, length].filter(Boolean).join(' / ') || (parameter.kind === 'number' || parameter.kind === 'integer' ? '유한한 ' + (parameter.kind === 'integer' ? '정수' : '숫자') + '를 입력합니다.' : '블록 속성에서 신호 형식과 값을 지정합니다.');
}
function LimitList({ values, labels }: { values: Readonly<Record<string, number>>; labels: Readonly<Record<string, string>> }) {
  return <dl className="support-metadata help-limit-list">{Object.entries(values).map(([key, value]) => <div key={key}><dt>{labels[key]}</dt><dd>{key === 'maxBytes' ? String(value / (1024 * 1024)) + ' MiB' : String(value)}</dd></div>)}</dl>;
}

export function SupportDialog({ onClose, onManage }: { onClose: () => void; onManage: () => void }) {
  const [page, setPage] = useState<HelpPage>('guide');
  const [detail, setDetail] = useState<HelpDetail>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ExecutionMode | ''>('');
  const [selectedId, setSelectedId] = useState('source.constant');
  const aboutButton = useRef<HTMLButtonElement>(null);
  const blocksButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    // A native dialog retains scroll when a tab swaps its content. Reset after
    // the new content is laid out so every help page starts at its heading.
    aboutButton.current?.closest('dialog')?.scrollTo(0, 0);
  }, [page, detail]);
  const blocks = useMemo(() => BLOCK_REGISTRY.filter(block => (!mode || block.supportedModes.includes(mode)) && (block.id + ' ' + block.label + ' ' + block.englishName + ' ' + block.aliases?.join(' ') + ' ' + block.description + ' ' + block.category + ' ' + Object.entries(block.parameters).map(([key, parameter]) => key + ' ' + parameter.label + ' ' + parameter.kind + ' ' + parameter.options?.join(' ')).join(' ') + ' ' + block.valueType + ' ' + block.shape + ' ' + block.unit).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [query, mode]);
  const selected = BLOCK_REGISTRY.find(block => block.id === selectedId)!;
  const selectedExtension = getCurrentObserverExtension(selected.id);
  function openPage(next: HelpPage) { aboutButton.current?.closest('dialog')?.scrollTo(0, 0); setPage(next); setDetail(null); }
  function openDetail(next: Exclude<HelpDetail, null>) { aboutButton.current?.focus({ preventScroll: true }); setDetail(next); }
  function backToAbout() { setDetail(null); aboutButton.current?.focus({ preventScroll: true }); }
  function findBlocks() { openPage('blocks'); blocksButton.current?.focus({ preventScroll: true }); }
  return <ModalDialog labelId="support-title" className="support-dialog help-dialog" onClose={onClose} initialFocus="[data-help-start]">
    <div className="dialog-heading help-heading"><div><h2 id="support-title">CalcWeave 도움말</h2><p>설치 없이 웹 브라우저에서 블록을 연결해 계산하고 시뮬레이션하세요.</p></div><button className="icon-button" aria-label="도움말 닫기" onClick={onClose}><Icon name="close"/></button></div>
    <nav className="dialog-navigation help-navigation" aria-label="도움말 항목">
      <button data-help-start aria-pressed={page === 'guide'} onClick={() => openPage('guide')}>사용 안내</button>
      <button ref={blocksButton} aria-pressed={page === 'blocks'} onClick={() => openPage('blocks')}>블록 찾기</button>
      <button aria-pressed={page === 'files'} onClick={() => openPage('files')}>파일·코드</button>
      <button ref={aboutButton} data-help-about aria-pressed={page === 'about'} onClick={() => openPage('about')}>앱 정보</button>
    </nav>
    <div className="dialog-content help-content">
      {page === 'guide' && <section className="help-guide" aria-labelledby="help-guide-title">
        <div className="help-guide-layout">
          <div><h3 id="help-guide-title">첫 계산을 만들어 보세요</h3><p>상수에 배율을 곱하고 결과를 표시하는 작은 도식부터 시작할 수 있습니다.</p>
            <ol className="help-steps"><li><strong>블록을 놓습니다</strong><span>라이브러리의 블록을 클릭해 추가하거나 캔버스의 원하는 위치로 끌어 놓으세요. 빠른 추가에서도 상수, 배율, 결과(Display) 블록을 추가할 수 있습니다. 준비된 도식은 상단의 예제로 시작에서 고를 수 있습니다.</span></li><li><strong>선을 연결하고 값을 정합니다</strong><span>상수 → 배율 → 결과 순서로 출력과 입력 포트를 연결하세요. 블록 속성에서 상수를 2, 배율을 3으로 바꿔 보세요.</span></li><li><strong>실행하고 결과를 확인합니다</strong><span>상단의 실행 버튼을 누르면 계산 결과에 6이 나타납니다. 시간에 따른 변화는 이산 또는 연속 실행 방식과 시간 그래프(Scope)로 확인하세요.</span></li></ol>
            <button className="button" onClick={findBlocks}>필요한 블록 찾기<Icon name="arrow" size={16}/></button>
          </div>
          <section className="help-next-steps" aria-labelledby="help-next-title"><h3 id="help-next-title">작업을 이어가는 방법</h3><dl>
            <div><dt>시간에 따른 변화</dt><dd>모델 설정에서 실행 방식과 시작·종료 시간을 정하세요. Display·Scope의 입력을 1~16개로 늘려 신호를 함께 기록하고, Scope에서 그래프를 중첩하거나 따로 볼 수 있습니다. Scope의 시간 범위를 적용하면 해당 범위까지 다시 계산합니다.</dd></div>
            <div><dt>측정 데이터로 계산</dt><dd>CSV·JSON·값만 저장된 XLSX를 미리 본 뒤 데이터 재생 블록에 연결하세요. 원본 데이터와 열·자료형을 확인하고 모델에 적용합니다.</dd></div>
            <div><dt>신호와 제어계 분석</dt><dd>상단의 분석에서 완료한 시간 기록의 FFT, 구간 통계·교차 상관, Welch 평균 PSD와 STFT를 확인하세요. 지원되는 연속·이산 상태공간 모델의 주파수 응답과 극점·영점도 분석할 수 있습니다.</dd></div>
            <div><dt>계수 비교와 수학 학습</dt><dd>실험 탭에서 다변수 조합, CSV 측정값 피팅, 불확실성 앙상블을 실행하세요. 수식·학습 탭에서는 지원되는 블록의 수식과 예제 가이드를 확인할 수 있습니다.</dd></div>
            <div><dt>도식 정리와 설명</dt><dd>선택한 블록을 하위 도식으로 묶고, 대시보드에서 입력을 조절하거나 노트에 설명을 남길 수 있습니다.</dd></div>
          </dl></section>
        </div>
        <details className="help-disclosure"><summary>마우스·키보드 조작</summary><dl className="support-metadata help-shortcuts">
          <div><dt>도식 이동</dt><dd>마우스 휠 버튼을 누른 채 드래그</dd></div><div><dt>영역 선택</dt><dd>캔버스 빈 곳에서 마우스 왼쪽 버튼으로 드래그</dd></div><div><dt>도식 맞추기</dt><dd>캔버스에서 <kbd>Space</kbd></dd></div>
          <div><dt>자동 정렬</dt><dd>캔버스에서 <kbd>Space</kbd>를 누른 상태로 <kbd>Z</kbd> · <kbd>Ctrl + Z</kbd>로 정렬 취소</dd></div>
          <div><dt>키보드로 블록 편집</dt><dd><kbd>Tab</kbd>으로 블록 이동 · <kbd>Enter</kbd>로 속성 편집 · 입력값과 연결 메뉴는 <kbd>Tab</kbd>으로 이동</dd></div>
          <div><dt>빠른 추가</dt><dd><kbd>Ctrl + K</kbd> · <kbd>↑ / ↓</kbd> 선택 · <kbd>Enter</kbd> 추가 · <kbd>Escape</kbd> 닫기</dd></div>
          <div><dt>선택과 복사</dt><dd><kbd>Ctrl + A</kbd> 전체 선택 · <kbd>Ctrl + C / V</kbd> 복사·붙여넣기 · <kbd>Ctrl + D</kbd> 복제 · <kbd>Delete</kbd> 삭제</dd></div>
          <div><dt>실행과 실행 취소</dt><dd><kbd>Ctrl + Enter</kbd> 실행 · <kbd>Ctrl + Z</kbd> 실행 취소 · <kbd>Ctrl + Shift + Z</kbd> 다시 실행</dd></div>
        </dl></details>
      </section>}
      {page === 'blocks' && <section aria-label="블록 찾기">
        <div className="support-filters"><label className="field"><span className="field-label">블록·파라미터 검색</span><input aria-label="지원 블록 검색" maxLength={120} value={query} onChange={event => setQuery(event.target.value.slice(0, 120))} placeholder="상수, 적분, 행렬…"/></label><label className="field"><span className="field-label">실행 방식</span><select aria-label="지원 실행 방식" value={mode} onChange={event => setMode(Object.hasOwn(MODES, event.target.value) ? event.target.value as ExecutionMode : '')}><option value="">전체 방식</option>{Object.entries(MODES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        <p className="support-result-count" role="status">{blocks.length} / {BLOCK_REGISTRY.length}개 블록</p>
        <div className="support-layout"><div className="support-block-list" aria-label="지원 블록 목록">{blocks.map(block => <button key={block.id} aria-pressed={selectedId === block.id} onClick={() => setSelectedId(block.id)}><strong>{block.label}<span className="help-block-english">{block.englishName}</span></strong><span>{block.category} · {block.supportedModes.map(item => MODES[item]).join(' / ')}</span></button>)}{!blocks.length && <p className="muted-copy">일치하는 블록이 없습니다.</p>}</div>
          <section className="support-block-detail" aria-label="선택한 블록의 지원 정보"><h3>{selected.label}<span className="help-detail-english">{selected.englishName}</span></h3><p>{selected.description}</p>
            <dl className="support-metadata"><div><dt>실행 방식</dt><dd>{selected.supportedModes.map(item => MODES[item]).join(' · ')}</dd></div><div><dt>입력 / 출력</dt><dd>{selectedExtension ? `${selectedExtension.minimumInputs} ~ ${selectedExtension.maximumInputs}` : selected.inputs.length}개 / {selected.outputs.length}개<small>포트 수는 블록 설정과 하위 도식에 따라 바뀔 수 있습니다.</small></dd></div><div><dt>코드 내보내기</dt><dd>{selected.exportTargets.map(target => target === 'typescript' ? 'TypeScript' : target === 'python' ? 'Python' : 'WASM').join(' · ')}<small>내보낼 때 모델의 실행 방식·연결·자료형과 설정을 확인합니다. 하위 도식은 내부 계산 블록이 모두 지원되어야 합니다.</small></dd></div></dl>
            {selectedExtension && <p className="field-help" data-testid="observer-extension-support">브라우저 계산·TypeScript는 입력을 {selectedExtension.maximumInputs}개까지 기록하고, Python·WASM 내보내기는 입력 1개만 지원합니다. 입력 개수는 블록 속성에서 조절할 수 있습니다. 입력이 모두 연결되어 있으면 추가 신호를 연결할 때 최대 {selectedExtension.maximumInputs}개까지 새 입력을 만듭니다.</p>}
            <h4>설정과 기본값</h4>{Object.keys(selected.parameters).length ? <><div className="support-parameter-list help-parameter-list">{Object.entries(selected.parameters).map(([key, parameter]) => <div key={key}><strong>{parameter.label}</strong><p>기본값 <span className="help-default-value">{displayDefault(parameter.default)}</span></p><p>{readableParameterConstraint(parameter)}</p></div>)}</div><details className="help-disclosure"><summary>파라미터 기술 정보</summary><div className="support-parameter-list">{Object.entries(selected.parameters).map(([key, parameter]) => <div key={key}><strong>{parameter.label} <code>{key}</code></strong><p>{parameter.kind} · 기본값 <code>{JSON.stringify(parameter.default)}</code></p><p>{parameterConstraint(parameter)}</p></div>)}</div></details></> : <p>설정할 파라미터가 없습니다.</p>}
            <details className="help-disclosure"><summary>기술 정보</summary><dl className="support-metadata">
              <div><dt>ID · 버전</dt><dd>{selected.id} · v{selected.version}</dd></div><div><dt>포트 이름</dt><dd>{selected.inputs.join(', ') || '없음'} / {selected.outputs.join(', ') || '없음'}</dd></div><div><dt>타입 · 모양</dt><dd>{selected.valueType} · {selected.shape}</dd></div><div><dt>단위</dt><dd>{selected.unit === 'dimensionless' ? '단위 없음' : '입력·파라미터에서 추론'}</dd></div><div><dt>시간 · 상태</dt><dd>{selected.sampleTime} · {selected.state}</dd></div>
            </dl></details><p className="field-help">연결과 신호 형식, 단위, 설정은 실행 전에 검증합니다. 실제 입력에 따라 정해지는 형식은 모델의 블록 속성에서 확인하세요.</p>
          </section>
        </div>
      </section>}
      {page === 'files' && <section className="help-files" aria-labelledby="help-files-title"><h3 id="help-files-title">도식과 결과를 파일로 이어가세요</h3>
        <dl className="help-file-rows">
          <div><dt>모델 저장과 전달</dt><dd>상단의 모델 다운로드로 도식·데이터·하위 도식·대시보드·노트를 함께 저장합니다. 가져오기로 다른 브라우저에서도 열 수 있습니다.</dd></div>
          <div><dt>작업 공간 백업</dt><dd>작업 공간의 백업·복구에서 모델을 보관하고 실행 기록의 포함 여부를 선택하세요. 브라우저 저장 공간을 지울 때와 기기를 옮길 때 사용할 수 있습니다.</dd></div>
          <div><dt>계산 결과 활용</dt><dd>실행 결과와 Scope에서 값을 확인하세요. 실험 탭의 실행 기록에서 결과 CSV를 내려받아 다른 도구에서 사용할 수 있습니다.</dd></div>
        </dl>
        <h3>실행 가능한 코드로 내보내기</h3><p>코드 다운로드 오른쪽의 타깃 선택 버튼에서 실행 환경을 선택하세요. 내보내기 전에 현재 모델의 지원 여부를 확인하며, 실행 방식과 블록 설정에 따라 선택 가능한 타깃이 달라집니다.</p>
        <dl className="help-file-rows">
          <div><dt>TypeScript</dt><dd>지원되는 모델을 독립 실행 코드로 내보냅니다.</dd></div>
          <div><dt>Python</dt><dd>지원 블록의 정적·이산 실행 설정을 내보냅니다. 준비한 Python 환경에서 실행하며 연속 시뮬레이션은 지원하지 않습니다.</dd></div>
          <div><dt>WASM</dt><dd>유한한 실수 단일값을 쓰는 순환 없는 계산 도식의 일부 블록을 지원합니다. 저장 상태나 연속 시뮬레이션은 지원하지 않습니다.</dd></div>
        </dl>
        <details className="help-disclosure"><summary>파일 호환성과 고급 공유</summary><p>MAT 데이터표와 SLX·MDL 도식은 일부 형식을 해석해 가져옵니다. 변환되지 않는 항목과 손실을 검토하고, 원본 파일은 따로 보관하세요. MATLAB 코드나 콜백, 외부 참조는 실행하지 않습니다.</p><p>서명된 모델 패키지는 작업 공간 → 고급 파일에서 사용합니다. 공개 키 지문은 파일 출처 확인용이며 계산 정확성을 증명하지 않습니다. 일반 모델 파일은 지문 입력 없이 주고받을 수 있습니다.</p><p>C/C++ 코드 내보내기는 현재 지원하지 않습니다.</p></details>
      </section>}
      {page === 'about' && detail !== null && <><div className="help-detail-heading"><button className="button subtle" onClick={backToAbout}>앱 정보로 돌아가기</button><h3>{detail === 'matrix' ? 'Simulink 참고 자료 비교' : '확장 기능 상세'}</h3></div>{detail === 'matrix' ? <SourceSupportPanel/> : <AdapterCatalogPanel/>}</>}
      {page === 'about' && detail === null && <section className="help-about" aria-labelledby="help-about-title">
        <div className="help-about-version"><h3 id="help-about-title">CalcWeave</h3><span>버전 {RELEASE.version}</span></div>
        <p>CalcWeave는 블록 {BLOCK_REGISTRY.length}개를 연결해 수학 모델을 만들고 계산·시뮬레이션·신호 및 제어계 분석을 수행하는 독립적인 웹 계산 도구이며 MATLAB 설치가 필요하지 않습니다.</p>
        <section className="help-about-section" aria-labelledby="help-storage-title"><h3 id="help-storage-title">이 브라우저에 작업을 저장합니다</h3><p>모델과 데이터, 실행 기록은 현재 브라우저에 저장됩니다. 브라우저 저장 공간을 지우면 작업이 사라질 수 있으니 백업 파일을 내려받아 보관하세요.</p><button className="button" onClick={onManage}>백업·복구 열기</button></section>
        <section className="help-about-section" aria-labelledby="help-update-title"><h3 id="help-update-title">최신 버전으로 작업을 이어가세요</h3><p>상단의 업데이트 확인을 누르세요. 새 버전이 준비되면 저장 후 업데이트 적용으로 현재 작업을 저장하고 새 앱을 엽니다. 다른 탭에서 이미 새 버전이 적용된 경우에는 저장 후 새로고침으로 안내합니다.</p></section>
        <section className="help-about-section" aria-labelledby="help-limits-title"><h3 id="help-limits-title">작업 크기</h3><dl className="support-metadata help-limits-summary"><div><dt>모델</dt><dd>블록 {RELEASE.limits.maxNodes.toLocaleString('ko-KR')}개 · 연결 {RELEASE.limits.maxEdges.toLocaleString('ko-KR')}개 · 파일 {RELEASE.limits.maxBytes / (1024 * 1024)} MiB</dd></div><div><dt>데이터 파일</dt><dd>{RELEASE.datasetLimits.maxBytes / (1024 * 1024)} MiB · {RELEASE.datasetLimits.maxRows.toLocaleString('ko-KR')}행 · {RELEASE.datasetLimits.maxColumns}열 · 전체 {RELEASE.datasetLimits.maxCells.toLocaleString('ko-KR')}셀</dd></div><div><dt>실행 기록</dt><dd>최대 5개 · 전체 20 MiB · 기록당 수치 원소 200,000개</dd></div></dl><details className="help-disclosure"><summary>계산·데이터 세부 범위</summary><p>기본 실수·참/거짓 신호는 단일값·벡터·2차원 배열을 지원합니다. Typed 신호는 명시한 자료형과 최대 8차원 배열을 지원하며 기본 실수 블록과 연결할 때 명시적으로 변환합니다. 실수 밀집 행렬은 각 축 32개, lookup 표는 각 축 2~32개, 하위 도식 깊이는 최대 8단계입니다.</p><p>연속·혼합 실행은 RK4·RK45와 선택된 implicit Euler 설정을 지원합니다. 연속 상태는 단위 없는 실수 단일값 범위입니다. 단위는 검증하며 단위 변환 블록 이외의 자동 변환은 수행하지 않습니다. 내부 계산 간격과 결과 기록 간격은 별도로 정합니다.</p><p>단일 계수 스윕은 최대 16회, 다변수 실험은 최대 3개 계수·64개 조합, 불확실성 앙상블은 최대 3개 계수·2~64개 표본을 지원합니다. 각 실험은 전체 30초 상한 안에서 실행합니다. 피팅의 실행 한도는 실험 탭에서 별도로 정합니다.</p><h4>모델과 결과</h4><LimitList values={RELEASE.limits} labels={MODEL_LIMIT_LABELS}/><h4>데이터표</h4><LimitList values={RELEASE.datasetLimits} labels={DATASET_LIMIT_LABELS}/><h4>연속 계산</h4><LimitList values={RELEASE.solverLimits} labels={SOLVER_LIMIT_LABELS}/><h4>계산·내보내기 조건</h4><ul className="unsupported-list">{RELEASE.unsupported.map(item => <li key={item}>{item}</li>)}</ul></details></section>
        <details className="help-disclosure"><summary>버전 기술 정보</summary><dl className="support-metadata"><div><dt>계산 엔진</dt><dd>{RELEASE.engineVersion}</dd></div><div><dt>모델 파일 형식 버전</dt><dd>{RELEASE.schemaVersion}</dd></div></dl></details>
        <details className="help-disclosure"><summary>지원 환경</summary><p>{RELEASE.browserSupport}</p><p>오프라인 사용은 최초 온라인 설치가 완료된 이후에 가능합니다. 계정이나 클라우드 동기화는 제공하지 않습니다. 여러 탭의 저장 충돌은 자동 병합하지 않으므로 현재 탭을 백업하고 최신 저장 모델을 불러오세요.</p></details>
        <details className="help-disclosure"><summary>호환성 참고</summary><p>Simulink 관련 자료는 기능·파일 형식 비교를 위한 참고입니다. CalcWeave의 기본 사용 조건이 아니며, 원본의 모든 기능이나 옵션과 같다는 의미도 아닙니다.</p><div className="help-reference-actions"><button className="button" onClick={() => openDetail('matrix')}>Simulink 참고 자료 비교</button><button className="button" onClick={() => openDetail('adapters')}>확장 기능 상세</button></div></details>
        <section className="help-about-section help-contact" aria-labelledby="help-contact-title"><h3 id="help-contact-title">문의와 이용 안내</h3><p>{RELEASE.operator} · <a href={'mailto:' + RELEASE.contact}>{RELEASE.contact}</a></p><div className="policy-links"><a href={RELEASE.deploymentUrl} target="_blank" rel="noopener noreferrer">현재 웹 주소</a><a href={appResourcePath(RELEASE.policyLinks.privacy)} target="_blank" rel="noopener noreferrer">개인정보 처리방침</a><a href={appResourcePath(RELEASE.policyLinks.terms)} target="_blank" rel="noopener noreferrer">이용약관</a><a href={appResourcePath(RELEASE.policyLinks.cookies)} target="_blank" rel="noopener noreferrer">쿠키·로컬 저장 안내</a><a href={appResourcePath(RELEASE.policyLinks.notices)} target="_blank" rel="noopener noreferrer">오픈소스 고지</a></div></section>
      </section>}
    </div>
    <div className="dialog-footnote">Escape 닫기 · Tab으로 창 안의 항목 이동<button className="text-button" onClick={onClose}>닫기</button></div>
  </ModalDialog>;
}

type SupportMatrixApi = typeof import('../../../../packages/support-matrix/src');
let matrixModule: Promise<SupportMatrixApi> | undefined;
function loadSupportMatrix(): Promise<SupportMatrixApi> {
  return matrixModule ??= import('../../../../packages/support-matrix/src').catch(error => { matrixModule = undefined; throw error; });
}
const CLASSIFICATIONS: Record<SupportClassification, string> = {
  'native-capability': '계산 기능', 'shared-configuration': '공유 구성', preset: 'preset',
  'independent-alternative': '독립 대체', 'conditional-adapter': '조건부 adapter', legacy: '이전·외부 환경',
};
const DECISIONS: Record<SupportDecision, string> = { 'selected-subset': '선택 범위 지원', unsupported: '미지원', 'legacy-unavailable': '원본 환경 미지원' };
const TARGETS: Record<SupportTarget, string> = { typescript: 'TypeScript', python: 'Python', wasm: 'WASM', 'c-cpp': 'C/C++' };
const TARGET_STATUS: Record<SupportTargetStatus, string> = { 'selected-config-eligible': '선택 구성 승인', 'ui-only': '화면 전용', unsupported: '미지원', 'environment-unavailable': '실행 환경 미지원' };

/** Links point to reviewed repository artifacts; no imported URL becomes executable content. */
function supportArtifactLink(path: string, line?: number): string | undefined {
  if (path.length > 512 || !/^(?:docs|dataset|tests|packages)\//.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || !/^[\w.\-]+$/.test(part))) return undefined;
  return `${RELEASE.repository}/blob/main/${path.split('/').map(part => encodeURIComponent(part)).join('/')}${line !== undefined && Number.isInteger(line) && line > 0 ? `#L${line}` : ''}`;
}
function ArtifactLabel({ path, line }: { path: string; line?: number }) {
  const href = supportArtifactLink(path, line);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer">{path}{line ? ` · L${line}` : ''}</a> : <span>{path}{line ? ` · L${line}` : ''}</span>;
}

function SourceSupportPanel() {
  const [api, setApi] = useState<SupportMatrixApi>(), [error, setError] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setError(false);
    void loadSupportMatrix().then(module => { if (active) setApi(module); }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [attempt]);
  if (error) return <section className="source-support-matrix" aria-label="원자료 대응표"><p role="alert">대응표 데이터를 불러오지 못했습니다. 연결 상태를 확인하세요.</p>{attempt < 2 && <button className="button" onClick={() => setAttempt(current => current + 1)}>대응표 다시 불러오기</button>}</section>;
  if (!api) return <p role="status">원자료 대응표를 불러오고 있습니다.</p>;
  return <SourceSupportContent api={api}/>;
}

function SourceSupportContent({ api }: { api: SupportMatrixApi }) {
  const [query, setQuery] = useState(''), [section, setSection] = useState<number | undefined>(), [classification, setClassification] = useState<SupportClassification | undefined>(), [decision, setDecision] = useState<SupportDecision | undefined>(), [target, setTarget] = useState<SupportTarget | undefined>();
  const [selectedId, setSelectedId] = useState('01-001');
  const [reportError, setReportError] = useState(false);
  const rows = useMemo(() => api.listSourceSupport({ query, section, classification, decision, target }).slice(0, 385), [api, query, section, classification, decision, target]);
  const selected = rows.find(row => row.id === selectedId) ?? rows[0], summary = api.getSupportSummary();
  function downloadReport() {
    try { downloadText(api.serializeSupportMatrix(), 'CalcWeave-support-matrix.json', 'application/json'); setReportError(false); }
    catch { setReportError(true); }
  }
  return <section className="source-support-matrix" aria-labelledby="source-matrix-title">
    <h3 id="source-matrix-title">참고 자료와 CalcWeave 기능 비교</h3>
    <p>CalcWeave는 MATLAB 설치가 필요 없는 독립적인 웹 계산 도구입니다. 이 비교표는 Simulink 관련 참고 자료를 확인하기 위한 정보이며 기본 사용 조건이 아닙니다.</p>
    <p>R2024b에서 선택한 참고 자료의 원자료 {summary.trackedSourceRows}행을 추적합니다. 같은 이름이나 같은 계산 블록을 사용하는 항목도 원자료 ID로 구분합니다. 전체 Simulink 라이브러리 전수 목록이나 원본 전체 옵션의 동등성을 뜻하지 않으며, 원본 환경의 수치 동등성은 검증하지 않았습니다.</p>
    <p className="field-help" data-testid="historical-support-notice">이 표는 엔진 {api.SUPPORT_MATRIX.engineVersion}의 검증 기록입니다. 현재 엔진 {api.CURRENT_SUPPORT_EXTENSIONS.engineVersion}의 Display·Scope 다중 입력은 별도 확장 계약으로 제공됩니다. 브라우저 계산·TypeScript는 1~16개, Python·WASM 내보내기는 입력 1개를 지원합니다.</p>
    <div className="source-support-summary" data-testid="source-support-summary"><span>원자료 {summary.trackedSourceRows}행 · 이름 {summary.uniqueSourceNames}개</span><span>등록 계산 블록 {summary.registryDefinitions}개</span><span>선택 subset {summary.selectedSubsetRows}행 · 미지원 {summary.unsupportedRows}행</span><span>원본 옵션 inventory 미검증 {summary.unverifiedInventoryRows}행 · 전체 동등 승인 {summary.fullOptionEquivalentRows}행</span></div>
    <div className="source-support-filters">
      <label className="field source-support-search"><span className="field-label">원자료 이름·ID·구현 검색</span><input aria-label="원자료 검색" maxLength={120} value={query} onChange={event => setQuery(event.target.value.slice(0, 120))} placeholder="Display, 06-001, string…"/></label>
      <label className="field"><span className="field-label">분류</span><select aria-label="원자료 분류" value={section ?? ''} onChange={event => { const selected = api.SUPPORT_MATRIX.sections.find(item => String(item.id) === event.target.value); setSection(selected?.id); }}><option value="">전체 분류</option>{api.SUPPORT_MATRIX.sections.map(item => <option key={item.id} value={item.id}>{String(item.id).padStart(2, '0')} · {item.name}</option>)}</select></label>
      <label className="field"><span className="field-label">구현 유형</span><select aria-label="원자료 구현 유형" value={classification ?? ''} onChange={event => setClassification(Object.hasOwn(CLASSIFICATIONS, event.target.value) ? event.target.value as SupportClassification : undefined)}><option value="">전체 유형</option>{Object.entries(CLASSIFICATIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="field"><span className="field-label">지원 상태</span><select aria-label="원자료 지원 상태" value={decision ?? ''} onChange={event => setDecision(Object.hasOwn(DECISIONS, event.target.value) ? event.target.value as SupportDecision : undefined)}><option value="">전체 상태</option>{Object.entries(DECISIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label className="field"><span className="field-label">코드 타깃</span><select aria-label="원자료 코드 타깃" value={target ?? ''} onChange={event => setTarget(Object.hasOwn(TARGETS, event.target.value) ? event.target.value as SupportTarget : undefined)}><option value="">전체 타깃</option>{Object.entries(TARGETS).map(([id, label]) => <option key={id} value={id}>{label} 선택 구성</option>)}</select></label>
    </div>
    <p className="field-help">타깃 필터는 선택 구성의 승인 목록입니다. 실제 모델의 자료형·설정·모드·연결 검증이 필요합니다. 화면 위젯과 원본 환경 미지원 항목에는 실행 타깃을 부여하지 않습니다.</p>
    {target === 'c-cpp' && <p className="field-help">C/C++는 승인된 빌드·실행 프로파일이 없어 현재 선택 구성 목록이 없습니다.</p>}
    <div className="source-support-actions"><p className="support-result-count" role="status">{rows.length} / {summary.trackedSourceRows}행</p><button className="button" onClick={downloadReport}>전체 대응표 JSON 다운로드</button></div>
    {reportError && <p role="alert">대응표 보고서 다운로드를 준비하지 못했습니다. 창을 다시 열고 확인하세요.</p>}
    <p id="source-list-help" className="field-help">목록에서 ↑ ↓로 선택하고 Home·End로 처음·끝 항목에 이동합니다. Tab으로 상세의 링크와 설정을 확인하세요.</p>
    <div className="source-support-layout">
      <div className="source-support-list" role="group" aria-label="원자료 대응 목록" aria-describedby="source-list-help">{rows.map((row, index) => <button key={row.id} data-source-id={row.id} data-source-decision={row.decision.status} data-source-classification={row.decision.classification} aria-pressed={selected?.id === row.id} tabIndex={selected?.id === row.id ? 0 : -1} onClick={() => setSelectedId(row.id)} onKeyDown={event => {
        const next = event.key === 'ArrowDown' ? Math.min(index + 1, rows.length - 1) : event.key === 'ArrowUp' ? Math.max(index - 1, 0) : event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault(); event.stopPropagation(); setSelectedId(rows[next]!.id);
        event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[data-source-id]')[next]?.focus();
      }}><strong>{row.id} · {row.name}</strong><span>{String(row.section).padStart(2, '0')}절 · {row.subgroup}</span><span>{DECISIONS[row.decision.status]} · {CLASSIFICATIONS[row.decision.classification]}</span></button>)}{rows.length === 0 && <p className="muted-copy">일치하는 원자료 항목이 없습니다.</p>}</div>
      {selected && <SourceSupportDetails row={selected} api={api}/>}
    </div>
  </section>;
}

function SourceSupportDetails({ row, api }: { row: Readonly<SourceSupportRow>; api: SupportMatrixApi }) {
  return <section className="source-support-detail" aria-label="원자료 선택 항목 상세" data-source-detail-id={row.id}>
    <h3>{row.id} · {row.name}</h3><p>{row.decision.reason}</p>
    <div className="source-support-boundary"><strong>전체 동등성 미검증</strong><p>이 항목은 선언한 선택 subset 또는 명시한 미지원 상태입니다. 원본 옵션 inventory는 {row.sourceInventory.status}이며, MathWorks 참조 환경 실행과 모든 자료형·설정·타깃의 수치 동등성을 검증하지 않았습니다.</p></div>
    <dl className="support-metadata">
      <div><dt>원자료</dt><dd><ArtifactLabel path={row.source.path} line={row.source.line}/><small>{row.subgroup} · {row.condition}</small><small>원자료 ID SHA-256 <code className="source-support-code">{row.source.identitySha256}</code></small></dd></div>
      <div><dt>결정·책임</dt><dd>{DECISIONS[row.decision.status]} · {CLASSIFICATIONS[row.decision.classification]}<small>원래 상태: {row.decision.priorStatus} · 담당 {row.owner}</small><small>{row.verification.engineVersion} · {row.verification.auditScope}</small></dd></div>
      <div><dt>실행 방식</dt><dd>{row.capabilities.modes.length ? row.capabilities.modes.map(mode => `${mode} · ${MODES[mode]}`).join(' / ') : '실행 방식 미지원 또는 화면 전용'}</dd></div>
      <div><dt>옵션 계약 참조</dt><dd>{row.capabilities.optionsRef.join(' · ') || '등록 옵션 계약 없음'}<small>로컬 선언과 선택 설정만 확인하며 원본 전체 옵션 inventory는 미검증입니다.</small></dd></div>
      <div><dt>자료형</dt><dd>{row.capabilities.dtype.scopes.map(scope => <p key={scope.canonical}><code>{scope.canonical}</code> · {scope.description}</p>)}<small>{row.capabilities.dtype.status} · 실제 모델에서 검증</small></dd></div>
      <div><dt>외부 조건</dt><dd>native 실행: {row.externalConditions.nativeExecution === 'unavailable' ? '미지원 · unavailable' : '미검증 · unverified'}<small>{row.externalConditions.sourceCondition}</small>{row.externalConditions.requirements.map((requirement, index) => <p key={index}>{requirement}</p>)}<small>원본 환경 실행 확인 없음 · 외부 코드 재배포·사용권은 구현 여부로 판단하지 않습니다.</small>{row.externalConditions.profileIds.length > 0 && <small>프로파일: {row.externalConditions.profileIds.join(' · ')}</small>}</dd></div>
    </dl>
    <h4>승인된 선택 설정</h4>
    {row.capabilities.optionProfiles.length ? row.capabilities.optionProfiles.map((profile, index) => <div className="source-support-implementation" key={index}><strong>선택 구성 {index + 1} · {profile.scope}</strong><code className="source-support-code">{JSON.stringify(profile.parameters, null, 2)}</code><p>{profile.modes.join(' · ')}</p>{profile.presetId && <p>preset: <code>{profile.presetId}</code></p>}{profile.rawFixtureId && <p>원본 fixture: <code>{profile.rawFixtureId}</code></p>}{profile.requiredBindingsActuallyConnected && <p>검증 fixture의 실제 연결: {profile.requiredBindingsActuallyConnected.length ? profile.requiredBindingsActuallyConnected.join(' · ') : '추가 동적 바인딩 없음'}</p>}<ArtifactLabel path={profile.evidencePath}/>{profile.fixtureIds.length > 0 && <p>fixture: {profile.fixtureIds.join(' · ')}</p>}</div>) : <p>별도 preset 설정 선언은 없습니다. 아래 구현의 등록 계약과 승인 증거 범위만 적용합니다.</p>}
    <h4>연결된 구현·파라미터 계약</h4>
    {row.implementations.map(implementation => { const contract = api.getCanonicalSupport(implementation.id); return contract ? <CanonicalSupportDetails key={`${implementation.kind}-${implementation.id}`} contract={contract}/> : <p key={`${implementation.kind}-${implementation.id}`}><code>{implementation.id}</code> · {implementation.kind} · 실행 계약 없음</p>; })}
    <h4>코드 타깃별 범위</h4>
    <div className="source-support-targets">{row.capabilities.targets.map(capability => <div key={capability.target} data-support-target={capability.target} data-support-target-status={capability.status}><strong>{TARGETS[capability.target]} · {TARGET_STATUS[capability.status]}</strong><p>{capability.reason}</p><p>{capability.dtypeScope}</p><p>{capability.supportedModes.length ? capability.supportedModes.join(' · ') : '실행 모드 없음'} · {capability.version}</p><p>선택 구성만 해당하며 실제 모델의 설정·자료형·모드·연결 검증이 필요합니다.</p></div>)}</div>
    <h4>미확정·남은 확인</h4><p>{row.sourceInventory.reason}</p><ul>{row.unresolvedReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul><p className="field-help">원본 옵션 확인 대상: {row.sourceInventory.requiredDimensions.join(' · ')}</p>
    <h4>근거·검증 파일</h4><p>추적용 자료와 선택 subset의 실행 증거를 구분합니다. 파일과 hash는 승인된 자료를 찾기 위한 정보이며 원본 환경 동등성의 보증이 아닙니다.</p>
    {row.evidence.map((evidence, index) => <details key={`${evidence.path}-${index}`}><summary>{evidence.kind} · {evidence.path}</summary><p><ArtifactLabel path={evidence.path}/></p><p>{evidence.scope}</p><p>주장 범위: {evidence.claim}</p><code className="source-support-code">SHA-256 {evidence.sha256}</code>{evidence.fixtureIds?.length ? <p>fixture: {evidence.fixtureIds.join(' · ')}</p> : null}</details>)}
  </section>;
}

function CanonicalSupportDetails({ contract }: { contract: Readonly<CanonicalSupport> }) {
  return <section className="source-support-implementation" data-canonical-support-id={contract.id} aria-label={`${contract.id} 구현 계약`}><h4>{contract.label} · {contract.englishName}</h4><p><code>{contract.id}</code> · {contract.kind}{contract.kind === 'model-widget' ? ' · 모델 대시보드 위젯' : contract.kind === 'unavailable-capability' ? ' · 실행 계약 미지원' : ' · 등록 계산 블록'}</p><p>{contract.description}</p>
    <dl className="support-metadata"><div><dt>입력 / 출력</dt><dd>{contract.declaration.inputs.join(' · ') || '없음'} / {contract.declaration.outputs.join(' · ') || '없음'}<small>포트는 실제 설정·하위 도식에 따라 검증합니다.</small></dd></div><div><dt>자료형·모양</dt><dd>{contract.dtype.scope}<small>{contract.declaration.valueType} · {contract.declaration.shape} · {contract.dtype.status}</small></dd></div><div><dt>단위·시간·상태</dt><dd>{contract.declaration.unit} · {contract.declaration.sampleTime} · {contract.declaration.state}</dd></div>{contract.bindings?.length ? <div><dt>바인딩 조건</dt><dd>{contract.bindings.map((binding, index) => <p key={index}>{binding}</p>)}</dd></div> : null}</dl>
    {Object.keys(contract.parameters).length > 0 && <details><summary>설정·기본값 {Object.keys(contract.parameters).length}개</summary><div className="support-parameter-list">{Object.entries(contract.parameters).map(([id, parameter]) => <div key={id}><strong>{parameter.label} <code>{id}</code></strong><p>{parameter.kind}{parameter.required !== undefined ? ` · ${parameter.required ? '필수' : '선택'}` : ''} · {contract.kind === 'model-widget' && parameter.default === null ? '기본값 지정 없음' : <>기본값 <code>{JSON.stringify(parameter.default)}</code></>}</p><p>{parameterConstraint(parameter)}</p><p>로컬 선언 schema 범위 · 원본 전체 옵션 inventory 미검증</p></div>)}</div></details>}
  </section>;
}
