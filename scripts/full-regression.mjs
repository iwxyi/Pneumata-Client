import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log(`Full regression runner.\n\nUsage:\n  npm run test:full\n  npm run test:full -- --cloud\n  npm run test:full -- --browser\n  npm run test:full -- --llm\n  npm run test:full -- --all\n\nDefault stages never require a browser, account, cloud service, or paid model.`);
  process.exit(0);
}
const includeBrowser = args.has('--browser') || args.has('--all');
const includeLlm = args.has('--llm') || args.has('--all');
const includeCloud = args.has('--cloud') || args.has('--all');
const clientRoot = resolve(process.cwd());
const repoRoot = resolve(clientRoot, '..');

function run(label, command, commandArgs, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const startedAt = Date.now();
    console.log(`[full-test] START ${label}`);
    const child = spawn(command, commandArgs, {
      cwd: options.cwd || repoRoot,
      stdio: 'inherit',
      env: { ...process.env, ...(options.env || {}) },
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      const result = { label, ok: code === 0, code, signal, durationMs: Date.now() - startedAt };
      console.log(`[full-test] ${result.ok ? 'PASS' : 'FAIL'} ${label} (${result.durationMs}ms)`);
      resolvePromise(result);
    });
  });
}

async function main() {
  const results = [];
  results.push(await run('client typecheck', 'npm', ['run', 'typecheck', '--workspace=Pneumata-Client']));
  results.push(await run('client unit tests', 'npm', ['run', 'test', '--workspace=Pneumata-Client']));
  results.push(await run('client production bundle', 'npm', ['run', 'build:bundle', '--workspace=Pneumata-Client']));
  results.push(await run('server tests', 'npm', ['run', 'test', '--workspace=Pneumata-Server']));
  results.push(await run('server build', 'npm', ['run', 'build', '--workspace=Pneumata-Server']));

  if (includeCloud) {
    results.push(await run('cloud sync regression', 'npm', ['run', 'test:cloud-sync', '--workspace=Pneumata-Client']));
  }
  if (includeBrowser) {
    results.push(await run('message branching browser smoke', 'npm', ['run', 'test:message-branching-browser-smoke', '--workspace=Pneumata-Client']));
    results.push(await run('story browser smoke', 'npm', ['run', 'test:story-browser-smoke', '--workspace=Pneumata-Client']));
  }
  if (includeLlm) {
    results.push(await run('real LLM acceptance', 'npm', ['run', 'test:ai-llm-acceptance', '--workspace=Pneumata-Client', '--', '--run']));
  }

  const payload = {
    ok: results.every((result) => result.ok),
    stages: results,
    optional: { browser: includeBrowser, cloud: includeCloud, llm: includeLlm },
  };
  console.log(JSON.stringify(payload, null, 2));
  if (!payload.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[full-test] fatal: ${error?.stack || error}`);
  process.exitCode = 1;
});
