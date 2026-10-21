import { parse } from './parse.js';
import { layout } from './layout.js';
import { rasterize } from './rasterize.js';
import { FlowInkError } from './errors.js';
import { snapshotGraph } from './graph.js';
export { parse, FlowInkError };
/** @typedef {import('./types.js').FlowGraph} FlowGraph */
/** @typedef {import('./types.js').RenderOptions} RenderOptions */

/**
 * Render a Mermaid 12.0.0 flowchart as a plain text diagram.
 * @param {string} source Mermaid flowchart source.
 * @param {RenderOptions} [options]
 * @returns {Promise<string>}
 */
export async function render(source, options = {}) {
  const charset = renderCharset(options);
  return renderLayout(parse(source), charset);
}

/**
 * Render a parsed or JSON-deserialized FlowGraph without parsing its source.
 * Rendering data is snapshotted before asynchronous layout; input is not mutated.
 * @param {FlowGraph} graph
 * @param {RenderOptions} [options]
 * @returns {Promise<string>}
 */
export async function renderGraph(graph, options = {}) {
  const charset = renderCharset(options);
  return renderLayout(snapshotGraph(graph), charset);
}

function renderCharset(options) {
  if (!options || typeof options !== 'object') {
    throw new FlowInkError('Render options must be an object.', { code: 'INVALID_OPTIONS' });
  }
  const charset = options.charset ?? 'ascii';
  if (charset !== 'ascii' && charset !== 'unicode') {
    throw new FlowInkError('charset must be "ascii" or "unicode".', { code: 'INVALID_OPTIONS' });
  }
  return charset;
}

async function renderLayout(graph, charset) {
  try {
    return rasterize(await layout(graph), { charset });
  } catch (cause) {
    if (cause instanceof FlowInkError) throw cause;
    throw new FlowInkError(`Cannot lay out this flowchart: ${cause instanceof Error ? cause.message : String(cause)}`, { code: 'LAYOUT_ERROR', cause });
  }
}
