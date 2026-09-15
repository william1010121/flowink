import { parse } from './parse.js';
import { layout } from './layout.js';
import { rasterize } from './rasterize.js';
import { FlowInkError } from './errors.js';
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
  if (!options || typeof options !== 'object') {
    throw new FlowInkError('Render options must be an object.', { code: 'INVALID_OPTIONS' });
  }
  const charset = options.charset ?? 'ascii';
  if (charset !== 'ascii' && charset !== 'unicode') {
    throw new FlowInkError('charset must be "ascii" or "unicode".', { code: 'INVALID_OPTIONS' });
  }
  const graph = parse(source);
  try {
    return rasterize(await layout(graph), { charset });
  } catch (cause) {
    if (cause instanceof FlowInkError) throw cause;
    throw new FlowInkError(`Cannot lay out this flowchart: ${cause instanceof Error ? cause.message : String(cause)}`, { code: 'LAYOUT_ERROR', cause });
  }
}
