import parser from './parser/generated.js';
import { FlowInkError } from './errors.js';
import { FlowSemanticDB, parserError } from './parser/semantic.js';
import { preprocess } from './parser/preprocess.js';

/** @param {string} source @returns {import('./types.js').FlowGraph} */
export function parse(source) {
  if (typeof source !== 'string') throw new FlowInkError('Flowchart source must be a string', { code: 'INVALID_INPUT' });
  const db = new FlowSemanticDB(source);
  const processed = preprocess(source);
  const localParser = new parser.Parser();
  try {
    localParser.yy = db;
    // Mermaid's flow parser accepts shape blocks only when the closing brace
    // is immediately followed by a statement separator.
    localParser.parse(`${processed.text.replace(/}[^\S\n]*(?=\n|$)/g, '}')}\n`);
    const graph = db.finalize();
    // Mermaid's parser canonicalises HTML attribute quoting in labels.
    const canonicaliseLabel = (value) => String(value).replace(/(<[^>]+?)='([^']*)'/g, '$1="$2"');
    for (const node of graph.nodes) node.label = canonicaliseLabel(node.label);
    for (const edge of graph.edges) edge.label = canonicaliseLabel(edge.label);
    Object.assign(graph.metadata, processed.metadata);
    return graph;
  } catch (error) {
    if (error instanceof FlowInkError) throw error;
    const wrapped = parserError(error, source);
    if (wrapped.line !== undefined) wrapped.line += processed.lineOffset;
    throw wrapped;
  }
}

export default parse;
