import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyBrowser } from './verify-browser.js';

// Exercise the actual browser runner with broken synthetic pages, not mocked APIs.
const directory = await mkdtemp(join(tmpdir(), 'flowink-browser-'));
let offOriginHits = 0;
const offOrigin = createServer((request, response) => {
  offOriginHits++;
  response.writeHead(200, { 'Access-Control-Allow-Origin': '*' }).end('reachable');
});
try {
  await new Promise((resolve, reject) => {
    offOrigin.once('error', reject);
    offOrigin.listen(0, '127.0.0.1', resolve);
  });
  const passed = JSON.stringify({ status: 'passed', results: ['controls', 'branch', 'cycle', 'parallel', 'nested', 'CJK'].map(name => ({ name, passed: true })) });
  await cp('.cache/browser-smoke', directory, { recursive: true });
  const original = await readFile(join(directory, 'index.html'), 'utf8');
  const mutants = [
    ['output mismatch', original.replace('const results=[];', "expected[0].outputs[0] += 'wrong'; const results=[];"), /browser output differs/],
    ['missing module', original.replace("from './flowink.js'", "from './missing.js'"), /Browser reported errors/],
    ['page error', '<script>throw Error("intentional page error")</script><script>window.__flowinkSmoke={status:"passed",results:[]}</script>', /Browser reported errors/],
    ['console error', '<script>console.error("intentional console error");window.__flowinkSmoke={status:"passed",results:[]}</script>', /Browser reported errors/],
    ['HTTP resource failure', `<script type="module">await fetch('/missing.txt');window.__flowinkSmoke=${passed}</script>`, /HTTP 404:/],
    ['off-origin request', `<script type="module">await fetch('http://127.0.0.1:${offOrigin.address().port}/').catch(()=>{});window.__flowinkSmoke=${passed}</script>`, /Off-origin request:/],
    ['timeout', '<p>Never publishes completion</p>', /Browser completion timed out/],
    ['incomplete results', '<script>window.__flowinkSmoke={status:"passed",results:[]}</script>', /deep-equal/],
  ];
  for (const [name, html, pattern] of mutants) {
    await writeFile(join(directory, 'index.html'), html);
    await assert.rejects(verifyBrowser({ directory, timeout: 5_000 }), pattern, `${name} must fail`);
    if (name === 'off-origin request') assert.equal(offOriginHits, 0, 'Off-origin server must not receive a request');
    console.log(`Rejected mutant: ${name}`);
  }
  await writeFile(join(directory, 'index.html'), original);
  await verifyBrowser({ directory });
  console.log('Restored page passes Chromium verification.');
} finally {
  await new Promise(resolve => offOrigin.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
