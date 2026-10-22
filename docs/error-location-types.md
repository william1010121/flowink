# Optional error-location declarations

`FlowInkError.line` and `.column` can be `undefined`: for example, invalid input
or layout errors may not have a source position. The generated declarations now
explicitly say `number | undefined`, matching existing runtime behavior.

This is a type correction, not a runtime change. Strict TypeScript consumers
that previously treated these fields as unconditional numbers must narrow them
before numeric use. Check each field independently: a line does not imply that
a column is available.

Clean-package verification compiles a strict consumer against the actual packed
declarations. It rejects unconditional numeric assignments and accepts explicit
unions and narrowing. Runtime tests cover absent, located, partially located,
and actual invalid-input errors. No compiler-wide nullability setting or module
format support is changed.

Validation: 570 runtime tests, build, existing type tests, clean packed strict
consumer on Node 22.12 and 24, eight Chromium fixtures and browser failure guards
passed. The emitted runtime JavaScript bundle is byte-identical to the current
main baseline; only declaration precision changes. The baseline negative type
fixture fails with unused expected-error directives, while the corrected packed
consumer passes with both unsafe assignments rejected.

After rebasing onto the merged own-metadata-key correction, the final focused
candidate passed 576 tests, package/type checks, nine actual Chromium fixtures
and browser failure guards. The browser runner's older summary sentence still
says eight; its asserted fixture list includes all nine.
