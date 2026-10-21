# Bounded extrema reductions

Data-sized Math.min/Math.max argument lists can exceed the JavaScript engine's
argument-count limit. This change replaces those reductions with internal numeric
iterable helpers, folding with two-argument Math.min/Math.max. Empty-input seeds,
NaN propagation, infinities and signed zero remain intact. Coordinate, routing,
label-placement and indentation algorithms are otherwise unchanged.

The helpers consume already-computed numeric values. They are not a public
replacement for arbitrary variadic expressions with getters, object coercion or
other evaluation side effects. Existing map/flatMap arrays remain allocated;
this is not a streaming-memory redesign or a resource/DoS sandbox.

## Reproductions and boundaries

On main b2e663af25ba336213917c3afdc43635304967ed, each of these bounded fixtures
hit a RangeError; the candidate completes them:

- A 600,044-byte single-node YAML block scalar with 150,001 content lines and a
  sibling `shape: rect` key. Public parse previously wrapped the RangeError as
  PARSE_ERROR. The test parses only, without constructing a huge raster.
- Node preparation and edge-label validation with 150,001 short lines, without
  grid allocation.
- Label-placement translation of 150,001 coincident route points, without a
  large canvas or many-node pairwise overlap work.

The initial scalar-only diagnostic has a separate pre-existing common-indentation
normalization limitation. It is not claimed fixed: the final valid regression
uses the sibling key to preserve the existing indentation convention. Other
argument spreads, such as parser style/class pushes, are outside this extrema-only
change. There is no claim that all large-input failures are eliminated.

Tests cover repeated parsing, malformed-input recovery, repeated coordinate
translation, empty layouts, numeric edge cases and input-dimension non-mutation.
Chromium additionally parses the same large scalar, without rendering it.

## Representative controls

Run `node scripts/benchmark-extrema.js BASELINE_CHECKOUT` against the main commit
above. Node 24.19.0 on the shared Linux host, coordinated quiet window. Nine
alternating-order rounds, discard two warmups, median of seven per-operation
batch timings. Batch counts: parse100, edge validation50, numeric maximum100,
source render10. Exact normal-workload outputs are checked before timing.

| Workload | Baseline ms | Candidate ms |
| --- | ---: | ---: |
| 100-line scalar parse | 0.06554 | 0.06406 |
| 100-line edge validation | 0.16128 | 0.16186 |
| 10,000-number maximum | 0.02309 | 0.00994 |
| Two-node source rendering | 4.84595 | 4.80435 |

This is a correctness fix. Ordinary parse/validation/render differences are small
and host/JIT-sensitive, not a general speed claim. The isolated numeric reduction
is faster here, but that is not representative of whole-diagram throughput.
