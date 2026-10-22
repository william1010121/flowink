# Preserve group-title clearance after route spacing

A small nested cycle in `test/fixtures/title-clearance.mmd` previously failed
with `LABEL_COLLISION: box G1 collides at (17,22)`. It rasterizes before spacing
and after vertical compaction. Adjacent-route separation widens the inner group
from 18 to 19 cells, moving its centered `Inner` title from columns 12–16 to
13–17, while an existing vertical route remains at column 17. This is a broken
post-routing clearance invariant, not an inherently impossible diagram.

The rasterizer keeps centered subgraph titles whenever their actual glyph cells
are free. Only an obstructed centered title invokes a fallback: find the nearest
free rectangle inside the same padded header strip. All lines move by one common
horizontal offset, retaining their existing relative alignment and UTF-16 text.
Display-cell widths, not string lengths, define the rectangle. Equal-distance
choices prefer the left interval deterministically.

Routes, node boxes, edge labels, title content and diagram size are not changed.
`placeLabels` already reserves the complete group header strip for generated
layouts. For supplied layouts, fallback reservations additionally exclude nodes,
other group borders/header strips, and edge-label rectangles that may be drawn
later. Future arrows occupy already drawn route cells. A conservative rectangular
reservation may reject an arrangement that could fit with individually shifted
lines; if no safe rectangle exists, the original explicit collision failure is
retained. Collision detection is never suppressed.

The fallback unions occupied columns across the title rows and marks future
obstacles through clipped difference intervals. It costs
O(header width × title rows + boxes + edge labels), with
O(header width + title rows) temporary memory. Ordinary centered placement only
checks its existing text cells and does not allocate the fallback arrays.

## Validation

- Eight tests cover the original source, both charsets, repeated renders, input
  immutability, odd/even widths, CJK/emoji/combining text, multiline offsets,
  left tie-breaking, pending nodes/group borders/edge labels, invisible routes,
  unchanged centered titles and explicit no-fit/ordinary-node failures.
- Independent exhaustive interval oracle: 40,962 cases agree.
- Independent 2,016 synthetic-layout differential preserves all 1,574 baseline
  successes byte-for-byte and repairs 382 failures; other failures remain.
- Saved realistic corpus: 200 fixture executions, **149 distinct sources**, both
  charsets. All 200 parsed graphs match main; all 350 previously successful
  render outputs remain byte-identical. Six formerly failing render executions
  now succeed, representing one distinct nested-cycle diagram repeated across
  fixtures/charsets. The remaining 44 unrelated failures retain identical errors.
  There are no new failures. The corpus completed under a 60-second hard timeout.
- Original candidate: 576 tests and nine real Chromium fixtures passed. After
  rebasing onto main `3d076779a5d49e123110c538022944e1793cef6e`, all 593 tests,
  build, type declarations, clean package consumer, ten real Chromium fixtures
  and browser failure guards pass. The same 200-execution/149-source differential
  was repeated on this base with the identical 350/6/44 outcome above. The nested-cycle source is included
  in browser-to-Node ASCII/Unicode parity verification.

## Ordinary overhead controls

The reproducible harness is `node scripts/benchmark-title-clearance.js
BASELINE_CHECKOUT`, using main `75599923b9d8302ad1d049dd87eebc887281869a`.
It requires equal outputs, alternates nine baseline/candidate rounds, discards
two warmups and reports medians of seven samples. It compares two unobstructed
group rasterizations and small/nested source renders. This is a correctness
change, not a speedup claim.

An initial trial aborted on a baseline `LAYOUT_MISSING_EDGE` in an accidentally
cross-level nested control, before reporting results. No timing result from that
trial is claimed. The corrected control contains nested groups without that
unsupported cross-level edge; production code is unchanged.

Completed corrected run, Node 24.19.0, under a ten-second hard timeout:

| Workload | Baseline ms | Candidate ms |
| --- | ---: | ---: |
| Unobstructed group raster, width 17 | 0.035507 | 0.035368 |
| Unobstructed group raster, width 80 | 0.105357 | 0.107744 |
| Small source render | 4.296826 | 4.261880 |
| Nested source render | 6.601244 | 6.670134 |

The wider raster control cost about 2.4 microseconds more (2.3%), and nested
source rendering about 1% more in this run. Other controls were similar.
These are bounded wall-clock observations, not a universal overhead guarantee;
raw samples are retained. The formerly failing diagram now completes, but a
failure-versus-success timing comparison would not measure equivalent work.

After the independent semantic-append repair landed, the candidate was rebased
again onto main `0a93d1a1ba05ef703a6e1ac716067cd4f5326adb`. All 597 tests,
build/types, ten Chromium fixtures and browser failure guards pass. The packed
consumer passes offline using the existing dependency cache; local registry
access had returned HTTP 403 during a separate candidate check, so this is not
claimed as a fresh online install. The 200-execution/149-source differential was
repeated again with the same 350 unchanged successes, six repaired executions,
44 unchanged failures and zero regressions. Rasterizer source is unchanged.
