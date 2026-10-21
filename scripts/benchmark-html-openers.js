import assert from 'node:assert/strict';
import { labelLines } from '../src/text.js';
import { labelLines as baseline } from '../test/fixtures/text/legacy-text.js';
const cases=[
 ['plain','A short label', 'text',1000],
 ['html','First<br/><b>Second</b>', 'text',1000],
 ['quoted','<span title="a > b">中文🙂</span>', 'text',1000],
 ['markdown','**Bold** and [link](https://example.test)', 'markdown',500],
 ['literal1000','<'.repeat(1000), 'text',5],
 ['literal4000','<'.repeat(4000), 'text',2],
 ['invalidClosing','</'.repeat(2000), 'text',2],
];
for(const[name,value,mode,iterations]of cases){
 assert.deepEqual(labelLines(value,mode),baseline(value,mode));
 const samples=[[],[]], funcs=[baseline,labelLines];
 for(let round=0;round<9;round++)for(let offset=0;offset<2;offset++){
  const i=(round+offset)%2,start=performance.now();
  for(let j=0;j<iterations;j++)funcs[i](value,mode);
  if(round>=2)samples[i].push((performance.now()-start)/iterations);
 }
 const median=a=>a.sort((a,b)=>a-b)[3];
 console.log(JSON.stringify({name,baselineMs:median(samples[0]),candidateMs:median(samples[1])}));
}

if(process.argv[2]) {
 const {pathToFileURL}=await import('node:url');
 const {resolve}=await import('node:path');
 const {render}=await import('../src/index.js');
 const {render:oldRender}=await import(pathToFileURL(resolve(process.argv[2])).href);
 for(const[name,source]of [['render-small','flowchart TB\nA-->B'],['render-literal2000','flowchart TB\nA["'+'<'.repeat(2000)+'"]']]) {
  assert.equal(await render(source),await oldRender(source));
  const samples=[[],[]],funcs=[oldRender,render];
  for(let round=0;round<9;round++)for(let offset=0;offset<2;offset++) {
   const i=(round+offset)%2,start=performance.now();await funcs[i](source);
   if(round>=2)samples[i].push(performance.now()-start);
  }
  console.log(JSON.stringify({name,baselineMs:samples[0].sort((a,b)=>a-b)[3],candidateMs:samples[1].sort((a,b)=>a-b)[3]}));
 }
}
