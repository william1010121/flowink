// Internal numeric reductions: production callers supply already computed numbers.
// This is not a public replacement for variadic argument evaluation with side effects.
// Keep data-sized inputs out of function argument lists. The two-argument
// operations preserve Math.min/max behavior for NaN, infinities and signed zero.
export function minimum(values, initial = Infinity) {
  let result = initial;
  for (const value of values) result = Math.min(result, value);
  return result;
}

export function maximum(values, initial = -Infinity) {
  let result = initial;
  for (const value of values) result = Math.max(result, value);
  return result;
}
