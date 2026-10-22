# Distinct arrowhead cells

A two-cell route between a child and its enclosing compound box can put both endpoint arrowheads in the same intermediate cell. For example, `flowchart TB; subgraph A; a; end; a<-->A` produced the route `(6,6) → (6,8)` and failed with `ARROW_COLLISION`. The collision already existed before spacing transforms. A three-segment detour with unchanged boxes demonstrates that this example is representable.

Routing now rejects a completed route whose two arrowheads occupy fewer than two distinct cells. The fallback tries the next endpoint pair instead of accepting the same invalid two-step path at every search margin. No-arrow and single-arrow validation are unchanged. Ordinary perpendicular crossings remain allowed. Point, circle and cross arrowheads all require their own character cell.

This is not a complete path-search redesign: BFS retains one predecessor per cell and does not search for a longer detour for the same endpoint pair after its shortest path fails the arrow test. If no alternative endpoint pair works, the existing explicit routing failure remains; this change does not guarantee discovery of every geometrically possible route. Invisible edges with retained arrow metadata can acquire a different internal path, though the four tested ancestor controls retain byte-identical rendered output.

## Validation

The regression first failed with coincident arrow cells `(6,7)`, then passed all four directions and three arrow styles with input immutability and source/JSON graph parity. Compound endpoints, multiple alternate arrows, error recovery and repeated concurrent calls are covered. Twelve previously successful single-arrow, no-arrow and self-loop controls retain exact ASCII/Unicode hashes captured before this patch. Existing crossing tests retain their exact output hashes.

The separate small corpus has 200 executions of 149 distinct sources, with all 400 ASCII/Unicode outputs byte-identical to the immediate baseline. Native synthetic probes cover straight/bent two-step routes, valid three-step paths and four-step detours, mixed arrow kinds, and perpendicular crossings. These probes do not establish exhaustive routing completeness.

The refreshed 435-source upstream differential retained 432 successful sources byte-identically in both charsets and the same three expected errors. Separately labeled native synthetic 1×1 endpoint probes returned null for identical/adjacent endpoints, a sole two-step dual-arrow pair, and four blocked exits; a three-step pair returned a valid route. These deliberately tiny synthetic boxes are not normal prepared nodes. No broader guarantee is inferred from them.

A bounded Node 24.19.0 comparison alternated baseline/candidate order over 13 rounds, discarded the first three, and compared median ten-sample render times with exact output equality. Baseline/candidate milliseconds: ordinary bidirectional 6.980/6.542; valid ancestor 9.420/9.597; chain 5.650/5.439; cycle 6.342/6.231; perpendicular crossings 40.707/39.737. The valid ancestor control was 0.177ms slower (1.9%); samples were noisy. This is a correctness change, not a throughput claim.

## Current-main integration

The unchanged routing patch was reapplied to main `26a0abeafb7f470f99eb4a80af701ab8ab22c090`, after the nested cross-level repair, order-independent parent validation and published-versus-source README clarification had landed. Only this arrowhead fix, its tests, browser fixture and documentation are included; the held spacing and terminal-control changes are not dependencies.

On this exact baseline, three of the four new focused tests failed before the production patch, including coincident `(6,7)` arrow cells and `ARROW_COLLISION`; all four pass afterward. The final combined source passes 648 tests on both Node 24.19.0 and the minimum Node 22.12.0, declaration checks, the packed-consumer check using the existing offline npm cache, Chromium parity for 17 fixtures, and all six browser failure guards. The offline package check is not a new online installation.

Fresh baseline/candidate comparisons preserve all 400 ASCII/Unicode outputs from 200 executions of 149 distinct small sources. The 435-source upstream corpus preserves 864 successful render outputs (432 sources in both charsets) and the same six error outcomes (three sources in both charsets), with no new failure, changed successful output or detected degenerate loop. The earlier timing and native synthetic probes above are retained historical evidence, not newly measured performance results for this main revision.
