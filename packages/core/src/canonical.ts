/*
 * @sigil implements packages/core/src/context-retrieval.sigil::SigilContextRetrieval::PurposeRetrievalResult logic,constraints
 * @sigil implements packages/core/src/workspace.sigil::SigilWorkspaceLoader::WorkspaceSnapshotIdentity logic,constraints
 */
export function canonicalJson(value: unknown): string {
  if (
    value === null || typeof value === "boolean" || typeof value === "string"
  ) return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Canonical JSON does not support non-finite numbers.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record).filter((key) => record[key] !== undefined).sort().map(
        (key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
      ).join(",")
    }}`;
  }
  throw new TypeError("Value is not representable as canonical JSON.");
}

export async function sha256Canonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
