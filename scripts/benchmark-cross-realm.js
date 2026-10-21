import { runInNewContext } from 'node:vm';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { parse } from '../src/index.js';
import { snapshotGraph } from '../src/graph.js';
if (!process.argv[2]) throw Error('Pass the baseline src/graph.js path');
const baseline = (await import(pathToFileURL(resolve(process.argv[2])).href)).snapshotGraph;
for (const count of [2, 100]) {
  const graph = parse('flowchart TB\n'+Array.from({length: count-1}, (_,i)=>`N${i}-->N${i+1}`).join('\n'));
  const foreign = runInNewContext(`JSON.parse(${JSON.stringify(JSON.stringify(graph))})`);
  assert.deepEqual(snapshotGraph(graph), baseline(graph));
  assert.deepEqual(snapshotGraph(foreign), baseline(graph));
  const variants = [() => baseline(graph), () => snapshotGraph(graph), () => snapshotGraph(foreign)];
  const samples = variants.map(() => []);
  for(let round=0;round<9;round++) for(let offset=0;offset<3;offset++) {
    const index=(round+offset)%3, start=performance.now();
    for(let i=0;i<500;i++) variants[index]();
    if(round>=2)samples[index].push((performance.now()-start)/500);
  }
  console.log(JSON.stringify({nodes:count,...Object.fromEntries(['baselineLocalMs','candidateLocalMs','candidateForeignMs'].map((key,i)=>[key,samples[i].sort((a,b)=>a-b)[3]]))}));
}
