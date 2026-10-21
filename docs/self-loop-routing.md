# Independent self-loop route repair

This correction is extracted from the original stacked self-loop candidate onto
main after the cross-realm API change. Its only production change is layout.js;
it does not import the pending spacing optimization or crossing-search changes.

Custom and snapped ELK self-loops must leave and return at distinct,
nonadjacent border cells. Short boxes use separated side anchors rather than
an out-and-back segment, including height/width four where interior anchors
would be adjacent. Fallback search skips identical endpoints and adjacent
self-loop endpoints; eligibility of distinct-node endpoints is unchanged.

Correcting a degenerate loop may change downstream spacing, box positions and
other edge routes in that diagram. This is an intentional correctness change,
not an unconditional output-equivalence or performance claim.

## Bounded evidence

On main before extraction, a 180-source matrix (four directions, one through
five loops, short/wide/five-line labels, and absent/visible/invisible outgoing
neighbors), rendered in both charsets, had 148 failing executions repaired,
116 successful outputs changed and 96 successful outputs unchanged. There were
no baseline-success-to-failure regressions in these 360 renders.

A separate realistic corpus has 200 fixture executions but only 149 distinct
sources. Across both charsets, 330 successful outputs were unchanged, 26 changed,
36 errors were unchanged and eight failed executions were repaired. The eight
repaired executions represent four distinct sources; the 26 changed successful
executions represent 11 distinct sources. No new render failures occurred.

Across both matrices, all 69 distinct changed-success sources had a degenerate
baseline self-loop, and none retained a degenerate self-loop after repair.
Twenty-nine also changed box positions and 25 changed non-loop routes as a
consequence of corrected loop geometry. Successful diagrams without self-loops
in the realistic corpus were byte-identical.

These bounded results are not a claim that all self-loop graphs now render.
In particular, `flowchart BT` with `B --> A` followed by three `A --- A` edges
still fails: the original LAYOUT_EMPTY_EDGE becomes ROUTE_COLLISION after the
empty-route repair. This is classified as failure-to-different-failure, not a
fixed case. Source rendering, renderGraph and JSON-roundtrip graph rendering
share that residual error, and recover on the next valid call.

Regression tests cover separated endpoints, no immediate route reversal,
orthogonal segments outside node interiors, visible arrow counts, alternate
strokes, tall nodes, invisible neighbors, concurrent calls and error recovery.

After recovery onto main `406ae886514eb3a9ebf9a404ad6b3a8a20b43dc3`,
629 tests, build and type checks passed. An independent 188-source extension
adds incoming edges, empty/two-line/round/diamond/text nodes, groups, alternate
endpoints and up to eight loops. Its 376 charset attempts had 242 repaired
failures, 32 changed successes, 56 identical successes, 32 identical errors and
14 failure-to-different-error cases; zero successful baseline renders failed.
The 32 identical errors are parser rejections of 16 empty quoted labels, so
actual layout/raster coverage is 172 parseable inputs / 344 charset attempts.
All returned candidate layouts passed separated-endpoint, no-reversal and
node-interior checks. The 14 different errors are seven undirected-loop sources
(TB with six/eight loops, BT three/eight, LR six/eight, RL eight, all with B→A),
again LAYOUT_EMPTY_EDGE→ROUTE_COLLISION rather than repaired cases.
