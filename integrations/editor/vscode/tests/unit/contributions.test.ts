import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,state,logic,constraints,cases
 * @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::ComponentPreview interface,state,logic,cases
 */
test("manifest contributes the Sigil language, grammar, and preview command", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(manifest.publisher, "sigil-dev");
  assert.equal(manifest.engines.vscode, "^1.91.0");
  assert.deepEqual(manifest.capabilities, {
    untrustedWorkspaces: {
      supported: false,
      description:
        "Sigil language features require a trusted file-backed workspace.",
    },
    virtualWorkspaces: {
      supported: false,
      description: "Sigil language features require a file-backed workspace.",
    },
  });
  assert.deepEqual(manifest.contributes.languages[0].extensions, [".sigil"]);
  assert.equal(manifest.contributes.grammars[0].scopeName, "source.sigil");
  assert.equal(
    manifest.contributes.commands[0].command,
    "sigil.showComponentPreview",
  );
  assert.equal(
    manifest.contributes.commands[1].command,
    "sigil.compileComponent",
  );
  assert.equal(
    manifest.contributes.commands[2].command,
    "sigil.compileWorkspace",
  );
  assert.equal(
    manifest.contributes.commands[3].command,
    "sigil.selectCompilationFocus",
  );
  assert.equal(
    manifest.contributes.configuration.properties[
      "sigil.compile.executable"
    ].default,
    "sigil",
  );
  assert.deepEqual(
    manifest.contributes.configuration.properties[
      "sigil.compile.focus"
    ].enum,
    ["ask", "design", "implementation"],
  );
  assert.equal(
    manifest.contributes.configuration.properties[
      "sigil.compile.focus"
    ].default,
    "ask",
  );
});

/*
 * @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::ExtensionPackage interface,constraints,cases
 * @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::ArtifactVersionOwnership constraints
 */
test("package command derives the VSIX filename from the manifest version", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const packaging = await readFile("scripts/package-extension.mjs", "utf8");
  assert.equal(manifest.scripts.package.includes("sigil-vscode-0.7.1"), false);
  assert.equal(packaging.includes("manifest.version"), true);
  assert.equal(
    packaging.includes("sigil-vscode-${manifest.version}.vsix"),
    true,
  );
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,state,logic,constraints,cases
test("TextMate grammar colors syntax without treating capitalized prose as names", async () => {
  const grammar = JSON.parse(
    await readFile("syntaxes/sigil.tmLanguage.json", "utf8"),
  );
  assert.equal(grammar.scopeName, "source.sigil");
  assert(grammar.repository.imports);
  assert(grammar.repository.declarations);
  assert(grammar.repository.sections);
  assert(grammar.repository.concepts);
  assert.equal(
    grammar.repository.sections.patterns[0].match.includes("decisions"),
    true,
  );
  assert.equal(grammar.repository["type-names"], undefined);
  assert.equal(
    JSON.stringify(grammar).includes("\\\\b[A-Z][A-Za-z0-9_]*\\\\b"),
    false,
  );
  assert.equal(
    JSON.stringify(grammar).includes("entity.name.type.concept.sigil"),
    true,
  );
  assert.equal(JSON.stringify(grammar).includes("comment"), false);
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,state,logic,constraints,cases
test("manifest maps concept and glossary semantic tokens to a visible TextMate scope", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.deepEqual(
    manifest.contributes.semanticTokenScopes[0],
    {
      language: "sigil",
      scopes: {
        concept: ["entity.name.type.concept.sigil"],
        term: ["entity.name.type.concept.sigil"],
      },
    },
  );
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::EditorLanguageSupport logic,constraints,cases
test("delegates ownership-source watching to server registration", async () => {
  const source = await readFile("src/extension.ts", "utf8");
  assert.equal(source.includes("createFileSystemWatcher"), false);
  assert.equal(source.includes("synchronize:"), false);
});

/*
 * @sigil tests integrations/editor/vscode/#module.sigil::SigilVsCodeExtension::ConfigurationSchema interface,logic,constraints,cases
 */
test("bundles the configuration schema and associates it with .sigil/config.json", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const validation: Array<{ fileMatch?: string; url?: string }> =
    manifest.contributes.jsonValidation;
  assert(Array.isArray(validation), "jsonValidation contribution is missing");
  const entry = validation.find(
    (item) => item.fileMatch === "**/.sigil/config.json",
  );
  assert(entry, "jsonValidation must map .sigil/config.json");
  assert.equal(entry.url, "./schemas/sigil-config.schema.json");

  // The bundled schema must stay a verbatim copy of the published source, so a
  // stale schema in the VSIX fails here rather than shipping silently.
  const bundled = await readFile("schemas/sigil-config.schema.json", "utf8");
  const source = await readFile(
    "../../../spec/sigil-config.schema.json",
    "utf8",
  );
  assert.equal(
    bundled,
    source,
    "bundled schema is out of sync with spec/sigil-config.schema.json; run the extension build",
  );
});
