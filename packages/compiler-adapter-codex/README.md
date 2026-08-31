# @qoherent/sigil-compiler-adapter-codex

The Codex CLI adapter for the Sigil compiler.

The compiler is provider-neutral: it owns adapter contracts, execution
coordination, and capability validation, but no provider implementation. This
package owns Codex invocation, event-stream parsing, and telemetry, and the CLI
registers it alongside the other adapter packages.

```ts
import { CodexAdapter } from "@qoherent/sigil-compiler-adapter-codex";

const report = await compile(workspacePath, target, "standard", {
  adapters: [new CodexAdapter(model)],
});
```

Configure an evaluator with provider `codex` and implementation identity
`builtin.codex-cli`. The provider identifier is opaque to the compiler; it is
matched against the registered adapter's declaration.

`deno task test:compiler-adapter-codex` runs this package's tests.
