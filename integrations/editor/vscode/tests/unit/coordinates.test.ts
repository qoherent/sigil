import assert from "node:assert/strict";
import test from "node:test";
import { captureSource } from "../../../../../packages/core/src/source-text.ts";
import {
  EditorProtocolSource,
  nativeLocationRange,
  sourceDigest,
} from "../../src/coordinates.ts";

test("native byte ranges and the bundled LSP select identical visible Unicode text", () => {
  for (const ending of ["\n", "\r\n", "\r"]) {
    const raw = `\uFEFFcomponent Café {${ending}😀 *café results*${ending}}`;
    const bytes = Buffer.from(raw);
    const source = captureSource("a.sigil", bytes).source!;
    const protocol = new EditorProtocolSource(source);
    for (const needle of ["Café", "café results"]) {
      const start = source.byteOffsetAtUtf16(raw.indexOf(needle))!;
      const range = { start, end: start + Buffer.byteLength(needle) };
      const visible = raw.slice(1).replace(/\r\n|\r/g, "\n");
      const mapped = nativeLocationRange(
        {
          side: "design",
          source: "a.sigil",
          coordinate_system: "utf8-bytes",
          source_digest: sourceDigest(bytes),
          range,
        },
        bytes,
        visible,
      )!;
      assert.deepEqual(mapped, {
        start: protocol.utf16PositionAtByte(range.start),
        end: protocol.utf16PositionAtByte(range.end),
      });
      assert.equal(
        visible.split("\n")[mapped.start.line].slice(
          mapped.start.character,
          mapped.end.character,
        ),
        needle,
      );
      assert.equal(protocol.byteOffsetAtUtf16Position(mapped.start), start);
    }
  }
});
test("location projection rejects stale bytes, dirty text, surrogate splits and invalid UTF-8", () => {
  const bytes = Buffer.from("😀 example");
  const location = {
    side: "design",
    source: "a.sigil",
    coordinate_system: "utf8-bytes",
    source_digest: sourceDigest(bytes),
    range: { start: 0, end: 4 },
  } as const;
  assert.throws(
    () => nativeLocationRange(location, Buffer.from("changed"), "changed"),
    /Stale/,
  );
  assert.throws(
    () => nativeLocationRange(location, bytes, "😀 edited"),
    /does not match/,
  );
  assert.throws(
    () =>
      nativeLocationRange(
        { ...location, range: { start: 1, end: 4 } },
        bytes,
        bytes.toString(),
      ),
    /Invalid source range/,
  );
  const invalid = new Uint8Array([0xff]);
  assert.throws(
    () =>
      nativeLocationRange(
        { ...location, source_digest: sourceDigest(invalid) },
        invalid,
        "�",
      ),
    /does not match/,
  );
});
test("implementation coordinates remain explicitly one-based UTF-16 lines", () => {
  const bytes = Buffer.from("😀 value\r\nnext");
  const range = nativeLocationRange(
    {
      side: "implementation",
      source: "a.ts",
      coordinate_system: "utf16-lines",
      source_digest: sourceDigest(bytes),
      implementation_range: {
        start: { line: 1, column: 4 },
        end: { line: 1, column: 9 },
      },
    },
    bytes,
    "😀 value\nnext",
  );
  assert.deepEqual(range, {
    start: { line: 0, character: 3 },
    end: { line: 0, character: 8 },
  });
});
