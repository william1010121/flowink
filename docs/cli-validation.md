# Minimal CLI validation

## Source lineage

This source-only CLI revision is based on terminal-control PR #7 head
`49eaea42436a941249e196513b6677cc611e79c4`, which includes main
`23fee6a27dbea4870a5be091e98995f27e697e34`. The CLI entry, build script and
startup harness are unchanged from original CLI candidate
`a2715dd9abacec8d03eb5f7a0907a2af880aba04`. Current packed-consumer type/control
checks are retained alongside installed-bin checks, with an explicit source-only
README notice and CLI label-control regression test.

This candidate depends on PR #7 and is not part of published npm `flowink@0.1.1`.
These validation results do not replace the required review gates or imply a
release.

## Validation on 2026-10-22

On Linux, Node.js 24.19.0 and minimum Node.js 22.12.0 each passed all 668 tests
and build/declaration checks. Node 24 also passed browser asset generation.
`npm pack --ignore-scripts` confirmed the CLI/library/declaration entries and
exclusion of test/dependency files.

A fresh temporary consumer of this source archive passed on Node.js 22.12.0
with npm 11.9.0, including installed-bin version/render parity and strict
emitted-declaration checks. Installation used a reused npm cache and official
registry dependencies, with install scripts/audit/funding disabled. Resolved
direct runtime dependencies were elkjs 0.12.0, entities 6.0.1, js-yaml 4.3.2,
marked 16.4.2 and string-width 7.2.0. The minimum runtime was obtained from
registry package `node-linux-x64@22.12.0`. This was a freshly packed source
consumer, not a test of the published npm 0.1.1 artifact.

Chromium 155.0.8059.79 could not start in the validation environment because of
socket/crashpad initialization failures. No browser fixture or failure-guard
pass is claimed for this revision; generating browser assets is not equivalent
to running them. Windows shell wrappers, console signals and platform-specific
executable installation have not been validated.

## Test coverage and build behavior

The CLI subprocess tests cover argument parsing, stdin and files, strict UTF-8,
BOM and CRLF parity, structured original-source diagnostics, escaped controls,
missing paths/directories, synchronous and asynchronous output errors, early
stdin closure/errors, native SIGINT, and real closed stdout pipes. Help and
version exercise the same EPIPE-success and non-EPIPE-failure contract as
rendering. Malformed input must produce no stdout. Async child tests have bounded
timeouts and owned-child cleanup. Package smoke exercises npm's installed bin.

`npm test` now runs the build before tests so fresh checkouts have the CLI and
its lazy-loaded renderer. This deliberately adds a build to test execution;
CI workflows already building first may perform a duplicate build. It is not a
runtime dependency or per-invocation build cost.

## Historical startup/resource measurements

Run `node scripts/benchmark-cli.js` after building. It takes three fresh-process
samples per case and asserts the small CLI rendering exactly matches a direct
library subprocess. It records wall time and child peak RSS, not throughput or
memory guarantees. The following values were recorded for the original CLI
candidate on Linux with Node.js 22.12.0. They were not remeasured for this revision and must not be
read as fresh validation results:

| Case | Median elapsed | Observed peak RSS |
| --- | ---: | ---: |
| Help | 25.41 ms | 43,908–44,164 KiB |
| Version | 28.06 ms | 44,164 KiB |
| Small CLI render | 300.39 ms | 88,376–89,352 KiB |
| Same direct render | 278.53 ms | 88,408–89,256 KiB |

These few shared-host samples are feature-cost evidence, not a speed claim.
After measurement, the harness-only parity assertion was strengthened to check
each round rather than only the final round; production code was unchanged.
The CLI buffers the entire input and output, does not stream rendering, and has
no artificial input-size cap. Larger graphs can exhaust memory or consume
substantial layout time; use external limits for untrusted workloads. Escaping
errors and normalizing label controls are not universal terminal-safety guarantees.

## Reproduction

With the desired Node executable first on PATH, run:

```sh
npm test
npm run test:package
npm run test:types
npm run test:browser
npm run test:browser:runner
node scripts/benchmark-cli.js
```

The browser checks require the installed Playwright Chromium runtime. The actual
browser verifies all rendering fixtures; the runner's failure guards check output
mismatch, missing module, page/console errors, failed HTTP resources, off-origin
requests, timeout, and incomplete results. A browser bundle build alone does not
establish these checks passed.
