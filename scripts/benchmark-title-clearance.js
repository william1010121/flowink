import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { rasterize } from '../src/rasterize.js';
import { render } from '../src/index.js';
if (!process.argv[2]) throw new Error('Usage: node scripts/benchmark-title-clearance.js BASELINE_CHECKOUT');
const root = resolve(process.argv[2]);
const oldRasterize = (await import(pathToFileURL(`${root}/src/rasterize.js`))).rasterize;
const oldRender = (await import(pathToFileURL(`${root}/src/index.js`))).render;
const layout = width => ({ width, height: 7, boxes: [{ id: 'g', kind: 'subgraph', x: 0, y: 0, width, height: 7, lines: ['Title'], shape: 'rect' }], edges: [] });
const results = [];
async function compare(name, functions, count) {
  assert.equal(await functions[0](), await functions[1]());
  const samples = [[], []];
  for (let round = 0; round < 9; round++) for (let offset = 0; offset < 2; offset++) {
    const mode = (round + offset) % 2, start = performance.now();
    for (let i = 0; i < count; i++) await functions[mode]();
    if (round >= 2) samples[mode].push((performance.now() - start) / count);
  }
  const median = values => [...values].sort((a,b) => a-b)[3];
  results.push({ name, baselineMs: median(samples[0]), candidateMs: median(samples[1]), samples });
}
for (const width of [17, 80]) {
  const graph = layout(width);
  await compare(`unobstructed raster width${width}`, [() => oldRasterize(graph), () => rasterize(graph)], 100);
}
for (const [name, source] of [
  ['small source render', 'flowchart LR\n A --> B'],
  ['nested source render', 'flowchart TB\n subgraph Outer\n subgraph Inner\n A --> B\n end\n C\n end'],
]) await compare(name, [() => oldRender(source), () => render(source)], 5);
console.log(JSON.stringify({ node: process.version, results }, null, 2));
