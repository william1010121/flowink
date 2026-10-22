import test from 'node:test';
import assert from 'node:assert/strict';
import { FlowInkError } from '../src/errors.js';
import { parse } from '../src/parse.js';

test('error locations remain absent or numeric according to construction', () => {
  const absent = new FlowInkError('No source location');
  assert.equal(absent.line, undefined);
  assert.equal(absent.column, undefined);
  assert.equal(absent.code, 'FLOWINK_ERROR');
  const located = new FlowInkError('Located', { line: 2, column: 3 });
  assert.equal(located.line, 2);
  assert.equal(located.column, 3);
  const partial = new FlowInkError('Line only', { line: 4 });
  assert.equal(partial.line, 4);
  assert.equal(partial.column, undefined);
});

test('actual parser input errors may have no source location', () => {
  assert.throws(() => parse(null), error => {
    assert.ok(error instanceof FlowInkError);
    assert.equal(error.code, 'INVALID_INPUT');
    assert.equal(error.line, undefined);
    assert.equal(error.column, undefined);
    return true;
  });
});
