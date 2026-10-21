import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parse, render } from '../src/index.js';
import { validateLayout } from '../src/rasterize.js';
import { maximum } from '../src/extrema.js';
if (!process.argv[2]) throw new Error('Usage: node scripts/benchmark-extrema.js BASELINE_CHECKOUT');
const baseline = await import(pathToFileURL(resolve(process.argv[2], 'src/index.js')));
const oldRaster = await import(pathToFileURL(resolve(process.argv[2], 'src/rasterize.js')));
const scalar = 'flowchart TB\n A@{label: |\n' + '  a\n'.repeat(100) + 'shape: rect\n}';
const graph = { width: 1, height: 1, boxes: [], edges: [{ id: 'e', points: [{ x: 0, y: 0 }], label: { x: 0, y: 0, lines: Array(100).fill('a') } }] };
const numbers = Array.from({ length: 10000 }, (_, i) => (i % 17) - 8);
const source = 'flowchart LR\n A["開始 👩‍💻"] -->|確認| B["完成 é"]';
const cases = [
  ['100-line scalar parse', 100, () => baseline.parse(scalar), () => parse(scalar)],
  ['100-line edge validation', 50, () => oldRaster.validateLayout(graph), () => validateLayout(graph)],
  ['10000-number maximum', 100, () => Math.max(0, ...numbers), () => maximum(numbers, 0)],
  ['two-node source render', 10, () => baseline.render(source), () => render(source)],
];
const results = [];
for (const [name, count, oldFn, newFn] of cases) {
  assert.deepEqual(await oldFn(), await newFn());
  const samples = { baseline: [], candidate: [] };
  for (let round = 0; round < 9; round++) {
    for (const mode of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const fn = mode === 'baseline' ? oldFn : newFn;
      const start = performance.now();
      for (let i = 0; i < count; i++) await fn();
      if (round >= 2) samples[mode].push((performance.now() - start) / count);
    }
  }
  const medians = Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, [...values].sort((a, b) => a - b)[3]]));
  results.push({ name, samples, medians });
}
console.log(JSON.stringify({ node: process.version, results }, null, 2));
