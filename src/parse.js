import { mergeMetadata } from './metadata.js';
import parser from './parser/generated.js';
import { FlowInkError } from './errors.js';
import { FlowSemanticDB, parserError } from './parser/semantic.js';
import { preprocess } from './parser/preprocess.js';
import { captureLexer } from './parser/lexer-capture.js';

const capturingLexer = captureLexer(parser.lexer);

/** @param {string} source @returns {import('./types.js').FlowGraph} */
export function parse(source) {
  if (typeof source !== 'string') throw new FlowInkError('Flowchart source must be a string', { code: 'INVALID_INPUT' });
  const db = new FlowSemanticDB(source);
  const processed = preprocess(source);
  const localParser = new parser.Parser();
  let workingLexer;
  localParser.lexer = capturingLexer;
  // Jison copies this callback into its invocation-local yy context before
  // initializing its fresh working lexer. It is not part of the public graph.
  db.captureLexer = lexer => { workingLexer = lexer; };
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
    mergeMetadata(graph.metadata, processed.metadata);
    return graph;
  } catch (error) {
    if (error instanceof FlowInkError) throw error;
    // Both Jison EOF (numeric 1) and the grammar EOF token lack a new
    // source token; lexical failures likewise keep their existing fallback.
    const tokenLocation = workingLexer?.yylloc && error?.hash?.loc && error.hash.token != null && error.hash.token !== 1 && error.hash.token !== 'EOF'
      ? { ...workingLexer?.yylloc }
      : undefined;
    const wrapped = parserError(error, source, tokenLocation);
    if (wrapped.line !== undefined) wrapped.line += processed.lineOffset;
    // The leading BOM occupies one UTF-16 code unit only on original line 1.
    // Keep EOF/lexical fallback locations unchanged.
    if (tokenLocation && processed.removedBOM && wrapped.line === 1 && wrapped.column !== undefined) wrapped.column += 1;
    throw wrapped;
  }
}

export default parse;
