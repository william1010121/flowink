import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {labelLines} from '../src/text.js';
import {render} from '../src/index.js';
if(!process.argv[2])throw Error('Usage: node scripts/benchmark-tab-expansion.js BASELINE_CHECKOUT');
const baseline=await import(pathToFileURL(resolve(process.argv[2],'src/text.js')));
const oldRender=(await import(pathToFileURL(resolve(process.argv[2],'src/index.js')))).render;
const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const results=[];
for(const [name,value,count] of [['plain','A normal label',1000],['unicode','中文 👩‍💻 é',1000],['long','normal text 中文 👩‍💻 é '.repeat(100),50],['tab-heavy','a\t中\t👩‍💻\té\t'.repeat(20),100]]){
 assert.deepEqual(labelLines(value),baseline.labelLines(value));
 const samples={baseline:[],candidate:[]};
 for(let r=0;r<9;r++)for(const mode of r%2?['candidate','baseline']:['baseline','candidate']){
  const fn=mode==='baseline'?baseline.labelLines:labelLines;const start=performance.now();
  for(let i=0;i<count;i++)fn(value);
  if(r>=2)samples[mode].push((performance.now()-start)/count);
 }
 results.push({name,kind:'labelLines',samples,medianMs:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,median(v)]))});
}
const source='flowchart LR\n A["開始 👩‍💻"] -->|確認| B["完成 é"]';
for(const charset of ['ascii','unicode'])assert.equal(await render(source,{charset}),await oldRender(source,{charset}));
const samples={baseline:[],candidate:[]};
for(let r=0;r<9;r++)for(const mode of r%2?['candidate','baseline']:['baseline','candidate']){
 const fn=mode==='baseline'?oldRender:render;const start=performance.now();
 for(let i=0;i<10;i++)await fn(source);
 if(r>=2)samples[mode].push((performance.now()-start)/10);
}
results.push({name:'two-node Unicode',kind:'render',samples,medianMs:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,median(v)]))});
console.log(JSON.stringify({node:process.version,results},null,2));
