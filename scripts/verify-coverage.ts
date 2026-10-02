import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sourceBytes = await readFile('dataset/Simulink_Basic_Blocks_R2024b.md');
const lines = sourceBytes.toString('utf8').split(/\r?\n/);
const rows = new Map<string, { name: string; condition: string; line: number }>();
let section = 0, ordinal = 0;
for (const [index, line] of lines.entries()) {
  const heading = /^## (\d{2})\. /.exec(line);
  if (heading) { section = Number(heading[1]); ordinal = 0; }
  if (section < 1 || section > 21) continue;
  const match = /^\| ([^|]+) \| ([^|]+) \|\s*$/.exec(line);
  if (!match || match[1] === '블록명' || /^[-: ]+$/.test(match[1])) continue;
  ordinal++;
  rows.set(`${String(section).padStart(2, '0')}-${String(ordinal).padStart(3, '0')}`, { name: match[1].trim(), condition: match[2].trim(), line: index + 1 });
}
const coverage = await readFile('docs/block-coverage.md', 'utf8');
const seen = new Set<string>();
const statuses: Record<string, number> = {};
for (const line of coverage.split(/\r?\n/)) {
  const match = /^\| \[(\d{2}-\d{3})\]\([^)]*\) \(L(\d+)\) \|/.exec(line);
  if (!match) continue;
  const cells = line.slice(1, -1).split('|').map(cell => cell.trim());
  const source = rows.get(match[1]);
  if (!source || seen.has(match[1]) || source.name !== cells[1] || source.condition !== cells[3] || source.line !== Number(match[2])) throw new Error(`Source mismatch or duplicate: ${match[1]}`);
  seen.add(match[1]);
  statuses[cells[8]] = (statuses[cells[8]] ?? 0) + 1;
}
if (rows.size !== 385 || seen.size !== 385) throw new Error(`Coverage incomplete: ${rows.size} / ${seen.size}`);
const sha256 = createHash('sha256').update(sourceBytes).digest('hex').toUpperCase();
if (sha256 !== 'CFA9BC90F5FC50C64F85AABC3A3F74CC0329954289FF570618E94798524813D7') throw new Error('Reference dataset changed');
process.stdout.write(JSON.stringify({ sourceRows: rows.size, trackedRows: seen.size, duplicates: 0, statuses, datasetSha256: sha256 }, null, 2) + '\n');
