import { ModelError, type CalcModel, type DashboardAppliedEvent } from '../../../packages/model/src';
/** Receipts describe actual due boundaries. Initial model parameters are never overwritten. */
export function appendDashboardReplayEvents(model: CalcModel, receipts: readonly DashboardAppliedEvent[]): CalcModel {
  if (receipts.length > 256) throw new ModelError([{ code: 'DASHBOARD_EVENT_LIMIT', message: '실행 중 적용 기록은256개 이하여야 합니다.' }]);
  const next = structuredClone(model);
  for (const receipt of receipts) {
    if (!receipt || typeof receipt.nodeId !== 'string' || !Number.isFinite(receipt.value) || !Number.isFinite(receipt.time) || receipt.time < model.execution.startTime || receipt.time > model.execution.stopTime || !Number.isSafeInteger(receipt.order) || receipt.order < 0 || !next.nodes.some(node => node.id === receipt.nodeId && ['dashboard.control', 'math.slider-gain'].includes(node.blockType))) throw new ModelError([{ code: 'DASHBOARD_RECEIPT', message: '적용된 조작 기록의 블록·값·시간·순서를 확인하세요.' }]);
  }
  for (const node of next.nodes) {
    const edits = receipts.filter(receipt => receipt.nodeId === node.id); if (!edits.length) continue;
    const planned = JSON.parse(String(node.parameters.events ?? '[]')) as { time: number; order: number; value: number }[];
    if (planned.length + edits.length > 256) throw new ModelError([{ code: 'DASHBOARD_EVENT_LIMIT', nodeId: node.id, message: '블록의 재현 기록은256개 이하여야 합니다.' }]);
    const events = [...planned.map(event => ({ ...event, origin: 0 })), ...edits.map(({ time, order, value }) => ({ time, order, value, origin: 1 }))].sort((a, b) => a.time - b.time || a.origin - b.origin || a.order - b.order).map(({ time, value }, order) => ({ time, order, value }));
    node.parameters.events = JSON.stringify(events);
  }
  return next;
}
