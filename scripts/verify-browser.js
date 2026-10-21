import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

// Serve only generated smoke-test assets, on an ephemeral loopback port.
export async function verifyBrowser({ directory = '.cache/browser-smoke', timeout = 30_000 } = {}) {
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/flowink.js', ['flowink.js', 'text/javascript; charset=utf-8']],
    ['/flowink.js.map', ['flowink.js.map', 'application/json']],
  ]);
  const server = createServer(async (request, response) => {
    const asset = assets.get(request.url);
    if (!asset) { response.writeHead(404).end(); return; }
    try {
      const body = await readFile(resolve(directory, asset[0]));
      response.writeHead(200, { 'Content-Type': asset[1] }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    browser = await chromium.launch({ timeout: 30_000 });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(`Page error: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`Console error: ${message.text()}`);
    });
    page.on('requestfailed', request => errors.push(`Request failed: ${request.url()}`));
    page.on('response', response => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      errors.push(`Off-origin request: ${route.request().url()}`);
      return route.abort();
    });
    await page.goto(`${origin}/`, { timeout: 30_000, waitUntil: 'load' });
    try {
      await page.waitForFunction(() => window.__flowinkSmoke !== undefined, null, { timeout });
    } catch (error) {
      assert.equal(errors.length, 0, `Browser reported errors: ${errors.join('; ')}`);
      if (error.name === 'TimeoutError') throw new Error('Browser completion timed out', { cause: error });
      throw error;
    }
    const result = await page.evaluate(() => window.__flowinkSmoke);
    assert.equal(errors.length, 0, `Browser reported errors: ${errors.join('; ')}`);
    assert.equal(result.status, 'passed', result.error || 'Browser verification did not pass');
    assert.deepEqual(result.results.map(row => row.name), ['yaml-scalar', 'tab-label', 'grapheme-lines', 'branch', 'cycle', 'parallel', 'nested', 'CJK']);
    assert.ok(result.results.every(row => row.passed === true), 'Incomplete browser results');
    return result;
  } finally {
    try { await browser?.close(); }
    finally { await new Promise(resolve => server.close(resolve)); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyBrowser();
  console.log('Chromium: all eight fixtures match Node.js in ASCII and Unicode.');
}
