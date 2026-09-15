import { captureSource } from "../src/source-text.ts";
import { assert, assertEquals } from "./assert.ts";

// @sigil tests packages/core/src/model/source.sigil::SigilSourceModel::SourceModel interface
Deno.test("source capture preserves BOM, disk bytes and every physical ending", () => {
  const text = "\uFEFFa😀e\u0301\r\nb\rc\n";
  const bytes = new TextEncoder().encode(text);
  const result = captureSource("unicode.sigil", bytes);
  assertEquals(result.diagnostics, []);
  const source = result.source;
  assert(source);
  assertEquals(source.text, text);
  assertEquals(source.origin, "disk");
  assertEquals([...source.rawBytes!], [...bytes]);
  assertEquals(source.lines.map((line) => line.ending), [
    "\r\n",
    "\r",
    "\n",
    "",
  ]);
  assertEquals(source.lines.map((line) => line.content), [
    "\uFEFFa😀e\u0301",
    "b",
    "c",
    "",
  ]);
  assertEquals(source.byteOffsetAtLocation({ line: 1, column: 3 }), 4);
  assertEquals(source.locationAtByte(8), { line: 1, column: 4 });
  assertEquals(source.utf16PositionAtByte(8), { line: 0, character: 4 });
  assertEquals(
    source.byteOffsetAtUtf16Position({ line: 0, character: 3 }),
    undefined,
  );
  assertEquals(source.utf16OffsetAtByte(5), undefined);
  for (let offset = 0; offset <= source.byteLength; offset++) {
    const utf16 = source.utf16OffsetAtByte(offset);
    if (utf16 !== undefined) {
      assertEquals(source.byteOffsetAtUtf16(utf16), offset);
    }
    const location = source.locationAtByte(offset);
    if (location) assertEquals(source.byteOffsetAtLocation(location), offset);
  }
  assertEquals(source.slice({ start: 4, end: 8 }), "😀");
  bytes[0] = 0;
  assertEquals(source.rawBytes![0], 0xef);
  const exposed = source.rawBytes!;
  exposed[0] = 0;
  assertEquals(source.rawBytes![0], 0xef);
});

Deno.test("strict decoding rejects malformed UTF-8 without replacement text", () => {
  for (
    const bytes of [
      [0x61, 0xff],
      [0xc0, 0x80],
      [0xed, 0xa0, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
      [0xe2, 0x82],
      [0x80],
    ]
  ) {
    const result = captureSource("bad.sigil", new Uint8Array(bytes));
    assertEquals(result.source, undefined);
    assertEquals(result.diagnostics.map((d) => d.code), [
      "SIGIL_INVALID_ENCODING",
    ]);
    assertEquals(result.diagnostics[0].range?.start, bytes[0] === 0x61 ? 1 : 0);
    assertEquals([...result.rawBytes!], bytes);
  }
});

Deno.test("text overlays validate scalars and do not claim original disk bytes", () => {
  const valid = captureSource("overlay.sigil", "a😀\uFEFF");
  assert(valid.source);
  assertEquals(valid.source.origin, "text");
  assertEquals(valid.source.rawBytes, undefined);
  assertEquals(valid.source.byteLength, 8);
  for (const text of ["a\ud800", "\udc00b", "a\ud800b"]) {
    const invalid = captureSource("overlay.sigil", text);
    assertEquals(invalid.source, undefined);
    assertEquals(invalid.rawText, text);
    assertEquals(invalid.diagnostics[0].code, "SIGIL_INVALID_CHARACTER");
    assertEquals(invalid.diagnostics[0].range, undefined);
  }
});

Deno.test("NUL is invalid source but its exact scalar snapshot remains available", () => {
  const result = captureSource("nul.sigil", "😀\0x");
  assert(result.source);
  assertEquals(result.source.text, "😀\0x");
  assertEquals(result.diagnostics.map((d) => d.code), [
    "SIGIL_INVALID_CHARACTER",
  ]);
  assertEquals(result.diagnostics[0].range, { start: 4, end: 5 });
});
