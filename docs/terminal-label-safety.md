# Terminal label controls

FlowInk returns plain terminal diagrams, not ANSI-formatted labels. Raw terminal controls in labels could previously survive rendering, including backspace, ESC, and BEL. A sufficiently wide second label line could allow ANSI/OSC sequences to pass through instead of triggering a label collision.

Label normalization now replaces unsafe C0/C1 controls with the visible Unicode replacement character `�` (U+FFFD). Replacement occurs after entity decoding and existing CR/CRLF-to-LF normalization, before tab expansion. LF and existing tab stops remain supported. Ordinary Unicode, combining marks, joiners, and emoji remain unchanged. Escape-sequence payload characters remain literal text; this is not an ANSI formatting parser.

This is an intentional output change for unsafe labels in both ASCII and Unicode framing modes. Visible replacements preserve evidence of control bytes instead of silently deleting them. Entity-decoding semantics still apply: HTML numeric references that decode to ordinary Unicode remain ordinary Unicode. Node, edge, and subgraph labels share this boundary; graph source data is not rewritten.

The guarantee concerns label normalization in the public `render(source)` and `renderGraph(graph)` APIs. It is not a general terminal emulator, a sandbox for JavaScript objects, a bidi-spoofing defense, or a promise that arbitrary manually constructed internal rasterizer inputs are sanitized. Tests inspect escaped strings and character ranges; they do not execute returned escape sequences in a terminal.

Error diagnostics are outside this returned-diagram guarantee and may quote unsafe input text. Consumers displaying errors in a terminal should apply their own diagnostic escaping rather than print untrusted error text verbatim.

Generated fallback shape placeholders use the same control replacement and whitespace normalization, but preserve literal markup/entity text in the shape name rather than interpret it as a label. This closes the placeholder path for consumers of the parsed-graph API as well as internal layout callers.

Many-line shape placeholders are accumulated iteratively and their widest line is computed iteratively, avoiding JavaScript argument-count ceilings. A controlled 150,001-line shape is tested only through preparation, not full rendering; this does not promise that arbitrarily large diagrams are practical.

## Historical measured overhead

Run `node scripts/benchmark-label-controls.js BASELINE_SRC_TEXT_JS`. Safe-label outputs are checked for equality before nine alternating-order rounds; two warmup rounds are discarded and the median of seven batched samples is reported. Node 24.19.0, shared cloud host with coordinated heavy jobs paused. Baseline → candidate milliseconds: plain 0.103658 → 0.105283 (+1.6%); Unicode 0.040945 → 0.016210; HTML 0.051696 → 0.051523; 1,000-character ordinary text 4.659267 → 3.570213. These noisy helper-only timings do not establish a speedup; this is a defensive correctness change, with a small measured ordinary-label overhead in this run.

After rebasing onto main `7dfa9e9` (including the HTML opener optimization), the same harness measured plain 0.107555 → 0.108844 ms (+1.2%); Unicode 0.045672 → 0.022279; HTML 0.051893 → 0.051702; long ordinary text 3.509212 → 4.991774 (+42.2%). The long-label result reversed versus the earlier run, so neither a stable speedup nor negligible overhead is claimed. Safety behavior is the purpose of this change; these single-host timings disclose a potential throughput cost that deserves broader profiling if large-label throughput is critical.


## Current-main integration

This revision integrates the same replacement boundary with main `23fee6a27dbea4870a5be091e98995f27e697e34`. It retains the current extrema helper, text fast paths, graph validation and browser checks; it does not import the held spacing optimization or the unpublished CLI. The newer parsed-graph API is explicitly covered with source/JSON parity, edited node/edge/group labels, raw C0/C1 characters, ID fallback labels, unknown-shape placeholders and metadata, input non-mutation, failed-call recovery and concurrent calls. Chromium exercises source rendering, JSON graph rendering and genuine cross-realm graph rendering for the control fixture.

On current main, seven of eight focused tests fail before this patch and all eight pass afterward. The many-line baseline failure here concerns the missing placeholder line normalization, not a newly reproduced argument-count overflow: main already uses bounded numeric extrema. Combined tests pass 656/656 on Node 24.19.0 and minimum Node 22.12.0, plus declaration checks, the packed consumer using the existing offline cache, Chromium parity for 18 fixtures and all six browser failure guards. The offline package check is not a new online installation.

The refreshed ordinary-output differential preserves all 400 outputs from 200 executions of 149 distinct small sources. Across 435 upstream sources, 864 successful ASCII/Unicode outputs and six error outcomes remain unchanged, with no regression or changed successful output. These ordinary fixtures do not establish correctness for every possible control sequence; the focused range and entity tests cover the intentionally changed behavior separately.

A fresh bounded run of the same helper benchmark against this actual main measured baseline/candidate milliseconds per call: plain 0.000914/0.000898; Unicode 0.000769/0.000992; HTML 0.001240/0.001352; long ordinary text 0.011935/0.013394. The latter three controls were slower by about 0.223µs, 0.112µs and 1.459µs respectively. These short, noisy single-host samples are disclosed as overhead observations, not a uniform speed or negligible-cost claim. The much earlier measurements above used older text implementations and are not directly comparable to this revision.

The explicit requested Security review remains a required merge gate for the final integrated head; an unreported result is not a pass.
