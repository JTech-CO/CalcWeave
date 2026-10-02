/** Fixed filenames and bounded, deterministic ZIP store records; no archive imports/extraction. */
export const EXPORT_ARCHIVE_LIMITS = Object.freeze({ maxFileBytes: 16 * 1024 * 1024, maxArchiveBytes: 32 * 1024 * 1024, maxFiles: 6 });
const ALLOWED_FILES = new Set(['model.ts', 'model.py', 'model.cw.json', 'manifest.json', 'expected-output.json', 'run-example.ts', 'run-example.py', 'README.md']);
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function createExportArchive(files: Readonly<Record<string, string>>): Uint8Array<ArrayBuffer> {
  const entries = Object.entries(files);
  if (entries.length === 0 || entries.length > EXPORT_ARCHIVE_LIMITS.maxFiles) throw new Error('실행 묶음의 파일 개수가 올바르지 않습니다.');
  const encoder = new TextEncoder();
  let localSize = 0, centralSize = 0;
  const encoded = entries.map(([name, text]) => {
    if (!ALLOWED_FILES.has(name) || typeof text !== 'string') throw new Error('실행 묶음의 파일 이름이나 내용이 올바르지 않습니다.');
    // Bound UTF-16 text before allocating its UTF-8 representation as well.
    if (text.length > EXPORT_ARCHIVE_LIMITS.maxFileBytes) throw new Error('실행 묶음의 한 파일은 16 MiB 이하여야 합니다. 기록 범위를 줄여 주세요.');
    const nameBytes = encoder.encode(name), bytes = encoder.encode(text);
    if (bytes.byteLength > EXPORT_ARCHIVE_LIMITS.maxFileBytes) throw new Error('실행 묶음의 한 파일은 16 MiB 이하여야 합니다. 기록 범위를 줄여 주세요.');
    const offset = localSize;
    localSize += 30 + nameBytes.length + bytes.length; centralSize += 46 + nameBytes.length;
    if (localSize + centralSize + 22 > EXPORT_ARCHIVE_LIMITS.maxArchiveBytes) throw new Error('실행 묶음은 32 MiB 이하여야 합니다. 기록 범위를 줄여 주세요.');
    return { nameBytes, bytes, offset, crc: crc32(bytes) };
  });
  const archive = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(archive.buffer);
  const write16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const write32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  let centralOffset = localSize;
  for (const entry of encoded) {
    const { offset, crc, nameBytes, bytes } = entry;
    write32(offset, 0x04034b50); write16(offset + 4, 20); write16(offset + 6, 0x0800);
    write16(offset + 12, 33); write32(offset + 14, crc); write32(offset + 18, bytes.length); write32(offset + 22, bytes.length); write16(offset + 26, nameBytes.length);
    archive.set(nameBytes, offset + 30); archive.set(bytes, offset + 30 + nameBytes.length);
    write32(centralOffset, 0x02014b50); write16(centralOffset + 4, 20); write16(centralOffset + 6, 20); write16(centralOffset + 8, 0x0800);
    write16(centralOffset + 14, 33); write32(centralOffset + 16, crc); write32(centralOffset + 20, bytes.length); write32(centralOffset + 24, bytes.length); write16(centralOffset + 28, nameBytes.length); write32(centralOffset + 42, offset);
    archive.set(nameBytes, centralOffset + 46); centralOffset += 46 + nameBytes.length;
  }
  write32(centralOffset, 0x06054b50); write16(centralOffset + 8, encoded.length); write16(centralOffset + 10, encoded.length); write32(centralOffset + 12, centralSize); write32(centralOffset + 16, localSize);
  return archive;
}

export const EXPORT_RUN_EXAMPLE = `import { run, getManifest } from './model.js';

// The generated model runs locally, without CalcWeave or a network connection.
const result = run();
console.log(JSON.stringify({ manifest: getManifest(), result }, null, 2));
`;

export const PYTHON_RUN_EXAMPLE = `import json
from model import run, get_manifest

# Run locally with the Python standard library.
print(json.dumps({"manifest": get_manifest(), "result": run()}, ensure_ascii=False, indent=2, allow_nan=False))
`;

export function pythonArchiveReadme(hasExpected: boolean): string {
  return `# CalcWeave Python 실행 묶음\n\nPython 3.10 이상에서 표준 라이브러리만 사용합니다.\n\n- model.py: 승인된 정적·이산 모델의 독립 계산 코드. run()과 get_manifest()를 제공합니다.\n- model.cw.json: CalcWeave에서 편집할 수 있는 원래 모델.\n- manifest.json: 타깃·엔진 버전, 모델 해시, 실행 설정과 지원 범위.\n- run-example.py: JSON 결과를 출력하는 실행 예제.\n${hasExpected ? '- expected-output.json: 현재 모델의 완료 결과. 수치 원시값을 비교하는 기준입니다.' : '현재 모델의 완료 결과가 없어 expected-output.json을 포함하지 않았습니다.'}\n\n\`\`\`sh\npython model.py\npython run-example.py\n\`\`\`\n\nPython 타깃의 지원표와 manifest에 있는 블록·모드·자료형 범위에서 실행합니다. 연속 solver와 지원하지 않는 블록을 자동으로 다른 수식으로 바꾸지 않습니다. 파일과 네트워크를 읽지 않으며 데이터는 모델에 내장됩니다. 이 묶음은 현재 브라우저에서 생성했습니다.\n`;
}

export function exportArchiveReadme(hasExpected: boolean, mode: 'static' | 'discrete' | 'continuous' = 'discrete', m4 = false, m5 = false, catalog = false): string {
  const executionNote = mode === 'continuous' ? '모델은 manifest의 RK4·RK45 설정과 연속·혼합 경계 규칙을 따릅니다. 출력 격자는 solver 내부 간격과 별개입니다. 같은 경계에서는 reset → tick → observe 순서로 초기화, 이산 갱신, 출력 관측을 처리합니다. Rate Transition 등 경계 버퍼는 read-before-write 규칙을 따릅니다. 결과의 stateTime은 finalState가 확정된 시각이며, raw 출력의 마지막 샘플 시각과 다를 수 있습니다.' : mode === 'static' ? '연결된 입력과 수식을 한 번 계산합니다. 시간 상태를 사용하는 도식은 해당 블록이 지원하는 이산·연속 실행 방식을 선택합니다.' : '모델은 정수 tick의 고정 샘플시간 규칙을 따릅니다. Rate Transition은 이전 발행값을 읽습니다.';
  const scopeNote = (catalog ? '수학·신호 확장 타깃입니다. 라이브러리의 144개 블록 정의에서 각 블록의 지원 모드·자료형·형상·단위 규칙에 따라 승인된 정적·이산·연속 계산을 내보냅니다. 통계 집계, 벡터·행렬 조작, 명시적 수학 함수와 시간 파형을 포함하며 실제 사용 블록과 허용 범위는 manifest에 기록됩니다. 연속 ODE 상태와 hold 입력의 scalar 제한은 유지하고, 일반 수식의 배열 신호는 승인된 형상에서 계산합니다. 새 불연속 함수의 변화하는 출력을 연속 상태에 연결하면 실행 승인을 거부합니다. ' : '') + (m5 || catalog ? '승인된 M5 실수 행렬 계산, 2D 표 보간·Prelookup, 최대 32-bit 저장 정수를 사용하는 양자화를 포함합니다. 양자화는 명시한 반올림·overflow 규칙으로 decoded 값과 저장 정수를 계산하며 일반적인 고정소수점 자료형 전체를 대체하지 않습니다. ' : '') + (m4 || m5 || catalog ? '승인된 M4 데이터 재생·명시적 단위 변환·이름 있는 scalar 신호·투명한 하위 도식 확장을 포함합니다. 재생 데이터는 코드에 내장되어 외부 파일이나 URL을 읽지 않습니다. manifest의 dataReferences와 hierarchyReferences에 버전·SHA-256 출처를 기록하며 model.cw.json에는 편집 가능한 원래 계층과 대시보드·노트를 보관합니다. 실행 기록과 실험 비교는 원시 결과를 기준으로 합니다. 모든 MATLAB 옵션의 호환은 제공하지 않습니다.' : mode === 'continuous' ? '연속 scalar ODE·단위 1과 명시적 hold의 현재 승인된 M3 부분집합입니다. solver 통계와 이벤트 기록은 기준 결과에 포함됩니다. 모든 MATLAB 옵션의 호환은 제공하지 않습니다.' : '숫자 오차, 경계·reset·hold 및 상태의 의미는 현재 승인된 M2 부분집합에 한정됩니다. 모든 MATLAB 옵션의 호환은 제공하지 않습니다.');
  return `# CalcWeave TypeScript 실행 묶음\n\n${executionNote}\n\n- model.ts: 검증된 모델과 최소 런타임. 외부 import 없이 run()과 getManifest()를 제공합니다.\n- model.cw.json: CalcWeave에서 다시 열 수 있는 현재 모델.\n- manifest.json: 모델 SHA-256, 엔진·타깃 버전, 실행 설정, rate·seed, 단위·자료형과 자원 상한.\n- run-example.ts: 독립 실행 예제.\n${hasExpected ? '- expected-output.json: 현재 모델의 완료 결과. 시간축·출력·최종 상태와 내부 메모리를 비교할 수 있습니다.' : '이번 묶음에는 현재 모델의 완료 결과가 없어 expected-output.json을 포함하지 않았습니다. CalcWeave에서 먼저 실행한 뒤 다시 내려받으면 기준 결과를 포함합니다.'}\n\nTypeScript와 Node.js 실행 환경에서:\n\n\`\`\`sh\ntsc --target ES2022 --module commonjs model.ts run-example.ts --outDir output\nnode output/run-example.js\n\`\`\`\n\n위 명령은 package.json의 type이 module이 아닌 디렉토리에서 실행하세요. 생성 코드 자체에는 패키지 설치나 네트워크 접근이 필요하지 않습니다. TypeScript 도구와 Node.js는 별도로 준비합니다.\n\n${scopeNote} 이 파일들은 로컬 작업 공간에서 생성했습니다.\n`;
}
