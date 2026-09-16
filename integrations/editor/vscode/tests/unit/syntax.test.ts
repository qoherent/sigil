import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { INITIAL, parseRawGrammar, Registry } from "vscode-textmate";
import {
  createOnigScanner,
  createOnigString,
  loadWASM,
} from "vscode-oniguruma";

test("TextMate recognizes 0.8 imports and Tags while protecting links and payloads", async () => {
  const wasm = await readFile(
    "node_modules/vscode-oniguruma/release/onig.wasm",
  );
  await loadWASM(
    wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
  );
  const registry = new Registry({
    onigLib: Promise.resolve({ createOnigScanner, createOnigString }),
    loadGrammar: async () =>
      parseRawGrammar(
        await readFile("syntaxes/sigil.tmLanguage.json", "utf8"),
        "sigil.json",
      ),
  });
  const grammar = (await registry.loadGrammar("source.sigil"))!;
  let stack = INITIAL;
  const tokens = (line: string) => {
    const result = grammar.tokenizeLine(line, stack);
    stack = result.ruleStack;
    return result.tokens.map((t) => ({
      text: line.slice(t.startIndex, t.endIndex),
      scopes: t.scopes,
    }));
  };
  const tags = (line: string) =>
    tokens(line).filter((t) => t.scopes.includes("entity.name.type.tag.sigil"))
      .map((t) => t.text);
  tokens("@provider.sigil from Provider import {");
  assert.deepEqual(tags("  café results, Owner Tag"), [
    "café results",
    "Owner Tag",
  ]);
  tokens("}");
  assert.deepEqual(tags("  café results {"), ["café results"]);
  assert.deepEqual(tags("😀 A *café results* is owned."), ["café results"]);
  assert.deepEqual(tags("See [*not a Tag*](./notes.md)."), []);
  tokens("```typescript");
  assert.deepEqual(tags("component Fake {"), []);
  assert.deepEqual(tags("*not a Tag*"), []);
  tokens("```");
  assert.deepEqual(tags("*visible again*"), ["visible again"]);
  assert(
    !tokens("expand Legacy {").some((t) =>
      t.scopes.includes("keyword.declaration.sigil")
    ),
  );
});
