import assert from "node:assert/strict";
import test from "node:test";
import { hoverToMarkdown } from "../../src/preview.ts";

test("returns Markdown markup content unchanged", () => {
  assert.equal(
    hoverToMarkdown({ contents: { kind: "markdown", value: "### Thing" } }),
    "### Thing",
  );
});

test("combines marked strings and fenced language content", () => {
  assert.equal(
    hoverToMarkdown({
      contents: ["Contract", {
        language: "sigil",
        value: "component Thing {}",
      }],
    }),
    "Contract\n\n```sigil\ncomponent Thing {}\n```",
  );
});

test("returns undefined for absent or empty hover content", () => {
  assert.equal(hoverToMarkdown(null), undefined);
  assert.equal(hoverToMarkdown({ contents: [] }), undefined);
});
