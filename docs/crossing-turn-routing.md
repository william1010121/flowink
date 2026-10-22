# Preserve perpendicular crossings during route repair

This five-line layout correction is extracted independently onto main after the
self-loop repair. It does not contain the pending spacing optimization or its
ancestry. An orthogonal search may enter an occupied wire perpendicularly, but
must not leave that crossing cell along the existing wire: that would create an
ambiguous shared turn or overlapping segment. The destination-only occupancy
check cannot detect this turn at the current cell. The added current-cell check
uses the same horizontal/vertical occupancy invariant as final route validation.

Legitimate perpendicular nonjoining crossings remain allowed. The K3,3 fixture
retains both ASCII and Unicode hashes captured before this correction and
reconfirmed on main e98be50. Distinct-node and self-loop endpoint candidate
filters are unchanged.

## Bounded independent extraction evidence

The previously residual BT case with B→A and three undirected A→A loops changes
from ROUTE_COLLISION to a complete render. Source, parsed-graph and JSON-roundtrip
graph API outputs now agree; failed-then-valid and concurrent calls remain tested.

The 188-input adversarial loop matrix has 172 parseable sources and 16 invalid
empty-label inputs. Across 376 charset attempts, all 330 successful baseline
outputs remain byte-identical, 14 failures are repaired, and 32 parser failures
remain unchanged. These fourteen repairs cover all seven previously documented
undirected-loop residual sources. Every returned loop passed separated-endpoint,
no-reversal and node-interior checks. This does not claim every possible graph
is supported.

A separate realistic corpus has 200 executions / 149 distinct sources. All 364
successful charset outputs and all 36 expected errors remain identical on the
main-based extraction; no new failure or malformed returned loop was observed.

Independent lightweight function probes preserve four perpendicular crossing
orientations and validate eight rotated/mirrored turn fixtures, including four
previously ambiguous baseline routes. Identical and adjacent self-loop endpoint
behavior is unchanged. These probes isolate routing-search behavior without ELK.

A bounded Node24.19.0 shared-host control measured parse + layout + rasterization using the
same dependencies and alternating baseline/candidate order for thirteen rounds,
discarding three warmups and taking the median of ten samples. Chain medians
were 8.136→8.052 ms, cycle 7.170→6.980 ms, and legitimate K3,3 crossings
36.908→36.029 ms. Every measured output was identical. Sample variability is
substantial; these controls support no observed material ordinary-workload cost,
not a throughput improvement claim. The batch completed within ten seconds.
