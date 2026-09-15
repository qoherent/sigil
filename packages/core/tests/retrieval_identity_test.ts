import {
  RetrievalIdentityCollision,
  RetrievalIdentityRegistry,
} from "../src/retrieval-identity.ts";
import { assert, assertEquals } from "./assert.ts";

Deno.test("stable identity collisions distinguish canonical duplicates and kind domains", async () => {
  const registry = new RetrievalIdentityRegistry(() =>
    Promise.resolve("0".repeat(64))
  );
  const first = await registry.identify("n", {
    path: "a.sigil",
    range: { start: 0, end: 1 },
  });
  assertEquals(
    await registry.identify("n", {
      range: { end: 1, start: 0 },
      path: "a.sigil",
    }),
    first,
  );
  assert((await registry.identify("e", { path: "b.sigil" })).startsWith("e:"));
  let collision: unknown;
  try {
    await registry.identify("n", { path: "b.sigil" });
  } catch (error) {
    collision = error;
  }
  assert(collision instanceof RetrievalIdentityCollision);
});
