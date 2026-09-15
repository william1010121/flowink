import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, render } from '../src/index.js';
import { layout } from '../src/layout.js';
import { rasterize } from '../src/rasterize.js';

test('Transformer residual routes do not inflate every node and row', async () => {
  const source = await readFile(new URL('../demo/transformer.mmd', import.meta.url), 'utf8');
  const graph = parse(source);
  const result = await layout(graph);
  assert.equal(result.edges.length, 23);
  assert.equal(result.boxes.filter(box => box.kind === 'node').length, 19);
  assert.equal(result.boxes.filter(box => box.kind === 'subgraph').length, 2);
  for (const box of result.boxes.filter(box => box.kind === 'node')) {
    assert.ok(box.height <= box.lines.length + 3, `${box.id}: unnecessary vertical padding`);
  }
  for (const charset of ['ascii', 'unicode']) {
    const text = rasterize(result, { charset });
    assert.ok(text.split('\n').length <= 120, 'keep the diagram below half its original 241 rows');
    assert.ok(Math.max(...text.split('\n').map(line => line.length)) <= 65);
    assert.equal((text.match(/Residual/g) ?? []).length, 5);
    assert.match(text, /K, V/);
    assert.match(text, /Output Probabilities/);
    for (const box of result.boxes) for (const line of box.lines) assert.ok(text.includes(line), line);
  }
});

test('short vertical bidirectional edges retain both arrowheads', async () => {
  for (const direction of ['TB', 'BT']) {
    for (const arrow of ['<-->', 'o--o', 'x--x']) {
      const text = await render(`flowchart ${direction}\nA ${arrow} B`);
      if (arrow === '<-->') { assert.match(text, /\^/); assert.match(text, /v/); }
      else assert.equal((text.match(new RegExp(arrow[0], 'g')) ?? []).length, 2);
    }
  }
});
