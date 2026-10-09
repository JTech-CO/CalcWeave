import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CI_UNIT_RESULTS_PATH, HISTORICAL_M16_UNIT_RESULTS_PATH, M16_SUPPORT_TEST_PATH, m16UnitEvidenceInput, validateM16UnitResults } from '../scripts/m16-unit-evidence';

function freshReport(supportCount = 28) {
  const assertions = (length: number) => Array.from({ length }, () => ({ status: 'passed' }));
  return { success: true, numTotalTests: supportCount + 3, numPassedTests: supportCount + 3, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, testResults: [
    { name: resolve(M16_SUPPORT_TEST_PATH), status: 'passed', assertionResults: assertions(supportCount) },
    { name: resolve('tests/other.test.ts'), status: 'passed', assertionResults: assertions(3) },
  ] };
}

describe('M16 deployment unit evidence', () => {
  it('allows only the dedicated fresh CI report while preserving explicit historical fallback', () => {
    expect(m16UnitEvidenceInput(CI_UNIT_RESULTS_PATH)).toEqual({ path: CI_UNIT_RESULTS_PATH, mode: 'fresh-current-tests' });
    expect(m16UnitEvidenceInput(undefined)).toEqual({ path: HISTORICAL_M16_UNIT_RESULTS_PATH, mode: 'frozen-historical-proof' });
  });
  it.each(['', HISTORICAL_M16_UNIT_RESULTS_PATH, '../ci-unit-results.json', '/tmp/ci-unit-results.json', '.test-generated/../docs/evidence/m16-support-unit-results.json'])('rejects substituted fresh evidence path %s', path => {
    expect(() => m16UnitEvidenceInput(path)).toThrow();
  });
  it('validates the preserved original 28-test proof as historical evidence', () => {
    const original = JSON.parse(readFileSync(HISTORICAL_M16_UNIT_RESULTS_PATH, 'utf8'));
    expect(validateM16UnitResults(original, 'frozen-historical-proof')).toMatchObject({ passed: 28, totalPassed: 28, mode: 'frozen-historical-proof' });
  });
  it.each([28, 29, 40])('accepts a complete fresh support suite with %i tests and reports actual counts', count => {
    expect(validateM16UnitResults(freshReport(count), 'fresh-current-tests')).toEqual({ passed: count, failed: 0, files: 1, totalPassed: count + 3, sourcePath: M16_SUPPORT_TEST_PATH, mode: 'fresh-current-tests' });
  });
  it.each(['success', 'numFailedTests', 'numPendingTests', 'numTodoTests', 'numPassedTests', 'numTotalTests'])('rejects unsuccessful or inconsistent fresh run field %s', field => {
    const report = freshReport();
    Object.assign(report, { [field]: field === 'success' ? false : 1 });
    expect(() => validateM16UnitResults(report, 'fresh-current-tests')).toThrow();
  });
  it.each(['failed', 'pending', 'skipped', 'todo'])('rejects a support assertion with status %s despite passed summary counters', status => {
    const report = freshReport(); report.testResults[0]!.assertionResults[0]!.status = status;
    expect(() => validateM16UnitResults(report, 'fresh-current-tests')).toThrow();
  });
  it('rejects an unrelated failing assertion and an incomplete suite', () => {
    const failed = freshReport(); failed.testResults[1]!.assertionResults[0]!.status = 'failed';
    expect(() => validateM16UnitResults(failed, 'fresh-current-tests')).toThrow();
    const incomplete = freshReport(); incomplete.testResults[1]!.status = 'pending';
    expect(() => validateM16UnitResults(incomplete, 'fresh-current-tests')).toThrow();
  });
  it('rejects an absent, duplicated or truncated current support test file', () => {
    const absent = freshReport(); absent.testResults[0]!.name = resolve('old/tests/m16-support-matrix.test.ts');
    expect(() => validateM16UnitResults(absent, 'fresh-current-tests')).toThrow();
    const duplicate = freshReport(); duplicate.testResults[1]!.name = resolve(M16_SUPPORT_TEST_PATH);
    expect(() => validateM16UnitResults(duplicate, 'fresh-current-tests')).toThrow();
    expect(() => validateM16UnitResults(freshReport(27), 'fresh-current-tests')).toThrow();
  });
  it.each([null, [], {}, { success: true, numFailedTests: 0, testResults: [null] }])('rejects malformed report %j', value => {
    expect(() => validateM16UnitResults(value, 'fresh-current-tests')).toThrow();
  });
});
