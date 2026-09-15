import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';
import { layout } from '../src/layout.js';

const getBoxes = async source => new Map((await layout(parse(source))).boxes.map(box => [box.id, box]));
test('isolated subgraph uses its explicit local direction', async () => {
  const boxes = await getBoxes('flowchart TB\n subgraph G\n direction LR\n A --> B\n end');
  assert.ok(boxes.get('A').x < boxes.get('B').x);
  assert.equal(boxes.get('A').y, boxes.get('B').y);
});
test('edge to a subgraph itself preserves its local direction', async () => {
  const boxes = await getBoxes('flowchart TB\n subgraph G\n direction LR\n A --> B\n end\n G --> C');
  assert.ok(boxes.get('A').x < boxes.get('B').x);
  assert.equal(boxes.get('A').y, boxes.get('B').y);
});
test('external connection to a child makes its subgraph inherit parent direction', async () => {
  const source = 'flowchart TB\n subgraph G\n direction LR\n A --> B\n end\n B --> C';
  const graph = parse(source);
  assert.equal(graph.subgraphs.find(group => group.id === 'G').direction, 'LR', 'source direction is retained');
  const boxes = new Map((await layout(graph)).boxes.map(box => [box.id, box]));
  assert.ok(boxes.get('A').y < boxes.get('B').y);
});
