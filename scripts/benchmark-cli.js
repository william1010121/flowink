// Bounded startup/resource smoke, not a throughput benchmark or speed claim.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const source = 'flowchart LR\n A[你好] --> B[Done]';
const cli = resolve('dist/cli.js');
const library = pathToFileURL(resolve('dist/index.js')).href;
const resource = 'data:text/javascript,' + encodeURIComponent("process.on('exit',()=>process.stderr.write('SMOKE_RSS_KIB='+process.resourceUsage().maxRSS+'\\n'));");
const cases = {
  help: [cli, '--help'],
  version: [cli, '--version'],
  cli: [cli, '--charset=unicode'],
  direct: ['--input-type=module', '--eval', `import {render} from ${JSON.stringify(library)}; process.stdout.write(await render(${JSON.stringify(source)}, {charset:'unicode'})+'\\n');`],
};
const samples = {};
const outputs = {};
for (let round = 0; round < 3; round++) {
  for (const [name, args] of Object.entries(cases)) {
    const start = performance.now();
    const result = spawnSync(process.execPath, ['--import', resource, ...args], { input: source, encoding: 'utf8', timeout: 5000 });
    const elapsedMs = performance.now() - start;
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /^SMOKE_RSS_KIB=\d+\n$/);
    (samples[name] ??= []).push({ elapsedMs: Math.round(elapsedMs * 100) / 100, maxRssKiB: Number(result.stderr.match(/\d+/)[0]) });
    outputs[name] = result.stdout;
  }
  assert.equal(outputs.cli, outputs.direct);
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, parity: true, note: 'Three fresh-process samples per case; small input only. No throughput, streaming, memory-bound, or speed claim.', samples }, null, 2));
