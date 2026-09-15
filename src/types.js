/** @typedef {'TB'|'BT'|'LR'|'RL'} Direction */
/** @typedef {'none'|'point'|'circle'|'cross'} Arrow */
/** @typedef {{id:string,label:string,labelType:string,shape:string,parentId?:string,styles:string[],classes:string[],metadata:Record<string,any>}} FlowNode */
/** @typedef {{id:string,source:string,target:string,label:string,labelType:string,arrowStart:Arrow,arrowEnd:Arrow,stroke:'normal'|'thick'|'dotted'|'invisible',length:number,styles:string[],classes:string[],animate?:boolean,animation?:string,curve?:string,interpolate?:string,isUserDefinedId?:boolean,metadata:Record<string,any>}} FlowEdge */
/** @typedef {{id:string,label:string,nodeIds:string[],parentId?:string,direction?:Direction,styles:string[],classes:string[],metadata:Record<string,any>}} FlowSubgraph */
/** @typedef {{source:string,direction:Direction,nodes:FlowNode[],edges:FlowEdge[],subgraphs:FlowSubgraph[],classes:Record<string,string[]>,metadata:Record<string,any>}} FlowGraph */
/** @typedef {{charset?:'ascii'|'unicode'}} RenderOptions */
/** @typedef {{x:number,y:number}} Point */
/** Integer character cells. Width/height include both border cells. Edge points land on box borders. */
/** @typedef {{id:string,kind:'node'|'subgraph',x:number,y:number,width:number,height:number,lines:string[],shape:string,parentId?:string}} LayoutBox */
/** @typedef {{id:string,points:Point[],arrowStart:Arrow,arrowEnd:Arrow,stroke:string,label?:{x:number,y:number,lines:string[],width:number,height:number}}} LayoutEdge */
/** @typedef {{boxes:LayoutBox[],edges:LayoutEdge[],width:number,height:number}} LayoutGraph */
export {};
