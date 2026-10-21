import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeMetadata } from '../src/metadata.js';
import { parse } from '../src/parse.js';
import { render } from '../src/index.js';

test('metadata merges retain enumerable own keys as data without changing prototypes', () => {
  const symbol = Symbol('metadata');
  const nested = { value: 1 };
  const source = Object.create({ inherited: true });
  Object.defineProperties(source, {
    constructor: { value: 'constructor', enumerable: true },
    prototype: { value: 'prototype', enumerable: true },
    hidden: { value: true },
    [symbol]: { value: nested, enumerable: true },
  });
  // Object-literal __proto__ is syntax, so define the source key explicitly.
  Object.defineProperty(source, '__proto__', { value: nested, enumerable: true });
  const before = Object.getOwnPropertyDescriptors(source);
  const target = { retained: 1 };
  assert.equal(mergeMetadata(target, source), target);
  assert.equal(Object.getPrototypeOf(target), Object.prototype);
  assert.equal(Object.hasOwn(target, '__proto__'), true);
  assert.equal(target.__proto__, nested);
  assert.equal(target[symbol], nested);
  assert.equal(target.constructor, 'constructor');
  assert.equal(target.prototype, 'prototype');
  assert.equal(Object.hasOwn(target, 'inherited'), false);
  assert.equal(Object.hasOwn(target, 'hidden'), false);
  assert.deepEqual(Object.getOwnPropertyDescriptors(source), before);
  mergeMetadata(target, JSON.parse('{"__proto__":"updated"}'));
  assert.equal(target.__proto__, 'updated');
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, '__proto__'), {
    value: 'updated', enumerable: true, writable: true, configurable: true,
  });
});

test('parser preserves special metadata keys and repeated declarations', async () => {
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const source = 'flowchart TB\nA@{__proto__: first, constructor: ctor, prototype: proto, label: Visible}\nA@{__proto__: second}\nA --> B';
  const graph = parse(source);
  const node = graph.nodes.find(({ id }) => id === 'A');
  assert.equal(Object.getPrototypeOf(node.metadata), Object.prototype);
  assert.equal(Object.hasOwn(node.metadata, '__proto__'), true);
  assert.equal(node.metadata.__proto__, 'second');
  assert.equal(node.metadata.constructor, 'ctor');
  assert.equal(node.metadata.prototype, 'proto');
  assert.equal(node.label, 'Visible');
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
  const expected = await render('flowchart TB\nA[Visible] --> B');
  assert.equal(await render(source), expected);
  assert.equal(await render(source), expected);
});

test('parser retains nested special keys without using them as label or shape', () => {
  const source = 'flowchart TB\nA@{\nshape: rect\n__proto__:\n  label: changed\n  shape: circle\nnested:\n  __proto__: kept\nlabel: Original\n}';
  const node = parse(source).nodes[0];
  assert.equal(node.label, 'Original');
  assert.equal(node.shape, 'rect');
  assert.deepEqual(node.metadata.__proto__, { label: 'changed', shape: 'circle' });
  assert.equal(Object.hasOwn(node.metadata.nested, '__proto__'), true);
  assert.equal(node.metadata.nested.__proto__, 'kept');
  assert.equal(Object.getPrototypeOf(node.metadata), Object.prototype);
});

test('edge and subgraph metadata paths preserve own special keys', () => {
  for (const source of [
    'flowchart TB\nA e@--> B\ne@{__proto__: edge, constructor: ctor}',
    'flowchart TB\nsubgraph G\nA\nend\nG@{__proto__: group, constructor: ctor}',
    'flowchart TB\nG@{__proto__: group, constructor: ctor}\nsubgraph G\nA\nend',
  ]) {
    const graph = parse(source);
    const metadata = (graph.edges[0] ?? graph.subgraphs[0]).metadata;
    assert.equal(Object.hasOwn(metadata, '__proto__'), true);
    assert.equal(Object.getPrototypeOf(metadata), Object.prototype);
    assert.equal(metadata.constructor, 'ctor');
  }
});

test('merge reads enumerable values once, preserving shallow value and key order', () => {
  let reads = 0;
  const source = { first: 1, get value() { reads++; return { nested: true }; } };
  const target = { existing: 0 };
  mergeMetadata(target, source);
  assert.equal(reads, 1);
  assert.deepEqual(Object.keys(target), ['existing', 'first', 'value']);
  assert.equal(Object.getOwnPropertyDescriptor(target, 'value').get, undefined);
});

test('metadata keys do not invoke inherited setters or constructor coercion', () => {
  let calls = 0;
  const prototype = { set ordinary(value) { calls++; } };
  const target = Object.create(prototype);
  const constructor = { toString() { calls++; throw Error('must not coerce'); } };
  const source = { ordinary: 1, constructor };
  mergeMetadata(target, source);
  assert.equal(calls, 0);
  assert.equal(target.ordinary, 1);
  assert.equal(target.constructor, constructor);
  assert.equal(Object.getPrototypeOf(target), prototype);
  const failure = Error('source read failed');
  assert.throws(() => mergeMetadata({}, { get value() { throw failure; } }), error => error === failure);
  assert.equal(parse('flowchart TB\nA@{__proto__: afterFailure}').nodes[0].metadata.__proto__, 'afterFailure');
});
