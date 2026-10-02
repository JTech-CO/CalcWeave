import type { CSSProperties } from 'react';

export type IconName = 'search' | 'play' | 'pause' | 'reset' | 'stop' | 'download' | 'upload' | 'undo' | 'redo' | 'plus' | 'close' | 'check' | 'layers' | 'sliders' | 'chart' | 'arrow' | 'info' | 'sun' | 'moon' | 'trash' | 'link' | 'grid';

const paths: Record<IconName, string> = {
  search: 'm21 21-4.35-4.35 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  play: 'm8 4 12 8-12 8z',
  pause: 'M8 5v14M16 5v14',
  reset: 'M4 10a8 8 0 1 1 1 8M4 4v6h6',
  stop: 'M6 6h12v12H6z',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',
  undo: 'M8 4 3 9l5 5M3 9h11a7 7 0 0 1 0 14',
  redo: 'm16 4 5 5-5 5M21 9H10a7 7 0 0 0 0 14',
  plus: 'M12 5v14M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  check: 'm5 12 4 4L19 6',
  layers: 'm12 3 10 5-10 5L2 8zm-10 9 10 5 10-5M2 16l10 5 10-5',
  sliders: 'M4 4v4m0 4v8M12 4v10m0 4v2M20 4v2m0 4v10M1 8h6m2 10h6m2-12h6',
  chart: 'M4 4v16h16M7 14l4-5 4 3 5-7',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  info: 'M12 11v6m0-10v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
  moon: 'M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  link: 'm10 13 4-4M8 15l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 3 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
};

export function Icon({ name, size = 18, style }: { name: IconName; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
