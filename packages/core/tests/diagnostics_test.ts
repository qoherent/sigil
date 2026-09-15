import { diagnostic, orderDiagnostics } from "../src/diagnostics.ts";
import { assertEquals } from "./assert.ts";

// @sigil tests packages/core/src/diagnostics.sigil::SigilDiagnostics::NormativeDiagnostics constraints
Deno.test("diagnostics use source order and Unicode scalar ordering, not severity", () => {
  const make = (filePath?: string) =>
    diagnostic("SIGIL_PARSE_STRUCTURE", "problem", {
      filePath,
      range: { start: 2, end: 3 },
    });
  const warning = diagnostic(
    "SIGIL_IMPLEMENTATION_SOURCE_DISCOVERY",
    "advisory",
    { severity: "warning", filePath: "a.sigil", range: { start: 1, end: 2 } },
  );
  assertEquals(
    orderDiagnostics([
      make("𐀀.sigil"),
      make("\uE000.sigil"),
      make("z.sigil"),
      warning,
      make(),
    ]).map((d) => d.filePath),
    [undefined, "a.sigil", "z.sigil", "\uE000.sigil", "𐀀.sigil"],
  );
});

Deno.test("diagnostic coalescing preserves stage and related evidence with numeric related ordering", () => {
  const make = (start: number) =>
    diagnostic("SIGIL_DUPLICATE_SECTION", "duplicate", {
      filePath: "a.sigil",
      range: { start: 0, end: 1 },
      related: [{ filePath: "b.sigil", range: { start, end: start + 1 } }],
    });
  const earlier = make(2), later = make(10);
  const otherStage = { ...earlier, stage: "interpretation" as const };
  const ordered = orderDiagnostics([later, earlier, earlier, otherStage]);
  assertEquals(ordered.length, 3);
  assertEquals(ordered.map((d) => d.related[0].range?.start), [2, 2, 10]);
  assertEquals(new Set(ordered.slice(0, 2).map((d) => d.stage)).size, 2);
});
