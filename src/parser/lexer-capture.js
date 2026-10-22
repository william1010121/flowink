/** Build one reusable adapter; each parse still creates its own working clone. */
export function captureLexer(base) {
  const adapter = Object.create(base);
  adapter.setInput = function (input, yy) {
    const result = base.setInput.call(this, input, yy);
    yy.captureLexer(this);
    return result;
  };
  return Object.freeze(adapter);
}
