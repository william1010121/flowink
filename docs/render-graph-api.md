# Parsed graph rendering

`renderGraph(graph, options)` complements the existing source-only `render`. It
supports programmatic edits and reuse of `parse` output or its JSON round-trip.
It is not a new parser dialect, CLI, or general JavaScript-object sandbox.

The API snapshots drawing fields synchronously before the first asynchronous
layout step. Unknown/non-drawing fields are ignored. Own data descriptors are
read without invoking getters. Plain objects from the caller or another realm (including null-prototype records)
and dense ordinary arrays are accepted; custom instances and accessors in
consumed data are rejected. Cyclic text/shape metadata (including parser YAML
aliases) is rejected rather than promising parity for non-serializable inputs.
Icon/image metadata is reduced to a presence flag without traversing its
unused payload. Cross-realm ordinary records and dense arrays are accepted directly. Custom class instances, array subclasses, and nonstandard prototype chains remain rejected. Foreign intrinsic prototypes are checked through own data descriptors and native constructor/prototype identity, without invoking constructors or property getters. Drawing-metadata traversal has a 256-level depth limit; deeper acyclic inputs
reject as `INVALID_GRAPH` instead of overflowing the JavaScript stack. Memoized copying preserves aliases
inside each consumed metadata value without sharing caller objects; a shared
acyclic subtree is copied once, rather than expanded exponentially. Cached
subtree heights still enforce the depth limit at every reference. This is not a
total input-size, output-size, or memory budget.
Text-bound metadata is checked on the inert copy so
malformed coercion data rejects as `INVALID_GRAPH`, not an incidental layout
failure. Proxies and globally modified built-ins are not a security boundary.

Node/group identity, containment, and endpoint checks remain in layout's existing
validation. Duplicate edge IDs and invalid direction/arrow/stroke enums are
checked at the new boundary. `render(source)` retains its previous parser and
options behavior; it does not acquire graph validation or become overloaded.

## Non-gating performance sample

Run `node scripts/benchmark-render-graph.js` from the repository root. Node
24.19.0, Linux shared host, 2026-10-20. Each workload verifies output equivalence,
warms each API five times, then alternates call order for 15 timed samples and
reports medians. Input parsing for graph reuse happens outside the graph-render
timer; the synchronous snapshot remains inside it. Preparation timings are
separate 20-call batches with the same warm-up/sample/order policy. No competing
builds or benchmark processes were intentionally running during measurement.

| Workload | Source render ms | Reused graph render ms | Parse ms | Snapshot ms |
| --- | ---: | ---: | ---: | ---: |
| Two-node flow | 5.298 | 5.075 | 0.056 | 0.004 |
| Four-node decision | 8.132 | 7.143 | 0.113 | 0.006 |
| Transformer | 40.645 | 40.801 | 0.952 | 0.036 |
| 100-edge chain | 55.679 | 53.400 | 2.203 | 0.106 |
| 15 nested groups | 16.666 | 14.757 | 0.381 | 0.019 |

This compares two API use cases, not a universal throughput claim. Graph reuse
avoids repeated Mermaid parsing but still performs complete ELK layout and
rasterization, which dominate these workloads. The Transformer median regressed
0.4%; larger timing differences also include JIT, GC, and host noise. Graph reuse
is primarily a functionality and integration improvement, not a layout cache.

## Validation evidence

- Contract tests cover ASCII/Unicode parity, JSON round-trips, edits, immutable
  frozen input, parallel/repeated calls, mutation after invocation, invalid
  topology, malformed drawing data, accessor non-execution, and recovery.
- A separate differential probe covered all 432 parseable cases among 435 pinned
  upstream fixtures: graph rendering matched source output or error code for
  every case. This does not mean all upstream diagrams render successfully.
- Built package, TypeScript declarations, and Chromium browser consumers exercise
  the new named export; browser parity covers all nine existing fixtures.

## Independent current-main extraction

The API was extracted onto main `d16489c5a5f20078151394346aa4b4dd48e1f94e`
without any pending routing, spacing, terminal-control or lexer research changes.
The snapshot and public composition code are unchanged from the originally
reviewed API. One prior test assumed a pending multi-self-loop repair; it now
explicitly verifies the same existing `LAYOUT_EMPTY_EDGE` error through source,
graph and JSON graph paths, followed by successful recovery. No routing error is
suppressed and no existing layout guarantee is expanded by this API.

Current validation: 616 tests, build/types, ten real Chromium fixtures and all
browser failure guards pass. The packed consumer passes offline using existing
cached dependencies; local npm registry HTTP 403 prevents claiming a fresh online
install. A bounded differential ran 200 fixture executions containing 149
unique sources in both charsets. Untouched-main source rendering, extracted
source rendering, graph rendering and JSON graph rendering agree exactly for
all 400 cases: 356 successful outputs and 44 shared expected errors.

The same non-gating benchmark completed within 20 seconds on Node 24.19.0 with
no competing builds/timings, now against this independent main-based API:

| Workload | Source render ms | Reused graph render ms | Parse ms | Snapshot ms |
| --- | ---: | ---: | ---: | ---: |
| Two-node flow | 5.090 | 5.006 | 0.0667 | 0.0049 |
| Four-node decision | 7.324 | 6.985 | 0.1156 | 0.0054 |
| Transformer | 40.314 | 39.204 | 1.1854 | 0.0416 |
| 100-edge chain | 60.528 | 61.364 | 2.5844 | 0.1327 |
| 15 nested groups | 18.599 | 19.161 | 0.4202 | 0.0250 |

The reused-graph chain and nested-group medians are 1.4% and 3.0% slower in this
run despite less preparation work. This remains a composable API feature, not a
layout cache or a promise that skipping parsing always lowers full-render time.

### Cross-realm boundary

Foreign ordinary objects/arrays require standard intrinsic prototype `constructor` data descriptors and constructor-to-prototype back-references. Deleting or replacing those descriptors can make otherwise ordinary foreign data unsupported; the existing local-realm fast paths remain unchanged. Validation uses caller-realm intrinsic descriptor/prototype operations and `Function.prototype.toString`, never caller-supplied or foreign method overrides. It assumes trusted caller-realm intrinsics, and is not hardened identity authentication or a sandbox for arbitrary Proxies.

Cross-realm regression coverage uses both Node VM contexts and real same-origin Chromium iframes: plain and mixed-realm output parity, rejected custom classes/array subclasses, and rejected non-executed getters. Existing metadata cycle/depth/shared-DAG and snapshot-mutation safeguards also apply to foreign data. The feature does not grant access to cross-origin iframe objects; ordinary browser origin rules remain in force.

Run `node scripts/benchmark-cross-realm.js BASELINE_SRC_GRAPH_JS` to compare snapshot overhead. It verifies snapshot equality, rotates baseline-local/candidate-local/candidate-foreign order for nine rounds, discards two warmup rounds, and reports medians of seven 500-call batches. On Node 24.19.0: two nodes measured 0.003179 / 0.002893 / 0.007667 ms; 100 nodes measured 0.081154 / 0.083587 / 0.205779 ms. Foreign descriptor validation has a measurable cost; local 100-node overhead was approximately 3% in this run. These are snapshot-only timings, not full-render speed claims, and shared-host noise limits generalization.

Cross-realm extraction onto main `2ef9e97179c96ab358698f74c302a08385ef6bcf`
changes no routing or parsing source. Its graph validator is byte-identical to
the previously reviewed cross-realm implementation. Current validation passes
621 tests, build/types, an offline packed consumer, ten browser fixtures plus
real same-origin iframe checks, and browser failure guards. A bounded
200-execution/149-source differential verifies foreign-graph and JSON paths
against current-main source rendering in both charsets: 356 identical successful
outputs and 44 identical expected layout errors. Existing class/accessor,
cycle/depth/DAG, mutation and repeated-recovery safeguards remain tested.

One refreshed snapshot-only comparison on Node 24.19.0 completed within ten
seconds using the same rotating nine-round harness. Baseline-local /
candidate-local / candidate-foreign medians were 0.003083 / 0.002433 / 0.007337 ms
for two nodes and 0.098482 / 0.099475 / 0.221873 ms for 100 nodes. The local
100-node difference is approximately one microsecond (+1.0%); foreign validation
has a deliberate measurable cost. This is interoperability, not a full-render
performance claim. Local online dependency installation remains unverified due
to the previously observed registry HTTP 403; offline results are kept distinct.
