# Route spacing performance

The spacing pass preserves the coordinates and rendered output from commit
`7bac01bce24013fc4c815a91d6916ea20645bb91` (FlowInk 0.1.1), but avoids two
size-dependent costs:

- Vertical compaction records removed **intervals** and their prefix counts,
  rather than allocating every empty row. Coordinate lookup uses binary search.
  Existing populated node rows and group title rows are still enumerated.
- Route separation buckets segments by orientation and fixed coordinate. Only
  neighboring lanes are swept, sorted by interval start. Keeping the two longest
  ends belonging to distinct edge IDs preserves the same-edge exclusion without
  comparing all segment pairs. Each segment participates in at most two sweeps.
  Gap coordinate lookup uses sorted arrays and binary search.

For S route segments, separation is O(S log S) rather than O(S²), plus coordinate
mapping. Compaction's empty-channel storage now depends on the number of fixed
row intervals rather than their total height. These are internal changes, not a
new public API, cache, or cancellation mechanism.

## Reproduce

After `npm ci`, run `npm run bench:spacing` from the repository root. The script
uses the frozen old spacing implementation in `test/helpers/legacy-spacing.js`.
It bundles baseline and current layout identically, checks exact geometry and
ASCII/Unicode parity, warms both variants, alternates timing order, excludes
input cloning from timers, and reports median milliseconds. It measures nine
samples per synthetic spacing case and fifteen per complete layout, after three
warm-ups. Timings are informational, never a flaky CI pass/fail threshold.

Example on Linux x64, Node 24.19.0, shared cloud runner:

| Workload | Before (ms) | After (ms) |
| --- | ---: | ---: |
| Compaction, 20 sparse edges | 0.267 | 0.021 |
| Separation, 20 sparse edges | 0.082 | 0.030 |
| Compaction, 200 sparse edges | 18.996 | 0.114 |
| Separation, 200 sparse edges | 3.694 | 0.087 |
| Compaction, 2,000 sparse edges | 1,027.172 | 1.237 |
| Separation, 2,000 sparse edges | 363.672 | 0.798 |
| Complete decision layout | 6.510 | 6.561 |
| Complete Transformer layout | 33.294 | 33.807 |
| Complete 100-edge chain layout | 42.590 | 40.286 |
| Complete 15-level nested layout | 13.548 | 12.600 |

The sparse fixtures deliberately stress empty channels and non-overlapping
lanes, not typical whole-render speed. Complete layouts are dominated by ELK
and shared-host noise: the decision and Transformer medians were respectively
0.8% and 1.5% slower in this run. Do not extrapolate the isolated speedups to all
renders. A prior non-alternating exploratory run was substantially noisier.

## Regression coverage

- 500 deterministic mixed graphs per transform, including a second pass over
  each already transformed graph, compared deeply with the frozen old algorithm.
- Empty inputs and recovery after failed calls; no per-call state is retained.
- Same-edge exclusion, reversed routes, invisible edges, point segments,
  endpoint-only touches, negative coordinates, and fractional discrete counts.
- A billion-row empty-channel case, without constructing the old huge array.
- Exact pre-change ASCII and Unicode snapshots for decision, Transformer,
  60-edge chain, 12-level nesting, and CJK/emoji/multiline labels.
- The existing empty-route error for parallel self-loops plus an invisible edge
  is preserved explicitly, not treated as a successful rendering or silently
  dropped edge. Parse failure followed by repeated/concurrent renders is tested.
