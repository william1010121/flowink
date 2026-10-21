# Bounded semantic array appends

The semantic database used `target.push(...values)` for node styles/classes,
synthetic subgraph styles/classes, and node/edge class-style expansion. An
ordinary array with 150,001 entries exceeds Node's call-argument ceiling even
though iterating that array is inexpensive. These six transfers now use a
private indexed loop with the source length captured before appending.

This preserves order, duplicates, shallow element identity, holes as explicit
undefined entries, missing-class defaults and the existing source/target alias
behavior. Capturing the length prevents self-appends from growing indefinitely.
The contract is internally produced ordinary arrays, not custom iterators,
proxies, accessor-modified arrays or overridden push methods. No grammar,
preprocessing or style interpretation changes are included.

## Scope and evidence

Direct `FlowSemanticDB` fixtures with 150,001-element arrays reproduce baseline
RangeError and succeed after the change. Tests cover vertex styles/classes,
synthetic groups and node/edge class expansion without rendering a huge grid.
Ordinary source class declarations and repeated parses preserve style order.
An independent differential compares 445 ordinary corpus/example/failure inputs
twice and 600 seeded 30-operation semantic sequences, including repeated
finalization, holes, aliases and missing classes.

This is an internal completeness fix, not a demonstrated large-source parser
fix. A separate roughly 600 KB class-definition source probe was interrupted
because parsing was too slow; it did not establish a public parse overflow and
is not repeated by the tests or benchmark. The grammar's large-input runtime is
outside this patch.

## Measurement

`node scripts/benchmark-semantic-appends.js BASELINE_CHECKOUT` measures direct
10-item and 10,000-item transfers plus ordinary class-source parse/render. It
checks ordinary graph/output equality first, uses nine alternating rounds,
discards two warmups and reports the median of seven, with per-round iteration
counts recorded alongside all raw samples. No oversized failing baseline is
timed and no universal speedup is claimed.
Direct-transfer samples include database construction and addVertex overhead;
they measure an operation, not isolated append-helper speed.

A Node 24.19.0 run against main 7559992 measured milliseconds per operation:

| Workload | Baseline | Candidate |
| --- | ---: | ---: |
| 10-item append operation | 0.000844 | 0.000792 |
| 10,000-item append operation | 0.01943 | 0.03130 |
| Ordinary class-source parse | 0.13662 | 0.12897 |
| Ordinary class-source render | 4.45051 | 4.47484 |

The large direct operation is about 61% slower (roughly 12 microseconds), while
the measured full render is about 0.5% slower. The change trades that direct-loop
cost for removing the argument ceiling; short timing differences are not broad
throughput claims. The 150,001-entry correctness fixtures are not represented as
a successful baseline timing.

## Current-main integration

Rebased onto main `3d076779a5d49e123110c538022944e1793cef6e`, retaining
own-data-property metadata copying beside the six append replacements.
All 589 tests, build, types, clean packed consumer, nine Chromium fixtures and
browser failure guards passed on Node 22.12.0. The timings above remain the
original, explicitly identified baseline measurement, not a new performance run.
