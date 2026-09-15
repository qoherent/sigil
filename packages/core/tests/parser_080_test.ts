import { parseSigilDocument } from "../src/parser.ts";
import { assert, assertEquals } from "./assert.ts";
import { isEmbeddedFacet } from "../src/model/source.ts";

const parse = (source: string | Uint8Array) =>
  parseSigilDocument("fixture.sigil", source, { sigilVersion: "0.8.0" });
const component = (body: string) =>
  `component Example {\ngoal {\nA responsibility.\n}\ninterface {\n${body}\n}\n}\n`;

Deno.test("component name ranges select the name even when it repeats the keyword", () => {
  const result = parse(
    component("Offer an interaction.").replace("Example", "component"),
  );
  assertEquals(result.document.components[0].nameRange, { start: 10, end: 19 });
});

// @sigil tests packages/core/src/parser.sigil::SigilParser::SourceDocumentParsing interface
Deno.test("C01: parses minimal 0.8 source with byte ranges and optional final newline", () => {
  for (const ending of ["\n", "\r\n", "\r"]) {
    for (const final of [true, false]) {
      const lines = [
        "component Minimal {",
        "  goal {",
        "    State one responsibility.",
        "  }",
        "  interface {",
        "    Offer one interaction.",
        "  }",
        "}",
      ];
      const source = lines.join(ending) + (final ? ending : "");
      const parsed = parseSigilDocument("minimal.sigil", source, {
        sigilVersion: "0.8.0",
      });
      assertEquals(parsed.diagnostics, []);
      assertEquals(parsed.document.components.length, 1);
      const component = parsed.document.components[0];
      assertEquals(component.sections.map((s) => s.units.length), [1, 1]);
      assertEquals(component.range, {
        start: 0,
        end: new TextEncoder().encode(source).length,
      });
    }
  }
});

Deno.test("C02: retains inline introductions, repeated grouping occurrences and Facet roles", () => {
  const result = parse(
    component(
      "A *query* contains search text.\n\nquery {\nAccept a query.\n}",
    ) +
      "component Other {\ngoal {\nOwn another responsibility.\n}\ninterface {\nquery {\nOffer another query.\n}\n}\n}",
  );
  assertEquals(result.diagnostics, []);
  const first = result.document.components[0];
  assertEquals(first.sections[1].groups.length, 1);
  assertEquals(first.sections[1].units.map((f) => f.groupingTag), [
    undefined,
    "query",
  ]);
  assertEquals(first.sections[1].units[0].definitions.map((d) => d.name), [
    "query",
  ]);
});

Deno.test("C06: payload closure terminates a Facet and preserves its exact body", () => {
  const result = parse(
    component(
      "An introduction.\n\t```ts\n\tlet x = 1;  \n\t\n\t```\nNext prose.",
    ),
  );
  assertEquals(result.diagnostics, []);
  const units = result.document.components[0].sections[1].units;
  assertEquals(units.length, 2);
  assertEquals(units[0].literalBlocks.length, 1);
  assert(isEmbeddedFacet(units[0]));
  assertEquals(units[0].literalBlocks[0].rawBody, "\tlet x = 1;  \n\t\n");
  assertEquals(units[0].literalBlocks[0].body, "let x = 1;  \n\n");
  assertEquals(units[1].prose, "Next prose.");
  assertEquals(
    parse(component("Intro.\n```\n```")).document.components[0].sections[1]
      .units[0].literalBlocks[0]?.body,
    "",
  );
});

Deno.test("payload attachment errors preserve detached source without creating a Facet", () => {
  for (
    const [body, code] of [
      ["Intro.\n\n```\nx\n```", "SIGIL_DETACHED_LITERAL_BLOCK"],
      ["```\nx\n```", "SIGIL_LITERAL_WITHOUT_INTRODUCTION"],
      [
        "Intro.\n```\nx\n```\n```\ny\n```",
        "SIGIL_LITERAL_WITHOUT_INTRODUCTION",
      ],
      [
        "Intro.\n```bad type\ncomponent Fake {\n```",
        "SIGIL_INVALID_LITERAL_TYPE",
      ],
    ]
  ) {
    const result = parse(component(body));
    assertEquals(
      result.diagnostics.filter((d) => d.code.includes("LITERAL")).map((d) =>
        d.code
      ),
      [code],
    );
    assertEquals(result.document.components.length, 1);
  }
});

Deno.test("unterminated payload is inert and suppresses derived absence errors", () => {
  const result = parse(
    "component Broken {\ngoal {\nIntro.\n```\ncomponent Hidden {\n}\n",
  );
  assertEquals(result.document.components.map((c) => c.name), ["Broken"]);
  assertEquals(result.diagnostics.map((d) => d.code), [
    "SIGIL_UNCLOSED_LITERAL_BLOCK",
  ]);
  assertEquals(result.document.components[0].complete, false);
});

Deno.test("unknown sections retain balanced invalid bodies and independent later sections", () => {
  const result = parse(
    "component Example {\nunknown {\ngoal {\nHidden.\n}\n}\ngoal {\nReal.\n}\ninterface {\nOffer.\n}\n}",
  );
  assertEquals(result.diagnostics.map((d) => d.code), [
    "SIGIL_UNKNOWN_SECTION",
  ]);
  assertEquals(
    result.document.components[0].sections.map((
      s,
    ) => [s.name, s.valid, s.units.length]),
    [["unknown", false, 0], ["goal", true, 1], ["interface", true, 1]],
  );
});

Deno.test("duplicate sections remain separate with related conflict locations", () => {
  const result = parse(
    component("Offer.").replace(
      /\n}\n$/,
      "\nlogic {\nFirst.\n}\nlogic {\nSecond.\n}\n}",
    ),
  );
  const duplicates = result.diagnostics.filter((d) =>
    d.code === "SIGIL_DUPLICATE_SECTION"
  );
  assertEquals(duplicates.length, 1);
  assertEquals(duplicates[0].related.length, 1);
  assertEquals(
    result.document.components[0].sections.filter((s) => s.name === "logic")
      .length,
    2,
  );
});

Deno.test("empty and nested groups keep invalid evidence without becoming local Tags", () => {
  const empty = parse(component("Empty {\n}"));
  assertEquals(empty.diagnostics.map((d) => d.code).sort(), [
    "SIGIL_EMPTY_TAG_GROUP",
    "SIGIL_MISSING_INTERFACE",
  ]);
  const nested = parse(component("Outer {\nInner {\nText.\n}\n}"));
  assertEquals(nested.diagnostics.map((d) => d.code), [
    "SIGIL_NESTED_TAG_GROUP",
  ]);
  assertEquals(
    nested.document.components[0].sections[1].groups[0].groups[0].valid,
    false,
  );
});

Deno.test("multiline imports preserve exact selection names and recover at a new component", () => {
  const valid = parse(
    "@a.sigil from A import {\nsearch  results,\nC++,\n}\n" +
      component("Offer."),
  );
  assertEquals(valid.diagnostics, []);
  assertEquals(valid.document.imports[0].provider, "A");
  assertEquals(valid.document.imports[0].names, ["search  results", "C++"]);
  const broken = parse(
    "@a.sigil from A import {\nquery\n" + component("Offer."),
  );
  assertEquals(broken.document.imports[0].complete, false);
  assertEquals(broken.document.components.length, 1);
  assertEquals(broken.diagnostics.map((d) => d.code), [
    "SIGIL_PARSE_STRUCTURE",
  ]);
});

Deno.test("import recovery preserves a later complete import and exact provider locations", () => {
  const text =
    "@broken.sigil from Broken import {\nquery\n@from.sigil from import import { query }\n" +
    component("Offer.");
  const result = parse(text);
  assertEquals(result.document.imports.length, 2);
  assertEquals(result.document.imports[1].provider, "import");
  assertEquals(
    result.document.source?.slice(result.document.imports[1].providerRange),
    "import",
  );
  assertEquals(result.document.components.length, 1);
});

Deno.test("unclosed unknown sections preserve block errors unless a payload hides their end", () => {
  const result = parse("component A {\nunknown {\nText.");
  assertEquals(
    result.diagnostics.filter((d) => d.code === "SIGIL_UNCLOSED_BLOCK").length,
    2,
  );
  const payload = parse("component A {\nunknown {\nIntro.\n```\nhidden");
  assertEquals(
    payload.diagnostics.filter((d) => d.code === "SIGIL_UNCLOSED_BLOCK"),
    [],
  );
});

Deno.test("strict disk ingress retains independent source evidence and initial BOM offsets", () => {
  assertEquals(
    parse(new Uint8Array([0xff])).diagnostics[0].code,
    "SIGIL_INVALID_ENCODING",
  );
  const result = parse(
    new TextEncoder().encode("\uFEFF" + component("Offer.")),
  );
  assertEquals(result.diagnostics, []);
  assertEquals(result.document.components[0].nameRange.start, 13);
  assertEquals(result.document.source?.rawBytes?.[0], 0xef);
});

Deno.test("removed forms and compact structure are rejected without legacy interpretation", () => {
  for (
    const source of [
      "@x.sigil { X }",
      "expand Example {\n}",
      "component Example { goal { x } }",
      "component Example\n{\n}",
    ]
  ) {
    const result = parse(source);
    assertEquals(
      result.diagnostics.some((d) => d.code === "SIGIL_PARSE_STRUCTURE"),
      true,
    );
  }
  assertEquals(parse(component("Return { enabled: true }.")).diagnostics, []);
  assertEquals(parse("").diagnostics, []);
});

Deno.test("Unicode whitespace remains exact name content and is not structural indentation", () => {
  const result = parse(component("search\u2028results {\nOffer.\n}"));
  assertEquals(result.diagnostics, []);
  assertEquals(
    result.document.components[0].sections[1].groups[0].name,
    "search\u2028results",
  );
  const fence = parse(
    component("Intro.\n```js\u2028invalid\ncomponent Hidden {\n```"),
  );
  assertEquals(fence.diagnostics.map((d) => d.code), [
    "SIGIL_INVALID_LITERAL_TYPE",
  ]);
  assertEquals(fence.document.components.length, 1);
  assertEquals(
    parse("\u00a0" + component("Offer.")).diagnostics.some((d) =>
      d.code === "SIGIL_PARSE_STRUCTURE"
    ),
    true,
  );
});
