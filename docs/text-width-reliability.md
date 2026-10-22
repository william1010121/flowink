# Multiline display width reliability

`displayWidth` previously spread every line width into `Math.max`. On Node 24.19.0, a controlled 150,001-line input (`'x\n'.repeat(150_000) + '中文'`, approximately 300 KB) throws `RangeError: Maximum call stack size exceeded`. The failure is a JavaScript argument-count ceiling, not recursive graph layout.

The implementation now updates a running maximum in input order. It preserves normalization, string coercion, Unicode width handling, empty and trailing lines, and thrown coercion errors. It removes the mapped widths array and unbounded argument list; the split lines array remains. This is not a total input, output, memory, or render-time limit, and does not claim that huge diagrams are practical.

## Validation

- Baseline failure captured before changing production code.
- Three repeated large-text calls plus 150,001 empty lines.
- Empty/null/undefined, CRLF/CR, trailing newline, combining marks, emoji families, wide text, primitive coercion, and recovery after coercion failure.
- 1,000 seeded Unicode/ANSI/control multiline differentials against the original algorithm.
- Independent native review added 3,856 BMP/control/lone-surrogate equivalence cases.
- Full 551-test suite, build, types, clean package consumer, real Chromium parity, and all eight browser guard mutants pass on the independent main-based candidate.

## Benchmark methodology and limitations

Run `node scripts/benchmark-text-width.js`. It embeds the original implementation, checks equivalent outputs when the baseline succeeds, warms three times, alternates baseline/candidate order across seven rounds, and reports median milliseconds per call. Short cases use batches to reduce timer overhead. These are isolated helper timings, not end-to-end render benchmarks. Node 24.19.0, shared cloud machine; other coordinated builds/tests were paused during the run.

Observed baseline → candidate milliseconds:

- Short ASCII: 0.005364 → 0.004870.
- Short Unicode multiline: 0.011688 → 0.012142 (+3.9%).
- 1,001 Unicode lines: 5.551 → 5.109.
- 10,001 short lines: 43.366 → 54.573 (+25.8%).
- 150,001 short lines: baseline RangeError; candidate 788.235.

This batch fixes correctness and an allocation/argument-list hazard. It does not claim a throughput improvement: the measured 10,001-line workload regressed, and these single-environment timings are noisy. No unsupported performance claim should be inferred from removing one intermediate array.

A follow-up comparison rotated the original spread, running `Math.max`, and direct `if (currentWidth > width)` variants across 11 rounds (two warmup rounds, nine measured, median). For 10,001 lines it measured 47.751 / 35.644 / 54.825 ms respectively: the running-maximum regression reversed, while the proposed comparison variant was slower. Short ASCII measured 0.004512 / 0.004633 / 0.004411 ms; short Unicode 0.008880 / 0.010370 / 0.008592 ms. This variability is why the simpler, output-preserving running `Math.max` is retained without a throughput claim. These local experiments are not evidence of a stable speedup or regression across platforms.
