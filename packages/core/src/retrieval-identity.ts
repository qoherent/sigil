import { canonicalJson, sha256Canonical } from "./canonical.ts";

export class RetrievalIdentityCollision extends Error {}

/** One request owns all item domains, including candidates later excluded. */
export class RetrievalIdentityRegistry {
  readonly #objects = new Map<string, string>();
  constructor(
    private readonly hash: (value: unknown) => Promise<string> =
      sha256Canonical,
  ) {}
  async identify(
    kind: "n" | "e" | "v" | "r" | "x",
    object: unknown,
  ): Promise<string> {
    const canonical = canonicalJson(object);
    const identity = `${kind}:${await this.hash(object)}`;
    const previous = this.#objects.get(identity);
    if (previous !== undefined && previous !== canonical) {
      throw new RetrievalIdentityCollision(
        "Different canonical retrieval items share an identity.",
      );
    }
    this.#objects.set(identity, canonical);
    return identity;
  }
}
