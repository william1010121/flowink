// Non-gating API benchmark. Run from repository root with no competing workloads.
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { parse, render, renderGraph } from '../src/index.js';
import { snapshotGraph } from '../src/graph.js';
const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const examples = {
  small: 'flowchart LR\nA[Start] --> B[Done]',
  decision: 'flowchart TB\nA --> B{Ready?}\nB -->|yes| C\nB -->|no| D',
  transformer: await readFile('demo/transformer.mmd', 'utf8'),
  chain100: `flowchart TB\n${Array.from({length:100},(_,i)=>`N${i} --> N${i+1}`).join('\n')}`,
  deepGroups: `flowchart TB\n${Array.from({length:15},(_,i)=>`subgraph G${i}`).join('\n')}\nA --> B\n${'end\n'.repeat(15)}`,
};
for (const [name, source] of Object.entries(examples)) {
  const graph = parse(source); // Reused input is the feature's intended use case.
  assert.equal(await renderGraph(graph), await render(source));
  const samples = [[], []];
  for (let i = 0; i < 20; i++) for (const which of i % 2 ? [1,0] : [0,1]) {
    const start = performance.now();
    await (which ? renderGraph(graph) : render(source));
    if (i >= 5) samples[which].push(performance.now() - start);
  }
  const preparation = [[], []];
  for (let i = 0; i < 20; i++) for (const which of i % 2 ? [1,0] : [0,1]) {
    const start = performance.now();
    for (let j = 0; j < 20; j++) which ? snapshotGraph(graph) : parse(source);
    if (i >= 5) preparation[which].push((performance.now() - start) / 20);
  }
  console.log(JSON.stringify({name,renderMs:median(samples[0]),renderGraphMs:median(samples[1]),parseMs:median(preparation[0]),snapshotMs:median(preparation[1])}));
}
