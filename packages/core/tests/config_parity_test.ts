import { Ajv2020 } from "ajv-2020";
import { parseSigilConfig, SIGIL_VERSION } from "../src/mod.ts";

// Parity suite for the Sigil workspace configuration contract, which is defined
// twice: the strict parser in packages/core/src/config.ts and the published
// JSON Schema in spec/sigil-config.schema.json. Each fixture is evaluated by
// both representations. Structural cases must agree; documented cases capture
// checks the schema cannot (or does not) express; malformed-source cases apply
// only to the parser, which owns JSON parsing.
//
// This suite is acceptance-focused: it compares valid/invalid outcomes, not the
// parser's diagnostic codes or messages (those stay in the focused parser
// tests). It must not be "fixed" by changing either contract representation; a
// discovered mismatch is recorded here and escalated to a separate review.
//
// Note: the parser accepts exactly the one supported language version. That
// version is SIGIL_VERSION (currently "0.5.0"), imported here so the suite stays
// correct across version bumps rather than hard-coding it.

type Category =
  | "structural-parity"
  | "parser-only-semantic"
  | "malformed-source";

interface Fixture {
  // Describes the rule under test, not a sequence number.
  readonly name: string;
  readonly category: Category;
  // Raw .sigil/config.json source, so malformed-JSON cases are expressible.
  readonly source: string;
  // Expected parser acceptance (config produced with no rejecting diagnostics).
  readonly parserValid: boolean;
  // Expected schema acceptance. Structural cases derive this from parserValid;
  // parser-only-semantic cases state the (differing) schema outcome explicitly.
  readonly schemaValid?: boolean;
  // Required for parser-only-semantic: why the two representations differ.
  readonly reason?: string;
  // Required for parser-only-semantic: the configuration rule that governs it.
  readonly rule?: string;
}

const V = SIGIL_VERSION;
const workspace = { name: "demo" };
const files = { include: ["**/*.sigil"] };
const valid = { sigilVersion: V, workspace, files };
const src = (value: unknown): string => JSON.stringify(value);

const fixtures: readonly Fixture[] = [
  // ---- structural parity: valid ----
  {
    name: "minimal-required-fields",
    category: "structural-parity",
    source: src(valid),
    parserValid: true,
  },
  {
    name: "all-fields-present",
    category: "structural-parity",
    parserValid: true,
    source: src({
      sigilVersion: V,
      workspace: { name: "demo", members: ["pkg-a", "pkg-b"] },
      files: { include: ["**/*.sigil", "docs/**"], exclude: ["build/**"] },
      tools: { qmb: { level: "info" } },
    }),
  },
  {
    name: "workspace-name-internal-whitespace",
    category: "structural-parity",
    parserValid: true,
    source: src({ ...valid, workspace: { name: "my workspace" } }),
  },
  {
    name: "members-empty-array",
    category: "structural-parity",
    parserValid: true,
    source: src({ ...valid, workspace: { name: "demo", members: [] } }),
  },
  {
    name: "members-nested-directories",
    category: "structural-parity",
    parserValid: true,
    source: src({
      ...valid,
      workspace: { name: "demo", members: ["a/b", "c"] },
    }),
  },
  {
    name: "files-exclude-empty-array",
    category: "structural-parity",
    parserValid: true,
    source: src({ ...valid, files: { include: ["**/*.sigil"], exclude: [] } }),
  },
  {
    name: "tools-empty-object",
    category: "structural-parity",
    parserValid: true,
    source: src({ ...valid, tools: {} }),
  },
  {
    name: "tools-arbitrary-settings",
    category: "structural-parity",
    parserValid: true,
    source: src({ ...valid, tools: { qmb: { a: 1, b: { c: 2 } }, other: {} } }),
  },

  // ---- structural parity: required fields ----
  {
    name: "missing-sigilVersion",
    category: "structural-parity",
    parserValid: false,
    source: src({ workspace, files }),
  },
  {
    name: "missing-workspace",
    category: "structural-parity",
    parserValid: false,
    source: src({ sigilVersion: V, files }),
  },
  {
    name: "missing-files",
    category: "structural-parity",
    parserValid: false,
    source: src({ sigilVersion: V, workspace }),
  },
  {
    name: "missing-workspace-name",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: {} }),
  },
  {
    name: "missing-files-include",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, files: {} }),
  },

  // ---- structural parity: unknown properties at every object level ----
  {
    name: "unknown-top-level-key",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, extra: 1 }),
  },
  {
    name: "unknown-workspace-key",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", extra: 1 } }),
  },
  {
    name: "unknown-files-key",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, files: { include: ["**/*.sigil"], extra: 1 } }),
  },

  // ---- structural parity: root shape ----
  {
    name: "root-is-array",
    category: "structural-parity",
    parserValid: false,
    source: "[]",
  },
  {
    name: "root-is-string",
    category: "structural-parity",
    parserValid: false,
    source: '"nope"',
  },
  {
    name: "root-is-null",
    category: "structural-parity",
    parserValid: false,
    source: "null",
  },

  // ---- structural parity: sigilVersion ----
  {
    name: "sigilVersion-not-string",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, sigilVersion: 123 }),
  },
  {
    name: "sigilVersion-not-semver",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, sigilVersion: "not-a-version" }),
  },

  // ---- structural parity: workspace ----
  {
    name: "workspace-not-object",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: "demo" }),
  },
  {
    name: "workspace-name-not-string",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: 5 } }),
  },
  {
    name: "workspace-name-empty",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "" } }),
  },
  {
    name: "workspace-name-only-whitespace",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "   " } }),
  },
  {
    name: "workspace-name-surrounding-whitespace",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: " demo " } }),
  },

  // ---- structural parity: workspace.members ----
  {
    name: "members-not-array",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", members: "a" } }),
  },
  {
    name: "members-item-not-string",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", members: [1] } }),
  },
  {
    name: "members-duplicate",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", members: ["a", "a"] } }),
  },
  {
    name: "member-single-dot",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", members: ["."] } }),
  },
  {
    name: "member-absolute-path",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", members: ["/abs"] } }),
  },
  {
    name: "member-parent-traversal",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", members: ["../up"] } }),
  },
  {
    name: "member-embedded-parent-traversal",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", members: ["a/../b"] } }),
  },
  {
    name: "member-current-dir-segment",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", members: ["a/./b"] } }),
  },
  {
    name: "member-drive-letter",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", members: ["C:/abs"] } }),
  },
  {
    name: "member-backslash",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", members: ["a\\b"] } }),
  },
  {
    name: "member-trailing-slash",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", members: ["a/"] } }),
  },
  {
    name: "member-double-slash",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, workspace: { name: "demo", members: ["a//b"] } }),
  },

  // ---- structural parity: files.include / files.exclude ----
  {
    name: "files-not-object",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, files: [] }),
  },
  {
    name: "include-not-array",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, files: { include: "**/*.sigil" } }),
  },
  {
    name: "include-empty-array",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, files: { include: [] } }),
  },
  {
    name: "include-item-empty-string",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, files: { include: [""] } }),
  },
  {
    name: "include-item-not-string",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, files: { include: [1] } }),
  },
  {
    name: "include-absolute-path",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, files: { include: ["/abs/**"] } }),
  },
  {
    name: "include-parent-traversal",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, files: { include: ["../up/**"] } }),
  },
  {
    name: "include-backslash",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, files: { include: ["a\\b"] } }),
  },
  {
    name: "exclude-item-empty-string",
    category: "structural-parity",
    parserValid: false,
    source: src({
      ...valid,
      files: { include: ["**/*.sigil"], exclude: [""] },
    }),
  },
  {
    name: "exclude-absolute-path",
    category: "structural-parity",
    parserValid: false,
    source: src({
      ...valid,
      files: { include: ["**/*.sigil"], exclude: ["/abs/**"] },
    }),
  },

  // ---- structural parity: tools ----
  {
    name: "tools-not-object",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, tools: [] }),
  },
  {
    name: "tools-value-not-object",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, tools: { qmb: 1 } }),
  },
  {
    name: "tools-value-array",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, tools: { qmb: [] } }),
  },
  {
    name: "tools-empty-name",
    category: "structural-parity",
    parserValid: false,
    source: src({ ...valid, tools: { "": {} } }),
  },

  // ---- parser-only semantic: JSON Schema cannot (or does not) express these ----
  {
    name: "sigilVersion-older-but-well-formed",
    category: "parser-only-semantic",
    source: src({ ...valid, sigilVersion: "0.1.0" }),
    parserValid: false,
    schemaValid: true,
    reason:
      "0.1.0 is a well-formed semantic version, so the schema (which only validates the version string format) accepts it; the parser accepts only the single supported language version.",
    rule:
      "SigilWorkspaceConfig::ConfiguredLanguageVersion — the configured sigilVersion must equal a language version supported by the interpreting tool (parser diagnostic SIGIL_UNSUPPORTED_VERSION).",
  },
  {
    name: "sigilVersion-newer-but-well-formed",
    category: "parser-only-semantic",
    source: src({ ...valid, sigilVersion: "9.9.9" }),
    parserValid: false,
    schemaValid: true,
    reason:
      "The schema validates only the semantic-version format, so a future version is accepted; the parser rejects any version other than the one it supports.",
    rule:
      "SigilWorkspaceConfig::ConfiguredLanguageVersion — the configured sigilVersion must equal a language version supported by the interpreting tool (parser diagnostic SIGIL_UNSUPPORTED_VERSION).",
  },
  {
    name: "members-overlapping-prefix",
    category: "parser-only-semantic",
    source: src({
      ...valid,
      workspace: { name: "demo", members: ["a", "a/b"] },
    }),
    parserValid: false,
    schemaValid: true,
    reason:
      "Overlap is a relationship between two array items (one member path is a prefix of another); JSON Schema cannot express a cross-item path-prefix constraint, so the schema accepts overlapping members.",
    rule:
      "SigilWorkspaceConfig::WorkspaceBoundary — member paths are unique, non-root, workspace-relative directories that cannot escape the workspace or overlap.",
  },
  {
    name: "member-leading-whitespace",
    category: "parser-only-semantic",
    source: src({ ...valid, workspace: { name: "demo", members: [" a"] } }),
    parserValid: false,
    schemaValid: true,
    reason:
      "The parser requires normalized (trimmed) member paths, but the published schema's member pattern does not reject surrounding whitespace, so it accepts a leading space. Candidate schema gap; do not fix here.",
    rule:
      "SigilWorkspaceConfig::WorkspaceBoundary — member paths are unique, non-root, workspace-relative directories.",
  },
  {
    name: "member-trailing-whitespace",
    category: "parser-only-semantic",
    source: src({ ...valid, workspace: { name: "demo", members: ["a "] } }),
    parserValid: false,
    schemaValid: true,
    reason:
      "As with leading whitespace, the parser rejects an untrimmed member while the schema's member pattern only forbids a trailing slash, not trailing whitespace. Candidate schema gap; do not fix here.",
    rule:
      "SigilWorkspaceConfig::WorkspaceBoundary — member paths are unique, non-root, workspace-relative directories.",
  },

  // ---- malformed source: parser owns JSON parsing; schema sees only parsed JSON ----
  {
    name: "malformed-empty-source",
    category: "malformed-source",
    parserValid: false,
    source: "",
  },
  {
    name: "malformed-not-json",
    category: "malformed-source",
    parserValid: false,
    source: "not json",
  },
  {
    name: "malformed-trailing-comma",
    category: "malformed-source",
    parserValid: false,
    source: `{"sigilVersion":"${V}",}`,
  },
  {
    name: "malformed-unclosed-object",
    category: "malformed-source",
    parserValid: false,
    source: "{",
  },
];

// Compile the published schema once with a standards-compliant draft 2020-12
// validator. strict:false keeps annotation keywords such as `default` from
// being treated as errors during validation.
const schemaText = await Deno.readTextFile(
  new URL("../../../spec/sigil-config.schema.json", import.meta.url),
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(JSON.parse(schemaText));

function parserAccepts(source: string): boolean {
  return parseSigilConfig(source).config !== undefined;
}

/*
 * @sigil tests spec/language.sigil::SigilWorkspaceConfig::ConfiguredLanguageVersion interface,constraints
 * @sigil tests spec/language.sigil::SigilWorkspaceConfig::WorkspaceBoundary interface,constraints
 * @sigil tests spec/language.sigil::SigilWorkspaceConfig::SourceSelection interface,constraints
 * @sigil tests spec/language.sigil::SigilWorkspaceConfig::ToolConfiguration interface
 */
Deno.test("config parser and JSON Schema agree on the configuration contract", async (t) => {
  for (const fixture of fixtures) {
    await t.step(`${fixture.category}: ${fixture.name}`, () => {
      const parserValid = parserAccepts(fixture.source);
      assertEquals(
        parserValid,
        fixture.parserValid,
        `${fixture.name}: parser disagreed`,
      );

      if (fixture.category === "malformed-source") {
        // The schema validator only sees parsed JSON, so malformed source is
        // exclusively the parser's concern; there is nothing to compare.
        return;
      }

      const expectedSchemaValid = fixture.category === "structural-parity"
        ? fixture.parserValid
        : requireDocumentedSchemaExpectation(fixture);

      const schemaValid = validateSchema(JSON.parse(fixture.source));
      assertEquals(
        schemaValid,
        expectedSchemaValid,
        `${fixture.name}: schema disagreed`,
      );

      if (fixture.category === "structural-parity") {
        assertEquals(
          parserValid,
          schemaValid,
          `${fixture.name}: PARITY MISMATCH (parser=${parserValid}, schema=${schemaValid})`,
        );
      }
    });
  }
});

// A parser-only-semantic fixture must document why the representations differ
// and which configuration rule governs the difference.
function requireDocumentedSchemaExpectation(fixture: Fixture): boolean {
  assert(
    fixture.schemaValid !== undefined,
    `${fixture.name}: parser-only-semantic fixture must state schemaValid`,
  );
  assert(
    !!fixture.reason && fixture.reason.length > 0,
    `${fixture.name}: parser-only-semantic fixture must give a reason`,
  );
  assert(
    !!fixture.rule && fixture.rule.length > 0,
    `${fixture.name}: parser-only-semantic fixture must reference a rule`,
  );
  return fixture.schemaValid;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${
        JSON.stringify(actual)
      }`,
    );
  }
}
