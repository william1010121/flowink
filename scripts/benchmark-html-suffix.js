import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { labelLines } from '../src/text.js';
import { render } from '../src/index.js';
if (!process.argv[2]) throw new Error('Usage: node scripts/benchmark-html-suffix.js BASELINE_CHECKOUT');
const root = resolve(process.argv[2]);
const baseline = await import(pathToFileURL(`${root}/src/text.js`));
const oldRender = (await import(pathToFileURL(`${root}/src/index.js`))).render;
const results = [];
const cases = [
  ['plain', 'A short 中文🙂 label', 'text', 1000],
  ['html', 'First<br/><b>Second</b>', 'text', 1000],
  ['quoted', '<span title="a > b">中文🙂</span>', 'text', 1000],
  ['markdown', '**Bold** and [link](https://example.test)', 'markdown', 500],
  ['unterminated1000', '<a'.repeat(500), 'text', 5],
  ['unterminated4000', '<a'.repeat(2000), 'text', 2],
  ['tag_then_suffix', '<b>text</b>' + '<a'.repeat(1000), 'text', 2],
  ['unclosed_comment', '<!--' + '<a'.repeat(1000), 'text', 10],
  ['remaining_quoted_terminator', '<a'.repeat(500) + '">', 'text', 5],
];
async function compare(name, functions, count) {
  assert.deepEqual(await functions[0](), await functions[1]());
  const samples = [[], []];
  for (let round = 0; round < 9; round++) for (let offset = 0; offset < 2; offset++) {
    const mode = (round + offset) % 2, start = performance.now();
    for (let i = 0; i < count; i++) await functions[mode]();
    if (round >= 2) samples[mode].push((performance.now() - start) / count);
  }
  const median = values => [...values].sort((a,b) => a-b)[3];
  results.push({ name, baselineMs: median(samples[0]), candidateMs: median(samples[1]), samples });
}
for (const [name, value, mode, count] of cases) {
  await compare(name, [() => baseline.labelLines(value, mode), () => labelLines(value, mode)], count);
}
for (const [name, source] of [['render_small', 'flowchart LR\n A --> B'], ['render_suffix', 'flowchart LR\n A["' + '<a'.repeat(128) + '"]']]) {
  await compare(name, [() => oldRender(source), () => render(source)], 5);
}
console.log(JSON.stringify({ node: process.version, results }, null, 2));
