# Nested cross-level edge repair

ELK's separated compound graphs can omit routes owned by a container when an endpoint belongs to a deeper descendant. The repair keeps the external container separate, but places its children and owned edges in an invisible, zero-padding INCLUDE_CHILDREN helper. The helper uses the nearest explicit ancestor direction or root direction. Direct-child edges and containers with external connections keep their existing handling.

Helpers use internal IDs disjoint from generated node/group IDs and never become public boxes, input graph data, or sizing counts. Existing raw ELK errors may still include internal IDs. Arrow cells may not lie along box borders; ordinary group-boundary crossings remain supported.

## Verification and recovery

The original local production source was independently reviewed with SHA-256 `8b41a5729637912012f92ff19f4388300f03daa7139a127f01d586a9dcf36d52`. After an environment replacement, that exact source, the six regression tests, and browser scripts were recovered from retained review evidence. Original documentation, benchmark source, and baseline JSON were unavailable. This document and benchmark harness were reconstructed; the eight known-valid ASCII/Unicode baseline cases were regenerated from unchanged published commit `ac0f3ba71fff2a54df2684f7696d99e4c8f127bc`, not the repaired implementation.

Original validation covered all four missing-edge upstream fixtures, all 16 root/local direction combinations, inherited directions, nested helpers, compound endpoints, invisible and parallel edges, labels, prototype-like IDs, repeat/concurrent rendering, failure recovery, and unchanged input graphs. The original 435-fixture differential found 428 previously successful cases byte-identical in ASCII and Unicode, four fixed failures, and three unchanged expected parser/shape failures. Fresh recovery validation is recorded separately rather than presumed from these historical results.

## Historical benchmark

Original sequential baseline/candidate measurements in milliseconds, retained in the benchmark log: small 5.176/5.167; decision 6.587/6.750; Transformer 41.261/42.284; chain100 53.299/51.412; deep groups 13.641/13.865. Two formerly failing nested/compound examples completed in 5.992/7.251 ms. These results are noisy and do not support a speedup claim; observed decision/Transformer regressions were approximately 2.5%.

The reconstructed harness accepts the baseline entry module path as its first argument, warms each implementation, checks exact output equality for previously valid inputs, and reports medians of nine sequential renders. New recovered measurements must not be presented as the original experiment.

## First independent main validation

This extraction is based on main `985704bc208caef534359629c04cc4764cd89e2e`, after the separately reviewed self-loop and crossing fixes. It contains no geometry-spacing optimization, terminal-control normalization, or experimental lexer pruning. The production change remains 23 added lines in `src/layout.js`.

All four pinned missing-edge failures were reproduced on that main before applying the patch. The refreshed 435-source upstream differential has 428 previously successful sources byte-identical in both charsets, four fixed failures, and three unchanged expected errors. A separate generated corpus contains 200 executions of 149 distinct sources: 364 unchanged render outputs and 36 repaired render attempts covering ten distinct sources, with no remaining errors, changed successful outputs, or detected degenerate self-loops. Repeated executions are not counted as distinct cases.

The focused regressions also compare source rendering, parsed-graph rendering and JSON round trips on the four repaired examples. Browser coverage retains every existing case and adds nested cross-level and compound-endpoint examples. Public helper frames and input mutation remain forbidden; raw ELK error strings are not promised to hide internal identifiers.

An independent current-main review additionally compared 32 ancestor/compound/bidirectional cases: four unchanged successes, 18 repaired failures (16 missing-edge and two arrow-border cases), ten unchanged `ARROW_COLLISION` failures, and no successful-case regression. The 22 successful examples matched JSON `renderGraph` output and exposed only public IDs. A border-only regression and explicit ancestor-direction/parent assertions are now durable tests. This does not claim all compound arrow arrangements are supported.

A fresh Node24.19.0 bounded run used three warmups and nine sequential samples per implementation, with exact output checks for prior successes. Median baseline/candidate milliseconds: small 6.760/7.560; decision 10.071/8.946; chain100 60.156/56.174; deep groups 18.412/16.727. The small control was 0.800ms slower (11.8%) in this run; other controls were faster, so these noisy sequential results are not a throughput claim. Formerly failing nested/compound examples rendered in 42.803/52.425ms and have no successful baseline timing. These measurements are distinct from the historical run above.

## Integration with main after parent validation

The final candidate is based on main `260a96499e4eb0ce47eb7d2509c27fccc9d1db5d`,
including the independently merged order-independent parent validation and
published-versus-source README guard. The nested repair remains the same
23-line production delta relative to that main. The earlier candidate and
its evidence remain preserved; its old-head review is not a review of this
combined source. No spacing optimization, terminal-control normalization, or
unpublished distinct-arrowhead repair is included.

The combined suite passes 644 tests. Build, declarations, an offline packed
consumer, all 16 Chromium fixtures and browser failure guards pass. The
offline package check reuses cached dependencies and is not represented as
a fresh network install; final-head CI must supply its clean-install gate.

Re-running the differential against this exact main retains all 428 prior
successful upstream sources byte-for-byte in both charsets, fixes the same
four missing-edge sources, and retains three expected errors. The bounded
generated corpus again covers 200 executions of 149 distinct sources: 364
identical successful outputs and 36 fixed attempts, with no new regression.
Minimum Node 22.12 also passes the 34 focused nested/parent/API/realm tests.
The timing results above remain measurements of the earlier base, not new
measurements of this integration.
