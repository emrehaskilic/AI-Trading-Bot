import { writeFileSync } from 'node:fs';
import { TestResult } from './test_utils.ts';
import { ALL_TESTS } from './strategy_simulation_test.ts';

interface TestSuiteResult {
  passed: number;
  failed: number;
  total: number;
  results: TestResult[];
  startTime: number;
  endTime: number;
  duration: number;
}

export async function runAllTests(): Promise<TestSuiteResult> {
  const startTime = Date.now();
  const results: TestResult[] = [];

  for (const testFn of ALL_TESTS) {
    const result = await Promise.resolve(testFn());
    results.push(result);
    const status = result.passed ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${result.testName} (${result.duration}ms)`);
    if (!result.passed && result.error) {
      console.log(`  error: ${result.error}`);
    }
  }

  const endTime = Date.now();
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  return {
    passed,
    failed,
    total: results.length,
    results,
    startTime,
    endTime,
    duration: endTime - startTime,
  };
}

export function formatSummary(suite: TestSuiteResult): string {
  const passRate = suite.total > 0 ? ((suite.passed / suite.total) * 100).toFixed(1) : '0.0';
  return [
    '',
    '================ Test Summary ================',
    `Total: ${suite.total}`,
    `Passed: ${suite.passed}`,
    `Failed: ${suite.failed}`,
    `Pass Rate: ${passRate}%`,
    `Duration: ${suite.duration}ms`,
    '==============================================',
    '',
  ].join('\n');
}

export function saveResults(suite: TestSuiteResult, outputPath: string): void {
  const report = {
    generatedAt: new Date().toISOString(),
    summary: {
      total: suite.total,
      passed: suite.passed,
      failed: suite.failed,
      duration: suite.duration,
    },
    results: suite.results,
  };
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf8');
}

async function main(): Promise<void> {
  console.log('Strategy Consensus Test Runner');
  console.log('==============================');

  const suite = await runAllTests();
  console.log(formatSummary(suite));

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = `strategy-test-results-${ts}.json`;
  saveResults(suite, outputPath);
  console.log(`Results saved to ${outputPath}`);

  if (suite.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('strategy_test_runner_failed', error);
  process.exitCode = 1;
});
