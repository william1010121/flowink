import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, render } from '../src/index.js';

test('runs without a DOM and keeps interactions as serializable data', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  let invoked = false;
  globalThis.flowinkTestCallback = () => { invoked = true; };
  try {
    const source = 'flowchart LR\n A[Start] --> B[Done]\n click A flowinkTestCallback "Tip"';
    const graph = parse(source);
    assert.equal(JSON.parse(JSON.stringify(graph)).source, source);
    assert.match(await render(source), /Start/);
    assert.equal(invoked, false);
  } finally {
    delete globalThis.flowinkTestCallback;
  }
});
