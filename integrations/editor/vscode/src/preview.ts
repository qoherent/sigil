export interface HoverLike {
  readonly contents: unknown;
}

export function hoverToMarkdown(
  hover: HoverLike | null | undefined,
): string | undefined {
  if (!hover) return undefined;
  const values = Array.isArray(hover.contents)
    ? hover.contents
    : [hover.contents];
  const markdown = values.map(markedValue).filter((value): value is string =>
    value !== undefined && value.length > 0
  );
  return markdown.length ? markdown.join("\n\n") : undefined;
}

function markedValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!isRecord(value) || typeof value.value !== "string") return undefined;
  if (value.kind === "markdown" || value.kind === "plaintext") {
    return value.value;
  }
  if (typeof value.language === "string") {
    return `\`\`\`${value.language}\n${value.value}\n\`\`\``;
  }
  return value.value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
