import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest contributes the Sigil language, grammar, and preview command", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.publisher, "sigil-dev");
  assert.equal(manifest.engines.vscode, "^1.91.0");
  assert.deepEqual(manifest.contributes.languages[0].extensions, [".sigil"]);
  assert.equal(manifest.contributes.grammars[0].scopeName, "source.sigil");
  assert.equal(
    manifest.contributes.commands[0].command,
    "sigil.showComponentPreview",
  );
});

test("TextMate grammar colors syntax without treating capitalized prose as names", async () => {
  const grammar = JSON.parse(
    await readFile("syntaxes/sigil.tmLanguage.json", "utf8"),
  );
  assert.equal(grammar.scopeName, "source.sigil");
  assert(grammar.repository.imports);
  assert(grammar.repository.declarations);
  assert(grammar.repository.sections);
  assert.equal(grammar.repository["type-names"], undefined);
  assert.equal(
    JSON.stringify(grammar).includes("\\\\b[A-Z][A-Za-z0-9_]*\\\\b"),
    false,
  );
  assert.equal(JSON.stringify(grammar).includes("entity.name.type"), false);
  assert.equal(JSON.stringify(grammar).includes("comment"), false);
});
