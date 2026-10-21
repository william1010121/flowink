import { parse, render, renderGraph, FlowInkError, type FlowGraph } from 'flowink';

const graph: FlowGraph = parse('flowchart LR\n A --> B');
const ids: string[] = graph.nodes.map(node => node.id);
const output: Promise<string> = render(graph.source, { charset: 'unicode' });
const ascii: Promise<string> = render(graph.source);
const error: Error = new FlowInkError('Invalid diagram', { code: 'PARSE_ERROR', line: 2, column: 3 });
void [ids, output, ascii, error];
// @ts-expect-error Drawing charset is a finite set.
render(graph.source, { charset: 'svg' });
// @ts-expect-error Parser accepts Mermaid source, not a graph object.
parse(graph);

const edited: Promise<string> = renderGraph(graph, { charset: 'unicode' });
void edited;
// @ts-expect-error Graph rendering accepts graphs, not Mermaid strings.
renderGraph(graph.source);
// @ts-expect-error Graph rendering has the same finite charset choices.
renderGraph(graph, { charset: 'svg' });
