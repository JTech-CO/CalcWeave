import { getBlockDefinition } from '../../../packages/block-library/src';

export const BLOCK_DRAG_MIME = 'application/x-calcweave-block';
export function parseDraggedBlock(value: string): string | undefined {
  if (value.length > 100 || !/^[a-z][a-z0-9.-]*$/.test(value)) return;
  return getBlockDefinition(value) ? value : undefined;
}
export function canvasDropPosition(position: { x: number; y: number }): { x: number; y: number } | undefined {
  if (![position.x, position.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1_000_000)) return;
  return { x: Math.round(position.x / 16) * 16, y: Math.round(position.y / 16) * 16 };
}
