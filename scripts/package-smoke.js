import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed:\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
const root = resolve('.');
const outdir = join(root, '.cache');
await mkdir(outdir, { recursive: true });
const preview = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--dry-run', '--json'], root))[0];
const paths = new Set(preview.files.map(file => file.path));
for (const path of ['dist/index.js', 'dist/index.d.ts', 'dist/types.d.ts', 'vendor/mermaid/flow.jison', 'vendor/mermaid/LICENSE', 'LICENSE', 'NOTICE.md', 'README.md']) {
  if (!paths.has(path)) throw new Error(`Package is missing ${path}`);
}
if ([...paths].some(path => path.startsWith('test/') || path.startsWith('node_modules/'))) throw new Error('Package includes development files');
const pack = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', outdir], root))[0];
const archive = join(outdir, pack.filename);
const consumer = await mkdtemp(join(tmpdir(), 'flowink-consumer-'));
try {
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ type: 'module', private: true }));
  run('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund', archive], consumer);
  await writeFile(join(consumer, 'check.mjs'), `import assert from 'node:assert/strict';
import {parse,render,renderGraph} from 'flowink';
const source='flowchart LR\\n A[Start] --> B[Done]';
assert.equal(parse(source).nodes.length,2);
assert.match(await render(source),/Start/);
assert.match(await render(source,{charset:'unicode'}),/Done/);
const graph=JSON.parse(JSON.stringify(parse(source)));
assert.equal(await renderGraph(graph),await render(source));
graph.nodes[0].label='Changed';
assert.match(await renderGraph(graph),/Changed/);
const controlled='flowchart LR\\nA["A&#27;B"]-->|"E&#7;"|B';
const controlledOutput=await render(controlled);
assert.ok(controlledOutput.includes('�'));
assert.ok(![...controlledOutput].some(character=>{const code=character.charCodeAt(0);return(code<32&&code!==10)||(code>=127&&code<=159)}));
assert.equal(await renderGraph(JSON.parse(JSON.stringify(parse(controlled)))),controlledOutput);
assert.equal(typeof globalThis.document,'undefined');
assert.throws(()=>parse(String.fromCharCode(0xfeff)+'flowchart LR; A[ok)'),e=>e.code==='PARSE_ERROR'&&e.line===1&&e.column===20);
assert.throws(()=>parse('flowchart LR\\n A[ok)\\n'),e=>e.code==='PARSE_ERROR'&&e.line===2&&e.column===6);
console.log('Clean package consumer passed');
`);
  process.stdout.write(run(process.execPath, ['check.mjs'], consumer));
  await writeFile(join(consumer, 'error-types.mts'), `import {FlowInkError} from 'flowink';
const error = new FlowInkError('unlocated');
// @ts-expect-error Locations can be absent at runtime.
const unsafeLine: number = error.line;
// @ts-expect-error Locations can be absent at runtime.
const unsafeColumn: number = error.column;
const line: number | undefined = error.line;
const column: number | undefined = error.column;
if (error.line !== undefined) error.line.toFixed();
if (error.column !== undefined) error.column.toFixed();
void [line, column, unsafeLine, unsafeColumn];
`);
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--noEmit', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'error-types.mts'], consumer);
  const report = { filename: pack.filename, size: pack.size, unpackedSize: pack.unpackedSize, fileCount: pack.files.length, cleanConsumer: 'passed' };
  await writeFile(join(outdir, 'package-verification.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await rm(consumer, { recursive: true, force: true });
}
