import { scanInlineContent } from "../src/inline-content.ts";
import { captureSource } from "../src/source-text.ts";
import { assert, assertEquals } from "./assert.ts";
import commonmark from "./fixtures/commonmark-inline-links.json" with {
  type: "json",
};

function scan(text: string) {
  const source = captureSource("inline.sigil", text).source!;
  return scanInlineContent("inline.sigil", source, {
    start: 0,
    end: source.byteLength,
  });
}

// @sigil tests packages/core/src/parser.sigil::SigilParser::PhysicalSource constraints
Deno.test("C04: inline definitions use physical boundaries and backticks are ordinary", () => {
  for (
    const [text, count, codes] of [
      ["A *query* contains text.", 1, []],
      ["A `*query*` contains text.", 0, []],
      ["A *query*.", 1, []],
      ["(*query*)", 0, []],
      ["prefix*query*suffix", 0, []],
      ["A * query * contains text.", 0, []],
      ["quantity * unitPrice * discount", 0, []],
      ["A *query\n", 0, ["SIGIL_INCOMPLETE_TAG"]],
      ["A *request, result* contains text.", 0, ["SIGIL_INVALID_TAG_NAME"]],
      ["*search results* and *search  results*", 2, []],
    ] as const
  ) {
    const result = scan(text);
    assertEquals(result.definitions.filter((d) => d.valid).length, count);
    assertEquals(result.diagnostics.map((d) => d.code), codes);
  }
  assertEquals(scan("*é* and *e\u0301*").definitions.map((d) => d.name), [
    "é",
    "e\u0301",
  ]);
});

Deno.test("complete links protect nested syntax, escaped destinations and multiline titles", () => {
  const text =
    '😀 [*query*](<./a\\>b&amp;c.md> "a\n title") and ![query](image.svg)';
  const result = scan(text);
  assertEquals(result.definitions, []);
  assertEquals(
    result.links.map((l) => [l.label, l.destination, l.title, l.image]),
    [
      ["*query*", "./a>b&c.md", "a\n title", false],
      ["query", "image.svg", undefined, true],
    ],
  );
  assertEquals(result.links[0].range.start, 5);
  assertEquals(
    result.links[0].raw,
    '[*query*](<./a\\>b&amp;c.md> "a\n title")',
  );
  assertEquals(scan("`[*query*](a.md)`").links.length, 1);
  assertEquals(
    scan("[x](foo(and(bar)))").links[0].destination,
    "foo(and(bar))",
  );
  assertEquals(scan('[x]("title")').links[0].destination, '"title"');
  assertEquals(scan('[x]( "title")').links[0].destination, '"title"');
  assertEquals(scan('[x](<> "title")').links[0].destination, "");
});

Deno.test("malformed links do not hide Tag definitions or consume later complete links", () => {
  const result = scan("[ *query* ](unfinished and [good](ok.md)");
  assertEquals(result.definitions.map((d) => d.name), ["query"]);
  assertEquals(result.links.map((l) => l.destination), ["ok.md"]);
  assertEquals(scan("[x](a b)").links, []);
  assertEquals(scan("[x](<a\nb>)").links, []);
  assertEquals(scan('[x](a "unclosed)').links, []);
  assertEquals(scan("[x][reference]").links, []);
});

Deno.test("CommonMark nesting permits images in links and forbids links in links", () => {
  assertEquals(scan("[outer [inner](b)](a)").links.map((l) => l.destination), [
    "b",
  ]);
  const result = scan("[outer ![image](b)](a)");
  assertEquals(result.links.map((l) => l.destination), ["a", "b"]);
  assert(
    result.eligible.every((r) =>
      r.end <= result.links[0].range.start ||
      r.start >= result.links[0].range.end
    ),
  );
  assertEquals(scan("\\[escaped](x)").links, []);
});

Deno.test("adopted CommonMark 0.31.2 inline-link examples retain complete references", async (t) => {
  for (const example of commonmark.cases) {
    await t.step(String(example.example), () => {
      const links = example.markdown.split(/\n[ \t]*\n/).flatMap((paragraph) =>
        scan(paragraph).links
      );
      assertEquals(links.length, example.references);
      for (const link of links) {
        assert(link.raw.includes(link.label));
      }
    });
  }
});
