# Route spacing performance

The original spacing helpers from commit
`7bac01bce24013fc4c815a91d6916ea20645bb91` are unchanged in current main
`23fee6a27dbea4870a5be091e98995f27e697e34`. This revision compares the optimization
against that current baseline, avoiding two size-dependent costs:

- Vertical compaction of normalized integer rows records removed **intervals** and their prefix counts,
  rather than allocating every empty row. Coordinate lookup uses binary search.
  Existing populated node rows and group title rows are still enumerated.
- Route separation buckets segments by orientation and fixed coordinate. Only
  neighboring lanes are swept, sorted by interval start. Keeping the two longest
  ends belonging to distinct edge IDs preserves the same-edge exclusion without
  comparing all segment pairs. Each segment participates in at most two sweeps.
  Gap coordinate lookup uses sorted arrays and binary search.

For S route segments with safe-integer point coordinates, separation is
O(S log S) rather than O(S²), plus coordinate mapping. Other route coordinates
use the unchanged quadratic legacy separation implementation. Compaction's
empty-channel storage now depends on the number of fixed row intervals rather
than their total height. Outside the checked compaction domain, the exact legacy
per-row routine is retained. These are internal changes, not a
new public API, cache, or cancellation mechanism.

## Reproduce

After `npm ci`, run `npm run bench:spacing` from the repository root. The script
uses the frozen old spacing implementation in `test/helpers/legacy-spacing.js`.
It bundles baseline and current layout identically, checks exact geometry and
ASCII/Unicode parity, warms both variants, alternates timing order, excludes
input cloning from timers, and reports median milliseconds. It measures nine
samples per synthetic spacing case and fifteen per complete layout, after three
warm-ups. Timings are informational, never a flaky CI pass/fail threshold.

## Historical measurements

The following original measurements used the early baseline, not current main.
They are retained as history rather than a current speed claim. Linux x64,
Node 24.19.0, shared cloud runner:

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
  endpoint-only touches, negative coordinates, and fractional discrete counts preserved by the legacy fallback.
- A billion-row empty-channel case, without constructing the old huge array.
- Exact current-main ASCII and Unicode snapshots for decision, Transformer,
  60-edge chain, 12-level nesting, and CJK/emoji/multiline labels.
- Parallel self-loops plus an invisible edge now render successfully on current
  main due to independently merged routing fixes; the refreshed snapshot records
  that baseline instead of requiring the obsolete early error. Parse failure
  followed by repeated/concurrent renders is tested.


## Current-main integration and numeric boundary

Only the spacing optimization is integrated with main `23fee6a`; the pending terminal-control change and unpublished CLI are excluded. The legacy helper function bodies match that main exactly, apart from export declarations and reference-file whitespace. Current-main snapshots were generated before changing its spacing calls, not copied from the optimized implementation.

A bounded internal probe found a floating-point mismatch in the original optimized neighbor lookup: lanes at `1.0000000000000002` and `2` have subtraction-based distance `0.9999999999999998`, while adding one to the first coordinate rounds to `2`. The original legacy predicate therefore leaves them alone, while the initial lookup incorrectly added a gap. This is not a reproduced public-render defect: layout operates on integer cells. The final implementation conservatively uses the exact legacy separation routine whenever any route point coordinate is not a safe integer. Tests also cover cancellation around negative one, fractional interval endpoints, unsafe large integers, safe-integer limits and ordinary integer calls after fallback. The new regression fails before this guard and passes afterward. No floating-point equivalence beyond the justified integer fast path is assumed.

Eleven focused tests include 500 ordinary seeded graphs per operation, repeated passes, another 500 fractional/repeated-ID graphs per operation, explicit boundaries, failure recovery and the existing large empty-channel case. The finite fractional fallback can be slower; this is a correctness tradeoff, not an optimized fractional-layout promise.

The first current-main candidate with only the separation guard was measured as follows. This run is superseded by the both-guard candidate below; it is retained transparently rather than used as final evidence:

| Workload | Before (ms) | After (ms) |
| --- | ---: | ---: |
| Compaction, 20 sparse edges | 0.275 | 0.026 |
| Separation, 20 sparse edges | 0.085 | 0.059 |
| Compaction, 200 sparse edges | 18.437 | 0.109 |
| Separation, 200 sparse edges | 3.577 | 0.100 |
| Compaction, 2,000 sparse edges | 855.403 | 1.213 |
| Separation, 2,000 sparse edges | 363.236 | 1.119 |
| Separation, 20 fractional edges, legacy fallback | 0.031 | 0.052 |
| Complete decision layout | 6.982 | 6.554 |
| Complete Transformer layout | 34.335 | 32.822 |
| Complete 100-edge chain layout | 43.068 | 42.539 |
| Complete 15-level nested layout | 11.899 | 11.903 |

The fallback sample was about 21µs slower and the deep-layout median about 4µs slower. Small samples are noisy. The earlier current-main run before the numeric guard measured decision 7.734/7.575ms, Transformer 33.949/36.222ms, chain 44.989/42.196ms and deep groups 13.243/12.529ms. Its Transformer regression did not reproduce in the final run; both observations are disclosed, not selectively treated as a uniform whole-layout win. The strong sparse-geometry improvements do not imply comparable total-render improvements or a universal speedup.

Fresh exact-head Code, the explicitly requested Security review, and complete CI remain required gates. Missing Security status is not a pass.

Fresh local validation on 2026-10-22: 659/659 tests on both Node 24.19.0 and minimum 22.12.0; build, emitted types, offline-cache packed-consumer checks, Chromium 17 fixtures in both charsets, and eight browser-runner negative guards all pass. The packed-consumer check is not a fresh online install. The bounded mixed corpus contains 200 executions of 149 unique sources: all 400 charset outputs are byte-identical. The upstream corpus contains 435 sources: 864 outputs and six existing errors are unchanged, with no new failures or changed errors. These are measured corpora, not a proof over every possible input.


### Final compaction domain and both-guard measurements

A second finite internal counterexample uses one vertical route from y=0.3 to y=8.3 and graph height 10.3. The legacy loop visits six removed rows, while the original prefix `ceil` calculation counted seven. Legacy therefore produces endpoint 2.3000000000000007 and height 4.300000000000001. That exact case now has a red-before/green-after regression. It is not a demonstrated public-render bug.

Compaction now requires nonnegative safe integers for every relevant vertical input: graph height; box y and height, their sum, bottom row and subgraph header loop limit; every route point y; and any edge-label y. Outside that domain it calls the unchanged legacy routine. Nonnegative integer rows keep prefix totals bounded by the row span and the number of removed rows below a mapped value no greater than that value, so all mapped subtractions stay exact. No floating epsilon or alternate numeric interpretation is introduced. Negative/fractional and other out-of-domain input retains legacy arithmetic, allocation and resource limitations, not a broader large-number guarantee.

The caller is explicit: `fromElkGraph` floors ELK box origins and computes inclusive integer extents; `routePoints` invokes `orthogonalRound`, and grid-repair/self-loop paths use cell coordinates. Before either spacing pass, `fromElkGraph` computes minima across **both boxes and route points**, translates both (and labels) by those minima, and derives width/height from the resulting geometry. Labels use integer cell placement. These normal caller paths motivate the fast domain; the runtime checks still validate actual inputs rather than assuming all public or internal data must satisfy it.

Final measured medians including **both** numeric guards, same current baseline, Node 24.19.0/Linux x64 and the methodology above:

| Workload | Before (ms) | After (ms) |
| --- | ---: | ---: |
| Compaction, 20 sparse edges | 0.276 | 0.038 |
| Separation, 20 sparse edges | 0.139 | 0.041 |
| Compaction, 200 sparse edges | 18.288 | 0.130 |
| Separation, 200 sparse edges | 3.639 | 0.103 |
| Compaction, 2,000 sparse edges | 837.639 | 1.372 |
| Separation, 2,000 sparse edges | 366.653 | 0.944 |
| Compaction, fractional rows, legacy fallback | 0.002 | 0.003 |
| Separation, 20 fractional edges, legacy fallback | 0.033 | 0.051 |
| Complete decision layout | 6.547 | 6.556 |
| Complete Transformer layout | 31.296 | 31.908 |
| Complete 100-edge chain layout | 42.319 | 41.600 |
| Complete 15-level nested layout | 13.458 | 13.284 |

The final decision median is about 9µs slower and Transformer about 0.612ms (2.0%) slower; the two fractional controls are about 1µs and 18µs slower. These costs and shared-host variability are retained, not described as a universal performance win. The earlier two current-main runs above are superseded prototypes, not independent confirmations of this final source.

The differential suite also retains a separate 500-seed normalized compaction corpus. Its construction translates all boxes, route points and labels into nonnegative rows, and assertions check every production guard input before each of two successive transformations. This explicitly exercises the optimized path; the original mixed/negative corpus remains to cover legacy fallback and separation.
