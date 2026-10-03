import type { CalcModel, Dataset } from '../../model/src';

export const NATIVE_IMPORT_LIMITS = Object.freeze({ maxInputBytes: 2 * 1024 * 1024, maxExpandedBytes: 8 * 1024 * 1024, maxEntries: 64, maxXmlNodes: 100_000, maxDepth: 32, maxIssues: 2_000, maxArchiveBytes: 5 * 1024 * 1024, maxMatVariables: 64 });
export type NativeFormat = 'mat-v5' | 'slx' | 'mdl';
/** Text offsets/columns use UTF-16 code units; MAT offsets use bytes within the named element stream. */
export interface NativeLocation { member?: string; offset: number; line?: number; column?: number; path?: string }
export interface NativeIssue { code: string; severity: 'info' | 'warning' | 'unsupported'; message: string; location: NativeLocation; nativeId?: string; parameter?: string; original?: string }
export interface NativeImportOptions { inports?: Record<string, number> }
export interface NativeImportReport {
  profile: 'calcweave-native-scalar-v1'; format: NativeFormat; parse: 'passed' | 'failed'; convertedBlocks: number;
  graphCompile: 'passed' | 'failed' | 'not-applicable'; execution: 'supported' | 'unsupported' | 'not-applicable';
  numericalEquivalence: 'unverified'; roundTrip: { originalBytes: 'preserved'; editedNativeModel: 'not-supported' };
  assumptions: string[]; issues: NativeIssue[];
}
export interface NativeInport { nativeId: string; name: string; location: NativeLocation }
export interface NativeMatVariable { name: string; dimensions: number[]; location: NativeLocation; supported: boolean; reason?: string; rows?: number[][] }
export interface NativeSourceOrigin { kind: 'block' | 'connection' | 'variable'; nativeId: string; convertedId?: string; location: NativeLocation; parameters?: { name: string; location: NativeLocation }[] }
export interface NativeInspection {
  filename: string; format: NativeFormat; sourceHash: string; sourceBytes: Uint8Array; options: NativeImportOptions;
  report: NativeImportReport; model?: CalcModel; inports: NativeInport[]; variables: NativeMatVariable[]; locations: NativeSourceOrigin[];
}
export interface InteropArchiveInspection { inspection: NativeInspection; selectedVariable?: string; dataset?: Dataset }
export function nativeReport(format: NativeFormat): NativeImportReport {
  return { profile: 'calcweave-native-scalar-v1', format, parse: 'passed', convertedBlocks: 0, graphCompile: 'not-applicable', execution: 'not-applicable', numericalEquivalence: 'unverified', roundTrip: { originalBytes: 'preserved', editedNativeModel: 'not-supported' }, assumptions: [], issues: [] };
}
