import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { FlowSemanticDB as CandidateDB } from '../src/parser/semantic.js';
import * as candidate from '../src/index.js';
if (!process.argv[2]) throw Error('Usage: node scripts/benchmark-semantic-appends.js BASELINE_CHECKOUT');
const root = resolve(process.argv[2]);
const { FlowSemanticDB: BaselineDB } = await import(pathToFileURL(resolve(root, 'src/parser/semantic.js')));
const baseline = await import(pathToFileURL(resolve(root, 'src/index.js')));
const source = 'flowchart LR\nA --> B\nclassDef hot fill:red,stroke:blue,fill:red\nclass A hot';
assert.deepEqual(candidate.parse(source), baseline.parse(source));
assert.equal(await candidate.render(source), await baseline.render(source));
const results = [];
for (const [name, count, size] of [['10-item append', 2000, 10], ['10000-item append', 50, 10000], ['class source parse', 1000, 0], ['class source render', 10, -1]]) {
  const values = Array(size > 0 ? size : 0).fill('x:y');
  const samples = { baseline: [], candidate: [] };
  for (let round = 0; round < 9; round++) {
    for (const mode of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const DB = mode === 'baseline' ? BaselineDB : CandidateDB;
      const api = mode === 'baseline' ? baseline : candidate;
      const start = performance.now();
      for (let i = 0; i < count; i++) {
        if (size > 0) { const db = new DB(''); db.addVertex('A', undefined, undefined, values); }
        else if (size === 0) api.parse(source);
        else await api.render(source);
      }
      if (round >= 2) samples[mode].push((performance.now() - start) / count);
    }
  }
  const medians = Object.fromEntries(Object.entries(samples).map(([mode, values]) => [mode, [...values].sort((a,b)=>a-b)[3]]));
  results.push({ name, count, samples, medians });
}
console.log(JSON.stringify({ node: process.version, results }, null, 2));
