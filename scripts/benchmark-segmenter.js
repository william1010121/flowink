import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const baseline = process.argv[2];
if (!baseline) throw new Error('Usage: node scripts/benchmark-segmenter.js BASELINE_CHECKOUT');
const oldRaster = (await import(pathToFileURL(resolve(baseline, 'src/rasterize.js')))).rasterize;
const newRaster = (await import('../src/rasterize.js')).rasterize;
const oldRender = (await import(pathToFileURL(resolve(baseline, 'src/index.js')))).render;
const newRender = (await import('../src/index.js')).render;
const median = a => [...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const results = [];
for (const [name, lines] of [['small', ['Hello']], ['multiline', Array.from({length:100},(_,i)=>['中文','👩‍💻','é','narrow'][i%4])]]) {
  const graph = {width:12,height:lines.length+2,boxes:[{id:'a',kind:'node',shape:'rect',x:0,y:0,width:12,height:lines.length+2,lines}],edges:[]};
  assert.equal(oldRaster(graph),newRaster(graph));
  const samples={baseline:[],candidate:[]};
  for(let r=0;r<9;r++) for(const mode of r%2?['candidate','baseline']:['baseline','candidate']) {
    const fn=mode==='baseline'?oldRaster:newRaster;const start=performance.now();
    for(let i=0;i<100;i++)fn(graph);
    if(r>=2)samples[mode].push((performance.now()-start)/100);
  }
  results.push({name,kind:'rasterize',samples,medianMs:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,median(v)]))});
}
for(const [name,source] of [['small','flowchart LR\n A[Hello] --> B[World]'],['multiline','flowchart TB\n A["'+Array.from({length:30},(_,i)=>['中文','👩‍💻','é','narrow'][i%4]).join('<br/>')+'"]']]) {
  for(const charset of ['ascii','unicode']) assert.equal(await oldRender(source,{charset}),await newRender(source,{charset}));
  const samples={baseline:[],candidate:[]};
  for(let r=0;r<9;r++) for(const mode of r%2?['candidate','baseline']:['baseline','candidate']) {
    const fn=mode==='baseline'?oldRender:newRender;const start=performance.now();
    for(let i=0;i<10;i++)await fn(source);
    if(r>=2)samples[mode].push((performance.now()-start)/10);
  }
  results.push({name,kind:'render',samples,medianMs:Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,median(v)]))});
}
console.log(JSON.stringify({node:process.version,results},null,2));
