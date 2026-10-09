import assert from 'node:assert/strict';
import { resolve } from 'node:path';

export const CI_UNIT_RESULTS_PATH = '.test-generated/ci-unit-results.json';
export const HISTORICAL_M16_UNIT_RESULTS_PATH = 'docs/evidence/m16-support-unit-results.json';
export const M16_SUPPORT_TEST_PATH = 'tests/m16-support-matrix.test.ts';
export const UNIT_RESULTS_MAX_BYTES = 32 * 1024 * 1024;

export type M16UnitEvidenceMode = 'fresh-current-tests' | 'frozen-historical-proof';
interface AssertionResult { status: string }
interface TestResult { name: string; status: string; assertionResults: AssertionResult[] }
interface UnitResults {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  testResults: TestResult[];
}

/** CI may read only its dedicated fresh report, never an arbitrary supplied path. */
export function m16UnitEvidenceInput(value: string | undefined): { path: string; mode: M16UnitEvidenceMode } {
  if (value === undefined) return { path: HISTORICAL_M16_UNIT_RESULTS_PATH, mode: 'frozen-historical-proof' };
  assert.equal(value, CI_UNIT_RESULTS_PATH, 'CALCWEAVE_UNIT_RESULTS must use the dedicated CI unit report path');
  return { path: CI_UNIT_RESULTS_PATH, mode: 'fresh-current-tests' };
}

export function validateM16UnitResults(value: unknown, mode: M16UnitEvidenceMode): { passed: number; failed: 0; files: 1; totalPassed: number; sourcePath: string; mode: M16UnitEvidenceMode } {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), 'Unit evidence must be a JSON object');
  const unit = value as UnitResults;
  assert.equal(unit.success, true, 'Unit evidence reports an unsuccessful test run');
  assert.equal(unit.numFailedTests, 0, 'Unit evidence contains failed tests');
  assert(Array.isArray(unit.testResults) && unit.testResults.length > 0 && unit.testResults.length <= 1_000, 'Unit evidence has no bounded suite list');
  for (const suite of unit.testResults) {
    assert(suite !== null && typeof suite === 'object' && Array.isArray(suite.assertionResults), 'Malformed unit suite');
    assert(suite.assertionResults.every(test => test !== null && typeof test === 'object' && test.status === 'passed'), 'Unit evidence contains a failed, pending or skipped assertion');
  }
  if (mode === 'frozen-historical-proof') {
    // Preserve the original standalone M16 proof contract for existing CLI use.
    assert.equal(unit.numPassedTests, 28);
    assert.equal(unit.testResults.length, 1);
    assert.equal(unit.testResults[0]!.assertionResults.length, 28);
    return { passed: 28, failed: 0, files: 1, totalPassed: 28, sourcePath: M16_SUPPORT_TEST_PATH, mode };
  }
  assert.equal(unit.numPendingTests, 0, 'Fresh unit run must not contain pending tests');
  assert.equal(unit.numTodoTests, 0, 'Fresh unit run must not contain todo tests');
  assert(Number.isSafeInteger(unit.numPassedTests) && unit.numPassedTests >= 28 && unit.numPassedTests <= 100_000, 'Fresh unit passed count is invalid');
  const assertions = unit.testResults.reduce((count, suite) => count + suite.assertionResults.length, 0);
  assert.equal(unit.numPassedTests, assertions, 'Fresh unit report counters differ from actual assertions');
  assert.equal(unit.numTotalTests, assertions, 'Fresh unit report has unaccounted tests');
  assert(unit.testResults.every(suite => suite.status === 'passed'), 'Fresh unit evidence contains an incomplete or failed suite');
  const supportSuites = unit.testResults.filter(suite => typeof suite.name === 'string' && resolve(suite.name) === resolve(M16_SUPPORT_TEST_PATH));
  assert.equal(supportSuites.length, 1, 'Fresh unit run must execute the current M16 support test file exactly once');
  const passed = supportSuites[0]!.assertionResults.length;
  assert(passed >= 28, 'Fresh M16 support suite omitted established assertions');
  return { passed, failed: 0, files: 1, totalPassed: unit.numPassedTests, sourcePath: M16_SUPPORT_TEST_PATH, mode };
}
