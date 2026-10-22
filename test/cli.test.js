import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm, cp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { render, parse } from '../src/index.js';

const cli = resolve('dist/cli.js');
const source = 'flowchart LR\n A[你好] --> B[Done]';
function run(args = [], input = source, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8', timeout: 20000, ...options });
}
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'flowink-cli-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
test('CLI matches render exactly, defaults to ASCII, preserves BOM and CRLF', async () => {
  for (const input of [source, '\ufeff' + source.replaceAll('\n', '\r\n')]) {
    for (const args of [[], ['-'], ['--charset', 'ascii'], ['--charset=unicode', '-'], ['-', '--charset', 'unicode']]) {
      const result = run(args, input);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, await render(input, { charset: args.includes('unicode') || args.includes('--charset=unicode') ? 'unicode' : 'ascii' }) + '\n');
    }
  }
});
test('CLI reads files and -- treats leading dash as an operand', async () => fixture(async dir => {
  await writeFile(join(dir, '-diagram'), source);
  for (const args of [['--', '-diagram'], ['--charset=unicode', '--', '-diagram']]) {
    const result = run(args, '', { cwd: dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, await render(source, { charset: args[0].includes('unicode') ? 'unicode' : 'ascii' }) + '\n');
  }
}));
test('CLI rejects invalid grammar with usage status and no stdout', () => {
  for (const args of [['--charset'], ['--charset='], ['--charset', 'wide'], ['--charset=ascii', '--charset=ascii'], ['a', 'b'], ['--wat'], ['--help', '-'], ['--version', '--help'], ['-h', '--charset=ascii'], ['--', '--help', '-']]) {
    const result = run(args);
    assert.equal(result.status, 2, JSON.stringify(args) + result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /flowink:/);
  }
});
test('CLI help, version, and invalid usage require neither input nor renderer', async () => fixture(async dir => {
  await mkdir(join(dir, 'dist'));
  await cp(cli, join(dir, 'dist/cli.js'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ type: 'module', version: '7.8.9' }));
  for (const flag of ['--help', '-h', '--version', '-v', '--bad']) {
    const result = spawnSync(process.execPath, [join(dir, 'dist/cli.js'), flag], { encoding: 'utf8', timeout: 2000 });
    assert.equal(result.status, flag === '--bad' ? 2 : 0, result.stderr);
    if (flag === '-v' || flag === '--version') assert.equal(result.stdout, '7.8.9\n');
  }
}));
test('CLI fails for missing paths, directories, invalid UTF-8 and render errors', async () => fixture(async dir => {
  await writeFile(join(dir, 'invalid'), Buffer.from([0xc3, 0x28]));
  for (const args of [[join(dir, 'missing')], [dir], [join(dir, 'invalid')]]) {
    const result = run(args);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /flowink:/);
    assert.doesNotMatch(result.stderr, /\n\s+at /);
  }
  const malformed = run([], Buffer.from([0xff]));
  assert.equal(malformed.status, 1);
  assert.equal(malformed.stdout, '');
  assert.equal(run([], 'not a flowchart').status, 1);
}));
test('CLI escapes all unsafe diagnostic fields', () => {
  const result = run(['missing\x1b\x85\u202e\u2066\u2028\u2029']);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr.trimEnd(), /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\u2028\u2029]/u);
  assert.match(result.stderr, /\\u001b/);
  assert.match(result.stderr, /\\u202e/);
});
async function injected(dir, code, args = [], input = source) {
  const preload = join(dir, 'inject.mjs');
  await writeFile(preload, code);
  return spawnSync(process.execPath, ['--import', preload, cli, ...args], { input, encoding: 'utf8', timeout: 20000 });
}
test('CLI handles stdout EPIPE, other output errors and stderr failures', async () => fixture(async dir => {
  for (const args of [[], ['--help'], ['--version']]) {
    for (const code of ['EPIPE', 'EIO']) {
    const result = await injected(dir, `process.stdout.write = (chunk, callback) => { const e = Object.assign(new Error('output failed'), { code: '${code}' }); queueMicrotask(() => { callback(e); process.stdout.emit('error', e); }); return false; };`, args);
    assert.equal(result.status, code === 'EPIPE' ? 0 : 1, result.stderr);
    }
  }
  for (const code of ['EPIPE', 'EIO']) {
    const result = await injected(dir, `process.stdout.write = () => { throw Object.assign(new Error('synchronous output failed'), { code: '${code}' }); };`);
    assert.equal(result.status, code === 'EPIPE' ? 0 : 1, result.stderr);
  }
  const eventOnly = await injected(dir, `process.stdout.write = (chunk, callback) => { queueMicrotask(() => { process.stdout.emit('error', Object.assign(new Error('event output failed'), {code:'EIO'})); callback(); }); return false; };`);
  assert.equal(eventOnly.status, 1);
  const failed = await injected(dir, `process.stderr.write = () => { queueMicrotask(() => process.stderr.emit('error', new Error('stderr failed'))); return false; };`, ['--bad']);
  assert.equal(failed.status, 2);
  const prior = await injected(dir, `process.stderr.write = () => { queueMicrotask(() => process.stdout.emit('error', Object.assign(new Error('pipe'), { code: 'EPIPE' }))); return false; };`, ['--bad']);
  assert.equal(prior.status, 2);
}));
test('CLI rejects premature stdin close/error', async () => fixture(async dir => {
  for (const action of ["this.destroy()", "this.destroy(new Error('input failed'))", "this.destroy(Object.assign(new Error('input pipe failed'), {code: 'EPIPE'}))"]) {
    const result = await injected(dir, `process.stdin._read = function () { ${action}; };`);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
  }
}));
async function withChild(action) {
  const child = spawn(process.execPath, [cli], { stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  let timer;
  try {
    return await Promise.race([
      action(child, closed),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CLI subprocess timed out')), 10000); }),
    ]);
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
}
test('CLI leaves SIGINT handling native while waiting for stdin', { skip: process.platform === 'win32' }, async () => withChild(async (child, closed) => {
  await new Promise(resolve => setTimeout(resolve, 150));
  child.kill('SIGINT');
  assert.deepEqual(await closed, { code: null, signal: 'SIGINT' });
}));

test('CLI tolerates a real closed stdout pipe', async () => withChild(async (child, closed) => {
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.destroy();
  child.stdin.end(source);
  assert.deepEqual(await closed, { code: 0, signal: null }, stderr);
  assert.equal(stderr, '');
}));

test('CLI exposes structured original-source error code and location', () => {
  for (const source of ['\ufeffflowchart LR; A[ok)', '---\r\ntitle: example\r\n---\r\nflowchart LR; A[ok)', 'flowchart LR\n A[ok)\n']) {
    let expected;
    try { parse(source); } catch (error) { expected = error; }
    assert.ok(expected);
    const result = run([], source);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.startsWith(`flowink: [${expected.code} ${expected.line}:${expected.column}] `), result.stderr);
  }
});

// Reconstructed after the workspace rollback; preserve current label normalization.
test('CLI preserves normalized node, edge and group labels in both charsets', async () => {
  for (const input of ['flowchart LR\n A["before\u001bafter"]', 'flowchart LR\n A -->|"before&#7;after"| B', 'flowchart LR\n subgraph G["before\u0085after"]\n A\n end']) {
    for (const charset of ['ascii', 'unicode']) {
      const result = run(['--charset', charset], input);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(result.stdout, await render(input, { charset }) + '\n');
      assert.ok(result.stdout.includes('�'));
      assert.ok(![...result.stdout].some(c => { const n = c.charCodeAt(0); return (n < 32 && n !== 10) || (n >= 127 && n <= 159); }));
    }
  }
});
