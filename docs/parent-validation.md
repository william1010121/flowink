# Order-independent parent validation

`renderGraph` accepts containment through an explicit `parentId`, a group's
`nodeIds`, or matching redundant declarations. Conflicting declarations must
reject with `FlowInkError` code `INVALID_GRAPH`, regardless of array order.

Before this correction, `G.nodeIds = ['H']` and `H.parentId = 'J'` could be
accepted when G preceded H: registering H's explicit parent overwrote the
membership-derived parent. Reversing G and H rejected the same contradiction.
All explicit parents are now registered before membership reconciliation.
Valid hierarchy layout and the existing subsequent cycle checks are unchanged.
When an input has several different defects, which validation error appears
first is not guaranteed.

The regression tests cover all six orders of three groups, matching repeated
membership declarations, missing parents, competing memberships, mixed cycles,
both character sets, input immutability, and concurrent failure/recovery.
Independent review additionally checked membership-only versus explicit-only
nesting, canonical synthetic group aliases, and other cycle/conflict forms.

Validation on the independent main base: 636 Node tests pass; the 435-source
upstream differential retains all 428 successful outputs in both charsets and
the same seven existing errors (870 comparisons, no new regression). Minimum
Node 22.12 passes 26 focused API tests. Build, declaration checks, an offline
packed-package consumer, Chromium's 14 fixtures and browser failure guards pass.
The offline consumer uses already-installed cached dependencies, not a fresh
network installation. CI must independently verify its clean install.

## Bounded ordinary controls

Node 24.19, main `985704bc` versus this four-line change; three warmups followed
by ten measured rounds per source, alternating baseline/candidate execution.
Every paired output was byte-identical. Median elapsed milliseconds:

| Source | Main | Candidate |
| --- | ---: | ---: |
| Two nodes, one edge | 5.391 | 5.468 |
| Two groups with an external edge | 51.400 | 49.527 |
| Two nested groups | 7.033 | 6.914 |

These are noisy correctness controls, not a throughput improvement claim.
The change adds a separate linear pass over groups, without changing the
existing ancestry traversal or making a global complexity claim.
