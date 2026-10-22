import test from 'node:test';
import assert from 'node:assert/strict';
import { FlowSemanticDB } from '../src/parser/semantic.js';
import { parse } from '../src/parse.js';

const largeCount = 150001;

test('semantic vertex style and class appends do not use argument-sized calls', () => {
  const db = new FlowSemanticDB('');
  const value = { unchanged: true };
  const styles = Array(largeCount).fill(value);
  const classes = Array(largeCount).fill('class');
  db.addVertex('A', undefined, undefined, styles, classes);
  const vertex = db.vertices.get('A');
  assert.equal(vertex.styles.length, largeCount);
  assert.equal(vertex.classes.length, largeCount);
  assert.equal(vertex.styles[largeCount - 1], value);
  assert.equal(styles.length, largeCount);
  assert.equal(classes.length, largeCount);
});

test('semantic synthetic group and class style transfers handle large arrays', () => {
  for (const kind of ['group', 'node', 'edge']) {
    const db = new FlowSemanticDB('');
    const styles = Array(largeCount).fill('x:y');
    let target;
    if (kind === 'group') {
      db.addVertex('G');
      db.vertices.get('G').styles = [...styles];
      db.vertices.get('G').classes = Array(largeCount).fill('c');
      db.addSubGraph({ text: 'G' }, [], { text: 'Group' });
      target = db.subGraphs[0];
      assert.equal(db.vertices.get('G').classes.length, largeCount);
    } else {
      db.addVertex('A'); db.addVertex('B');
      if (kind === 'node') target = db.vertices.get('A');
      else {
        db.addSingleLink('A', 'B', { type: 'arrow_point', stroke: 'normal', length: 1 });
        target = db.edges[0];
      }
      db.classes.set('many', styles);
      target.classes.push('many');
    }
    db.finalize();
    assert.equal(target.styles.length, largeCount);
    assert.equal(target.styles[largeCount - 1], 'x:y');
    assert.equal(styles.length, largeCount);
    if (kind === 'group') assert.equal(target.classes.length, largeCount);
  }
});

test('ordinary arrays preserve order, duplicates, holes and aliased-source length', () => {
  const value = {};
  const db = new FlowSemanticDB('');
  db.addVertex('A', undefined, undefined, [value, , value], ['x', 'x']);
  const vertex = db.vertices.get('A');
  assert.deepEqual(vertex.styles, [value, undefined, value]);
  db.addVertex('A', undefined, undefined, vertex.styles, vertex.classes);
  assert.deepEqual(vertex.styles, [value, undefined, value, value, undefined, value]);
  assert.deepEqual(vertex.classes, ['x', 'x', 'x', 'x']);
});

test('source class definitions keep order and duplicate styles across repeated parses', () => {
  const source = 'flowchart TB\nA --> B\nclassDef hot fill:red,stroke:blue,fill:red\nclass A hot';
  for (let index = 0; index < 3; index++) {
    const graph = parse(source);
    assert.deepEqual(graph.nodes[0].styles, ['fill:red', 'stroke:blue', 'fill:red']);
  }
});
