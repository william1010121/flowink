/** An input or layout error. Locations refer to the original Mermaid source. */
export class FlowInkError extends Error {
  /** @param {string} message @param {{code?:string,line?:number,column?:number,cause?:unknown}} [options] */
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = 'FlowInkError';
    this.code = options.code ?? 'FLOWINK_ERROR';
    this.line = options.line;
    this.column = options.column;
  }
}
