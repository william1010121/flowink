import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { parse, render, renderGraph } from '../src/index.js';
import { snapshotGraph } from '../src/graph.js';
const source = 'flowchart LR\nsubgraph Group\n__proto__[Start]-->constructor[Done]\nend';
const foreign = graph => runInNewContext(`JSON.parse(${JSON.stringify(JSON.stringify(graph))})`);
const invalid = { code: 'INVALID_GRAPH' };

test('foreign and mixed-realm records, arrays, metadata and group memberships preserve output', async () => {
  const graph = foreign(parse(source));
  assert.notEqual(Object.getPrototypeOf(graph), Object.prototype);
  assert.notEqual(Object.getPrototypeOf(graph.nodes), Array.prototype);
  const before = JSON.stringify(graph);
  for (const charset of ['ascii', 'unicode']) {
    const expected = await render(source, { charset });
    assert.equal(await renderGraph(graph, { charset }), expected);
    assert.equal(await renderGraph({ ...graph, nodes: [...graph.nodes] }, { charset }), expected);
  }
  assert.equal(JSON.stringify(graph), before);
  graph.nodes[0].metadata.label = runInNewContext("['First', ['Second']]");
  const pending = renderGraph(graph);
  graph.nodes[0].metadata.label[1][0] = 'Changed';
  assert.match(await pending, /Second/);
  assert.doesNotMatch(await pending, /Changed/);
});

test('foreign classes, subclasses, custom chains and forged constructors remain rejected', async () => {
  for (const expression of [
    'Object.assign(new (class Graph {})(), graph)',
    'Object.assign(Object.create({}), graph)',
    'Object.assign(Object.create(Object.create(null)), graph)',
    'Object.assign(Object.create({constructor:Object}), graph)',
    'Object.assign(Object.create({constructor:function Object(){}}), graph)',
    '({...graph,nodes:new (class Nodes extends Array {})(...graph.nodes)})',
    '({...graph,nodes:Object.setPrototypeOf([...graph.nodes],[])})',
    '({...graph,nodes:[,...graph.nodes]})',
    '({...graph,nodes:graph.nodes.map(n=>Object.assign(new (class Node {})(),n))})',
  ]) {
    const graph = foreign(parse(source));
    await assert.rejects(renderGraph(runInNewContext(expression, { graph })), invalid, expression);
  }
});

test('foreign prototype accessors and overridden function methods are never invoked', async () => {
  for (const expression of [
    `Object.assign(Object.create(Object.create(null,{constructor:{get(){calls++;throw Error('getter')}}})),graph)`,
    `(()=>{const Fake=function Object(){}; Fake.toString=()=>{calls++;throw Error('toString')}; return Object.assign(Object.create(Fake.prototype),graph)})()`,
    `(()=>{Object.defineProperty(graph.nodes[0],'label',{get(){calls++;throw Error('label')}});return graph})()`,
    `(()=>{Object.defineProperty(graph.nodes,'0',{get(){calls++;throw Error('index')}});return graph})()`,
  ]) {
    const context = { graph: foreign(parse(source)), calls: 0 };
    const graph = runInNewContext(expression, context);
    await assert.rejects(renderGraph(graph), invalid);
    assert.equal(context.calls, 0);
  }
  const graph = foreign(parse(source));
  delete graph.direction;
  await assert.rejects(renderGraph(graph), invalid); // never inherit required fields
});

test('foreign metadata retains cycle, depth and shared-DAG safeguards', async () => {
  const graph = foreign(parse(source));
  graph.nodes[0].metadata.label = runInNewContext('(()=>{const a=[];a.push(a);return a})()');
  await assert.rejects(renderGraph(graph), invalid);
  graph.nodes[0].metadata.label = runInNewContext('(()=>{let a="leaf";for(let i=0;i<257;i++)a=[a];return a})()');
  await assert.rejects(renderGraph(graph), invalid);
  const shared = runInNewContext('({leaf:"value"})');
  graph.nodes[0].metadata.label = runInNewContext('({left:shared,right:shared})', { shared });
  const snapshot = snapshotGraph(graph);
  assert.equal(snapshot.nodes[0].metadata.label.left, snapshot.nodes[0].metadata.label.right);
  assert.notEqual(snapshot.nodes[0].metadata.label.left, shared);
  graph.nodes[0].metadata.label = 'Recovered';
  const outputs = await Promise.all(Array.from({ length: 3 }, () => renderGraph(graph)));
  assert.ok(outputs.every(output => output === outputs[0]));
});

test('foreign intrinsic overrides are not invoked and altered constructor descriptors reject', async () => {
  const context = { source: JSON.stringify(parse(source)), calls: 0 };
  const graph = runInNewContext(`
    Function.prototype.toString = function(){ calls++; throw Error('foreign function method'); };
    Object.toString = Array.toString = function(){ calls++; throw Error('foreign constructor method'); };
    JSON.parse(source);
  `, context);
  assert.equal(await renderGraph(graph), await render(source));
  assert.equal(context.calls, 0);
  for (const statement of ['delete Object.prototype.constructor', 'delete Array.prototype.constructor', 'Object.prototype.constructor = function Object(){}', 'Object.prototype.constructor = null', 'Array.prototype.constructor = 42', "Object.defineProperty(Array.prototype, 'constructor', {get(){throw Error('must not call')}})"]) {
    const altered = runInNewContext(`const graph = JSON.parse(source); ${statement}; graph`, { source: JSON.stringify(parse(source)) });
    await assert.rejects(renderGraph(altered), invalid);
  }
});

test('foreign constructor descriptor flags must match standard intrinsic descriptors', async () => {
  for (const name of ['Object', 'Array']) {
    for (const [flag, value] of [['enumerable', true], ['writable', false], ['configurable', false]]) {
      const graph = runInNewContext(`
        const graph = JSON.parse(source);
        Object.defineProperty(${name}.prototype, 'constructor', {${flag}: ${value}});
        graph;
      `, { source: JSON.stringify(parse(source)) });
      await assert.rejects(renderGraph(graph), invalid, `${name}.${flag}`);
    }
  }
  assert.equal(await renderGraph(foreign(parse(source))), await render(source));
});
