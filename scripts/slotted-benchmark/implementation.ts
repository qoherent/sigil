import { join } from "node:path";
import type { FixtureIssue, FixturePreflight } from "./fixture.ts";

/** Fixture-owned answer key and overlays stay outside every reader's workspace. */
export const IMPLEMENTATION_FIXTURE = {
  version: 1 as const,
  description:
    "Repaired, trimmed Slotted design with clean TypeScript and six independent planted overlays.",
  sources: [{
    path: "slotted.sigil",
    role: "Booking requests and exclusive room state",
    imports: [],
    target: { state: "Coherent" as const, exitCode: 0 as const },
  }],
  issues: [] as readonly FixtureIssue[],
};
export interface ImplementationPlant extends FixtureIssue {
  readonly implementation: {
    readonly source: string;
    readonly element?: string;
  };
  readonly changes: readonly {
    readonly path: string;
    readonly before?: string;
    readonly after: string;
  }[];
}
export async function implementationPlants(): Promise<ImplementationPlant[]> {
  const root = new URL("./implementation/plants/", import.meta.url);
  const entries = [];
  for await (const entry of Deno.readDir(root)) {
    if (entry.isFile && entry.name.endsWith(".json")) entries.push(entry.name);
  }
  return await Promise.all(
    entries.sort().map(async (name) =>
      JSON.parse(await Deno.readTextFile(new URL(name, root)))
    ),
  );
}
export async function applyImplementationPlants(
  root: string,
  ids?: readonly string[],
): Promise<void> {
  for (const plant of await implementationPlants()) {
    if (ids && !ids.includes(plant.id)) continue;
    for (const change of plant.changes) {
      const path = join(root, change.path);
      if (change.before === undefined) {
        await Deno.writeTextFile(path, change.after, { createNew: true });
      } else {
        const text = await Deno.readTextFile(path);
        if (
          !text.includes(change.before) ||
          text.split(change.before).length !== 2
        ) throw new Error(`Plant ${plant.id} anchor drifted: ${change.path}`);
        await Deno.writeTextFile(
          path,
          text.replace(change.before, change.after),
        );
      }
    }
  }
}
export async function preflightImplementationFixture(
  root: string,
  variant: "clean" | "planted",
): Promise<FixturePreflight> {
  if (variant === "clean") {
    return { canSchedule: true, sourceDrift: [], issues: [] };
  }
  const issues = [];
  for (const plant of await implementationPlants()) {
    let reason: string | null = null;
    for (const anchor of plant.anchors) {
      if (
        !(await Deno.readTextFile(join(root, anchor.source))).includes(
          anchor.text,
        )
      ) reason = `Missing plant anchor in ${anchor.source}`;
    }
    issues.push({
      ...plant,
      status: reason ? "drift" as const : "scorable" as const,
      reason,
      facets: [],
    });
  }
  return {
    canSchedule: issues.every((i) => i.status === "scorable"),
    sourceDrift: issues.flatMap((i) => i.reason ? [i.reason] : []),
    issues,
  };
}
