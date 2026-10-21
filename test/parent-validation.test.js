import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, render, renderGraph, FlowInkError } from '../src/index.js';

const source = 'flowchart TB\nsubgraph G[Group G]\nA\nend\nsubgraph H[Group H]\nB\nend\nsubgraph J[Group J]\nC\nend';
const orders = [['G', 'H', 'J'], ['G', 'J', 'H'], ['H', 'G', 'J'], ['H', 'J', 'G'], ['J', 'G', 'H'], ['J', 'H', 'G']];
function graphInOrder(order) {
  const graph = parse(source);
  const groups = new Map(graph.subgraphs.map(group => [group.id, group]));
  graph.subgraphs = order.map(id => groups.get(id));
  return { graph, groups };
}
const invalid = error => error instanceof FlowInkError && error.code === 'INVALID_GRAPH';

test('conflicting explicit and membership parents reject in every group order without mutation', async () => {
  for (const order of orders) {
    const { graph, groups } = graphInOrder(order);
    groups.get('G').nodeIds.push('H');
    groups.get('H').parentId = 'J';
    const before = JSON.stringify(graph);
    await assert.rejects(renderGraph(graph), error => invalid(error) && /conflicting subgraph parents/.test(error.message));
    assert.equal(JSON.stringify(graph), before);
  }
});

test('matching explicit and redundant membership parents retain output in every group order', async () => {
  for (const order of orders) {
    const { graph, groups } = graphInOrder(order);
    groups.get('H').parentId = 'G';
    for (const charset of ['ascii', 'unicode']) {
      const expected = await renderGraph(graph, { charset });
      groups.get('G').nodeIds.push('H', 'H');
      assert.equal(await renderGraph(graph, { charset }), expected);
      groups.get('G').nodeIds = groups.get('G').nodeIds.filter(id => id !== 'H');
    }
  }
});

test('missing parents, conflicting memberships and cycles remain invalid in every group order', async () => {
  for (const order of orders) for (const mode of ['missing', 'memberships', 'cycle']) {
    const { graph, groups } = graphInOrder(order);
    if (mode === 'missing') groups.get('H').parentId = 'absent';
    if (mode === 'memberships') {
      groups.get('G').nodeIds.push('H');
      groups.get('J').nodeIds.push('H');
    }
    if (mode === 'cycle') {
      groups.get('G').nodeIds.push('H');
      groups.get('G').parentId = 'H';
    }
    await assert.rejects(renderGraph(graph), invalid);
  }
});

test('rejected parent conflicts do not leak into concurrent valid source or graph renders', async () => {
  const { graph, groups } = graphInOrder(orders[0]);
  groups.get('G').nodeIds.push('H');
  groups.get('H').parentId = 'J';
  const input = 'flowchart TB\nsubgraph G[Outer]\nsubgraph H[Inner]\nA\nend\nend\nG --> B';
  const expected = await render(input);
  const results = await Promise.allSettled([renderGraph(graph), renderGraph(parse(input)), renderGraph(graph), render(input)]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled', 'rejected', 'fulfilled']);
  for (const index of [0, 2]) assert.ok(invalid(results[index].reason));
  for (const index of [1, 3]) assert.equal(results[index].value, expected);
  assert.equal(await renderGraph(parse(input)), expected);
});
