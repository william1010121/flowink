// Non-gating benchmark: medians, warmed runs, cloned inputs outside timers.
import { performance } from 'node:perf_hooks';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import * as current from '../src/spacing.js';
import * as legacy from '../test/helpers/legacy-spacing.js';
import { parse } from '../src/parse.js';
import { rasterize } from '../src/rasterize.js';

await mkdir('.cache', { recursive: true });
const oldLayoutSource = (await readFile('src/layout.js', 'utf8')).replace("from './spacing.js'", "from '../test/helpers/legacy-spacing.js'");
await build({ stdin: { contents: oldLayoutSource, resolveDir: `${process.cwd()}/src`, sourcefile: 'legacy-layout.js' }, outfile: '.cache/legacy-layout.mjs', bundle: true, packages: 'external', platform: 'node', format: 'esm' });
const { layout: oldLayout } = await import('../.cache/legacy-layout.mjs');
await build({ entryPoints: ['src/layout.js'], outfile: '.cache/current-layout.mjs', bundle: true, packages: 'external', platform: 'node', format: 'esm' });
const { layout } = await import('../.cache/current-layout.mjs');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function compare(name, before, after, input, count = 9) {
  const old = structuredClone(input); const next = structuredClone(input);
  const oldResult = await before(old); const nextResult = await after(next);
  assert.deepEqual(nextResult ?? next, oldResult ?? old, name);
  const samples = [[], []];
  for (let i = 0; i < count + 3; i++) {
    // Alternate order to reduce warm-up and shared-host scheduling bias.
    for (const index of i % 2 ? [1, 0] : [0, 1]) {
      const copy = structuredClone(input);
      const start = performance.now();
      await [before, after][index](copy);
      if (i >= 3) samples[index].push(performance.now() - start);
    }
  }
  const oldMs = median(samples[0]); const newMs = median(samples[1]);
  console.log(`${name}: ${oldMs.toFixed(3)} ms -> ${newMs.toFixed(3)} ms (${(oldMs / newMs).toFixed(2)}x)`);
}
for (const size of [20, 200, 2000]) {
  // Repeated parallel bus lanes, no overlap across neighbors: worst-case scan,
  // and long vertical channels typical of sparse layered diagrams.
  const input = { boxes: [], width: size * 3, height: size * 20 + 1, edges: Array.from({ length: size }, (_, i) => ({ id: `e${i}`, stroke: 'solid', arrowStart: 'none', arrowEnd: 'arrow', points: [{ x: i * 3, y: i * 20 }, { x: i * 3 + 2, y: i * 20 }, { x: i * 3 + 2, y: i * 20 + 18 }] })) };
  for (const operation of Object.keys(current)) await compare(`${operation}/${size} edges`, legacy[operation], current[operation], input);
}
const fractional = { boxes: [], width: 100, height: 5, edges: Array.from({ length: 20 }, (_, i) => ({
  id: `fraction${i}`, stroke: 'solid', points: [{ x: i * 3 + 0.25, y: i % 2 + 0.25 }, { x: i * 3 + 2.25, y: i % 2 + 0.25 }],
})) };
await compare('compactVerticalChannels/fractional rows (legacy fallback)', legacy.compactVerticalChannels, current.compactVerticalChannels,
  { boxes: [], edges: [{ id: 'fraction', arrowStart: 'none', arrowEnd: 'none', points: [{ x: 0, y: 0.3 }, { x: 0, y: 8.3 }] }], width: 1, height: 10.3 });
await compare('separateAdjacentRoutes/20 fractional edges (legacy fallback)', legacy.separateAdjacentRoutes, current.separateAdjacentRoutes, fractional);
const examples = {
  decision: 'flowchart TB\nA[Start] --> B{Ready?}\nB -->|yes| C[Ship]\nB -->|no| D[Wait]',
  transformer: await readFile('demo/transformer.mmd', 'utf8'),
  chain100: `flowchart TB\n${Array.from({ length: 100 }, (_, i) => `N${i} --> N${i + 1}`).join('\n')}`,
  deepGroups: `flowchart TB\n${Array.from({ length: 15 }, (_, i) => `subgraph G${i}`).join('\n')}\nA --> B\n${'end\n'.repeat(15)}`,
};
for (const [name, source] of Object.entries(examples)) {
  const graph = parse(source);
  await compare(`layout/${name}`, oldLayout, layout, graph, 15);
  const old = await oldLayout(graph); const next = await layout(graph);
  for (const charset of ['ascii', 'unicode']) assert.equal(rasterize(next, { charset }), rasterize(old, { charset }));
}
