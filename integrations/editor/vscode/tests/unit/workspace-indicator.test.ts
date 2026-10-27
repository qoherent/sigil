import assert from "node:assert/strict";
import test from "node:test";
import {
  indicatorView,
  parseDocumentWorkspace,
} from "../../src/workspace-indicator.ts";

test("a served file shows its workspace name and puts the root in the tooltip", () => {
  const view = indicatorView(
    parseDocumentWorkspace({
      state: "workspace",
      name: "design",
      root: "/work/.benchmarks/run/design",
    }),
  );
  assert.equal(view.visible, true);
  assert.equal(view.warning, false);
  assert.equal(view.text, "$(root-folder) design");
  assert.match(view.tooltip, /\/work\/\.benchmarks\/run\/design/);
});

test("a file its workspace leaves out warns and carries the reason", () => {
  const view = indicatorView(
    parseDocumentWorkspace({
      state: "excluded",
      name: "outer",
      root: "/work",
      reason: "The files selection of this workspace leaves this file out.",
    }),
  );
  assert.equal(view.visible, true);
  assert.equal(view.warning, true);
  assert.match(view.text, /outer/);
  assert.match(view.tooltip, /files selection/);
});

test("a file with no workspace warns and carries the reason", () => {
  const view = indicatorView(
    parseDocumentWorkspace({
      state: "none",
      reason: "No .sigil/config.json was found above this file.",
    }),
  );
  assert.equal(view.warning, true);
  assert.equal(view.text, "$(warning) No Sigil workspace");
  assert.match(view.tooltip, /\.sigil\/config\.json/);
});

test("no answer hides the entry", () => {
  for (
    const value of [
      undefined,
      null,
      "workspace",
      {},
      { state: "workspace", name: "x" },
      { state: "excluded", name: "x", root: "/x" },
      { state: "none" },
      { state: "other", name: "x", root: "/x", reason: "r" },
    ]
  ) {
    const view = indicatorView(parseDocumentWorkspace(value));
    assert.equal(view.visible, false, JSON.stringify(value));
  }
});
