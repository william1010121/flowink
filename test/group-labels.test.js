import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, render } from '../src/index.js';

test('retains Markdown type for subgraph titles and renders their plain text', async () => {
  const source = 'flowchart TB\n subgraph g["`**Title**`"]\n A\n end';
  const group = parse(source).subgraphs[0];
  assert.equal(group.label, '**Title**');
  assert.equal(group.metadata.labelType, 'markdown');
  const output = await render(source);
  assert.match(output, /Title/);
  assert.doesNotMatch(output, /\*\*/);
});
test('plain group titles retain literal Markdown punctuation', async () => {
  const output = await render('flowchart TB\n subgraph g["**Title**"]\n A\n end');
  assert.match(output, /\*\*Title\*\*/);
});
