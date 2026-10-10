import { join, resolve } from "node:path";
import { SIGIL_VERSION } from "../packages/core/src/model/language.ts";
import {
  deepStrictEqual as assertEquals,
  ok as assert,
} from "node:assert/strict";

type Run = (
  executable: string,
  args: string[],
  code?: number,
) => Promise<string>;
/** Every Facet id under a Component's sections, in document order. */
function facetIds(component: unknown): string[] {
  const found: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      const node = value as Record<string, unknown>;
      if (node.kind === "facet" && typeof node.id === "string") {
        found.push(node.id);
      }
      Object.values(node).forEach(walk);
    }
  };
  walk((component as { sections: unknown }).sections);
  return found;
}

/** Canned readings exercise the native protocol, not model interpretation quality. */
export async function validateNativeProtocol(
  { language, compiler, fixture, scratch, run }: {
    language: string;
    compiler: string;
    fixture: string;
    scratch: string;
    run: Run;
  },
) {
  const store = join(scratch, "store");
  const configPath = join(fixture, ".sigil/config.json");
  const config = JSON.parse(await Deno.readTextFile(configPath));
  config.tools = { sigilc: { implementation: { paths: ["main.any"] } } };
  await Deno.writeTextFile(configPath, JSON.stringify(config));
  const native = async (args: string[], code = 0) =>
    JSON.parse(
      await run(compiler, [...args, "--root", fixture, "--store", store], code),
    );
  assertEquals((await run(compiler, ["--version"])).trim(), "sigilc 0.3.0");
  const tree = await native(["tree"]);
  assert(
    tree.trees.flatMap((t: { parse: { components: unknown[] } }) =>
      t.parse.components.flatMap(facetIds)
    ).length,
  );
  const inspect = async (args: string[], state: string, code: number) => {
    const summary = await native(args, code);
    assertEquals(summary.state, state);
    const report = JSON.parse(await Deno.readTextFile(summary.report));
    const context = JSON.parse(
      await Deno.readTextFile(summary.judgmentContext),
    );
    assertEquals(report.state, state);
    assertEquals(report.version, args[0] === "align" ? 1 : 6);
    assertEquals(context.identity, report.identity);
    return report;
  };
  await inspect(["check"], "incomplete", 1);
  await inspect(["align", "check"], "incomplete", 1);
  let round = 0;
  const design = async (mode: "coherent" | "loose" | "disjoint") => {
    // Each canned scenario starts with fresh readings of unchanged source bytes.
    await Deno.remove(join(store, "claims/interpretations"), {
      recursive: true,
    }).catch((e) => {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    });
    const out = join(scratch, `design-${round++}`);
    await native(["prepare", "--source", "main.sigil", "--out", out]);
    const request = JSON.parse(
      await Deno.readTextFile(join(out, "request.json")),
    );
    const rows = request.rows.filter((f: { context?: boolean }) => !f.context)
      .map((f: { facet: string; section: string }) => {
        const id = JSON.stringify(f.facet);
        if (f.section !== "interface") return `(reading ${id} "no-commitment")`;
        if (mode === "loose") {
          return `(property ${id} "fixture operation" "required" "true")`;
        }
        const claim =
          `(claim ${id} "ReleaseFixture" "provides" "fixture operation" "required" "true")`;
        return mode === "disjoint"
          ? claim +
            `\n(claim ${id} "ReleaseFixture" "provides" "fixture operation" "required" "false")`
          : claim;
      }).join("\n");
    const answer = join(out, "answer.egg");
    await Deno.writeTextFile(answer, rows);
    await native([
      "ingest",
      "--binding",
      join(out, "binding.json"),
      "--claims",
      answer,
    ], mode === "disjoint" ? 1 : 0);
  };
  const code = async (mapped: boolean, owns = false) => {
    await Deno.remove(join(store, "claims/implementation"), { recursive: true })
      .catch((e) => {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      });
    const out = join(scratch, `code-${round++}`);
    const prepared = await native(["align", "prepare", "--out", out]);
    assertEquals(prepared.requestedUnits, 1);
    const dir = prepared.inputs[0];
    const answer = join(dir, "answer.egg");
    await Deno.writeTextFile(
      answer,
      `(element "operation" "function")\n` +
        (mapped
          ? `(realizes "operation" "ReleaseFixture")\n(realizes "operation" "ReleaseFixture::fixture operation")\n`
          : ""),
    );
    if (owns) {
      await Deno.writeTextFile(
        answer,
        '(act "operation" "owns" "ReleaseFixture::fixture operation")\n',
        { append: true },
      );
    }
    await native([
      "align",
      "ingest",
      "--binding",
      join(dir, "binding.json"),
      "--claims",
      answer,
    ]);
  };
  await design("coherent");
  await inspect(["check"], "coherent", 0);
  await inspect(["align", "check"], "incomplete", 1);
  await code(true);
  await inspect(["align", "check"], "closed", 0);
  await design("loose");
  await inspect(["check"], "loose", 0);
  await code(true, true);
  await inspect(["align", "check"], "converged", 0);
  await design("coherent");
  await code(false);
  const drift = await inspect(["align", "check"], "drift", 1);
  assert(drift.undesignedElements.length);
  await design("disjoint");
  await inspect(["check"], "disjoint", 1);
  const gated = await inspect(["align", "check"], "incomplete", 1);
  assert(gated.incompleteReasons.includes("design-disjoint"));
  assertEquals(gated.findings, []);
  await design("coherent");
  await Deno.remove(join(store, "claims/implementation"), { recursive: true });
  const stale = await native([
    "align",
    "prepare",
    "--out",
    join(scratch, "stale"),
  ]);
  const staleBinding = join(stale.inputs[0], "binding.json");
  await Deno.writeTextFile(
    join(fixture, "main.any"),
    "changed after preparation\n",
  );
  const staleAnswer = join(scratch, "stale.egg");
  await Deno.writeTextFile(staleAnswer, '(element "changed" "function")');
  await run(compiler, [
    "align",
    "ingest",
    "--binding",
    staleBinding,
    "--claims",
    staleAnswer,
    "--root",
    fixture,
    "--store",
    store,
  ], 2);

  const tagRoot = join(scratch, "Tag import probe");
  await Deno.mkdir(join(tagRoot, ".sigil"), { recursive: true });
  const tagConfig = {
    sigilVersion: SIGIL_VERSION,
    workspace: { name: "tag-probe", members: [] },
    files: { include: ["**/*.sigil"], exclude: [] },
  };
  await Deno.writeTextFile(
    join(tagRoot, ".sigil/config.json"),
    JSON.stringify(tagConfig),
  );
  const providerText =
    "\uFEFFcomponent Provider {\r\ngoal {\r\nOwn vocabulary.\r\n}\r\ninterface {\r\n😀 A *café results* preserves content.\r\n}\r\n}\r\n";
  await Deno.writeTextFile(join(tagRoot, "provider.sigil"), providerText);
  await Deno.writeTextFile(
    join(tagRoot, "consumer.sigil"),
    "@provider.sigil from Provider import { café results }\ncomponent Consumer {\ngoal {\nUse vocabulary.\n}\ninterface {\nConsume café results and [notes](./notes.md).\n}\n}\n",
  );
  await run(language, ["check", tagRoot, "--format", "json"]);
  const tagStore = join(scratch, "tag store");
  const tagTrees = JSON.parse(
    await run(compiler, ["tree", "--root", tagRoot, "--store", tagStore]),
  ).trees;
  const consumer = tagTrees.find((t: { parse: { path: string } }) =>
    t.parse.path === "consumer.sigil"
  );
  assertEquals(consumer.resolution.imports.length, 1);
  assertEquals(consumer.resolution.references.length, 1);
  assertEquals(
    consumer.parse.components[0].sections[1].children[0].links.length,
    1,
  );
  await Deno.writeTextFile(
    join(tagRoot, ".sigil/config.json"),
    JSON.stringify({
      ...tagConfig,
      tools: {
        sigilc: {
          implementation: {
            design: ["consumer.sigil"],
            exclude: ["**"],
            allowEmpty: true,
          },
        },
      },
    }),
  );
  const selected = JSON.parse(
    await run(compiler, [
      "align",
      "prepare",
      "--root",
      tagRoot,
      "--store",
      tagStore,
      "--out",
      join(scratch, "tag-prep"),
    ]),
  );
  assertEquals(selected.selection.design.sources, [
    "consumer.sigil",
    "provider.sigil",
  ]);
  await Deno.writeTextFile(
    join(tagRoot, ".sigil/config.json"),
    JSON.stringify({ ...tagConfig, sigilVersion: "0.7.0" }),
  );
  const rejected = JSON.parse(
    await run(language, ["check", tagRoot, "--format", "json"], 1),
  );
  assert(
    rejected.diagnostics.some((d: { code: string }) =>
      d.code === "SIGIL_UNSUPPORTED_VERSION"
    ),
  );
  return {
    design: ["incomplete", "coherent", "loose", "disjoint"],
    implementation: ["incomplete", "closed", "converged", "drift"],
    staleIngest: 2,
  };
}

if (import.meta.main) {
  const suffix = Deno.build.os === "windows" ? ".exe" : "";
  const language = resolve(
    Deno.env.get("SIGIL_TEST_LANGUAGE") ?? `build/sigil${suffix}`,
  );
  const compiler = resolve(
    Deno.env.get("SIGIL_TEST_COMPILER") ??
      `packages/sigilc/target/debug/sigilc${suffix}`,
  );
  const scratch = await Deno.makeTempDir({
    prefix: "sigil current protocol Ω ",
  });
  try {
    const fixture = join(scratch, "workspace");
    await Deno.mkdir(join(fixture, ".sigil"), { recursive: true });
    await Deno.copyFile(
      new URL("./fixtures/release/project/main.sigil", import.meta.url),
      join(fixture, "main.sigil"),
    );
    await Deno.copyFile(
      new URL(
        "./fixtures/release/project/fixture-config.json",
        import.meta.url,
      ),
      join(fixture, ".sigil/config.json"),
    );
    await Deno.writeTextFile(
      join(fixture, "main.any"),
      "fixed source-independent fixture\n",
    );
    const run: Run = async (executable, args, code = 0) => {
      const output = await new Deno.Command(executable, {
        args,
        cwd: scratch,
        stdout: "piped",
        stderr: "piped",
      }).output();
      const text = new TextDecoder().decode(output.stdout);
      assertEquals(
        output.code,
        code,
        `${args.join(" ")}: ${
          new TextDecoder().decode(output.stderr)
        }\n${text}`,
      );
      return text;
    };
    console.log(
      JSON.stringify(
        await validateNativeProtocol({
          language,
          compiler,
          fixture,
          scratch,
          run,
        }),
      ),
    );
  } finally {
    await Deno.remove(scratch, { recursive: true });
  }
}
