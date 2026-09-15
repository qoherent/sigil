import assert from "node:assert/strict";
import test from "node:test";
import { type DesignReport, nativeState } from "../../src/compilation.ts";
import { sourceDigest } from "../../src/coordinates.ts";
import {
  type ProjectedDiagnostic,
  publishCompilationDiagnostics,
} from "../../src/diagnostic-projection.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  const entered = deferred(), release = deferred();
  const sources = new Map(["first.sigil", "second.sigil"].map((source) => {
    const text = `source ${source}`;
    return [source, {
      bytes: Buffer.from(text),
      document: {
        version: 1,
        isDirty: false,
        text,
        getText() {
          return this.text;
        },
      },
    }];
  }));
  const publications: { codes: string[]; status: string }[] = [];
  const visible = {
    diagnostics: [] as readonly ProjectedDiagnostic[],
    status: "compiling",
  };
  const report = (
    code: string,
    state: DesignReport["world"]["state"],
  ): DesignReport => ({
    version: 2,
    world: { state },
    diagnostics: {
      omitted: 0,
      items: [{
        code,
        side: "design",
        severity: "warning",
        message: code,
        omitted_locations: 0,
        locations: [...sources].map(([source, { bytes }]) => ({
          source,
          side: "design",
          coordinate_system: "utf8-bytes",
          source_digest: sourceDigest(bytes),
          range: { start: 0, end: 6 },
        })),
      }],
    },
  });
  function start(report: DesignReport, isCurrent: () => boolean, pause = true) {
    return publishCompilationDiagnostics(report, {
      async loadSource(source) {
        if (pause && source === "second.sigil") {
          // The first document has already been captured and mapped.
          entered.resolve();
          await release.promise;
        }
        return sources.get(source)!;
      },
      isCurrent,
      publish(diagnostics) {
        visible.diagnostics = diagnostics;
        visible.status = nativeState(report)!;
        publications.push({
          codes: diagnostics.map((d) => d.finding.code),
          status: visible.status,
        });
      },
    });
  }
  return { sources, entered, release, publications, visible, report, start };
}

for (const change of ["dirty", "saved version"] as const) {
  test(`a ${change} edit to an already captured document prevents publication`, async () => {
    const h = harness();
    const pending = h.start(h.report("obsolete", "Disjoint"), () => true);
    await h.entered.promise;
    const document = h.sources.get("first.sigil")!.document;
    if (change === "dirty") document.isDirty = true;
    else document.version++;
    document.text = "changed after its range was mapped";
    h.release.resolve();
    await assert.rejects(
      pending,
      /Source changed during diagnostic projection/,
    );
    assert.deepEqual(h.publications, []);
    assert.deepEqual(h.visible, { diagnostics: [], status: "compiling" });
  });
}

test("a workspace edit during projection preserves the stale status", async () => {
  const h = harness();
  let revision = 1;
  const startedAt = revision;
  const pending = h.start(
    h.report("obsolete", "Disjoint"),
    () => revision === startedAt,
  );
  await h.entered.promise;
  revision++;
  h.sources.get("first.sigil")!.document.version++;
  h.visible.status = "stale";
  h.release.resolve();
  await pending;
  assert.deepEqual(h.publications, []);
  assert.deepEqual(h.visible, { diagnostics: [], status: "stale" });
});

test("a replacement compilation stays visible when an obsolete projection finishes", async () => {
  const h = harness();
  const obsolete = {}, replacement = {};
  let active = obsolete;
  const pending = h.start(
    h.report("obsolete", "Disjoint"),
    () => active === obsolete,
  );
  await h.entered.promise;
  assert.deepEqual(h.publications, []);

  active = replacement;
  await h.start(
    h.report("replacement", "Coherent"),
    () => active === replacement,
    false,
  );
  const replacementDiagnostics = h.visible.diagnostics;
  assert.equal(h.visible.status, "Coherent");
  assert.equal(replacementDiagnostics.length, 2);
  h.release.resolve();
  await pending;

  assert.deepEqual(h.publications, [{
    codes: ["replacement", "replacement"],
    status: "Coherent",
  }]);
  assert.equal(h.visible.diagnostics, replacementDiagnostics);
  assert.equal(h.visible.status, "Coherent");
});
