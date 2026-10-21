import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { labelLines } from '../src/text.js';
if(!process.argv[2]) throw Error('Pass baseline src/text.js path');
const {labelLines:baseline}=await import(pathToFileURL(resolve(process.argv[2])).href);
for(const [name,value] of [['plain','A short ordinary label'],['unicode','中文🙂 é 👨‍👩‍👧‍👦'],['html','First<br><b>Second</b>'],['long','Text '.repeat(200)]]) {
 assert.deepEqual(labelLines(value),baseline(value));
 const iterations=name==='long'?10:500,samples=[[],[]],functions=[baseline,labelLines];
 for(let round=0;round<9;round++) for(let offset=0;offset<2;offset++) {
  const index=(round+offset)%2,start=performance.now();
  for(let i=0;i<iterations;i++)functions[index](value);
  if(round>=2)samples[index].push((performance.now()-start)/iterations);
 }
 console.log(JSON.stringify({name,baselineMs:samples[0].sort((a,b)=>a-b)[3],candidateMs:samples[1].sort((a,b)=>a-b)[3]}));
}
