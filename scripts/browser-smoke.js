import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const outdir = '.cache/browser-smoke';
await mkdir(outdir, { recursive: true });
await build({ entryPoints: ['dist/index.js'], outfile: `${outdir}/flowink.js`,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', sourcemap: true });
const cases = [
  ['crossingRepair', 'flowchart BT\n B --> A\n A --- A\n A --- A\n A --- A'],
  ['crossings', 'flowchart LR\n' + [1, 2, 3].flatMap(s => [1, 2, 3].map(t => `S${s} --> T${t}`)).join('\n')],
  ['shortSelfLoop', 'flowchart TB\n A --> A'],
  ['neighborSelfLoops', 'flowchart LR\n A --> A\n A --> A\n A ~~~ B'],
  ['title-clearance', "flowchart TB\nsubgraph G0[\"Outer\"]\nN0[\"Start\"]\nsubgraph G1[\"Inner\"]\nN1[\"Review\"]\nN2[\"\u7d42\u70b9\"]\nend\nend\nN3[\"\u51e6\u7406 \ud83d\udc08\"]\nN4[\"Alpha<br/>Beta\"]\nN0 --> N1\nN1 --> N2\nN2 --> N3\nN3 --> N4\nN4 --> N1\n"],
  ['metadata-keys', 'flowchart TB\nA@{__proto__: kept, constructor: ctor, prototype: proto, label: Visible} --> B'],
  ['yaml-scalar', 'flowchart TB\n A@{label: |\n  shape: rect\n  # literal text\n}'],
  ['tab-label', 'flowchart LR\n A["中\t👩‍💻\té"] --> B["plain label"]'],
  ['grapheme-lines', 'flowchart TB\n A["中文<br/>👩‍💻<br/>👨‍👩‍👧‍👦<br/>é<br/>a"]'],
  ['branch', 'flowchart LR\n A[Start] --> B{Ready?}\n B -->|yes| C[Work]\n B -->|no| D[Wait]'],
  ['cycle', 'flowchart TB\n A[Alpha] --> B[Beta] --> C[Gamma] --> A'],
  ['parallel', 'flowchart LR\n A -->|first| B\n A -->|second| B\n B -->|return| A'],
  ['nested', 'flowchart TB\n subgraph Outer\n subgraph Inner\n A --> B\n end\n C\n end\n B --> C\n C --> D'],
  ['CJK', 'flowchart LR\n A["開始 👩‍💻"] -->|確認| B["完成 é"]'],
];
const { render } = await import('../dist/index.js');
const expected = await Promise.all(cases.map(async ([name, source]) => ({
  name, outputs: await Promise.all(['ascii', 'unicode'].map(charset => render(source, { charset }))),
})));
await writeFile(`${outdir}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>FlowInk browser verification</title><link rel="icon" href="data:,">
<style>body{font:16px system-ui;margin:24px;background:#fafafa;color:#222}pre{font:14px/1.25 ui-monospace,monospace;white-space:pre;overflow:auto;padding:16px;background:white;border:1px solid #ddd}h2{font-size:16px}</style>
<h1>FlowInk browser verification</h1><p id="status">Running…</p><main></main><script type="module">
import {render,parse,renderGraph} from './flowink.js';
const cases = ${JSON.stringify(cases)};
const expected = ${JSON.stringify(expected)};
const results=[];
const frame=document.createElement('iframe');
frame.hidden=true;
document.body.append(frame);
const foreign=frame.contentWindow;
if(foreign.Object.prototype===Object.prototype)throw Error('iframe has no distinct realm');
try {
  const rejectGraph=async graph=>{try{await renderGraph(graph)}catch(error){if(error.code==='INVALID_GRAPH')return;throw error}throw Error('Invalid foreign graph accepted')};
  const base=foreign.JSON.parse(JSON.stringify(parse(cases[0][1])));
  const ForeignClass=foreign.eval('(class Graph {})');
  await rejectGraph(Object.assign(new ForeignClass(),base));
  const ForeignArray=foreign.eval('(class Nodes extends Array {})');
  await rejectGraph({...base,nodes:new ForeignArray(...base.nodes)});
  let getterCalls=0;
  const invalid=foreign.JSON.parse(JSON.stringify(base));
  foreign.Object.defineProperty(invalid.nodes[0],'label',{get(){getterCalls++;throw Error('getter called')}});
  await rejectGraph(invalid);
  if(getterCalls!==0)throw Error('Foreign getter executed');
  for(const [name,source] of cases){
    const outputs=await Promise.all(['ascii','unicode'].map(charset=>render(source,{charset})));
    if(!outputs.every(s=>typeof s==='string'&&s.length))throw Error(name+': empty output');
    if(JSON.stringify(outputs)!==JSON.stringify(expected.find(row=>row.name===name).outputs))throw Error(name+': browser output differs from Node.js');
    const repeat=await render(source);
    if(repeat!==outputs[0])throw Error(name+': unstable output');
    const graph=parse(source);
    const graphOutputs=await Promise.all(['ascii','unicode'].map(charset=>renderGraph(JSON.parse(JSON.stringify(graph)),{charset})));
    if(JSON.stringify(graphOutputs)!==JSON.stringify(outputs))throw Error(name+': renderGraph differs from render');
    const foreignGraph=foreign.JSON.parse(JSON.stringify(graph));
    const foreignOutputs=await Promise.all(['ascii','unicode'].map(charset=>renderGraph(foreignGraph,{charset})));
    if(JSON.stringify(foreignOutputs)!==JSON.stringify(outputs))throw Error(name+': foreign graph differs');
    if(await renderGraph({...foreignGraph,nodes:[...foreignGraph.nodes]})!==outputs[0])throw Error(name+': mixed realm differs');
    if(graph.source!==source)throw Error(name+': source lost');
    results.push({name,nodes:graph.nodes.length,edges:graph.edges.length,passed:true});
    for(let i=0;i<outputs.length;i++){
      const title=document.createElement('h2');title.textContent=name+' / '+['ASCII','Unicode'][i];
      const pre=document.createElement('pre');pre.textContent=outputs[i];document.querySelector('main').append(title,pre);
    }
  }
  const special=parse('flowchart TB\\nA@{__proto__: kept, constructor: ctor, prototype: proto}').nodes[0].metadata;
  if(!Object.hasOwn(special,'__proto__') || special.__proto__!=='kept' || Object.getPrototypeOf(special)!==Object.prototype)throw Error('Own metadata key lost');
  const kept=parse('flowchart TB\\n A@{label: |+\\n  one\\n\\n}').nodes[0].metadata;
  if(kept.label!=='one\\n\\n')throw Error('YAML keep chomping changed');
  const nested=parse('flowchart TB\\n A@{settings:\\n  color: blue\\nlabel: hi\\n}').nodes[0].metadata;
  if(nested.settings.color!=='blue' || Object.hasOwn(nested,'color'))throw Error('Nested YAML flattened');
  const largeShapeSource='flowchart TB\\n A@{label: |\\n'+'  a\\n'.repeat(150001)+'shape: rect\\n}';
  const largeShape=parse(largeShapeSource);
  if(largeShape.nodes.length!==1 || largeShape.nodes[0].metadata.label!=='a\\n'.repeat(150001))throw Error('Large YAML scalar failed');
  for(const [source,line,column] of [['flowchart LR\\n A[ok)\\n',2,6],['flowchart LR\\n A[中文🙂)\\n',2,8],['flowchart LR\\n  end\\n',2,3]]){
    let caught=false;try{parse(source)}catch(e){caught=true;if(e.line!==line||e.column!==column)throw Error('Wrong lookahead location');}
    if(!caught)throw Error('Invalid lookahead accepted');
  }
  for(const [source,line,column] of [[String.fromCharCode(0xfeff)+'flowchart LR; A[ok)',1,20],[String.fromCharCode(0xfeff)+'flowchart LR\\n A[ok)',2,6]]){
    let caught=false;try{parse(source)}catch(e){caught=true;if(e.line!==line||e.column!==column)throw Error('Wrong BOM location');}
    if(!caught)throw Error('Invalid BOM source accepted');
  }
  const unterminated='<a'.repeat(128);
  if(!(await render('flowchart LR\\n A["'+unterminated+'"]')).includes(unterminated))throw Error('Unterminated tag suffix lost');
  let located=false;try{parse('flowchart LR\\n A[')}catch(e){located=Number.isInteger(e.line)}
  if(!located)throw Error('Syntax error lacks position');
  window.__flowinkSmoke={status:'passed',results};
  document.querySelector('#status').textContent='All browser checks passed';
}catch(error){window.__flowinkSmoke={status:'failed',results,error:error.stack};document.querySelector('#status').textContent=error.stack;}
</script></html>`);
console.log(`Browser verification built in ${outdir}. Serve it locally and inspect window.__flowinkSmoke.`);
