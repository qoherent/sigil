import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../..");

await rm(path.join(directory, "dist"), { recursive: true, force: true });
await mkdir(path.join(directory, "build"), { recursive: true });

// Keep the bundled configuration schema a verbatim copy of the published
// source so the packaged VSIX cannot ship a stale schema. The synchronization
// is also asserted by tests/unit/contributions.test.ts.
await mkdir(path.join(directory, "schemas"), { recursive: true });
await cp(
  path.join(repository, "spec/sigil-config.schema.json"),
  path.join(directory, "schemas/sigil-config.schema.json"),
);

await Promise.all([
  build({
    entryPoints: [path.join(directory, "src/extension.ts")],
    outfile: path.join(directory, "dist/extension.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    sourcemap: false,
  }),
  build({
    entryPoints: [path.join(directory, "src/node-server.ts")],
    outfile: path.join(directory, "dist/server.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    alias: {
      "@qoherent/sigil-core": path.join(repository, "packages/core/src/mod.ts"),
    },
    sourcemap: false,
  }),
  build({
    entryPoints: [path.join(directory, "tests/extension/index.ts")],
    outfile: path.join(directory, "dist/test/extension.js"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    external: ["vscode"],
    sourcemap: false,
  }),
]);
