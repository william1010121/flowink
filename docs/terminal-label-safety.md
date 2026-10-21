# Terminal label controls

FlowInk returns plain terminal diagrams, not ANSI-formatted labels. Raw terminal controls in labels could previously survive rendering, including backspace, ESC, and BEL. A sufficiently wide second label line could allow ANSI/OSC sequences to pass through instead of triggering a label collision.

Label normalization now replaces unsafe C0/C1 controls with the visible Unicode replacement character `�` (U+FFFD). Replacement occurs after entity decoding and existing CR/CRLF-to-LF normalization, before tab expansion. LF and existing tab stops remain supported. Ordinary Unicode, combining marks, joiners, and emoji remain unchanged. Escape-sequence payload characters remain literal text; this is not an ANSI formatting parser.

This is an intentional output change for unsafe labels in both ASCII and Unicode framing modes. Visible replacements preserve evidence of control bytes instead of silently deleting them. Entity-decoding semantics still apply: HTML numeric references that decode to ordinary Unicode remain ordinary Unicode. Node, edge, and subgraph labels share this boundary; graph source data is not rewritten.

The guarantee concerns label normalization in the public rendering API. It is not a general terminal emulator, a sandbox for JavaScript objects, a bidi-spoofing defense, or a promise that arbitrary manually constructed internal rasterizer inputs are sanitized. Tests inspect escaped strings and character ranges; they do not execute returned escape sequences in a terminal.

Error diagnostics are outside this returned-diagram guarantee and may quote unsafe input text. Consumers displaying errors in a terminal should apply their own diagnostic escaping rather than print untrusted error text verbatim.

Generated fallback shape placeholders use the same control replacement and whitespace normalization, but preserve literal markup/entity text in the shape name rather than interpret it as a label. This closes the placeholder path for consumers of the parsed-graph API as well as internal layout callers.

Many-line shape placeholders are accumulated iteratively and their widest line is computed iteratively, avoiding JavaScript argument-count ceilings. A controlled 150,001-line shape is tested only through preparation, not full rendering; this does not promise that arbitrarily large diagrams are practical.

## Measured overhead

Run `node scripts/benchmark-label-controls.js BASELINE_SRC_TEXT_JS`. Safe-label outputs are checked for equality before nine alternating-order rounds; two warmup rounds are discarded and the median of seven batched samples is reported. Node 24.19.0, shared cloud host with coordinated heavy jobs paused. Baseline → candidate milliseconds: plain 0.103658 → 0.105283 (+1.6%); Unicode 0.040945 → 0.016210; HTML 0.051696 → 0.051523; 1,000-character ordinary text 4.659267 → 3.570213. These noisy helper-only timings do not establish a speedup; this is a defensive correctness change, with a small measured ordinary-label overhead in this run.

After rebasing onto main `7dfa9e9` (including the HTML opener optimization), the same harness measured plain 0.107555 → 0.108844 ms (+1.2%); Unicode 0.045672 → 0.022279; HTML 0.051893 → 0.051702; long ordinary text 3.509212 → 4.991774 (+42.2%). The long-label result reversed versus the earlier run, so neither a stable speedup nor negligible overhead is claimed. Safety behavior is the purpose of this change; these single-host timings disclose a potential throughput cost that deserves broader profiling if large-label throughput is critical.
