import { WORD_CHARACTER_RANGES } from "./data/word-characters-15.1.ts";
import type { SourceRange } from "./model/language.ts";
import type { SourceText } from "./source-text.ts";

export function isTagWordCharacter(character: string | undefined): boolean {
  if (character === undefined) return false;
  const code = character.codePointAt(0)!;
  let low = 0, high = WORD_CHARACTER_RANGES.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const [start, end] = WORD_CHARACTER_RANGES[middle];
    if (code < start) high = middle - 1;
    else if (code > end) low = middle + 1;
    else return true;
  }
  return false;
}

/** Eligible regions already exclude physical endings, definitions and links. */
export function matchTagReferences(
  source: SourceText,
  regions: readonly SourceRange[],
  names: readonly string[],
): { name: string; range: SourceRange }[] {
  const matches: { name: string; range: SourceRange; length: number }[] = [];
  const vocabulary = names.filter((name) => name.length > 0).map((name) => ({
    name,
    length: [...name].length,
  }));
  for (const region of regions) {
    const text = source.slice(region)!;
    const scalars = [...text];
    const offsets = [0];
    for (const scalar of scalars) offsets.push(offsets.at(-1)! + scalar.length);
    const indices = new Map(offsets.map((offset, index) => [offset, index]));
    const absoluteStart = source.utf16OffsetAtByte(region.start)!;
    for (const { name, length } of vocabulary) {
      let from = 0;
      while (from < text.length) {
        const start = text.indexOf(name, from);
        if (start < 0) break;
        const end = start + name.length;
        from = start + 1;
        const a = indices.get(start), b = indices.get(end);
        if (a === undefined || b === undefined) continue;
        if (
          isTagWordCharacter(scalars[a - 1]) || isTagWordCharacter(scalars[b])
        ) continue;
        let before = a - 1, after = b;
        while (scalars[before] === "-" || scalars[before] === ".") before--;
        while (scalars[after] === "-" || scalars[after] === ".") after++;
        if (
          (before < a - 1 && isTagWordCharacter(scalars[before])) ||
          (after > b && isTagWordCharacter(scalars[after]))
        ) continue;
        matches.push({
          name,
          length,
          range: {
            start: source.byteOffsetAtUtf16(absoluteStart + start)!,
            end: source.byteOffsetAtUtf16(absoluteStart + end)!,
          },
        });
      }
    }
  }
  matches.sort((a, b) => b.length - a.length || a.range.start - b.range.start);
  const chosen: typeof matches = [];
  for (const match of matches) {
    if (
      !chosen.some((other) =>
        match.range.start < other.range.end &&
        other.range.start < match.range.end
      )
    ) chosen.push(match);
  }
  return chosen.sort((a, b) => a.range.start - b.range.start).map((
    { name, range },
  ) => ({ name, range }));
}
