import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, render, renderGraph } from '../src/index.js';
import { layout } from '../src/layout.js';

function arrowCells(edge) {
  const first = edge.points[0], last = edge.points.at(-1);
  const next = edge.points.find(p => p.x !== first.x || p.y !== first.y);
  const previous = [...edge.points].reverse().find(p => p.x !== last.x || p.y !== last.y);
  const step = (a,b) => `${a.x + Math.sign(b.x-a.x)},${a.y + Math.sign(b.y-a.y)}`;
  return [step(first,next), step(last,previous)];
}

test('ancestor bidirectional edges reserve distinct arrow cells in every direction', async () => {
  for (const direction of ['TB','BT','LR','RL']) for (const stroke of ['<-->', 'o--o', 'x--x']) {
    const source = `flowchart ${direction}\nsubgraph A\na\nend\na ${stroke} A`;
    const graph = parse(source), original = JSON.stringify(graph);
    const result = await layout(graph);
    const [start,end] = arrowCells(result.edges[0]);
    assert.notEqual(start,end, `${direction}/${stroke}`);
    assert.equal(JSON.stringify(graph),original);
    for (const charset of ['ascii','unicode']) {
      const output = await render(source,{charset});
      assert.equal(await renderGraph(JSON.parse(original),{charset}),output);
    }
  }
});

test('compound and alternate-arrow routes keep their arrow cells distinct', async () => {
  for (const direction of ['TB','BT','LR','RL']) {
    for (const source of [
      `flowchart ${direction}\nsubgraph A\nsubgraph B\nc\nend\nend\nA<-->B`,
      `flowchart ${direction}\nsubgraph A\na\nend\na o--o A\nA x--x a`,
    ]) {
      const result = await layout(parse(source));
      for (const edge of result.edges) assert.notEqual(...arrowCells(edge));
      for (const charset of ['ascii','unicode']) assert.ok((await render(source,{charset})).length > 0);
    }
  }
});

test('successful single-arrow, no-arrow and self-loop controls keep exact output', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const fixtures = JSON.parse(await readFile(new URL('./fixtures/arrowheads/baseline.json',import.meta.url),'utf8'));
  // Captured before this fix from b4494cc, not from the repaired renderer.
  for (const {source,...hashes} of fixtures) for (const charset of ['ascii','unicode']) {
    const output = await render(source,{charset});
    assert.equal(createHash('sha256').update(output).digest('hex'),hashes[charset]);
  }
});

test('bidirectional repair is repeatable and recovers after invalid input', async () => {
  const source = 'flowchart TB\nsubgraph A\na\nend\na<-->A';
  const expected = await render(source);
  await assert.rejects(render('flowchart TB\nA-->'),{code:'PARSE_ERROR'});
  assert.deepEqual(await Promise.all(Array.from({length:4},()=>render(source))),Array(4).fill(expected));
});
