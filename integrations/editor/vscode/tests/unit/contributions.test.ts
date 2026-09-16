import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/*
 * @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,state,logic,constraints,cases
 * @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::DocumentPreview interface,state,logic,cases
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
    "sigil.openPreview",
  );
  assert.equal(
    manifest.contributes.commands[0].title,
    "Sigil: Open Preview",
  );
  assert(
    manifest.activationEvents.includes("onCommand:sigil.openPreview"),
    "activation event should reference the preview command",
  );
  assert.equal(
    manifest.contributes.commands[1].command,
    "sigil.compileFile",
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
    "sigilc",
  );
  assert.equal(
    manifest.contributes.configuration.properties["sigil.compile.profile"],
    undefined,
  );
  assert.equal(
    manifest.contributes.configuration
      .properties["sigil.compile.languageExecutable"].default,
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

test("manifest contributes the preview command to the editor title toolbar for Sigil editors", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));

  // The command carries a Codicon so it renders as a title-bar button.
  assert.equal(manifest.contributes.commands[0].icon, "$(open-preview)");

  type MenuItem = {
    command?: string;
    when?: string;
    group?: string;
  };
  const editorTitle = manifest.contributes.menus["editor/title"];
  assert(Array.isArray(editorTitle), "editor/title menu contribution missing");
  const entry = editorTitle.find(
    (item: MenuItem) => item.command === "sigil.openPreview",
  );
  assert(entry, "editor/title must contribute the preview command");
  assert.equal(entry.when, "editorLangId == sigil");
  assert.equal(entry.group, "navigation");

  // The Command Palette entry remains available and Sigil-scoped.
  const palette = manifest.contributes.menus.commandPalette.find(
    (item: MenuItem) => item.command === "sigil.openPreview",
  );
  assert(palette, "Command Palette entry must remain");
  assert.equal(palette.when, "editorLangId == sigil");
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::CompilationSurface interface,logic,cases
test("editor title compile action uses the same focus-selection command as the status bar", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const selectFocus = manifest.contributes.commands.find(
    (item: { command?: string }) =>
      item.command === "sigil.selectCompilationFocus",
  );
  assert(selectFocus, "select compilation focus command missing");
  assert.equal(selectFocus.icon, "$(play)");

  type MenuItem = {
    command?: string;
    when?: string;
    group?: string;
  };
  const editorTitle = manifest.contributes.menus["editor/title"];
  const entry = editorTitle.find(
    (item: MenuItem) => item.command === "sigil.selectCompilationFocus",
  );
  assert(entry, "editor/title must contribute select compilation focus");
  assert.equal(entry.when, "editorLangId == sigil");
  assert.equal(entry.group, "navigation");
  assert.equal(
    editorTitle.some(
      (item: MenuItem) => item.command === "sigil.compileFile",
    ),
    false,
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
  assert(grammar.repository.tags);
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
    JSON.stringify(grammar).includes("entity.name.type.tag.sigil"),
    true,
  );
  assert.equal(JSON.stringify(grammar).includes("comment"), false);
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::EditorLanguageSupport interface,state,logic,constraints,cases
test("manifest maps Tag and glossary semantic tokens to a visible TextMate scope", async () => {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  assert.deepEqual(
    manifest.contributes.semanticTokenScopes[0],
    {
      language: "sigil",
      scopes: {
        tag: ["entity.name.type.tag.sigil"],
        term: ["entity.name.type.tag.sigil"],
      },
    },
  );
});

// @sigil tests integrations/editor/vscode/_module.sigil::SigilVsCodeExtension::EditorLanguageSupport logic,constraints,cases
test("keeps LSP registration separate from compilation input invalidation", async () => {
  const source = await readFile("src/extension.ts", "utf8");
  assert.equal(source.includes("synchronize:"), false);
  assert.equal(source.includes('createFileSystemWatcher("**/*")'), true);
  assert.equal(source.includes("synchronize:"), false);
});
