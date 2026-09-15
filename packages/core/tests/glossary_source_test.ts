import {
  glossaryOccurrencesForDocument,
  parseSigilGlossary,
  resolveGlossaryForFile,
} from "../src/glossary.ts";
import { parseSigilDocument } from "../src/parser.ts";
import { captureSource } from "../src/source-text.ts";
import { assert, assertEquals } from "./assert.ts";

// @sigil tests packages/core/src/glossary.sigil::SigilGlossaryEngine::TermRecognitionEngine logic,constraints
Deno.test("glossary declarations and matches share original byte coordinates", () => {
  const text =
    '{"schemaVersion":1,"terms":[{"definition":"😀 search text","term":"query"}],"contexts":[]}';
  const glossary = parseSigilGlossary(text).glossary;
  assert(glossary);
  const range = glossary.terms[0].declarationRange;
  const expected =
    new TextEncoder().encode(text.slice(0, text.indexOf("query"))).length;
  assertEquals(range, { start: expected, end: expected + 5 });
  assertEquals(
    captureSource("glossary.json", text).source?.slice(range),
    "query",
  );
  const input =
    "\uFEFFcomponent A {\r\ngoal {\r\nResponsibility.\r\n}\r\ninterface {\r\n😀 e\u0301 query.\r\n}\r\n}";
  const document =
    parseSigilDocument("a.sigil", input, { sigilVersion: "0.8.0" }).document;
  const context = resolveGlossaryForFile(glossary, "a.sigil").context;
  const occurrences = glossaryOccurrencesForDocument(context, document);
  assertEquals(occurrences.length, 1);
  assertEquals(document.source?.slice(occurrences[0].range), "query");
  assertEquals(
    occurrences[0].range.start,
    new TextEncoder().encode(input.slice(0, input.indexOf("query"))).length,
  );
});
