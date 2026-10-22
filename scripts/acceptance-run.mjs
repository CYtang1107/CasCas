// Phase 8 acceptance evidence generator. Uses only isolated, deterministic tests;
// does not invoke deployed servers, real AI providers, payments or physical chargers.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const paths = ['test/acceptance.test.js', 'test/pilot-readiness.test.js'];
const args = ['--test', '--test-reporter=tap', ...paths];
const result = spawnSync(process.execPath, args, {
  cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
  env: { ...process.env, TZ: 'Asia/Kuala_Lumpur' },
});
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');

const value = (field) => {
  const line = (result.stdout || '').match(new RegExp(`^# ${field} (\\d+)$`, 'm'));
  return line ? Number(line[1]) : null;
};
const evidence = {
  kind: 'CasSama Phase 8 automated acceptance (simulated)',
  generatedAt: new Date().toISOString(),
  nodeVersion: process.version,
  isolated: true,
  physicalHardwareTested: false,
  liveAiProviderTested: false,
  actualPaymentsVerified: false,
  suites: paths,
  results: {
    tests: value('tests'), passed: value('pass'), failed: value('fail'),
    skipped: value('skipped'), cancelled: value('cancelled'),
    processExitCode: result.status,
  },
};
const folder = path.join(root, 'acceptance-results');
fs.mkdirSync(folder, { recursive: true });
const outFile = path.join(folder, 'phase8-latest.json');
fs.writeFileSync(outFile, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
const success = result.status === 0 && evidence.results.failed === 0 && evidence.results.tests === 5;
process.stdout.write(`\nPhase 8 acceptance evidence: ${path.relative(root, outFile)}\n`);
process.stdout.write(`Verdict: ${success ? 'PASS (isolated simulation only)' : 'FAIL / INCOMPLETE'}\n`);
if (!success) process.exitCode = 1;
