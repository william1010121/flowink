import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as candidate from '../src/index.js';
if (!process.argv[2]) throw new Error('Usage: node scripts/benchmark-shape-yaml.js BASELINE_CHECKOUT');
const baseline = await import(pathToFileURL(resolve(process.argv[2], 'src/index.js')));
const cases = [
  ['inline metadata parse', 'parse', 1000, 'flowchart TB\n A@{shape: rect, label: Hello}'],
  ['multiline metadata parse', 'parse', 1000, 'flowchart TB\n A@{shape: rect\nlabel: |\n  one\n  two\n}'],
  ['100-line metadata parse', 'parse', 100, 'flowchart TB\n A@{shape: rect\nlabel: |\n' + '  one\n'.repeat(100) + '}'],
  ['metadata source render', 'render', 10, 'flowchart LR\n A@{shape: rect\nlabel: |\n  one\n  two\n} --> B'],
];
const results = [];
for (const [name, method, count, source] of cases) {
  assert.deepEqual(await baseline[method](source), await candidate[method](source));
  const samples = { baseline: [], candidate: [] };
  for (let round = 0; round < 9; round++) {
    for (const mode of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const api = mode === 'baseline' ? baseline : candidate;
      const start = performance.now();
      for (let i = 0; i < count; i++) await api[method](source);
      if (round >= 2) samples[mode].push((performance.now() - start) / count);
    }
  }
  const medians = Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, [...values].sort((a, b) => a - b)[3]]));
  results.push({ name, samples, medians });
}
console.log(JSON.stringify({ node: process.version, results }, null, 2));
