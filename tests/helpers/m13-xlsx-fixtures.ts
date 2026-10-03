import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../../packages/data/src/bounded-xlsx';
const encoder = new TextEncoder();
export function fixtureZip(files: Record<string, string>, compression = 0): Uint8Array {
  const local: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0;
  for (const [filename, text] of Object.entries(files)) { const name = encoder.encode(filename), bytes = encoder.encode(text), payload = compression ? new Uint8Array(deflateRawSync(bytes)) : bytes, crc = crc32(bytes);
    const head = new Uint8Array(30 + name.length), v = new DataView(head.buffer); v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(8, compression, true); v.setUint32(14, crc, true); v.setUint32(18, payload.length, true); v.setUint32(22, bytes.length, true); v.setUint16(26, name.length, true); head.set(name, 30);
    const directory = new Uint8Array(46 + name.length), d = new DataView(directory.buffer); d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(10, compression, true); d.setUint32(16, crc, true); d.setUint32(20, payload.length, true); d.setUint32(24, bytes.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46);
    local.push(head, payload); central.push(directory); offset += head.length + payload.length;
  }
  const csize = central.reduce((sum, entry) => sum + entry.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer); e.setUint32(0, 0x06054b50, true); e.setUint16(8, central.length, true); e.setUint16(10, central.length, true); e.setUint32(12, csize, true); e.setUint32(16, offset, true);
  const result = new Uint8Array(offset + csize + 22); let at = 0; for (const part of [...local, ...central, end]) { result.set(part, at); at += part.length; } return result;
}
export function workbookFiles(sheet = '<row r="1"><c r="A1" t="inlineStr"><is><t>time</t></is></c><c r="B1" t="inlineStr"><is><t>value</t></is></c></row><row r="2"><c r="A2"><v>0</v></c><c r="B2"><v>2</v></c></row><row r="3"><c r="A3"><v>1</v></c><c r="B3"><v>6</v></c></row>'): Record<string, string> {
  return { '[Content_Types].xml': '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>', '_rels/.rels': '<Relationships><Relationship Id="workbook" Target="xl/workbook.xml"/></Relationships>', 'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="r"><sheets><sheet name="실험" sheetId="1" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${sheet}</sheetData></worksheet>` };
}
