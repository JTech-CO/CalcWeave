import { compileModel } from '../../compiler/src';
import { MODEL_LIMITS, ModelError, parseModelJson, type CalcModel, type Diagnostic } from '../../model/src';
export * from './native';

export const MODEL_IMPORT_LIMITS = Object.freeze({ maxBytes: MODEL_LIMITS.maxBytes, maxDepth: MODEL_LIMITS.maxDepth });
export interface ModelImportInspection {
  /** Whether bounded text was syntactically valid JSON; model availability separately indicates schema validation. */
  parsed: boolean;
  /** No foreign-format adapter is implemented. Native JSON is parsed directly, not converted. */
  converted: boolean;
  executable: boolean;
  model?: CalcModel;
  diagnostics: Diagnostic[];
  format: 'calcweave' | 'unknown';
}

function failure(parsed: boolean, format: ModelImportInspection['format'], code: string, message: string): ModelImportInspection {
  return { parsed, converted: false, executable: false, diagnostics: [{ code, message }], format };
}

/** Read-only import boundary. Parsing, unsupported conversion, and executable compilation are distinct stages. */
export function inspectModelImport(text: string): ModelImportInspection {
  if (typeof text !== 'string') return failure(false, 'unknown', 'INVALID_JSON', '가져올 모델은 JSON 텍스트여야 합니다.');
  if (text.length > MODEL_IMPORT_LIMITS.maxBytes || new TextEncoder().encode(text).byteLength > MODEL_IMPORT_LIMITS.maxBytes) {
    return failure(false, 'unknown', 'MODEL_TOO_LARGE', '모델 JSON은 5 MiB 이하여야 합니다.');
  }
  let depth = 0, inString = false, escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === '{' || character === '[') {
      if (++depth > MODEL_IMPORT_LIMITS.maxDepth + 1) return failure(false, 'unknown', 'MODEL_DEPTH_EXCEEDED', '모델의 중첩 깊이는 32단계 이하여야 합니다.');
    } else if (character === '}' || character === ']') depth--;
  }
  let value: unknown;
  try { value = JSON.parse(text); } catch { return failure(false, 'unknown', 'IMPORT_FORMAT_UNSUPPORTED', 'JSON 모델로 파싱할 수 없습니다. 외부 도식 포맷 변환은 아직 지원하지 않습니다.'); }
  const native = value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.hasOwn(value, 'schemaVersion') && Object.hasOwn(value, 'modelId');
  if (!native) return failure(true, 'unknown', 'IMPORT_FORMAT_UNSUPPORTED', 'CalcWeave 원본 모델 JSON이 아닙니다. 외부 포맷은 변환하거나 실행하지 않았습니다.');
  let model: CalcModel;
  try { model = parseModelJson(text); } catch (error) {
    return { parsed: true, converted: false, executable: false, diagnostics: error instanceof ModelError ? error.diagnostics : [{ code: 'INVALID_MODEL', message: '모델 구조를 확인해 주세요.' }], format: 'calcweave' };
  }
  let diagnostics: Diagnostic[] = [];
  try { compileModel(model); } catch (error) {
    diagnostics = error instanceof ModelError ? error.diagnostics : [{ code: 'IMPORT_VALIDATION_FAILED', message: '모델 실행 계약을 검증할 수 없습니다.' }];
  }
  return { parsed: true, converted: false, executable: diagnostics.length === 0, model, diagnostics, format: 'calcweave' };
}
